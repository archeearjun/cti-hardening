import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {createDirectDataReaderV1} from '../src/extractors/coursera/direct-data-network.js';
import {sanitizeCourseraCourseDataModel} from '../src/extractors/coursera/direct-data-privacy.js';
import {canonicalDirectAssetUrlV1,directAssetMetadataBindingV1,directAssetBodyKindV1,
  decodeDirectAssetBodyV1,encodeDirectAssetBodyV1,directRetainedAssetBodyV1,createDirectDataMediaReaderV1} from '../src/extractors/coursera/direct-data-media.js';

const id='ABCDEFGHIJKLMNOPQRSTUV',other='BCDEFGHIJKLMNOPQRSTUVW',png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const location=(key='first')=>'https://fixture.cloudfront.net/file.png?width=400&hmac=hidden-'+key+'&expiry=100';
function envelope(assetId=id,changes={}) {return {elements:[{id:assetId,name:'file.png',typeName:'image',url:{url:location(),expires:100},...changes}],paging:{},linked:{}};}
function setup({metadataChange,allMetadataChange,binaryFetch,limits,assertCurrent}={}) {
  let metadataCalls=0;
  const apiReader=createDirectDataReaderV1({sanitize:sanitizeCourseraCourseDataModel,fetchImpl:async url=>{
    metadataCalls++;const assetId=new URL(url).searchParams.get('ids');
    const changed=metadataCalls%2===0;
    const value=envelope(assetId,{...allMetadataChange,...(changed?{url:{url:location('fresh'),expires:200},...metadataChange}:{})});
    return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  }});
  const reader=createDirectDataMediaReaderV1({apiReader,limits,assertCurrent,fetchImpl:binaryFetch || (async(url,options)=>{
    assert.equal(url,location());assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    return new Response(png,{headers:{'content-type':'image/png'}});
  })});
  return {reader,apiReader,metadataCalls:()=>metadataCalls};
}

test('bound metadata refresh, actual bytes and receipt hashes survive while delivery secrets stay ephemeral',async()=>{
  const {reader,metadataCalls}=setup();const result=await reader.capture(id);
  assert.equal(result.reason,undefined);assert.equal(result.stability.stable,true);assert.equal(metadataCalls(),2);
  assert.equal(result.metadataReceipt.id,id);assert.equal(result.metadataReceipt.sha256,result.metadataReceipt.originalResponseSha256);
  assert.equal(result.body.sha256,createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(decodeDirectAssetBodyV1(result.body),png);
  assert.equal(result.body.canonicalUrl,'https://fixture.cloudfront.net/file.png?width=400');
  assert.equal(result.body.receipt.bodyFormat,'ORIGINAL_BINARY_BYTES_BASE64');
  assert(!JSON.stringify(result).includes('hidden-'));
  assert.equal(reader.snapshot().requests,1);assert.equal(reader.snapshot().completed,1);
  assert.equal(await reader.capture(id),result);assert.equal(metadataCalls(),2);
});

test('only HTTPS supported CDN locations are accepted and representation parameters remain identity',()=>{
  for(const value of ['http://fixture.cloudfront.net/a','https://127.0.0.1/a','https://localhost/a','https://localhost.coursera.org/a',
    'https://fixture.cloudfront.net:8443/a','https://user:password@fixture.cloudfront.net/a','https://fixture.coursera.org/api/auth',
    'https://fixture.cloudfront.net.attacker.test/a','https://untrusted.test/a','data:image/png;base64,AAAA']) assert.equal(canonicalDirectAssetUrlV1(value),'');
  assert.equal(canonicalDirectAssetUrlV1('https://bucket.s3.amazonaws.com/a?width=1&revision=2&Signature=hidden&Expires=123#section'),
    'https://bucket.s3.amazonaws.com/a?width=1&revision=2');
  const a=directAssetMetadataBindingV1(envelope(),id),b=directAssetMetadataBindingV1(envelope(id,{url:{url:location('fresh'),expires:300}}),id);
  assert.equal(a.modelCanonical,b.modelCanonical);
  assert.notEqual(a.modelCanonical,directAssetMetadataBindingV1(envelope(id,{name:'other.png'}),id).modelCanonical);
  assert.equal(directAssetMetadataBindingV1(envelope(other),id),null);
});

test('supported binary signatures must match MIME and office extension; HTML and disguised bodies cannot pass',()=>{
  const prefix=text=>new TextEncoder().encode(text);
  assert.equal(directAssetBodyKindV1(png,'image/png','file.png'),'PNG');
  assert.equal(directAssetBodyKindV1(png,'image/jpeg','file.jpg'),'');
  assert.equal(directAssetBodyKindV1(prefix('%PDF-1.7'),'application/pdf','file.pdf'),'PDF');
  assert.equal(directAssetBodyKindV1(Uint8Array.of(80,75,3,4,1),'application/vnd.openxmlformats-officedocument.presentationml.presentation','lesson.pptx'),'OFFICE_ZIP');
  assert.equal(directAssetBodyKindV1(Uint8Array.of(80,75,3,4,1),'image/png','lesson.pptx'),'');
  assert.equal(directAssetBodyKindV1(prefix('<html>login</html>'),'image/png','file.png'),'');
  assert.equal(directAssetBodyKindV1(prefix('<svg/>'),'image/svg+xml','file.svg'),'');
});

test('original base64 is exact and decoded allocations reject malformed padding, wrong sizes and limits',()=>{
  for(const length of [1,2,3,12287,12288,12289,65537]) {
    const bytes=Uint8Array.from({length},(_,index)=>index%256),base64=encodeDirectAssetBodyV1(bytes);
    assert.equal(base64,Buffer.from(bytes).toString('base64'));assert.deepEqual(decodeDirectAssetBodyV1({base64,size:length}),bytes);
  }
  for(const body of [{base64:'AB==',size:1},{base64:'A===',size:1},{base64:'AA==x',size:1},
    {base64:'AA==',size:2},{base64:'AA A',size:3},{base64:'AA==',size:0}]) assert.equal(decodeDirectAssetBodyV1(body),null);
  assert.equal(decodeDirectAssetBodyV1({base64:encodeDirectAssetBodyV1(png),size:png.length},8),null);
});

test('metadata mutation retains downloaded evidence but cannot claim stable complete media',async()=>{
  for(const metadataChange of [{name:'new.png'},{typeName:'generic'},{url:{url:'https://fixture.cloudfront.net/changed.png'}},{revision:2}]) {
    const {reader}=setup({metadataChange});const result=await reader.capture(id);
    assert.equal(result.reason,'DIRECT_ASSET_METADATA_CHANGED');assert.equal(result.stability.stable,false);
    assert(result.body.sha256);assert.equal(result.metadata.elements[0].name,'file.png');
  }
});

test('binary MIME, redirects, HTTP failures and CORS rejections remain explicit incomplete source evidence',async()=>{
  const cases=[
    ['DIRECT_ASSET_BODY_HTTP_403',()=>new Response(null,{status:403})],
    ['DIRECT_ASSET_BODY_HTTP_206',()=>new Response(png,{status:206,headers:{'content-type':'image/png'}})],
    ['DIRECT_ASSET_BODY_MIME_UNSUPPORTED',()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})],
    ['DIRECT_ASSET_BODY_MAGIC_INVALID',()=>new Response('fake PNG',{headers:{'content-type':'image/png'}})],
    ['DIRECT_ASSET_BODY_FETCH_FAILED',()=>{throw new TypeError('private delivery URL must never appear');}],
    ['DIRECT_ASSET_BODY_REDIRECT',()=>{const reply=new Response(png,{headers:{'content-type':'image/png'}});Object.defineProperty(reply,'url',{value:'https://fixture.cloudfront.net/redirected.png'});return reply;}],
  ];
  for(const [reason,binaryFetch] of cases) {
    const {reader,metadataCalls}=setup({binaryFetch});const result=await reader.capture(id);
    assert.equal(result.reason,reason);assert.equal(result.body,undefined);assert(result.metadata);
    assert.equal(metadataCalls(),1);assert(!JSON.stringify(result).includes('private'));
  }
});

test('advertised and streamed byte ceilings stop oversized assets without stopping safe later items',async()=>{
  for(const advertised of [false,true]) {
    let calls=0;
    const {reader}=setup({limits:{bodyBytes:16},binaryFetch:async()=>{
      calls++;if(calls>1)return new Response(png,{headers:{'content-type':'image/png'}});
      const stream=new ReadableStream({start(controller){controller.enqueue(png);controller.enqueue(png);controller.close();}});
      return new Response(stream,{headers:{'content-type':'image/png',...(advertised?{'content-length':'24'}:{})}});
    }});
    assert.equal((await reader.capture(id)).reason,'DIRECT_ASSET_BODY_BYTE_LIMIT');
    assert.equal(reader.snapshot().stopped,false);assert.equal((await reader.capture(other)).reason,undefined);
  }
});

test('binary concurrency stays at two while aggregate bytes enforce one cumulative course bound',async()=>{
  let active=0,maximum=0;
  const {reader}=setup({binaryFetch:async()=>{active++;maximum=Math.max(maximum,active);await delay(5);active--;return new Response(png,{headers:{'content-type':'image/png'}});}});
  const results=await Promise.all(Array.from({length:8},(_,index)=>reader.capture('A'.repeat(21)+String(index))));
  assert(results.every(result=>!result.reason));assert.equal(maximum,2);assert.equal(reader.snapshot().maxConcurrentRequests,2);
  const bounded=setup({limits:{totalBytes:png.length},binaryFetch:async()=>new Response(png,{headers:{'content-type':'image/png'}})}).reader;
  assert.equal((await bounded.capture(id)).reason,undefined);
  assert.equal((await bounded.capture(other)).reason,'DIRECT_MEDIA_BYTE_LIMIT');assert.equal(bounded.snapshot().stopped,false);
  assert.equal(bounded.snapshot().bodyBudgetExhausted,true);
});

test('a persisted body can release its settled cache without disrupting active duplicate suppression',async()=>{
  const finishes=[],starts=[];
  const started=Array.from({length:2},()=>new Promise(resolve=>starts.push(resolve)));
  const {reader,metadataCalls}=setup({binaryFetch:async()=>{
    await new Promise(resolve=>{const index=finishes.length;finishes.push(resolve);starts[index]();});
    return new Response(png,{headers:{'content-type':'image/png'}});
  }});
  const first=reader.capture(id);
  await started[0];
  assert.equal(reader.release(id),false);
  assert.equal(reader.capture(id),first);assert.equal(metadataCalls(),1);
  finishes[0]();const result=await first;
  assert.equal(result.reason,undefined);assert.equal(reader.capture(id),first);
  assert.equal(reader.release(id),true);assert.equal(reader.release(id),false);
  const again=reader.capture(id);
  assert.notEqual(again,first);
  await started[1];
  assert.equal(metadataCalls(),3);finishes[1]();
  const refreshed=await again;
  assert.equal(refreshed.reason,undefined);assert.equal(metadataCalls(),4);
  assert.equal(reader.snapshot().requests,2);assert.equal(reader.snapshot().bytes,png.length*2);
});

test('a resumed zero remaining byte budget cannot reset to default or issue metadata and binary requests',async()=>{
  let apiCalls=0,bodyCalls=0;
  const reader=createDirectDataMediaReaderV1({apiReader:{readAsset:async()=>{apiCalls++;}},
    fetchImpl:async()=>{bodyCalls++;},limits:{totalBytes:0}});
  const result=await reader.capture(id);
  assert.equal(result.reason,'DIRECT_MEDIA_BYTE_LIMIT');assert.equal(reader.snapshot().limits.totalBytes,0);
  assert.equal(apiCalls,0);assert.equal(bodyCalls,0);assert.equal(reader.snapshot().stopped,false);
  assert.equal(reader.snapshot().bodyBudgetExhausted,true);
});

test('a retained original body is independently revalidated and reused only after two fresh stable metadata reads',async()=>{
  const original=await setup().reader.capture(id),oldTimestamp='2001-01-01T00:00:00.000Z';
  original.body.receipt.observedAt=oldTimestamp;
  const {reader,metadataCalls}=setup({binaryFetch:async()=>{throw Error('Retained original must not be downloaded again');}});
  const result=await reader.capture(id,original);
  assert.equal(result.reason,undefined);assert.equal(result.stability.stable,true);assert.equal(metadataCalls(),2);
  assert.deepEqual(result.body,original.body);assert.equal(result.body.receipt.observedAt,oldTimestamp);
  assert.equal(reader.snapshot().requests,0);assert.equal(reader.snapshot().bytes,0);
  assert.notEqual(result.metadataReceipt,original.metadataReceipt);
});

test('an exhausted binary budget permits validated retained bodies but cannot download new or corrupted bytes',async()=>{
  const original=await setup().reader.capture(id);
  const valid=setup({limits:{totalBytes:0},binaryFetch:async()=>{throw Error('No remaining byte budget');}});
  assert.equal((await valid.reader.capture(id,original)).reason,undefined);
  assert.equal(valid.metadataCalls(),2);assert.equal(valid.reader.snapshot().requests,0);
  const corrupt=structuredClone(original);corrupt.body.sha256='a'.repeat(64);corrupt.body.receipt.sha256=corrupt.body.sha256;
  const failed=setup({limits:{totalBytes:0},binaryFetch:async()=>{throw Error('No remaining byte budget');}});
  assert.equal((await failed.reader.capture(id,corrupt)).reason,'DIRECT_MEDIA_BYTE_LIMIT');
  assert.equal(failed.metadataCalls(),0);assert.equal(failed.reader.snapshot().requests,0);
  const changed=setup({limits:{totalBytes:0},allMetadataChange:{name:'changed.png'}});
  assert.equal((await changed.reader.capture(id,original)).reason,'DIRECT_MEDIA_BYTE_LIMIT');
  assert.equal(changed.metadataCalls(),1);assert.equal(changed.reader.snapshot().requests,0);
  const recovered=setup({limits:{totalBytes:0},binaryFetch:async()=>{throw Error('No remaining byte budget');}});
  assert.equal((await recovered.reader.capture(id)).reason,'DIRECT_MEDIA_BYTE_LIMIT');
  assert.equal((await recovered.reader.capture(id,corrupt)).reason,'DIRECT_MEDIA_BYTE_LIMIT');
  assert.equal(recovered.metadataCalls(),0);
  assert.equal((await recovered.reader.capture(id,original)).reason,undefined);
  assert.equal(recovered.metadataCalls(),2);assert.equal(recovered.reader.snapshot().requests,0);
  assert.equal(recovered.reader.snapshot().stopped,false);
});

test('actual streamed aggregate exhaustion cancels downloads without blocking later retained-body metadata validation',async()=>{
  const original=await setup().reader.capture(id);
  const {reader,metadataCalls}=setup({limits:{totalBytes:png.length},binaryFetch:async()=>new Response(
    new ReadableStream({start(controller){controller.enqueue(png);controller.enqueue(png);controller.close();}}),
    {headers:{'content-type':'image/png'}})});
  assert.equal((await reader.capture(id)).reason,'DIRECT_MEDIA_BYTE_LIMIT');
  assert.equal(reader.snapshot().bytes,png.length*2);assert.equal(reader.snapshot().stopped,false);
  assert.equal((await reader.capture(other)).reason,'DIRECT_MEDIA_BYTE_LIMIT');assert.equal(metadataCalls(),1);
  const resumed=await reader.capture(id,original);
  assert.equal(resumed.reason,undefined);assert.deepEqual(resumed.body,original.body);
  assert.equal(metadataCalls(),3);assert.equal(reader.snapshot().requests,1);
});

test('foreign or tampered cached evidence falls back to bounded downloads instead of receiving cache certification',async()=>{
  const original=await setup().reader.capture(id);
  const mutations=[
    value=>{value.assetId=other;},
    value=>{value.metadataReceipt.requestQuery=[['ids',other]];},
    value=>{delete value.metadataReceipt.originalResponseSha256;},
    value=>{value.stability.stable=false;},
    value=>{value.stability.receipt.id=other;},
    value=>{value.stability.metadata.elements[0].name='foreign.png';},
    value=>{value.body.base64=Buffer.from('forged bytes').toString('base64');},
    value=>{value.body.sha256='a'.repeat(64);value.body.receipt.sha256=value.body.sha256;},
    value=>{value.body.receipt.bodyFormat='CLAIMED_HASH_ONLY';},
    value=>{value.body.receipt.canonicalUrl='https://fixture.cloudfront.net/other.png';},
  ];
  for(const mutate of mutations) {
    const cached=structuredClone(original);mutate(cached);
    assert.equal(await directRetainedAssetBodyV1(cached,id),null);
    const {reader,metadataCalls}=setup();const result=await reader.capture(id,cached);
    assert.equal(result.reason,undefined);assert.equal(metadataCalls(),2);assert.equal(reader.snapshot().requests,1);
    assert.equal(reader.snapshot().bytes,png.length);
  }
  const changed=setup({allMetadataChange:{name:'changed.png'}});
  const fresh=await changed.reader.capture(id,original);
  assert.equal(fresh.reason,undefined);assert.equal(changed.metadataCalls(),2);assert.equal(changed.reader.snapshot().requests,1);
  assert.equal(fresh.metadata.elements[0].name,'changed.png');
});

test('source changes and ignored AbortSignals cannot release bytes or start queued binary downloads',async()=>{
  let current=true;
  const changed=setup({assertCurrent:()=>current,binaryFetch:async()=>{current=false;return new Response(png,{headers:{'content-type':'image/png'}});}}).reader;
  assert.equal((await changed.capture(id)).reason,'SOURCE_CONTEXT_CHANGED');
  for(const manual of [false,true]) {
    const signals=[];let binaryStarted;
    const started=new Promise(resolve=>{binaryStarted=resolve;});
    // Keep API hashing out of this binary-deadline check. Under concurrent test
    // load its worker queue could consume the deadline before a binary began.
    const apiReader={readAsset:async assetId=>({ok:true,data:envelope(assetId),
      receipt:{resource:'assets.v1',id:assetId,requestPath:'/api/assets.v1',requestQuery:[['ids',assetId]],
        status:200,bodyFormat:'PARSED_SANITIZED_JSON_MODEL',originalResponseSha256:'a'.repeat(64),observedAt:new Date().toISOString()},
      takeAssetLocation:()=>location()})};
    const reader=createDirectDataMediaReaderV1({apiReader,limits:{requestMs:100},fetchImpl:async(url,options)=>{
      signals.push(options.signal);if(signals.length===2)binaryStarted();return new Promise(()=>{});
    }});
    const pending=Array.from({length:5},(_,index)=>reader.capture('B'.repeat(21)+String(index)));
    if(manual){await started;reader.abort('OPERATOR_STOPPED');}
    const results=await Promise.all(pending);
    assert(results.every(result=>result.reason===(manual?'OPERATOR_STOPPED':'DIRECT_MEDIA_REQUEST_TIMEOUT')));
    assert.equal(signals.length,2);assert(signals.every(signal=>signal.aborted));assert.equal(reader.snapshot().active,0);
  }
});
