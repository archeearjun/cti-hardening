import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { createDirectDataMediaReaderV1 } from "../src/extractors/coursera/direct-data-media.js";
import { attachCourseraArchiveFileBytes } from "../src/domain/coursera-capture-archive.ts";
import { createInlinePublisherMediaContentFixture } from "./coursera-inline-content-fixtures.mjs";
import { directPublisherMediaInventoryV1, directPublisherMediaStructureV1,
  directPublisherMediaEvidenceV1, directPublisherImageUrlV1, directPublisherImageAttemptsV1 } from "../src/extractors/coursera/direct-data-publisher-media.js";

const target = "https://opentextbc.ca/syntheticbook/?p=225/#main",
  image = "https://opentextbc.ca/oerdiscipline/wp-content/uploads/2026/10/original.png",
  png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]),
  hash = value => createHash("sha256").update(value).digest("hex");
function response(url, bytes, options = {}) {
  return Object.defineProperties(new Response(bytes,{status:options.status || 200,
    headers:{"content-type":options.mime || "image/png",...options.headers}}),
    {type:{value:options.type || "cors"},url:{value:options.url || url}});
}
async function source(html, raw = html) {
  const value = {id:225,status:"publish",type:"chapter",link:"https://opentextbc.ca/syntheticbook/chapter/lesson/",
    title:{raw:"Original",rendered:"Original"},content:{raw,rendered:html,protected:false}};
  const reader = createDirectDataReaderV1({sanitize:data => ({data,removedFields:0,redactedUrls:0,limitReached:false}),
    fetchImpl:async url => response(url,JSON.stringify(value),{mime:"application/json; charset=utf-8"})});
  const read = await reader.readPublisherPage(target,{itemId:"item",providerId:"p".repeat(22) + "@1"});
  assert.equal(read.ok,true,read.reason);
  return {model:read.data,receipt:read.receipt};
}
async function captured(observation, reply = url => response(url,png), options = {}) {
  const calls = [], reader = createDirectDataMediaReaderV1({archiveMode:true,...options,
    fetchImpl:async (url,init) => { calls.push({url,init}); return reply(url,init); }}),
    inventory = directPublisherMediaInventoryV1(observation,target), resources = [];
  for (const resource of inventory.resources) {
    const read = await reader.readPublisherImage(observation,target,resource);
    resources.push({...resource,...(read.body ? {body:read.body} : {reason:read.reason,...(read.attempts ? {attempts:read.attempts} : {})})});
  }
  return {media:{...inventory,resources},reader,calls};
}

test("publisher inventory preserves raw/rendered literal ownership and selects no alternative, executable or raw-text examples", async () => {
  const html = '<img src="' + image + '" srcset="' + image.replace("original","alternate") + ' 2x">' +
    '<a href="' + image + '">Original file</a>' +
    '<img srcset="' + image.replace("original","only-alternative") + ' 2x">' +
    ["script","style","textarea","title","xmp","noembed","noframes","iframe"].map(tag =>
      '<' + tag + '><img src="' + image.replace("original",tag) + '"></' + tag + '>').join("") +
    '<!--<img src="' + image.replace("original","comment") + '">-->&lt;img src="escaped.png"&gt;' +
    '< img src="' + image.replace("original","space") + '">' +
    '<script></scripture><img src="' + image.replace("original","false-close") + '"></script>';
  const observation = await source(html), inventory = directPublisherMediaInventoryV1(observation,target);
  assert.equal(inventory.resources.length,1);
  assert.equal(inventory.resources[0].url,image);
  assert.equal(inventory.resources[0].references.length,4);
  assert.deepEqual(new Set(inventory.resources[0].references.map(v => v.field)),new Set(["content.raw","content.rendered"]));
  assert(inventory.failures.some(v => v.reason === "PUBLISHER_IMAGE_SOURCE_ABSENT"));
  assert(inventory.failures.some(v => v.reason === "PUBLISHER_IMAGE_SRCSET_ALTERNATIVES_NOT_SELECTED"));
  for (const invalid of [image + "?token=x",image.replace("https:","http:"),image.replace("opentextbc.ca","private.example"),image.replace("original.png","../original.png"),image.replace("original.png","original.svg"),image.replace("original.png","%6f.png")])
    assert.equal(directPublisherImageUrlV1(invalid,target),"");
});

test("actual browser-visible image bytes have independent source/hash/archive proof and no cookie or redirect fallback", async () => {
  const observation = await source('<img src="' + image + '">'), {media,reader,calls} = await captured(observation);
  assert(directPublisherMediaStructureV1(observation,target,media));
  assert(directPublisherMediaEvidenceV1(observation,target,media,hash));
  assert.equal(media.resources[0].body.sha256,hash(png));
  assert.equal(media.resources[0].body.archivePath,"files/" + hash(png));
  assert.equal(Object.getOwnPropertyDescriptor(media.resources[0].body,"bytes").enumerable,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].init.mode,"cors"); assert.equal(calls[0].init.credentials,"omit");
  assert.equal(calls[0].init.redirect,"error"); assert.equal(calls[0].init.referrerPolicy,"no-referrer");
  assert.equal(calls[0].init.headers,undefined);
  await reader.readPublisherImage(observation,target,directPublisherMediaInventoryV1(observation,target).resources[0]);
  assert.equal(calls.length,1,"same attempt deduplicates exact source hash and URL");
  const serialized = JSON.parse(JSON.stringify(media));
  assert(directPublisherMediaStructureV1(observation,target,serialized));
  assert.equal(directPublisherMediaEvidenceV1(observation,target,serialized,hash),null,"descriptor is not embedded bytes");
  const wrong = structuredClone(media); wrong.resources[0].body.receipt.sourceSha256 = "a".repeat(64);
  assert.equal(directPublisherMediaStructureV1(observation,target,wrong),null);
  const next = await captured(observation); assert.equal(next.calls.length,1,"new reader refreshes mutable image URL");
});

test("image transport rejects opaque, redirect identity, HTTP, HTML, range and signature failures without retaining originals", async () => {
  const observation = await source('<img src="' + image + '">');
  for (const options of [{type:"opaque"},{url:image.replace("original","other")},{status:403},{mime:"text/html"},{headers:{"content-range":"bytes 0-1/2"}}]) {
    const {media} = await captured(observation,url => response(url,png,options));
    assert.equal(media.resources[0].body,undefined);
    assert(media.resources[0].reason);
    assert(directPublisherMediaStructureV1(observation,target,media));
  }
  const bad = await captured(observation,url => response(url,new TextEncoder().encode("<html>not image</html>")));
  assert.equal(bad.media.resources[0].reason,"PUBLISHER_IMAGE_MAGIC_INVALID");
  const limit = await captured(observation,url => response(url,png),{limits:{bodyBytes:8}});
  assert.equal(limit.media.resources[0].reason,"PUBLISHER_IMAGE_BODY_BYTE_LIMIT");
});

test("changed publisher JSON retains old images only with the exact old source proof", async () => {
  const old = await source('<img src="' + image + '">'), prior = await captured(old),
    fresh = await source('<p>New source text</p><img src="' + image + '">'),
    current = await captured(fresh,async () => { throw Error("blocked"); });
  current.media.retained = [{observation:old,resources:prior.media.resources}];
  assert(directPublisherMediaStructureV1(fresh,target,current.media));
  assert(directPublisherMediaEvidenceV1(fresh,target,current.media,hash));
  current.media.retained[0].observation = fresh;
  assert.equal(directPublisherMediaStructureV1(fresh,target,current.media),null,"historical receipt cannot be relabeled as new source");
});

test("forged parent source hash is rejected before an image request", async () => {
  const observation = await source('<img src="' + image + '">'), resource = directPublisherMediaInventoryV1(observation,target).resources[0];
  observation.model.sha256 = observation.receipt.originalResponseSha256 = "a".repeat(64);
  let reads = 0;
  const reader = createDirectDataMediaReaderV1({fetchImpl:async () => { reads++; return response(image,png); }});
  const read = await reader.readPublisherImage(observation,target,resource);
  assert.equal(read.reason,"PUBLISHER_IMAGE_SOURCE_HASH_INVALID"); assert.equal(reads,0);
});

test("archive insertion independently proves native publisher ownership and retains old originals across a failed current refresh", () => {
  function fixture() {
    const f = createInlinePublisherMediaContentFixture(), body = f.publisherMedia.resources[0].body;
    f.raw.meta.directDataCapture = {materials:{elements:[{id:f.courseId}]}};
    const file = {path:body.archivePath,sha256:body.sha256,size:body.size,bytes:f.publisherMediaBytes};
    return {...f,file};
  }
  const f = fixture();
  f.fp.payload.directResumeRevalidation = {verified:false,reason:"DIRECT_DRAFT_CHANGED_DURING_CAPTURE"};
  attachCourseraArchiveFileBytes(f.raw,[f.file]);
  assert.deepEqual(f.publisherMedia.resources[0].body.bytes,f.publisherMediaBytes);
  assert.equal(f.fp.payload.directResumeRevalidation.verified,false,"historical file ownership never upgrades current verification");
  for (const mutate of [
    value => {value.fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0].sourceFields = ["invented.source"];},
    value => {value.fp.payload.directInlineWidgetProviderEvidence.providers[0].initial.model.elements[0].owners = ["COURSE~foreign"];},
    value => {value.fp.payload.directDataSources.receipts.stability.draftHash = "a".repeat(64);},
    value => {value.publisherObservation.model.rawJson += " ";},
    value => {value.publisherMedia.resources[0].references[0].attributeValue = image;},
    value => {value.publisherMedia.resources[0].body.receipt.sourceSha256 = "a".repeat(64);},
  ]) {
    const bad = fixture(); mutate(bad);
    assert.throws(() => attachCourseraArchiveFileBytes(bad.raw,[bad.file]),/native source binding/);
  }
  const signature = fixture(), fake = new TextEncoder().encode("<html>not a raster</html>"), body = signature.publisherMedia.resources[0].body;
  body.sha256 = body.receipt.sha256 = hash(fake);body.archivePath = "files/" + body.sha256;
  body.size = body.receipt.bytes = fake.length;delete body.bytes;
  assert.throws(() => attachCourseraArchiveFileBytes(signature.raw,[{path:body.archivePath,sha256:body.sha256,size:fake.length,bytes:fake}]),/raster format/);
});

test("observed part 125 retains its one literal cross-book original image and leaves srcset alternatives unfetched", async () => {
  const rawJson = readFileSync(new URL("./fixtures/pressbooks-part125-observed-20261018.json",import.meta.url),"utf8"),
    targetUrl = "https://opentextbc.ca/mathfortrades2/?p=125/#main", calls = [],
    reader = createDirectDataReaderV1({sanitize:data => ({data,removedFields:0,redactedUrls:0,limitReached:false}),
      fetchImpl:async url => { calls.push(String(url)); return String(url).includes("/chapters/")
        ? response(url,"",{status:404,mime:"application/json"}) : response(url,rawJson,{mime:"application/json"}); }});
  const read = await reader.readPublisherPage(targetUrl,{itemId:"item",providerId:"p".repeat(22) + "@1"});
  assert.equal(read.ok,true,read.reason);assert.equal(calls.length,2);
  assert.equal(read.data.rawJson,rawJson);
  const inventory = directPublisherMediaInventoryV1({model:read.data,receipt:read.receipt},targetUrl);
  assert.equal(inventory.resources.length,1);
  assert.equal(inventory.resources[0].url,"https://opentextbc.ca/oerdiscipline/wp-content/uploads/sites/347/2020/11/perimeter-outcomes.jpg");
  assert.equal(inventory.resources[0].references.length,2);
  assert.equal(inventory.failures.length,1);
  assert.equal(inventory.failures[0].reason,"PUBLISHER_IMAGE_SRCSET_ALTERNATIVES_NOT_SELECTED");
});

function serviceResponse(sourceSha256, options = {}) {
  const bytes = options.bytes || png, headers = new Headers({"content-type":"image/png",
    "x-cti-provider-transport":"CTI_SERVICE_PUBLIC_IMAGE","x-cti-provider-origin":"https://cti-hardening.pages.dev",
    "x-cti-upstream-status":"200","x-cti-upstream-observed-at":"2026-10-18T23:59:59.000Z",
    "x-cti-upstream-requests":"1","x-cti-upstream-bytes":String(bytes.length),
    "x-cti-upstream-content-length":String(bytes.length),"x-cti-upstream-sha256":hash(bytes),
    "x-cti-publisher-source-hash":sourceSha256,...options.headers});
  for (const name of options.omit || []) headers.delete(name);
  return new Response(bytes,{status:options.status || 200,headers});
}
function service(sourceSha256, options = {}) {
  const calls = [], helper = {ready:async () => {},supports:kind => kind === "publisherImage",
    request:async (kind,payload,signal) => {calls.push({kind,payload,signal});return serviceResponse(sourceSha256,options);}};
  return {calls,helper};
}

test("one closed public-service image fallback preserves source ownership, actual SHA and distinct clocks without claiming native CORS", async () => {
  const observation = await source('<img src="' + image + '">'), f = service(observation.model.sha256),
    result = await captured(observation,async () => {throw TypeError("browser policy");},{providerTransport:f.helper}),
    body = result.media.resources[0].body;
  assert(body);assert.equal(result.calls.length,1);assert.equal(f.calls.length,1);assert.equal(result.reader.snapshot().requests,2);
  assert.equal(result.reader.snapshot().bytes,png.length);
  assert.deepEqual(f.calls[0].payload,{targetUrl:target,imageUrl:image,sourceSha256:observation.model.sha256});
  assert.equal(f.calls[0].kind,"publisherImage");assert(f.calls[0].signal instanceof AbortSignal);
  assert.equal(body.receipt.transport,"CTI_SERVICE_PUBLIC_IMAGE");assert.equal(body.receipt.responseType,"service");
  assert.equal(body.receipt.observedAtBasis,"BROWSER_RESPONSE");assert.equal(body.receipt.upstreamObservedAt,"2026-10-18T23:59:59.000Z");
  assert.equal(body.receipt.browserAttempt.reason,"PUBLISHER_IMAGE_BLOCKED_OR_FAILED");
  assert.equal(body.receipt.upstreamSha256,hash(png));assert.equal(body.receipt.publisherSourceHash,observation.model.sha256);
  assert(directPublisherMediaEvidenceV1(observation,target,result.media,hash));
  const reloaded = JSON.parse(JSON.stringify(result.media));
  assert(directPublisherMediaStructureV1(observation,target,reloaded));
  assert.equal(directPublisherMediaEvidenceV1(observation,target,reloaded,hash),null,"service receipt cannot stand in for original bytes");
});

test("readable HTTP, redirected identity, MIME, magic and partial-body failures never use the public service", async () => {
  const observation = await source('<img src="' + image + '">');
  for (const options of [{status:403},{status:404},{url:image.replace("original","other")},{mime:"text/html"},{headers:{"content-range":"bytes 0-1/2"}}]) {
    const f = service(observation.model.sha256), result = await captured(observation,url => response(url,png,options),{providerTransport:f.helper});
    assert.equal(f.calls.length,0);assert.equal(result.media.resources[0].body,undefined);
    assert.equal(result.media.resources[0].attempts,undefined);
  }
  const f = service(observation.model.sha256), result = await captured(observation,url => response(url,new Uint8Array([1,2,3])),{providerTransport:f.helper});
  assert.equal(result.media.resources[0].reason,"PUBLISHER_IMAGE_MAGIC_INVALID");assert.equal(f.calls.length,0);
});

test("service source, transport, framing, body hash and MIME defects remain explicit failed observations", async () => {
  const observation = await source('<img src="' + image + '">');
  for (const options of [
    {omit:["x-cti-upstream-sha256"]},{omit:["x-cti-upstream-content-length"]},
    {headers:{"x-cti-provider-transport":"CTI_PUBLIC_BACKEND"}},
    {headers:{"x-cti-provider-origin":"https://foreign.example"}},
    {headers:{"x-cti-publisher-source-hash":"a".repeat(64)}},
    {headers:{"x-cti-upstream-requests":"2"}},
    {headers:{"x-cti-upstream-sha256":"a".repeat(64)}},
    {headers:{"x-cti-upstream-content-length":String(png.length+1),"x-cti-upstream-bytes":String(png.length+1)}},
    {headers:{"content-type":"text/html"}},
    {bytes:new TextEncoder().encode("<html>not an image</html>")},
  ]) {
    const f = service(observation.model.sha256,options), result = await captured(observation,async () => {throw Error("blocked");},{providerTransport:f.helper}),
      resource = result.media.resources[0];
    assert.equal(resource.body,undefined);assert(resource.reason);assert.equal(f.calls.length,1);
    assert(directPublisherImageAttemptsV1(resource.attempts));
    assert.equal(resource.attempts[0].reason,"PUBLISHER_IMAGE_BLOCKED_OR_FAILED");assert.equal(resource.attempts[1].reason,resource.reason);
    assert(directPublisherMediaStructureV1(observation,target,result.media));
    if (options.headers?.["content-type"] === "text/html")
      assert.equal(result.reader.snapshot().bytes,png.length,"buffered service source bytes are counted even when MIME is rejected before delivery");
  }
});

test("service failures preserve browser and upstream outcomes and stale helper makes no public request", async () => {
  const observation = await source('<img src="' + image + '">'),
    f = service(observation.model.sha256,{status:502,bytes:new TextEncoder().encode('{"error":"PUBLIC_IMAGE_PROVIDER_HTTP_403"}'),
      headers:{"content-type":"application/json","x-cti-upstream-status":"403","x-cti-upstream-bytes":"0"}}),
    result = await captured(observation,async () => {throw Error("blocked");},{providerTransport:f.helper}), resource = result.media.resources[0];
  assert.equal(resource.reason,"PUBLISHER_IMAGE_UPSTREAM_HTTP_403");assert.equal(resource.attempts[1].serviceStatus,502);
  assert.equal(resource.attempts[1].upstreamStatus,403);assert(directPublisherMediaStructureV1(observation,target,result.media));
  let reads = 0;
  const stale = await captured(observation,async () => {throw Error("blocked");},{providerTransport:{ready:async()=>{},supports:()=>false,request:async()=>{reads++;}}});
  assert.equal(reads,0);assert.equal(stale.media.resources[0].reason,"PUBLISHER_IMAGE_HELPER_OPERATION_UNSUPPORTED");
  assert.equal(stale.media.resources[0].attempts[1].serviceStatus,0);assert.equal(stale.media.resources[0].attempts[1].upstreamStatus,0);
  assert(directPublisherMediaStructureV1(observation,target,stale.media));
});

test("validated service bytes are budgeted before body delivery and remain counted on truncation or missing body", async () => {
  const observation = await source('<img src="' + image + '">');
  for (const mode of ["missing","truncated"]) {
    const helper = {ready:async()=>{},supports:()=>true,request:async()=>{
      const complete = serviceResponse(observation.model.sha256);
      return new Response(mode === "missing" ? null : png.slice(0,4),{headers:complete.headers});
    }}, result = await captured(observation,async()=>{throw Error("blocked");},{providerTransport:helper});
    assert.equal(result.media.resources[0].body,undefined);
    assert.equal(result.reader.snapshot().bytes,png.length,"the complete observed service read is counted once despite incomplete client delivery");
    assert(directPublisherMediaStructureV1(observation,target,result.media));
  }
  const f = service(observation.model.sha256), limited = await captured(observation,async()=>{throw Error("blocked");},
    {providerTransport:f.helper,limits:{totalBytes:png.length-1}});
  assert.equal(limited.media.resources[0].reason,"DIRECT_MEDIA_BYTE_LIMIT");
  assert.equal(limited.reader.snapshot().bytes,png.length);
});

test("service originals import through unchanged native ownership and can share one archived body with historical browser evidence", async () => {
  const f = createInlinePublisherMediaContentFixture(), observation = f.publisherObservation,
    inventory = directPublisherMediaInventoryV1(observation,f.targetUrl), resource = inventory.resources[0],
    old = {...f.publisherMedia.resources[0]}, helper = service(observation.model.sha256,{bytes:f.publisherMediaBytes}),
    reader = createDirectDataMediaReaderV1({archiveMode:true,providerTransport:helper.helper,fetchImpl:async()=>{throw Error("blocked");}}),
    result = await reader.readPublisherImage(observation,f.targetUrl,resource);
  assert(result.body);f.publisherMedia.resources[0] = {...resource,body:result.body};
  f.publisherMedia.retained = [{observation,resources:[old]}];
  f.raw.meta.directDataCapture = {materials:{elements:[{id:f.courseId}]}};
  const capture = JSON.parse(JSON.stringify(f.raw)), file = {path:result.body.archivePath,sha256:result.body.sha256,
    size:result.body.size,bytes:f.publisherMediaBytes};
  attachCourseraArchiveFileBytes(capture,[file]);
  const page = capture.fingerprints[0].payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0];
  assert(directPublisherMediaEvidenceV1(page.observation,page.targetUrl,page.media,hash));
  assert.equal(page.media.resources[0].body.receipt.transport,"CTI_SERVICE_PUBLIC_IMAGE");
  assert.equal(page.media.retained[0].resources[0].body.receipt.transport,"BROWSER_PUBLISHER_IMAGE");
  assert.equal(page.media.resources[0].body.archivePath,page.media.retained[0].resources[0].body.archivePath);
  page.media.resources[0].body.receipt.publisherSourceHash = "a".repeat(64);
  assert.throws(()=>attachCourseraArchiveFileBytes(capture,[file]),/native source binding/);
});

test("the original media deadline and operator cancellation retain already observed browser and helper failure context", async () => {
  const observation = await source('<img src="' + image + '">'), resource = directPublisherMediaInventoryV1(observation,target).resources[0];
  for (const mode of ["timeout","operator-stop"]) {
    let started;
    const active = new Promise(resolve => {started=resolve;}),
      helper = {ready:async()=>{},supports:()=>true,request:async(_kind,_payload,signal)=>{
        started(); return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(Object.assign(Error("stopped"),{code:"PROVIDER_HELPER_ABORTED"})),{once:true}));
      }}, reader = createDirectDataMediaReaderV1({archiveMode:true,providerTransport:helper,
        fetchImpl:async()=>{throw Error("browser policy");},limits:{requestMs:mode === "timeout" ? 20 : 1000}}),
      pending = reader.readPublisherImage(observation,target,resource);
    await active;
    if (mode === "operator-stop") reader.abort("OPERATOR_STOPPED");
    const result = await pending;
    assert.equal(result.reason,mode === "timeout" ? "DIRECT_MEDIA_REQUEST_TIMEOUT" : "OPERATOR_STOPPED");
    assert.equal(result.body,undefined);assert.equal(reader.snapshot().requests,2);
    assert(directPublisherImageAttemptsV1(result.attempts));
    assert.equal(result.attempts[0].reason,"PUBLISHER_IMAGE_BLOCKED_OR_FAILED");
    assert.equal(result.attempts[1].reason,result.reason);assert.equal(result.attempts[1].serviceStatus,0);
  }
});
