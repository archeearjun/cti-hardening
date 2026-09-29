import { qaCaptureInputsText_, qaMissingScopeText_ } from "./capture-summary.js";
import { qaOwnerTasksText } from "./owner-tasks.js";
import { qaAssessmentScoreLabel_, qaAssessmentAnswerEvidenceText_, qaAssessmentEvidenceText_, qaQuestionDifferenceText_ } from "./assessment-evidence.js";
import { qaExternalWebpageDiagnosticText_, qaSourceAssetProvenanceText_ } from "./source-evidence.js";

export function buildPostQaText_(res) {
     res = res || {};
     res.stats = res.stats || {};
     var s = res.summary || {};
     var text = "CTI SOURCE → COURSERA QA REPORT\n";
     var technicalAppendix = "";
     text += qaCaptureInputsText_(res);
     if(res.operationalPolicy){ var topOp=res.operationalPolicy; text += "ASSIGNMENT OWNER SUMMARY\n"; text += "NEXT ACTION: " + (topOp.recommendationCode||'REVIEW') + " — " + (topOp.recommendationLabel||'') + "\nWHY: " + (topOp.recommendationReason||'') + "\n"; if(topOp.diagnosticRecommendationCode && topOp.diagnosticRecommendationCode !== topOp.recommendationCode) text += "TECHNICAL DIAGNOSIS: " + topOp.diagnosticRecommendationCode + " — " + (topOp.diagnosticRecommendationReason||'') + "\n"; text += "\n"; }

     if (res.summary) {
       if (s.headlineText) text += s.headlineText + "\n";
       text += "Observed Match: " + s.observedFidelity + "% (how much source material CTI can positively match; not a quality score)\n";
       text += "Evidence Coverage: " + s.evidenceCoverage + "% (how much of the comparison has enough direct evidence for a confident verdict; low coverage means uncertainty, not automatically missing content)\n";
       text += "Verified: " + s.verified + " | Partial: " + s.partial + " | Unverified: " + s.unverified + " | Missing: " + s.missing + " | Ingestion Failures: " + (s.ingestionFailures || 0) + " | Behavior Mutations: " + (s.behaviorMutations || 0) + " | Repackaged: " + (s.repackaged || 0) + " | Native Transformations: " + (s.expectedTransformations || 0) + " | Intentional Exclusions: " + (s.intentionalExclusions || 0) + " | Type Mutations: " + s.mutations + " | Moved: " + s.moved + "\n";
     }

     if(qaMissingScopeText_(res))text+=qaMissingScopeText_(res)+'\n';
     text += qaOwnerTasksText(res);
     text += "Coursera items: " + (res.stats.coursera || 0) + " | Source items: " + (res.stats.originalCore || res.stats.original || 0) + "\n";
     if (res.engineBuildId) text += "QA engine build: " + res.engineBuildId + "\n";
     if (res.snapshotContext) {
       text += "Snapshot: " + (res.snapshotContext.label || res.snapshotContext.mode || '') + (res.snapshotContext.inferred ? " [AUTO]" : "") + " | publication policy=" + (res.snapshotContext.publicationPolicy || '') + "\n";
       text += "Snapshot reason: " + (res.snapshotContext.reason || '') + "\n";
     }
     if (res.inputCoherence) {
       text += "Input coherence: " + (res.inputCoherence.status || '') + (res.inputCoherence.idOverlapPercent == null ? '' : " | ID overlap=" + res.inputCoherence.idOverlapPercent + "%") + " | " + (res.inputCoherence.reason || '') + "\n";
     }
     if (res.courseLevelFailure && res.courseLevelFailure.detected) {
       text += "COURSE-LEVEL FAILURE: " + (res.courseLevelFailure.code || '') + " | " + (res.courseLevelFailure.reason || '') + "\n";
     }
     if (res.operationalPolicy) {
       var op = res.operationalPolicy;
       text += "\nOPERATIONAL REDO DECISION\n";
       text += "Policy: " + (op.policyId || '') + "\n";
       text += "Recommendation: " + (op.recommendationCode || '') + " — " + (op.recommendationLabel || '') + "\n";
       text += "Reason: " + (op.recommendationReason || '') + "\n";
       text += "Ingestion actionability: " + (op.ingestionCapabilityStatus || 'UNKNOWN') + (op.reingestionGuardApplied ? " | repeat-reingestion guard=APPLIED" : "") + "\n";
       if(op.diagnosticRecommendationCode && op.diagnosticRecommendationCode !== op.recommendationCode) text += "Underlying technical diagnosis: " + op.diagnosticRecommendationCode + " — " + (op.diagnosticRecommendationReason || '') + "\n";
       text += "Policy-adjusted match: " + Number(op.adjustedObservedFidelity || 0) + "% | coverage=" + Number(op.adjustedEvidenceCoverage || 0) + "%\n";
       text += "Decision gate: source items=" + Number(op.gateSourceItems || 0) + " | policy-exempt source items=" + Number(op.policyExemptSourceItems || 0) + " | matched ingestion failures=" + Number(op.learnerFacingIngestionFailures || 0) + " | broken destination extras=" + Number(op.learnerFacingExtraIngestionFailures || 0) + " | behavior mutations=" + Number(op.learnerFacingBehaviorMutations || 0) + " | behavior unverified=" + Number(op.learnerFacingBehaviorUnverified || 0) + " | runtime reviews=" + Number(op.learnerFacingRuntimeReviews || 0) + " | external runtime packages=" + Number(op.externalRuntimePackageCount || 0) + " | learner-facing missing=" + Number(op.learnerFacingMissing || 0) + " | hard payload loss=" + Number(op.learnerFacingHardPayloadLoss || 0) + " | hidden-dependency reviews=" + Number(op.hiddenDependencyReviews || 0) + " | type mutations=" + Number(op.learnerFacingTypeMutations || 0) + " | partial=" + Number(op.learnerFacingPartial || 0) + " | unverified=" + Number(op.learnerFacingUnverified || 0) + "\n";
       if ((op.ingestionFailureNames || []).length) text += "Explicit matched ingestion failures: " + op.ingestionFailureNames.join(', ') + "\n";
       if ((op.extraIngestionFailureNames || []).length) text += "Broken unmatched Coursera ingestion artifacts: " + op.extraIngestionFailureNames.join(', ') + "\n";
       if ((op.behaviorMutationNames || []).length) text += "Proven behavior mutations: " + op.behaviorMutationNames.join(', ') + "\n";
       if ((op.runtimeReviewNames || []).length) text += "Interactive/runtime launch checks: " + op.runtimeReviewNames.join(', ') + "\n";
       if ((op.learnerFacingMissingNames || []).length) text += "Missing in decision gate: " + op.learnerFacingMissingNames.join(', ') + "\n";
       if ((op.hardPayloadLossNames || []).length) text += "Proven hard payload loss: " + op.hardPayloadLossNames.join(', ') + "\n";
       if ((op.manualRemovalNames || []).length) text += "Manual removals since raw snapshot (same generation; do not re-ingest solely for these): " + op.manualRemovalNames.join(', ') + "\n";
       if ((op.manualRegressionNames || []).length) text += "Manual regressions since raw snapshot: " + op.manualRegressionNames.join(', ') + "\n";
       if ((op.manualRepairNames || []).length) text += "Manual repair required (do not assume re-ingestion will fix): " + op.manualRepairNames.join(', ') + "\n";
       if ((op.hiddenDependencyNames || []).length) text += "Hidden dependencies requiring review: " + op.hiddenDependencyNames.join(', ') + "\n";
       if ((op.policyExemptNames || []).length) text += "Policy-exempt findings retained for audit: " + op.policyExemptNames.join(', ') + "\n";
       text += (op.description || '') + "\n";
     }
     if (res.ingestionIntelligence && res.ingestionIntelligence.detected) {
       var ii = res.ingestionIntelligence;
       var pm = ii.provenanceMemory || {};
       var provenanceLabel = pm.inherited && Number(pm.currentClaimCount || 0) === 0
         ? ("inherited from same-generation raw Evidence Memory" + (pm.sourceRunId ? " (" + pm.sourceRunId + ")" : ""))
         : (pm.inherited ? "current evidence + inherited same-generation Evidence Memory" : "current Author Alignment Report evidence");
       technicalAppendix += "Smart Ingestion provenance: " + provenanceLabel + " | claims=" + ((ii.claims || []).length) + " | generated-field mentions=" + (ii.generatedFieldMentions || 0) + " | content-adaptation mentions=" + (ii.contentAdaptationMentions || 0) + "\n";
       (ii.claims || []).slice(0,10).forEach(function(c){ technicalAppendix += "  CLAIM " + (c.type || '') + (c.subject ? " | " + c.subject : "") + (c.target ? " -> " + c.target : "") + " | " + (c.excerpt || '') + "\n"; });
     }
     if (res.generationEvidenceContext && res.generationEvidenceContext.provenanceInherited) {
       technicalAppendix += "Generation provenance memory: inherited " + Number(res.generationEvidenceContext.provenanceInheritedClaimCount || 0) + " claim(s) from " + (res.generationEvidenceContext.provenanceSourceRunId || '') + " in the same import generation.\n";
     }
     if (res.manualChangeAttribution && res.manualChangeAttribution.applied) {
       technicalAppendix += "Same-generation manual change attribution: baseline " + (res.manualChangeAttribution.baselineRunId || '') + " | manual removals=" + (res.manualChangeAttribution.manualRemovalNames || []).join(', ') + " | manual regressions=" + (res.manualChangeAttribution.manualRegressionNames || []).join(', ') + "\n";
     }


     if (res.currentStateResolution && (res.currentStateResolution.resolutions || []).length) {
       var csrTxt = res.currentStateResolution || {};
       technicalAppendix += "\nCURRENT STATE RESOLUTION\n";
       technicalAppendix += "Engine: " + (csrTxt.engineVersion || '') + " | resolved=" + Number(csrTxt.resolvedCount || 0) + " | review=" + Number(csrTxt.reviewCount || 0) + " | evidence gaps=" + Number(csrTxt.evidenceGapCount || 0) + "\n";
       (csrTxt.resolutions || []).slice(0,80).forEach(function(r){
         technicalAppendix += "  " + (r.status || '') + " | " + (r.currentItemName || r.subject || r.claimType || '') + " | historical=" + (r.claimType || '') + (r.target ? " -> " + r.target : "") + " | " + (r.detail || '') + (r.action ? " | ACTION: " + r.action : "") + "\n";
         (r.evidence || []).slice(0,5).forEach(function(e){ technicalAppendix += "      evidence: " + JSON.stringify(e) + "\n"; });
       });
     }

     if (res.destinationReadiness) {
       var drTxt = res.destinationReadiness || {};
       technicalAppendix += "\nDESTINATION READINESS\n";
       technicalAppendix += "Status: " + (drTxt.status || '') + " | critical=" + Number(drTxt.criticalCount || 0) + " | review=" + Number(drTxt.reviewCount || 0) + " | evidence gaps=" + Number(drTxt.evidenceGapCount || 0) + " | manual repairs=" + Number(drTxt.manualRepairCount || 0) + "\n";
       (drTxt.criticalFindings || []).slice(0,20).forEach(function(f){ technicalAppendix += "  CRITICAL " + (f.code || '') + (f.itemName ? " | " + f.itemName : "") + " | " + (f.detail || '') + " | ACTION: " + (f.action || '') + "\n"; });
       (drTxt.reviewFindings || []).slice(0,30).forEach(function(f){ technicalAppendix += "  REVIEW " + (f.code || '') + (f.itemName ? " | " + f.itemName : "") + " | " + (f.detail || '') + " | ACTION: " + (f.action || '') + "\n"; });
       (drTxt.evidenceFindings || []).slice(0,40).forEach(function(f){ technicalAppendix += "  EVIDENCE " + (f.code || '') + (f.itemName ? " | " + f.itemName : "") + (f.path ? " @ " + f.path : "") + " | " + (f.detail || '') + " | ACTION: " + (f.action || '') + "\n"; });
       (drTxt.findings || []).filter(function(f){return f.policyExempt;}).forEach(function(f){ technicalAppendix += "  POLICY-EXEMPT " + (f.code || '') + " | " + (f.itemName || '') + " @ " + (f.path || '') + " | " + (f.detail || '') + " | Optional housekeeping; excluded from learner-facing tasks.\n"; });
     }

     var extractorMeta = (res.stats && res.stats.extractorMeta) || {};
     if (extractorMeta.activeSpaCrawl) {
       var crawl = extractorMeta.activeSpaCrawl;
       technicalAppendix += "\nACTIVE SPA CRAWL DIAGNOSTICS\n";
       if(extractorMeta.supplementalReadingRecovery)technicalAppendix += "Original full-capture diagnostics retained below. Combined editor coverage and later reading recovery are recorded under CAPTURE INPUTS.\n";
       technicalAppendix += "Build: " + (crawl.buildId || extractorMeta.buildId || "") + "\n";
       technicalAppendix += "Crawl start: " + (crawl.crawlStartUrl || "") + " | canonicalized=" + (crawl.canonicalizedStart ? "YES" : "NO") + "\n";
       if (crawl.canonicalizedStart && crawl.originalUrl) technicalAppendix += "Original URL: " + crawl.originalUrl + "\n";
       var filterTest = extractorMeta.filterSelfTest || {};
       technicalAppendix += "Filter self-test: telemetry=" + (filterTest.telemetry ? "PASS" : "FAIL") + " | course-wide=" + (filterTest.courseWide ? "PASS" : "FAIL") + "\n";
       technicalAppendix += "Targets: " + (crawl.targets || 0) + " | Discovered: " + (crawl.discoveredTargets || 0) + " | Navigated: " + (crawl.navigated || 0) + "\n";
       technicalAppendix += "Traversal: completed=" + (crawl.completedTargets == null ? (crawl.returned || 0) : crawl.completedTargets) + "/" + (crawl.eligibleTargets || crawl.targets || 0) + " | allTargetsAttempted=" + (crawl.allTargetsAttempted ? "YES" : "NO") + " | unvisitedDueToBudget=" + (crawl.unvisitedDueToBudget || 0) + "\n";
       technicalAppendix += "Budget: strategy=" + (crawl.budgetStrategy || "legacy") + " | elapsedMs=" + (crawl.crawlElapsedMs || 0) + " | allocatedMs=" + (crawl.timeBudgetMs || 0) + " | exhausted=" + (crawl.timeBudgetExhausted ? "YES" : "NO") + " | itemTraversalCoverage=" + Math.round(Number(crawl.deepCoverageCompleteness || 0)*100) + "%\n";
       technicalAppendix += "Network responses: " + (crawl.networkResponses || 0) + " | GraphQL: " + (crawl.graphqlResponses || 0) + " | Associated: " + (crawl.associatedNetworkResponses || 0) + "\n";
       technicalAppendix += "DOM captures: " + (crawl.domCaptures || 0) + " | Route-scoped surfaces: " + (crawl.routeScopedSurfaceCaptures || 0) + " | Evidence upgrades: " + (crawl.evidenceUpgrades || 0) + " | Route failures: " + (crawl.routeFailures || 0) + "\n";
       technicalAppendix += "Ignored non-item traffic: telemetry=" + (crawl.ignoredNoiseResponses || 0) + " | course-wide=" + (crawl.ignoredCourseWideResponses || 0) + "\n";
       technicalAppendix += "Viewport scan steps: " + (crawl.viewportScanSteps || 0) + " | Outline disclosures expanded: " + (crawl.outlineDisclosureExpansions || 0) + "\n";
       if (extractorMeta.outlineHydration) {
         var oh=extractorMeta.outlineHydration||{};
         technicalAppendix += "Outline pre-hydration: roots=" + Number(oh.roots||0) + " | positions=" + Number(oh.positions||0) + " | disclosures expanded=" + Number(oh.disclosuresExpanded||0) + " | max range=" + Number(oh.maxRange||0) + "\n";
       }
       technicalAppendix += "Direct React attempts: " + (crawl.directReactAttempts || 0) + " | Success signals: " + (crawl.directReactSuccessSignals || 0) + "\n";
       technicalAppendix += "Evidence scoping: route-DOM diagnostic=" + (crawl.routeDomScans || 0) + " | UI assets filtered=" + (crawl.filteredUiAssets || 0) + " | chrome links filtered=" + (crawl.filteredChromeLinks || 0) + " | configured URLs=" + (crawl.configuredUrlsFound || 0) + " | launch URLs=" + (crawl.launchUrlsFound || 0) + " | weak identity ignored=" + (crawl.weakIdentityMatchesIgnored || 0) + " | scoped bodies=" + (crawl.scopedBodyCaptures || 0) + " | incomplete text=" + (crawl.incompleteTextCaptures || 0) + "\n";       technicalAppendix += "Adaptive readiness: waits=" + (crawl.stabilityWaits || 0) + " | timeouts=" + (crawl.stabilityTimeouts || 0) + " | avg dwell=" + Math.round((crawl.stabilityTotalMs || 0) / Math.max(1, crawl.stabilityWaits || 0)) + "ms | evidence changes=" + (crawl.stabilityEvidenceChanges || 0) + "\n";
       technicalAppendix += "Session evidence: associated=" + (crawl.sessionAssociatedResponses || 0) + " | files=" + (crawl.sessionPayloadFiles || 0) + " | links=" + (crawl.sessionPayloadLinks || 0) + "\n";
       technicalAppendix += "Self-healing retry: targets=" + (crawl.retryTargets || 0) + " | attempts=" + (crawl.retryAttempts || 0) + " | improved=" + (crawl.retryImproved || 0) + " | resolved=" + (crawl.retryResolved || 0) + " | remainingWeak=" + (crawl.retryRemainingWeak || 0) + " | health=" + (crawl.runHealthGrade || "") + " | effectiveNavigated=" + (crawl.effectiveNavigated == null ? (crawl.navigated || 0) : crawl.effectiveNavigated) + "/" + (crawl.targets || 0) + "\n";
       if((crawl.assessmentTextHeuristicSkipped || []).length)technicalAppendix += "Generic body-text retry omitted for " + crawl.assessmentTextHeuristicSkipped.length + " assessment(s) with same-visit structured text receipts: " + crawl.assessmentTextHeuristicSkipped.map(function(x){return x.id;}).join(', ') + ". Media, behavior and source equivalence remain independent checks.\n";
       if (crawl.targetDiagnostics && crawl.targetDiagnostics.length) {
         crawl.targetDiagnostics.forEach(function(d) {
           technicalAppendix += "  - " + (d.name || d.id || "item") +
             ": found=" + (d.found ? "yes" : "no") +
             ", via=" + (d.navigation || d.reason || "none") +
             ", network=" + (d.networkResponses || 0) +
             ", associated=" + (d.associatedResponses || 0) +
             ", DOM=" + (d.domCaptured ? "yes" : "no") +
             ", surface=" + (d.editorSurfaceCaptured ? ("yes@" + String(d.editorSurfaceScore || "")) : "no") +
             ", routeScoped=" + (d.routeScopedSurfaceCaptured ? "yes" : "no") +
             ", strongIdentity=" + (d.strongIdentitySeed ? "yes" : "no") +
             ", genericName=" + (d.genericBaseName ? "yes" : "no") +
             ", upgraded=" + (d.upgraded ? "yes" : "no") +
             ", noise=" + String(d.ignoredNoise || 0) +
             ", foundReason=" + String(d.foundReason || "") +
             ", foundTag=" + String(d.tag || "") +
             ", visibleSeed=" + (d.visibleSeed ? "yes" : "no") +
             ", row=" + (d.rowFound ? (String(d.rowTag || "") + ":yes") : "no") +
             ", candidates=" + String(d.candidateCount || 0) +
             ", hiddenIdMatches=" + String(d.hiddenIdMatches || 0) +
             ", reactClick=" + String(d.reactClickCandidates || 0) +
             ", nativeInteractive=" + String(d.nativeInteractiveCandidates || 0) +
             ", subtree=" + String(d.rowSubtreeSize || 0) +
             ", scanSteps=" + String(d.viewportScanSteps || 0) +
             ", expanded=" + String(d.outlineExpanded || 0) +
             ", roots=" + String(d.scrollRootsTried || 0) +
             ", scanRoot=" + String(d.scanRootTag || "") +
             ", routeDOM=" + (d.routeDomObserved ? "yes" : "no") +
             ", weakIgnored=" + String(d.weakIdentityMatchesIgnored || 0) +
             ", uiFiltered=" + String(d.filteredUiAssets || 0) +
             ", chromeLinks=" + String(d.filteredChromeLinks || 0) +
             ", configuredUrls=" + String(d.configuredUrlsFound || 0) +
             ", launchUrls=" + String(d.launchUrlsFound || 0) +
             ", bodyScoped=" + (d.bodyScoped ? "yes" : "no") +
             ", textComplete=" + Math.round(Number(d.textCompleteness || 0) * 100) + "%" +
             ", textScope=" + (d.textScopeKind || "") +
             ", dwell=" + String(d.stabilityMs || 0) + "ms" +
             ", stableSamples=" + String(d.stabilitySamples || 0) +
             ", evidenceChanges=" + String(d.stabilityChanges || 0) +
             ", stabilityTimeout=" + (d.stabilityTimedOut ? "yes" : "no") +
             ", sessionAssoc=" + String(d.sessionAssociatedResponses || 0) +
             ", sessionFiles=" + String(d.sessionPayloadFiles || 0) +
             ", sessionLinks=" + String(d.sessionPayloadLinks || 0) +
             ", retry=" + (d.retryAttempted ? ("yes[" + String((d.retryReason || []).join("+")) + "], improved=" + (d.retryImproved ? "yes" : "no") + ", resolved=" + (d.retryResolved ? "yes" : "no")) : "no") +
             ", y=" + String(d.foundScrollY || 0) + "\n";
         if (d.questionCycleCaptureCompleteness) {
           var qc=d.questionCycleCaptureCompleteness, qt=d.questionCycleTraversal || {};
           var notApplicable=qc.answerKeyNotApplicableQuestionOrdinals || [];
           var requiredMissing=Array.isArray(qc.missingRequiredAnswerOrdinals)?qc.missingRequiredAnswerOrdinals:(qc.unansweredQuestionOrdinals || []);
           var finalRows=(res.itemResults || []).filter(function(r){return String(r.courseraId || '')===String(d.id || '') && r.checks && r.checks.structuredAssessment;});
           if(finalRows.length===1) {
             var finalAssessment=finalRows[0].checks.structuredAssessment, finalCoverage=finalAssessment.courseraCaptureCompleteness || {};
             technicalAppendix += "      Final assessment payload: question records=" + Number(finalAssessment.courseraQuestionCount || 0) + "/" + Number(finalAssessment.courseraDeclaredQuestionCount || 0) +
               " | explicit question coverage=" + (finalCoverage.questionCoverageComplete===true?"YES":finalCoverage.questionCoverageComplete===false?"NO":"NOT RECORDED") +
               " | comparison=" + String(finalAssessment.status || "UNVERIFIED") + "\n";
           }
           technicalAppendix += "      Question-cycle observation (intermediate; later recovery may supersede): question records=" + Number(qc.captured || 0) + "/" + Number(qc.declared || 0) +
             " | unique question IDs=" + (qc.uniqueQuestionIds==null?"not recorded":Number(qc.uniqueQuestionIds)) +
             " | question coverage=" + (qc.questionCoverageComplete ? "YES" : "NO") +
             " | answer keys=" + Number(qc.answerEvidence || 0) + "/" + Math.max(0,Number(qc.declared || 0)-notApplicable.length) +
             " | applicable evidence complete=" + ((qc.requiredAnswerCoverageComplete==null?qc.answerCoverageComplete:qc.requiredAnswerCoverageComplete) ? "YES" : "NO") +
             " | stop=" + String(qt.stopReason || qc.stopReason || "") +
             " | scroll steps=" + Number(qt.scrollSteps || 0) + " | pages advanced=" + Number(qt.paginationClicks || 0) + "\n";
           if ((qc.missingQuestionOrdinals || []).length) technicalAppendix += "      Question positions absent at this intermediate stage: " + qc.missingQuestionOrdinals.slice(0,30).join(", ") + (qc.missingQuestionOrdinals.length>30 || qc.missingOrdinalListTruncated ? " (list shortened)" : "") + "\n";
           if (requiredMissing.length) technicalAppendix += "      Positions without reliable answer keys at this intermediate stage: " + requiredMissing.slice(0,30).join(", ") + (requiredMissing.length>30 ? " (list shortened)" : "") + "\n";
           if (notApplicable.length) technicalAppendix += "      Answer key not applicable at positions: " + notApplicable.slice(0,30).join(", ") + "\n";
         }
         (d.candidatePreview || []).slice(0, 4).forEach(function(c) {
           technicalAppendix += "      candidate: " + String(c.tag || "") +
             " | scope=" + String(c.scope || "") +
             " | score=" + String(c.score || "") +
             " | react=" + (c.reactClick ? "yes" : "no") +
             " | key=" + (c.reactKeyPress ? "yes" : "no") +
             " | direct=" + (c.directAllowed ? "yes" : "no") +
             " | component=" + String(c.trackComponent || "") +
             " | action=" + String(c.trackAction || "") +
             " | props=" + String((c.reactProps || []).join(",")).slice(0,100) +
             " | " + String(c.label || "").slice(0,120) + "\n";
         });
         (d.controlAttempts || []).slice(0, 5).forEach(function(c) {
           technicalAppendix += "      control: " + String(c.tag || "") +
             " | scope=" + String(c.scope || "") +
             " | " + String(c.mode || "") +
             " | react=" + (c.reactClick ? "yes" : "no") +
             " | direct=" + (c.directAllowed ? "yes" : "no") +
             " | component=" + String(c.trackComponent || "") +
             " | " + String(c.label || "").slice(0,120) +
             " | surface=" + (c.surface ? ("yes@" + String(c.surfaceScore || "")) : "no") +
             (c.error ? (" | error=" + String(c.error || "").slice(0,100)) : "") + "\n";
         });
           (d.responseSummaries || []).forEach(function(r) {
             var h = r.harvested || {};
             technicalAppendix += "      ↳ " + String(r.method || "GET") + " " + String(r.path || "") +
               (r.operation ? (" | op=" + String(r.operation)) : "") +
               (r.bytes ? (" | bytes=" + String(r.bytes)) : "") +
               " | associated=" + (r.associated ? "yes" : "no") +
             (r.sessionAssociated ? " | session=yes" : "") +
               " | files=" + String(h.files || 0) +
               " links=" + String(h.links || 0) +
               " text=" + String(h.text || 0) + "\n";
           });
         });
       }
     }
     technicalAppendix += "\n";

     (res.itemResults || []).forEach(function(item) {
       text += item.verdict + " — " + item.sourceName + "\n";
       text += "  Observed Match: " + (item.verdict === 'INTENTIONAL_EXCLUSION' ? 'N/A' : (item.fidelityPercent + '%')) + " | Evidence Coverage: " + item.evidenceCoverage + "% | Structural match: " + Math.round((item.matchScore || 0) * 100) + "%\n";
       if (item.evidenceStrength) text += "  Evidence Strength: " + (item.evidenceStrength.score || 0) + "% (" + (item.evidenceStrength.label || "") + ")\n";
       text += "  Source: " + (item.sourceType || '') + " @ " + (item.sourcePath || 'Root') + "\n";
       if (item.courseraName) text += "  Coursera: " + item.courseraName + " [" + (item.courseraId || 'no stable ID') + "] — " + (item.courseraType || '') + " @ " + (item.courseraPath || 'Unavailable') + "\n";

       var checks = item.checks || {};
       if(item.verdict==='UNVERIFIED') text += '  Interpretation: scores describe observed signals only; this item is not fully verified.\n';
       if(checks.sourceTextNormalization) text += '  Source text normalization: '+checks.sourceTextNormalization.status+' — '+checks.sourceTextNormalization.reason+'\n';
       if(checks.reconciliationDiagnostic){
         var dg=checks.reconciliationDiagnostic;
         text += '  Source evidence: '+(dg.sourceScanner||'unknown scanner')+' | build='+(dg.sourceBuild||'unknown')+' | type='+dg.sourceTypeRaw+' | sample='+dg.sourceSampleLength+' | declared='+dg.sourceDeclaredLength+' | raw='+dg.rawSampleLength+'\n';
         text += '  Source preview: '+dg.sourcePreview+'\n';
         (dg.candidates||[]).forEach(function(c){text += '  Unconfirmed candidate: '+c.name+' ['+c.id+'] @ '+c.path+' | text='+(c.comparison&&c.comparison.status||'unknown')+' | similarity='+(c.comparison&&c.comparison.similarity!=null?Math.round(Number(c.comparison.similarity)*100)+'%':'unavailable')+' | scope='+c.scope+' | completeness='+Math.round(c.completeness*100)+'% | reason='+(c.comparison&&c.comparison.reason||'')+'\n';});
       }
       if(checks.destinationReadiness) checks.destinationReadiness.forEach(function(f){text += '  Destination readiness: '+f.code+' — '+f.detail+'\n';});
       if (checks.repackaging) {
         if (checks.repackaging.identityRecovered === true) text += "  Repackaging: unique renamed Discussion identity recovered" + (checks.repackaging.carriers && checks.repackaging.carriers.length ? " in " + checks.repackaging.carriers.map(function(c){ return c.name || c.id; }).join(', ') : '') + "; structural survival supported, source prompt equivalence unverified\n";
         else text += "  Repackaging: recovered " + (checks.repackaging.recoveredCount || 0) + "/" + (checks.repackaging.totalExpected || 0) + " expected payload signals" + (checks.repackaging.carriers && checks.repackaging.carriers.length ? " in " + checks.repackaging.carriers.map(function(c){ return c.name || c.id; }).join(', ') : '') + "\n";
       }
       var tf = checks.transformationFamily || checks.oneToManyTransformation || null;
       if (tf) {
         text += "  Transformation family: " + (tf.familyStatus || tf.status || 'UNVERIFIED') + " | mode " + (tf.mode || '') + " | destination items " + (tf.childCount || 0) + " | deep text " + (tf.textEvidenceChildren || 0) + "/" + (tf.childCount || 0) + " | source semantic coverage " + Math.round(Number(tf.directionalSourceCoverage || 0) * 100) + "%";
         if (tf.aggregateLengthRatio != null) text += " | aggregate/source length " + Math.round(Number(tf.aggregateLengthRatio || 0) * 100) + "%";
         text += "\n";
         if ((tf.childNames || []).length) text += "    CTI checked together: " + (tf.childNames || []).slice(0,30).join(' | ') + "\n";
       }
       if (checks.assets && checks.assets.relocated && checks.assets.relocated.length) text += "  Assets relocated: " + checks.assets.relocated.map(function(m){ return m.expected + " → " + (m.carrierName || m.carrierId || 'another item') + " [" + (m.method || '') + " " + Math.round(Number(m.score || 0) * 100) + "%]"; }).join(' | ') + "\n";
       if (checks.assets && checks.assets.transformed && checks.assets.transformed.length) text += "  Assets transformed: " + checks.assets.transformed.map(function(m){ return m.expected + " → " + (m.nativeSurface || 'native Coursera Assignment') + " [" + Math.round(Number(m.score || 0) * 100) + "% semantic evidence]"; }).join(' | ') + "\n";
       if (checks.assets && checks.assets.changedNative && checks.assets.changedNative.length) text += "  Native content changed: " + checks.assets.changedNative.map(function(m){ return m.expected + " → " + (m.nativeSurface || 'native Coursera rubric') + " [" + Math.round(Number(m.score || 0) * 100) + "% semantic evidence]"; }).join(' | ') + "\n";
       if (checks.transformation) {
         text += "  Native transformation: " + checks.transformation.status + " | " + (checks.transformation.transformedCount || 0) + "/" + (checks.transformation.expectedDocumentCount || 0) + " source PDFs | native rubrics " + (checks.transformation.rubricCount || 0);
         if (checks.transformation.rubricMismatchCount) text += " | rubric content mismatches " + String(checks.transformation.rubricMismatchCount);
         if (checks.transformation.sourceEvidenceSchemaVersion != null) text += " | source evidence schema " + String(checks.transformation.sourceEvidenceSchemaVersion || 0);
         if (checks.transformation.sourceEvidenceBuildId) text += " | source build " + String(checks.transformation.sourceEvidenceBuildId);
         if (checks.transformation.ignoredSourceReferenceCount) text += " | source-only refs ignored " + String(checks.transformation.ignoredSourceReferenceCount);
         if (checks.transformation.sourceRefreshRequired) text += " | SOURCE REFRESH REQUIRED";
         else if (Number(checks.transformation.pdfEvidenceMappingFailureCount || 0) > 0) text += " | SOURCE EVIDENCE MAPPING GAP";
         if (checks.transformation.pdfExtractionFailureCount) text += " | PDF extraction failures " + String(checks.transformation.pdfExtractionFailureCount);
         text += "\n";
         (checks.transformation.documents || []).forEach(function(d) {
           text += "    - " + (d.name || "PDF") + ": " + (d.status || "UNVERIFIED") + " | role=" + (d.role || "document");
           if (d.similarity != null) text += " | semantic " + Math.round(Number(d.similarity || 0) * 100) + "%";
           if (d.pdfParser) text += " | parser=" + d.pdfParser;
           if (d.pdfPagesRead) text += " | pagesScanned=" + d.pdfPagesRead;
           if (d.sampledPageCount) text += " | semanticWindows=" + d.sampledPageCount;
           if (d.bestSemanticPage) text += " | bestPage=" + d.bestSemanticPage;
           if (d.rubricAnchors && d.rubricAnchors.totalCriteria) text += " | rubricCriteria=" + (d.rubricAnchors.matchedCriteria || 0) + "/" + d.rubricAnchors.totalCriteria;
           if (d.reason) text += " | " + d.reason;
           text += "\n";
         });
       }
       if (checks.assets && checks.assets.missing && checks.assets.missing.length) text += "  Assets not observed: " + checks.assets.missing.join(', ') + "\n";
       if (checks.assets && checks.assets.unresolved && checks.assets.unresolved.length) text += "  Assets unresolved: " + checks.assets.unresolved.join(', ') + "\n";
       if (checks.assets && checks.assets.status === 'UNVERIFIED' && checks.assets.expected && checks.assets.expected.length && !(checks.assets.unresolved || []).length) text += "  Assets unverified: " + checks.assets.expected.join(', ') + "\n";
       if (checks.links && checks.links.relocated && checks.links.relocated.length) text += "  Links relocated: " + checks.links.relocated.map(function(m){ return m.expected + " → " + (m.carrierName || m.carrierId || 'another item'); }).join(' | ') + "\n";
       if (checks.links && checks.links.status === 'PARTIAL' && checks.links.missing && checks.links.missing.length) text += "  Links not observed: " + checks.links.missing.join(', ') + "\n";
       if (checks.links && checks.links.status === 'UNVERIFIED' && checks.links.expected && checks.links.expected.length) text += "  Links unverified: " + checks.links.expected.join(', ') + "\n";
       if (checks.content && checks.content.mode === 'STRUCTURED_ASSESSMENT') {
         text += "  Assessment: " + checks.content.status + (checks.content.similarity != null ? " (" + qaAssessmentScoreLabel_(checks.structuredAssessment || checks.content) + ")" : "") + (checks.content.reason ? " — " + checks.content.reason : "") + "\n";
       } else if (checks.content && (checks.content.status === 'CHANGED' || checks.content.status === 'DRIFT')) {
         text += "  Content: " + checks.content.status + (checks.content.similarity != null ? " (" + Math.round(checks.content.similarity * 100) + "% similarity)" : "") + "\n";
       } else if (checks.content && checks.content.status === 'UNVERIFIED' && checks.content.reason && (checks.content.sourceLength || checks.content.courseraLength)) {
         text += "  Content: UNVERIFIED — " + checks.content.reason + "\n";
       }
       if(checks.sourceLinkNormalization)text+='  Source URL evidence: '+checks.sourceLinkNormalization.status+' — '+checks.sourceLinkNormalization.reason+'\n';
       if(checks.externalWebpageTransformation)text+='  External webpage conversion: source target preserved | learner launch NOT_OBSERVED | '+checks.externalWebpageTransformation.sourceUrl+'\n';
       else if(checks.externalWebpageEvidence)text+=qaExternalWebpageDiagnosticText_(checks.externalWebpageEvidence);
       if (checks.structuredAssessment) {
         var sa = checks.structuredAssessment;
         text += "  Structured assessment: source " + (sa.sourceQuestionCount || 0) + " q | Coursera " + (sa.courseraQuestionCount || 0) + " q | aligned " + (sa.alignedQuestionCount || 0);
         if (sa.declaredCaptureIncomplete) text += " | declared source=" + sa.sourceDeclaredQuestionCount + " Coursera=" + sa.courseraDeclaredQuestionCount + " (capture incomplete)";
         if (sa.evidenceCoverage != null) text += " | coverage " + Math.round(Number(sa.evidenceCoverage || 0) * 100) + "%";
         if (sa.answerEvidenceCoverage != null) text += " | answer evidence " + qaAssessmentAnswerEvidenceText_(sa);
         if (sa.answerMismatchCount) text += " | answer mismatches " + sa.answerMismatchCount;
         if (sa.selectionPolicyStatus && sa.selectionPolicyStatus !== 'NOT_OBSERVED') {
           var sp = sa.sourceSelectionPolicy || {}, cp = sa.courseraSelectionPolicy || {};
           text += " | pool " + sa.selectionPolicyStatus + " source=" + (sp.selectCount == null ? '?' : sp.selectCount) + "/" + (sp.poolSize == null ? '?' : sp.poolSize) + " Coursera=" + (cp.selectCount == null ? '?' : cp.selectCount) + "/" + (cp.poolSize == null ? '?' : cp.poolSize);
         }
         text += "\n";
         var assessmentEvidence=qaAssessmentEvidenceText_(sa);
         if(assessmentEvidence)text+='    '+assessmentEvidence.replace(/\n/g,'\n    ')+'\n';
         (sa.questionResults || []).forEach(function(q) {
           text += "    Q" + (q.sourceIndex || '') + "→Q" + (q.courseraIndex || '') + ": " + ((q.details||{}).optionCaptureIssue?'UNVERIFIED':Math.round(Number(q.score || 0) * 100)+'%') + ((q.mismatches || []).length ? " [" + q.mismatches.join(', ') + "]" : "") + "\n";
           var difference=qaQuestionDifferenceText_(q);
           if(difference)text+='      '+difference.replace(/\n/g,'\n      ')+'\n';
         });
       }
       if (checks.content && checks.content.evidenceCompleteness != null) {
         text += "  Text evidence: " + Math.round(Number(checks.content.evidenceCompleteness || 0) * 100) + (checks.content.scopeKind === 'transformation-family-aggregate' ? "% of family children have text evidence" : "% reported capture completeness") + (checks.content.scopeKind ? " [" + checks.content.scopeKind + "]" : "") + (checks.content.lengthRatio != null ? " | length ratio " + Math.round(checks.content.lengthRatio * 100) + "%" : "") + "\n";
         if (checks.content.fieldScopedComparison && checks.content.sourceScopeKind) {
           text += "  Field alignment: source " + checks.content.sourceScopeKind + " ↔ destination " + (checks.content.scopeKind || 'learner-field') + (checks.content.sourceFieldSimilarity != null ? " | alignment " + Math.round(Number(checks.content.sourceFieldSimilarity || 0) * 100) + "%" : "") + (checks.content.sourceFieldConfidence != null ? " | confidence " + Math.round(Number(checks.content.sourceFieldConfidence || 0) * 100) + "%" : "") + "\n";
         }
       }
       if (checks.ingestionProvenance && (checks.ingestionProvenance.claims || []).length) {
         text += "  Ingestion provenance: " + (checks.ingestionProvenance.status || 'CLAIMED') + " — " + (checks.ingestionProvenance.reason || '') + "\n";
         (checks.ingestionProvenance.claims || []).forEach(function(c){ text += "    CLAIM " + (c.type || '') + (c.subject ? " | " + c.subject : "") + (c.target ? " -> " + c.target : "") + " | " + (c.excerpt || '') + "\n"; });
       }
       if (checks.publication && checks.publication.status === 'UNPUBLISHED') text += "  Publication: UNPUBLISHED/HIDDEN\n";
       if (checks.publication && checks.publication.status === 'RAW_UNPUBLISHED') text += "  Publication: RAW UNPUBLISHED — observed, not penalized\n";
       if (checks.publication && checks.publication.status === 'RAW_PUBLISHED') text += "  Publication: RAW PUBLISHED — observed\n";
       if (item.ownerAction && item.ownerAction.action) text += "  Assignment Owner: " + item.ownerAction.action + "\n";
       if (item.issues && item.issues.length) text += "  Flags: " + item.issues.join(', ') + "\n";
       text += "\n";
     });

     if (res.injected && res.injected.length) {
       text += "EXTRA COURSERA ITEMS\n";
       res.injected.forEach(function(item) {
         text += "- " + item.name + " [" + item.type + "]" + (item.path ? " @ " + item.path : "");
         if (item.extraLabel) text += " — " + item.extraLabel;
         text += "\n";
         if (item.ownerAction) text += "  Owner: " + item.ownerAction + "\n";
         if(item.sourceAssetProvenance)text+=qaSourceAssetProvenanceText_(item.sourceAssetProvenance);
       });
       text += "\n";
     }

     text += "\nTECHNICAL AUDIT APPENDIX — provenance, readiness, and capture diagnostics\n" + technicalAppendix;
     return text.trim();
 }
