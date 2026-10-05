// Maintained source: explicit dependencies; no ordered concatenation.
import { qaObservedEmptyAssessmentReceipt_, qaReadingAttachmentEvidence_, qaReadingEvidenceGap_ } from "../assessment/assignment.js";
import { normalizeCourseraType_, qaCleanName_, qaCleanText_ } from "../matching/text.js";
import { qaCaptureTraversalSummary_, qaHasAiGraderPlaceholder_, qaObservedEmptyAssessmentBody_, qaResolveHistoricalClaimCurrentState_ } from "../provenance/current-state.js";
import { workSourceItemPolicy_ } from "../work/policy.js";
import { qaTemplatePlaceholders_ } from "./template-placeholders.js";

export function qaAssessDestinationReadiness_(courseraItems, intelligence, extractorMeta, snapshotContext, currentStateResolution, partnerName) {
    var findings=[];
    function push(code,severity,itemName,path,detail,action,itemId){findings.push({code:code,severity:severity,itemName:itemName||'',path:path||'',detail:detail||'',action:action||'',itemId:itemId||''});}
    (courseraItems||[]).forEach(function(item){
        function pushItem(code,severity,name,path,detail,action){push(code,severity,name,path,detail,action,item.id);}
        var name=qaCleanText_(item.name||'');
        var text=qaCleanText_(item.textSample||'');
        var combined=name+' '+text;
        var readingGap=qaReadingEvidenceGap_(item);
        if(readingGap)pushItem(readingGap.code,'EVIDENCE',name,item.path,readingGap.reason,'Verify the specific unread document or page before publication. Do not edit course content solely because its capture is incomplete.');
        var attachments=qaReadingAttachmentEvidence_(item);
        if(attachments && attachments.unresolvedLabels.length)pushItem('ATTACHMENT_DOWNLOAD_URLS_UNVERIFIED','EVIDENCE',name,item.path,
            'Coursera item '+item.id+': '+attachments.resolvedLabelCount+'/'+attachments.observedLabelCount+' observed attachment labels have captured download URLs. Unresolved: '+attachments.unresolvedLabels.join('; ')+'. Reading text coverage is separate from attachment coverage.',
            'Recover the unresolved attachment URLs from this exact Coursera item. This capture gap does not establish missing course files; do not recreate or delete attachments based on it.');
        var attachmentReceipt=item.readingAttachmentEvidence,network=attachmentReceipt && attachmentReceipt.network;
        if(attachments && attachmentReceipt && attachmentReceipt.itemId===String(item.id) && network && Number.isSafeInteger(network.omittedResponses) && network.omittedResponses>0)pushItem('READING_NETWORK_CAPTURE_LIMIT','EVIDENCE',name,item.path,
            network.omittedResponses+' eligible reading responses exceeded the bounded extraction budget.',
            'Inspect or recover this item separately. Editor traversal and text capture do not establish attachment completeness.');
        var emptyAssessment=/Assignment|Assessment|Quiz/i.test(item.type||'') &&
            /Content you add will show in order here\./i.test(text) &&
            /Select content type/i.test(text) && !/Content\s*\(\s*[1-9]\d*\s*\)/i.test(text) &&
            !(item.structuredAssessment&&item.structuredAssessment.questions&&item.structuredAssessment.questions.length) &&
            Number(item.textEvidenceCompleteness||0)>=0.75 && /scoped|assignment/.test(item.textScopeKind||'');
        var emptyReceipt=qaObservedEmptyAssessmentReceipt_(item);
        if(emptyAssessment || emptyReceipt)pushItem('EMPTY_ASSESSMENT_EDITOR_OBSERVED','REVIEW',name,item.path,
            emptyReceipt?'The exact assignment outline and body both showed an empty editor in two stable observations. This confirms the captured destination state; source completeness remains undetermined.':'The captured item-scoped editor explicitly shows its empty-content state and no question structure.',
            emptyReceipt?'Compare this empty destination assignment with its matched source assessment. Restore content only if the source confirms it belongs here.':'Open this exact assignment once and check whether the source questions were created. The capture shows an empty editor; do not assume a question bank was merely truncated. Confirm before restoring questions.');
        else if(qaObservedEmptyAssessmentBody_(item,extractorMeta))pushItem('EMPTY_ASSESSMENT_BODY_REVIEW','REVIEW',name,item.path,
            'The observed assignment body contains only Coursera\'s empty-content creation controls. Full outline evidence was not captured.',
            'Check this exact assignment against its source questions. Confirm the empty state before adding or restoring content; this body-only capture does not establish complete assessment coverage.');
        if(/^\[empty\]/i.test(name)) pushItem('EMPTY_PLACEHOLDER_ITEM','REVIEW',name,item.path,'A placeholder/empty learner item exists in the destination shell.','Confirm whether this item should be populated or removed before publication.');
        var templatePlaceholders=qaTemplatePlaceholders_(combined);
        if(templatePlaceholders.length) pushItem('TEMPLATE_PLACEHOLDER_TEXT','REVIEW',name,item.path,'Template authoring prompts remain in the captured destination: '+templatePlaceholders.join('; '),'Replace or intentionally remove the placeholder before publication. Use approved course information; do not invent contact details, assessment instructions or grading policies. Record what is needed if approval or information is unavailable.');
        if(/first\.last\.?@email\.com|\(000\)\s*000[-\s]?0000|000[-\s]?000[-\s]?0000/i.test(combined)) pushItem('PLACEHOLDER_CONTACT_INFO','REVIEW',name,item.path,'Generic facilitator contact placeholders remain in the destination content.','Replace with the intended facilitator/contact details or remove the placeholder fields.');
        if(qaHasAiGraderPlaceholder_(item)) pushItem('AI_GRADER_PLACEHOLDER','REVIEW',name,item.path,'The captured assignment authoring surface shows an AI-grader instruction placeholder. Learner text fidelity does not verify grader setup.','Inspect the AI-grader instructions. Configure them if empty, or select the intended grading mode, before publication.');
        if(/author alignment report|author.?s eyes/i.test(name+' '+String(item.path||''))) pushItem('AUTHOR_ALIGNMENT_REPORT_PRESENT','INFO',name,item.path,'The Smart Ingestion Author Alignment Report is still in the shell.','Delete the [DELETE ME] Author Alignment Report module before publication, as instructed by Smart Ingestion.');
        if(normalizeCourseraType_(item.type)==='Video' && item.timeEstimateMinutes===0) pushItem('ZERO_MINUTE_VIDEO','REVIEW',name,item.path,'A video is configured with a 0-minute time estimate.','Set an appropriate learner time estimate before publication.');
    });
    var resolutions=currentStateResolution && currentStateResolution.resolutions;
    if(!Array.isArray(resolutions))resolutions=(intelligence && intelligence.claims || []).map(function(c){return qaResolveHistoricalClaimCurrentState_(c,null,null,courseraItems,extractorMeta,snapshotContext);});
    resolutions.forEach(function(r){
        var raw=r.status==='RAW_PROVENANCE';
        if(raw&&!/^(UNRESOLVED_SOURCE_ASSET|GENERATED_CONTENT_FALLBACK|GENERATED_BEHAVIOR|BROKEN_LINK_FALLBACK|PLACEHOLDER_FALLBACK)$/.test(r.claimType))return;
        if(['CRITICAL','REVIEW','EVIDENCE'].indexOf(r.severity)<0)return;
        var code=raw?'SI_'+r.claimType:(r.severity==='EVIDENCE'?'CURRENT_STATE_EVIDENCE_':'CURRENT_STATE_')+String(r.claimType||r.status);
        var label=r.currentItemName||r.sourceName||r.subject||('Unmapped ingestion finding ('+String(r.claimType||r.status)+')');
        push(code,r.severity,label,r.currentItemPath||r.sourcePath||r.pathHint,r.detail,r.action,r.currentItemId);
    });
    var crawl=extractorMeta && extractorMeta.activeSpaCrawl || {};
    var traversal=qaCaptureTraversalSummary_(extractorMeta);
    if(traversal.recorded&&!traversal.complete){
        push('EXTRACTOR_FULL_CRAWL_INCOMPLETE','EVIDENCE','','',
            'Only '+traversal.visited+'/'+traversal.eligible+' eligible item editors were observed. '+traversal.unresolvedCount+' remain unresolved, even if every item was searched for.',
            'Recover or inspect the unresolved item editors before treating unobserved payload as absent. Keep independently confirmed defects visible; do not rebuild items solely because their editor was not reached.');
    }
    findings.forEach(function(f){
        if(!f.itemId && f.itemName){
            var matches=(courseraItems||[]).filter(function(item){return qaCleanName_(item.name)===qaCleanName_(f.itemName)&&qaCleanText_(item.path)===qaCleanText_(f.path);});
            if(matches.length===1)f.itemId=matches[0].id||'';
        }
        if(!workSourceItemPolicy_(partnerName||'',{sourcePath:f.path}).inDecisionGate){
            f.originalSeverity=f.severity;f.originalAction=f.action;f.severity='INFO';f.policyExempt=true;
            f.action='Optional housekeeping in '+f.path+'. Retain for audit and change only if the course requirements call for it; this does not block the learner-facing audit.';
        }
    });
    var dedup=Object.create(null), unique=[];
    findings.forEach(function(f){var k=[f.code,String(f.itemId||''),qaCleanName_(f.itemName),qaCleanName_(f.path),qaCleanName_(f.detail)].join('|');if(!dedup[k]){dedup[k]=true;unique.push(f);}});
    var critical=unique.filter(function(f){return f.severity==='CRITICAL';});
    var review=unique.filter(function(f){return f.severity==='REVIEW';});
    var evidence=unique.filter(function(f){return f.severity==='EVIDENCE';});
    var manualRepair=critical.filter(function(f){return f.code==='SI_UNRESOLVED_SOURCE_ASSET';});
    return {
        status:critical.length?'BLOCKED':((review.length||evidence.length)?'REVIEW':'READY'),
        criticalCount:critical.length,
        reviewCount:review.length,
        evidenceGapCount:evidence.length,
        manualRepairCount:manualRepair.length,
        manualRepairFindings:manualRepair.slice(0,40),
        findings:unique.slice(0,160),
        criticalFindings:critical.slice(0,60),
        reviewFindings:review.slice(0,80),
        evidenceFindings:evidence.slice(0,40)
    };
}

export function qaApplyDestinationReadinessPolicy_(operationalPolicy, readiness) {
    operationalPolicy=operationalPolicy||{};
    if(!readiness) return operationalPolicy;
    operationalPolicy.destinationReadiness=readiness;
    operationalPolicy.readinessCriticalNames=(readiness.criticalFindings||[]).map(function(f){return f.itemName||f.code;}).filter(Boolean);
    operationalPolicy.readinessReviewNames=(readiness.reviewFindings||[]).map(function(f){return f.itemName||f.code;}).filter(Boolean);
    operationalPolicy.manualRepairRequired=Number(readiness.manualRepairCount||0)>0;
    operationalPolicy.manualRepairNames=(readiness.manualRepairFindings||[]).map(function(f){return f.itemName||f.code;}).filter(Boolean);
    if(operationalPolicy.manualRepairRequired && ['KEEP','REVIEW'].indexOf(operationalPolicy.recommendationCode)>=0){
        operationalPolicy.recommendationCode='MANUAL_REMEDIATION';
        operationalPolicy.recommendationLabel='Resolve reported attachment failures before publication';
        operationalPolicy.recommendationReason='Current Smart Ingestion reports an attachment it could not include: '+operationalPolicy.manualRepairNames.join('; ')+'. Confirm learner access and restore or link the source file if absent. These explicit failures require a targeted check; repeating ingestion is not established as a remedy.';
    } else if((readiness.criticalCount||0)>0 && operationalPolicy.recommendationCode==='KEEP'){
        operationalPolicy.recommendationCode='REVIEW';
        operationalPolicy.recommendationLabel='REVIEW';
        operationalPolicy.recommendationReason='Source-fidelity thresholds pass, but destination readiness has critical Smart Ingestion fallbacks or unresolved source assets. Fix those before KEEP.';
    } else if(((readiness.reviewCount||0)>0||(readiness.evidenceGapCount||0)>0) && operationalPolicy.recommendationCode==='KEEP'){
        operationalPolicy.recommendationCode='REVIEW';
        operationalPolicy.recommendationLabel='REVIEW';
        operationalPolicy.recommendationReason='Source-fidelity thresholds pass, but destination publish-readiness checks still require human review.';
    }
    return operationalPolicy;
}

export function qaIsProvenHardPayloadLoss_(item) {
    item=item||{};
    var issues=Array.isArray(item.issues)?item.issues:[];
    var checks=item.checks||{};
    var oneToMany=checks.oneToManyTransformation||null;

    // A negative finding that first appears after manual cleanup in the SAME
    // Smart Ingestion generation is a manual-regression review, not evidence
    // that Smart Ingestion itself must be run again.
    if(issues.indexOf('MANUAL_PAYLOAD_REGRESSION_SINCE_RAW')>-1) return false;

    // v7.2 operational distinction:
    // Smart Ingestion may explicitly say an attachment could not be inserted and
    // instruct the author to upload/link it manually. That is a real blocker,
    // but repeating the same ingestion is not proven to fix it.
    if(issues.indexOf('SI_UNRESOLVED_SOURCE_ASSET')>-1) return false;

    if(issues.indexOf('SI_GENERATED_CONTENT_FALLBACK_HARD')>-1) return true;
    if(issues.indexOf('RUBRIC_CONTENT_CHANGED')>-1 || issues.indexOf('ASSESSMENT_CHANGED')>-1) return true;

    // An unobserved link remains a review even when a wrapper URL was captured.
    // Link confidence measures what was observed, not exhaustive configuration.
    if(issues.indexOf('MISSING_ASSET')>-1) {
        if(oneToMany) {
            var strongRatio=Number(oneToMany.strongPayloadEvidenceRatio||0);
            // Do not convert absence-of-observation into hard loss when only a
            // subset of one-to-many destination children was deeply inspected.
            if(strongRatio < 0.85) return false;

        }
        return true;
    }

    if(issues.indexOf('CONTENT_CHANGED')>-1){
        if(oneToMany && Number(oneToMany.textEvidenceRatio||0)<0.80) return false;
        return Number(item.evidenceCoverage||0)>=80;
    }
    return false;
}

export function qaResolveSnapshotContext_(requestedMode, courseraItems, intelligence) {
    var requested = String(requestedMode || 'auto').toLowerCase();
    if (['raw','raw_ingestion','raw-ingestion'].indexOf(requested) > -1) requested = 'raw';
    else if (['ops','current','ops_ready','ops-ready','prepared'].indexOf(requested) > -1) requested = 'ops';
    else if (['published','learner_facing','learner-facing','live'].indexOf(requested) > -1) requested = 'published';
    else requested = 'auto';

    var observed = 0, published = 0, unpublished = 0;
    (courseraItems || []).forEach(function(item) {
        if (item.published === true) { observed++; published++; }
        else if (item.published === false) { observed++; unpublished++; }
    });

    var rawEvidence = !!(intelligence && intelligence.detected) && observed >= 3 && published === 0 && unpublished / observed >= 0.70;
    var inferredPublished = observed >= 3 && published / observed >= 0.90;

    var mode = requested === 'raw'
        ? 'RAW_INGESTION'
        : 'OPS_CURRENT';

    if (requested === 'auto') mode = rawEvidence ? 'RAW_INGESTION' : 'OPS_CURRENT';

    var stage = mode === 'RAW_INGESTION'
        ? 'RAW_UNPUBLISHED'
        : (requested === 'published' || (requested === 'auto' && inferredPublished)
            ? 'PUBLISHED'
            : 'OPS_PREPARED_UNPUBLISHED');

    var label = stage === 'RAW_UNPUBLISHED'
        ? 'Raw Coursera ingestion'
        : (stage === 'PUBLISHED'
            ? 'Published learner-facing Coursera course'
            : 'Current / Ops-prepared Coursera shell');

    var reason;
    if (requested === 'raw') {
        reason = 'User explicitly labelled this as the untouched post-ingestion snapshot.';
    } else if (requested === 'published') {
        reason = 'User explicitly labelled this as the published / learner-facing state. Individual items may still be unpublished or hidden and are evaluated as publication-state findings.';
    } else if (requested === 'ops') {
        reason = 'User explicitly labelled this as a current/Ops-prepared shell that is still unpublished.';
    } else if (rawEvidence) {
        reason = 'Author Alignment Report is present and observed Coursera items are overwhelmingly unpublished, consistent with an untouched Smart Ingestion shell.';
    } else if (inferredPublished) {
        reason = 'Observed destination publication evidence is overwhelmingly published, so CTI inferred a learner-facing course state.';
    } else {
        reason = 'Raw-ingestion and published-state evidence were not strong enough for a stronger automatic stage inference.';
    }

    return {
        requestedMode: requested,
        mode: mode,
        stage: stage,
        label: label,
        inferred: requested === 'auto',
        confidence: requested !== 'auto' ? 1 : (rawEvidence ? 0.97 : (inferredPublished ? 0.94 : 0.72)),
        publicationObservedCount: observed,
        publishedCount: published,
        unpublishedCount: unpublished,
        authorAlignmentReportDetected: !!(intelligence && intelligence.detected),
        reason: reason,
        publicationPolicy: mode === 'RAW_INGESTION'
            ? 'OBSERVE_NOT_PENALIZE'
            : (stage === 'PUBLISHED' ? 'LEARNER_FACING_STRICT' : 'NORMAL_FIDELITY')
    };
}

export function qaAssessSnapshotCoherence_(excelItems, jsonItems, pageMeta, excelName, jsonName) {
    excelItems = excelItems || [];
    jsonItems = jsonItems || [];
    var excelIds = Object.create(null), jsonIds = Object.create(null);
    var excelNames = Object.create(null), jsonNames = Object.create(null);
    excelItems.forEach(function(item) {
        var id = String(item && item.id || '').trim().toLowerCase();
        if (id) excelIds[id] = true;
        var name = qaCleanName_(item && item.name || '');
        if (name && !/^new (reading|discussion prompt|plugin item|assignment|quiz|item)$/.test(name) && name !== 'untitled') excelNames[name] = true;
    });
    jsonItems.forEach(function(item) {
        var id = String(item && item.id || '').trim().toLowerCase();
        if (id) jsonIds[id] = true;
        var name = qaCleanName_(item && item.name || '');
        if (name && !/^new (reading|discussion prompt|plugin item|assignment|quiz|item)$/.test(name) && name !== 'untitled') jsonNames[name] = true;
    });
    var excelIdKeys = Object.keys(excelIds), jsonIdKeys = Object.keys(jsonIds);
    var idIntersection = excelIdKeys.filter(function(id) { return jsonIds[id]; }).length;
    var idDenom = Math.min(excelIdKeys.length, jsonIdKeys.length);
    var idOverlap = idDenom ? idIntersection / idDenom : null;
    var excelNameKeys = Object.keys(excelNames), jsonNameKeys = Object.keys(jsonNames);
    var nameIntersection = excelNameKeys.filter(function(name) { return jsonNames[name]; }).length;
    var nameDenom = Math.min(excelNameKeys.length, jsonNameKeys.length);
    var nameOverlap = nameDenom ? nameIntersection / nameDenom : null;
    var status = 'UNVERIFIED';
    var reason = 'The uploaded pair does not expose enough comparable identifiers to prove that the XLSX and JSON belong to the same Coursera snapshot.';
    if (!excelItems.length || !jsonItems.length) {
        status = 'SINGLE_SOURCE';
        reason = 'Only one Coursera evidence source was supplied, so XLSX↔JSON snapshot coherence cannot be checked.';
    } else if (idDenom >= 5) {
        if (idOverlap >= 0.60) {
            status = 'PASS';
            reason = 'Stable Coursera item IDs strongly agree between the XLSX structural inventory and JSON fingerprint.';
        } else if (idOverlap >= 0.25) {
            status = 'WARN';
            reason = 'Only partial stable-ID overlap was observed between XLSX and JSON. Review the selected files before relying on payload-level verdicts.';
        } else {
            status = 'FAIL';
            reason = 'The XLSX and JSON have too little stable Coursera item-ID overlap and appear to come from different course branches/snapshots.';
        }
    } else if (nameDenom >= 5 && nameOverlap >= 0.70) {
        status = 'PASS';
        reason = 'Stable IDs are sparse, but non-generic item names strongly agree between the XLSX and JSON.';
    } else if (nameDenom >= 3 && nameOverlap >= 0.40) {
        status = 'WARN';
        reason = 'Stable IDs are sparse and item-name overlap is only partial. Treat payload evidence cautiously.';
    }
    return {
        status: status,
        reason: reason,
        excelName: String(excelName || ''),
        jsonName: String(jsonName || ''),
        jsonCourseId: String(pageMeta && pageMeta.courseId || ''),
        jsonPageTitle: String(pageMeta && pageMeta.title || ''),
        excelItemIdCount: excelIdKeys.length,
        jsonItemIdCount: jsonIdKeys.length,
        intersectingItemIds: idIntersection,
        idOverlapPercent: idOverlap == null ? null : Math.round(idOverlap * 100),
        comparableExcelNames: excelNameKeys.length,
        comparableJsonNames: jsonNameKeys.length,
        intersectingNames: nameIntersection,
        nameOverlapPercent: nameOverlap == null ? null : Math.round(nameOverlap * 100)
    };
}

export function qaLifecycleSourceKey_(item) {
    if (!item) return '';
    if (item.sourceId) return 'id:' + String(item.sourceId);
    return 'name:' + qaCleanName_(item.sourceName || '') + '|path:' + qaCleanName_(item.sourcePath || '');
}

export function qaLifecyclePublication_(item) {
    var pub = item && item.checks && item.checks.publication;
    return pub && (pub.published === true || pub.published === false) ? pub.published : null;
}

export function qaLifecycleContentStatus_(item) {
    return String(item && item.checks && item.checks.content && item.checks.content.status || '');
}

export function qaLifecycleRubricCount_(item) {
    var tr = item && item.checks && item.checks.transformation;
    return tr && tr.rubricCount != null ? Number(tr.rubricCount || 0) : null;
}

export function qaLifecycleRubricMismatch_(item) {
    var tr = item && item.checks && item.checks.transformation;
    return tr ? Number(tr.rubricMismatchCount || 0) : 0;
}

export function qaLifecycleGoodVerdict_(verdict) {
    return ['VERIFIED','REPACKAGED','EXPECTED_TRANSFORMATION','INTENTIONAL_EXCLUSION','MOVED'].indexOf(String(verdict || '')) > -1;
}

export function qaLifecycleBadRank_(verdict) {
    var v = String(verdict || '');
    var rank = { VERIFIED:0, EXPECTED_TRANSFORMATION:0, REPACKAGED:0, INTENTIONAL_EXCLUSION:0, MOVED:1, UNVERIFIED:2, PARTIAL:3, STATE_MUTATION:3, TYPE_MUTATION:4, MISSING:5 };
    return rank[v] == null ? 2 : rank[v];
}
