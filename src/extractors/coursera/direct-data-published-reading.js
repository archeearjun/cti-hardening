import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import { sanitizeCourseraCourseDataModel } from "./direct-data-privacy.js";

/** Response-only adapter for the observed ItemAuthoringFrameworkData shape.
 * No GraphQL document, variables, historical revision or network request is
 * inferred here. Source-bound content still needs live acquisition/stability
 * checks before it can enter any complete-item contract. */
export function directPublishedReadingObservationV1(response, context, receipt) {
  try {
    const {item, material, atomData, relationData, courseId, courseSlug} = context;
    if (!item || !/^[A-Za-z0-9_-]{22}$/.test(item.atomId || "") ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(item.id || "") ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(courseId || "") || !courseSlug ||
        item.contentId !== "atom~" + item.atomId || item.typeName !== "supplement" ||
        material?.id !== item.id || material.atomId !== item.atomId || material.contentId !== item.contentId ||
        material.content?.typeName !== item.typeName || material.published !== true ||
        atomData?.elements?.length !== 1 || relationData?.elements?.length !== 1 ||
        atomData.paging?.next != null || relationData.paging?.next != null) return null;
    const atom=atomData.elements[0], relation=relationData.elements[0],
      branch=relation?.branchRelationMap?.[courseId+"~"+item.id];
    if (atom?.id !== item.atomId || atom.contentId !== item.contentId ||
        atom.status?.typeName !== "publishedAtomStatus" || atom.published?.content?.typeName !== "reading" ||
        relation?.id !== item.atomId || relation.atomId !== item.atomId ||
        branch?.itemId !== item.id || branch.courseId !== courseId || branch.courseSlug !== courseSlug ||
        receipt?.operationName !== "ItemAuthoringFrameworkData" || receipt.status !== 200 ||
        !Number.isFinite(Date.parse(receipt.observedAt)) || !/^[a-f0-9]{64}$/.test(receipt.originalResponseSha256 || "")) return null;
    if (!Array.isArray(response) || response.length !== 1 || response[0]?.errors?.length) return null;
    const data=response[0]?.data?.ItemAuthoring,
      source=data?.queryAuthoringItemByAtomId, parent=data?.queryParentBranchByAtomId,
      reading=source?.publishedItemContent;
    if (data?.__typename !== "ItemAuthoringQueries" || source?.__typename !== "ItemPlatform_AuthoringItem" ||
        source.id !== item.atomId || source.atomId !== item.atomId || source.itemType !== "READING" ||
        !Object.hasOwn(source,"draftItemContent") || source.draftItemContent !== null ||
        parent?.__typename !== "ItemAuthoring_ItemParentBranchConnection" ||
        !Array.isArray(parent.edges) || parent.edges.length > 100 ||
        parent.edges.filter(edge=>edge?.node?.courseId === courseId).length !== 1) return null;
    const node=parent.edges.find(edge=>edge?.node?.courseId === courseId).node;
    if (node.__typename !== "ItemAuthoring_ItemParentBranch" || node.id !== courseId || node.isAtomAtLatestVersion !== true ||
        reading?.__typename !== "ItemPlatform_ReadingContent" || typeof reading.name !== "string" ||
        typeof reading.timeCommitment !== "string" || reading.content?.__typename !== "CmlContent" ||
        reading.content.dtdId !== "assess/1" || typeof reading.content.cmlValue !== "string") return null;
    // Allowlist only observed instructional/source fields. Editing tokens,
    // permissions and unrelated GraphQL data never enter the returned model.
    const selected={sourceState:"OBSERVED_CURRENT_PUBLISHED_BODY",scope:"PUBLISHED_READING_RESPONSE_ONLY",
      courseId,itemId:item.id,atomId:item.atomId,contentId:item.contentId,
      binding:{courseSlug,relationKey:courseId+"~"+item.id,materialPublished:true,
        nativeAtomStatus:atom.status.typeName,nativePublishedContentType:atom.published.content.typeName},
      draftItemContent:null,publishedItemContent:{__typename:reading.__typename,name:reading.name,
        timeCommitment:reading.timeCommitment,content:{__typename:reading.content.__typename,
          cmlValue:reading.content.cmlValue,dtdId:reading.content.dtdId}},
      parentBranch:{id:node.id,courseId:node.courseId,isAtomAtLatestVersion:true},
      receipt:{operationName:receipt.operationName,status:receipt.status,observedAt:receipt.observedAt,
        originalResponseSha256:receipt.originalResponseSha256},
      historicalVersionId:null,wholeItemVerified:false};
    const clean=sanitizeCourseraCourseDataModel(selected);
    return clean.limitReached || directCanonicalSourceTextV1(clean.data)!==directCanonicalSourceTextV1(selected) ? null : clean.data;
  } catch (_) {return null;}
}
