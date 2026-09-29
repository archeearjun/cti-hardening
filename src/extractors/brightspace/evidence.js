import { sameOrigin } from "./text-and-dom.js";

export function topicEvidencePolicy(activityType, url) {
    const n = Number(activityType);
    // Tool pages can render class/attempt/submission UI even when the definition itself is safe.
    // Their definitions are captured through the dedicated Brightspace APIs below, so never fetch
    // the rendered tool page. File/content pages remain eligible for same-origin evidence capture.
    if ([3,4,5,6,8,9,10,11,12,13,20,21,22,23,24,25,26,27,29].includes(n)) {
      return {fetch:false, status:'DEFINITION_API_ONLY', reason:'Dynamic/tool activity definition is collected from Brightspace APIs; rendered learner/activity pages are not fetched.'};
    }
    if (n === 2 || n === 7 || n === 14) {
      if (!url || !sameOrigin(url)) return {fetch:false, status:'EXTERNAL_NOT_FETCHED', reason:'External link/tool destination is recorded but never fetched.'};
    }
    return {fetch:!!url, status:url ? 'ELIGIBLE' : 'NO_URL', reason:''};
  }
