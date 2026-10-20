import { bindDirectIdentityV1 } from "./direct-data-models.js";

export const CTI_DIRECT_READING_QUERY_V1 = "query ItemAuthoringFrameworkData($atomId:ID!){ItemAuthoring{queryAuthoringItemByAtomId(atomId:$atomId){id atomId itemType draftItemContent{...Reading}publishedItemContent{...Reading}}queryParentBranchByAtomId(atomId:$atomId){edges{node{id courseId isAtomAtLatestVersion}}}}}fragment Reading on ItemPlatform_ReadingContent{__typename name timeCommitment content{__typename cmlValue dtdId}}";

/** Allowlist the requested response fields before persistence. No generic
 * GraphQL execution or editing/private configuration is exposed. */
export function directReadingResponseV1(value, id) {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] ||
      (value[0].errors != null && (!Array.isArray(value[0].errors) || value[0].errors.length))) return null;
  const data=value[0].data?.ItemAuthoring, i=data?.queryAuthoringItemByAtomId, p=data?.queryParentBranchByAtomId;
  if (i?.id !== id || i.atomId !== id || !Object.hasOwn(i,"draftItemContent") ||
      !Object.hasOwn(i,"publishedItemContent") || !Array.isArray(p?.edges) || p.edges.length>100) return null;
  const pick=(v,keys)=>Object.fromEntries(keys.split(",").filter(k=>Object.hasOwn(v || {},k)).map(k=>[k,v[k]])),
    body=v=>v===null ? null : {...pick(v,"__typename,name,timeCommitment"),
      ...(v?.content ? {content:pick(v.content,"__typename,cmlValue,dtdId")} : {})};
  return [{data:{ItemAuthoring:{
    queryAuthoringItemByAtomId:{...pick(i,"id,atomId,itemType"),
      draftItemContent:body(i.draftItemContent),publishedItemContent:body(i.publishedItemContent)},
    queryParentBranchByAtomId:{edges:p.edges.map(edge=>({node:pick(edge?.node,"id,courseId,isAtomAtLatestVersion")}))}}}}];
}

/** A bound current published observation is separate from a historical version
 * and from whole-item completeness. The bounded reader owns HTTP receipts and
 * mandatory sanitization before this deterministic content projection. */
export function directReadingContentV1(value, ctx) {
  try {
    const {item:i, material:m, atomData:a, relationData:r, courseId, courseSlug} = ctx;
    const {atom}=bindDirectIdentityV1(i,courseId,courseSlug,a,r);
    if (i.typeName !== "supplement" || ["id","atomId","contentId"].some(key=>m?.[key]!==i[key]) ||
        m.content?.typeName !== i.typeName || m.published !== true ||
        a.paging?.next != null || r.paging?.next != null ||
        atom.status?.typeName !== "publishedAtomStatus" || atom.published?.content?.typeName !== "reading") return null;
    const data=directReadingResponseV1(value,i.atomId)[0].data.ItemAuthoring,
      s=data.queryAuthoringItemByAtomId, body=s.publishedItemContent,
      all=data.queryParentBranchByAtomId.edges.filter(edge=>edge.node.courseId===courseId),node=all[0]?.node;
    if (s.itemType!=="READING" || all.length!==1 || node.id !== courseId || node.isAtomAtLatestVersion !== true ||
        body?.__typename !== "ItemPlatform_ReadingContent" || typeof body.name !== "string" ||
        typeof body.timeCommitment !== "string" || body.content?.__typename !== "CmlContent" ||
        body.content.dtdId !== "assess/1" || typeof body.content.cmlValue !== "string") return null;
    // Allowlist only observed instructional/source fields. Editing tokens,
    // permissions and unrelated GraphQL data never enter the returned model.
    return {...s,courseId,itemId:i.id,parentBranch:node};
  } catch (_) {return null;}
}
