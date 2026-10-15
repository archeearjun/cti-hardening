import test from 'node:test';
import assert from 'node:assert/strict';
import {directPanoptoFixture,panoptoHash} from './coursera-direct-panopto-fixtures.mjs';
import {WIDGET_COURSE,WIDGET_SLUG} from './coursera-direct-widget-fixtures.mjs';
import {directProviderAccessDiagnosticV1,directProviderAccessDiagnosticStructureV1,directProviderAccessDiagnosticTextV1} from '../src/extractors/coursera/direct-data-provider-diagnostic.js';
import {validateProviderAccessDiagnostic,providerAccessDiagnosticText} from '../src/domain/provider-access-diagnostic.ts';

function fixture(outcome='CORS_OR_NETWORK'){
 const f=directPanoptoFixture(),p=f.fp.payload,widget=p.directWidgetProviderEvidence,
  receipt=structuredClone(f.delivery.initial.receipt);
 receipt.status=outcome==='HTTP_OBSERVED'?401:0;
 receipt.bytes=0;receipt.originalResponseSha256='';receipt.sha256='';
 receipt.diagnostics={schemaVersion:1,outcome,policyEventsAvailable:true,enforcedCsp:null,relatedEnforcedCsp:null,httpStatus:receipt.status};
 if(outcome==='ENFORCED_CSP')receipt.diagnostics.enforcedCsp={effectiveDirective:'connect-src',disposition:'enforce'};
 if(outcome==='CSP_REPORTED_FOR_ORIGIN')receipt.diagnostics.relatedEnforcedCsp={effectiveDirective:'connect-src',disposition:'enforce',requestMatch:'ORIGIN_ONLY'};
 const sources={atom:p.directDataSources.atom,relation:p.directDataSources.relation,provider:widget.initial.model,
  receipts:{atom:p.directDataSources.receipts.atom,relation:p.directDataSources.receipts.relation,provider:widget.initial.receipt}};
 sources.hashes=Object.fromEntries(['atom','relation','provider'].map(k=>[k,panoptoHash(sources[k])]));
 const item={itemId:f.fp.id,atomId:f.fp.atomId,providerId:f.evidence.providerId,targetUrl:f.targetUrl,sources,
  request:{reason:outcome==='HTTP_OBSERVED'?'PANOPTO_HTTP_401':'PANOPTO_ACCESS_BLOCKED_OR_FAILED',receipt}};
 const input={courseId:WIDGET_COURSE,courseSlug:WIDGET_SLUG,pageUrl:`https://www.coursera.org/teach/${WIDGET_SLUG}/${WIDGET_COURSE}/content/edit`,checkedAt:'2026-10-15T20:00:00.000Z',items:[item],nativeFailures:[]};
 return {...f,item,input,diagnostic:directProviderAccessDiagnosticV1(input)};
}

test('separate diagnostic binds exact native widget target and observed HTTP without a content claim',()=>{
 const {diagnostic}=fixture('HTTP_OBSERVED'),before=JSON.stringify(diagnostic),valid=validateProviderAccessDiagnostic(diagnostic);
 assert.equal(valid.kind,'CTI_PROVIDER_ACCESS_DIAGNOSTIC');assert.equal(valid.notForCourseAudit,true);
 for(const key of ['contentCompletionVerified','sourceStabilityVerified','bodyVerified','playbackVerified','launchVerified','wholeWidgetVerified'])assert.equal(valid[key],false);
 assert.equal(directProviderAccessDiagnosticStructureV1(valid).items[0].httpStatus,401);
 assert.ok(providerAccessDiagnosticText(valid).includes('HTTP status 401'));assert.equal(JSON.stringify(diagnostic),before);
 assert.equal(valid.items[0].request.data,undefined);assert.equal(valid.items[0].request.receipt.diagnostics.outcome,'HTTP_OBSERVED');
});

test('exact enforced CSP, origin-only CSP and opaque network failure remain distinct',()=>{
 const exact=fixture('ENFORCED_CSP'),origin=fixture('CSP_REPORTED_FOR_ORIGIN'),opaque=fixture();
 assert.ok(directProviderAccessDiagnosticTextV1(exact.diagnostic).includes('blocking this request'));
 const text=providerAccessDiagnosticText(origin.diagnostic);assert.ok(text.includes('did not identify the exact request'));assert.ok(!text.includes('blocking this request'));
 const unknown=providerAccessDiagnosticText(opaque.diagnostic);assert.ok(unknown.includes('CORS policy and network failure cannot be distinguished'));
 assert.ok(!unknown.includes('CORS blocked'));assert.ok(!unknown.includes('authentication failed'));
});

test('diagnostic refuses wrong item/provider/model/source receipt and linked example targets',()=>{
 for(const mutate of [f=>f.item.itemId='OtherItem',f=>f.item.providerId='x'.repeat(22),f=>f.item.atomId='x'.repeat(22),
  f=>f.item.sources.receipts.provider.requestQuery.find(p=>p[0]==='courseId')[1]='Other_course',
  f=>f.item.sources.receipts.atom.requestPath+='/foreign',f=>f.item.sources.provider.elements[0].id='x'.repeat(22),
  f=>f.item.targetUrl=f.item.sources.provider.linked['authoringWidgetSummaries.v1'][0].configurationExamples[0].configuration.url]){
  const f=fixture();mutate(f);assert.equal(directProviderAccessDiagnosticStructureV1(f.diagnostic).valid,false);
 }
});

test('diagnostic independently hashes whole retained native models including unknown metadata',()=>{
 const f=fixture();f.item.sources.provider.elements[0].draft.configuration.customSetting='Changed retained text';
 assert.equal(directProviderAccessDiagnosticStructureV1(f.diagnostic).valid,true);
 assert.throws(()=>validateProviderAccessDiagnostic(f.diagnostic),/SOURCE_HASH_INVALID/);
});

test('diagnostic rejects contradictory, report-only and fabricated completion classifications',()=>{
 for(const mutate of [f=>f.diagnostic.contentCompletionVerified=true,f=>f.diagnostic.wholeWidgetVerified=true,
  f=>f.item.request.receipt.diagnostics.outcome='CORS_CONFIRMED',
  f=>f.item.request.receipt.diagnostics.outcome='HTTP_OBSERVED',
  f=>f.item.request.receipt.diagnostics.httpStatus=403,
  f=>{f.item.request.receipt.diagnostics.outcome='ENFORCED_CSP';f.item.request.receipt.diagnostics.enforcedCsp={effectiveDirective:'connect-src',disposition:'report'};},
  f=>{f.item.request.receipt.diagnostics.outcome='CSP_REPORTED_FOR_ORIGIN';f.item.request.receipt.diagnostics.relatedEnforcedCsp={effectiveDirective:'connect-src',disposition:'enforce',requestMatch:'OTHER_PATH'};},
  f=>f.item.request.receipt.requestForm.push(['action','change'])]){
  const f=fixture();mutate(f);assert.equal(directProviderAccessDiagnosticStructureV1(f.diagnostic).valid,false);
 }
});

test('native source failures retain safe identity and authorize no guessed request',()=>{
 const f=fixture();f.input.items=[];f.input.nativeFailures=[{itemId:'WidgetMissing',atomId:'a'.repeat(22),reason:'AUTHORING_SOURCE_READ_FAILED'}];
 const d=directProviderAccessDiagnosticV1(f.input);assert.equal(d.items.length,0);assert.equal(validateProviderAccessDiagnostic(d),d);
 assert.ok(providerAccessDiagnosticText(d).includes('No provider request was authorized'));
 f.input.nativeFailures[0].reason='raw browser error with data';assert.throws(()=>directProviderAccessDiagnosticV1(f.input));
});

test('diagnostic bounds and credential policy reject unsafe report contents',()=>{
 const f=fixture();f.item.sources.provider.elements[0].draft.configuration.accessToken='synthetic-secret';
 assert.equal(directProviderAccessDiagnosticStructureV1(f.diagnostic).valid,false);
 const g=fixture();g.diagnostic.items.push(g.item);assert.equal(directProviderAccessDiagnosticStructureV1(g.diagnostic).valid,false);
 const h=fixture();h.diagnostic.pageUrl='https://other.example.test/teach/x/'+WIDGET_COURSE+'/content';assert.equal(directProviderAccessDiagnosticStructureV1(h.diagnostic).valid,false);
 const i=fixture();i.item.request.data=i.model;assert.equal(directProviderAccessDiagnosticStructureV1(i.diagnostic).valid,false);
 const j=fixture();j.item.sources.provider.elements[0].draft.configuration.unknownText='x'.repeat(1024*1024);assert.equal(directProviderAccessDiagnosticStructureV1(j.diagnostic).valid,false);
});


test('a stopped check retains controlled reason without fabricating a request receipt',()=>{
 const f=fixture();f.input.stopReason='COURSE_API_TIME_LIMIT';f.item.request={reason:'COURSE_API_TIME_LIMIT',receipt:null};
 const diagnostic=directProviderAccessDiagnosticV1(f.input),parsed=directProviderAccessDiagnosticStructureV1(diagnostic);
 assert.equal(parsed.valid,true);assert.equal(parsed.items[0].outcome,'UNKNOWN');assert.equal(parsed.items[0].observedAt,null);
 assert.ok(providerAccessDiagnosticText(diagnostic).includes('Check stopped: COURSE_API_TIME_LIMIT'));
 assert.equal(diagnostic.items[0].request.receipt,null);
 f.item.request.reason='';assert.throws(()=>directProviderAccessDiagnosticV1(f.input));
});
