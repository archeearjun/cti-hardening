

function qaNativeRubricAnchorEvidence_(doc, coursera) {
    var nativeAssignment = coursera && coursera.nativeAssignment;
    if (!nativeAssignment || !Array.isArray(nativeAssignment.rubrics) || !nativeAssignment.rubrics.length) {
        return { verified: false, score: 0, criterionCoverage: 0, labelCoverage: 0, matchedCriteria: 0, totalCriteria: 0 };
    }
    var sourceText = qaAssessmentText_([doc && doc.textSample || ''].concat((doc && doc.pdfPageSamples || []).map(function(s) { return s && s.text || ''; })).join(' '));
    if (sourceText.length < 80) return { verified: false, score: 0, criterionCoverage: 0, labelCoverage: 0, matchedCriteria: 0, totalCriteria: 0 };

    var criteria = [], labels = [];
    nativeAssignment.rubrics.forEach(function(r) {
        var c = qaCleanText_(r && (r.criterionTitle || r.title) || '');
        if (c && !/^rubric\s*\d*$/i.test(c)) criteria.push(c);
        (r && r.levels || []).forEach(function(level) {
            var label = qaCleanText_(level && level.label || '');
            if (label) labels.push(label);
        });
    });
    criteria = criteria.filter(function(v, i, a) { return a.indexOf(v) === i; });
    labels = labels.filter(function(v, i, a) { return a.indexOf(v) === i; });

    function present(needle) {
        var n = qaAssessmentText_(needle);
        if (!n) return false;
        if (sourceText.toLowerCase().indexOf(n.toLowerCase()) > -1) return true;
        return qaAssessmentFieldSimilarity_(n, sourceText) >= 0.90;
    }
    var matchedCriteria = criteria.filter(present).length;
    var matchedLabels = labels.filter(present).length;
    var criterionCoverage = criteria.length ? matchedCriteria / criteria.length : 0;
    var labelCoverage = labels.length ? matchedLabels / labels.length : 0;
    var score = (criterionCoverage * 0.82) + (labelCoverage * 0.18);
    // Criterion identity carries the proof. Generic performance labels can support
    // it but can never establish transformation on their own.
    var verified = criteria.length >= 2 && criterionCoverage >= 0.67 && score >= 0.72;
    return {
        verified: verified,
        score: score,
        criterionCoverage: criterionCoverage,
        labelCoverage: labelCoverage,
        matchedCriteria: matchedCriteria,
        totalCriteria: criteria.length,
        matchedLabels: matchedLabels,
        totalLabels: labels.length
    };
}

function qaNativeTransformationComparison_(source, coursera) {
    var base = {
        mode: 'SOURCE_DOCUMENT_TO_NATIVE', status: 'NOT_APPLICABLE', confidence: 0,
        expectedDocumentCount: 0, documentsWithText: 0, transformedCount: 0,
        documents: [], transformedAssetKeys: {}, changedAssetKeys: {}, rubricMismatchCount: 0, rubricCount: 0, reason: '',
        sourceEvidenceSchemaVersion: Number(source && source.sourceEvidenceSchemaVersion || 0),
        sourceEvidenceExtractor: qaCleanText_(source && source.sourceEvidenceExtractor || ''),
        sourceEvidenceBuildId: qaCleanText_(source && source.sourceEvidenceBuildId || ''),
        sourceRefreshRequired: false, pdfExtractionFailureCount: 0, pdfTextMissingCount: 0, pdfEvidenceMappingFailureCount: 0, ignoredSourceReferenceCount: 0, ignoredSourceReferences: []
    };
    if (!source || !coursera || normalizeCourseraType_(source.type) !== 'Assignment' || normalizeCourseraType_(coursera.type) !== 'Assignment') return base;

    var pdfSet = qaSourcePdfComparisonSet_(source.assetDetails || []);
    var sourcePdfs = pdfSet.documents;
    base.ignoredSourceReferenceCount = pdfSet.ignoredReferences.length;
    base.ignoredSourceReferences = pdfSet.ignoredReferences.map(function(d) { return d.name || d.href || d.path || 'PDF reference'; });
    if (!sourcePdfs.length) return base;
    base.expectedDocumentCount = sourcePdfs.length;

    var nativeAssignment = coursera.nativeAssignment || null;
    var promptTarget = qaNativePromptSemanticText_(coursera);
    var rubricTarget = qaNativeRubricSemanticText_(coursera);
    var combinedTarget = qaNativeAssignmentSemanticText_(coursera);
    var hasNativeSignals = !!(nativeAssignment && (
        Number(nativeAssignment.rubricCount || 0) > 0 ||
        (nativeAssignment.submission && (nativeAssignment.submission.fileUpload || nativeAssignment.submission.aiGraded || nativeAssignment.submission.peerGraded)) ||
        nativeAssignment.prompt || nativeAssignment.directions || nativeAssignment.expectations ||
        promptTarget.length >= 120
    ));
    if (!hasNativeSignals || combinedTarget.length < 120) {
        base.status = 'UNVERIFIED';
        base.reason = 'Source PDF assets exist, but a sufficiently structured native Coursera Assignment surface was not captured.';
        return base;
    }

    base.rubricCount = Number(nativeAssignment.rubricCount || (nativeAssignment.rubrics || []).length || 0);
    var confidenceSum = 0;
    sourcePdfs.forEach(function(doc) {
        var text = qaAssessmentText_(doc.textSample || '');
        var name = String(doc.name || '').toLowerCase();
        var role = /rubric|grading/.test(name) ? 'rubric' : (/assessment|assignment|instruction|direction/.test(name) ? 'assignment' : 'document');
        var parser = qaCleanText_(doc.pdfParser || '');
        var docInfo = {
            name: doc.name || doc.url || 'PDF',
            role: role,
            similarity: null,
            status: 'UNVERIFIED',
            nativeSurface: role === 'rubric' ? ('native rubric (' + base.rubricCount + ' rubric(s))') : 'native assignment prompt/submission',
            pdfParser: parser,
            pdfPageCount: Number(doc.pdfPageCount || 0),
            pdfPagesRead: Number(doc.pdfPagesRead || 0),
            pdfReadError: qaCleanText_(doc.pdfReadError || ''),
            pdfSampleStrategy: qaCleanText_(doc.pdfSampleStrategy || ''),
            sampledPageCount: Array.isArray(doc.pdfPageSamples) ? doc.pdfPageSamples.length : 0,
            bestSemanticPage: 0,
            semanticForward: 0,
            semanticReverse: 0,
            rubricAnchors: null,
            reason: ''
        };

        if (text.length < 120) {
            base.pdfTextMissingCount++;
            var parserKey = String(parser || '').toLowerCase();
            if (base.sourceEvidenceSchemaVersion > 0 && base.sourceEvidenceSchemaVersion < 5) {
                base.sourceRefreshRequired = true;
                docInfo.reason = 'Stored source fingerprint predates the PDF-parser lineage. Re-scan/update the source IMSCC with source schema 6; the existing Coursera fingerprint can be reused.';
            } else if (parserKey === 'skipped-size') {
                base.pdfExtractionFailureCount++;
                docInfo.reason = 'Source PDF semantic extraction was intentionally skipped because the document exceeded the bounded extraction size limit.';
            } else if (parserKey === 'skipped-budget') {
                base.pdfExtractionFailureCount++;
                docInfo.reason = 'Source PDF semantic extraction was intentionally skipped because the bounded source PDF page budget had been exhausted.';
            } else if (parserKey === 'unavailable' || parserKey === 'error' || docInfo.pdfReadError) {
                base.pdfExtractionFailureCount++;
                docInfo.reason = 'The current source scanner attempted this PDF, but text could not be recovered' + (docInfo.pdfReadError ? (': ' + docInfo.pdfReadError) : '.');
            } else if (!parser) {
                base.pdfEvidenceMappingFailureCount++;
                docInfo.reason = base.sourceEvidenceSchemaVersion >= 5
                    ? 'Current source-evidence schema is present, but this asset has no PDF parser marker. This indicates an evidence-association/mapping gap rather than proof of content loss.'
                    : 'No source PDF parser evidence is stored; source-evidence lineage is insufficient to determine whether extraction was attempted.';
            } else {
                docInfo.reason = 'The PDF parser ran, but no sufficiently long extractable text was recovered; this may be an image-only/scanned PDF.';
            }
            base.documents.push(docInfo);
            return;
        }

        base.documentsWithText++;
        var roleTarget = role === 'rubric' ? rubricTarget : (role === 'assignment' ? promptTarget : combinedTarget);
        var roleSignal = role === 'rubric'
            ? (base.rubricCount > 0 && rubricTarget.length >= 120)
            : (!!(nativeAssignment.submission && nativeAssignment.submission.fileUpload) || promptTarget.length >= 120 || !!coursera.structuredAssessment);
        var semanticMatch = roleTarget.length >= 120 ? qaBestDocumentSemanticMatch_(doc, roleTarget) : { score: 0, forward: 0, reverse: 0, page: 0, kind: '' };
        var similarity = Number(semanticMatch.score || 0);
        var rubricAnchors = role === 'rubric' ? qaNativeRubricAnchorEvidence_(doc, coursera) : { verified:false, score:0, criterionCoverage:0 };
        var transformed = roleSignal && (similarity >= 0.62 || rubricAnchors.verified === true);
        var parserKeyForMismatch = String(parser || '').toLowerCase();
        var sourcePdfFullyObserved = Number(doc.pdfPageCount || 0) > 0 && Number(doc.pdfPagesRead || 0) >= Number(doc.pdfPageCount || 0);
        var nativeRubricFullyObserved = role === 'rubric' && base.rubricCount > 0 && rubricTarget.length >= 250 && Number(nativeAssignment && nativeAssignment.parserConfidence || 0) >= 0.90;
        // v6.5.8: when both sides are strongly observed, very low semantic overlap
        // plus near-zero criterion identity is positive evidence of rubric content
        // change. This is not an extraction failure and must not be called missing.
        var rubricContentChanged = !transformed && role === 'rubric' && /^pdfjs/.test(parserKeyForMismatch) &&
            sourcePdfFullyObserved && nativeRubricFullyObserved && text.length >= 200 &&
            similarity < 0.45 && Number(rubricAnchors.criterionCoverage || 0) < 0.34;
        var key = qaAssetKey_(doc.name || doc.url || '');
        if (transformed && key) base.transformedAssetKeys[key] = true;
        if (rubricContentChanged && key) base.changedAssetKeys[key] = true;
        if (transformed) base.transformedCount++;
        if (rubricContentChanged) base.rubricMismatchCount++;
        confidenceSum += similarity;

        docInfo.similarity = Number(similarity.toFixed(3));
        docInfo.bestSemanticPage = Number(semanticMatch.page || 0);
        docInfo.semanticForward = Number(Number(semanticMatch.forward || 0).toFixed(3));
        docInfo.semanticReverse = Number(Number(semanticMatch.reverse || 0).toFixed(3));
        docInfo.rubricAnchors = role === 'rubric' ? {
            verified: rubricAnchors.verified === true,
            score: Number(Number(rubricAnchors.score || 0).toFixed(3)),
            matchedCriteria: Number(rubricAnchors.matchedCriteria || 0),
            totalCriteria: Number(rubricAnchors.totalCriteria || 0),
            matchedLabels: Number(rubricAnchors.matchedLabels || 0),
            totalLabels: Number(rubricAnchors.totalLabels || 0)
        } : null;
        docInfo.status = transformed ? 'TRANSFORMED' : (rubricContentChanged ? 'CONTENT_CHANGED' : 'UNVERIFIED');
        docInfo.reason = transformed
            ? (rubricAnchors.verified === true && similarity < 0.62
                ? 'Source rubric criterion identities are positively present in the native Coursera rubric structure.'
                : 'Source document semantics are positively present on the expected native Coursera surface.')
            : (rubricContentChanged
                ? 'Both source and native rubric surfaces are strongly observed, but semantic overlap is low and fewer than one-third of native criterion identities are present in the source rubric. Treat this as a rubric-content change requiring review, not an extraction gap.'
                : 'The correct native surface was captured, but neither page-aware semantic overlap nor role-specific structural anchors are strong enough to prove this document was transformed.');
        base.documents.push(docInfo);
    });

    base.confidence = base.documentsWithText ? confidenceSum / base.documentsWithText : 0;
    if (base.documentsWithText === sourcePdfs.length && base.transformedCount === sourcePdfs.length) {
        base.status = 'VERIFIED';
        base.reason = 'Every source PDF has bounded text evidence and is positively matched to its role-specific native Coursera Assignment/rubric surface.';
    } else if (base.transformedCount > 0 || base.rubricMismatchCount > 0) {
        base.status = 'PARTIAL';
        base.reason = base.rubricMismatchCount > 0
            ? 'At least one source document is positively represented natively, while a fully observed source rubric materially differs from the captured native rubric structure.'
            : 'At least one source PDF is positively represented as native Coursera content, but one or more source documents remain unverified.';
    } else if (base.sourceRefreshRequired) {
        base.status = 'UNVERIFIED';
        base.reason = 'The stored source package fingerprint predates the PDF-parser lineage. Refresh the source IMSCC with source schema 6; do not treat these PDFs as missing.';
    } else if (base.pdfEvidenceMappingFailureCount > 0) {
        base.status = 'UNVERIFIED';
        base.reason = 'Current source-evidence lineage is present, but one or more Assignment PDF descriptors lost their parser/text evidence while being associated to the source item. This is an evidence-mapping limitation, not proof of content loss.';
    } else if (base.pdfExtractionFailureCount > 0) {
        base.status = 'UNVERIFIED';
        base.reason = 'Native Coursera Assignment/rubric evidence exists, but one or more source PDFs could not yield extractable text. This is an evidence-extraction limitation, not proof of content loss.';
    } else {
        base.status = 'UNVERIFIED';
        base.reason = base.documentsWithText < sourcePdfs.length
            ? 'Source PDF text evidence is incomplete; do not decide whether the files were lost or converted.'
            : 'Native Coursera Assignment evidence exists, but semantic overlap is not strong enough to prove conversion.';
    }
    return base;
}

function qaQuestionMediaAction_(assessment) {
    assessment=assessment||{};
    var actions=[],gaps=assessment.sourcePackageMediaGaps||[];
    function numbers(status){return gaps.filter(function(g){return g.status===status;}).map(function(g){return g.question;}).filter(function(v,i,a){return a.indexOf(v)===i;}).join(', ');}
    var absent=numbers('NOT_IN_PACKAGE'),mislocated=numbers('PRESENT_DIFFERENT_PATH');
    if(absent)actions.push('Recover referenced images for source question(s) '+absent+' from the source LMS or owner: those files are absent from the package. Repeating ingestion cannot supply them.');
    if(mislocated)actions.push('Verify and repair image references for source question(s) '+mislocated+': matching filenames exist at different package paths.');
    if((assessment.sourceMediaQuestionNumbers||[]).length)actions.push('Check destination rendering for question media; aligned prompts do not verify images.');
    return actions.join(' ');
}

// Revalidate identity and the empty-editor receipt before using it to distinguish
// an observed destination state from a failed question capture.
function qaConfirmedEmptyComparison_(result) {
    var q=result && result.checks && result.checks.structuredAssessment;
    if(!q || q.destinationContentState!=='OBSERVED_EMPTY_EDITOR' ||
        Number(q.courseraQuestionCount)!==0 || Number(q.courseraDeclaredQuestionCount)!==0 ||
        Number(q.alignedQuestionCount)!==0 || (q.questionResults||[]).length)return null;
    return qaObservedEmptyAssessmentReceipt_({id:result.courseraId,type:'Assignment',emptyEditorEvidence:q.destinationEmptyEvidence});
}

function qaAssessmentAnswerOnlyGap_(q) {
    return !!(q && q.status==='UNVERIFIED' && Number(q.sourceQuestionCount)>0 &&
        Number(q.sourceQuestionCount)===Number(q.courseraQuestionCount) &&
        Number(q.alignedQuestionCount)===Number(q.sourceQuestionCount) &&
        Number(q.sourceDeclaredQuestionCount)>0 && Number(q.sourceDeclaredQuestionCount)<=Number(q.sourceQuestionCount) &&
        Number(q.courseraDeclaredQuestionCount)>0 && Number(q.courseraDeclaredQuestionCount)<=Number(q.courseraQuestionCount) &&
        q.declaredCaptureIncomplete===false && q.answerEvidenceApplicable!==false &&
        q.answerEvidenceCoverage!=null && Number(q.answerEvidenceCoverage)>=0 && Number(q.answerEvidenceCoverage)<0.99 &&
        Number(q.hardMismatchCount)===0 && Number(q.unknownTypeCount)===0 &&
        Number(q.fidelity)>=0.90 && Number(q.evidenceCoverage)>=0.55 &&
        Number(q.sourceParserConfidence)>=0.80 && Number(q.courseraParserConfidence)>=0.80 &&
        ['VERIFIED','NOT_OBSERVED'].indexOf(q.selectionPolicyStatus)>-1 &&
        !(q.captureIssueQuestionNumbers||[]).length && !(q.sourceMediaQuestionNumbers||[]).length &&
        q.sourceAnswerRefreshRequired!==true);
}