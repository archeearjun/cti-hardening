import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {directManualPartTargetsV1,directManualObservationV1,directManualQuestionV1,CTI_DIRECT_MANUAL_FIELDS_V1} from '../src/extractors/coursera/direct-data-native-observations.js';
import {directCanonicalSourceTextV1} from '../src/extractors/coursera/direct-data-canonical.js';
const hash=x=>createHash('sha256').update(directCanonicalSourceTextV1(x)).digest('hex');
const ids=['R_f6cLTaEfGh5Qr_wfyFdQ','SIXig7TaEfG8Ow7_-knS0w','SQrJ9LTaEfG8Ow7_-knS0w','SZDC4bTaEfGc8xL_1-Q0Lw','ShHZwbTaEfGh5Qr_wfyFdQ','SowS1bTaEfGqVQ7_1MvWlQ','Swjj5rTaEfG8Ow7_-knS0w','S5gro7TaEfGh5Qr_wfyFdQ','TBgKBLTaEfGh5Qr_wfyFdQ','TKGsY7TaEfGc8xL_1-Q0Lw'];
const bound={sourceState:'AUTHORING_DRAFT',atomId:'RwzXxrTaEfGOPAr_0ssJ-Q',draft:{content:{typeName:'staffGradedDraft',definition:{parts:ids.map(id=>({typeName:'storedManualGradedQuestionPart',definition:{id}}))}}}};
test('the ten audited manual parts retain exact source order and owner IDs without inventing versions',()=>{
 const before=JSON.stringify(bound),targets=directManualPartTargetsV1(bound);assert.equal(targets.length,10);assert.deepEqual(targets.map(t=>t.localId),ids);assert(targets.every(t=>t.id===t.localId&&!t.id.includes('@')));assert.equal(JSON.stringify(bound),before);
 const dup=structuredClone(bound);dup.draft.content.definition.parts.push(dup.draft.content.definition.parts[0]);assert.deepEqual(directManualPartTargetsV1(dup),[]);
});
test('manual source retention requires two matching owned observations and preserves all original grading fields',()=>{
 const target=directManualPartTargetsV1(bound)[0],data={elements:[{id:target.id,prompt:{typeName:'cml',definition:{value:'<co-content><text>Exact manual prompt</text></co-content>'}},rubrics:[{title:'Exact rubric',points:4}],options:[{display:''}]}]},
 receipt={requestQuery:[['id',target.id],['fields',CTI_DIRECT_MANUAL_FIELDS_V1]],resource:'authoringAssignmentManualGradedQuestions.v1',id:target.id,requestPath:'/api/authoringAssignmentManualGradedQuestions.v1/'+target.id,status:200,bodyFormat:'PARSED_SANITIZED_JSON_MODEL',observedAt:'2026-10-20T08:00:00.000Z'},
 initial={data,receipt,modelSha256:hash(data)},record={...target,initial,final:structuredClone(initial),stable:true};
 assert(directManualObservationV1(record,target,hash));assert.equal(record.initial.data.elements[0].options[0].display,'');assert.equal(record.initial.data.elements[0].rubrics[0].points,4);
 for(const mutate of [r=>r.final.data.elements[0].rubrics[0].points=5,r=>r.final.receipt.status=404,r=>r.initial.data.elements[0].id='foreign',r=>r.stable=false,r=>r.final.receipt.requestQuery=[['id',target.id],['fields','ALL']],r=>r.final.receipt.observedAt='2026-10-19T08:00:00.000Z']){const r=structuredClone(record);mutate(r);assert.equal(directManualObservationV1(r,target,hash),false);}
 assert.equal(record.wholeItemVerified,undefined);
});

test('observed AI manual rich-text shape preserves exact CML, rubric points, configuration and empty fields',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('./fixtures/coursera/manual-authoring-observed.json',import.meta.url),'utf8'));
 const source=fixture.elements[0],before=JSON.stringify(source),result=directManualQuestionV1(source);
 assert.equal(result.kind,'MANUAL_SUBMISSION');assert.equal(result.graderClassification,'AI');assert.equal(result.sourceState,'CURRENT_AUTHORING_QUESTION');assert.equal(result.publishedBodyVerified,false);
 assert.deepEqual(result.fields,source);assert.equal(result.fields.rubrics[0].details.definition.points,2);assert.equal(result.fields.graderType,'AI');assert.equal(result.fields.graderInstructions,'');
 assert.equal(JSON.stringify(source),before);
 const minimal={id:source.id,prompt:{typeName:'cml',definition:{dtdId:'assess/1',value:''}},rubrics:[],submissionSchema:{typeName:'richText'}};
 assert.deepEqual(directManualQuestionV1(minimal).fields,minimal);
 // Synthetic non-AI value tests literal retention, not a claim about Coursera's staff enum.
 const staff={...source,graderType:'SYNTHETIC_STAFF'};
 assert.equal(directManualQuestionV1(staff).fields.graderType,'SYNTHETIC_STAFF');assert.equal(directManualQuestionV1(staff).graderClassification,'UNKNOWN');
 assert.equal(directManualQuestionV1({...source,id:'owner~'+source.id}),null);
 assert.equal(directManualQuestionV1({...source,writeAccessToken:'synthetic-rejected'}),null);
 assert(!JSON.stringify(fixture).includes('writeAccessToken'));
});

test('manual targets never infer IDs from published, missing or malformed bindings',()=>{
 for(const mutate of [b=>b.sourceState='PUBLISHED',b=>b.atomId='',b=>b.draft.content.definition.parts[0].definition.id='owner~question']){
 const b=structuredClone(bound);mutate(b);assert.deepEqual(directManualPartTargetsV1(b),[]);
 }
});
