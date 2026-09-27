


function normalizeCourseraItem_(item) {
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

    return {
        id: String(item.id || item.itemId || ''),
        name: qaCleanText_(item.name || item.title || 'Untitled Item'),
        type: normalizeCourseraType_(item.type || item.typeName || payload.typeName),
        rawType: qaCleanText_(item.typeName || payload.typeName || item.type || ''),
        path: qaCleanText_(item.path || ''),
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
        timeEstimateMinutes: rawTimeEstimate!=null && Number.isFinite(Number(rawTimeEstimate))?Number(rawTimeEstimate):null,
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

function qaMatchScore_(source, coursera) {
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

function qaBuildGlobalMatchPlan_(sourceItems, courseraItems) {
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

function qaBehaviorComparison_(source, coursera) {
    var src = source && source.behavior && typeof source.behavior === 'object' ? source.behavior : null;
    var dst = coursera && coursera.nativeAssignment && typeof coursera.nativeAssignment === 'object' ? coursera.nativeAssignment : null;
    var sourceType = qaCleanText_(source && source.type || '');
    var assignmentLike = /Assignment/i.test(sourceType);
    // v6.12.0: lack of portable source behavior is not evidence of equivalence.
    // For learner-facing assignments we explicitly surface an UNVERIFIED behavior
    // gate so KEEP cannot be reached merely because the IMSCC omitted D2L-specific
    // submission/grading settings.
    if (!src || src.observed !== true) {
        if (assignmentLike) return {
            status:'UNVERIFIED', comparable:true, reviewRequired:true,
            mismatches:[], issues:['BEHAVIOR_SOURCE_UNVERIFIED'],
            sourceObserved:false, destinationObserved:!!dst,
            reason:'This is a learner-facing source assignment, but the exported source package did not expose portable submission/grading behavior. CTI cannot infer equivalence; verify the source LMS behavior before KEEP.'
        };
        return { status:'NOT_APPLICABLE', comparable:false, mismatches:[], issues:[], reason:'No explicit portable source behavior metadata was observed for this non-assignment item.' };
    }
    if (!dst) return { status:'UNVERIFIED', comparable:true, reviewRequired:true, mismatches:[], issues:['BEHAVIOR_DESTINATION_UNVERIFIED'], sourceObserved:true, destinationObserved:false, reason:'Source behavior was observed, but Coursera native behavior evidence was not captured.' };

    var mismatches = [], compared = [];
    var ss = src.submission || {}, ds = dst.submission || {};
    if (ss.fileUpload === true) {
        compared.push('FILE_UPLOAD');
        if (ds.fileUpload !== true && (ds.aiGraded === true || ds.textSubmission === true)) mismatches.push('FILE_UPLOAD_REPLACED');
        else if (ds.fileUpload !== true) return { status:'UNVERIFIED', comparable:true, mismatches:[], issues:[], reason:'Source requires file upload, but destination submission mode was not observed strongly enough.' };
    }
    if (ss.textSubmission === true) {
        compared.push('TEXT_SUBMISSION');
        if (ds.fileUpload === true && ds.textSubmission !== true && ds.aiGraded !== true) mismatches.push('TEXT_SUBMISSION_REPLACED');
    }
    var sourceAttempts = src.settings && src.settings.attempts != null ? String(src.settings.attempts).toLowerCase() : '';
    var destAttempts = dst.settings && dst.settings.attempts != null ? String(dst.settings.attempts).toLowerCase() : '';
    if (sourceAttempts && destAttempts) { compared.push('ATTEMPTS'); if (sourceAttempts !== destAttempts) mismatches.push('ATTEMPTS_CHANGED'); }
    var sourcePoints = src.settings && src.settings.points != null && src.settings.points !== '' && Number.isFinite(Number(src.settings.points)) ? Number(src.settings.points) : null;
    var destPoints = dst.settings && dst.settings.points != null && dst.settings.points !== '' && Number.isFinite(Number(dst.settings.points)) ? Number(dst.settings.points) : null;
    if (sourcePoints != null && destPoints != null) { compared.push('POINTS'); if (Math.abs(sourcePoints-destPoints) > 0.001) mismatches.push('POINTS_CHANGED'); }

    if (mismatches.length) return { status:'MUTATED', comparable:true, mismatches:mismatches, issues:mismatches.slice(), compared:compared, source:src, coursera:dst, reason:'One or more explicitly observed learner-behavior settings differ between source LMS and Coursera.' };
    if (!compared.length) return { status:'UNVERIFIED', comparable:true, mismatches:[], issues:[], compared:[], reason:'Behavior objects exist, but no directly comparable portable behavior dimension was observed on both sides.' };
    return { status:'VERIFIED', comparable:true, mismatches:[], issues:[], compared:compared, source:src, coursera:dst, reason:'Observed portable learner-behavior settings are compatible.' };
}

function qaRuntimeReview_(source, coursera) {
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


function qaExternalRuntimeEvidenceForPackage_(packageMeta) {
    packageMeta = packageMeta || {};
    var partner = String(packageMeta.partner || '');
    var fileName = String(packageMeta.fileName || '');
    var out = { checked:false, required:false, riseCount:0, storylineCount:0, source:'', warning:'', titleKey:getMatchKey_(fileName) };
    try {
        if (normalizePartnerName_(partner) !== normalizePartnerName_(CTI_WORK_SOURCE_CONFIG_.nait.partner)) return out;
        out.checked = true;
        out.source = 'NAIT SCORM/Rise inventory';
        var idx = workBuildScormIndex_();
        if (idx && idx._error) out.warning = String(idx._error || '');
        var rec = idx && out.titleKey ? idx[out.titleKey] : null;
        if (!rec) return out;
        out.riseCount = Number(rec.riseCount || 0);
        out.storylineCount = Number(rec.storylineCount || 0);
        out.linkLabel = String(rec.linkLabel || '');
        out.required = (out.riseCount + out.storylineCount) > 0;
        out.courseCode = String(rec.courseCode || '');
        out.title = String(rec.title || '');
        return out;
    } catch (e) {
        out.checked = true;
        out.warning = String(e && e.message || e);
        return out;
    }
}

function qaApplyExternalRuntimePolicy_(operationalPolicy, externalRuntimeEvidence) {
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

function qaBuildHiddenDependencyResult_(source, courseraEvidenceItems, snapshotContext) {
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

function qaCourseLevelFailure_(sourceItems, courseraItems, partnerName) {
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