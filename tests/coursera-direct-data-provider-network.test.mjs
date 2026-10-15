import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDirectDataReaderV1 } from '../src/extractors/coursera/direct-data-network.js';
import { createDirectDataMediaReaderV1, decodeDirectAssetBodyV1 } from '../src/extractors/coursera/direct-data-media.js';
import { sanitizeCourseraCourseDataModel } from '../src/extractors/coursera/direct-data-privacy.js';
import { directPanoptoSourceV1 } from '../src/extractors/coursera/direct-data-panopto.js';
import { directCanonicalSourceTextV1 } from '../src/extractors/coursera/direct-data-canonical.js';
import { panoptoDeliveryFixture } from './panopto-delivery-fixtures.mjs';
const serviceOrigin='https://cti-hardening.pages.dev', observedAt='2026-10-15T19:00:00.000Z';
const secret='SYNTHETIC_PRIVATE_REQUEST_CREDENTIAL';
const mp4=Uint8Array.from([0,0,0,12,102,116,121,112,105,115,111,109]);
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture() {
  const f=panoptoDeliveryFixture();
  f.targetUrl=f.targetUrl.replace('video.example.test','fixture.hosted.panopto.com');
  f.model.EmbedUrl=f.model.EmbedUrl.replace('video.example.test','fixture.hosted.panopto.com');
  f.model.Delivery.PodcastStreams[0].StreamUrl=f.model.Delivery.PodcastStreams[0].StreamUrl
    .replace('media.example.test','fixture.cloudfront.net')+'?token='+secret;
  return f;
}
function headers(bytes=0, extra={}) {
  return {'content-type':'application/json','X-CTI-Provider-Transport':'CTI_PUBLIC_BACKEND',
    'X-CTI-Provider-Origin':serviceOrigin,'X-CTI-Upstream-Status':'200',
    'X-CTI-Upstream-Observed-At':observedAt,'X-CTI-Upstream-Bytes':String(bytes),
    'X-CTI-Upstream-Requests':'1','X-CTI-Validation-Bytes':'0',...extra};
}
const responseFor=f=>new Response(JSON.stringify(f.model),{headers:headers(Buffer.byteLength(JSON.stringify(f.model)))});
function reader(providerTransport, options={}) {
  return createDirectDataReaderV1({providerTransport,sanitize:sanitizeCourseraCourseDataModel,
    fetchImpl:async url=>new Response(JSON.stringify({elements:[{id:new URL(url).pathname.split('/').at(-1)}]}),
      {headers:{'content-type':'application/json'}}),...options});
}
function podcastResponse(sourceHash, validationBytes=100, extra={}, responseOptions={}) {
  return new Response(mp4,{...responseOptions,headers:headers(0,{'content-type':'video/mp4',
    'X-CTI-Upstream-Requests':'2','X-CTI-Validation-Bytes':String(validationBytes),
    'X-CTI-Validation-Source-Hash':sourceHash,'X-CTI-Validation-Observed-At':observedAt,...extra})});
}

test('public helper metadata retains original upstream bytes, clocks and status separately from native reads',async()=>{
  const f=fixture(), calls=[];let native=0;
  const api=reader({request:async(kind,payload,signal)=>{calls.push({kind,payload,signal});return responseFor(f);}},
    {fetchImpl:async()=>{native++;return new Response('{"elements":[{"id":"course"}]}',{headers:{'content-type':'application/json'}});}});
  const began=Date.now(), result=await api.readPanoptoDeliveryInfo(f.targetUrl);
  assert.equal(result.ok,true);assert.equal(calls.length,1);
  assert.deepEqual(calls[0].payload,{targetUrl:f.targetUrl});assert.equal(calls[0].kind,'metadata');
  assert(calls[0].signal instanceof AbortSignal);assert.equal(native,0);
  assert.equal(result.receipt.originalResponseSha256,sha(JSON.stringify(f.model)));
  assert.equal(result.receipt.bytes,Buffer.byteLength(JSON.stringify(f.model)));
  assert.equal(result.receipt.transport,'CTI_PUBLIC_BACKEND');assert.equal(result.receipt.serviceOrigin,serviceOrigin);
  assert.equal(result.receipt.serviceStatus,200);assert.equal(result.receipt.status,200);
  assert.equal(result.receipt.observedAt,observedAt);assert.equal(result.receipt.observedAtBasis,'UPSTREAM');
  assert.equal(result.receipt.upstreamRequests,1);assert(Date.parse(result.receipt.receivedAt)>=began);
  assert.equal(result.receipt.diagnostics,undefined);assert(!JSON.stringify(result).includes(secret));
  assert.equal((await api.readCourse('course')).ok,true);assert.equal(native,1);
  assert.equal(api.snapshot().requests,2);
});

test('helper errors distinguish service access failure from upstream HTTP without browser-policy claims',async()=>{
  const f=fixture();
  for (const [reply,reason,status,count,basis] of [
    [()=>new Response('{"error":"PRIVATE_'+secret+'"}',{status:401}), 'PROVIDER_HELPER_RECEIPT_INVALID',0,0,'CLIENT_ATTEMPT'],
    [()=>new Response('{"error":"PANOPTO_PROVIDER_HTTP_401"}',{status:502,headers:headers(0,{'X-CTI-Upstream-Status':'401'})}),
      'PROVIDER_HELPER_HTTP_401',401,1,'UPSTREAM'],
    [()=>new Response('{"error":"PANOPTO_PROVIDER_REQUEST_FAILED"}',{status:502,headers:headers(0,{
      'X-CTI-Upstream-Status':'0','X-CTI-Upstream-Observed-At':''})}),
      'PROVIDER_HELPER_REQUEST_FAILED',0,1,'CLIENT_ATTEMPT'],
  ]) {
    const api=reader({request:async()=>reply()}),result=await api.readPanoptoDeliveryInfo(f.targetUrl);
    assert.equal(result.ok,false);assert.equal(result.reason,reason);assert.equal(result.receipt.status,status);
    assert.equal(result.receipt.serviceStatus,status===401||count===1?502:401);
    assert.equal(result.receipt.upstreamRequests,count);assert.equal(result.receipt.observedAtBasis,basis);
    assert.equal(result.receipt.diagnostics,undefined);assert(!JSON.stringify(result).includes(secret));
    assert.equal((await api.readCourse('course')).ok,true);assert.equal(api.snapshot().stopped,false);
  }
});

test('helper malformed receipts and oversized error bodies never retain untrusted response text',async()=>{
  const f=fixture();let cancelled=0;
  const api=reader({request:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(secret.repeat(200)));},cancel(){cancelled++;}}),
    {status:502,headers:headers(0,{'X-CTI-Provider-Origin':'https://untrusted.example.test'})})});
  const result=await api.readPanoptoDeliveryInfo(f.targetUrl);
  assert.equal(result.reason,'PROVIDER_HELPER_RECEIPT_INVALID');assert.equal(cancelled,1);
  assert.equal(result.receipt.status,0);assert.equal(result.receipt.upstreamRequests,0);
  assert(!JSON.stringify(result).includes(secret));
  const mismatch=reader({request:async()=>new Response(JSON.stringify(f.model),{headers:headers(1)})});
  assert.equal((await mismatch.readPanoptoDeliveryInfo(f.targetUrl)).reason,'PROVIDER_HELPER_RECEIPT_INVALID');
});

test('helper podcast request binds the exact native source and charges validation wire bytes plus MP4 once',async()=>{
  const f=fixture(), calls=[];
  const providerTransport={request:async(kind,payload)=>{calls.push({kind,payload});
    return kind==='metadata'?responseFor(f):podcastResponse(payload.sourceHash);}};
  const api=reader(providerTransport), metadata=await api.readPanoptoDeliveryInfo(f.targetUrl);
  // The public helper must not need the parent's transient signed location.
  const plain={ok:true,data:metadata.data,receipt:metadata.receipt};
  const media=createDirectDataMediaReaderV1({apiReader:api,providerTransport,archiveMode:true,
    fetchImpl:async()=>{throw Error('DIRECT_FETCH_MUST_NOT_RUN');}});
  const result=await media.capturePanoptoPodcast(plain,f.ids.D);
  assert.equal(result.reason,undefined);assert.equal(calls[1].kind,'podcast');
  assert.deepEqual(calls[1].payload,{targetUrl:f.targetUrl,streamFileId:f.ids.D,
    sourceHash:sha(directCanonicalSourceTextV1(directPanoptoSourceV1(f.targetUrl,metadata.data)))});
  assert(!JSON.stringify(calls[1]).includes(secret));assert.deepEqual(decodeDirectAssetBodyV1(result.body),mp4);
  assert.equal(result.body.sha256,sha(mp4));assert.equal(result.body.receipt.bytes,mp4.length);
  assert.equal(result.body.receipt.targetUrl,f.targetUrl);assert.equal(result.body.receipt.transport,'CTI_PUBLIC_BACKEND');
  assert.equal(result.body.receipt.observedAtBasis,'UPSTREAM');assert.equal(result.body.receipt.upstreamRequests,2);
  assert.equal(result.body.receipt.validationMetadataBytes,100);
  assert.equal(result.body.receipt.validationSourceHash,calls[1].payload.sourceHash);
  assert.equal(result.body.receipt.validationObservedAt,observedAt);
  assert.equal(media.snapshot().bytes,100+mp4.length);assert.equal(media.snapshot().requests,2);
  assert.equal(result.body.originalUploadVerified,undefined);
});

test('helper podcast failures retain actual changed-source proof and account failed upstream work',async()=>{
  const f=fixture(),api=reader({request:async()=>responseFor(f)}),metadata=await api.readPanoptoDeliveryInfo(f.targetUrl);
  const different='b'.repeat(64);
  const providerTransport={request:async()=>new Response('{"error":"PANOPTO_PROVIDER_SOURCE_CHANGED"}',{status:400,
    headers:headers(0,{'X-CTI-Upstream-Requests':'1','X-CTI-Validation-Bytes':'150',
      'X-CTI-Validation-Source-Hash':different,'X-CTI-Validation-Observed-At':observedAt})})};
  const media=createDirectDataMediaReaderV1({apiReader:api,providerTransport});
  const result=await media.capturePanoptoPodcast(metadata,f.ids.D);
  assert.equal(result.reason,'PROVIDER_HELPER_SOURCE_CHANGED');assert.equal(result.body,undefined);
  assert.equal(result.receipt.targetUrl,f.targetUrl);assert.equal(result.receipt.validationSourceHash,different);
  assert.equal(result.receipt.serviceStatus,400);assert.equal(result.receipt.status,200);
  assert.equal(result.receipt.upstreamRequests,1);assert.equal(media.snapshot().requests,1);
  assert.equal(media.snapshot().bytes,150);
});

test('unbound podcast validation is rejected and cumulative metadata cost can exhaust the shared media budget',async()=>{
  const f=fixture(),api=reader({request:async()=>responseFor(f)}),metadata=await api.readPanoptoDeliveryInfo(f.targetUrl);
  for (const budget of [false,true]) {
    let cancelled=0;
    const providerTransport={request:async(kind,payload)=>{
      const headersSource=podcastResponse(budget?payload.sourceHash:'b'.repeat(64),100).headers;
      return new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:headersSource});}};
    const media=createDirectDataMediaReaderV1({apiReader:api,providerTransport,
      ...(budget?{limits:{totalBytes:99}}:{})});
    const result=await media.capturePanoptoPodcast(metadata,f.ids.D);
    assert.equal(result.reason,budget?'DIRECT_MEDIA_BYTE_LIMIT':'PROVIDER_HELPER_VALIDATION_INVALID');
    assert.equal(result.body,undefined);assert.equal(cancelled,1);
    assert.equal(media.snapshot().bytes,100);assert.equal(media.snapshot().requests,2);
  }
});

test('helper timeouts and operator cancellation propagate signals while leaving native metadata readable',async()=>{
  const f=fixture();let signal;
  const api=reader({request:async(kind,payload,next)=>{signal=next;return new Promise((resolve,reject)=>next.addEventListener('abort',()=>reject(Error(secret)),{once:true}));}},
    {limits:{requestMs:15,concurrentRequests:1}});
  assert.equal((await api.readPanoptoDeliveryInfo(f.targetUrl)).reason,'PROVIDER_HELPER_REQUEST_TIMEOUT');
  assert.equal(signal.aborted,true);assert.equal((await api.readCourse('course')).ok,true);
  const metadata=await reader({request:async()=>responseFor(f)}).readPanoptoDeliveryInfo(f.targetUrl);
  let begin;const began=new Promise(resolve=>{begin=resolve;});
  const media=createDirectDataMediaReaderV1({apiReader:api,providerTransport:{request:async(kind,payload,next)=>{
    signal=next;begin();return new Promise((resolve,reject)=>next.addEventListener('abort',()=>reject(Error(secret)),{once:true}));}}});
  const pending=media.capturePanoptoPodcast(metadata,f.ids.D);await began;media.abort('OPERATOR_STOPPED');
  const result=await pending;assert.equal(result.reason,'OPERATOR_STOPPED');assert.equal(signal.aborted,true);
  assert(!JSON.stringify(result).includes(secret));
});

test('failed helper podcast body charges both observed origin legs without inventing a successful body',async()=>{
  const f=fixture(),api=reader({request:async()=>responseFor(f)}),metadata=await api.readPanoptoDeliveryInfo(f.targetUrl);
  const media=createDirectDataMediaReaderV1({apiReader:api,providerTransport:{request:async(kind,payload)=>
    new Response('{"error":"PANOPTO_PROVIDER_HTTP_401"}',{status:502,headers:headers(23,{
      'X-CTI-Upstream-Status':'401','X-CTI-Upstream-Requests':'2','X-CTI-Validation-Bytes':'30',
      'X-CTI-Validation-Source-Hash':payload.sourceHash,'X-CTI-Validation-Observed-At':observedAt})})}});
  const result=await media.capturePanoptoPodcast(metadata,f.ids.D);
  assert.equal(result.reason,'PROVIDER_HELPER_HTTP_401');assert.equal(result.body,undefined);
  assert.equal(result.receipt.status,401);assert.equal(result.receipt.serviceStatus,502);
  assert.equal(result.receipt.bytes,23);assert.equal(result.receipt.validationMetadataBytes,30);
  assert.equal(media.snapshot().bytes,53);assert.equal(media.snapshot().requests,2);
});

test('ordinary Coursera image metadata and originals keep their direct transport when a provider helper exists',async()=>{
  const assetId='A'.repeat(22),location='https://fixture.cloudfront.net/original.png';
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  let helperCalls=0,nativeMetadata=0,nativeBodies=0;
  const providerTransport={request:async()=>{helperCalls++;throw Error('NO_PROVIDER_REQUEST_EXPECTED');}};
  const api=reader(providerTransport,{fetchImpl:async()=>{nativeMetadata++;
    return new Response(JSON.stringify({elements:[{id:assetId,name:'original.png',typeName:'image',url:{url:location}}]}),
      {headers:{'content-type':'application/json'}});}});
  const media=createDirectDataMediaReaderV1({apiReader:api,providerTransport,fetchImpl:async(url,options)=>{
    nativeBodies++;assert.equal(url,location);assert.equal(options.credentials,'omit');
    return new Response(png,{headers:{'content-type':'image/png'}});}});
  const result=await media.capture(assetId);
  assert.equal(result.reason,undefined);assert.equal(result.body.sha256,sha(png));
  assert.equal(result.body.receipt.transport,undefined);assert.equal(helperCalls,0);
  assert.equal(nativeMetadata,2);assert.equal(nativeBodies,1);assert.equal(media.snapshot().requests,1);
  assert.equal(media.snapshot().bytes,png.length);
});
