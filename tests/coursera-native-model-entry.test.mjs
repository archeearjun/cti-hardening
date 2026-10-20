import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { harness, useNativeCml, exportedCapture } from "./coursera-direct-data-entry.test.mjs";
import { CTI_DIRECT_MANUAL_FIELDS_V1 } from "../src/extractors/coursera/direct-data-native-observations.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";

const COURSE = "Synthetic_course", SLUG = "synthetic-course", clone = value => structuredClone(value),
  hash = value => createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex"),
  cml = text => ({typeName: "cml", definition: {dtdId: "assess/1", value: "<co-content><text>" + text + "</text></co-content>"}});
function fixture(t) {
  useNativeCml(t);
  const cases = [{id: "InstructionModel", kind: "instruction", atomId: "A".repeat(22)},
    {id: "ReflectionModel", kind: "reflection", atomId: "B".repeat(22)},
    {id: "ExactTextModel", kind: "exact", atomId: "C".repeat(22)}],
    atoms = new Map(), relations = new Map(), groups = new Map(), definitions = new Map(),
    materialNodes = {}, fingerprints = {}, definitionsByItem = new Map();
  for (const item of cases) {
    const fp = {id: item.id, type: "Assignment", typeName: "ungradedAssignment", name: "Synthetic " + item.kind,
      atomId: item.atomId, contentId: "atom~" + item.atomId, payload: {}, sourceIdentity: {published: false}},
      parts = [], ownedDefinitions = [];
    if (item.kind === "instruction") parts.push({typeName: "storedTextBlockPart", definition: {
      id: "textBlock~12345678-1234-1234-1234-123456789abc", title: "Original instruction title", body: cml("Preserve the original task instructions."),
    }});
    else for (const [index, kind] of (item.kind === "reflection" ? ["mcqReflect", "checkboxReflect"] : ["textExactMatch"]).entries()) {
      const local = String.fromCharCode(103 + index).repeat(22), groupId = item.atomId + "~" + local,
        definitionId = item.atomId + "~" + String.fromCharCode(113 + index).repeat(22) + "@3";
      const body = kind === "textExactMatch" ? {prompt: cml("Enter the literal source phrase."),
        options: [{id: "literal", answer: "  Original Answer\n", isCorrect: true, feedback: cml("Original accepted-answer feedback")},
          {id: "rejected", answer: "original answer", isCorrect: false, feedback: cml("Original rejected-answer feedback")}],
        defaultIncorrectFeedback: cml("Original default incorrect feedback")} : {prompt: cml("Record your original preference " + (index + 1)),
          shuffleOptions: false, ...(kind === "mcqReflect" ? {noChosenFeedback: cml("")} : {}), options: [
            {id: "first", display: cml("Original preference first"), feedback: cml("Original feedback first")},
            {id: "second", display: cml("Original preference second"), feedback: cml("")}]};
      const source = {id: definitionId, definition: {typeName: kind, definition: body}};
      parts.push({typeName: "storedQuestionGroupPart", definition: {id: local}});
      groups.set(groupId, {id: groupId, questions: [definitionId], questionReferences: [{authoringId: definitionId}]});
      definitions.set(definitionId, source); ownedDefinitions.push(definitionId);
    }
    atoms.set(item.atomId, {id: item.atomId, contentId: fp.contentId, status: {typeName: "draftAtomStatus", definition: {}},
      storedAtomVersion: 1, metadata: {updatedAt: 1700000000000}, draft: {name: fp.name, content: {typeName: "staffGradedDraft", definition: {
        parts, configuration: {isGraded: false, gradeSelectionStrategy: "KEEP_LATEST"}, passingFraction: 0, assignmentLevelRubrics: [],
      }}}});
    relations.set(item.atomId, {id: item.atomId, atomId: item.atomId, branchRelationMap: {[COURSE + "~" + item.id]: {courseId: COURSE, itemId: item.id, courseSlug: SLUG}}});
    materialNodes[item.id] = {id: item.id, name: fp.name, originalName: fp.name, atomId: fp.atomId, contentId: fp.contentId, published: false,
      content: {typeName: fp.typeName, definition: {assignmentId: item.atomId + "@1"}}};
    fingerprints[item.id] = fp; definitionsByItem.set(item.id, ownedDefinitions);
  }
  const material = {id: COURSE, conflictMetadata: {version: 1, courseBranchVersion: 1}, material: {elements: [{id: "ModuleOne", name: "Synthetic module", elements: Object.values(materialNodes)}]}},
    resources = {atom: "authoringAtoms.v2", relation: "authoringItemContentRelations.v1", group: "authoringAssignmentQuestionGroups.v1", definition: "authoringAssignmentMachineEvaluableQuestions.v1", materials: "authoringCourseMaterials.v1", course: "authoringCourses.v2"},
    options = {ids: cases.map(item => item.id), fingerprints, materialNodes, nativeCml: true, nativeAssessment: true,
      readResult(call) {
        const value = call.resource === "atom" ? atoms.get(call.id) : call.resource === "relation" ? relations.get(call.id) :
          call.resource === "group" ? groups.get(call.id) : call.resource === "definition" ? definitions.get(call.id) :
          call.resource === "materials" ? material : call.resource === "course" ? {id: COURSE} : null;
        if (!value) return undefined;
        const data = {elements: [clone(value)], paging: {}, linked: {}};
        return {ok: true, data, receipt: {resource: resources[call.resource], id: call.id, status: 200,
          requestPath: "/api/" + resources[call.resource] + "/" + call.id, bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
          originalResponseSha256: hash(data), observedAt: new Date(call.at).toISOString(), bytes: 64}};
      }};
  return {app: harness(options), atoms, groups, definitions, definitionsByItem};
}
function byId(capture, id) { return capture.fingerprints.find(item => item.id === id); }

test("maintained entry captures exact-text keys, unkeyed reflections and non-question instructions through their actual native contracts", async t => {
  const f = fixture(t); f.app.launch(); await f.app.idle();
  assert.deepEqual(f.app.alerts, []);
  assert.equal(f.app.state().state, "COMPLETE", JSON.stringify(f.app.state()));
  const {capture} = await exportedCapture(f.app.downloads.at(-1)), instruction = byId(capture, "InstructionModel"),
    reflection = byId(capture, "ReflectionModel"), exact = byId(capture, "ExactTextModel");
  assert.equal(instruction.captureContract.status, "COMPLETE_BOUND_DRAFT_INSTRUCTION_ASSESSMENT");
  assert.equal(instruction.payload.structuredAssessment.questionCount, 0);
  assert.equal(instruction.payload.structuredAssessment.contentBlocks.length, 1);
  assert.equal(instruction.payload.structuredAssessment.captureCompleteness.sourceEmpty, false);
  assert.equal(instruction.payload.structuredAssessment.captureCompleteness.answerKeyApplicability, "NOT_APPLICABLE_NON_QUESTION_CONTENT");
  assert.equal(instruction.payload.structuredAssessment.contentBlocks[0].sourcePartSha256, hash(f.atoms.get(instruction.atomId).draft.content.definition.parts[0]));
  assert.equal(instruction.payload.explicitEmptyAssessmentEvidence, undefined);
  assert.equal(reflection.captureContract.status, "COMPLETE_BOUND_DRAFT_REFLECTION_ASSESSMENT");
  assert.equal(reflection.payload.structuredAssessment.questionCount, 2);
  assert.equal(reflection.payload.structuredAssessment.answerEvidenceQuestionCount, 0);
  assert(reflection.payload.structuredAssessment.questions.every(q => q.options.every(option => option.correct === null) && !q.correctAnswers.length && q.answerKeyApplicable === false));
  assert.equal(exact.captureContract.status, "COMPLETE_BOUND_DRAFT_ASSESSMENT");
  assert.equal(exact.payload.structuredAssessment.answerEvidenceQuestionCount, 1);
  assert.deepEqual(exact.payload.structuredAssessment.questions[0].correctAnswers, ["  Original Answer\n"]);
  assert.deepEqual(exact.payload.structuredAssessment.questions[0].options.map(option => option.correct), [true, false]);
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified, true, "This is only the complete bounded synthetic native course.");
  assert.equal(capture.fingerprints.reduce((sum, item) => sum + item.payload.structuredAssessment.questionCount, 0), 3);
  for (const item of [reflection, exact]) for (const definition of item.payload.assessmentApiEvidence.questionDefinitions) {
    assert.deepEqual(definition, f.definitions.get(definition.id));
    const receipt = item.payload.assessmentApiEvidence.receipts.find(receipt => receipt.id === definition.id), q = item.payload.structuredAssessment.questions.find(q => q.sourceDefinitionId === definition.id);
    assert.equal(q.observedAtMs, Date.parse(receipt.observedAt));
  }
  assert.equal(f.app.calls.filter(call => call.resource === "definition").length, 3);
  assert.equal(f.app.calls.filter(call => /public|publisher|panopto/.test(call.resource)).length, 0);
});

test("native recheck retains original exact definitions, keys, reflection applicability and their observation dates", async t => {
  const f = fixture(t); f.app.launch(); await f.app.idle();
  const original = (await exportedCapture(f.app.downloads.at(-1))).capture, runId = f.app.state().runId,
    oldDefinitions = clone([...f.app.definitions]), beforeCalls = f.app.calls.length;
  f.app.advance(10000); f.app.state().recheckNative(); await f.app.idle();
  const current = (await exportedCapture(f.app.downloads.at(-1))).capture;
  assert.equal(f.app.state().runId, runId);
  assert.equal(current.meta.directDataCapture.wholeCourseVerified, true);
  assert.equal(f.app.calls.slice(beforeCalls).filter(call => call.resource === "definition").length, 0, "Exact immutable definition IDs use existing validated cached originals.");
  assert.deepEqual(clone([...f.app.definitions]), oldDefinitions);
  for (const id of ["ReflectionModel", "ExactTextModel"]) {
    const old = byId(original, id), now = byId(current, id);
    // These independent response records are collected concurrently; their
    // arrival order is not authored question order. Compare exact records by ID.
    const recordsById = records => [...records].sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(recordsById(now.payload.assessmentApiEvidence.questionDefinitions), recordsById(old.payload.assessmentApiEvidence.questionDefinitions));
    assert.deepEqual(now.payload.structuredAssessment.questions, old.payload.structuredAssessment.questions);
    assert.equal(now.captureContract.status, old.captureContract.status);
  }
  const oldBlock = byId(original, "InstructionModel").payload.structuredAssessment.contentBlocks[0], currentBlock = byId(current, "InstructionModel").payload.structuredAssessment.contentBlocks[0];
  assert.deepEqual(currentBlock, oldBlock, "Exact original instruction CML/title/hash remains unchanged on a new source observation.");
});

test("entry never exempts reflection keys or instruction questions when the same native draft is graded", async t => {
  const f = fixture(t);
  for (const atom of f.atoms.values()) if (atom.id !== "C".repeat(22)) atom.draft.content.definition.configuration.isGraded = true;
  f.app.launch(); await f.app.idle();
  const {capture} = await exportedCapture(f.app.downloads.at(-1));
  assert.equal(f.app.state().state, "INCOMPLETE");
  for (const id of ["InstructionModel", "ReflectionModel"]) {
    const item = byId(capture, id); assert.equal(item.captureContract.complete, false); assert.equal(item.payload.directReflectionAssessmentEvidence, undefined); assert.equal(item.payload.directInstructionAssessmentEvidence, undefined);
  }
  assert.equal(byId(capture, "ExactTextModel").captureContract.complete, true);
  assert.equal(capture.meta.directDataCapture.wholeCourseVerified, false);
});

test('ten manual parts acquire two exact mutable observations each without fabricating normalized questions or verification', async t=>{
  useNativeCml(t);
  const atomId='M'.repeat(22),itemId='ManualParts',parts=Array.from({length:10},(_,i)=>({typeName:'storedManualGradedQuestionPart',definition:{id:String.fromCharCode(97+i).repeat(22)}})),
    fp={id:itemId,type:'Assignment',typeName:'ungradedAssignment',name:'Manual source',atomId,contentId:'atom~'+atomId,payload:{},sourceIdentity:{published:false}},
    atom={id:atomId,contentId:fp.contentId,status:{typeName:'draftAtomStatus'},storedAtomVersion:1,metadata:{updatedAt:1700000000000},draft:{name:fp.name,content:{typeName:'staffGradedDraft',definition:{parts,configuration:{isGraded:true},passingFraction:0.8,assignmentLevelRubrics:[]}}}},
    relation={id:atomId,atomId,branchRelationMap:{[COURSE+'~'+itemId]:{courseId:COURSE,itemId,courseSlug:SLUG}}},
    node={...fp,published:false,content:{typeName:fp.typeName,definition:{assignmentId:atomId+'@1'}}},
    material={id:COURSE,conflictMetadata:{version:1,courseBranchVersion:1},material:{elements:[{id:'ModuleOne',name:'Manual module',elements:[node]}]}},
    records=new Map(parts.map((part,i)=>{const id=part.definition.id;return [id,{id,graderType:'AI',submissionSchema:{typeName:'richText'},prompt:cml('Exact manual prompt '+i),rubrics:[{details:{typeName:'multiLineInput',definition:{points:2}},prompt:cml('Original criterion '+i)}],graderInstructions:'',options:[{display:''}]}];})),
    resources={atom:'authoringAtoms.v2',relation:'authoringItemContentRelations.v1',materials:'authoringCourseMaterials.v1',course:'authoringCourses.v2',manual:'authoringAssignmentManualGradedQuestions.v1'},
    app=harness({ids:[itemId],fingerprints:{[itemId]:fp},materialNodes:{[itemId]:node},nativeCml:true,nativeAssessment:true,readResult(call){
      const value=call.resource==='atom'?atom:call.resource==='relation'?relation:call.resource==='materials'?material:call.resource==='course'?{id:COURSE}:call.resource==='manual'?records.get(call.id):null;
      if(!value)return undefined;const data={elements:[clone(value)],paging:{},linked:{}};
      return {ok:true,data,receipt:{...(call.resource==='manual'?{requestQuery:[['id',call.id],['fields',CTI_DIRECT_MANUAL_FIELDS_V1]]}:{}),resource:resources[call.resource],id:call.id,status:200,requestPath:'/api/'+resources[call.resource]+'/'+call.id,bodyFormat:'PARSED_SANITIZED_JSON_MODEL',originalResponseSha256:hash(data),observedAt:new Date(call.at).toISOString(),bytes:64}};
    }});
  app.launch();await app.idle();const {capture}=await exportedCapture(app.downloads.at(-1)),item=byId(capture,itemId),manual=item.payload.assessmentApiEvidence.manualDefinitions;
  assert.equal(manual.length,10);assert.equal(app.calls.filter(c=>c.resource==='manual').length,20);assert.equal(app.calls.filter(c=>c.resource==='definition'||c.resource==='group').length,0);
  for(const record of manual){assert.equal(record.stable,true);assert.deepEqual(record.acquisition,{kind:"MANUAL_SUBMISSION",sourceState:"CURRENT_AUTHORING_QUESTION",publishedBodyVerified:false});assert.deepEqual(record.initial.data.elements[0],records.get(record.id));assert.equal(record.initial.data.elements[0].options[0].display,'');}
  assert.equal(item.payload.structuredAssessment.questionCount,0);assert.equal(item.captureContract.complete,false);assert.equal(capture.meta.directDataCapture.wholeCourseVerified,false);
  const original=clone(item.payload.assessmentApiEvidence),before=app.calls.length;
  app.advance(1000);app.state().recheckNative();await app.idle();
  const current=app.items.get(app.state().runId+"/"+itemId).fingerprint;
  assert.equal(app.calls.slice(before).filter(c=>c.resource==='manual').length,20);
  assert.deepEqual(current.payload.assessmentApiEvidence,original,"Prior original bodies and timestamps remain intact");
  const attempt=current.payload.directNativeRecheckAttempt;
  assert.equal(attempt.currentNativeVerified,false);assert.equal(attempt.assessmentApiEvidence.manualDefinitions.length,10);
  assert(attempt.assessmentApiEvidence.manualDefinitions.every(r=>r.stable && r.acquisition.publishedBodyVerified===false));

});
