

function qaStructuredAssessmentComparison_(source, coursera) {
    if (!source || source.isStructuredAssessment !== true) return null;
    var sAssessment = qaNormalizeAssessment_(source.structuredAssessment, 'source-qti');
    var cAssessment = qaNormalizeAssessment_(coursera && coursera.structuredAssessment, 'coursera-assignment');
    var base = {
        mode: 'STRUCTURED_ASSESSMENT',
        status: 'UNVERIFIED',
        similarity: null,
        fidelity: null,
        evidenceCoverage: 0,
        sourceQuestionCount: sAssessment ? sAssessment.questionCount : 0,
        courseraQuestionCount: cAssessment ? cAssessment.questionCount : 0,
        sourceDeclaredQuestionCount:sAssessment?sAssessment.declaredQuestionCount:0,
        courseraDeclaredQuestionCount:cAssessment?cAssessment.declaredQuestionCount:0,
        sourceDefinitionCoverage:sAssessment?sAssessment.definitionCoverage:null,
        courseraDefinitionCoverage:cAssessment?cAssessment.definitionCoverage:null,
        definitionCoverageUnverified:!!((sAssessment && sAssessment.definitionCoverage && sAssessment.definitionCoverage.completenessVerified!==true) || (cAssessment && cAssessment.definitionCoverage && cAssessment.definitionCoverage.completenessVerified!==true)),
        alignedQuestionCount: 0,
        answerMismatchCount: 0,
        answerEvidenceCoverage: 0,
        sourceAnswerEvidenceQuestionCount: sAssessment ? Number(sAssessment.answerEvidenceQuestionCount || 0) : 0,
        courseraAnswerEvidenceQuestionCount: cAssessment ? Number(cAssessment.answerEvidenceQuestionCount || 0) : 0,
        sourceAnswerableQuestionCount: sAssessment ? Number(sAssessment.answerableQuestionCount || 0) : 0,
        courseraAnswerableQuestionCount: cAssessment ? Number(cAssessment.answerableQuestionCount || 0) : 0,
        sourceSelectionPolicy: sAssessment ? sAssessment.selectionPolicy : null,
        courseraSelectionPolicy: cAssessment ? cAssessment.selectionPolicy : null,
        selectionPolicyStatus: 'NOT_OBSERVED',
        questionResults: [],
        sourceParserConfidence: sAssessment ? sAssessment.parserConfidence : 0,
        courseraParserConfidence: cAssessment ? cAssessment.parserConfidence : 0,
        reason: ''
    };

    base.answerEvidenceApplicable=!(sAssessment && cAssessment && sAssessment.questions.length && cAssessment.questions.length && sAssessment.questions.concat(cAssessment.questions).every(function(q){return q.type==='essay';}));
    base.sourceMediaQuestionNumbers=sAssessment?sAssessment.questions.map(function(q,i){return q.mediaRefs&&q.mediaRefs.length?i+1:null;}).filter(Boolean):[];
    base.questionMediaStatus=base.sourceMediaQuestionNumbers.length?'UNVERIFIED':'NOT_RECORDED_OR_NOT_REQUIRED';
    base.sourcePackageMediaGaps=[];if(sAssessment)sAssessment.questions.forEach(function(q,i){(q.mediaPresence||[]).forEach(function(m){if(m.status==='NOT_IN_PACKAGE'||m.status==='PRESENT_DIFFERENT_PATH')base.sourcePackageMediaGaps.push({question:i+1,status:m.status,ref:m.ref,expectedPath:m.expectedPath,candidates:m.candidates||[]});});});
    if (!sAssessment) {
        base.reason = 'Source QTI question structure is not stored in this package fingerprint. Re-process/update the source IMSCC once with v6.5.3; the existing Coursera fingerprint can be reused.';
        return base;
    }
    if (!cAssessment) {
        var emptyReceipt=qaObservedEmptyAssessmentReceipt_(coursera);
        if(emptyReceipt) {
            base.destinationContentState='OBSERVED_EMPTY_EDITOR';
            base.destinationEmptyEvidence=emptyReceipt;
            base.courseraDeclaredQuestionCountObserved=true;
            base.questionCountMatch=false;
            base.reason='The exact Coursera assignment outline and body were empty in two stable observations. The matched source contains '+base.sourceQuestionCount+' question definitions. Review their intended destination and whether they were moved or intentionally excluded; this receipt confirms an empty editor, not a question-extraction failure or course-wide deletion.';
            return base;
        }
        base.reason = 'Coursera Assignment question structure could not be derived from the captured authoring evidence.';
        return base;
    }

    // Reserve unique exact prompts before a weaker boilerplate overlap can take them.
    var sourcePromptKeys=Object.create(null),destinationPromptKeys=Object.create(null),reserved=Object.create(null);
    sAssessment.questions.forEach(function(q,i){var k=qaAssessmentText_(q.prompt).toLowerCase();if(k)(sourcePromptKeys[k]||(sourcePromptKeys[k]=[])).push(i);});
    cAssessment.questions.forEach(function(q,i){var k=qaAssessmentText_(q.prompt).toLowerCase();if(k)(destinationPromptKeys[k]||(destinationPromptKeys[k]=[])).push(i);});
    Object.keys(sourcePromptKeys).forEach(function(k){if(sourcePromptKeys[k].length===1&&destinationPromptKeys[k]&&destinationPromptKeys[k].length===1)reserved[destinationPromptKeys[k][0]]=sourcePromptKeys[k][0];});
    var used = {}, aligned = [], unmatchedSource = [];
    for (var i = 0; i < sAssessment.questions.length; i++) {
        var sq = sAssessment.questions[i];
        var best = -1, bestScore = 0;
        for (var j = 0; j < cAssessment.questions.length; j++) {
            if (used[j] || (Object.prototype.hasOwnProperty.call(reserved,j)&&reserved[j]!==i)) continue;
            var promptScore = qaQuestionPromptSimilarity_(sq.prompt, cAssessment.questions[j].prompt);
            // Preserve order as a weak tie-breaker but never force an alignment.
            if (i === j) promptScore += 0.025;
            if (promptScore > bestScore) { bestScore = promptScore; best = j; }
        }
        if (best >= 0 && bestScore >= 0.48) {
            used[best] = true;
            var qr = qaCompareAssessmentQuestion_(sq, cAssessment.questions[best]);
            qr.sourceIndex = i + 1;
            qr.courseraIndex = best + 1;
            qr.alignmentSimilarity = Math.min(1, bestScore);
            aligned.push(qr);
        } else unmatchedSource.push(i + 1);
    }

    var unmatchedCoursera = [];
    for (var c = 0; c < cAssessment.questions.length; c++) if (!used[c]) unmatchedCoursera.push(c + 1);
    base.alignedQuestionCount = aligned.length;
    base.questionResults = aligned;
    base.unmatchedSourceQuestions = unmatchedSource;
    base.unmatchedCourseraQuestions = unmatchedCoursera;
    base.questionCountMatch = sAssessment.questionCount === cAssessment.questionCount;

    if (!aligned.length) {
        base.reason = 'No source QTI questions could be confidently aligned to Coursera Assignment questions.';
        return base;
    }

    var weightedScore = 0, weightedCoverage = 0, answerMismatches = 0, hardMismatches = 0;
    aligned.forEach(function(qr) {
        var w = Math.max(0.35, qr.coverage);
        weightedScore += qr.score * w;
        weightedCoverage += w;
        if (qr.mismatches.indexOf('CORRECT_ANSWER') > -1 || qr.mismatches.indexOf('CORRECT_ANSWER_COUNT') > -1) answerMismatches++;
        if (qr.mismatches.indexOf('PROMPT') > -1 || qr.mismatches.indexOf('TYPE') > -1 || qr.mismatches.indexOf('OPTION_COUNT') > -1 || qr.mismatches.indexOf('OPTIONS') > -1 || qr.mismatches.indexOf('CORRECT_ANSWER') > -1 || qr.mismatches.indexOf('CORRECT_ANSWER_COUNT') > -1 || qr.mismatches.indexOf('POINTS') > -1) hardMismatches++;
    });
    base.declaredCaptureIncomplete=sAssessment.declaredQuestionCount>sAssessment.questionCount || cAssessment.declaredQuestionCount>cAssessment.questionCount;
    var structuralCoverage = aligned.length / Math.max(sAssessment.questionCount,cAssessment.questionCount,sAssessment.declaredQuestionCount,cAssessment.declaredQuestionCount,1);
    var fieldCoverage = aligned.reduce(function(sum, q) { return sum + q.coverage; }, 0) / aligned.length;
    var coverage = structuralCoverage * fieldCoverage;
    var fidelity = weightedCoverage ? weightedScore / weightedCoverage : 0;
    if (!base.questionCountMatch) fidelity *= 0.90;
    base.fidelity = fidelity;
    base.similarity = fidelity;
    base.evidenceCoverage = coverage;
    base.answerMismatchCount = answerMismatches;
    base.hardMismatchCount = hardMismatches;
    base.captureIssueQuestionNumbers=aligned.filter(function(q){return q.details.optionCaptureIssue;}).map(function(q){return q.courseraIndex;});
    var sourceAnswerCoverage = sAssessment.answerableQuestionCount ? (sAssessment.answerEvidenceQuestionCount / sAssessment.answerableQuestionCount) : 1;
    var courseraAnswerCoverage = cAssessment.answerableQuestionCount ? (cAssessment.answerEvidenceQuestionCount / cAssessment.answerableQuestionCount) : 1;
    base.answerEvidenceCoverage = Math.min(sourceAnswerCoverage, courseraAnswerCoverage);
    base.sourceAnswerRefreshRequired = /^ims-qti-dom(?:-v[12](?:-|$)|$)/.test(String(sAssessment.parser || '').toLowerCase()) &&
        sAssessment.questions.some(function(q) { return q.type === 'multiple-select' && q.answerTextReliable === false; });

    var sp = sAssessment.selectionPolicy || { observed:false }, cp = cAssessment.selectionPolicy || { observed:false };
    if (sp.observed === true && cp.observed === true) {
        var selectOk = (sp.selectCount == null || cp.selectCount == null || Number(sp.selectCount) === Number(cp.selectCount));
        var poolOk = (sp.poolSize == null || cp.poolSize == null || Number(sp.poolSize) === Number(cp.poolSize));
        var randomOk = (sp.randomSelection == null || cp.randomSelection == null || sp.randomSelection === cp.randomSelection);
        var policyGap=['selectCount','poolSize','randomSelection'].some(function(k){return (sp[k]==null)!==(cp[k]==null);});
        var comparedPolicy=['selectCount','poolSize','randomSelection'].some(function(k){return sp[k]!=null&&cp[k]!=null;});
        base.selectionPolicyStatus = !(selectOk&&poolOk&&randomOk)?'MUTATED':(policyGap||!comparedPolicy?'UNVERIFIED':'VERIFIED');
        if (!(selectOk && poolOk && randomOk)) {
            base.selectionPolicyMismatch = true;
            base.selectionPolicyReason = 'Source and Coursera question-pool/random-selection behavior differ.';
            hardMismatches++;
        }
    } else if (sp.observed === true || cp.observed === true) {
        base.selectionPolicyStatus = 'UNVERIFIED';
        base.selectionPolicyReason = 'Question-pool behavior was observed on only one side.';
    }
    base.hardMismatchCount = hardMismatches;

    var bothParsersStrong = sAssessment.parserConfidence >= 0.80 && cAssessment.parserConfidence >= 0.80;
    var supportedTypes = { 'true-false':true, 'single-select':true, 'multiple-select':true, 'regex':true, 'text-entry':true, 'essay':true };
    var unknownTypeCount = sAssessment.questions.filter(function(q) { return !supportedTypes[String(q.type || '')]; }).length + cAssessment.questions.filter(function(q) { return !supportedTypes[String(q.type || '')]; }).length;
    base.unknownTypeCount = unknownTypeCount;
    if (coverage < 0.55 || !bothParsersStrong) {
        base.status = 'UNVERIFIED';
        base.reason = 'Question-level evidence exists, but structured coverage/parser confidence is not strong enough for a hard verdict.';
    } else if (base.selectionPolicyStatus === 'MUTATED' && coverage >= 0.55) {
        base.status = 'CHANGED';
        base.reason = 'Structured assessment content may align, but the question-pool/random-selection behavior changed.';
    } else if (hardMismatches > 0 && coverage >= 0.72) {
        base.status = 'CHANGED';
        base.reason = answerMismatches ? 'Structured comparison found one or more correct-answer mismatches.' : 'Structured comparison found a material prompt, type, option, or points mismatch.';
    } else if(base.captureIssueQuestionNumbers.length) {
        base.status='UNVERIFIED';
        base.reason='Question count and prompts are captured, but answer/feedback boundaries are unresolved for Coursera question(s) '+base.captureIssueQuestionNumbers.join(', ')+'. Refresh the capture with the current extractor or inspect those fields. No answer change is established by contaminated text.';
    } else if(base.definitionCoverageUnverified) {
        base.status='UNVERIFIED';
        base.reason='Captured question fields can be compared, but the source/destination definition total remains unverified. Matching captured subsets do not establish complete assessment coverage. Reuse the original package question definitions where available; another identical Coursera capture cannot establish the source total.';
    } else if(base.declaredCaptureIncomplete || base.selectionPolicyStatus==='UNVERIFIED') {
        base.status='UNVERIFIED';
        base.reason=base.declaredCaptureIncomplete?'Captured questions do not cover the declared assessment size. Matching captured subsets do not verify the unobserved questions.':'Question-pool behavior lacks comparable evidence on both sides. No behavior change is established solely by this gap.';
    } else if (unknownTypeCount > 0) {
        base.status = 'UNVERIFIED';
        base.reason = 'At least one question type is not yet semantically supported by the structured verifier; a hard assessment verdict would be unsafe.';
    } else if (base.questionCountMatch && unmatchedSource.length === 0 && unmatchedCoursera.length === 0 && base.answerEvidenceCoverage >= 0.99 && fidelity >= 0.90 && base.selectionPolicyStatus !== 'MUTATED' && !(sp.observed === true && base.selectionPolicyStatus === 'UNVERIFIED')) {
        base.status = 'VERIFIED';
        base.reason = 'Source QTI questions align to the Coursera Assignment with matching question count, answer evidence for every answerable question, and no detected material mismatch.';
    } else if (base.answerEvidenceCoverage < 0.99 && base.questionCountMatch && unmatchedSource.length === 0 && unmatchedCoursera.length === 0 && hardMismatches === 0 && fidelity >= 0.90) {
        base.status = 'UNVERIFIED';
        base.reason = 'All observed question fields align, but correct-answer evidence is incomplete. No assessment change is proven. Confirm whether answer keys apply to this activity and obtain any required missing answer evidence before verification.';
    } else if (base.answerEvidenceCoverage < 0.90) {
        base.status = 'UNVERIFIED';
        base.reason = 'Question structure aligns, but correct-answer evidence is incomplete; a hard assessment verdict would be unsafe.';
    } else if (fidelity >= 0.70) {
        base.status = 'DRIFT';
        base.reason = 'The assessment is substantially aligned, but question count, prompt/type/options, or scoring details show meaningful drift.';
    } else if (coverage >= 0.75 && bothParsersStrong) {
        base.status = 'CHANGED';
        base.reason = 'Structured assessment fields differ materially across the aligned questions.';
    } else {
        base.status = 'UNVERIFIED';
        base.reason = 'Structured differences were observed, but coverage is not sufficient for a hard changed verdict.';
    }
    if(base.sourceMediaQuestionNumbers.length){
        if(base.status==='VERIFIED')base.status='UNVERIFIED';
        base.reason+=' Source question(s) '+base.sourceMediaQuestionNumbers.join(', ')+' depend on images or embedded media. Prompt and answer matching does not verify those media; inspect their source availability and destination rendering.';
    }
    if(base.sourcePackageMediaGaps.length){
        var absent=base.sourcePackageMediaGaps.filter(function(m){return m.status==='NOT_IN_PACKAGE';}).map(function(m){return m.question;}).filter(function(v,i,a){return a.indexOf(v)===i;});
        var movedMedia=base.sourcePackageMediaGaps.filter(function(m){return m.status==='PRESENT_DIFFERENT_PATH';}).map(function(m){return m.question;}).filter(function(v,i,a){return a.indexOf(v)===i;});
        if(absent.length)base.reason+=' Referenced media for source question(s) '+absent.join(', ')+' are absent from the package. Recover them from the source LMS or owner; repeating ingestion cannot supply absent package files.';
        if(movedMedia.length)base.reason+=' Source question(s) '+movedMedia.join(', ')+' reference a path that does not resolve, while matching filenames exist elsewhere in the package; verify and repair the reference mapping.';
    }
    if (base.sourceAnswerRefreshRequired) {
        if (base.status === 'VERIFIED') base.status = 'UNVERIFIED';
        base.reason += ' Stored multi-select answer keys came from a legacy QTI parser that did not preserve negated conditions. Re-scan the original IMSCC with the current source scanner to verify those answer keys; this is a source-evidence refresh, not Coursera re-ingestion.';
    }
    return base;
}

function qaBestSemanticSourceField_(sourceText, targetText, destinationScopeKind) {
    sourceText = qaCleanText_(sourceText || '');
    targetText = qaCleanText_(targetText || '');
    destinationScopeKind = qaCleanText_(destinationScopeKind || '');
    var supported = destinationScopeKind === 'assignment-learner-body' || destinationScopeKind === 'discussion-prompt';
    var base = {
        used:false,
        inferred:false,
        exactContainment:false,
        kind:'whole-source-item',
        text:sourceText,
        similarity:0,
        directionalCoverage:0,
        reverseCoverage:0,
        lexicalSimilarity:0,
        ngramSimilarity:0,
        confidence:0,
        targetTokenCoverage:0,
        reason:''
    };
    if (!supported || sourceText.length < 100 || targetText.length < 40) return base;

    var targetSemanticTokens = qaSemanticTokenList_(targetText);
    var distinct = Object.create(null);
    targetSemanticTokens.forEach(function(t){ distinct[t] = true; });
    if (Object.keys(distinct).length < 8) {
        base.reason = 'Destination learner field is too lexically small/generic for safe source-field inference.';
        return base;
    }

    var sourceNorm = qaCleanName_(sourceText);
    var targetNorm = qaCleanName_(targetText);
    if (targetNorm.length >= 40 && sourceNorm.indexOf(targetNorm) !== -1) {
        return {
            used:true,
            inferred:false,
            exactContainment:true,
            kind:destinationScopeKind === 'discussion-prompt' ? 'source-discussion-prompt-match' : 'source-assignment-learner-field-match',
            text:targetText,
            similarity:1,
            directionalCoverage:1,
            reverseCoverage:1,
            lexicalSimilarity:1,
            ngramSimilarity:1,
            confidence:1,
            targetTokenCoverage:1,
            reason:'Destination learner field is exactly contained in the normalized source item body.'
        };
    }

    var sourceTokens = sourceText.split(/\s+/).filter(Boolean).slice(0, 2600);
    var targetTokens = targetText.split(/\s+/).filter(Boolean).slice(0, 1200);
    if (sourceTokens.length < 24 || targetTokens.length < 10) return base;
    // If the source is already approximately field-sized, whole-item comparison is
    // safer than choosing a destination-guided window from essentially the same body.
    if (sourceTokens.length <= Math.max(targetTokens.length * 1.45, targetTokens.length + 45)) return base;

    var sizes = [0.72, 0.90, 1.08, 1.30, 1.58, 1.95].map(function(mult){
        return Math.max(24, Math.min(sourceTokens.length, Math.round(targetTokens.length * mult)));
    }).filter(function(v, i, a){ return a.indexOf(v) === i; });
    var step = Math.max(6, Math.min(48, Math.floor(targetTokens.length / 5) || 6));
    var best = null;

    sizes.forEach(function(size){
        var starts = [];
        for (var start = 0; start + size <= sourceTokens.length; start += step) starts.push(start);
        var lastStart = Math.max(0, sourceTokens.length - size);
        if (starts.indexOf(lastStart) === -1) starts.push(lastStart);
        starts.forEach(function(start){
            var windowText = sourceTokens.slice(start, start + size).join(' ');
            if (windowText.length < 80) return;
            var directional = qaDirectionalSemanticSimilarity_(targetText, windowText);
            var reverse = qaDirectionalSemanticSimilarity_(windowText, targetText);
            var lexical = qaJaccard_(targetText, windowText);
            var ngram = qaCharNgramCosine_(targetText, windowText, 3);
            var lengthCloseness = Math.min(targetText.length, windowText.length) / Math.max(targetText.length, windowText.length, 1);
            var windowSemanticTokens = qaSemanticTokenList_(windowText);
            var windowSet = Object.create(null);
            windowSemanticTokens.forEach(function(t){ windowSet[t] = true; });
            var targetKeys = Object.keys(distinct), tokenHits = 0;
            targetKeys.forEach(function(t){ if (windowSet[t]) tokenHits++; });
            var targetTokenCoverage = targetKeys.length ? tokenHits / targetKeys.length : 0;
            // Destination-to-source semantic token coverage is intentionally dominant:
            // source wrappers may be much larger and paraphrases often break bigrams,
            // but the distinctive learner concepts still need to co-locate in one
            // bounded source window.
            var score = (targetTokenCoverage * 0.38) + (directional * 0.22) + (reverse * 0.07) + (lexical * 0.13) + (ngram * 0.10) + (lengthCloseness * 0.10);
            if (!best || score > best.score) best = {
                score:score,
                text:windowText,
                directional:directional,
                reverse:reverse,
                lexical:lexical,
                ngram:ngram,
                targetTokenCoverage:targetTokenCoverage,
                lengthCloseness:lengthCloseness,
                start:start,
                size:size
            };
        });
    });

    if (!best || best.targetTokenCoverage < 0.34 || best.score < 0.40) {
        base.reason = 'No sufficiently distinctive source semantic window could be aligned to the destination learner field.';
        if (best) {
            base.similarity = best.score;
            base.directionalCoverage = best.directional;
            base.reverseCoverage = best.reverse;
            base.lexicalSimilarity = best.lexical;
            base.ngramSimilarity = best.ngram;
            base.targetTokenCoverage = Number(best.targetTokenCoverage || 0);
        }
        return base;
    }

    base.used = true;
    base.inferred = true;
    base.kind = destinationScopeKind === 'discussion-prompt' ? 'source-discussion-semantic-window' : 'source-assignment-semantic-window';
    base.text = best.text;
    base.similarity = best.score;
    base.directionalCoverage = best.directional;
    base.reverseCoverage = best.reverse;
    base.lexicalSimilarity = best.lexical;
    base.ngramSimilarity = best.ngram;
    base.targetTokenCoverage = Number(best.targetTokenCoverage || 0);
    base.confidence = Math.max(0, Math.min(1, (best.score * 0.50) + (best.targetTokenCoverage * 0.32) + (best.directional * 0.10) + (best.lengthCloseness * 0.08)));
    base.reason = 'Best bounded source semantic window aligned to the destination learner field; negative verdicts remain conservative because the source field was inferred semantically.';
    return base;
}
