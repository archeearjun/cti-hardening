import { createCtiProgressPanelV1 } from "./progress.js";
import { downloadJson, absolute, getJson, courseId, normalizeType, normalizeName, unique, stripHtml, sha256, sha256Buffer, ctiCourseraCourseLabel, ctiCourseraExportName, inferPublished, safeSourceLabel, enrichFromObservedObject, collectFieldValues, isAuthoringChromeUrl, extractConfiguredExternalUrls, shouldUseDomResourceElement, objectAssociationScore, discoverObservedItemTemplates, instantiateObservedTemplate, automaticDeepVerify } from "./text-and-dom.js";
import { perceptualHashBuffer, ctiSafeFileToken, ctiLocalFileTimestamp, fileNameFromUrl, assetDescriptor, uniqueAssetDetails, canonicalRemoteAssetKeyV614, hashRemoteAsset, isCourseraUiAssetUrl, readingAssetRequestsV61324, recoverReadingAssetUrlsV61324, attachmentFileTypeFromText } from "./assets.js";
import { harvestEvidence, textEvidenceSourcePriority, mergeEvidence, fingerprintsFromMaterial, collectCurrentDomEvidence, matchCurrentPageToFingerprint, fetchHtmlEvidence, mergeExactReadingEvidenceV61318, finalizeCapturedTextV61318, readingFrameEvidenceV61311, readingNetworkRecordsV61323, mergeReadingNetworkV61312 } from "./evidence.js";
import { collectEmbeddedPageState, visiblePluginConfigurationV61316, clearTypedPluginChromeV61317, pluginReadinessV6147, collectPluginEvidenceV6139, mergePluginEvidenceV6139 } from "./plugins.js";
import { sleepMs, readingLoadingOnlyV61312, exactReadingBodyV61318, choiceControlVisibilityV61320, unmarkedChoiceProbeV61320, choiceControlInVisiblePartV61319, choiceAncestryV61319, observedEmptyLayoutV61318, choiceDiagnosticsV61318, parseUnmarkedChoicesV61318, readingBodyGuardV61312, exactReadingEditorV61311, readingAttachmentLabelsV61323, readingAttachmentCoverageV61323, readingAttachmentStateV61324, readingNetworkDiagnosticsV61324, isRejectedItemNavigationUrl, elementTextKey, elementAttributeBlob, directElementTextKey, isExactVisibleTitleNode, isRejectedNavigationSeed, exactIdentityElements, isDocumentScrollRoot, scrollRootPosition, setScrollRootPosition, scrollRootMax, isPerItemNetworkNoise, isCourseWideNetworkResponse, waitForNetworkQuiet, waitForVisibleV6154, hasVisibleLoadingIndicator, findCurrentEditorSurface } from "./text-and-dom-2.js";
import { readingRouteTemplateV61312, authoringItemRouteV61311, certifiedReadingRouteV61311, readingRouteForTargetV61311, recoverReadingRouteV61311, canonicalOutlineUrl, isSafeCourseRoute, routeCandidateFromElement, findNavigationTargetInCurrentViewport, outlineScrollRoots, targetPathTokens, expandSafeOutlineDisclosures, expandAllSafeOutlineDisclosures, hydrateOutlineSurfaceForCrawl, findNavigationTargetForFingerprint } from "./navigation.js";
import { isAssignmentTextBlockV61321, parseAssignmentTextBlockV61321, collectAssignmentTextBlocksV61321, assignmentTextBlockBodyV61321, assignmentOutlineLinksV61320, emptyAssessmentProbeV61320, observedAssignmentLayoutV61319, assessmentLayoutDiagnosticV61318, attachQuestionFailureEvidenceV61318, isStructuredAssessmentFingerprint, assessmentTypeKey, exactAssessmentBadgeElements, optionRowForBadge, splitOptionSemanticText, optionDomTextV6136, optionDomEvidenceV6136, optionSemanticPartsFromRow, stripCourseraOptionDecoration, recoverCollapsedBadgeOptions, parseCourseraAssessmentTextFallback } from "./assessments.js";
import { assignmentBehaviorTextV61321, rubricRowForPoint, rubricLevelFromRow, rubricContainerForHeading, parseFlatRubricCandidate, parseCourseraRubricsFromText, mergeNativeRubricModels } from "./assessment-settings.js";
import { retryDecisionV61318, retryReasonsForDiagnostic, retrySeverity, buildRetryPlan, attachRetryResults } from "./retries.js";
import { mergeReadingRecoveryV61311, evidenceHasUsefulPayload, installReadOnlyNetworkRecorder, evidenceFromCapturedRecord, isHeavyHydrationFingerprint, quickRootEvidenceSnapshot, quickNetworkEvidenceSnapshot, isSessionScopedPayloadEndpoint, sanitizeSessionPayloadEvidence, startDomMutationCapture, genericSurfaceNeedsPayloadUpgrade, scoreSurfaceForFingerprint, isDiscussionFingerprintV6612, normalizeDiscussionBodyEvidenceV6612, mergeCourseraLearnerText, mergeTypedEditorRecoveryV61317, collectDomEvidenceFromRoot } from "./evidence-2.js";
import { waitForRouteChange, isLikelyWholeOutlineSurface, findRouteScopedItemEditorSurface, interleaveCrawlTargetsV61313, typedEditorRouteTypeV61316, typedEditorRouteV61316, crawlTargetPriority, safelyRouteWithHistory, safelyRestoreRoute, isGenericCourseEditRoute, isItemSpecificCourseRoute, returnToOutlineV6142, recoveryCrawlBudgetV61326, activeCrawlBudgetMs, itemAttemptBudgetV6153, diagnosticNavigated, targetedItemPayloadProbes } from "./navigation-2.js";
import { scopedWaitBudgetV61321, sessionEndpointContentKey, sessionAtomIsRelationPaired, isVisibleElement, surfaceRoleBonus, isGenericSmartIngestionName, editorSurfaceSignalScore, candidateSurfaceAncestors, snapshotOpenSurfaceRoots, findOpenedEditorSurface, estimateTextCompleteness, cleanDiscussionPromptTextV6612, collectSurfaceBodyText, textWithoutExactBadges, splitCarryDescriptionAndLabel, isObservedWrittenResponseV6138, parseWrittenResponsePartV6136, feedbackCoreV6611, stateSearchBudgetV61313, stateSearchStepV61313, ownStateValueV61313, ctiPlainTextV664, reactFiberForElementV664, findNamedValueV664 } from "./text-and-dom-3.js";
import { assessmentPromptKey_, mergeCourseraAssessmentEvidence, isAssessmentLikeFingerprintV662, assessmentPartCountV8, assessmentDeclaredCountV662, assessmentEnvelopeRootV662, assessmentQuestionNavCandidatesV662, expandAssessmentContentShellV663, assessmentQuestionDetailRootV662, inferSelectedQuestionTypeV662, questionEvidenceReadyV6138, parseSelectedAssessmentQuestionV662, assessmentCycleKeyV613, mergeQuestionIntoCycleV662 } from "./assessments-2.js";
import { mergeAssessmentModelIntoCycleV662, safeClickAssessmentQuestionV662, cleanAssignmentOptionFieldV6610, cleanAssignmentOptionAliasesV6610, ctiSeparateJoinedOptionFeedback_, ctiOptionLabelLooksLikeFeedback_, ctiOptionFeedbackRisk_, ctiGuardOptionEvidence_, ctiGuardAssessmentOptionEvidence_, normalizeAssignmentOptionRowsV6610, assignmentEntryTypeFromDomV6611, dropFeedbackPseudoOptionsV6611, parseAssignmentPartDomV665, assignmentPartEvidenceScoreV666, assessmentOutlinePromptAlignedV613, hydrateAssignmentPartV666 } from "./assessments-3.js";
import { assessmentOutlineCandidatesV613, assessmentScrollRootsV613, assessmentOutlineMoreV613, assessmentCaptureCoverageV613, assessmentLayoutV61313, exactAssessmentLayoutV61313, emptyAssessmentSnapshotV61313, assessmentDeadlineV61313, assessmentSurfaceDiagnosticsV61313, assessmentStateSeedsV664, parseOptionStateV664, parseQuestionStateV664, collectReactAssessmentStateV664, assessmentControlDiagnosticsV664, assessmentAnswerEvidenceCountV667, assessmentIsFullyAnswerHydratedV667, assessmentFromCycleMapV667, collectAssessmentSelectionPolicyFromText_, collectCourseraStructuredAssessment } from "./assessments-4.js";
import { objectTextV664, exactPointElements, cleanAttachmentDisplayName, collectCourseraAttachmentFacts, courseraControlValue, findLabeledCourseraControlValue, stripCourseraAttachmentBadgesFromLearnerText, detectCourseraIngestionFailure, typedEditorIdentityV61316, typedEditorTitleAnchorsV61316, typedEditorFieldsV61316, typedEditorSurfaceV61316, typedEditorDiagnosticsV61316, typedEditorNameFieldsV61317, typedEditorProductionSurfaceV61317, isDangerousEditorControl, isGlobalChromeElement, countNormalizedOccurrence, clickableAncestor, isStrongItemIdentityNode, interactiveAncestor, elementsAreNear, reactPropsForElement } from "./text-and-dom-4.js";
import { nativeAssignmentSectionsFromText, trimCourseraAssignmentLearnerText, normalizeAssignmentMetadataV61325, collectCourseraNativeAssignment, retainAssessmentSurfaceEvidenceV6138, assessmentTextReceiptV6146, genericAssessmentTextHeuristicNotApplicableV6146 } from "./assessments-5.js";
import { itemRowRootForFingerprint } from "./evidence-3.js";
import { previewHandlerSource, reactSignalsForElement, isDragHandleLike, rowSubtreeInteractionCandidates, editorControlCandidates, snapshotVisibleMenuRoots, visibleMenuEditorAction, makeDirectReactEvent, canDirectInvokeReactControl, invokeDirectReactControl, clearBlockingToasts, dispatchReadOnlyEditorControl, dismissEditorSurfaceSafely, diagnosticQualityScore } from "./text-and-dom-5.js";
import { MAX_WALK_NODES, MAX_AUTO_DEEP_API_PROBES, MAX_AUTO_DEEP_PAGE_FETCHES, REMOTE_ASSET_FETCH_TIMEOUT_MS, MAX_REMOTE_ASSET_BYTES, MAX_TEXT_SAMPLE, MAX_EXACT_READING_TEXT_V61318, MAX_EMBEDDED_STATE_SCRIPTS, MAX_CAPTURED_RESPONSE_CHARS, ACTIVE_CRAWL_FIXED_OVERHEAD_MS, ACTIVE_CRAWL_PER_TARGET_BUDGET_MS, ACTIVE_CRAWL_MAX_TOTAL_MS, ACTIVE_CRAWL_BASE_BUDGET_MS, CTI_PLUGIN_PRIMARY_MAX_MS, CTI_PLUGIN_RETRY_MAX_MS, CTI_ASSESSMENT_BASE_MS, CTI_ASSESSMENT_PER_QUESTION_MS, CTI_ASSESSMENT_MAX_MS, CTI_ASSESSMENT_ATTEMPT_MAX_MS, CTI_MAX_ITEM_ATTEMPTS, CTI_WHOLE_RUN_MAX_MS } from "./config.js";
import { captureContractV6150, captureContractSummaryV6150, compactDiagnosticV6150, createCheckpointManagerV6150, finalCaptureAccountingV6150 } from "./completion.js";
javascript:(async function () {
  "use strict";

  const CTI_RUN_LOCK_KEY = "__CTI_ITEM_FIDELITY_RUN_LOCK";
  const CTI_RUN_LOCK_STALE_MS = 45000;
  const existingRunLock = window[CTI_RUN_LOCK_KEY];
  const nowForLock = Date.now();
  let CTI_WHOLE_RUN_DEADLINE=nowForLock+CTI_WHOLE_RUN_MAX_MS;
  if (existingRunLock && existingRunLock.running &&
      (nowForLock - Number(existingRunLock.lastHeartbeatAt || existingRunLock.startedAt || 0)) < CTI_RUN_LOCK_STALE_MS) {
    console.warn("CTI Item Fidelity Extractor is already running. Second invocation blocked.", existingRunLock);
    return;
  }
  const CTI_RUN_TOKEN = "cti-" + nowForLock + "-" + Math.random().toString(36).slice(2);
  window[CTI_RUN_LOCK_KEY] = {
    running: true, token: CTI_RUN_TOKEN, startedAt: nowForLock, lastHeartbeatAt:nowForLock, version: "v6.15.4"
  };
  const ctiRunHeartbeat=setInterval(()=>{
    try{const current=window[CTI_RUN_LOCK_KEY];if(current && current.token===CTI_RUN_TOKEN && current.running)current.lastHeartbeatAt=Date.now();}catch(_){}
  },10000);
  function releaseCtiRunLock() {
    clearInterval(ctiRunHeartbeat);
    try {
      const current = window[CTI_RUN_LOCK_KEY];
      if (current && current.token === CTI_RUN_TOKEN) {
        window[CTI_RUN_LOCK_KEY] = {
          running: false, token: CTI_RUN_TOKEN, startedAt: current.startedAt, lastHeartbeatAt:Date.now(),
          finishedAt: Date.now(), version: "v6.15.4"
        };
      }
    } catch (e) {}
  }

  // CTI_PROGRESS_BEGIN
  let ctiProgress = null;
  function ctiProgressUpdateV1(patch) {
    try { if (typeof ctiProgress !== "undefined" && ctiProgress) ctiProgress.update(patch); } catch (_) {}
  }
  // CTI_PROGRESS_BEGIN: isolated display; never part of course evidence.

  // CTI_PROGRESS_END

  // CTI_PROGRESS_END
  let ctiCheckpointManager=null;
  try {

  const MAX_OBSERVED_API_FETCHES = 80;

  const MAX_TOTAL_REMOTE_ASSET_BYTES = 50000000;

  const ASSET_STAGE_MAX_MS = 120000;

  const MAX_ACTIVE_CRAWL_ITEMS = 0; // 0 = no primary item-count cap; time budget remains the safety bound
  // v6.12: primary crawl is capless by item count; budget scales with eligible items.
  // The previous fixed 240 s wall routinely stopped medium courses around 20/33.
  // Keep a hard safety ceiling, but give every eligible target a realistic visit window.

   // QA hardening: large virtualized assessments need a longer per-target window

  const MAX_ACTIVE_RECORDS_PER_ITEM = 24;
  const ACTIVE_CRAWL_SETTLE_MS = 2500;
  // Navigation/opening gets a short quiet check first; the later evidence-stability
  // phase remains authoritative and still has the full heavy-item dwell windows.
  const ACTIVE_CRAWL_EDITITEM_QUIET_MS = 1800;
  const ACTIVE_CRAWL_GENERIC_QUIET_MS = 2500;
  const ACTIVE_CRAWL_DIRECT_QUIET_MS = 1100;
  // v6.2: item editors hydrate at different speeds. Do not close on the first
  // visible shell; wait until item evidence itself is stable, within a hard cap.
  const EVIDENCE_STABILITY_SAMPLE_MS = 400;
  const EVIDENCE_STABILITY_REQUIRED_SAMPLES = 3;
  const EVIDENCE_STABILITY_MIN_MS = 1600;
  const EVIDENCE_STABILITY_HEAVY_MIN_MS = 2600;
  const EVIDENCE_STABILITY_EMPTY_HEAVY_MIN_MS = 4600;
  const EVIDENCE_STABILITY_MAX_MS = 12000;
  const EVIDENCE_STABILITY_HEAVY_MAX_MS = 20000;
  // v6.4 self-healing retry pass: only weak targets are reopened, with a
  // longer bounded dwell and one extra stable sample before accepting capture.
  const MAX_RETRY_ITEMS = 12;
  const RETRY_STABILITY_REQUIRED_SAMPLES = 4;
  const RETRY_STABILITY_MIN_MS = 2400;
  const RETRY_STABILITY_HEAVY_MIN_MS = 3600;
  const RETRY_STABILITY_EMPTY_HEAVY_MIN_MS = 6000;
  const RETRY_STABILITY_MAX_MS = 18000;
  const RETRY_STABILITY_HEAVY_MAX_MS = 30000;
  const ACTIVE_CRAWL_ROUTE_TIMEOUT_MS = 7000;

  // v6.14.7: a rendered course+item Reading Content field certifies identity.
  // Route strings alone never certify that the SPA mounted the requested item.

  async function waitForItemEvidenceStability(fp, recorder, initialCount, openedSurface, baselineOpenSurfaces, options) {
    options=options || {};
    const retryMode=Boolean(options.retryMode),started=Date.now(),heavy=isHeavyHydrationFingerprint(fp);
    const plugin=/plugin|widget|lti/i.test(String(fp.type || '')+' '+String(fp.typeName || ''));
    const configuredMaxMs=plugin?(retryMode?CTI_PLUGIN_RETRY_MAX_MS:CTI_PLUGIN_PRIMARY_MAX_MS):retryMode ? (heavy?RETRY_STABILITY_HEAVY_MAX_MS:RETRY_STABILITY_MAX_MS) : (heavy?EVIDENCE_STABILITY_HEAVY_MAX_MS:EVIDENCE_STABILITY_MAX_MS);
    const deadline=options.deadline==null?Infinity:Number(options.deadline),remaining=Math.max(0,deadline-started);
    const baseMaxMs=Math.min(configuredMaxMs,remaining),hardMaxMs=Math.min(plugin?configuredMaxMs:configuredMaxMs+(heavy?20000:12000),remaining);
    let maxMs=baseMaxMs,minMs=retryMode?(heavy?RETRY_STABILITY_HEAVY_MIN_MS:RETRY_STABILITY_MIN_MS):(heavy?EVIDENCE_STABILITY_HEAVY_MIN_MS:EVIDENCE_STABILITY_MIN_MS);
    const requiredStableSamples=retryMode?RETRY_STABILITY_REQUIRED_SAMPLES:EVIDENCE_STABILITY_REQUIRED_SAMPLES;
    const sampleMs=retryMode?Math.max(450,EVIDENCE_STABILITY_SAMPLE_MS):EVIDENCE_STABILITY_SAMPLE_MS;
    if(plugin)minMs=Math.max(minMs,10000);
    let pluginSnapshot=null,pluginRoot=null,pluginRootSeenAt=0;
    let stableSamples=0,samples=0,evidenceChanges=0,previousSignature='',surface=openedSurface;
    let last={dom:{},network:{}},maxima=null,lastProgressAt=-1,extendedForProgressAt=-1;
    const extensions=[],networkSummaryCache=new WeakMap();
    function result(reason,timedOut) {
      return {surface,dwellMs:Date.now()-started,samples,stableSamples,evidenceChanges,timedOut,heavy,retryMode,last,
        stopReason:reason,baseBudgetMs:baseMaxMs,hardBudgetMs:hardMaxMs,grantedBudgetMs:maxMs,
        pluginReadiness:pluginSnapshot?pluginReadinessV6147(pluginSnapshot):null,progressExtensions:extensions,meaning:'A stable observed editor is not proof of complete content or external-frame access.'};
    }
    while(Date.now()-started<maxMs) {
      if(typeof document !== 'undefined' && document.visibilityState !== 'visible') return result('DOCUMENT_HIDDEN_DURING_STABILITY',true);
      if(!surface || !surface.root || !surface.root.isConnected || !isVisibleElement(surface.root)) {
        surface=findCurrentEditorSurface(fp,baselineOpenSurfaces,options.strongSessionIdentity===true);
      }
      const dom=quickRootEvidenceSnapshot(surface && surface.root,fp),net=quickNetworkEvidenceSnapshot(recorder,fp,initialCount,networkSummaryCache);
      if(plugin && surface?.root!==pluginRoot){pluginRoot=surface?.root || null;pluginRootSeenAt=Date.now();}
      pluginSnapshot=plugin && surface?.root?collectPluginEvidenceV6139(surface.root,fp):null;
      last={dom,network:net};samples++;
      const elapsed=Date.now()-started;
      const meaningful=Boolean(dom.files || dom.links || dom.textLength>=80 || net.files || net.links);
      if(heavy && (!meaningful || !surface))minMs=Math.max(minMs,retryMode?RETRY_STABILITY_EMPTY_HEAVY_MIN_MS:EVIDENCE_STABILITY_EMPTY_HEAVY_MIN_MS);
      // Actual payload growth earns more time. Request counts, spinner animation,
      // and changing chrome do not earn extensions by themselves.
      const scopedText=Number(dom.textCompleteness)>=.5 || /^(reading-content-field|assignment-text-blocks|field-aggregate)$/.test(String(dom.textScope || ''));
      const measures=[dom.files,dom.links,dom.frames,scopedText?dom.textLength:0,scopedText?dom.textCompleteness:0,net.files,net.links,net.text,pluginSnapshot?(pluginSnapshot.frames || []).reduce((n,f)=>n+Number(f.textLength || 0),0):0].map(x=>Number(x)||0);
      if(maxima && measures.some((x,i)=>x>maxima[i]))lastProgressAt=elapsed;
      maxima=maxima?measures.map((x,i)=>Math.max(x,maxima[i])):measures;
      const signature=[surface&&surface.root?'surface':'nosurface',dom.signature,net.signature,plugin?JSON.stringify(pluginSnapshot):'',location.pathname+location.search].join('||');
      if(previousSignature && signature===previousSignature && !dom.loading && surface && surface.root)stableSamples++;
      else {if(previousSignature && signature!==previousSignature)evidenceChanges++;stableSamples=0;}
      previousSignature=signature;
      if(elapsed>=minMs && stableSamples>=requiredStableSamples && (!plugin || (Date.now()-pluginRootSeenAt>=10000 && !pluginReadinessV6147(pluginSnapshot).pending)))return result('STABLE_SCOPED_EVIDENCE',false);
      if(elapsed+sampleMs>=maxMs && maxMs<hardMaxMs && lastProgressAt>extendedForProgressAt && elapsed-lastProgressAt<=4000) {
        const previousMaxMs=maxMs;
        maxMs=Math.min(hardMaxMs,maxMs+4000);extendedForProgressAt=lastProgressAt;
        extensions.push({atMs:elapsed,addedMs:maxMs-previousMaxMs,progressAtMs:lastProgressAt,reason:'NEW_PAYLOAD_EVIDENCE'});
        if(typeof ctiProgressUpdateV1==='function')ctiProgressUpdateV1({detail:String(fp.name || fp.id)+' · New content still appearing · '+Math.round(elapsed/1000)+'s on this item · allowing more time'});
      }
      await sleepMs(Math.max(0,Math.min(sampleMs,maxMs-(Date.now()-started))));
    }
    return result(Date.now()>=deadline?'COURSE_TIME_BUDGET_REACHED':!surface?'EDITOR_NOT_OBSERVED':extensions.length?'PROGRESS_WAIT_LIMIT_REACHED':last.dom.loading?'LOADING_WITHOUT_SETTLED_EVIDENCE':'EVIDENCE_WAIT_LIMIT_REACHED',true);
  }

  // v6.6.5: generic Smart Ingestion shells can expose a shallow editor/form
  // surface (typically score ~0.93-0.97) before the real item editor finishes
  // opening. Treat that as useful fallback text, not as a reason to stop the
  // activation sequence. The v6.5.8 run proved that a second, direct React
  // activation on the same strongly-ID'd row is what triggered the payload-
  // bearing requests for carrier readings such as Summative Assessment Resources.

  // v6.7.1: Discussion editors can append author-only Coursera guidance to the
  // learner prompt. That chrome must never participate in the learner-facing text
  // fingerprint or create a false CONTENT_CHANGED verdict.

  // v6.5: structured Coursera Assignment extraction from the live editor DOM.
  // Exact visual Correct/Incorrect badges are used instead of flat-text token
  // splitting, so answer text such as "Correct Selections" cannot create fake
  // option boundaries.

  // A detached clone has no rendered innerText layout. Preserve actual block
  // boundaries while keeping inline emphasis inside the same logical text.

  // Bounded field evidence for unresolved options; no HTML, URLs or input values.

  // v6.6.5: unpublished multi-question assignments can render only the currently
  // selected question body even though the editor contains navigation controls for
  // all questions. Expand to the nearest bounded assessment envelope first; if the
  // whole assessment is still not present in one DOM tree, cycle the visible
  // read-only question selectors and merge each observed question deterministically.

  // v6.6.5: question controls in untouched Coursera assignments can live in a
  // portal/sibling tree well outside the bounded detail surface. Once we have a
  // strongly identified assessment item and a declared multi-question count, scan
  // progressively wider ancestors and finally the document for *question-semantic*
  // controls only. This is intentionally read-only and excludes course-outline
  // edititem controls and all mutating controls.

  // v6.6.11: Coursera's current assignment editor exposes a deterministic left
  // sidebar with one hash link per question and matching DOM panels named
  // data-testid="assignment-part-N". This is substantially safer than guessing
  // generic clickable descendants, and it works even when the item title is
  // still the Smart-Ingestion placeholder "Untitled".
  // v6.6.11: keep authoring controls and feedback prose out of answer rows.
  // This is deliberately suffix-only / exact-boundary cleanup so learner text
  // containing similar words is not rewritten.

  // v6.6.11: distinguish real selectable answer options from Coursera's
  // text-entry / regex answer editor. In those question types the authoring DOM
  // can decorate the accepted answer with a "Correct" badge and the incorrect
  // explanation with an "Incorrect" badge even though neither is a choice.

  // v6.13: discover the live question index repeatedly. A sidebar may contain
  // only the currently mounted window, or append more rows after scrolling.

  async function collectAssessmentFromOutlineDomV665(surfaceRoot, fp, declaredHint, options) {
    const out = {attempted:false, anchors:0, resolvedTargets:0, questionCount:0, assessment:null, preview:[],
      scrollSteps:0, paginationClicks:0, navigationClicks:0, hydrationAttempts:0, stopReason:'NO_OUTLINE', elapsedMs:0, errors:[]};
    if (!surfaceRoot || !isAssessmentLikeFingerprintV662(fp)) return out;
    options = options || {};
    const observedParts=assessmentPartCountV8(surfaceRoot);
    let declared = observedParts>0?observedParts:Number(declaredHint || 0);
    const start = Date.now();
    const budget = Math.min(900000, Math.max(45000, 20000 + declared * 4500));
    const deadline = Math.min(Number(options.deadline || Infinity), start + budget);
    const roots = [surfaceRoot];
    for (let p=surfaceRoot.parentElement, depth=0; p && depth<7; p=p.parentElement,depth++) roots.push(p);
    roots.push(document.body);
    function liveSidebar() {
      for (const root of roots) {
        if (!root || !root.isConnected) continue;
        const bars = [...root.querySelectorAll('[data-testid="item-layout-left-sidebar"]')].filter(el=>isVisibleElement(el) && /\bContent\s*\(\s*\d+\s*\)/i.test(el.innerText || el.textContent || ''));
        if (bars.length) return bars.sort((a,b)=>b.querySelectorAll('a[href^="#"]').length-a.querySelectorAll('a[href^="#"]').length)[0];
      }
      return null;
    }
    if (!liveSidebar()) return out;
    out.attempted = true;
    const textPartOrdinals=new Set();
    const known = new Map(), questions = new Map(), attempts = new Map(), scrolls = new Map(), pageClicks = new Set();
    // Only the same in-memory run supplies seeds. Each reused question must be
    // rediscovered in this editor with the same ID, ordinal and prompt prefix.
    const seeds=new Map();let reusedQuestions=0;
    for(const q of options.seedAssessment?.questions || []) {
      if(q.courseraQuestionId && q.questionOrdinalObserved && questionEvidenceReadyV6138(q))seeds.set(String(q.courseraQuestionId),q);
    }
    let idle = 0, turn = 0, stopReason = 'NO_FURTHER_QUESTIONS';
    function discover(sidebar) {
      const count = assessmentPartCountV8(sidebar);
      declared = Math.max(declared, count);
      const live = assessmentOutlineCandidatesV613(sidebar, declared);
      // Keep diagnostic identity only. Virtualized question DOM must not be
      // retained for the lifetime of a large assessment.
      for (const candidate of live) known.set(candidate.id, {id:candidate.id,ordinal:candidate.ordinal,
        href:candidate.href,label:candidate.label,targetTestId:candidate.targetTestId});
      for(const candidate of live)if(/~textBlock!~/i.test(candidate.id)||isAssignmentTextBlockV61321(candidate.target))textPartOrdinals.add(candidate.ordinal);
      return live;
    }
    function currentQuestions() { return [...questions.values()].sort((a,b)=>Number(a.id)-Number(b.id)); }
    function complete() { return assessmentCaptureCoverageV613(currentQuestions(), Math.max(0,declared-textPartOrdinals.size),'',{declaredContentParts:declared,nonQuestionPartOrdinals:[...textPartOrdinals]}).requiredAnswerCoverageComplete; }
    function score(q) { return q ? (q.answerTextReliable ? 1000 : 0) + (q.optionTextReliable ? 100 : 0) + Number(q.parserConfidence || 0)*10 : -1; }
    try {
      while (Date.now() < deadline) {
        const sidebar = liveSidebar();
        if (!sidebar) { stopReason='EDITOR_OUTLINE_UNAVAILABLE'; break; }
        const before = known.size + questions.size + currentQuestions().filter(q=>q.answerTextReliable).length;
        const live = discover(sidebar);
        for (const candidate of live) {
          if (Date.now() >= deadline) break;
  // CTI_PROGRESS_BEGIN
          if (typeof ctiProgressUpdateV1 === "function") ctiProgressUpdateV1({detail:String(fp.name || fp.id) + " · " + questions.size + (declared ? "/" + declared : "") + " questions collected; reading question " + candidate.ordinal});
  // CTI_PROGRESS_END
          if(textPartOrdinals.has(candidate.ordinal))continue;
          const seed=seeds.get(candidate.id);
          if(!questions.has(candidate.id) && seed && Number(seed.id)===candidate.ordinal && assessmentOutlinePromptAlignedV613(candidate.label,seed.prompt)) {
            questions.set(candidate.id,JSON.parse(JSON.stringify(seed)));reusedQuestions++;
          }
          const previous = questions.get(candidate.id);
          if (questionEvidenceReadyV6138(previous)) continue;
          if (Number(attempts.get(candidate.id) || 0) >= 2) continue;
          // A prior activation may have virtualized this row away. Rediscover it
          // before clicking; detached cached nodes are not navigation controls.
          const fresh = discover(liveSidebar()).find(c=>c.id===candidate.id);
          if (!fresh) continue;
          attempts.set(fresh.id, Number(attempts.get(fresh.id) || 0)+1);
          out.hydrationAttempts++;
          const hydrated = await hydrateAssignmentPartV666(fresh, fresh.target, deadline);
          if (hydrated && hydrated.clicked) out.navigationClicks++;
          const target = hydrated && hydrated.target;
          if (!target || !document.contains(target) || target.id !== fresh.id) continue;
          const panelNumber = String(target.getAttribute('data-testid') || '').match(/^assignment-part-(\d+)$/);
          if (!panelNumber) continue;
          const ordinal = Number(panelNumber[1])+1;
          if (fresh.ordinal && ordinal!==fresh.ordinal) continue;
          let q = parseAssignmentPartDomV665(target, fp, ordinal, fresh.label);
          if (!q || !q.prompt) continue;
          if (!assessmentOutlinePromptAlignedV613(fresh.label,q.prompt)) {
            if (out.errors.length<20) out.errors.push({ordinal,reason:'PROMPT_NOT_ALIGNED_WITH_OUTLINE'});
            continue;
          }
          q.courseraQuestionId = fresh.id;
          q.questionOrdinalObserved = true;
          q.id = String(ordinal);
          q._cycleOrdinal = ordinal;
          if (score(q)>score(previous)) questions.set(fresh.id,q);
        }
        if (complete()) { stopReason='COMPLETE'; break; }
        const refreshed = liveSidebar();
        if (!refreshed) { stopReason='EDITOR_OUTLINE_UNAVAILABLE'; break; }
        discover(refreshed);
        const liveEnvelope=roots.find(r=>r && r.isConnected && r.contains(refreshed) && r.querySelector('[data-testid^="assignment-part-"]')) || surfaceRoot;
        const scrollRoots = assessmentScrollRootsV613(refreshed, liveEnvelope);
        let moved = false;
        for (let offset=0; offset<scrollRoots.length; offset++) {
          const root = scrollRoots[(turn+offset)%scrollRoots.length];
          let state = scrolls.get(root);
          if (!state) { state={original:scrollRootPosition(root),cursor:0,started:false}; scrolls.set(root,state); }
          const max = scrollRootMax(root);
          if (!state.started) {
            state.started=true;
            await setScrollRootPosition(root,0); moved=true;
          } else if (state.cursor < max-1) {
            const height=isDocumentScrollRoot(root)?Number(window.innerHeight || 600):Number(root.clientHeight || 600);
            state.cursor=Math.min(max,state.cursor+Math.max(100,Math.floor(height*0.7)));
            await setScrollRootPosition(root,state.cursor); moved=true;
          }
          if (moved) { turn=(turn+offset+1)%scrollRoots.length; out.scrollSteps++; break; }
        }
        if (!moved) {
          const more = assessmentOutlineMoreV613(refreshed);
          const visible = assessmentOutlineCandidatesV613(refreshed,declared);
          const pageKey = visible.map(c=>c.id).join('|');
          if (more && !pageClicks.has(pageKey) && safeClickAssessmentQuestionV662(more)) {
            pageClicks.add(pageKey); out.paginationClicks++; moved=true;
            for (const state of scrolls.values()) { state.cursor=0; state.started=false; }
            await sleepMs(400);
          }
        }
        const after = known.size + questions.size + currentQuestions().filter(q=>q.answerTextReliable).length;
        if (moved || after>before) idle=0; else idle++;
        if (idle>=4) break;
        await sleepMs(moved?120:450);
      }
      if (Date.now()>=deadline && !complete()) stopReason='TIME_BUDGET';
    } finally {
      // Restore only positions changed by this traversal. No content or settings
      // are edited, and the saved question evidence survives DOM unmounting.
      for (const [root,state] of scrolls) if (root.isConnected) await setScrollRootPosition(root,state.original);
    }
    out.elapsedMs=Date.now()-start; out.stopReason=stopReason;
    out.anchors=known.size; out.resolvedTargets=questions.size;
    out.preview=[...known.values()].slice(0,12).map(c=>({ordinal:c.ordinal,href:c.href,label:c.label.slice(0,180),targetFound:questions.has(c.id),targetTestId:c.targetTestId}));
    const captured=currentQuestions().map(q=>{const x=JSON.parse(JSON.stringify(q));delete x._cycleOrdinal;return x;});
    out.questionCount=captured.length;
    const declaredContentParts=declared || known.size;
    const finalDeclared=Math.max(0,declaredContentParts-textPartOrdinals.size);
    const coverage=assessmentCaptureCoverageV613(captured,finalDeclared,stopReason,{declaredContentParts,nonQuestionPartOrdinals:[...textPartOrdinals]});
    out.captureCompleteness=coverage;
    if (!captured.length) return out;
    const evidence={anchors:known.size,resolvedTargets:questions.size,scrollSteps:out.scrollSteps,paginationClicks:out.paginationClicks,
      navigationClicks:out.navigationClicks,hydrationAttempts:out.hydrationAttempts,reusedQuestions,stopReason,elapsedMs:out.elapsedMs,budgetMs:budget,effectiveBudgetMs:Math.max(0,deadline-start),preview:out.preview,errors:out.errors};
    out.assessment={schemaVersion:6,parser:'coursera-assignment-outline-dom-v2-dynamic',origin:'coursera-authoring-dom',
      declaredQuestionCount:finalDeclared,questionCount:captured.length,answerEvidenceQuestionCount:coverage.answerEvidence,
      questions:captured,parserConfidence:coverage.requiredAnswerCoverageComplete?0.98:0.84,
      warnings:coverage.requiredAnswerCoverageComplete?[]:['Assessment capture is incomplete; see captureCompleteness for unobserved questions or answer evidence.'],
      captureCompleteness:coverage,outlineEvidence:evidence,
      selectionPolicy:collectAssessmentSelectionPolicyFromText_(String(liveSidebar()?.textContent || ''),finalDeclared)};
    return out;
  }

  async function collectCourseraAssessmentByQuestionCycleV662(surfaceRoot, fp, options) {
    const stats = {
      attempted:false, declared:0, navCount:0, clicks:0, captured:0, assessment:null,
      expandedContent:false, candidatePreview:[], reactStateAttempted:false,
      reactStateQuestions:0, reactStateArraysScanned:0, reactStateCandidates:[], controlDiagnostics:[],
      outlineDomAttempted:false, outlineDomAnchors:0, outlineDomResolvedTargets:0, outlineDomQuestions:0, outlineDomPreview:[]
    };
    if (!surfaceRoot || !isAssessmentLikeFingerprintV662(fp)) return stats;
    options=options || {};
    const cycleDeadline=Math.min(Number(options.deadline || Infinity),Date.now()+900000);
    let envelope = assessmentEnvelopeRootV662(surfaceRoot, fp) || surfaceRoot;
    const emptyBefore=options.certifiedItem===true ? emptyAssessmentSnapshotV61313(surfaceRoot,fp) : null;
    if (emptyBefore && Date.now()+1200<cycleDeadline) {
      await sleepMs(1200);
      const emptyAfter=emptyAssessmentSnapshotV61313(surfaceRoot,fp);
      if (emptyAfter && emptyBefore.signature===emptyAfter.signature && emptyBefore.route===emptyAfter.route) {
        stats.emptyEditorEvidence={status:'OBSERVED_EMPTY_EDITOR',itemId:String(fp.id),
          route:emptyAfter.route,observedAt:new Date().toISOString(),samples:2,intervalMs:1200,
          marker:emptyAfter.marker,scope:'EXACT_ITEM_ASSIGNMENT_LAYOUT',sourceCompleteness:'NOT_DETERMINED'};
        stats.stopReason='STABLE_EMPTY_EDITOR';
        return stats;
      }
    }
    const blockBefore=options.certifiedItem===true?collectAssignmentTextBlocksV61321(envelope,fp):null;
    if(blockBefore && blockBefore.completeTextBlockOnly && Date.now()+1200<cycleDeadline) {
      await sleepMs(1200);
      const blockAfter=collectAssignmentTextBlocksV61321(envelope,fp);
      if(blockAfter && blockAfter.completeTextBlockOnly && JSON.stringify(blockBefore)===JSON.stringify(blockAfter)) {
        stats.contentBlockEvidence=blockAfter;stats.stopReason='STABLE_TEXT_BLOCK_ONLY_EDITOR';
        stats.declaredContentParts=blockAfter.declaredContentParts;
        // Content (N) counts these instruction blocks; it does not declare N questions.
        return stats;
      }
    }
    const wideModel = collectCourseraStructuredAssessment(envelope, fp);
    let declared = Math.max(assessmentDeclaredCountV662(envelope), Number(wideModel && wideModel.declaredQuestionCount || 0));
    stats.declared = declared;

    const questionMap = new Map();
    mergeAssessmentModelIntoCycleV662(questionMap, wideModel);

    // v6.6.11: first use Coursera's own assignment outline as a deterministic
    // index into the matching question panels. This is read-only DOM evidence and
    // avoids guessing from generic React children.
    const outlineProbe = await collectAssessmentFromOutlineDomV665(envelope, fp, declared, {deadline:cycleDeadline,seedAssessment:options.seedAssessment});
    stats.outlineDomAttempted = Boolean(outlineProbe && outlineProbe.attempted);
    stats.attempted = stats.outlineDomAttempted;
    stats.clicks += Number(outlineProbe && outlineProbe.navigationClicks || 0);
    stats.outlineDomTraversal = outlineProbe && outlineProbe.assessment ? outlineProbe.assessment.outlineEvidence : outlineProbe;
    stats.captureCompleteness = outlineProbe && outlineProbe.captureCompleteness || null;
    stats.outlineDomAnchors = Number(outlineProbe && outlineProbe.anchors || 0);
    stats.outlineDomResolvedTargets = Number(outlineProbe && outlineProbe.resolvedTargets || 0);
    stats.outlineDomQuestions = Number(outlineProbe && outlineProbe.questionCount || 0);
    stats.outlineDomPreview = outlineProbe && Array.isArray(outlineProbe.preview) ? outlineProbe.preview : [];
    if (outlineProbe && outlineProbe.assessment) {
      declared = Number(outlineProbe.assessment.declaredQuestionCount || declared);
      stats.declared = declared;
      mergeAssessmentModelIntoCycleV662(questionMap, outlineProbe.assessment);
      if (declared > 0 && assessmentIsFullyAnswerHydratedV667(outlineProbe.assessment, declared)) {
        stats.captured = Number(outlineProbe.assessment.questionCount || 0);
        stats.assessment = outlineProbe.assessment;
        return stats;
      }
    }

    // v6.6.5: before clicking anything, inspect the bounded React component/query
    // state for the strongly identified assignment. Untouched Smart Ingestion
    // assignments can keep all question objects in React state while rendering only
    // one selected question in the visible editor DOM.
    const stateProbe = collectReactAssessmentStateV664(envelope, fp, declared, {deadline:cycleDeadline});
    stats.reactStateElapsedMs=Number(stateProbe && stateProbe.elapsedMs || 0);
    stats.reactStateStopReason=String(stateProbe && stateProbe.stopReason || '');
    stats.reactStateTruncated=Boolean(stateProbe && stateProbe.truncated);
    stats.reactStateAttempted = Boolean(stateProbe && stateProbe.attempted);
    stats.reactStateQuestions = Number(stateProbe && stateProbe.questionCount || 0);
    stats.reactStateArraysScanned = Number(stateProbe && stateProbe.arraysScanned || 0);
    stats.reactStateCandidates = stateProbe && Array.isArray(stateProbe.candidateArrays) ? stateProbe.candidateArrays : [];
    if (stateProbe && stateProbe.assessment) {
      declared = Math.max(declared, Number(stateProbe.assessment.declaredQuestionCount || 0));
      stats.declared = declared;
      mergeAssessmentModelIntoCycleV662(questionMap, stateProbe.assessment);
      const mergedAfterState = assessmentFromCycleMapV667(questionMap, declared, {
        contentPartCoverage:stats.captureCompleteness,
        reactStateAttempted:true,
        reactStateQuestions:Number(stateProbe.assessment.questionCount || 0),
        reactStateArraysScanned:Number(stateProbe.arraysScanned || 0),
        reactStateCandidates:Array.isArray(stateProbe.candidateArrays) ? stateProbe.candidateArrays : [],
        outlineDomAttempted:stats.outlineDomAttempted,
        outlineDomAnchors:stats.outlineDomAnchors,
        outlineDomResolvedTargets:stats.outlineDomResolvedTargets,
        outlineDomQuestions:stats.outlineDomQuestions,
        outlineDomPreview:stats.outlineDomPreview
      });
      if (declared > 1 && assessmentIsFullyAnswerHydratedV667(mergedAfterState, declared)) {
        stats.captured = Number(mergedAfterState.questionCount || 0);
        stats.assessment = mergedAfterState;
        return stats;
      }
    }

    let navs = assessmentQuestionNavCandidatesV662(envelope, fp, declared);
    if (declared > 1 && navs.length < 2) {
      stats.expandedContent = expandAssessmentContentShellV663(envelope, declared);
      if (stats.expandedContent) {
        await sleepMs(360);
        navs = assessmentQuestionNavCandidatesV662(envelope, fp, declared);
      }
    }
    declared = Math.max(declared, navs.length);
    stats.declared = declared;
    stats.navCount = navs.length;
    stats.candidatePreview = navs.slice(0,12).map(n => ({ordinal:Number(n.ordinal||0), scope:String(n.scope||''), label:String(n.label||'').slice(0,260)}));
    if (declared > 1 && navs.length < declared) stats.controlDiagnostics = assessmentControlDiagnosticsV664(envelope);

    if (declared > 1 && wideModel && assessmentIsFullyAnswerHydratedV667(wideModel, declared)) {
      stats.captured = Number(wideModel.questionCount || 0);
      stats.assessment = wideModel;
      return stats;
    }
    if (declared < 2 && navs.length < 2) {
      if (questionMap.size) {
        const qs = [...questionMap.values()].map((q,i) => Object.assign({}, q, {id:String(i+1), _cycleOrdinal:undefined}));
        stats.captured = qs.length;
        // Retain the observed model even when its only question has unresolved
        // type or answer evidence. Returning it is not a completeness claim.
        stats.assessment = outlineProbe && outlineProbe.assessment || assessmentFromCycleMapV667(questionMap,declared,{contentPartCoverage:stats.captureCompleteness,navigationCandidates:navs.length});
      }
      return stats;
    }
    if (navs.length < 2) {
      const merged = assessmentFromCycleMapV667(questionMap, declared, {
        contentPartCoverage:stats.captureCompleteness,
        navigationCandidates:navs.length,
        clicks:stats.clicks,
        expandedContent:Boolean(stats.expandedContent),
        candidatePreview:stats.candidatePreview,
        reactStateAttempted:stats.reactStateAttempted,
        reactStateQuestions:stats.reactStateQuestions,
        reactStateArraysScanned:stats.reactStateArraysScanned,
        reactStateCandidates:stats.reactStateCandidates,
        outlineDomAttempted:stats.outlineDomAttempted,
        outlineDomAnchors:stats.outlineDomAnchors,
        outlineDomResolvedTargets:stats.outlineDomResolvedTargets,
        outlineDomQuestions:stats.outlineDomQuestions,
        outlineDomPreview:stats.outlineDomPreview,
        controlDiagnostics:stats.controlDiagnostics
      });
      if (merged) {
        stats.captured = Number(merged.questionCount || 0);
        stats.assessment = merged;
      } else if (stateProbe && stateProbe.assessment) {
        stats.captured = Number(stateProbe.assessment.questionCount || 0);
        stats.assessment = stateProbe.assessment;
      } else if (wideModel) {
        stats.captured = Number(wideModel.questionCount || 0);
        stats.assessment = wideModel;
      }
      return stats;
    }

    stats.attempted = true;
    const maxClicks = navs.length; // Traversal is bounded by time, not a 40-question ceiling.
    for (let i = 0; i < Math.min(navs.length, maxClicks); i++) {
      if (Date.now()>=cycleDeadline) break;
  // CTI_PROGRESS_BEGIN
      if (typeof ctiProgressUpdateV1 === "function") ctiProgressUpdateV1({detail:String(fp.name || fp.id) + " · Reading question " + (i + 1) + "/" + navs.length});
  // CTI_PROGRESS_END
      const liveNavs = assessmentQuestionNavCandidatesV662(envelope, fp, declared);
      const nav = liveNavs.find(x => Number(x.ordinal) === Number(navs[i].ordinal)) || navs[i];
      if (!nav || !safeClickAssessmentQuestionV662(nav.element)) continue;
      stats.clicks++;
      await sleepMs(520);
      await sleepMs(260);

      let currentSurface = null;
      try { currentSurface = findOpenedEditorSurface(fp, [], nav.element, [], true); } catch (e) {}
      const currentRoot = currentSurface && currentSurface.root ? currentSurface.root : surfaceRoot;
      envelope = assessmentEnvelopeRootV662(currentRoot, fp) || currentRoot;

      const currentWide = collectCourseraStructuredAssessment(envelope, fp);
      mergeAssessmentModelIntoCycleV662(questionMap, currentWide);
      const selected = parseSelectedAssessmentQuestionV662(currentRoot, fp, nav.ordinal, nav.label);
      if (selected && nav.ordinal) selected.questionOrdinalObserved=true;
      mergeQuestionIntoCycleV662(questionMap, selected, nav.ordinal);
      if (declared > 1 && assessmentIsFullyAnswerHydratedV667(assessmentFromCycleMapV667(questionMap,declared,{}),declared)) break;
    }

    const mergedFinal = assessmentFromCycleMapV667(questionMap, declared, {
        contentPartCoverage:stats.captureCompleteness,
      navigationCandidates:navs.length, clicks:stats.clicks, expandedContent:Boolean(stats.expandedContent),
      candidatePreview:stats.candidatePreview,
      reactStateAttempted:stats.reactStateAttempted, reactStateQuestions:stats.reactStateQuestions,
      reactStateArraysScanned:stats.reactStateArraysScanned, reactStateCandidates:stats.reactStateCandidates,
      outlineDomAttempted:stats.outlineDomAttempted, outlineDomAnchors:stats.outlineDomAnchors,
      outlineDomResolvedTargets:stats.outlineDomResolvedTargets, outlineDomQuestions:stats.outlineDomQuestions,
      outlineDomPreview:stats.outlineDomPreview, controlDiagnostics:stats.controlDiagnostics
    });
    if (!mergedFinal) return stats;
    stats.captured = Number(mergedFinal.questionCount || 0);
    stats.assessment = mergedFinal;
    return stats;
  }

  // Passive, item-scoped evidence only: no configuration clicks, requests,
  // postMessage injection, playback controls, form submission or permission bypass.

  async function recoverTypedEditorV61317(fp, courseId, template, options) {
    options=options || {};
    const started=Date.now(),route=typedEditorRouteV61316(fp,courseId,template);
    const plugin=typedEditorRouteTypeV61316(fp)==='plugin',retryMode=Boolean(options.retryMode);
    const baseMs=plugin?(retryMode?CTI_PLUGIN_RETRY_MAX_MS:CTI_PLUGIN_PRIMARY_MAX_MS):(retryMode?35000:25000);
    const waitBudget=scopedWaitBudgetV61321(baseMs,plugin?0:16000,options.deadline);
    let deadline=Math.min(started+baseMs,options.deadline==null?Infinity:Number(options.deadline));
    waitBudget.observe([0]);
    const out={id:String(fp.id),route,attempted:false,captured:false,reason:'NO_TYPED_ROUTE',samples:0,dwellMs:0};
    if(!route)return out;
    if(Date.now()>=deadline){out.reason='TIME_BUDGET_EXHAUSTED';return out;}
    const previousNameFields=options.previousNameFields || new Set(typedEditorNameFieldsV61317());
    out.attempted=true;
    if(!safelyRestoreRoute(route)){out.reason='ROUTE_DISPATCH_FAILED';return out;}
    let previous='',stable=0,seenRoot=null,seenAt=0,lastSurface=null,lastPlugin=null;
    const capture=(surface,reason)=>{
      const contentRoot=fp.typeName==='discussionPrompt'?surface.fields[0]:surface.root;
      const evidence=collectDomEvidenceFromRoot(contentRoot,'active-typed-editor',fp);
      if(typedEditorProductionSurfaceV61317(fp,courseId,previousNameFields)?.root!==surface.root){out.reason='EDITOR_CHANGED_DURING_CAPTURE';return false;}
      if(plugin){
        clearTypedPluginChromeV61317(evidence);
        const readiness=pluginReadinessV6147(evidence.pluginEvidence);
        out.pluginWait={...readiness,stopReason:reason,elapsedMs:Date.now()-started,minimumSurfaceWaitMs:10000};
        if(evidence.pluginEvidence)evidence.pluginEvidence.readiness=out.pluginWait;
      }
      evidence.typedEditorEvidence={observedAt:new Date().toISOString(),courseId:String(courseId),itemId:String(fp.id),route,
        editorType:fp.typeName,observedTitle:surface.heading,titleTag:surface.titleTag,identity:surface.identity,itemIdObserved:surface.itemIdObserved,
        freshEditor:surface.freshEditor,screenshotAnchoredTrial:false,wholeCourseVerified:false,externalInteractionVerified:false};
      out.captured=true;out.reason=reason;out.evidence=evidence;return true;
    };
    while(Date.now()<deadline){
      if(options.shouldStop && options.shouldStop()){out.reason='STOP_REQUESTED';break;}
      out.samples++;
      const actual=authoringItemRouteV61311(location.href);
      if(!actual || actual.courseId!==String(courseId) || actual.itemId!==String(fp.id) || actual.typeName!==typedEditorRouteTypeV61316(fp)){out.reason='ROUTE_CHANGED';break;}
      const surface=typedEditorProductionSurfaceV61317(fp,courseId,previousNameFields);
      if(!surface){previous='';stable=0;seenRoot=null;}
      else {
        lastSurface=surface;
        if(seenRoot!==surface.root){seenRoot=surface.root;seenAt=Date.now();previous='';stable=0;}
        const text=String(surface.root.innerText || surface.root.textContent || '');
        const urls=[...surface.root.querySelectorAll('a[href],iframe[src],img[src],object[data]')].map(el=>el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data') || '');
        lastPlugin=plugin?collectPluginEvidenceV6139(surface.root,fp):null;
        const readiness=pluginReadinessV6147(lastPlugin);
        // A frame URL may settle while its document is still loading. Include
        // accessible frame state/content in the stability signal.
        const frameSignature=lastPlugin?JSON.stringify(lastPlugin):'';
        const signature=surface.heading+'|'+text+'|'+JSON.stringify(urls)+'|'+frameSignature+'|'+surface.fields.map(f=>String(f.value || f.innerText || f.textContent || '')).join('|');
        waitBudget.observe([urls.length,surface.fields.reduce((n,f)=>n+String(f.value || f.innerText || f.textContent || '').length,0),visiblePluginConfigurationV61316(surface.root).values.length,
          ...(plugin?[(lastPlugin?.targets || []).length,readiness.readableFrames,(lastPlugin?.frames || []).reduce((n,f)=>n+Number(f.textLength || 0),0)]:[])]);
        if(plugin && typeof ctiProgressUpdateV1==='function')ctiProgressUpdateV1({detail:surface.heading+' · Checking plugin readiness · '+Math.round((Date.now()-started)/1000)+'s elapsed · '+readiness.status.toLowerCase().replace(/_/g,' ')});
        const loading=hasVisibleLoadingIndicator(surface.root);
        stable=previous && signature===previous && !loading?stable+1:0;previous=signature;
        const meaningful=fp.typeName==='discussionPrompt'?surface.fields.some(f=>String(f.value || f.innerText || f.textContent || '').trim()):urls.length>0 || visiblePluginConfigurationV61316(surface.root).values.length>0;
        if(stable>=3 && Date.now()-seenAt>=(plugin?10000:meaningful?2000:5000) && !loading && (!plugin || !readiness.pending)){
          capture(surface,plugin?'PLUGIN_READINESS_OBSERVED':'SCOPED_TYPED_EDITOR_CAPTURED');
          break;
        }
      }
      deadline=waitBudget.extend(400);
      await sleepMs(Math.min(400,Math.max(0,deadline-Date.now())));
    }
    // Preserve partial evidence at a bounded deadline. Never call a loading
    // frame empty, complete, launched, or playable. Identity is rechecked here.
    if(plugin && !out.captured && lastSurface && Date.now()>=deadline &&
      typedEditorProductionSurfaceV61317(fp,courseId,previousNameFields)?.root===lastSurface.root)
      capture(lastSurface,Date.now()>=Number(options.deadline)?'COURSE_TIME_BUDGET_REACHED':'PLUGIN_WAIT_LIMIT_REACHED');
    out.dwellMs=Date.now()-started;
    out.waitBudget=waitBudget.snapshot();
    if(!out.captured){
      if(out.reason==='NO_TYPED_ROUTE')out.reason=lastSurface?'EDITOR_NOT_STABLE':'MATCHING_EDITOR_NOT_FOUND';
      out.diagnostics=typedEditorDiagnosticsV61316(lastSurface && lastSurface.root,fp,courseId,lastSurface && lastSurface.heading);
    }
    return out;
  }

  async function activeSpaCrawl(fingerprints, courseOrBranchId, options) {
    options = options || {};
    const retryPass = Boolean(options.retryPass);
    const onlyIds = Array.isArray(options.onlyIds) ? new Set(options.onlyIds.map(x => String(x))) : null;
    const recorder = installReadOnlyNetworkRecorder();
    const originalUrl = location.href;
    let startingItemId = "";
    try { const itemRoute=authoringItemRouteV61311(originalUrl); startingItemId = itemRoute ? itemRoute.itemId : String(new URL(originalUrl).searchParams.get("itemId") || ""); } catch (e) {}
    const readingRouteTemplate=options.readingRouteTemplate || readingRouteTemplateV61312(courseOrBranchId);
    const startUrl = canonicalOutlineUrl(originalUrl);
    const canonicalizedStart = startUrl !== originalUrl;
    if (canonicalizedStart) {
      await returnToOutlineV6142(startUrl);
      await sleepMs(500);
    }
    let eligibleTargets = (fingerprints || []).filter(fp => {
      const p = fp.payload || {};
      const name = normalizeName(fp.name);
      if (fp.type === "Unknown" && /^(overview content|archive content|overview|archive|content)$/.test(name)) return false;
      if (!fp.id) return false;
      if (onlyIds) return onlyIds.has(String(fp.id));
      return !(p.assetDetails || []).length || !p.textSample || p.published == null || Number(p.assetEvidenceConfidence || 0) < 0.90 || Number(p.textEvidenceCompleteness || 0) < 0.75;
    }).sort((a,b) => onlyIds ? options.onlyIds.indexOf(String(a.id)) - options.onlyIds.indexOf(String(b.id)) : crawlTargetPriority(b,startingItemId) - crawlTargetPriority(a,startingItemId));
    if (!onlyIds) eligibleTargets=interleaveCrawlTargetsV61313(eligibleTargets);
    const explicitMaxItems = Number(options.maxItems || 0);
    const targetCap = explicitMaxItems > 0 ? explicitMaxItems : eligibleTargets.length;
    const targets = eligibleTargets.slice(0, targetCap);
    const crawlBudgetMs = Math.min(retryPass?recoveryCrawlBudgetV61326(targets):activeCrawlBudgetMs(targets.length, false),Number(options.budgetMs || Infinity));
    const crawlStartedAt = Date.now();

    const meta = {
      version: "v6.14.7",
      buildId: "v6.14.7-plugin-readiness-20260929",
      pass: retryPass ? "retry" : "primary",
      originalUrl: originalUrl,
      startingItemId: startingItemId,
      crawlStartUrl: startUrl,
      canonicalizedStart: canonicalizedStart,
      targets: targets.length,
      targetIds: targets.map(fp => String(fp.id)),
      eligibleTargets: eligibleTargets.length,
      targetCap: targetCap,
      coverageLimitedByCap: eligibleTargets.length > targets.length,
      budgetStrategy: retryPass ? "ADAPTIVE_RETRY" : "INTERLEAVED_TYPES_WITH_RESERVED_VISITS",
      timeBudgetMs: crawlBudgetMs,
      baseBudgetMs: ACTIVE_CRAWL_BASE_BUDGET_MS,
      perTargetBudgetMs: retryPass ? 16000 : ACTIVE_CRAWL_PER_TARGET_BUDGET_MS,
      maxBudgetMs: retryPass ? 20 * 60 * 1000 : ACTIVE_CRAWL_MAX_TOTAL_MS,
      timeBudgetExhausted: false,
      unvisitedDueToBudget: 0,
      discoveredTargets: 0,
      routeAttempts: 0,
      navigated: 0,
      returned: 0,
      networkResponses: 0,
      graphqlResponses: 0,
      associatedNetworkResponses: 0,
      domCaptures: 0,
      evidenceUpgrades: 0,
      skippedNoTarget: 0,
      historyRoutes: 0,
      buttonRoutes: 0,
      secondaryControlAttempts: 0,
      menuEditorAttempts: 0,
      directReactAttempts: 0,
      directReactSuccessSignals: 0,
      routeFailures: 0,
      ignoredNoiseResponses: 0,
      ignoredCourseWideResponses: 0,
      viewportScanSteps: 0,
      outlineDisclosureExpansions: 0,
      routeDomScans: 0,
      routeScopedSurfaceCaptures: 0,
      filteredUiAssets: 0,
      filteredChromeLinks: 0,
      configuredUrlsFound: 0,
      launchUrlsFound: 0,
      weakIdentityMatchesIgnored: 0,
      scopedBodyCaptures: 0,
      incompleteTextCaptures: 0,
      stabilityWaits: 0,
      stabilityTimeouts: 0,
      stabilityTotalMs: 0,
      stabilityEvidenceChanges: 0,
      sessionAssociatedResponses: 0,
      sessionPayloadFiles: 0,
      sessionPayloadLinks: 0,
      assessmentQuestionCycleTargets: 0,
      assessmentQuestionCycleClicks: 0,
      assessmentQuestionCycleQuestions: 0,
      assessmentReactStateTargets: 0,
      assessmentReactStateQuestions: 0,
      assessmentOutlineDomTargets: 0,
      assessmentOutlineDomQuestions: 0,
      targetDiagnostics: []
    };

    try {
      for (let index = 0; index < targets.length; index++) {
        if (Date.now() - crawlStartedAt > crawlBudgetMs) {
          meta.timeBudgetExhausted = true;
          meta.unvisitedDueToBudget = targets.length - index;
          break;
        }
        const itemStartedAt=Date.now();
        const fp = targets[index];  // CTI_PROGRESS_BEGIN
        if (typeof ctiProgressUpdateV1 === "function") ctiProgressUpdateV1({phase:retryPass ? "Recovery editors" : "Primary editors",
          detail:String(fp.name || fp.id) + " · Opening editor", completed:index, total:targets.length,
          count:index + "/" + targets.length + " visits processed · " + meta.targetDiagnostics.filter(d => d.domCaptured || d.editorSurfaceCaptured).length + " editors observed"});
  // CTI_PROGRESS_END

        console.log('CTI '+(retryPass?'recovery':'primary')+': item '+(index+1)+'/'+targets.length+'; '+Math.round((Date.now()-crawlStartedAt)/1000)+' seconds elapsed');
        const typedPreviousNameFields=new Set(typedEditorNameFieldsV61317());
        await returnToOutlineV6142(startUrl);
        await sleepMs(220);

        const scanTrace = {deadline:Math.min(crawlStartedAt+crawlBudgetMs,Date.now()+20000)};
        const readingInitialRecords=recorder.takeFor(fp).length;
        recorder.setActive(fp);
        const readingRecovery = fp.typeName === 'supplement' && readingRouteTemplate ?
          await recoverReadingRouteV61311(fp,courseOrBranchId,readingRouteTemplate,{deadline:crawlStartedAt+crawlBudgetMs,recorder,initialCount:readingInitialRecords}) : null;
        const typedRecovery=typedEditorRouteTypeV61316(fp) && readingRouteTemplate ?
          await recoverTypedEditorV61317(fp,courseOrBranchId,readingRouteTemplate,{deadline:crawlStartedAt+crawlBudgetMs,previousNameFields:typedPreviousNameFields}) : null;
        recorder.setActive(null);
        if (typedRecovery && !typedRecovery.captured) {await returnToOutlineV6142(startUrl);await sleepMs(600);}
        if (readingRecovery && !readingRecovery.captured) {await returnToOutlineV6142(startUrl);await sleepMs(600);}
        scanTrace.deadline=Math.min(crawlStartedAt+crawlBudgetMs,Date.now()+20000);
        const found = (readingRecovery && readingRecovery.captured) || (typedRecovery && typedRecovery.captured) ? null : await findNavigationTargetForFingerprint(fp, courseOrBranchId, scanTrace);
        const diag = {
          id: String(fp.id || ""),
          name: String(fp.name || ""),
          attempt: retryPass ? 2 : 1,
          startedAt:new Date(itemStartedAt).toISOString(),
          documentVisibility:String(document.visibilityState || "unknown"),
          navigationMs:0,stabilityPhaseMs:0,assessmentMs:0,harvestMs:0,elapsedMs:0,
          found: Boolean(found),
          score: found ? Number(found.score || 0) : 0,
          reason: found ? found.reason : "no-target",
          tag: found ? found.tag : "",
          route: found ? String(found.route || "") : "",
          foundText: found ? String(found.text || "").slice(0,180) : "",
          foundReason: found ? String(found.reason || "") : "",
          hiddenIdMatches: found ? Number(found.hiddenIdMatches || 0) : 0,
          visibleSeed: found ? isVisibleElement(found.element) : false,
          viewportScanSteps: found ? Number(found.viewportScanSteps || 0) : Number(scanTrace.viewportScanSteps || 0),
          outlineExpanded: found ? Number(found.outlineExpanded || 0) : Number(scanTrace.outlineExpanded || 0),
          foundScrollY: found ? Number(found.foundScrollY || 0) : Number(scanTrace.foundScrollY || 0),
          scrollRootsTried: found ? Number(found.scrollRootsTried || 0) : Number(scanTrace.scrollRootsTried || 0),
          scanRootTag: found ? String(found.scanRootTag || "") : String(scanTrace.scanRootTag || ""),
          rowFound: false,
          rowTag: "",
          rowAttrs: "",
          candidateCount: 0,
          reactClickCandidates: 0,
          nativeInteractiveCandidates: 0,
          rowSubtreeSize: 0,
          directReactAttempts: 0,
          candidatePreview: [],
          navigation: "",
          routeChanged: false,
          networkResponses: 0,
          associatedResponses: 0,
          domCaptured: false,
          editorSurfaceCaptured: false,
          editorSurfaceScore: 0,
          routeScopedSurfaceCaptured: false,
          strongIdentitySeed: false,
          genericBaseName: isGenericSmartIngestionName(fp),
          controlAttempts: [],
          responseSummaries: [],
          ignoredNoise: 0,
          ignoredCourseWide: 0,
          routeDomObserved: false,
          filteredUiAssets: 0,
          filteredChromeLinks: 0,
          configuredUrlsFound: 0,
          launchUrlsFound: 0,
          weakIdentityMatchesIgnored: 0,
          bodyScoped: false,
          textCompleteness: 0,
          textScopeKind: "",
          stabilityMs: 0,
          stabilitySamples: 0,
          stabilityChanges: 0,
          stabilityTimedOut: false,
          sessionAssociatedResponses: 0,
          sessionPayloadFiles: 0,
          sessionPayloadLinks: 0,
          questionCycleAttempted: false,
          questionCycleDeclared: 0,
          questionCycleNavCount: 0,
          questionCycleClicks: 0,
          questionCycleQuestions: 0,
          questionCycleReactStateAttempted: false,
          questionCycleReactStateQuestions: 0,
          questionCycleReactStateArraysScanned: 0,
          questionCycleReactStateCandidates: [],
          questionCycleControlDiagnostics: [],
          questionCycleOutlineDomAttempted: false,
          questionCycleOutlineDomAnchors: 0,
          questionCycleOutlineDomResolvedTargets: 0,
          questionCycleOutlineDomQuestions: 0,
          questionCycleOutlineDomPreview: [],
          upgraded: false
        };
        if(typedRecovery)diag.typedEditorRecovery={attempted:typedRecovery.attempted,captured:typedRecovery.captured,reason:typedRecovery.reason,route:typedRecovery.route,dwellMs:typedRecovery.dwellMs,pluginWait:typedRecovery.pluginWait,waitBudget:typedRecovery.waitBudget};
        meta.targetDiagnostics.push(diag);
        diag.weakIdentityMatchesIgnored = found ? Number(found.weakMatchesIgnored || 0) : Number(scanTrace.weakMatchesIgnored || 0);
        meta.weakIdentityMatchesIgnored += Number(diag.weakIdentityMatchesIgnored || 0);
        meta.viewportScanSteps += Number(diag.viewportScanSteps || 0);
        meta.outlineDisclosureExpansions += Number(diag.outlineExpanded || 0);

        if (!found) {
          const recovery=typedRecovery || readingRecovery || await recoverReadingRouteV61311(fp,courseOrBranchId,readingRouteTemplate,{deadline:crawlStartedAt+crawlBudgetMs,recorder,initialCount:readingInitialRecords});
          const recoverySummary={attempted:recovery.attempted,captured:recovery.captured,reason:recovery.reason,route:recovery.route,dwellMs:recovery.dwellMs,pluginWait:recovery.pluginWait,waitBudget:recovery.waitBudget};
          if(typedRecovery){diag.typedEditorRecovery=recoverySummary;if(recovery.diagnostics)diag.typedEditorDiagnostics=recovery.diagnostics;}
          else diag.readingRouteRecovery=recoverySummary;
          if (recovery.attempted) {
            meta.routeAttempts++;meta.historyRoutes++;
            diag.route=recovery.route;diag.navigation=typedRecovery?'typed-editor-route':'certified-reading-route';
            diag.stabilityMs=recovery.dwellMs;diag.stabilitySamples=recovery.samples;
            meta.stabilityWaits++;meta.stabilityTotalMs+=recovery.dwellMs;
          }
          if (typedRecovery ? mergeTypedEditorRecoveryV61317(fp,recovery) : mergeReadingRecoveryV61311(fp,recovery)) {
            const network=mergeReadingNetworkV61312(fp,recorder,readingInitialRecords,recovery);
            diag.networkResponses=network.responses;diag.associatedResponses=network.associated;diag.readingNetworkCapture=network.networkCapture;
            diag.sessionPayloadFiles=network.files;diag.sessionPayloadLinks=network.links;
            meta.networkResponses+=network.responses;meta.associatedNetworkResponses+=network.associated;
            diag.sessionAssociatedResponses=network.associated;meta.sessionAssociatedResponses+=network.associated;
            meta.sessionPayloadFiles+=network.files;meta.sessionPayloadLinks+=network.links;
            const sd=recovery.evidence._diagnostics || {};
            diag.found=true;diag.reason=typedRecovery?'fresh-typed-editor-after-route':'exact-reading-field-after-route';
            diag.strongIdentitySeed=typedRecovery?Boolean(recovery.evidence.typedEditorEvidence.itemIdObserved):true;
            diag.routeChanged=true;diag.editorSurfaceCaptured=true;diag.editorSurfaceScore=1;
            diag.routeScopedSurfaceCaptured=true;diag.upgraded=true;diag.completed=true;
            diag.bodyScoped=Boolean(sd.bodyScoped);diag.textCompleteness=Number(sd.textCompleteness || 0);
            diag.textScopeKind=String(sd.textScopeKind || '');diag.launchUrlsFound=Number(sd.launchUrls || 0);
            meta.discoveredTargets++;meta.navigated++;meta.domCaptures++;meta.evidenceUpgrades++;
            meta.routeScopedSurfaceCaptures++;meta.launchUrlsFound+=diag.launchUrlsFound;
            if (diag.bodyScoped) meta.scopedBodyCaptures++;
            await returnToOutlineV6142(startUrl);meta.returned++;
          } else {
            meta.skippedNoTarget++;
            if (recovery.attempted) {meta.routeFailures++;await returnToOutlineV6142(startUrl);}
          }
          diag.networkRecorderRelease=recorder.releaseFor(fp);
          diag.elapsedMs=Date.now()-itemStartedAt;diag.navigationMs=diag.elapsedMs;
          continue;
        }
        try {
          const tm = String(found.text || "").match(/\b(\d+(?:\.\d+)?)\s*min(?:ute)?s?\b/i);
          if (tm && Number.isFinite(Number(tm[1]))) {
            fp.payload.timeEstimateMinutes = Number(tm[1]);
            fp.payload.timeEstimateEvidence = "outline-row";
          }
        } catch (e) {}
        meta.discoveredTargets++;
        meta.routeAttempts++;
        const genericBaseName = isGenericSmartIngestionName(fp);
        const identityReason = String(found.reason || found.foundReason || "");
        const strongIdentitySeed = Boolean(
          Number(found.score || 0) >= 0.995 &&
          (genericBaseName
            ? /visible-attribute-id|visible-route-id|stable-id/i.test(identityReason)
            : /visible-attribute-id|visible-route-id|visible-direct-title|visible-exact-title|stable-id/i.test(identityReason))
        );
        diag.strongIdentitySeed = strongIdentitySeed;

        const beforeState = JSON.stringify({
          a:(fp.payload.assetDetails||[]).length,
          l:(fp.payload.links||[]).length,
          t:String(fp.payload.textSample||"").length,
          q:Number(fp.payload.structuredAssessment && (fp.payload.structuredAssessment.questionCount || (fp.payload.structuredAssessment.questions || []).length) || 0),
          p:fp.payload.published
        });

        recorder.setActive(fp);
        const initialRecords = recorder.takeFor(fp).length;
        // Baseline surfaces before this exact item's activation. Any editor surface
        // discovered later must be new relative to this baseline.
        const itemSessionBaseline = snapshotOpenSurfaceRoots();
        const probeRow = itemRowRootForFingerprint(fp, found && found.element);
        if (probeRow) {
          diag.rowFound = true;
          diag.rowTag = String(probeRow.tagName || "").toLowerCase();
          diag.rowAttrs = elementAttributeBlob(probeRow).slice(0, 260);
        }
        const controls = editorControlCandidates(fp, found, courseOrBranchId);
        diag.candidateCount = controls.length;
        diag.reactClickCandidates = controls.filter(c => c.reactClick).length;
        diag.rowSubtreeSize = controls.length ? Number(controls[0].subtreeSize || 0) : 0;
        diag.nativeInteractiveCandidates = controls.length ? Number(controls[0].nativeInteractiveCount || 0) : 0;
        diag.candidatePreview = controls.slice(0, 8).map(c => ({
          tag:c.tag, scope:c.scope, label:String(c.label||"").slice(0,120), score:Number(c.score||0),
          reactClick:Boolean(c.reactClick), reactKeyPress:Boolean(c.reactKeyPress),
          directAllowed:Boolean(c.directAllowed),
          trackComponent:String(c.trackComponent||""), trackAction:String(c.trackAction||""),
          reactProps:(c.reactPropKeys||[]).slice(0,8),
          handler:String(c.onClickPreview||"").slice(0,180)
        }));
        let openedSurface = null;
        let routeIdHit = false;
        let anyAttempted = false;

        for (let ci = 0; ci < controls.length && ci < 5 && Date.now()<scanTrace.deadline && (!openedSurface || genericSurfaceNeedsPayloadUpgrade(fp, openedSurface)); ci++) {
          const control = controls[ci];
          const oldHref = location.href;
          const baselineOpenSurfaces = snapshotOpenSurfaceRoots();
          const baselineMenus = snapshotVisibleMenuRoots();
          const mutationCapture = startDomMutationCapture();
          const dispatched = dispatchReadOnlyEditorControl(control, courseOrBranchId);
          if (!dispatched.attempted) {
            mutationCapture.stop();
            diag.controlAttempts.push({ label:control.label, tag:control.tag, scope:control.scope || "", mode:dispatched.mode, reactClick:Boolean(control.reactClick), surface:false });
            continue;
          }
          anyAttempted = true;
          if (ci > 0) meta.secondaryControlAttempts++;
          if (dispatched.mode === "history-popstate") meta.historyRoutes++; else meta.buttonRoutes++;
          if (!diag.navigation) diag.navigation = dispatched.mode;

          await sleepMs(350);

          // Some rows expose only a More/Actions button. Opening that menu is safe;
          // if a visible Edit/Open command appears, invoke that command next.
          if (/\b(more|options|actions)\b/.test(control.label)) {
            const menuAction = visibleMenuEditorAction(fp, courseOrBranchId, control.element, baselineMenus);
            if (menuAction) {
              const menuDispatch = dispatchReadOnlyEditorControl(menuAction, courseOrBranchId);
              if (menuDispatch.attempted) {
                meta.menuEditorAttempts++;
                diag.controlAttempts.push({ label:control.label + " -> " + menuAction.label, tag:menuAction.tag, scope:menuAction.scope || "new-menu", mode:menuDispatch.mode, surface:false });
                await sleepMs(450);
              }
            }
          }

          const trackedEditItem = /(?:^|\b)edititem(?:\b|$)/.test(String(control.trackComponent || ""));
          await waitForNetworkQuiet(
            recorder, fp, initialRecords,
            trackedEditItem ? ACTIVE_CRAWL_EDITITEM_QUIET_MS : ACTIVE_CRAWL_GENERIC_QUIET_MS
          );
          await sleepMs(160);
          const changedNodes = mutationCapture.stop();
          routeIdHit = String(location.href).toLowerCase().includes(String(fp.id || "").toLowerCase());
          openedSurface = findOpenedEditorSurface(fp, changedNodes, control.element, baselineOpenSurfaces, strongIdentitySeed);
          diag.controlAttempts.push({
            label:control.label, tag:control.tag, scope:control.scope || "", mode:dispatched.mode,
            reactClick:Boolean(control.reactClick), directAllowed:Boolean(canDirectInvokeReactControl(control)),
            trackComponent:String(control.trackComponent||""),
            surface:Boolean(openedSurface), surfaceScore:openedSurface ? Number(openedSurface.score.toFixed(3)) : 0
          });

          const needsGenericPayloadUpgrade = genericBaseName && genericSurfaceNeedsPayloadUpgrade(fp, openedSurface);
          if (((!openedSurface && !routeIdHit) || needsGenericPayloadUpgrade) && canDirectInvokeReactControl(control)) {
            for (const directKind of ["click", "keypress", "keydown"]) {
              if (Date.now()>=scanTrace.deadline) break;
              if ((openedSurface && !genericSurfaceNeedsPayloadUpgrade(fp, openedSurface)) || (routeIdHit && !genericBaseName)) break;
              const directBaseline = snapshotOpenSurfaceRoots();
              const directMutation = startDomMutationCapture();
              const directBeforeRecords = recorder.takeFor(fp).length;
              const directResult = invokeDirectReactControl(control, directKind);
              if (!directResult.attempted) { directMutation.stop(); continue; }
              meta.directReactAttempts++;
              diag.directReactAttempts++;
              await sleepMs(350);
              await waitForNetworkQuiet(recorder, fp, directBeforeRecords, ACTIVE_CRAWL_DIRECT_QUIET_MS);
              await sleepMs(120);
              const directChanged = directMutation.stop();
              const directRoute = isItemSpecificCourseRoute(location.href, fp, courseOrBranchId);
              routeIdHit = routeIdHit || directRoute || String(location.href).toLowerCase().includes(String(fp.id || "").toLowerCase());
              const directSurface = findOpenedEditorSurface(fp, directChanged, control.element, directBaseline, strongIdentitySeed);
              if (directSurface && (!openedSurface || Number(directSurface.score || 0) > Number(openedSurface.score || 0))) openedSurface = directSurface;
              const signal = Boolean(directSurface || directRoute || recorder.takeFor(fp).length > directBeforeRecords);
              if (signal) meta.directReactSuccessSignals++;
              diag.controlAttempts.push({
                label:control.label, tag:control.tag, scope:control.scope || "", mode:directResult.mode,
                reactClick:Boolean(control.reactClick), directAllowed:Boolean(canDirectInvokeReactControl(control)),
                trackComponent:String(control.trackComponent||""),
                surface:Boolean(directSurface), surfaceScore:directSurface ? Number(directSurface.score.toFixed(3)) : 0,
                error:String(directResult.error||"").slice(0,160)
              });
            }
          }

          if (!openedSurface && location.href !== oldHref && !routeIdHit) {
            safelyRestoreRoute(startUrl);
            await sleepMs(250);
          }
        }

        if (!anyAttempted) {
          recorder.setActive(null);
          meta.routeFailures++;
          diag.navigation = "no-safe-navigation";
          diag.networkRecorderRelease=recorder.releaseFor(fp);
          diag.elapsedMs=Date.now()-itemStartedAt;
          continue;
        }

        if (!openedSurface && strongIdentitySeed) {
          const routeFallback = findRouteScopedItemEditorSurface(fp, courseOrBranchId, strongIdentitySeed, location.href !== startUrl);
          if (routeFallback) {
            openedSurface = routeFallback;
            diag.routeScopedSurfaceCaptured = true;
            meta.routeScopedSurfaceCaptures++;
          }
        }

        // v6.2: shell-open is not payload-ready. Keep the item open until scoped DOM
        // and item-session network evidence stop changing, or a bounded timeout fires.
        diag.navigationMs=Date.now()-itemStartedAt;
        const stabilityPhaseStart=Date.now();  // CTI_PROGRESS_BEGIN
        if (typeof ctiProgressUpdateV1 === "function") ctiProgressUpdateV1({detail:String(fp.name || fp.id) + " · Waiting for content to settle"});
  // CTI_PROGRESS_END

        const stability = await waitForItemEvidenceStability(
          fp, recorder, initialRecords, openedSurface, itemSessionBaseline,
          { retryMode: retryPass, strongSessionIdentity: strongIdentitySeed,deadline:crawlStartedAt+crawlBudgetMs }
        );
        diag.stabilityPhaseMs=Date.now()-stabilityPhaseStart;
        meta.stabilityWaits++;
        meta.stabilityTotalMs += Number(stability.dwellMs || 0);
        meta.stabilityEvidenceChanges += Number(stability.evidenceChanges || 0);
        if (stability.timedOut) meta.stabilityTimeouts++;
        diag.stabilityMs = Number(stability.dwellMs || 0);
        diag.stabilitySamples = Number(stability.samples || 0);
        diag.stabilityChanges = Number(stability.evidenceChanges || 0);
        diag.stabilityTimedOut = Boolean(stability.timedOut);
        diag.stabilityStopReason=String(stability.stopReason || '');
        diag.stabilityBudget={baseMs:stability.baseBudgetMs,hardMs:stability.hardBudgetMs,grantedMs:stability.grantedBudgetMs};
        diag.stabilityProgressExtensions=stability.progressExtensions || [];
        if (stability.surface && stability.surface.root &&
            (!openedSurface || Number(stability.surface.score || 0) >= Number(openedSurface.score || 0))) {
          openedSurface = stability.surface;
        }

        // v6.6.5: if this is a multi-question assessment whose editor exposes only
        // one selected question at a time, cycle the read-only question rail and
        // merge all observed question structures before the normal surface harvest.
        if (openedSurface && openedSurface.root && isAssessmentLikeFingerprintV662(fp)) {
          const assessmentStartedAt=Date.now();  // CTI_PROGRESS_BEGIN
          if (typeof ctiProgressUpdateV1 === "function") ctiProgressUpdateV1({detail:String(fp.name || fp.id) + " · Reading questions and answer evidence"});
  // CTI_PROGRESS_END

          diag.assessmentSurface=assessmentSurfaceDiagnosticsV61313(openedSurface.root,fp);
          const partRoot=assessmentEnvelopeRootV662(openedSurface.root,fp) || openedSurface.root;
          diag.unmarkedChoiceProbes=[...partRoot.querySelectorAll('[data-testid^="assignment-part-"]')].slice(0,12).map((part,i)=>{
            const probe=unmarkedChoiceProbeV61320(part,fp,i+1);
            return {partId:part.id,status:probe.status,reason:probe.reason,controls:probe.controls,
              parsedType:probe.question?.type || '',parsedChoices:probe.question?.options.length || 0};
          });
          retainAssessmentSurfaceEvidenceV6138(openedSurface.root,fp);
          const cycle = await collectCourseraAssessmentByQuestionCycleV662(openedSurface.root, fp, {seedAssessment:retryPass?fp.payload.structuredAssessment:null,deadline:assessmentDeadlineV61313(crawlStartedAt+crawlBudgetMs,targets.length-index-1),
            certifiedItem:strongIdentitySeed && isItemSpecificCourseRoute(location.href,fp,courseOrBranchId)});
          diag.assessmentMs=Date.now()-assessmentStartedAt;
          diag.questionCycleReactStateMs=Number(cycle.reactStateElapsedMs || 0);
          diag.questionCycleReactStateStopReason=String(cycle.reactStateStopReason || '');
          diag.questionCycleReactStateTruncated=Boolean(cycle.reactStateTruncated);
          diag.emptyEditorEvidence=cycle.emptyEditorEvidence || null;
          diag.assignmentContentBlocks=cycle.contentBlockEvidence?{declaredContentParts:cycle.declaredContentParts,capturedTextBlocks:cycle.contentBlockEvidence.blocks.length,status:cycle.stopReason}:null;
          diag.questionCycleStopReason=String(cycle.stopReason || '');
          if (cycle.emptyEditorEvidence) fp.payload.emptyEditorEvidence=cycle.emptyEditorEvidence;
          const refreshed=findCurrentEditorSurface(fp,itemSessionBaseline,strongIdentitySeed);
          if(refreshed && refreshed.root && refreshed.root.isConnected)openedSurface=refreshed;
          diag.questionCycleAttempted = Boolean(cycle && cycle.attempted);
          diag.questionCycleTraversal = cycle && cycle.outlineDomTraversal || null;
          diag.assessmentTextReceipt=retryPass ? null : assessmentTextReceiptV6146(cycle && cycle.assessment,fp);
          diag.questionCycleCaptureCompleteness = cycle && cycle.assessment && cycle.assessment.captureCompleteness || cycle && cycle.captureCompleteness || null;
          diag.questionCycleDeclared = Number(cycle && cycle.declared || 0);
          diag.questionCycleNavCount = Number(cycle && cycle.navCount || 0);
          diag.questionCycleClicks = Number(cycle && cycle.clicks || 0);
          diag.questionCycleQuestions = Number(cycle && cycle.captured || 0);
          diag.questionCycleExpandedContent = Boolean(cycle && cycle.expandedContent);
          diag.questionCycleCandidatePreview = cycle && Array.isArray(cycle.candidatePreview) ? cycle.candidatePreview : [];
          diag.questionCycleReactStateAttempted = Boolean(cycle && cycle.reactStateAttempted);
          diag.questionCycleReactStateQuestions = Number(cycle && cycle.reactStateQuestions || 0);
          diag.questionCycleReactStateArraysScanned = Number(cycle && cycle.reactStateArraysScanned || 0);
          diag.questionCycleReactStateCandidates = cycle && Array.isArray(cycle.reactStateCandidates) ? cycle.reactStateCandidates : [];
          diag.questionCycleControlDiagnostics = cycle && Array.isArray(cycle.controlDiagnostics) ? cycle.controlDiagnostics : [];
          diag.questionCycleOutlineDomAttempted = Boolean(cycle && cycle.outlineDomAttempted);
          diag.questionCycleOutlineDomAnchors = Number(cycle && cycle.outlineDomAnchors || 0);
          diag.questionCycleOutlineDomResolvedTargets = Number(cycle && cycle.outlineDomResolvedTargets || 0);
          diag.questionCycleOutlineDomQuestions = Number(cycle && cycle.outlineDomQuestions || 0);
          diag.questionCycleOutlineDomPreview = cycle && Array.isArray(cycle.outlineDomPreview) ? cycle.outlineDomPreview : [];
          if (cycle && cycle.attempted) meta.assessmentQuestionCycleTargets++;
          if (cycle && cycle.reactStateAttempted) meta.assessmentReactStateTargets++;
          if (cycle && cycle.outlineDomAttempted) meta.assessmentOutlineDomTargets++;
          meta.assessmentQuestionCycleClicks += Number(cycle && cycle.clicks || 0);
          meta.assessmentQuestionCycleQuestions += Number(cycle && cycle.captured || 0);
          meta.assessmentReactStateQuestions += Number(cycle && cycle.reactStateQuestions || 0);
          meta.assessmentOutlineDomQuestions += Number(cycle && cycle.outlineDomQuestions || 0);
          if (cycle && cycle.assessment) {
            mergeEvidence(fp.payload, {structuredAssessment:cycle.assessment, evidenceSources:["active-editor-question-cycle"]}, "active-editor-question-cycle");
            fp.evidenceSources = unique([...(fp.evidenceSources || []), "active-editor-question-cycle"], 50);
          }
        }

        const harvestStartedAt=Date.now();
        const currentHref = location.href;
        routeIdHit = routeIdHit || String(currentHref).toLowerCase().includes(String(fp.id || "").toLowerCase());
        diag.routeChanged = currentHref !== startUrl;

        const dom = collectCurrentDomEvidence();
        const domMatched = routeIdHit || matchCurrentPageToFingerprint([fp], dom);
        if (domMatched && dom && !/\/content(?:\/edit)?\/?$/i.test(location.pathname)) {
          // v5.9: whole-page DOM is diagnostic/navigation evidence only. It may
          // contain authoring chrome, cookie logos and unrelated navigation links,
          // so it must never raise item payload confidence or overwrite item text.
          meta.routeDomScans++;
          diag.routeDomObserved = true;
          const dd = dom._diagnostics || {};
          meta.filteredUiAssets += Number(dd.filteredUiAssets || 0);
          meta.filteredChromeLinks += Number(dd.filteredChromeLinks || 0);
          diag.filteredUiAssets += Number(dd.filteredUiAssets || 0);
          diag.filteredChromeLinks += Number(dd.filteredChromeLinks || 0);
        }

        if (openedSurface && openedSurface.root) {
          const surfaceEvidence = collectDomEvidenceFromRoot(openedSurface.root, "active-editor-surface", fp);
          if (surfaceEvidence) {
            const sd = surfaceEvidence._diagnostics || {};
            meta.filteredUiAssets += Number(sd.filteredUiAssets || 0);
            meta.filteredChromeLinks += Number(sd.filteredChromeLinks || 0);
            meta.configuredUrlsFound += Number(sd.configuredUrls || 0);
            meta.launchUrlsFound += Number(sd.launchUrls || 0);
            if (sd.bodyScoped) meta.scopedBodyCaptures++;
            if (Number(sd.textCompleteness || 0) > 0 && Number(sd.textCompleteness || 0) < 0.75) meta.incompleteTextCaptures++;
            diag.filteredUiAssets += Number(sd.filteredUiAssets || 0);
            diag.filteredChromeLinks += Number(sd.filteredChromeLinks || 0);
            diag.configuredUrlsFound += Number(sd.configuredUrls || 0);
            diag.launchUrlsFound += Number(sd.launchUrls || 0);
            diag.bodyScoped = Boolean(sd.bodyScoped);
            diag.textCompleteness = Number(sd.textCompleteness || 0);
            diag.textScopeKind = String(sd.textScopeKind || "");
            delete surfaceEvidence._diagnostics;
            mergeEvidence(fp.payload, surfaceEvidence, "active-editor-surface");
            if (fp.typeName === 'supplement') {
              fp.payload.textCaptureTruncated=Boolean(surfaceEvidence.textCaptureTruncated);
              fp.payload.fullObservedTextLength=Number(surfaceEvidence.fullObservedTextLength || 0);
              fp.payload.readingCaptureGap=String(surfaceEvidence.readingCaptureGap || '');
            }
            fp.evidenceSources = unique([...(fp.evidenceSources || []), "active-editor-surface"], 50);
            meta.domCaptures++;
            diag.editorSurfaceCaptured = true;
            diag.editorSurfaceScore = Number(openedSurface.score.toFixed(3));
          }
        }

        if (diag.routeChanged || diag.domCaptured || diag.editorSurfaceCaptured) meta.navigated++;

        // Defense in depth: even if a browser wrapper bypasses the recorder-side
        // filter, telemetry/course-wide responses are removed again here before
        // diagnostics, association, or evidence merging.
        const rawRecs = recorder.takeFor(fp).slice(initialRecords, initialRecords + MAX_ACTIVE_RECORDS_PER_ITEM * 2);
        const recs = [];
        for (const rec of rawRecs) {
          if (isPerItemNetworkNoise(rec.url)) { meta.ignoredNoiseResponses++; diag.ignoredNoise++; continue; }
          if (isCourseWideNetworkResponse(rec.url)) { meta.ignoredCourseWideResponses++; diag.ignoredCourseWide++; continue; }
          recs.push(rec);
          if (recs.length >= MAX_ACTIVE_RECORDS_PER_ITEM) break;
        }
        diag.networkResponses = recs.length;
        meta.networkResponses += recs.length;

        const strongTargetSession = Boolean(
          strongIdentitySeed &&
          anyAttempted &&
          (diag.routeChanged || Boolean(openedSurface) || recorder.takeFor(fp).length > initialRecords)
        );

        for (const rec of recs) {
          if (/graphql/i.test(rec.url || "")) meta.graphqlResponses++;
          let evidence = evidenceFromCapturedRecord(rec);
          if (!evidence) {
            if (diag.responseSummaries.length < 5) {
              let path = String(rec.url || "");
              try { path = new URL(path, location.origin).pathname; } catch (e) {}
              let operation = "";
              try { const body = JSON.parse(rec.requestBody || "{}"); operation = String(body.operationName || ""); } catch (e) {}
              diag.responseSummaries.push({ method:String(rec.method || "GET"), path:path.slice(0,180), graphql:/graphql/i.test(rec.url || ""), associated:false, operation:operation.slice(0,100), bytes:String(rec.text || "").length, harvested:{files:0,links:0,text:0,published:null} });
            }
            continue;
          }

          const idLower = String(fp.id || "").toLowerCase();
          const nameKey = normalizeName(fp.name);
          const requestBlob = (String(rec.url || "") + " " + String(rec.requestBody || "")).toLowerCase();

          let associated = false;
          if (idLower && requestBlob.includes(idLower)) associated = true;
          if (!associated && (routeIdHit || diag.editorSurfaceCaptured)) {
            try { associated = objectAssociationScore(JSON.parse(rec.text), fp) >= 0.70; }
            catch (e) { associated = Boolean(nameKey && normalizeName(rec.text).includes(nameKey)); }
          }
          if (!associated) {
            try { associated = objectAssociationScore(JSON.parse(rec.text), fp) >= 0.90; }
            catch (e) { associated = Boolean(nameKey && normalizeName(rec.text).includes(nameKey)); }
          }

          // v6.2: some item editors fetch their actual files from generic read-only
          // endpoints such as /api/assets.v1, whose URL contains no Coursera item ID.
          // Associate those only inside a strongly identified, bounded item-open
          // session, and only when the response itself contains positive file/link
          // payload after UI/chrome filtering.
          let sessionAssociated = false;
          if (!associated && strongTargetSession && isSessionScopedPayloadEndpoint(rec)) {
            const allowSessionText = sessionAtomIsRelationPaired(rec, recs) && String(evidence.textConfidence || "").toLowerCase() === "high";
            const sessionEvidence = sanitizeSessionPayloadEvidence(evidence, {allowText:allowSessionText});
            if (sessionEvidence) {
              evidence = sessionEvidence;
              associated = true;
              sessionAssociated = true;
            }
          }

          const harvestedSummary = {
            files: (evidence.assetDetails || []).length,
            links: (evidence.links || []).length,
            text: String(evidence.textSample || "").length,
            published: evidence.published
          };
          if (diag.responseSummaries.length < 5) {
            let path = String(rec.url || "");
            try { path = new URL(path, location.origin).pathname; } catch (e) {}
            diag.responseSummaries.push({
              method: String(rec.method || "GET"),
              path: path.slice(0, 180),
              graphql: /graphql/i.test(rec.url || ""),
              associated: Boolean(associated),
              sessionAssociated: Boolean(sessionAssociated),
              harvested: harvestedSummary
            });
          }
          if (!associated) continue;

          meta.associatedNetworkResponses++;
          diag.associatedResponses++;
          if (sessionAssociated) {
            const sf = (evidence.assetDetails || []).length;
            const sl = (evidence.links || []).length;
            meta.sessionAssociatedResponses++;
            meta.sessionPayloadFiles += sf;
            meta.sessionPayloadLinks += sl;
            diag.sessionAssociatedResponses++;
            diag.sessionPayloadFiles += sf;
            diag.sessionPayloadLinks += sl;
          }
          mergeEvidence(fp.payload, evidence, sessionAssociated ? "active-crawl-session-network" : (/graphql/i.test(rec.url || "") ? "active-crawl-graphql" : "active-crawl-network"));
          fp.evidenceSources = unique([...(fp.evidenceSources || []), sessionAssociated ? "active-crawl-session-network" : (/graphql/i.test(rec.url || "") ? "active-crawl-graphql" : "active-crawl-network")], 50);
        }

        recorder.setActive(null);

        const afterState = JSON.stringify({
          a:(fp.payload.assetDetails||[]).length,
          l:(fp.payload.links||[]).length,
          t:String(fp.payload.textSample||"").length,
          q:Number(fp.payload.structuredAssessment && (fp.payload.structuredAssessment.questionCount || (fp.payload.structuredAssessment.questions || []).length) || 0),
          p:fp.payload.published
        });
        if (beforeState !== afterState) {
          meta.evidenceUpgrades++;
          diag.upgraded = true;
        }

        diag.networkRecorderRelease=recorder.releaseFor(fp);
        await returnToOutlineV6142(startUrl);
        diag.harvestMs=Date.now()-harvestStartedAt;
        diag.elapsedMs=Date.now()-itemStartedAt;
        diag.completed = true;
        meta.returned++;
        await sleepMs(220);
      }
    } finally {
      recorder.setActive(null);
      const recorderStats = recorder.stats ? recorder.stats() : {};
      meta.networkRecorderMemory=recorderStats;
      meta.ignoredNoiseResponses += Number(recorderStats.ignoredNoise || 0);
      meta.ignoredCourseWideResponses += Number(recorderStats.ignoredCourseWide || 0);
      meta.crawlElapsedMs = Date.now() - crawlStartedAt;
      meta.completedTargets = Number(meta.returned || 0);  // CTI_PROGRESS_BEGIN
      if (typeof ctiProgressUpdateV1 === "function") ctiProgressUpdateV1({completed:meta.targetDiagnostics.length,total:targets.length,
        count:meta.targetDiagnostics.length + "/" + targets.length + " visits attempted · " + meta.targetDiagnostics.filter(d => d.domCaptured || d.editorSurfaceCaptured).length + " editors observed"});
  // CTI_PROGRESS_END

      meta.allTargetsAttempted = Number(meta.routeAttempts || 0) >= Number(targets.length || 0) && Number(meta.unvisitedDueToBudget || 0) === 0;
      recorder.restore();
      meta.networkRecorderAfterCleanup=recorder.stats();
      await returnToOutlineV6142(startUrl);
    }
    return meta;
  }

  // A receipt from THIS visit, before merging another observation. This only
  // establishes question/choice/key text, never media, behavior or source fidelity.

  // CTI_PROGRESS_BEGIN
  ctiProgress = createCtiProgressPanelV1("CTI · Coursera v6.14.7", {key:"__CTI_COURSERA_PROGRESS__"});
  ctiProgressUpdateV1({phase:"Read course structure",detail:"Finding the course and its authoring outline."});
  // CTI_PROGRESS_END
  const id = courseId();
  const readingRouteTemplate=readingRouteTemplateV61312(id);
  if (!id) {
    console.error("Could not determine Coursera course/branch ID. Open the Edit Content/Course Outline authoring page and try again.");  // CTI_PROGRESS_BEGIN
    ctiProgressUpdateV1({phase:"Capture stopped"});
    ctiProgress.finish("error", "Open the course authoring outline and run the extractor again.");
  // CTI_PROGRESS_END

    return;
  }

  console.log("%cCTI Item Fidelity Extractor v6.14.7", "font-size:18px;font-weight:bold;color:#4F46E5");
  console.log("Course / branch:", id);

  const result = {
    schemaVersion: 34,
    extractedAt: new Date().toISOString(),
    page: { url: location.href, title: document.title, courseId: id },
    meta: {
      extractor: "CTI Item Fidelity Extractor v6.14.7",
      buildId: "v6.14.7-plugin-readiness-20260929",
      observedApiFetchLimit: MAX_OBSERVED_API_FETCHES,
      apiStatus: {},
      observedApiResponsesFetched: 0,
      observedApiResponsesUsable: 0
    },
    fingerprints: [],
    embeddedFiles: []
  };
  result.meta.filterSelfTest = {
    telemetry: isPerItemNetworkNoise("/api/rest/v1/eventing/infobatch"),
    courseWide: isCourseWideNetworkResponse("/api/authoringCourseMaterials.v1/example/")
  };
  console.log("CTI build:", result.meta.buildId, "filters:", result.meta.filterSelfTest);

  const knownCalls = {
    authoringCourseMaterials: `/api/authoringCourseMaterials.v1/${encodeURIComponent(id)}/?fields=material,conflictMetadata,authoringAtomRelations.v1(embeddedContentSourceCourseId)&includes=embeddedContentMapping`,
    authoringCourse: `/api/authoringCourses.v2/${encodeURIComponent(id)}`,
    branchProperties: `/api/authoringBranchProperties.v1/${encodeURIComponent(id)}/?fields=properties,conflictMetadata`,
    itemDraftProperties: `/api/itemDraftProperties.v1/?q=getItemDraftInfo&branchId=${encodeURIComponent(id)}&showDraftsOnFrozenAtoms=true&fields=itemTypeLabel`,
    learningObjectives: `/api/onDemandStoredLearningObjectives.v1?courseId=${encodeURIComponent(id)}&limit=5000&q=byCourse&fields=id,description`
  };

  const knownResponses = {};
  for (const [label, url] of Object.entries(knownCalls)) {
  // CTI_PROGRESS_BEGIN
    ctiProgressUpdateV1({detail:"Reading " + label});
  // CTI_PROGRESS_END
    const response = await getJson(url);
    knownResponses[label] = response;
    result.meta.apiStatus[label] = {
      status: response.status,
      ok: response.ok,
      bytes: response.bytes
    };
  }

  const materialData = knownResponses.authoringCourseMaterials && knownResponses.authoringCourseMaterials.data;
  if (!materialData) {
    console.error("authoringCourseMaterials did not return JSON. The extractor cannot reconstruct the shell structure.", result.meta.apiStatus);  // CTI_PROGRESS_BEGIN
    ctiProgressUpdateV1({phase:"Capture stopped"});
    ctiProgress.finish("error", "Course structure was unavailable. A diagnostic JSON will be prepared; it is not a complete capture.");
  // CTI_PROGRESS_END

    result.meta.itemsWithTimeEstimateEvidence = result.fingerprints.filter(fp => Number.isFinite(Number(fp.payload && fp.payload.timeEstimateMinutes))).length;
  result.meta.deepEvidenceCoverage = { structuralItems: result.fingerprints.length, eligibleTargets:Number(result.meta.activeSpaCrawl && result.meta.activeSpaCrawl.eligibleTargets || 0), navigated:Number(result.meta.activeSpaCrawl && result.meta.activeSpaCrawl.effectiveNavigated || 0), completeness:Number(result.meta.activeSpaCrawl && result.meta.activeSpaCrawl.deepCoverageCompleteness || 0), timeBudgetExhausted:Boolean(result.meta.activeSpaCrawl && result.meta.activeSpaCrawl.timeBudgetExhausted), limitedByCap:Boolean(result.meta.activeSpaCrawl && result.meta.activeSpaCrawl.coverageLimitedByCap) };
  result.meta.exportFileName = ctiCourseraExportName(id, "ITEM_FINGERPRINT_ERROR");
  downloadJson(result.meta.exportFileName, result);
    return;
  }

  result.meta.materialRootKeys = materialData && typeof materialData === "object" ? Object.keys(materialData).slice(0, 30) : [];
  result.fingerprints = await fingerprintsFromMaterial(materialData);
  result.meta.baseFingerprintCount = result.fingerprints.length;
  if (result.fingerprints.length === 0) {
    // Keep a bounded diagnostic snapshot only on failure. The material response
    // is small enough to make the next parser correction evidence-driven.
    result.debug = {
      authoringCourseMaterials: materialData,
      itemDraftProperties: knownResponses.itemDraftProperties && knownResponses.itemDraftProperties.data ? knownResponses.itemDraftProperties.data : null
    };
  }
  console.log("Base fingerprints:", result.fingerprints.length);

  for (const [label, response] of Object.entries(knownResponses)) {
    if (!response || !response.data || label === "authoringCourseMaterials") continue;
    enrichFromObservedObject(response.data, result.fingerprints, label);
  }

  const observedUrls = unique(
    performance.getEntriesByType("resource")
      .map(entry => entry.name)
      .filter(url => {
        try {
          const parsed = new URL(url);
          if (parsed.origin !== location.origin) return false;
          if (!parsed.pathname.includes("/api/")) return false;
          if (/graphql-gateway/i.test(parsed.pathname)) return false;
          return /authoring|item|atom|material|content|lecture|supplement|assessment|plugin|quiz|assignment/i.test(parsed.pathname + parsed.search);
        } catch (e) {
          return false;
        }
      }),
    MAX_OBSERVED_API_FETCHES
  );

  const knownAbsolute = new Set(Object.values(knownCalls).map(absolute));

  // CTI_PROGRESS_BEGIN
  ctiProgressUpdateV1({phase:"Read item data",detail:"Checking already-observed course responses."});
  // CTI_PROGRESS_END
  for (const url of observedUrls) {
    if (knownAbsolute.has(url)) continue;
    const response = await getJson(url);
    result.meta.observedApiResponsesFetched++;

    if (response.ok && response.data) {
      result.meta.observedApiResponsesUsable++;
      enrichFromObservedObject(response.data, result.fingerprints, safeSourceLabel(url));
    }
  }

  // CTI_PROGRESS_BEGIN
  ctiProgressUpdateV1({detail:"Reading item-specific payloads for " + result.fingerprints.length + " discovered items."});
  // CTI_PROGRESS_END
  result.meta.targetedProbe = await targetedItemPayloadProbes(result.fingerprints, knownResponses, id);
  // CTI_PROGRESS_BEGIN
  ctiProgressUpdateV1({detail:"Checking additional content evidence."});
  // CTI_PROGRESS_END
  result.meta.autoDeepVerify = await automaticDeepVerify(result.fingerprints);
  // v6.11 pre-hydrates/expands the authoring outline before exhaustive per-item traversal.
  // This is read-only and specifically addresses virtualized/collapsed outlines
  // where later assignment/rubric rows never entered the DOM in v6.8.
  // CTI_PROGRESS_BEGIN
  ctiProgressUpdateV1({detail:"Expanding the course outline before editor visits."});
  // CTI_PROGRESS_END
  result.meta.outlineHydration = await hydrateOutlineSurfaceForCrawl();
  console.log("CTI exhaustive crawl: adaptive primary budget up to " + (ACTIVE_CRAWL_MAX_TOTAL_MS / 60000) + " minutes; bounded recovery visits untouched items first.");
  const primaryStartedAt=Date.now();
  const primaryCrawl = await activeSpaCrawl(result.fingerprints, id, { retryPass:false,readingRouteTemplate });
  const primaryFinishedAt=Date.now();
  const retryPlan = buildRetryPlan(primaryCrawl, result.fingerprints);
  let retryCrawl = null;
  if (retryPlan.length) {
    console.log("CTI self-healing retry targets:", retryPlan);
    retryCrawl = await activeSpaCrawl(result.fingerprints, id, {
      retryPass:true,
      readingRouteTemplate,
      onlyIds:retryPlan.map(x => x.id),
      maxItems:retryPlan.length
    });
  }
  const recoveryFinishedAt=Date.now();
  result.meta.activeSpaCrawl = attachRetryResults(primaryCrawl, retryCrawl, retryPlan);

  // If the script is run while an individual Reading/Assignment/Discussion is
  // open, capture the actual rendered learner-facing DOM and attach it only to
  // the matching fingerprint. This is the highest-confidence browser evidence.
  const domEvidence = collectCurrentDomEvidence();
  const isOutlinePage = /\/content(?:\/edit)?\/?$/i.test(location.pathname);
  const currentItem = isOutlinePage ? null : matchCurrentPageToFingerprint(result.fingerprints, domEvidence);
  if (currentItem) {
    // v5.9 intentionally does not merge a whole-page snapshot into item payload.
    // Active item evidence must come from the certified editor surface captured
    // during the crawl, otherwise authoring chrome can create false fidelity claims.
    result.meta.currentItemDomMatched = { id: currentItem.id || "", name: currentItem.name || "", diagnosticOnly: true };
  } else {
    result.meta.currentItemDomMatched = null;
  }

  // Hash remotely accessible assets with a strict byte budget. Exact hashes turn
  // an asset comparison into cryptographic proof instead of filename guessing.
  const assetPhaseStartedAt=Date.now();
  console.log('CTI: checking asset hashes and preparing the JSON export');
  const hashBudget = { remaining: MAX_TOTAL_REMOTE_ASSET_BYTES, cache:new Map(), deadline:Date.now()+ASSET_STAGE_MAX_MS };  // CTI_PROGRESS_BEGIN
  let progressAssetsProcessed = 0;
  ctiProgressUpdateV1({phase:"Check assets",detail:"Checking accessible file hashes and preparing evidence."});
  // CTI_PROGRESS_END

  for (const fp of result.fingerprints) {
  // CTI_PROGRESS_BEGIN
    ctiProgressUpdateV1({detail:String(fp.name || fp.id),completed:progressAssetsProcessed,total:result.fingerprints.length,
      count:progressAssetsProcessed + "/" + result.fingerprints.length + " items processed for assets"});
    progressAssetsProcessed++;
  // CTI_PROGRESS_END
    fp.payload.assetDetails = uniqueAssetDetails([
      ...(fp.payload.assetDetails || []),
      ...(fp.payload.files || []).map(x => ({ url: /^https?:/i.test(x) ? x : "", name: fileNameFromUrl(x), evidenceSource: "file-string" })),
      ...(fp.payload.images || []).map(x => ({ url: /^https?:/i.test(x) ? x : "", name: fileNameFromUrl(x), evidenceSource: "image-string" }))
    ], 800);

    for (const detail of fp.payload.assetDetails) {
      if (hashBudget.remaining <= 0) { if(!detail.hashStatus)detail.hashStatus="SKIPPED_BYTE_BUDGET"; continue; }
      if (Date.now() >= hashBudget.deadline) { if(!detail.hashStatus)detail.hashStatus="SKIPPED_STAGE_BUDGET"; continue; }
      await hashRemoteAsset(detail, hashBudget);
    }

    if ((fp.payload.assetDetails || []).some(d => d.sha256)) {
      fp.payload.assetEvidenceConfidence = Math.max(Number(fp.payload.assetEvidenceConfidence || 0), 0.98);
    }

    fp.payload.files = unique(fp.payload.files || [], 600);
    fp.payload.links = unique(fp.payload.links || [], 600);
    fp.payload.images = unique(fp.payload.images || [], 600);
    fp.payload.embeddedRefs = unique(fp.payload.embeddedRefs || [], 600);
    fp.payload.assetDetails = uniqueAssetDetails(fp.payload.assetDetails || [], 800);
    finalizeCapturedTextV61318(fp.payload);
    attachQuestionFailureEvidenceV61318(fp.payload);
    fp.payload.textLength = fp.payload.textSample.length;
    fp.payload.textConfidence = String(fp.payload.textConfidence || "none");
    fp.payload.textSha256 = fp.payload.textSample ? await sha256(fp.payload.textSample) : "";
    fp.payload.evidenceLevel = fp.evidenceLevel;
    fp.payload.evidenceSources = unique(fp.evidenceSources || fp.payload.evidenceSources || [], 50);
    const na = fp.payload.nativeAssignment && typeof fp.payload.nativeAssignment === "object" ? fp.payload.nativeAssignment : null;
    fp.payload.currentState = {
      observedAt: new Date().toISOString(),
      published: fp.payload.published,
      attachmentFacts: na && Array.isArray(na.attachments) ? na.attachments : [],
      grading: na ? {
        submission: na.submission || {},
        settings: na.settings || {},
        rubricCount: Number(na.rubricCount || 0),
        currentStateEvidence: na.currentStateEvidence || {}
      } : null,
      textEvidenceCompleteness: Number(fp.payload.textEvidenceCompleteness || 0),
      textScopeKind: String(fp.payload.textScopeKind || ""),
      evidenceSources: unique(fp.evidenceSources || fp.payload.evidenceSources || [], 50)
    };
  }

  // CTI_PROGRESS_BEGIN
  ctiProgressUpdateV1({phase:"Prepare JSON",detail:"Finalizing the capture and its diagnostics."});
  // CTI_PROGRESS_END
  const assetPhaseFinishedAt=Date.now();
  result.embeddedFiles = unique(
    result.fingerprints.flatMap(fp => [
      ...(fp.payload.files || []),
      ...(fp.payload.images || []),
      ...(fp.payload.embeddedRefs || [])
    ]),
    2000
  );

  result.meta.fingerprintCount = result.fingerprints.length;
  result.meta.itemsWithAssetEvidence = result.fingerprints.filter(fp => (fp.payload.files || []).length > 0 || (fp.payload.assetDetails || []).length > 0).length;
  result.meta.itemsWithCryptographicAssetEvidence = result.fingerprints.filter(fp => (fp.payload.assetDetails || []).some(d => d.sha256)).length;
  result.meta.itemsWithPerceptualImageEvidence = result.fingerprints.filter(fp => (fp.payload.assetDetails || []).some(d => d.perceptualHash)).length;
  result.meta.remoteAssetHashBytesUsed = MAX_TOTAL_REMOTE_ASSET_BYTES - hashBudget.remaining;
  result.meta.itemsWithLinkEvidence = result.fingerprints.filter(fp => (fp.payload.links || []).length > 0).length;
  result.meta.itemsWithTextEvidence = result.fingerprints.filter(fp => (fp.payload.textSample || "").length >= 40).length;
  result.meta.itemsWithNativeRubricEvidence = result.fingerprints.filter(fp => fp.payload.nativeAssignment && Number(fp.payload.nativeAssignment.rubricCount || 0) > 0).length;
  result.meta.itemsWithNativeBehaviorEvidence = result.fingerprints.filter(fp => fp.payload.nativeAssignment && (Object.values(fp.payload.nativeAssignment.submission || {}).some(Boolean) || Object.keys(fp.payload.nativeAssignment.settings || {}).length)).length;
  result.meta.explicitQuestionErrors = result.fingerprints.reduce((n,fp)=>n+((fp.payload.ingestionFailure || {}).questionErrors || []).length,0);
  result.meta.explicitIngestionFailures = result.fingerprints.filter(fp => fp.payload.ingestionFailure && fp.payload.ingestionFailure.detected === true).length;
  result.meta.itemsWithPublicationEvidence = result.fingerprints.filter(fp => fp.payload.published === true || fp.payload.published === false).length;
  result.meta.itemsWithCurrentStateEvidence = result.fingerprints.filter(fp => fp.payload.currentState && ((fp.payload.currentState.attachmentFacts || []).length || fp.payload.currentState.grading)).length;
  result.meta.currentAttachmentFacts = result.fingerprints.reduce((n,fp) => n + (((fp.payload.currentState || {}).attachmentFacts || []).length), 0);

  result.meta.runtime={totalBeforeDownloadMs:Date.now()-nowForLock,setupMs:primaryStartedAt-nowForLock,
    primaryMs:primaryFinishedAt-primaryStartedAt,recoveryMs:recoveryFinishedAt-primaryFinishedAt,
    postCrawlCaptureMs:assetPhaseStartedAt-recoveryFinishedAt,assetAndNormalizationMs:assetPhaseFinishedAt-assetPhaseStartedAt,
    finalizationMs:Date.now()-assetPhaseFinishedAt};
  console.log("%cExtraction complete", "color:#059669;font-size:16px;font-weight:bold");
  console.table(result.meta);
  console.log(result);

  result.meta.exportFileName = ctiCourseraExportName(id, "ITEM_FINGERPRINT");
  // CTI_PROGRESS_BEGIN
  result.meta.progressTiming = {elapsedMs:ctiProgress.snapshot().elapsedMs, phaseDurationsMs:ctiProgress.snapshot().phaseDurationsMs};
  // CTI_PROGRESS_END
  downloadJson(result.meta.exportFileName, result);
  // CTI_PROGRESS_BEGIN
  const progressCrawl = result.meta.activeSpaCrawl || {};
  const progressReached = Number(progressCrawl.visitedEditorCount || 0);
  const progressTotal = Number(progressCrawl.eligibleTargets || 0);
  const progressGaps = progressReached < progressTotal || !result.fingerprints.length || Number(progressCrawl.retryRemainingWeak || 0) > 0 || Number(progressCrawl.unresolvedEvidenceCount || 0) > 0;
  ctiProgressUpdateV1({phase:progressGaps ? "Capture finished · review gaps" : "Capture finished"});
  ctiProgress.finish(progressGaps ? "review" : "success", "JSON prepared; download requested. Review evidence coverage in CTI.",
    progressReached + "/" + progressTotal + " eligible editors observed · " + result.fingerprints.reduce((n,fp) => n + Number(fp.payload.structuredAssessment && fp.payload.structuredAssessment.questionCount || 0), 0) + " question records collected");
  // CTI_PROGRESS_END
  } finally {
  // CTI_PROGRESS_BEGIN
    if (ctiProgress && ctiProgress.snapshot().outcome === "running") {
      ctiProgressUpdateV1({phase:"Capture interrupted"});
      ctiProgress.finish("error", "The run did not reach the JSON export. See the console for the error; this is not a completed capture.");
    }
  // CTI_PROGRESS_END
    releaseCtiRunLock();
  }
})();
