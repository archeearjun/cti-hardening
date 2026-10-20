import test from 'node:test';
import assert from 'node:assert/strict';
import {directReadingObservationV1} from '../src/extractors/coursera/direct-data-published-reading.js';
import {sanitizeCourseraCourseDataModel} from '../src/extractors/coursera/direct-data-privacy.js';

import {publishedReadingFixture as fixture} from './published-reading-fixture.mjs';
test('published reading preserves exact typed CML, title, duration and null draft with separate identities',()=>{
 const f=fixture(),before=JSON.stringify(f),result=directReadingObservationV1(f.response,f.context,f.receipt);
 assert(result);assert.deepEqual(JSON.parse(JSON.stringify(result.publishedItemContent)),f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId.publishedItemContent);
 assert.equal(result.draftItemContent,null);assert.equal(result.itemId,'Read1');assert.equal(result.atomId,'R'.repeat(22));
 assert.equal(result.parentBranch.isAtomAtLatestVersion,true);assert.equal(result.historicalVersionId,undefined);assert.equal(result.wholeItemVerified,false);
 assert.equal(JSON.stringify(f),before);
});
test('foreign identities, unpublished state, ambiguous parents, errors and draft bodies cannot masquerade as this published contract',()=>{
 for(const mutate of [f=>f.context.item.id='Other',f=>f.context.material.published=false,
 f=>f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId.atomId='X'.repeat(22),
 f=>f.context.relationData.elements[0].branchRelationMap={},f=>f.receipt.status=403,
 f=>f.response[0].errors=[{message:'partial response'}],
 f=>delete f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId.draftItemContent,
 f=>f.response[0].data.ItemAuthoring.queryParentBranchByAtomId.edges[0].node.isAtomAtLatestVersion=false,
 f=>f.response[0].data.ItemAuthoring.queryParentBranchByAtomId.edges.push(f.response[0].data.ItemAuthoring.queryParentBranchByAtomId.edges[0])]){
 const f=fixture();mutate(f);assert.equal(directReadingObservationV1(f.response,f.context,f.receipt),null);
 }
});
test('editing credentials and permission data are excluded, including conflict tokens in shared sanitization',()=>{
 const f=fixture(),source=f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId;
 source.conflictDetectionToken='synthetic-conflict';source.permissions={secret:'synthetic-permission'};source.writeAccessToken='synthetic-write';
 const result=directReadingObservationV1(f.response,f.context,f.receipt);
 assert(result);assert(!/synthetic-conflict|synthetic-permission|synthetic-write|permissions|Token/.test(JSON.stringify(result)));
 assert(!JSON.stringify(sanitizeCourseraCourseDataModel(f.response).data).includes('synthetic-conflict'));
});

test('an attached draft remains distinct from published content and never substitutes for a missing published body',()=>{
 const f=fixture(),source=f.response[0].data.ItemAuthoring.queryAuthoringItemByAtomId;
 source.draftItemContent=structuredClone(source.publishedItemContent);source.draftItemContent.content.cmlValue='';
 let result=directReadingObservationV1(f.response,f.context,f.receipt);assert(result);
 assert.equal(result.draftItemContent.content.cmlValue,'');assert.notEqual(result.publishedItemContent.content.cmlValue,'');
 source.publishedItemContent=null;assert.equal(directReadingObservationV1(f.response,f.context,f.receipt),null);
});
