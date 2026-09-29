

function runPostIngestionQa(excelBase64, excelName, jsonBase64, jsonName, targetUuid, snapshotMode, persistResult, lineageMeta, sourceLiveBase64, sourceLiveName, readingRecoveryBase64, readingRecoveryName) {
  authorize_('editor');
  return runPostIngestionQaCore_(excelBase64, excelName, jsonBase64, jsonName, targetUuid, snapshotMode, persistResult, lineageMeta, sourceLiveBase64, sourceLiveName, readingRecoveryBase64, readingRecoveryName, ctiWorkflowIo_());
}

// Deterministic workflow; storage is supplied explicitly by the host.
function runPostIngestionQaCore_(excelBase64, excelName, jsonBase64, jsonName, targetUuid, snapshotMode, persistResult, lineageMeta, sourceLiveBase64, sourceLiveName, readingRecoveryBase64, readingRecoveryName, io) {
    var tempFileId = null;
    if (persistResult === undefined || persistResult === null) persistResult = true;
    if (typeof lineageMeta === 'string' && lineageMeta) { try { lineageMeta = JSON.parse(lineageMeta); } catch (e) { lineageMeta = {}; } }
    if (!lineageMeta || typeof lineageMeta !== 'object') lineageMeta = {};

    try {
        if (!excelBase64) return { success: false, error: "Coursera Excel export is required as the authoritative structural inventory. Fingerprint JSON is optional payload enrichment." };
        if (String(excelBase64).length > 35000000) return { success:false, error:"Coursera Excel export is larger than the 25 MB QA safety limit." };
        if (readingRecoveryBase64 && !jsonBase64)return {success:false,error:'Attach the original full Coursera JSON together with its reading recovery JSON.'};
        if (readingRecoveryBase64 && String(readingRecoveryBase64).length>35000000)return {success:false,error:'Reading recovery JSON exceeds the 25 MB limit.'};
        if (jsonBase64 && String(jsonBase64).length > 35000000) return { success:false, error:"Coursera fingerprint JSON is larger than the 25 MB QA safety limit." };
        if (sourceLiveBase64 && String(sourceLiveBase64).length > 56000000) return { success:false, error:"Brightspace live-source JSON is larger than the 40 MB QA safety limit." };
        targetUuid = validateUuid_(targetUuid);

        var dbData = io.loadPackage(targetUuid);
        if (!dbData.success) throw new Error("Could not load original package structure for comparison.");

        var originalItems = flattenTreeForQa_(dbData.tree);
        var coreItems = [], bundledAssets = [];
        originalItems.forEach(function(item) {
            if (item.isRawAsset) bundledAssets.push(item);
            else coreItems.push(normalizeSourceItem_(item));
        });

        var liveSourceCapture = sourceLiveBase64 ? qaParseBrightspaceGroundTruthCapture_(sourceLiveBase64, sourceLiveName) : null;
        var liveSourceGroundTruth = null;
        if (liveSourceCapture) {
            var liveApplied = qaApplyBrightspaceGroundTruth_(coreItems, liveSourceCapture, dbData.packageMeta || {}, bundledAssets);
            coreItems = liveApplied.sourceItems;
            liveSourceGroundTruth = liveApplied.report;
        }

        var courseraItems = [];
        var courseraEvidenceItems = [];
        var liveEvidenceItems = [];
        var liveEmbeddedFiles = [];
        var sourceInfo = [];
        var extractorMeta = {};
        var jsonItemsForCoherence = [];
        var parsedPageMeta = {};
        var inputCoherence = { status:'NOT_CHECKED', reason:'XLSX↔JSON coherence has not been evaluated.' };

        if (jsonBase64) {
            var jsonStr = Utilities.newBlob(Utilities.base64Decode(jsonBase64)).getDataAsString();
            var parsed = JSON.parse(jsonStr);
            qaAssertNotDiagnosticCapture_(parsed);
            if(parsed.kind==='CTI_COURSERA_READING_RECOVERY')throw new Error('Select the original full capture as the fingerprint JSON and attach this file under Reading recovery JSON.');
            if(readingRecoveryBase64)parsed=qaApplyReadingRecovery_(parsed,JSON.parse(Utilities.newBlob(Utilities.base64Decode(readingRecoveryBase64)).getDataAsString()),readingRecoveryName);
            liveEmbeddedFiles = parsed.embeddedFiles || [];
            extractorMeta = parsed.meta || parsed.extractionMeta || {};
            // This receipt is computed from the supplied XLSX below; never trust
            // one embedded in an old or externally edited capture JSON.
            delete extractorMeta.xlsxTraversalInventory;
            parsedPageMeta = parsed.page || {};
            extractorMeta.schemaVersion = parsed.schemaVersion || extractorMeta.schemaVersion || null;
            extractorMeta.buildId = parsed.buildId || extractorMeta.buildId || '';
            extractorMeta.extractor = parsed.extractor || extractorMeta.extractor || '';
            extractorMeta.capturedAt = parsed.capturedAt || parsed.extractedAt || extractorMeta.capturedAt || '';
            extractorMeta.page = parsedPageMeta;

            if (parsed.fingerprints && parsed.fingerprints.length > 0) {
                parsed.fingerprints.forEach(function(item) { courseraItems.push(normalizeCourseraItem_(item)); });
                liveEvidenceItems = courseraItems.slice();
                jsonItemsForCoherence = courseraItems.slice();
                sourceInfo.push('Coursera Item Fingerprint JSON v' + String(parsed.schemaVersion || '2'));
            } else if (parsed.api && parsed.api.authoringCourseMaterials && parsed.api.authoringCourseMaterials.data) {
                var topElements = (((parsed.api.authoringCourseMaterials.data || {}).elements || [])[0] || {}).material;
                var modules = topElements && topElements.elements ? topElements.elements : [];
                modules.forEach(function(mod) {
                    var lessonTracks = mod.elements || [];
                    lessonTracks.forEach(function(track) {
                        var cItems = track.elements || [];
                        cItems.forEach(function(item) {
                            var itemName = item.originalName || item.name || 'Untitled Item';
                            var typeName = (item.content && item.content.typeName) ? item.content.typeName : 'Reading';
                            courseraItems.push(normalizeCourseraItem_({
                                id: item.id || item.itemId || '',
                                type: typeName,
                                name: itemName,
                                path: '',
                                payload: { files: [], links: [], images: [], textSample: '', textLength: 0, published: null },
                                evidenceLevel: 'structure-only'
                            }));
                        });
                    });
                });
                sourceInfo.push('Legacy Coursera Backend API JSON');
            } else if (parsed.items && parsed.items.length > 0) {
                parsed.items.forEach(function(item) { courseraItems.push(normalizeCourseraItem_(item)); });
                sourceInfo.push(excelBase64 ? 'Legacy Live DOM JSON (Assets)' : 'Legacy Live DOM JSON (Structure + Assets)');
            }
        }

        if (!liveEvidenceItems.length && courseraItems.length) liveEvidenceItems = courseraItems.slice();
        courseraEvidenceItems = courseraItems.slice();

        if (excelBase64) {
            var blob = Utilities.newBlob(
                Utilities.base64Decode(excelBase64),
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                excelName
            );
            var tempFile = io.importWorkbook(blob, 'Temp_QA_' + targetUuid);
            tempFileId = tempFile.id;

            var ss = io.openWorkbook(tempFileId);
            var sheet = ss.getSheetByName('FOR IMPORT') || ss.getSheets()[0];
            var data = sheet.getDataRange().getValues();
            var validTypes = qaCourseraExcelItemTypes_();
            var excelItems = [];
            var currentModule = '';
            var currentLesson = '';
            var awaitingModuleName = false;
            var awaitingLessonName = false;

            for (var i = 0; i < data.length; i++) {
                var v0 = String(data[i][0] || '').trim();
                var v1 = String(data[i][1] || '').trim();
                var lower0 = v0.toLowerCase();

                if (lower0 === 'module') {
                    awaitingModuleName = true;
                    awaitingLessonName = false;
                    currentLesson = '';
                    continue;
                }
                if (lower0 === 'lesson') {
                    awaitingLessonName = true;
                    continue;
                }
                if (v0 === '***Name' && awaitingModuleName) {
                    currentModule = v1;
                    awaitingModuleName = false;
                    continue;
                }
                if (v0 === '***Name' && awaitingLessonName) {
                    currentLesson = v1;
                    awaitingLessonName = false;
                    continue;
                }

                if (validTypes.indexOf(lower0) > -1 && v1) {
                    excelItems.push(normalizeCourseraItem_({
                        id: String(data[i][7] || '').trim(),
                        type: v0,
                        name: v1,
                        // Source IMSCC paths are normalized at the module level, so use
                        // the Coursera module as the comparable placement dimension.
                        path: currentModule || '',
                        lesson: currentLesson || '',
                        payload: {},
                        evidenceLevel: 'excel-structure',
                        evidenceSources: ['Coursera Excel Export']
                    }));
                }
            }

            if (!courseraEvidenceItems.length) courseraEvidenceItems = courseraItems.slice();

            inputCoherence = qaAssessSnapshotCoherence_(excelItems, jsonItemsForCoherence.length ? jsonItemsForCoherence : courseraItems, parsedPageMeta, excelName, jsonName);
            extractorMeta.inputCoherence = inputCoherence;
            extractorMeta.xlsxTraversalInventory=qaXlsxTraversalInventory_(data,jsonItemsForCoherence.length?jsonItemsForCoherence:courseraItems,parsedPageMeta,excelName,jsonName);
            if (jsonBase64 && inputCoherence.status === 'FAIL') {
                return { success:false, error:'Input coherence check failed: ' + inputCoherence.reason + ' XLSX=' + String(excelName || '') + ' | JSON=' + String(jsonName || '') };
            }

        if (courseraItems.length === 0) {
                courseraItems = excelItems;
                sourceInfo.unshift("Excel (Authoritative Structure + IDs + Placement)");
            } else {
                // v4.2 architecture: the Coursera Excel export is authoritative for
                // visible structure, stable item IDs, titles, types and placement.
                // The live JSON is used only to enrich those canonical Excel items
                // with payload evidence. This prevents lesson/module API objects from
                // being misclassified as EXTRA Coursera items.
                var liveItems = courseraItems.slice();
                var consumedLiveIds = Object.create(null);
                var liveById = Object.create(null);
                var liveByName = Object.create(null);

                liveItems.forEach(function(item) {
                    if (item.id) {
                        var idKey = String(item.id).toLowerCase();
                        if (!liveById[idKey]) liveById[idKey] = [];
                        liveById[idKey].push(item);
                    }
                    var liveNameKey = qaCleanName_(item.name);
                    if (liveNameKey) {
                        if (!liveByName[liveNameKey]) liveByName[liveNameKey] = [];
                        liveByName[liveNameKey].push(item);
                    }
                });

                var enrichedExcelItems = excelItems.map(function(excelItem) {
                    var liveMatch = null;
                    if (excelItem.id) {
                        var candidatesById = liveById[String(excelItem.id).toLowerCase()] || [];
                        if (candidatesById.length) liveMatch = candidatesById[0];
                    }
                    if (!liveMatch) {
                        var candidatesByName = liveByName[qaCleanName_(excelItem.name)] || [];
                        if (candidatesByName.length) liveMatch = candidatesByName[0];
                    }
                    if (liveMatch && liveMatch.id) consumedLiveIds[String(liveMatch.id).toLowerCase()] = true;
                    return qaMergeCourseraPayload_(excelItem, liveMatch);
                });

                extractorMeta.liveFingerprintCount = liveItems.length;
                extractorMeta.excelCanonicalItemCount = excelItems.length;
                extractorMeta.liveFingerprintsIgnoredForStructure = Math.max(0, liveItems.length - enrichedExcelItems.filter(function(item) {
                    return (item.evidenceSources || []).some(function(source) { return source !== 'Coursera Excel Export'; });
                }).length);

                courseraItems = enrichedExcelItems;

                // v6.6.1: Excel remains the ONLY structural authority. Unmatched live
                // fingerprints are retained strictly as evidence-only nodes so their
                // files/links can participate in cross-item recovery and the Author
                // Alignment Report can be parsed. They cannot become structural items.
                courseraEvidenceItems = enrichedExcelItems.slice();
                liveItems.forEach(function(liveItem) {
                    var idKey = String(liveItem.id || '').toLowerCase();
                    if (idKey && consumedLiveIds[idKey]) return;
                    liveItem.evidenceOnly = true;
                    liveItem.structuralAuthority = false;
                    courseraEvidenceItems.push(liveItem);
                });
                sourceInfo.push("Excel (Authoritative Structure) + Live JSON (Payload Enrichment)");
            }
        }

        if (!excelBase64 && jsonBase64) {
            inputCoherence = qaAssessSnapshotCoherence_([], jsonItemsForCoherence.length ? jsonItemsForCoherence : courseraItems, parsedPageMeta, excelName, jsonName);
            extractorMeta.inputCoherence = inputCoherence;
        }

        if (courseraItems.length === 0) {
            return { success: false, error: "No valid Coursera structural items were found in the uploaded file(s)." };
        }

        // v6.6 lifecycle context is resolved only after Excel has established the
        // authoritative Coursera structure and live JSON has been merged as payload
        // evidence. This keeps Auto-detect correct for both XLSX+JSON and JSON-only
        // runs while preserving Excel-only structural authority.
        var generationContext = io.loadGeneration(targetUuid,lineageMeta);
        var currentSnapshotIngestionIntelligence = qaLocalizeNamedIngestionClaims_(qaParseSmartIngestionIntelligence_(courseraEvidenceItems), coreItems);
        var ingestionIntelligence = qaMergeGenerationIngestionIntelligence_(
            currentSnapshotIngestionIntelligence,
            generationContext.provenanceIntelligence,
            generationContext.provenanceSourceRunId
        );
        ingestionIntelligence = qaLocalizeNamedIngestionClaims_(ingestionIntelligence, coreItems);
        // Auto snapshot detection must use what exists NOW, not a historical
        // Author Alignment Report remembered from an earlier snapshot.
        var snapshotContext = qaResolveSnapshotContext_(snapshotMode, courseraItems, currentSnapshotIngestionIntelligence);
        snapshotContext = qaApplySnapshotStageGuard_(snapshotContext, generationContext, courseraItems, {
            excelSha256:qaSha256Base64_(excelBase64),jsonSha256:qaSha256Base64_(jsonBase64),
            hasReadingRecovery:!!readingRecoveryBase64 || !!extractorMeta.supplementalReadingRecovery
        });
        var destinationReadiness = null;
        var courseLevelFailure = qaCourseLevelFailure_(coreItems, courseraItems, (dbData.packageMeta && dbData.packageMeta.partner) || '');

        var itemResults = [];
        var missing = [];
        var mutations = [];
        var partial = [];
        var payloadUnverified = [];
        var matched = [];
        var moved = [];
        var stateMutations = [];
        var repackaged = [];

        function markConsolidationCarrier_(carrierId, sourceName) {
            var key = String(carrierId || '').toLowerCase();
            if (!key) return;
            courseraItems.forEach(function(item) {
                if (String(item.id || '').toLowerCase() !== key) return;
                if (!Array.isArray(item.repackagedSourceNames)) item.repackagedSourceNames = [];
                if (item.repackagedSourceNames.indexOf(sourceName) === -1) item.repackagedSourceNames.push(sourceName);
            });
        }

        var oneToManyAggregates = [];
        coreItems.forEach(function(src){
            if(src && src.hiddenDependency) return;
            var built=qaOneToManyAggregateForSource_(src,courseraItems,ingestionIntelligence);
            if(built && built.aggregate){
                oneToManyAggregates.push(built.aggregate);
                (built.children||[]).forEach(function(child){ markConsolidationCarrier_(child && child.id, src.name || ''); });
            }
        });
        var matchingCourseraItems = courseraItems.concat(oneToManyAggregates);
        var matchPlan = qaBuildGlobalMatchPlan_(coreItems, matchingCourseraItems);
        for (var s = 0; s < coreItems.length; s++) {
            var source = coreItems[s];

            if (source.hiddenDependency) {
                itemResults.push(qaBuildHiddenDependencyResult_(source, courseraEvidenceItems, snapshotContext));
                continue;
            }

            var plannedMatch = matchPlan[s] || null;
            var bestIdx = plannedMatch ? plannedMatch.courseraIndex : -1;
            var bestScore = plannedMatch ? plannedMatch.score : 0;

            if (bestIdx === -1 || bestScore < 0.78) {
                // v6.5: structural absence does not automatically mean payload loss; cross-item recovery requires concrete evidence.
                // Search all observed Coursera items for strong POSITIVE source payload evidence.
                var crossItemRecovery = qaFindCrossItemPayloadEvidence_(source, courseraEvidenceItems, '');
                crossItemRecovery = qaAugmentCrossItemRecoveryWithSemanticEvidence_(source, crossItemRecovery, courseraItems, '');
                if (crossItemRecovery.hasPositiveEvidence) {
                    var repackagedResult = qaBuildRepackagedMissingResult_(source, crossItemRecovery, snapshotContext);
                    if(source.sourceTextNormalization) repackagedResult.checks.sourceTextNormalization=source.sourceTextNormalization;
                    var repClaims = qaSmartIngestionClaimsForSource_(source, ingestionIntelligence);
                    if (repClaims.length) {
                        repackagedResult.checks.ingestionProvenance = {
                            status:'CLAIM_CONFIRMED_BY_PAYLOAD', claims:repClaims, trustModel:'CLAIM_PLUS_OBSERVATION',
                            reason:'Smart Ingestion reports a consolidation/adaptation involving this source item, and CTI independently recovered positive payload evidence in Coursera.'
                        };
                        repackagedResult.evidenceSources = (repackagedResult.evidenceSources || []).concat(['Smart Ingestion Author Alignment Report']);
                    }
                    repackagedResult.snapshotContext = snapshotContext;
                    itemResults.push(repackagedResult);
                    repackaged.push({
                        name: source.name, type: source.type, path: source.path,
                        recoveryRatio: crossItemRecovery.recoveryRatio,
                        carriers: crossItemRecovery.carriers,
                        relocatedAssets: crossItemRecovery.relocatedAssets,
                        relocatedLinks: crossItemRecovery.relocatedLinks,
                        unresolvedAssets: crossItemRecovery.unresolvedAssets,
                        unresolvedLinks: crossItemRecovery.unresolvedLinks,
                        sourcePayloadAvailable: crossItemRecovery.sourcePayloadAvailable,
                        titleDerivedRecovery: crossItemRecovery.titleDerivedRecovery
                    });
                    (crossItemRecovery.carriers || []).forEach(function(carrier) { markConsolidationCarrier_(carrier.id, source.name); });
                    continue;
                }

                var exclusionClaim = qaExplicitExclusionClaimForSource_(source, ingestionIntelligence);
                if (exclusionClaim) {
                    var exclusionResult = qaBuildIntentionalExclusionResult_(source, exclusionClaim, snapshotContext);
                    itemResults.push(exclusionResult);
                    continue;
                }

                var sourceIngestionClaims = qaSmartIngestionClaimsForSource_(source, ingestionIntelligence);
                var missingResult = {
                    sourceId: source.id,
                    sourceName: source.name,
                    sourceType: source.type,
                    sourcePath: source.path,
                    courseraId: '',
                    courseraName: '',
                    courseraType: '',
                    courseraPath: '',
                    matchScore: Number(bestScore.toFixed(3)),
                    fidelityPercent: 0,
                    evidenceCoverage: 30,
                    earnedPoints: 0,
                    possiblePoints: 100,
                    verdict: 'MISSING',
                    issues: ['MISSING_ITEM'],
                    checks: {
                        structure: { status: 'MISSING', weight: 30 },
                        reconciliationDiagnostic: qaMissingReconciliationDiagnostic_(source, courseraItems),
                        crossItemRecovery: {
                            status: 'NONE',
                            expectedAssets: (source.assetDetails || []).length,
                            expectedLinks: (source.links || []).length,
                            sourcePayloadAvailable: ((source.assetDetails || []).length + (source.links || []).length) > 0,
                            positiveEvidenceFound: false,
                            weight: 0
                        },
                        ingestionProvenance: sourceIngestionClaims.length ? {
                            status:'CLAIM_UNCONFIRMED', claims:sourceIngestionClaims, trustModel:'CLAIM_PLUS_OBSERVATION',
                            reason:'Smart Ingestion reports a transformation involving this source item, but CTI did not independently recover the destination payload. The claim does not cancel a MISSING result without positive evidence.'
                        } : null
                    },
                    snapshotContext:snapshotContext,
                    evidenceSources: sourceIngestionClaims.length ? ['Smart Ingestion Author Alignment Report'] : []
                };
                if(source.sourceTextNormalization) missingResult.checks.sourceTextNormalization=source.sourceTextNormalization;
                missingResult = qaApplySourceTextGap_(missingResult,source);
                missingResult = qaApplyUnreachedCarrierGap_(missingResult,source,courseraItems,extractorMeta);
                missingResult.ownerAction = qaOwnerActionForResult_(missingResult);
                missingResult.evidenceStrength = qaEvidenceStrength_(missingResult);
                itemResults.push(missingResult);
                if(missingResult.verdict==='MISSING') missing.push({ name: source.name, type: source.type, path: source.path, id: source.id, matchScore: bestScore });
                else payloadUnverified.push({name:source.name,type:source.type,path:source.path,expectedAssets:source.assetDetails||[],fidelityPercent:0,evidenceCoverage:0,reason:missingResult.ownerAction.action});
                continue;
            }

            var coursera = matchingCourseraItems[bestIdx];
            coursera.matched = true;
            if(coursera.syntheticOneToMany===true){ (coursera.oneToMany && coursera.oneToMany.childIds || []).forEach(function(cid){ courseraItems.forEach(function(real){ if(String(real.id||'')===String(cid||'')) real.matched=true; }); }); }
            var result = compareItemFidelity_(source, coursera, bestScore, courseraEvidenceItems, snapshotContext, ingestionIntelligence);
            if(coursera.syntheticOneToMany===true) result = qaDecorateOneToManyResult_(source,coursera,result);
            result = qaApplySmartIngestionProvenanceToResult_(source,result,ingestionIntelligence,courseraItems);
            result.matchMethod = plannedMatch ? plannedMatch.method : 'UNPLANNED';
            itemResults.push(result);
            ((result.checks && result.checks.assets && result.checks.assets.relocated) || []).forEach(function(m) { markConsolidationCarrier_(m.carrierId, source.name); });
            ((result.checks && result.checks.links && result.checks.links.relocated) || []).forEach(function(m) { markConsolidationCarrier_(m.carrierId, source.name); });

            if (result.verdict === 'TYPE_MUTATION') {
                mutations.push({
                    origName: source.name,
                    origType: source.type,
                    origPath: source.path,
                    newName: coursera.name,
                    newType: coursera.type,
                    newPath: coursera.path,
                    fidelityPercent: result.fidelityPercent
                });
            } else if (result.verdict === 'PARTIAL') {
                partial.push({
                    name: source.name,
                    type: source.type,
                    path: source.path,
                    courseraName: coursera.name,
                    courseraType: coursera.type,
                    presentAssets: (result.checks.assets && result.checks.assets.present) || [],
                    missingAssets: (result.checks.assets && result.checks.assets.missing) || [],
                    relocatedAssets: (result.checks.assets && result.checks.assets.relocated) || [],
                    unresolvedAssets: (result.checks.assets && result.checks.assets.unresolved) || [],
                    presentLinks: (result.checks.links && result.checks.links.present) || [],
                    missingLinks: (result.checks.links && result.checks.links.missing) || [],
                    relocatedLinks: (result.checks.links && result.checks.links.relocated) || [],
                    unresolvedLinks: (result.checks.links && result.checks.links.unresolved) || [],
                    contentStatus: result.checks.content ? result.checks.content.status : 'NOT_APPLICABLE',
                    fidelityPercent: result.fidelityPercent,
                    evidenceCoverage: result.evidenceCoverage,
                    issues: result.issues
                });
            } else if (result.verdict === 'UNVERIFIED') {
                var expectedAssets = (result.checks.assets && result.checks.assets.expected) || [];
                payloadUnverified.push({
                    name: source.name,
                    type: source.type,
                    path: source.path,
                    expectedAssets: expectedAssets,
                    fidelityPercent: result.fidelityPercent,
                    evidenceCoverage: result.evidenceCoverage,
                    reason: 'The item matched structurally, but one or more payload dimensions were not exposed with enough item-specific evidence.'
                });
            } else if (result.verdict === 'MOVED') {
                moved.push({
                    name: source.name,
                    type: source.type,
                    sourcePath: source.path,
                    courseraPath: coursera.path,
                    fidelityPercent: result.fidelityPercent
                });
            } else if (result.verdict === 'STATE_MUTATION') {
                stateMutations.push({
                    name: source.name,
                    type: source.type,
                    path: source.path,
                    courseraName: coursera.name,
                    published: result.checks.publication ? result.checks.publication.published : null,
                    fidelityPercent: result.fidelityPercent,
                    issues: result.issues
                });
            } else {
                matched.push({
                    name: source.name,
                    type: source.type,
                    path: source.path,
                    fidelityPercent: result.fidelityPercent,
                    evidenceCoverage: result.evidenceCoverage
                });
            }
        }

        qaAttachSourceAssetProvenance_(courseraItems, originalItems);
        var injected = [];
        courseraItems.forEach(function(item) {
            if (!item.matched) {
                var extraInfo = qaClassifyExtraItem_(item);
                injected.push({
                    id: item.id,
                    name: item.name,
                    type: item.type,
                    path: item.path,
                    files: item.files,
                    links: item.links,
                    sourceAssetProvenance: item.sourceAssetProvenance || null,
                    classification: extraInfo.classification,
                    extraLabel: extraInfo.label,
                    severity: extraInfo.severity,
                    ownerAction: extraInfo.action,
                    repackagedSourceNames: item.repackagedSourceNames || []
                });
            }
        });

        // v7.2: compare later same-generation snapshots with the saved raw
        // baseline before making an operational redo decision. If an item existed
        // immediately after Smart Ingestion and disappears/degrades only after
        // manual cleanup, attribute that change to the manual/current-shell stage.
        var manualChangeAttribution = qaApplySameGenerationManualAttribution_(itemResults,generationContext,snapshotContext);
        if (manualChangeAttribution && manualChangeAttribution.manualRemovalNames && manualChangeAttribution.manualRemovalNames.length) {
            var manualRemovalSet = Object.create(null);
            manualChangeAttribution.manualRemovalNames.forEach(function(n){ manualRemovalSet[qaCleanName_(n)] = true; });
            missing = missing.filter(function(m){ return !manualRemovalSet[qaCleanName_(m && m.name || '')]; });
        }

        // v7.3: historical Smart Ingestion provenance is now reconciled against
        // CURRENT destination evidence before it can create an operator finding.
        // This prevents repaired attachments/pages/settings from being reported
        // forever while still surfacing generated behavior that is actually present.
        var currentStateResolution = qaResolveHistoricalCurrentState_(coreItems,courseraItems,itemResults,ingestionIntelligence,extractorMeta,snapshotContext);
        itemResults = qaApplyCurrentStateResolutionsToResults_(itemResults,currentStateResolution);
        destinationReadiness = qaAssessDestinationReadiness_(courseraItems, ingestionIntelligence, extractorMeta, snapshotContext, currentStateResolution, (dbData.packageMeta||{}).partner);
        qaAttachReadinessActions_(itemResults, courseraItems, destinationReadiness);

        // Backward-compatible global bundled-asset verification.
        var verifiedEmbedded = [], unverifiedBundled = [];
        var observedPackageHashes=Object.create(null);
        courseraItems.forEach(function(item){(item.assetDetails||[]).forEach(function(file){if(/^[a-f0-9]{64}$/i.test(String(file.sha256||'')))observedPackageHashes[String(file.sha256).toLowerCase()]=true;});});
        bundledAssets.forEach(function(asset) {
            var packageFiles=(asset.sourceFiles||[]).filter(function(f){return f.presentInPackage===true && !f.referenceOnly;});
            var exact=packageFiles.length>0 && packageFiles.every(function(f){return /^[a-f0-9]{64}$/i.test(String(f.sha256||'')) && observedPackageHashes[String(f.sha256).toLowerCase()];});
            if(exact)verifiedEmbedded.push(Object.assign({},asset,{verificationMethod:'SHA256_EXACT',contentVerified:true}));
            else if (qaFindAsset_(asset.name, liveEmbeddedFiles)) verifiedEmbedded.push(asset);
            else unverifiedBundled.push(asset);
        });

        var externalRuntimeEvidence = io.externalRuntime(dbData.packageMeta || {});
        var operationalPolicy = workBuildRawQaOperationalPolicy_((dbData.packageMeta && dbData.packageMeta.partner) || '', itemResults, injected, courseLevelFailure);
        // v7.6: the policy gate and operator instructions must say the same thing.
        // Policy-exempt Instructor Resources/Archive findings remain visible for audit
        // but must not tell operators to restore/publish learner content automatically.
        workApplyPolicyAwareOperatorGuidance_(itemResults, injected);
        // Count the final operator actions, including explicit policy exemptions.
        var summary = qaBuildSummary_(itemResults, injected);
        operationalPolicy = qaApplyExternalRuntimePolicy_(operationalPolicy, externalRuntimeEvidence);
        operationalPolicy = qaApplyLiveSourceReviewPolicy_(operationalPolicy, liveSourceGroundTruth);
        operationalPolicy = qaApplyDestinationReadinessPolicy_(operationalPolicy, destinationReadiness);
        // v7.7: diagnosis and operator action are separate. A real ingestion-origin
        // defect remains visible even when another run of the same latest Smart
        // Ingestion would only reproduce the same output.
        operationalPolicy = qaApplyIngestionActionabilityPolicy_(operationalPolicy, lineageMeta, snapshotContext);
        summary.operationalPolicy = operationalPolicy;
        summary.externalRuntimeEvidence = externalRuntimeEvidence;
        summary.liveSourceGroundTruth = liveSourceGroundTruth;
        qaApplyReadinessToSummary_(summary,itemResults,courseraItems,destinationReadiness);
        summary.currentStateResolution = currentStateResolution;

        var qaResult = {
            success: true,
            schemaVersion: 14,
            gatewayRelease: CTI_GATEWAY_RELEASE_,
            engineBuildId: CTI_QA_ENGINE_BUILD_ID_,
            captureReadiness: qaCourseraCaptureReadiness_(extractorMeta,itemResults),
            stats: {
                original: originalItems.length,
                originalCore: coreItems.length,
                coursera: courseraItems.length,
                source: sourceInfo.join(" + "),
                extractorMeta: extractorMeta,
                courseraEvidenceNodeCount: courseraEvidenceItems.length,
                liveEvidenceOnlyNodeCount: courseraEvidenceItems.filter(function(item){ return item.evidenceOnly === true; }).length,
                matchingStrategy:'GLOBAL_EXACT_RESERVATION_V1'
            },
            snapshotContext: snapshotContext,
            courseLevelFailure: courseLevelFailure,
            inputCoherence: inputCoherence,
            ingestionIntelligence: ingestionIntelligence,
            currentStateResolution: currentStateResolution,
            generationEvidenceContext: {
                generation:generationContext.generation,
                correctedAggregateStageRunIds:generationContext.correctedAggregateStageRunIds || [],
                provenanceSourceRunId:generationContext.provenanceSourceRunId || '',
                rawBaselineRunId:generationContext.rawBaselineRunId || '',
                provenanceInherited:!!(ingestionIntelligence.provenanceMemory && ingestionIntelligence.provenanceMemory.inherited),
                provenanceInheritedClaimCount:ingestionIntelligence.provenanceMemory ? Number(ingestionIntelligence.provenanceMemory.inheritedClaimCount || 0) : 0,
                source:generationContext.source || 'NONE'
            },
            manualChangeAttribution: manualChangeAttribution,
            destinationReadiness: destinationReadiness,
            operationalPolicy: operationalPolicy,
            externalRuntimeEvidence: externalRuntimeEvidence,
            liveSourceGroundTruth: liveSourceGroundTruth,
            summary: summary,
            ownerView: qaBuildDestinationOwnerView_(courseraItems, itemResults, destinationReadiness),
            itemResults: itemResults,
            missing: missing,
            repackaged: repackaged,
            bundled: unverifiedBundled,
            verified: verifiedEmbedded,
            mutations: mutations,
            partial: partial,
            payloadUnverified: payloadUnverified,
            moved: moved,
            stateMutations: stateMutations,
            injected: injected,
            matched: matched
        };
        if (persistResult) {
            var isRaw = snapshotContext && snapshotContext.mode === 'RAW_INGESTION';
            qaResult.persistence = io.persistRun(targetUuid, isRaw ? 'SINGLE_C0' : 'SINGLE_C1', qaResult, {
                c0ExcelName:isRaw ? excelName : '', c0JsonName:isRaw ? jsonName : '',
                c1ExcelName:isRaw ? '' : excelName, c1JsonName:isRaw ? '' : jsonName,
                c0ExcelSha256:isRaw ? qaSha256Base64_(excelBase64) : '', c0JsonSha256:isRaw ? qaSha256Base64_(jsonBase64) : '',
                c1ExcelSha256:isRaw ? '' : qaSha256Base64_(excelBase64), c1JsonSha256:isRaw ? '' : qaSha256Base64_(jsonBase64),
                liveSourcePlatform:liveSourceGroundTruth ? 'BRIGHTSPACE' : '', liveSourceFile:sourceLiveName || '', liveSourceSha256:sourceLiveBase64 ? qaSha256Base64_(sourceLiveBase64) : '',
                liveSourceCourseId:liveSourceGroundTruth && liveSourceGroundTruth.course ? String(liveSourceGroundTruth.course.orgUnitId || '') : '',
                liveSourceSchema:liveSourceGroundTruth ? String(liveSourceGroundTruth.schemaVersion || '') : '', liveSourceExtractor:liveSourceGroundTruth ? String(liveSourceGroundTruth.extractor || '') : '', liveSourceBuild:liveSourceGroundTruth ? String(liveSourceGroundTruth.buildId || '') : '',
                lineageRequested: lineageMeta
            });
        }
        return qaResult;

    } catch (e) {
        return { success: false, error: "QA Diff Error: " + e.message };
    } finally {
        if (tempFileId) {
            try { io.getTemporaryFile(tempFileId).setTrashed(true); } catch (e) {}
        }
    }
}
