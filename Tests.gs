// ============================================================================
// CTI REGRESSION TEST SUITE v3.0.0
// Baseline: CTI Evidence Integrity Platform v8.0.0 (QA engine v8.0.0)
// Purpose: catch accidental logic loss across IMSCC, Coursera QA/lifecycle,
//          Macmillan Stage 1-5 contracts, and shared backend utilities.
//
// Add this file to the SAME Apps Script project as Code.gs.
// Run one of these from the Apps Script editor:
//   runCTIFastRegressionSuite()         // no XLSX conversion; fast
//   runCTISourceContractRegressionSuite() // Index.html + frontend/backend contracts
//   runCTIIntegrationRegressionSuite()  // Drive API + temp spreadsheets
//   runCTIFullGoldenRegressionSuite()   // full 33-module Sowder real-world fixture
//   runCTIRegressionSuite()             // all gates; recommended before deployment
//
// Tests create only temporary spreadsheets/files and trash them in finally blocks.
// They do NOT write to the CTI production package database.
// ============================================================================

var CTI_TEST_SUITE_VERSION_ = '3.0.0';
var CTI_TEST_BASELINE_GATEWAY_ = 'v8.0.0';
var CTI_TEST_BASELINE_EXTRACTOR_ = 'v6.14.0';
var CTI_TEST_BASELINE_EXTRACTOR_SCHEMA_ = 34;
var CTI_TEST_BASELINE_TIME_MODEL_ = 'm2-leaf-evidence-20260911';
var CTI_TEST_INDEX_SOURCE_CACHE_ = null;

function runCTIRegressionSuite() {
  var fast = CTI_TEST_runSuite_('FAST', CTI_TEST_fastCases_());
  var sourceContract = CTI_TEST_runSuite_('SOURCE_CONTRACT', CTI_TEST_sourceContractCases_());
  var integration = CTI_TEST_runSuite_('INTEGRATION', CTI_TEST_integrationCases_());
  var fullGolden = CTI_TEST_runSuite_('FULL_GOLDEN', CTI_TEST_fullGoldenCases_());
  var combined = CTI_TEST_mergeReports_([fast, sourceContract, integration, fullGolden]);
  CTI_TEST_logReport_(combined);
  if (combined.failed) throw new Error('CTI regression suite failed: ' + combined.failed + ' failing test(s). See execution log.');
  return combined;
}

function runCTIFastRegressionSuite() {
  var report = CTI_TEST_runSuite_('FAST', CTI_TEST_fastCases_());
  CTI_TEST_logReport_(report);
  if (report.failed) throw new Error('CTI fast regression suite failed: ' + report.failed + ' failing test(s). See execution log.');
  return report;
}

function runCTISourceContractRegressionSuite() {
  var report = CTI_TEST_runSuite_('SOURCE_CONTRACT', CTI_TEST_sourceContractCases_());
  CTI_TEST_logReport_(report);
  if (report.failed) throw new Error('CTI source-contract regression suite failed: ' + report.failed + ' failing test(s). See execution log.');
  return report;
}

function runCTIIntegrationRegressionSuite() {
  var report = CTI_TEST_runSuite_('INTEGRATION', CTI_TEST_integrationCases_());
  CTI_TEST_logReport_(report);
  if (report.failed) throw new Error('CTI integration regression suite failed: ' + report.failed + ' failing test(s). See execution log.');
  return report;
}

function runCTIFullGoldenRegressionSuite() {
  var report = CTI_TEST_runSuite_('FULL_GOLDEN', CTI_TEST_fullGoldenCases_());
  CTI_TEST_logReport_(report);
  if (report.failed) throw new Error('CTI full-golden regression suite failed: ' + report.failed + ' failing test(s). See execution log.');
  return report;
}

function CTI_TEST_fastCases_() {
  return [
    ['v8 / math representation equivalence and question type recovery', CTI_TEST_v8MathAndType_],
    ['v8 / assessment grading behavior is a required dimension', CTI_TEST_v8AssessmentBehavior_],
    ['v8 / dimensional verdict gate blocks binary false pass', CTI_TEST_v8DimensionalBinaryGate_],
    ['v8 / AAR event parser retains unsupported and failure provenance', CTI_TEST_v8AarEvents_],
    ['v8 / failed latest ingestion attempt never becomes latest-applied', CTI_TEST_v8FailedAttemptActionability_],
    ['v8 / consolidated reading can recover semantic activity without recovering assets', CTI_TEST_v8ConsolidatedReading_],
    ['Extractor / release processed network records and retire late owners', CTI_TEST_networkReleaseV7931_],
    ['Brightspace / partial and hyphenated count evidence', CTI_TEST_brightspaceCaptureStatusV7930_],
    ['Assignment / creation controls do not certify grading', CTI_TEST_assignmentMetadata_],
    ['Report / version changes retain answer applicability review', CTI_TEST_olderAnswerReview_],
    ['Reading / mounted attachment state stays item-scoped', CTI_TEST_mountedReadingAssets_],
    ['Reading / attachment labels need captured URLs', CTI_TEST_readingAttachmentCoverage_],
    ['Recovery / later empty proof supersedes generic timeout', CTI_TEST_emptyTimeoutRetry_],
    ['Report / unverified behavior retains owner action', CTI_TEST_behaviorUnverifiedOwner_],
    ['Extractor / scoped progress budgets honor deadlines', CTI_TEST_scopedWaitBudget_],
    ['Assignment / text blocks preserve instruction boundaries', CTI_TEST_assignmentTextBlocks_],
    ['Assignment / instruction evidence survives backend normalization', CTI_TEST_assignmentTextBlockNormalization_],
    ['Report / confirmed empty destination is a content review', CTI_TEST_confirmedEmptyComparison_],
    ['Report / incomplete receipt cannot bypass evidence gaps', CTI_TEST_invalidEmptyComparison_],
    ['Report / answer-only evidence advice preserves applicability', CTI_TEST_answerOnlyGuidance_],
    ['Report / other assessment gaps retain their required checks', CTI_TEST_answerOnlyBoundaries_],
    ['Capture / exact reading receipt and legacy cap', CTI_TEST_exactReadingReceipt_],
    ['Capture / empty editor receipt and stable item identity', CTI_TEST_emptyEditorReceipt_],
    ['Report / unknown choice correctness stays unknown', CTI_TEST_unknownChoiceCorrectness_],
    ['Progress / display failure cannot block capture or change elapsed time', CTI_TEST_progressClockFailure_],
    ['Capture / narrow empty assignment body remains review-only', CTI_TEST_emptyAssessmentBodyScope_],
    ['Capture / focused diagnostic cannot become a course audit', CTI_TEST_rejectFocusedDiagnostic_],
    ['Recovery / immutable merge and evidence coverage', CTI_TEST_readingRecoveryMerge_],
    ['Recovery / exact course, baseline, and item identity', CTI_TEST_readingRecoveryIdentity_],
    ['Recovery / loading, partial document, and capped text', CTI_TEST_readingRecoveryScopes_],
    ['Report / confirmed failure retains source media recovery guidance', CTI_TEST_failureMediaGuidance_],
    ['Report / written-response answer evidence applicability', CTI_TEST_writtenAnswerApplicability_],
    ['Capture / unread same-module carriers prevent false loss claims', CTI_TEST_unreadLinkCarrier_],
    ['Links / content selectors remain distinct', CTI_TEST_contentUrlIdentity_],
    ['Assessment / question media requires separate evidence', CTI_TEST_questionMediaGate_],
    ['Capture / searched targets and observed editors differ', CTI_TEST_editorTraversalTruth_],
    ['Assessment / explicit image creation failure prompts', CTI_TEST_questionImageFailure_],
    ['Assessment / explicit empty editor requires targeted review', CTI_TEST_emptyAssessmentSurface_],
    ['Assessment / exact prompts are reserved before weak matches', CTI_TEST_assessmentExactReservation_],
    ['Provenance / source attachment bytes and unrelated extras', CTI_TEST_sourceAttachmentProvenance_],
    ['Text / PDF preview and description scopes', CTI_TEST_pdfDescriptionScope_],
    ['Plugins / target identity and runtime uncertainty', CTI_TEST_pluginTargetEvidence_],
    ['Policy / non-learner placeholders stay informational', CTI_TEST_placeholderPolicyConsistency_],
    ['Extractor / written responses require observed type and prompt evidence', CTI_TEST_writtenResponseCoverage_],
    ['Extractor / evidence reuse invalidates changed network records', CTI_TEST_networkEvidenceReuse_],
    ['Assessment / repeated status badges remain uncertain', CTI_TEST_repeatedStatusOptions_],
    ['Extractor / recovery visits untouched items first', CTI_TEST_unvisitedRecovery_],
    ['Extractor / recovery preserves item identity and scope', CTI_TEST_editorRecoveryIdentity_],
    ['Drive conversion / bounded transient retries', CTI_TEST_driveConversionRetry_],
    ['Drive conversion / uncertain success and duplicate isolation', CTI_TEST_driveConversionRecovery_],
    ['Drive conversion / persistent and permanent failures stay failures', CTI_TEST_driveConversionFailure_],
    ['Drive conversion / incomplete recovery lookup stops retries', CTI_TEST_driveConversionLookupFailure_],
    ['Drive conversion / legacy v2 conversion and private markers', CTI_TEST_driveConversionLegacy_],
    ['Lineage / aggregate child IDs preserve raw stage', CTI_TEST_aggregateStageIds_],
    ['Lineage / obsolete automatic stage correction is bounded', CTI_TEST_aggregateStageHistory_],
    ['Assessment / feedback-only options retain uncertainty', CTI_TEST_feedbackOnlyOptions_],
    ['Source text / persisted format and error contract', CTI_TEST_sourceTextContract_],
    ['Reliability / RichText', CTI_TEST_reliabilityRichText_],
    ['Reliability / Assets', CTI_TEST_reliabilityAssets_],
    ['Reliability / PrimaryEvidence', CTI_TEST_reliabilityPrimaryEvidence_],
    ['Reliability / AssessmentBounds', CTI_TEST_reliabilityAssessmentBounds_],
    ['Reliability / BrightspaceAnswers', CTI_TEST_reliabilityBrightspaceAnswers_],
    ['IMS discussion / table markup and literal boundaries', CTI_TEST_tableMarkup_],
    ['QA / unconfirmed discussion candidate is not proven missing', CTI_TEST_candidateUncertainty_],
    ['IMS discussion / raw XML and incomplete-source safeguards', CTI_TEST_discussionXml_],
    ['Owner report / incomplete answer evidence is not drift', CTI_TEST_ownerAnswerGap_],
    ['Owner report / family actions preserve residual findings', CTI_TEST_ownerFamilyActions_],
    ['Owner report / readiness is attached by unique destination', CTI_TEST_ownerReadiness_],
    ['Owner report / missing candidate is diagnostic only', CTI_TEST_ownerMissingDiagnostic_],
    ['Owner report / destination outline preserves order and certainty', CTI_TEST_ownerOutline_],
    ['Owner report / current-state action retains object contract', CTI_TEST_ownerCurrentAction_],
    ['BORL / learner text normalization boundaries', CTI_TEST_learnerMarkup_],
    ['BORL / real Stock Planning Card recovery', CTI_TEST_borlDiscussion_],
    ['BORL / image reference provenance and SHA recovery', CTI_TEST_borlImageRefs_],
    ['BORL / legacy QTI rich text and destination literals', CTI_TEST_qtiMarkup_],
    ['Core / sheet formula neutralization', CTI_TEST_sheetSafeText_],
    ['Core / filename normalization', CTI_TEST_filenameNormalization_],
    ['Core / catalog match key', CTI_TEST_matchKey_],
    ['Core / validation boundaries', CTI_TEST_validationBoundaries_],
    ['Core / UUID, version, integer utilities', CTI_TEST_uuidVersionUtilities_],
    ['IMSCC / screenshot IFS + labor fixture', CTI_TEST_ifsLaborScreenshotFixture_],
    ['IMSCC / zero-content and boilerplate IFS overrides', CTI_TEST_ifsOverrides_],
    ['IMSCC / empty-folder and administrative preflight policy', CTI_TEST_emptyFolderPolicies_],
    ['IMSCC / source-evidence parsing and provenance propagation', CTI_TEST_sourceEvidenceParsing_],
    ['IMSCC / source payload projection and manifest fallback', CTI_TEST_sourcePayloadProjection_],
    ['IMSCC / duplicate package planning and conflict safety', CTI_TEST_duplicatePlanning_],
    ['IMSCC / duplicate archive formula safety', CTI_TEST_duplicateArchiveFormulaSafety_],
    ['IMSCC / synthetic manifest analysis', CTI_TEST_imsccSyntheticManifest_],
    ['IMSCC / advanced metrics: orphan, plugin, unknown, extension, empty', CTI_TEST_imsccAdvancedMetrics_],
    ['IMSCC / z-score imbalance and lexical-variance regression', CTI_TEST_imsccZScoreLexical_],
    ['IMSCC / invalid XML root rejected', CTI_TEST_imsccInvalidRoot_],
    ['IMSCC / empty, malformed, and invalid-evidence resilience', CTI_TEST_imsccMalformedInputs_],
    ['IMSCC / hierarchy depth safety limit', CTI_TEST_imsccDepthLimit_],
    ['IMSCC / deterministic preflight decisions', CTI_TEST_preflightDeterministic_],
    ['Coursera / XLSX-JSON coherence PASS and FAIL', CTI_TEST_snapshotCoherence_],
    ['Coursera / type normalization and compatibility', CTI_TEST_courseraTypeContracts_],
    ['Coursera / URL normalization and technical-link filtering', CTI_TEST_courseraUrlContracts_],
    ['Coursera / asset fingerprint similarity hierarchy', CTI_TEST_assetSimilarity_],
    ['Coursera / discussion-prompt positive evidence regression', CTI_TEST_discussionPromptRegression_],
    ['Coursera / 4-question structured assessment regression', CTI_TEST_structuredAssessmentRegression_],
    ['Capture inputs / older Coursera evidence and assessment gaps remain explicit', CTI_TEST_captureInputReadiness_],
    ['Capture inputs / Brightspace question definitions stay distinct from described counts', CTI_TEST_brightspaceCaptureCounts_],
    ['Extractor delivery / canonical script agrees with its served version', CTI_TEST_extractorDeliveryIntegrity_],
    ['Assessment findings / preserve both observed answer and option sets', CTI_TEST_questionDifferenceEvidence_],
    ['Assessment evidence / feedback contamination remains unverified', CTI_TEST_optionBoundaryIntegrity_],
    ['Live-source evidence / attachments and quiz counts retain their scope', CTI_TEST_liveSourceEvidenceScope_],
    ['Link evidence / unobserved plugin targets are review only', CTI_TEST_unobservedPluginTarget_],
    ['Assignment / learner and authoring fields stay separate', CTI_TEST_assignmentLearnerFields_],
    ['Brightspace / observed assignment instructions and behavior', CTI_TEST_brightspaceAssignmentInstructions_],
    ['Web links / exact webpage conversion with launch uncertainty', CTI_TEST_externalWebpageEvidence_],
    ['Web links / target-only plugin evidence retains launch uncertainty and correct report basis', CTI_TEST_targetOnlyPluginEvidence_],
    ['XLSX enrichment / preserve exact link evidence and structural authority', CTI_TEST_mergedWebpageEvidence_],
    ['XLSX enrichment / reject ambiguous identity and URL evidence', CTI_TEST_mergedWebpageSafeguards_],
    ['Stored web-link XML / exact URL recovery and unsafe-input rejection', CTI_TEST_legacyWebLinkXml_],
    ['External webpage / missing source and conflicting URL diagnostics', CTI_TEST_webpageDiagnosticReasons_],
    ['Assignment XML / instruction body and malformed-source safeguards', CTI_TEST_assignmentXml_],
    ['Feedback separation / preserve observed answers and raw evidence', CTI_TEST_joinedOptionFeedback_],
    ['Feedback separation / reject ambiguous and contradictory evidence', CTI_TEST_optionFeedbackSafeguards_],
    ['Coursera / lifecycle publication + exclusion + regression', CTI_TEST_lifecycleRegression_],
    ['Coursera / extra-item classification', CTI_TEST_extraItemClassification_],
    ['Coursera / evidence-strength scoring', CTI_TEST_evidenceStrengthScoring_],
    ['Work / normalization and campaign key', CTI_TEST_workNormalization_],
    ['Work / catalog duplicate resolution by planner owner', CTI_TEST_workCatalogResolution_],
    ['Work / planner title-code extraction', CTI_TEST_workPlannerCodeExtraction_],
    ['Work / SCORM count normalization', CTI_TEST_workScormCount_],
    ['Work / source upload and re-scan next-action gates', CTI_TEST_workSourceNextActions_],
    ['Work / existing raw-shell QA recommendation policy', CTI_TEST_workRawQaRecommendation_],
    ['Work / NAIT redo policy definition', CTI_TEST_workNaitRedoPolicyDefinition_],
    ['Work / NAIT learner-facing path classification', CTI_TEST_workNaitPathPolicy_],
    ['Work / non-LFM missing items do not force re-ingest', CTI_TEST_workNonLfmExemption_],
    ['Work / learner-facing missing item forces re-ingest', CTI_TEST_workLearnerMissingReingest_],
    ['Work / learner-facing type mutation is review-first', CTI_TEST_workTypeMutationReview_],
    ['Work / hard learner-facing payload loss forces re-ingest', CTI_TEST_workHardPayloadReingest_],
    ['Work / administrative vs learner-facing extra policy', CTI_TEST_workExtraOperationalPolicy_],
    ['Work / SCORM flagged titles require source-LMS runtime check before keep', CTI_TEST_workScormKeepGate_],
    ['Work / audit existing shell before Coursera re-ingest', CTI_TEST_workAuditBeforeReingest_],
    ['Work / keep-existing bypasses unnecessary reimport', CTI_TEST_workKeepExistingState_],
    ['Work / course outline and source-audit state machine', CTI_TEST_workCourseStateMachine_],
    ['Work / specialization outline and content-map state machine', CTI_TEST_workSpecializationStateMachine_],
    ['Work / work-state validation', CTI_TEST_workStateValidation_],
    ['Work / checklist validates booleans and preserves unset steps', CTI_TEST_workEvidenceChecklistValidation_],
    ['Work / collection completion never certifies QA or re-ingestion', CTI_TEST_workEvidenceChecklistIsolation_],
    ['Semantic QA / exact-title reservation prevents quiz theft', CTI_TEST_globalMatchReservation_],
    ['Semantic QA / distillation-error sentinel is hard ingestion failure', CTI_TEST_ingestionFailureSentinel_],
    ['Semantic QA / raw x-coursera metadata is ingestion failure', CTI_TEST_rawMetadataFailure_],
    ['Semantic QA / hidden attachment proxy does not force re-ingest', CTI_TEST_hiddenAttachmentProxy_],
    ['Semantic QA / hidden media dependency is review-first', CTI_TEST_hiddenMediaDependency_],
    ['Semantic QA / explicit assignment behavior mutation is surfaced', CTI_TEST_behaviorMutation_],
    ['Semantic QA / unobservable assignment behavior blocks automatic KEEP', CTI_TEST_behaviorUnknownBlocksKeep_],
    ['Semantic QA / external Rise/Storyline evidence blocks automatic KEEP', CTI_TEST_externalRuntimePolicy_],
    ['Analytics / IFS workload semantics and structural profile vector', CTI_TEST_analyticsSemantics_],
    ['Evidence Memory / generation and snapshot-stage helpers', CTI_TEST_lineageHelpers_],
    ['Evidence Memory / item-level reimport evolution delta', CTI_TEST_itemEvolutionDelta_],
    ['Semantic QA / empty destination course is catastrophic', CTI_TEST_emptyDestinationFailure_],
    ['Semantic QA / question-pool selection semantics are compared', CTI_TEST_questionPoolBehavior_],
    ['Core / semantic package identity catches BORL/browser/DEV variants', CTI_TEST_semanticPackageIdentity_],
    ['Semantic QA / Coursera conversion-error placeholder is hard failure', CTI_TEST_conversionPlaceholderFailure_],
    ['Semantic QA / broken unmatched Coursera extra forces re-ingest', CTI_TEST_brokenExtraReingest_],
    ['Semantic QA / D2L practice JSON is runtime dependency, not missing activity', CTI_TEST_practiceRuntimeDependency_],
    ['Semantic QA / source runtime signal blocks automatic KEEP', CTI_TEST_sourceRuntimeReview_],
    ['Work / internal source-runtime evidence requires launch check before keep', CTI_TEST_workInternalRuntimeKeepGate_],
    ['Architecture / v7 release registry and feature parity manifest', CTI_TEST_v7ArchitectureManifest_],
    ['Architecture / canonical Coursera extractor is server-owned and version-locked', CTI_TEST_courseraCanonicalExtractor_],
    ['Brightspace / canonical Code.gs extractor identity and safety contract', CTI_TEST_brightspaceCanonicalExtractor_],
    ['Brightspace / legacy v0.1.x live capture parser compatibility', CTI_TEST_brightspaceLegacyParser_],
    ['Brightspace / structured quiz conversion and answer evidence', CTI_TEST_brightspaceQuizAdapter_],
    ['Brightspace / live runtime enrichment blocks automatic KEEP', CTI_TEST_brightspaceRuntimeEnrichment_],
    ['Brightspace / live-only drift is review-only, not re-ingest denominator', CTI_TEST_brightspaceDriftPolicy_],
    ['Smart Ingestion / current exclusion wording maps by module path', CTI_TEST_smartIngestionExplicitExclusionV2_],
    ['Smart Ingestion / one-to-many transformation aggregates destination children', CTI_TEST_oneToManyTransformationAggregate_],
    ['Smart Ingestion / unresolved attachment becomes critical provenance', CTI_TEST_unresolvedSourceAssetProvenance_],
    ['Smart Ingestion / generated behavior is review evidence', CTI_TEST_generatedBehaviorProvenance_],
    ['Destination Readiness / template placeholders and generated fallbacks are surfaced', CTI_TEST_destinationReadiness_],
    ['Coursera / one-to-many link review is not hard payload loss when semantic preservation is proven', CTI_TEST_oneToManyHardLossGuard_],
    ['Smart Ingestion / generic generated behavior does not bleed across sibling items', CTI_TEST_provenanceClaimScopeIsolation_],
    ['QA report / destination-readiness and manual-repair text contract', CTI_TEST_destinationReadinessTextContract_],
    ['Evidence Memory / generation Smart Ingestion provenance survives report deletion', CTI_TEST_generationProvenanceMerge_],
    ['Evidence Memory / inherited raw defects are historical review in later stage', CTI_TEST_historicalProvenanceStageSemantics_],
    ['Evidence Memory / same-generation manual deletion is review not re-ingest', CTI_TEST_manualRemovalAttribution_],
    ['Evidence Memory / post-raw hard-loss regression is manual review not re-ingest', CTI_TEST_manualPayloadRegressionAttribution_],
    ['QA UI / generation memory and manual-change guidance contract', CTI_TEST_generationMemoryUiContract_],
    ['Golden QA / CITC923 same-generation cleanup cannot masquerade as re-ingestion failure', CTI_TEST_citc923SameGenerationCleanupScenario_],
    ['Evidence Memory / canonical raw baseline is first valid raw snapshot', CTI_TEST_canonicalRawBaselineSelection_],
    ['QA stage guard / later edited shell cannot overwrite raw generation state', CTI_TEST_rawStageGuard_],
    ['QA snapshot / explicit published state is preserved distinctly from ops-prepared', CTI_TEST_publishedSnapshotContext_],
    ['QA UI / published choice reaches backend as published snapshot mode', CTI_TEST_publishedUiSnapshotMode_],
    ['Extractor naming / Coursera filename is human-searchable and timestamped', CTI_TEST_courseraSearchableFilename_],
    ['Extractor naming / Brightspace filename is human-searchable and timestamped', CTI_TEST_brightspaceSearchableFilename_],
    ['Current-state resolution / repaired source asset closes historical attachment finding', CTI_TEST_currentStateResolvedAttachment_],
    ['Current-state resolution / generated 80 percent threshold still present', CTI_TEST_currentStateGeneratedThresholdStillPresent_],
    ['Golden QA / CITC923 Assignment 2 resolves attachment while retaining current AI + 80% review', CTI_TEST_citc923Assignment2CurrentState_],
    ['Current-state resolution / AI grader still present is localized', CTI_TEST_currentStateAiGraderStillPresent_],
    ['Current-state resolution / source-equivalent Overview closes generated fallback', CTI_TEST_currentStateOverviewResolvedByLiveSource_],
    ['Current-state resolution / removed placeholder closes historical fallback', CTI_TEST_currentStatePlaceholderRemoved_],
    ['Current-state resolution / unobserved historical issue becomes evidence gap not stale defect', CTI_TEST_currentStateUnobservedEvidenceGap_],
    ['Destination Readiness / current-state resolutions drive later-stage findings', CTI_TEST_currentStateReadinessIntegration_],
    ['QA UI / current-state resolution operator contract', CTI_TEST_currentStateUiContract_],
    ['Coursera v6.12 / labeled control values capture input-only threshold', CTI_TEST_v610ControlValueContract_],
    ['Coursera v6.12 / starting item and low-evidence items receive crawl priority', CTI_TEST_v610CrawlPriorityContract_],
    ['Coursera v6.12 / assignment learner semantics exclude authoring-only grading chrome', CTI_TEST_v610LearnerSemanticContract_],
    ['Coursera v6.12 / attachment capture rejects large ancestor pseudo-files', CTI_TEST_v610AttachmentLocalityContract_],
    ['Current-state resolution / current rubric presence does not prove historical rubric identity', CTI_TEST_rubricIdentityUnproven_],
    ['Semantic QA / native assignment learner body drives text comparison', CTI_TEST_assignmentLearnerBodyComparison_],
    ['Destination Readiness / incomplete full crawl stays visible as an evidence gap', CTI_TEST_fullCrawlInfoOnly_],
    ['Macmillan / time policy version and rule matrix', CTI_TEST_macmillanTimeRules_],
    ['Macmillan / safe matrix neutralizes spreadsheet formulas', CTI_TEST_macmillanSafeMatrix_]
  ];
}

function CTI_TEST_progressClockFailure_() {
  [ctiCanonicalCourseraExtractorSource_(), ctiCanonicalBrightspaceExtractorSource_()].forEach(function(source) {
    var begin = source.indexOf('  function createCtiProgressPanelV1(');
    var end = source.indexOf('  // CTI_PROGRESS_END', begin);
    CTI_TEST_assert_(begin >= 0 && end > begin, 'Canonical extractor must include its progress display');
    var clockMs = 1000000;
    function TestClock() { return new Date(clockMs); }
    TestClock.now = function() { return clockMs; };
    var panel = new Function('window', 'document', 'Date', 'setInterval', 'clearInterval',
      source.slice(begin, end) + '\nreturn createCtiProgressPanelV1("Progress test");')(
        {}, {createElement:function() { throw new Error('Display unavailable'); }}, TestClock,
        function() { throw new Error('A failed display must not start a timer'); }, function() {});
    panel.update({phase:'Read content'});
    clockMs += 62000;
    CTI_TEST_assert_(panel.snapshot().elapsedMs === 62000, 'Elapsed time must reflect the actual clock');
    panel.update({phase:'Prepare JSON'});
    clockMs += 2500;
    panel.finish('review', 'Capture finished with evidence gaps');
    var finished = panel.snapshot();
    CTI_TEST_assert_(finished.elapsedMs === 64500, 'Completion must retain total elapsed time');
    CTI_TEST_assert_(finished.phaseDurationsMs['Read content'] === 62000, 'Stage durations must remain distinct');
    clockMs += 60000;
    panel.update({phase:'Late callback'});
    CTI_TEST_assert_(panel.snapshot().elapsedMs === 64500 && panel.snapshot().phase === 'Prepare JSON', 'Finished progress must not restart on a late callback');
    CTI_TEST_assert_(finished.outcome === 'review', 'Capture gaps must not be converted to success');
  });
}

// Exercise the canonical extractor's evidence rules without a live browser.
function CTI_TEST_writtenResponseCoverage_() {
  var f=CTI_TEST_editorRecoveryFixture_();
  var names=['ctiOptionLabelLooksLikeFeedback_','ctiOptionFeedbackRisk_','ctiGuardOptionEvidence_',
    'isObservedWrittenResponseV6138','questionEvidenceReadyV6138','assessmentCaptureCoverageV613'];
  var coverage=new Function(names.map(f.code).join('\n')+'\nreturn assessmentCaptureCoverageV613;')();
  var written={id:'1',courseraQuestionId:'written-1',questionOrdinalObserved:true,type:'essay',
    prompt:'Explain the observed immune response.',options:[],correctAnswers:[],
    responseTypeEvidence:{method:'OBSERVED_EDITOR_HEADING',text:'AI-Graded Rich Text Test Question'},
    promptBoundaryEvidence:{method:'EXPLICIT_AUTHORING_SECTION'}};
  var raw=JSON.stringify(written),complete=coverage([written],1);
  CTI_TEST_assert_(complete.questionCoverageComplete && complete.requiredAnswerCoverageComplete,'Observed written prompt satisfies applicable evidence requirements');
  CTI_TEST_equal_(complete.answerEvidence,0,'Written prompt does not create an answer key');
  CTI_TEST_assert_(!complete.answerCoverageComplete,'Legacy answer-key coverage remains honest');
  CTI_TEST_equal_(complete.answerKeyNotApplicableQuestionOrdinals.join(','),'1','Explicitly identified written ordinal');
  CTI_TEST_assert_(!coverage([written],2).requiredAnswerCoverageComplete,'A missing question stays incomplete');
  var unknown=JSON.parse(raw);delete unknown.responseTypeEvidence;
  CTI_TEST_assert_(!coverage([unknown],1).requiredAnswerCoverageComplete,'An inferred essay type cannot bypass missing answer evidence');
  var empty=JSON.parse(raw);empty.prompt='';
  CTI_TEST_assert_(!coverage([empty],1).requiredAnswerCoverageComplete,'Empty written prompt stays incomplete');
  var automatic={id:'2',courseraQuestionId:'auto-2',questionOrdinalObserved:true,type:'single-select',prompt:'Which pathway applies?',
    options:[{label:'Pathway A',correct:true},{label:'Pathway B',correct:false}],correctAnswers:['Pathway A'],answerTextReliable:true};
  CTI_TEST_assert_(coverage([written,automatic],2).requiredAnswerCoverageComplete,'Mixed assessment requires its observed automatic key');
  automatic.options[0].optionFieldIssue='ANSWER_AND_FEEDBACK_BOUNDARY_UNRESOLVED';
  CTI_TEST_assert_(!coverage([written,automatic],2).requiredAnswerCoverageComplete,'Unresolved option field defeats an apparent correct answer');
  CTI_TEST_equal_(JSON.stringify(written),raw,'Raw written evidence is unchanged');
}

function CTI_TEST_networkEvidenceReuse_() {
  var f=CTI_TEST_editorRecoveryFixture_(),parsed=0;
  // URL identity is deterministic here; network harvesting runs no requests.
  function TestUrl(url){this.pathname=url;}
  var snapshot=new Function('evidenceFromCapturedRecord','unique','URL','location',
    f.code('quickNetworkEvidenceSnapshot')+'\nreturn quickNetworkEvidenceSnapshot;')(
    function(record){parsed++;return record.text==='empty'?null:JSON.parse(record.text);},
    function(values,limit){return Array.from(new Set(values)).slice(0,limit);},TestUrl,{origin:'https://example.test'});
  var records=[{url:'/one',status:200,text:JSON.stringify({assetDetails:[{url:'asset'}],links:['link'],textSample:'Observed text'})},
    {url:'/two',status:200,text:'empty'}];
  var recorder={takeFor:function(){return records;}},cache=new WeakMap(),baseline=JSON.stringify(snapshot(recorder,{},0));parsed=0;
  for(var i=0;i<20;i++)CTI_TEST_equal_(JSON.stringify(snapshot(recorder,{},0,cache)),baseline,'Reused summaries preserve stability evidence');
  CTI_TEST_equal_(parsed,2,'Parse each unchanged record only once per wait');
  records[0].text=JSON.stringify({assetDetails:[{url:'asset'},{url:'second'}],textSample:'Changed text'});
  var updated=snapshot(recorder,{},0,cache);CTI_TEST_equal_(parsed,3,'Payload text change invalidates cache');
  CTI_TEST_assert_(JSON.stringify(updated)!==baseline,'Changed payload updates the stability signature');
  records[0].status=206;snapshot(recorder,{},0,cache);CTI_TEST_equal_(parsed,4,'Status change invalidates cache');
  records[0].url='/changed';snapshot(recorder,{},0,cache);CTI_TEST_equal_(parsed,5,'URL change invalidates cache');
  records.push({url:'/new',status:200,text:JSON.stringify({links:['new-link']})});
  CTI_TEST_equal_(JSON.stringify(snapshot(recorder,{},0,cache)),JSON.stringify(snapshot(recorder,{},0)),'New records agree with a fresh uncached sample');
}

function CTI_TEST_sourceContractCases_() {
  return [
    ['v8 / source resolver and blocker-first UI contract', CTI_TEST_v8IndexContract_],
    ['v8 / Coursera extractor hardening contract', CTI_TEST_v8ExtractorContract_],
    ['Release / Gateway, QA, extractor, Macmillan identities', CTI_TEST_releaseIdentityContract_],
    ['Frontend / google.script.run endpoint mapping', CTI_TEST_frontendEndpointMapping_],
    ['Frontend / required DOM and workflow controls', CTI_TEST_frontendDomContract_],
    ['IMSCC UI / ZIP, QTI, PDF source-fingerprint extractor contract', CTI_TEST_imsccBrowserExtractorContract_],
    ['IMSCC UI / scan result, IFS, preflight and package-summary contract', CTI_TEST_imsccScanUiContract_],
    ['Course Library / cards, Explore, audit, QA, re-scan and IFS contract', CTI_TEST_courseLibraryUiContract_],
    ['Work Queue / controls, owner grouping, progress and source actions contract', CTI_TEST_workQueueUiContract_],
    ['Work Queue / backend endpoint and build identity contract', CTI_TEST_workQueueEndpointContract_],
    ['Work Queue / audit-first existing-shell decision contract', CTI_TEST_workQueueAuditFirstUiContract_],
    ['Post-Ingestion QA / operational redo-decision UI contract', CTI_TEST_operationalRedoUiContract_],
    ['Work Queue / NAIT non-LFM policy disclosure contract', CTI_TEST_workQueueNaitPolicyContract_],
    ['Semantic QA / v6.11 extractor and failure UI contract', CTI_TEST_semanticQaUiContract_],
    ['Explore / hierarchy, package summary and Deep Audit contract', CTI_TEST_exploreViewerContract_],
    ['Post-Ingestion QA / single-snapshot and lifecycle UI contract', CTI_TEST_postQaUiContract_],
    ['Macmillan UI / Stage 1→5 workflow and partner-ready output contract', CTI_TEST_macmillanUiContract_],
    ['Frontend / output escaping and AI-report sanitization contract', CTI_TEST_frontendSafetyContract_],
    ['Architecture / v7 workspace preserves Directory, IMSCC, Work Queue and Macmillan surfaces', CTI_TEST_v7FeatureParityUiContract_],
    ['Coursera UI / canonical extractor loads from Code.gs without embedded duplicate', CTI_TEST_courseraCanonicalUiContract_],
    ['Brightspace UI / canonical extractor loads from Code.gs without embedded duplicate', CTI_TEST_brightspaceCanonicalUiContract_],
    ['Coursera UI / v6.12 capless adaptive-crawl and time-evidence contract', CTI_TEST_courseraV68CoverageUiContract_],
    ['Post-Ingestion QA / provenance v2, one-to-many and destination-readiness UI contract', CTI_TEST_v71QaUiContract_]
  ];
}

function CTI_TEST_integrationCases_() {
  return [
    ['Storage / chunked course-tree round trip', CTI_TEST_treeChunkStorageIntegration_],
    ['Storage / package schema and UUID migration', CTI_TEST_packageSchemaMigrationIntegration_],
    ['Storage / catalog map round trip', CTI_TEST_catalogMapIntegration_],
    ['Storage / QA evidence sheet schemas', CTI_TEST_qaEvidenceSheetSchemaIntegration_],
    ['Storage / duplicate archive schema', CTI_TEST_duplicateArchiveSchemaIntegration_],
    ['Work / state-sheet schema integration', CTI_TEST_workStateSheetIntegration_],
    ['Work / package scan-history round trip', CTI_TEST_scanHistoryIntegration_],
    ['Work / latest raw-QA evidence map integration', CTI_TEST_rawQaMapIntegration_],
    ['Storage / QA lineage generation inference integration', CTI_TEST_qaLineageGenerationIntegration_],
    ['IMSCC / Explore export-to-Google-Sheets integration', CTI_TEST_exportManifestIntegration_],
    ['Macmillan / createTab temporary-sheet smoke test', CTI_TEST_createTabIntegration_],
    ['Macmillan / Stage 1 XLSX upload + anchor scan', CTI_TEST_macmillanStage1Integration_],
    ['Macmillan / Stage 3→4→5 XLSX contract regression', CTI_TEST_macmillanStageContractsIntegration_]
  ];
}

function CTI_TEST_fullGoldenCases_() {
  return [
    ['Macmillan / Sowder full 33-module Stage 2→5 golden regression', CTI_TEST_sowderFullGoldenIntegration_]
  ];
}

function CTI_TEST_runSuite_(suiteName, cases) {
  var started = new Date();
  var report = {
    suiteVersion: CTI_TEST_SUITE_VERSION_,
    suite: suiteName,
    startedAt: started.toISOString(),
    passed: 0,
    failed: 0,
    tests: []
  };
  for (var i = 0; i < cases.length; i++) {
    var name = cases[i][0], fn = cases[i][1], t0 = new Date().getTime();
    try {
      fn();
      report.passed++;
      report.tests.push({ name:name, status:'PASS', ms:new Date().getTime()-t0 });
    } catch (e) {
      report.failed++;
      report.tests.push({ name:name, status:'FAIL', ms:new Date().getTime()-t0, error:String(e && e.message ? e.message : e) });
    }
  }
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date().getTime() - started.getTime();
  report.status = report.failed ? 'FAIL' : 'PASS';
  return report;
}

function CTI_TEST_mergeReports_(reports) {
  var out = { suiteVersion:CTI_TEST_SUITE_VERSION_, suite:'ALL', startedAt:reports[0] && reports[0].startedAt || new Date().toISOString(), passed:0, failed:0, tests:[] };
  (reports || []).forEach(function(r) {
    out.passed += Number(r.passed || 0);
    out.failed += Number(r.failed || 0);
    (r.tests || []).forEach(function(t) { out.tests.push({ suite:r.suite, name:t.name, status:t.status, ms:t.ms, error:t.error || '' }); });
  });
  out.finishedAt = new Date().toISOString();
  out.status = out.failed ? 'FAIL' : 'PASS';
  return out;
}

function CTI_TEST_logReport_(report) {
  Logger.log('============================================================');
  Logger.log('CTI REGRESSION ' + report.suite + ' — ' + report.status);
  Logger.log('Suite v' + report.suiteVersion + ' | baseline Gateway ' + CTI_TEST_BASELINE_GATEWAY_ + ' | extractor ' + CTI_TEST_BASELINE_EXTRACTOR_ + '/schema ' + CTI_TEST_BASELINE_EXTRACTOR_SCHEMA_);
  Logger.log('------------------------------------------------------------');
  (report.tests || []).forEach(function(t) {
    Logger.log((t.status === 'PASS' ? 'PASS ' : 'FAIL ') + (t.suite ? '[' + t.suite + '] ' : '') + t.name + ' (' + t.ms + ' ms)' + (t.error ? ' — ' + t.error : ''));
  });
  Logger.log('------------------------------------------------------------');
  Logger.log('TOTAL: ' + report.passed + ' passed · ' + report.failed + ' failed');
  Logger.log('============================================================');
}

function CTI_TEST_assert_(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}
function CTI_TEST_equal_(actual, expected, message) {
  if (actual !== expected) throw new Error((message ? message + ' — ' : '') + 'expected [' + expected + '] but found [' + actual + '].');
}
function CTI_TEST_near_(actual, expected, tolerance, message) {
  if (Math.abs(Number(actual) - Number(expected)) > Number(tolerance || 0)) throw new Error((message ? message + ' — ' : '') + 'expected ~' + expected + ' but found ' + actual + '.');
}
function CTI_TEST_contains_(value, fragment, message) {
  if (String(value || '').indexOf(String(fragment || '')) === -1) throw new Error((message ? message + ' — ' : '') + 'missing fragment [' + fragment + '].');
}
function CTI_TEST_throws_(fn, fragment, message) {
  var threw = false, errorText = '';
  try { fn(); } catch (e) { threw = true; errorText = String(e && e.message ? e.message : e); }
  if (!threw) throw new Error((message ? message + ' — ' : '') + 'expected an exception.');
  if (fragment && errorText.indexOf(String(fragment)) === -1) throw new Error((message ? message + ' — ' : '') + 'exception did not contain [' + fragment + ']: ' + errorText);
}
function CTI_TEST_jsonEqual_(actual, expected, message) {
  CTI_TEST_equal_(JSON.stringify(actual), JSON.stringify(expected), message);
}
function CTI_TEST_indexSource_() {
  if (CTI_TEST_INDEX_SOURCE_CACHE_ === null) CTI_TEST_INDEX_SOURCE_CACHE_ = HtmlService.createHtmlOutputFromFile('Index').getContent();
  return CTI_TEST_INDEX_SOURCE_CACHE_;
}
function CTI_TEST_sourceHasFunction_(source, name) {
  source = String(source || '');
  name = String(name || '');
  return source.indexOf('function ' + name + '(') > -1 || source.indexOf('async function ' + name + '(') > -1;
}
function CTI_TEST_globalFunctionExists_(name) {
  try { return eval('typeof ' + name + ' === "function"'); } catch (e) { return false; }
}
function CTI_TEST_domIdExists_(source, id) {
  source = String(source || ''); id = String(id || '');
  return source.indexOf('id="' + id + '"') > -1 || source.indexOf("id='" + id + "'") > -1;
}
function CTI_TEST_unregisterWorkflowFileId_(fileId) {
  if (!fileId) return;
  var props = PropertiesService.getUserProperties();
  var ids = [];
  try { ids = JSON.parse(props.getProperty('ACTIVE_MASTER_FILE_IDS') || '[]'); } catch (e) {}
  ids = ids.filter(function(id){ return String(id) !== String(fileId); });
  props.setProperty('ACTIVE_MASTER_FILE_IDS', JSON.stringify(ids));
}
function CTI_TEST_packageRow_(timestamp, partner, fileName, uuid, scanSeed, owner) {
  scanSeed = Number(scanSeed || 0);
  return [
    timestamp || new Date(), partner || 'Partner', fileName || 'Course.imscc',
    10 + scanSeed, 20 + scanSeed, 5 + scanSeed, 2, 3, 0, 0,
    '{}', 'Quiz A', '[]', '2026-01-01', owner || 'Owner A', '2026-01-31', 'In Queue', 'https://drive.google.com/drive/folders/test',
    uuid || Utilities.getUuid(), 0
  ];
}

// ---------------------------------------------------------------------------
// FAST: shared/backend safety
// ---------------------------------------------------------------------------
function CTI_TEST_sheetSafeText_() {
  CTI_TEST_equal_(sheetSafeText_('=SUM(A1:A2)'), "'=SUM(A1:A2)", 'Formula-like text must be neutralized');
  CTI_TEST_equal_(sheetSafeText_('+cmd'), "'+cmd", 'Leading + must be neutralized');
  CTI_TEST_equal_(sheetSafeText_('Normal text'), 'Normal text', 'Normal text must remain unchanged');
}

function CTI_TEST_filenameNormalization_() {
  CTI_TEST_equal_(normalizeFileName_(' Course (2).IMSCC ', true), 'course.imscc', 'Download suffix normalization');
  CTI_TEST_equal_(normalizeFileName_('Course (2).IMSCC', false), 'course (2).imscc', 'Suffix must remain when removal disabled');
}

function CTI_TEST_matchKey_() {
  CTI_TEST_equal_(getMatchKey_('ABC Development (NCE) - CLXT (2).imscc'), 'abc', 'Catalog match key normalization');
  CTI_TEST_equal_(getMatchKey_('B0RL-101.zip'), 'borl101', 'Known BORL typo normalization');
}

// ---------------------------------------------------------------------------
// FAST: IMSCC analyzer golden manifest
// ---------------------------------------------------------------------------
function CTI_TEST_imsccSyntheticManifest_() {
  var xml = CTI_TEST_goldenManifestXml_();
  var evidence = {
    schemaVersion:6,
    extractor:'CTI Test Fixture',
    manifestOnly:false,
    resources:{
      r_read:{ files:[{href:'reading.html', size:123, sha256:'abc'}], textSample:'This reading explains quantity relationships and representations.', textLength:62, textSha256:'readhash' },
      r_quiz:{ files:[{href:'quiz.xml', size:456, sha256:'def'}], structuredAssessment:{ schemaVersion:2, declaredQuestionCount:2, questionCount:2, questions:[] } }
    }
  };
  var res = analyzeImsccFromXmlString(xml, 'CTI_Golden.imscc', JSON.stringify(evidence));
  CTI_TEST_assert_(res && res.success === true, 'Synthetic IMSCC should analyze successfully: ' + (res && res.error || 'unknown error'));
  CTI_TEST_equal_(res.moduleCount, 2, 'Synthetic package should expose 2 top-level modules');
  CTI_TEST_equal_(res.stats.totalResources, 5, 'Synthetic package resource count');
  CTI_TEST_equal_(res.stats.webcontent, 1, 'Webcontent count');
  CTI_TEST_equal_(res.stats.quizzes, 1, 'Quiz count');
  CTI_TEST_equal_(res.stats.discussions, 1, 'Discussion count');
  CTI_TEST_equal_(res.stats.weblinks, 1, 'Web link count');
  CTI_TEST_equal_(res.stats.lti, 1, 'LTI count');
  CTI_TEST_equal_(res.stats.fingerprintedResources, 2, 'Source evidence resource count');
  CTI_TEST_assert_(Array.isArray(res.qtiNames) && res.qtiNames.indexOf('Golden Quiz') > -1, 'QTI title should be preserved in tree extraction');
}

function CTI_TEST_imsccInvalidRoot_() {
  var res = analyzeImsccFromXmlString('<notmanifest><x/></notmanifest>', 'bad.imscc', '{}');
  CTI_TEST_assert_(res && res.success === false, 'Non-manifest XML must be rejected');
  CTI_TEST_contains_(res.error, 'not an IMS manifest', 'Invalid root reason');
}

function CTI_TEST_goldenManifestXml_() {
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="CTI_TEST_MANIFEST">' +
      '<organizations><organization identifier="ORG1">' +
        '<item identifier="M1"><title>Module One</title>' +
          '<item identifier="I1" identifierref="r_read"><title>Golden Reading</title></item>' +
          '<item identifier="I2" identifierref="r_quiz"><title>Golden Quiz</title></item>' +
          '<item identifier="I3" identifierref="r_disc"><title>Golden Discussion</title></item>' +
        '</item>' +
        '<item identifier="M2"><title>Module Two</title>' +
          '<item identifier="I4" identifierref="r_link"><title>Golden Link</title></item>' +
          '<item identifier="I5" identifierref="r_lti"><title>Golden LTI</title></item>' +
        '</item>' +
      '</organization></organizations>' +
      '<resources>' +
        '<resource identifier="r_read" type="webcontent"><file href="reading.html"/></resource>' +
        '<resource identifier="r_quiz" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="quiz.xml"/></resource>' +
        '<resource identifier="r_disc" type="imsdt_xmlv1p1"><file href="discussion.xml"/></resource>' +
        '<resource identifier="r_link" type="imswl_xmlv1p1"><file href="link.xml"/></resource>' +
        '<resource identifier="r_lti" type="imsbasiclti_xmlv1p0"><file href="lti.xml"/></resource>' +
      '</resources>' +
    '</manifest>';
}


// ---------------------------------------------------------------------------
// FAST: wider IMSCC / library / deterministic analytics coverage
// ---------------------------------------------------------------------------
function CTI_TEST_validationBoundaries_() {
  CTI_TEST_equal_(validateDateOnly_('2026-09-12','Date'),'2026-09-12','Valid date should be retained');
  CTI_TEST_throws_(function(){ validateDateOnly_('12/09/2026','Date'); },'YYYY-MM-DD','Invalid date format must fail');
  CTI_TEST_equal_(validateStatus_('Completed'),'Completed','Known status');
  CTI_TEST_throws_(function(){ validateStatus_('Done'); },'Invalid status','Unknown status must fail');
  CTI_TEST_equal_(validateDriveLink_('https://drive.google.com/file/d/abc'),'https://drive.google.com/file/d/abc','Drive HTTPS link');
  CTI_TEST_equal_(validateDriveLink_('https://docs.google.com/spreadsheets/d/abc'),'https://docs.google.com/spreadsheets/d/abc','Docs HTTPS link');
  CTI_TEST_throws_(function(){ validateDriveLink_('http://drive.google.com/file/d/abc'); },'HTTPS','HTTP Drive link must fail');
  CTI_TEST_throws_(function(){ validateDriveLink_('https://example.com/x'); },'Google Drive','Non-Google link must fail');
}

function CTI_TEST_uuidVersionUtilities_() {
  var uuid = '123e4567-e89b-42d3-a456-426614174000';
  CTI_TEST_equal_(validateUuid_(uuid),uuid,'Valid UUID');
  CTI_TEST_throws_(function(){ validateUuid_('not-a-uuid'); },'Invalid package UUID','Invalid UUID must fail');
  CTI_TEST_equal_(nonNegativeInteger_(4.9),4,'Positive numbers are floored');
  CTI_TEST_equal_(nonNegativeInteger_(-1),0,'Negative numbers collapse to zero');
  CTI_TEST_equal_(nonNegativeInteger_('bad'),0,'NaN collapses to zero');
  var d = new Date(1700000000000);
  CTI_TEST_equal_(versionToken_(d),'1700000000000','Date version token');
  assertCurrentVersion_(d,'1700000000000');
  CTI_TEST_throws_(function(){ assertCurrentVersion_(d,'1700000000001'); },'changed after the dashboard loaded','Stale version must be rejected');
}

function CTI_TEST_ifsLaborScreenshotFixture_() {
  // Mirrors the Wastewater Collection Systems I screenshot:
  // LTI 0 + Empty 2 + Unknown 0 + Assessments 7 + Discussions 2 + WebLinks 4 + WebContent 44 = IFS 53.
  var metrics = computeRiskMetrics_(44,7,2,4,0,0,2);
  CTI_TEST_equal_(metrics.totalItems,57,'Screenshot total valid items');
  CTI_TEST_equal_(metrics.ifs,53,'Screenshot IFS formula must stay 53');
  CTI_TEST_equal_(metrics.isBoilerplate,false,'Real course must not be boilerplate');
  CTI_TEST_equal_(predictLaborHours(53,57,0,2),7,'Screenshot estimated labor must stay 7h');
  var profile = vectorizeCourse({webcontent:44,quizzes:7,discussions:2,weblinks:4,lti:0,empty:2});
  CTI_TEST_equal_(profile.length,10,'Structural profile vector contract has 10 log-scaled dimensions');
  CTI_TEST_near_(profile[0],Math.log(45),0.0000001,'Structural profile webcontent dimension');
  CTI_TEST_near_(profile[1],Math.log(8),0.0000001,'Structural profile assessment dimension');
  CTI_TEST_near_(profile[9],Math.log(58),0.0000001,'Structural profile total-item dimension');
  CTI_TEST_near_(calculateCosineSimilarity(profile,profile),1,0.0000001,'Self cosine similarity');
  CTI_TEST_equal_(calculateCosineSimilarity([0,0],[1,2]),0,'Zero-vector similarity');
}

function CTI_TEST_ifsOverrides_() {
  var empty = computeRiskMetrics_(0,0,0,0,0,0,0);
  CTI_TEST_equal_(empty.ifs,100,'Zero-content package must be maximum risk');
  CTI_TEST_equal_(empty.totalItems,0,'Zero-content total');
  var boiler = computeRiskMetrics_(0,0,1,2,0,0,0);
  CTI_TEST_equal_(boiler.isBoilerplate,true,'Tiny package without readings/assessments is boilerplate');
  CTI_TEST_equal_(boiler.ifs,100,'Boilerplate shell must be maximum risk');
  var normal = computeRiskMetrics_(6,0,0,0,0,0,0);
  CTI_TEST_equal_(normal.isBoilerplate,false,'Six readings escape boilerplate override');
  CTI_TEST_equal_(normal.ifs,3,'Six readings deterministic IFS');
}

function CTI_TEST_emptyFolderPolicies_() {
  var tree = [
    {title:'Start Here',autoDeleted:true,children:[]},
    {title:'Student Resources',children:[{title:'Empty Resource Folder',autoDeleted:true,children:[]}]},
    {title:'Module 1',autoDeleted:true,children:[]},
    {title:'Module 2',children:[{title:'Lesson Folder',autoDeleted:true,children:[]}]}
  ];
  CTI_TEST_equal_(countEmptyFolders_(tree),4,'All auto-deleted folders count operationally');
  CTI_TEST_equal_(countCoreEmptyFolders_(tree,false),2,'Administrative empty folders must not block preflight');
  CTI_TEST_assert_(isAdministrativeTitle_('Instructor Resources') === true,'Instructor resources are administrative');
  CTI_TEST_assert_(isAdministrativeTitle_('Module 1') === false,'Instructional module is not administrative');
}

function CTI_TEST_sourceEvidenceParsing_() {
  var parsed = parseSourceEvidence_(JSON.stringify({
    schemaVersion:6, extractor:'Extractor X', buildId:'build-x', manifestOnly:false,
    resources:{ r1:{ files:[{href:'a.pdf'}] } }
  }));
  CTI_TEST_equal_(parsed.resources.r1.schemaVersion,6,'Parent schema propagates to resource evidence');
  CTI_TEST_equal_(parsed.resources.r1.evidenceExtractor,'Extractor X','Extractor identity propagates');
  CTI_TEST_equal_(parsed.resources.r1.evidenceBuildId,'build-x','Build identity propagates');
  var invalid = parseSourceEvidence_('{not-json');
  CTI_TEST_equal_(invalid.manifestOnly,true,'Invalid evidence degrades to manifest-only');
  CTI_TEST_contains_(invalid.warning,'could not be parsed','Invalid evidence warning');
  var absent = parseSourceEvidence_('');
  CTI_TEST_equal_(absent.schemaVersion,8,'Absent evidence default schema');
}

function CTI_TEST_sourcePayloadProjection_() {
  var evidenceMap = {
    r1:{type:'webcontent',files:['fallback.pdf'],deps:['r2'],evidence:{schemaVersion:6,evidenceExtractor:'X',evidenceBuildId:'B',files:[{href:'actual.pdf',name:'actual.pdf',presentInPackage:true}],links:['https://example.com'],images:['img.png'],embeddedRefs:['ref'],textSample:'hello',textLength:5,textSha256:'abc',structuredAssessment:{questionCount:2},evidenceTruncated:true}},
    r2:{type:'webcontent',files:['nested.docx'],deps:[],evidence:null}
  };
  var p = sourcePayloadForResource_('r1',evidenceMap);
  CTI_TEST_equal_(p.resourceId,'r1','Resource identity');
  CTI_TEST_equal_(p.files[0].href,'actual.pdf','Evidence files override manifest fallback');
  CTI_TEST_equal_(p.dependencies[0],'r2','Dependency lineage');
  CTI_TEST_equal_(p.structuredAssessment.questionCount,2,'Structured assessment retained');
  var semanticMap = {r3:{type:'assignment',files:[],deps:[],evidence:{schemaVersion:7,behavior:{observed:true,submission:{fileUpload:true}},interactiveSignals:{detected:true,confidence:'HIGH'}}}};
  var semantic = sourcePayloadForResource_('r3',semanticMap);
  CTI_TEST_assert_(semantic.behavior && semantic.behavior.submission.fileUpload === true,'Source assignment behavior retained');
  CTI_TEST_assert_(semantic.interactiveSignals && semantic.interactiveSignals.detected === true,'Interactive package signals retained');
  CTI_TEST_assert_(p.evidenceTruncated === true,'Truncation flag retained');
  var fallback = sourcePayloadForResource_('r2',evidenceMap);
  CTI_TEST_equal_(fallback.files[0].extension,'docx','Manifest fallback derives extension');
  CTI_TEST_equal_(fallback.files[0].presentInPackage,null,'Manifest fallback does not invent package presence');
  CTI_TEST_equal_(sourcePayloadForResource_('missing',evidenceMap),null,'Unknown resource has no payload');
}

function CTI_TEST_duplicatePlanning_() {
  var h = new Array(20); for (var i=0;i<h.length;i++) h[i] = 'H' + i;
  var u1='123e4567-e89b-42d3-a456-426614174001', u2='123e4567-e89b-42d3-a456-426614174002';
  var r1 = CTI_TEST_packageRow_(new Date(1000),'Partner','Course.imscc',u1,0,'Owner A');
  var r2 = CTI_TEST_packageRow_(new Date(2000),'Partner','Course (2).imscc',u2,1,'Owner A');
  var plan = buildDuplicatePlan_([h,r1,r2]);
  CTI_TEST_equal_(canonicalDisplayFileName_('Course (2).imscc'),'Course.imscc','Canonical display filename strips browser suffix');
  CTI_TEST_equal_(plan.groups.length,1,'Canonical duplicate group count');
  CTI_TEST_equal_(plan.duplicateEntryCount,1,'One duplicate removable');
  CTI_TEST_equal_(plan.safeGroupCount,1,'Matching metadata permits archival');
  CTI_TEST_equal_(plan.groups[0].survivor.uuid,u1,'Unsuffixed oldest record survives');
  CTI_TEST_equal_(plan.groups[0].latestScan.uuid,u2,'Newest scan data is selected');
  CTI_TEST_assert_(plan.groups[0].scanDataDiffers === true,'Changed scan fingerprints are detected');
  var conflicting = CTI_TEST_packageRow_(new Date(2000),'Partner','Course (2).imscc',u2,1,'Owner B');
  var blocked = buildDuplicatePlan_([h,r1,conflicting]);
  CTI_TEST_equal_(blocked.safeGroupCount,0,'Metadata conflict blocks automatic archive');
  CTI_TEST_assert_(blocked.groups[0].conflictFields.indexOf('Owner') > -1,'Owner conflict is surfaced');
}

function CTI_TEST_duplicateArchiveFormulaSafety_() {
  var row = CTI_TEST_packageRow_(new Date(),'=Partner','+Course.imscc',Utilities.getUuid(),0,'@Owner');
  var record = {row:row};
  var archived = duplicateArchiveRow_(record,new Date(),'=reviewer@example.com','survivor','group','DUPLICATE_REMOVED');
  CTI_TEST_equal_(archived[1],"'=Partner",'Archived partner formula must be neutralized');
  CTI_TEST_equal_(archived[2],"'+Course.imscc",'Archived filename formula must be neutralized');
  CTI_TEST_equal_(archived[14],"'@Owner",'Archived owner formula must be neutralized');
  CTI_TEST_equal_(archived[21],"'=reviewer@example.com",'Archived-by formula must be neutralized');
}

function CTI_TEST_advancedManifestXml_() {
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="ADV">' +
    '<organizations><organization identifier="ORG"><item identifier="WRAP"><title>Course Root</title>' +
      '<item identifier="M1"><title>Module Alpha</title>' +
        '<item identifier="A1" identifierref="r_read"><title>Lesson Lesson</title></item>' +
        '<item identifier="A2" identifierref="r_plugin"><title>Practice Practice</title></item>' +
        '<item identifier="A3" identifierref="r_unknown"><title>Unknown Unknown</title></item>' +
      '</item>' +
      '<item identifier="EMPTY"><title>Empty Core</title></item>' +
      '<item identifier="ADMIN"><title>Student Resources</title></item>' +
    '</item></organization></organizations>' +
    '<resources>' +
      '<resource identifier="r_read" type="webcontent"><file href="reading.html"/><file href="image.png"/></resource>' +
      '<resource identifier="r_plugin" type="webcontent"><file href="practice.json"/><dependency identifierref="r_dep"/></resource>' +
      '<resource identifier="r_dep" type="webcontent"><file href="nested/plugin.json"/></resource>' +
      '<resource identifier="r_unknown" type="vendor/custom"><file href="custom.dat"/></resource>' +
      '<resource identifier="r_orphan" type="webcontent"><file href="orphan.pdf"/></resource>' +
    '</resources></manifest>';
}

function CTI_TEST_imsccAdvancedMetrics_() {
  var res = analyzeImsccFromXmlString(CTI_TEST_advancedManifestXml_(),'Advanced.imscc','');
  CTI_TEST_assert_(res.success === true,'Advanced IMSCC should analyze: ' + (res.error || ''));
  CTI_TEST_equal_(res.moduleCount,3,'Single wrapper folder must be omitted from top-level course modules');
  CTI_TEST_equal_(res.stats.totalResources,5,'Resource inventory');
  CTI_TEST_equal_(res.stats.webcontent,4,'Webcontent includes dependency and orphan resource');
  CTI_TEST_equal_(res.stats.unknown,1,'Unknown resource classification');
  CTI_TEST_equal_(res.stats.hiddenPlugins,2,'JSON/practice resource detection');
  CTI_TEST_equal_(res.stats.orphans,1,'Only the unreferenced orphan remains unvisited');
  CTI_TEST_equal_(res.stats.emptyFolders,2,'Two empty top-level folders');
  CTI_TEST_equal_(res.stats.coreEmptyCount,1,'Student Resources is ignored by preflight core-empty policy');
  CTI_TEST_equal_(res.stats.sourceEvidenceMode,'manifest-only','No ZIP evidence means manifest-only mode');
  CTI_TEST_equal_(res.fileExtensionsLog.json,2,'JSON extension inventory');
  CTI_TEST_equal_(res.fileExtensionsLog.pdf,1,'PDF extension inventory');
  CTI_TEST_equal_(res.unknownTypesLog['vendor/custom'],1,'Unknown type log');
  var pluginCount = 0;
  (function walk(nodes){ (nodes||[]).forEach(function(n){ if(n.type === 'plugin') pluginCount++; walk(n.children); }); })(res.courseTree);
  CTI_TEST_equal_(pluginCount,2,'Dependency-resolved hidden plugins must appear in Explore hierarchy');
}

function CTI_TEST_imsccZScoreLexical_() {
  var items = '';
  for (var m=0;m<5;m++) {
    var children=''; var n = m===0 ? 10 : 1;
    for (var i=0;i<n;i++) children += '<item identifier="M'+m+'I'+i+'" identifierref="r"><title>Resource Resource</title></item>';
    items += '<item identifier="M'+m+'"><title>Module Module</title>' + children + '</item>';
  }
  var xml = '<?xml version="1.0"?><manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"><organizations><organization>'+items+'</organization></organizations><resources><resource identifier="r" type="webcontent"><file href="reading.html"/></resource></resources></manifest>';
  var res = analyzeImsccFromXmlString(xml,'imbalance.imscc','');
  CTI_TEST_assert_(res.success === true,'Imbalance fixture should analyze');
  CTI_TEST_equal_(res.stats.zScoreImbalances.length,1,'One oversized module should cross z-score threshold');
  CTI_TEST_equal_(res.stats.zScoreImbalances[0].count,10,'Oversized module descendant count');
  CTI_TEST_assert_(Number(res.stats.zScoreImbalances[0].zScore) > 1.75,'Oversized module z-score crosses tightened threshold');
  CTI_TEST_assert_(res.stats.lexicalTTR < 0.4,'Repeated naming must produce low lexical variance');
}

function CTI_TEST_imsccMalformedInputs_() {
  var empty = analyzeImsccFromXmlString('','empty.imscc','');
  CTI_TEST_assert_(empty.success === false,'Empty manifest must fail');
  CTI_TEST_contains_(empty.error,'empty','Empty-manifest message');
  var malformed = analyzeImsccFromXmlString('<manifest>','bad.imscc','');
  CTI_TEST_assert_(malformed.success === false,'Malformed XML must fail');
  CTI_TEST_contains_(malformed.error,'XML Parsing Error','Malformed XML reason');
  var evidence = analyzeImsccFromXmlString(CTI_TEST_goldenManifestXml_(),'evidence.imscc','{bad-json');
  CTI_TEST_assert_(evidence.success === true,'Bad optional source evidence must not invalidate manifest analysis');
  CTI_TEST_equal_(evidence.stats.sourceEvidenceMode,'manifest-only','Bad evidence degrades conservatively');
}

function CTI_TEST_imsccDepthLimit_() {
  // Apps Script's underlying JAXP parser itself rejects XML deeper than 100
  // elements before CTI can inspect it. Keep this fixture shallow enough to
  // parse, then seed CTI's validator at depth 100 so one child crosses CTI's
  // own explicit 100-level boundary. This tests our guard rather than JAXP.
  var xml = '<?xml version="1.0"?><manifest xmlns="urn:test"><organizations><organization>' +
    '<item identifier="D0"><title>Depth</title><item identifier="D1"><title>Leaf</title></item></item>' +
    '</organization></organizations><resources/></manifest>';
  var doc = XmlService.parse(xml), root = doc.getRootElement(), ns = root.getNamespace();
  var org = root.getChild('organizations',ns).getChild('organization',ns);
  CTI_TEST_throws_(function(){ validateManifestItems_(org.getChildren('item',ns),ns,100,{count:0}); },'100-level safety limit','Excessive hierarchy depth must fail');

  // Also freeze the platform-parser boundary: if JAXP rejects pathological depth
  // before CTI's validator runs, the public analyzer must degrade to a normal
  // {success:false} result rather than leaking an uncaught exception.
  var deepInner = '<title>Leaf</title>';
  for (var i=0;i<102;i++) deepInner = '<item identifier="X'+i+'"><title>Depth</title>' + deepInner + '</item>';
  var tooDeepXml = '<?xml version="1.0"?><manifest xmlns="urn:test"><organizations><organization>' + deepInner + '</organization></organizations><resources/></manifest>';
  var tooDeep = analyzeImsccFromXmlString(tooDeepXml,'too-deep.imscc','');
  CTI_TEST_assert_(tooDeep.success === false,'Platform XML depth rejection must be returned as a controlled failure');
  CTI_TEST_contains_(tooDeep.error,'XML Parsing Error','Platform XML depth rejection must use the public analyzer error contract');
}

function CTI_TEST_preflightDeterministic_() {
  CTI_TEST_equal_(deterministicPreflightMessage_('CLEARED TO INGEST',57,0,0),'Cleared by deterministic checks: 57 valid item(s), 0 core empty folder(s), and 0 LTI item(s).','Clear preflight message');
  CTI_TEST_contains_(deterministicPreflightMessage_('BLOCKED',0,0,0),'no valid content items','Zero-content block reason');
  CTI_TEST_contains_(deterministicPreflightMessage_('BLOCKED',10,2,0),'2 non-administrative empty folder(s)','Core-empty block reason');
  CTI_TEST_contains_(deterministicPreflightMessage_('BLOCKED',100,0,51),'51 LTI items exceed the limit of 50','LTI block reason');
}

function CTI_TEST_courseraTypeContracts_() {
  CTI_TEST_equal_(normalizeCourseraType_('StaffGraded'),'Assignment','Staff graded normalizes to Assignment');
  CTI_TEST_equal_(normalizeCourseraType_('discussionPrompt'),'Discussion','Discussion prompt normalization');
  CTI_TEST_equal_(normalizeCourseraType_('ungradedWidget'),'Plugin','Widget normalization');
  CTI_TEST_equal_(normalizeCourseraType_('exam'),'Assessment','Exam normalization');
  CTI_TEST_equal_(normalizeCourseraType_('lecture'),'Reading','Lecture normalization');
  CTI_TEST_assert_(qaTypesCompatible_('assessment','assignment') === true,'Assessment→Assignment is an allowed transformation');
  CTI_TEST_assert_(qaTypesCompatible_('plugin','lti') === true,'Plugin/LTI compatibility');
  CTI_TEST_assert_(qaTypesCompatible_('discussion','assignment') === false,'Discussion→Assignment is not silently compatible');
}

function CTI_TEST_courseraUrlContracts_() {
  CTI_TEST_equal_(qaNormalizeUrl_('HTTPS://WWW.Example.com/a//b/?x=1#z'),'example.com/a/b?x=1#z','Content query and fragment are preserved');
  CTI_TEST_equal_(qaNormalizeUrl_('not-a-url'),'','Non-HTTP value ignored');
  var links = qaExternalLinks_([
    'https://www.example.com/a?x=1',
    'https://example.com/a#frag',
    'http://www.imsglobal.org/xsd/imscp_v1p1.xsd',
    'https://another.example.org/path/'
  ]);
  CTI_TEST_equal_(links.length,3,'Distinct resource selectors remain distinct; schema URLs are filtered');
  CTI_TEST_equal_(links[0].normalized,'example.com/a?x=1','Canonical query URL');
  CTI_TEST_equal_(links[1].normalized,'example.com/a#frag','Canonical section URL'
  );
  CTI_TEST_equal_(links[2].normalized,'another.example.org/path','Third external URL');
}

function CTI_TEST_assetSimilarity_() {
  var h1 = new Array(65).join('a'), h2 = new Array(65).join('b');
  var exact = qaAssetSimilarity_({name:'Guide.pdf',sha256:h1,size:1000},{name:'renamed.pdf',sha256:h1,size:1200});
  CTI_TEST_equal_(exact.method,'SHA256_EXACT','SHA-256 outranks filename changes');
  CTI_TEST_equal_(exact.score,1,'Cryptographic match score');
  var mismatch = qaAssetSimilarity_({name:'Guide.pdf',sha256:h1,size:1000},{name:'Guide.pdf',sha256:h2,size:1000});
  CTI_TEST_equal_(mismatch.method,'HASH_MISMATCH','Same filename with different hashes must not verify');
  CTI_TEST_assert_(mismatch.score < 0.5,'Hash mismatch confidence stays low');
  var nameSize = qaAssetSimilarity_({name:'slides.pptx',size:1000},{name:'slides.pptx',size:1000});
  CTI_TEST_equal_(nameSize.method,'NAME_SIZE_EXACT','Name+size fallback');
  CTI_TEST_near_(qaPerceptualHashSimilarity_('abcdef','abcdef'),1,0,'Perceptual hash identity');
}

function CTI_TEST_extraItemClassification_() {
  CTI_TEST_equal_(qaClassifyExtraItem_({name:'Author Alignment Report'}).classification,'ADMIN_EXTRA','Alignment report is administrative');
  CTI_TEST_equal_(qaClassifyExtraItem_({name:'Untitled Placeholder'}).classification,'PLACEHOLDER_EXTRA','Placeholder classification');
  CTI_TEST_equal_(qaClassifyExtraItem_({name:'Course-specific Resources'}).classification,'TEMPLATE_EXTRA','Template classification');
  CTI_TEST_equal_(qaClassifyExtraItem_({name:'Real New Lesson'}).classification,'CONTENT_EXTRA','Unknown extra content requires review');
  CTI_TEST_equal_(qaClassifyExtraItem_({name:'Carrier',repackagedSourceNames:['Source A']}).classification,'CONSOLIDATION_CARRIER','Repackaged carrier classification');
}

function CTI_TEST_evidenceStrengthScoring_() {
  CTI_TEST_equal_(qaEvidenceStrength_({verdict:'MISSING',checks:{},issues:[]}).score,98,'Missing evidence strength');
  CTI_TEST_equal_(qaEvidenceStrength_({verdict:'INTENTIONAL_EXCLUSION',checks:{},issues:[]}).score,96,'Intentional exclusion evidence strength');
  CTI_TEST_equal_(qaEvidenceStrength_({verdict:'TYPE_MUTATION',checks:{},issues:[]}).score,95,'Type mutation evidence strength');
  var verifiedAsset = qaEvidenceStrength_({verdict:'PARTIAL',evidenceCoverage:70,issues:[],checks:{assets:{matches:[{method:'SHA256_EXACT'}],relocated:[]}}});
  CTI_TEST_equal_(verifiedAsset.score,99,'SHA-256 proof lifts evidence strength to 99');
  var unverified = qaEvidenceStrength_({verdict:'UNVERIFIED',evidenceCoverage:92,issues:[],checks:{}});
  CTI_TEST_assert_(unverified.score <= 69,'UNVERIFIED evidence is capped below strong confidence');
}


function CTI_TEST_workNormalization_() {
  CTI_TEST_equal_(workOwnerKey_('Mayur N.'),'mayur n','Owner normalization');
  CTI_TEST_equal_(workDisplayCode_('SCRS200 - DEV (NCE)'),'SCRS200','Display code strips development suffix');
  CTI_TEST_equal_(workDisplayCode_('BORL113.imscc'),'BORL113','Display code strips IMSCC extension');
  var campaign = workCampaignId_('Northern Alberta Institute of Technology','2026-05-01','2026-06-30','2026-09-12');
  CTI_TEST_contains_(campaign,'20260501','Campaign contains from date');
  CTI_TEST_contains_(campaign,'20260630','Campaign contains to date');
  CTI_TEST_contains_(campaign,'20260912','Campaign contains redo scan cutoff');
}

function CTI_TEST_workCatalogResolution_() {
  var rows = [
    {sourceRow:2,title:'Blueprint Reading',owner:'Archee Arjun',ccPackageAccess:'Complete',importStatus:'Complete'},
    {sourceRow:239,title:'Hydraulics & Blueprint Reading',owner:'',ccPackageAccess:'Pending',importStatus:'Pending'}
  ];
  var resolved = workResolveCatalogCandidate_(rows,'Archee Arjun');
  CTI_TEST_equal_(resolved.status,'MATCH','Planner owner resolves duplicate title code');
  CTI_TEST_equal_(resolved.row.sourceRow,2,'Owner-matched catalog row wins');
  var ambiguous = workResolveCatalogCandidate_([
    {sourceRow:1,owner:'Owner A'},{sourceRow:2,owner:'Owner A'}
  ],'Owner A');
  CTI_TEST_equal_(ambiguous.status,'AMBIGUOUS','Multiple owner matches remain ambiguous');
}

function CTI_TEST_workPlannerCodeExtraction_() {
  var index = Object.create(null);
  index[getMatchKey_('SCRS200')] = [{}];
  index[getMatchKey_('BORL111')] = [{}];
  index[getMatchKey_('MELT523')] = [{}];
  var text = 'SCRS200 - DEV (NCE), BORL111 DEV (NCE). Jira AUTHORING-10515. M2L2. MELT523 failed.';
  var keys = workExtractCatalogKeysFromText_(text,index);
  CTI_TEST_equal_(keys.length,3,'Only known catalog title codes are extracted');
  CTI_TEST_assert_(keys.indexOf(getMatchKey_('SCRS200')) > -1,'SCRS200 extracted');
  CTI_TEST_assert_(keys.indexOf(getMatchKey_('BORL111')) > -1,'BORL111 extracted');
  CTI_TEST_assert_(keys.indexOf(getMatchKey_('MELT523')) > -1,'MELT523 extracted');
}

function CTI_TEST_workScormCount_() {
  CTI_TEST_equal_(workScormCount_('N/A'),0,'N/A means no SCORM package');
  CTI_TEST_equal_(workScormCount_('5'),5,'Numeric SCORM count');
  CTI_TEST_equal_(workScormCount_(3),3,'Numeric cell SCORM count');
  CTI_TEST_equal_(workScormCount_('Yes'),1,'Positive nonnumeric marker counts as one');
}

function CTI_TEST_workSourceNextActions_() {
  var state = workDefaultState_('W','C','T');
  var missing = workNextAction_({catalogStatus:'MATCH',ctiMatchStatus:'MISSING',ctiUuid:'',expectedFileName:'ABC123.imscc'},state);
  CTI_TEST_equal_(missing.code,'UPLOAD_SOURCE','Missing CTI source requires upload');
  var old = workNextAction_({catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'u',sourceRescanned:false},state);
  CTI_TEST_equal_(old.code,'RESCAN_SOURCE','Existing old source requires re-scan');
  var rescanned = workNextAction_({catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'u',sourceRescanned:true},state);
  CTI_TEST_equal_(rescanned.code,'REDO_COURSERA','Re-scanned source advances to Coursera redo');
}

function CTI_TEST_workRawQaRecommendation_() {
  var keep = workRawQaRecommendation_({sourceFidelity:98,summary:{observedFidelity:98,evidenceCoverage:96,missing:0,mutations:0,partial:0,unverified:0,ownerCritical:0,ownerReview:0}});
  CTI_TEST_equal_(keep.code,'KEEP','High-fidelity complete raw audit should support keeping the existing shell');

  var reingest = workRawQaRecommendation_({sourceFidelity:91,summary:{observedFidelity:91,evidenceCoverage:95,missing:1,mutations:0,partial:0,unverified:0,ownerCritical:1,ownerReview:0}});
  CTI_TEST_equal_(reingest.code,'REINGEST','Missing/critical source evidence should recommend re-ingestion');

  var review = workRawQaRecommendation_({sourceFidelity:96,summary:{observedFidelity:96,evidenceCoverage:92,missing:0,mutations:0,partial:1,unverified:0,ownerCritical:0,ownerReview:1}});
  CTI_TEST_equal_(review.code,'REVIEW','Partial/review evidence should require a human decision');
  var extraReview = workRawQaRecommendation_({sourceFidelity:99,summary:{observedFidelity:99,evidenceCoverage:99,missing:0,mutations:0,partial:0,unverified:0,ownerCritical:0,ownerReview:0,extraCourseraItems:1}});
  CTI_TEST_equal_(extraReview.code,'REVIEW','Unexpected extra Coursera structure prevents automatic keep recommendation');
}


function CTI_TEST_workNaitRedoPolicyDefinition_() {
  var nait = workRedoPolicyDefinition_('Northern Alberta Institute of Technology');
  CTI_TEST_equal_(nait.policyId || nait.id,'NAIT-LFM-REDO-v4','NAIT policy identity');
  CTI_TEST_assert_(nait.nonLearnerFacingRoots.indexOf('instructor resources') > -1,'Instructor Resources is non-LFM for NAIT redo gate');
  CTI_TEST_assert_(nait.nonLearnerFacingRoots.indexOf('archive') > -1,'Archive is non-LFM for NAIT redo gate');
  CTI_TEST_assert_(nait.nonLearnerFacingRoots.indexOf('student resources') === -1,'Student Resources remains in the learner-facing gate');
  var marshall = workRedoPolicyDefinition_('Marshall University');
  CTI_TEST_equal_(marshall.nonLearnerFacingRoots.length,0,'Partner policy does not silently apply NAIT exclusions to Marshall');


  var review94 = workBuildRawQaOperationalPolicy_(
    'Northern Alberta Institute of Technology',
    [{sourceName:'Clean Reading',sourcePath:'Module 1',verdict:'VERIFIED',earnedPoints:94,possiblePoints:100,evidenceCoverage:100,issues:[]}], [], {detected:false}
  );
  CTI_TEST_equal_(review94.recommendationCode,'REVIEW','94% adjusted fidelity must not automatically KEEP');

  var keep95 = workBuildRawQaOperationalPolicy_(
    'Northern Alberta Institute of Technology',
    [{sourceName:'Clean Reading',sourcePath:'Module 1',verdict:'VERIFIED',earnedPoints:95,possiblePoints:100,evidenceCoverage:80,issues:[]}], [], {detected:false}
  );
  CTI_TEST_equal_(keep95.recommendationCode,'KEEP','95% fidelity and 80% coverage with no review findings may KEEP');

  var review79Coverage = workBuildRawQaOperationalPolicy_(
    'Northern Alberta Institute of Technology',
    [{sourceName:'Clean Reading',sourcePath:'Module 1',verdict:'VERIFIED',earnedPoints:100,possiblePoints:100,evidenceCoverage:79,issues:[]}], [], {detected:false}
  );
  CTI_TEST_equal_(review79Coverage.recommendationCode,'REVIEW','Evidence coverage below 80% must block automatic KEEP');
}

function CTI_TEST_workNaitPathPolicy_() {
  var partner = 'Northern Alberta Institute of Technology';
  CTI_TEST_assert_(workSourceItemPolicy_(partner,{sourcePath:'Instructor Resources'}).inDecisionGate === false,'Instructor Resources excluded from redo decision');
  CTI_TEST_assert_(workSourceItemPolicy_(partner,{sourcePath:'Archive'}).inDecisionGate === false,'Archive excluded from redo decision');
  CTI_TEST_assert_(workSourceItemPolicy_(partner,{sourcePath:'Student Resources: Remote On-Demand Delivery'}).inDecisionGate === true,'Student Resources remains learner-facing/in-scope');
  CTI_TEST_assert_(workSourceItemPolicy_(partner,{sourcePath:'Overview'}).inDecisionGate === true,'Core module remains in-scope');
}

function CTI_TEST_workNonLfmExemption_() {
  var partner = 'Northern Alberta Institute of Technology';
  var items = [
    {sourceName:'Core Reading',sourcePath:'Overview',verdict:'VERIFIED',earnedPoints:100,possiblePoints:100,evidenceCoverage:100,issues:[]},
    {sourceName:'Instructor Guide',sourcePath:'Instructor Resources',verdict:'MISSING',earnedPoints:0,possiblePoints:0,evidenceCoverage:30,issues:['MISSING_ITEM']},
    {sourceName:'Teams Link',sourcePath:'Archive',verdict:'MISSING',earnedPoints:0,possiblePoints:0,evidenceCoverage:30,issues:['MISSING_ITEM']}
  ];
  items.forEach(function(item){ item.ownerAction=qaOwnerActionForResult_({verdict:item.verdict,issues:item.issues,checks:{},sourceType:'Reading',courseraType:''}); });
  var op = workBuildRawQaOperationalPolicy_(partner,items,[]);
  workApplyPolicyAwareOperatorGuidance_(items,[]);
  CTI_TEST_equal_(op.policyExemptSourceItems,2,'Two non-LFM missing source items are policy-exempt');
  CTI_TEST_equal_(op.learnerFacingMissing,0,'Non-LFM missing items do not become learner-facing missing');
  CTI_TEST_equal_(op.recommendationCode,'KEEP','Only non-LFM missing findings do not force re-ingestion when the learner-facing gate is clean');
  CTI_TEST_equal_(items[1].ownerAction.severity,'INFO','Policy-exempt missing Instructor Resources guidance is audit-only, not critical');
  CTI_TEST_contains_(items[1].ownerAction.action,'No automatic restoration, publication, or re-ingestion is required','Policy-aware wording must not tell operators to restore/publish exempt content');
}

function CTI_TEST_workLearnerMissingReingest_() {
  var partner = 'Northern Alberta Institute of Technology';
  var items = [
    {sourceName:'Course Error Reporting',sourcePath:'Student Resources: Remote On-Demand Delivery',verdict:'MISSING',earnedPoints:0,possiblePoints:0,evidenceCoverage:30,issues:['MISSING_ITEM']},
    {sourceName:'Instructor Guide',sourcePath:'Instructor Resources',verdict:'MISSING',earnedPoints:0,possiblePoints:0,evidenceCoverage:30,issues:['MISSING_ITEM']}
  ];
  var op = workBuildRawQaOperationalPolicy_(partner,items,[]);
  CTI_TEST_equal_(op.learnerFacingMissing,1,'Student Resources missing remains in redo gate');
  CTI_TEST_equal_(op.policyExemptSourceItems,1,'Instructor Resources missing remains visible but exempt');
  CTI_TEST_equal_(op.recommendationCode,'REINGEST','Learner-facing missing source item forces re-ingest recommendation');
}

function CTI_TEST_workTypeMutationReview_() {
  var partner = 'Northern Alberta Institute of Technology';
  var items = [
    {sourceName:'NAIT Student Resources',sourcePath:'Welcome - Start Here!',verdict:'TYPE_MUTATION',earnedPoints:75,possiblePoints:100,evidenceCoverage:95,issues:['TYPE_MUTATION']}
  ];
  var op = workBuildRawQaOperationalPolicy_(partner,items,[]);
  CTI_TEST_equal_(op.learnerFacingTypeMutations,1,'Learner-facing type mutation counted');
  CTI_TEST_equal_(op.recommendationCode,'REVIEW','Reading→plugin/native type mutations are review-first, not blind re-ingest');
}

function CTI_TEST_workHardPayloadReingest_() {
  var partner = 'Northern Alberta Institute of Technology';
  var items = [
    {sourceName:'Learner Reading',sourcePath:'Module 1',verdict:'PARTIAL',earnedPoints:85,possiblePoints:100,evidenceCoverage:100,issues:['MISSING_ASSET']}
  ];
  var op = workBuildRawQaOperationalPolicy_(partner,items,[]);
  CTI_TEST_equal_(op.learnerFacingHardPayloadLoss,1,'High-confidence learner-facing payload loss counted');
  CTI_TEST_equal_(op.recommendationCode,'REINGEST','Hard learner-facing payload loss creates a re-ingest diagnosis before actionability is applied');
  var latest = qaApplyIngestionActionabilityPolicy_(JSON.parse(JSON.stringify(op)),{ingestionCapabilityStatus:'LATEST_APPLIED'},{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(latest.recommendationCode,'MANUAL_REMEDIATION','Latest Smart Ingestion must not loop into another identical re-ingestion recommendation');
  CTI_TEST_equal_(latest.diagnosticRecommendationCode,'REINGEST','Underlying ingestion-defect diagnosis remains visible after actionability guard');
  var legacy = qaApplyIngestionActionabilityPolicy_(JSON.parse(JSON.stringify(op)),{ingestionCapabilityStatus:'LEGACY_OR_OUTDATED'},{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(legacy.recommendationCode,'REINGEST','Older/import-only shell may still be re-ingested once with latest capability');
}

function CTI_TEST_workExtraOperationalPolicy_() {
  var partner = 'Northern Alberta Institute of Technology';
  var verified = [{sourceName:'Core',sourcePath:'Overview',verdict:'VERIFIED',earnedPoints:100,possiblePoints:100,evidenceCoverage:100,issues:[]}];
  var info = workBuildRawQaOperationalPolicy_(partner,verified,[{name:'Author Alignment Report',path:'[DELETE ME] Author Alignment Report',classification:'ADMIN_EXTRA',severity:'INFO'}]);
  CTI_TEST_equal_(info.informationalExtras,1,'Administrative extra retained as information');
  CTI_TEST_equal_(info.recommendationCode,'KEEP','Administrative extra alone does not block keep decision');
  var review = workBuildRawQaOperationalPolicy_(partner,verified,[{name:'[EMPTY] Supporting Content',path:'Student Resources',classification:'PLACEHOLDER_EXTRA',severity:'REVIEW'}]);
  CTI_TEST_equal_(review.learnerFacingExtraReview,1,'Learner-facing placeholder extra requires review');
  CTI_TEST_equal_(review.recommendationCode,'REVIEW','Learner-facing placeholder extra blocks automatic keep');
}


function CTI_TEST_workScormKeepGate_() {
  var state = workDefaultState_('W','C','T');
  var base = {catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'u',sourceRescanned:true,catalogImportStatus:'Complete',plannerCategories:['Import Only'],existingCourseraShell:true,rawQaFresh:true,latestRawQa:{},rawQaRecommendation:{code:'KEEP'}};
  var flagged = Object.assign({},base,{scorm:{riseCount:1,storylineCount:0}});
  CTI_TEST_assert_(workHasScormFlag_(flagged) === true,'Rise/Storyline flag is detected');
  CTI_TEST_equal_(workNextAction_(flagged,state).code,'REVIEW_SCORM_EXISTING','SCORM/Rise/Storyline prevents automatic keep until source-LMS launch/runtime is checked');
  var clean = Object.assign({},base,{scorm:{riseCount:0,storylineCount:0}});
  CTI_TEST_equal_(workNextAction_(clean,state).code,'CONFIRM_KEEP_EXISTING','Non-SCORM clean shell may proceed to keep confirmation');
}

function CTI_TEST_workAuditBeforeReingest_() {
  var state = workDefaultState_('W','C','T');
  var base = {catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'u',sourceRescanned:true,catalogImportStatus:'Complete',plannerCategories:['Import Only'],existingCourseraShell:true};
  CTI_TEST_assert_(workHasExistingCourseraShell_(base) === true,'Completed Import Only assignment is eligible for audit-first shell handling');
  CTI_TEST_assert_(workHasExistingCourseraShell_({catalogImportStatus:'Complete',plannerCategories:['Course-to-Specialization Content Map']}) === false,'Completed non-Import-Only work must not be assumed to be an untouched raw shell');
  var noQa = Object.assign({},base,{rawQaFresh:false,latestRawQa:null,rawQaRecommendation:{code:'NONE'}});
  CTI_TEST_equal_(workNextAction_(noQa,state).code,'AUDIT_EXISTING_RAW','Existing completed import must be audited before blind re-ingestion');

  var keep = Object.assign({},base,{rawQaFresh:true,latestRawQa:{},rawQaRecommendation:{code:'KEEP'}});
  CTI_TEST_equal_(workNextAction_(keep,state).code,'CONFIRM_KEEP_EXISTING','Strong existing-shell QA should ask the owner to keep/confirm rather than reimport');

  var review = Object.assign({},base,{rawQaFresh:true,latestRawQa:{},rawQaRecommendation:{code:'REVIEW'}});
  CTI_TEST_equal_(workNextAction_(review,state).code,'REVIEW_EXISTING_RAW','Review-grade QA must stop for human review');

  var bad = Object.assign({},base,{rawQaFresh:true,latestRawQa:{},rawQaRecommendation:{code:'REINGEST'}});
  CTI_TEST_equal_(workNextAction_(bad,state).code,'REDO_COURSERA','Material raw-shell fidelity issues should recommend re-ingestion');
}

function CTI_TEST_workKeepExistingState_() {
  var item = {catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'u',sourceRescanned:true,catalogImportStatus:'Complete',existingCourseraShell:true,productType:'Course',plannerCategories:['Import Only']};
  var state = workDefaultState_('W','C','T');
  state.courseraRedo = 'NOT_REQUIRED';
  CTI_TEST_equal_(workNextAction_(item,state).code,'BUILD_COURSE_OUTLINE','Keep-existing decision must bypass unnecessary Coursera reimport and advance the workflow');
  var patch = workValidateStatePatch_({courseraRedo:'NOT_REQUIRED'});
  CTI_TEST_equal_(patch.courseraRedo,'NOT_REQUIRED','NOT_REQUIRED is a valid persisted Coursera decision');
}

function CTI_TEST_workCourseStateMachine_() {
  var item = {catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'u',sourceRescanned:true,productType:'Course',plannerCategories:[]};
  var state = workDefaultState_('W','C','T');
  state.courseraRedo = 'DONE';
  CTI_TEST_equal_(workNextAction_(item,state).code,'BUILD_COURSE_OUTLINE','Course outline follows Coursera redo');
  state.courseOutline = 'DRAFT';
  CTI_TEST_equal_(workNextAction_(item,state).code,'AUDIT_SOURCE','Draft outline must be audited against source LMS');
  state.sourceAudit = 'PASS';
  CTI_TEST_equal_(workNextAction_(item,state).code,'SECURE_COURSE_OUTLINE','Passed source audit must be secured');
  state.courseOutline = 'SECURED';
  CTI_TEST_equal_(workNextAction_(item,state).code,'COMPLETE','Course completes after secured audited outline');
}

function CTI_TEST_workSpecializationStateMachine_() {
  var item = {catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'u',sourceRescanned:true,productType:'Specialization',plannerCategories:['Course-to-Specialization Content Map']};
  var state = workDefaultState_('W','C','T');
  state.courseraRedo = 'DONE';
  state.courseOutline = 'SECURED';
  state.sourceAudit = 'PASS';
  CTI_TEST_equal_(workNextAction_(item,state).code,'BUILD_SPEC_OUTLINE','Specialization outline waits until course outline is secured');
  state.specializationOutline = 'DRAFT';
  CTI_TEST_equal_(workNextAction_(item,state).code,'SECURE_SPEC_OUTLINE','Draft specialization outline must be secured');
  state.specializationOutline = 'SECURED';
  CTI_TEST_equal_(workNextAction_(item,state).code,'BUILD_CONTENT_MAP','Content map follows secured specialization outline');
  state.contentMap = 'DONE';
  CTI_TEST_equal_(workNextAction_(item,state).code,'COMPLETE','Specialization completes after content map');
}

function CTI_TEST_workStateValidation_() {
  var patch = workValidateStatePatch_({courseraRedo:'DONE',courseOutline:'DRAFT',sourceAudit:'PASS'});
  CTI_TEST_equal_(patch.courseraRedo,'DONE','Valid work state accepted');
  CTI_TEST_throws_(function(){ workValidateStatePatch_({courseOutline:'MAGIC'}); },'Invalid work-state value','Invalid work state rejected');
  CTI_TEST_throws_(function(){ workValidateStatePatch_({}); },'No supported work-state changes','Empty work patch rejected');
}

function CTI_TEST_workEvidenceChecklistValidation_() {
  var initial = workNormalizeEvidenceChecklist_();
  CTI_TEST_equal_(Object.keys(initial).length,10,'Ten collection steps');
  CTI_TEST_assert_(Object.keys(initial).every(function(key){ return initial[key] === false; }),'No progress inferred from an empty record');
  var saved = workNormalizeEvidenceChecklist_('{"beforeQaSaved":true,"afterQaSaved":false}');
  CTI_TEST_equal_(saved.beforeQaSaved,true,'Saved before report is restored');
  CTI_TEST_equal_(saved.afterQaSaved,false,'After report remains unchecked');
  CTI_TEST_equal_(saved.reingested,false,'Unrecorded ingestion is not inferred');
  var patch = workValidateStatePatch_({evidenceChecklist:{beforeQaSaved:false}});
  CTI_TEST_equal_(patch.evidenceChecklist.beforeQaSaved,false,'Unchecking is a valid update');
  CTI_TEST_throws_(function(){workValidateStatePatch_({evidenceChecklist:{beforeQaSaved:'false'}});},'Invalid evidence checklist step','String false cannot count as checked');
  CTI_TEST_throws_(function(){workValidateStatePatch_({evidenceChecklist:{sourceAudit:true}});},'Invalid evidence checklist step','Checklist cannot change audit state');
  CTI_TEST_throws_(function(){workValidateStatePatch_({evidenceChecklist:[]});},'Invalid evidence checklist','Arrays rejected');
  CTI_TEST_throws_(function(){workNormalizeEvidenceChecklist_('{bad');},'unreadable','Corrupt stored progress cannot be silently reset');
  CTI_TEST_throws_(function(){workNormalizeEvidenceChecklist_('{"__proto__":true}');},'Invalid evidence checklist step','Prototype keys rejected');
}

function CTI_TEST_workEvidenceChecklistIsolation_() {
  var state = workDefaultState_('campaign|MELT521','campaign','MELT521');
  var item = {catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'source',sourceRescanned:false};
  var before = workNextAction_(item,state).code;
  workEvidenceChecklistSteps_().forEach(function(step){ state.evidenceChecklist[step.key] = true; });
  CTI_TEST_equal_(workNextAction_(item,state).code,before,'Manual collection checks cannot satisfy actual source-evidence requirements');
  CTI_TEST_equal_(state.sourceAudit,'NOT_STARTED','No audit approval implied');
  CTI_TEST_equal_(state.courseraRedo,'NOT_STARTED','Checklist does not change the existing reimport workflow');
  CTI_TEST_equal_(workDefaultState_('campaign|BORL113','campaign','BORL113').evidenceChecklist.beforeQaSaved,false,'Course records do not share progress objects');
}

// ---------------------------------------------------------------------------
// SOURCE CONTRACT: browser-side workflows that Apps Script cannot execute as DOM code
// ---------------------------------------------------------------------------
function CTI_TEST_releaseIdentityContract_() {
  var source = CTI_TEST_indexSource_();
  CTI_TEST_equal_(CTI_GATEWAY_RELEASE_,CTI_TEST_BASELINE_GATEWAY_,'Backend gateway identity');
  CTI_TEST_equal_(CTI_QA_ENGINE_BUILD_ID_,'v8.0.0-evidence-dimension-hardening-20260926','Backend QA build identity');
  CTI_TEST_equal_(CTI_MACMILLAN_BUILD_ID_,'v6.8.2-partner-ready-doc-projection-20260912','Backend Macmillan build identity');
  CTI_TEST_equal_(CTI_WORK_QUEUE_BUILD_ID_,'v1.6-evidence-checklist-20260919','Backend work-queue build identity');
  CTI_TEST_equal_(MACMILLAN_TIME_MODEL_VERSION_,CTI_TEST_BASELINE_TIME_MODEL_,'Backend time-model identity');
  CTI_TEST_contains_(source,CTI_TEST_BASELINE_GATEWAY_,'Frontend gateway release label');
  CTI_TEST_contains_(source,'v6.14.0','Coursera extractor version');
  CTI_TEST_contains_(source,'schema 34','Frozen Coursera extractor schema label');
}

function CTI_TEST_frontendEndpointMapping_() {
  var source = CTI_TEST_indexSource_();
  var endpoints = [
    'recordSiteVisit','getDeploymentTimestamp','analyzeImsccFromXmlString','runPreFlightInspector','savePackageAuditToDb',
    'getPartnerAnalyticsDb','fetchPackageStructureDb','exportMasterManifestAsGoogleSheet','generateAiRiskReportDb','executeDeepArchitectureAudit',
    'updatePackageInDb','updatePackageMetadataInDb','deletePackageFromDb','getDuplicateEntryPreview','archiveDuplicateEntries','syncCatalogsFromDrive',
    'getQaRunHistory','getQaStoredRun','repairQaRepeatedExportLineage','runCTISystemHealthCheck','runPostIngestionQa','runPostIngestionLifecycleQa','synthesizeQaRemediationPlanDb',
    'getRedoWorkQueueDb','updateRedoWorkItemState',
    'uploadAndScanMaster','executeDynamicNSplitAndScan','exportSpecAsXlsxBlob','qaCompareGptOutput'
  ];
  endpoints.forEach(function(name){
    CTI_TEST_assert_(source.indexOf('.' + name + '(') > -1,'Index.html must call backend endpoint ' + name);
    CTI_TEST_assert_(CTI_TEST_globalFunctionExists_(name),'Code.gs must define backend endpoint ' + name);
  });
}

function CTI_TEST_frontendDomContract_() {
  var source = CTI_TEST_indexSource_();
  var ids = [
    'partnerTagInput','assignedDateInput','ownerInput','deadlineInput','statusInput','driveLinkInput','imsccFile','analyzeImsccBtn','imsccStatus',
    'workPartnerFilter','workOwnerFilter','workFromDate','workToDate','refreshWorkQueueBtn','workQueueStatus','workQueueSummary','workQueueUnresolved','workQueueList',
    'refreshLibraryBtn','duplicateReviewBtn','duplicateCountBadge','syncCatalogsBtn','searchPackagesInput','dbAnalyticsStatus','courseViewerContainer','courseViewerBox','viewerTitle',
    'auditModal','auditTitle','auditContent','postQaModal','postQaTitle','postQaResults','qaGenerationSelect','qaManualGenerationSelect','qaOperatorGuidance','qaExcelInput','qaJsonInput','qaRawExcelInput','qaRawJsonInput','qaCurrentExcelInput','qaCurrentJsonInput',
    'masterFile','stage1Btn','stage2Btn','stage3Btn','stage4Btn','stage5Btn','anchorsContainer','metaContainer','mergeContainer','mapContainer','finalDownloadBox'
  ];
  ids.forEach(function(id){ CTI_TEST_assert_(CTI_TEST_domIdExists_(source,id),'Required DOM id missing: ' + id); });
  ['processImscc','fetchRedoWorkQueue','renderRedoWorkQueue','triggerWorkRescan','saveRedoWorkState','openSavedCourseViewer','runDeepAudit','runPostQa','runLifecycleQa','processStage1','processStage2','processStage3','processStage4','processStage5'].forEach(function(name){
    CTI_TEST_assert_(CTI_TEST_sourceHasFunction_(source,name),'Required frontend function missing: ' + name);
  });
}

function CTI_TEST_imsccBrowserExtractorContract_() {
  var source = CTI_TEST_indexSource_();
  CTI_TEST_contains_(source,'jszip@3.10.1','JSZip dependency');
  CTI_TEST_contains_(source,'pdf.js/3.11.174','PDF.js dependency');
  CTI_TEST_assert_(CTI_TEST_sourceHasFunction_(source,'readPackageManifest'),'IMSCC package reader');
  CTI_TEST_contains_(source,'async function buildSourceEvidenceFromZip_','ZIP source-evidence builder');
  CTI_TEST_assert_(CTI_TEST_sourceHasFunction_(source,'parseQtiAssessmentStructure_'),'QTI question/answer parser');
  CTI_TEST_contains_(source,'ims-qti-dom-v5-response-profile','Condition-aware QTI parser identity');
  CTI_TEST_contains_(source,"tag === 'not'",'QTI answer parsing preserves negated selections');
  CTI_TEST_contains_(source,"action === 'set' || action === 'add'",'Subtract/Multiply are not positive answer evidence');
  CTI_TEST_assert_(CTI_TEST_sourceHasFunction_(source,'manifestResourceRecords_'),'Manifest compatibility record parser');
  CTI_TEST_contains_(source,'schemaVersion: 8','Source evidence schema 8');
  CTI_TEST_contains_(source,'pdfPageSemanticSamples: true','PDF page semantic evidence capability');
  CTI_TEST_contains_(source,'qtiStructure: true','QTI structure evidence capability');
  CTI_TEST_contains_(source,'maxFiles: 1800','ZIP file safety budget');
  CTI_TEST_contains_(source,'maxTotalHashBytes: 60000000','Hashing safety budget');
  CTI_TEST_contains_(source,'maxTotalPdfPages: 240','PDF page safety budget');
}

function CTI_TEST_imsccScanUiContract_() {
  var source = CTI_TEST_indexSource_();
  ['Live IFS Evaluation','Formula Breakdown:','Auto-Remarks:','Source Item Fingerprinting:','Graph Theory Orphan Detection','Lexical Variance (TTR:','Z-Score Imbalance Detected','Hidden dependency audit','Micro-Course Warning','Package Summary','Interactive Course Blueprint','Pre-Flight Rules Running...','CLEARED TO INGEST','BLOCKED'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'IMSCC scan UI contract');
  });
  CTI_TEST_contains_(source,'runPreFlightInspector(JSON.stringify(preFlightData))','Scan result must invoke deterministic preflight');
  CTI_TEST_contains_(source,"onclick='exportToGoogleSheet(this)'",'Scan result must expose Google Sheets export');
  CTI_TEST_contains_(source,"onclick='copyBlueprintText(this)'",'Scan result must expose copy format');
}

function CTI_TEST_courseLibraryUiContract_() {
  var source = CTI_TEST_indexSource_();
  ['Refresh Course Library','Bulk Re-Scan','Review Duplicates','Sync Catalogs','Explore','Deep Audit','Post-Ingestion QA','AI Triage','Re-Scan','IFS Formula Breakdown:','Est. Labor:'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'Course Library feature contract');
  });
  CTI_TEST_contains_(source,'res.partners[b].avgIFS - res.partners[a].avgIFS','Partner cards remain sorted by descending average IFS');
  CTI_TEST_contains_(source,'predictLaborHours(pObj.ifs, pObj.totalItems, pObj.lti, pObj.empty)','Labor estimate remains derived from package metrics');
  CTI_TEST_contains_(source,'canonicalFileKey','Re-scan/duplicate filename normalization remains wired');
}


function CTI_TEST_workQueueUiContract_() {
  var source = CTI_TEST_indexSource_();
  ['Smart Ingestion Redo Work Queue','May–June 2026','Confirmed title codes','Need source re-scan','SCORM / Rise / Storyline flagged','Unmapped planner slots','Coursera reimport','Course outline','Source-LMS audit','Specialization outline','Content map'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'Work Queue UI contract');
  });
  ['fetchRedoWorkQueue','renderRedoWorkQueue','triggerWorkRescan','prepareWorkUpload','saveRedoWorkState','openWorkExplore','openWorkAudit','openWorkQa'].forEach(function(name){
    CTI_TEST_assert_(CTI_TEST_sourceHasFunction_(source,name),'Work Queue frontend function missing: ' + name);
  });
  CTI_TEST_contains_(source,'updateContext = { uuid:item.ctiUuid','Work re-scan must update exact saved UUID');
  CTI_TEST_contains_(source,'planner/catalog sources','Work Queue source authority disclosure');
}

function CTI_TEST_workQueueEndpointContract_() {
  var source = CTI_TEST_indexSource_();
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('getRedoWorkQueueDb'),'Backend Work Queue endpoint');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('updateRedoWorkItemState'),'Backend Work State endpoint');
  CTI_TEST_contains_(source,'.getRedoWorkQueueDb(','Frontend calls Work Queue endpoint');
  CTI_TEST_contains_(source,'.updateRedoWorkItemState(','Frontend calls Work State endpoint');
  CTI_TEST_equal_(CTI_WORK_DEFAULT_FROM_,'2026-05-01','Default redo from date');
  CTI_TEST_equal_(CTI_WORK_DEFAULT_TO_,'2026-06-30','Default redo to date');
  CTI_TEST_equal_(CTI_WORK_DEFAULT_SCAN_AFTER_,'2026-09-12','Redo source-scan baseline');
  CTI_TEST_contains_(CTI_WORK_SOURCE_CONFIG_.nait.scormId,'1-DGjqy','NAIT SCORM source configured');
}

function CTI_TEST_workQueueAuditFirstUiContract_() {
  var source = CTI_TEST_indexSource_();
  ['Need existing-shell QA','Keep existing recommended','Re-ingest recommended','Audit Existing Shell','Not required / keep existing','Existing Coursera raw-shell QA:','Import Only rule:'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'Audit-first Work Queue UI contract');
  });
  CTI_TEST_contains_(source,"snapshot.value = 'raw'",'Work Queue existing-shell QA defaults to raw-ingestion context');
  CTI_TEST_contains_(source,'refreshWorkQueueForPackageUuid_(currentPostQaUuid)','Successful QA refreshes matching Work Queue evidence');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('workRawQaRecommendation_'),'Backend raw-QA recommendation policy exists');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('loadLatestRawQaMap_'),'Backend latest raw-QA map exists');
}


function CTI_TEST_operationalRedoUiContract_() {
  var source = CTI_TEST_indexSource_();
  ['Operational redo decision','Policy-adjusted','Missing in decision gate','Policy-exempt source findings','OPERATIONAL REDO DECISION','Is this shell already from the latest Smart Ingestion','Need help reading this report? Definitions in plain language','Evidence Coverage','MANUAL FIXES REQUIRED — DO NOT LOOP RE-INGESTION'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'Operational redo UI/copy contract');
  });
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('workBuildRawQaOperationalPolicy_'),'Operational redo policy builder exists');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('qaApplyIngestionActionabilityPolicy_'),'Ingestion actionability guard exists');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('workSourceItemPolicy_'),'Source-item policy classifier exists');
}

function CTI_TEST_workQueueNaitPolicyContract_() {
  var source = CTI_TEST_indexSource_();
  ['NAIT redo policy','Instructor Resources','Archive','Student Resources','Policy-adjusted','Runtime check before keep'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'NAIT redo policy disclosure contract');
  });
  CTI_TEST_contains_(source,'item.latestRawQa.operationalPolicy || qs.operationalPolicy','Work Queue reads persisted operational policy');
}

function CTI_TEST_exploreViewerContract_() {
  var source = CTI_TEST_indexSource_();
  CTI_TEST_assert_(CTI_TEST_sourceHasFunction_(source,'openSavedCourseViewer'),'Explore viewer function');
  ['Pipeline Status:','Run Deep Audit','Graph Theory Orphan Detection','Lexical Variance (TTR:','Z-Score Imbalance Detected','Package Summary','Content Format','Detected Count','Coursera Mapping','Hidden dependency candidates','Interactive runtime candidates (source evidence)','external inventory is supplemental, not exhaustive','Extracted Hierarchy'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'Explore viewer contract');
  });
  CTI_TEST_contains_(source,'generateTreeHtml(res.tree)','Explore hierarchy must render saved tree');
  CTI_TEST_contains_(source,'.fetchPackageStructureDb(uuid)','Explore must load exact saved UUID structure');
  CTI_TEST_contains_(source,'at least five top-level modules','Z-score help text must reflect the effective sample-size threshold');
  CTI_TEST_assert_(source.indexOf('cognitive overload nightmare') === -1,'Structural z-score diagnostics must not claim cognitive overload');
  CTI_TEST_assert_(source.indexOf('structurally flawless') === -1,'Tracked structural signals must not be presented as proof a course is flawless');
}

function CTI_TEST_postQaUiContract_() {
  var source = CTI_TEST_indexSource_();
  ['BEFORE','AFTER','same Smart Ingestion attempt','immutable source fingerprint','XLSX + JSON selected','Run Source → Current Coursera QA','Open saved report'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'Post-ingestion QA operator/readiness contract');
  });
  CTI_TEST_contains_(source,'.runPostIngestionQa(','Single-snapshot QA endpoint');
  CTI_TEST_contains_(source,'.runPostIngestionLifecycleQa(','Lifecycle QA endpoint');
  CTI_TEST_contains_(source,'.getQaRunHistory(','QA evidence history endpoint');
  CTI_TEST_contains_(source,'.getQaStoredRun(','Saved QA report retrieval endpoint');
  CTI_TEST_contains_(source,'downloadVisibleQaReport','Saved/visible QA report can be downloaded as text');
  CTI_TEST_contains_(source,'BEFORE → AFTER','Lifecycle presentation uses operator language');
  CTI_TEST_contains_(source,'internal: C0','Internal lifecycle identity remains visible only as secondary context');

  // v1.8.2 regression: renderPostQaResults previously referenced the copy-report
  // accumulator `text`, which exists only in copyPostQaToClipboard(). That made
  // successful backend QA calls appear to hang because the success renderer threw
  // ReferenceError: text is not defined before updating the modal.
  var renderStart = source.indexOf('function renderPostQaResults');
  var renderEnd = source.indexOf('function runAiQaRemediation', renderStart);
  CTI_TEST_assert_(renderStart > -1 && renderEnd > renderStart, 'Post-QA renderer source range is discoverable');
  var renderSource = source.slice(renderStart, renderEnd);
  CTI_TEST_assert_(renderSource.indexOf(' text +=') === -1, 'Post-QA renderer must not reference copy-report text accumulator');
}

function CTI_TEST_macmillanUiContract_() {
  var source = CTI_TEST_indexSource_();
  ['Master Manifest Summary','Partner Setup &amp; Structure Triage','Metadata GPT Turnaround','Merge GPT Turnaround','Content Map Generation','Split Specializations &amp; Analyze','Verify Metadata Outputs','Cross-check Merged Outputs'].forEach(function(fragment){
    CTI_TEST_contains_(source,fragment,'Macmillan workflow UI contract');
  });
  CTI_TEST_contains_(source,'.uploadAndScanMaster(','Stage 1 backend endpoint');
  CTI_TEST_contains_(source,'.executeDynamicNSplitAndScan(','Stage 2 backend endpoint');
  CTI_TEST_contains_(source,'.qaCompareGptOutput(','Stage 3-5 QA endpoint');
  CTI_TEST_contains_(source,'buildPartnerContentMapHtml_','Partner-ready document projection');
  CTI_TEST_contains_(source,'module durations are preserved exactly from the CTI baseline','Partner-ready deterministic-time disclosure');
}

function CTI_TEST_frontendSafetyContract_() {
  var source = CTI_TEST_indexSource_();
  ['escapeHtml','sanitizeHTML','safeDriveUrl','validateChosenFile','setButtonBusy','renderStatus'].forEach(function(name){
    CTI_TEST_assert_(CTI_TEST_sourceHasFunction_(source,name),'Frontend safety/helper function missing: ' + name);
  });
  CTI_TEST_contains_(source,'sanitizeHTML(res.report)','Deep Audit AI HTML must be sanitized before rendering');
  CTI_TEST_contains_(source,'escapeHtml(res.error)','Server errors must be escaped in rendered HTML');
  CTI_TEST_contains_(source,'rel="noopener noreferrer"','External GPT links require noopener/noreferrer');
}

// ---------------------------------------------------------------------------
// FAST: Coursera QA/lifecycle regressions
// ---------------------------------------------------------------------------
function CTI_TEST_snapshotCoherence_() {
  var excel = [], json = [];
  for (var i = 1; i <= 6; i++) {
    excel.push({id:'id' + i, name:'Item ' + i});
    json.push({id:'id' + i, name:'Item ' + i});
  }
  var passRes = qaAssessSnapshotCoherence_(excel, json, {courseId:'COURSE'}, 'a.xlsx', 'a.json');
  CTI_TEST_equal_(passRes.status, 'PASS', 'Matching stable IDs should pass coherence');
  CTI_TEST_equal_(passRes.idOverlapPercent, 100, 'Matching stable IDs should show 100% overlap');

  var bad = [];
  for (var j = 1; j <= 6; j++) bad.push({id:'other' + j, name:'Different ' + j});
  var failRes = qaAssessSnapshotCoherence_(excel, bad, {}, 'a.xlsx', 'b.json');
  CTI_TEST_equal_(failRes.status, 'FAIL', 'Unrelated stable IDs should fail coherence');
}

function CTI_TEST_discussionPromptRegression_() {
  var prompt = 'Take a moment to introduce yourself and why you chose this course or program.';
  var source = {
    textSample:'Icebreaker discussion. ' + prompt + ' Please read the participation expectations before posting.',
    textLength:140
  };
  var coursera = {
    textSample:prompt,
    textLength:prompt.length,
    textEvidenceCompleteness:0.97,
    textScopeKind:'discussion-prompt',
    textConfidence:'high'
  };
  var good = qaTextComparison_(source, coursera);
  CTI_TEST_equal_(good.status, 'VERIFIED', 'Contained narrow discussion prompt must verify');
  CTI_TEST_assert_(good.promptContainment === true, 'Discussion verification must record positive containment');

  var bad = qaTextComparison_(source, {
    textSample:'This is a different learner prompt that is deliberately not contained in the source discussion body.',
    textLength:93,
    textEvidenceCompleteness:0.97,
    textScopeKind:'discussion-prompt',
    textConfidence:'high'
  });
  CTI_TEST_equal_(bad.status, 'UNVERIFIED', 'Non-contained narrow prompt must remain UNVERIFIED, never changed');
}

function CTI_TEST_structuredAssessmentRegression_() {
  var questions = [
    {number:1,type:'true-false',prompt:'The sky is blue.',options:[{text:'True',isCorrect:true},{text:'False',isCorrect:false}],correctAnswers:['True'],points:1,answerTextReliable:true},
    {number:2,type:'single-select',prompt:'Choose the prime number.',options:[{text:'4',isCorrect:false},{text:'5',isCorrect:true},{text:'6',isCorrect:false}],correctAnswers:['5'],points:1,answerTextReliable:true},
    {number:3,type:'text-entry',prompt:'Complete: To Learn, ___, To Succeed',options:[],correctAnswers:['To Do'],points:1,answerTextReliable:true},
    {number:4,type:'multiple-select',prompt:'Select all even numbers.',options:[{text:'2',isCorrect:true},{text:'3',isCorrect:false},{text:'4',isCorrect:true}],correctAnswers:['2','4'],points:1,answerTextReliable:true}
  ];
  var assessment = {schemaVersion:2,declaredQuestionCount:4,questionCount:4,questions:questions,parserConfidence:0.98};
  var source = {isStructuredAssessment:true,structuredAssessment:assessment};
  var coursera = {structuredAssessment:JSON.parse(JSON.stringify(assessment))};
  var good = qaStructuredAssessmentComparison_(source, coursera);
  CTI_TEST_equal_(good.status, 'VERIFIED', 'Identical four-question assessment must verify');
  CTI_TEST_equal_(good.alignedQuestionCount, 4, 'All four questions must align');
  CTI_TEST_near_(good.answerEvidenceCoverage, 1, 0.0001, 'All answerable questions must carry answer evidence');

  coursera.structuredAssessment.questions[1].correctAnswers = ['4'];
  coursera.structuredAssessment.questions[1].options[0].isCorrect = true;
  coursera.structuredAssessment.questions[1].options[1].isCorrect = false;
  var changed = qaStructuredAssessmentComparison_(source, coursera);
  CTI_TEST_equal_(changed.status, 'CHANGED', 'Correct-answer mutation must be detected');
  CTI_TEST_assert_(changed.answerMismatchCount >= 1, 'Correct-answer mutation must increment mismatch count');
  var unreliableSource=JSON.parse(JSON.stringify(assessment));
  unreliableSource.questions[3].correctAnswers=['2','3','4'];
  unreliableSource.questions[3].answerTextReliable=false;
  var unreliable=crossCheck(unreliableSource,assessment);
  CTI_TEST_equal_(unreliable.answerMismatchCount,0,'Unreliable answer evidence cannot prove an answer-count mismatch');
  CTI_TEST_equal_(unreliable.status,'UNVERIFIED','Unreliable answer keys remain review evidence');
  var legacy=JSON.parse(JSON.stringify(unreliableSource));
  legacy.parser='ims-qti-dom-v2-semantic-options'; legacy.origin='source-imscc'; legacy.questions[3].answerTextReliable=true;
  var old=crossCheck(legacy,assessment);
  CTI_TEST_assert_(old.sourceAnswerRefreshRequired===true,'Legacy multi-select answer keys require a source refresh');
  CTI_TEST_equal_(old.status,'UNVERIFIED','Known legacy QTI ambiguity cannot force a false changed verdict');
  var fresh=JSON.parse(JSON.stringify(legacy));fresh.parser='ims-qti-dom-v4-learner-text';
  var freshChanged=crossCheck(fresh,assessment);
  CTI_TEST_equal_(freshChanged.status,'CHANGED','Fresh reliable answer-key mismatch remains a hard finding');
  function crossCheck(a,b){return qaStructuredAssessmentComparison_({isStructuredAssessment:true,structuredAssessment:a},{structuredAssessment:JSON.parse(JSON.stringify(b))});}

}

function CTI_TEST_lifecycleRegression_() {
  function item(id, name, verdict, published, contentStatus) {
    return {sourceId:id,sourceName:name,sourcePath:'Module',verdict:verdict,checks:{publication:{published:published},content:{status:contentStatus||''},transformation:{rubricCount:0,rubricMismatchCount:0}}};
  }
  var raw = {itemResults:[
    item('a','Published Later','VERIFIED',false,'VERIFIED'),
    item('b','Intentional Note','INTENTIONAL_EXCLUSION',false,''),
    item('c','Regression Item','VERIFIED',false,'VERIFIED')
  ]};
  var current = {itemResults:[
    item('a','Published Later','VERIFIED',true,'VERIFIED'),
    item('b','Intentional Note','MISSING',false,''),
    item('c','Regression Item','MISSING',true,'')
  ]};
  var diff = qaCompareLifecycleSnapshots_(raw,current);
  CTI_TEST_assert_(diff && diff.summary, 'Lifecycle comparator must return a summary');
  CTI_TEST_equal_(diff.summary.publicationStateMutations, 2, 'Two publication state changes expected');
  CTI_TEST_equal_(diff.summary.persistedIntentionalExclusions, 1, 'C0 intentional exclusion must persist into C1 absence');
  CTI_TEST_equal_(diff.summary.regressions, 1, 'Verified→Missing must be a regression');
}

// ---------------------------------------------------------------------------
// FAST: Macmillan deterministic model
// ---------------------------------------------------------------------------
function CTI_TEST_macmillanTimeRules_() {
  CTI_TEST_equal_(MACMILLAN_TIME_MODEL_VERSION_, CTI_TEST_BASELINE_TIME_MODEL_, 'Time-model version changed; review and update tests deliberately');
  var policy = macmillanTimePolicyRows_();
  CTI_TEST_assert_(Array.isArray(policy) && policy.length >= 10, 'Time policy table must remain populated');

  // columns: level, name, assignment_tool, node_type
  var idx = {levelIdx:0,nameIdx:1,toolIdx:2,nodeTypeIdx:3};
  function mins(row, expected, rule) {
    var res = macmillanEstimateItemTime_(row,idx);
    CTI_TEST_equal_(res.minutes, expected, row[1] + ' minutes');
    if (rule) CTI_TEST_equal_(res.rule, rule, row[1] + ' rule');
  }
  mins([1,'Ch 1: Root','','folder'],0,'module-root');
  mins([2,'Reading Folder','','folder'],0,'container');
  mins([2,'Instructor Resources','reading','item'],0,'instructor-support-excluded');
  mins([2,'Chapter 1','reading','item'],0,'reading-navigation-chapter');
  mins([2,'Chapter 1 Review','reading','item'],3,'reading-review');
  mins([2,'Concept Section','reading','item'],8,'reading-section');
  mins([2,'LearningCurve Ch 1','learningcurve','item'],10,'learningcurve-quiz');
  mins([2,'Intro Video','mapi','item'],5,'video');
  mins([2,'Practice Quiz','assessment','item'],10,'assessment-quiz');
  mins([2,'DESMOS Dynamic Figure','assessment','item'],15,'assessment-activity');
  mins([2,'Homework','assessment','item'],15,'assessment-activity');
  mins([2,'Rubric.pdf','staticfile','item'],2,'reference-rubric-report');
  mins([2,'External Resource','url','item'],5,'reference-file-url');
  mins([2,'Mystery Tool','mystery','item'],5,'unknown-leaf-default');
}

function CTI_TEST_macmillanSafeMatrix_() {
  var safe = macmillanSafeMatrix_([['Header','=formula'],['Normal','@risk']]);
  CTI_TEST_equal_(safe[0][1], "'=formula", 'Formula-like matrix value must be neutralized');
  CTI_TEST_equal_(safe[1][1], "'@risk", 'Leading @ must be neutralized');
}


// ---------------------------------------------------------------------------
// INTEGRATION: isolated storage, Explore export, and Macmillan Stage 1
// ---------------------------------------------------------------------------
function CTI_TEST_treeChunkStorageIntegration_() {
  var ss = SpreadsheetApp.create('CTI_TEST_tree_chunks_' + new Date().getTime());
  try {
    var uuid = Utilities.getUuid();
    var treeJson = JSON.stringify([{title:'Large Module',type:'folder',children:[],payload:new Array(70000).join('x')}]);
    CTI_TEST_assert_(treeJson.length > TREE_CELL_LIMIT_,'Fixture must exceed inline tree-cell limit');
    var cell = prepareCourseTreeCell_(ss,uuid,treeJson);
    CTI_TEST_assert_(String(cell).indexOf('TREE:') === 0,'Large tree must be chunk-backed');
    CTI_TEST_equal_(resolveCourseTreeJson_(ss,uuid,cell),treeJson,'Chunked tree round trip');
    var store = loadTreeStoreMap_(ss);
    CTI_TEST_assert_(store[String(cell).slice(5)] === treeJson,'Tree store loader reconstructs chunk payload');
    removeTreeCellStorage_(ss,cell);
    var treeSheet = ss.getSheetByName(TREE_STORE_SHEET_NAME);
    CTI_TEST_equal_(treeSheet.getLastRow(),1,'Tree chunks are removed cleanly');
  } finally { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {} }
}

function CTI_TEST_packageSchemaMigrationIntegration_() {
  var ss = SpreadsheetApp.create('CTI_TEST_package_schema_' + new Date().getTime());
  try {
    var sheet = ss.getSheets()[0]; sheet.setName('Packages'); initializePackageSheet_(sheet);
    CTI_TEST_equal_(sheet.getLastColumn(),20,'Packages schema has 20 columns');
    CTI_TEST_assert_(hasPackageHeaders_(sheet) === true,'Packages headers recognized');
    var tree = [{title:'Empty Module',type:'folder',autoDeleted:true,children:[]}];
    var row = CTI_TEST_packageRow_(new Date(),'Partner','Legacy.imscc','',0,'Owner');
    row[12] = JSON.stringify(tree); row[18] = ''; row[19] = '';
    sheet.appendRow(row);
    var added = migratePackageSheetToUuid_(sheet);
    CTI_TEST_equal_(added,1,'Migration assigns missing UUID');
    var migrated = sheet.getRange(2,1,1,20).getValues()[0];
    CTI_TEST_assert_(/^[0-9a-f-]{36}$/i.test(String(migrated[18])),'Migrated UUID shape');
    CTI_TEST_equal_(Number(migrated[19]),1,'Migration derives empty-folder count from stored tree');
  } finally { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {} }
}

function CTI_TEST_catalogMapIntegration_() {
  var ss = SpreadsheetApp.create('CTI_TEST_catalog_map_' + new Date().getTime());
  try {
    updateCatalogMapSheet_(ss,{ abc:{title:'Alpha Course',owner:'Owner A'}, xyz:{title:'Zulu Course',owner:'Owner Z'} });
    var map = loadCatalogMap_(ss);
    CTI_TEST_equal_(map.abc.title,'Alpha Course','Catalog title round trip');
    CTI_TEST_equal_(map.xyz.owner,'Owner Z','Catalog owner round trip');
    CTI_TEST_assert_(ss.getSheetByName('Catalog_Map').isSheetHidden(),'Catalog map remains hidden');
  } finally { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {} }
}

function CTI_TEST_qaEvidenceSheetSchemaIntegration_() {
  var ss = SpreadsheetApp.create('CTI_TEST_qa_schema_' + new Date().getTime());
  try {
    var runs = getQaRunsSheet_(ss), chunks = getQaRunChunksSheet_(ss);
    CTI_TEST_equal_(runs.getLastColumn(),47,'QA_Runs schema width with longitudinal + live-source + generation provenance');
    CTI_TEST_equal_(runs.getRange(1,1).getValue(),'Run ID','QA_Runs first header');
    CTI_TEST_equal_(runs.getRange(1,22).getValue(),'Summary JSON','QA_Runs summary header');
    CTI_TEST_equal_(runs.getRange(1,27).getValue(),'Lineage Generation','QA_Runs generation header');
    CTI_TEST_equal_(runs.getRange(1,28).getValue(),'Snapshot Stage','QA_Runs snapshot-stage header');
    CTI_TEST_equal_(runs.getRange(1,35).getValue(),'Delta JSON','QA_Runs longitudinal delta header');
    CTI_TEST_equal_(runs.getRange(1,36).getValue(),'Generation Provenance','Generation provenance header');
    CTI_TEST_equal_(runs.getRange(1,37).getValue(),'Generation Warning','Generation warning header');
    CTI_TEST_equal_(runs.getRange(1,38).getValue(),'Live Source Platform','Live-source platform provenance header');
    CTI_TEST_equal_(runs.getRange(1,44).getValue(),'Live Source Build','Live-source build provenance header');
    CTI_TEST_equal_(runs.getRange(1,45).getValue(),'Generation SI Provenance JSON','Generation Smart Ingestion provenance header');
    CTI_TEST_equal_(runs.getRange(1,46).getValue(),'Generation SI Provenance Source Run ID','Generation provenance source-run header');
    CTI_TEST_equal_(runs.getRange(1,47).getValue(),'Manual Change Attribution JSON','Manual-change attribution header');
    CTI_TEST_equal_(QA_RUN_SCHEMA_VERSION_,5,'Evidence schema v5');
    var legacy = new Array(35).fill(''); legacy[0]='QA-LEGACY'; legacy[21]='{"observedFidelity":28}'; legacy[26]=0;
    runs.getRange(2,1,1,35).setValues([legacy]);
    runs.getRange(1,36,1,12).clearContent();
    getQaRunsSheet_(ss); getQaRunsSheet_(ss);
    CTI_TEST_equal_(runs.getLastColumn(),47,'legacy to v5 migration is idempotent');
    CTI_TEST_jsonEqual_(runs.getRange(2,1,1,35).getValues()[0],legacy,'Schema migration preserves legacy evidence cells');
    CTI_TEST_equal_(chunks.getLastColumn(),3,'QA chunk schema width');
    CTI_TEST_equal_(chunks.getRange(1,3).getValue(),'Base64 Result Chunk','QA chunk payload header');
  } finally { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {} }
}

function CTI_TEST_duplicateArchiveSchemaIntegration_() {
  var ss = SpreadsheetApp.create('CTI_TEST_duplicate_archive_' + new Date().getTime());
  try {
    var sheet = getDuplicateArchiveSheet_(ss);
    CTI_TEST_equal_(sheet.getLastColumn(),25,'Duplicate archive schema width');
    CTI_TEST_equal_(sheet.getRange(1,21).getValue(),'Archived At','Duplicate archive provenance header');
    CTI_TEST_equal_(sheet.getRange(1,25).getValue(),'Archive Action','Duplicate archive action header');
  } finally { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {} }
}


function CTI_TEST_workStateSheetIntegration_() {
  var ss = SpreadsheetApp.create('CTI TEST - Work State ' + Utilities.getUuid());
  try {
    var sheet = getWorkStateSheet_(ss);
    var headers = sheet.getRange(1,1,1,13).getDisplayValues()[0];
    CTI_TEST_equal_(headers[0],'Work Key','Work state schema first column');
    CTI_TEST_equal_(headers[3],'Scope','Work state scope column');
    CTI_TEST_equal_(headers[4],'Coursera Redo','Work state Coursera column');
    CTI_TEST_equal_(headers[5],'Course Outline','Work state outline column');
    CTI_TEST_equal_(headers[6],'Source Audit','Work state audit column');
    CTI_TEST_equal_(headers[7],'Specialization Outline','Work state specialization column');
    CTI_TEST_equal_(headers[8],'Content Map','Work state content map column');
    CTI_TEST_equal_(headers[12],'Version','Work state optimistic version column');
    CTI_TEST_equal_(sheet.getRange(1,14).getValue(),'Evidence Checklist JSON','Checklist column appended after the original schema');
    var key = 'test|MELT521';
    sheet.getRange(2,1,1,14).setValues([[key,'test','MELT521','ACTIVE','DONE','DRAFT','REVIEW','NOT_STARTED','NOT_STARTED','Preserve notes',new Date(),'test','v1','{"beforeQaSaved":true}']]);
    var state = loadWorkStateMap_(ss,'test')[key];
    CTI_TEST_equal_(state.evidenceChecklist.beforeQaSaved,true,'Native sheet reload retains completed collection step');
    CTI_TEST_equal_(state.evidenceChecklist.afterQaSaved,false,'Native sheet reload defaults only missing steps');
    CTI_TEST_equal_(state.notes,'Preserve notes','Existing notes retained');
    CTI_TEST_equal_(state.sourceAudit,'REVIEW','Existing review decision retained');
  } finally {
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {}
  }
}

function CTI_TEST_scanHistoryIntegration_() {
  var ss = SpreadsheetApp.create('CTI TEST - Scan History ' + Utilities.getUuid());
  try {
    var uuid = Utilities.getUuid();
    var oldMetrics = {ifs:74,totalItems:80,emptyFolders:3,orphans:6,lti:1};
    var newMetrics = {ifs:53,totalItems:89,emptyFolders:0,orphans:2,lti:0};
    var saved = appendPackageScanHistory_(ss,uuid,'RESCAN','WWWT101.imscc',oldMetrics,newMetrics);
    CTI_TEST_equal_(saved.status,'SAVED','Scan history saved');
    var map = loadLatestPackageScanHistoryMap_(ss);
    CTI_TEST_assert_(!!map[uuid],'Latest scan history indexed by UUID');
    CTI_TEST_equal_(map[uuid].action,'RESCAN','Scan history action preserved');
    CTI_TEST_equal_(map[uuid].oldMetrics.ifs,74,'Old IFS preserved');
    CTI_TEST_equal_(map[uuid].newMetrics.ifs,53,'New IFS preserved');
    var headers = ss.getSheetByName(PACKAGE_SCAN_HISTORY_SHEET_NAME).getRange(1,1,1,11).getDisplayValues()[0];
    CTI_TEST_equal_(headers[2],'Package UUID','Scan history UUID column');
    CTI_TEST_equal_(headers[8],'New Metrics JSON','Scan history metrics column');
  } finally {
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {}
  }
}

function CTI_TEST_rawQaMapIntegration_() {
  var ss = SpreadsheetApp.create('CTI TEST - Raw QA Map ' + Utilities.getUuid());
  try {
    var sheet = getQaRunsSheet_(ss);
    var uuid = Utilities.getUuid();
    var oldDate = new Date('2026-09-12T08:00:00Z');
    var newDate = new Date('2026-09-12T09:00:00Z');
    var base = new Array(26).fill('');
    function row(runId, when, fidelity, summary) {
      var r = base.slice();
      r[0]=runId; r[1]=when; r[2]=uuid; r[3]='SINGLE_C0'; r[4]='v6.9.1'; r[6]='v6.7.0'; r[7]='29'; r[9]='COURSE';
      r[19]=fidelity; r[21]=JSON.stringify(summary); r[22]='UNREVIEWED';
      return r;
    }
    sheet.getRange(2,1,2,26).setValues([
      row('QA-OLD',oldDate,88,{observedFidelity:88,evidenceCoverage:90,missing:1}),
      row('QA-NEW',newDate,98,{observedFidelity:98,evidenceCoverage:96,missing:0,mutations:0})
    ]);
    var map = loadLatestRawQaMap_(ss);
    CTI_TEST_assert_(!!map[uuid],'Raw QA map indexes package UUID');
    CTI_TEST_equal_(map[uuid].runId,'QA-NEW','Latest raw QA run wins');
    CTI_TEST_equal_(map[uuid].sourceFidelity,98,'Latest source fidelity preserved');
    CTI_TEST_equal_(map[uuid].summary.evidenceCoverage,96,'Summary JSON is parsed for Work Queue decisions');
  } finally {
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {}
  }
}

function CTI_TEST_qaLineageGenerationIntegration_() {
  var ss = SpreadsheetApp.create('CTI TEST - QA Lineage ' + Utilities.getUuid());
  try {
    var sheet = getQaRunsSheet_(ss), uuid = Utilities.getUuid();
    var row = new Array(35).fill('');
    row[0]='QA-G0'; row[1]=new Date('2026-09-12T08:00:00Z'); row[2]=uuid; row[3]='SINGLE_C0'; row[15]='HASH-A'; row[21]=JSON.stringify({observedFidelity:40,evidenceCoverage:50,missing:10}); row[22]='UNREVIEWED'; row[26]=0; row[27]='RAW_UNPUBLISHED';
    sheet.getRange(2,1,1,35).setValues([row]);
    var same = qaResolveLineage_(uuid,'SINGLE_C0',{snapshotContext:{mode:'RAW_INGESTION'}},{c0ExcelSha256:'HASH-A',lineageRequested:{}},sheet);
    CTI_TEST_equal_(same.generation,0,'Same raw XLSX remains in original generation');
    var next = qaResolveLineage_(uuid,'SINGLE_C0',{snapshotContext:{mode:'RAW_INGESTION'}},{c0ExcelSha256:'HASH-B',lineageRequested:{}},sheet);
    CTI_TEST_equal_(next.generation,0,'Distinct raw XLSX stays in the active import generation');
    CTI_TEST_equal_(next.previousGenerationRunId,'','Repeated export has no reimport delta');
    var explicit = qaResolveLineage_(uuid,'SINGLE_C0',{}, {c0ExcelSha256:'HASH-A',lineageRequested:{generation:'G1'}},sheet);
    CTI_TEST_equal_(explicit.generation,1,'Explicit reimport advances even with identical XLSX');
    CTI_TEST_equal_(explicit.previousGenerationRunId,'QA-G0','Explicit reimport links to previous raw run');
    CTI_TEST_equal_(explicit.generationProvenance,'EXPLICIT_OPERATOR','Operator decision persists as provenance');
    var metrics={observedFidelity:28,evidenceCoverage:49,ingestionFailures:4,missing:0,partial:2,unverified:1,behaviorMutations:0,runtimeReviews:0};
    row[9]='same-course'; row[21]=JSON.stringify(metrics);
    sheet.getRange(2,1,1,35).setValues([row]);
    var repeated=row.slice(); repeated[0]='QA-REPEAT'; repeated[4]='v6.12.0'; repeated[5]='v6.12.0-longitudinal-fidelity-systems-health-20260913';
    repeated[15]='HASH-B'; repeated[26]=1; repeated[32]='QA-G0'; repeated[33]='Reimport generation inferred from a distinct raw XLSX snapshot.';
    var delta=qaBuildLongitudinalDelta_(metrics,metrics,{previousGenerationRunId:'QA-G0',generationLabel:'G1'});
    delta.itemEvolution={fixedOrImproved:0,regressed:0,unchanged:20,addedEvidence:0,removedEvidence:0,changes:[]};
    repeated[34]=JSON.stringify(delta);
    sheet.getRange(3,1,1,35).setValues([repeated]);
    var chunks=getQaRunChunksSheet_(ss);
    chunks.getRange(2,1,1,3).setValues([['QA-REPEAT',0,'original-payload-sentinel']]);
    var beforeChunks=JSON.stringify(chunks.getDataRange().getValues());
    var beforeEvidence=JSON.stringify(sheet.getRange(3,1,1,26).getValues());
    var repair=qaRepairRepeatedExportLineage_(ss,sheet,uuid,'QA-REPEAT');
    CTI_TEST_equal_(repair.generation,0,'Real sheet repairs repeated export to G0');
    CTI_TEST_equal_(sheet.getRange(3,35).getValue(),'','Real sheet removes false reimport delta');
    CTI_TEST_equal_(sheet.getRange(3,36).getValue(),'REPAIRED_REPEAT_EXPORT','Real sheet persists repair provenance');
    CTI_TEST_equal_(JSON.stringify(chunks.getDataRange().getValues()),beforeChunks,'Stored payload chunks are unchanged');
    CTI_TEST_equal_(JSON.stringify(sheet.getRange(3,1,1,26).getValues()),beforeEvidence,'Stored QA evidence is unchanged');
    CTI_TEST_equal_(qaResolveLineage_(uuid,'SINGLE_C0',{}, {},sheet).generation,0,'Post-repair Auto stays G0');
  } finally { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {} }
}

function CTI_TEST_exportManifestIntegration_() {
  var analyzed = analyzeImsccFromXmlString(CTI_TEST_goldenManifestXml_(),'CTI_Golden.imscc','');
  CTI_TEST_assert_(analyzed.success === true,'Export fixture must analyze first');
  var exported = exportMasterManifestAsGoogleSheet(JSON.stringify(analyzed.courseTree),'CTI_Golden.imscc');
  CTI_TEST_assert_(exported.success === true,'Explore Google Sheets export should succeed: ' + (exported.error || ''));
  var match = String(exported.url || '').match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  CTI_TEST_assert_(match && match[1],'Export URL must contain spreadsheet ID');
  try {
    var ss = SpreadsheetApp.openById(match[1]), sheet = ss.getSheetByName('Manifest');
    CTI_TEST_assert_(sheet !== null,'Manifest export tab exists');
    CTI_TEST_equal_(sheet.getRange(1,1).getValue(),'Level','Export Level header');
    CTI_TEST_equal_(sheet.getRange(1,3).getValue(),'Assignment_Tool','Export mapping header');
    var values = sheet.getDataRange().getDisplayValues();
    var flat = values.map(function(r){ return r.join('|'); }).join('\n');
    CTI_TEST_contains_(flat,'Golden Quiz|Assessment','QTI maps to Assessment in Explore export');
    CTI_TEST_contains_(flat,'Golden Discussion|Discussion','Discussion maps correctly');
    CTI_TEST_contains_(flat,'Golden LTI|LTI','LTI maps correctly');
  } finally { try { DriveApp.getFileById(match[1]).setTrashed(true); } catch (e) {} }
}

function CTI_TEST_macmillanStage1Integration_() {
  var rows = [
    ['level','name','node_type','assignment_tool','path'],
    [1,'Welcome to Achieve','container','','Welcome'],
    [2,'Welcome note','item','reading','Welcome > note'],
    [1,'Ch 1: Quantities','container','','Ch 1'],
    [2,'Reasoning About Quantities','item','reading','Ch 1 > Reasoning'],
    [1,'Chapter 2: Numeration','container','','Chapter 2'],
    [2,'Place Value','item','reading','Chapter 2 > Place Value'],
    [3,'Practice','item','assessment','Chapter 2 > Practice']
  ];
  var xlsx = CTI_TEST_rowsToXlsxBase64_(rows,'stage1_fixture.xlsx');
  var result = uploadAndScanMaster(xlsx.base64,'stage1_fixture.xlsx');
  CTI_TEST_assert_(result.success === true,'Stage 1 real XLSX conversion should succeed: ' + (result.error || ''));
  try {
    CTI_TEST_equal_(result.totalRows,7,'Stage 1 data-row count');
    CTI_TEST_equal_(result.totalL1,3,'Stage 1 Level-1 count');
    CTI_TEST_equal_(result.primaryCount,2,'Chapter/Ch anchors selected');
    CTI_TEST_equal_(result.filteredModules[0].name,'Ch 1: Quantities','First instructional anchor');
    CTI_TEST_equal_(result.filteredModules[1].name,'Chapter 2: Numeration','Second instructional anchor');
    CTI_TEST_equal_(result.excludedModules.length,1,'Welcome group excluded from primary anchors');
    CTI_TEST_equal_(result.excludedModules[0].name,'Welcome to Achieve','Excluded Stage 1 group');
    CTI_TEST_equal_(result.totalL2,3,'Level-2 count');
    validateWorkflowFileId_(result.fileId);
  } finally {
    try { CTI_TEST_unregisterWorkflowFileId_(result.fileId); } catch (e) {}
    try { DriveApp.getFileById(result.fileId).setTrashed(true); } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// INTEGRATION: Spreadsheet / Macmillan Stage 3-5 contracts
// ---------------------------------------------------------------------------
function CTI_TEST_createTabIntegration_() {
  var ss = SpreadsheetApp.create('CTI_TEST_createTab_' + new Date().getTime());
  try {
    var sheet = createTab(ss,'Regression',[['A','B'],['x',1],['y',2]]);
    CTI_TEST_equal_(sheet.getName(),'Regression','createTab should return requested sheet');
    var values = sheet.getRange(1,1,3,2).getValues();
    CTI_TEST_equal_(values[1][0],'x','createTab must write body rows');
    CTI_TEST_equal_(values[2][1],2,'createTab must preserve numeric values');
    createTab(ss,'Regression',[['A'],['z']]);
    CTI_TEST_equal_(sheet.getLastRow(),2,'Rewriting a tab must clear stale rows');
  } finally {
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {}
  }
}

function CTI_TEST_macmillanStageContractsIntegration_() {
  // This test intentionally exercises the real qaCompareGptOutput XLSX conversion
  // contract and therefore requires the Advanced Drive API service, just like the
  // production Macmillan workflow.
  var master = SpreadsheetApp.create('CTI_TEST_Macmillan_Master_' + new Date().getTime());
  try {
    var clean = [
      ['Module No.','Module Name','Module Description','Time Estimate','Learning Objectives'],
      [1,'Ch 1: Quantities','',125,''],
      [2,'Ch 2: Numeration','',88,''],
      [3,'Ch 3: Operations','',96,'']
    ];
    var context = [
      ['Module No.','Module Name','Source Level','Node Type','Item Name','Source Tool','Deterministic Minutes','Time Rule','Use for Metadata','Source Path'],
      [1,'Ch 1: Quantities',2,'item','Story Problems','reading',8,'reading-section','YES','Ch 1 > Story Problems'],
      [2,'Ch 2: Numeration',2,'item','Place Value','reading',8,'reading-section','YES','Ch 2 > Place Value'],
      [3,'Ch 3: Operations',2,'item','Whole Number Operations','reading',8,'reading-section','YES','Ch 3 > Operations']
    ];
    createTab(master,'Spec1_Clean',clean);
    createTab(master,'Spec1_Context',context);
    createTab(master,'Spec1_Time_Policy',macmillanTimePolicyRows_());
    createTab(master,'Spec1_Excluded',[['Excluded Module Name'],['Glossary']]);
    registerWorkflowFileId_(master.getId());

    var desc1 = 'This module uses story problems and quantitative relationships to develop reasoning about quantities, representations, and problem-solving approaches grounded in the supplied module context.';
    var desc2 = 'This module develops understanding of numeration systems and place value, using source evidence about representations and reasoning across number bases and positional structures.';
    var desc3 = 'This module develops meaning for whole-number operations and strategies, using source evidence about addition, subtraction, multiplication, division, and number-sense reasoning.';
    var obj1 = '1. Analyze quantities in story problems.\n2. Use representations to explain quantitative relationships.\n3. Apply quantitative reasoning to solve problems.';
    var obj2 = '1. Explain place value.\n2. Represent quantities in numeration systems.\n3. Compare number representations.';
    var obj3 = '1. Explain whole-number operations.\n2. Compare solution strategies.\n3. Apply operation reasoning.';

    var metaRows = [
      ['Module Name','Module Description','Learning Objectives'],
      ['Ch 1: Quantities',desc1,obj1],
      ['Ch 2: Numeration',desc2,obj2],
      ['Ch 3: Operations',desc3,obj3]
    ];
    var metaFile = CTI_TEST_rowsToXlsxBase64_(metaRows,'metadata.xlsx');
    var metaRes = qaCompareGptOutput(metaFile.base64,'metadata.xlsx',master.getId(),'Metadata',1);
    CTI_TEST_assert_(metaRes.success === true, 'Valid Metadata workbook should pass: ' + (metaRes.error || ''));
    CTI_TEST_assert_(master.getSheetByName('Spec1_Metadata_Validated') !== null, 'Validated Metadata snapshot must be persisted');

    var badMetaRows = metaRows.concat([['Glossary','Administrative glossary should not return.','1. Bad.\n2. Bad.']]);
    var badMeta = CTI_TEST_rowsToXlsxBase64_(badMetaRows,'metadata_bad.xlsx');
    var badMetaRes = qaCompareGptOutput(badMeta.base64,'metadata_bad.xlsx',master.getId(),'Metadata',1);
    CTI_TEST_assert_(badMetaRes.success === false, 'Excluded module reappearance must fail Metadata QA');

    var mergedRows = [
      ['Module No.','Module Name','Module Description','Time Estimate','Learning Objectives'],
      [1,'Ch 1: Quantities',desc1,125,obj1],
      [2,'Ch 2: Numeration',desc2,88,obj2],
      [3,'Ch 3: Operations',desc3,96,obj3]
    ];
    var mergedFile = CTI_TEST_rowsToXlsxBase64_(mergedRows,'merged.xlsx');
    var mergedRes = qaCompareGptOutput(mergedFile.base64,'merged.xlsx',master.getId(),'Merged',1);
    CTI_TEST_assert_(mergedRes.success === true, 'Valid Merged workbook should pass: ' + (mergedRes.error || ''));
    CTI_TEST_assert_(master.getSheetByName('Spec1_Merged_Validated') !== null, 'Validated Merged snapshot must be persisted');

    var changedTimeRows = JSON.parse(JSON.stringify(mergedRows)); changedTimeRows[1][3] = 124;
    var changedTimeFile = CTI_TEST_rowsToXlsxBase64_(changedTimeRows,'merged_changed_time.xlsx');
    var changedTimeRes = qaCompareGptOutput(changedTimeFile.base64,'merged_changed_time.xlsx',master.getId(),'Merged',1);
    CTI_TEST_assert_(changedTimeRes.success === false, 'GPT time mutation must fail Merged QA');

    var mapRows = [
      ['Orig. Mod No.','Orig. Mod Name','Orig. Mod Description','Orig. Mod Length','Course No.','Course Title','Mod No. in Course','Mod Name in Course','Mod Length','Remarks'],
      [1,'Ch 1: Quantities',desc1,'2h 5m',1,'Foundations',1,'Ch 1: Quantities','2h 5m',''],
      [2,'Ch 2: Numeration',desc2,'1h 28m',1,'Foundations',2,'Ch 2: Numeration','1h 28m',''],
      [3,'Ch 3: Operations',desc3,'1h 36m',1,'Foundations',3,'Ch 3: Operations','1h 36m','']
    ];
    var mapFile = CTI_TEST_rowsToXlsxBase64_(mapRows,'content_map.xlsx');
    var mapRes = qaCompareGptOutput(mapFile.base64,'content_map.xlsx',master.getId(),'ContentMap',1);
    CTI_TEST_assert_(mapRes.success === true, 'Valid Content Map should pass: ' + (mapRes.error || ''));
    CTI_TEST_equal_(mapRes.metrics.totalMinutes,309,'Content Map exact-minute conservation');
    CTI_TEST_equal_(mapRes.metrics.courseCount,1,'Synthetic map course count');
    CTI_TEST_assert_(mapRes.metrics.partnerDocument && mapRes.metrics.partnerDocument.moduleCount === 3, 'Partner-ready projection data must be generated only after QA passes');
    CTI_TEST_assert_(master.getSheetByName('Spec1_ContentMap_Validated') !== null, 'Validated Content Map snapshot must be persisted');

    var badMapRows = JSON.parse(JSON.stringify(mapRows)); badMapRows[1][3] = '2h';
    var badMap = CTI_TEST_rowsToXlsxBase64_(badMapRows,'content_map_bad_time.xlsx');
    var badMapRes = qaCompareGptOutput(badMap.base64,'content_map_bad_time.xlsx',master.getId(),'ContentMap',1);
    CTI_TEST_assert_(badMapRes.success === false, 'Rounded/changed Content Map duration must fail exact-minute contract');

    var reorderedRows = [mapRows[0],mapRows[2],mapRows[1],mapRows[3]];
    var reordered = CTI_TEST_rowsToXlsxBase64_(reorderedRows,'content_map_reordered.xlsx');
    var reorderedRes = qaCompareGptOutput(reordered.base64,'content_map_reordered.xlsx',master.getId(),'ContentMap',1);
    CTI_TEST_assert_(reorderedRes.success === false, 'Source module reorder must fail Content Map QA');
  } finally {
    try { CTI_TEST_unregisterWorkflowFileId_(master.getId()); } catch (e) {}
    try { DriveApp.getFileById(master.getId()).setTrashed(true); } catch (e) {}
  }
}

function CTI_TEST_rowsToXlsxBase64_(rows, fileName) {
  var ss = SpreadsheetApp.create('CTI_TEST_XLSX_' + new Date().getTime() + '_' + Math.floor(Math.random()*100000));
  try {
    var sheet = ss.getSheets()[0]; sheet.setName('export');
    sheet.getRange(1,1,rows.length,rows[0].length).setValues(rows);
    SpreadsheetApp.flush();
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
    var response = UrlFetchApp.fetch(url,{method:'get',headers:{Authorization:'Bearer ' + ScriptApp.getOAuthToken()},muteHttpExceptions:true});
    var status = response.getResponseCode();
    if (status < 200 || status >= 300) throw new Error('Fixture XLSX export failed with HTTP ' + status + '.');
    return { base64:Utilities.base64Encode(response.getBlob().getBytes()), fileName:fileName || 'fixture.xlsx' };
  } finally {
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {}
  }
}


// ---------------------------------------------------------------------------
// FULL GOLDEN: real Sowder 33-module deterministic fixture
// ---------------------------------------------------------------------------
// This compressed fixture is a projection of the actual Sowder master workbook's
// export sheet, retaining exactly the five columns consumed by Stage 2:
// level, name, node_type, assignment_tool, path.
// It preserves all 957 source rows and therefore all original Excel row anchors.
// The fixture is data only; production logic remains in Code.gs.
var CTI_TEST_SOWDER_EXPORT_GZIP_B64_ =
    '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' +
    '44sDAA==';

function CTI_TEST_sowderFixtureRows_() {
  var compressed = Utilities.newBlob(
    Utilities.base64Decode(CTI_TEST_SOWDER_EXPORT_GZIP_B64_),
    'application/gzip',
    'CTI_Sowder_export.json.gz'
  );
  var text = Utilities.ungzip(compressed).getDataAsString('UTF-8');
  var rows = JSON.parse(text);
  CTI_TEST_equal_(rows.length, 958, 'Sowder fixture must retain header + 957 source rows');
  CTI_TEST_equal_(rows[0].join('|'), 'level|name|node_type|assignment_tool|path', 'Sowder fixture header contract');
  return rows;
}

function CTI_TEST_formatDuration_(minutes) {
  minutes = Number(minutes || 0);
  var h = Math.floor(minutes / 60), m = minutes % 60;
  if (h && m) return h + 'h ' + m + 'm';
  if (h) return h + 'h';
  return m + 'm';
}

function CTI_TEST_sowderMetadataText_(moduleName) {
  return 'Regression fixture metadata for ' + moduleName + '. This deterministic description exists only to exercise CTI source identity, coverage, ordering, lineage, and validation contracts across the complete 33-module Sowder specialization; it is not partner-facing instructional copy.';
}

function CTI_TEST_sowderObjectives_(moduleName) {
  return '1. Preserve the validated source identity for ' + moduleName + '.\n' +
         '2. Preserve deterministic CTI learner-time lineage without recalculation.\n' +
         '3. Preserve module order and one-to-one coverage through the regression pipeline.';
}

function CTI_TEST_sowderFullGoldenIntegration_() {
  var ss = SpreadsheetApp.create('CTI_TEST_Sowder_Full_Golden_' + new Date().getTime());
  try {
    // Build the source fixture without using createTab(), so Stage 2 itself is what
    // exercises the production createTab dependency.
    var rows = CTI_TEST_sowderFixtureRows_();
    var exportSheet = ss.getSheets()[0];
    exportSheet.setName('export');
    exportSheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    SpreadsheetApp.flush();
    registerWorkflowFileId_(ss.getId());

    // The actual Sowder Ch 1 anchor is Excel row 277.
    var anchors = [277];
    var specNames = ['Specialization_1'];

    // Dry-run triage must recover the known twelve non-instructional top-level groups.
    var triage = executeDynamicNSplitAndScan(ss.getId(), anchors, specNames, 'Macmillan Learning', null, 'macmillan');
    CTI_TEST_assert_(triage && triage.success === true && triage.isTriage === true, 'Sowder dry-run triage should succeed.');
    CTI_TEST_equal_(triage.triageData.length, 1, 'Sowder should produce one specialization triage group');
    var expectedExcluded = [
      'Welcome to Achieve',
      'Goal-setting and Reflection Surveys',
      'Beta: Writing-to-Learn Activities',
      "What's in Your Achieve Course? - Resource and Assignment Guide",
      'Instructor Resources',
      'Instructor Active Learning Guides',
      'Data Sets for Part IV (.zip)',
      'Front Matter',
      'Selected Answers for Learning Exercises',
      'Appendices',
      'Glossary',
      'Index'
    ];
    CTI_TEST_equal_(triage.triageData[0].items.length, expectedExcluded.length, 'Sowder triage count');
    CTI_TEST_equal_(triage.triageData[0].items.join('|'), expectedExcluded.join('|'), 'Sowder triage lineage/order');

    // Approve none of the gray/non-instructional groups: only Ch 1–33 remain.
    var split = executeDynamicNSplitAndScan(ss.getId(), anchors, specNames, 'Macmillan Learning', [], 'macmillan');
    CTI_TEST_assert_(split && split.success === true && split.isTriage === false, 'Sowder full Stage 2 split should succeed: ' + (split && split.error || ''));
    CTI_TEST_equal_(split.numSpecs, 1, 'Sowder specialization count');
    CTI_TEST_equal_(split.totalMasterDataRows, 957, 'Sowder source row count');
    CTI_TEST_equal_(split.specResults.length, 1, 'Sowder result count');

    var sr = split.specResults[0];
    CTI_TEST_equal_(sr.totalFileRows, 33, 'Sowder instructional module count');
    CTI_TEST_equal_(sr.contextRows, 599, 'Sowder Module Context row count');
    CTI_TEST_equal_(sr.totalEstimatedMinutes, 3405, 'Sowder deterministic minute total');
    CTI_TEST_equal_(sr.timeModelVersion, 'm2-leaf-evidence-20260911', 'Sowder time model version');
    CTI_TEST_equal_(sr.fallbackItemCount, 0, 'Sowder unknown fallback count');
    CTI_TEST_equal_(sr.excludedModules.join('|'), expectedExcluded.join('|'), 'Sowder explicit exclusions');
    CTI_TEST_equal_(Number(sr.timeRuleCounts.container || 0), 147, 'Sowder container count');
    CTI_TEST_equal_(Number(sr.timeRuleCounts['reading-navigation-chapter'] || 0), 33, 'Sowder chapter-navigation zero-time count');
    CTI_TEST_equal_(Number(sr.timeRuleCounts['reading-navigation-part'] || 0), 4, 'Sowder part-navigation zero-time count');
    CTI_TEST_equal_(Number(sr.timeRuleCounts['unknown-leaf-default'] || 0), 0, 'Sowder unknown-leaf time-rule count');

    var cleanSheet = ss.getSheetByName('Spec1_Clean');
    var contextSheet = ss.getSheetByName('Spec1_Context');
    var policySheet = ss.getSheetByName('Spec1_Time_Policy');
    var excludedSheet = ss.getSheetByName('Spec1_Excluded');
    CTI_TEST_assert_(cleanSheet && contextSheet && policySheet && excludedSheet, 'Stage 2 must create Clean, Context, Time Policy, and Excluded tabs.');

    var clean = cleanSheet.getDataRange().getValues();
    var context = contextSheet.getDataRange().getValues();
    var policy = policySheet.getDataRange().getValues();
    var excluded = excludedSheet.getDataRange().getValues();
    CTI_TEST_equal_(clean.length, 34, 'Sowder Clean tab rows');
    CTI_TEST_equal_(context.length, 600, 'Sowder Context tab rows including header');
    CTI_TEST_equal_(excluded.length, 13, 'Sowder Excluded tab rows including header');
    CTI_TEST_equal_(String(policy[0][1]), 'm2-leaf-evidence-20260911', 'Time Policy workbook version');

    var contributing = 0, zeroMinute = 0, fallbackRows = 0;
    for (var cx = 1; cx < context.length; cx++) {
      var mins = Number(context[cx][6] || 0), rule = String(context[cx][7] || '');
      if (mins > 0) contributing++; else zeroMinute++;
      if (rule === 'unknown-leaf-default') fallbackRows++;
      if (rule === 'container' || rule.indexOf('reading-navigation-') === 0) CTI_TEST_equal_(mins, 0, 'Structural/navigation evidence must remain zero-minute at context row ' + (cx + 1));
    }
    CTI_TEST_equal_(contributing, 415, 'Sowder time-contributing evidence rows');
    CTI_TEST_equal_(zeroMinute, 184, 'Sowder zero-minute structural/navigation evidence rows');
    CTI_TEST_equal_(fallbackRows, 0, 'Sowder fallback evidence rows');

    var spot = {1:125, 2:88, 3:96, 6:138, 15:146, 16:208, 23:123, 33:102};
    var total = 0;
    for (var cr = 1; cr < clean.length; cr++) {
      var modNo = Number(clean[cr][0]), mins = Number(clean[cr][3] || 0);
      total += mins;
      if (Object.prototype.hasOwnProperty.call(spot, modNo)) CTI_TEST_equal_(mins, spot[modNo], 'Sowder Ch ' + modNo + ' time');
    }
    CTI_TEST_equal_(total, 3405, 'Sowder Clean tab exact-time conservation');

    // Stage 3: validate metadata across all 33 modules.
    var metaRows = [['Module Name','Module Description','Learning Objectives']];
    for (var mi = 1; mi < clean.length; mi++) {
      var moduleName = String(clean[mi][1]);
      metaRows.push([moduleName, CTI_TEST_sowderMetadataText_(moduleName), CTI_TEST_sowderObjectives_(moduleName)]);
    }
    var metaFile = CTI_TEST_rowsToXlsxBase64_(metaRows, 'sowder_full_metadata.xlsx');
    var metaRes = qaCompareGptOutput(metaFile.base64, 'sowder_full_metadata.xlsx', ss.getId(), 'Metadata', 1);
    CTI_TEST_assert_(metaRes.success === true, 'Full Sowder Metadata QA should pass: ' + (metaRes.error || ''));
    CTI_TEST_equal_(metaRes.expectedCount, 33, 'Full Sowder Metadata expected count');
    CTI_TEST_equal_(metaRes.foundCount, 33, 'Full Sowder Metadata found count');
    CTI_TEST_equal_(Number(metaRes.metrics.contextEvidenceRows || 0), 599, 'Full Sowder Metadata evidence-row availability');

    // Stage 4: merge text while preserving authoritative identity, order and minutes.
    var mergedRows = [['Module No.','Module Name','Module Description','Time Estimate','Learning Objectives']];
    for (var mj = 1; mj < clean.length; mj++) {
      var mn = String(clean[mj][1]);
      mergedRows.push([Number(clean[mj][0]), mn, CTI_TEST_sowderMetadataText_(mn), Number(clean[mj][3]), CTI_TEST_sowderObjectives_(mn)]);
    }
    var mergedFile = CTI_TEST_rowsToXlsxBase64_(mergedRows, 'sowder_full_merged.xlsx');
    var mergedRes = qaCompareGptOutput(mergedFile.base64, 'sowder_full_merged.xlsx', ss.getId(), 'Merged', 1);
    CTI_TEST_assert_(mergedRes.success === true, 'Full Sowder Merged QA should pass: ' + (mergedRes.error || ''));

    // Stage 5: use the known six-course grouping from the accepted Sowder map.
    var courseSizes = [5,6,4,7,5,6];
    var courseTitles = [
      'Number Sense and Whole-Number Operations',
      'Fractions, Ratios, and Number Systems',
      'Algebra, Functions, and Graphing',
      'Geometry: Shapes, Symmetry, and Transformations',
      'Measurement: Length, Area, Volume, and Rate',
      'Data, Probability, and Statistical Reasoning'
    ];
    var expectedCourseMinutes = [464,625,483,793,446,594];
    var mapRows = [['Orig. Mod No.','Orig. Mod Name','Orig. Mod Description','Orig. Mod Length','Course No.','Course Title','Mod No. in Course','Mod Name in Course','Mod Length','Remarks']];
    var moduleCursor = 1;
    for (var courseIndex = 0; courseIndex < courseSizes.length; courseIndex++) {
      for (var within = 1; within <= courseSizes[courseIndex]; within++) {
        var sourceRow = clean[moduleCursor], sName = String(sourceRow[1]), sMinutes = Number(sourceRow[3]);
        var duration = CTI_TEST_formatDuration_(sMinutes);
        mapRows.push([
          Number(sourceRow[0]), sName, CTI_TEST_sowderMetadataText_(sName), duration,
          courseIndex + 1, courseTitles[courseIndex], within, sName, duration, ''
        ]);
        moduleCursor++;
      }
    }
    CTI_TEST_equal_(moduleCursor, 34, 'All 33 Sowder modules must be mapped exactly once');

    var mapFile = CTI_TEST_rowsToXlsxBase64_(mapRows, 'sowder_full_content_map.xlsx');
    var mapRes = qaCompareGptOutput(mapFile.base64, 'sowder_full_content_map.xlsx', ss.getId(), 'ContentMap', 1);
    CTI_TEST_assert_(mapRes.success === true, 'Full Sowder Content Map QA should pass: ' + (mapRes.error || ''));
    CTI_TEST_equal_(mapRes.metrics.contractStatus, 'PASS', 'Full Sowder Content Map deterministic contract status');
    CTI_TEST_equal_(mapRes.metrics.ctiVerdict, 'PASS_WITH_REVIEW', 'Full Sowder Content Map advisory verdict');
    CTI_TEST_equal_(mapRes.metrics.totalMinutes, 3405, 'Full Sowder Content Map exact-minute total');
    CTI_TEST_equal_(mapRes.metrics.courseCount, 6, 'Full Sowder Content Map course count');
    CTI_TEST_assert_(mapRes.metrics.partnerDocument && mapRes.metrics.partnerDocument.moduleCount === 33, 'Partner-ready projection must contain all 33 modules');
    CTI_TEST_equal_(mapRes.metrics.partnerDocument.totalMinutes, 3405, 'Partner-ready projection exact-minute total');
    CTI_TEST_equal_(mapRes.metrics.courseBreakdown.length, 6, 'Sowder course breakdown length');
    for (var bi = 0; bi < 6; bi++) {
      CTI_TEST_equal_(mapRes.metrics.courseBreakdown[bi].modules, courseSizes[bi], 'Sowder Course ' + (bi + 1) + ' module count');
      CTI_TEST_equal_(mapRes.metrics.courseBreakdown[bi].minutes, expectedCourseMinutes[bi], 'Sowder Course ' + (bi + 1) + ' time');
      CTI_TEST_equal_(mapRes.metrics.courseBreakdown[bi].title, courseTitles[bi], 'Sowder Course ' + (bi + 1) + ' title');
    }

    // Export path must still include all evidence sheets.
    var exportRes = exportSpecAsXlsxBlob(ss.getId(), 1);
    CTI_TEST_assert_(exportRes && exportRes.success === true && String(exportRes.base64 || '').length > 1000, 'Full Sowder evidence XLSX export should succeed.');
  } finally {
    try { CTI_TEST_unregisterWorkflowFileId_(ss.getId()); } catch (e) {}
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {}
  }
}


function CTI_TEST_globalMatchReservation_() {
  var source = [
    {name:'Innate Immune System',type:'Reading',path:'Module 2'},
    {name:'Unit Quiz 2: Innate Immune System',type:'Assessment',path:'Module 2'},
    {name:'Adaptive Immune System',type:'Reading',path:'Module 3'},
    {name:'Unit Quiz 3: Adaptive Immune System',type:'Assessment',path:'Module 3'}
  ];
  var dest = [
    {name:'Unit Quiz 2: Innate Immune System',type:'Assignment',path:'Module 2'},
    {name:'Innate Immune System',type:'Assignment',path:'Module 2'},
    {name:'Unit Quiz 3: Adaptive Immune System',type:'Assignment',path:'Module 3'},
    {name:'Adaptive Immune System',type:'Assignment',path:'Module 3'}
  ];
  var plan = qaBuildGlobalMatchPlan_(source,dest);
  CTI_TEST_equal_(plan[1].courseraIndex,0,'Exact Unit Quiz 2 title is reserved for source Unit Quiz 2');
  CTI_TEST_equal_(plan[3].courseraIndex,2,'Exact Unit Quiz 3 title is reserved for source Unit Quiz 3');
  CTI_TEST_equal_(plan[1].method,'EXACT_TITLE_RESERVED','Quiz exact match uses reservation method');

  var errorPlan = qaBuildGlobalMatchPlan_(
    [{id:'s3',name:'Performance Management',type:'Reading',path:'Module 1'}],
    [{id:'c3',name:'[ERROR DURING DISTILLATION] Performance Management',type:'Reading',path:'Module 1'}]
  );
  CTI_TEST_equal_(errorPlan[0].method,'EXACT_TITLE_RESERVED','Known distillation wrapper does not erase exact source-title identity');
}

function CTI_TEST_ingestionFailureSentinel_() {
  var failure = qaNormalizeIngestionFailure_(null,'[ERROR DURING DISTILLATION] Performance Management','Raw content for the item: x-coursera-resource-type');
  CTI_TEST_assert_(failure.detected === true,'Distillation sentinel detected');
  CTI_TEST_assert_(failure.codes.indexOf('DISTILLATION_ERROR') > -1,'Distillation code emitted');
  var source = {id:'s',name:'Performance Management',type:'Reading',path:'Module 1',assetDetails:[],links:[],textSample:'Real learner content that should survive ingestion and remain usable.',textLength:70,contentComparable:true};
  var dest = {id:'c',name:'[ERROR DURING DISTILLATION] Performance Management',type:'Reading',path:'Module 1',assetDetails:[],links:[],textSample:'Raw content for the item: x-coursera-structure-node-id x-coursera-resource-type x-coursera-associated-content-files',textLength:120,ingestionFailure:failure,evidenceSources:[]};
  var result = compareItemFidelity_(source,dest,0.99,[dest],{mode:'RAW_INGESTION'},{});
  CTI_TEST_equal_(result.verdict,'INGESTION_FAILURE','Explicit failure bypasses ordinary PARTIAL text scoring');
  var op = workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',[result],[],{detected:false});
  CTI_TEST_equal_(op.recommendationCode,'REINGEST','Learner-facing explicit ingestion failure forces re-ingest');
}

function CTI_TEST_rawMetadataFailure_() {
  var failure = qaNormalizeIngestionFailure_(null,'Feedback and Difficult Conversations Course Content','Raw content for the item: x-coursera-structure-node-id abc x-coursera-resource-type webcontent x-coursera-file-path content/foo');
  CTI_TEST_assert_(failure.detected === true,'Rendered raw metadata detected');
  CTI_TEST_assert_(failure.codes.indexOf('RAW_METADATA_RENDERED') > -1,'Raw metadata code emitted');
}

function CTI_TEST_hiddenAttachmentProxy_() {
  var src = normalizeSourceItem_({id:'h',name:'Hidden Plugin (Rounding Practice.docx)',type:'Plugin',sourceTypeRaw:'plugin',path:'Module 3',parentSourceName:'Rounding Practice.docx',sourceFiles:[],sourceLinks:[],sourceImages:[],sourceEmbeddedRefs:[]});
  CTI_TEST_equal_(src.hiddenDependency.kind,'ATTACHMENT_PROXY','Same-named hidden document child classified as attachment proxy');
  var result = qaBuildHiddenDependencyResult_(src,[],{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(result.verdict,'DEPENDENCY_PROXY','Attachment proxy is informational rather than MISSING');
  var op = workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',[result],[],{detected:false});
  CTI_TEST_assert_(op.recommendationCode !== 'REINGEST','Attachment proxy alone must not force re-ingest');
}

function CTI_TEST_hiddenMediaDependency_() {
  var src = normalizeSourceItem_({id:'h',name:'Hidden Plugin (2.1 the five practices.jpg)',type:'Plugin',sourceTypeRaw:'plugin',path:'Student Resources: Remote On-Demand Delivery',parentSourceName:'Feedback and Difficult Conversations Course Content',sourceFiles:[],sourceLinks:[],sourceImages:[],sourceEmbeddedRefs:[]});
  CTI_TEST_equal_(src.hiddenDependency.kind,'EMBEDDED_MEDIA_DEPENDENCY','Hidden JPG child classified as embedded media dependency');
  var result = qaBuildHiddenDependencyResult_(src,[],{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(result.verdict,'HIDDEN_DEPENDENCY_REVIEW','Unrecovered hidden media is review-first');
  var partner = 'Northern Alberta Institute of Technology';
  var op = workBuildRawQaOperationalPolicy_(partner,[result],[],{detected:false});
  CTI_TEST_equal_(op.recommendationCode,'REVIEW','Hidden media dependency alone must not force re-ingest');

  var exempt = workBuildRawQaOperationalPolicy_(partner,[{sourceName:'Hidden Plugin (guide.jpg)',sourcePath:'Instructor Resources > Guide',verdict:'HIDDEN_DEPENDENCY_REVIEW',earnedPoints:0,possiblePoints:0,evidenceCoverage:40,issues:['HIDDEN_DEPENDENCY_UNVERIFIED'],hiddenDependency:{kind:'EMBEDDED_MEDIA_DEPENDENCY'}}],[],{detected:false});
  CTI_TEST_equal_(exempt.hiddenDependencyReviews,0,'Hidden dependency under NAIT Instructor Resources is policy-exempt');
  CTI_TEST_equal_(exempt.policyExemptSourceItems,1,'Policy-exempt hidden dependency remains visible in exempt counts');
  CTI_TEST_assert_(exempt.recommendationCode !== 'REINGEST','Policy-exempt hidden dependency never forces re-ingest');
}

function CTI_TEST_behaviorUnknownBlocksKeep_() {
  var res = qaBehaviorComparison_({type:'Assignment',behavior:null},{nativeAssignment:{submission:{textSubmission:true},settings:{attempts:'unlimited'}}});
  CTI_TEST_equal_(res.status,'UNVERIFIED','Missing portable source assignment behavior must remain unverified');
  CTI_TEST_assert_(res.reviewRequired === true,'Unverifiable assignment behavior requires review');
  CTI_TEST_assert_((res.issues || []).indexOf('BEHAVIOR_SOURCE_UNVERIFIED') > -1,'Behavior-source uncertainty issue is explicit');
  var policy = workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',[{sourceName:'Assignment A',sourcePath:'Module 1',verdict:'UNVERIFIED',earnedPoints:95,possiblePoints:100,evidenceCoverage:95,issues:['BEHAVIOR_UNVERIFIED']}],[]);
  CTI_TEST_equal_(policy.recommendationCode,'REVIEW','Unverifiable learner assignment behavior blocks KEEP');
  CTI_TEST_equal_(policy.learnerFacingBehaviorUnverified,1,'Behavior verification gap is counted explicitly');
}

function CTI_TEST_externalRuntimePolicy_() {
  var out = qaApplyExternalRuntimePolicy_({recommendationCode:'KEEP',recommendationLabel:'KEEP',recommendationReason:'clean'}, {required:true,riseCount:5,storylineCount:0});
  CTI_TEST_equal_(out.recommendationCode,'REVIEW','External runtime inventory must block automatic KEEP');
  CTI_TEST_equal_(out.externalRuntimePackageCount,5,'External runtime package count');
}

function CTI_TEST_analyticsSemantics_() {
  var risk = computeRiskMetrics_(1,0,0,0,0,0,0);
  CTI_TEST_equal_(risk.ifs,0.5,'Legacy IFS workload points remain stable');
  CTI_TEST_equal_(risk.ifsVersion,'IFS-v1-workload','IFS is explicitly versioned as a workload index');
  CTI_TEST_equal_(risk.ifsPerItem,0.5,'IFS density is exposed separately');
  var a = vectorizeCourse({webcontent:10,quizzes:2,discussions:1,weblinks:2,lti:0,empty:0,unknown:0,orphans:1,interactiveRuntimeCandidates:0,totalItems:15});
  var b = vectorizeCourse({webcontent:10,quizzes:2,discussions:1,weblinks:2,lti:0,empty:0,unknown:0,orphans:1,interactiveRuntimeCandidates:0,totalItems:15});
  CTI_TEST_equal_(a.length,10,'Structural profile vector has 10 dimensions');
  CTI_TEST_assert_(Math.abs(calculateCosineSimilarity(a,b)-1) < 1e-9,'Identical structural profiles have cosine similarity 1');
}

function CTI_TEST_lineageHelpers_() {
  CTI_TEST_lineageIdentityAndRepair_();
  CTI_TEST_equal_(qaNormalizeRequestedGeneration_('G2'),2,'Generation override parser');
  CTI_TEST_equal_(qaNormalizeRequestedGeneration_('auto'),null,'Auto generation remains inferable');
  CTI_TEST_equal_(qaSnapshotStageFromResult_('SINGLE_C0',{},'AUTO'),'RAW_UNPUBLISHED','Raw snapshot stage');
  CTI_TEST_equal_(qaSnapshotStageFromResult_('SINGLE_C1',{snapshotContext:{publicationObservedCount:10,publishedCount:10,unpublishedCount:0}},'AUTO'),'PUBLISHED','Published snapshot auto-detection');
}

function CTI_TEST_itemEvolutionDelta_() {
  var d = qaItemEvolutionDelta_([
    {sourceId:'a',sourceName:'A',sourcePath:'M1',verdict:'INGESTION_FAILURE',issues:['INGESTION_FAILURE']},
    {sourceId:'b',sourceName:'B',sourcePath:'M1',verdict:'VERIFIED',issues:[]}
  ],[
    {sourceId:'a',sourceName:'A',sourcePath:'M1',verdict:'VERIFIED',issues:[]},
    {sourceId:'b',sourceName:'B',sourcePath:'M1',verdict:'PARTIAL',issues:['CONTENT_DRIFT']}
  ]);
  CTI_TEST_equal_(d.fixedOrImproved,1,'Reimport delta counts fixed item');
  CTI_TEST_equal_(d.regressed,1,'Reimport delta counts regression');
  CTI_TEST_equal_(d.changes.length,2,'Changed items are retained for evidence timeline');
}

function CTI_TEST_behaviorMutation_() {
  var source = {behavior:{observed:true,submission:{fileUpload:true},settings:{},evidence:['file submission']}};
  var dest = {nativeAssignment:{submission:{fileUpload:false,textSubmission:true,aiGraded:true},settings:{},parserConfidence:0.95}};
  var check = qaBehaviorComparison_(source,dest);
  CTI_TEST_equal_(check.status,'MUTATED','File-upload to AI/text submission mutation is detected');
  CTI_TEST_assert_(check.mismatches.indexOf('FILE_UPLOAD_REPLACED') > -1,'Submission-mode mismatch code emitted');
}

function CTI_TEST_emptyDestinationFailure_() {
  var source = []; for (var i=0;i<12;i++) source.push({name:'Source '+i});
  var dest = [{name:'Author Alignment Report — For Author\'s Eyes Only',path:'[DELETE ME] Author Alignment Report',type:'Reading'}];
  var failure = qaCourseLevelFailure_(source,dest);
  CTI_TEST_assert_(failure.detected === true,'Substantial source with only admin destination is catastrophic');
  CTI_TEST_equal_(failure.code,'EMPTY_DESTINATION_AFTER_INGESTION','Empty-destination code');
  var op = workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',[],dest,failure);
  CTI_TEST_equal_(op.recommendationCode,'REINGEST','Course-level empty destination forces re-ingest');

  var exemptOnly = []; for (var j=0;j<6;j++) exemptOnly.push({name:'Instructor '+j,sourcePath:'Instructor Resources',type:'Reading'});
  var noFalseFailure = qaCourseLevelFailure_(exemptOnly,[],'Northern Alberta Institute of Technology');
  CTI_TEST_assert_(noFalseFailure.detected === false,'NAIT policy-exempt-only source does not create a catastrophic empty-destination redo blocker');
}

function CTI_TEST_questionPoolBehavior_() {
  var source = {isStructuredAssessment:true,structuredAssessment:{schemaVersion:3,parser:'ims-qti-dom-v2-semantic-options',origin:'source-imscc',selectionPolicy:{observed:true,selectCount:15,poolSize:34,randomSelection:true,source:'IMS_QTI_SELECTION_RULE'},questions:[{id:'1',type:'single-select',prompt:'Question alpha',options:[{id:'a',text:'A'},{id:'b',text:'B'}],correctAnswers:['A'],parserConfidence:0.95}],parserConfidence:0.95}};
  var dest = {structuredAssessment:{schemaVersion:1,parser:'coursera-editor-dom-v2',origin:'coursera-authoring-editor',selectionPolicy:{observed:true,selectCount:15,poolSize:34,randomSelection:true,source:'VISIBLE_AUTHORING_TEXT'},questions:[{id:'1',type:'single-select',prompt:'Question alpha',options:[{id:'a',text:'A'},{id:'b',text:'B'}],correctAnswers:['A'],parserConfidence:0.95}],parserConfidence:0.95}};
  var check = qaStructuredAssessmentComparison_(source,dest);
  CTI_TEST_equal_(check.selectionPolicyStatus,'VERIFIED','Matching 15-of-34 question-pool behavior is verified');
  dest.structuredAssessment.selectionPolicy.selectCount=34; dest.structuredAssessment.selectionPolicy.randomSelection=false;
  var changed = qaStructuredAssessmentComparison_(source,dest);
  CTI_TEST_equal_(changed.selectionPolicyStatus,'MUTATED','Changed pool-selection behavior is detected');
  CTI_TEST_equal_(changed.status,'CHANGED','Question-pool behavior mutation contributes a changed assessment verdict');
}


function CTI_TEST_semanticPackageIdentity_() {
  var a = packageSemanticKey_('BORL113.imscc');
  CTI_TEST_equal_(packageSemanticKey_('BORL113 (1).imscc'),a,'Browser duplicate suffix collapses to BORL113 identity');
  CTI_TEST_equal_(packageSemanticKey_('BORL113 DEV (NCE).imscc'),a,'DEV NCE suffix collapses to BORL113 identity');
  CTI_TEST_equal_(packageSemanticKey_('BORL113 - DEV (NCE).imscc'),a,'Hyphenated DEV NCE suffix collapses to BORL113 identity');
  var h = new Array(20); for (var i=0;i<h.length;i++) h[i]='H'+i;
  var r1=CTI_TEST_packageRow_(new Date(1000),'NAIT','BORL113.imscc','123e4567-e89b-42d3-a456-426614174101',0,'Owner A');
  var r2=CTI_TEST_packageRow_(new Date(2000),'NAIT','BORL113 (1).imscc','123e4567-e89b-42d3-a456-426614174102',1,'Owner A');
  var plan=buildDuplicatePlan_([h,r1,r2]);
  CTI_TEST_equal_(plan.groups.length,1,'Semantic BORL duplicate is surfaced by Review Duplicates backend');
}

function CTI_TEST_conversionPlaceholderFailure_() {
  var text='There was an error when converting this discussion prompt. Please add content to complete this item.';
  var failure=qaNormalizeIngestionFailure_(null,'New Discussion Prompt',text);
  CTI_TEST_assert_(failure.detected === true,'Coursera conversion placeholder detected');
  CTI_TEST_assert_(failure.codes.indexOf('CONVERSION_ERROR_PLACEHOLDER') > -1,'Conversion placeholder failure code emitted');
}

function CTI_TEST_brokenExtraReingest_() {
  var broken={name:'New Discussion Prompt',path:'Module 1',type:'Discussion',textSample:'There was an error when converting this discussion prompt. Please add content to complete this item.'};
  var cls=qaClassifyExtraItem_(broken);
  CTI_TEST_equal_(cls.classification,'INGESTION_FAILURE_EXTRA','Unmatched broken Coursera item gets first-class ingestion-failure classification');
  var extra=Object.assign({},broken,cls);
  var op=workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',[],[extra],{detected:false});
  CTI_TEST_equal_(op.learnerFacingExtraIngestionFailures,1,'Learner-facing broken extra counted');
  CTI_TEST_equal_(op.recommendationCode,'REINGEST','Broken unmatched destination item forces re-ingest');
}

function CTI_TEST_practiceRuntimeDependency_() {
  var dep=qaHiddenDependencyKind_({name:'Hidden Plugin (config-1740758793879.practice.json)',sourceTypeRaw:'plugin',parentSourceName:'Lesson 1: Revegetation and Seedling Requirements'});
  CTI_TEST_equal_(dep.kind,'INTERACTIVE_RUNTIME_DEPENDENCY','.practice.json child is interactive runtime dependency');
  var src=normalizeSourceItem_({id:'p',name:'Hidden Plugin (config-1740758793879.practice.json)',type:'Plugin',sourceTypeRaw:'plugin',path:'Module 1',parentSourceName:'Lesson 1: Revegetation and Seedling Requirements',sourceFiles:[],sourceLinks:[],sourceImages:[],sourceEmbeddedRefs:[]});
  var result=qaBuildHiddenDependencyResult_(src,[],{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(result.verdict,'HIDDEN_DEPENDENCY_REVIEW','Unrecovered practice config is review-first, not standalone MISSING');
}

function CTI_TEST_sourceRuntimeReview_() {
  var source={id:'s',name:'Lesson 1: 360 Activity',type:'Reading',path:'Module 1',assetDetails:[],links:[],textSample:'Interactive learner activity',textLength:28,contentComparable:true,interactiveSignals:{detected:true,confidence:'HIGH',runtimeFamilies:['SCORM'],runtimeVerificationRequired:true,note:'SCORM runtime observed'}};
  var dest={id:'d',name:'Lesson 1: 360 Activity',type:'Reading',path:'Module 1',assetDetails:[],links:[],files:[],textSample:'Interactive learner activity',textLength:28,published:false,evidenceSources:[]};
  var result=compareItemFidelity_(source,dest,1,[dest],{mode:'RAW_INGESTION'},{});
  CTI_TEST_assert_(result.issues.indexOf('RUNTIME_VERIFICATION_REQUIRED') > -1,'Runtime verification flag emitted');
  CTI_TEST_equal_(result.verdict,'RUNTIME_REVIEW','Clean structure/payload cannot auto-verify interactive runtime');
  var op=workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',[result],[],{detected:false});
  CTI_TEST_equal_(op.recommendationCode,'REVIEW','Runtime evidence blocks automatic KEEP without proof of runtime equivalence');
  var combined=JSON.parse(JSON.stringify(result));combined.verdict='PARTIAL';
  combined.issues.push('MISSING_ASSET','LINK_NOT_OBSERVED');
  combined.checks.assets={missing:['Required field image.jpeg']};combined.checks.links={missing:['https://example.org/required-guide']};
  var action=qaOwnerActionForResult_(combined);
  CTI_TEST_equal_(action.severity,'CRITICAL','Runtime review does not hide missing-asset severity');
  CTI_TEST_contains_(action.action,'Required field image.jpeg','Runtime owner guidance retains missing asset');
  CTI_TEST_contains_(action.action,'https://example.org/required-guide','Runtime owner guidance retains unobserved link');
  CTI_TEST_contains_(action.action,'Open the source activity','Runtime launch review remains visible alongside repairs');

}

function CTI_TEST_workInternalRuntimeKeepGate_() {
  var state=workDefaultState_('W','C','T');
  var item={catalogStatus:'MATCH',ctiMatchStatus:'MATCH',ctiUuid:'u',sourceRescanned:true,catalogImportStatus:'Complete',plannerCategories:['Import Only'],rawQaFresh:true,latestRawQa:{},rawQaRecommendation:{code:'KEEP'},scorm:{riseCount:0,storylineCount:0},ctiMetrics:{interactiveRuntimeCandidates:1,scormLikeCandidates:0,practiceJsonDependencies:1}};
  CTI_TEST_assert_(workHasSourceRuntimeFlag_(item) === true,'Internal source runtime metric detected independently of external SCORM list');
  CTI_TEST_equal_(workNextAction_(item,state).code,'REVIEW_SCORM_EXISTING','Internal runtime evidence requires launch check before keep');
}

function CTI_TEST_semanticQaUiContract_() {
  // Extractor implementation is server-owned in v7; combine UI contract text with the canonical source.
  var source = CTI_TEST_indexSource_() + '\n' + ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_contains_(source,'v6.14.0-evidence-dimension-hardening-20260926','Embedded v6.14.0 extractor build identity');
  CTI_TEST_contains_(source,'schema 34','Extractor schema 34 label');
  CTI_TEST_contains_(source,'detectCourseraIngestionFailure','Extractor deterministic ingestion-failure detector');
  CTI_TEST_contains_(source,'collectAssessmentSelectionPolicyFromText_','Extractor question-pool behavior detector');
  CTI_TEST_contains_(source,'Hidden dependency audit','Explore hidden-dependency semantic disclosure');
  CTI_TEST_contains_(source,'Explicit matched ingestion failures','Operational decision UI shows matched ingestion failures');
  CTI_TEST_contains_(source,'Broken unmatched Coursera ingestion artifacts','Operational decision UI shows broken unmatched destination artifacts');
  CTI_TEST_contains_(source,'Interactive/runtime launch checks','Operational decision UI shows runtime checks');
  CTI_TEST_contains_(source,'sourceRuntimeSemantics: true','Source scanner exposes runtime semantics');
  CTI_TEST_contains_(source,'schemaVersion: 8','Source evidence schema 8 is embedded');
  CTI_TEST_contains_(source,'CONVERSION_ERROR_PLACEHOLDER','Coursera conversion-error placeholder is a deterministic ingestion-failure code');
  CTI_TEST_contains_(source,'D2L_PRACTICE_RUNTIME','Source scanner distinguishes D2L practice/runtime dependencies');
  CTI_TEST_assert_(CTI_TEST_sourceHasFunction_(source,'semanticPackageKey'),'Frontend semantic package identity helper exists');
  CTI_TEST_contains_(source,'external inventory is supplemental, not exhaustive','Explore discloses that external SCORM inventory is not negative authority');
  CTI_TEST_contains_(source,'ctiCourseraExportName(id, "ITEM_FINGERPRINT")','Extractor success path requests the searchable ITEM_FINGERPRINT export name');
  CTI_TEST_contains_(source,'__v6.14.0_s34__${suffix}.json','Extractor filename template retains version/schema plus dynamic evidence-kind suffix');
  CTI_TEST_contains_(source,'Field alignment: source','QA report exposes source-field ↔ destination-field semantic alignment');
  CTI_TEST_assert_(source.indexOf('ITEM_FINGERPRINT_v6_7_0.json') === -1,'Stale v6.7.0 extractor filename is absent');
  CTI_TEST_contains_(source,'Repair repeated-export lineage','Legacy lineage repair action exists');
  CTI_TEST_contains_(source,'Did Smart Ingestion run again since the last saved CTI QA?','Operator-facing import-attempt question exists');
  CTI_TEST_contains_(source,'Yes — Smart Ingestion was run again once since the last saved QA','Re-ingestion can be confirmed without knowing G numbers');
  CTI_TEST_contains_(source,'You no longer need to work out G0/G1/G2','Internal generation codes are hidden from normal workflow');
  CTI_TEST_contains_(source,'qaGenerationSelect','Post-QA lineage generation control exists');
  CTI_TEST_contains_(source,'qaLineageStageSelect','Post-QA snapshot-stage control exists');
  CTI_TEST_contains_(source,'runSystemHealthCheck','System-health UI control exists');
}

// Nested in the existing FAST lineage case; v7.6.0 preserves decision-evidence and field-scoping regressions.
function CTI_TEST_lineageIdentityAndRepair_() {
  var headers = ['Run ID','Timestamp','Package UUID','Mode','Gateway Release','QA Engine Build','Extractor Version','Extractor Schema','Extractor Build','C0 Course ID','C1 Course ID','C0 XLSX','C0 JSON','C1 XLSX','C1 JSON','C0 XLSX SHA256','C0 JSON SHA256','C1 XLSX SHA256','C1 JSON SHA256','Source→C0 Match','Source→C1 Match','Summary JSON','Review Status','Human Label','Reviewer Notes','Payload Chunks','Lineage Generation','Snapshot Stage','Source Scan ID','Source Scan Timestamp','Source Scan Metrics JSON','Parent Run ID','Previous Generation Run ID','Lineage Notes','Delta JSON','Generation Provenance','Generation Warning'];
  var summary = {observedFidelity:28,evidenceCoverage:49,ingestionFailures:4,missing:0,partial:2,unverified:1,behaviorMutations:0,runtimeReviews:0};
  function row(id,gen,hash,provenance) {
    var r=new Array(37).fill('');
    r[0]=id; r[2]='fixture'; r[3]='SINGLE_C0'; r[4]='v6.12.0'; r[5]='v6.12.0-longitudinal-fidelity-systems-health-20260913';
    r[9]='same-course'; r[15]=hash; r[21]=JSON.stringify(summary); r[22]='UNREVIEWED'; r[25]=2;
    r[26]=gen; r[27]='RAW_UNPUBLISHED'; r[35]=provenance||'';
    return r;
  }
  function sheet(values) {
    return {
      getDataRange:function(){return {getValues:function(){return values;}};},
      getRange:function(r,c,n,w){return {setValues:function(data){
        CTI_TEST_equal_(c,27,'Repair begins at lineage columns');
        CTI_TEST_equal_(n,1,'Repair changes one row'); CTI_TEST_equal_(w,11,'Repair only writes lineage metadata');
        for(var i=0;i<w;i++) values[r-1][c-1+i]=data[0][i];
      }};}
    };
  }
  var g0=row('QA-G0',0,'HASH-A'), data=[headers,g0];
  function resolve(mode,requested,result,hash) {
    return qaResolveLineage_('fixture',mode,result||{}, {c0ExcelSha256:hash||'HASH-B',lineageRequested:requested||{}},sheet(data));
  }
  CTI_TEST_equal_(qaResolveLineage_('empty','SINGLE_C0',{}, {},sheet([headers])).generationProvenance,'AUTO_BASELINE','First run is G0 baseline');
  CTI_TEST_equal_(resolve('SINGLE_C0').generation,0,'Fresh export bytes do not create G1');
  CTI_TEST_equal_(resolve('SINGLE_C1').generation,0,'Prepared audit stays G0');
  CTI_TEST_equal_(resolve('LIFECYCLE').generation,0,'Lifecycle audit stays G0');
  CTI_TEST_equal_(resolve('SINGLE_C0',{generation:'G1'},null,'HASH-A').generation,1,'Actual reimport may reuse the hash');
  CTI_TEST_equal_(resolve('SINGLE_C0',{generation:'G1'}).generationProvenance,'EXPLICIT_OPERATOR','Explicit selection is recorded');
  CTI_TEST_equal_(resolve('SINGLE_C0',{importEvent:'REIMPORT_ONCE'}).generation,1,'Plain-language re-ingestion confirmation advances exactly one attempt');
  CTI_TEST_equal_(resolve('SINGLE_C0',{importEvent:'REIMPORT_ONCE'}).generationProvenance,'EXPLICIT_REIMPORT_EVENT','Re-ingestion confirmation is durable provenance');
  CTI_TEST_equal_(resolve('SINGLE_C0',{importEvent:'SAME_IMPORT'}).generation,0,'Same-import confirmation does not advance lineage');
  CTI_TEST_equal_(resolve('SINGLE_C0',{importEvent:'ORIGINAL_IMPORT'}).generation,0,'Original-import confirmation anchors G0');
  CTI_TEST_equal_(qaNormalizeRequestedGeneration_('garbageG2'),null,'Malformed generation is not silently accepted');
  CTI_TEST_throws_(function(){resolve('SINGLE_C0',{generation:'-1'});},'valid import attempt','Invalid explicit generation rejects persistence');
  var changed={stats:{extractorMeta:{page:{courseId:'different-branch'}}}};
  CTI_TEST_equal_(resolve('SINGLE_C0',{},changed).generation,0,'Changed destination never advances generation');
  CTI_TEST_contains_(resolve('SINGLE_C0',{},changed).generationWarning,'destination','Changed destination requires a decision');
  CTI_TEST_equal_(resolve('SINGLE_C0',{generation:'G0'},changed).generationWarning,'','Explicit decision resolves destination warning');
  var anchor=row('QA-G1',1,'HASH-A','EXPLICIT_OPERATOR'); data.push(anchor);
  CTI_TEST_equal_(resolve('SINGLE_C0',{},null,'HASH-A').generation,1,'Identical G0 hash cannot pull Auto back from explicit G1');
  CTI_TEST_equal_(resolve('SINGLE_C1').generationProvenance,'AUTO_INHERITED_EXPLICIT_ANCHOR','Prepared snapshot inherits explicit anchor');
  data.push(row('QA-G2',2,'HASH-C','EXPLICIT_OPERATOR'));
  data.push(row('QA-OLD-G0',0,'HASH-A','EXPLICIT_OPERATOR'));
  CTI_TEST_equal_(resolve('LIFECYCLE').generation,2,'A later historical G0 audit does not replace the highest explicit generation');
  data=[headers,g0];
  var bad=row('QA-REPEAT',1,'HASH-B'); bad[32]='QA-G0';
  bad[33]='Reimport generation inferred from a distinct raw XLSX snapshot.';
  var delta=qaBuildLongitudinalDelta_(summary,summary,{previousGenerationRunId:'QA-G0',generationLabel:'G1'});
  delta.itemEvolution={fixedOrImproved:0,regressed:0,unchanged:20,addedEvidence:0,removedEvidence:0,changes:[]};
  bad[34]=JSON.stringify(delta); data.push(bad);
  function candidates(){return qaRepeatedExportRepairCandidates_(data,'fixture');}
  CTI_TEST_equal_(candidates().length,1,'BORL-like zero-delta repeated export is offered for operator review');
  CTI_TEST_equal_(resolve('SINGLE_C0').generation,1,'Unrepaired legacy history is not silently rewritten');
  CTI_TEST_contains_(resolve('SINGLE_C0').generationWarning,'no recorded operator confirmation','Unproven legacy generation is warned');
  CTI_TEST_equal_(qaRepeatedExportRepairCandidates_(data,'other-package').length,0,'Repair is package scoped');
  function rejectCell(index,value,label) {var old=bad[index];bad[index]=value;CTI_TEST_equal_(candidates().length,0,label);bad[index]=old;}
  rejectCell(35,'EXPLICIT_OPERATOR','Never repair an explicit operator generation');
  rejectCell(23,'REINGEST','Never repair human-labelled rows');
  rejectCell(24,'Operator note','Never repair reviewer annotations');
  rejectCell(22,'REVIEWED','Never repair reviewed evidence');
  rejectCell(33,'Operator selected G1','Never repair custom lineage notes');
  rejectCell(9,'different-branch','Changed course identity is not repeated-export evidence');
  rejectCell(9,'','Missing course identity cannot establish repair');
  rejectCell(15,'HASH-A','Same hash cannot establish the legacy hash-promotion mistake');
  rejectCell(4,'v6.12.1','Only legacy v6.12.0 rows are eligible');
  rejectCell(31,'QA-OTHER','Do not repair established within-generation lineage');
  rejectCell(34,'{}','Missing delta is not zero delta');
  rejectCell(34,'null','JSON null is not zero delta');
  var nonzero=JSON.parse(bad[34]); nonzero.observedFidelity.delta=1;
  rejectCell(34,JSON.stringify(nonzero),'Improved fidelity prevents repair');
  nonzero=JSON.parse(bad[34]); nonzero.evidenceCoverage.before=null;
  rejectCell(34,JSON.stringify(nonzero),'Unknown coverage is not zero delta');
  nonzero=JSON.parse(bad[34]); nonzero.itemEvolution.regressed=1;
  rejectCell(34,JSON.stringify(nonzero),'Item regression prevents repair');
  nonzero=JSON.parse(bad[34]); nonzero.itemEvolution.addedEvidence=1;
  rejectCell(34,JSON.stringify(nonzero),'New evidence prevents automatic candidate matching');
  nonzero=JSON.parse(bad[34]); nonzero.itemEvolution.changes=[{change:'CHANGED_SAME_SEVERITY'}];
  rejectCell(34,JSON.stringify(nonzero),'Same-severity changes prevent repair');
  var descendant=row('QA-CHILD',1,'HASH-C'); descendant[31]='QA-REPEAT'; data.push(descendant);
  CTI_TEST_equal_(candidates().length,0,'Refuse generations with dependent history'); data.pop();
  var originalPrefix=JSON.stringify(bad.slice(0,26)), originalParent=JSON.stringify(g0);
  var noPayloadAccess={getSheetByName:function(){throw new Error('G1 to G0 repair must not touch payload storage');}};
  var repaired=qaRepairRepeatedExportLineage_(noPayloadAccess,sheet(data),'fixture','QA-REPEAT');
  CTI_TEST_equal_(repaired.generation,0,'False G1 becomes G0');
  CTI_TEST_equal_(bad[27],'RAW_UNPUBLISHED','Stage is preserved');
  CTI_TEST_equal_(bad[31],'QA-G0','Repaired run belongs to original generation');
  CTI_TEST_equal_(bad[32],'','False previous-generation link is removed');
  CTI_TEST_equal_(bad[34],'','False reimport delta is removed');
  CTI_TEST_equal_(bad[35],'REPAIRED_REPEAT_EXPORT','Repair provenance is durable');
  CTI_TEST_equal_(JSON.stringify(bad.slice(0,26)),originalPrefix,'QA summary, review fields and payload references are byte-for-byte unchanged');
  CTI_TEST_equal_(JSON.stringify(g0),originalParent,'Earlier run is untouched');
  CTI_TEST_equal_(data.length,3,'No records deleted');
  CTI_TEST_equal_(resolve('SINGLE_C0').generation,0,'Future Auto audits inherit repaired G0');
  CTI_TEST_equal_(candidates().length,0,'Repair is not offered twice');
  CTI_TEST_throws_(function(){qaRepairRepeatedExportLineage_(noPayloadAccess,sheet(data),'fixture','QA-REPEAT');},'no longer eligible','Stale repair is rejected');
}


// ============================================================================
// CTI v7 ARCHITECTURE + BRIGHTSPACE LIVE-SOURCE CONTRACTS
// ============================================================================
function CTI_TEST_v7ArchitectureManifest_() {
  CTI_TEST_equal_(CTI_RELEASE_REGISTRY_.gateway,'v8.0.0','Gateway release registry');
  CTI_TEST_equal_(CTI_RELEASE_REGISTRY_.qaEngine,'v8.0.0','QA engine release registry');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.directory.explore,'Explore feature must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.directory.editDetails,'Edit Details must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.directory.delete,'Delete must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.sourcePackage.imscc,'IMSCC intelligence must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.operations.workQueue,'Work Queue must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.qa.lifecycle,'Lifecycle QA must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.macmillan.stage5,'Macmillan Stage 5 must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.evidenceMemory.futureMlDataset,'Human-confirmed future ML dataset contract must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.evidenceMemory.generationSmartIngestionProvenance,'Generation Smart Ingestion provenance memory must remain registered');
  CTI_TEST_assert_(!!CTI_FEATURE_MANIFEST_.qa.manualChangeAttribution,'Manual-change attribution capability must remain registered');
}

function CTI_TEST_courseraCanonicalExtractor_() {
  CTI_TEST_equal_(CTI_RELEASE_REGISTRY_.courseraExtractor.delivery,'CODE_GS_CANONICAL','Coursera extractor canonical delivery');
  var script=ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_assert_(script.length > 250000,'Canonical Coursera extractor payload is present');
  CTI_TEST_assert_(script.indexOf('v6.14.0') > -1,'Canonical Coursera extractor version present');
  CTI_TEST_assert_(script.indexOf('v6.14.0-evidence-dimension-hardening-20260926') > -1,'Canonical Coursera build present');
  CTI_TEST_assert_(/Delete|Publish|Save/.test(script),'Extractor safety vocabulary remains auditable');
  var served=getCtiExtractor('coursera');
  CTI_TEST_equal_(served.version,'v6.14.0','Served Coursera version');
  CTI_TEST_equal_(served.schemaVersion,33,'Served Coursera schema');
  CTI_TEST_assert_(served.script === script,'Server returns canonical Coursera script exactly');
}

function CTI_TEST_brightspaceCanonicalExtractor_() {
  var source=ctiCanonicalBrightspaceExtractorSource_();
  CTI_TEST_contains_(source,'Brightspace v1.0.5','Canonical extractor version');
  CTI_TEST_contains_(source,"const SCHEMA_VERSION = 2",'Canonical extractor schema');
  CTI_TEST_contains_(source,"methodsUsed:['GET']",'GET-only safety evidence');
  CTI_TEST_contains_(source,'401/403 means unavailable','Permission-boundary safety evidence');
  CTI_TEST_assert_(!/method\s*:\s*[\"'](?:post|put|patch|delete)[\"']/i.test(source),'Canonical Brightspace extractor must not contain mutating fetch methods');
  CTI_TEST_contains_(source,'learner submissions','Learner-data exclusion');
}

function CTI_TEST_brightspaceLegacyParser_() {
  var legacy={schemaVersion:1,extractor:'CTI Brightspace Source Capture v0.1.4',buildId:'legacy',capturedAt:'2026-09-13T00:00:00Z',course:{orgUnitId:'163049',title:'BORL113 DEV Field Planting'},page:{origin:'https://lms.example.edu'},permissionBlocks:[],summary:{topics:1},contentTree:[{kind:'MODULE',title:'Module 1',path:['Module 1'],children:[{kind:'TOPIC',id:'1',title:'Lesson 1: 360 Activity',path:['Module 1','Assess'],activityTypeLabel:'Scorm',activityType:24,url:'d2l:brightspace:scorm:x',contentEvidence:{status:'EXTERNAL_NOT_FETCHED'}}]}],quizzes:[],assignments:[],discussions:[],runtimeSignals:[{id:'1',title:'Lesson 1: 360 Activity',activityTypeLabel:'Scorm'}]};
  var b64=Utilities.base64Encode(Utilities.newBlob(JSON.stringify(legacy)).getBytes());
  var parsed=qaParseBrightspaceGroundTruthCapture_(b64,'legacy.json');
  CTI_TEST_equal_(parsed.schemaVersion,1,'Legacy schema retained');
  CTI_TEST_equal_(parsed.topics.length,1,'Legacy content tree parsed');
  CTI_TEST_equal_(parsed.runtimeCarriers.length,1,'Legacy runtimeSignals converted to runtime carriers');
  CTI_TEST_equal_(parsed.runtimeCarriers[0].family,'SCORM','Legacy SCORM family normalized');
}

function CTI_TEST_brightspaceQuizAdapter_() {
  var quiz={name:'Module 1 Assessment',description:{text:'This assessment has 2 questions.'},questions:[
    {QuestionId:1,QuestionTypeId:1,QuestionText:{Text:'Choose A'},Points:1,QuestionInfo:{Answers:[{PartId:1,Answer:{Text:'A'},Weight:100},{PartId:2,Answer:{Text:'B'},Weight:0}]}},
    {QuestionId:2,QuestionTypeId:2,QuestionText:{Text:'Sky is blue'},Points:1,QuestionInfo:{TruePartId:3,TrueWeight:100,FalsePartId:4,FalseWeight:0}}
  ]};
  var a=qaBrightspaceQuizToAssessment_(quiz);
  CTI_TEST_equal_(a.declaredQuestionCount,2,'Declared count');
  CTI_TEST_equal_(a.questionCount,2,'Captured count');
  CTI_TEST_equal_(a.questions[0].correctAnswers[0],'A','MC answer preserved');
  CTI_TEST_equal_(a.questions[1].correctAnswers[0],'True','True/false answer preserved');
}

function CTI_TEST_brightspaceRuntimeEnrichment_() {
  var source=[{id:'s1',name:'Lesson 1: 360 Activity',type:'Plugin',path:'Module 1',textSample:'',structuredAssessment:null,behavior:null,interactiveSignals:null}];
  var capture={fileName:'x.json',sha256:'x',schemaVersion:2,extractor:'Brightspace v1.0.0',buildId:'b',capturedAt:'',course:{title:'BORL113 DEV Field Planting',orgUnitId:'1'},page:{origin:'https://lms.example.edu'},permissionBlocks:[],warnings:[],topics:[{id:'t1',title:'Lesson 1: 360 Activity',path:'Module 1 > Assess',activityTypeLabel:'Scorm',activityType:24,contentEvidence:{status:'EXTERNAL_NOT_FETCHED'}}],quizById:{},quizByName:{},assignmentById:{},assignmentByName:{},runtimeCarriers:[{id:'t1',title:'Lesson 1: 360 Activity',family:'SCORM'}],interactiveEmbeds:[]};
  var out=qaApplyBrightspaceGroundTruth_(source,capture,{fileName:'BORL113 DEV Field Planting.imscc'});
  CTI_TEST_assert_(out.sourceItems[0].interactiveSignals.detected===true,'Runtime signal must be added');
  CTI_TEST_equal_(out.sourceItems[0].interactiveSignals.runtimeFamilies[0],'SCORM','SCORM family retained');
  var runtime=qaRuntimeReview_(out.sourceItems[0],{type:'Reading',links:[],files:[]});
  CTI_TEST_equal_(runtime.status,'REVIEW','Positive live runtime must require review');
}

function CTI_TEST_brightspaceDriftPolicy_() {
  var policy={recommendationCode:'KEEP',recommendationLabel:'KEEP',recommendationReason:'base'};
  var report={liveOnlyCount:2,contradictionCount:0,permissionBlocks:0};
  var out=qaApplyLiveSourceReviewPolicy_(policy,report);
  CTI_TEST_equal_(out.recommendationCode,'REVIEW','Live-only source drift must block automatic KEEP');
  CTI_TEST_assert_(out.recommendationCode!=='REINGEST','Live-only source drift must not automatically force re-ingestion');
}

function CTI_TEST_v7FeatureParityUiContract_() {
  var src=CTI_TEST_indexSource_();
  ['Analyze Package Hierarchy','Smart Ingestion Redo Work Queue','CTI Course Library','Explore','Deep Audit','AI Triage','Bulk Re-Scan','Review Duplicates','Sync Catalogs','System Health','Edit Details','Delete','Macmillan workflow','Content Map Generation'].forEach(function(label){CTI_TEST_contains_(src,label,'Preserved UI feature: '+label);});
  CTI_TEST_contains_(src,"id=\"searchPackagesInput\"",'Directory search preserved');
  CTI_TEST_contains_(src,"id=\"qaBrightspaceSourceInput\"",'Brightspace live-source input preserved');
  CTI_TEST_contains_(src,'cti-workspace-nav','v7 workspace quick navigation');
}

function CTI_TEST_courseraCanonicalUiContract_() {
  var src=CTI_TEST_indexSource_();
  CTI_TEST_contains_(src,"ctiLoadCanonicalExtractor_('coursera','extractorScriptCode'",'Coursera UI lazy-loads canonical server extractor');
  CTI_TEST_contains_(src,'Coursera extractor source is canonical in Code.gs','Coursera UI does not duplicate canonical script source');
  CTI_TEST_assert_(src.indexOf('v6.14.0-evidence-dimension-hardening-20260926') > -1,'Coursera UI still exposes version/build badge');
  CTI_TEST_contains_(src,'Transformation family','Assignment-owner help explains source→destination families');
  CTI_TEST_contains_(src,'CTI checked these together','Item detail surfaces grouped destination children');
}

function CTI_TEST_brightspaceCanonicalUiContract_() {
  var src=CTI_TEST_indexSource_();
  CTI_TEST_contains_(src,"getCtiExtractor",'Frontend loads canonical extractor from backend');
  CTI_TEST_contains_(src,"copyBrightspaceGroundTruthScript",'Copy control preserved');
  CTI_TEST_contains_(src,'canonical in Code.gs','UI explains canonical source ownership');
  CTI_TEST_assert_(src.indexOf("const SCHEMA_VERSION = 2")===-1,'Brightspace implementation must not be duplicated inside Index.html');
}


// -------------------------------------------------------------------
// v7.2.0 — generation-scoped Smart Ingestion provenance + manual-change attribution
// -------------------------------------------------------------------
function CTI_TEST_smartIngestionExplicitExclusionV2_() {
  var items=[{name:'Author Alignment Report — For Author\'s Eyes Only',path:'[DELETE ME] Author Alignment Report',textSample:"Smart Ingestion transformations and gap-filling. Module: Student Resources: Remote On-Demand Delivery Content Excluded Excluded the 'Course Error Reporting' weblink item because it is an administrative feedback form with no educational content."}];
  var intel=qaParseSmartIngestionIntelligence_(items);
  CTI_TEST_equal_(intel.parserVersion,'smart-ingestion-provenance-v2','Parser version');
  var remote={name:'Course Error Reporting',path:'Student Resources: Remote On-Demand Delivery',assetDetails:[],textSample:''};
  var live={name:'Course Error Reporting',path:'Student Resources: Face-to-Face or Remote Live Delivery',assetDetails:[],textSample:''};
  CTI_TEST_assert_(!!qaExplicitExclusionClaimForSource_(remote,intel),'Remote duplicate receives explicit exclusion claim');
  CTI_TEST_assert_(!qaExplicitExclusionClaimForSource_(live,intel),'Face-to-face duplicate does not steal path-scoped exclusion claim');
}

function CTI_TEST_oneToManyTransformationAggregate_() {
  var source={id:'s1',name:'Performance Management',type:'Reading',path:'Student Resources: Remote On-Demand Delivery',textSample:'alpha beta gamma delta epsilon performance management coaching feedback expectations diagnosis development planning'.repeat(12),assetDetails:[],links:[]};
  var intel={claims:[{type:'ONE_TO_MANY_TRANSFORMATION',subject:'Performance Management',pathHint:'Student Resources: Remote On-Demand Delivery',excerpt:'Structured the massive tabbed Performance Management page as a chunked item.',context:''}]};
  var children=[]; for(var i=1;i<=14;i++) children.push({id:'c'+i,name:'Performance Management - '+i+'. Part '+i,type:'Reading',path:source.path,textSample:i<=12?source.textSample.slice((i-1)*30,i*30+280):'',assetDetails:[],links:[],evidenceSources:['fixture'],published:false});
  var built=qaOneToManyAggregateForSource_(source,children,intel);
  CTI_TEST_assert_(built && built.aggregate,'Aggregate built');
  CTI_TEST_equal_(built.aggregate.oneToMany.childCount,14,'All 14 children grouped');
  CTI_TEST_assert_(built.aggregate.oneToMany.textEvidenceRatio > 0.80,'Deep-text child coverage recorded');

  var chunkSource={id:'b2',name:'Lesson 2: Microsites and Seedling Survival in the Field',type:'Reading',path:'Module 2 - Microsites and Seedling Survival in the Field',textSample:('microsites planting seedlings mechanical preparation ripplow survival growth site conditions ').repeat(100),assetDetails:[],links:[]};
  var parsedChunkIntel=qaParseSmartIngestionIntelligence_([{name:'Author Alignment Report',path:'[DELETE ME]',textSample:"Module: Module 2 - Microsites and Seedling Survival in the Field Content Adaptation Reclassified the main lesson webcontent item 'Lesson 2: Microsites and Seedling Survival in the Field' as CHUNKED_ITEM because its content exceeds the length threshold. Module: Module 3 - Planting Prescriptions and Revegetation Strategies Content Adaptation Classified Lesson 3 as a CHUNKED_ITEM because its single HTML node mixes multiple readings. Module: Module 4 - Stock Handling and Planting Techniques Content Adaptation Reclassified Lesson 4 as a CHUNKED_ITEM to resolve sizing and verification limitations."}]);
  CTI_TEST_assert_(parsedChunkIntel.claims.some(function(c){return c.type==='CHUNKED_ITEM_TRANSFORMATION' && c.subject==='Lesson 2: Microsites and Seedling Survival in the Field';}),'Parser recognizes explicit quoted CHUNKED_ITEM provenance');
  CTI_TEST_assert_(parsedChunkIntel.claims.some(function(c){return c.type==='CHUNKED_ITEM_TRANSFORMATION' && c.subject==='Lesson 3';}),'Parser recognizes unquoted Classified Lesson CHUNKED_ITEM provenance');
  CTI_TEST_assert_(parsedChunkIntel.claims.some(function(c){return c.type==='CHUNKED_ITEM_TRANSFORMATION' && c.subject==='Lesson 4';}),'Parser recognizes unquoted Reclassified Lesson CHUNKED_ITEM provenance');
  var chunkIntel={claims:[{type:'CHUNKED_ITEM_TRANSFORMATION',subject:'Lesson 2: Microsites and Seedling Survival in the Field',pathHint:chunkSource.path,excerpt:'Reclassified the main lesson webcontent item as CHUNKED_ITEM.',context:''}]};
  var chunkChildren=[
    {id:'b21',name:'Lesson 2: Microsites and Seedling Survival in the Field - Planting via Microsites',type:'Reading',path:chunkSource.path,textSample:chunkSource.textSample.slice(0,2200),textEvidenceCompleteness:.95,textScopeKind:'scoped-subtree',assetDetails:[],links:[],evidenceSources:['active-editor-surface'],published:false},
    {id:'b22',name:'Lesson 2: Microsites and Seedling Survival in the Field - Mechanical Preparation of Sites',type:'Reading',path:chunkSource.path,textSample:chunkSource.textSample.slice(1800,4400),textEvidenceCompleteness:.95,textScopeKind:'scoped-subtree',assetDetails:[],links:[],evidenceSources:['active-editor-surface'],published:false},
    {id:'b23',name:'Lesson 2: Microsites and Seedling Survival in the Field - Self-Check 1',type:'Assignment',path:chunkSource.path,textSample:chunkSource.textSample.slice(4200,6200),textEvidenceCompleteness:.92,textScopeKind:'assignment-learner-body',assetDetails:[],links:[],evidenceSources:['active-editor-surface'],published:false}
  ];
  var chunkBuilt=qaOneToManyAggregateForSource_(chunkSource,chunkChildren,chunkIntel);
  CTI_TEST_assert_(chunkBuilt && chunkBuilt.aggregate,'Explicit CHUNKED_ITEM builds a transformation family');
  CTI_TEST_equal_(chunkBuilt.aggregate.oneToMany.mode,'EXPLICIT_CHUNKED_ITEM','Chunked-item mode retained');
  CTI_TEST_equal_(chunkBuilt.aggregate.oneToMany.childCount,3,'Chunk family contains all destination children');

  var inferredBuilt=qaOneToManyAggregateForSource_(chunkSource,chunkChildren,{claims:[]});
  CTI_TEST_assert_(inferredBuilt && inferredBuilt.aggregate,'Strong 3+ same-module title-prefix family can be inferred without provenance');
  CTI_TEST_equal_(inferredBuilt.aggregate.oneToMany.mode,'INFERRED_PREFIX_FAMILY','Inferred chunk-family mode retained');

  // v7.8.1: renamed/consolidated same-module discussions with strong prompt
  // equivalence must reconcile as REPACKAGED instead of becoming false MISSING.
  var discussionSource={id:'d-src',name:'Forum Activity: Stock Planning Card',type:'Discussion',path:'Module 1 - Introduction to Revegetation and Seedling Requirements',textSample:'In this activity, use the planting stock planning card to select appropriate stock types for the site. Explain your selections and discuss your reasoning with classmates.',textLength:151,assetDetails:[],links:[]};
  var discussionCarrier={id:'d-dst',name:'Stock Planning Card Activity',type:'Discussion',path:'Module 1 - Introduction to Revegetation and Seedling Requirements',textSample:'In this activity, use the planting stock planning card to select appropriate stock types for the site. Explain your selections and discuss your reasoning with classmates.',textLength:151,textEvidenceCompleteness:.97,textConfidence:'high',textScopeKind:'discussion-prompt',assetDetails:[],links:[],published:false};
  var semantic=qaFindCrossItemSemanticRepackagingEvidence_(discussionSource,[discussionCarrier],'');
  CTI_TEST_assert_(!!semantic,'Strong same-module discussion prompt finds a semantic repackaging carrier');
  CTI_TEST_equal_(semantic.carrierId,'d-dst','Semantic reconciliation selects the actual destination discussion');
  var emptyRecovery=qaFindCrossItemPayloadEvidence_(discussionSource,[discussionCarrier],'');
  CTI_TEST_assert_(emptyRecovery.hasPositiveEvidence===false,'No file/link payload alone should not fabricate repackaging evidence');
  var reconciled=qaAugmentCrossItemRecoveryWithSemanticEvidence_(discussionSource,emptyRecovery,[discussionCarrier],'');
  CTI_TEST_assert_(reconciled.hasPositiveEvidence===true && reconciled.semanticRecovered===true,'Strong learner-text evidence upgrades unmatched discussion to repackaged evidence');
  var repackagedResult=qaBuildRepackagedMissingResult_(discussionSource,reconciled,{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(repackagedResult.verdict,'REPACKAGED','Semantically consolidated discussion is not MISSING');
  CTI_TEST_assert_(repackagedResult.issues.indexOf('SEMANTIC_REPACKAGING_CONFIRMED')>-1,'Semantic repackaging is auditable in item issues');

  var unrelated={id:'d-other',name:'Completely Different Discussion',type:'Discussion',path:discussionSource.path,textSample:'Discuss workplace communication strategies, conflict resolution, and leadership approaches with your peers in this unrelated activity.',textLength:135,textEvidenceCompleteness:.97,textConfidence:'high',textScopeKind:'discussion-prompt',assetDetails:[],links:[],published:false};
  CTI_TEST_assert_(!qaFindCrossItemSemanticRepackagingEvidence_(discussionSource,[unrelated],''),'Unrelated same-module discussion must not suppress a genuine MISSING result');

  // v7.8.2 BORL-realistic path: IMSCC Discussion prompt text is unavailable,
  // but the destination contains one strongly evidenced renamed Discussion.
  var thinDiscussionSource={id:'d-thin',name:'Forum Activity: X Marks the Spot',type:'Discussion',path:'Module 2 - Microsites and Seedling Survival in the Field',textSample:'',textLength:0,assetDetails:[],links:[]};
  var renamedCarrier={id:'d-renamed',name:'X Marks the Spot Activity',type:'Discussion',path:thinDiscussionSource.path,textSample:'Use the X Marks the Spot activity to evaluate microsite conditions, compare the two site options, and discuss your choice with classmates.',textLength:132,textEvidenceCompleteness:.92,textConfidence:'high',textScopeKind:'field-aggregate',assetDetails:[{name:'Option 1.jpeg'},{name:'Option 2.jpeg'}],links:[],published:false,repackagedSourceNames:['Option 1 Image File','Option 2 Image File']};
  var structural=qaFindCrossItemStructuralRepackagingEvidence_(thinDiscussionSource,[renamedCarrier],'');
  CTI_TEST_assert_(!!structural,'Unique same-module renamed Discussion identity is recoverable when source prompt evidence is absent');
  CTI_TEST_equal_(structural.carrierId,'d-renamed','Structural reconciliation selects the renamed BORL-style Discussion');
  var thinRecovery=qaFindCrossItemPayloadEvidence_(thinDiscussionSource,[renamedCarrier],'');
  var thinReconciled=qaAugmentCrossItemRecoveryWithSemanticEvidence_(thinDiscussionSource,thinRecovery,[renamedCarrier],'');
  CTI_TEST_assert_(thinReconciled.hasPositiveEvidence===true && thinReconciled.identityRecovered===true,'Thin-source Discussion upgrades to identity-repackaged evidence');
  CTI_TEST_assert_(thinReconciled.allRecovered===false,'Structural identity does not falsely claim semantic payload verification');
  var thinResult=qaBuildRepackagedMissingResult_(thinDiscussionSource,thinReconciled,{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(thinResult.verdict,'REPACKAGED','BORL-style renamed Discussion is not falsely MISSING');
  CTI_TEST_assert_(thinResult.issues.indexOf('STRUCTURAL_IDENTITY_REPACKAGING')>-1,'Structural identity reconciliation is auditable');
  CTI_TEST_assert_(thinResult.issues.indexOf('PAYLOAD_UNVERIFIED')>-1,'Prompt equivalence remains explicitly unverified');

  // v7.8.3 BORL Stock Planning Card regression: source metadata can retain a
  // non-zero textLength even when no portable Discussion prompt is present in
  // textSample. Metadata length alone must not suppress structural identity.
  var metadataOnlyDiscussionSource={id:'d-meta',name:'Forum Activity: Stock Planning Card',type:'Discussion',path:discussionSource.path,textSample:'',textLength:418,assetDetails:[],links:[]};
  var metadataCarrier=JSON.parse(JSON.stringify(discussionCarrier));
  metadataCarrier.repackagedSourceNames=['Planting Stock Planning Card'];
  var metadataStructural=qaFindCrossItemStructuralRepackagingEvidence_(metadataOnlyDiscussionSource,[metadataCarrier],'');
  CTI_TEST_assert_(!!metadataStructural,'Declared textLength without portable textSample does not block structural Discussion reconciliation');
  CTI_TEST_equal_(metadataStructural.carrierId,'d-dst','Metadata-only source resolves to the unique same-module Stock Planning Card Discussion');
  var metadataRecovery=qaAugmentCrossItemRecoveryWithSemanticEvidence_(metadataOnlyDiscussionSource,qaFindCrossItemPayloadEvidence_(metadataOnlyDiscussionSource,[metadataCarrier],''),[metadataCarrier],'');
  var metadataResult=qaBuildRepackagedMissingResult_(metadataOnlyDiscussionSource,metadataRecovery,{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(metadataResult.verdict,'REPACKAGED','Metadata-only BORL Discussion is not falsely MISSING');
  CTI_TEST_assert_(metadataResult.issues.indexOf('PAYLOAD_UNVERIFIED')>-1,'Metadata-only structural recovery keeps prompt payload explicitly unverified');

  // v7.9.8: production normalization always creates an ingestionFailure object.
  var normalizedCarrier=normalizeCourseraItem_(metadataCarrier);
  CTI_TEST_equal_(normalizedCarrier.ingestionFailure.detected,false,'Healthy normalization has an explicit false failure flag');
  var normalizedRecovery=qaAugmentCrossItemRecoveryWithSemanticEvidence_(metadataOnlyDiscussionSource,qaFindCrossItemPayloadEvidence_(metadataOnlyDiscussionSource,[normalizedCarrier],''),[normalizedCarrier],'');
  var normalizedResult=qaBuildRepackagedMissingResult_(metadataOnlyDiscussionSource,normalizedRecovery,{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(normalizedResult.verdict,'REPACKAGED','Normalized healthy destination survives the production recovery path');
  CTI_TEST_assert_(normalizedResult.issues.indexOf('STRUCTURAL_IDENTITY_REPACKAGING')>-1,'Normalized recovery is identity-only');
  CTI_TEST_assert_(normalizedResult.issues.indexOf('PAYLOAD_UNVERIFIED')>-1,'Normalized recovery does not claim prompt equivalence');
  CTI_TEST_assert_(normalizedResult.evidenceStrength.basis.join(' ').indexOf('structural identity only')>-1,'Evidence strength describes identity rather than payload proof');
  var failedCarrier=JSON.parse(JSON.stringify(normalizedCarrier)); failedCarrier.ingestionFailure.detected=true;
  CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(metadataOnlyDiscussionSource,[failedCarrier],''),'Actual ingestion failures cannot recover identity');
  CTI_TEST_assert_(!qaFindCrossItemSemanticRepackagingEvidence_(discussionSource,[failedCarrier],''),'Actual ingestion failures cannot recover semantic content');
  var weakDuplicate=JSON.parse(JSON.stringify(normalizedCarrier)); weakDuplicate.id='weak-duplicate'; weakDuplicate.textSample=''; weakDuplicate.textEvidenceCompleteness=0;
  CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(metadataOnlyDiscussionSource,[normalizedCarrier,weakDuplicate],''),'Weak duplicate still makes structural identity ambiguous');
  var metadataOnlyTarget=JSON.parse(JSON.stringify(normalizedCarrier)); metadataOnlyTarget.textSample=''; metadataOnlyTarget.textLength=999;
  CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(metadataOnlyDiscussionSource,[metadataOnlyTarget],''),'Target metadata length alone cannot establish a learner surface');
  var wrongModule=JSON.parse(JSON.stringify(normalizedCarrier)); wrongModule.path='Completely unrelated chemistry';
  CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(metadataOnlyDiscussionSource,[wrongModule],''),'Wrong module cannot recover identity');
  var wrongType=JSON.parse(JSON.stringify(normalizedCarrier)); wrongType.type='Reading';
  CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(metadataOnlyDiscussionSource,[wrongType],''),'Wrong type cannot recover identity');
  var withMissingAssets=JSON.parse(JSON.stringify(discussionSource));
  withMissingAssets.assetDetails=[{name:'Required worksheet.pdf',presentInPackage:true},{name:'Required rubric.pdf',presentInPackage:true}];
  var partialRecovery=qaAugmentCrossItemRecoveryWithSemanticEvidence_(withMissingAssets,qaFindCrossItemPayloadEvidence_(withMissingAssets,[normalizedCarrier],''),[normalizedCarrier],'');
  var partialResult=qaBuildRepackagedMissingResult_(withMissingAssets,partialRecovery,{mode:'RAW_INGESTION'});
  CTI_TEST_near_(partialRecovery.recoveryRatio,1/3,0.0001,'One recovered prompt does not recover two missing attachments');
  CTI_TEST_equal_(partialResult.checks.repackaging.status,'PARTIAL','Semantic text recovery with unresolved assets stays partial');
  CTI_TEST_contains_(partialResult.ownerAction.action,'assets or links remain unresolved','Owner guidance retains unresolved attachments');

  var wrongIdentity={id:'d-wrong',name:'Stock Selection Activity',type:'Discussion',path:thinDiscussionSource.path,textSample:renamedCarrier.textSample,textLength:132,textEvidenceCompleteness:.95,textConfidence:'high',textScopeKind:'discussion-prompt',assetDetails:[],links:[],published:false};
  CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(thinDiscussionSource,[wrongIdentity],''),'Different activity identity cannot suppress MISSING');
  var duplicateRenamed=JSON.parse(JSON.stringify(renamedCarrier)); duplicateRenamed.id='d-renamed-2';
  CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(thinDiscussionSource,[renamedCarrier,duplicateRenamed],''),'Ambiguous duplicate renamed Discussions remain unresolved');

  var substantialMismatch={id:'d-rich',name:'Forum Activity: X Marks the Spot',type:'Discussion',path:thinDiscussionSource.path,textSample:'This source prompt asks learners to analyze a completely different rehabilitation scenario, document soil chemistry, and debate reclamation policy with evidence from the assigned reading.'.repeat(2),textLength:330,assetDetails:[],links:[]};
  CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(substantialMismatch,[renamedCarrier],''),'Title identity never overrides substantial source prompt evidence');
}

function CTI_TEST_unresolvedSourceAssetProvenance_() {
  var items=[{name:'Author Alignment Report — For Author\'s Eyes Only',path:'[DELETE ME]',textSample:'Smart Ingestion transformations and gap-filling. Module: Student Resources: Remote On-Demand Delivery Unsupported Content Fallback Could not attach or embed the referenced document "CITC923 Assignment 2.docx" (which likely contains the case study) because no asset identifier exists.'}];
  var intel=qaParseSmartIngestionIntelligence_(items);
  var source={name:'Assignment 2: S.M.A.R.T. Performance Expectations',path:'Student Resources: Remote On-Demand Delivery',textSample:'Complete the case study.',assetDetails:[{name:'CITC923 Assignment 2.docx',presentInPackage:true}]};
  var result={verdict:'VERIFIED',issues:[],checks:{},evidenceSources:[]};
  result=qaApplySmartIngestionProvenanceToResult_(source,result,intel);
  CTI_TEST_assert_(result.issues.indexOf('SI_UNRESOLVED_SOURCE_ASSET')>-1,'Unresolved attachment issue surfaced');
  CTI_TEST_equal_(result.verdict,'PARTIAL','Explicit missing attachment blocks VERIFIED');
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(result)===false,'Explicit unresolved source asset is a manual-repair blocker, not proof that another re-ingestion will fix it');
  var readiness=qaAssessDestinationReadiness_([],intel,{activeSpaCrawl:{eligibleTargets:0}},{mode:'RAW_INGESTION'});
  CTI_TEST_assert_(readiness.manualRepairCount===1,'Unresolved source asset is retained as explicit manual-repair readiness blocker');
}

function CTI_TEST_generatedBehaviorProvenance_() {
  var items=[{name:'Author Alignment Report — For Author\'s Eyes Only',path:'[DELETE ME]',textSample:'Smart Ingestion transformations and gap-filling. Module: Student Resources: Remote On-Demand Delivery Item: ungradedAssignment Content Adaptation Removed the journal navigation instruction. AI-Generated Mandatory Field Set the grader type to AI for the manually graded journal question because the source system did not specify a grading mode but this field is required.'}];
  var intel=qaParseSmartIngestionIntelligence_(items);
  CTI_TEST_assert_((intel.categoryCounts.GENERATED_BEHAVIOR||0)>=1,'Generated behavior parsed');
  CTI_TEST_assert_((intel.reviewClaims||[]).some(function(c){return c.type==='GENERATED_BEHAVIOR';}),'Generated behavior is review evidence');
}

function CTI_TEST_destinationReadiness_() {
  var items=[
    {name:'Welcome',path:'Welcome',type:'Reading',textSample:'In this course, we will learn [add your course description here]. Contact first.last.@email.com',timeEstimateMinutes:10},
    {name:'Performance Management - 9. Video: Coaching and Mentoring',path:'Student Resources',type:'Video',textSample:'',timeEstimateMinutes:0},
    {name:'[EMPTY] Supporting Content',path:'Student Resources',type:'Reading',textSample:''}
  ];
  var intel={claims:[{type:'UNRESOLVED_SOURCE_ASSET',subject:'CITC923 Assignment 2.docx',pathHint:'Student Resources',detail:'Could not attach source file.',severity:'CRITICAL',remediation:'Restore file.'}]};
  var r=qaAssessDestinationReadiness_(items,intel,{activeSpaCrawl:{eligibleTargets:3,deepCoverageCompleteness:1}},{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(r.status,'BLOCKED','Critical Smart Ingestion fallback blocks readiness');
  CTI_TEST_assert_(r.findings.some(function(f){return f.code==='TEMPLATE_PLACEHOLDER_TEXT';}),'Template placeholder detected');
  CTI_TEST_assert_(r.findings.some(function(f){return f.code==='PLACEHOLDER_CONTACT_INFO';}),'Contact placeholder detected');
  CTI_TEST_assert_(r.findings.some(function(f){return f.code==='ZERO_MINUTE_VIDEO';}),'Zero-minute video detected');
  CTI_TEST_assert_(r.findings.some(function(f){return f.code==='EMPTY_PLACEHOLDER_ITEM';}),'Empty placeholder detected');
}

function CTI_TEST_oneToManyHardLossGuard_() {
  var item={sourceName:'Performance Management',verdict:'PARTIAL',issues:['CONTENT_CHANGED'],evidenceCoverage:76,checks:{oneToManyTransformation:{textEvidenceRatio:0.50,strongPayloadEvidenceRatio:0.40},content:{status:'CHANGED'}}};
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(item)===false,'Incomplete one-to-many evidence cannot prove hard text loss');
  item.checks.oneToManyTransformation.textEvidenceRatio=1; item.evidenceCoverage=90;
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(item)===true,'Complete item evidence can still prove hard content change');

  var assetItem={sourceName:'Performance Management',verdict:'PARTIAL',issues:['MISSING_ASSET','LINK_NOT_OBSERVED'],evidenceCoverage:90,checks:{oneToManyTransformation:{textEvidenceRatio:1,strongPayloadEvidenceRatio:0.40,directionalSourceCoverage:0.99},content:{status:'VERIFIED'}}};
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(assetItem)===false,'Incomplete child payload evidence cannot convert missing one-to-many assets/links into hard loss');
  assetItem.checks.oneToManyTransformation.strongPayloadEvidenceRatio=0.95;
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(assetItem)===true,'A genuinely missing source asset remains hard loss even when one-to-many text preservation is strong');

  var linkOnlyItem={sourceName:'Performance Management',verdict:'PARTIAL',issues:['LINK_NOT_OBSERVED','RUNTIME_VERIFICATION_REQUIRED','ONE_TO_MANY_TRANSFORMATION'],evidenceCoverage:100,checks:{oneToManyTransformation:{textEvidenceRatio:1,strongPayloadEvidenceRatio:0.95,directionalSourceCoverage:0.99},content:{status:'VERIFIED'}}};
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(linkOnlyItem)===false,'Strongly preserved one-to-many content plus a lone unobserved source URL is review-first, not proven hard payload loss');
  linkOnlyItem.checks.oneToManyTransformation.directionalSourceCoverage=0.70;
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(linkOnlyItem)===false,'Weak semantic coverage does not convert an unobserved link into proof of loss');
}

function CTI_TEST_optionBoundaryIntegrity_() {
  var source={type:'single-select',prompt:'Which code matches the described condition?',options:[{label:'K1',correct:true},{label:'K2',correct:false}],correctAnswers:['K1']};
  var captured={type:'single-select',prompt:source.prompt,options:[{label:'K1',text:'K1 Correct.',description:'Correct.',correct:true},{label:'Feedback from the previous option. K2',text:'Feedback from the previous option. K2 Incorrect.',description:'Incorrect.',correct:false}],correctAnswers:['K1']};
  var raw=JSON.stringify(captured),q=qaCompareAssessmentQuestion_(source,captured);
  CTI_TEST_equal_(q.mismatches.length,0,'Contaminated fields do not manufacture option/answer changes');
  CTI_TEST_equal_(q.details.optionCaptureIssue,'FEEDBACK_SPILLS_BETWEEN_OPTION_ROWS','Capture boundary gap retained');
  CTI_TEST_equal_(q.details.courseraAnswerTextReliable,false,'Answer evidence is not promoted');
  CTI_TEST_equal_(JSON.stringify(captured),raw,'Raw input is immutable');
  var assessment=qaStructuredAssessmentComparison_({isStructuredAssessment:true,structuredAssessment:{questions:[source]}},{structuredAssessment:{questions:[captured]}});
  CTI_TEST_equal_(assessment.status,'UNVERIFIED','Count-complete contaminated assessment requires evidence');
  CTI_TEST_equal_(assessment.alignedQuestionCount,1,'Question remains captured');
  CTI_TEST_equal_(assessment.answerMismatchCount,0,'No fabricated wrong answer');
  var wrong=JSON.parse(JSON.stringify(source));wrong.options[0].correct=false;wrong.options[1].correct=true;wrong.correctAnswers=['K2'];
  CTI_TEST_assert_(qaCompareAssessmentQuestion_(source,wrong).mismatches.indexOf('CORRECT_ANSWER')>=0,'A clean wrong answer still fails');
  CTI_TEST_equal_(ctiOptionFeedbackRisk_([{label:'Correct.',correct:true},{label:'Incorrect.',correct:false}]),'','Literal answer words are not contamination');
  CTI_TEST_equal_(ctiOptionFeedbackRisk_([{label:'K1Correct.',correct:true},{label:'K2Incorrect.',correct:false}]),'','Previously supported terminal feedback repair remains available');
}

function CTI_TEST_liveSourceEvidenceScope_() {
  var s={id:'q',name:'Unit Quiz',type:'Assessment',path:'Module 1',isStructuredAssessment:true,textSample:new Array(50).join('source question body '),structuredAssessment:{questionCount:20,declaredQuestionCount:20}};
  var quiz={id:'7',name:'Unit Quiz',description:'Quiz instructions',questions:[{QuestionId:1,QuestionText:'Which result?',QuestionType:'MultipleChoice',QuestionInfo:{Answers:[]}}]};
  var live={course:{title:'TEST101'},topics:[{id:'1',title:'Unit Quiz',path:'Module 1',toolItemId:'7',activityTypeLabel:'Quiz',contentEvidence:{text:new Array(50).join('Instructions attempts time deadline ') }},{id:'2',title:'Worksheet.pdf',path:'Module 1 > Activities',activityTypeLabel:'File'}],quizById:{'7':quiz},quizByName:{},assignmentById:{},assignmentByName:{},quizzes:[quiz]};
  var result=qaApplyBrightspaceGroundTruth_([s],live,{name:'TEST101'},[{id:'asset',name:'Worksheet.pdf',path:'Module 1',type:'Reading'}]).report;
  CTI_TEST_equal_(result.matchedSourceItems,1,'Core denominator retained');
  CTI_TEST_equal_(result.matchedBundledAssetCount,1,'Package attachment identity retained');
  CTI_TEST_equal_(result.liveOnlyCount,0,'Known source document is not live-only');
  CTI_TEST_equal_(result.contradictionCount,0,'Instructions and a partial definition count are not contradictions');
  CTI_TEST_equal_(result.evidenceReviewCount,1,'Count gap is still visible for review');
  CTI_TEST_equal_(result.matchedBundledAssets[0].contentVerified,false,'Filename/path match does not verify document content');
  var ambiguous=JSON.parse(JSON.stringify(live));ambiguous.topics.push(Object.assign({},ambiguous.topics[1],{id:'3'}));
  CTI_TEST_equal_(qaApplyBrightspaceGroundTruth_([],ambiguous,{name:'TEST101'},[{name:'Worksheet.pdf',path:'Module 1',type:'Reading'}]).report.matchedBundledAssetCount,0,'Ambiguous duplicate document identities are not silently matched');
}

function CTI_TEST_unobservedPluginTarget_() {
  var finding={issues:['LINK_NOT_OBSERVED'],checks:{},evidenceCoverage:100};
  CTI_TEST_equal_(qaIsProvenHardPayloadLoss_(finding),false,'Absence of observed URL is not proven loss');
  finding.issues.push('ASSESSMENT_CHANGED');CTI_TEST_equal_(qaIsProvenHardPayloadLoss_(finding),true,'Independent hard findings remain hard');
  var evidence=qaExternalWebpageEvidence_({type:'Reading',sourceTypeRaw:'imswl_xmlv1p3',sourceLinkUrls:['https://www.youtube.com/watch?v=video']},{type:'Plugin',textSample:'Choose Plugin YouTube Edit Configuration',capturedLinkUrls:['https://cdn.example.org/youtube/index.html'],linkEvidenceConfidence:0.97});
  CTI_TEST_equal_(evidence.reasonCode,'YOUTUBE_TARGET_UNOBSERVED','YouTube wrapper has a specific evidence action');
  CTI_TEST_equal_(evidence.status,'UNVERIFIED','Wrapper does not prove video identity');
}

function CTI_TEST_courseraV68CoverageUiContract_() {
  CTI_TEST_equal_(CTI_TEST_BASELINE_EXTRACTOR_,'v6.14.0','v6.14.0 baseline extractor');
  CTI_TEST_equal_(CTI_TEST_BASELINE_EXTRACTOR_SCHEMA_,33,'v6.11 schema 34');
  var server=ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_contains_(server,'MAX_ACTIVE_CRAWL_ITEMS = 0','Primary crawl has no fixed item-count cap');
  CTI_TEST_contains_(server,'ACTIVE_CRAWL_BASE_BUDGET_MS = 240000','Adaptive crawl retains a four-minute minimum budget');
  CTI_TEST_contains_(server,'ACTIVE_CRAWL_PER_TARGET_BUDGET_MS = 45000','Adaptive crawl budget scales per eligible target');
  CTI_TEST_contains_(server,'ACTIVE_CRAWL_MAX_TOTAL_MS = 24 * 60 * 1000','Capless crawl retains an absolute time safety ceiling');
  CTI_TEST_contains_(server,'INTERLEAVED_TYPES_WITH_RESERVED_VISITS','Primary traversal gives every content type a turn and reserves later visits');
  CTI_TEST_contains_(server,'eligibleTargets.length','Primary target cap expands to the complete eligible set');
  CTI_TEST_contains_(server,'crawlElapsedMs','Traversal elapsed time is exported');
  CTI_TEST_contains_(server,'completedTargets','Traversal completed-target count is exported');
  CTI_TEST_contains_(server,'allTargetsAttempted','Traversal explicitly records whether every eligible target was attempted');
  CTI_TEST_contains_(server,'deepCoverageCompleteness','Deep coverage completeness diagnostics');
  CTI_TEST_contains_(server,'timeEstimateMinutes','Outline time evidence');
  var ui=CTI_TEST_indexSource_();
  CTI_TEST_contains_(ui,'Traversal completion:','QA UI surfaces exhaustive traversal completion');
  CTI_TEST_contains_(ui,'Crawl budget:','QA UI surfaces adaptive crawl budget diagnostics');
  CTI_TEST_contains_(ui,'allTargetsAttempted=','Downloaded report surfaces exhaustive traversal flag');
}

function CTI_TEST_v71QaUiContract_() {
  var source=CTI_TEST_indexSource_();
  ['Destination Readiness','Smart Ingestion Provenance v2','Policy-adjusted source match','Raw observed match','1→N transform','Improved:','Regressed:'].forEach(function(fragment){CTI_TEST_contains_(source,fragment,'v7.1 QA UI contract');});
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('qaAssessDestinationReadiness_'),'Destination readiness engine exists');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('qaOneToManyAggregateForSource_'),'One-to-many aggregation engine exists');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('qaApplySmartIngestionProvenanceToResult_'),'Smart Ingestion provenance application exists');
}


// v7.2 evidence-scope/manual-repair regressions retained

function CTI_TEST_provenanceClaimScopeIsolation_() {
  var items=[{name:"Author Alignment Report — For Author's Eyes Only",path:"[DELETE ME]",textSample:"Smart Ingestion transformations and gap-filling. Module: Student Resources: Remote On-Demand Delivery Item: ungradedAssignment AI-Generated Mandatory Field Set the passing threshold to 80% because the assignment is graded but no explicit pass criterion was provided in the source material."}];
  var intel=qaParseSmartIngestionIntelligence_(items);
  var unrelated={name:"CITC923 Discussion Forum Rubric",path:"Student Resources: Remote On-Demand Delivery",textSample:"Rubric criteria performance expectations and feedback.",assetDetails:[]};
  var claims=qaSmartIngestionClaimsForSource_(unrelated,intel);
  CTI_TEST_assert_(!claims.some(function(c){return c.type==="GENERATED_BEHAVIOR";}),"Generic generated behavior must remain course-level unless item identity is explicit");
}

function CTI_TEST_destinationReadinessTextContract_() {
  var source=CTI_TEST_indexSource_();
  CTI_TEST_contains_(source,"DESTINATION READINESS","Downloaded QA text must include destination readiness");
  CTI_TEST_contains_(source,"Manual repair required (do not assume re-ingestion will fix)","Downloaded QA text must distinguish manual repair from re-ingestion");
  CTI_TEST_contains_(source,"Proven hard payload loss:","Downloaded QA text must name proven hard-loss items");
}



// v7.2.0 generation-memory/manual-attribution regressions
function CTI_TEST_generationProvenanceMerge_() {
  var inherited={detected:true,claims:[
    {type:'INTENTIONAL_EXCLUSION',subject:'Course Error Reporting',pathHint:'Student Resources: Remote On-Demand Delivery',excerpt:'Excluded Course Error Reporting because administrative.',severity:'REVIEW'},
    {type:'ONE_TO_MANY_TRANSFORMATION',subject:'Performance Management',pathHint:'Student Resources: Remote On-Demand Delivery',excerpt:'Structured Performance Management as a chunked item.',severity:'INFO'}
  ]};
  var current={detected:false,claims:[]};
  var merged=qaMergeGenerationIngestionIntelligence_(current,inherited,'QA-G1-RAW');
  CTI_TEST_assert_(merged.detected,'Inherited provenance remains active without the current Author Alignment Report');
  CTI_TEST_equal_(merged.provenanceMemory.sourceRunId,'QA-G1-RAW','Provenance source run retained');
  CTI_TEST_equal_(merged.provenanceMemory.inheritedClaimCount,2,'Both same-generation claims inherited');
  var remote={name:'Course Error Reporting',path:'Student Resources: Remote On-Demand Delivery',assetDetails:[],textSample:''};
  CTI_TEST_assert_(!!qaExplicitExclusionClaimForSource_(remote,merged),'Inherited explicit exclusion still maps after report deletion');
}

function CTI_TEST_manualRemovalAttribution_() {
  var baseline=[{sourceId:'welcome',sourceName:'Welcome to Effective Performance Management',sourcePath:'Welcome - Start Here!',verdict:'VERIFIED',courseraId:'c1',courseraName:'Welcome to Effective Performance Management',issues:[],checks:{},earnedPoints:100,possiblePoints:100,evidenceCoverage:90}];
  var current=[{sourceId:'welcome',sourceName:'Welcome to Effective Performance Management',sourcePath:'Welcome - Start Here!',verdict:'MISSING',courseraId:'',courseraName:'',issues:['MISSING_ITEM'],checks:{},earnedPoints:0,possiblePoints:100,evidenceCoverage:30}];
  var attr=qaApplySameGenerationManualAttribution_(current,{rawBaselineRunId:'QA-G1-RAW',rawBaselineItems:baseline},{mode:'OPS_PREPARED'});
  CTI_TEST_assert_(attr.applied,'Manual attribution applied');
  CTI_TEST_equal_(current[0].verdict,'MANUAL_REMOVAL_REVIEW','Later same-generation deletion is manual-removal review');
  CTI_TEST_assert_(current[0].issues.indexOf('MISSING_ITEM')===-1,'Manual deletion no longer masquerades as ingestion missing');
  var policy=workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',current,[],{detected:false});
  CTI_TEST_equal_(policy.learnerFacingMissing,0,'Manual deletion does not count as Smart Ingestion missing');
  CTI_TEST_equal_(policy.learnerFacingManualRemovals,1,'Manual deletion is still surfaced');
  CTI_TEST_equal_(policy.recommendationCode,'REVIEW','Manual deletion is review, not re-ingest');
}

function CTI_TEST_manualPayloadRegressionAttribution_() {
  var baseline=[{sourceId:'pm',sourceName:'Performance Management',sourcePath:'Student Resources: Remote On-Demand Delivery',verdict:'UNVERIFIED',courseraId:'cpm',courseraName:'Performance Management',issues:['PAYLOAD_UNVERIFIED'],checks:{},earnedPoints:80,possiblePoints:100,evidenceCoverage:75}];
  var current=[{sourceId:'pm',sourceName:'Performance Management',sourcePath:'Student Resources: Remote On-Demand Delivery',verdict:'PARTIAL',courseraId:'cpm',courseraName:'Performance Management',issues:['MISSING_ASSET'],checks:{assets:{missing:['asset.jpg']}},earnedPoints:75,possiblePoints:100,evidenceCoverage:90}];
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(current[0])===true,'Fixture begins as hard payload loss');
  var attr=qaApplySameGenerationManualAttribution_(current,{rawBaselineRunId:'QA-G1-RAW',rawBaselineItems:baseline},{mode:'OPS_PREPARED'});
  CTI_TEST_assert_(attr.manualRegressionNames.indexOf('Performance Management')>-1,'Hard-loss regression attributed to manual stage');
  CTI_TEST_assert_(qaIsProvenHardPayloadLoss_(current[0])===false,'Manual-stage regression no longer proves Smart Ingestion must rerun');
  var policy=workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',current,[],{detected:false});
  CTI_TEST_equal_(policy.learnerFacingHardPayloadLoss,0,'Attributed manual regression is excluded from re-ingest hard-loss gate');
  CTI_TEST_equal_(policy.learnerFacingManualRegressions,1,'Manual regression remains visible');
  CTI_TEST_equal_(policy.recommendationCode,'REVIEW','Manual regression is review/fix, not blind re-ingest');
}

function CTI_TEST_generationMemoryUiContract_() {
  var source=CTI_TEST_indexSource_();
  CTI_TEST_contains_(source,'Generation memory active:','UI explains inherited Smart Ingestion provenance');
  CTI_TEST_contains_(source,'Changes made after Smart Ingestion — confirm these were intentional','Operator summary separates same-generation manual changes');
  CTI_TEST_contains_(source,'Manual removals since raw snapshot','Detailed decision panel exposes manual removals');
  CTI_TEST_contains_(source,'Generation provenance memory: inherited','Downloaded text preserves generation provenance explanation');
}



function CTI_TEST_historicalProvenanceStageSemantics_() {
  var intel=qaMergeGenerationIngestionIntelligence_({detected:false,claims:[]},{detected:true,claims:[
    {type:'UNRESOLVED_SOURCE_ASSET',subject:'Assignment 2.docx',pathHint:'Student Resources',detail:'Could not attach.',severity:'CRITICAL'},
    {type:'GENERATED_CONTENT_FALLBACK',subject:'Overview.html',pathHint:'Overview',detail:'Generated replacement.',severity:'CRITICAL'}
  ]},'QA-G1-RAW');
  var ready=qaAssessDestinationReadiness_([],intel,{activeSpaCrawl:{eligibleTargets:0}},{mode:'OPS_CURRENT'},null);
  CTI_TEST_equal_(ready.criticalCount,0,'Inherited raw critical claims do not remain automatic current-stage blockers');
  CTI_TEST_equal_(ready.reviewCount,0,'Historical provenance alone is not repeated as an unresolved current defect without current-state reconciliation');
  var source={name:'Overview.html',path:'Overview',textSample:'real source content '.repeat(20),assetDetails:[],links:[]};
  var result={verdict:'VERIFIED',issues:[],checks:{},snapshotContext:{mode:'OPS_CURRENT'},evidenceSources:[],earnedPoints:100,possiblePoints:100,evidenceCoverage:90};
  result=qaApplySmartIngestionProvenanceToResult_(source,result,intel);
  CTI_TEST_assert_(result.issues.indexOf('SI_HISTORICAL_GENERATED_CONTENT_FALLBACK_REVIEW')===-1,'Historical generated fallback remains provenance-only until current-state resolver decides it');
  CTI_TEST_assert_(result.verdict!=='INGESTION_FAILURE','Historical generated fallback alone cannot recreate an ingestion failure after manual cleanup');
}



function CTI_TEST_citc923SameGenerationCleanupScenario_() {
  var intel=qaMergeGenerationIngestionIntelligence_({detected:false,claims:[]},{detected:true,claims:[
    {type:'INTENTIONAL_EXCLUSION',subject:'Course Error Reporting',pathHint:'Student Resources: Remote On-Demand Delivery',excerpt:'Excluded Course Error Reporting because administrative.',severity:'REVIEW'},
    {type:'ONE_TO_MANY_TRANSFORMATION',subject:'Performance Management',pathHint:'Student Resources: Remote On-Demand Delivery',excerpt:'Structured Performance Management as a chunked item.',severity:'INFO'}
  ]},'QA-CITC923-G1-RAW');
  var remote={name:'Course Error Reporting',path:'Student Resources: Remote On-Demand Delivery',assetDetails:[],textSample:''};
  CTI_TEST_assert_(!!qaExplicitExclusionClaimForSource_(remote,intel),'CITC923 remote Course Error Reporting exclusion survives cleanup');

  var baseline=[
    {sourceId:'welcome',sourceName:'Welcome to Effective Performance Management',sourcePath:'Welcome - Start Here!',verdict:'VERIFIED',courseraId:'welcome-id',courseraName:'Welcome to Effective Performance Management',issues:[],checks:{},earnedPoints:100,possiblePoints:100,evidenceCoverage:90},
    {sourceId:'pm',sourceName:'Performance Management',sourcePath:'Student Resources: Remote On-Demand Delivery',verdict:'PARTIAL',courseraId:'pm-id',courseraName:'Composite transformation',issues:['PAYLOAD_UNVERIFIED'],checks:{},earnedPoints:83,possiblePoints:100,evidenceCoverage:84}
  ];
  var current=[
    {sourceId:'welcome',sourceName:'Welcome to Effective Performance Management',sourcePath:'Welcome - Start Here!',verdict:'MISSING',issues:['MISSING_ITEM'],checks:{},earnedPoints:0,possiblePoints:100,evidenceCoverage:30},
    {sourceId:'cer',sourceName:'Course Error Reporting',sourcePath:'Student Resources: Remote On-Demand Delivery',verdict:'INTENTIONAL_EXCLUSION',issues:['INTENTIONAL_EXCLUSION'],checks:{},earnedPoints:0,possiblePoints:0,evidenceCoverage:45},
    {sourceId:'pm',sourceName:'Performance Management',sourcePath:'Student Resources: Remote On-Demand Delivery',verdict:'PARTIAL',courseraId:'pm-id',courseraName:'Composite transformation',issues:['MISSING_ASSET'],checks:{assets:{missing:['ideas.jpg']}},earnedPoints:78,possiblePoints:100,evidenceCoverage:84}
  ];
  var attr=qaApplySameGenerationManualAttribution_(current,{rawBaselineRunId:'QA-CITC923-G1-RAW',rawBaselineItems:baseline},{mode:'OPS_CURRENT'});
  CTI_TEST_assert_(attr.manualRemovalNames.indexOf('Welcome to Effective Performance Management')>-1,'Deleted Welcome is attributed to manual cleanup');
  CTI_TEST_assert_(attr.manualRegressionNames.indexOf('Performance Management')>-1,'New PM hard-loss signal is attributed to manual cleanup stage');
  var policy=workBuildRawQaOperationalPolicy_('Northern Alberta Institute of Technology',current,[],{detected:false});
  CTI_TEST_equal_(policy.learnerFacingMissing,0,'CITC923 cleanup has no Smart Ingestion missing item after attribution');
  CTI_TEST_equal_(policy.learnerFacingHardPayloadLoss,0,'CITC923 cleanup has no Smart Ingestion hard-loss gate after attribution');
  CTI_TEST_equal_(policy.learnerFacingIntentionalExclusions,1,'CITC923 intentional exclusion remains visible');
  CTI_TEST_equal_(policy.recommendationCode,'REVIEW','CITC923 cleanup remains manual review/fix, never blind re-ingest');
}



// v7.2.1 canonical raw-baseline + stage-guard regressions

function CTI_TEST_canonicalRawBaselineSelection_() {
  var rows=[
    {runId:'QA-G1-RAW-ORIGINAL',mode:'SINGLE_C0',stage:'RAW_UNPUBLISHED'},
    {runId:'QA-G1-OPS',mode:'SINGLE_C1',stage:'OPS_PREPARED_UNPUBLISHED'},
    {runId:'QA-G1-MISLABELLED-RAW',mode:'SINGLE_C0',stage:'RAW_UNPUBLISHED'}
  ];
  var chosen=qaSelectCanonicalRawBaselineRow_(rows);
  CTI_TEST_equal_(chosen.runId,'QA-G1-RAW-ORIGINAL','First valid raw snapshot is immutable canonical baseline');
}

function CTI_TEST_rawStageGuard_() {
  var rawItems=[
    {sourceId:'welcome',sourceName:'Welcome to Effective Performance Management',courseraId:'welcome-id',courseraName:'Welcome to Effective Performance Management',verdict:'VERIFIED'}
  ];
  var current=[{id:'other-id',name:'Instructor Contact Information'}];
  var ctx={
    requestedMode:'raw',mode:'RAW_INGESTION',label:'Raw Coursera ingestion',
    publicationPolicy:'OBSERVE_NOT_PENALIZE',reason:'User explicitly labelled raw.'
  };
  var guarded=qaApplySnapshotStageGuard_(ctx,{
    rawBaselineRunId:'QA-G1-RAW-ORIGINAL',
    rawBaselineItems:rawItems,
    latestNonRawRunId:'QA-G1-OPS',
    latestNonRawStage:'OPS_PREPARED_UNPUBLISHED'
  },current);
  CTI_TEST_assert_(guarded.stageGuardApplied,'Stage guard activates when same-generation history proves this cannot be raw');
  CTI_TEST_equal_(guarded.mode,'OPS_CURRENT','Mislabelled raw shell is treated as current/Ops-prepared for decision semantics');
  CTI_TEST_equal_(guarded.canonicalRawBaselineRunId,'QA-G1-RAW-ORIGINAL','Stage guard references immutable canonical raw baseline');

  var attributed=[{sourceId:'welcome',sourceName:'Welcome to Effective Performance Management',sourcePath:'Welcome - Start Here!',verdict:'MISSING',issues:['MISSING_ITEM'],checks:{},earnedPoints:0,possiblePoints:100,evidenceCoverage:30}];
  var attr=qaApplySameGenerationManualAttribution_(attributed,{rawBaselineRunId:'QA-G1-RAW-ORIGINAL',rawBaselineItems:rawItems},guarded);
  CTI_TEST_assert_(attr.manualRemovalNames.indexOf('Welcome to Effective Performance Management')>-1,'Stage guard enables correct manual-removal attribution');
}


// v7.2.2 published-stage lineage regressions

function CTI_TEST_publishedSnapshotContext_() {
  var items=[
    {published:true},{published:true},{published:true},{published:false}
  ];
  var ctx=qaResolveSnapshotContext_('published',items,{detected:false});
  CTI_TEST_equal_(ctx.mode,'OPS_CURRENT','Published state remains a current-shell comparison, not raw ingestion');
  CTI_TEST_equal_(ctx.stage,'PUBLISHED','Published state is preserved explicitly');
  CTI_TEST_equal_(ctx.label,'Published learner-facing Coursera course','Published operator label is explicit');
  CTI_TEST_equal_(ctx.publicationPolicy,'LEARNER_FACING_STRICT','Published state uses learner-facing publication policy');
}

function CTI_TEST_publishedUiSnapshotMode_() {
  var source=CTI_TEST_indexSource_();
  CTI_TEST_contains_(source,"stateChoice === 'published' ? 'published'","Published UI choice must be sent to backend as published, not collapsed into ops");
}


// v7.6.0 current-state resolution + searchable filename regressions

function CTI_TEST_courseraSearchableFilename_() {
  var script=ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_contains_(script,'CTI__COURSERA__','Coursera filename begins with a searchable platform prefix');
  CTI_TEST_contains_(script,'__COURSE_','Coursera filename retains the unique course/branch identifier after the human title');
  CTI_TEST_contains_(script,'ctiLocalFileTimestamp','Coursera filename includes local date/time and timezone');
  CTI_TEST_contains_(script,'__v6.14.0_s34__${suffix}.json','Coursera filename template exposes extractor version/schema and dynamic evidence kind');
  CTI_TEST_contains_(script,'ctiCourseraExportName(id, "ITEM_FINGERPRINT")','Coursera success export explicitly uses ITEM_FINGERPRINT as the evidence kind');
  CTI_TEST_contains_(script,'result.meta.exportFileName','Coursera JSON records its own exported filename');
}

function CTI_TEST_brightspaceSearchableFilename_() {
  var script=ctiCanonicalBrightspaceExtractorSource_();
  CTI_TEST_contains_(script,'CTI__BRIGHTSPACE__','Brightspace filename begins with a searchable platform prefix');
  CTI_TEST_contains_(script,'__ORG_${slug(orgUnitId)}__','Brightspace filename includes the unique OrgUnit identifier');
  CTI_TEST_contains_(script,'fileTimestamp(new Date())','Brightspace filename includes local date/time and timezone');
  CTI_TEST_contains_(script,'__v1.0.5_s2__SOURCE_GROUND_TRUTH.json','Brightspace filename exposes extractor version/schema and evidence kind');
  CTI_TEST_contains_(script,'capture.exportFileName = exportFileName','Brightspace JSON records its own exported filename');
}


// ---------------------------------------------------------------------------
// v7.3 current-state resolution engine regressions
// ---------------------------------------------------------------------------
function CTI_TEST_currentStateResolvedAttachment_() {
  var claim={type:'UNRESOLVED_SOURCE_ASSET',subject:'CITC923 Assignment 2.docx',target:'Coursera attachment',severity:'CRITICAL'};
  var source={id:'a2',name:'Assignment 2: S.M.A.R.T. Performance Expectations',path:'Student Resources',assetDetails:[{name:'CITC923 Assignment 2.docx'}]};
  var item={id:'dest-a2',name:'Assignment 2: S.M.A.R.T. Performance Expectations',path:'Student Resources',type:'Assignment',assetDetails:[],evidenceSources:['active-editor-surface'],nativeAssignment:{
    attachments:[{displayName:'CITC923 Assignment 2',fileType:'DOCX',inferredFileName:'CITC923 Assignment 2.docx',evidenceSource:'visible-editor-file-chip'}],
    currentStateEvidence:{editorSurfaceObserved:true},submission:{fileUpload:true},settings:{}
  }};
  var r=qaResolveHistoricalClaimCurrentState_(claim,source,item,[item],{}, {mode:'OPS_CURRENT'});
  CTI_TEST_equal_(r.status,'RESOLVED','Current visible DOCX attachment resolves the old Smart Ingestion missing-asset claim');
  CTI_TEST_equal_(r.severity,'RESOLVED','Resolved historical asset is not an operator defect');
}

function CTI_TEST_currentStateGeneratedThresholdStillPresent_() {
  var claim={type:'GENERATED_BEHAVIOR',subject:'passing threshold',target:'80%',severity:'REVIEW'};
  var item={id:'a2',name:'Assignment 2',path:'Student Resources',type:'Assignment',evidenceSources:['active-editor-surface'],nativeAssignment:{
    settings:{passingThreshold:80},submission:{aiGraded:true},currentStateEvidence:{editorSurfaceObserved:true,observedSettingFields:['passingThreshold']}
  }};
  var r=qaResolveHistoricalClaimCurrentState_(claim,null,item,[item],{}, {mode:'PUBLISHED'});
  CTI_TEST_equal_(r.status,'STILL_PRESENT','Current 80% threshold is positively observed');
  CTI_TEST_equal_(r.currentItemName,'Assignment 2','Generated behavior is localized to the current item');
}

function CTI_TEST_currentStateAiGraderStillPresent_() {
  var claim={type:'GENERATED_BEHAVIOR',subject:'grader type',target:'AI',severity:'REVIEW'};
  var item={id:'a2',name:'Assignment 2',path:'Student Resources',type:'Assignment',evidenceSources:['active-editor-surface'],nativeAssignment:{
    settings:{graderType:'AI'},submission:{aiGraded:true},currentStateEvidence:{editorSurfaceObserved:true}
  }};
  var r=qaResolveHistoricalClaimCurrentState_(claim,null,item,[item],{}, {mode:'OPS_CURRENT'});
  CTI_TEST_equal_(r.status,'STILL_PRESENT','AI grading that remains in the current editor stays a review finding');
  CTI_TEST_contains_(r.detail,'AI','Current AI setting is explained');
}

function CTI_TEST_currentStateOverviewResolvedByLiveSource_() {
  var text='Welcome to Effective Performance Management. This course is designed to help you implement an ongoing continuous process of communicating and clarifying job responsibilities priorities and performance expectations. Course Objectives include SMART goals coaching feedback and performance diagnosis. '.repeat(4);
  var claim={type:'GENERATED_CONTENT_FALLBACK',subject:'Overview.html',target:'AI-generated replacement reading',severity:'CRITICAL'};
  var source={id:'ov',name:'Overview.html',path:'Overview',textSample:'',liveSource:{textSample:text}};
  var item={id:'ov-d',name:'Overview',path:'Overview',type:'Reading',textSample:text,textEvidenceCompleteness:0.95,textScopeKind:'scoped-subtree',evidenceSources:['active-editor-surface']};
  var r=qaResolveHistoricalClaimCurrentState_(claim,source,item,[item],{}, {mode:'PUBLISHED'});
  CTI_TEST_equal_(r.status,'RESOLVED_SOURCE_EQUIVALENT','Live-source-equivalent current Overview resolves old generated fallback');
  CTI_TEST_equal_(r.severity,'RESOLVED','Resolved Overview no longer keeps readiness in review');
}

function CTI_TEST_currentStatePlaceholderRemoved_() {
  var claim={type:'PLACEHOLDER_FALLBACK',subject:'Supporting Content',target:'reading placeholder',severity:'REVIEW'};
  var items=[{id:'x',name:'Other item',path:'Student Resources',type:'Reading'}];
  var r=qaResolveHistoricalClaimCurrentState_(claim,null,null,items,{}, {mode:'PUBLISHED'});
  CTI_TEST_equal_(r.status,'RESOLVED_BY_REMOVAL','Historical placeholder absent from complete current structural inventory resolves by removal');
}

function CTI_TEST_currentStateUnobservedEvidenceGap_() {
  var claim={type:'UNRESOLVED_SOURCE_ASSET',subject:'Case Study.docx',target:'Coursera attachment',severity:'CRITICAL'};
  var r=qaResolveHistoricalClaimCurrentState_(claim,null,null,[],{activeSpaCrawl:{effectiveNavigated:0,targets:10}}, {mode:'PUBLISHED'});
  CTI_TEST_equal_(r.status,'UNOBSERVED','Lack of deep current evidence remains unobserved');
  CTI_TEST_equal_(r.severity,'EVIDENCE','Unobserved historical issue is an evidence gap, not a stale current defect');
}

function CTI_TEST_currentStateReadinessIntegration_() {
  var claim={type:'GENERATED_BEHAVIOR',subject:'passing threshold',target:'80%',severity:'REVIEW'};
  var item={id:'a2',name:'Assignment 2',path:'Student Resources',type:'Assignment',evidenceSources:['active-editor-surface'],nativeAssignment:{settings:{passingThreshold:80},submission:{aiGraded:true},currentStateEvidence:{editorSurfaceObserved:true}}};
  var report={resolutions:[qaResolveHistoricalClaimCurrentState_(claim,null,item,[item],{}, {mode:'PUBLISHED'})]};
  var ready=qaAssessDestinationReadiness_([item],{claims:[claim]},{activeSpaCrawl:{eligibleTargets:1,deepCoverageCompleteness:1}},{mode:'PUBLISHED'},report);
  CTI_TEST_equal_(ready.criticalCount,0,'Later-stage generated behavior never becomes blind re-ingest critical');
  CTI_TEST_assert_(ready.reviewFindings.some(function(f){return f.code==='CURRENT_STATE_GENERATED_BEHAVIOR';}),'Current-state still-present behavior drives readiness review');
}

function CTI_TEST_currentStateUiContract_() {
  var source=CTI_TEST_indexSource_();
  CTI_TEST_contains_(source,'Current-State Resolution','Operator UI exposes current-vs-historical resolution');
  CTI_TEST_contains_(source,'CURRENT STATE RESOLUTION','Downloaded report exposes current-vs-historical resolution');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('qaResolveHistoricalCurrentState_'),'Current-state resolution engine exists');
  CTI_TEST_assert_(CTI_TEST_globalFunctionExists_('qaResolveHistoricalClaimCurrentState_'),'Per-claim current-state resolver exists');
}


function CTI_TEST_citc923Assignment2CurrentState_() {
  var claims=[
    {type:'UNRESOLVED_SOURCE_ASSET',subject:'CITC923 Assignment 2.docx',target:'Coursera attachment',severity:'CRITICAL'},
    {type:'GENERATED_BEHAVIOR',subject:'passing threshold',target:'80%',severity:'REVIEW'},
    {type:'GENERATED_BEHAVIOR',subject:'grader type',target:'AI',severity:'REVIEW'}
  ];
  var source={id:'a2',name:'Assignment 2: S.M.A.R.T. Performance Expectations',path:'Student Resources: Remote On-Demand Delivery',assetDetails:[{name:'CITC923 Assignment 2.docx'}]};
  var item={id:'a2-dest',name:'Assignment 2: S.M.A.R.T. Performance Expectations',path:'Student Resources: Remote On-Demand Delivery',type:'Assignment',evidenceSources:['active-editor-surface'],nativeAssignment:{
    attachments:[{displayName:'CITC923 Assignment 2',fileType:'DOCX',inferredFileName:'CITC923 Assignment 2.docx',evidenceSource:'visible-editor-file-chip'}],
    submission:{fileUpload:true,aiGraded:true},
    settings:{passingThreshold:80,graderType:'AI',gradeSetting:'Graded',attempts:'Unlimited Attempts',scoringPolicy:'Latest Score'},
    currentStateEvidence:{editorSurfaceObserved:true,observedSettingFields:['passingThreshold','graderType'],attachmentCount:1}
  }};
  var attachment=qaResolveHistoricalClaimCurrentState_(claims[0],source,item,[item],{}, {mode:'PUBLISHED'});
  var threshold=qaResolveHistoricalClaimCurrentState_(claims[1],source,item,[item],{}, {mode:'PUBLISHED'});
  var grader=qaResolveHistoricalClaimCurrentState_(claims[2],source,item,[item],{}, {mode:'PUBLISHED'});
  CTI_TEST_equal_(attachment.status,'RESOLVED','Assignment 2 DOCX is current positive evidence, so historical missing-asset warning closes');
  CTI_TEST_equal_(threshold.status,'STILL_PRESENT','Assignment 2 current 80% threshold remains a real review');
  CTI_TEST_equal_(grader.status,'STILL_PRESENT','Assignment 2 current AI grader remains a real review');
}


// ---------------------------------------------------------------------------
// v7.6.0 / Coursera v6.11 exhaustive-crawl + decision-evidence regressions
// ---------------------------------------------------------------------------
function CTI_TEST_v610ControlValueContract_() {
  var script=ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_contains_(script,'findLabeledCourseraControlValue','Extractor has label-to-form-control value resolver');
  CTI_TEST_contains_(script,"/^Passing threshold\\b/i",'Passing threshold uses the labeled control resolver');
  CTI_TEST_contains_(script,'settings.passingThreshold = Number(n[0])','Input-only numeric threshold is persisted structurally');
  CTI_TEST_contains_(script,'aria-valuenow','Accessible numeric control values are supported');
}

function CTI_TEST_v610CrawlPriorityContract_() {
  var script=ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_contains_(script,'startingItemId','Extractor preserves the itemId from the URL that launched extraction');
  CTI_TEST_contains_(script,'score += 120','Starting item receives dominant crawl priority');
  CTI_TEST_contains_(script,'completeness < 0.50','Low-text-evidence items are explicitly prioritized');
  CTI_TEST_contains_(script,'crawlTargetPriority(b,startingItemId)','Active crawl sorting uses starting-item context');
}

function CTI_TEST_v610LearnerSemanticContract_() {
  var script=ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_contains_(script,'trimCourseraAssignmentLearnerText','Assignment learner-facing text has a bounded trimmer');
  CTI_TEST_contains_(script,'AI Grader Instructions','AI grader instructions are a learner-text stop marker');
  CTI_TEST_contains_(script,'learnerSemanticText','Extractor exports learner-only assignment semantics separately');
  CTI_TEST_contains_(script,'authoringSemanticText','Authoring/rubric/settings evidence remains available separately');
}

function CTI_TEST_v610AttachmentLocalityContract_() {
  var script=ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_contains_(script,'own.length > 220','Large ancestor text is rejected as an attachment chip');
  CTI_TEST_contains_(script,'visible-editor-file-chip','Local visible file-chip evidence remains supported');
  CTI_TEST_contains_(script,'displayName.length > 190','Implausibly large inferred filenames are filtered');
}

function CTI_TEST_rubricIdentityUnproven_() {
  var claim={type:'GENERATED_BEHAVIOR',subject:'rubric',target:'generated rubric',severity:'REVIEW'};
  var item={id:'a2',name:'Assignment 2',path:'Student Resources',type:'Assignment',evidenceSources:['active-editor-surface'],nativeAssignment:{rubricCount:1,rubrics:[{title:'Current rubric'}],settings:{},submission:{},currentStateEvidence:{editorSurfaceObserved:true,rubricCount:1}}};
  var r=qaResolveHistoricalClaimCurrentState_(claim,null,item,[item],{}, {mode:'PUBLISHED'});
  CTI_TEST_equal_(r.status,'CURRENT_RUBRIC_PRESENT_IDENTITY_UNPROVEN','A current rubric does not prove the historical generated rubric survived unchanged');
  CTI_TEST_equal_(r.severity,'REVIEW','Rubric identity uncertainty remains review-first');
}

function CTI_TEST_assignmentLearnerBodyComparison_() {
  var learner='Develop one SMART goal for Maya using observable behaviours and explain how the goal will be measured and achieved.';
  var wrapper=('Course shell metadata grading notes facilitator context navigation instructions administrative labels '.repeat(18));
  var source={type:'Assignment',textSample:wrapper + ' ' + learner + ' ' + wrapper,textLength:(wrapper + ' ' + learner + ' ' + wrapper).length};
  var coursera={type:'Assignment',textSample:learner+' AI Grader Instructions unrelated rubric settings passing threshold export settings '.repeat(20),textLength:1900,textEvidenceCompleteness:.95,textConfidence:'high',nativeAssignment:{learnerSemanticText:learner,learnerPrompt:learner}};
  var cmp=qaTextComparison_(source,coursera);
  CTI_TEST_equal_(cmp.scopeKind,'assignment-learner-body','QA compares assignment learner semantics rather than authoring chrome');
  CTI_TEST_assert_(cmp.fieldScopedComparison === true,'QA aligns the narrow destination learner field to a bounded source field');
  CTI_TEST_assert_(/^source-assignment-/.test(cmp.sourceScopeKind),'Source field alignment is explicitly typed');
  CTI_TEST_equal_(cmp.status,'VERIFIED','A learner assignment field embedded inside a much larger source wrapper must verify field-to-field');

  var sourceParaphrase='For this assignment, create at least one SMART performance expectation for Maya. Explain specific observable employee behaviours, describe how progress will be measured, and show why the goal is achievable and relevant within an appropriate time period.';
  var destinationParaphrase='Develop one SMART goal for Maya. Include observable behaviours, explain how you will measure progress, make sure the goal is achievable and relevant, and identify the time frame.';
  var paraphraseSource={type:'Assignment',textSample:wrapper+' '+sourceParaphrase+' '+wrapper,textLength:(wrapper+' '+sourceParaphrase+' '+wrapper).length};
  var paraphraseCmp=qaTextComparison_(paraphraseSource,{type:'Assignment',textSample:destinationParaphrase,textLength:destinationParaphrase.length,textEvidenceCompleteness:.95,textConfidence:'high',nativeAssignment:{learnerSemanticText:destinationParaphrase,learnerPrompt:destinationParaphrase}});
  CTI_TEST_equal_(paraphraseCmp.status,'VERIFIED','Strong paraphrased field-to-field alignment should verify without requiring whole-source length similarity');
  CTI_TEST_assert_(paraphraseCmp.sourceFieldInference === true,'Paraphrased assignment verification records inferred source-field alignment');

  var unrelated='Write a completely unrelated procurement strategy about supplier contracts, tax policy, and warehouse logistics.';
  var bad=qaTextComparison_(source,{type:'Assignment',textSample:unrelated,textLength:unrelated.length,textEvidenceCompleteness:.95,textConfidence:'high',nativeAssignment:{learnerSemanticText:unrelated,learnerPrompt:unrelated}});
  CTI_TEST_assert_(bad.status!=='CHANGED' && bad.status!=='DRIFT','Destination-guided source-field inference must never manufacture negative content drift when alignment is weak');
}

function CTI_TEST_fullCrawlInfoOnly_() {
  var incomplete=qaAssessDestinationReadiness_([], {claims:[]}, {activeSpaCrawl:{eligibleTargets:33,completedTargets:20,allTargetsAttempted:false,unvisitedDueToBudget:13,timeBudgetExhausted:true,coverageLimitedByCap:false,deepCoverageCompleteness:.606}}, {mode:'PUBLISHED'}, {resolutions:[]});
  CTI_TEST_equal_(incomplete.evidenceGapCount,1,'An incomplete eligible surface remains an evidence gap');
  CTI_TEST_assert_(incomplete.findings.some(function(f){return f.code==='EXTRACTOR_FULL_CRAWL_INCOMPLETE' && f.severity==='EVIDENCE';}),'Unattempted eligible targets remain visible as diagnostic info');
  var complete=qaAssessDestinationReadiness_([], {claims:[]}, {activeSpaCrawl:{eligibleTargets:33,targets:33,completedTargets:33,allTargetsAttempted:true,unvisitedDueToBudget:0,timeBudgetExhausted:false,coverageLimitedByCap:false,deepCoverageCompleteness:1}}, {mode:'PUBLISHED'}, {resolutions:[]});
  CTI_TEST_assert_(!complete.findings.some(function(f){return f.code==='EXTRACTOR_FULL_CRAWL_INCOMPLETE';}),'33/33 attempted traversal is not mislabeled incomplete even when individual items may yield weak content evidence');
}

function CTI_TEST_learnerMarkup_() {
  CTI_TEST_equal_(qaLearnerMarkupText_('<p>Alpha <strong>beta</strong></p><p>gamma&#160;&amp; delta</p>'),'Alpha beta gamma & delta','Block boundaries and entities');
  CTI_TEST_equal_(qaLearnerMarkupText_('x < 5 and y > 3'),'x < 5 and y > 3','Math inequalities remain literal');
  CTI_TEST_equal_(qaLearnerMarkupText_('&lt;p&gt;literal example&lt;/p&gt;'),'<p>literal example</p>','Decode literal examples after tag removal');
  CTI_TEST_equal_(qaLearnerMarkupText_('<span>micro</span><b>site</b>'),'microsite','Inline spans do not split words');
}
function CTI_TEST_borlDiscussion_() {
  var raw = {"name": "Forum Activity: Stock Planning Card", "id": "if2e8061c-bd6d-46d3-9da9-6c0a73d95631_R", "sourceTypeRaw": "imsdt_xmlv1p3", "file": "discussion/i9ef63e3e-bc03-4c33-9f33-c9eb6a24f2ed/discussion_cb15892e-e5aa-413e-bcfc-1e7c041625b3.xml", "xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<topic xmlns=\"http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3 http://www.imsglobal.org/profile/cc/ccv1p3/ccv1p3_imsdt_v1p3.xsd\">\r\n  <title>Forum Activity: Stock Planning Card</title>\r\n  <text texttype=\"text/html\">&lt;p&gt;In this activity, you will complete the following Planting Stock Planning Card. Start by selecting 1 stock type, and complete the card with the correct answers corresponding to the stock type you selected. You can circle, highlight, or mark with an ‘x’ your selections on the card, or you can black out all answers that you do not wish to select. You can share your completed card on the discussion forum.&lt;/p&gt;\r\n&lt;p&gt;&lt;a href=\"/d2l/common/dialogs/quickLink/quickLink.d2l?ou={orgUnitId}&amp;amp;type=coursefile&amp;amp;fileId=Planting+Stock+Planning+Card.docx\" target=\"_blank\" rel=\"noopener\"&gt;Planting Stock Planning Card.docx&lt;/a&gt;&lt;/p&gt;\r\n&lt;p&gt;&lt;a href=\"/d2l/common/dialogs/quickLink/quickLink.d2l?ou={orgUnitId}&amp;amp;type=coursefile&amp;amp;fileId=Planting+Stock+Planning+Card.pdf\" target=\"_blank\" rel=\"noopener\"&gt;Planting Stock Planning Card.pdf&lt;/a&gt;&lt;/p&gt;\r\n&lt;p&gt;&lt;/p&gt;</text>\r\n</topic>", "sourceTextSample": "Forum Activity: Stock Planning Card <p>In this activity, you will complete the following Planting Stock Planning Card. Start by selecting 1 stock type, and complete the card with the correct answers corresponding to the stock type you selected. You can circle, highlight, or mark with an ‘x’ your selections on the card, or you can black out all answers that you do not wish to select. You can share your completed card on the discussion forum.</p> <p><a href=\"/d2l/common/dialogs/quickLink/quickLink.d2l?ou={orgUnitId}&amp;type=coursefile&amp;fileId=Planting+Stock+Planning+Card.docx\" target=\"_blank\" rel=\"noopener\">Planting Stock Planning Card.docx</a></p> <p><a href=\"/d2l/common/dialogs/quickLink/quickLink.d2l?ou={orgUnitId}&amp;type=coursefile&amp;fileId=Planting+Stock+Planning+Card.pdf\" target=\"_blank\" rel=\"noopener\">Planting Stock Planning Card.pdf</a></p> <p></p>", "sourceTextLength": 874, "type": "Discussion", "path": "Module 1 - Introduction to Revegetation and Seedling Requirements"};
  var dest = {"id": "EivpM", "name": "Stock Planning Card Activity", "type": "Discussion", "path": "Module 1 - Introduction to Revegetation and Seedling Requirements", "textSample": "In this activity, you will complete the following Planting Stock Planning Card. Start by selecting 1 stock type, and complete the card with the correct answers corresponding to the stock type you selected. You can circle, highlight, or mark with an ‘x’ your selections on the card, or you can black out all answers that you do not wish to select. You can share your completed card on the discussion forum. Planting Stock Planning Card.docx Planting Stock Planning Card DOCX File Planting Stock Planning Card.pdf Planting Stock Planning Card PDF File", "textLength": 549, "textConfidence": "high", "textEvidenceCompleteness": 0.92, "textScopeKind": "scoped-subtree", "ingestionFailure": {"detected": false, "codes": [], "confidence": "LOW", "metadataHits": 0, "reason": ""}};
  raw.sourceTextSha256 = 'old-hash';
  var source = normalizeSourceItem_(raw);
  CTI_TEST_equal_(source.textSha256,'','Changed text cannot retain old hash');
  CTI_TEST_equal_(source.textLength,source.textSample.length,'Complete normalized sample length');
  var recovered = qaFindCrossItemSemanticRepackagingEvidence_(source,[dest]);
  CTI_TEST_assert_(!!recovered && recovered.carrierId === 'EivpM','Exact supplied discussion is recovered');
  CTI_TEST_assert_(recovered.textComparison.similarity > 0.97,'Learner content exceeds unchanged recovery threshold');
  dest.textSample = 'This discussion asks learners to calculate shipping costs and schedule an unrelated event.';
  dest.textLength = dest.textSample.length;
  CTI_TEST_assert_(!qaFindCrossItemSemanticRepackagingEvidence_(source,[dest]),'Same identity cannot recover unrelated payload');
}
function CTI_TEST_borlImageRefs_() {
  var hash='b0e9dc7707a78956100905e701a60d8962f8f2031e07c8babdaf5e24aa59f7bd';
  var source=normalizeSourceItem_({sourceFiles:[{name:'Microsite_20250228180932080.jpeg',sha256:hash,size:596552,presentInPackage:true},{name:'Student Example.jpeg',size:326512,presentInPackage:true}],sourceImages:['Microsite_20250228180932080.jpeg','Content/Student%20Example.jpeg?ou=104696']});
  var expected=source.assetDetails.filter(function(a){return a.referenceOnly!==true && a.presentInPackage!==false;});
  CTI_TEST_equal_(expected.length,2,'Two package files, no duplicate image expectations');
  CTI_TEST_equal_(source.assetDetails.filter(function(a){return a.referenceOnly;}).length,2,'DOM references retained as diagnostics');
  var match=qaFindAssetEvidence_(expected[0],[{name:'Revegetation.jpeg',sha256:hash,size:596552}]);
  CTI_TEST_equal_(match.method,'SHA256_EXACT','Renamed actual Microsite bytes match');
  CTI_TEST_assert_(qaFindAssetEvidence_(expected[1],[]).score < 0.78,'Unobserved concrete Student Example remains unresolved');
}
function CTI_TEST_qtiMarkup_() {
  var legacy={parser:'ims-qti-dom-v3-condition-semantics',questions:[{type:'single-select',prompt:'<p><span>Which stock type?</span>&#160;</p>',options:['<p>Hitchhiker</p>','<p>Cold-stock</p>'],correctAnswers:['<p>Hitchhiker</p>']}]};
  var parsed=qaNormalizeAssessment_(legacy,'source-qti');
  CTI_TEST_equal_(parsed.questions[0].prompt,'Which stock type?','Legacy prompt strips embedded HTML');
  CTI_TEST_equal_(parsed.questions[0].correctAnswers[0],'Hitchhiker','Legacy answer text normalized');
  CTI_TEST_equal_(legacy.questions[0].prompt,'<p><span>Which stock type?</span>&#160;</p>','Stored evidence retained');
  var current={parser:'ims-qti-dom-v4-learner-text',questions:[{prompt:'What does <p> mean?'}]};
  CTI_TEST_equal_(qaNormalizeAssessment_(current,'source-qti').questions[0].prompt,'What does <p> mean?','Already extracted literals remain literal');
  CTI_TEST_equal_(qaNormalizeAssessment_(current,'coursera-assignment').questions[0].prompt,'What does <p> mean?','Destination literals retained');
}

function CTI_TEST_ownerAnswerGap_() {
  var questions=[];
  for(var i=0;i<13;i++) questions.push({id:String(i),type:'single-select',prompt:'Question '+i+' choose the correct tree.',options:['Pine','Oak'],correctAnswers:['Pine'],answerTextReliable:i!==12,parserConfidence:0.95});
  var assessment={parser:'ims-qti-dom-v4-learner-text',questions:questions,parserConfidence:0.95};
  var target=JSON.parse(JSON.stringify(assessment));target.questions.forEach(function(q){q.answerTextReliable=true;});
  var result=qaStructuredAssessmentComparison_({isStructuredAssessment:true,structuredAssessment:assessment},{structuredAssessment:target});
  CTI_TEST_equal_(result.alignedQuestionCount,13,'All observed prompts align');
  CTI_TEST_equal_(result.status,'UNVERIFIED','12/13 answer evidence must not create a drift claim');
  target.questions[0].correctAnswers=['Oak'];
  CTI_TEST_equal_(qaStructuredAssessmentComparison_({isStructuredAssessment:true,structuredAssessment:assessment},{structuredAssessment:target}).status,'CHANGED','Known wrong answer stays changed despite another evidence gap');
}
function CTI_TEST_ownerFamilyActions_() {
  var r={verdict:'RUNTIME_REVIEW',issues:['RUNTIME_VERIFICATION_REQUIRED','LINK_NOT_OBSERVED'],checks:{transformationFamily:{status:'REVIEW',childCount:2,childNames:['Part A','Part B']},runtime:{runtimeFamilies:['D2L_PRACTICE_RUNTIME']},links:{missing:['https://example.com/required']}}};
  var a=qaOwnerActionForResult_(r);
  CTI_TEST_equal_(typeof a,'object','Structured action contract');
  CTI_TEST_contains_(a.action,'Open the source activity','Runtime obligation survives');
  CTI_TEST_contains_(a.action,'https://example.com/required','Link obligation survives');
  var split=qaOwnerActionForResult_({verdict:'EXPECTED_TRANSFORMATION',issues:[],checks:{transformationFamily:{status:'REVIEW',childCount:4,childNames:['Reading 1','Reading 2','Check 1','Check 2']}}});
  CTI_TEST_equal_(split.severity,'REVIEW','Family REVIEW cannot become no-action');
  CTI_TEST_assert_(split.action.indexOf('positively represented as native Coursera Assignment/rubric')===-1,'No unrelated PDF conversion claim');
  var source={id:'s',name:'Lesson',type:'Reading',textSample:'Trees need water and soil to grow strong roots.'};
  var aggregate={syntheticOneToMany:true,textSample:source.textSample,oneToMany:{childCount:2,childIds:['a','b'],childNames:['Part A','Part B'],textEvidenceRatio:1,strongPayloadEvidenceRatio:1}};
  var decorated=qaDecorateOneToManyResult_(source,aggregate,{verdict:'VERIFIED',issues:[],checks:{content:{status:'VERIFIED'}},earnedPoints:80,possiblePoints:80});
  CTI_TEST_equal_(typeof decorated.ownerAction,'object','Family decoration must never replace action with string');
  CTI_TEST_equal_(decorated.checks.transformationFamily.childIds[0],'a','Family IDs retained for outline association');
}
function CTI_TEST_ownerReadiness_() {
  var items=[{id:'contact',name:'Instructor Contact Information',path:'Start Here!'}];
  var results=[{courseraId:'contact',sourceName:'Instructor Contact Information',verdict:'VERIFIED',checks:{},ownerAction:{severity:'NONE',action:'No action'}}];
  var readiness={findings:[{code:'PLACEHOLDER_CONTACT_INFO',severity:'REVIEW',itemName:items[0].name,path:items[0].path,action:'Replace contact placeholders.'}]};
  qaAttachReadinessActions_(results,items,readiness);
  CTI_TEST_equal_(results[0].verdict,'VERIFIED','Readiness does not rewrite fidelity verdict');
  CTI_TEST_equal_(results[0].ownerAction.severity,'REVIEW','Placeholder task surfaced');
  CTI_TEST_contains_(results[0].ownerAction.action,'Replace contact placeholders.','Action retained');
  CTI_TEST_equal_(qaReadinessForDestination_(items[0],items.concat([{id:'second',name:items[0].name,path:items[0].path}]),readiness).length,0,'Ambiguous duplicate title/path must not receive guessed assignment');
}
function CTI_TEST_ownerMissingDiagnostic_() {
  var source=normalizeSourceItem_({name:'Forum Activity: Stock Planning Card',type:'Discussion',path:'Module 1',sourceTypeRaw:'imsdt_xmlv1p3',sourceTextSample:'Different instructions requiring a calculation about shipping quantities and a written reflection on logistics.'});
  var destination=normalizeCourseraItem_({id:'EivpM',name:'Stock Planning Card Activity',type:'Discussion',path:'Module 1',payload:{textSample:'Complete the planting stock planning card and share it with the class.',textEvidenceCompleteness:0.97,textConfidence:'high'}});
  var d=qaMissingReconciliationDiagnostic_(source,[destination]);
  CTI_TEST_equal_(d.candidates.length,1,'Candidate identity retained despite no semantic proof');
  var result={verdict:'MISSING',issues:['MISSING_ITEM'],checks:{reconciliationDiagnostic:d}};
  var action=qaOwnerActionForResult_(result);
  CTI_TEST_contains_(action.action,'before creating anything','Prevent blind duplication');
  CTI_TEST_equal_(result.verdict,'MISSING','Diagnostic does not silently clear loss finding');
}
function CTI_TEST_ownerOutline_() {
  var items=[{id:'b',name:'Part B',path:'Module 1',type:'Reading',published:false,textSample:'Captured excerpt'},{id:'a',name:'Part A',path:'Module 1',type:'Reading'},{id:'e',name:'Evidence only',evidenceOnly:true}];
  var result={sourceName:'Lesson',verdict:'RUNTIME_REVIEW',courseraId:'aggregate',checks:{transformationFamily:{childIds:['a','b']}},ownerAction:{severity:'REVIEW',action:'Launch the interaction.'}};
  var view=qaBuildDestinationOwnerView_(items,[result],{findings:[]});
  CTI_TEST_equal_(view.items.length,2,'Evidence-only node excluded from structural outline');
  CTI_TEST_equal_(view.items[0].id,'b','XLSX order is preserved');
  CTI_TEST_equal_(view.items[0].status,'REVIEW','Family obligation appears on mapped children');
  CTI_TEST_equal_(view.items[0].excerptComplete,false,'Bounded excerpt never advertised as a full rendering');
}
function CTI_TEST_ownerCurrentAction_() {
  var r={sourceName:'Lesson',ownerAction:{severity:'NONE',label:'No action',action:'Observed fields align.'}};
  qaApplyCurrentStateResolutionsToResults_([r],{resolutions:[{sourceName:'Lesson',severity:'REVIEW',subject:'Grading threshold',status:'STILL_PRESENT'}]});
  CTI_TEST_equal_(typeof r.ownerAction,'object','Resolution preserves action object');
  CTI_TEST_contains_(r.ownerAction.action,'Grading threshold','Current-state task visible');
  CTI_TEST_assert_(r.ownerAction.action.indexOf('[object Object]')===-1,'No stringified object in instruction');
}

function CTI_TEST_discussionXml_() {
  var raw={"name": "Forum Activity: Stock Planning Card", "id": "if2e8061c-bd6d-46d3-9da9-6c0a73d95631_R", "sourceTypeRaw": "imsdt_xmlv1p3", "file": "discussion/i9ef63e3e-bc03-4c33-9f33-c9eb6a24f2ed/discussion_cb15892e-e5aa-413e-bcfc-1e7c041625b3.xml", "sourceTextSample": "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<topic xmlns=\"http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3 http://www.imsglobal.org/profile/cc/ccv1p3/ccv1p3_imsdt_v1p3.xsd\">\r\n  <title>Forum Activity: Stock Planning Card</title>\r\n  <text texttype=\"text/html\">&lt;p&gt;In this activity, you will complete the following Planting Stock Planning Card. Start by selecting 1 stock type, and complete the card with the correct answers corresponding to the stock type you selected. You can circle, highlight, or mark with an ‘x’ your selections on the card, or you can black out all answers that you do not wish to select. You can share your completed card on the discussion forum.&lt;/p&gt;\r\n&lt;p&gt;&lt;a href=\"/d2l/common/dialogs/quickLink/quickLink.d2l?ou={orgUnitId}&amp;amp;type=coursefile&amp;amp;fileId=Planting+Stock+Planning+Card.docx\" target=\"_blank\" rel=\"noopener\"&gt;Planting Stock Planning Card.docx&lt;/a&gt;&lt;/p&gt;\r\n&lt;p&gt;&lt;a href=\"/d2l/common/dialogs/quickLink/quickLink.d2l?ou={orgUnitId}&amp;amp;type=coursefile&amp;amp;fileId=Planting+Stock+Planning+Card.pdf\" target=\"_blank\" rel=\"noopener\"&gt;Planting Stock Planning Card.pdf&lt;/a&gt;&lt;/p&gt;\r\n&lt;p&gt;&lt;/p&gt;</text>\r\n</topic>", "sourceTextLength": 1326, "sourceTextSha256": "raw-xml-hash", "sourceEvidenceBuildId": "v6.6.1-hybrid-payload-recovery-20260911", "type": "Discussion", "path": "Module 1 - Introduction to Revegetation and Seedling Requirements"};
  var dest={"id": "EivpM", "name": "Stock Planning Card Activity", "type": "Discussion", "path": "Module 1 - Introduction to Revegetation and Seedling Requirements", "textSample": "In this activity, you will complete the following Planting Stock Planning Card. Start by selecting 1 stock type, and complete the card with the correct answers corresponding to the stock type you selected. You can circle, highlight, or mark with an ‘x’ your selections on the card, or you can black out all answers that you do not wish to select. You can share your completed card on the discussion forum. Planting Stock Planning Card.docx Planting Stock Planning Card DOCX File Planting Stock Planning Card.pdf Planting Stock Planning Card PDF File", "textLength": 549, "textConfidence": "high", "textEvidenceCompleteness": 0.92, "textScopeKind": "scoped-subtree", "ingestionFailure": {"detected": false, "codes": [], "confidence": "LOW", "metadataHits": 0, "reason": ""}};

  var normalized=normalizeSourceItem_(raw);
  CTI_TEST_equal_(normalized.sourceTextNormalization.status,'NORMALIZED_LEGACY_DISCUSSION_XML','Complete discussion XML parsed');
  CTI_TEST_equal_(normalized.textSample.length,508,'Only learner title and body remain');
  CTI_TEST_assert_(normalized.textSample.indexOf('schemaLocation')===-1 && normalized.textSample.indexOf('quickLink')===-1,'Metadata and URLs excluded');
  CTI_TEST_equal_(normalized.textSha256,'','Raw hash not reused');
  CTI_TEST_equal_(normalized.original.sourceTextSample,raw.sourceTextSample,'Original XML retained');
  var recovered=qaFindCrossItemSemanticRepackagingEvidence_(normalized,[dest]);
  CTI_TEST_assert_(recovered && recovered.textComparison.similarity>0.97,'Actual raw-XML source recovers with existing threshold');
  dest.textSample='An unrelated discussion of shipping schedules and vehicle maintenance, without any planting instructions.';
  dest.textLength=dest.textSample.length;
  CTI_TEST_assert_(!qaFindCrossItemSemanticRepackagingEvidence_(normalized,[dest]),'Unrelated prompt is not recovered');
  var ns=' xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3"';
  var plain=normalizeSourceItem_({sourceTypeRaw:'imsdt_xmlv1p3',sourceTextSample:'<topic'+ns+'><text texttype="text/plain">Show &lt;p&gt; and &amp;lt;p&amp;gt; with 2 &lt; 3.</text></topic>'});
  CTI_TEST_equal_(plain.textSample,'Show <p> and &lt;p&gt; with 2 < 3.','Plain text decoded exactly once');
  var rich=normalizeSourceItem_({sourceTypeRaw:'imsdt_xmlv1p3',sourceTextSample:'<topic'+ns+'><text texttype="text/html"><![CDATA[<p>Show &lt;p&gt; with 2 &lt; 3.</p>]]></text></topic>'});
  CTI_TEST_equal_(rich.textSample,'Show <p> with 2 < 3.','CDATA HTML preserves encoded learner literals');
  [raw.sourceTextSample.slice(0,-9),'<topic'+ns+'><text texttype="application/xml">bad</text></topic>','<!DOCTYPE topic [<!ENTITY x "bad">]>'+raw.sourceTextSample].forEach(function(bad){
    var copy=JSON.parse(JSON.stringify(raw));copy.sourceTextSample=bad;
    // A DOCTYPE-prefixed sample is tested through the recognized XML declaration.
    if(bad.indexOf('<!DOCTYPE')===0) copy.sourceTextSample='<?xml version="1.0"?>'+bad;
    var source=normalizeSourceItem_(copy);
    CTI_TEST_assert_(source.sourceTextRefreshRequired,'Unsupported XML needs source refresh');
    CTI_TEST_equal_(qaTextComparison_(source,dest).status,'UNVERIFIED','Bad XML never produces content drift');
    CTI_TEST_assert_(!qaFindCrossItemStructuralRepackagingEvidence_(source,[dest]),'Bad XML cannot fall back to identity recovery');
    var result={verdict:'MISSING',issues:['MISSING_ITEM'],checks:{reconciliationDiagnostic:{candidates:[{id:'EivpM'}]}}};
    qaApplySourceTextGap_(result,source);
    CTI_TEST_equal_(result.verdict,'UNVERIFIED','Bad source with existing candidate is uncertainty, not proven absence');
    CTI_TEST_equal_(qaOwnerActionForResult_(result).severity,'EVIDENCE','Owner gets source refresh task');
    var missing={verdict:'MISSING',checks:{reconciliationDiagnostic:{candidates:[]}}};
    CTI_TEST_equal_(qaApplySourceTextGap_(missing,source).verdict,'MISSING','No candidate does not clear structural absence');
  });
  ['v6.8.2-learner-text-20260918','v6.8.3-table-text-20260918','v6.8.4-source-text-contract-20260918'].forEach(function(build){
    var current=Object.assign({},raw,{sourceEvidenceBuildId:build});
    var normalizedCurrent=normalizeSourceItem_(current);
    CTI_TEST_equal_(normalizedCurrent.textSample,normalized.textSample,'Raw XML is parsed independently of scanner version '+build);
    CTI_TEST_equal_(normalizedCurrent.textSha256,'','Raw XML hash invalidated '+build);
  });
  raw.sourceEvidenceTruncated=true;
  CTI_TEST_assert_(normalizeSourceItem_(raw).sourceTextRefreshRequired,'Truncation vetoes apparent complete XML');
}

function CTI_TEST_tableMarkup_() {
  var raw={"name": "Forum Activity: X Marks the Spot", "id": "i58cec7bc-060d-4407-938f-26f4bbe9eff3_R", "sourceTypeRaw": "imsdt_xmlv1p3", "file": "discussion/i86167b59-442e-4119-9a10-5c40a1bd20f3/discussion_1933c347-ceb6-4319-b294-37ad5b601d21.xml", "xml": "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<topic xmlns=\"http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3 http://www.imsglobal.org/profile/cc/ccv1p3/ccv1p3_imsdt_v1p3.xsd\">\r\n  <title>Forum Activity: X Marks the Spot</title>\r\n  <text texttype=\"text/html\">&lt;p&gt;In this activity, you will select 1 of 2 images to determine what some potential microsites for planting might be.&lt;/p&gt;\r\n&lt;ul&gt;\r\n&lt;li&gt;You will need to select 1 of the images, look at the image, then edit the image to identify 3 potential microsite options, indicated by adding red or white x’s on the image.&lt;/li&gt;\r\n&lt;li&gt;You will also write 2-3 sentences clarifying your options and explaining your choice.&lt;/li&gt;\r\n&lt;/ul&gt;\r\n&lt;p&gt;You do not need to worry about spacing or density (how close or spread out you plant your seedlings) in this activity. You can use any editor to add markup to your image, such as windows Photo or Paint.&amp;nbsp;&lt;/p&gt;\r\n&lt;p&gt;The images are shown below but can be downloaded as separate files on the course home page.&amp;nbsp;&lt;/p&gt;\r\n&lt;p&gt;&lt;/p&gt;\r\n&lt;table border=\"1\" style=\"border-collapse: collapse; width: 75.7903%; height: 274.93px;\"&gt;&lt;colgroup&gt;&lt;col style=\"width: 49.5558%;\"&gt;&lt;col style=\"width: 50.4442%;\"&gt;&lt;/colgroup&gt;\r\n&lt;tbody&gt;\r\n&lt;tr style=\"height: 44.9297px;\"&gt;\r\n&lt;td&gt;&lt;strong&gt;Option 1:&lt;/strong&gt;&lt;/td&gt;\r\n&lt;td&gt;&lt;strong&gt;Option 2:&lt;/strong&gt;&lt;/td&gt;\r\n&lt;/tr&gt;\r\n&lt;tr style=\"height: 230px;\"&gt;\r\n&lt;td&gt;&lt;img src=\"Content/Option%201.jpeg?ou=104696\" width=\"272\" height=\"133\"&gt;&lt;/td&gt;\r\n&lt;td&gt;&lt;img src=\"Content/Option%202.jpeg?ou=104696\" width=\"275\" height=\"132\" style=\"display: block; margin-left: auto; margin-right: auto;\"&gt;&lt;/td&gt;\r\n&lt;/tr&gt;\r\n&lt;/tbody&gt;\r\n&lt;/table&gt;\r\n&lt;section&gt;\r\n&lt;section&gt;&lt;/section&gt;\r\n&lt;/section&gt;\r\n&lt;section&gt;\r\n&lt;section&gt;\r\n&lt;p&gt;&lt;strong&gt;&lt;/strong&gt;&lt;/p&gt;\r\n&lt;/section&gt;\r\n&lt;/section&gt;</text>\r\n</topic>", "sourceTextSample": "Forum Activity: X Marks the Spot <p>In this activity, you will select 1 of 2 images to determine what some potential microsites for planting might be.</p> <ul> <li>You will need to select 1 of the images, look at the image, then edit the image to identify 3 potential microsite options, indicated by adding red or white x’s on the image.</li> <li>You will also write 2-3 sentences clarifying your options and explaining your choice.</li> </ul> <p>You do not need to worry about spacing or density (how close or spread out you plant your seedlings) in this activity. You can use any editor to add markup to your image, such as windows Photo or Paint.&nbsp;</p> <p>The images are shown below but can be downloaded as separate files on the course home page.&nbsp;</p> <p></p> <table border=\"1\" style=\"border-collapse: collapse; width: 75.7903%; height: 274.93px;\"><colgroup><col style=\"width: 49.5558%;\"><col style=\"width: 50.4442%;\"></colgroup> <tbody> <tr style=\"height: 44.9297px;\"> <td><strong>Option 1:</strong></td> <td><strong>Option 2:</strong></td> </tr> <tr style=\"height: 230px;\"> <td><img src=\"Content/Option%201.jpeg?ou=104696\" width=\"272\" height=\"133\"></td> <td><img src=\"Content/Option%202.jpeg?ou=104696\" width=\"275\" height=\"132\" style=\"display: block; margin-left: auto; margin-right: auto;\"></td> </tr> </tbody> </table> <section> <section></section> </section> <section> <section> <p><strong></strong></p> </section> </section>", "sourceTextLength": 1443, "type": "Discussion", "path": "Module 2 - Microsites and Seedling Survival in the Field"};
  var dest={"textSample": "In this activity, you will select 1 of 2 images to determine what some potential microsites for planting might be. You will need to select 1 of the images, look at the image, then edit the image to identify 3 potential microsite options, indicated by adding red or white x's on the image. You will also write 2-3 sentences clarifying your options and explaining your choice. You do not need to worry about spacing or density (how close or spread out you plant your seedlings) in this activity. You can use any editor to add markup to your image, such as windows Photo or Paint. The images are shown below but can be downloaded as separate files on the course home page. Option 1 Option 2", "textLength": 687, "textConfidence": "high", "textScopeKind": "discussion-prompt", "textEvidenceCompleteness": 0.97, "ingestionFailure": null, "id": "gYHKz", "name": "X Marks the Spot Activity", "path": "Module 2 - Microsites and Seedling Survival in the Field", "type": "Discussion"};

  var source=normalizeSourceItem_(raw);
  CTI_TEST_equal_(source.textSample.length,722,'Only title and learner table labels remain');
  var recovery=qaFindCrossItemSemanticRepackagingEvidence_(source,[dest]);
  CTI_TEST_assert_(recovery&&recovery.textComparison.promptContainment,'Full original prompt matches without lowering thresholds');
  CTI_TEST_equal_(qaLearnerMarkupText_('<table><caption>Choices</caption><colgroup><col style="width:50%"></colgroup><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody><tfoot><tr><td>C</td></tr></tfoot></table>'),'Choices A B C','All table structural tags removed, learner words retained');
  CTI_TEST_equal_(qaLearnerMarkupText_('<p>Use &lt;tbody&gt; and 2 &lt; 3.</p>'),'Use <tbody> and 2 < 3.','Encoded tag examples and inequalities retained');
  var current=normalizeSourceItem_({sourceTypeRaw:'imsdt_xmlv1p3',sourceEvidenceBuildId:'v6.8.3-table-text-20260918',sourceTextSample:'Use <tbody> as a literal.'});
  CTI_TEST_equal_(current.textSample,'Use <tbody> as a literal.','New scanner output is not decoded/stripped again');
  dest.textSample='Discuss why truck maintenance and shipping delays affect fuel costs at a distant warehouse.';
  dest.textLength=dest.textSample.length;
  CTI_TEST_assert_(!qaFindCrossItemSemanticRepackagingEvidence_(source,[dest]),'Matching identity cannot prove unrelated prompt');
}
function CTI_TEST_candidateUncertainty_() {
  function result(candidates){return {verdict:'MISSING',sourceName:'Forum Activity: Test Activity',issues:['MISSING_ITEM'],checks:{structure:{status:'MISSING'},reconciliationDiagnostic:{candidates:candidates}},evidenceCoverage:30};}
  var c={id:'x',name:'Test Activity',confidence:'high',completeness:0.97,comparison:{status:'UNVERIFIED'}};
  var r=qaApplySourceTextGap_(result([c]),{});
  CTI_TEST_equal_(r.verdict,'UNVERIFIED','Inconclusive prompt is not proven absence');
  CTI_TEST_assert_(r.issues.indexOf('SOURCE_DESTINATION_MATCH_UNCONFIRMED')!==-1,'Mapping uncertainty is explicit');
  CTI_TEST_equal_(qaOwnerActionForResult_(r).severity,'EVIDENCE','Owner gets evidence follow-up');
  CTI_TEST_assert_(qaEvidenceStrength_(r).score<=69,'No very-strong failure score');
  CTI_TEST_equal_(r.checks.structure.status,'UNVERIFIED','Structure is not silently verified');
  CTI_TEST_equal_(qaApplySourceTextGap_(result([]),{}).verdict,'MISSING','No candidate retains original missing verdict');
  c.comparison.status='CHANGED';
  CTI_TEST_equal_(qaApplySourceTextGap_(result([c]),{}).verdict,'MISSING','Contradictory comparison is not cleared');
  c.comparison.status='UNVERIFIED';c.confidence='low';
  CTI_TEST_equal_(qaApplySourceTextGap_(result([c]),{}).verdict,'MISSING','Weak destination does not clear missing');
  c.confidence='high';c.completeness=0.4;
  CTI_TEST_equal_(qaApplySourceTextGap_(result([c]),{}).verdict,'MISSING','Weak capture does not clear missing');
}
function CTI_TEST_reliabilityRichText_() {
 var cases=[
  [{Text:{Text:'Nested plain',Html:'<p>Nested plain</p>'},IsDisplayed:true},'Nested plain'],
  [{Text:'',Html:'<p>HTML &amp; fallback</p>'},'HTML & fallback'],
  [{text:{text:'Lower case'}},'Lower case'],
  [{Text:'2 < 3; literal <p>'},'2 < 3; literal <p>'],
  [{unrelated:{secret:'not content'}},''],
  [null,'']
 ];
 cases.forEach(function(x){CTI_TEST_equal_(qaBrightspaceText_(x[0]),x[1],'Rich text variant');});
}
function CTI_TEST_reliabilityAssets_() {
 var a={name:'lesson-file.pdf',size:12345,sha256:Array(65).join('a')};
 var b={name:'lesson_file.pdf',size:12345,sha256:Array(65).join('b')};
 CTI_TEST_assert_(qaAssetSimilarity_(a,b).score<0.78,'Conflicting hashes beat renamed/size evidence');
 var same={name:a.name,size:a.size,sha256:b.sha256};
 CTI_TEST_assert_(qaFindAssetEvidence_(a,[same,a.name]).score<0.78,'A bare duplicate name cannot mask a conflicting hash');
 CTI_TEST_assert_(qaFindAssetEvidence_(a,[a.name,same]).score<0.78,'Evidence order cannot hide the conflict');
 CTI_TEST_equal_(qaFindAssetEvidence_(a,[same,{name:'renamed.pdf',sha256:a.sha256}]).method,'SHA256_EXACT','Exact matching bytes remain authoritative');
 CTI_TEST_equal_(qaAssetSimilarity_({name:'a.jpg',sha256:a.sha256,perceptualHash:Array(65).join('1')},{name:'b.jpg',sha256:b.sha256,perceptualHash:Array(65).join('1')}).method,'IMAGE_PERCEPTUAL','Positive visual equivalence remains supported');
}
function CTI_TEST_reliabilityPrimaryEvidence_() {
 var d=normalizeCourseraItem_({id:'d',type:'Reading',assetEvidenceConfidence:1,linkEvidenceConfidence:1,textEvidenceCompleteness:1,textSample:'Stale text should never return.',textLength:100,textSha256:'oldhash',payload:{assetEvidenceConfidence:0,linkEvidenceConfidence:0,textEvidenceCompleteness:0,textSample:'',textLength:0,textSha256:''}});
 CTI_TEST_equal_(d.textEvidenceCompleteness,0,'Explicit zero completeness is preserved');
 CTI_TEST_equal_(d.assetEvidenceConfidence,0,'Explicit zero asset confidence is preserved');
 CTI_TEST_equal_(d.linkEvidenceConfidence,0,'Explicit zero link confidence is preserved');
 CTI_TEST_equal_(d.textSample,'','Empty current capture cannot resurrect stale text');
 CTI_TEST_equal_(d.textSha256,'','Empty current hash cannot resurrect stale hash');
 var cleared=normalizeCourseraItem_({type:'Reading',published:true,structuredAssessment:{questions:[{prompt:'Stale'}]},files:['stale.pdf'],currentState:{observed:true},timeEstimateMinutes:20,payload:{published:null,structuredAssessment:null,files:null,currentState:null,timeEstimateMinutes:null}});
 CTI_TEST_equal_(cleared.structuredAssessment,null,'Explicitly unobserved assessment cannot inherit stale structure');
 CTI_TEST_equal_(cleared.files.length,0,'Explicit empty files cannot inherit stale attachments');
 CTI_TEST_equal_(cleared.published,null,'Unknown publication is not published');
 CTI_TEST_equal_(cleared.currentState,null,'Unknown current state is not inherited');
 CTI_TEST_equal_(cleared.timeEstimateMinutes,null,'Unknown duration is not zero or stale');
 var text='This sufficiently detailed learner prompt explains the activity, its required submissions, expected answers and grading criteria for the course.';
 d=normalizeCourseraItem_({type:'Reading',payload:{textSample:text,textLength:text.length,textConfidence:'high',textEvidenceCompleteness:0}});
 CTI_TEST_equal_(qaTextComparison_({textSample:text,textLength:text.length},d).status,'UNVERIFIED','Explicit zero cannot be upgraded through legacy completeness inference');
}
function CTI_TEST_reliabilityAssessmentBounds_() {
 var q={prompt:'Which tree species is recommended for the planting activity?',type:'single-select',options:['Spruce','Pine'],correctAnswers:['Spruce'],points:1};
 function model(declared,policy){return {parser:'current',parserConfidence:1,declaredQuestionCount:declared,questions:[q],selectionPolicy:policy};}
 function compare(a,b){return qaStructuredAssessmentComparison_({isStructuredAssessment:true,structuredAssessment:a},{structuredAssessment:b});}
 CTI_TEST_equal_(compare(model(1),model(1)).status,'VERIFIED','Complete strong assessment stays verified');
 CTI_TEST_equal_(compare(model(10),model(10)).status,'UNVERIFIED','Two equal partial captures cannot verify a declared larger assessment');
 CTI_TEST_equal_(compare(model(1),model(10)).status,'UNVERIFIED','One declared larger capture remains incomplete');
 var policy={observed:true,selectCount:1,poolSize:1,randomSelection:false};
 CTI_TEST_equal_(compare(model(1,policy),model(1)).status,'UNVERIFIED','Source-only pool behavior is uncertain');
 CTI_TEST_equal_(compare(model(1),model(1,policy)).status,'UNVERIFIED','Destination-only pool behavior is equally uncertain');
 var norm=qaNormalizeAssessment_(model(1,{observed:true,selectCount:null,poolSize:null,randomSelection:null}),'source');
 CTI_TEST_equal_(norm.selectionPolicy.selectCount,null,'Null selection count must not become zero');
 CTI_TEST_equal_(compare(model(1,{observed:true}),model(1,policy)).status,'UNVERIFIED','Unobserved policy fields cannot become verified');
}
function CTI_TEST_reliabilityBrightspaceAnswers_() {
 var q={QuestionId:1,QuestionTypeId:1,QuestionText:{Text:'Choose the fully correct answer.'},Points:null,QuestionInfo:{Answers:[{Answer:{Text:'Full'},Weight:100},{Answer:{Text:'Partial'},Weight:50},{Answer:{Text:'Wrong'},Weight:0}]}};
 var parsed=qaBrightspaceQuizQuestion_(q,0);
 CTI_TEST_equal_(parsed.type,'single-select','Partial-credit choice does not mutate question type');
 CTI_TEST_assert_(!parsed.answerTextReliable,'Unmodelled partial credit cannot verify an answer key');
 CTI_TEST_equal_(parsed.points,null,'Unknown points are not zero points');
 CTI_TEST_equal_(qaBrightspaceQuestionType_({QuestionTypeId:5}),'unknown','Unsupported matching is not text entry');
 CTI_TEST_equal_(qaBrightspaceQuestionType_({QuestionTypeId:6}),'unknown','Unsupported ordering is not text entry');
 q.QuestionInfo.Answers[1].Weight=0;parsed=qaBrightspaceQuizQuestion_(q,0);
 CTI_TEST_assert_(parsed.answerTextReliable,'Fully observed ordinary choice stays reliable');
 CTI_TEST_equal_(parsed.correctAnswers.join('|'),'Full','Full answer survives');
 q.QuestionTypeId=4;q.QuestionInfo.Answers=[{Answer:{Text:'Yes'},IsCorrect:true},{Answer:{Text:'Unobserved'}}];
 CTI_TEST_assert_(!qaBrightspaceQuizQuestion_(q,0).answerTextReliable,'Missing multi-select answer flags cannot imply incorrect');
}

function CTI_TEST_sourceTextContract_() {
  function fromEvidence(ev) {
    var parsed=parseSourceEvidence_(JSON.stringify({schemaVersion:8,extractor:'CTI Source Evidence v6.8.4',buildId:'v6.8.4-source-text-contract-20260918',resources:{r:ev}}));
    var payload=sourcePayloadForResource_('r',{r:{type:'imsdt_xmlv1p3',files:[],deps:[],evidence:parsed.resources.r}});
    var raw=flattenTreeForQa_([{title:'Activity',type:'imsdt_xmlv1p3',idref:'r',sourcePayload:payload}],'Module 1')[0];
    return {payload:payload,raw:raw,source:normalizeSourceItem_(raw)};
  }
  var literal='<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3"><text texttype="text/plain">An XML example &amp; &lt;p&gt;</text></topic>';
  var ok=fromEvidence({textFormat:'learner-text',textNormalizationStatus:'NORMALIZED',textSample:literal,textLength:literal.length,textSha256:'already-normalized'});
  CTI_TEST_equal_(ok.raw.sourceTextFormat,'learner-text','Format survives payload and flattening');
  CTI_TEST_equal_(ok.source.textSample,literal,'Explicit learner text is not decoded a second time');
  CTI_TEST_equal_(ok.source.textSha256,'already-normalized','Unchanged learner text retains its hash');
  CTI_TEST_assert_(!ok.source.sourceTextRefreshRequired,'Valid literal needs no refresh');
  var bad=fromEvidence({textFormat:'unavailable',textNormalizationStatus:'SOURCE_REFRESH_REQUIRED',textSample:'',textLength:0,files:[{name:'discussion.xml',readError:'parser unavailable'}]});
  CTI_TEST_equal_(bad.raw.sourceTextNormalizationStatus,'SOURCE_REFRESH_REQUIRED','Failure survives payload and flattening');
  CTI_TEST_assert_(bad.source.sourceTextRefreshRequired,'Scanner failure remains explicit');
  CTI_TEST_equal_(qaTextComparison_(bad.source,{textSample:'An existing destination discussion prompt.'}).status,'UNVERIFIED','Failure does not become a drift or verification verdict');
  CTI_TEST_equal_(bad.payload.files[0].readError,'parser unavailable','Original extraction diagnostic retained');
}

function CTI_TEST_captureInputReadiness_() {
  var partial={courseraId:'final',courseraName:'Final Evaluation',verdict:'UNVERIFIED',checks:{structuredAssessment:{status:'UNVERIFIED',courseraQuestionCount:27,courseraDeclaredQuestionCount:79,answerEvidenceCoverage:1}}};
  var before=JSON.stringify(partial);
  var old=qaCourseraCaptureReadiness_({buildId:'v6.14.0-wrapper',activeSpaCrawl:{buildId:'v6.12.0-capless-adaptive-crawl-20260917'}},[partial]);
  CTI_TEST_equal_(old.status,'OLDER_CAPTURE_WITH_GAPS','Actual crawl version takes precedence over wrapper metadata');
  CTI_TEST_equal_(old.observedVersion,'v6.12.0','Uploaded capture version retained');
  CTI_TEST_equal_(old.expectedVersion,'v6.14.0','Available extractor comes from release registry');
  CTI_TEST_contains_(old.action,'A newer version alone does not establish','Version difference alone must not force another crawl');
  CTI_TEST_assert_(old.action.indexOf('upload the newly downloaded')===-1,'No blanket repeat-extraction instruction');
  CTI_TEST_equal_(old.assessmentGaps[0].captured,27,'Captured count is never raised by current app version');
  CTI_TEST_equal_(JSON.stringify(partial),before,'Capture guidance does not rewrite verdict or question evidence');
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({buildId:'v6.14.0-current'},[partial]).status,'CAPTURE_INCOMPLETE','Current extractor with a gap is not blamed on an old version');
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({},[partial]).status,'VERSION_UNKNOWN_WITH_GAPS','Unknown capture version stays unknown');
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({buildId:'v6.14.0-future'},[]).status,'NEWER_CAPTURE','Newer capture not marked obsolete');
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({buildId:'v6.12.0-older'},[]).action,'','Old complete evidence remains usable without a forced re-capture');
  var recovered=JSON.parse(before);recovered.checks.structuredAssessment.courseraQuestionCount=79;recovered.checks.structuredAssessment.status='VERIFIED';
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({buildId:'v6.14.0-current'},[recovered]).assessmentGaps.length,0,'Actual 79/79 capture clears question gap');
}

function CTI_TEST_brightspaceCaptureCounts_() {
  var quizzes=[{id:'a',name:'Practice',questions:[{QuestionId:1},{QuestionId:2}],declaredQuestionCount:2,questionsStatus:'CAPTURED'},
    {id:'b',name:'Final',questions:[],capturedQuestionCount:79,questionsStatus:'CAPTURED',description:{text:'[object Object]'},raw:{Description:{Text:{Text:'This exam has 25 questions.'}}}},
    {id:'c',name:'Restricted',questions:[],questionsStatus:'UNAVAILABLE'},
    {id:'d',name:'Unknown count',questions:[{QuestionId:3}],questionsStatus:'CAPTURED'}];
  var before=JSON.stringify(quizzes),result=qaBrightspaceQuizCaptureSummary_(quizzes);
  CTI_TEST_equal_(result.capturedQuestionDefinitions,3,'Count actual captured definitions, never a supplied counter');
  CTI_TEST_equal_(result.items[1].descriptionQuestionCount,25,'Read nested original description despite the older object-string bug');
  CTI_TEST_equal_(result.items[1].capturedQuestionDefinitions,0,'Zero Final definitions are not filled from package or description');
  CTI_TEST_equal_(result.items[1].status,'NO_DEFINITIONS_CAPTURED','HTTP success does not prove question capture');
  CTI_TEST_equal_(result.items[2].status,'UNAVAILABLE','Permission-limited evidence remains unavailable');
  CTI_TEST_equal_(result.items[3].descriptionQuestionCount,null,'Unknown described count is not inferred from captured count');
  CTI_TEST_equal_(JSON.stringify(quizzes),before,'Input evidence remains intact');
  var applied=qaApplyBrightspaceGroundTruth_([], {course:{title:'BORL113 Course'},topics:[],quizzes:quizzes}, {name:'BORL113 Course'});
  CTI_TEST_equal_(applied.report.quizCapture.capturedQuestionDefinitions,3,'Quiz diagnostics survive into the actual QA report');
  CTI_TEST_equal_(applied.sourceItems.length,0,'Live definitions do not replace the package denominator');
}

function CTI_TEST_extractorDeliveryIntegrity_() {
  var current=ctiExtractorDelivery_('coursera');
  CTI_TEST_assert_(current.success,'Canonical Coursera delivery succeeds');
  CTI_TEST_equal_(current.script,ctiCanonicalCourseraExtractorSource_(),'Delivered source is the complete embedded script');
  CTI_TEST_equal_(current.version,'v6.14.0','Delivered version is v6.14.0');
  CTI_TEST_equal_(current.gatewayRelease,'v8.0.0','Response identifies its deployed app version');
  var original=ctiCanonicalCourseraExtractorSource_;
  try {
    ctiCanonicalCourseraExtractorSource_=function(){return 'old script v6.12.0';};
    CTI_TEST_assert_(!ctiExtractorDelivery_('coursera').success,'An old embedded body cannot be relabeled as the current extractor');
  } finally {ctiCanonicalCourseraExtractorSource_=original;}
  CTI_TEST_equal_(ctiExtractorDelivery_('coursera').script,current.script,'Canonical source restored after fault injection');
  CTI_TEST_assert_(!ctiExtractorDelivery_('unsupported').success,'Unsupported platform remains rejected');
}

function CTI_TEST_questionDifferenceEvidence_() {
  var source={type:'single-select',prompt:'Which microsite option supports this tree species?',options:[{text:'A',correct:false},{text:'B',correct:false},{text:'C',correct:false},{text:'A and B',correct:true},{text:'A, B, or C',correct:false}],correctAnswers:['A and B'],points:1,answerTextReliable:true,optionTextReliable:true};
  var dest=JSON.parse(JSON.stringify(source));dest.options[2].correct=true;dest.options[3].correct=false;dest.correctAnswers=['C'];
  var before=JSON.stringify([source,dest]),result=qaCompareAssessmentQuestion_(source,dest);
  CTI_TEST_assert_(result.mismatches.indexOf('CORRECT_ANSWER')>=0,'A genuinely different answer remains a mismatch');
  CTI_TEST_equal_(result.details.sourceCorrectAnswers[0],'A and B','Source answer survives into review evidence');
  CTI_TEST_equal_(result.details.courseraCorrectAnswers[0],'C','Captured destination answer survives independently');
  CTI_TEST_equal_(result.details.sourceOptions.length,5,'All source options remain available');
  CTI_TEST_equal_(result.details.courseraOptions.length,5,'All captured destination options remain available');
  CTI_TEST_assert_(result.details.courseraOptions[2].correct,'Destination correct marker is retained');
  CTI_TEST_equal_(JSON.stringify([source,dest]),before,'Review evidence does not rewrite either question');
  result.sourceIndex=55;result.courseraIndex=55;
  var action=qaOwnerActionForResult_({verdict:'PARTIAL',issues:['ASSESSMENT_CHANGED'],checks:{structuredAssessment:{answerMismatchCount:1,questionResults:[result]}}});
  CTI_TEST_contains_(action.action,'source Q55 → Coursera Q55','Owner action identifies the affected question positions');
  CTI_TEST_equal_(qaCompareAssessmentQuestion_(source,source).mismatches.length,0,'Identical answer and option evidence remains matched');
}

function CTI_TEST_joinedOptionFeedback_() {
  var labels=['A','B','C','A and B','A, B, or C'];
  [3,2].forEach(function(correctIndex){
    var source={type:'single-select',prompt:'Which microsite option is best for this tree species?',options:labels.map(function(t,i){return {text:t,correct:i===correctIndex};}),correctAnswers:[labels[correctIndex]],answerTextReliable:true,optionTextReliable:true,points:1};
    var dest=JSON.parse(JSON.stringify(source));dest.options.forEach(function(o){o.text+=o.correct?'Correct.':'Incorrect.';});dest.correctAnswers=[dest.options[correctIndex].text];
    var raw=JSON.stringify(dest),result=qaCompareAssessmentQuestion_(source,dest);
    CTI_TEST_equal_(result.mismatches.length,0,'Consistent feedback contamination is not a content mismatch');
    CTI_TEST_equal_(result.details.answerSimilarity,1,'Observed correct answer is preserved exactly');
    CTI_TEST_equal_(result.details.optionFeedbackNormalization.changes.length,5,'All raw rows remain auditable');
    CTI_TEST_equal_(JSON.stringify(dest),raw,'The uploaded capture is not modified');
    var wrong=JSON.parse(JSON.stringify(dest));wrong.options.forEach(function(o,i){o.correct=i===0;o.text=labels[i]+(o.correct?'Correct.':'Incorrect.');});wrong.correctAnswers=[wrong.options[0].text];
    var changed=qaCompareAssessmentQuestion_(source,wrong);
    CTI_TEST_assert_(changed.mismatches.indexOf('CORRECT_ANSWER')>=0,'A genuinely different marked answer survives feedback separation');
  });
}
function CTI_TEST_optionFeedbackSafeguards_() {
  function row(text,correct){return {text:text,label:text,correct:correct};}
  var source=[row('A',true),row('B',false)],dest=[row('ACorrect.',true),row('BIncorrect.',false)];
  CTI_TEST_assert_(ctiSeparateJoinedOptionFeedback_(dest,source),'Entire exact source choice set provides corroboration');
  CTI_TEST_assert_(!ctiSeparateJoinedOptionFeedback_([row('ACorrect.',true),row('XIncorrect.',false)],source),'Different option text cannot be erased');
  CTI_TEST_assert_(!ctiSeparateJoinedOptionFeedback_([row('ACorrect.',true),row('B',false)],source),'Partial pattern stays untouched');
  CTI_TEST_assert_(!ctiSeparateJoinedOptionFeedback_([row('AIncorrect.',true),row('BIncorrect.',false)],source),'Contradictory state stays untouched');
  CTI_TEST_assert_(!ctiSeparateJoinedOptionFeedback_([row('A Correct.',true),row('B Incorrect.',false)],source),'Ordinary separated words are not suffix-stripped');
  CTI_TEST_assert_(!ctiSeparateJoinedOptionFeedback_([row('Correct.',true),row('Incorrect.',false)],source),'Feedback-like answer words remain actual choices');
  CTI_TEST_assert_(!ctiSeparateJoinedOptionFeedback_([row('AnswerCorrect.',true),row('OtherIncorrect.',false)]),'Extractor does not guess prose boundaries from strings');
  CTI_TEST_assert_(!ctiSeparateJoinedOptionFeedback_([row('ACorrect.',true),row('AIncorrect.',false)],source),'Duplicate stripped choices fail the uniqueness check');
  var q={type:'single-select',options:dest,correctAnswers:['BIncorrect.'],optionTextReliable:true,answerTextReliable:true};
  CTI_TEST_assert_(!qaSeparateCourseraOptionFeedback_({options:source},q),'Contradictory answer array blocks legacy normalization');
  q.correctAnswers=['ACorrect.'];q.answerTextReliable=false;
  CTI_TEST_assert_(!qaSeparateCourseraOptionFeedback_({options:source},q),'Unreliable answer evidence cannot be promoted');
}

function CTI_TEST_assignmentLearnerFields_() {
  var a={schemaVersion:4,prompt:'Learner instructions. AI Grader Instructions Private text',learnerPrompt:'Learner instructions.',learnerDirections:'Upload your response.',learnerExpectations:'Use complete sentences.',learnerSemanticText:'Learner instructions. Upload your response. Use complete sentences.',authoringSemanticText:'PRIVATE_EDITOR_SENTINEL',submission:{fileUpload:true},parserConfidence:0.9};
  var normalized=qaNormalizeNativeAssignment_(a);
  CTI_TEST_equal_(normalized.learnerSemanticText,a.learnerSemanticText,'Learner field survives backend normalization');
  CTI_TEST_equal_(normalized.authoringSemanticText,a.authoringSemanticText,'Authoring evidence remains separately available');
  CTI_TEST_equal_(normalized.prompt,a.prompt,'Raw prompt is preserved');
  CTI_TEST_equal_(qaNormalizeNativeAssignment_(normalized).learnerPrompt,a.learnerPrompt,'Normalization is idempotent');
  var legacy=qaNormalizeNativeAssignment_({prompt:'Legacy assignment prompt',parserConfidence:0.9});
  CTI_TEST_equal_(legacy.prompt,'Legacy assignment prompt','Legacy prompt fallback remains available');
}
function CTI_TEST_brightspaceAssignmentInstructions_() {
  var raw={name:'Practice',instructions:{text:'',html:''},raw:{CustomInstructions:{Text:'Submit your file.',Html:'<p>Submit your file.</p>'},SubmissionType:0,SubmissionsRule:3}},original=JSON.stringify(raw);
  var a=qaNormalizeBrightspaceAssignment_(raw);
  CTI_TEST_equal_(a.instructions.text,'Submit your file.','CustomInstructions survives earlier captures');
  CTI_TEST_equal_(a.instructionEvidence.sourceField,'raw.CustomInstructions','Recovery identifies its observed source');
  CTI_TEST_equal_(JSON.stringify(raw),original,'Original capture is unchanged');
  CTI_TEST_equal_(qaBrightspaceAssignmentBehavior_(a).settings.submissionRule,3,'Plural Brightspace SubmissionsRule is retained');
  CTI_TEST_assert_(qaBrightspaceAssignmentBehavior_(a).submission.fileUpload,'Explicit submission type zero means file upload');
  CTI_TEST_assert_(!qaBrightspaceAssignmentBehavior_({raw:{SubmissionType:null}}).observed,'Null submission type is not zero/file upload');
  var behavior=qaBehaviorComparison_({type:'Assignment',behavior:{observed:true,submission:{fileUpload:true},settings:{points:null}}},{nativeAssignment:{submission:{fileUpload:true},settings:{points:10}}});
  CTI_TEST_assert_(behavior.mismatches.indexOf('POINTS_CHANGED')<0,'Missing source points are not zero points');
}
function CTI_TEST_externalWebpageEvidence_() {
  var url='https://example.org/resource?course=1#/lesson-a';
  var source=normalizeSourceItem_({type:'Reading',name:'Resource',path:'Resources',sourceTypeRaw:'imswl_xmlv1p3',sourceLinks:[url]});
  function destination(u){return normalizeCourseraItem_({id:'external',name:'Resource',type:'Plugin',path:'Resources',payload:{textSample:'PLUGIN Choose Plugin External Webpage Edit Configuration',links:[u],linkEvidenceConfidence:0.97,published:false}});}
  var same=destination(url),r=compareItemFidelity_(source,same,1,[same],{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(r.verdict,'EXPECTED_TRANSFORMATION','Exact external web-link wrapper is an evidenced conversion');
  CTI_TEST_equal_(r.checks.externalWebpageTransformation.launchStatus,'NOT_OBSERVED','Link preservation does not claim a working launch');
  CTI_TEST_equal_(r.ownerAction.severity,'REVIEW','Owner still sees a launch review');
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,destination(url.replace('course=1','course=2'))),'Different query targets remain distinct');
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,destination(url.replace('lesson-a','lesson-b'))),'Different fragment routes remain distinct');
  same.linkEvidenceConfidence=0.4;CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,same),'Weak URL evidence cannot establish conversion');
  same=destination(url);same.original.payload.textSample='PLUGIN Unknown Tool';same.textSample='PLUGIN Unknown Tool';CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,same),'Generic plugins are not assumed to be webpage wrappers');
  source=normalizeSourceItem_({type:'Reading',sourceTypeRaw:'imswl_xmlv1p3',sourceLinks:[url,url.replace('course=1','course=2')]});CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,destination(url)),'Distinct source queries are not collapsed into one launch target');
}
function CTI_TEST_targetOnlyPluginEvidence_() {
  var url='https://example.org/resources/#/';
  var source=normalizeSourceItem_({type:'Reading',name:'Resources',sourceTypeRaw:'imswl_xmlv1p3',sourceLinks:[url]});
  var dest=normalizeCourseraItem_({id:'plugin',name:'Resources',type:'Plugin',payload:{
    textSample:'',textLength:0,textConfidence:'none',textEvidenceCompleteness:0,textScopeKind:'plugin-target-only',
    links:[url],linkEvidenceConfidence:0.97,pluginEvidence:{schemaVersion:1,itemId:'plugin',scope:'ITEM_EDITOR',kind:'EXTERNAL_WEBPAGE',
      targets:[{url:url,method:'FRAME_SRC'}],frames:[{src:url,access:'CROSS_ORIGIN_UNREADABLE'}],launchStatus:'NOT_VERIFIED',playbackStatus:'NOT_OBSERVED'}
  }});
  var result=compareItemFidelity_(source,dest,1,[dest],{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(result.verdict,'EXPECTED_TRANSFORMATION','Target evidence works without plugin button text');
  CTI_TEST_equal_(dest.textSample,'','Authoring controls do not count as learner text');
  CTI_TEST_equal_(result.checks.externalWebpageEvidence.runtime.launchStatus,'NOT_VERIFIED','A URL does not verify launch');
  CTI_TEST_equal_(result.checks.externalWebpageEvidence.runtime.inaccessibleFrames,1,'Unread external frame remains explicit');
  CTI_TEST_equal_(result.ownerAction.severity,'REVIEW','Runtime still requires owner review');
  CTI_TEST_contains_(result.evidenceStrength.basis.join(' '),'plugin URL/configuration','Report explains the actual target evidence');
  CTI_TEST_assert_(result.evidenceStrength.basis.join(' ').indexOf('Assignment/rubric') === -1,'Plugin preservation cannot claim assignment evidence');
  var assignment=qaEvidenceStrength_({verdict:'EXPECTED_TRANSFORMATION',checks:{transformation:{confidence:0.96}}});
  CTI_TEST_contains_(assignment.basis.join(' '),'Assignment/rubric','Native assignment transformation retains its own explanation');
}
function CTI_TEST_assignmentXml_() {
  var instruction='This is an optional and ungraded assignment for you to practice submitting assignments in Brightspace.';
  var xml='<assignment xmlns="http://www.imsglobal.org/xsd/imscc_extensions/assignment"><title>Practice Assignment</title><instructor_text texttype="text/html">&lt;p&gt;'+instruction+'&lt;/p&gt;</instructor_text><submission_formats><format type="file"/></submission_formats></assignment>';
  var raw={name:'Practice Assignment',type:'Assignment',sourceTypeRaw:'assignment_xmlv1p0',sourceTextSample:xml,sourceTextLength:xml.length};
  var normalized=normalizeSourceItem_(raw);
  CTI_TEST_equal_(normalized.textSample,'Practice Assignment '+instruction,'Only the assignment title and decoded instruction body become learner text');
  CTI_TEST_equal_(normalized.original.sourceTextSample,xml,'Original XML retained');
  CTI_TEST_assert_(!normalized.sourceTextRefreshRequired,'Complete supported XML is usable');
  var bad=JSON.parse(JSON.stringify(raw));bad.sourceTextSample=xml.slice(0,-12);
  CTI_TEST_assert_(normalizeSourceItem_(bad).sourceTextRefreshRequired,'Malformed XML cannot be promoted');
  bad.sourceTextSample=xml.replace('text/html','application/xml');CTI_TEST_assert_(normalizeSourceItem_(bad).sourceTextRefreshRequired,'Unknown body type cannot become learner text');
  bad.sourceTextSample=xml.replace('imscc_extensions/assignment','unknown/assignment');CTI_TEST_assert_(normalizeSourceItem_(bad).sourceTextRefreshRequired,'Unsupported namespace cannot become learner text');
  bad.sourceTextSample=xml;bad.sourceEvidenceTruncated=true;CTI_TEST_assert_(normalizeSourceItem_(bad).sourceTextRefreshRequired,'Truncated source stays an evidence gap');
  var literal=JSON.parse(JSON.stringify(raw));literal.sourceTextFormat='learner-text';CTI_TEST_equal_(normalizeSourceItem_(literal).textSample,xml,'Explicit learner literals are not decoded as wrapper XML');
}

function CTI_TEST_mergedWebpageEvidence_() {
  var url='https://example.org/resource?course=1#/lesson-a';
  var raw={id:'page-1',name:'Official Resource',type:'Ungraded Plugin',path:'Resources',payload:{},evidenceSources:['Coursera Excel Export']};
  var liveRaw={id:'page-1',name:'New Plugin Item',type:'Plugin',path:'Different live path',payload:{textSample:'Choose Plugin External Webpage Edit Configuration',links:[url],linkEvidenceConfidence:0.97,published:false}};
  var source=normalizeSourceItem_({type:'Reading',name:'Official Resource',path:'Resources',sourceTypeRaw:'imswl_xmlv1p3',sourceLinks:[url]});
  var live=normalizeCourseraItem_(liveRaw),merged=qaMergeCourseraPayload_(normalizeCourseraItem_(raw),live);
  CTI_TEST_equal_(merged.name,raw.name,'XLSX title remains authoritative');
  CTI_TEST_equal_(merged.type,raw.type,'XLSX type remains authoritative');
  CTI_TEST_equal_(merged.path,raw.path,'XLSX placement remains authoritative');
  CTI_TEST_equal_(merged.liveObservedName,liveRaw.name,'Observed title remains separately available');
  CTI_TEST_equal_(merged.capturedLinkUrls[0],url,'Full query and fragment survive merge');
  CTI_TEST_equal_(JSON.stringify(merged.original.payload),'{}','Original structural record is not replaced by a fingerprint');
  var result=compareItemFidelity_(source,merged,1,[merged],{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(result.verdict,'EXPECTED_TRANSFORMATION','Production merge retains the proven wrapper conversion');
  CTI_TEST_equal_(result.checks.externalWebpageTransformation.launchStatus,'NOT_OBSERVED','No working launch is inferred');
  CTI_TEST_equal_(result.ownerAction.severity,'REVIEW','Launch stays an owner review');
  merged.capturedLinkUrls.push('https://example.org/unrelated');
  CTI_TEST_equal_(live.capturedLinkUrls.length,1,'Merged URL array does not mutate normalized live input');
  CTI_TEST_equal_(liveRaw.payload.links.length,1,'Raw fingerprint remains immutable');
}

function CTI_TEST_mergedWebpageSafeguards_() {
  var url='https://example.org/resource?course=1#/lesson-a';
  var source=normalizeSourceItem_({type:'Reading',sourceTypeRaw:'imswl_xmlv1p3',sourceLinks:[url]});
  function merged(id,urls,confidence){
    return qaMergeCourseraPayload_(normalizeCourseraItem_({id:'page-1',name:'Resource',type:'Ungraded Plugin',payload:{}}),normalizeCourseraItem_({id:id,name:'Resource',type:'Plugin',payload:{textSample:'Choose Plugin External Webpage',links:urls,linkEvidenceConfidence:confidence}}));
  }
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,merged('page-2',[url],0.97)),'Matching title with different stable ID cannot prove conversion');
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,merged('',[url],0.97)),'Missing live ID cannot prove conversion');
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,merged('page-1',[url],0.4)),'Weak captured URL evidence stays unverified');
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,merged('page-1',[url],'bad')),'Non-numeric confidence cannot pass');
  var ambiguous=merged('page-1',[url,url.replace('course=1','course=2')],0.97);
  CTI_TEST_equal_(ambiguous.links.length,2,'Distinct configured URL selectors remain separate candidates');
  CTI_TEST_equal_(ambiguous.capturedLinkUrls.length,2,'Distinct full targets are preserved');
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,ambiguous),'Lossy normalized search keys do not prove one configured target');
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,merged('page-1',[url.replace('lesson-a','lesson-b')],0.97)),'Changed fragment remains a distinct target after merge');
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,merged('page-1',[url.replace('course=1','course=2')],0.97)),'Changed query remains a distinct target after merge');
  var noCapture=normalizeCourseraItem_({id:'page-1',type:'Ungraded Plugin',payload:{textSample:'Choose Plugin External Webpage',capturedLinkUrls:[url],linkEvidenceConfidence:0.97}});
  CTI_TEST_assert_(!qaExternalWebpageTransformation_(source,noCapture),'Derived raw evidence is rebuilt from observed links, never trusted as an input claim');
}

function CTI_TEST_legacyWebLinkXml_() {
  var url='https://example.org/launch?course=1&lesson=2#/unit-a';
  var xml='<?xml version="1.0"?><webLink xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imswl_v1p3"><title>External resource</title><url href="'+url.replace(/&/g,'&amp;')+'" target="_blank"/></webLink>';
  var raw={name:'External resource',type:'Reading',sourceTypeRaw:'imswl_xmlv1p3',sourceLinks:[],sourceTextSample:xml,sourceTextLength:xml.length};
  var saved=JSON.stringify(raw),s=normalizeSourceItem_(raw);
  CTI_TEST_equal_(s.sourceLinkNormalization.status,'RECOVERED_STORED_WEBLINK_XML','Valid stored XML supplies a source launch target');
  CTI_TEST_equal_(s.links[0].raw,url,'Query, fragment and decoded XML attribute are preserved');
  CTI_TEST_equal_(s.textSample,'External resource','XML wrapper cannot become learner content');
  CTI_TEST_equal_(JSON.stringify(raw),saved,'Original stored evidence is immutable');
  var prefix=xml.replace('<webLink xmlns=','<wl:webLink xmlns:wl=').replace(/<title>/g,'<wl:title>').replace(/<\/title>/g,'</wl:title>').replace('<url ','<wl:url ').replace('</webLink>','</wl:webLink>');
  CTI_TEST_equal_(qaLegacyWebLinkEvidence_(Object.assign({},raw,{sourceTextSample:prefix})).urls[0],url,'Namespaced prefix is supported');
  var bad=[
    {sourceTextSample:xml.slice(0,-10)},
    {sourceEvidenceTruncated:true},
    {sourceTextSample:xml.replace('imswl_v1p3','unknown')},
    {sourceTextSample:xml.replace('</webLink>','<url href="https://other.example"/></webLink>')},
    {sourceTextSample:xml.replace('https://example.org','javascript:example.org')},
    {sourceTextSample:'<!DOCTYPE webLink [<!ENTITY bad "bad">]>'+xml.replace('<?xml version="1.0"?>','')},
    {sourceLinks:['https://different.example/target']}
  ];
  bad.forEach(function(change){var n=normalizeSourceItem_(Object.assign({},raw,change));CTI_TEST_equal_(n.sourceLinkNormalization.status,'SOURCE_REFRESH_REQUIRED','Unsafe/contradictory stored XML stays unresolved');CTI_TEST_assert_(!qaExternalWebpageTransformation_(n,normalizeCourseraItem_({id:'x',type:'Plugin',payload:{textSample:'Choose Plugin External Webpage',links:[url],linkEvidenceConfidence:0.97}})),'Incomplete or conflicting source cannot verify a wrapper conversion');});
  CTI_TEST_equal_(qaLegacyWebLinkEvidence_(Object.assign({},raw,{sourceTextFormat:'learner-text'})),null,'Explicit learner text is not reparsed as transport XML');
}

function CTI_TEST_webpageDiagnosticReasons_() {
  var raw={type:'Reading',sourceTypeRaw:'imswl_xmlv1p3',sourceLinks:[]};
  var dest=normalizeCourseraItem_({id:'x',type:'Plugin',payload:{textSample:'Choose Plugin External Webpage',links:['https://example.org/a?course=1#/a'],linkEvidenceConfidence:0.97}});
  var source=normalizeSourceItem_(raw),r=compareItemFidelity_(source,dest,1,[dest],{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(r.checks.externalWebpageEvidence.reasonCode,'SOURCE_URL_NOT_CAPTURED','Missing source URL is explicitly diagnosed');
  CTI_TEST_contains_(r.ownerAction.action,'original IMSCC','Owner receives the specific recovery step');
  CTI_TEST_assert_(!r.checks.externalWebpageTransformation,'Missing source is never asserted equivalent');
  source=normalizeSourceItem_(Object.assign({},raw,{sourceLinks:['https://example.org/a?course=2#/a']}));
  CTI_TEST_equal_(qaExternalWebpageEvidence_(source,dest).reasonCode,'LAUNCH_URL_DIFFERS','Full-target mismatch stays explicit');
  source=normalizeSourceItem_(Object.assign({},raw,{sourceLinks:['https://example.org/a?course=1#/a','https://example.org/a?course=2#/a']}));
  CTI_TEST_equal_(qaExternalWebpageEvidence_(source,dest).reasonCode,'SOURCE_URL_AMBIGUOUS','Normalized duplicate keys cannot erase ambiguity');
  source=normalizeSourceItem_(Object.assign({},raw,{sourceLinks:['https://example.org/a?course=1#/a']}));
  CTI_TEST_equal_(qaExternalWebpageEvidence_(source,dest).status,'VERIFIED_CONFIGURATION','Existing complete source URL evidence remains valid');
}

// v8.0.0: reproduction of synthetic aggregate deletion and feedback-only fields.
function CTI_TEST_aggregateStageIds_() {
  var baseline=[{courseraId:'direct'}, {courseraId:'cti-aggregate:source',checks:{transformationFamily:{childIds:['AbC','def']}}}];
  var ctx={mode:'RAW_INGESTION',publicationPolicy:'OBSERVE_NOT_PENALIZE'},mem={rawBaselineRunId:'raw1',rawBaselineItems:baseline};
  var current=[{id:'direct'},{id:'AbC'},{id:'def'}];
  CTI_TEST_equal_(qaApplySnapshotStageGuard_(ctx,mem,current).mode,'RAW_INGESTION','Internal aggregate is not an actual deleted destination item');
  CTI_TEST_equal_(qaApplySnapshotStageGuard_(ctx,mem,current.slice(0,2)).mode,'OPS_CURRENT','Deleted aggregate child remains detected');
  CTI_TEST_equal_(qaApplySnapshotStageGuard_(ctx,mem,[{id:'direct'},{id:'abc'},{id:'def'}]).mode,'OPS_CURRENT','Destination IDs remain case-sensitive');
  CTI_TEST_equal_(baseline[1].courseraId,'cti-aggregate:source','Historical result remains unchanged');
}
function CTI_TEST_aggregateStageHistory_() {
  var baseline=[{courseraId:'direct'},{courseraId:'cti-aggregate:s',checks:{transformationFamily:{childIds:['AbC','def']}}}];
  var result={snapshotContext:{originalMode:'RAW_INGESTION',stageGuardApplied:true,stageGuardReason:'1 destination item(s) that existed in the canonical raw baseline are absent now'},itemResults:baseline};
  CTI_TEST_assert_(qaObsoleteAggregateStageGuard_(result,baseline,false),'All actual children present proves synthetic-ID guard false positive');
  CTI_TEST_assert_(!qaObsoleteAggregateStageGuard_(result,baseline,true),'Explicit later-stage history remains authoritative');
  result.itemResults=[{courseraId:'direct'},{courseraId:'AbC'}];
  CTI_TEST_assert_(!qaObsoleteAggregateStageGuard_(result,baseline,false),'A genuinely absent child prevents history correction');
  result.itemResults=baseline;result.snapshotContext.stageGuardApplied=false;
  CTI_TEST_assert_(!qaObsoleteAggregateStageGuard_(result,baseline,false),'User-chosen later-stage snapshot is never rewritten');
}
function CTI_TEST_feedbackOnlyOptions_() {
  var q={id:'1',type:'single-select',prompt:'Which option applies to this scenario?',options:[{label:'Correct according to this item. A feedback explanation.',correct:true},{label:'Another explanatory sentence.',correct:false}],correctAnswers:['Correct according to this item. A feedback explanation.'],optionTextReliable:true,answerTextReliable:true};
  var before=JSON.stringify(q),guard=ctiGuardOptionEvidence_(q);
  CTI_TEST_equal_(guard.optionCaptureIssue,'FEEDBACK_TEXT_USED_AS_OPTION','Feedback prose is not a proven answer label');
  CTI_TEST_assert_(!guard.answerTextReliable && !guard.optionTextReliable,'Uncertain fields cannot claim complete evidence');
  CTI_TEST_equal_(JSON.stringify(q),before,'Captured strings are preserved');
  CTI_TEST_equal_(ctiOptionFeedbackRisk_([{label:'Correct.',correct:true},{label:'Incorrect.',correct:false}]),'','Literal short choices remain intact');
  CTI_TEST_equal_(ctiOptionFeedbackRisk_([{label:'The statement is Correct.',correct:true},{label:'The statement is Incorrect.',correct:false}]),'','Ordinary answer sentences are not stripped');
  CTI_TEST_equal_(ctiOptionFeedbackRisk_([{label:'Long unprefixed feedback.',correct:true,optionFieldIssue:'FEEDBACK_ONLY_OPTION_FIELD'},{label:'Other feedback.',correct:false}]),'FEEDBACK_ONLY_OPTION_FIELD','Explicit feedback field cannot become a choice');
}

// v8.0.0: injected adapters never call Google or sleep during these fast tests.
function CTI_TEST_conversionAdapter_(files) {
  var io={files:files,requestId:'cti-test-conversion-0001',waits:[],trashed:[],logs:[],random:function(){return 0;}};
  io.wait=function(ms){io.waits.push(ms);};io.trash=function(id){io.trashed.push(id);};io.log=function(message){io.logs.push(message);};return io;
}
function CTI_TEST_driveConversionRetry_() {
  var calls=0,lists=0,blob={testWorkbook:true},metadata=[];
  var io=CTI_TEST_conversionAdapter_({create:function(resource,media){
    calls++;metadata.push(JSON.stringify(resource));CTI_TEST_assert_(media===blob,'Retry must use the same workbook bytes');
    if(calls<3)throw new Error('API call to drive.files.create failed with error: Internal Error');return {id:'success'};
  },list:function(){lists++;return {files:[]};}});
  var out=ctiImportXlsxAsSheet_(blob,'test.xlsx',io);
  CTI_TEST_equal_(out.id,'success','Third conversion attempt can recover a transient service error');
  CTI_TEST_equal_(calls,3,'Attempts are bounded');CTI_TEST_equal_(io.waits.join(','),'1000,2000','Exponential waits occur only after service failures');
  CTI_TEST_equal_(metadata[0],metadata[2],'One request marker persists through retries');CTI_TEST_equal_(lists,3,'Reconcile before retry and after retry success');
  var direct=CTI_TEST_conversionAdapter_({create:function(){return {id:'first'};},list:function(){throw new Error('No lookup expected on normal success');}});
  CTI_TEST_equal_(ctiImportXlsxAsSheet_(blob,'test.xlsx',direct).id,'first','Normal conversion remains one request');CTI_TEST_equal_(direct.waits.length,0,'No extra delay on success');
}
function CTI_TEST_driveConversionRecovery_() {
  var calls=0,io=CTI_TEST_conversionAdapter_({create:function(){calls++;throw new Error('Internal Error');},list:function(options){
    CTI_TEST_contains_(options.q,"appProperties has",'Recovery uses private request identity, not a filename');
    return {files:[
      {id:'another-upload',mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{ctiImportRequest:'different-request'}},
      {id:'already-created',mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{ctiImportRequest:'cti-test-conversion-0001'}},
      {id:'duplicate',mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{ctiImportRequest:'cti-test-conversion-0001'}}
    ]};
  }});
  CTI_TEST_equal_(ctiImportXlsxAsSheet_({},'same-name.xlsx',io).id,'already-created','A confirmed existing conversion is reused');
  CTI_TEST_equal_(calls,1,'Do not create again after recovering uncertain success');CTI_TEST_equal_(io.trashed.join(','),'duplicate','Only this request\'s observed duplicate is cleaned up');
}
function CTI_TEST_driveConversionFailure_() {
  var calls=0,io=CTI_TEST_conversionAdapter_({create:function(){calls++;throw new Error('Internal Error');},list:function(){return {files:[]};}}),message='';
  try{ctiImportXlsxAsSheet_({},'fail.xlsx',io);}catch(e){message=e.message;}
  CTI_TEST_contains_(message,'after 3 attempts','Persistent infrastructure failure remains explicit');CTI_TEST_contains_(message,'QA has not run','Conversion failure never becomes a QA pass');
  CTI_TEST_equal_(calls,3,'Persistent failure cannot loop indefinitely');CTI_TEST_equal_(io.waits.join(','),'1000,2000,4000','Final uncertainty is reconciled after backoff too');
  ['Insufficient permissions','Invalid file format','Storage quota exceeded','Daily limit exceeded','Service invoked too many times for one day: drive.','Unsupported media type'].forEach(function(reason){
    var count=0,noRetry=CTI_TEST_conversionAdapter_({create:function(){count++;throw new Error(reason);},list:function(){throw new Error('No lookup allowed');}}),error='';
    try{ctiImportXlsxAsSheet_({},'bad.xlsx',noRetry);}catch(e){error=e.message;}
    CTI_TEST_equal_(error,reason,'Permanent/unknown error preserved');CTI_TEST_equal_(count,1,'Do not retry permanent/unknown errors');CTI_TEST_equal_(noRetry.waits.length,0,'No backoff for permanent/unknown errors');
  });
  CTI_TEST_assert_(ctiDriveConversionRetryable_({code:503,message:'Service Unavailable'}),'503 eligible');
  CTI_TEST_assert_(ctiDriveConversionRetryable_({code:403,message:'User rate limit exceeded'}),'Explicit rate limit eligible');
  CTI_TEST_assert_(!ctiDriveConversionRetryable_({code:403,message:'Forbidden'}),'Generic access denial never retried');
}
function CTI_TEST_driveConversionLookupFailure_() {
  [function(){throw new Error('Internal Error');},function(){return {files:[],incompleteSearch:true};},function(){return {files:[],nextPageToken:'more'};}].forEach(function(lookup){
    var calls=0,io=CTI_TEST_conversionAdapter_({create:function(){calls++;throw new Error('Internal Error');},list:lookup}),error='';
    try{ctiImportXlsxAsSheet_({},'test.xlsx',io);}catch(e){error=e.message;}
    CTI_TEST_contains_(error,'could not be confirmed','Lookup uncertainty remains visible');CTI_TEST_equal_(calls,1,'No blind additional create when reconciliation fails');
  });
}
function CTI_TEST_driveConversionLegacy_() {
  var calls=0,io=CTI_TEST_conversionAdapter_({insert:function(resource,blob,options){
    calls++;CTI_TEST_equal_(resource.title,'legacy.xlsx','v2 uses title');CTI_TEST_assert_(options.convert===true,'v2 explicitly converts Excel');
    CTI_TEST_equal_(resource.properties[0].visibility,'PRIVATE','Legacy marker is private');throw new Error('Backend Error');
  },list:function(options){
    CTI_TEST_contains_(options.q,"visibility = 'PRIVATE'",'v2 recovery keeps private property scope');
    return {items:[{id:'legacy-created',mimeType:'application/vnd.google-apps.spreadsheet',properties:[{key:'ctiImportRequest',value:'cti-test-conversion-0001',visibility:'PRIVATE'}]}]};
  }});
  CTI_TEST_equal_(ctiImportXlsxAsSheet_({},'legacy.xlsx',io).id,'legacy-created','v2 result shape recovered');CTI_TEST_equal_(calls,1,'Legacy uncertain success not duplicated');
}


// Run the shipped recovery/scoring functions, with a small read-only DOM fixture.
function CTI_TEST_editorRecoveryFixture_(sourceOverride) {
  var source=sourceOverride || ctiCanonicalCourseraExtractorSource_();
  function code(name) {
    var re=/^  (?:async )?function (\w+)\(/gm,m,begin=-1;
    while((m=re.exec(source))) {
      if(begin>=0)return source.slice(begin,m.index);
      if(m[1]===name)begin=m.index;
    }
    throw new Error('Missing extractor function: '+name);
  }
  function node(text,attrs,control) {
    attrs=attrs||{};
    return {innerText:text,textContent:text,visible:true,isConnected:true,
      attributes:Object.keys(attrs).map(function(key){return {name:key,value:attrs[key]};}),
      getAttribute:function(key){return attrs[key]||null;},
      querySelector:function(selector){return control && selector.indexOf('textarea')>=0?{}:null;},
      querySelectorAll:function(){return [];}};
  }
  var roots=[],doc={body:node(''),documentElement:node(''),querySelectorAll:function(selector){return selector.indexOf("[role='dialog']")>=0?roots:[];}};
  var names=['normalizeName','elementAttributeBlob','surfaceRoleBonus','isGenericSmartIngestionName','editorSurfaceSignalScore','candidateSurfaceAncestors','scoreSurfaceForFingerprint','findCurrentEditorSurface'];
  var body=names.map(code).join('\n')+'\nreturn findCurrentEditorSurface;';
  var find=new Function('document','isVisibleElement','isGlobalChromeElement','isLikelyWholeOutlineSurface',body)(doc,
    function(el){return !!el.visible;},function(el){return !!el.chrome;},function(el){return !!el.outline;});
  return {find:find,node:node,document:doc,code:code,roots:function(value){roots=value;}};
}

function CTI_TEST_editorRecoveryIdentity_() {
  var f=CTI_TEST_editorRecoveryFixture_();
  var fp={id:'target-id',name:'Untitled',type:'reading'};
  var editor=f.node('Reading content body with a time estimate',{'class':'item-editor'},true);
  f.roots([editor]);
  CTI_TEST_equal_(f.find(fp,new Set()),null,'Missing identity must not enable generic recovery');
  CTI_TEST_equal_(f.find(fp,new Set(),false),null,'Weak identity must not enable generic recovery');
  CTI_TEST_assert_(f.find(fp,new Set(),true).root===editor,'Strong identity recovers a bounded generic editor without a ReferenceError');
  CTI_TEST_equal_(f.find(fp,new Set([editor]),true),null,'Previously open surface remains excluded');
  editor.visible=false;CTI_TEST_equal_(f.find(fp,new Set(),true),null,'Hidden editor excluded');editor.visible=true;
  editor.chrome=true;CTI_TEST_equal_(f.find(fp,new Set(),true),null,'Global chrome excluded');editor.chrome=false;
  editor.outline=true;CTI_TEST_equal_(f.find(fp,new Set(),true),null,'Whole outline excluded');editor.outline=false;
  var unrelated=f.node('Access is denied',{},false);f.roots([unrelated,f.document.body,f.document.documentElement]);
  CTI_TEST_equal_(f.find(fp,new Set(),true),null,'Access denied text and whole document are not item evidence');
  var known=f.node('Immune pathways',{},false);f.roots([known]);
  CTI_TEST_assert_(f.find({id:'target-id',name:'Immune pathways'},new Set()).root===known,'Independent exact title remains valid without session flag');
}

function CTI_TEST_repeatedStatusOptions_() {
  var labels=['Incorrect.','Incorrect.','Correct.','Incorrect.'];
  var q={type:'single-select',prompt:'Choose the matching explanation.',options:labels.map(function(s,i){return {label:s,text:s,correct:i===2};}),correctAnswers:['Correct.'],answerTextReliable:true,optionTextReliable:true};
  var raw=JSON.stringify(q), guard=ctiGuardOptionEvidence_(q);
  CTI_TEST_equal_(guard.optionCaptureIssue,'FEEDBACK_TEXT_USED_AS_OPTION','Repeated state badges are not distinct answer labels');
  CTI_TEST_assert_(!guard.optionTextReliable && !guard.answerTextReliable,'Neither field may claim verification');
  CTI_TEST_equal_(JSON.stringify(q),raw,'Keep raw evidence intact');
  var source=JSON.parse(raw);source.options=['Alpha','Beta','Gamma','Delta'].map(function(s,i){return {label:s,correct:i===2};});source.correctAnswers=['Gamma'];
  var comparison=qaCompareAssessmentQuestion_(source,q);
  CTI_TEST_equal_(comparison.mismatches.length,0,'Capture uncertainty is not an answer-key mismatch');
  CTI_TEST_equal_(comparison.details.optionTextComparison,'SKIPPED_UNRELIABLE_OPTION_TEXT','Expose the evidence limitation');
  CTI_TEST_equal_(ctiOptionFeedbackRisk_([{label:'Correct.',correct:true},{label:'Incorrect.',correct:false}]),'','Legitimate binary labels remain valid');
  CTI_TEST_equal_(ctiOptionFeedbackRisk_([{label:'Correct.',correct:false},{label:'Incorrect.',correct:true}]),'','Binary labels are independent of grading state');
  CTI_TEST_equal_(ctiOptionFeedbackRisk_([{label:'Correct.',correct:true},{label:'Incorrect.',correct:false},{label:'Neither',correct:false}]),'','A distinct third choice is not a repeated badge set');
  var shipped=CTI_TEST_editorRecoveryFixture_();
  var risk=new Function(shipped.code('ctiOptionLabelLooksLikeFeedback_')+'\n'+shipped.code('ctiOptionFeedbackRisk_')+'\nreturn ctiOptionFeedbackRisk_;')();
  CTI_TEST_equal_(risk(q.options),guard.optionCaptureIssue,'Browser and server use the same evidence rule');
}

function CTI_TEST_unvisitedRecovery_() {
  var f=CTI_TEST_editorRecoveryFixture_();
  var names=['diagnosticNavigated','retryReasonsForDiagnostic','retrySeverity','diagnosticQualityScore','retryDecisionV61318','buildRetryPlan','attachRetryResults'];
  var api=new Function('MAX_RETRY_ITEMS',names.map(f.code).join('\n')+'\nreturn {plan:buildRetryPlan,attach:attachRetryResults};')(12);
  var fps=[],diag=[];
  for(var i=0;i<20;i++) {
    fps.push({id:'item'+i,name:'Item '+i,payload:{}});
    if(i<12)diag.push({id:'item'+i,found:true,editorSurfaceCaptured:true,upgraded:false,completed:true});
  }
  var meta={targets:20,eligibleTargets:20,targetIds:fps.map(function(fp){return fp.id;}),targetDiagnostics:diag,completedTargets:12,unvisitedDueToBudget:8,timeBudgetExhausted:true};
  var plan=api.plan(meta,fps);
  CTI_TEST_equal_(plan.length,20,'All concrete gaps are queued; execution stays time bounded');
  CTI_TEST_equal_(plan.slice(0,8).map(function(p){return p.id;}).join(','),fps.slice(12).map(function(p){return p.id;}).join(','),'All eight untouched targets precede weak recaptures');
  CTI_TEST_assert_(plan.slice(0,8).every(function(p){return p.reasons[0]==='not-attempted';}),'First visits carry an honest reason');
  var retried=plan.slice(0,8).map(function(p){return {id:p.id,found:true,editorSurfaceCaptured:true,upgraded:true,completed:true};});
  var complete=api.attach(JSON.parse(JSON.stringify(meta)),{targets:12,targetDiagnostics:retried},plan);
  CTI_TEST_equal_(complete.retryAttempts,8,'Queued targets are not counted as attempted');
  CTI_TEST_equal_(complete.completedTargets,20,'Completed first visits are added once');
  CTI_TEST_equal_(complete.effectiveNavigated,20,'Coverage includes newly visited targets');
  CTI_TEST_equal_(complete.unvisitedDueToBudget,0,'Recovered queue has no untouched targets');
  CTI_TEST_assert_(complete.allTargetsAttempted,'All eligible targets were actually tried');
  CTI_TEST_assert_(complete.timeBudgetExhausted,'Keep original timeout history');
  CTI_TEST_assert_(!complete.targetDiagnostics[0].retryAttempted,'A planned but unattempted retry stays unattempted');
  var partial=api.attach(JSON.parse(JSON.stringify(meta)),{targets:12,targetDiagnostics:retried.slice(0,3)},plan);
  CTI_TEST_equal_(partial.completedTargets,15,'Partial recovery cannot claim completion');
  CTI_TEST_equal_(partial.unvisitedDueToBudget,5,'Remaining targets stay explicit');
  CTI_TEST_assert_(!partial.allTargetsAttempted,'Incomplete recovery stays incomplete');
  var duplicate=api.attach(JSON.parse(JSON.stringify(meta)),{targetDiagnostics:retried.concat([Object.assign({},diag[0],{upgraded:true})])},plan);
  CTI_TEST_equal_(duplicate.completedTargets,20,'Revisiting a primary target does not double-count it');
  var old=JSON.parse(JSON.stringify(meta));delete old.targetIds;
  CTI_TEST_assert_(api.plan(old,fps).every(function(p){return p.reasons.indexOf('not-attempted')<0;}),'Do not guess the eligible queue in old captures');
}

function CTI_TEST_sourceAttachmentProvenance_() {
  var h='a'.repeat(64),other='b'.repeat(64),source=[{id:'raw',name:'Worksheet.pdf',path:'Module 1',sourceFiles:[{name:'Worksheet.pdf',path:'files/Worksheet.pdf',sha256:h,presentInPackage:true}]}];
  var items=[{name:'Renamed worksheet',assetDetails:[{name:'different-name.pdf',sha256:h}]},{name:'Worksheet.pdf',assetDetails:[{name:'Worksheet.pdf',sha256:other}]}];
  qaAttachSourceAssetProvenance_(items,source);
  CTI_TEST_equal_(qaClassifyExtraItem_(items[0]).classification,'SOURCE_ASSET_CARRIER','Exact bytes establish provenance despite renaming');
  CTI_TEST_assert_(!items[0].sourceAssetProvenance.itemContentVerified && !items[0].sourceAssetProvenance.visibilityVerified,'File identity cannot verify the whole item or learner visibility');
  CTI_TEST_equal_(qaClassifyExtraItem_(items[1]).classification,'CONTENT_EXTRA','Same filename with different bytes remains unverified');
  var classified=Object.assign({},items[0],qaClassifyExtraItem_(items[0]));
  CTI_TEST_assert_(!workExtraItemPolicy_('NAIT',classified).inDecisionGate,'Source-backed attachments do not count as unrelated learner extras');
  items[0].assetDetails.push({name:'Unknown.pdf',sha256:other});qaAttachSourceAssetProvenance_(items,source);
  var mixed=qaClassifyExtraItem_(items[0]);
  CTI_TEST_equal_(mixed.classification,'PARTIAL_SOURCE_ASSET_CARRIER','One known attachment cannot hide other unmatched files');
  CTI_TEST_assert_(workExtraItemPolicy_('NAIT',Object.assign({},items[0],mixed)).inDecisionGate,'Mixed source and unrelated files retain extra review');
  items[0].assetDetails.pop();items[0].assetDetails.push({name:'Uncaptured.pdf',url:'https://example.test/Uncaptured.pdf'});qaAttachSourceAssetProvenance_(items,source);
  CTI_TEST_equal_(qaClassifyExtraItem_(items[0]).classification,'PARTIAL_SOURCE_ASSET_CARRIER','An un-hashed download also prevents full attachment provenance');
  items[0].ingestionFailure={detected:true,codes:['DISTILLATION_ERROR']};
  CTI_TEST_equal_(qaClassifyExtraItem_(items[0]).classification,'INGESTION_FAILURE_EXTRA','A real ingestion failure overrides attachment provenance');
  source[0].sourceFiles[0].presentInPackage=false;qaAttachSourceAssetProvenance_(items,source);
  CTI_TEST_equal_(items[0].sourceAssetProvenance,null,'Reference-only or absent source bytes cannot establish provenance');
}

function CTI_TEST_pdfDescriptionScope_() {
  var hash='c'.repeat(64),description='A concise overview of the immune system, published by the specified institute for learners to use as a reference.';
  var source=normalizeSourceItem_({id:'pdf',type:'Reading',sourceFiles:[{name:'Guide.pdf',sha256:hash,presentInPackage:true}],sourceTextSample:description,sourceTextLength:description.length,sourceTextFormat:'learner-text'});
  var dest=normalizeCourseraItem_({id:'dest',type:'Reading',payload:{assetDetails:[{name:'Guide.pdf',sha256:hash}],textSample:'\u200b / 63 100% Guide to Immunology',textConfidence:'high',textEvidenceCompleteness:0.95}});
  var result=qaTextComparison_(source,dest);
  CTI_TEST_equal_(result.reasonCode,'DESCRIPTION_VS_DOCUMENT_SURFACE','Document preview and source description are separate fields');
  CTI_TEST_equal_(result.status,'UNVERIFIED','Identical PDF does not prove its description survived');
  CTI_TEST_equal_(result.documentIdentity,'SHA256_EXACT','Document bytes remain positively verified');
  dest.assetDetails[0].sha256='d'.repeat(64);
  CTI_TEST_equal_(qaDocumentScopeComparison_(source,dest),null,'Changed document cannot receive the preserved-document exception');
  dest.assetDetails[0].sha256=hash;dest.textSample='A wholly different ordinary learner-facing body without a PDF viewer marker. '.repeat(4);
  CTI_TEST_equal_(qaDocumentScopeComparison_(source,dest),null,'Ordinary body drift is not hidden by a matching attachment');
}

function CTI_TEST_pluginTargetEvidence_() {
  var source={type:'Reading',sourceTypeRaw:'imswl_xmlv1p3',sourceLinkUrls:['https://www.youtube.com/watch?v=h9mqsllg1Cs']};
  var dest={id:'plugin',type:'Plugin',textSample:'Choose Plugin YouTube Edit Configuration',capturedLinkUrls:['https://cdn.example.org/youtube/index.html'],linkEvidenceConfidence:0.97};
  CTI_TEST_equal_(qaExternalWebpageEvidence_(source,dest).reasonCode,'YOUTUBE_TARGET_UNOBSERVED','Wrapper alone proves no target');
  dest.pluginEvidence={itemId:'plugin',scope:'ITEM_EDITOR',kind:'YOUTUBE',targets:[{url:'https://www.youtube.com/embed/h9mqsllg1Cs'}],frames:[{access:'CROSS_ORIGIN_UNREADABLE'}]};
  var actual=qaExternalWebpageEvidence_(source,dest);
  CTI_TEST_equal_(actual.status,'VERIFIED_CONFIGURATION','Observed video identity survives equivalent embed form');
  CTI_TEST_equal_(actual.runtime.launchStatus,'NOT_VERIFIED','Configuration and frame existence do not prove launch');
  CTI_TEST_equal_(actual.runtime.inaccessibleFrames,1,'Inaccessible frame stays explicit');
  dest.pluginEvidence.targets[0].url+='?start=60';
  CTI_TEST_equal_(qaExternalWebpageEvidence_(source,dest).reasonCode,'LAUNCH_URL_DIFFERS','Time offsets cannot silently disappear');
  dest.pluginEvidence.targets[0].url='https://www.youtube.com/embed/Bl6vWLqL2D0';
  CTI_TEST_equal_(qaExternalWebpageEvidence_(source,dest).reasonCode,'LAUNCH_URL_DIFFERS','Another video is a real target difference');
  dest.pluginEvidence.itemId='different-item';
  CTI_TEST_equal_(qaExternalWebpageEvidence_(source,dest).reasonCode,'YOUTUBE_TARGET_UNOBSERVED','Configuration from another item is rejected');
  var merged=qaMergeCourseraPayload_({id:'right',links:[]},{id:'wrong',pluginEvidence:{itemId:'wrong',scope:'ITEM_EDITOR'}});
  CTI_TEST_equal_(merged.pluginEvidence,null,'Name-only merge cannot import plugin configuration');
}

function CTI_TEST_placeholderPolicyConsistency_() {
  var items=[{id:'a',name:'[EMPTY] Course-Specific Resources',path:'Instructor Resources',type:'Reading'}];
  var result=qaAssessDestinationReadiness_(items,{}, {},{mode:'RAW_INGESTION'},null,'NAIT');
  CTI_TEST_equal_(result.reviewCount,0,'NAIT instructor placeholder does not become a learner blocker');
  CTI_TEST_assert_(result.findings[0].policyExempt && result.findings[0].severity==='INFO','Exempt placeholder remains visible for audit');
  items[0].path='Module 1';
  CTI_TEST_equal_(qaAssessDestinationReadiness_(items,{}, {},{mode:'RAW_INGESTION'},null,'NAIT').reviewCount,1,'Learner-facing empty item still needs review');
  items[0].path='Instructor Resources';
  CTI_TEST_equal_(qaAssessDestinationReadiness_(items,{}, {},{mode:'RAW_INGESTION'},null,'OTHER').reviewCount,1,'Do not impose NAIT exemptions on another partner');
}

function CTI_TEST_editorTraversalTruth_() {
  var meta={buildId:'v6.14.0-test',activeSpaCrawl:{eligibleTargets:3,targets:3,targetIds:['a','b','c'],allTargetsAttempted:true,unvisitedDueToBudget:0,completedTargets:2,
    targetDiagnostics:[{id:'a',found:true,editorSurfaceCaptured:true},{id:'b',found:false},{id:'c',found:false,retryResult:{found:true,navigated:true,surface:true}}]}};
  var t=qaCaptureTraversalSummary_(meta);
  CTI_TEST_equal_(t.visited,2,'Search attempts never count as observed editors');
  CTI_TEST_equal_(t.unresolvedItemIds.join(','),'b','A successful retry resolves only its own item');
  CTI_TEST_equal_(qaCourseraCaptureReadiness_(meta,[]).status,'EDITOR_TRAVERSAL_INCOMPLETE','Coverage warning is independent of assessment gaps');
  var r=qaAssessDestinationReadiness_([],null,meta,{mode:'RAW_INGESTION'},null,'NAIT');
  CTI_TEST_equal_(r.evidenceGapCount,1,'Unreached editors remain visible at readiness');
  CTI_TEST_equal_(r.status,'REVIEW','Unreached editors cannot be READY');
  CTI_TEST_equal_(qaApplyDestinationReadinessPolicy_({recommendationCode:'KEEP'},r).recommendationCode,'REVIEW','Capture gaps block automatic KEEP');
  meta.activeSpaCrawl.targetDiagnostics[1]={id:'b',found:true,editorSurfaceCaptured:true};
  CTI_TEST_assert_(qaCaptureTraversalSummary_(meta).complete,'Fully observed editors clear only the traversal warning');
}

function CTI_TEST_questionImageFailure_() {
  var assessment={questions:[{id:'q1',prompt:'Explain what [Error: Image could not be created] means.'},{id:'q2',prompt:'[Error: Image could not be created]',type:'essay'}]};
  var f=qaNormalizeIngestionFailure_(null,'Final Assessment','',assessment);
  CTI_TEST_assert_(f.detected,'An exact failed question prompt is a content defect');
  CTI_TEST_equal_(f.questionErrors.length,1,'Explanatory prose does not trigger the sentinel');
  CTI_TEST_equal_(f.questionErrors[0].ordinal,2,'Retain the exact question position');
  CTI_TEST_contains_(f.reason,'2','The owner receives the affected question number');
  CTI_TEST_assert_(!qaNormalizeIngestionFailure_(null,'About image errors','[Error: Image could not be created]').detected,'Incidental body wording alone is insufficient');
}

function CTI_TEST_emptyAssessmentSurface_() {
  var item={id:'wk1',name:'Week 1 Assessment',type:'Assignment',path:'Module 1',textSample:'Assignment outline Content Content you add will show in order here. Select content type',textEvidenceCompleteness:0.84,textScopeKind:'scoped-subtree'};
  var r=qaAssessDestinationReadiness_([item],null,{},null,null,'NAIT');
  CTI_TEST_assert_(r.findings.some(function(f){return f.code==='EMPTY_ASSESSMENT_EDITOR_OBSERVED'&&f.severity==='REVIEW';}),'An explicit empty editor merits a targeted check');
  item.structuredAssessment={questions:[{prompt:'Actual question'}]};
  CTI_TEST_assert_(!qaAssessDestinationReadiness_([item],null,{},null,null,'NAIT').findings.some(function(f){return f.code==='EMPTY_ASSESSMENT_EDITOR_OBSERVED';}),'Actual questions override boilerplate');
  item.structuredAssessment=null;item.textEvidenceCompleteness=0.2;
  CTI_TEST_assert_(!qaAssessDestinationReadiness_([item],null,{},null,null,'NAIT').findings.some(function(f){return f.code==='EMPTY_ASSESSMENT_EDITOR_OBSERVED';}),'A shallow surface cannot prove an empty state');
}

function CTI_TEST_assessmentExactReservation_() {
  function q(id,p){return {id:id,type:'essay',prompt:p,options:[],correctAnswers:[],parserConfidence:0.95};}
  var a='Calculate the percentage of airflow coverage for the space shown. Typed answers, typed documents, and pictures of written answers are acceptable forms of submission.';
  var b='Calculate the perimeter of each of the four spaces. Typed answers, typed documents, and pictures of written answers are acceptable forms of submission.';
  var source={isStructuredAssessment:true,structuredAssessment:{parserConfidence:0.95,questions:[q('1',a),q('2',b)]}};
  var dest={structuredAssessment:{parserConfidence:0.95,questions:[q('1','[Error: Image could not be created]'),q('2',b)]}};
  var r=qaStructuredAssessmentComparison_(source,dest);
  CTI_TEST_equal_(r.questionResults.length,1,'Generic submission wording cannot steal an exact later prompt');
  CTI_TEST_equal_(r.questionResults[0].sourceIndex,2,'Preserve source question identity');
  CTI_TEST_equal_(r.questionResults[0].courseraIndex,2,'Preserve destination question identity');
  CTI_TEST_equal_(r.unmatchedSourceQuestions.join(','),'1','The missing prompt remains unresolved');
}

function CTI_TEST_contentUrlIdentity_() {
  var first='https://opentextbc.ca/mathfortrades1/?p=83/#main',second='https://opentextbc.ca/mathfortrades1/?p=156/#main';
  CTI_TEST_assert_(qaNormalizeUrl_(first)!==qaNormalizeUrl_(second),'Different chapters cannot collapse to one domain/path');
  CTI_TEST_assert_(!qaFindLink_(first,[second]),'A different chapter cannot verify the source link');
  CTI_TEST_equal_(qaNormalizeUrl_('https://example.com/a?p=2&utm_source=test#section'),'example.com/a?p=2#section','Only known tracking parameters may be removed');
  CTI_TEST_assert_(!qaFindLink_({raw:first,normalized:'opentextbc.ca/mathfortrades1'},[{raw:second,normalized:'opentextbc.ca/mathfortrades1'}]),'Old serialized normalized keys cannot hide distinct raw URLs');
}
function CTI_TEST_questionMediaGate_() {
  var question={id:'1',type:'essay',prompt:'Calculate the floor area shown in the diagram.',mediaRefs:['diagram.png']};
  var source={isStructuredAssessment:true,structuredAssessment:{parserConfidence:0.95,questions:[question]}},dest={structuredAssessment:{parserConfidence:0.95,questions:[{id:'1',type:'essay',prompt:question.prompt}]}};
  var r=qaStructuredAssessmentComparison_(source,dest);
  CTI_TEST_equal_(r.answerEvidenceCoverage,1,'Written responses do not require an automatic answer key');
  CTI_TEST_equal_(r.status,'UNVERIFIED','Text agreement cannot certify unobserved diagrams');
  CTI_TEST_equal_(r.sourceMediaQuestionNumbers.join(','),'1','Identify the diagram-dependent question');
}

function CTI_TEST_unreadLinkCarrier_() {
  var source={path:'Module 1 > Chapters',links:[{raw:'https://example.org/?p=83'}]};
  var meta={activeSpaCrawl:{eligibleTargets:1,targetIds:['hub'],targetDiagnostics:[{id:'hub',found:false}],allTargetsAttempted:true}};
  var dest=[{id:'hub',name:'Learning resources',path:'Module 1',type:'Reading'}];
  function missing(){return {verdict:'MISSING',issues:['MISSING_ITEM'],checks:{structure:{status:'MISSING'}},evidenceCoverage:30};}
  var r=qaApplyUnreachedCarrierGap_(missing(),source,dest,meta);
  CTI_TEST_equal_(r.verdict,'UNVERIFIED','Unread same-module content is not proof of absence');
  CTI_TEST_assert_(r.checks.captureGap.candidates[0].id==='hub','The precise follow-up item is retained');
  CTI_TEST_assert_(qaOwnerActionForResult_(r).action.indexOf('before creating')>=0,'Recovery precedes an unnecessary course edit');
  dest[0].path='Module 2';CTI_TEST_equal_(qaApplyUnreachedCarrierGap_(missing(),source,dest,meta).verdict,'MISSING','Unrelated modules do not suppress structural absence');
  dest[0].path='Module 1';meta.activeSpaCrawl.targetDiagnostics[0]={id:'hub',found:true,editorSurfaceCaptured:true};
  CTI_TEST_equal_(qaApplyUnreachedCarrierGap_(missing(),source,dest,meta).verdict,'MISSING','A fully observed carrier cannot create this capture-gap exception');
}

function CTI_TEST_failureMediaGuidance_() {
  var r={verdict:'INGESTION_FAILURE',issues:['INGESTION_FAILURE'],checks:{ingestionFailure:{codes:['QUESTION_IMAGE_CREATION_ERROR'],reason:'Error prompts in questions 2, 4.'},structuredAssessment:{sourceMediaQuestionNumbers:[1,2,4],sourcePackageMediaGaps:[{question:1,status:'NOT_IN_PACKAGE'},{question:2,status:'PRESENT_DIFFERENT_PATH'}]}}};
  var a=qaOwnerActionForResult_(r);
  CTI_TEST_equal_(a.severity,'CRITICAL','Confirmed defect remains critical');
  CTI_TEST_contains_(a.action,'Error prompts in questions 2, 4','Observed failure retained');
  CTI_TEST_contains_(a.action,'source question(s) 1','Absent source media is not hidden by destination failure');
  CTI_TEST_contains_(a.action,'different package paths','Mislocated media gets a different remedy');
  CTI_TEST_assert_(a.label.indexOf('Re-ingest')===-1,'Failure label must not override ingestion-version guard');
  delete r.checks.structuredAssessment;
  CTI_TEST_assert_(qaOwnerActionForResult_(r).action.indexOf('those files are absent')===-1,'Never invent package gaps for failures without media evidence');
}
function CTI_TEST_writtenAnswerApplicability_() {
  function item(type){return {isStructuredAssessment:true,structuredAssessment:{questions:[{id:'q1',type:type,prompt:'Explain your reasoning.',options:[],correctAnswers:[]}],parserConfidence:1}};}
  CTI_TEST_equal_(qaStructuredAssessmentComparison_(item('essay'),item('essay')).answerEvidenceApplicable,false,'Essay pair does not advertise a verified auto-answer key');
  CTI_TEST_equal_(qaStructuredAssessmentComparison_(item('text-entry'),item('text-entry')).answerEvidenceApplicable,true,'Short-answer questions still require answer evidence');
  CTI_TEST_equal_(qaStructuredAssessmentComparison_(item('unknown'),item('unknown')).answerEvidenceApplicable,true,'Unknown types do not waive answer verification');
}

function CTI_TEST_readingRecoveryFixture_() {
  var t0='2026-09-20T10:00:00.000Z',t1='2026-09-20T20:00:00.000Z',t2='2026-09-20T20:00:04.000Z';
  var base={extractedAt:t0,page:{courseId:'course'},meta:{activeSpaCrawl:{targetIds:['reading','other'],targets:2,eligibleTargets:2,targetDiagnostics:[{id:'reading',found:false},{id:'other',editorSurfaceCaptured:true}]}},fingerprints:[
    {id:'reading',name:'Reading',type:'Reading',typeName:'supplement',payload:{textSample:'atom~opaque',files:['old.pdf'],published:false}},
    {id:'other',type:'Assignment',typeName:'assignment',payload:{structuredAssessment:{questions:[{prompt:'Keep this prompt',correctAnswers:['Keep this answer']} ]}}}
  ]};
  var recovery={kind:'CTI_COURSERA_READING_RECOVERY',scope:'SUPPLEMENTAL_READING_RECOVERY_NOT_A_FULL_COURSE_CAPTURE',courseId:'course',version:'6.13.11',startedAt:t1,finishedAt:t2,targetSelection:{baselineCapture:t0,ids:['reading']},readings:[{item:{id:'reading',typeName:'supplement'},capturedAt:t2,payload:{files:[],links:['https://example.org/?p=26/#main'],textSample:'Recovered reading body.',textEvidenceCompleteness:.95,readingEditorEvidence:{courseId:'course',itemId:'reading',fieldTestId:'course+reading',identity:'exact-course-plus-item-reading-content-field',route:'https://www.coursera.org/teach/example/course/content/item/supplement/reading',observedAt:t2,frames:[],unreadFrameCount:0}}}]};
  return {base:base,recovery:recovery};
}
function CTI_TEST_readingRecoveryMerge_() {
  var f=CTI_TEST_readingRecoveryFixture_(),original=JSON.stringify(f.base),r=qaApplyReadingRecovery_(f.base,f.recovery,'recovery.json');
  CTI_TEST_equal_(JSON.stringify(f.base),original,'Original capture is immutable');
  CTI_TEST_equal_(JSON.stringify(r.fingerprints[1]),JSON.stringify(f.base.fingerprints[1]),'Assessment evidence stays byte-identical');
  CTI_TEST_equal_(r.extractedAt,f.base.extractedAt,'Original capture time is retained');
  CTI_TEST_equal_(r.fingerprints[0].payload.files[0],'old.pdf','Previously observed assets survive a DOM-only recovery');
  CTI_TEST_equal_(r.fingerprints[0].payload.published,false,'Publication evidence is not discarded');
  CTI_TEST_equal_(qaCaptureTraversalSummary_(r.meta).visited,2,'Recovered editor counts once');
  CTI_TEST_equal_(r.meta.supplementalReadingRecovery.wholeCourseRecaptured,false,'Recovery never claims whole-course recapture');
}
function CTI_TEST_readingRecoveryIdentity_() {
  ['course','baseline','duplicate','item','route','field','time','type'].forEach(function(kind){
    var f=CTI_TEST_readingRecoveryFixture_(),r=f.recovery,e=r.readings[0].payload.readingEditorEvidence;
    if(kind==='course')r.courseId='wrong';
    if(kind==='baseline')r.targetSelection.baselineCapture='2025-01-01';
    if(kind==='duplicate')r.readings.push(r.readings[0]);
    if(kind==='item')r.readings[0].item.id='unknown';
    if(kind==='route')e.route=e.route+'-other';
    if(kind==='field')e.fieldTestId='course+other';
    if(kind==='time')e.observedAt='2027-01-01T00:00:00.000Z';
    if(kind==='type')f.base.fingerprints[0].typeName='assignment';
    CTI_TEST_throws_(function(){qaApplyReadingRecovery_(f.base,r,'recovery.json');},'Reading recovery JSON',kind+' mismatch rejected');
  });
}
function CTI_TEST_readingRecoveryScopes_() {
  var source={textSample:'A substantive source description with enough words for a proper evidence comparison. '.repeat(5),textLength:415};
  var cases=[['\u200b / 0 100% Loading...','READING_STILL_LOADING'],['\u200b / 8 100% A single rendered PDF page containing only part of the document.','DOCUMENT_PAGES_NOT_VERIFIED'],['x'.repeat(24000),'TEXT_SAMPLE_LIMIT_REACHED']];
  cases.forEach(function(row){
    var item=normalizeCourseraItem_({id:'r',type:'Reading',payload:{textSample:row[0],textConfidence:'high',textEvidenceCompleteness:.95,textScopeKind:'reading-content-field'}});
    CTI_TEST_equal_(qaReadingEvidenceGap_(item).code,row[1],'Scope gap detected');
    CTI_TEST_equal_(qaTextComparison_(source,item).status,'UNVERIFIED','Scope gap is not deletion or verified preservation');
    CTI_TEST_assert_(item.textEvidenceCompleteness<.75,'Incomplete viewer/body evidence is capped');
  });
  var routeOnly={activeSpaCrawl:{targetIds:['reading'],eligibleTargets:1,targetDiagnostics:[{id:'reading',found:true,navigated:true,routeChanged:true}]}};
  CTI_TEST_equal_(qaCaptureTraversalSummary_(routeOnly).visited,0,'Route change without observed editor is not a visit');
}

function CTI_TEST_rejectFocusedDiagnostic_() {
  [{kind:'FOCUSED_EXTRACTOR_DIAGNOSTIC'},{notForCourseAudit:true},{schemaVersion:'CTI_EXTRACTOR_TRIAL_V1'}].forEach(function(value){
    var rejected=false;
    try{qaAssertNotDiagnosticCapture_(value);}catch(error){rejected=/focused extractor trial/.test(String(error.message));}
    CTI_TEST_assert_(rejected,'Diagnostic markers must reject the file as a full capture');
  });
  qaAssertNotDiagnosticCapture_({schemaVersion:33,fingerprints:[]});
  qaAssertNotDiagnosticCapture_({schemaVersion:2,api:{}});
}

function CTI_TEST_emptyAssessmentBodyScope_() {
  var body='Learning objectives This assignment is testing 0 learning objectives Content * Generate questions Use Generative AI to create auto-graded questions based on your learning objectives Create AI-graded question Craft open-ended questions and get instant AI-powered grading. Prefer to manually add content? Select content type';
  var item={id:'week1',type:'Assignment',name:'Week 1 Assessment',textSample:body,textScopeKind:'scoped-subtree',textEvidenceCompleteness:0.35};
  var meta={activeSpaCrawl:{targetDiagnostics:[{id:'week1',editorSurfaceCaptured:true,strongIdentitySeed:true,stabilityTimedOut:false}]}};
  CTI_TEST_assert_(qaObservedEmptyAssessmentBody_(item,meta),'Exact live empty-body template is recognized');
  var r=qaAssessDestinationReadiness_([item],null,meta,{mode:'RAW_INGESTION'},null,'NAIT');
  var findings=r.findings.filter(function(f){return f.code==='EMPTY_ASSESSMENT_BODY_REVIEW';});
  CTI_TEST_equal_(findings.length,1,'One review finding');
  CTI_TEST_equal_(findings[0].severity,'REVIEW','Never assert loss from a narrow body capture');
  CTI_TEST_assert_(!qaObservedEmptyAssessmentBody_(item,{}),'No identity evidence means no observed empty claim');
  var questionItem=JSON.parse(JSON.stringify(item));questionItem.structuredAssessment={questions:[{prompt:'A real question'}]};
  CTI_TEST_assert_(!qaObservedEmptyAssessmentBody_(questionItem,meta),'Existing questions override generic creation controls');
  var instruction=JSON.parse(JSON.stringify(item));instruction.textSample='Read this tutorial: '+body;
  CTI_TEST_assert_(!qaObservedEmptyAssessmentBody_(instruction,meta),'Instructions quoting UI text are not empty state');
  meta.activeSpaCrawl.targetDiagnostics[0].stabilityTimedOut=true;
  CTI_TEST_assert_(!qaObservedEmptyAssessmentBody_(item,meta),'An unstable editor remains uncertain');
}

function CTI_TEST_exactReadingReceipt_() {
  function reading(length,observed) {
    return {id:'reading',type:'Reading',payload:{textSample:'x'.repeat(length),textConfidence:'high',textEvidenceCompleteness:.97,textScopeKind:'reading-content-field',
      textCaptureEvidence:{method:'EXACT_READING_FIELD',courseId:'course',itemId:'reading',observedCharacters:observed,capturedCharacters:length,limit:256000,truncated:observed>256000,externalFrameTextIncluded:false}}};
  }
  var raw=reading(43265,43265),before=JSON.stringify(raw),item=normalizeCourseraItem_(raw);
  CTI_TEST_equal_(qaReadingEvidenceGap_(item),null,'Complete exact field is not truncated at the old 24k limit');
  CTI_TEST_equal_(item.textEvidenceCompleteness,.97,'Complete reading retains its observed confidence');
  var merged=qaMergeCourseraPayload_({id:'reading',name:'Excel title',type:'Reading'},item);
  CTI_TEST_equal_(qaReadingEvidenceGap_(merged),null,'Exact receipt survives stable-ID Excel enrichment');
  CTI_TEST_equal_(JSON.stringify(raw),before,'Normalization does not mutate the capture');
  var wrong=qaMergeCourseraPayload_({id:'other',type:'Reading'},item);
  CTI_TEST_equal_(wrong.textCaptureEvidence,null,'Name-only enrichment cannot transfer exact field proof');
  CTI_TEST_equal_(qaReadingEvidenceGap_(wrong).code,'TEXT_SAMPLE_LIMIT_REACHED','Mismatched identity cannot bypass the legacy guard');
  ['missing','count','item','limit','explicit'].forEach(function(kind){
    var r=reading(43265,43265);
    if(kind==='missing')delete r.payload.textCaptureEvidence;
    if(kind==='count')r.payload.textCaptureEvidence.observedCharacters++;
    if(kind==='item')r.payload.textCaptureEvidence.itemId='different';
    if(kind==='limit')r.payload.textCaptureEvidence.limit=999999;
    if(kind==='explicit')r.payload.textCaptureTruncated=true;
    CTI_TEST_equal_(qaReadingEvidenceGap_(normalizeCourseraItem_(r)).code,'TEXT_SAMPLE_LIMIT_REACHED',kind+' remains unverified');
  });
  CTI_TEST_equal_(qaReadingEvidenceGap_(normalizeCourseraItem_(reading(256000,256000))),null,'Exactly at the limit is complete when receipt agrees');
  CTI_TEST_equal_(qaReadingEvidenceGap_(normalizeCourseraItem_(reading(256000,256001))).code,'TEXT_SAMPLE_LIMIT_REACHED','Actual truncation remains explicit');
  raw.payload.readingEditorEvidence={unreadFrameCount:1};
  CTI_TEST_equal_(qaReadingEvidenceGap_(normalizeCourseraItem_(raw)).code,'EXTERNAL_FRAME_TEXT_UNVERIFIED','Full outer field does not verify iframe contents');
}

function CTI_TEST_emptyEditorReceipt_() {
  var receipt={status:'OBSERVED_EMPTY_EDITOR',itemId:'week1',route:'https://www.coursera.org/teach/course/course-id/content/item/project/week1',observedAt:'2026-09-21T13:57:12.938Z',samples:2,intervalMs:1200,marker:'Content you add will show in order here.',scope:'EXACT_ITEM_ASSIGNMENT_LAYOUT',sourceCompleteness:'NOT_DETERMINED'};
  var raw={id:'week1',type:'Assignment',name:'Week 1',payload:{textSample:'Generate questions Create AI-graded question Select content type',textEvidenceCompleteness:.35,textScopeKind:'scoped-subtree',emptyEditorEvidence:receipt}};
  var item=normalizeCourseraItem_(raw),merged=qaMergeCourseraPayload_({id:'week1',type:'Assignment',name:'Excel Week 1'},item);
  CTI_TEST_equal_(merged.emptyEditorEvidence.samples,2,'Receipt survives stable-ID payload enrichment');
  var findings=qaAssessDestinationReadiness_([merged],null,{}, {mode:'RAW_INGESTION'},null,'NAIT').findings;
  var found=findings.filter(function(f){return f.code==='EMPTY_ASSESSMENT_EDITOR_OBSERVED';});
  CTI_TEST_equal_(found.length,1,'Full stable receipt produces one specific empty-editor finding');
  CTI_TEST_equal_(found[0].severity,'REVIEW','Empty state alone does not establish ingestion failure');
  CTI_TEST_contains_(found[0].detail,'source completeness remains undetermined','Source limits remain explicit');
  CTI_TEST_equal_(qaMergeCourseraPayload_({id:'different',type:'Assignment'},item).emptyEditorEvidence,null,'Empty proof cannot transfer to a different item');
  ['item','route','samples','interval','questions','scope'].forEach(function(kind){
    var r=JSON.parse(JSON.stringify(raw)),e=r.payload.emptyEditorEvidence;
    if(kind==='item')e.itemId='different';
    if(kind==='route')e.route=e.route+'-other';
    if(kind==='samples')e.samples=1;
    if(kind==='interval')e.intervalMs=0;
    if(kind==='scope')e.scope='PAGE';
    if(kind==='questions')r.payload.structuredAssessment={questions:[{id:'1',prompt:'A real captured question'}]};
    CTI_TEST_equal_(normalizeCourseraItem_(r).emptyEditorEvidence,null,kind+' contradiction rejects the receipt');
  });
}

function CTI_TEST_unknownChoiceCorrectness_() {
  var source=qaNormalizeQuestion_({type:'single-select',prompt:'Choose an option',points:1,options:[{text:'A',correct:true},{text:'B',correct:false}],correctAnswers:['A'],answerTextReliable:true},0);
  var dest=qaNormalizeQuestion_({type:'single-select',prompt:'Choose an option',points:2,options:[{text:'A',correct:null},{text:'B',correct:null}],correctAnswers:[],answerTextReliable:false},0);
  var result=qaCompareAssessmentQuestion_(source,dest);
  CTI_TEST_equal_(result.details.courseraOptions[0].correct,null,'Unknown correctness does not become false in report details');
  CTI_TEST_equal_(result.details.courseraOptions[1].correct,null,'Every unknown option retains its third state');
  CTI_TEST_equal_(result.details.courseraAnswerTextReliable,false,'Missing answer-key evidence stays explicit');
  CTI_TEST_equal_(result.details.courseraCorrectAnswers.length,0,'No answer key is inferred from the source');
}

function CTI_TEST_reportEmptyFixture_() {
  return {
    source:{isStructuredAssessment:true,structuredAssessment:{parser:'ims-qti-dom-v4',parserConfidence:.95,declaredQuestionCount:2,questions:[
      {id:'s1',type:'text-entry',prompt:'How many millimetres are in one metre?',correctAnswers:['1000'],answerTextReliable:true},
      {id:'s2',type:'text-entry',prompt:'How many centimetres are in one metre?',correctAnswers:['100'],answerTextReliable:true}]}},
    destination:{id:'week1',type:'Assignment',emptyEditorEvidence:{status:'OBSERVED_EMPTY_EDITOR',itemId:'week1',route:'https://www.coursera.org/teach/trades/course-id/content/item/project/week1',observedAt:'2026-09-21T13:57:12.938Z',samples:2,intervalMs:1200,marker:'Content you add will show in order here.',scope:'EXACT_ITEM_ASSIGNMENT_LAYOUT',sourceCompleteness:'NOT_DETERMINED'}}
  };
}
function CTI_TEST_reportResult_(q) {
  return {courseraId:'week1',courseraName:'Week 1 Assessment',verdict:'UNVERIFIED',issues:['PAYLOAD_UNVERIFIED'],checks:{structuredAssessment:q}};
}
function CTI_TEST_confirmedEmptyComparison_() {
  var f=CTI_TEST_reportEmptyFixture_(),before=JSON.stringify(f),q=qaStructuredAssessmentComparison_(f.source,f.destination),r=CTI_TEST_reportResult_(q);
  CTI_TEST_equal_(q.status,'UNVERIFIED','An empty destination is not verified or automatically a proven ingestion failure');
  CTI_TEST_equal_(q.sourceQuestionCount,2,'Source question count is retained');
  CTI_TEST_equal_(q.courseraQuestionCount,0,'Empty destination never inherits the source questions');
  CTI_TEST_equal_(q.destinationContentState,'OBSERVED_EMPTY_EDITOR','Exact stable receipt records the observed content state');
  CTI_TEST_equal_(q.courseraDeclaredQuestionCountObserved,true,'Observed zero is distinct from an unavailable count');
  var action=qaOwnerActionForResult_(r);
  CTI_TEST_equal_(action.severity,'REVIEW','Source comparison remains actionable');
  CTI_TEST_contains_(action.action,'confirmed empty','Guidance explains the observed editor');
  CTI_TEST_assert_(!/question bank|capture the unobserved/.test(action.action),'Do not send owner back to extract a confirmed empty bank');
  var capture=qaCourseraCaptureReadiness_({buildId:'v6.14.0'},[r]);
  CTI_TEST_equal_(capture.assessmentGaps.length,0,'Empty destination is not a failed answer capture');
  CTI_TEST_equal_(capture.observedEmptySourceAssessments.length,1,'It remains visible as a source content review');
  CTI_TEST_contains_(capture.action,'does not establish course completeness','No publication approval from traversal or emptiness');
  CTI_TEST_equal_(JSON.stringify(f),before,'Comparisons do not modify input evidence');
  r.issues.push('INGESTION_FAILURE');r.checks.ingestionFailure={codes:['QUESTION_IMAGE_CREATION_ERROR']};
  CTI_TEST_equal_(qaOwnerActionForResult_(r).severity,'CRITICAL','Independent explicit ingestion failure takes precedence');
}
function CTI_TEST_invalidEmptyComparison_() {
  ['missing','item','route','samples','interval','scope','questions','badSamples','badInterval','infinite','fractional'].forEach(function(kind){
    var f=CTI_TEST_reportEmptyFixture_(),e=f.destination.emptyEditorEvidence;
    if(kind==='missing')delete f.destination.emptyEditorEvidence;
    if(kind==='item')e.itemId='wrong';
    if(kind==='route')e.route+='-wrong';
    if(kind==='samples')e.samples=1;
    if(kind==='interval')e.intervalMs=10;
    if(kind==='scope')e.scope='PAGE';
    if(kind==='questions')f.destination.structuredAssessment={questions:[{type:'text-entry',prompt:'An observed question'}]};
    if(kind==='badSamples')delete e.samples;
    if(kind==='badInterval')e.intervalMs='unknown';
    if(kind==='infinite')e.samples=Infinity;
    if(kind==='fractional')e.samples=2.5;
    var q=qaStructuredAssessmentComparison_(f.source,f.destination),r=CTI_TEST_reportResult_(q);
    CTI_TEST_equal_(qaConfirmedEmptyComparison_(r),null,kind+' does not establish an empty comparison');
    CTI_TEST_equal_(qaCourseraCaptureReadiness_({buildId:'v6.14.0'},[r]).observedEmptySourceAssessments.length,0,kind+' cannot suppress evidence gaps');
  });
  var f=CTI_TEST_reportEmptyFixture_(),q=qaStructuredAssessmentComparison_(f.source,f.destination),r=CTI_TEST_reportResult_(q);
  r.courseraId='different';
  CTI_TEST_equal_(qaConfirmedEmptyComparison_(r),null,'Receipt is rebound to the matched result ID');
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({buildId:'v6.14.0'},[r]).assessmentGaps.length,1,'Mismatched result identity retains evidence gap');
  r.courseraId='week1';q.courseraDeclaredQuestionCount=2;
  CTI_TEST_equal_(qaConfirmedEmptyComparison_(r),null,'Positive declared count contradicts zero-content claim');
}
function CTI_TEST_reportAnswerFixture_() {
  var questions=[{id:'q1',type:'single-select',prompt:'Which study format do you prefer?',options:[{text:'Independent reading',correct:null},{text:'Group discussion',correct:null}],correctAnswers:[],answerTextReliable:false}];
  return qaStructuredAssessmentComparison_(
    {isStructuredAssessment:true,structuredAssessment:{parser:'ims-qti-dom-v4',parserConfidence:.95,declaredQuestionCount:1,questions:questions}},
    {structuredAssessment:{parser:'coursera-assignment',parserConfidence:.95,declaredQuestionCount:1,questions:JSON.parse(JSON.stringify(questions))}});
}
function CTI_TEST_answerOnlyGuidance_() {
  var q=CTI_TEST_reportAnswerFixture_(),r=CTI_TEST_reportResult_(q);
  CTI_TEST_equal_(q.status,'UNVERIFIED','Missing answers are not silently exempted');
  CTI_TEST_equal_(q.answerEvidenceCoverage,0,'No answer evidence is invented');
  CTI_TEST_assert_(qaAssessmentAnswerOnlyGap_(q),'Complete comparable fields identify the answer-only review');
  var a=qaOwnerActionForResult_(r),capture=qaCourseraCaptureReadiness_({buildId:'v6.14.0'},[r]);
  CTI_TEST_contains_(a.action,'whether an answer key is required','Applicability is checked explicitly');
  CTI_TEST_assert_(!/question bank|capture the unobserved/.test(a.action),'Complete prompts do not trigger a question-bank recrawl');
  CTI_TEST_equal_(capture.status,'ANSWER_EVIDENCE_REVIEW','Capture input summary explains the specific gap');
  CTI_TEST_equal_(capture.assessmentGaps.length,1,'Answer review remains in the report');
  CTI_TEST_equal_(capture.assessmentGaps[0].answerEvidenceOnly,true,'Frontend can describe this precise evidence gap');
  CTI_TEST_contains_(capture.action,'whether answer keys apply','Capture banner does not demand keys for an unconfirmed survey');
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({},[r]).status,'VERSION_UNKNOWN_WITH_GAPS','Unknown version is not promoted');
}
function CTI_TEST_answerOnlyBoundaries_() {
  var q=CTI_TEST_reportAnswerFixture_();
  var cases=[['courseraDeclaredQuestionCount',2],['sourceDeclaredQuestionCount',2],['alignedQuestionCount',0],['unknownTypeCount',1],['hardMismatchCount',1],['fidelity',.5],['sourceParserConfidence',.4],['selectionPolicyStatus','UNVERIFIED'],['sourceMediaQuestionNumbers',[1]],['captureIssueQuestionNumbers',[1]],['sourceAnswerRefreshRequired',true]];
  cases.forEach(function(entry){var c=JSON.parse(JSON.stringify(q));c[entry[0]]=entry[1];CTI_TEST_assert_(!qaAssessmentAnswerOnlyGap_(c),entry[0]+' remains a broader review');});
  var f=CTI_TEST_reportEmptyFixture_(),empty=CTI_TEST_reportResult_(qaStructuredAssessmentComparison_(f.source,f.destination));
  var answer=CTI_TEST_reportResult_(q);answer.courseraId='survey';answer.courseraName='Survey';
  var mixed=qaCourseraCaptureReadiness_({buildId:'v6.14.0'},[empty,answer]);
  CTI_TEST_equal_(mixed.observedEmptySourceAssessments.length,1,'Mixed report retains empty content review');
  CTI_TEST_equal_(mixed.assessmentGaps.length,1,'Only actual answer evidence goes into capture gaps');
  var partial=JSON.parse(JSON.stringify(q));partial.courseraDeclaredQuestionCount=2;
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({buildId:'v6.14.0'},[CTI_TEST_reportResult_(partial)]).status,'CAPTURE_INCOMPLETE','Uncaptured declared questions retain incomplete status');
}

function CTI_TEST_assignmentTextBlocks_() {
  var f=CTI_TEST_editorRecoveryFixture_();
  var parse=new Function('isVisibleElement','hasVisibleLoadingIndicator',f.code('isAssignmentTextBlockV61321')+'\n'+f.code('parseAssignmentTextBlockV61321')+'\nreturn parseAssignmentTextBlockV61321;')(function(){return true;},function(){return false;});
  function part(text,id){return {id:id||'assignment~textBlock!~1',isConnected:true,innerText:text,getAttribute:function(k){return k==='data-testid'?'assignment-part-0':null;},querySelectorAll:function(){return [];}};}
  var text='1Text block Submission guide Title Submission guide Content Read the example. Submit through the associated dropbox. Content includes a table. Prompt is a literal word here.';
  var block=parse(part(text));
  CTI_TEST_equal_(block.kind,'text-block','Native text-block ID establishes the content family');
  CTI_TEST_equal_(block.text,'Read the example. Submit through the associated dropbox. Content includes a table. Prompt is a literal word here.','Only authoring labels are removed; learner words remain');
  CTI_TEST_equal_(block.submissionBehavior,'NOT_INFERRED_FROM_INSTRUCTIONS','Dropbox wording is not an observed submission control');
  CTI_TEST_equal_(parse(part(text,'question~multipleChoice!~1')),null,'Question parts cannot be relabeled from text alone');
  CTI_TEST_equal_(parse(part('Text block A Title B Content Mixed boundaries')),null,'Ambiguous field boundaries remain uncaptured');
  var long=parse(part('1Text block Long Title Long Content '+'x'.repeat(25000)));
  CTI_TEST_assert_(long.truncated,'A bounded text capture reports truncation');
  CTI_TEST_equal_(long.capturedCharacters,24000,'Limit is explicit');
  CTI_TEST_equal_(long.observedCharacters,25000,'Original observed length is retained');
}
function CTI_TEST_assignmentTextBlockNormalization_() {
  var raw={parser:'coursera-native-assignment-dom+controls-v4',learnerSemanticText:'Read the submission instructions.',submission:{},contentBlockEvidence:{itemId:'guide',declaredContentParts:1,completeTextBlockOnly:true,sourceCompleteness:'NOT_DETERMINED',blocks:[{id:'a~textBlock!~1',text:'Read the submission instructions.',kind:'text-block',embeddedFrameCount:0}]}};
  var before=JSON.stringify(raw),n=qaNormalizeNativeAssignment_(raw);
  CTI_TEST_equal_(n.contentBlockEvidence.blocks.length,1,'Instruction receipt survives normalization');
  CTI_TEST_equal_(n.learnerSemanticText,raw.learnerSemanticText,'Learner instruction text is retained');
  CTI_TEST_equal_(n.submission.fileUpload,false,'Instruction presence does not create a file-upload control');
  CTI_TEST_equal_(n.contentBlockEvidence.sourceCompleteness,'NOT_DETERMINED','Source completeness is not invented');
  n.contentBlockEvidence.blocks[0].text='modified copy';
  CTI_TEST_equal_(JSON.stringify(raw),before,'Normalized receipt is an independent copy');
}

function CTI_TEST_scopedWaitBudget_() {
  var f=CTI_TEST_editorRecoveryFixture_(),now=0;
  var make=new Function('Date',f.code('scopedWaitBudgetV61321')+'\nreturn scopedWaitBudgetV61321;')({now:function(){return now;}});
  var quiet=make(3200,8000,20000);quiet.observe([100,2]);now=3060;quiet.observe([100,2]);
  CTI_TEST_equal_(quiet.extend(180),3200,'Unchanged scoped evidence earns no extension');
  CTI_TEST_equal_(quiet.snapshot().extensions.length,0,'Initial content alone does not repeatedly increase the budget');
  now=0;var growing=make(3200,8000,5000);growing.observe([0,0]);now=2700;growing.observe([100,2]);now=3060;
  CTI_TEST_equal_(growing.extend(180),5000,'New payload earns time within the course deadline');
  CTI_TEST_equal_(growing.snapshot().extensions.length,1,'Extension has a recorded evidence reason');
  CTI_TEST_equal_(growing.snapshot().extensions[0].reason,'NEW_SCOPED_PAYLOAD_EVIDENCE','Reason identifies actual scoped progress');
  now=4990;growing.observe([200,4]);CTI_TEST_equal_(growing.extend(180),5000,'Further growth cannot exceed the outer deadline');
  now=0;var expired=make(3200,8000,0);expired.observe([0]);now=10;expired.observe([100]);
  CTI_TEST_equal_(expired.extend(180),0,'An expired deadline is never revived');
}

function CTI_TEST_emptyTimeoutRetry_() {
  var fixture=CTI_TEST_editorRecoveryFixture_();
  var decide=new Function(fixture.code('retryDecisionV61318')+'\nreturn retryDecisionV61318;')();
  var start=Date.parse('2026-09-21T10:00:00.000Z');
  var receipt={status:'OBSERVED_EMPTY_EDITOR',itemId:'empty1',scope:'EXACT_ITEM_ASSIGNMENT_LAYOUT',
    route:'https://www.coursera.org/teach/course/course123/content/item/project/empty1',
    sourceCompleteness:'NOT_DETERMINED',marker:'Content you add will show in order here.',
    samples:2,intervalMs:1200,observedAt:new Date(start+14200).toISOString()};
  var original={id:'empty1',editorSurfaceCaptured:true,stabilityTimedOut:true,
    startedAt:new Date(start).toISOString(),navigationMs:3000,stabilityPhaseMs:10000,elapsedMs:14300,
    questionCycleStopReason:'STABLE_EMPTY_EDITOR',questionCycleDeclared:0,questionCycleQuestions:0,
    emptyEditorEvidence:receipt,assessmentSurface:{layoutDiagnostic:{exactRoute:true,route:receipt.route}}};
  var reasons=['timeout','incomplete-text','generic-fallback-only','no-upgrade'];
  var copy=function(x){return JSON.parse(JSON.stringify(x));};
  var before=JSON.stringify(original),out=decide(original,{emptyEditorEvidence:receipt},reasons);
  CTI_TEST_equal_(out.retryReasons.length,0,'Same-visit empty proof supersedes generic timeout and text gaps');
  CTI_TEST_equal_(out.deferredReasons.length,4,'Every removed reason remains explicit');
  CTI_TEST_equal_(out.status,'OBSERVED_EMPTY_EDITOR_REQUIRES_SOURCE_REVIEW','Source review remains required');
  CTI_TEST_equal_(JSON.stringify(original),before,'Keep timeout and observation history unchanged');
  var variants=[
    function(d){d.emptyEditorEvidence.itemId='other';},
    function(d){d.emptyEditorEvidence.route=d.emptyEditorEvidence.route.replace('course123','otherCourse');},
    function(d){d.emptyEditorEvidence.samples=1;},
    function(d){d.emptyEditorEvidence.intervalMs=1000;},
    function(d){d.emptyEditorEvidence.observedAt=new Date(start+1000).toISOString();},
    function(d){d.emptyEditorEvidence.observedAt=new Date(start+15000).toISOString();},
    function(d){d.emptyEditorEvidence.marker='Loading item...';},
    function(d){d.emptyEditorEvidence.sourceCompleteness='COMPLETE';},
    function(d){d.questionCycleStopReason='WAIT_LIMIT';},
    function(d){d.questionCycleDeclared=1;},
    function(d){d.questionCycleQuestions=1;},
    function(d){d.questionCycleReactStateQuestions=1;},
    function(d){delete d.emptyEditorEvidence;},
    function(d){delete d.startedAt;},
    function(d){d.assessmentSurface.layoutDiagnostic.exactRoute=false;},
    function(d){d.editorSurfaceCaptured=false;}
  ];
  variants.forEach(function(change,i){var d=copy(original);change(d);CTI_TEST_equal_(decide(d,{emptyEditorEvidence:receipt},reasons).retryReasons.length,4,'Unproven/stale/contradictory empty receipt retains retry '+i);});
  [{questions:[{prompt:'A question'}]},{declaredQuestionCount:1},{questionCount:1}].forEach(function(model){
    CTI_TEST_equal_(decide(original,{structuredAssessment:model},reasons).retryReasons.length,4,'Positive question evidence cannot be hidden');
  });
  CTI_TEST_equal_(decide(original,{},reasons.concat(['incomplete-answer-evidence'])).retryReasons.join(','),'incomplete-answer-evidence','Do not suppress independent answer gaps');
  var capped={textCaptureTruncated:true,textCaptureEvidence:{method:'EXACT_READING_FIELD'}};
  CTI_TEST_equal_(decide({editorSurfaceCaptured:true,stabilityTimedOut:true},capped,['timeout','incomplete-text']).retryReasons.length,2,'Truncation cannot hide an unresolved timeout');
  CTI_TEST_equal_(decide({editorSurfaceCaptured:true},capped,['incomplete-text']).retryReasons.length,0,'Stable known truncation keeps targeted recovery behavior');
}

function CTI_TEST_behaviorUnverifiedOwner_() {
  var result={verdict:'UNVERIFIED',issues:['BEHAVIOR_UNVERIFIED'],checks:{
    content:{status:'VERIFIED'},behavior:{status:'UNVERIFIED',reason:'Source requires file upload, but destination submission mode was not observed strongly enough.'}}};
  var original=JSON.stringify(result),action=qaOwnerActionForResult_(result);
  CTI_TEST_equal_(action.severity,'EVIDENCE','Verified instructions do not dismiss unknown behavior');
  CTI_TEST_assert_(action.action.indexOf('Source requires file upload')>=0,'Preserve the concrete source requirement');
  CTI_TEST_assert_(/submission and grading settings/.test(action.action),'Provide a targeted inspection');
  CTI_TEST_assert_(/only if this check confirms a gap/.test(action.action),'Do not prescribe unproven repair');
  CTI_TEST_equal_(JSON.stringify(result),original,'Owner guidance does not mutate source or destination evidence');
  var critical=JSON.parse(original);critical.issues.push('MISSING_ASSET');critical.checks.assets={missing:['diagram.png']};
  CTI_TEST_equal_(qaOwnerActionForResult_(critical).severity,'CRITICAL','Behavior uncertainty must not downgrade confirmed asset loss');
  var runtime=JSON.parse(original);runtime.issues.push('RUNTIME_VERIFICATION_REQUIRED');
  CTI_TEST_equal_(qaOwnerActionForResult_(runtime).severity,'REVIEW','Keep independent runtime review');
  CTI_TEST_equal_(qaOwnerActionForResult_({verdict:'VERIFIED',issues:[],checks:{behavior:{status:'VERIFIED'}}}).severity,'NONE','Fully verified items retain no-action guidance');
  result.ownerAction=action;result.operationalPolicy={inDecisionGate:false,reason:'Optional instructor area'};
  workApplyPolicyAwareOperatorGuidance_([result],[]);
  CTI_TEST_equal_(result.ownerAction.severity,'INFO','Policy-exempt material stays outside required fixes');
}

function CTI_TEST_readingAttachmentCoverage_() {
  var text='Week 1 First lesson.pdf First lesson PDF File Second lesson.pdf Second lesson PDF File';
  var item={id:'reading',type:'Reading',textScopeKind:'reading-content-field',textSample:text,
    assetDetails:[{name:'First lesson.pdf',url:'https://cdn.example/first.pdf'},{name:'Second lesson.pdf',url:''}],
    readingEditorEvidence:{identity:'exact-course-plus-item-reading-content-field',courseId:'course',itemId:'reading',fieldTestId:'course+reading',observedAt:'2026-09-21T12:00:00Z',route:'https://www.coursera.org/teach/example/course/content/item/supplement/reading'}};
  var result=qaReadingAttachmentEvidence_(item);
  if(result.observedLabelCount!==2 || result.resolvedLabelCount!==1 || result.unresolvedLabels[0]!=='Second lesson.pdf')throw Error('Attachment labels require actual download URLs.');
  if(qaReadingEvidenceGap_(item)!==null)throw Error('Attachment gaps must not downgrade otherwise complete reading text.');
  var readiness=qaAssessDestinationReadiness_([item],{}, {}, {}, {}, 'NAIT');
  if(JSON.stringify(readiness).indexOf('ATTACHMENT_DOWNLOAD_URLS_UNVERIFIED')<0)throw Error('Owner report must expose unresolved attachment URLs.');
  item.assetDetails.push({name:'Second lesson.pdf',url:'https://cdn.example/second.pdf'});
  if(qaReadingAttachmentEvidence_(item).unresolvedLabels.length)throw Error('Both observed labels now have URLs.');
  item.readingAttachmentEvidence={itemId:'reading',network:{omittedResponses:3}};
  if(JSON.stringify(qaAssessDestinationReadiness_([item],{}, {}, {}, {}, 'NAIT')).indexOf('READING_NETWORK_CAPTURE_LIMIT')<0)throw Error('A bounded network omission must be visible.');
  item.readingEditorEvidence.itemId='other';
  if(qaReadingAttachmentEvidence_(item)!==null)throw Error('Cross-item receipts cannot certify attachment coverage.');
  if(qaReadingAttachmentLabels_('Please read First lesson.pdf before class.').length)throw Error('A prose filename is not an attachment card.');
  if(qaReadingAttachmentLabels_('unrelated.pdf Different name PDF File').length)throw Error('Repeated attachment labels must agree.');
  if(qaReadingAttachmentLabels_('Sheet.xlsx Sheet Excel File Slides.pptx Slides PowerPoint File').length!==2)throw Error('Supported non-PDF card labels must remain discoverable.');
  return {observedLabels:2,unresolvedLabels:1,conservativeIdentity:true,textCompletenessIndependent:true};
}

function CTI_TEST_mountedReadingAssets_() {
  var f=CTI_TEST_editorRecoveryFixture_();
  var make=new Function('exactReadingEditorV61311','uniqueAssetDetails','isCourseraUiAssetUrl',
    f.code('ownStateValueV61313')+'\n'+f.code('readingAttachmentLabelsV61323')+'\n'+f.code('readingAttachmentStateV61324')+'\nreturn readingAttachmentStateV61324;');
  var root={innerText:'First.pdf First PDF File',getAttribute:function(){return null;},querySelectorAll:function(){return [];},contains:function(){return false;}};
  root.__reactProps$test={asset:{id:'assetABC',name:'First.pdf',url:'https://cdn.example/first.pdf',sha256:'metadata-is-not-a-measured-hash'}};
  var active=root,read=make(function(){return {root:active};},function(a){return a;},function(){return false;});
  var captured=read(root,{id:'reading'},'course');
  CTI_TEST_equal_(captured.assets.length,1,'A mounted attachment does not require a new network request');
  CTI_TEST_equal_(captured.references[0].assetId,'assetABC','Keep the observed attachment reference');
  CTI_TEST_equal_(captured.assets[0].sha256,'','Do not turn a metadata checksum into binary verification');
  CTI_TEST_equal_(captured.assets[0].hashStatus,'URL_ONLY','Scope is URL capture');
  active={};CTI_TEST_equal_(read(root,{id:'reading'},'course').assets.length,0,'Reject a different mounted reading');
  active=root;root.__reactProps$test={store:{asset:{id:'assetABC',name:'First.pdf',url:'https://cdn.example/other.pdf'}}};
  CTI_TEST_equal_(read(root,{id:'reading'},'course').assets.length,0,'Global stores are outside the exact component scope');
  root.__reactProps$test={};Object.defineProperty(root.__reactProps$test,'asset',{enumerable:true,get:function(){throw Error('Do not invoke page getters');}});
  CTI_TEST_equal_(read(root,{id:'reading'},'course').assets.length,0,'Passive state capture never invokes getters');
}

function CTI_TEST_assignmentMetadata_() {
  var fixture=CTI_TEST_editorRecoveryFixture_();
  var front=new Function(fixture.code('normalizeAssignmentMetadataV61325')+';return normalizeAssignmentMetadataV61325;')();
  var empty={schemaVersion:4,submission:{aiGraded:true},settings:{graderType:'AI',gradeSetting:'true',scoringPolicy:'Required Latest Score \u200b',feedbackType:'Required Full \u200b',passingThreshold:80},
    currentStateEvidence:{observedSettingFields:['graderType','gradeSetting','passingThreshold'],observedSubmissionSignals:['aiGraded']},
    authoringSemanticText:'Content you add will show in order here. Create AI-graded question Craft open-ended questions and get instant AI-powered grading. Grade setting Required Graded Scoring policy Required Latest Score'};
  var original=JSON.stringify(empty),clean=front(empty);
  CTI_TEST_equal_(clean.submission.aiGraded,false,'Creating a question does not establish the current grader');
  CTI_TEST_assert_(!clean.settings.graderType,'Do not certify an AI grader from a creation button');
  CTI_TEST_equal_(clean.settings.gradeSetting,'Graded','Use the visible grade label instead of the hidden boolean');
  CTI_TEST_equal_(clean.settings.passingThreshold,80,'Keep the observed threshold');
  CTI_TEST_equal_(clean.settings.scoringPolicy,'Latest Score','Remove the Required form label');
  CTI_TEST_equal_(clean.settings.feedbackType,'Full','Remove zero-width form decoration');
  CTI_TEST_equal_(JSON.stringify(empty),original,'Preserve the uploaded source evidence');
  var current={grading:{submission:empty.submission,settings:empty.settings,currentStateEvidence:empty.currentStateEvidence}};
  var normalized=normalizeCourseraItem_({id:'empty',type:'Assignment',payload:{nativeAssignment:empty,currentState:current}});
  CTI_TEST_equal_(normalized.nativeAssignment.submission.aiGraded,false,'Existing captures receive the same correction');
  CTI_TEST_equal_(normalized.currentState.grading.submission.aiGraded,false,'Lifecycle evidence cannot retain the false signal');
  CTI_TEST_assert_(normalized.nativeAssignment.metadataCorrections.length>=2,'Keep correction receipts');
  var native=JSON.parse(original);native.authoringSemanticText+=' 2AI-Graded Rich Text Test Question Prompt Calculate the answer. AI Grader Instructions';
  CTI_TEST_equal_(front(native).settings.graderType,'AI','Preserve observed AI question headers');
  CTI_TEST_equal_(front(native).submission.aiGraded,true,'An actual AI question remains AI graded');
  var unknown=front({submission:{},settings:{gradeSetting:'false'}});
  CTI_TEST_assert_(!Object.prototype.hasOwnProperty.call(unknown.settings,'gradeSetting'),'A raw boolean alone cannot identify an ungraded setting');
  ['Ungraded','Practice'].forEach(function(label){var x=JSON.parse(original);x.settings.gradeSetting='false';x.authoringSemanticText=x.authoringSemanticText.replace('Required Graded','Required '+label);CTI_TEST_equal_(front(x).settings.gradeSetting,label,'Retain the observed grade label '+label);});
  var later={grading:{submission:{aiGraded:false,peerGraded:true},settings:{graderType:'PEER'}}};
  normalized=normalizeCourseraItem_({id:'empty',type:'Assignment',payload:{nativeAssignment:empty,currentState:later}});
  CTI_TEST_equal_(normalized.currentState.grading.settings.graderType,'PEER','Do not overwrite a different later observation');
}

function CTI_TEST_olderAnswerReview_() {
  var q=CTI_TEST_reportAnswerFixture_(),r=CTI_TEST_reportResult_(q);
  var capture=qaCourseraCaptureReadiness_({buildId:'v6.13.24-mounted-attachment-state-20260922'},[r]);
  CTI_TEST_equal_(capture.status,'ANSWER_EVIDENCE_REVIEW','A metadata-only release does not make aligned prompts a failed crawl');
  CTI_TEST_equal_(capture.olderCapture,true,'Keep the original extractor version visible');
  CTI_TEST_contains_(capture.action,'whether answer keys apply','Preserve the actual remaining action');
  CTI_TEST_assert_(!/repeat extraction|uncaptured question positions/.test(capture.action),'Do not replace an applicability question with a recrawl task');
  q.courseraQuestionCount=0;
  CTI_TEST_equal_(qaCourseraCaptureReadiness_({buildId:'v6.13.24'},[r]).status,'OLDER_CAPTURE_WITH_GAPS','Actual missing positions retain capture guidance');
}

function CTI_TEST_brightspaceCaptureStatusV7930_() {
  var result=qaBrightspaceQuizCaptureSummary_([
    {id:'pool',name:'Pool',description:{Text:'A 15-question quiz covering the unit.'},questions:[],questionsStatus:'CAPTURED'},
    {id:'partial',name:'Paged quiz',questions:[{QuestionId:1}],questionsStatus:'PARTIAL',questionPageEvidence:{complete:false,stopReason:'PAGE_UNAVAILABLE'}}
  ]);
  CTI_TEST_equal_(result.items[0].descriptionQuestionCount,15,'Hyphenated exam length is visible');
  CTI_TEST_equal_(result.items[0].status,'NO_DEFINITIONS_CAPTURED','An empty API response is not an empty course quiz');
  CTI_TEST_equal_(result.items[1].status,'PARTIAL_API_CAPTURE','Failed later page is not complete');
  CTI_TEST_equal_(result.quizEvidenceGaps,2,'Both uncertainties reach the report');
}

function CTI_TEST_networkReleaseV7931_() {
  var f=CTI_TEST_editorRecoveryFixture_();
  function FakeUrl(url){this.href=url;this.origin='https://example.test';this.pathname=url;this.searchParams={values:function(){return [];}};}
  function Xhr(){this.events={};}
  Xhr.prototype.open=function(){};Xhr.prototype.send=function(){};
  Xhr.prototype.addEventListener=function(name,fn){this.events[name]=fn;};
  Xhr.prototype.removeEventListener=function(name){delete this.events[name];};
  Xhr.prototype.getResponseHeader=function(){return 'application/json';};
  Xhr.prototype.finish=function(text){this.responseText=text;this.status=200;if(this.events.load)this.events.load();if(this.events.loadend)this.events.loadend();};
  var originalOpen=Xhr.prototype.open,originalSend=Xhr.prototype.send,nativeFetch=function(){};
  var window={fetch:nativeFetch,XMLHttpRequest:Xhr};
  var recorder=new Function('window','URL','location','MAX_CAPTURED_RESPONSE_CHARS','isPerItemNetworkNoise','isCourseWideNetworkResponse','isSessionScopedPayloadEndpoint',
    f.code('installReadOnlyNetworkRecorder')+'\nreturn installReadOnlyNetworkRecorder();')(
      window,FakeUrl,{origin:'https://example.test'},2500000,function(){return false;},function(){return false;},function(){return true;});
  function send(){var xhr=new Xhr();xhr.open('GET','/api/assets.v1/a');xhr.send();return xhr;}
  var raw='{"links":["https://example.test/resource"],"answer":"Observed answer"}',saved=[];
  for(var i=0;i<90;i++){
    var item={id:String(i)};recorder.setActive(item);send().finish(raw);
    var records=recorder.takeFor(item);saved.push(JSON.parse(records[0].text));
    CTI_TEST_equal_(recorder.stats().retainedRecords,1,'Only the current completed-item batch remains');
    var receipt=recorder.releaseFor(item);
    CTI_TEST_equal_(receipt.releasedRecords,1,'Record released after parsing');
    CTI_TEST_equal_(recorder.stats().retainedChars,0,'Raw body released between items');
    CTI_TEST_equal_(records[0].text,'','Temporary record reference also loses raw text');
  }
  CTI_TEST_equal_(recorder.stats().peakRetainedChars,raw.length,'Raw response storage does not grow with 90 completed items');
  CTI_TEST_equal_(saved.length,90,'All extracted evidence survives release');
  CTI_TEST_equal_(saved[89].answer,'Observed answer','Answer preserved');
  var a={id:'A'};recorder.setActive(a);var late=send();
  CTI_TEST_equal_(recorder.releaseFor(a).pendingAtRelease,1,'Unsettled request is explicit');
  recorder.setActive(a);late.finish(raw);
  CTI_TEST_equal_(recorder.takeFor(a).length,0,'An old owner cannot repopulate a revisited item');
  CTI_TEST_equal_(recorder.stats().lateResponsesIgnored,1,'Late discarded response is counted');
  send().finish(raw);CTI_TEST_equal_(recorder.takeFor(a).length,1,'Fresh revisit still captures');
  var remaining=recorder.takeFor(a);recorder.restore();
  CTI_TEST_equal_(recorder.stats().retainedRecords,0,'Restore clears remaining records');
  CTI_TEST_equal_(recorder.stats().retainedChars,0,'Restore clears remaining raw text');
  CTI_TEST_equal_(remaining[0].text,'','Restore clears referenced record bodies');
  CTI_TEST_assert_(window.fetch===nativeFetch && Xhr.prototype.open===originalOpen && Xhr.prototype.send===originalSend,'Original request methods restored');
}

// ============================================================================
// CTI v8.0.0 — regression fixtures derived from the 15-title research corpus.
// These are generic mechanism tests; title names are intentionally absent.
// ============================================================================
function CTI_TEST_v8MathAndType_() {
  var score=qaAssessmentFieldSimilarity_("\\( 24' 2\\frac{1}{2}'' \\)","24' 2 1/2''");
  CTI_TEST_assert_(score>0.98,'LaTeX and rendered plain fractions are semantically equivalent');
  var q=qaNormalizeQuestion_({type:'essay',prompt:'Length?',options:[
    {text:"27' 3 1/2''",correct:false},{text:"24' 2 1/2''",correct:true},
    {text:"22' 3 1/2''",correct:false},{text:"21' 3 1/2''",correct:false}
  ],correctAnswers:["24' 2 1/2''"]},0);
  CTI_TEST_equal_(q.type,'single-select','Observed choice controls/correctness override a false essay classification');
}

function CTI_TEST_v8AssessmentBehavior_() {
  var source={type:'Assessment',behavior:{observed:true,source:'BRIGHTSPACE_LIVE_QUIZ_API',submission:{},settings:{
    graded:false,gradeSetting:'Ungraded',gradeLinked:false,attempts:'UNLIMITED',timeLimitMinutes:5,passingThreshold:null
  }}};
  var dest={nativeAssignment:{submission:{},settings:{gradeSetting:'Graded',passingThreshold:80,attempts:'UNLIMITED'}}};
  var r=qaBehaviorComparison_(source,dest);
  CTI_TEST_equal_(r.status,'MUTATED','Ungraded source quiz cannot be silently verified as a graded destination');
  CTI_TEST_assert_(r.mismatches.indexOf('GRADED_STATE_CHANGED')>-1,'Grading-state mutation is explicit');
  CTI_TEST_assert_(r.mismatches.indexOf('PASSING_THRESHOLD_ON_UNGRADED_SOURCE')>-1,'Generated passing threshold is explicit');
}

function CTI_TEST_v8DimensionalBinaryGate_() {
  var hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  var source={type:'Reading',contentComparable:true,textSample:'',assetDetails:[{name:'key.tif',sha256:hash,presentInPackage:true}],links:[]};
  var dest={type:'Reading',assetDetails:[{name:'key.tif',url:'https://cdn.example/key.tif'}]};
  var result={verdict:'VERIFIED',issues:[],checks:{structure:{status:'VERIFIED'},assets:{missing:[],unresolved:[]}},ownerAction:null};
  var gated=qaApplyDimensionalVerdictGateV8_(source,dest,result);
  CTI_TEST_equal_(gated.verdict,'UNVERIFIED','Filename/URL observation is not byte proof for a source binary with SHA');
  dest.assetDetails[0].sha256=hash;
  result={verdict:'VERIFIED',issues:[],checks:{structure:{status:'VERIFIED'},assets:{missing:[],unresolved:[]}},ownerAction:null};
  CTI_TEST_equal_(qaApplyDimensionalVerdictGateV8_(source,dest,result).verdict,'VERIFIED','Exact SHA permits binary verification');
}

function CTI_TEST_v8AarEvents_() {
  var item={id:'aar',name:'New Reading',path:'[DELETE ME] Author Alignment Report > Lesson',published:false,
    textSample:'This report summarizes transformations and gap-filling performed during Smart Ingestion. Module: Module 1 Item: ungradedAssignment Opens in a new tab Unsupported Content Fallback The original assignment referenced an attached Word document "Task.docx", but the format does not provide a field for including that file as an asset, so the attachment itself could not be represented here. Module: Final Assessment Item: ungradedAssignment Opens in a new tab Unsupported Content Fallback NonRetryableCompletionParsingException: malformed model JSON failed to parse the assessment. DO NOT PUBLISH THIS READING.'};
  var intel=qaParseSmartIngestionIntelligence_([item]),types=(intel.claims||[]).map(function(c){return c.type;});
  CTI_TEST_assert_(types.indexOf('UNSUPPORTED_CONTENT_FALLBACK')>-1,'Unsupported fallback is retained as structured provenance');
  CTI_TEST_assert_(types.indexOf('UNRESOLVED_SOURCE_ASSET')>-1,'Unrepresentable source attachment is retained');
  CTI_TEST_assert_(types.indexOf('SI_PROCESSING_FAILURE')>-1,'Distillation/parser exception is retained');
}

function CTI_TEST_v8FailedAttemptActionability_() {
  var op=qaApplyIngestionActionabilityPolicy_({recommendationCode:'REINGEST',recommendationLabel:'redo',recommendationReason:'defect'},
    {ingestionCapabilityStatus:'LATEST_ATTEMPT_FAILED_NO_OUTPUT'},{mode:'RAW_INGESTION'});
  CTI_TEST_equal_(op.recommendationCode,'REVIEW','Failed latest attempt does not become manual-remediation latest-applied');
  CTI_TEST_equal_(op.ingestionCapabilityStatus,'LATEST_ATTEMPT_FAILED_NO_OUTPUT','Failed-attempt state is preserved');
  CTI_TEST_assert_(op.recommendationLabel.indexOf('failed')>-1,'Owner sees failed-attempt state');
}

function CTI_TEST_v8ConsolidatedReading_() {
  var source={id:'s',name:'Temperature Activity',type:'Reading',path:'Module 3',textSample:'Use the temperature chart to identify the required range, compare the observed temperature, record the result, and explain whether the equipment is within the acceptable operating range.',assetDetails:[],links:[]};
  var carrier={id:'d',name:'Practice',type:'Reading',path:'Module 3',textSample:'Practice. Use the temperature chart to identify the required range, compare the observed temperature, record the result, and explain whether the equipment is within the acceptable operating range. Continue with the related practice files.',textEvidenceCompleteness:.97,textConfidence:'high',ingestionFailure:{detected:false},assetDetails:[],links:[]};
  var found=qaFindCrossItemSemanticRepackagingEvidence_(source,[carrier],'');
  CTI_TEST_assert_(!!found,'Unique strong same-module semantic carrier is recoverable');
  CTI_TEST_equal_(found.method,'SEMANTIC_CONSOLIDATED_READING','Recovery records consolidation method');
}

function CTI_TEST_v8IndexContract_() {
  var s=CTI_TEST_indexSource_();
  CTI_TEST_contains_(s,'resolveZipEntryV8_','Source scanner has conservative multi-form ZIP resolver');
  CTI_TEST_contains_(s,'SEMICOLON_SLASH_NORMALIZED','D2L semicolon/slash path variation is explicit');
  CTI_TEST_contains_(s,'UNIQUE_BASENAME_FALLBACK','Unique basename fallback is explicit');
  CTI_TEST_contains_(s,'AMBIGUOUS_BASENAME','Ambiguous basename never silently resolves');
  CTI_TEST_contains_(s,'headlineText','Owner UI renders blocker-first summary');
  CTI_TEST_contains_(s,'Gateway <b>v8.0.0</b>','Frontend release is v8');
}

function CTI_TEST_v8ExtractorContract_() {
  var s=ctiCanonicalCourseraExtractorSource_();
  CTI_TEST_contains_(s,'REMOTE_ASSET_FETCH_TIMEOUT_MS = 8000','Remote hashes have a hard per-fetch timeout');
  CTI_TEST_contains_(s,'ASSET_STAGE_MAX_MS = 120000','Asset stage has a bounded wall clock');
  CTI_TEST_contains_(s,'SKIPPED_STAGE_BUDGET','Asset budget exhaustion degrades to explicit uncertainty');
  CTI_TEST_contains_(s,'[role="textbox"]','Simple Discussion rich-text surfaces are capturable');
  CTI_TEST_contains_(s,'Text\\s+block','Content part count subtracts structural Text blocks');
  CTI_TEST_contains_(s,'PASSING_THRESHOLD','Extractor/QA release retains behavior evidence vocabulary');
  CTI_TEST_assert_(s.indexOf('v6.13.27')===-1,'No stale Coursera extractor release remains');
}
