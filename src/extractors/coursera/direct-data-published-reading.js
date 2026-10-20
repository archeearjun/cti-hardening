import { bindDirectIdentityV1 } from "./direct-data-models.js";

export const CTI_DIRECT_READING_QUERY_V1 = "query ItemAuthoringFrameworkData($atomId:ID!){ItemAuthoring{queryAuthoringItemByAtomId(atomId:$atomId){id atomId itemType draftItemContent{...Reading}publishedItemContent{...Reading}}queryParentBranchByAtomId(atomId:$atomId){edges{node{id courseId isAtomAtLatestVersion}}}}}fragment Reading on ItemPlatform_ReadingContent{__typename name timeCommitment content{__typename cmlValue dtdId}}";

/** Allowlist the requested response fields before persistence. No generic
 * GraphQL execution or editing/private configuration is exposed. */
export function directReadingResponseV1(response, atomId) {
  if (!Array.isArray(response) || response.length !== 1 || !response[0] ||
      (response[0].errors != null && (!Array.isArray(response[0].errors) || response[0].errors.length))) return null;
  const data=response[0].data?.ItemAuthoring, item=data?.queryAuthoringItemByAtomId, parent=data?.queryParentBranchByAtomId;
  if (item?.id !== atomId || item.atomId !== atomId || !Object.hasOwn(item,"draftItemContent") ||
      !Object.hasOwn(item,"publishedItemContent") || !Array.isArray(parent?.edges) || parent.edges.length>100) return null;
  const pick=(value,keys)=>Object.fromEntries(keys.split(",").filter(key=>Object.hasOwn(value || {},key)).map(key=>[key,value[key]])),
    content=value=>value===null ? null : {...pick(value,"__typename,name,timeCommitment"),
      ...(value?.content ? {content:pick(value.content,"__typename,cmlValue,dtdId")} : {})};
  return [{data:{ItemAuthoring:{
    queryAuthoringItemByAtomId:{...pick(item,"id,atomId,itemType"),
      draftItemContent:content(item.draftItemContent),publishedItemContent:content(item.publishedItemContent)},
    queryParentBranchByAtomId:{edges:parent.edges.map(edge=>({node:pick(edge?.node,"id,courseId,isAtomAtLatestVersion")}))}}}}];
}

/** A bound current published observation is separate from a historical version
 * and from whole-item completeness. The bounded reader owns HTTP receipts and
 * mandatory sanitization before this deterministic content projection. */
export function directReadingContentV1(response, context) {
  try {
    const {item, material, atomData, relationData, courseId, courseSlug} = context;
    const {atom}=bindDirectIdentityV1(item,courseId,courseSlug,atomData,relationData);
    if (item.typeName !== "supplement" || ["id","atomId","contentId"].some(key=>material?.[key]!==item[key]) ||
        material.content?.typeName !== item.typeName || material.published !== true ||
        atomData.paging?.next != null || relationData.paging?.next != null ||
        atom.status?.typeName !== "publishedAtomStatus" || atom.published?.content?.typeName !== "reading") return null;
    const data=directReadingResponseV1(response,item.atomId)[0].data.ItemAuthoring,
      source=data.queryAuthoringItemByAtomId, reading=source.publishedItemContent,
      nodes=data.queryParentBranchByAtomId.edges.filter(edge=>edge.node.courseId===courseId),node=nodes[0]?.node;
    if (source.itemType!=="READING" || nodes.length!==1 || node.id !== courseId || node.isAtomAtLatestVersion !== true ||
        reading?.__typename !== "ItemPlatform_ReadingContent" || typeof reading.name !== "string" ||
        typeof reading.timeCommitment !== "string" || reading.content?.__typename !== "CmlContent" ||
        reading.content.dtdId !== "assess/1" || typeof reading.content.cmlValue !== "string") return null;
    // Allowlist only observed instructional/source fields. Editing tokens,
    // permissions and unrelated GraphQL data never enter the returned model.
    return {...source,courseId,itemId:item.id,parentBranch:node};
  } catch (_) {return null;}
}
