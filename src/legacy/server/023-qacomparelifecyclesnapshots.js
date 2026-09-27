

function qaCompareLifecycleSnapshots_(rawQa, currentQa) {
    var rawMap = Object.create(null), currentMap = Object.create(null), keys = Object.create(null);
    (rawQa.itemResults || []).forEach(function(item) { var key = qaLifecycleSourceKey_(item); if (key) { rawMap[key] = item; keys[key] = true; } });
    (currentQa.itemResults || []).forEach(function(item) { var key = qaLifecycleSourceKey_(item); if (key) { currentMap[key] = item; keys[key] = true; } });

    var items = [];
    var summary = {
        totalSourceItems: Object.keys(keys).length,
        stable: 0,
        publicationStateMutations: 0,
        rubricMutations: 0,
        contentMutations: 0,
        structureMutations: 0,
        regressions: 0,
        improvedOrResolved: 0,
        persistedIntentionalExclusions: 0,
        persistentMissing: 0,
        currentOnly: 0,
        rawOnly: 0
    };

    Object.keys(keys).forEach(function(key) {
        var raw = rawMap[key] || null;
        var current = currentMap[key] || null;
        var changeTypes = [];
        var notes = [];
        var primary = 'STABLE';
        var effectiveCurrentVerdict = current ? current.verdict : 'ABSENT';
        var ownerAction = 'No lifecycle-specific action is required.';

        if (!raw) {
            primary = 'CURRENT_ONLY';
            changeTypes.push('CURRENT_ONLY');
            summary.currentOnly++;
            ownerAction = 'This source-mapped result exists only in C1. Confirm whether the source fingerprint or C0 snapshot was incomplete.';
        } else if (!current) {
            primary = 'RAW_ONLY';
            changeTypes.push('RAW_ONLY');
            summary.rawOnly++;
            ownerAction = 'This source-mapped result disappeared from the C1 comparison. Review C1 structure/evidence.';
        } else {
            var rawVerdict = String(raw.verdict || '');
            var currentVerdict = String(current.verdict || '');
            var rawPub = qaLifecyclePublication_(raw), currentPub = qaLifecyclePublication_(current);
            var rawRubrics = qaLifecycleRubricCount_(raw), currentRubrics = qaLifecycleRubricCount_(current);
            var rawMismatch = qaLifecycleRubricMismatch_(raw), currentMismatch = qaLifecycleRubricMismatch_(current);
            var rawContent = qaLifecycleContentStatus_(raw), currentContent = qaLifecycleContentStatus_(current);

            if (rawVerdict === 'INTENTIONAL_EXCLUSION' && currentVerdict === 'MISSING') {
                primary = 'PERSISTED_INTENTIONAL_EXCLUSION';
                effectiveCurrentVerdict = 'INTENTIONAL_EXCLUSION';
                changeTypes.push('C0_PROVENANCE_CARRIED_FORWARD');
                notes.push('C0 already established an explicit Smart Ingestion intentional-exclusion provenance. C1 absence is therefore not a newly discovered loss.');
                summary.persistedIntentionalExclusions++;
                ownerAction = 'Do not recreate this item solely because it is absent in C1. Confirm that the C0 intentional exclusion is still appropriate.';
            } else if (rawVerdict === 'MISSING' && currentVerdict === 'MISSING') {
                primary = 'PERSISTENT_MISSING';
                changeTypes.push('PERSISTENT_MISSING');
                notes.push('The source item was missing at C0 and remains missing at C1.');
                summary.persistentMissing++;
                ownerAction = 'This is a persistent loss signal across snapshots. Restore/recreate only after confirming the source item should exist in Coursera.';
            }

            if (rawPub !== null && currentPub !== null && rawPub !== currentPub) {
                changeTypes.push('PUBLICATION_STATE_MUTATION');
                notes.push('Publication changed from ' + (rawPub ? 'PUBLISHED' : 'UNPUBLISHED') + ' at C0 to ' + (currentPub ? 'PUBLISHED' : 'UNPUBLISHED') + ' at C1.');
                summary.publicationStateMutations++;
                if (primary === 'STABLE') primary = 'STATE_MUTATION';
                if (rawPub === false && currentPub === true) ownerAction = 'Expected Ops lifecycle change: item was published after raw ingestion.';
                if (rawPub === true && currentPub === false) ownerAction = 'Review why a previously published item became unpublished in C1.';
            }

            if (rawRubrics !== null && currentRubrics !== null && rawRubrics !== currentRubrics) {
                changeTypes.push('RUBRIC_STRUCTURE_MUTATION');
                notes.push('Native rubric count changed from ' + rawRubrics + ' at C0 to ' + currentRubrics + ' at C1.');
                summary.rubricMutations++;
                if (primary === 'STABLE' || primary === 'STATE_MUTATION') primary = 'RUBRIC_MUTATION';
                ownerAction = 'Review the C1 native rubric against the C0/raw transformation and source rubric. This is an Ops/manual-content change, not an ingestion-loss finding.';
            }
            if (currentMismatch > rawMismatch) {
                if (changeTypes.indexOf('RUBRIC_CONTENT_MUTATION') === -1) {
                    changeTypes.push('RUBRIC_CONTENT_MUTATION');
                    summary.rubricMutations++;
                }
                notes.push('Rubric mismatch evidence increased from ' + rawMismatch + ' to ' + currentMismatch + '.');
                if (primary === 'STABLE' || primary === 'STATE_MUTATION') primary = 'RUBRIC_MUTATION';
                ownerAction = 'Review the manual/native rubric change; source Assignment content may still be preserved even though rubric semantics changed.';
            }

            if (rawContent && currentContent && rawContent !== currentContent && currentContent === 'CHANGED') {
                changeTypes.push('CONTENT_MUTATION');
                notes.push('Content status changed from ' + rawContent + ' at C0 to CHANGED at C1.');
                summary.contentMutations++;
                if (primary === 'STABLE' || primary === 'STATE_MUTATION') primary = 'CONTENT_MUTATION';
                ownerAction = 'Review the C1 learner-facing content change against C0 and source evidence.';
            }

            var typeChanged = qaCleanName_(raw.courseraType || '') !== qaCleanName_(current.courseraType || '') && raw.courseraType && current.courseraType;
            var pathChanged = qaCleanName_(raw.courseraPath || '') !== qaCleanName_(current.courseraPath || '') && raw.courseraPath && current.courseraPath;
            var nameChanged = qaCleanName_(raw.courseraName || '') !== qaCleanName_(current.courseraName || '') && raw.courseraName && current.courseraName;
            if (typeChanged || pathChanged || nameChanged) {
                changeTypes.push('STRUCTURE_MUTATION');
                var bits = [];
                if (nameChanged) bits.push('name');
                if (typeChanged) bits.push('type');
                if (pathChanged) bits.push('placement');
                notes.push('Coursera ' + bits.join('/') + ' changed between C0 and C1.');
                summary.structureMutations++;
                if (primary === 'STABLE' || primary === 'STATE_MUTATION') primary = 'STRUCTURE_MUTATION';
            }

            if (primary !== 'PERSISTED_INTENTIONAL_EXCLUSION' && qaLifecycleBadRank_(currentVerdict) > qaLifecycleBadRank_(rawVerdict) && qaLifecycleGoodVerdict_(rawVerdict)) {
                changeTypes.push('REGRESSION');
                notes.push('Source-fidelity verdict worsened from ' + rawVerdict + ' at C0 to ' + currentVerdict + ' at C1.');
                summary.regressions++;
                primary = 'REGRESSION';
                ownerAction = 'Investigate the C1 change. C0 had stronger positive fidelity evidence than the current snapshot.';
            } else if (qaLifecycleBadRank_(currentVerdict) < qaLifecycleBadRank_(rawVerdict)) {
                changeTypes.push('IMPROVED_OR_RESOLVED');
                notes.push('Source-fidelity verdict improved from ' + rawVerdict + ' at C0 to ' + currentVerdict + ' at C1.');
                summary.improvedOrResolved++;
                if (primary === 'STABLE' || primary === 'STATE_MUTATION') primary = 'IMPROVED_OR_RESOLVED';
            }

            if (primary === 'STABLE') summary.stable++;
        }

        items.push({
            sourceKey:key,
            sourceId:(current && current.sourceId) || (raw && raw.sourceId) || '',
            sourceName:(current && current.sourceName) || (raw && raw.sourceName) || '',
            sourceType:(current && current.sourceType) || (raw && raw.sourceType) || '',
            sourcePath:(current && current.sourcePath) || (raw && raw.sourcePath) || '',
            rawVerdict:raw ? raw.verdict : 'ABSENT',
            currentVerdict:current ? current.verdict : 'ABSENT',
            effectiveCurrentVerdict:effectiveCurrentVerdict,
            rawFidelity:raw && raw.fidelityPercent != null ? raw.fidelityPercent : null,
            currentFidelity:current && current.fidelityPercent != null ? current.fidelityPercent : null,
            rawPublished:raw ? qaLifecyclePublication_(raw) : null,
            currentPublished:current ? qaLifecyclePublication_(current) : null,
            rawCourseraName:raw ? raw.courseraName : '',
            currentCourseraName:current ? current.courseraName : '',
            rawCourseraType:raw ? raw.courseraType : '',
            currentCourseraType:current ? current.courseraType : '',
            rawCourseraPath:raw ? raw.courseraPath : '',
            currentCourseraPath:current ? current.courseraPath : '',
            rawRubricCount:raw ? qaLifecycleRubricCount_(raw) : null,
            currentRubricCount:current ? qaLifecycleRubricCount_(current) : null,
            primaryLifecycleVerdict:primary,
            changeTypes:changeTypes,
            notes:notes,
            ownerAction:ownerAction
        });
    });

    items.sort(function(a, b) {
        var priority = { REGRESSION:0, RUBRIC_MUTATION:1, CONTENT_MUTATION:2, STRUCTURE_MUTATION:3, PERSISTENT_MISSING:4, PERSISTED_INTENTIONAL_EXCLUSION:5, IMPROVED_OR_RESOLVED:6, STATE_MUTATION:7, CURRENT_ONLY:8, RAW_ONLY:8, STABLE:9 };
        var pa = priority[a.primaryLifecycleVerdict] == null ? 9 : priority[a.primaryLifecycleVerdict];
        var pb = priority[b.primaryLifecycleVerdict] == null ? 9 : priority[b.primaryLifecycleVerdict];
        if (pa !== pb) return pa - pb;
        return String(a.sourceName || '').localeCompare(String(b.sourceName || ''));
    });
    return { summary:summary, items:items };
}

function qaLifecycleSnapshotView_(qa) {
    return {
        summary:qa.summary || {},
        snapshotContext:qa.snapshotContext || null,
        inputCoherence:qa.inputCoherence || null,
        ingestionIntelligence:qa.ingestionIntelligence || null,
        stats:{
            original:qa.stats && qa.stats.original || 0,
            originalCore:qa.stats && qa.stats.originalCore || 0,
            coursera:qa.stats && qa.stats.coursera || 0,
            source:qa.stats && qa.stats.source || '',
            extractorMeta:qa.stats && qa.stats.extractorMeta || {}
        },
        itemResults:qa.itemResults || [],
        injected:qa.injected || []
    };
}

function runPostIngestionLifecycleQa(rawExcelBase64, rawExcelName, rawJsonBase64, rawJsonName, currentExcelBase64, currentExcelName, currentJsonBase64, currentJsonName, targetUuid, lineageMeta, sourceLiveBase64, sourceLiveName, rawRecoveryBase64, rawRecoveryName, currentRecoveryBase64, currentRecoveryName) {
    authorize_('editor');
    if (typeof lineageMeta === 'string' && lineageMeta) { try { lineageMeta = JSON.parse(lineageMeta); } catch (e) { lineageMeta = {}; } }
    if (!lineageMeta || typeof lineageMeta !== 'object') lineageMeta = {};
    try {
        if (!rawExcelBase64 || !rawJsonBase64 || !currentExcelBase64 || !currentJsonBase64) {
            return { success:false, error:'Lifecycle QA requires all four snapshot files: C0 Raw XLSX + JSON and C1 Current XLSX + JSON. Excel is structural authority and JSON is payload evidence.' };
        }
        targetUuid = validateUuid_(targetUuid);
        var rawQa = runPostIngestionQa(rawExcelBase64, rawExcelName, rawJsonBase64, rawJsonName, targetUuid, 'raw', false, lineageMeta, sourceLiveBase64, sourceLiveName, rawRecoveryBase64, rawRecoveryName);
        if (!rawQa || !rawQa.success) return { success:false, error:'C0 Raw snapshot failed: ' + String(rawQa && rawQa.error || 'Unknown error') };
        var currentQa = runPostIngestionQa(currentExcelBase64, currentExcelName, currentJsonBase64, currentJsonName, targetUuid, 'ops', false, lineageMeta, sourceLiveBase64, sourceLiveName, currentRecoveryBase64, currentRecoveryName);
        if (!currentQa || !currentQa.success) return { success:false, error:'C1 Current snapshot failed: ' + String(currentQa && currentQa.error || 'Unknown error') };
        if (rawQa.inputCoherence && rawQa.inputCoherence.status === 'FAIL') return { success:false, error:'C0 Raw snapshot files are incoherent: ' + rawQa.inputCoherence.reason };
        if (currentQa.inputCoherence && currentQa.inputCoherence.status === 'FAIL') return { success:false, error:'C1 Current snapshot files are incoherent: ' + currentQa.inputCoherence.reason };

        var lifecycle = qaCompareLifecycleSnapshots_(rawQa, currentQa);
        var lifecycleResult = {
            success:true,
            schemaVersion:2,
            gatewayRelease:CTI_GATEWAY_RELEASE_,
            engineBuildId:CTI_QA_ENGINE_BUILD_ID_,
            lifecycleModel:'S0_SOURCE -> C0_RAW -> C1_OPS',
            rawSnapshot:qaLifecycleSnapshotView_(rawQa),
            currentSnapshot:qaLifecycleSnapshotView_(currentQa),
            lifecycleSummary:lifecycle.summary,
            lifecycleItems:lifecycle.items,
            liveSourceGroundTruth:currentQa.liveSourceGroundTruth || rawQa.liveSourceGroundTruth || null
        };
        lifecycleResult.persistence = persistQaRun_(targetUuid, 'LIFECYCLE', lifecycleResult, {
            c0ExcelName:rawExcelName, c0JsonName:rawJsonName, c1ExcelName:currentExcelName, c1JsonName:currentJsonName,
            c0ExcelSha256:qaSha256Base64_(rawExcelBase64), c0JsonSha256:qaSha256Base64_(rawJsonBase64),
            c1ExcelSha256:qaSha256Base64_(currentExcelBase64), c1JsonSha256:qaSha256Base64_(currentJsonBase64),
            liveSourcePlatform:(currentQa.liveSourceGroundTruth || rawQa.liveSourceGroundTruth) ? 'BRIGHTSPACE' : '', liveSourceFile:sourceLiveName || '', liveSourceSha256:sourceLiveBase64 ? qaSha256Base64_(sourceLiveBase64) : '',
            liveSourceCourseId:(currentQa.liveSourceGroundTruth && currentQa.liveSourceGroundTruth.course) ? String(currentQa.liveSourceGroundTruth.course.orgUnitId || '') : '',
            liveSourceSchema:currentQa.liveSourceGroundTruth ? String(currentQa.liveSourceGroundTruth.schemaVersion || '') : '', liveSourceExtractor:currentQa.liveSourceGroundTruth ? String(currentQa.liveSourceGroundTruth.extractor || '') : '', liveSourceBuild:currentQa.liveSourceGroundTruth ? String(currentQa.liveSourceGroundTruth.buildId || '') : '',
            lineageRequested:lineageMeta
        });
        return lifecycleResult;
    } catch (e) {
        return { success:false, error:'Lifecycle QA Error: ' + e.message };
    }
}

function qaBuildIntentionalExclusionResult_(source, claim, snapshotContext) {
    var result = {
        sourceId:source.id, sourceName:source.name, sourceType:source.type, sourcePath:source.path,
        courseraId:'', courseraName:'', courseraType:'', courseraPath:'', matchScore:0,
        fidelityPercent:null, evidenceCoverage:45, earnedPoints:0, possiblePoints:0,
        verdict:'INTENTIONAL_EXCLUSION', issues:['INTENTIONAL_EXCLUSION'],
        checks:{
            structure:{status:'INTENTIONAL_EXCLUSION', weight:30, reason:'The source item is absent from Coursera structure, and the Smart Ingestion Author Alignment Report explicitly records an intentional exclusion.'},
            ingestionProvenance:{status:'CLAIMED', claims:[claim], trustModel:'CLAIM_PLUS_OBSERVATION', reason:'This is an ingestion provenance claim, not proof that the exclusion was pedagogically correct.'},
            publication:{status:'NOT_APPLICABLE', published:null, weight:5}
        },
        snapshotContext:snapshotContext || null,
        evidenceSources:['Coursera Excel Export','Smart Ingestion Author Alignment Report']
    };
    result.ownerAction = qaOwnerActionForResult_(result);
    result.evidenceStrength = qaEvidenceStrength_(result);
    return result;
}