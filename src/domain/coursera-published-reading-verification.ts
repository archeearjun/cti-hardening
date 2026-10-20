import { directReadingContentV1, CTI_DIRECT_READING_QUERY_V1 } from "../extractors/coursera/direct-data-published-reading.js";
import { directCmlMediaInventoryV1 } from "../extractors/coursera/direct-data-media-contracts.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { sanitizeCourseraCourseDataModel } from "../extractors/coursera/direct-data-privacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Independently reconstruct the published binding; never trust a saved stable
 * or wholeItemVerified flag. Only text-only CML has a supported complete rule. */
export function publishedReadingVerified(item: any, material: any, courseId: string, courseSlug: string): boolean {
  try {
    const p=item.payload, e=p.directPublishedReadingEvidence, s=e.sources;
    const same=(a: any,b: any)=>directCanonicalSourceTextV1(a)===directCanonicalSourceTextV1(b);
    const digest=(text: string)=>bytesToHex(sha256(new TextEncoder().encode(text)));
    if (e.method!=="BOUND_PUBLISHED_READING_GRAPHQL" || e.stable!==true || e.wholeItemVerified!==true ||
        !same(s.material,material) || !same(s.atom,s.atomFinal) || !same(e.initial.model,e.final.model)) return false;
    const clean=sanitizeCourseraCourseDataModel(e);
    if (clean.limitReached || !same(clean.data,e)) return false;
    const receipt=(r: any)=>r?.status===200 && r.bodyFormat==="PARSED_SANITIZED_JSON_MODEL" &&
      /^[a-f0-9]{64}$/.test(r.originalResponseSha256 || "") && (!r.sha256 || r.sha256===r.originalResponseSha256) &&
      Number.isFinite(Date.parse(r.observedAt)) && r.id===item.atomId;
    for (const [key,resource] of [["atom","authoringAtoms.v2"],["relation","authoringItemContentRelations.v1"],["atomFinal","authoringAtoms.v2"]]) {
      const r=s.receipts[key];
      if (!receipt(r) || r.resource!==resource || r.requestPath!=="/api/"+resource+"/"+item.atomId) return false;
    }
    for (const observation of [e.initial,e.final]) {
      const r=observation.receipt, model=observation.model;
      if (!receipt(r) || r.resource!=="ItemAuthoringFrameworkData" || r.method!=="POST" ||
          r.requestPath!=="/graphql-gateway" || r.requestDocument!==CTI_DIRECT_READING_QUERY_V1 ||
          !same(r.variables,{atomId:item.atomId}) || !same(r.requestQuery,[["opname","ItemAuthoringFrameworkData"]])) return false;
      const response=[{data:{ItemAuthoring:{queryAuthoringItemByAtomId:model,
        queryParentBranchByAtomId:{edges:[{node:model.parentBranch}]}}}}];
      const bound=directReadingContentV1(response,{item,material,courseId,courseSlug,atomData:s.atom,relationData:s.relation});
      if (!bound || !same(bound,model)) return false;
    }
    const times=[s.receipts.atom,e.initial.receipt,e.final.receipt,s.receipts.atomFinal].map(r=>Date.parse(r.observedAt));
    if (times.some((time,index)=>index>0 && time<times[index-1])) return false;
    const cml=e.initial.model.publishedItemContent.content.cmlValue, parsed=directCmlMediaInventoryV1(cml,2);
    return parsed.valid && parsed.references.length===0 && p.textSample===parsed.text &&
      p.textLength===parsed.text.length && p.textSha256===digest(parsed.text) &&
      p.textCaptureTruncated===false && p.textScopeKind==="bound-current-published-cml";
  } catch { return false; }
}
