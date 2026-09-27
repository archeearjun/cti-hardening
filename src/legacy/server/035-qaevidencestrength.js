


function qaEvidenceStrength_(result) {
    var checks = result.checks || {};
    var score = 50;
    var basis = [];

    if (result.verdict === 'INGESTION_FAILURE') {
        score = 99;
        basis.push('Coursera explicitly exposed a deterministic Smart Ingestion failure sentinel/raw-metadata artifact on the matched learner item.');
    } else if (result.verdict === 'DEPENDENCY_PROXY') {
        score = 96;
        basis.push('Source hierarchy identifies a same-named hidden attachment proxy beneath its visible parent.');
    } else if (result.verdict === 'HIDDEN_DEPENDENCY_REVIEW') {
        score = 90;
        basis.push('Source hierarchy proves a hidden dependency, but learner-impact must be judged through its parent/payload survival.');
    } else if (result.verdict === 'RUNTIME_REVIEW') {
        score = 91;
        basis.push('Source evidence positively identifies an interactive/runtime carrier; automated structure/payload evidence cannot by itself prove runtime equivalence.');
    } else if (result.verdict === 'INTENTIONAL_EXCLUSION') {
        score = 96;
        basis.push('The authoritative Coursera structure omits the source item and the Smart Ingestion Author Alignment Report explicitly records its intentional exclusion. The claim explains cause but does not by itself prove that the exclusion is pedagogically correct.');
    } else if (result.verdict === 'MISSING') {
        score = 98;
        basis.push('Source item is absent from the authoritative Coursera structural export and no positive cross-item payload recovery was observed.');
    } else if (result.verdict === 'REPACKAGED') {
        var rep = checks.repackaging || {};
        score = rep.status === 'VERIFIED' ? 96 : (rep.status === 'INFERRED' ? 82 : 86);
        basis.push(rep.identityRecovered === true
            ? 'A unique same-module destination Discussion supports structural identity only; source prompt equivalence remains unverified.'
            : rep.status === 'INFERRED'
            ? (rep.inferredWhilePayloadAvailable === true
                ? 'Source item is absent as a standalone row; direct source-payload matching was inconclusive, but an actual Coursera asset filename strongly matches the source item identity.'
                : 'Source item is absent as a standalone row; an actual Coursera asset filename strongly matches the item identity, but the source payload fingerprint was unavailable.')
            : 'Source item is absent as a standalone row, but positive payload evidence was observed in other Coursera item(s).');
    } else if (result.verdict === 'EXPECTED_TRANSFORMATION') {
        var transform = checks.transformation || {};
        score = Math.max(90, Math.min(98, Math.round(Number(transform.confidence || 0) * 100)));
        var externalTransform = checks.externalWebpageTransformation || checks.externalWebpageEvidence;
        basis.push(externalTransform && externalTransform.status === 'VERIFIED_CONFIGURATION'
            ? 'The source target is preserved in the observed Coursera plugin URL/configuration. External launch and interaction remain unverified.'
            : 'Source document text is positively matched to structured native Coursera Assignment/rubric evidence.');
    } else if (result.verdict === 'TYPE_MUTATION') {
        score = 95;
        basis.push('Source and Coursera structural types disagree on an exact/near-exact item match.');
    } else if (result.verdict === 'STATE_MUTATION') {
        score = 92;
        basis.push('Coursera publication/visibility state was directly observed.');
    } else {
        score = Math.max(45, Math.min(92, Number(result.evidenceCoverage || 0)));
    }

    if (checks.assets) {
        var assetConfidence = Number(checks.assets.evidenceConfidence || 0);
        if (assetConfidence > 0 && result.verdict === 'PARTIAL' && (result.issues || []).indexOf('MISSING_ASSET') > -1) {
            score = Math.max(score, Math.min(99, assetConfidence));
            basis.push('Missing-asset conclusion is supported by ' + assetConfidence + '% item-level asset evidence.');
        }
        var allAssetProof = (checks.assets.matches || []).concat(checks.assets.relocated || []);
        var methods = allAssetProof.map(function(m) { return String(m.method || ''); });
        if (methods.indexOf('SHA256_EXACT') > -1) {
            score = Math.max(score, 99); basis.push('At least one asset is cryptographically identical by SHA-256.');
        } else if (methods.indexOf('IMAGE_PERCEPTUAL') > -1) {
            score = Math.max(score, 96); basis.push('At least one image is visually matched by perceptual hash.');
        } else if (methods.indexOf('NAME_SIZE_EXACT') > -1) {
            score = Math.max(score, 94); basis.push('At least one asset matches by normalized filename and byte size.');
        } else if ((checks.assets.relocated || []).length) {
            score = Math.max(score, 86); basis.push('Positive asset evidence was recovered in another Coursera item.');
        }
        if ((result.issues || []).indexOf('RUBRIC_CONTENT_CHANGED') > -1) {
            score = Math.max(score, 94);
            basis.push('Source rubric PDF text was fully observed and the native Coursera rubric structure was strongly captured; low semantic/criterion overlap supports a content-change conclusion.');
        }
    }

    if (checks.links && (checks.links.relocated || []).length) {
        score = Math.max(score, 90);
        basis.push('Expected link target was positively observed in another Coursera item.');
    }

    if (checks.structuredAssessment && checks.structuredAssessment.status === 'VERIFIED') {
        score = Math.max(score, 94);
        basis.push('Question-level structured assessment evidence was verified.');
    } else if (checks.content && checks.content.status === 'VERIFIED') {
        score = Math.max(score, checks.content.reason && checks.content.reason.indexOf('SHA-256') > -1 ? 99 : 90);
        basis.push('Learner-facing text evidence was verified.');
    }

    if (result.verdict === 'UNVERIFIED') {
        score = Math.min(score, 69);
        basis.push('One or more payload dimensions remain unobserved.');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score: score, label: score >= 95 ? 'Very strong' : score >= 85 ? 'Strong' : score >= 70 ? 'Moderate' : 'Limited', basis: basis.slice(0, 5) };
}