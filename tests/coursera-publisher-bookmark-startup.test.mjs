import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createCourseraDirectDataCaptureBookmark} from '../src/domain/coursera-direct-data-capture.ts';
import {createDirectPublisherFirstPartyV1} from '../src/extractors/coursera/direct-data-publisher-first-party.js';
const courseId='Publisher_fixture_123';
const source=decodeURIComponent(createCourseraDirectDataCaptureBookmark().slice('javascript:'.length));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({origin='https://opentextbc.ca',opener=true,hash=true,throwOnListen=false}={}) {
 const elements=[],alerts=[],messages=[],parentListeners=new Set(),childListeners=new Set();
 const parent={location:new URL('https://www.coursera.org/teach/fixture/'+courseId+'/content'),closed:false,
  addEventListener(_,f){parentListeners.add(f)},removeEventListener(_,f){parentListeners.delete(f)},
  postMessage(data,target){assert.equal(target,'https://www.coursera.org');messages.push(data.type);queueMicrotask(()=>{for(const f of parentListeners)f({data,origin,source:child})})},
  open(url,name,...features){assert.deepEqual(features,[],"normal tab: do not request a toolbar-less popup");assert.match(name,/^CTIPublisher_/);child.location=new URL(url);return child}};
 const child={closed:false,close(){throw Error("Bookmark must never close the browser window")},opener:opener?parent:null,focus(){},
  addEventListener(type,f){if(throwOnListen)throw Error('SIMULATED_STARTUP_FAILURE');if(type==='message')childListeners.add(f)},
  removeEventListener(type,f){if(type==='message')childListeners.delete(f)},
  postMessage(data,target){assert.equal(target,origin);queueMicrotask(()=>{for(const f of childListeners)f({data,origin:'https://www.coursera.org',source:parent})})}};
 child.top=child;
 const transport=createDirectPublisherFirstPartyV1({windowImpl:parent,courseId,entries:[{itemId:'ReprH',atomId:'fixtureAtom',providerId:'fixtureProvider@1',targetUrl:origin+'/mathfortrades2/?p=179/#main',imageUrl:origin+'/mathfortrades2/wp-content/uploads/original.png',sourceSha256:'a'.repeat(64)}]});
 if(!hash)child.location.hash='';
 const document={body:{append(...x){elements.push(...x)}},getElementById(id){return elements.find(x=>x.id===id)},createElement(tag){return{tag,style:{},append(...x){this.children=x},remove(){const i=elements.indexOf(this);if(i>=0)elements.splice(i,1)}}}};
 const context=vm.createContext({window:child,location:child.location,document,URL,URLSearchParams,crypto:webcrypto,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,console,alert:m=>alerts.push(m),fetch(){throw Error('No image request is allowed during startup')}});
 return {transport,child,messages,alerts,elements,start(){return new vm.Script(source).runInContext(context)},
  forgeReady(type="ready"){const p=new URLSearchParams(child.location.hash.slice(1));for(const f of parentListeners)f({origin,source:child,data:{protocol:'CTI_PUBLISHER_FIRST_PARTY_V1',courseId,nonce:p.get('nonce'),sessionId:p.get('session'),type,planSha256:transport.snapshot().planSha256}})},
  close(){child.__CTI_PUBLISHER_FIRST_PARTY_CAPTURE__?.close();transport.close()}};
}
test('actual generated bookmark initializes on each allowed publisher and completes hello/plan/ready, not tab-open or unsolicited-ready',async()=>{
 for(const origin of ['https://opentextbc.ca','https://pressbooks.bccampus.ca']) {
  const f=fixture({origin});try{
   await turn();assert.equal(f.transport.snapshot().connected,false);f.forgeReady();assert.equal(f.transport.snapshot().connected,false);
   const originalUrl=f.child.location.href;
   assert.equal(f.start(),undefined,"bookmark completion must not replace the document");await f.transport.ready();
   assert.equal(f.child.location.href,originalUrl);assert.equal(f.child.closed,false);
   assert.equal(f.transport.snapshot().connected,true);assert.equal(f.child.__CTI_PUBLISHER_FIRST_PARTY_CAPTURE__.snapshot().connected,true);
   assert(f.messages.includes('hello'));assert(f.messages.includes('ready'));assert.equal(f.elements.length,1);assert.deepEqual(f.alerts,[]);
   assert.equal(f.transport.snapshot().requests,0);assert.equal(f.transport.snapshot().receivedBytes,0);
   f.start();assert.equal(f.elements.length,1,'repeated activation focuses existing handler');
  }finally{f.close()}
 }
});
test('actual generated bookmark shows missing-context and severed-opener errors on publisher origin',async()=>{
 for(const [options,code] of [[{hash:false},'INVALID_RECOVERY_URL'],[{opener:false},'OPENER_UNAVAILABLE'],[{throwOnListen:true},'SIMULATED_STARTUP_FAILURE']]) {
  const f=fixture(options);try{
   f.start();await turn();assert.equal(f.elements.length,1);assert.match(f.elements[0].children[0].textContent,new RegExp(code));
   assert.equal(f.transport.snapshot().connected,false);assert.equal(f.transport.snapshot().requests,0);assert.equal(f.elements[0].children[1].disabled,true);assert.deepEqual(f.alerts,[]);
  }finally{f.close()}
 }
});

test('timeouts distinguish no handler hello from a missing plan acknowledgement',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 for(const hello of [false,true]) {
  const f=fixture();try {
   await turn();if(hello)f.forgeReady('hello');
   t.mock.timers.tick(300000);
   assert.equal(f.transport.snapshot().connected,false);
   assert.equal(f.transport.snapshot().stopped,'PUBLISHER_FIRST_PARTY_'+(hello?'PLAN_NOT_ACKNOWLEDGED':'HANDLER_NOT_OBSERVED'));
   assert.equal(f.transport.snapshot().receivedBytes,0);
  }finally{f.close()}
 }
});
