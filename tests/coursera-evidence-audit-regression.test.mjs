import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { directPublisherMediaStructureV1,directPublisherInlineAlternativesV1 } from '../src/extractors/coursera/direct-data-publisher-media.js';
const pages=JSON.parse(fs.readFileSync(new URL('./fixtures/cti-audit/publisher-pages.json',import.meta.url)));
const source=fs.readFileSync(new URL('../src/extractors/coursera/direct-data-entry.js',import.meta.url),'utf8');
function summaryContext(courseId) {
 const ast=ts.createSourceFile('entry.js',source,ts.ScriptTarget.Latest,true),decls=[];
 function walk(n){if(ts.isFunctionDeclaration(n)&&['publicPageFailureOutcome','summarizeInlineItem','inlineExternalContentSummary'].includes(n.name?.text))decls.push(n.getText(ast));else ts.forEachChild(n,walk);}
 walk(ast);const c=vm.createContext({courseId,itemStates:new Map(),directPublisherMediaStructureV1});new vm.Script(decls.join('\n')).runInContext(c);return c;
}
test('verified publisher archive slices preserve seven 404 sources and seven authored inline relationships',()=>{
 const failures=new Set(),alternatives=[];
 for(const page of pages){
  const before=JSON.stringify(page);
  assert(directPublisherMediaStructureV1(page.observation,page.targetUrl,page.media));
  for(const r of page.media.resources)if(r.reason){assert.equal(r.reason,'PUBLISHER_FIRST_PARTY_HTTP_404');assert.equal(r.firstPartyAttempt.status,404);assert.equal(r.firstPartyAttempt.observedBytes,0);failures.add(r.url);}
  alternatives.push(...directPublisherInlineAlternativesV1(page.observation,page.targetUrl,page.media));
  assert.equal(JSON.stringify(page),before,'Projection cannot alter receipts, times or bodies');
 }
 assert.equal(failures.size,7);assert.equal(alternatives.length,7);
 for(const a of alternatives){assert(failures.has(a.linkedUrl));assert.equal(a.replacesLinkedOriginal,false);assert.match(a.inlineSha256,/^[a-f0-9]{64}$/);}
});
test('recovery accounting separates skipped page reads, retained bodies and first-party HTTP failures',()=>{
 const c=summaryContext('Synthetic_course');
 c.itemStates.set('one',{inlineExternalContent:{total:1,captured:1,pages:[
  {targetUrl:'zero-images',representation:'PUBLISHER_API',saved:true,reused:true,skipped:true,historical:false,outcomes:[]},
  {targetUrl:'missing-body',representation:'PUBLISHER_API',saved:false,reused:false,skipped:true,historical:false,outcomes:[]},
  {targetUrl:'missing-body',representation:'HTML',saved:false,skipped:true,historical:false,outcomes:[]},
 ],images:[{url:'one',saved:true,sha256:'a'.repeat(64)},{url:'two',saved:true,sha256:'a'.repeat(64)},{url:'broken',saved:false,outcome:'PUBLISHER_HTTP_404'}]}});
 const s=c.inlineExternalContentSummary();assert.equal(s.pages.skipped,2);assert.equal(s.pages.reused,1);assert.equal(s.publisherApi.failures.other,0);assert.equal(s.publisherApi.failures.unclassified,0);assert.equal(s.htmlPages.readTargets,0);assert.equal(s.publisherImages.saved,2);assert.equal(s.publisherImages.uniqueFiles,1);assert.equal(s.publisherImages.publisherHttp['404'],1);
});
export {summaryContext};

test('all five audited zero-image pages enter the pinned recovery page inventory without image jobs',async()=>{
 const {createHash}=await import('node:crypto');
 const {directPublisherTargetV1,directPublisherResourceObservationValidV1}=await import('../src/extractors/coursera/direct-data-publisher.js');
 const {directPublisherMediaInventoryV1}=await import('../src/extractors/coursera/direct-data-publisher-media.js');
 const zero=JSON.parse(fs.readFileSync(new URL('./fixtures/cti-audit/zero-image-pages.json',import.meta.url))),ast=ts.createSourceFile('entry.js',source,ts.ScriptTarget.Latest,true),decls=[];
 function walk(n){if(ts.isFunctionDeclaration(n)&&['publisherRecoveryItem','recoveryPageKey','captureInlinePublisherPages'].includes(n.name?.text))decls.push(n.getText(ast));else ts.forEachChild(n,walk);}walk(ast);
 const c=vm.createContext({courseId:'Synthetic_course',directPublisherTargetV1,directPublisherResourceObservationValidV1,directPublisherMediaInventoryV1,directPublisherMediaStructureV1,
  hashText:async s=>createHash('sha256').update(s).digest('hex'),checkpointPublisherProviders:async fp=>({providers:[{binding:{providerId:'Provider'},targets:fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages.map(p=>({url:p.targetUrl}))}]}),
  CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1:8388608,claimExternalSource(){},publicPageStats:{retainedUtf8Bytes:0},capturePublisherImages:async()=>{},retainPublisherFailureReceipt:()=>null,activeRecovery:{pages:new Map()}});
 new vm.Script(decls.join('\n')).runInContext(c);
 const fp={id:'Item',atomId:'A'.repeat(22),payload:{directInlineWidgetProviderEvidence:{providers:[{providerId:'Provider',publisherPages:zero}]}}},before=JSON.stringify(zero),selected=await c.publisherRecoveryItem(fp);
 assert.equal(zero.length,5);assert.equal(selected.length,5);assert(selected.every(s=>s.entry===null));assert.equal(JSON.stringify(zero),before);
 for(const value of selected)c.activeRecovery.pages.set(c.recoveryPageKey(fp.id,fp.atomId,'Provider',value.targetUrl),value.observation);
 const provider={providerId:'Provider',publisherPages:zero.map(p=>({...p,observation:null,retainedObservation:p.observation,failures:[]}))};
 await c.captureInlinePublisherPages(fp,provider);
 for(const p of provider.publisherPages){assert.equal(p.readScope,'NOT_REFETCHED');assert.equal(p.failures.length,0);assert.deepEqual(p.observation,zero.find(old=>old.targetUrl===p.targetUrl).observation);assert.equal(p.retainedObservation,undefined);}
 const missing={providerId:'Provider',publisherPages:[{targetUrl:'https://opentextbc.ca/mathfortrades2/?p=104/#main',observation:null,failures:[],priorFailures:[{reason:'PUBLISHER_BROWSER_HTTP_401'}]}]};
 await c.captureInlinePublisherPages(fp,missing);assert.equal(missing.publisherPages[0].failures.length,0);assert.equal(missing.publisherPages[0].readScope,'NOT_REFETCHED');assert.equal(missing.publisherPages[0].priorFailures[0].reason,'PUBLISHER_BROWSER_HTTP_401');
});

test('audited 1fv6W definition keeps both explicitly empty source options and its literal key reference',async()=>{
 const {retainedAuthoringFields}=await import('../src/domain/coursera-retained-authoring-fields.ts'),{createHash}=await import('node:crypto'),{directCanonicalSourceTextV1}=await import('../src/extractors/coursera/direct-data-canonical.js');
 const raw=JSON.parse(fs.readFileSync(new URL('./fixtures/cti-audit/empty-option-definition.json',import.meta.url))),before=JSON.stringify(raw),
  block={kind:'QUESTION_DEFINITION',ordinal:1,nativeId:raw.id,nativeType:'mcq',originalModelJson:before,originalModelSha256:createHash('sha256').update(directCanonicalSourceTextV1(raw)).digest('hex')},view=retainedAuthoringFields(block);
 assert(view);assert.deepEqual(view.sourceDefect.emptyOptionOrdinals,[1,2]);assert.equal(view.sourceDefect.usableAnswerTextVerified,false);assert.equal(view.options.length,2);assert(view.options.every(o=>o.display.status==='EXPLICIT_EMPTY_SOURCE'));assert.equal(view.sourceDefect.nativeCorrectOption.value,raw.definition.definition.correctOption);assert.equal(JSON.stringify(raw),before);
});

test('a skipped duplicate never hides an actual failed retrieval of the same publisher page',()=>{
 const c=summaryContext('Synthetic_course');
 c.itemStates.set('one',{inlineExternalContent:{total:1,captured:1,pages:[
  {targetUrl:'same',representation:'PUBLISHER_API',saved:false,skipped:true,outcomes:[]},
  {targetUrl:'same',representation:'PUBLISHER_API',saved:false,skipped:false,outcomes:['HTTP_401']},
 ]}});
 const s=c.inlineExternalContentSummary();assert.equal(s.publisherApi.skipped,0);assert.equal(s.publisherApi.failures.observedHttp['401'],1);
});
