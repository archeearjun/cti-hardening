import test from 'node:test';
import assert from 'node:assert/strict';
import {directPublishedReadingObservationV1} from '../src/extractors/coursera/direct-data-published-reading.js';
import {sanitizeCourseraCourseDataModel} from '../src/extractors/coursera/direct-data-privacy.js';

// Mirrors the reported array-wrapped SekFW response, with synthetic identities/text.
function fixture(){
 const courseId='Synthetic_course',courseSlug='synthetic-course',id='Read1',atomId='R'.repeat(22),contentId='atom~'+atomId;
 const item={id,atomId,contentId,typeName:'supplement'},material={...item,published:true,content:{typeName:'supplement'}};
 const context={item,material,courseId,courseSlug,atomData:{elements:[{id:atomId,contentId,status:{typeName:'publishedAtomStatus'},published:{content:{typeName:'reading'}}}]},
 relationData:{elements:[{id:atomId,atomId,branchRelationMap:{[courseId+'~'+id]:{courseId,courseSlug,itemId:id}}}]}};
 const response=[{data:{ItemAuthoring:{__typename:'ItemAuthoringQueries',queryAuthoringItemByAtomId:{__typename:'ItemPlatform_AuthoringItem',id:atomId,atomId,itemType:'READING',draftItemContent:null,
 publishedItemContent:{__typename:'ItemPlatform_ReadingContent',name:'Synthetic welcome',timeCommitment:'PT5M',content:{__typename:'CmlContent',cmlValue:'<co-content><text>Exact café &amp; text.</text></co-content>',dtdId:'assess/1'}}},
 queryParentBranchByAtomId:{__typename:'ItemAuthoring_ItemParentBranchConnection',edges:[{node:{__typename:'ItemAuthoring_ItemParentBranch',id:courseId,courseId,isAtomAtLatestVersion:true}}]}}}}];
 const receipt={operationName:'ItemAuthoringFrameworkData',status:200,observedAt:'2026-10-20T12:00:00Z',originalResponseSha256:'a'.repeat(64)};
 return {response,context,receipt};
}
test('published reading preserves exact typed CML, title, duration and null draft with separate identities',()=>{
 const f=fixture(),before=JSON.stringify(f),result=directPublishedReadingObservationV1(f.response,f.context,f.receipt);
 assert(result);assert.deepEqual(JSON.parse(JSON.stringify(result.publishedItemContent)),f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId.publishedItemContent);
 assert.equal(result.draftItemContent,null);assert.equal(result.itemId,'Read1');assert.equal(result.atomId,'R'.repeat(22));
 assert.equal(result.parentBranch.isAtomAtLatestVersion,true);assert.equal(result.historicalVersionId,null);assert.equal(result.wholeItemVerified,false);
 assert.deepEqual(JSON.parse(JSON.stringify(result.receipt)),f.receipt);assert.equal(JSON.stringify(f),before);
});
test('foreign identities, unpublished state, ambiguous parents, errors and draft bodies cannot masquerade as this published contract',()=>{
 for(const mutate of [f=>f.context.item.id='Other',f=>f.context.material.published=false,
 f=>f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId.atomId='X'.repeat(22),
 f=>f.context.relationData.elements[0].branchRelationMap={},f=>f.receipt.status=403,
 f=>f.response[0].errors=[{message:'partial response'}],
 f=>f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId.draftItemContent={},
 f=>f.response[0].data.ItemAuthoring.queryParentBranchByAtomId.edges[0].node.isAtomAtLatestVersion=false,
 f=>f.response[0].data.ItemAuthoring.queryParentBranchByAtomId.edges.push(f.response[0].data.ItemAuthoring.queryParentBranchByAtomId.edges[0])]){
 const f=fixture();mutate(f);assert.equal(directPublishedReadingObservationV1(f.response,f.context,f.receipt),null);
 }
});
test('editing credentials and permission data are excluded, including conflict tokens in shared sanitization',()=>{
 const f=fixture(),source=f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId;
 source.conflictDetectionToken='synthetic-conflict';source.permissions={secret:'synthetic-permission'};source.writeAccessToken='synthetic-write';
 const result=directPublishedReadingObservationV1(f.response,f.context,f.receipt);
 assert(result);assert(!/synthetic-conflict|synthetic-permission|synthetic-write|permissions|Token/.test(JSON.stringify(result)));
 assert(!JSON.stringify(sanitizeCourseraCourseDataModel(f.response).data).includes('synthetic-conflict'));
});
