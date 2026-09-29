// Maintained source: explicit dependencies; no ordered concatenation.
import { qaCleanName_ } from "../matching/text.js";
import { qaNormalizeIngestionClaimScope_ } from "../provenance/claims.js";

export function qaHexDigest_(bytes) {
  return (bytes || []).map(function(b) {
    var v = b < 0 ? b + 256 : b;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

export function create_qaSha256Base64_(services) {
const {Utilities} = services;
return function qaSha256Base64_(base64Value) {
  if (!base64Value) return '';
  try {
    var bytes = Utilities.base64Decode(base64Value);
    return qaHexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  } catch (e) { return ''; }
};
}

export function qaCompactIngestionIntelligence_(intel) {
  intel = intel && typeof intel === 'object' ? intel : {};
  var claims = Array.isArray(intel.claims) ? intel.claims.slice(0,220).map(function(c){
    return {
      type:String(c.type || ''), subject:String(c.subject || ''), target:String(c.target || ''),
      excerpt:String(c.excerpt || '').slice(0,560), confidence:Number(c.confidence || 0),
      detail:String(c.detail || '').slice(0,560), pathHint:String(c.pathHint || '').slice(0,300),
      context:String(c.context || '').slice(0,700), severity:String(c.severity || ''),
      remediation:String(c.remediation || '').slice(0,560),
      originalClaimType:String(c.originalClaimType || ''), originalClaimSubject:String(c.originalClaimSubject || ''),
      classificationReason:String(c.classificationReason || '').slice(0,560)
    };
  }) : [];
  var counts = {};
  claims.forEach(function(c){ if(c.type) counts[c.type] = (counts[c.type] || 0) + 1; });
  return {
    detected:claims.length > 0 || intel.detected === true,
    parserVersion:String(intel.parserVersion || 'smart-ingestion-provenance-v2'),
    reportCount:Number(intel.reportCount || 0),
    reportItems:Array.isArray(intel.reportItems) ? intel.reportItems.slice(0,20) : [],
    claims:claims,
    categoryCounts:counts,
    criticalClaims:claims.filter(function(c){return c.severity === 'CRITICAL';}).slice(0,60),
    reviewClaims:claims.filter(function(c){return c.severity === 'REVIEW';}).slice(0,80),
    generatedFieldMentions:Number(intel.generatedFieldMentions || 0),
    contentAdaptationMentions:Number(intel.contentAdaptationMentions || 0),
    emptyModuleMentions:Number(intel.emptyModuleMentions || 0),
    reportTextLength:Number(intel.reportTextLength || 0),
    trustModel:String(intel.trustModel || 'CLAIM_PLUS_OBSERVATION'),
    note:String(intel.note || '')
  };
}

export function qaMergeGenerationIngestionIntelligence_(currentIntel, inheritedIntel, sourceRunId) {
  currentIntel = qaCompactIngestionIntelligence_(currentIntel || {});
  inheritedIntel = qaCompactIngestionIntelligence_(inheritedIntel || {});
  var claims = [], seen = Object.create(null);
  function addClaim(c, origin) {
    if (!c) return;
    c = qaNormalizeIngestionClaimScope_(c);
    var key = [String(c.type||''),qaCleanName_(c.subject||''),qaCleanName_(c.target||''),qaCleanName_(c.pathHint||''),String(c.excerpt||'').toLowerCase()].join('|');
    if (!key || seen[key]) return;
    seen[key] = true;
    var clone = Object.assign({}, c);
    clone.provenanceOrigin = origin;
    claims.push(clone);
  }
  (currentIntel.claims || []).forEach(function(c){ addClaim(c,'CURRENT_SNAPSHOT'); });
  (inheritedIntel.claims || []).forEach(function(c){ addClaim(c,'EVIDENCE_MEMORY'); });
  var counts = {};
  claims.forEach(function(c){ if(c.type) counts[c.type]=(counts[c.type]||0)+1; });
  var inheritedCount = claims.filter(function(c){return c.provenanceOrigin === 'EVIDENCE_MEMORY';}).length;
  var currentCount = claims.length - inheritedCount;
  return {
    detected:claims.length > 0,
    parserVersion:'smart-ingestion-provenance-v2+generation-memory-v1',
    reportCount:Number(currentIntel.reportCount || 0),
    reportItems:currentIntel.reportItems || [],
    claims:claims,
    categoryCounts:counts,
    criticalClaims:claims.filter(function(c){return c.severity === 'CRITICAL';}).slice(0,60),
    reviewClaims:claims.filter(function(c){return c.severity === 'REVIEW';}).slice(0,80),
    generatedFieldMentions:Math.max(Number(currentIntel.generatedFieldMentions||0),Number(inheritedIntel.generatedFieldMentions||0)),
    contentAdaptationMentions:Math.max(Number(currentIntel.contentAdaptationMentions||0),Number(inheritedIntel.contentAdaptationMentions||0)),
    emptyModuleMentions:Math.max(Number(currentIntel.emptyModuleMentions||0),Number(inheritedIntel.emptyModuleMentions||0)),
    reportTextLength:Number(currentIntel.reportTextLength || 0),
    trustModel:'CLAIM_PLUS_OBSERVATION',
    provenanceMemory:{
      inherited:inheritedCount > 0,
      inheritedClaimCount:inheritedCount,
      currentClaimCount:currentCount,
      sourceRunId:String(sourceRunId || ''),
      reason:inheritedCount ? 'Smart Ingestion provenance was inherited from an earlier QA snapshot in the same import generation so deleting the [DELETE ME] Author Alignment Report during cleanup does not erase ingestion history.' : ''
    },
    note:claims.length ? 'Smart Ingestion provenance is generation-scoped. Current Author Alignment Report claims and durable same-generation Evidence Memory claims are reconciled with independent CTI evidence.' : ''
  };
}

export function qaPhysicalDestinationIds_(items) {
  var ids=[];
  (Array.isArray(items)?items:[]).forEach(function(item){
    var id=String(item && item.courseraId || '').trim();
    var family=item && item.checks && item.checks.transformationFamily;
    var refs=/^cti-aggregate:/.test(id) ? (family && Array.isArray(family.childIds)?family.childIds:[]) : [id];
    refs.forEach(function(ref){var value=String(ref||'').trim();if(value && !/^cti-aggregate:/.test(value) && ids.indexOf(value)<0)ids.push(value);});
  });
  return ids;
}

export function qaObsoleteAggregateStageGuard_(result, baseline, priorNonRaw) {
  // Repair only the documented synthetic-ID false positive. Keep the saved raw
  // baseline and genuine later-stage observations immutable.
  var ctx=result && result.snapshotContext || {};
  if(priorNonRaw || !ctx.stageGuardApplied || ctx.originalMode!=='RAW_INGESTION')return false;
  var reason=String(ctx.stageGuardReason||'');
  var m=reason.match(/^(?:a later-stage QA snapshot already exists in this same Smart Ingestion generation; )?(\d+) destination item\(s\) that existed in the canonical raw baseline are absent now$/);
  if(!m)return false;
  var synthetic=(baseline||[]).filter(function(x){return /^cti-aggregate:/.test(String(x.courseraId||''));});
  if(!synthetic.length || synthetic.some(function(x){return !qaPhysicalDestinationIds_([x]).length;}))return false;
  var seen=qaPhysicalDestinationIds_(result.itemResults||[]);
  var required=qaPhysicalDestinationIds_(baseline);
  if(!required.length || required.some(function(id){return seen.indexOf(id)<0;}))return false;
  var legacyMissing=[];
  (baseline||[]).forEach(function(x){var id=String(x.courseraId||'').trim();if(id && seen.indexOf(id)<0 && legacyMissing.indexOf(id)<0)legacyMissing.push(id);});
  return legacyMissing.length===Number(m[1]) && legacyMissing.every(function(id){return /^cti-aggregate:/.test(id);});
}

export function qaIsExactRawEvidenceReplay_(generationContext, inputIdentity) {
  var saved=generationContext && generationContext.rawBaselineEvidence || {}, incoming=inputIdentity || {};
  if(saved.hasReadingRecovery || incoming.hasReadingRecovery)return false;
  return ['excelSha256','jsonSha256'].every(function(key){
    return /^[a-f0-9]{64}$/i.test(String(saved[key]||'')) &&
      String(saved[key]).toLowerCase()===String(incoming[key]||'').toLowerCase();
  });
}
