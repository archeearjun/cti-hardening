const assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto'),c=require('./check.cjs');
const {fixture,El,functionCode}=require('./assessment-fixture.cjs');
const tests=[];async function test(name,fn){try{await fn();tests.push({name,status:'PASS'});}catch(e){tests.push({name,status:'FAIL',error:e.stack});}}
function hashFixture(options={}){
 let calls=0;const h={URL,location:{origin:'https://www.coursera.org'},AbortController,Uint8Array,Date,setTimeout,clearTimeout,REMOTE_ASSET_FETCH_TIMEOUT_MS:25,MAX_REMOTE_ASSET_BYTES:1000,
  fetch:async()=>{calls++;return options.response||{ok:true,headers:{get:()=>''},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};},
  sha256Buffer:async b=>crypto.createHash('sha256').update(Buffer.from(b)).digest('hex'),perceptualHashBuffer:async()=>''};
 vm.createContext(h);vm.runInContext(functionCode('canonicalRemoteAssetKeyV614')+functionCode('hashRemoteAsset'),h);return {h,calls:()=>calls,budget:()=>({remaining:5000,cache:new Map(),deadline:Date.now()+3000})};
}
(async()=>{
 await test('172 virtualized question cards do not shrink the declared count to visible cards',async()=>{const f=fixture({count:172,budget:900000});assert.equal(f.c.assessmentDeclaredCountV662(f.envelope),172);const r=await f.runFull();assert.equal(r.assessment.questionCount,172);assert.equal(r.assessment.answerEvidenceQuestionCount,172);assert(r.assessment.captureCompleteness.questionCoverageComplete);});
 await test('Content(29) with one typed text block captures all 28 questions including part 29',async()=>{
  const f=fixture({count:29,budget:900000});const old=f.c.assessmentOutlineCandidatesV613;f.c.assessmentOutlineCandidatesV613=(...args)=>old(...args).map(x=>x.ordinal===1?{...x,id:'course~textBlock!~intro'}:x);
  const r=await f.runFull();assert.equal(r.captured,28);assert.equal(r.assessment.declaredQuestionCount,28);assert.equal(r.captureCompleteness.declaredContentParts,29);assert.deepEqual(Array.from(r.captureCompleteness.nonQuestionPartOrdinals),[1]);assert(r.captureCompleteness.requiredAnswerCoverageComplete);assert(r.assessment.questions.some(q=>q.id==='29'));
  const guarded=f.c.ctiGuardAssessmentOptionEvidence_(r.assessment);assert(guarded.captureCompleteness.requiredAnswerCoverageComplete);
 });
 await test('Missing final question in a mixed editor stays incomplete',async()=>{const f=fixture({count:29,missing:[29],budget:900000});const old=f.c.assessmentOutlineCandidatesV613;f.c.assessmentOutlineCandidatesV613=(...args)=>old(...args).map(x=>x.ordinal===1?{...x,id:'course~textBlock!~intro'}:x);const r=await f.run();assert.equal(r.questionCount,27);assert(!r.captureCompleteness.questionCoverageComplete);assert.deepEqual(Array.from(r.captureCompleteness.missingQuestionOrdinals),[29]);});
 await test('Identical prompt wording in distinct observed question IDs remains distinct',async()=>{const f=fixture({count:79,duplicates:true,budget:900000});const r=await f.run();assert.equal(r.questionCount,79);assert.equal(r.assessment.questions[26].prompt,r.assessment.questions[27].prompt);assert.equal(new Set(r.assessment.questions.map(q=>q.courseraQuestionId)).size,79);});
 await test('Response-body stall is bounded even after HTTP headers arrive',async()=>{const f=hashFixture({response:{ok:true,headers:{get:()=>''},arrayBuffer:()=>new Promise(()=>{})}}),detail={url:'https://cdn.example/file.pdf'};const started=Date.now();await f.h.hashRemoteAsset(detail,f.budget());assert.equal(detail.hashStatus,'FETCH_TIMEOUT');assert(Date.now()-started<500);assert(!detail.sha256);});
 await test('Stage deadline is honored inside a single fetch',async()=>{const f=hashFixture();f.h.fetch=()=>new Promise(()=>{});const budget=f.budget();budget.deadline=Date.now()+5;const detail={url:'https://cdn.example/file.pdf'};await f.h.hashRemoteAsset(detail,budget);assert.equal(detail.hashStatus,'SKIPPED_STAGE_BUDGET');});
 await test('Oversize streamed body stops without consuming the whole asset',async()=>{let reads=0,cancels=0;const f=hashFixture({response:{ok:true,headers:{get:()=>''},body:{getReader:()=>({read:async()=>{reads++;return {value:new Uint8Array(1100),done:false};},cancel:async()=>{cancels++;}})}}});const detail={url:'https://cdn.example/file.pdf'};await f.h.hashRemoteAsset(detail,f.budget());assert.equal(detail.hashStatus,'SKIPPED_SIZE');assert.equal(reads,1);assert.equal(cancels,1);});
 await test('Signed URL identity preserves rendition query and ignores credentials only on recognized hosts',()=>{const f=hashFixture(),key=url=>f.h.canonicalRemoteAssetKeyV614({url,assetId:'shared'});assert.equal(key('https://a.cloudfront.net/x?width=10&Signature=a'),key('https://a.cloudfront.net/x?width=10&Signature=b'));assert.notEqual(key('https://a.cloudfront.net/x?width=10'),key('https://a.cloudfront.net/x?width=20'));assert.notEqual(key('https://untrusted.example/x?Signature=a'),key('https://untrusted.example/x?Signature=b'));});
 await test('Cache reuses successful byte proof but retries a failed signed URL',async()=>{const f=hashFixture(),budget=f.budget();const a={url:'https://a.cloudfront.net/x?Signature=a'},b={url:'https://a.cloudfront.net/x?Signature=b'};await f.h.hashRemoteAsset(a,budget);await f.h.hashRemoteAsset(b,budget);assert.equal(f.calls(),1);assert.equal(a.sha256,b.sha256);assert.equal(b.hashStatus,'SHA256_CACHE');const failed=hashFixture({response:{ok:false,status:403,headers:{get:()=>''}}}),fb=failed.budget();await failed.h.hashRemoteAsset({...a,sha256:''},fb);await failed.h.hashRemoteAsset({...b,sha256:''},fb);assert.equal(failed.calls(),2);assert.equal(fb.cache.size,0);});
 await test('ZIP resolution rejects external URLs and ambiguous normalized paths',()=>{
  const fs=require('node:fs'),html=fs.readFileSync(require('node:path').join(__dirname,'../Index.html'),'utf8');
  const starts=[...html.matchAll(/^ (?:async )?function (\w+)\(/gm)];const context={};vm.createContext(context);
  for(const name of ['normalizeZipPath_','resolveZipHref_','resolveZipEntryV8_']){const i=starts.findIndex(x=>x[1]===name);assert(i>=0);vm.runInContext(html.slice(starts[i].index,starts[i+1].index),context);}
  const resolve=(files,href)=>context.resolveZipEntryV8_({},files,'imsmanifest.xml',href);
  assert.equal(resolve(['docs/File.pdf'],'https://external.example/File.pdf').method,'EXTERNAL_REFERENCE');
  assert.equal(resolve(['a/File.pdf','b/File.pdf'],'unknown/File.pdf').method,'AMBIGUOUS_BASENAME');
  assert.equal(resolve(['docs/File.pdf','docs/file.pdf'],'docs/FILE.pdf').method,'AMBIGUOUS_PATH');
  assert.equal(resolve(['docs/File.pdf','docs/file.pdf'],'docs/File.pdf').path,'docs/File.pdf');
  assert.equal(resolve(['docs;folder/File.pdf'],'docs;/folder/File.pdf').method,'SEMICOLON_SLASH_NORMALIZED');
 });
 await test('Reading check delivery compiles and advertises the canonical release',()=>{
  const fs=require('node:fs'),html=fs.readFileSync(require('node:path').join(__dirname,'../Index.html'),'utf8');
  const start=html.indexOf(' function ctiBuildReadingAttachmentCheck_(');
  // Find the actual builder by its observed unique rejection text if renamed.
  const functions=[...html.matchAll(/^ function (\w+)\(/gm)];const hit=functions.findIndex((x,i)=>html.slice(x.index,functions[i+1]?.index).includes('The reading check and deployed extractor do not match'));
  assert(hit>=0);const f=functions[hit],context={};vm.createContext(context);vm.runInContext(html.slice(f.index,functions[hit+1].index),context);
  const delivery=c.ctiExtractorDelivery_('coursera'),script=context[f[1]](delivery);
  new vm.Script(script);assert(script.includes("version:'v6.14.0'"));assert(script.includes('SINGLE_READING_CHECK_NOT_A_FULL_COURSE_CAPTURE'));
 });
 const hash='a'.repeat(64),clean=()=>({verdict:'VERIFIED',issues:[],checks:{structure:{status:'VERIFIED'}}});
 await test('Missing asset/link checks cannot default to verified',()=>{for(const source of [{type:'Reading',assetDetails:[{name:'x.pdf',sha256:hash}]},{type:'Reading',links:[{raw:'https://example.test'}]}]){const r=c.qaApplyDimensionalVerdictGateV8_(source,{},clean());assert.equal(r.verdict,'UNVERIFIED');}});
 await test('One matching behavior setting cannot hide another uncaptured source setting',()=>{const r=c.qaBehaviorComparison_({type:'Quiz',behavior:{observed:true,settings:{graded:true,timeLimitMinutes:5}}},{nativeAssignment:{settings:{gradeSetting:'Graded'}}});assert.equal(r.status,'UNVERIFIED');assert(r.unverifiedDimensions.includes('TIME_LIMIT'));});
 await test('Missing submission evidence remains uncertainty, not a confirmed mutation',()=>{const r=c.qaBehaviorComparison_({type:'Assignment',behavior:{observed:true,submission:{fileUpload:true}}},{nativeAssignment:{settings:{}}});assert.equal(r.status,'UNVERIFIED');assert.equal(r.mismatches.length,0);});
 await test('Changed passing threshold on a graded source is compared',()=>{const r=c.qaBehaviorComparison_({type:'Quiz',behavior:{observed:true,settings:{graded:true,passingThreshold:60}}},{nativeAssignment:{settings:{gradeSetting:'Graded',passingThreshold:80}}});assert.equal(r.status,'MUTATED');assert(r.mismatches.includes('PASSING_THRESHOLD_CHANGED'));});
 await test('Observed written questions do not acquire a fabricated answer-key requirement',()=>{const source={type:'Reading',isStructuredAssessment:true};const r=clean();r.checks.structuredAssessment={status:'VERIFIED',answerEvidenceApplicable:false,answerEvidenceCoverage:0};assert.equal(c.qaApplyDimensionalVerdictGateV8_(source,{},r).verdict,'VERIFIED');});
 await test('Math mixed numbers normalize without concatenating the whole and fraction',()=>{assert(c.qaAssessmentFieldSimilarity_("24' 2\\frac{1}{2}''","24' 2 1/2''")>.98);assert.notEqual(c.qaCanonicalMathTextV8_('2½'),c.qaCanonicalMathTextV8_('21/2'));});
 console.log(JSON.stringify({status:tests.some(t=>t.status==='FAIL')?'FAIL':'PASS',tests},null,2));if(tests.some(t=>t.status==='FAIL'))process.exitCode=1;
})();
