

function compareItemFidelity_(source, coursera, matchScore, allCourseraItems, snapshotContext, ingestionIntelligence) {
    var checks = {};
    if(source.sourceTextNormalization) checks.sourceTextNormalization=source.sourceTextNormalization;
    if(source.sourceLinkNormalization)checks.sourceLinkNormalization=source.sourceLinkNormalization;
    var ingestionClaims = qaSmartIngestionClaimsForSource_(source, ingestionIntelligence);
    if (ingestionClaims.length) {
        checks.ingestionProvenance = {
            status:'CLAIMED',
            claims:ingestionClaims,
            trustModel:'CLAIM_PLUS_OBSERVATION',
            reason:'Coursera Smart Ingestion reported one or more transformations involving this source item. These claims provide causal provenance but do not override CTI-observed payload/hash evidence.'
        };
    }
    var issues = [];
    var earned = 30;
    var possible = 30;
    allCourseraItems = allCourseraItems || [];

    checks.structure = { status: 'VERIFIED', weight: 30 };

    var ingestionFailure = qaNormalizeIngestionFailure_(coursera.ingestionFailure || null, coursera.name || '', coursera.textSample || '', coursera.structuredAssessment);
    if (ingestionFailure.detected === true) {
        checks.ingestionFailure = ingestionFailure;
        if(source.isStructuredAssessment)checks.structuredAssessment=qaStructuredAssessmentComparison_(source,coursera);
        checks.content = { status:'FAILED_INGESTION', weight:70, reason:ingestionFailure.reason || 'Explicit Smart Ingestion failure evidence was observed.' };
        var failIssues = ['INGESTION_FAILURE'].concat(ingestionFailure.codes || []).filter(function(v,i,a){ return v && a.indexOf(v) === i; });
        var failResult = {
            sourceId: source.id, sourceName: source.name, sourceType: source.type, sourcePath: source.path,
            courseraId: coursera.id, courseraName: coursera.name, courseraType: coursera.type, courseraPath: coursera.path,
            matchScore: Number(matchScore.toFixed(3)), fidelityPercent: 30, evidenceCoverage: 95,
            earnedPoints:30, possiblePoints:100, verdict:'INGESTION_FAILURE', issues:failIssues, checks:checks,
            evidenceSources:(coursera.evidenceSources || []).concat(['Explicit Coursera ingestion-failure sentinel']), snapshotContext:snapshotContext || null
        };
        failResult.ownerAction = qaOwnerActionForResult_(failResult);
        failResult.evidenceStrength = qaEvidenceStrength_(failResult);
        return failResult;
    }

    possible += 15;
    var webpageEvidence=qaExternalWebpageEvidence_(source,coursera);
    if(webpageEvidence)checks.externalWebpageEvidence=webpageEvidence;
    var linkTransformation=webpageEvidence&&webpageEvidence.status==='VERIFIED_CONFIGURATION'?webpageEvidence:null;
    if(linkTransformation)checks.externalWebpageTransformation=linkTransformation;
    var typeOk = qaTypesCompatible_(source.type, coursera.type) || !!linkTransformation;
    var pendingPluginType=!typeOk && webpageEvidence && webpageEvidence.transformationCandidate;
    if (typeOk) earned += 15; else if(pendingPluginType){possible-=15;issues.push('PAYLOAD_UNVERIFIED');}else issues.push('TYPE_MUTATION');
    checks.type = { status: typeOk ? 'VERIFIED' : pendingPluginType ? 'UNVERIFIED' : 'MUTATED', source: source.type, coursera: coursera.type, weight: 15 };

    var pathSimilarity = qaPathSimilarity_(source.path, coursera.path);
    if (pathSimilarity !== null) {
        possible += 10;
        if (pathSimilarity >= 0.62) earned += 10;
        else if (pathSimilarity >= 0.40) { earned += 5; issues.push('MOVED_ITEM'); }
        else issues.push('MOVED_ITEM');
        checks.placement = { status: pathSimilarity >= 0.62 ? 'VERIFIED' : 'MOVED', similarity: Number(pathSimilarity.toFixed(3)), source: source.path, coursera: coursera.path, weight: 10 };
    } else checks.placement = { status: 'UNVERIFIED', source: source.path, coursera: coursera.path, weight: 10 };

    var behaviorCheck = qaBehaviorComparison_(source, coursera);
    if (behaviorCheck && behaviorCheck.status !== 'NOT_APPLICABLE') {
        checks.behavior = behaviorCheck;
        if (behaviorCheck.status === 'MUTATED') issues.push('BEHAVIOR_MUTATION');
        else if (behaviorCheck.status === 'UNVERIFIED') issues.push('BEHAVIOR_UNVERIFIED');
    }

    var runtimeCheck = qaRuntimeReview_(source, coursera);
    if (runtimeCheck && runtimeCheck.required === true) {
        checks.runtime = runtimeCheck;
        issues.push('RUNTIME_VERIFICATION_REQUIRED');
    }

    // v6.5.8: test document->native conversion before declaring a high-confidence
    // absent PDF missing. This does not weaken the missing-asset confidence guard;
    // it introduces positive semantic evidence for an alternative survival form.
    var transformationCheck = qaNativeTransformationComparison_(source, coursera);
    if (transformationCheck && transformationCheck.status !== 'NOT_APPLICABLE') checks.transformation = transformationCheck;
    var transformedAssetKeys = transformationCheck && transformationCheck.transformedAssetKeys ? transformationCheck.transformedAssetKeys : {};
    var changedAssetKeys = transformationCheck && transformationCheck.changedAssetKeys ? transformationCheck.changedAssetKeys : {};

    var allExpectedAssetDetails = source.assetDetails || [];
    var sourceReferenceOnlyAssets = allExpectedAssetDetails.filter(function(desc) { return desc.presentInPackage === false || desc.referenceOnly === true; });
    // v6.5.8: a ZIP scan that positively says presentInPackage=false is evidence
    // that the source package itself did not contain those bytes. Such hrefs remain
    // diagnostic source references, but they are not counted as post-ingestion
    // payload that Coursera was expected to reproduce.
    var expectedAssetDetails = allExpectedAssetDetails.filter(function(desc) { return desc.presentInPackage !== false && desc.referenceOnly !== true; });
    if (sourceReferenceOnlyAssets.length) {
        checks.sourceReferences = {
            status: 'SOURCE_REFERENCE_ONLY',
            ignoredForCourseraLoss: sourceReferenceOnlyAssets.map(function(desc) { return desc.name || desc.href || desc.path || desc.url; }),
            reason: 'These entries are source-side reference-only signals: either the ZIP scanner positively determined the bytes were not present, or they came from parser-only embedded references without independent package-file evidence. They remain diagnostic but are excluded from Coursera-loss accounting.'
        };
    }
    var observedAssetDetails = coursera.assetDetails || [];
    var expectedAssets = expectedAssetDetails.map(function(desc) { return desc.name || desc.url; });
    var observedAssets = observedAssetDetails.map(function(desc) { return desc.name || desc.url; });
    if (expectedAssets.length) {
        possible += 20;
        var presentAssets = [], relocatedAssets = [], transformedAssets = [], changedNativeAssets = [], hardMissingAssets = [], unresolvedAssets = [], assetMatches = [];
        var assetEvidenceConfidence = Number(coursera.assetEvidenceConfidence || 0);

        expectedAssetDetails.forEach(function(expectedDesc) {
            var expectedName = expectedDesc.name || expectedDesc.url;
            var local = qaFindAssetEvidence_(expectedDesc, observedAssetDetails);
            if (local.score >= 0.78) {
                presentAssets.push(expectedName);
                assetMatches.push({ expected: expectedName, observed: local.candidate ? (local.candidate.name || local.candidate.url) : '', score: Number(local.score.toFixed(3)), method: local.method, reason: local.reason });
                return;
            }
            var relocated = qaFindCrossItemAssetEvidence_(expectedDesc, allCourseraItems, coursera.id);
            if (relocated) { relocatedAssets.push(relocated); return; }
            var expectedKey = qaAssetKey_(expectedName);
            if (expectedKey && transformedAssetKeys[expectedKey]) {
                var docProof = (transformationCheck.documents || []).filter(function(d) { return qaAssetKey_(d.name || '') === expectedKey && d.status === 'TRANSFORMED'; })[0];
                transformedAssets.push({ expected: expectedName, method: 'NATIVE_SEMANTIC_TRANSFORMATION', score: docProof && docProof.similarity != null ? Number(docProof.similarity) : Number(transformationCheck.confidence || 0), nativeSurface: docProof ? docProof.nativeSurface : 'native Coursera Assignment' });
                return;
            }
            if (expectedKey && changedAssetKeys[expectedKey]) {
                var changedProof = (transformationCheck.documents || []).filter(function(d) { return qaAssetKey_(d.name || '') === expectedKey && d.status === 'CONTENT_CHANGED'; })[0];
                changedNativeAssets.push({ expected: expectedName, method: 'NATIVE_RUBRIC_CONTENT_CHANGED', score: changedProof && changedProof.similarity != null ? Number(changedProof.similarity) : 0, nativeSurface: changedProof ? changedProof.nativeSurface : 'native Coursera rubric' });
                return;
            }
            if (assetEvidenceConfidence >= 0.80) hardMissingAssets.push(expectedName);
            else unresolvedAssets.push(expectedName);
        });

        earned += 20 * ((presentAssets.length + transformedAssets.length + (0.5 * relocatedAssets.length)) / expectedAssets.length);
        if (relocatedAssets.length) issues.push('ASSET_RELOCATED');
        if (transformedAssets.length) issues.push('PAYLOAD_TRANSFORMED');
        if (changedNativeAssets.length) issues.push('RUBRIC_CONTENT_CHANGED');
        if (hardMissingAssets.length) issues.push('MISSING_ASSET');
        if (unresolvedAssets.length) {
            issues.push('PAYLOAD_UNVERIFIED');
            possible -= 20 * (unresolvedAssets.length / expectedAssets.length);
        }

        var assetStatus = 'VERIFIED';
        if (hardMissingAssets.length) assetStatus = transformedAssets.length ? 'PARTIAL_TRANSFORMED' : 'PARTIAL';
        else if (unresolvedAssets.length) assetStatus = transformedAssets.length ? 'PARTIAL_TRANSFORMED' : (relocatedAssets.length ? 'REPACKAGED_PARTIAL' : 'UNVERIFIED');
        else if (changedNativeAssets.length) assetStatus = transformedAssets.length ? 'PARTIAL_NATIVE_CHANGED' : 'NATIVE_CONTENT_CHANGED';
        else if (transformedAssets.length && transformedAssets.length + presentAssets.length + relocatedAssets.length === expectedAssets.length) assetStatus = 'TRANSFORMED';
        else if (relocatedAssets.length) assetStatus = 'RELOCATED';

        checks.assets = {
            status: assetStatus,
            expected: expectedAssets,
            present: presentAssets,
            transformed: transformedAssets,
            changedNative: changedNativeAssets,
            relocated: relocatedAssets,
            missing: hardMissingAssets,
            unresolved: unresolvedAssets,
            observed: observedAssets,
            matches: assetMatches,
            evidenceConfidence: Math.round(assetEvidenceConfidence * 100),
            reason: hardMissingAssets.length ? 'One or more expected source assets have neither direct/relocated evidence nor sufficient native-transformation evidence.' :
                    unresolvedAssets.length ? 'Some expected source assets remain unresolved; absence is not strong enough to prove loss.' :
                    changedNativeAssets.length ? 'A native Coursera rubric surface exists, but strongly observed source/native evidence indicates rubric content changed during transformation.' :
                    transformedAssets.length ? 'Source PDF payload is positively represented as native Coursera Assignment/rubric content.' :
                    relocatedAssets.length ? 'Expected source asset payload was positively observed in another Coursera item.' : '',
            weight: 20
        };
    } else checks.assets = { status: 'NOT_APPLICABLE', expected: [], matches: [], transformed: [], changedNative: [], relocated: [], weight: 20 };

    var expectedLinks = source.links || [];
    var observedLinks = coursera.links || [];
    if (expectedLinks.length) {
        possible += 10;
        var presentLinks = [], relocatedLinks = [], missingLinks = [], unresolvedLinks = [];
        var linkEvidenceConfidence = Number(coursera.linkEvidenceConfidence || 0);
        if(webpageEvidence && webpageEvidence.transformationCandidate && webpageEvidence.status==='UNVERIFIED' && webpageEvidence.reasonCode!=='LAUNCH_URL_DIFFERS')linkEvidenceConfidence=0;
        expectedLinks.forEach(function(link) {
            if(linkTransformation && link.raw===linkTransformation.sourceUrl){presentLinks.push(linkTransformation.courseraUrl);return;}
            if(webpageEvidence && webpageEvidence.reasonCode==='LAUNCH_URL_DIFFERS' && link.raw===webpageEvidence.sourceUrls[0]){missingLinks.push(link.raw);return;}
            if (qaFindLink_(link, observedLinks)) { presentLinks.push(link.raw); return; }
            var cross = qaFindCrossItemLinkEvidence_(link, allCourseraItems, coursera.id);
            if (cross) { relocatedLinks.push(cross); return; }
            if (linkEvidenceConfidence >= 0.85) missingLinks.push(link.raw); else unresolvedLinks.push(link.raw);
        });
        earned += 10 * ((presentLinks.length + (0.5 * relocatedLinks.length)) / expectedLinks.length);
        if (relocatedLinks.length) issues.push('LINK_RELOCATED');
        if (missingLinks.length) issues.push('LINK_NOT_OBSERVED');
        if (unresolvedLinks.length) {
            issues.push('PAYLOAD_UNVERIFIED');
            possible -= 10 * (unresolvedLinks.length / expectedLinks.length);
        }
        var linkStatus = 'VERIFIED';
        if (missingLinks.length) linkStatus = 'PARTIAL';
        else if (unresolvedLinks.length) linkStatus = relocatedLinks.length ? 'REPACKAGED_PARTIAL' : 'UNVERIFIED';
        else if (relocatedLinks.length) linkStatus = 'RELOCATED';
        checks.links = {
            status: linkStatus,
            expected: expectedLinks.map(function(x) { return x.raw; }),
            present: presentLinks,
            relocated: relocatedLinks,
            missing: missingLinks,
            unresolved: unresolvedLinks,
            observed: observedLinks.map(function(x) { return x.raw; }),
            evidenceConfidence: Math.round(linkEvidenceConfidence * 100),
            reason: missingLinks.length ? 'Expected source link(s) were not observed on a high-confidence item-level link surface.' :
                    unresolvedLinks.length ? 'Some expected source links remain unresolved; item-level evidence is incomplete.' :
                    relocatedLinks.length ? 'Expected link payload was positively observed in another Coursera item.' : '',
            weight: 10
        };
    } else checks.links = { status: 'NOT_APPLICABLE', expected: [], relocated: [], weight: 10 };

    var structuredCheck = qaStructuredAssessmentComparison_(source, coursera);
    if (structuredCheck) {
        checks.structuredAssessment = structuredCheck;
        checks.content = {
            mode: 'STRUCTURED_ASSESSMENT',
            status: structuredCheck.status,
            similarity: structuredCheck.fidelity,
            reason: structuredCheck.reason,
            sourceQuestionCount: structuredCheck.sourceQuestionCount,
            courseraQuestionCount: structuredCheck.courseraQuestionCount,
            alignedQuestionCount: structuredCheck.alignedQuestionCount,
            answerMismatchCount: structuredCheck.answerMismatchCount,
            structuredEvidenceCoverage: structuredCheck.evidenceCoverage,
            weight: 10
        };
        if (structuredCheck.status !== 'UNVERIFIED') {
            possible += 10;
            if (structuredCheck.status === 'VERIFIED') earned += 10;
            else if (structuredCheck.status === 'DRIFT') { earned += 5; issues.push('ASSESSMENT_DRIFT'); }
            else issues.push('ASSESSMENT_CHANGED');
        } else issues.push('PAYLOAD_UNVERIFIED');
    } else if (transformationCheck && Number(transformationCheck.rubricMismatchCount || 0) > 0) {
        possible += 10;
        issues.push('RUBRIC_CONTENT_CHANGED');
        checks.content = {
            mode: 'NATIVE_TRANSFORMATION', status: 'CHANGED', similarity: transformationCheck.confidence,
            reason: 'The Assignment PDF transformation is positively evidenced, but the fully observed source rubric materially differs from the captured native Coursera rubric criteria/content.', weight: 10
        };
    } else if (transformationCheck && transformationCheck.status === 'VERIFIED') {
        possible += 10;
        earned += 10;
        issues.push('PAYLOAD_TRANSFORMED');
        checks.content = {
            mode: 'NATIVE_TRANSFORMATION', status: 'VERIFIED', similarity: transformationCheck.confidence,
            reason: transformationCheck.reason, weight: 10
        };
    } else {
        var textCheck = qaTextComparison_(source, coursera);
        checks.content = textCheck; checks.content.weight = 10;
        if (textCheck.status !== 'NOT_APPLICABLE' && textCheck.status !== 'UNVERIFIED') {
            possible += 10;
            if (textCheck.status === 'VERIFIED') earned += 10;
            else if (textCheck.status === 'DRIFT') { earned += 5; issues.push('CONTENT_DRIFT'); }
            else issues.push('CONTENT_CHANGED');
        } else if (textCheck.status === 'UNVERIFIED') issues.push('PAYLOAD_UNVERIFIED');
    }

    if (coursera.published !== null) {
        possible += 5;
        if (snapshotContext && snapshotContext.mode === 'RAW_INGESTION') {
            // In an untouched ingestion snapshot publication is an observed state,
            // not a source-fidelity failure. Record it while preserving the 5-point
            // evidence dimension so raw shells are not punished merely for being drafts.
            earned += 5;
            checks.publication = {
                status:coursera.published ? 'RAW_PUBLISHED' : 'RAW_UNPUBLISHED',
                published:coursera.published,
                weight:5,
                reason:'Raw-ingestion mode observes publication state without treating an unpublished draft as content loss.'
            };
        } else {
            if (coursera.published) earned += 5; else issues.push('UNPUBLISHED');
            checks.publication = { status: coursera.published ? 'VERIFIED' : 'UNPUBLISHED', published: coursera.published, weight: 5 };
        }
    } else checks.publication = { status: 'UNVERIFIED', published: null, weight: 5 };

    var fidelity = possible ? Math.round((earned / possible) * 100) : 0;
    var coverage = Math.min(100, Math.round(possible));
    var hardIssue = issues.indexOf('TYPE_MUTATION') > -1 || issues.indexOf('MISSING_ASSET') > -1 || issues.indexOf('LINK_NOT_OBSERVED') > -1 || issues.indexOf('CONTENT_CHANGED') > -1 || issues.indexOf('RUBRIC_CONTENT_CHANGED') > -1 || issues.indexOf('ASSESSMENT_CHANGED') > -1 || issues.indexOf('UNPUBLISHED') > -1;
    var relocatedIssue = issues.indexOf('ASSET_RELOCATED') > -1 || issues.indexOf('LINK_RELOCATED') > -1;
    var transformedIssue = issues.indexOf('PAYLOAD_TRANSFORMED') > -1;

    var verdict = 'VERIFIED';
    if (issues.indexOf('BEHAVIOR_MUTATION') > -1) verdict = 'BEHAVIOR_MUTATION';
    else if (issues.indexOf('TYPE_MUTATION') > -1) verdict = 'TYPE_MUTATION';
    else if (issues.indexOf('UNPUBLISHED') > -1 && issues.indexOf('MISSING_ASSET') === -1 && issues.indexOf('LINK_NOT_OBSERVED') === -1 && issues.indexOf('CONTENT_CHANGED') === -1 && issues.indexOf('CONTENT_DRIFT') === -1 && !relocatedIssue) verdict = 'STATE_MUTATION';
    else if (hardIssue || issues.indexOf('CONTENT_DRIFT') > -1 || issues.indexOf('ASSESSMENT_DRIFT') > -1 || relocatedIssue) verdict = 'PARTIAL';
    else if (issues.indexOf('RUNTIME_VERIFICATION_REQUIRED') > -1) verdict = 'RUNTIME_REVIEW';
    else if (issues.indexOf('MOVED_ITEM') > -1) verdict = 'MOVED';
    else if (issues.indexOf('PAYLOAD_UNVERIFIED') > -1 || issues.indexOf('BEHAVIOR_UNVERIFIED') > -1 || coverage < 55) verdict = 'UNVERIFIED';
    else if (linkTransformation || transformedIssue && transformationCheck && transformationCheck.status === 'VERIFIED') verdict = 'EXPECTED_TRANSFORMATION';

    var result = {
        sourceId: source.id, sourceName: source.name, sourceType: source.type, sourcePath: source.path,
        courseraId: coursera.id, courseraName: coursera.name, courseraType: coursera.type, courseraPath: coursera.path,
        matchScore: Number(matchScore.toFixed(3)), fidelityPercent: fidelity, evidenceCoverage: coverage,
        earnedPoints: Number(earned.toFixed(2)), possiblePoints: possible, verdict: verdict,
        issues: issues.filter(function(value, index, array) { return array.indexOf(value) === index; }), checks: checks,
        evidenceSources: coursera.evidenceSources || [],
        snapshotContext: snapshotContext || null
    };
    result.ownerAction = qaOwnerActionForResult_(result);
    result.evidenceStrength = qaEvidenceStrength_(result);
    return result;
}

function qaBuildSummary_(itemResults, injected) {
    var summary = {
        totalSourceItems: itemResults.length,
        verified: 0, partial: 0, unverified: 0, missing: 0, repackaged: 0, expectedTransformations: 0, intentionalExclusions: 0,
        manualRemovals:0, manualRegressions:0,
        ingestionFailures:0, behaviorMutations:0, runtimeReviews:0, dependencyProxies:0, hiddenDependencyReviews:0, dependenciesVerified:0,
        mutations: 0, moved: 0, stateMutations: 0, rawUnpublished: 0,
        extraCourseraItems: (injected || []).length,
        observedFidelity: 0, evidenceCoverage: 0,
        ownerCritical: 0, ownerReview: 0, ownerEvidence: 0
    };
    var totalEarned = 0, totalPossible = 0, coveragePoints = 0;
    itemResults.forEach(function(item) {
        if (item.verdict === 'VERIFIED') summary.verified++;
        else if (item.verdict === 'INGESTION_FAILURE') summary.ingestionFailures++;
        else if (item.verdict === 'BEHAVIOR_MUTATION') summary.behaviorMutations++;
        else if (item.verdict === 'RUNTIME_REVIEW') summary.runtimeReviews++;
        else if (item.verdict === 'DEPENDENCY_PROXY') summary.dependencyProxies++;
        else if (item.verdict === 'HIDDEN_DEPENDENCY_REVIEW') summary.hiddenDependencyReviews++;
        else if (item.verdict === 'DEPENDENCY_VERIFIED') summary.dependenciesVerified++;
        else if (item.verdict === 'EXPECTED_TRANSFORMATION') summary.expectedTransformations++;
        else if (item.verdict === 'PARTIAL') summary.partial++;
        else if (item.verdict === 'UNVERIFIED') summary.unverified++;
        else if (item.verdict === 'MISSING') summary.missing++;
        else if (item.verdict === 'MANUAL_REMOVAL_REVIEW') summary.manualRemovals++;
        else if (item.verdict === 'REPACKAGED') summary.repackaged++;
        else if (item.verdict === 'INTENTIONAL_EXCLUSION') summary.intentionalExclusions++;
        else if (item.verdict === 'TYPE_MUTATION') summary.mutations++;
        else if (item.verdict === 'MOVED') summary.moved++;
        else if (item.verdict === 'STATE_MUTATION') summary.stateMutations++;

        if (item.verdict === 'MISSING' || item.verdict === 'MANUAL_REMOVAL_REVIEW') totalPossible += 100;
        else if (item.verdict === 'DEPENDENCY_PROXY' || item.verdict === 'DEPENDENCY_VERIFIED' || item.verdict === 'HIDDEN_DEPENDENCY_REVIEW') { /* dependency nodes are not independent learner-item denominator entries */ }
        else { totalEarned += Number(item.earnedPoints || 0); totalPossible += Number(item.possiblePoints || 0); }
        if (item.checks && item.checks.publication && item.checks.publication.status === 'RAW_UNPUBLISHED') summary.rawUnpublished++;
        if (item.verdict !== 'DEPENDENCY_PROXY' && item.verdict !== 'DEPENDENCY_VERIFIED' && item.verdict !== 'HIDDEN_DEPENDENCY_REVIEW') coveragePoints += (item.verdict === 'MISSING' || item.verdict === 'MANUAL_REMOVAL_REVIEW') ? 30 : Number(item.evidenceCoverage || 0);
        if ((item.issues || []).indexOf('MANUAL_PAYLOAD_REGRESSION_SINCE_RAW') > -1) summary.manualRegressions++;
        var severity = item.ownerAction && item.ownerAction.severity;
        if (severity === 'CRITICAL') summary.ownerCritical++;
        else if (severity === 'REVIEW') summary.ownerReview++;
        else if (severity === 'EVIDENCE') summary.ownerEvidence++;
    });
    summary.observedFidelity = totalPossible ? Math.round((totalEarned / totalPossible) * 100) : 0;
    var coverageDenominator = itemResults.filter(function(item){ return ['DEPENDENCY_PROXY','DEPENDENCY_VERIFIED','HIDDEN_DEPENDENCY_REVIEW'].indexOf(item.verdict) === -1; }).length;
    summary.evidenceCoverage = coverageDenominator ? Math.round(coveragePoints / coverageDenominator) : 0;
    return summary;
}