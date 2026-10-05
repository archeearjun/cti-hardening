// Maintained source: explicit dependencies; no ordered concatenation.
import { qaNormalizeIngestionFailure_, qaNormalizeNativeAssignment_, qaObservedEmptyAssessmentReceipt_, qaPayloadField_, qaReadingEvidenceGap_ } from "../assessment/assignment.js";
import { qaNormalizeAssessment_, qaParseCourseraAssignmentText_ } from "../assessment/questions.js";
import { nonNegativeInteger_ } from "../validation.js";
import { qaExternalLinks_, qaTypesCompatible_, qaUniqueAssetDescriptors_ } from "../matching/assets.js";
import { qaFindCrossItemPayloadEvidence_ } from "../matching/recovery.js";
import { fuzzyMatchScore_, normalizeCourseraType_, qaCleanText_, qaMatchTitleKey_, qaPathSimilarity_ } from "../matching/text.js";
import { qaClassifyExtraItem_ } from "../reporting/actions.js";
import { qaBuildRepackagedMissingResult_ } from "../source/brightspace-assessment.js";
import { qaMergeCourseraStructuredEvidence_ } from "../source/content.js";
import { workSourceItemPolicy_ } from "../work/policy.js";

export function normalizeCourseraItem_(item) {
    item = item || {};
    var payload = item.payload || {};
    var fileCandidates = [];
    (qaPayloadField_(payload,item,'assetDetails',[]) || []).forEach(function(value) { fileCandidates.push(value); });
    (qaPayloadField_(payload,item,'files',[]) || []).forEach(function(value) { fileCandidates.push(value); });
    (qaPayloadField_(payload,item,'images',[]) || []).forEach(function(value) { fileCandidates.push(value); });
    (qaPayloadField_(payload,item,'embeddedRefs',[]) || []).forEach(function(value) { fileCandidates.push(value); });

    var assetDetails = qaUniqueAssetDescriptors_(fileCandidates);
    var links = [];
    (qaPayloadField_(payload,item,'links',[]) || []).forEach(function(value) { links.push(value); });

    var published=qaPayloadField_(payload,item,'published',null);
    if (published !== true && published !== false) published = null;

    var assetEvidenceConfidence = Number(qaPayloadField_(payload,item,'assetEvidenceConfidence',0));
    if (!Number.isFinite(assetEvidenceConfidence) || assetEvidenceConfidence < 0) assetEvidenceConfidence = 0;
    if (assetEvidenceConfidence > 1) assetEvidenceConfidence = 1;

    var linkEvidenceConfidence = Number(qaPayloadField_(payload,item,'linkEvidenceConfidence',0));
    if (!Number.isFinite(linkEvidenceConfidence) || linkEvidenceConfidence < 0) linkEvidenceConfidence = 0;
    if (linkEvidenceConfidence > 1) linkEvidenceConfidence = 1;

    var textEvidenceCompleteness = Number(qaPayloadField_(payload,item,'textEvidenceCompleteness',0));
    if (!Number.isFinite(textEvidenceCompleteness) || textEvidenceCompleteness < 0) textEvidenceCompleteness = 0;
    if (textEvidenceCompleteness > 1) textEvidenceCompleteness = 1;

    var rawStructuredAssessment = qaPayloadField_(payload,item,'structuredAssessment',null);
    var normalizedTextForAssessment = qaCleanText_(qaPayloadField_(payload,item,'textSample',''));
    var normalizedTypeForAssessment = normalizeCourseraType_(item.type || item.typeName || payload.typeName);
    var structuredAssessment = (rawStructuredAssessment && typeof rawStructuredAssessment === 'object') ? rawStructuredAssessment : null;
    var rawReadingEvidence=qaPayloadField_(payload,item,'readingEditorEvidence',null);
    var rawTextScope=qaCleanText_(qaPayloadField_(payload,item,'textScopeKind',''));
    var rawTextReceipt=qaPayloadField_(payload,item,'textCaptureEvidence',null);
    var rawEmptyReceipt=qaPayloadField_(payload,item,'emptyEditorEvidence',null);
    var readingGap=qaReadingEvidenceGap_({id:String(item.id || item.itemId || ''),type:normalizedTypeForAssessment,textSample:normalizedTextForAssessment,textScopeKind:rawTextScope,readingEditorEvidence:rawReadingEvidence,textCaptureEvidence:rawTextReceipt,textCaptureTruncated:qaPayloadField_(payload,item,'textCaptureTruncated',false)});
    if(readingGap)textEvidenceCompleteness=Math.min(textEvidenceCompleteness,readingGap.code==='READING_STILL_LOADING'?0:readingGap.code==='DOCUMENT_PAGES_NOT_VERIFIED'?.60:.72);
    var rawCurrentState=qaPayloadField_(payload,item,'currentState',null);
    var rawTimeEstimate=qaPayloadField_(payload,item,'timeEstimateMinutes',null);
    var rawNativeAssignment = qaPayloadField_(payload,item,'nativeAssignment',null);
    var nativeAssignment = qaNormalizeNativeAssignment_(rawNativeAssignment);
    if(rawCurrentState && rawCurrentState.grading && nativeAssignment && rawNativeAssignment &&
       JSON.stringify(rawCurrentState.grading.submission || {})===JSON.stringify(rawNativeAssignment.submission || {}) &&
       JSON.stringify(rawCurrentState.grading.settings || {})===JSON.stringify(rawNativeAssignment.settings || {})) {
        rawCurrentState=JSON.parse(JSON.stringify(rawCurrentState));
        rawCurrentState.grading.submission=JSON.parse(JSON.stringify(nativeAssignment.submission));
        rawCurrentState.grading.settings=JSON.parse(JSON.stringify(nativeAssignment.settings));
        rawCurrentState.grading.currentStateEvidence=JSON.parse(JSON.stringify(nativeAssignment.currentStateEvidence));
        rawCurrentState.grading.metadataCorrections=nativeAssignment.metadataCorrections.slice();
    }

    // v6.5.2: always derive the conservative flat-text structured fallback for
    // assignments, then merge it with the higher-trust DOM structure. This recovers
    // question cards the DOM card finder can miss while preserving DOM-derived
    // Correct/Incorrect evidence whenever it exists.
    if (normalizedTypeForAssessment === 'Assignment' || normalizedTypeForAssessment === 'Assessment') {
        var textStructuredAssessment = qaParseCourseraAssignmentText_(normalizedTextForAssessment);
        if (structuredAssessment && textStructuredAssessment) {
            structuredAssessment = qaMergeCourseraStructuredEvidence_(structuredAssessment, textStructuredAssessment);
        } else if (!structuredAssessment) {
            structuredAssessment = textStructuredAssessment;
        }
    }

    if (structuredAssessment) structuredAssessment = qaNormalizeAssessment_(structuredAssessment, 'coursera-assignment');

    return {
        id: String(item.id || item.itemId || ''),
        name: qaCleanText_(item.name || item.title || 'Untitled Item'),
        type: normalizeCourseraType_(item.type || item.typeName || payload.typeName),
        rawType: qaCleanText_(item.typeName || payload.typeName || item.type || ''),
        path: qaCleanText_(item.path || ''),
        lesson: qaCleanText_(item.lesson || ''),
        files: assetDetails.map(function(desc) { return desc.name || desc.url; }),
        assetDetails: assetDetails,
        assetEvidenceConfidence: assetEvidenceConfidence,
        linkEvidenceConfidence: linkEvidenceConfidence,
        // Keep complete observed URLs alongside normalized search keys. Query and
        // fragment differences must survive the XLSX payload-enrichment step.
        capturedLinkUrls: links.filter(function(u){return typeof u==='string';}).map(function(u){return u.trim();}),
        links: qaExternalLinks_(links),
        textSample: qaCleanText_(qaPayloadField_(payload,item,'textSample','')),
        textSha256: String(qaPayloadField_(payload,item,'textSha256','')),
        textLength: nonNegativeInteger_(qaPayloadField_(payload,item,'textLength',0)),
        textConfidence: qaCleanText_(qaPayloadField_(payload,item,'textConfidence','')),
        textEvidenceCompleteness: textEvidenceCompleteness,
        textEvidenceCompletenessObserved: !!readingGap || Object.prototype.hasOwnProperty.call(payload,'textEvidenceCompleteness') || Object.prototype.hasOwnProperty.call(item,'textEvidenceCompleteness'),
        textScopeKind: qaCleanText_(qaPayloadField_(payload,item,'textScopeKind','')),
        timeEstimateMinutes: (typeof rawTimeEstimate === "number" || (typeof rawTimeEstimate === "string" && /^\d+(?:\.\d+)?$/.test(rawTimeEstimate.trim()))) && Number.isFinite(Number(rawTimeEstimate)) && Number(rawTimeEstimate)>=0 && Number(rawTimeEstimate)<=1000000?Number(rawTimeEstimate):null,
        timeEstimateEvidence: qaCleanText_(payload.timeEstimateEvidence || item.timeEstimateEvidence || ''),
        structuredAssessment: structuredAssessment,
        nativeAssignment: nativeAssignment,
        pluginEvidence:qaPayloadField_(payload,item,'pluginEvidence',null),
        readingEditorEvidence:qaPayloadField_(payload,item,'readingEditorEvidence',null),
        readingAttachmentEvidence:qaPayloadField_(payload,item,'readingAttachmentEvidence',null),
        textCaptureEvidence:rawTextReceipt && typeof rawTextReceipt==='object'?JSON.parse(JSON.stringify(rawTextReceipt)):null,
        emptyEditorEvidence:qaObservedEmptyAssessmentReceipt_({id:String(item.id || item.itemId || ''),type:normalizedTypeForAssessment,structuredAssessment:structuredAssessment,emptyEditorEvidence:rawEmptyReceipt}),
        textCaptureTruncated:qaPayloadField_(payload,item,'textCaptureTruncated',false)===true,
        readingCaptureGap:qaPayloadField_(payload,item,'readingCaptureGap',''),
        currentState:rawCurrentState && typeof rawCurrentState==='object'?JSON.parse(JSON.stringify(rawCurrentState)):null,
        ingestionFailure: qaNormalizeIngestionFailure_(payload.ingestionFailure || item.ingestionFailure || null, item.name || item.title || '', qaPayloadField_(payload,item,'textSample',''), structuredAssessment),
        published: published,
        evidenceLevel: qaCleanText_(item.evidenceLevel || payload.evidenceLevel || ''),
        evidenceSources: Array.isArray(item.evidenceSources) ? item.evidenceSources : (Array.isArray(payload.evidenceSources) ? payload.evidenceSources : []),
        original: item,
        matched: false
    };
}

export function qaMatchScore_(source, coursera) {
    var titleScore = fuzzyMatchScore_(source.name, coursera.name);
    if (titleScore < 0.50) return 0;

    var typeScore = qaTypesCompatible_(source.type, coursera.type) ? 1 : 0.15;
    var pathScore = qaPathSimilarity_(source.path, coursera.path);
    var combined;

    if (pathScore === null) combined = (titleScore * 0.90) + (typeScore * 0.10);
    else combined = (titleScore * 0.76) + (pathScore * 0.14) + (typeScore * 0.10);

    // Exact/near-exact titles must remain eligible for type-mutation detection
    // even when placement and type both changed.
    if (titleScore >= 0.98 && combined < 0.82) combined = 0.82;
    return combined;
}

export function qaBuildGlobalMatchPlan_(sourceItems, courseraItems) {
    sourceItems = Array.isArray(sourceItems) ? sourceItems : [];
    courseraItems = Array.isArray(courseraItems) ? courseraItems : [];
    var edges = [];
    for (var s = 0; s < sourceItems.length; s++) {
        if (sourceItems[s] && sourceItems[s].hiddenDependency) continue;
        for (var c = 0; c < courseraItems.length; c++) {
            var score = qaMatchScore_(sourceItems[s], courseraItems[c]);
            if (score < 0.78) continue;
            var sourceKey = qaMatchTitleKey_(sourceItems[s].name);
            var destKey = qaMatchTitleKey_(courseraItems[c].name);
            var exactTitle = !!sourceKey && sourceKey === destKey;
            var typeCompatible = qaTypesCompatible_(sourceItems[s].type, courseraItems[c].type);
            var pathScore = qaPathSimilarity_(sourceItems[s].path, courseraItems[c].path);
            edges.push({ sourceIndex:s, courseraIndex:c, score:score, exactTitle:exactTitle, typeCompatible:typeCompatible, pathScore:pathScore == null ? -1 : pathScore });
        }
    }
    edges.sort(function(a,b) {
        if (a.exactTitle !== b.exactTitle) return a.exactTitle ? -1 : 1;
        if (a.typeCompatible !== b.typeCompatible) return a.typeCompatible ? -1 : 1;
        if (Math.abs(a.score-b.score) > 1e-9) return b.score-a.score;
        if (Math.abs(a.pathScore-b.pathScore) > 1e-9) return b.pathScore-a.pathScore;
        if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex-b.sourceIndex;
        return a.courseraIndex-b.courseraIndex;
    });
    var sourceUsed = Object.create(null), destUsed = Object.create(null), plan = Object.create(null);
    edges.forEach(function(edge) {
        if (sourceUsed[edge.sourceIndex] || destUsed[edge.courseraIndex]) return;
        sourceUsed[edge.sourceIndex] = true; destUsed[edge.courseraIndex] = true;
        edge.method = edge.exactTitle ? 'EXACT_TITLE_RESERVED' : (edge.typeCompatible ? 'GLOBAL_TYPE_COMPATIBLE' : 'GLOBAL_FUZZY');
        plan[edge.sourceIndex] = edge;
    });
    return plan;
}

export function qaBehaviorComparison_(source,coursera){
  var src=source&&source.behavior, dst=coursera&&coursera.nativeAssignment;
  var required=/Assignment|Assessment|Quiz|Exam/i.test(String(source&&source.type||''));
  function unknown(issue,reason){return {status:'UNVERIFIED',comparable:true,reviewRequired:true,mismatches:[],issues:[issue],sourceObserved:!!(src&&src.observed),destinationObserved:!!dst,reason:reason};}
  if(!src||src.observed!==true)return required?unknown('BEHAVIOR_SOURCE_UNVERIFIED','Source behavior was not observed.'): {status:'NOT_APPLICABLE',comparable:false,mismatches:[],issues:[]};
  if(!dst)return unknown('BEHAVIOR_DESTINATION_UNVERIFIED','Source behavior exists but destination behavior was not captured.');
  var s=src.settings||{},d=dst.settings||{},ss=src.submission||{},ds=dst.submission||{},mis=[],comp=[],missing=[];
  function compare(key,a,b){if(a==null||a==='')return;if(b==null||b===''){missing.push(key);return;}comp.push(key);if(a!==b)mis.push(key+'_CHANGED');}
  function number(v){return v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;}
  function attempts(v){if(v==null||v==='')return null;var text=String(v).toLowerCase();if(/unlimited/.test(text))return 'UNLIMITED';var m=text.match(/\d+/);return m?String(Number(m[0])):null;}
  function graded(settings){if(typeof settings.graded==='boolean')return settings.graded;var text=String(settings.gradeSetting||'').trim();if(/^(?:ungraded|practice)$/i.test(text))return false;if(/^graded$/i.test(text))return true;return null;}
  if(ss.fileUpload===true){if(ds.fileUpload===true)comp.push('FILE_UPLOAD');else if(ds.aiGraded===true||ds.textSubmission===true)mis.push('FILE_UPLOAD_REPLACED');else missing.push('FILE_UPLOAD');}
  if(ss.textSubmission===true){if(ds.textSubmission===true)comp.push('TEXT_SUBMISSION');else if(ds.fileUpload===true&&ds.aiGraded!==true)mis.push('TEXT_SUBMISSION_REPLACED');else missing.push('TEXT_SUBMISSION');}
  compare('ATTEMPTS',attempts(s.attempts),attempts(d.attempts));
  var sg=graded(s),dg=graded(d);compare('GRADED_STATE',sg,dg);
  var sp=number(s.passingThreshold),dp=number(d.passingThreshold);
  if(sg===false&&dp!=null&&dp>0){comp.push('PASSING_THRESHOLD');mis.push('PASSING_THRESHOLD_ON_UNGRADED_SOURCE');}
  else compare('PASSING_THRESHOLD',sp,dp);
  compare('POINTS',number(s.points),number(d.points));compare('TIME_LIMIT',number(s.timeLimitMinutes),number(d.timeLimitMinutes));
  return {status:mis.length?'MUTATED':(missing.length||!comp.length?'UNVERIFIED':'VERIFIED'),comparable:true,reviewRequired:!!(missing.length||!comp.length),
    mismatches:mis,issues:mis.concat(missing.map(function(k){return k+'_UNVERIFIED';})),compared:comp,unverifiedDimensions:missing,source:src,coursera:dst,
    reason:mis.length?'Explicitly observed behavior differs.':missing.length?'Required source settings are not all observed at the destination.':!comp.length?'No portable behavior settings were comparable.':'All observed source behavior dimensions match.'};
}

export function qaRuntimeReview_(source, coursera) {
    var sig = source && source.interactiveSignals && typeof source.interactiveSignals === 'object' ? source.interactiveSignals : null;
    if (!sig || sig.detected !== true) return { status:'NOT_APPLICABLE', detected:false, required:false, runtimeFamilies:[], reason:'No source interactive runtime signature was observed.' };
    var families = Array.isArray(sig.runtimeFamilies) ? sig.runtimeFamilies.slice() : [];
    var courseraType = qaCleanText_(coursera && coursera.type || '');
    var links = (coursera && coursera.links || []).map(function(link){ return String(link && (link.raw || link.normalized || link) || '').toLowerCase(); });
    var files = (coursera && coursera.files || []).map(function(file){ return String(file || '').toLowerCase(); });
    var carrierObserved = courseraType === 'Ungraded Plugin' || links.some(function(url){ return /(?:launch|scorm|tincan|xapi|plugin|widget)/i.test(url); }) || files.some(function(file){ return /(?:story\.html|index_lms\.html|tincan\.xml|scormdriver|storyline|articulate|\.practice\.json)/i.test(file); });
    return {
        status:'REVIEW',
        detected:true,
        required:true,
        runtimeFamilies:families,
        confidence:String(sig.confidence || 'MEDIUM'),
        destinationCarrierObserved:carrierObserved,
        sourceNote:String(sig.note || ''),
        reason:carrierObserved
          ? 'Source evidence indicates interactive/runtime behavior and Coursera exposes a possible runtime carrier. Structure/payload evidence cannot prove that the interaction actually works; launch it before KEEP.'
          : 'Source evidence indicates interactive/runtime behavior, but no destination runtime carrier was proven. Verify the intended interaction manually; absence of a standalone SCORM label is not proof of loss or success.'
    };
}

export function qaApplyExternalRuntimePolicy_(operationalPolicy, externalRuntimeEvidence) {
    operationalPolicy = operationalPolicy || {};
    var ev = externalRuntimeEvidence || {};
    operationalPolicy.externalRuntimeReviewRequired = ev.required === true;
    operationalPolicy.externalRuntimeEvidence = ev;
    if (ev.required === true) {
        var count = Number(ev.riseCount || 0) + Number(ev.storylineCount || 0);
        operationalPolicy.externalRuntimePackageCount = count;
        if (operationalPolicy.recommendationCode === 'KEEP') {
            operationalPolicy.recommendationCode = 'REVIEW';
            operationalPolicy.recommendationLabel = 'REVIEW';
            operationalPolicy.recommendationReason = 'Automated structural/payload checks meet KEEP thresholds, but the external source inventory flags ' + count + ' Rise/Storyline runtime package(s). Launch the source LMS activity and Coursera equivalent before KEEP.';
        } else {
            operationalPolicy.runtimeAdvisory = 'External inventory flags ' + count + ' Rise/Storyline runtime package(s); this remains a required launch check after material ingestion failures are resolved.';
        }
    }
    return operationalPolicy;
}

export function qaBuildHiddenDependencyResult_(source, courseraEvidenceItems, snapshotContext) {
    var dep = source.hiddenDependency || { kind:'HIDDEN_DEPENDENCY_REVIEW', reason:'Hidden source dependency.' };
    if (dep.kind === 'ATTACHMENT_PROXY') {
        var proxy = {
            sourceId:source.id, sourceName:source.name, sourceType:source.type, sourcePath:source.path,
            courseraId:'', courseraName:'', courseraType:'', courseraPath:'', matchScore:0,
            fidelityPercent:100, evidenceCoverage:100, earnedPoints:0, possiblePoints:0,
            verdict:'DEPENDENCY_PROXY', issues:['HIDDEN_ATTACHMENT_PROXY'],
            checks:{ hiddenDependency:{status:'POLICY_INFORMATIONAL', kind:dep.kind, parentName:dep.parentName, reason:dep.reason} },
            evidenceSources:['IMSCC source hierarchy'], snapshotContext:snapshotContext
        };
        proxy.ownerAction = { severity:'NONE', label:'Attachment proxy', action:'Do not treat this hidden child as a second learner activity. Audit the visible parent/downloadable asset instead.' };
        proxy.evidenceStrength = { score:96, label:'Very strong', basis:['Source hierarchy and same-named attachment proxy pattern are deterministic.'] };
        proxy.hiddenDependency = dep;
        return proxy;
    }

    var recovery = qaFindCrossItemPayloadEvidence_(source, courseraEvidenceItems || [], '');
    if (recovery && recovery.hasPositiveEvidence) {
        var verified = qaBuildRepackagedMissingResult_(source, recovery, snapshotContext);
        verified.verdict = 'DEPENDENCY_VERIFIED';
        verified.issues = ['HIDDEN_DEPENDENCY_RECOVERED'];
        verified.checks.hiddenDependency = { status:'RECOVERED', kind:dep.kind, parentName:dep.parentName, reason:'Hidden dependency payload was recovered in Coursera evidence; standalone structure is not required.' };
        verified.hiddenDependency = dep;
        verified.ownerAction = { severity:'NONE', label:'Hidden dependency recovered', action:'Payload evidence was recovered. Do not recreate the hidden source child as a standalone Coursera item.' };
        return verified;
    }

    var review = {
        sourceId:source.id, sourceName:source.name, sourceType:source.type, sourcePath:source.path,
        courseraId:'', courseraName:'', courseraType:'', courseraPath:'', matchScore:0,
        fidelityPercent:0, evidenceCoverage:40, earnedPoints:0, possiblePoints:0,
        verdict:'HIDDEN_DEPENDENCY_REVIEW', issues:['HIDDEN_DEPENDENCY_UNVERIFIED'],
        checks:{ hiddenDependency:{status:'REVIEW', kind:dep.kind, parentName:dep.parentName, reason:dep.reason} },
        evidenceSources:['IMSCC source hierarchy'], snapshotContext:snapshotContext,
        hiddenDependency:dep
    };
    review.ownerAction = { severity:'REVIEW', label:'Review parent payload', action:'Do not re-ingest solely because this hidden child is absent. Verify whether its payload survives inside the visible parent or another learner-accessible Coursera item.' };
    review.evidenceStrength = { score:90, label:'Strong', basis:['The source hierarchy proves this is a hidden child; learner-impact remains unresolved.'] };
    return review;
}

export function qaCourseLevelFailure_(sourceItems, courseraItems, partnerName) {
    sourceItems = Array.isArray(sourceItems) ? sourceItems : [];
    courseraItems = Array.isArray(courseraItems) ? courseraItems : [];
    var meaningfulSource = sourceItems.filter(function(item) {
        if (!item || item.hiddenDependency) return false;
        return workSourceItemPolicy_(partnerName || '', item).inDecisionGate !== false;
    }).length;
    var meaningfulDestination = courseraItems.filter(function(item) {
        var info = qaClassifyExtraItem_(item || {});
        if (info.classification === 'ADMIN_EXTRA' || info.classification === 'TEMPLATE_EXTRA' || info.classification === 'PLACEHOLDER_EXTRA') return false;
        return workSourceItemPolicy_(partnerName || '', { sourcePath:item && item.path || '' }).inDecisionGate !== false;
    }).length;
    if (meaningfulSource >= 5 && meaningfulDestination === 0) {
        return { detected:true, code:'EMPTY_DESTINATION_AFTER_INGESTION', severity:'CRITICAL', sourceItemCount:meaningfulSource, destinationItemCount:meaningfulDestination,
            reason:'The source contains substantial learner content but Coursera contains no meaningful learner-content structure after administrative/template placeholders are removed.' };
    }
    if (meaningfulSource >= 10 && meaningfulDestination <= 1) {
        return { detected:true, code:'NEAR_EMPTY_DESTINATION_AFTER_INGESTION', severity:'CRITICAL', sourceItemCount:meaningfulSource, destinationItemCount:meaningfulDestination,
            reason:'The source contains substantial learner content but Coursera contains only one meaningful learner-content item.' };
    }
    return { detected:false, code:'', severity:'NONE', sourceItemCount:meaningfulSource, destinationItemCount:meaningfulDestination, reason:'' };
}
