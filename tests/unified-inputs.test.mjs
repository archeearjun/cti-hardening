import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifiedCourseraCaptureInventory, evaluateCourseraCapture } from '../src/domain/coursera-background-extraction.ts';
import { captureStructureEvidence, captureStructureWorkbook } from '../src/domain/capture-structure.ts';
import { readWorkbook } from '../src/adapters/workbook.ts';
import { sourceDocumentScan } from '../src/domain/source-documents.ts';
import { inspectEvidenceInput } from '../src/domain/evidence-intake.ts';
import { createWorkflows } from '../src/domain/workflows.ts';
import { workerXml } from '../src/adapters/worker-xml.ts';
import { comparisonFixture, encode } from './workflow-fixtures.mjs';
import { directCanonicalSourceTextV1 } from '../src/extractors/coursera/direct-data-canonical.js';
import { buildOwnerTasks } from '../src/domain/owner-actions.ts';
import { ownerScope } from '../src/domain/owner-scope.ts';
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
function shellCaptureFixture() {
 const capture=captureFixture(), mode=capture.meta.directDataCapture;
 const root=mode.materials.elements[0], first=root.material.elements[0];
 first.originalName='Old module title';
 first.elements[0].name='Current reading title';
 first.elements[0].originalName='Old reading title';
 first.elements.push({id:'empty_lesson',name:'Explore',trackId:'track_1',elements:[]});
 root.material.elements.push({id:'empty_module',name:'Archive',description:'',learningObjectives:[],timeCommitment:0,elements:[]});
 const repeated={id:'module_2',name:first.name,elements:[{...structuredClone(first.elements[0]),id:'reading_2',atomId:'b'.repeat(22),contentId:'atom~'+'b'.repeat(22)}]};
 root.material.elements.push(repeated);
 capture.fingerprints[0].name='Current reading title';
 capture.fingerprints.push(...[
  {id:'empty_lesson',name:'Explore',type:'Unknown'},
  {id:'empty_module',name:'Archive',type:'Unknown'},
  {id:'reading_2',name:'Current reading title',type:'Reading',atomId:'b'.repeat(22),contentId:'atom~'+'b'.repeat(22)}
 ].map(item=>({...item,payload:{textSample:'',files:[],links:[],images:[]}})));
 capture.meta.baseFingerprintCount=capture.fingerprints.length;
 mode.finalMaterials=structuredClone(mode.materials);
 mode.initialMaterialHash=mode.finalMaterialHash=digest(directCanonicalSourceTextV1(root));
 mode.materialsReceipt.sha256=mode.materialsReceipt.originalResponseSha256=digest(JSON.stringify(mode.materials));
 mode.finalMaterialsReceipt=structuredClone(mode.materialsReceipt);
 return capture;
}
function contextCaptureFixture() {
 const capture=captureFixture(), mode=capture.meta.directDataCapture, root=mode.materials.elements[0];
 const item=(id,letter)=>({id,name:id,atomId:letter.repeat(22),contentId:'atom~'+letter.repeat(22),content:{typeName:'supplement',definition:{}}});
 root.material.elements=[{id:'module_1',name:'Module 1',elements:[
  {id:'archive_1',name:'Archive',trackId:'t1',elements:[]}, item('reading_1','a'),
  {id:'lesson_1',name:'Repeated lesson',trackId:'t2',elements:[item('reading_2','b')]}, item('reading_3','c'),
  {id:'archive_2',name:'Archive',trackId:'t3',elements:[]},
  {id:'lesson_2',name:'Repeated lesson',trackId:'t4',elements:[item('reading_4','d')]}
 ]},{id:'module_2',name:'Module 1',elements:[
  {id:'archive_3',name:'Archive',trackId:'t5',elements:[]},item('reading_5','e')
 ]}];
 capture.fingerprints=[];
 function visit(node,ancestors) {
  if(node.elements?.length) return node.elements.forEach(child=>visit(child,[...ancestors,node]));
  capture.fingerprints.push({id:node.id,name:node.name,path:ancestors.map(a=>a.name).join(' > '),
   type:node.content?'Reading':'Unknown',atomId:node.atomId||'',contentId:node.contentId||'',payload:{textSample:'',files:[],links:[],images:[]}});
 }
 root.material.elements.forEach(node=>visit(node,[]));
 capture.meta.baseFingerprintCount=capture.fingerprints.length;
 mode.finalMaterials=structuredClone(mode.materials);
 mode.initialMaterialHash=mode.finalMaterialHash=digest(directCanonicalSourceTextV1(root));
 mode.materialsReceipt.sha256=mode.materialsReceipt.originalResponseSha256=digest(JSON.stringify(mode.materials));
 mode.finalMaterialsReceipt=structuredClone(mode.materialsReceipt);
 return capture;
}
test('native material structure can be verified while content gaps remain unresolved',()=>{
 const capture=captureFixture();const proof=verifiedCourseraCaptureInventory(capture);
 assert.equal(proof.inventory.length,1);assert.equal(proof.completeContent,false);
 assert.equal(evaluateCourseraCapture(capture).complete,false);
 const workbook=captureStructureWorkbook(capture);
 assert.equal(workbook.proof.independentWorkbook,false);assert.equal(workbook.proof.contentItemCount,1);
 assert.deepEqual(captureStructureEvidence(capture),workbook.proof);
});
test('verified native shell evidence retains unsupported source types without assigning a comparison content type',()=>{
 for(const type of ['programming','ungradedLab','gradedLti','futureQuiz','ungradedWidgetFuture','constructor']) {
  const capture=captureFixture(type), proof=captureStructureEvidence(capture);
  assert.equal(proof.contentItemCount,1);assert.equal(proof.completeContent,false);
  assert.deepEqual(proof.nativeHierarchy.at(-1),{
   id:'reading_1',title:'Reading',kind:'item',ancestorIds:['module_1'],emptyContainer:false,sourceContentType:type
  });
  assert.throws(()=>captureStructureWorkbook(capture),/unsupported type.*matching Coursera XLSX/);
 }
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
test('native shell projection retains empty modules and lessons, current names and repeated identities without inventing content',()=>{
 const capture=shellCaptureFixture(), workbook=captureStructureWorkbook(capture);
 const rows=readWorkbook(workbook.bytes,workbook.name).sheets.Inventory.values;
 assert.deepEqual(rows.filter(row=>row[0]==='***Name').map(row=>[row[1],row[7]]),[
  ['Module 1','module_1'],['Explore','empty_lesson'],['Archive','empty_module'],['Module 1','module_2']
 ]);
 assert.deepEqual(rows.filter(row=>row[0]==='Reading').map(row=>[row[1],row[7]]),[
  ['Current reading title','reading_1'],['Current reading title','reading_2']
 ]);
 const proof=workbook.proof;
 assert.equal(proof.inventoryEntryCount,4);assert.equal(proof.contentItemCount,2);
 assert.equal(proof.moduleCount,3);assert.equal(proof.lessonCount,1);assert.equal(proof.emptyContainerCount,2);
 assert.deepEqual(proof.nativeHierarchy.map(n=>[n.id,n.kind,n.ancestorIds,n.emptyContainer]),[
  ['module_1','module',[],false],['reading_1','item',['module_1'],false],
  ['empty_lesson','lesson',['module_1'],true],['empty_module','module',[],true],
  ['module_2','module',[],false],['reading_2','item',['module_2'],false]
 ]);
 assert.equal(capture.meta.directDataCapture.materials.elements[0].material.elements[0].originalName,'Old module title');
 assert(!rows.some(row=>row[1]==='Old module title'||row[1]==='Old reading title'));
 assert.equal(proof.completeContent,false);assert.equal(proof.independentWorkbook,false);
});
test('empty native headings retain shell evidence while the comparison still contains only content items',()=>{
 const input=comparisonFixture();delete input.excel;input.json={name:'native-shell.json',bytes:encode(shellCaptureFixture())};
 const output=createWorkflows(workerXml).compare(input);
 assert.equal(output.result.success,true);
 assert.equal(output.result.structuralInventoryBasis.emptyContainerCount,2);
 assert.equal(output.result.structuralInventoryBasis.nativeHierarchy.length,6);
 assert.deepEqual(output.result.nativeCourseOutlineEvidence,output.result.structuralInventoryBasis);
 const ids=output.result.ownerView.items.map(item=>item.id);
 assert.deepEqual(ids,['reading_1','reading_2']);
 assert(!ids.includes('empty_module'));assert(!ids.includes('empty_lesson'));
});
test('native workbook context cannot assign direct module items to a preceding empty Archive or completed lesson',()=>{
 const capture=contextCaptureFixture(), input=comparisonFixture();delete input.excel;
 input.json={name:'native-context.json',bytes:encode(capture)};
 const output=createWorkflows(workerXml).compare(input);
 assert.equal(output.result.success,true);
 const items=output.result.ownerView.items;
 assert.deepEqual(items.map(item=>[item.id,item.path,item.lesson||'']),[
  ['reading_1','Module 1',''],['reading_2','Module 1','Repeated lesson'],
  ['reading_3','Module 1',''],['reading_4','Module 1','Repeated lesson'],['reading_5','Module 1','']
 ]);
 const tasks=buildOwnerTasks(output.result,[], '',output.contentEvidence.coursera);
 const destination=tasks.filter(task=>!task.sourceOnly);
 assert.deepEqual(destination.map(task=>task.path),[
  'Module 1','Module 1 > Repeated lesson','Module 1','Module 1 > Repeated lesson','Module 1'
 ]);
 assert(destination.every(task=>ownerScope(task).included));
 assert.deepEqual(output.result.nativeCourseOutlineEvidence.nativeHierarchy.filter(n=>n.kind==='item').map(n=>[n.id,n.ancestorIds]),[
  ['reading_1',['module_1']],['reading_2',['module_1','lesson_1']],['reading_3',['module_1']],
  ['reading_4',['module_1','lesson_2']],['reading_5',['module_2']]
 ]);
});
test('an independent workbook keeps its authority while the capture retains a separate full native shell outline',()=>{
 const input=comparisonFixture();input.json={name:'native-shell.json',bytes:encode(shellCaptureFixture())};
 const output=createWorkflows(workerXml).compare(input);
 assert.equal(output.result.success,true);
 assert.equal(output.hashes.derivedStructure,undefined);
 assert.equal(output.result.structuralInventoryBasis,undefined);
 assert.equal(output.result.nativeCourseOutlineEvidence.contentItemCount,2);
 assert.equal(output.result.nativeCourseOutlineEvidence.emptyContainerCount,2);
 assert.deepEqual(output.result.nativeCourseOutlineEvidence.nativeHierarchy.map(n=>n.id),[
  'module_1','reading_1','empty_lesson','empty_module','module_2','reading_2'
 ]);
 assert.notEqual(output.result.inputCoherence?.status,'VERIFIED_CAPTURE_INVENTORY');
 assert.match(output.result.stats.source,/Excel/);
});
test('native outline evidence keeps unsupported native kinds literal beside an independent workbook',()=>{
 const input=comparisonFixture();input.json={name:'native-unsupported.json',bytes:encode(captureFixture('futureQuiz'))};
 const output=createWorkflows(workerXml).compare(input);
 assert.equal(output.result.success,true);
 assert.equal(output.result.nativeCourseOutlineEvidence.nativeHierarchy.at(-1).sourceContentType,'futureQuiz');
 assert.equal(output.result.structuralInventoryBasis,undefined);
});
test('legacy and unstable captures do not acquire a fabricated verified native shell outline',()=>{
 const legacy=createWorkflows(workerXml).compare(comparisonFixture());
 assert.equal(legacy.result.nativeCourseOutlineEvidence,undefined);
 const input=comparisonFixture(), capture=shellCaptureFixture();
 capture.meta.directDataCapture.sourceStable=false;
 input.json={name:'unstable-shell.json',bytes:encode(capture)};
 const output=createWorkflows(workerXml).compare(input);
 assert.equal(output.result.nativeCourseOutlineEvidence,undefined);
 assert(output.result.workspaceWarnings.some(w=>/native course outline.*unavailable/.test(w)));
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
