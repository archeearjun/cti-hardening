import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { createDirectDataMediaReaderV1 } from "../src/extractors/coursera/direct-data-media.js";
import { attachCourseraArchiveFileBytes } from "../src/domain/coursera-capture-archive.ts";
import { createInlinePublisherMediaContentFixture } from "./coursera-inline-content-fixtures.mjs";
import { directPublisherMediaInventoryV1, directPublisherMediaStructureV1,
  directPublisherMediaEvidenceV1, directPublisherImageUrlV1 } from "../src/extractors/coursera/direct-data-publisher-media.js";

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
    resources.push({...resource,...(read.body ? {body:read.body} : {reason:read.reason})});
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
