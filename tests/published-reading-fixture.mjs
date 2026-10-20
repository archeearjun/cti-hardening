import {CTI_DIRECT_READING_QUERY_V1} from "../src/extractors/coursera/direct-data-published-reading.js";
// Mirrors the reported array-wrapped SekFW response, with synthetic identities/text.
export function publishedReadingFixture(){
 const courseId='Synthetic_course',courseSlug='synthetic-course',id='Read1',atomId='R'.repeat(22),contentId='atom~'+atomId;
 const item={id,atomId,contentId,typeName:'supplement'},material={...item,published:true,content:{typeName:'supplement',definition:{}}};
 const context={item,material,courseId,courseSlug,atomData:{elements:[{id:atomId,contentId,status:{typeName:'publishedAtomStatus'},published:{content:{typeName:'reading'}}}]},
 relationData:{elements:[{id:atomId,atomId,branchRelationMap:{[courseId+'~'+id]:{courseId,courseSlug,itemId:id}}}]}};
 const response=[{data:{ItemAuthoring:{__typename:'ItemAuthoringQueries',queryAuthoringItemByAtomId:{__typename:'ItemPlatform_AuthoringItem',id:atomId,atomId,itemType:'READING',draftItemContent:null,
 publishedItemContent:{__typename:'ItemPlatform_ReadingContent',name:'Synthetic welcome',timeCommitment:'PT5M',content:{__typename:'CmlContent',cmlValue:'<co-content><text>Exact café &amp; text.</text></co-content>',dtdId:'assess/1'}}},
 queryParentBranchByAtomId:{__typename:'ItemAuthoring_ItemParentBranchConnection',edges:[{node:{__typename:'ItemAuthoring_ItemParentBranch',id:courseId,courseId,isAtomAtLatestVersion:true}}]}}}}];
 const receipt={resource:'ItemAuthoringFrameworkData',method:'POST',id:atomId,variables:{atomId},requestDocument:CTI_DIRECT_READING_QUERY_V1,requestPath:'/graphql-gateway',requestQuery:[['opname','ItemAuthoringFrameworkData']],bodyFormat:'PARSED_SANITIZED_JSON_MODEL',operationName:'ItemAuthoringFrameworkData',status:200,observedAt:'2026-10-20T12:00:00Z',originalResponseSha256:'a'.repeat(64)};
 return {response,context,receipt};
}
