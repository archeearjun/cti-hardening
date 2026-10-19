import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectPublisherFirstPartyV1,
  directPublisherFirstPartyContextV1,
  directPublisherFirstPartyPlanV1,
  runDirectPublisherFirstPartyV1,
} from "../src/extractors/coursera/direct-data-publisher-first-party.js";

const courseId="iu5pMbTVEfG-2xL_w9lGpQ";
const entry={itemId:"ReprH",atomId:"nativeAtom123",providerId:"nativeProvider@1",
  targetUrl:"https://opentextbc.ca/mathfortrades2/?p=179/#main",
  imageUrl:"https://opentextbc.ca/mathfortrades2/wp-content/uploads/2020/05/original.png",sourceSha256:"a".repeat(64)};
const turn=() => new Promise(resolve => setImmediate(resolve));
function imageResponse(url,bytes,options={}) {
  let reads=0,cancelled=0;
  const response={status:options.status || 200,type:options.type || "basic",url:options.url || url,redirected:options.redirected || false,
    headers:new Headers({"content-type":"image/png",...(options.headers || {})}),
    body:new ReadableStream({pull(controller) {reads++;if (reads===1) controller.enqueue(bytes);else controller.close();},cancel() {cancelled++;}}, {highWaterMark:0})};
  return {response,get reads() {return reads;},get cancelled() {return cancelled;}};
}
function fixture({entries=[entry],fetchImpl,blocked=false,start=true,limits}={}) {
  const parentListeners=new Set(),providerListeners=new Set(),messages=[],opens=[],fetches=[],statuses=[];
  const parent={location:{origin:"https://www.coursera.org",href:"https://www.coursera.org/teach/course/"+courseId+"/content"},closed:false,
    addEventListener(type,listener) {assert.equal(type,"message");parentListeners.add(listener);},
    removeEventListener(type,listener) {assert.equal(type,"message");parentListeners.delete(listener);},
    postMessage(data,targetOrigin,transfer=[]) {
      assert.equal(targetOrigin,"https://www.coursera.org");
      const copied=structuredClone(data,{transfer});messages.push({to:"parent",data:copied});
      queueMicrotask(() => {for (const listener of parentListeners) listener({data:copied,origin:provider.location.origin,source:provider});});
    },
    open(url,name,features) {opens.push({url,name,features});provider.location=new URL(url);return blocked?null:provider;}};
  const provider={location:null,closed:false,opener:parent,focus() {},
    addEventListener(type,listener) {assert.equal(type,"message");providerListeners.add(listener);},
    removeEventListener(type,listener) {assert.equal(type,"message");providerListeners.delete(listener);},
    postMessage(data,targetOrigin,transfer=[]) {
      assert.equal(targetOrigin,"https://opentextbc.ca");
      const copied=structuredClone(data,{transfer});messages.push({to:"provider",data:copied});
      queueMicrotask(() => {for (const listener of providerListeners) listener({data:copied,origin:parent.location.origin,source:parent});});
    }};
  provider.top=provider;
  const transport=createDirectPublisherFirstPartyV1({courseId,entries,windowImpl:parent,limits,onStatus:value=>statuses.push(value)});
  let collector=null;
  function startProvider() {
    collector=runDirectPublisherFirstPartyV1({windowImpl:provider,limits,fetchImpl:(url,options) => {
      fetches.push({url,options});
      return fetchImpl ? fetchImpl(url,options) : imageResponse(url,Uint8Array.from([137,80,78,71,13,10,26,10])).response;
    }});
    return collector;
  }
  if (start && !blocked) startProvider();
  function emitToParent(data,overrides={}) {
    const url=new URL(opens[0].url), params=new URLSearchParams(url.hash.slice(1));
    const message={protocol:"CTI_PUBLISHER_FIRST_PARTY_V1",nonce:params.get("nonce"),sessionId:params.get("session"),courseId,...data};
    for (const listener of parentListeners) listener({data:message,origin:provider.location.origin,source:provider,...overrides});
  }
  return {transport,parent,provider,messages,opens,fetches,statuses,parentListeners,providerListeners,startProvider,emitToParent,
    get collector() {return collector;},
    close() {transport.close();collector?.close();}};
}

test("frozen recovery plans admit only bounded original same-origin image source identities", () => {
  const plan=directPublisherFirstPartyPlanV1(courseId,[entry,{...entry}]);
  assert.equal(plan.entries.length,1);assert(Object.isFrozen(plan.entries[0]));
  for (const change of [{imageUrl:"https://evil.test/a.png"},{imageUrl:entry.imageUrl+"?token=secret"},
    {targetUrl:"https://opentextbc.ca/mathfortrades2/chapter/area/"},{sourceSha256:"bad"},{cookie:"never"},
    {imageUrl:"https://pressbooks.bccampus.ca/mathfortrades2/wp-content/uploads/original.png"}])
    assert.equal(directPublisherFirstPartyPlanV1(courseId,[{...entry,...change}]),null);
  assert.equal(directPublisherFirstPartyPlanV1(courseId,Array(1025).fill(entry)),null);
  assert.equal(directPublisherFirstPartyPlanV1("short",[entry]),null);
});

test("recovery opens synchronously, uses an opaque fragment and fails explicitly on blocked popups", async () => {
  const f=fixture({blocked:true});
  assert.equal(f.opens.length,1);
  const url=new URL(f.opens[0].url), context=directPublisherFirstPartyContextV1(url);
  assert.equal(url.origin,"https://opentextbc.ca");assert.equal(url.search,"?p=179/");
  assert.equal(context.courseId,courseId);assert.match(context.nonce,/^[a-f0-9]{64}$/);
  assert(!f.opens[0].url.includes(entry.sourceSha256));
  assert.equal(f.opens[0].features,undefined,"preserve opener without requesting popup chrome");
  await assert.rejects(f.transport.ready(),{code:"PUBLISHER_FIRST_PARTY_POPUP_BLOCKED"});
  assert.equal(f.parentListeners.size,0);
});

test("the same bookmark collector rejects unknown origins, missing opener and subframes", () => {
  assert.equal(directPublisherFirstPartyContextV1(new URL("https://evil.test/#cti-publisher-recovery=1")),null);
  const f=fixture({start:false});
  try {
    f.provider.opener=null;assert.equal(f.startProvider(),null);
    f.provider.opener=f.parent;f.provider.top={};assert.equal(f.startProvider(),null);
    f.provider.top=f.provider;f.provider.location.hash+="&cookie=not-accepted";assert.equal(f.startProvider(),null);
    assert.equal(f.providerListeners.size,0);
  } finally {f.close();}
});

test("source window, origin, nonce, course and session all bind the handshake", async () => {
  const f=fixture({start:false});let resolved=false;
  f.transport.ready().then(()=>{resolved=true;});
  try {
    await turn();
    for (const overrides of [{origin:"https://evil.test"},{source:{}},
      {data:{type:"hello"} }]) f.emitToParent({type:"hello"},overrides);
    for (const change of [{nonce:"0".repeat(64)},{sessionId:"0".repeat(32)},{courseId:"otherCourse123"}])
      f.emitToParent({type:"hello",...change});
    await turn();assert.equal(resolved,false);
    f.startProvider();const ready=await f.transport.ready();assert.match(ready.planSha256,/^[a-f0-9]{64}$/);
    assert.equal(resolved,true);assert.equal(f.fetches.length,0);
  } finally {f.close();}
});

test("first-party bytes stream in acknowledged 64 KiB chunks and preserve source binding without credentials", async () => {
  const bytes=new Uint8Array(150000);bytes.set([137,80,78,71,13,10,26,10]);
  let native;
  const f=fixture({fetchImpl:url => {native=imageResponse(url,bytes);return native.response;}});
  try {
    const ready=await f.transport.ready(), binding={courseId,itemId:entry.itemId,atomId:entry.atomId,providerId:entry.providerId,
      targetUrl:entry.targetUrl,sourceSha256:entry.sourceSha256,...ready};
    const result=await f.transport.request({targetUrl:entry.targetUrl,imageUrl:entry.imageUrl,sourceSha256:entry.sourceSha256,binding});
    assert.deepEqual(result.firstPartyBinding,binding);assert(Object.isFrozen(result.firstPartyBinding));
    assert.equal(result.receipt.transport,"FIRST_PARTY_BROWSER");assert.equal(result.receipt.collectorContext,"PROVIDER_PAGE_BROWSER");
    assert.equal(result.response.type,"basic");assert.equal(result.response.url,entry.imageUrl);
    assert.equal(f.messages.filter(m=>m.data.type==="pull").length,0);assert.equal(native.reads,0);
    const reader=result.response.body.getReader(),parts=[];
    while (true) {const next=await reader.read();if (next.done) break;parts.push(next.value);}
    assert.deepEqual(Buffer.concat(parts.map(p=>Buffer.from(p))),Buffer.from(bytes));
    const chunks=f.messages.filter(m=>m.data.type==="chunk").map(m=>m.data);
    assert.deepEqual(chunks.map(m=>m.offset),[0,65536,131072]);
    assert.deepEqual(chunks.map(m=>m.bytes.byteLength),[65536,65536,18928]);
    assert(chunks.every(m=>m.observedBytes===bytes.length));assert.equal(result.response.observedBytes(),bytes.length);
    assert.equal(f.transport.snapshot().receivedBytes,bytes.length);assert.equal(f.transport.snapshot().observedBytes,bytes.length);
    assert.equal(f.fetches[0].options.credentials,"same-origin");assert.equal(f.fetches[0].options.mode,"same-origin");
    assert.equal(f.fetches[0].options.redirect,"error");assert.equal(f.fetches[0].options.headers,undefined);
    assert(!JSON.stringify(f.messages).match(/set-cookie|authorization|cf_clearance/i));
    assert.equal(native.reads,2);assert.equal(f.transport.snapshot().active,0);
  } finally {f.close();}
});

test("same-URL cross-item reuse requires each exact planned native identity", async () => {
  const second={...entry,itemId:"otherItem",providerId:"otherProvider@2"},f=fixture({entries:[entry,second]});
  try {
    await f.transport.ready();
    for (const payload of [{targetUrl:entry.targetUrl,imageUrl:entry.imageUrl,sourceSha256:entry.sourceSha256},
      {...entry,itemId:"notPlanned"},{...entry,atomId:"wrongAtom"},{...entry,sourceSha256:"b".repeat(64)},
      {...entry,headers:{cookie:"never"}}]) await assert.rejects(f.transport.request(payload),{code:"PUBLISHER_FIRST_PARTY_SOURCE_NOT_PLANNED"});
    const result=await f.transport.request(second);assert.equal(result.firstPartyBinding.itemId,second.itemId);
    await result.response.body.cancel();assert.equal(f.fetches.length,1);
  } finally {f.close();}
});

test("publisher challenge remains explicit and stops queued same-origin recovery instead of retrying", async () => {
  const entries=[entry,{...entry,itemId:"second"},{...entry,itemId:"third"}],natives=[];
  const f=fixture({entries,fetchImpl:url => {const native=imageResponse(url,new Uint8Array([1,2,3]),{status:403,headers:{"cf-mitigated":"challenge"}});natives.push(native);return native.response;}});
  try {
    await f.transport.ready();
    const results=await Promise.allSettled(entries.map(value=>f.transport.request(value)));
    assert(results.every(r=>r.status==="rejected"));
    const actual=results.find(r=>r.reason.status===403);
    assert.equal(actual.reason.challenge,"cloudflare");assert.equal(actual.reason.observedBytes,0);
    assert.equal(f.transport.snapshot().stopped,"PUBLISHER_FIRST_PARTY_ORIGIN_CHALLENGE");
    assert(f.fetches.length<=2);assert(natives.every(native=>native.reads===0));
    assert.equal(f.transport.snapshot().receivedBytes,0);
  } finally {f.close();}
});

test("same-origin reader rejects redirects, unsupported MIME, opaque and ranged responses", async () => {
  for (const options of [{redirected:true},{url:entry.imageUrl.replace("original","replacement")},{type:"cors"},
    {type:"opaque"},{headers:{"content-type":"text/html"}},{headers:{"content-range":"bytes 0-7/8"}}]) {
    const f=fixture({fetchImpl:url=>imageResponse(url,new Uint8Array([1]),options).response});
    try {await f.transport.ready();await assert.rejects(f.transport.request(entry),error=>/^PUBLISHER_FIRST_PARTY_(?:RESPONSE|MIME)_UNSUPPORTED$/.test(error.code));assert.equal(f.transport.snapshot().receivedBytes,0);}
    finally {f.close();}
  }
});

test("an oversized observed body stays charged even when no original bytes are accepted", async () => {
  const bytes=new Uint8Array(16777217),f=fixture({fetchImpl:url=>imageResponse(url,bytes).response});
  try {
    await f.transport.ready();const result=await f.transport.request(entry),reader=result.response.body.getReader();
    await assert.rejects(reader.read(),{code:"PUBLISHER_FIRST_PARTY_BYTE_LIMIT"});
    assert.equal(result.response.observedBytes(),bytes.length);
    assert.equal(f.transport.snapshot().observedBytes,bytes.length);assert.equal(f.transport.snapshot().receivedBytes,0);
  } finally {f.close();}
});

test("abort, opener navigation and lost publisher window cancel pending work explicitly", async () => {
  let signal;
  const f=fixture({fetchImpl:(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  try {
    await f.transport.ready();const controller=new AbortController(),pending=f.transport.request(entry,controller.signal);
    await turn();controller.abort();await assert.rejects(pending,{code:"PUBLISHER_FIRST_PARTY_ABORTED"});
    await turn();assert.equal(signal.aborted,true);assert.equal(f.transport.snapshot().active,0);
    const second=f.transport.request(entry);await turn();f.provider.closed=true;
    await assert.rejects(second,{code:"PUBLISHER_FIRST_PARTY_WINDOW_CLOSED"});assert.equal(f.parentListeners.size,0);
  } finally {f.close();}
});

test("heartbeat timer ticks keep a live collector connected and detect a lost provider document", async t => {
  t.mock.timers.enable({apis:["Date","setInterval"],now:new Date("2026-10-19T13:00:00.000Z")});
  const f=fixture();
  try {
    await f.transport.ready();
    t.mock.timers.tick(500);await turn();
    assert(f.messages.some(value=>value.data.type==="ping"));assert(f.messages.some(value=>value.data.type==="pong"));
    assert.equal(f.transport.snapshot().connected,true);assert.equal(f.transport.snapshot().stopped,"");
    t.mock.timers.tick(500);await turn();
    assert.equal(f.transport.snapshot().stopped,"");
    // A navigation removes the old publisher document's listener even when
    // its WindowProxy still exists and reports closed=false.
    f.providerListeners.clear();t.mock.timers.tick(31000);await turn();
    assert.equal(f.transport.snapshot().stopped,"PUBLISHER_FIRST_PARTY_CONNECTION_LOST");
    assert.equal(f.parentListeners.size,0);
  } finally {f.close();t.mock.timers.reset();}
});

test("cumulative recovery bytes stop the entire session and cannot admit queued reads after exhaustion", async () => {
  const entries=[entry,{...entry,itemId:"second"},{...entry,itemId:"third"}],
    f=fixture({entries,limits:{totalBytes:10}});
  try {
    await f.transport.ready();
    const all=entries.map(value=>f.transport.request(value).then(async result=>{
      const reader=result.response.body.getReader();while (!(await reader.read()).done) {}
    }));
    const settled=await Promise.allSettled(all);
    assert(settled.every(result=>result.status==="rejected"));
    assert.equal(f.transport.snapshot().stopped,"PUBLISHER_FIRST_PARTY_BYTE_LIMIT");
    assert.equal(f.transport.snapshot().observedBytes,16);
    assert.equal(f.fetches.length,2,"A queued third GET must never start after the observed cumulative bound is exceeded");
    await assert.rejects(f.transport.request(entry),{code:"PUBLISHER_FIRST_PARTY_BYTE_LIMIT"});
  } finally {f.close();}
});

test("a completed request ID cannot be replayed into another publisher GET", async () => {
  const f=fixture();
  try {
    await f.transport.ready();const result=await f.transport.request(entry),reader=result.response.body.getReader();
    while (!(await reader.read()).done) {}
    const request=f.messages.find(value=>value.to==="provider" && value.data.type==="request").data;
    f.provider.postMessage(request,"https://opentextbc.ca");await turn();
    assert.equal(f.fetches.length,1);assert.equal(f.transport.snapshot().stopped,"PUBLISHER_FIRST_PARTY_INVALID_REQUEST");
  } finally {f.close();}
});

test("parent course navigation and a closed opener cannot keep a recovery capability alive", async t => {
  const f=fixture();
  try {
    await f.transport.ready();f.parent.location.href="https://www.coursera.org/teach/other/course123/content";
    await assert.rejects(f.transport.request(entry),{code:"PUBLISHER_FIRST_PARTY_CONTEXT_CHANGED"});assert.equal(f.fetches.length,0);
  } finally {f.close();}
  t.mock.timers.enable({apis:["Date","setInterval"],now:new Date("2026-10-19T13:00:00.000Z")});
  const g=fixture();
  try {
    await g.transport.ready();g.parent.closed=true;t.mock.timers.tick(500);await turn();
    assert.equal(g.transport.snapshot().stopped,"PUBLISHER_FIRST_PARTY_CONTEXT_CHANGED");
  } finally {g.close();t.mock.timers.reset();}
});

test("a read settling after cancellation stays locally charged without transferring bytes or source proof", async () => {
  let settle,readStarted=false;
  const f=fixture({fetchImpl:url=>({status:200,type:"basic",url,redirected:false,
    headers:new Headers({"content-type":"image/png"}),body:{getReader() {return {
      read() {readStarted=true;return new Promise(resolve=>{settle=resolve;});},cancel() {return Promise.resolve();}
    };}}})});
  try {
    await f.transport.ready();const controller=new AbortController(),result=await f.transport.request(entry,controller.signal),
      pending=result.response.body.getReader().read();
    await turn();assert.equal(readStarted,true);controller.abort();await assert.rejects(pending,{code:"PUBLISHER_FIRST_PARTY_ABORTED"});
    await turn();settle({done:false,value:new Uint8Array(100)});await turn();
    assert.equal(f.transport.snapshot().receivedBytes,0);assert.equal(f.messages.filter(value=>value.data.type==="chunk").length,0);
    assert.equal(f.providerListeners.size,1,"The remaining session may still serve unrelated planned originals");
    // The disconnected request no longer contributes parent-verifiable bytes.
    // Its collector still records the read that settled after cancellation.
    assert.equal(f.transport.snapshot().observedBytes,0);
    assert.equal(f.collector.snapshot().observedBytes,100);
  } finally {f.close();}
});

test("an error-only observed byte overrun remains charged without raising the actual recovery budget", async () => {
  const f=fixture({fetchImpl:()=>new Promise(()=>{})});
  try {
    await f.transport.ready();const pending=f.transport.request(entry);await turn();
    const request=f.messages.find(value=>value.to==="provider"&&value.data.type==="request").data;
    f.emitToParent({type:"error",id:request.id,index:request.index,planSha256:request.planSha256,
      code:"PUBLISHER_FIRST_PARTY_BYTE_LIMIT",observedBytes:536870913});
    await assert.rejects(pending,error=>error.code==="PUBLISHER_FIRST_PARTY_BYTE_LIMIT"&&error.observedBytes===536870913);
    assert.equal(f.transport.snapshot().observedBytes,536870913);assert.equal(f.transport.snapshot().receivedBytes,0);
    assert.equal(f.transport.snapshot().stopped,"PUBLISHER_FIRST_PARTY_BYTE_LIMIT");
    await assert.rejects(f.transport.request(entry),{code:"PUBLISHER_FIRST_PARTY_BYTE_LIMIT"});
  } finally {f.close();}
});

test("exact basic HTTP observations survive pre-head MIME, range and missing-body failures", async () => {
  for(const mode of ["mime","range","body"]){
    const f=fixture({fetchImpl:url=>{
      const native=imageResponse(url,new Uint8Array([1]),{headers:mode==="mime"?{"content-type":"text/html"}:mode==="range"?{"content-range":"bytes 0-0/1"}:{}}).response;
      if(mode==="body")native.body=null;
      return native;
    }});
    try {
      await f.transport.ready();await assert.rejects(f.transport.request(entry),error=>{
        assert.equal(error.status,200);assert(Number.isFinite(Date.parse(error.observedAt)));assert.equal(error.observedBytes,0);
        return /^PUBLISHER_FIRST_PARTY_(?:MIME_UNSUPPORTED|RESPONSE_UNSUPPORTED|BODY_UNREADABLE)$/.test(error.code);
      });
      assert.equal(f.transport.snapshot().receivedBytes,0);
    } finally {f.close();}
  }
});

test("a detached opener throwing during close cannot recursively re-enter cleanup", async () => {
  const f=fixture();
  try {
    await f.transport.ready();f.parent.postMessage=()=>{throw Error("synthetic detached WindowProxy");};
    assert.doesNotThrow(()=>f.collector.close());
    assert.equal(f.collector.snapshot().stopped,"PUBLISHER_FIRST_PARTY_CLOSED");assert.equal(f.providerListeners.size,0);
  } finally {f.close();}
});
