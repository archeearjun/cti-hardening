import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDirectDataReaderV1} from '../src/extractors/coursera/direct-data-network.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sanitize=data=>({data,removedFields:0,redactedUrls:0,limitReached:false});
const identity=url=>decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1));
function reply(url,extra={},options={}) {
  return new Response(JSON.stringify({elements:[{id:identity(url),...extra}],paging:{},linked:{}}),
    {headers:{'content-type':'application/json'},...options});
}

test('known single GETs retain the exact scoped wire format and original byte receipts',async()=>{
  const calls=[],originalBodies=[];
  const reader=createDirectDataReaderV1({sanitize:data=>{
    delete data.elements[0].writeAccessToken;
    return {data,removedFields:1,redactedUrls:2,limitReached:false};
  },fetchImpl:async(url,options)=>{
    calls.push({url:new URL(url),options});
    const raw=' {"elements":[{"id":'+JSON.stringify(identity(url))+',"writeAccessToken":"synthetic-secret","text":"café 日本語 α"}],"paging":{},"linked":{}}\n';
    originalBodies.push(raw);return new Response(raw,{headers:{'content-type':'application/vnd.fixture+json; charset=utf-8'}});
  }});
  const results=await Promise.all([reader.readCourse('course'),reader.readCourseMaterials('course'),
    reader.readAtom('atom'),reader.readRelation('atom'),reader.readGroup('atom~group'),reader.readDefinition('atom~definition@17')]);
  assert(results.every(result=>result.ok));
  for(let i=0;i<calls.length;i++) {
    const {url,options}=calls[i],result=results[i];
    assert.equal(url.origin,'https://www.coursera.org');assert.equal(options.method,'GET');
    assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Accept,'application/json');assert.equal(url.searchParams.has('ids'),false);
    assert.equal(result.receipt.bytes,Buffer.byteLength(originalBodies[i]));
    assert.equal(result.receipt.originalResponseSha256,createHash('sha256').update(originalBodies[i]).digest('hex'));
    assert.equal(result.receipt.bodyFormat,'PARSED_SANITIZED_JSON_MODEL');
    assert.equal(result.receipt.credentialFieldsRemoved,1);assert.equal(result.receipt.credentialUrlsRedacted,2);
    assert(!JSON.stringify(result).includes('synthetic-secret'));
    assert.equal(result.data.elements[0].text,'café 日本語 α');
    if(i>=2) {assert.equal(options.headers['X-Coursera-Naptime-Fields'],'ALL');assert.equal(url.searchParams.get('includes'),'_links');}
    else assert.equal(options.headers['X-Coursera-Naptime-Fields'],undefined);
  }
  assert.equal(calls[1].url.pathname,'/api/authoringCourseMaterials.v1/course/');
  assert(calls[1].url.searchParams.get('fields').includes('conflictMetadata'));
  assert.equal(calls[4].url.searchParams.get('id'),'atom~group');
  assert.equal(calls[5].url.pathname,'/api/authoringAssignmentMachineEvaluableQuestions.v1/atom~definition@17');
  assert.equal(calls[5].url.searchParams.has('id'),false);assert(!calls[5].url.href.includes('%40'));
  assert.equal(reader.snapshot().requests,6);assert.equal(reader.snapshot().active,0);
});

test('one shared queue fills four slots while bounding mixed resource reads',async()=>{
  let active=0,maxActive=0;const updates=[];
  const reader=createDirectDataReaderV1({sanitize,onStats:stats=>updates.push(stats),fetchImpl:async url=>{
    active++;maxActive=Math.max(maxActive,active);await pause(5);active--;return reply(url);
  }});
  const results=await Promise.all(Array.from({length:24},(_,i)=>i%3===0?reader.readAtom('atom'+i):
    i%3===1?reader.readGroup('atom~group'+i):reader.readDefinition('atom~definition'+i+'@1')));
  assert(results.every(result=>result.ok));assert.equal(maxActive,4);
  assert.equal(reader.snapshot().maxConcurrentRequests,4);assert.equal(reader.snapshot().completed,24);
  assert(updates.some(stats=>stats.queued>0));assert(updates.every(stats=>stats.active<=4));
  updates.at(-1).byResource['authoringAtoms.v2']=999;
  assert.equal(reader.snapshot().byResource['authoringAtoms.v2'],8);
});

test('a lower concurrency override still governs every resource in the shared pool',async()=>{
  for(const concurrentRequests of [1,2]) {
    let active=0,maxActive=0;
    const reader=createDirectDataReaderV1({sanitize,limits:{concurrentRequests},fetchImpl:async url=>{
      active++;maxActive=Math.max(maxActive,active);await pause(5);active--;return reply(url);
    }});
    const results=await Promise.all(Array.from({length:12},(_,i)=>i%3===0?reader.readAtom('atom'+i):
      i%3===1?reader.readGroup('atom~group'+i):reader.readDefinition('atom~definition'+i+'@1')));
    assert(results.every(result=>result.ok));assert.equal(maxActive,concurrentRequests);
    assert.equal(reader.snapshot().maxConcurrentRequests,concurrentRequests);
    assert.equal(reader.snapshot().completed,12);assert.equal(reader.snapshot().active,0);
    assert.equal(reader.snapshot().queued,0);
  }
});

test('invalid resources, raw URL descriptors, unsafe IDs and absent sanitization cause zero requests',async()=>{
  let calls=0;const fetchImpl=async url=>{calls++;return reply(url);};
  const reader=createDirectDataReaderV1({fetchImpl,sanitize});
  for(const descriptor of [null,'https://www.coursera.org/api/authoringAtoms.v2/atom',
    {resource:'assets.v1',id:'asset'},{resource:'authoringAtoms.v2',id:'../auth'},
    {resource:'authoringAtoms.v2',id:'atom',url:'https://different.example/api/atom'},
    {resource:'authoringAssignmentQuestionGroups.v1',id:'unqualified'},
    {resource:'authoringAssignmentMachineEvaluableQuestions.v1',id:'atom~definition%401'},
    {resource:'authoringAssignmentMachineEvaluableQuestions.v1',id:'atom~definition@1/extra'}]) {
    const result=await reader.read(descriptor);assert.equal(result.ok,false);assert.equal(result.reason,'INVALID_API_DESCRIPTOR');
  }
  const absent=await createDirectDataReaderV1({fetchImpl}).readAtom('atom');
  assert.equal(absent.reason,'SANITIZER_UNAVAILABLE');assert.equal(calls,0);
});

test('the observed asset collection accepts one exact CML ID and keeps signing URLs out of JSON',async()=>{
  const id='ABCDEFGHIJKLMNOPQRSTUV',signed='https://fixture.cloudfront.net/file.png?width=300&hmac=hidden-hmac&expiry=100&Signature=hidden-signature&Policy=hidden-policy&Key-Pair-Id=hidden-key';
  let calls=0;
  const reader=createDirectDataReaderV1({sanitize,fetchImpl:async(url,options)=>{
    calls++;const address=new URL(url);
    assert.equal(address.pathname,'/api/assets.v1');assert.deepEqual([...address.searchParams],[['ids',id]]);
    assert.equal(options.headers['X-Coursera-Naptime-Fields'],'ALL');
    return new Response(JSON.stringify({elements:[{id,name:'file.png',typeName:'image',url:{url:signed,expires:100}}],paging:{}}),
      {headers:{'content-type':'application/json'}});
  }});
  for(const invalid of ['short',id+',different',id+'@1','../'+id]) assert.equal((await reader.readAsset(invalid)).reason,'INVALID_API_DESCRIPTOR');
  assert.equal(calls,0);
  const result=await reader.readAsset(id);
  assert.equal(result.ok,true);assert.equal(calls,1);
  assert.equal(result.receipt.resource,'assets.v1');assert.equal(result.receipt.requestPath,'/api/assets.v1');
  assert(!JSON.stringify(result).includes('hidden-'));assert(!Object.keys(result).includes('takeAssetLocation'));
  assert.equal(result.data.elements[0].url.url,'https://fixture.cloudfront.net/file.png?width=300');
  assert.equal(result.takeAssetLocation(),signed);assert.equal(result.takeAssetLocation(),'');
});

test('asset metadata identities and changed source context cannot release delivery locations',async()=>{
  const id='ABCDEFGHIJKLMNOPQRSTUV';let current=true;
  const reader=createDirectDataReaderV1({sanitize,assertCurrent:()=>current,fetchImpl:async()=>new Response(
    JSON.stringify({elements:[{id,name:'x.png',typeName:'image',url:{url:'https://fixture.cloudfront.net/file.png?hmac=secret'}}]}),
    {headers:{'content-type':'application/json'}})});
  const result=await reader.readAsset(id);current=false;
  assert.equal(result.takeAssetLocation(),'');assert(!JSON.stringify(result).includes('secret'));
  const wrong=createDirectDataReaderV1({sanitize,fetchImpl:async()=>new Response(JSON.stringify({elements:[{id:'different'}]}),
    {headers:{'content-type':'application/json'}})});
  assert.equal((await wrong.readAsset(id)).reason,'UNEXPECTED_API_IDENTITY');
});

test('limits cannot exceed the stated transport bounds',()=>{
  const reader=createDirectDataReaderV1({sanitize,limits:{concurrentRequests:50,requests:1e9,bodyBytes:1e9,
    totalBytes:1e9,requestMs:1e9,durationMs:1e9}});
  assert.deepEqual(reader.snapshot().limits,{concurrentRequests:4,bodyBytes:2*1024*1024,totalBytes:64*1024*1024,
    requests:20000,requestMs:30000,durationMs:60*60*1000});
});

test('authentication failure stops queued work without following login redirects',async()=>{
  for(const status of [401,403]) {
    let calls=0;const reader=createDirectDataReaderV1({sanitize,limits:{concurrentRequests:1},
      fetchImpl:async()=>{calls++;await pause(1);return new Response(null,{status});}});
    const results=await Promise.all([reader.readAtom('atom1'),reader.readAtom('atom2'),reader.readAtom('atom3')]);
    assert.equal(calls,1);assert(results.every(result=>!result.ok && result.authenticationFailed));
    assert.equal(results[0].receipt.status,status);assert.equal(reader.snapshot().stopReason,'AUTHORING_API_AUTHENTICATION_FAILED');
    assert.equal(reader.snapshot().active,0);assert.equal(reader.snapshot().queued,0);
  }
});

test('MIME, redirects, mismatched versions, duplicate identities and pagination are rejected',async()=>{
  const cases=[
    ['UNEXPECTED_API_MIME',url=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})],
    ['UNEXPECTED_API_REDIRECT',url=>{const response=reply(url);Object.defineProperty(response,'url',{value:'https://other.example/api/authoringAtoms.v2/atom'});return response;}],
    ['UNEXPECTED_API_REDIRECT',url=>{const response=reply(url);Object.defineProperty(response,'url',{value:url+'&foreign=1'});return response;}],
    ['UNEXPECTED_API_IDENTITY',url=>reply(url,{id:'atom~definition@2'})],
    ['UNEXPECTED_API_IDENTITY',url=>new Response(JSON.stringify({elements:[{id:identity(url)},{id:identity(url)}]}),{headers:{'content-type':'application/json'}})],
    ['UNEXPECTED_API_PAGINATION',url=>new Response(JSON.stringify({elements:[{id:identity(url)}],paging:{next:'remaining'}}),{headers:{'content-type':'application/json'}})],
    ['INVALID_API_JSON',()=>new Response('{not valid JSON',{headers:{'content-type':'application/json'}})],
  ];
  for(const [reason,fetchImpl] of cases) {
    const result=await createDirectDataReaderV1({sanitize,fetchImpl}).readDefinition('atom~definition@1');
    assert.equal(result.ok,false);assert.equal(result.data,null);assert.equal(result.reason,reason);
  }
});

test('body limits apply to actual streamed bytes and to advertised oversize responses',async()=>{
  for(const advertised of [false,true]) {
    let calls=0;
    const reader=createDirectDataReaderV1({sanitize,limits:{bodyBytes:120},fetchImpl:async url=>{
      calls++;if(calls===2)return reply(url);
      const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(80));controller.enqueue(new Uint8Array(80));controller.close();}});
      return new Response(stream,{headers:{'content-type':'application/json',...(advertised?{'content-length':'10000'}:{})}});
    }});
    const failed=await reader.readAtom('atom');assert.equal(failed.reason,'API_RESPONSE_BYTE_LIMIT');
    assert.equal(failed.receipt.bytes,advertised?0:160);
    assert.equal(reader.snapshot().stopped,false);assert.equal((await reader.readAtom('other')).ok,true);
  }
});

test('cumulative bytes, request count and run duration stop the whole shared reader',async()=>{
  const bytes=createDirectDataReaderV1({sanitize,limits:{totalBytes:64},fetchImpl:async url=>reply(url,{payload:'x'.repeat(100)})});
  const byteResults=await Promise.all([bytes.readAtom('one'),bytes.readAtom('two'),bytes.readAtom('three')]);
  assert(byteResults.every(result=>!result.ok));assert.equal(bytes.snapshot().stopReason,'COURSE_API_BYTE_LIMIT');
  let calls=0;const count=createDirectDataReaderV1({sanitize,limits:{requests:1,concurrentRequests:1},fetchImpl:async url=>{calls++;return reply(url);}});
  assert.equal((await count.readAtom('one')).ok,true);
  assert.equal((await count.readAtom('two')).reason,'COURSE_API_REQUEST_LIMIT');assert.equal(calls,1);
  const duration=createDirectDataReaderV1({sanitize,limits:{durationMs:5},fetchImpl:async url=>reply(url)});
  await pause(10);assert.equal((await duration.readAtom('one')).reason,'COURSE_API_TIME_LIMIT');assert.equal(duration.snapshot().requests,0);
});

test('one transient network or 5xx retry is allowed while ordinary 404 and 405 are not retried',async()=>{
  for(const first of ['network',503,404,405]) {
    let calls=0;const reader=createDirectDataReaderV1({sanitize,fetchImpl:async url=>{
      calls++;if(calls===1){if(first==='network')throw Error('synthetic transport failure');return new Response(null,{status:first});}
      return reply(url);
    }});
    const result=await reader.readGroup('atom~group');
    assert.equal(result.ok,first==='network'||first===503);assert.equal(calls,result.ok?2:1);
  }
  let calls=0;const always=createDirectDataReaderV1({sanitize,fetchImpl:async()=>{calls++;return new Response(null,{status:503});}});
  assert.equal((await always.readAtom('atom')).reason,'HTTP_503');assert.equal(calls,2);
});

test('Retry-After seconds and HTTP dates receive at most one affordable retry',async()=>{
  for(const retryAfter of ['0',new Date(Date.now()-5000).toUTCString()]) {
    let calls=0;const began=Date.now();
    const reader=createDirectDataReaderV1({sanitize,limits:{requestMs:1500},fetchImpl:async url=>{
      calls++;return calls===1?new Response(null,{status:429,headers:{'retry-after':retryAfter}}):reply(url);
    }});
    assert.equal((await reader.readAtom('atom')).ok,true);assert.equal(calls,2);
    assert(Date.now()-began>=480);assert.equal(reader.snapshot().rateLimitRetries,1);
  }
  for(const retryAfter of ['11',new Date(Date.now()+60000).toUTCString()]) {
    let calls=0;const reader=createDirectDataReaderV1({sanitize,fetchImpl:async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':retryAfter}});}});
    const result=await reader.readAtom('atom');assert.equal(result.reason,'AUTHORING_API_RATE_LIMITED');assert.equal(calls,1);
  }
  let calls=0;const repeated=createDirectDataReaderV1({sanitize,limits:{requestMs:1500},fetchImpl:async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'0'}});}});
  assert.equal((await repeated.readAtom('atom')).reason,'AUTHORING_API_RATE_LIMITED');assert.equal(calls,2);
});

test('abort and deadline release all waiting reads even when fetch ignores AbortSignal',async()=>{
  for(const manual of [false,true]) {
    const signals=[];const reader=createDirectDataReaderV1({sanitize,limits:{requestMs:30},fetchImpl:async(url,options)=>{
      signals.push(options.signal);return new Promise(()=>{});
    }});
    const began=Date.now(),pending=Array.from({length:8},(_,i)=>reader.readAtom('atom'+i));
    if(manual)setTimeout(()=>reader.abort('OPERATOR_STOPPED'),5);
    const results=await Promise.all(pending);
    assert(results.every(result=>result.reason===(manual?'OPERATOR_STOPPED':'API_REQUEST_TIMEOUT')));
    assert.equal(signals.length,4);assert(signals.every(signal=>signal.aborted));
    assert.equal(reader.snapshot().active,0);assert.equal(reader.snapshot().queued,0);
    assert(Date.now()-began<1000);assert.equal((await reader.readAtom('after')).ok,false);
  }
});

test('source changes and failed or incomplete sanitization cannot release successful data',async()=>{
  let current=true;
  const changed=createDirectDataReaderV1({sanitize,assertCurrent:()=>current,fetchImpl:async url=>{current=false;return reply(url);}});
  assert.equal((await changed.readAtom('atom')).reason,'SOURCE_CONTEXT_CHANGED');
  const exceptional=createDirectDataReaderV1({sanitize,assertCurrent:()=>{throw Error('private context');},fetchImpl:async url=>reply(url)});
  assert.equal((await exceptional.readAtom('atom')).reason,'SOURCE_CONTEXT_CHECK_FAILED');assert.equal(exceptional.snapshot().requests,0);
  for(const sanitizer of [()=>{throw Error('private sanitizer failure');},()=>({data:null}),
    data=>({data,limitReached:true}),data=>({data:{...data,elements:[{id:'different'}]}})]) {
    const result=await createDirectDataReaderV1({sanitize:sanitizer,fetchImpl:async url=>reply(url)}).readAtom('atom');
    assert.equal(result.ok,false);assert.equal(result.data,null);assert.match(result.reason,/^SANITIZER_/);
    assert(!JSON.stringify(result).includes('private'));
  }
});

test('manual definitions use exact mutable owner IDs, bounded same-origin GETs and no guessed version',async()=>{
 const id='B'.repeat(22),calls=[],reader=createDirectDataReaderV1({sanitize,fetchImpl:async(url,options)=>{calls.push({url:new URL(url),options});return reply(url,{prompt:'original',rubrics:[{points:4}]});}});
 const result=await reader.readManualDefinition(id);assert(result.ok);assert.equal(calls.length,1);assert.equal(calls[0].url.pathname,'/api/authoringAssignmentManualGradedQuestions.v1/'+id);assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.redirect,'error');assert.equal(result.data.elements[0].rubrics[0].points,4);
 for(const invalid of [id+'@1',id+'/other','short~id','A'.repeat(22)+'~'+id])assert.equal((await reader.readManualDefinition(invalid)).ok,false);
 assert.equal(calls.length,1);
});

 test('manual reads request only read-only fields and sanitize unsolicited credentials before persistence',async()=>{
 const {CTI_DIRECT_MANUAL_FIELDS_V1}=await import('../src/extractors/coursera/direct-data-native-observations.js');
 let request;
 const reader=createDirectDataReaderV1({sanitize,fetchImpl:async(url,options)=>{
   request={url:new URL(url),options};return reply(url,{graderType:'AI',writeAccessToken:'synthetic-never-retain',prompt:{typeName:'cml',definition:{dtdId:'assess/1',value:''}},graderInstructions:'',rubrics:[],submissionSchema:{typeName:'richText'}});
 }});
 const result=await reader.readManualDefinition('Q'.repeat(22));assert(result.ok);
 assert.deepEqual([...request.url.searchParams],[['id','Q'.repeat(22)],['fields',CTI_DIRECT_MANUAL_FIELDS_V1]]);
 assert.equal(request.options.headers['X-Coursera-Naptime-Fields'],undefined);
 assert(!JSON.stringify(result).includes('synthetic-never-retain'));assert(!JSON.stringify(result).includes('writeAccessToken'));
 assert(result.receipt.credentialFieldsRemoved>=1);assert.equal(result.data.elements[0].prompt.definition.value,'');assert.equal(result.data.elements[0].graderInstructions,'');
 });

test('published reading uses observed same-origin POST envelope, read-only selections and no unsolicited configuration',async()=>{
 const {publishedReadingFixture}=await import('./published-reading-fixture.mjs');
 const {CTI_DIRECT_READING_QUERY_V1}=await import('../src/extractors/coursera/direct-data-published-reading.js');
 const f=publishedReadingFixture(),calls=[],source=f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId;
 source.conflictDetectionToken='synthetic-secret';source.clientSecret='synthetic-client';source.consumerKey='synthetic-consumer';source.permissions={private:'synthetic-private'};
 const reader=createDirectDataReaderV1({sanitize,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(f.response),{headers:{'content-type':'application/json'}});}});
 const read=await reader.readPublishedReading(f.context.item.atomId);assert(read.ok);
 const request=calls[0];assert.equal(request.url,'https://www.coursera.org/graphql-gateway?opname=ItemAuthoringFrameworkData');
 assert.equal(request.options.method,'POST');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.redirect,'error');
 assert.deepEqual(JSON.parse(request.options.body),[{operationName:'ItemAuthoringFrameworkData',variables:{atomId:f.context.item.atomId},query:CTI_DIRECT_READING_QUERY_V1}]);
 assert(!/mutation|conflictDetectionToken|clientSecret|consumerKey|permission|writeAccessToken|url/i.test(request.options.body));
 assert(!/synthetic-secret|synthetic-client|synthetic-consumer|synthetic-private|permissions/.test(JSON.stringify(read)));
 assert.equal(read.data[0].data.ItemAuthoring.queryAuthoringItemByAtomId.draftItemContent,null);
 assert.equal(read.receipt.method,'POST');assert.match(read.receipt.originalResponseSha256,/^[a-f0-9]{64}$/);
 assert.equal((await reader.readPublishedReading('Read1')).ok,false);assert.equal(calls.length,1);
});

test('published GraphQL errors, wrong identities and expired authorization cannot produce a body',async()=>{
 const {publishedReadingFixture}=await import('./published-reading-fixture.mjs');
 for(const variant of ['errors','identity','auth']) {
  const f=publishedReadingFixture();if(variant==='errors')f.response[0].errors=[{message:'private server error'}];
  if(variant==='identity')f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId.atomId='Z'.repeat(22);
  const reader=createDirectDataReaderV1({sanitize,fetchImpl:async()=>new Response(JSON.stringify(f.response),{status:variant==='auth'?403:200,headers:{'content-type':'application/json'}})});
  const result=await reader.readPublishedReading(f.context.item.atomId);assert.equal(result.ok,false);assert.equal(result.data,null);assert(!JSON.stringify(result).includes('private server error'));
 }
});
