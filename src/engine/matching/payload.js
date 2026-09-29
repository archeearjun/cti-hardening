// Maintained source: explicit dependencies; no ordered concatenation.
import { qaReadingEvidenceGap_ } from "../assessment/assignment.js";
import { qaBestSemanticSourceField_ } from "../assessment/comparison.js";
import { qaAssessmentText_, qaCharNgramCosine_, qaTextPreview_ } from "../assessment/questions.js";
import { qaDocumentScopeComparison_ } from "../source/metrics.js";
import { qaAssetKey_ } from "./assets.js";
import { qaCleanName_, qaCleanText_, qaJaccard_ } from "./text.js";

export function qaTextComparison_(source, coursera) {
    if(source&&source.sourceTextRefreshRequired) return {status:'UNVERIFIED',similarity:null,sourcePreview:'',courseraPreview:qaTextPreview_(coursera.textSample),reason:source.sourceTextNormalization.reason};
    if (source && source.contentComparable === false) {
        return { status: 'NOT_APPLICABLE', similarity: null, reason: 'Source resource is a web-link/LTI package definition; learner-facing equivalence should be judged by target/link and tool behavior, not package XML text.', sourcePreview: '', courseraPreview: '' };
    }
    var documentScope=qaDocumentScopeComparison_(source,coursera);
    if(documentScope)return documentScope;
    var readingGap=qaReadingEvidenceGap_(coursera);
    if(readingGap)return {status:'UNVERIFIED',similarity:null,reasonCode:readingGap.code,reason:readingGap.reason,sourcePreview:qaTextPreview_(source.textSample),courseraPreview:qaTextPreview_(coursera.textSample),scopeKind:coursera.textScopeKind||''};
    var originalSourceText = qaCleanText_(source.textSample);
    var sText = originalSourceText;
    var cText = qaCleanText_(coursera.textSample);
    var assignmentScoped = false;
    var nativeAssignment = coursera && coursera.nativeAssignment || null;
    if(nativeAssignment){
        var learnerOnly = qaCleanText_(nativeAssignment.learnerSemanticText || nativeAssignment.learnerPrompt || nativeAssignment.prompt || '');
        if(learnerOnly.length >= 40){
            cText = learnerOnly;
            assignmentScoped = true;
        }
    }
    var scopeKind = assignmentScoped ? 'assignment-learner-body' : qaCleanText_(coursera.textScopeKind || '');
    var sourceField = qaBestSemanticSourceField_(originalSourceText, cText, scopeKind);
    var sourceScoped = sourceField && sourceField.used === true;
    if (sourceScoped) sText = qaCleanText_(sourceField.text || sText);

    var sLen = sourceScoped ? sText.length : (source.textLength || sText.length);
    var cLen = assignmentScoped ? cText.length : (coursera.textLength || cText.length);
    var maxLen = Math.max(sLen || 0, cLen || 0, 1);
    var minLen = Math.min(sLen || 0, cLen || 0);
    var lengthRatio = minLen / maxLen;
    var completeness = assignmentScoped ? Math.max(0.92, Number(coursera.textEvidenceCompleteness || 0)) : Number(coursera.textEvidenceCompleteness || 0);
    if (!Number.isFinite(completeness) || completeness < 0) completeness = 0;
    if (completeness > 1) completeness = 1;
    // Backward-compatible inference for older fingerprints that do not carry the
    // v5.9 completeness field. Keep it conservative.
    if (!completeness && cText && coursera.textEvidenceCompletenessObserved!==true) {
        if (cLen >= 900) completeness = 0.82;
        else if (cLen >= 350 && lengthRatio >= 0.45) completeness = 0.76;
        else completeness = 0.60;
    }
    var previews = {
        sourcePreview: qaTextPreview_(sText),
        courseraPreview: qaTextPreview_(cText)
    };
    var base = {
        sourcePreview: previews.sourcePreview,
        courseraPreview: previews.courseraPreview,
        sourceLength: sLen,
        courseraLength: cLen,
        lengthRatio: lengthRatio,
        evidenceCompleteness: completeness,
        scopeKind: scopeKind,
        sourceScopeKind: sourceScoped ? sourceField.kind : 'whole-source-item',
        fieldScopedComparison: sourceScoped,
        sourceFieldSimilarity: sourceField ? Number(sourceField.similarity || 0) : 0,
        sourceFieldDirectionalCoverage: sourceField ? Number(sourceField.directionalCoverage || 0) : 0,
        sourceFieldConfidence: sourceField ? Number(sourceField.confidence || 0) : 0,
        sourceFieldTargetTokenCoverage: sourceField ? Number(sourceField.targetTokenCoverage || 0) : 0,
        sourceFieldInference: sourceField && sourceField.inferred === true,
        sourceFieldExactContainment: sourceField && sourceField.exactContainment === true
    };

    if (originalSourceText.length < 80 && Number(source.textLength || 0) < 80) {
        base.status = 'NOT_APPLICABLE';
        base.similarity = null;
        base.reason = 'No substantial source text fingerprint.';
        return base;
    }

    if (!cText || (cLen < 40 && cText.length < 40)) {
        base.status = 'UNVERIFIED';
        base.similarity = null;
        base.reason = 'Coursera did not expose enough item text for comparison.';
        return base;
    }

    var textConfidence = String(coursera.textConfidence || '').toLowerCase();
    if (textConfidence && textConfidence !== 'high') {
        base.status = 'UNVERIFIED';
        base.similarity = null;
        base.reason = 'Coursera exposed text-like metadata, but not a high-confidence item body/prompt.';
        return base;
    }

    // Whole-item hashes are valid only when both sides are still whole-item surfaces.
    if (!sourceScoped && source.textSha256 && coursera.textSha256 && source.textSha256 === coursera.textSha256) {
        base.status = 'VERIFIED';
        base.similarity = 1;
        base.lexicalSimilarity = 1;
        base.ngramSimilarity = 1;
        base.reason = 'Normalized text SHA-256 is identical.';
        return base;
    }

    // A narrow discussion prompt is compared to the corresponding source semantic
    // field, not to the full LMS wrapper/body. Exact containment is strongest, but a
    // high-confidence semantic field alignment can also provide positive evidence.
    if (scopeKind === 'discussion-prompt' && completeness >= 0.90) {
        var sourceDiscussionText = qaCleanName_(originalSourceText);
        var courseraDiscussionPrompt = qaCleanName_(cText);
        if (courseraDiscussionPrompt.length >= 40 && sourceDiscussionText.indexOf(courseraDiscussionPrompt) !== -1) {
            base.status = 'VERIFIED';
            base.similarity = 1;
            base.lexicalSimilarity = 1;
            base.ngramSimilarity = 1;
            base.promptContainment = true;
            base.reason = 'Isolated high-confidence Coursera discussion prompt is fully contained in the source Discussion body.';
            return base;
        }
        if (!sourceScoped || (sourceField.inferred && sourceField.confidence < 0.58)) {
            base.status = 'UNVERIFIED';
            base.similarity = null;
            base.promptContainment = false;
            base.reason = 'Coursera exposed an isolated high-confidence discussion prompt, but CTI could not confidently align a corresponding source prompt field; narrow prompt evidence is not used to declare content drift.';
            return base;
        }
    }

    // IMS QTI is a structured assessment representation. Flattening its XML into
    // prose and comparing it with a Coursera Assignment editor is not a valid
    // fidelity test. Structured questions/options/answers remain authoritative.
    if (source && source.isStructuredAssessment === true) {
        base.status = 'UNVERIFIED';
        base.similarity = null;
        base.reason = 'Source is IMS QTI; flat-text comparison is bypassed in favor of the question-level structured assessment check.';
        return base;
    }

    // High item-specificity is not the same thing as completeness. A single rubric
    // label, explanation field, or editor fragment must never create CONTENT_CHANGED.
    if (completeness < 0.75) {
        base.status = 'UNVERIFIED';
        base.similarity = null;
        base.reason = 'Coursera text is item-specific but incomplete; the captured fragment is not sufficient for a hard content-drift verdict.';
        return base;
    }

    var sampleA = sText.slice(0, 12000), sampleB = cText.slice(0, 12000);
    var lexical = qaJaccard_(sampleA, sampleB);
    var ngram = qaCharNgramCosine_(sampleA, sampleB, 3);
    var containment = 0;
    var shortText = sampleA.length <= sampleB.length ? sampleA : sampleB;
    var longText = sampleA.length > sampleB.length ? sampleA : sampleB;
    if (shortText.length >= 80 && longText.indexOf(shortText) > -1) {
        // Exact containment only proves full equivalence when the lengths are close.
        containment = lengthRatio >= 0.78 ? 1 : (0.52 + (0.35 * lengthRatio));
    }

    var similarity = Math.max(containment, (lexical * 0.58) + (ngram * 0.42));
    // For inferred field alignment, destination->source semantic coverage is useful
    // positive evidence but cannot manufacture a negative verdict on its own.
    if (sourceScoped) similarity = Math.max(similarity, Math.min(1, (sourceField.targetTokenCoverage * 0.50) + (sourceField.directionalCoverage * 0.28) + (sourceField.similarity * 0.22)));
    base.similarity = similarity;
    base.lexicalSimilarity = lexical;
    base.ngramSimilarity = ngram;

    var fieldPositiveEnough = !sourceScoped || sourceField.exactContainment === true || sourceField.confidence >= 0.56;
    var strongInferredField = sourceScoped && sourceField.inferred === true && sourceField.confidence >= 0.55 && sourceField.targetTokenCoverage >= 0.58 && sourceField.directionalCoverage >= 0.38 && sourceField.similarity >= 0.52;
    if ((similarity >= 0.74 && (lengthRatio >= 0.55 || similarity >= 0.90) && fieldPositiveEnough) || strongInferredField) {
        base.status = 'VERIFIED';
        base.reason = sourceScoped
            ? 'Source learner field was semantically aligned to the destination learner field, and the field-to-field similarity is strong.'
            : 'Ensemble text similarity is strong with sufficient captured coverage.';
        return base;
    }

    // v6.6.1: a field aggregate is a bounded fallback surface, not necessarily the
    // learner-facing body. It may provide positive evidence when it strongly matches
    // the source, but weak similarity on this fallback must never create DRIFT or
    // CONTENT_CHANGED.
    if (scopeKind === 'field-aggregate') {
        base.status = 'UNVERIFIED';
        base.reason = 'Coursera exposed a bounded field-level fallback, but it is not isolated enough to support a negative content-drift verdict.';
        return base;
    }

    // When CTI inferred the source field by searching for the best semantic window,
    // a weak/medium match is an evidence gap, not proof that learner content changed.
    // Positive matches can verify; negative claims require an independently bounded
    // source field or whole-item comparable bodies.
    if (sourceScoped && sourceField.inferred === true) {
        base.status = 'UNVERIFIED';
        base.reason = 'CTI aligned a probable source field to the destination learner field, but the field-to-field similarity is not strong enough to verify equivalence. Because the source field was inferred semantically, this result is not used to manufacture content drift.';
        return base;
    }

    if (similarity >= 0.46 && lengthRatio >= 0.30) {
        base.status = 'DRIFT';
        base.reason = 'Text appears materially related but has meaningful drift.';
        return base;
    }

    // If the two bodies are radically different in size, low lexical similarity is
    // ambiguous: it may be a partial capture rather than a true replacement.
    if (lengthRatio < 0.30) {
        base.status = 'UNVERIFIED';
        base.reason = 'The source and observed Coursera text lengths are too different to safely declare content changed.';
        return base;
    }

    // A hard CHANGED verdict requires complete item evidence plus both independent
    // similarity families being weak.
    if (completeness >= 0.85 && lexical < 0.22 && ngram < 0.30) {
        base.status = 'CHANGED';
        base.reason = 'Both token-set and character n-gram similarity are weak on a sufficiently complete item-level capture.';
        return base;
    }

    base.status = 'UNVERIFIED';
    base.reason = 'The text signals are insufficiently complete or internally inconsistent; manual or structured review is safer than declaring content changed.';
    return base;
}

export function qaSemanticTokenList_(value) {
    var words = qaAssessmentText_(value).toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
    var stop = { the:1,a:1,an:1,and:1,or:1,of:1,to:1,in:1,on:1,for:1,with:1,is:1,are:1,be:1,by:1,from:1,as:1,at:1,it:1,this:1,that:1,these:1,those:1,will:1,can:1 };
    return words.filter(function(w) { return w.length > 2 && !stop[w]; });
}

export function qaDirectionalSemanticSimilarity_(sourceText, targetText) {
    sourceText = qaAssessmentText_(sourceText);
    targetText = qaAssessmentText_(targetText);
    if (sourceText.length < 80 || targetText.length < 80) return 0;
    var sNorm = sourceText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    var tNorm = targetText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (sNorm.length >= 80 && tNorm.indexOf(sNorm) > -1) return 1;

    var sTokens = qaSemanticTokenList_(sourceText), tTokens = qaSemanticTokenList_(targetText);
    if (sTokens.length < 12 || tTokens.length < 12) return 0;
    var tSet = Object.create(null);
    tTokens.forEach(function(t) { tSet[t] = true; });
    var uniqueSource = Object.create(null);
    sTokens.forEach(function(t) { uniqueSource[t] = true; });
    var sourceKeys = Object.keys(uniqueSource), unigramHits = 0;
    sourceKeys.forEach(function(t) { if (tSet[t]) unigramHits++; });
    var unigramCoverage = sourceKeys.length ? unigramHits / sourceKeys.length : 0;

    function bigrams(tokens) {
        var set = Object.create(null);
        for (var i = 0; i + 1 < tokens.length; i++) set[tokens[i] + ' ' + tokens[i + 1]] = true;
        return set;
    }
    var sb = bigrams(sTokens), tb = bigrams(tTokens), sbKeys = Object.keys(sb), bigramHits = 0;
    sbKeys.forEach(function(bg) { if (tb[bg]) bigramHits++; });
    var bigramCoverage = sbKeys.length ? bigramHits / sbKeys.length : 0;
    var ngram = qaCharNgramCosine_(sourceText, targetText, 3);
    return Math.max(0, Math.min(1, (unigramCoverage * 0.42) + (bigramCoverage * 0.43) + (ngram * 0.15)));
}

export function qaNativeRubricSemanticText_(coursera) {
    var nativeAssignment = coursera && coursera.nativeAssignment;
    if (!nativeAssignment) return '';
    var pieces = [];
    (nativeAssignment.rubrics || []).forEach(function(r) {
        pieces.push(r.title || '', r.criterionTitle || '', r.criterionDescription || '', r.rawText || '');
        (r.levels || []).forEach(function(level) {
            pieces.push(level.label || '', level.description || '');
            if (level.points !== null && level.points !== undefined) pieces.push(String(level.points) + ' points');
        });
    });
    return qaAssessmentText_(pieces.filter(Boolean).join(' '));
}

export function qaNativePromptSemanticText_(coursera) {
    var nativeAssignment = coursera && coursera.nativeAssignment;
    var pieces = [coursera && coursera.textSample || ''];
    if (nativeAssignment) {
        pieces.push(nativeAssignment.prompt || '', nativeAssignment.directions || '', nativeAssignment.expectations || '');
    }
    return qaAssessmentText_(pieces.filter(Boolean).join(' '));
}

export function qaNativeAssignmentSemanticText_(coursera) {
    return qaAssessmentText_([
        qaNativePromptSemanticText_(coursera),
        qaNativeRubricSemanticText_(coursera)
    ].filter(Boolean).join(' '));
}

export function qaSourcePdfComparisonSet_(assetDetails) {
    var all = (assetDetails || []).filter(function(d) { return String(d && d.extension || '').toLowerCase() === 'pdf'; });
    var ignoredReferences = all.filter(function(d) { return d.presentInPackage === false || d.referenceOnly === true; });
    var candidates = all.filter(function(d) { return d.presentInPackage !== false && d.referenceOnly !== true; });
    var seen = Object.create(null), documents = [];
    candidates.forEach(function(d) {
        var hash = String(d.sha256 || '').toLowerCase();
        var path = String(d.path || d.href || '').replace(/\\/g, '/').toLowerCase();
        var name = qaAssetKey_(d.name || d.url || '');
        var key = hash ? ('sha:' + hash) : (path ? ('path:' + path) : ('name:' + name + ':' + String(d.size || 0)));
        if (!key || seen[key]) return;
        seen[key] = true;
        documents.push(d);
    });
    return { documents: documents, ignoredReferences: ignoredReferences, all: all };
}

export function qaBestDocumentSemanticMatch_(doc, targetText) {
    var segments = [];
    var whole = qaAssessmentText_(doc && doc.textSample || '');
    if (whole) segments.push({ page: 0, text: whole, kind: 'document-sample' });
    (doc && doc.pdfPageSamples || []).forEach(function(sample) {
        var t = qaAssessmentText_(sample && sample.text || '');
        if (t) segments.push({ page: Number(sample.page || 0), text: t, kind: 'page-sample' });
    });
    var best = { score: 0, forward: 0, reverse: 0, page: 0, kind: '' };
    segments.forEach(function(seg) {
        var forward = qaDirectionalSemanticSimilarity_(seg.text, targetText);
        // Native conversion can represent only one section of a much larger source
        // document. Reverse coverage asks whether the native surface is positively
        // grounded in that source section rather than penalizing unrelated pages.
        var reverse = qaDirectionalSemanticSimilarity_(targetText, seg.text);
        var score = Math.max(forward, reverse);
        if (score > best.score) best = { score: score, forward: forward, reverse: reverse, page: seg.page, kind: seg.kind };
    });
    return best;
}
