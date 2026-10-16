import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifiedCourseraCaptureInventory, evaluateCourseraCapture } from '../src/domain/coursera-background-extraction.ts';
import { captureStructureWorkbook } from '../src/domain/capture-structure.ts';
import { readWorkbook } from '../src/adapters/workbook.ts';
import { sourceDocumentScan } from '../src/domain/source-documents.ts';
import { inspectEvidenceInput } from '../src/domain/evidence-intake.ts';
import { createWorkflows } from '../src/domain/workflows.ts';
import { workerXml } from '../src/adapters/worker-xml.ts';
import { comparisonFixture, encode } from './workflow-fixtures.mjs';
import { directCanonicalSourceTextV1 } from '../src/extractors/coursera/direct-data-canonical.js';
const digest = x => createHash('sha256').update(x).digest('hex');
function captureFixture(typeName = 'supplement') {
 const courseId='native_course_123', atomId='a'.repeat(22);
 const leaf={id:'reading_1',name:'Reading',atomId,contentId:'atom~'+atomId,content:{typeName,definition:{}}};
 const model={elements:[{id:courseId,material:{elements:[{id:'module_1',name:'Module 1',elements:[leaf]}]},conflictMetadata:{version:1,courseBranchVersion:1}}]};
 const receipt={resource:'authoringCourseMaterials.v1',id:courseId,status:200,sha256:digest(JSON.stringify(model)),originalResponseSha256:digest(JSON.stringify(model)),requestPath:'/api/authoringCourseMaterials.v1/'+courseId,bodyFormat:'PARSED_SANITIZED_JSON_MODEL'};
 const modelHash=digest(directCanonicalSourceTextV1(model.elements[0]));
 return {schemaVersion:35,page:{courseId,url:'https://www.coursera.org/teach/native-course/'+courseId+'/content/edit'},
  meta:{baseFingerprintCount:1,directDataCapture:{mode:'BOUND_AUTHORING_DRAFT_API',version:1,sourceStable:true,acquisitionComplete:true,wholeCourseVerified:false,materialVersion:1,courseBranchVersion:1,initialMaterialHash:modelHash,finalMaterialHash:modelHash,materials:model,finalMaterials:structuredClone(model),materialsReceipt:receipt,finalMaterialsReceipt:structuredClone(receipt)}},
  fingerprints:[{id:leaf.id,name:leaf.name,type:'Reading',path:'Module 1',atomId,contentId:leaf.contentId,captureContract:{complete:false,status:'SOURCE_CONTENT_UNVERIFIED'},payload:{textSample:'',files:[],links:[],images:[]}}]};
}
test('native material structure can be verified while content gaps remain unresolved',()=>{
 const capture=captureFixture();const proof=verifiedCourseraCaptureInventory(capture);
 assert.equal(proof.inventory.length,1);assert.equal(proof.completeContent,false);
 assert.equal(evaluateCourseraCapture(capture).complete,false);
 const workbook=captureStructureWorkbook(capture);
 assert.equal(workbook.proof.independentWorkbook,false);assert.equal(workbook.proof.contentItemCount,1);
});
test('native type projection uses explicit supported kinds and rejects unknown content instead of inventing readings',()=>{
 for(const [type,label] of [['supplement','Reading'],['staffGraded','Assignment'],['peerGraded','Assignment'],['ungradedAssignment','Assignment'],['discussionPrompt','Discussion Prompt'],['quiz','Quiz'],['exam','Quiz'],['video','Video'],['ungradedWidget','Plugin'],['gradedWidget','Plugin']]) {
  const workbook=captureStructureWorkbook(captureFixture(type));
  const rows=readWorkbook(workbook.bytes,workbook.name).sheets.Inventory.values;
  assert.equal(rows.at(-1)[0],label,type);assert.equal(rows.at(-1)[7],'reading_1');
  assert.equal(workbook.proof.completeContent,false);
 }
 for(const type of ['programming','ungradedLab','gradedLti','futureQuiz','ungradedWidgetFuture','constructor']) {
  const capture=captureFixture(type);
  assert.equal(verifiedCourseraCaptureInventory(capture).inventory[0].sourceContentType,type);
  assert.throws(()=>captureStructureWorkbook(capture),/unsupported type.*matching Coursera XLSX/);
 }
});
test('native structural alternative rejects altered models, order, IDs, receipts and incomplete legacy inventory',()=>{
 const changes=[c=>{c.meta.directDataCapture.materials.elements[0].material.elements[0].name='Changed';},c=>{c.fingerprints[0].id='wrong';},c=>{c.meta.directDataCapture.finalMaterialsReceipt.status=403;},c=>{c.meta.baseFingerprintCount=2;},c=>{c.meta.directDataCapture.sourceStable=false;},c=>{delete c.meta.directDataCapture;}];
 for(const change of changes){const c=captureFixture();change(c);assert.throws(()=>verifiedCourseraCaptureInventory(c));}
});
test('capture-only comparison retains exact native ID and does not claim independent XLSX or full content',()=>{
 const input=comparisonFixture();delete input.excel;input.json={name:'native.json',bytes:encode(captureFixture())};
 const result=createWorkflows(workerXml).compare(input);
 assert.equal(result.result.success,true);assert.equal(result.hashes.excel,'');assert.match(result.hashes.derivedStructure,/^[a-f0-9]{64}$/);
 assert.equal(result.result.inputCoherence.status,'VERIFIED_CAPTURE_INVENTORY');
 assert.equal(result.result.stats.extractorMeta.xlsxTraversalInventory,undefined);
 assert.equal(result.result.stats.extractorMeta.excelCanonicalItemCount,undefined);
 assert.equal(result.result.stats.extractorMeta.inputCoherence.status,'VERIFIED_CAPTURE_INVENTORY');
 assert(!result.result.stats.source.includes('Excel (Authoritative'));
 assert.equal(result.result.structuralInventoryBasis.completeContent,false);
 assert.match(result.report,/independent.*XLSX/i);
});
test('legacy capture without an independent workbook fails rather than promoting incomplete structure',()=>{
 const input=comparisonFixture();delete input.excel;
 assert.throws(()=>createWorkflows(workerXml).compare(input),/native authoring-material/);
});
test('Markdown baseline retains literal text, ignores code headings and records text-only scope',async()=>{
 const md='# Original title\nExact source text.\n```\n# Not a section\n```\n## Repeated title\nUnchanged text.\n## Repeated title\nSecond copy.\n';
 const file=new File([md],'source.md');const inspected=await inspectEvidenceInput(file,comparisonFixture().course);
 const scan=sourceDocumentScan(inspected.data);const nodes=scan.courseTree[0].children;
 assert.equal(scan.courseTree[0].type,'folder');assert.equal(nodes.length,3);
 assert.equal(nodes.map(n=>n.sourcePayload.textSample).join(''),md);
 assert.equal(new Set(nodes.map(n=>n.idref)).size,3);assert.equal(nodes[1].title,nodes[2].title);
 assert.equal(scan.sourceEvidence.completeCourse,false);assert.equal(scan.sourceEvidence.original.text,md);
 assert.equal(scan.stats.expectedAssessmentCountKnown,false);
 assert(nodes.every(n=>n.sourcePayload.mediaCoverage==='NOT_ESTABLISHED'&&n.sourcePayload.expectedQuestionCount===null));
});
test('Markdown sections respect fence marker, minimum closing length and whitespace-only closing suffix',async()=>{
 for(const marker of ['`','~']) {
  const other=marker==='`'?'~':'`';
  const md=['# Source',marker.repeat(4)+'md','# Fenced heading',marker.repeat(3),
   '# Still fenced after short marker',other.repeat(4),'# Still fenced after other marker',
   marker.repeat(4)+' trailing text','# Still fenced after invalid closing suffix',
   marker.repeat(5)+' \t','## Actual next section','Exact final text.',''].join('\n');
  const scan=sourceDocumentScan((await inspectEvidenceInput(new File([md],'source.md'),comparisonFixture().course)).data);
  const nodes=scan.courseTree[0].children;
  assert.deepEqual(nodes.map(n=>n.title),['Source','Actual next section']);
  assert.equal(nodes.map(n=>n.sourcePayload.textSample).join(''),md);
 }
});
test('unclosed Markdown fences retain their headings as literal text and plain text never gains heading sections',async()=>{
 const course=comparisonFixture().course;
 const md='# Source\n```md\n# Literal code heading\n## More literal code\n';
 const scan=sourceDocumentScan((await inspectEvidenceInput(new File([md],'source.md'),course)).data);
 assert.equal(scan.courseTree[0].children.length,1);
 assert.equal(scan.courseTree[0].children[0].sourcePayload.textSample,md);
 const text=sourceDocumentScan((await inspectEvidenceInput(new File([md],'source.txt'),course)).data);
 assert.equal(text.courseTree[0].children.length,1);
 assert.equal(text.courseTree[0].children[0].sourcePayload.textSample,md);
});
test('Markdown heading labels preserve literal hashes and source-document JSON remains literal text',async()=>{
 const course=comparisonFixture().course;
 const md='# C#\nExact C# source.\n## Heading with closer ###\nBody.\n### Literal suffix#\nFinal.\n';
 const scan=sourceDocumentScan((await inspectEvidenceInput(new File([md],'source.md'),course)).data);
 const nodes=scan.courseTree[0].children;
 assert.deepEqual(nodes.map(n=>n.title),['C#','Heading with closer','Literal suffix#']);
 assert.equal(nodes.map(n=>n.sourcePayload.textSample).join(''),md);
 const json=JSON.stringify({kind:'CTI_SOURCE_DOCUMENT',schemaVersion:1,platform:'OTHER_LMS',
  title:'Retained source',text:md,scope:'Supplied text only',gaps:[]});
 const document=sourceDocumentScan((await inspectEvidenceInput(new File([json],'source.json'),course)).data);
 assert.equal(document.courseTree[0].children.length,1);
 assert.equal(document.courseTree[0].children[0].title,'Retained source');
 assert.equal(document.courseTree[0].children[0].sourcePayload.textSample,md);
 assert.equal(document.sourceEvidence.original.text,json);
});
test('a changed document has a different identity and cannot inherit old section identity by title',async()=>{
 const course=comparisonFixture().course;
 const a=sourceDocumentScan((await inspectEvidenceInput(new File(['# Same\nOne'],'source.md'),course)).data);
 const b=sourceDocumentScan((await inspectEvidenceInput(new File(['# Same\nTwo'],'source.md'),course)).data);
 assert.notEqual(a.fileSha256,b.fileSha256);assert.notEqual(a.courseTree[0].children[0].idref,b.courseTree[0].children[0].idref);
});
