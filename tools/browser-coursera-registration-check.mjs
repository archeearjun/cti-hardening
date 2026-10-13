import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Exercise Chrome's Tab -> auto-attached Page sessions, including explicit
// session replacement. These local fixtures retain no authenticated content.
// Replacement is a fault injection, not a diagnosis of a private browser.
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/controller'?'<title>CTI controller</title><h1>Controller</h1>':'<title>CTI child fixture</title><h1>Child</h1>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,controllerOrigin='http://localhost:'+server.address().port;
const profile=fs.mkdtempSync('/tmp/cti-registration-browser-');
const proc=spawn(process.env.CTI_CHROMIUM_PATH || chromium.executablePath(),['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run',controllerOrigin+'/controller'],{stdio:['ignore','ignore','pipe']});
let stderr='';proc.stderr.on('data',b=>stderr+=b);
let port,ws;const pending=new Map();let seq=1;const history=[];const callbacks=[];
try{
 for(let i=0;i<100;i++){try{port=fs.readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{}await delay(100)}
 assert(port,'No debug server');const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();
 ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(JSON.stringify(m.error)));else p?.resolve(m.result);}else{history.push(m);for(const cb of callbacks)cb(m)}};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=seq++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(Error('Timed out '+method))}},15000).unref()});
 const wait=async(test,ms=10000)=>{const start=Date.now();while(Date.now()-start<ms){const result=test();if(result)return result;await delay(25)}throw Error('Wait timed out')};
 await send('Target.setDiscoverTargets',{discover:true,filter:[{}]});
 const controller=(await send('Target.getTargets',{filter:[{}]})).targetInfos.find(t=>t.type==='page'&&t.url===controllerOrigin+'/controller');assert(controller);
 const parentSession=(await send('Target.attachToTarget',{targetId:controller.targetId,flatten:true})).sessionId;
 await send('Runtime.evaluate',{expression:'window.child=window.open('+JSON.stringify(origin+'/child')+',"_blank");Boolean(window.child)',returnByValue:true,userGesture:true},parentSession);
 await delay(500);const allTargets=(await send('Target.getTargets',{filter:[{}]})).targetInfos;
 const childTab=allTargets.find(t=>t.type==='tab'&&t.url===origin+'/child');assert(childTab,'No child tab');
 let tabSession=(await send('Target.attachToTarget',{targetId:childTab.targetId,flatten:true})).sessionId;
 await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'page',exclude:false}]},tabSession);
 let pageEvent=await wait(()=>history.find(m=>m.sessionId===tabSession&&m.method==='Target.attachedToTarget'&&m.params.targetInfo.type==='page'));
 let pageSession=pageEvent.params.sessionId;const initialTargetId=pageEvent.params.targetInfo.targetId;
 console.log('ATTACHED',JSON.stringify({tabTargetId:childTab.targetId,tabSession,pageSession,pageTargetId:initialTargetId}));
 await send('Page.enable',{},pageSession);await send('Inspector.enable',{},pageSession);
 const registration=await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__ctiProbe="REGISTERED";localStorage.setItem("cti-probe-runs",String(Number(localStorage.getItem("cti-probe-runs")||0)+1));',runImmediately:true},pageSession);
 console.log('REGISTERED',registration);
 async function snapshot(label){const result=await send('Runtime.evaluate',{expression:'JSON.stringify({marker:window.__ctiProbe,runs:localStorage.getItem("cti-probe-runs"),path:location.pathname})',returnByValue:true},pageSession);console.log(label,JSON.stringify({session:pageSession,state:result.result?.value,exception:result.exceptionDetails}));return result.result?.value}
 const initial=JSON.parse(await snapshot('INITIAL'));assert.equal(initial.marker,'REGISTERED');assert.equal(initial.runs,'1');
 for(let crash=1;crash<=3;crash++){
  const before=history.length;send('Page.crash',{},pageSession).catch(()=>{});
  await wait(()=>history.slice(before).find(m=>/^(?:Target|Inspector)\.targetCrashed$/.test(m.method)));
  await send('Runtime.evaluate',{expression:'window.child.location.href='+JSON.stringify(origin+'/child?resume='+crash)},parentSession);
  await delay(1000);
  const attachments=history.slice(before).filter(m=>/Target\.(attachedToTarget|detachedFromTarget|targetCrashed|targetDestroyed)/.test(m.method));
  console.log('CRASH_EVENTS_'+crash,JSON.stringify(attachments));
  const replacement=attachments.findLast(m=>m.method==='Target.attachedToTarget'&&m.sessionId===tabSession&&m.params.targetInfo.type==='page');if(replacement)pageSession=replacement.params.sessionId;
  const resumed=JSON.parse(await snapshot('AFTER_CRASH_'+crash));assert.equal(resumed.marker,'REGISTERED');assert.equal(resumed.runs,String(crash+1));
 }
 const oldTabSession=tabSession,oldPageSession=pageSession,beforeDetach=history.length;
 await send('Target.detachFromTarget',{sessionId:tabSession});
 tabSession=(await send('Target.attachToTarget',{targetId:childTab.targetId,flatten:true})).sessionId;
 await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'page',exclude:false}]},tabSession);
 const newPage=await wait(()=>history.slice(beforeDetach).find(m=>m.sessionId===tabSession&&m.method==='Target.attachedToTarget'&&m.params.targetInfo.type==='page'));
 pageSession=newPage.params.sessionId;
 console.log('SESSION_REPLACED',JSON.stringify({oldTabSession,oldPageSession,tabSession,pageSession,sameTab:childTab.targetId,samePage:newPage.params.targetInfo.targetId===initialTargetId}));
 await send('Runtime.evaluate',{expression:'window.child.location.href='+JSON.stringify(origin+'/child?replacement=1')},parentSession);await delay(1000);
 const missing=JSON.parse(await snapshot('AFTER_SESSION_REPLACEMENT'));assert.equal(missing.marker,undefined);assert.equal(missing.runs,'4');
 try{await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__badTab=true',runImmediately:true},tabSession);throw Error('Page command unexpectedly supported by Tab')}catch(error){console.log('TAB_PAGE_COMMAND',error.message);assert.match(error.message,/wasn.t found|method.*not found/i)}
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__ctiProbe="RE_REGISTERED";',runImmediately:true},pageSession);
 const restored=JSON.parse(await snapshot('AFTER_NEW_PAGE_REGISTRATION'));assert.equal(restored.marker,'RE_REGISTERED');assert.equal(restored.runs,'4');
 console.log('PASS',JSON.stringify({normalCrashes:3,registrationSurvivesNormalCrash:true,registrationLostOnSessionReplacement:true,localStoragePreserved:true,tabTargetRejectsPageCommand:true,newPageRegistrationWorks:true,scope:'Native browser Tab auto-attachment and injected session replacement; no private browser trigger or whole-course completion claim.'}));
} catch(error){console.error('::error::Chrome registration boundary: '+String(error.message).replace(/[\r\n]+/g,' ').slice(0,500));console.log('RECENT_EVENTS',JSON.stringify(history.slice(-15)));throw error;} finally {try{ws?.close()}catch{}proc.kill('SIGTERM');server.close();await delay(500);try{fs.rmSync(profile,{recursive:true,force:true})}catch{}}
