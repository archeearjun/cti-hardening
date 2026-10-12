import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {createCourseraResponseSampleScript} from '../src/domain/coursera-response-sample.ts';

const shell='https://www.coursera.org/teach/synthetic/Sample_fixture_123/content/edit';
const origin='https://www.coursera.org',source=createCourseraResponseSampleScript(shell);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cti-response-sample-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(scratch,'key.pem'),
 '-out',path.join(scratch,'cert.pem'),'-subj','/CN=www.coursera.org','-days','1'],{stdio:'ignore'});
const raw='{\n "questions": [{"id":"q1","prompt":"Café 日本語 α?","options":[{"label":"A","correct":true}],"unknownNumber":9007199254740993}]\n}';
let requests=[],authoringLoads=0;
const server=https.createServer({key:fs.readFileSync(path.join(scratch,'key.pem')),cert:fs.readFileSync(path.join(scratch,'cert.pem'))},(req,res)=>{
 const url=new URL(req.url,origin);
 if(url.pathname.startsWith('/api/')){
  requests.push({pathname:url.pathname,method:req.method,authenticated:req.headers.cookie?.includes('fixtureSession=fixture-http-only-cookie')===true});
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(url.pathname==='/api/authoringQuestionOversize.v1'){
   const body=JSON.stringify({padding:'x'.repeat(6*1024*1024+1)});
   if(url.searchParams.has('stream')){
    let index=0;
    const next=()=>{if(index>=body.length){res.end();return;}res.write(body.slice(index,index+65536));index+=65536;setImmediate(next);};next();
   }else{res.setHeader('Content-Length',Buffer.byteLength(body));res.end(body);}return;
  }
  if(url.pathname==='/api/authoringQuestionMedium.v1'){res.end(JSON.stringify({padding:'x'.repeat(4*1024*1024)}));return;}
  if(/^\/api\/(?:auth\.|users\.|courseSessions\.|analytics\.)/i.test(url.pathname)){res.end('{"private":"excluded-route-secret"}');return;}
  if(url.pathname==='/api/authoringQuestionAuthenticated.v1'){
   res.end(JSON.stringify({authenticated:requests.at(-1).authenticated,questions:[{id:'q1'}]}));return;
  }
  res.end(raw);return;
 }
 if(url.pathname.startsWith('/teach/'))authoringLoads++;
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.setHeader('Set-Cookie','fixtureSession=fixture-http-only-cookie; HttpOnly; Secure; SameSite=Lax; Path=/');
 // The observer needs no external script, unsafe-eval policy relaxation, or injected script element.
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'nonce-fixture'; style-src 'self'; connect-src 'self'");
 res.end('<!doctype html><title>Response observer fixture</title><body><main>Authoring outline</main><button id="data-tab">Open lightweight data tab</button><script nonce="fixture">document.getElementById("data-tab").onclick=()=>{const tab=window.open("about:blank");tab.document.body.textContent="Data-only capture fixture";};</script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{channel:'chromium'}),
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',`--host-resolver-rules=MAP www.coursera.org 127.0.0.1:${server.address().port}`]});
 const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true}),page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(shell);
 await page.evaluate(()=>{window.fixtureBefore={fetch,open:XMLHttpRequest.prototype.open,send:XMLHttpRequest.prototype.send};
  const nativeFetch=window.fetch;window.fixtureFetch=function(...args){const promise=Reflect.apply(nativeFetch,this,args);window.fixtureLastPromise=promise;return promise;};window.fetch=window.fixtureFetch;});
 await page.evaluate(source);assert.equal(requests.length,0,'Installing the observer initiates zero API requests');
 const originalResponses=await page.evaluate(async()=>{
  const url='/api/authoringQuestionDefinitions.v1?courseId=Sample_fixture_123&questionId=q1&q=fixtureQuestionDefinition&fields=definition,questions(options,feedback),sourceMath&includes=authoringQuestions.v1,questionParts.v1&token=request-query-secret&authorization=request-query-secret';
  const promise=fetch(url,{method:'POST',headers:{Authorization:'Bearer fixture-authorization-secret'},body:'fixture-request-body-secret'});
  const samePromise=promise===window.fixtureLastPromise,fetchText=await (await promise).text();
  const xhrText=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET','/api/authoringAssessmentDefinitions.v1?id=quiz1');xhr.onload=()=>resolve(xhr.responseText);xhr.onerror=reject;xhr.send();});
  for(const path of ['auth','users','courseSessions','analytics'])await (await fetch('/api/'+path+'.v1')).text();
  await (await fetch('/api/authoringQuestionDefinitions.v1?questionId=q1')).text();
  const jsonXhr=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET','/api/authoringQuestionParsed.v1');xhr.responseType='json';xhr.onload=()=>resolve(xhr.response.questions[0].id);xhr.onerror=reject;xhr.send();});
  return {samePromise,fetchText,xhrText,jsonXhr};
 });
 assert.equal(originalResponses.samePromise,true,'The original fetch promise is returned unchanged');
 assert.equal(originalResponses.fetchText,raw);assert.equal(originalResponses.xhrText,raw);assert.equal(originalResponses.jsonXhr,'q1');
 await page.waitForFunction(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot().captured===3);
 assert.equal(requests.length,8,'Only the original application requests reached the server');assert(requests.every(request=>request.authenticated));
 const snapshot=await page.evaluate(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot());
 assert.equal(snapshot.responses[0].method,'POST');assert.deepEqual(snapshot.responses[0].query,[['courseId','Sample_fixture_123'],['questionId','q1'],
  ['q','fixtureQuestionDefinition'],['fields','definition,questions(options,feedback),sourceMath'],['includes','authoringQuestions.v1,questionParts.v1']]);
 assert(snapshot.responses.some(response=>response.source==='XHR'));assert(snapshot.responses.every(response=>response.rawJson===raw));
 assert.equal(snapshot.declined.UNSUPPORTED_XHR_RESPONSE_TYPE,1);
 let downloads=[];page.on('download',download=>downloads.push(download));
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download response sample',exact:true}).click();
 const file=JSON.parse(fs.readFileSync(await (await downloadPromise).path(),'utf8')),serialized=JSON.stringify(file);
 assert.equal(file.kind,'CTI_COURSERA_RESPONSE_SAMPLE_V1');assert.equal(file.notForCourseAudit,true);assert.equal(file.captured,3);
 for(const excluded of ['fixture-http-only-cookie','fixture-authorization-secret','fixture-request-body-secret','request-query-secret','excluded-route-secret'])
  assert(!serialized.includes(excluded),`Sample excludes ${excluded}`);
 assert.equal(downloads.length,1);assert(await page.getByRole('button',{name:'Download response sample',exact:true}).isDisabled());
 assert(await page.evaluate(()=>window.fetch===window.fixtureFetch && XMLHttpRequest.prototype.open===window.fixtureBefore.open && XMLHttpRequest.prototype.send===window.fixtureBefore.send));

 // The per-body limit is measured on actual streamed bytes, including unknown-length bodies.
 await page.evaluate(source);const beforeOversize=requests.length;
 const lengths=await page.evaluate(async()=>{const out=[];for(const suffix of ['', '?stream=1'])out.push((await(await fetch('/api/authoringQuestionOversize.v1'+suffix)).text()).length);return out;});
 assert(lengths.every(length=>length>6*1024*1024),'Original callers retain the whole oversized response');
 await page.waitForFunction(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot().declined.BODY_BYTE_LIMIT===2);
 assert.equal((await page.evaluate(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot())).captured,0);
 assert.equal(requests.length-beforeOversize,2);await page.getByRole('button',{name:'Stop',exact:true}).click();

 await page.evaluate(source);const beforeTotal=requests.length;
 for(let i=0;i<3;i++){await page.evaluate(async()=>{await(await fetch('/api/authoringQuestionMedium.v1')).text();});
  if(i<2)await page.waitForFunction(n=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot().captured===n,i+1);}
 await page.waitForFunction(()=>!window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot().active);
 const total=await page.evaluate(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot());
 assert.equal(total.stopReason,'TOTAL_BYTE_LIMIT');assert.equal(total.captured,2);assert(total.totalBytes<=12*1024*1024);
 assert.equal(requests.length-beforeTotal,3);

 await page.evaluate(source);const beforeCount=requests.length;
 await page.evaluate(async()=>{for(let i=0;i<40;i++)await(await fetch('/api/authoringQuestionDefinitions.v1?questionId=q'+i)).text();});
 await page.waitForFunction(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot().captured===40);
 assert.equal(requests.length-beforeCount,40);assert.equal((await page.evaluate(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot())).stopReason,'BODY_COUNT_LIMIT');

 await page.evaluate(source);
 await page.evaluate(()=>{window.fixtureRealNow=Date.now;const sample=window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot();Date.now=()=>Date.parse(sample.startedAt)+sample.limits.durationMs+1000;});
 await page.waitForFunction(()=>window.__CTI_COURSERA_RESPONSE_SAMPLE.getSnapshot().stopReason==='TIME_LIMIT');
 await page.evaluate(()=>{Date.now=window.fixtureRealNow;});
 await page.evaluate(source);await page.evaluate(()=>{const observedFetch=window.fetch;window.fixtureLaterFetch=(...args)=>Reflect.apply(observedFetch,window,args);window.fetch=window.fixtureLaterFetch;window.__CTI_COURSERA_RESPONSE_SAMPLE.stop();});
 assert(await page.evaluate(()=>window.fetch===window.fixtureLaterFetch),'Stopping preserves a newer observer installed by another library');
 await page.evaluate(()=>{window.fetch=window.fixtureFetch;});

 // Browser feasibility only: an inherited-origin empty tab fetches with normal cookies,
 // without loading the authoring app. No real Coursera authoring API is asserted here.
 const beforePopupLoads=authoringLoads,popupPromise=page.waitForEvent('popup');await page.locator('#data-tab').click();const popup=await popupPromise;
 const lightweight=await popup.evaluate(async origin=>({url:location.href,origin:window.origin,
  result:await(await fetch(origin+'/api/authoringQuestionAuthenticated.v1')).json()}),origin);
 assert.equal(lightweight.url,'about:blank');assert.equal(lightweight.origin,origin);assert.equal(lightweight.result.authenticated,true);
 assert.equal(authoringLoads,beforePopupLoads);await popup.close();assert.deepEqual(errors,[]);
 console.log('Coursera response sample: PASS (passive fetch/XHR, lossless raw JSON, bounded bodies/count/time, restoration, one local download; inherited-origin authenticated data-tab proof uses synthetic responses)');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(scratch,{recursive:true,force:true});}
