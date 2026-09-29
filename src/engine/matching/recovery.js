// Maintained source: explicit dependencies; no ordered concatenation.
import { qaNormalizeIngestionFailure_ } from "../assessment/assignment.js";
import { qaAssetDescriptor_, qaAssetEvidenceCandidates_, qaCrossItemCandidateIsConcrete_, qaCrossItemCanonicalAssetName_, qaCrossItemDirectionalCoverage_, qaCrossItemGenericExpectedAsset_, qaCrossItemGenericMethodIsSufficient_, qaCrossItemInformativeTokens_, qaCrossItemRoleSignature_, qaFindAssetEvidence_, qaFindLink_, qaNormalizeUrl_ } from "./assets.js";
import { qaDirectionalSemanticSimilarity_, qaTextComparison_ } from "./payload.js";
import { fuzzyMatchScore_, normalizeCourseraType_, qaCleanName_, qaCleanText_, qaJaccard_, qaPathSimilarity_ } from "./text.js";

export function qaCrossItemSemanticAssetEvidence_(expected, candidates) {
    candidates=qaAssetEvidenceCandidates_(expected,candidates);
    var a = qaAssetDescriptor_(expected);
    var aName = qaCrossItemCanonicalAssetName_(a.name || a.url);
    var best = null;
    (candidates || []).forEach(function(candidate) {
        var b = qaAssetDescriptor_(candidate);
        if (a.sha256 && b.sha256 && a.sha256 !== b.sha256) return;
        if (a.extension && b.extension && a.extension !== b.extension) return;
        var bName = qaCrossItemCanonicalAssetName_(b.name || b.url);
        if (!aName || !bName) return;

        var aKey = aName.toLowerCase().replace(/[^a-z0-9]/g, '');
        var bKey = bName.toLowerCase().replace(/[^a-z0-9]/g, '');
        var fuzzy = fuzzyMatchScore_(aName, bName);
        var token = qaJaccard_(aName, bName);
        var directional = qaCrossItemDirectionalCoverage_(aName, bName);
        var score = 0, method = '', reason = '';

        if (aKey && aKey === bKey) {
            score = 0.96;
            method = 'SEMANTIC_FILENAME_EXACT';
            reason = 'Filename matches after stripping Coursera transport prefixes/encoding.';
        } else if (fuzzy >= 0.90 && token >= 0.72) {
            score = Math.min(0.95, 0.86 + fuzzy * 0.05 + token * 0.05);
            method = 'SEMANTIC_FILENAME';
            reason = 'Strong semantic filename match after removing Coursera CDN transport prefixes.';
        } else if (directional.expectedCount >= 1 &&
                   directional.coverage >= 0.84 &&
                   directional.anchorHits >= 1 &&
                   qaCrossItemRoleSignature_(aName) &&
                   qaCrossItemRoleSignature_(aName) === qaCrossItemRoleSignature_(bName) &&
                   fuzzy >= 0.38) {
            score = Math.min(0.94, 0.90 + directional.coverage * 0.04);
            method = 'SEMANTIC_TOKEN_CONTAINMENT';
            reason = 'Observed filename contains nearly all informative source filename tokens plus at least one source identity anchor.';
        }
        if (!score) return;
        if (!best || score > best.score) best = {
            score: score, method: method, reason: reason, candidate: b,
            directionalCoverage: directional.coverage,
            directionalAnchorHits: directional.anchorHits
        };
    });
    return best;
}

export function qaCrossItemAssetMatchIsStrong_(match) {
    if (!match || !match.candidate) return false;
    var method = String(match.method || '');
    if (method === 'HASH_MISMATCH' || method === 'SIZE_EXTENSION' || method === 'WEAK_NAME' || method === 'NONE') return false;
    return Number(match.score || 0) >= 0.90;
}

export function qaFindCrossItemAssetEvidence_(expectedDesc, courseraItems, excludeCourseraId) {
    var best = null;
    var excluded = String(excludeCourseraId || '').toLowerCase();

    (courseraItems || []).forEach(function(item) {
        if (!item) return;
        if (excluded && String(item.id || '').toLowerCase() === excluded) return;
        var candidates = (item.assetDetails || []).filter(qaCrossItemCandidateIsConcrete_);
        if (!candidates.length) return;

        var match = qaFindAssetEvidence_(expectedDesc, candidates);
        if (!qaCrossItemAssetMatchIsStrong_(match)) {
            var semantic = qaCrossItemSemanticAssetEvidence_(expectedDesc, candidates);
            if (semantic && qaCrossItemAssetMatchIsStrong_(semantic)) match = semantic;
        }
        if (!qaCrossItemAssetMatchIsStrong_(match)) return;

        // v6.4: cross-item NAME_EXACT/FUZZY_NAME is not enough for generic
        // filenames such as Rubric.pdf or Assessment.pdf. Otherwise an unrelated
        // rubric elsewhere in the course can be reported as a relocation.
        if (qaCrossItemGenericExpectedAsset_(expectedDesc) &&
            !qaCrossItemGenericMethodIsSufficient_(match.method)) return;

        if (!best || Number(match.score || 0) > Number(best.score || 0)) {
            best = {
                expected: expectedDesc.name || expectedDesc.url || '',
                observed: match.candidate ? (match.candidate.name || match.candidate.url || '') : '',
                score: Number(Number(match.score || 0).toFixed(3)),
                method: match.method || '',
                reason: match.reason || '',
                carrierId: item.id || '',
                carrierName: item.name || '',
                carrierType: item.type || '',
                carrierPath: item.path || '',
                carrierPublished: item.published === true ? true : (item.published === false ? false : null),
                carrierEvidenceOnly: item.evidenceOnly === true
            };
        }
    });
    return best;
}

export function qaFindCrossItemTitleAssetEvidence_(source, courseraItems, excludeCourseraId) {
    source = source || {};
    var title = qaCleanText_(source.name || '');
    var titleTokens = qaCrossItemInformativeTokens_(title);
    var excluded = String(excludeCourseraId || '').toLowerCase();
    var best = null;

    // Legacy source rows with no preserved payload can use actual observed asset
    // filenames as review-level survival evidence, but only when the title itself
    // carries a recognizable asset-role phrase plus a distinctive identity token.
    var titleRole = qaCrossItemRoleSignature_(title);
    if (titleTokens.length < 1 || title.length < 18 || !titleRole) return null;

    (courseraItems || []).forEach(function(item) {
        if (!item) return;
        if (excluded && String(item.id || '').toLowerCase() === excluded) return;
        (item.assetDetails || []).forEach(function(rawCandidate) {
            if (!qaCrossItemCandidateIsConcrete_(rawCandidate)) return;
            var candidate = qaAssetDescriptor_(rawCandidate);
            var observed = qaCrossItemCanonicalAssetName_(candidate.name || candidate.url);
            var ext = String(candidate.extension || '').toLowerCase();
            if (!/^(pdf|doc|docx|ppt|pptx|xls|xlsx|csv|zip|png|jpg|jpeg|webp)$/.test(ext)) return;

            var directional = qaCrossItemDirectionalCoverage_(title, observed);
            var fuzzy = fuzzyMatchScore_(title, observed);
            if (directional.expectedCount < 1 || directional.coverage < 0.90 ||
                directional.anchorHits < 1 ||
                qaCrossItemRoleSignature_(observed) !== titleRole ||
                fuzzy < 0.38) return;

            var match = {
                expected: title + ' [source item title proxy]',
                observed: candidate.name || candidate.url || '',
                score: Number(Math.min(0.92, 0.86 + directional.coverage * 0.06).toFixed(3)),
                method: 'ITEM_TITLE_ASSET_STRONG',
                reason: 'Source payload fingerprint is unavailable; an actual Coursera asset filename strongly contains the source item identity. This proves likely survival/repackaging, not binary identity.',
                carrierId: item.id || '',
                carrierName: item.name || '',
                carrierType: item.type || '',
                carrierPath: item.path || '',
                carrierPublished: item.published === true ? true : (item.published === false ? false : null),
                carrierEvidenceOnly: item.evidenceOnly === true,
                titleDerived: true,
                directionalCoverage: Number(directional.coverage.toFixed(3)),
                directionalAnchorHits: directional.anchorHits
            };
            if (!best || match.score > best.score) best = match;
        });
    });
    return best;
}

export function qaFindCrossItemLinkEvidence_(expectedLink, courseraItems, excludeCourseraId) {
    var key = typeof expectedLink === 'string' ? qaNormalizeUrl_(expectedLink) : expectedLink.normalized;
    if (!key) return null;
    var excluded = String(excludeCourseraId || '').toLowerCase();

    for (var i = 0; i < (courseraItems || []).length; i++) {
        var item = courseraItems[i];
        if (!item) continue;
        if (excluded && String(item.id || '').toLowerCase() === excluded) continue;
        if (qaFindLink_(expectedLink, item.links || [])) {
            return {
                expected: typeof expectedLink === 'string' ? expectedLink : expectedLink.raw,
                observed: typeof expectedLink === 'string' ? expectedLink : expectedLink.raw,
                score: 1,
                method: 'URL_EXACT',
                carrierId: item.id || '',
                carrierName: item.name || '',
                carrierType: item.type || '',
                carrierPath: item.path || '',
                carrierPublished: item.published === true ? true : (item.published === false ? false : null),
                carrierEvidenceOnly: item.evidenceOnly === true
            };
        }
    }
    return null;
}

export function qaFindCrossItemPayloadEvidence_(source, courseraItems, excludeCourseraId) {
    source = source || {};

    // v6.6.1: cross-item recovery must use only real source payload expectations.
    // Parser-only refs and hrefs proven absent from the source ZIP remain diagnostic
    // context; letting them count as expected payload suppresses the strong title->
    // asset fallback and can turn a confirmed consolidation into a false MISSING.
    var ignoredSourceReferenceAssets = [];
    var expectedAssets = (source.assetDetails || []).filter(function(raw) {
        var desc = qaAssetDescriptor_(raw);
        if (desc.referenceOnly === true || desc.presentInPackage === false) {
            ignoredSourceReferenceAssets.push(desc.name || desc.href || desc.path || desc.url || 'source reference');
            return false;
        }
        return true;
    });
    var expectedLinks = source.links || [];
    var sourcePayloadAvailable = (expectedAssets.length + expectedLinks.length) > 0;

    var relocatedAssets = [], unresolvedAssets = [];
    expectedAssets.forEach(function(expectedDesc) {
        var found = qaFindCrossItemAssetEvidence_(expectedDesc, courseraItems, excludeCourseraId);
        if (found) relocatedAssets.push(found);
        else unresolvedAssets.push(expectedDesc.name || expectedDesc.url || '');
    });

    var relocatedLinks = [], unresolvedLinks = [];
    expectedLinks.forEach(function(expectedLink) {
        var found = qaFindCrossItemLinkEvidence_(expectedLink, courseraItems, excludeCourseraId);
        if (found) relocatedLinks.push(found);
        else unresolvedLinks.push(expectedLink.raw || expectedLink.normalized || '');
    });

    // v6.6.1: if direct source-payload matching produced no positive result, permit
    // the already-conservative title->concrete-asset fallback even when an older
    // source descriptor exists. This fallback requires a distinctive role phrase
    // plus identity anchor and is explicitly labelled inferred, never binary proof.
    var titleDerivedRecovery = false;
    var inferredWhilePayloadAvailable = false;
    var explicitHashConflict = false;
    // Preserve the absolute SHA mismatch veto. If a concrete Coursera candidate
    // has the same normalized filename as a hashed source asset but a different
    // SHA-256, title-based inference is forbidden for this source item.
    expectedAssets.forEach(function(expectedRaw) {
        if (explicitHashConflict) return;
        var expected = qaAssetDescriptor_(expectedRaw);
        if (!expected.sha256) return;
        (courseraItems || []).forEach(function(item) {
            if (explicitHashConflict || !item) return;
            if (String(excludeCourseraId || '').toLowerCase() && String(item.id || '').toLowerCase() === String(excludeCourseraId || '').toLowerCase()) return;
            (item.assetDetails || []).forEach(function(candidateRaw) {
                if (explicitHashConflict) return;
                var candidate = qaAssetDescriptor_(candidateRaw);
                if (!candidate.sha256 || !expected.key || (expected.key !== candidate.key && qaCleanName_(qaCrossItemCanonicalAssetName_(expected.name)) !== qaCleanName_(qaCrossItemCanonicalAssetName_(candidate.name)))) return;
                if (expected.sha256 !== candidate.sha256) explicitHashConflict = true;
            });
        });
    });
    if (!explicitHashConflict && !relocatedAssets.length && !relocatedLinks.length) {
        var inferred = qaFindCrossItemTitleAssetEvidence_(source, courseraItems, excludeCourseraId);
        if (inferred) {
            relocatedAssets.push(inferred);
            titleDerivedRecovery = true;
            inferredWhilePayloadAvailable = sourcePayloadAvailable;
        }
    }

    var carriers = Object.create(null);
    relocatedAssets.concat(relocatedLinks).forEach(function(match) {
        var key = String(match.carrierId || match.carrierName || '');
        if (!key) return;
        if (!carriers[key]) carriers[key] = {
            id: match.carrierId || '', name: match.carrierName || '',
            type: match.carrierType || '', path: match.carrierPath || '',
            published: match.carrierPublished,
            evidenceOnly: match.carrierEvidenceOnly === true
        };
    });

    var totalExpected = sourcePayloadAvailable ? expectedAssets.length + expectedLinks.length : (titleDerivedRecovery ? 1 : 0);
    var recoveredCount = relocatedAssets.length + relocatedLinks.length;
    var allRecovered = sourcePayloadAvailable && totalExpected > 0 && recoveredCount === totalExpected && !inferredWhilePayloadAvailable;
    return {
        hasPositiveEvidence: recoveredCount > 0,
        sourcePayloadAvailable: sourcePayloadAvailable,
        titleDerivedRecovery: titleDerivedRecovery,
        inferredWhilePayloadAvailable: inferredWhilePayloadAvailable,
        explicitHashConflict: explicitHashConflict,
        ignoredSourceReferenceAssets: ignoredSourceReferenceAssets,
        totalExpected: totalExpected,
        recoveredCount: recoveredCount,
        recoveryRatio: totalExpected ? Math.min(1, recoveredCount / totalExpected) : 0,
        allRecovered: allRecovered,
        relocatedAssets: relocatedAssets,
        unresolvedAssets: unresolvedAssets,
        relocatedLinks: relocatedLinks,
        unresolvedLinks: unresolvedLinks,
        carriers: Object.keys(carriers).map(function(key) { return carriers[key]; })
    };
}

export function base_qaFindCrossItemSemanticRepackagingEvidence_(source, courseraItems, excludeCourseraId) {
    source = source || {};
    if(source.sourceTextRefreshRequired) return null;
    var sourceText = qaCleanText_(source.textSample || '');
    if (sourceText.length < 80) return null;

    var sourceType = normalizeCourseraType_(source.type || '');
    if (['Discussion','Assignment','Reading'].indexOf(sourceType) === -1) return null;
    var excluded = String(excludeCourseraId || '').toLowerCase();
    var best = null;

    (courseraItems || []).forEach(function(item) {
        if (!item || item.syntheticOneToMany === true) return;
        if (excluded && String(item.id || '').toLowerCase() === excluded) return;
        var targetType = normalizeCourseraType_(item.type || '');
        if (targetType !== sourceType) return;
        if (qaNormalizeIngestionFailure_(item.ingestionFailure, item.name, item.textSample).detected === true) return;

        var pathScore = qaPathSimilarity_(source.path || '', item.path || '');
        if (pathScore === null || pathScore < 0.62) return;

        var completeness = Number(item.textEvidenceCompleteness || 0);
        if (!Number.isFinite(completeness) || completeness < 0.85) return;
        var confidence = String(item.textConfidence || '').toLowerCase();
        if (confidence && confidence !== 'high') return;

        var textCheck = qaTextComparison_(source, item);
        if (!textCheck || textCheck.status !== 'VERIFIED') return;
        var similarity = Number(textCheck.similarity || 0);
        var exact = textCheck.promptContainment === true || textCheck.sourceFieldExactContainment === true;
        var fieldStrong = textCheck.fieldScopedComparison === true &&
            Number(textCheck.sourceFieldConfidence || 0) >= 0.58 &&
            Number(textCheck.sourceFieldTargetTokenCoverage || 0) >= 0.62;
        if (!exact && !fieldStrong && similarity < 0.82) return;

        var titleScore = fuzzyMatchScore_(source.name || '', item.name || '');
        var score = Math.min(1,
            (Math.max(similarity, exact ? 1 : 0) * 0.62) +
            (pathScore * 0.22) +
            (Math.max(0, titleScore) * 0.08) +
            0.08
        );
        if (score < 0.82) return;

        var candidate = {
            score:Number(score.toFixed(3)),
            method: exact ? 'SEMANTIC_PROMPT_CONTAINMENT' : 'SEMANTIC_LEARNER_TEXT_STRONG',
            reason: exact
                ? 'Strong learner-facing prompt containment proves that the renamed/consolidated destination item carries the source interaction text.'
                : 'Strong same-module, same-type learner-text alignment proves that the destination item carries the source learner-facing content.',
            carrierId:item.id || '', carrierName:item.name || '', carrierType:item.type || '', carrierPath:item.path || '',
            carrierPublished:item.published === true ? true : (item.published === false ? false : null),
            carrierEvidenceOnly:item.evidenceOnly === true,
            pathScore:Number(pathScore.toFixed(3)), titleScore:Number(titleScore.toFixed(3)),
            textComparison:textCheck
        };
        if (!best || candidate.score > best.score) best = candidate;
    });
    return best;
}

export function qaFindCrossItemSemanticRepackagingEvidence_(source,courseraItems,excludeCourseraId){
  var existing=base_qaFindCrossItemSemanticRepackagingEvidence_.apply(this,arguments);if(existing)return existing;
  var sourceText=qaCleanText_(source&&source.textSample||'');
  if(sourceText.length<80)return null;
  var candidates=(courseraItems||[]).filter(function(item){
    if(!item||String(item.id||'')===String(excludeCourseraId||''))return false;
    if(qaNormalizeIngestionFailure_(item.ingestionFailure||null,item.name||'',item.textSample||'').detected)return false;
    if(normalizeCourseraType_(item.type)!=='Reading')return false;
    var path=qaPathSimilarity_(source.path,item.path);if(path==null||path<0.58)return false;
    var text=qaCleanText_(item.textSample||'');if(text.length<80||Number(item.textEvidenceCompleteness||0)<0.80)return false;
    var directional=qaDirectionalSemanticSimilarity_(sourceText,text);
    return directional>=0.86;
  });
  if(candidates.length!==1)return null;
  var c=candidates[0];
  return {score:0.91,method:'SEMANTIC_CONSOLIDATED_READING',reason:'A unique same-module Coursera Reading contains strong directional learner-text coverage for the source activity. This proves semantic consolidation only; unresolved files/links remain unresolved.',
    carrierId:c.id||'',carrierName:c.name||'',carrierType:c.type||'',carrierPath:c.path||'',carrierPublished:c.published,carrierEvidenceOnly:c.evidenceOnly===true,
    textEvidenceCompleteness:Number(c.textEvidenceCompleteness||0)};
}

export function qaInteractionIdentityKey_(value) {
    var tokens = qaCleanText_(value || '').toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
    var generic = { forum:1, activity:1, activities:1, discussion:1, prompt:1, graded:1, ungraded:1, topic:1, exercise:1 };
    return tokens.filter(function(token) { return !generic[token]; }).join(' ').trim();
}
