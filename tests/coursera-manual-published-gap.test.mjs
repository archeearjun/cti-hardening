import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {directDraftAssessmentInventoryV1} from '../src/extractors/coursera/direct-data-models.js';
import {directManualPartTargetsV1, directManualObservationV1, directManualQuestionV1, CTI_DIRECT_MANUAL_FIELDS_V1} from '../src/extractors/coursera/direct-data-native-observations.js';
import {directCanonicalSourceTextV1} from '../src/extractors/coursera/direct-data-canonical.js';
import {directManualDraftModelV1} from '../src/extractors/coursera/direct-data-manual-draft.js';

const evidence = JSON.parse(readFileSync(new URL('./fixtures/coursera/manual-published-gap-v193.json', import.meta.url)));
const hash = value => createHash('sha256').update(directCanonicalSourceTextV1(value)).digest('hex');
const bound = {
  sourceState: 'AUTHORING_DRAFT', atomId: evidence.atomId,
  published: evidence.published,
  draft: {content: {typeName: 'staffGradedDraft', definition: {
    configuration: {isGraded: evidence.draftIsGraded},
    parts: evidence.questions.map(q => ({typeName: 'storedManualGradedQuestionPart', definition: {id: q.localId}})),
  }}},
};

test('ten observed manual parts do not resolve the separately versioned published assignment', () => {
  assert.equal(evidence.atomStatus, 'draftAtomStatus');
  assert.equal(evidence.published.content.definition.assignmentId, 'SPnBUGLKT0i5wVBiyj9IGQ@1');
  assert.notEqual(evidence.published.content.definition.assignmentId.split('@')[0], bound.atomId);
  assert.equal(evidence.draftIsGraded, true);
  assert.equal(evidence.published.content.definition.isGraded, false);
  const inventory = directDraftAssessmentInventoryV1(bound);
  assert.equal(inventory.complete, true, 'Part inventory is now understood, independently of body or publication verification');
  assert.equal(inventory.declaredContentParts, 10);
  assert.equal(inventory.candidates.length, 10);
  assert.equal(inventory.unsupportedParts.length, 0);
  assert.equal(inventory.manualOnly, true);
  assert.deepEqual(directManualPartTargetsV1({...bound, sourceState: 'PUBLISHED'}), []);
});

for (const observed of evidence.questions) {
  test(`observed manual part ${observed.ordinal}: stable AI authoring content is not published proof`, () => {
    const target = directManualPartTargetsV1(bound)[observed.ordinal - 1];
    assert.equal(target.id, observed.id);
    assert.deepEqual(observed.statuses, [200, 200]);
    // Source structure and point values are observed; course text is deliberately
    // replaced, and these synthetic receipts do not claim a live acquisition.
    const model = {
      id: target.id, graderType: observed.graderType,
      prompt: {typeName: 'cml', definition: {dtdId: 'assess/1', value: '<co-content><text>Synthetic regression question</text></co-content>'}},
      submissionSchema: {typeName: observed.submissionType, definition: {}},
      rubrics: observed.rubricPoints.map(points => ({details: {typeName: 'multiLineInput', definition: {points}}})),
      validation: {isReadyForPublish: observed.readyForPublish},
    };
    const data = {elements: [model]}, receipt = {
      resource: 'authoringAssignmentManualGradedQuestions.v1', id: target.id,
      requestPath: '/api/authoringAssignmentManualGradedQuestions.v1/' + target.id,
      requestQuery: [['id', target.id], ['fields', CTI_DIRECT_MANUAL_FIELDS_V1]],
      status: 200, bodyFormat: 'PARSED_SANITIZED_JSON_MODEL', observedAt: '2026-10-20T15:00:00Z',
    };
    const initial = {data, receipt, modelSha256: hash(data)};
    const record = {...target, initial, final: structuredClone(initial), stable: true};
    assert.equal(directManualObservationV1(record, target, hash), true);
    const result = directManualQuestionV1(model);
    assert.equal(result.graderClassification, 'AI');
    assert.equal(result.publishedBodyVerified, false);
    assert.deepEqual(result.fields, model);
    const versioned = structuredClone(record);
    versioned.final.data.elements[0].id = evidence.published.content.definition.assignmentId;
    versioned.final.modelSha256 = hash(versioned.final.data);
    assert.equal(directManualObservationV1(versioned, target, hash), false);
    const changed = structuredClone(record);
    changed.final.data.elements[0].prompt.definition.value = '';
    changed.final.modelSha256 = hash(changed.final.data);
    assert.equal(directManualObservationV1(changed, target, hash), false);
  });
}

test('manual draft completeness requires supported bodies, all ten bindings and original grading structures', () => {
  const b = {...structuredClone(bound), courseId:'SyntheticCourse', itemId:evidence.itemId};
  const records = directManualPartTargetsV1(b).map((target,index) => {
    const cml = value => ({typeName:'cml',definition:{dtdId:'assess/1',value}});
    const q = {id:target.id,graderType:'AI',submissionSchema:{typeName:'richText',definition:{}},
      prompt:cml('<co-content><text>Synthetic exact prompt</text></co-content>'),
      rubrics:[{id:'criterion-'+index,details:{typeName:'multiLineInput',definition:{points:evidence.questions[index].rubricPoints[0]}},
        prompt:cml('<co-content><text></text></co-content>')}],
      academicIntegrityConfiguration:{},plagiarismConfig:{},validation:{isReadyForPublish:true}};
    const data={elements:[q]},initial={data,modelSha256:hash(data),receipt:{
      resource:'authoringAssignmentManualGradedQuestions.v1',id:target.id,
      requestPath:'/api/authoringAssignmentManualGradedQuestions.v1/'+target.id,
      requestQuery:[['id',target.id],['fields',CTI_DIRECT_MANUAL_FIELDS_V1]],
      status:200,bodyFormat:'PARSED_SANITIZED_JSON_MODEL',observedAt:'2026-10-20T15:00:00Z'}};
    return {...target,initial,final:structuredClone(initial),stable:true};
  });
  const raw={method:'BOUND_AUTHORING_DRAFT_API',courseId:b.courseId,itemId:b.itemId,
    assignmentId:b.atomId,rawParts:b.draft.content.definition.parts,manualDefinitions:records};
  const model=directManualDraftModelV1(b,raw,hash);
  assert.equal(model.questionCount,10);
  assert.equal(model.sourceState,'AUTHORING_DRAFT');
  assert.equal(model.publishedBodyVerified,false);
  assert.deepEqual(model.questions.map(q=>q.points),[2,3,2,3,5,5,4,3,4,4]);
  assert(model.questions.every(q=>q.correctAnswers.length===0 && q.answerKeyApplicable===false));
  for(const mutate of [
    q=>q.graderType='UNKNOWN_STAFF',
    q=>q.submissionSchema.typeName='fileUpload',
    q=>q.rubrics[0].details.definition.points=-1,
    q=>q.rubrics[0].prompt.definition.value='<co-content><img src="https://example.test/missing.png"/></co-content>',
    q=>q.prompt.definition.value='<broken',
    q=>q.prompt.definition.dtdId='unknown/1',
    q=>q.options=[{display:''}],
    q=>q.plagiarismConfig.writeAccessToken='synthetic-secret',
  ]) {
    const changed=structuredClone(raw),r=changed.manualDefinitions[0];
    mutate(r.initial.data.elements[0]);r.initial.modelSha256=hash(r.initial.data);r.final=structuredClone(r.initial);
    assert.equal(directManualDraftModelV1(b,changed,hash),null);
  }
  for(const mutate of [r=>r.manualDefinitions.pop(),r=>r.manualDefinitions.reverse(),r=>r.assignmentId=evidence.published.content.definition.assignmentId]) {
    const changed=structuredClone(raw);mutate(changed);
    assert.equal(directManualDraftModelV1(b,changed,hash),null);
  }
});
