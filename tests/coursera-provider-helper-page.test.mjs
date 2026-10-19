import test from "node:test";
import assert from "node:assert/strict";
import { startProviderHelperV1 } from "../web/provider-helper.ts";

const courseId = "Vmal2bjyEfGabAr_0nhcow", nonce = "a".repeat(64);
const targetUrl = "https://fixture.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=59e8c889-654e-40f2-b073-b31c006c433b";
const identity = { id: "1", itemId: "swhBE", providerId: "native_provider" };
function fixture({ opener = true, access = true, fetcher } = {}) {
  const messages = [], calls = [], listeners = new Map();
  const status = { textContent: "" }, retry = { disabled: false, addEventListener() {} };
  const parent = { closed: false, postMessage(message, origin, transfer) {
    assert.equal(origin, "https://www.coursera.org"); messages.push({ ...message, transfer });
  } };
  const host = {
    opener: opener ? parent : null,
    location: { origin: "https://cti-hardening.pages.dev", hash: "#nonce=" + nonce + "&courseId=" + courseId },
    document: { getElementById(id) { return id === "status" ? status : retry; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const close = startProviderHelperV1(host, async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/access") return Response.json({ fullCti: access });
    return fetcher ? fetcher(url, options) : Response.json({ observed: true });
  });
  function emit(message, extra = {}) {
    listeners.get("message")?.({ source: parent, origin: "https://www.coursera.org",
      data: { protocol: "CTI_PROVIDER_HELPER_V1", nonce, courseId, ...message }, ...extra });
  }
  return { messages, calls, close, emit, status, retry, listeners, parent };
}
async function nextTurn() { await new Promise(resolve => setImmediate(resolve)); }
function request(changes = {}) {
  return { type: "request", ...identity, kind: "metadata", payload: { targetUrl, ...identity, id: undefined }, ...changes };
}
function metadataRequest() {
  return request({ payload: { targetUrl, itemId: identity.itemId, providerId: identity.providerId } });
}

const publisherTarget = "https://opentextbc.ca/mathfortrades2/?p=179/#main",
  publisherImage = "https://opentextbc.ca/oerdiscipline/wp-content/uploads/sites/347/2020/11/perimeter-outcomes.jpg",
  publisherSourceSha = "b".repeat(64), publisherImageSha = "c".repeat(64),
  publisherIdentity = { ...identity, providerId: "p".repeat(22) + "@3" },
  publisherBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function publisherRequest(changes={}) {
  return {type:"request",...publisherIdentity,kind:"publisherImage",payload:{targetUrl:publisherTarget,imageUrl:publisherImage,sourceSha256:publisherSourceSha,
    itemId:publisherIdentity.itemId,providerId:publisherIdentity.providerId},...changes};
}
function publisherHeaders(changes={}) {
  return {"content-type":"image/png","x-cti-provider-transport":"CTI_SERVICE_PUBLIC_IMAGE","x-cti-provider-origin":"https://cti-hardening.pages.dev",
    "x-cti-upstream-content-length":String(publisherBytes.length),"x-cti-upstream-sha256":publisherImageSha,"x-cti-publisher-source-hash":publisherSourceSha,...changes};
}

test("publisher images are an advertised closed binary operation with exact source context and no forwarded credentials", async () => {
  const f=fixture({fetcher:async()=>new Response(publisherBytes,{headers:publisherHeaders({"set-cookie":"PRIVATE_CTI_COOKIE"})})});
  try {
    await nextTurn();f.emit({type:"init"});assert.deepEqual(f.messages.at(-1).operations,["metadata","podcast","publicHtml","publisherImage"]);
    f.emit(publisherRequest());await nextTurn();const call=f.calls[1];
    assert.equal(call.url,"/api/provider/publisher-image");assert.equal(call.options.method,"POST");assert.equal(call.options.credentials,"same-origin");assert.equal(call.options.redirect,"error");
    assert.deepEqual(JSON.parse(call.options.body),{targetUrl:publisherTarget,imageUrl:publisherImage,sourceSha256:publisherSourceSha});
    assert.equal(call.options.headers.Accept,"image/png,image/jpeg,image/gif,image/webp");
    assert(!JSON.stringify(call.options.headers).includes("Cookie"));assert(!JSON.stringify(f.messages).includes("PRIVATE_CTI_COOKIE"));
    const head=f.messages.at(-1);assert.equal(head.type,"head");assert.equal(head.providerId,publisherIdentity.providerId);
    assert.equal(new Headers(head.headers).get("x-cti-upstream-sha256"),publisherImageSha);
    assert.equal(new Headers(head.headers).get("x-cti-publisher-source-hash"),publisherSourceSha);
    f.emit({type:"pull",...publisherIdentity,seq:0,offset:0});await nextTurn();assert.deepEqual(new Uint8Array(f.messages.at(-1).bytes),publisherBytes);
    f.emit({type:"pull",...publisherIdentity,seq:1,offset:publisherBytes.length});await nextTurn();assert.equal(f.messages.at(-1).type,"end");
  } finally {f.close();}
});

test("publisher image target, upload reference, source hash and native channel scope fail closed before fetching", async () => {
  const f=fixture();
  try {
    await nextTurn();f.emit({type:"init"});
    const good=publisherRequest().payload;
    for(const payload of [{...good,targetUrl:"https://evil.test/book/?p=179"},{...good,targetUrl:"https://opentextbc.ca/mathfortrades2/chapter/area/"},
      {...good,imageUrl:"https://evil.test/book/wp-content/uploads/a.png"},{...good,imageUrl:"/oerdiscipline/wp-content/uploads/a.png"},
      ...["?","#"].map(suffix=>({...good,imageUrl:publisherImage+suffix})),
      ...[":443",":0443",":"].map(port=>({...good,targetUrl:publisherTarget.replace("opentextbc.ca","opentextbc.ca"+port)})),
      {...good,targetUrl:publisherTarget.replace("opentextbc.ca","OpenTextBC.ca")},{...good,imageUrl:publisherImage.replace("opentextbc.ca","OpenTextBC.ca")},
      {...good,imageUrl:publisherImage+"?signature=PRIVATE"},{...good,sourceSha256:"not-a-source-hash"},{...good,cookie:"PRIVATE"},{...good,headers:{Authorization:"PRIVATE"}},
      {...good,providerId:"mismatched"}]) f.emit(publisherRequest({payload}));
    await nextTurn();assert.equal(f.calls.length,1);assert(!f.messages.some(m=>m.type==="head"));
  } finally {f.close();}
});

test("the relay preserves a declared publisher challenge without treating it as a successful image", async () => {
  const headers = {"content-type":"application/json", "x-cti-provider-transport":"CTI_SERVICE_PUBLIC_IMAGE",
    "x-cti-provider-origin":"https://cti-hardening.pages.dev", "x-cti-upstream-status":"403",
    "x-cti-upstream-requests":"1", "x-cti-upstream-bytes":"0", "x-cti-upstream-challenge":"cloudflare"};
  const f = fixture({fetcher:async()=>Response.json({error:"PUBLISHER_IMAGE_PROVIDER_CHALLENGE"},{status:502,headers})});
  try {
    await nextTurn(); f.emit({type:"init"}); f.emit(publisherRequest()); await nextTurn();
    const head=f.messages.at(-1); assert.equal(head.type,"head"); assert.equal(head.status,502);
    assert.equal(new Headers(head.headers).get("x-cti-upstream-challenge"),"cloudflare");
    assert.equal(new Headers(head.headers).get("x-cti-upstream-status"),"403");
    assert.equal(f.calls.length,2,"The relay does not solve or retry challenges");
  } finally {f.close();}
  const invalid=fixture({fetcher:async()=>new Response(publisherBytes,{headers:publisherHeaders({"x-cti-upstream-challenge":"cloudflare"})})});
  try {
    await nextTurn();invalid.emit({type:"init"});invalid.emit(publisherRequest());await nextTurn();
    assert.equal(invalid.messages.at(-1).code,"PROVIDER_HELPER_INVALID_RESPONSE");
    assert(!invalid.messages.some(m=>m.type==="head"));
  } finally {invalid.close();}
});

test("one image stream reserves the public-service permit while a core request can use the second helper slot", async () => {
  const f=fixture({fetcher:async url=>url==="/api/provider/publisher-image"?new Response(publisherBytes,{headers:publisherHeaders()}):Response.json({native:true})});
  try {
    await nextTurn();f.emit({type:"init"});f.emit(publisherRequest());await nextTurn();
    f.emit(publisherRequest({id:"2"}));await nextTurn();assert.equal(f.calls.length,2);assert.equal(f.messages.at(-1).code,"PROVIDER_HELPER_INVALID_REQUEST");
    f.emit({...metadataRequest(),id:"3"});await nextTurn();assert.equal(f.calls.length,3);
    assert.deepEqual(f.calls.slice(1).map(call=>call.url),["/api/provider/publisher-image","/api/provider/panopto/metadata"]);
    f.emit({type:"cancel",...publisherIdentity});f.emit(publisherRequest({id:"4"}));await nextTurn();
    assert.equal(f.calls.length,4);assert.equal(f.calls.at(-1).url,"/api/provider/publisher-image");assert.equal(f.messages.at(-1).type,"head");
    f.emit({type:"cancel",...publisherIdentity,id:"4"});f.emit({type:"cancel",...identity,id:"3"});
  } finally {f.close();}
});

test("publisher image relay requires decoded framing, source/SHA context and exact EOF", async () => {
  for(const scenario of ["missing-length","oversized","bad-sha","wrong-source","wrong-transport","truncated","overflow","compressed","identity-conflict"]){
    let cancelled=0;const headers=publisherHeaders(),bytes=scenario==="truncated"?publisherBytes.slice(0,-1):scenario==="overflow"?new Uint8Array(9):publisherBytes;
    if(scenario==="missing-length")delete headers["x-cti-upstream-content-length"];
    if(scenario==="oversized")headers["x-cti-upstream-content-length"]=String(16*1024*1024+1);
    if(scenario==="bad-sha")headers["x-cti-upstream-sha256"]="invalid";
    if(scenario==="wrong-source")headers["x-cti-publisher-source-hash"]="d".repeat(64);
    if(scenario==="wrong-transport")headers["x-cti-provider-transport"]="BROWSER_PUBLISHER_IMAGE";
    if(["compressed","identity-conflict"].includes(scenario)){headers["content-encoding"]=scenario==="compressed"?"gzip":"identity";headers["content-length"]="99";}
    const f=fixture({fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes);c.close();},cancel(){cancelled++;}}),{headers})});
    try {
      await nextTurn();f.emit({type:"init"});f.emit(publisherRequest());await nextTurn();
      const early=["missing-length","oversized","bad-sha","wrong-source","wrong-transport","identity-conflict"].includes(scenario);
      if(early){assert.equal(f.messages.at(-1).type,"error",scenario);assert(!f.messages.some(m=>m.type==="head"));assert.equal(cancelled,1);continue;}
      assert.equal(f.messages.at(-1).type,"head");f.emit({type:"pull",...publisherIdentity,seq:0,offset:0});await nextTurn();
      if(scenario!=="overflow"){f.emit({type:"pull",...publisherIdentity,seq:1,offset:bytes.length});await nextTurn();}
      if(scenario==="compressed")assert.equal(f.messages.at(-1).type,"end");
      else {assert.equal(f.messages.at(-1).code,"PROVIDER_HELPER_PUBLISHER_IMAGE_LENGTH_MISMATCH");assert(!f.messages.some(m=>m.type==="end"));}
    } finally {f.close();}
  }
});

test("publisher-image and core request allowances are separate while active streams still share two slots", async () => {
  const f=fixture({fetcher:async()=>new Response("{}",{status:404,headers:{"content-type":"application/json"}})});
  try {
    await nextTurn();f.emit({type:"init"});
    f.emit(publisherRequest());f.emit({...metadataRequest(),id:"2"});await nextTurn();const before=f.calls.length;
    f.emit(publisherRequest({id:"3"}));await nextTurn();assert.equal(f.calls.length,before);assert.equal(f.messages.at(-1).code,"PROVIDER_HELPER_INVALID_REQUEST");
    f.emit({type:"cancel",...publisherIdentity});f.emit({type:"cancel",...identity,id:"2"});
    for(let index=1;index<1024;index++){const scoped={...publisherIdentity,id:String(index+3)};f.emit(publisherRequest({id:scoped.id}));await nextTurn();f.emit({type:"cancel",...scoped});}
    const imageCalls=f.calls.length;f.emit(publisherRequest({id:"2000"}));await nextTurn();assert.equal(f.calls.length,imageCalls);
    for(let index=1;index<128;index++){const scoped={...identity,id:String(3000+index)};f.emit({...metadataRequest(),id:scoped.id});await nextTurn();f.emit({type:"cancel",...scoped});}
    const coreCalls=f.calls.length;f.emit({...metadataRequest(),id:"4000"});await nextTurn();assert.equal(f.calls.length,coreCalls);
    assert.equal(f.calls.length,1+1024+128);
  } finally {f.close();}
});

test("a standalone or severed helper has no access or provider requests", () => {
  const f = fixture({ opener: false });
  assert.equal(f.calls.length, 0);
  assert.equal(f.close, undefined);
  assert.match(f.status.textContent, /No valid Coursera capture connection/);
  assert.equal(f.retry.disabled, true);
});

test("the actual helper page checks CTI access and binds only the exact Coursera opener", async () => {
  const f = fixture();
  try {
    await nextTurn();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "/api/access");
    assert.equal(f.calls[0].options.credentials, "same-origin");
    assert.equal(f.calls[0].options.redirect, "error");
    for (const extra of [{ origin: "https://evil.test" }, { source: {} }]) f.emit({ type: "init" }, extra);
    f.emit({ type: "init", nonce: "wrong" });
    f.emit({ type: "init", courseId: "different_course" });
    f.emit(metadataRequest());
    await nextTurn();
    assert.equal(f.messages.length, 0);
    assert.equal(f.calls.length, 1);
    f.emit({ type: "init" });
    assert.equal(f.messages.at(-1).type, "ready");
  } finally { f.close(); }
});

test("failed CTI authorization never initiates a provider request", async () => {
  const f = fixture({ access: false });
  try {
    await nextTurn();
    f.emit({ type: "init" });
    assert.equal(f.messages.at(-1).code, "PROVIDER_HELPER_ACCESS_REQUIRED");
    f.emit(metadataRequest());
    await nextTurn();
    assert.equal(f.calls.length, 1);
    assert.equal(f.messages.at(-1).code, "PROVIDER_HELPER_INVALID_REQUEST");
    assert.match(f.status.textContent, /Sign into CTI/);
  } finally { f.close(); }
});

test("metadata operation sends only its fixed body and streams headers and bounded chunks on explicit pull", async () => {
  const source = new Uint8Array(100000).fill(47);
  const f = fixture({ fetcher: async () => new Response(source, { headers: {
    "content-type": "application/json", "set-cookie": "PRIVATE_CTI_COOKIE",
    "x-cti-provider-transport": "CTI_PUBLIC_BACKEND", "x-cti-upstream-status": "200",
  } }) });
  try {
    await nextTurn();
    f.emit({ type: "init" });
    f.emit(metadataRequest());
    await nextTurn();
    const call = f.calls[1];
    assert.equal(call.url, "/api/provider/panopto/metadata");
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.redirect, "error");
    assert.deepEqual(JSON.parse(call.options.body), { targetUrl });
    assert(!JSON.stringify(call.options.headers).includes("Cookie"));
    const head = f.messages.at(-1);
    assert.equal(head.type, "head");
    assert.equal(head.id, identity.id);
    assert.equal(head.itemId, identity.itemId);
    assert(!JSON.stringify(head).includes("PRIVATE_CTI_COOKIE"));
    assert.equal(f.messages.filter(m => m.type === "chunk").length, 0);
    for (const [seq, offset, expected] of [[0, 0, 65536], [1, 65536, 34464]]) {
      f.emit({ type: "pull", ...identity, seq, offset });
      await nextTurn();
      const chunk = f.messages.at(-1);
      assert.equal(chunk.type, "chunk");
      assert.equal(chunk.seq, seq);
      assert.equal(chunk.offset, offset);
      assert.equal(chunk.bytes.byteLength, expected);
      assert.equal(chunk.transfer[0], chunk.bytes);
    }
    f.emit({ type: "pull", ...identity, seq: 2, offset: 100000 });
    await nextTurn();
    assert.equal(f.messages.at(-1).type, "end");
    assert.equal(f.messages.at(-1).offset, 100000);
  } finally { f.close(); }
});

test("public HTML helper operation uses only its closed endpoint/body and checks complete JSON-envelope length", async () => {
  const publicTarget = "https://opentextbc.ca/syntheticbook/chapter/area/#main", providerId = "p".repeat(22) + "@3", body = "{}";
  for (const declared of ["2", "3", null]) {
    const f = fixture({ fetcher: async () => new Response(body, { headers: { "content-type": "application/json",
      ...(declared === null ? {} : { "X-CTI-Response-Envelope-Bytes": declared }), "set-cookie": "PRIVATE_SOURCE_COOKIE" } }) });
    const scopedIdentity = { ...identity, providerId };
    try {
      await nextTurn(); f.emit({ type: "init" });
      f.emit({ type: "request", ...scopedIdentity, kind: "publicHtml", payload: { targetUrl: publicTarget, itemId: identity.itemId, providerId } });
      await nextTurn();
      assert.equal(f.calls[1].url, "/api/provider/public-html");
      assert.equal(f.calls[1].options.credentials, "same-origin");
      assert.equal(f.calls[1].options.redirect, "error");
      assert.deepEqual(JSON.parse(f.calls[1].options.body), { targetUrl: publicTarget });
      assert(!JSON.stringify(f.messages).includes("PRIVATE_SOURCE_COOKIE"));
      if (declared === null) { assert.equal(f.messages.at(-1).code, "PROVIDER_HELPER_PUBLIC_HTML_LENGTH_UNAVAILABLE"); continue; }
      assert.equal(f.messages.at(-1).type, "head");
      f.emit({ type: "pull", ...scopedIdentity, seq: 0, offset: 0 }); await nextTurn();
      assert.equal(f.messages.at(-1).type, "chunk");
      f.emit({ type: "pull", ...scopedIdentity, seq: 1, offset: 2 }); await nextTurn();
      if (declared === "2") assert.equal(f.messages.at(-1).type, "end");
      else assert.equal(f.messages.at(-1).code, "PROVIDER_HELPER_PUBLIC_HTML_LENGTH_MISMATCH");
    } finally { f.close(); }
  }
});

test("public HTML helper counts decoded bytes using the service envelope header rather than compressed wire length", async () => {
  const publicTarget="https://opentextbc.ca/syntheticbook/chapter/area/",providerId="p".repeat(22)+"@3",scoped={...identity,providerId};
  const f=fixture({fetcher:async()=>new Response("{}",{headers:{"content-type":"application/json","content-encoding":"gzip","content-length":"20","X-CTI-Response-Envelope-Bytes":"2"}})});
  try{
    await nextTurn();f.emit({type:"init"});f.emit({type:"request",...scoped,kind:"publicHtml",payload:{targetUrl:publicTarget,itemId:identity.itemId,providerId}});await nextTurn();
    const head=f.messages.at(-1);assert.equal(head.type,"head");
    assert(head.headers.some(([key,value])=>key==="x-cti-response-envelope-bytes"&&value==="2"));
    f.emit({type:"pull",...scoped,seq:0,offset:0});await nextTurn();assert.equal(f.messages.at(-1).bytes.byteLength,2);
    f.emit({type:"pull",...scoped,seq:1,offset:2});await nextTurn();assert.equal(f.messages.at(-1).type,"end");
  }finally{f.close();}
});

test("podcast helper preserves full upstream length and only ends an exact body", async () => {
  const source = new Uint8Array(100000).fill(47);
  for (const declared of [100000, 100001, 99999]) {
    const f = fixture({ fetcher: async () => new Response(source, { headers: {
      "content-type": "video/mp4", "X-CTI-Upstream-Content-Length": String(declared),
      "content-encoding": "identity",
    } }) });
    try {
      await nextTurn();f.emit({ type: "init" });
      f.emit({ ...metadataRequest(), kind: "podcast", payload: {
        targetUrl, itemId: identity.itemId, providerId: identity.providerId,
        streamFileId: "59e8c889-654e-40f2-b073-b31c006c433b", sourceHash: "a".repeat(64),
      } });
      await nextTurn();
      const head=f.messages.at(-1);
      assert.equal(head.type,"head");
      assert.equal(new Headers(head.headers).get("X-CTI-Upstream-Content-Length"),String(declared));
      assert.equal(new Headers(head.headers).get("content-encoding"),"identity");
      let offset=0;
      for (let seq=0;seq<3;seq++) {
        f.emit({type:"pull",...identity,seq,offset});await nextTurn();
        const last=f.messages.at(-1);
        if(last.type!=="chunk")break;
        offset+=last.bytes.byteLength;
      }
      if(declared===source.length) {
        assert.equal(f.messages.at(-1).type,"end");
        assert.equal(f.messages.at(-1).offset,source.length);
      } else {
        assert.equal(f.messages.at(-1).type,"error");
        assert.equal(f.messages.at(-1).code,"PROVIDER_HELPER_PODCAST_LENGTH_MISMATCH");
        assert(!f.messages.some(m=>m.type==="end"));
      }
    } finally { f.close(); }
  }
});

test("a successful podcast response without a valid full source length never starts the relay", async () => {
  for (const declared of [null,"0","12.0","9007199254740992"]) {
    let cancelled=0;
    const f=fixture({fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),
      {headers:{"content-type":"video/mp4",...(declared===null?{}:{"X-CTI-Upstream-Content-Length":declared})}})});
    try {
      await nextTurn();f.emit({type:"init"});
      f.emit({...metadataRequest(),kind:"podcast",payload:{targetUrl,itemId:identity.itemId,providerId:identity.providerId,
        streamFileId:"59e8c889-654e-40f2-b073-b31c006c433b",sourceHash:"a".repeat(64)}});
      await nextTurn();
      assert.equal(f.messages.at(-1).code,"PROVIDER_HELPER_PODCAST_LENGTH_UNAVAILABLE");
      assert(!f.messages.some(m=>m.type==="head"));assert.equal(cancelled,1);
    } finally {f.close();}
  }
});

test("arbitrary operations, URLs, headers and oversized envelopes do not reach the authenticated API", async () => {
  const f = fixture();
  try {
    await nextTurn();
    f.emit({ type: "init" });
    for (const change of [
      { kind: "anything" }, { payload: { targetUrl: "https://evil.test/" } },
      { payload: { targetUrl, cookie: "private" } },
      { payload: { targetUrl, headers: { Authorization: "private" } } },
      { payload: { targetUrl, itemId: "wrong" } },
      { extra: "x".repeat(8192) },
    ]) f.emit(request(change));
    await nextTurn();
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("parent cancellation aborts the API request and closing the helper removes the channel", async () => {
  let activeSignal;
  const f = fixture({ fetcher: async (url, options) => {
    activeSignal = options.signal;
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(Error("PRIVATE_NETWORK_DETAIL")), { once: true }));
  } });
  try {
    await nextTurn();
    f.emit({ type: "init" });
    f.emit(metadataRequest());
    await nextTurn();
    assert.equal(activeSignal.aborted, false);
    f.emit({ type: "cancel", ...identity });
    await nextTurn();
    assert.equal(activeSignal.aborted, true);
    assert(!JSON.stringify(f.messages).includes("PRIVATE_NETWORK_DETAIL"));
    f.emit({ type: "close" });
    assert.equal(f.listeners.has("message"), false);
  } finally { f.close(); }
});
