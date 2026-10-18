import {
  CTI_DIRECT_DATA_VERSION_V1,
  CTI_DIRECT_DATA_BUILD_V1,
  directRecoverablePublisherBuildV1,
  CTI_DIRECT_DATA_EXPORT_BYTES_V1,
  CTI_DIRECT_DATA_COMPRESSED_BYTES_V1,
  CTI_DIRECT_DATA_MEDIA_BYTES_V1,
  CTI_DIRECT_DATA_ARCHIVE_BYTES_V1,
  CTI_DIRECT_DATA_MAX_PARTS_V1,
} from "./direct-data-config.js";
import { createDirectDataMediaReaderV1, decodeDirectAssetBodyV1,
  directAssetMetadataBindingV1 } from "./direct-data-media.js";
import { createDirectDataArchiveV1 } from "./direct-data-archive.js";
import {
  directDataCoverageSummaryV1,
  directDataAttemptMetricsV1,
} from "./direct-data-summary.js";
import { createDirectDataReaderV1 } from "./direct-data-network.js";
import { createDirectProviderHelperV1 } from "./direct-data-provider-helper.js";
import { createDirectDataCheckpointStoreV1 } from "./direct-data-checkpoints.js";
import { sanitizeCourseraCourseDataModel } from "./direct-data-privacy.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import {
  CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1,
  directMaterialStabilityModelV1,
} from "./direct-data-material-stability.js";
import { directDraftWidgetProviderV1, directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1, directInlineWidgetProviderSourceV1,
  directInlineWidgetProviderTargetsV1 } from "./direct-data-widget.js";
import { directPanoptoAutomaticTargetV1, directPanoptoSourceV1,
  directPanoptoPodcastBindingsV1, CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1 } from "./direct-data-panopto.js";
import { directProviderAccessDiagnosticV1, directProviderAccessDiagnosticTextV1 } from "./direct-data-provider-diagnostic.js";
import { directPublicPageTargetV1, directPublicPageObservationValidV1,
  CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1,
  CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1 } from "./direct-data-public-page.js";
import { directPublisherTargetV1, directPublisherObservationValidV1,
  directPublisherResourceObservationValidV1, directPublisherResourceV1,
  directPublisherPartResolutionValidV1 } from "./direct-data-publisher.js";
import { directCourseInventoryV1 } from "./direct-data-inventory.js";
import { directPublisherMediaInventoryV1, directPublisherMediaStructureV1,
  directPublisherImageBodyStructureV1 } from "./direct-data-publisher-media.js";
import {
  bindDirectAuthoringDraftV1,
  directDraftAssessmentInventoryV1,
  directDraftReadingSourceV1,
  directDraftDiscussionSourceV1,
} from "./direct-data-models.js";
import {
  applyDirectContractV1,
  directReadingPayloadV1,
  directDiscussionPayloadV1,
  directReceiptSourceValidV1,
  directAssessmentContractV1,
  directEmptyStructureContractV1,
  directUnsupportedContractV1,
  directWidgetContractV1,
  directInlineWidgetBindingsV1,
  directWidgetProviderReceiptValidV1,
  directInlineWidgetEvidenceV1,
  parseCourseraCheckboxDefinitionDirectV1,
  directCmlTextV1,
  directAssessmentQuestionProjectionV1,
} from "./direct-data-contracts.js";
import { parseCourseraMcqDefinitionV61524 } from "./assessment-api.js";
import { assessmentCaptureCoverageV613 } from "./assessments-4.js";
import { captureAccountingItemsV61531 } from "./completion.js";

(() => {
  "use strict";
  void (async () => {
    const match = location.pathname.match(
      /^\/teach\/([A-Za-z0-9-]+)\/([A-Za-z0-9_-]{8,})\/content(?:\/edit)?\/?$/,
    );
    if (
      window !== window.top ||
      location.origin !== "https://www.coursera.org" ||
      !match
    ) {
      alert(
        "Open the signed-in Coursera course Content page, then click CTI full course capture.",
      );
      return;
    }
    const prior = window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__;
    if (prior?.courseId === match[2] && (prior?.running || prior?.exporting || prior?.diagnosing)) {
      prior.focus?.();
      return;
    }
    if (
      prior?.courseId === match[2] &&
      prior?.state === "PAUSED" &&
      prior?.buildId === CTI_DIRECT_DATA_BUILD_V1 &&
      !prior.terminal &&
      typeof prior.resume === "function"
    ) {
      prior.focus?.();
      return;
    }
    if (prior?.running) prior.stop?.();
    if (window.__CTI_ITEM_FIDELITY_RUN_LOCK?.running) {
      alert(
        "Stop the earlier CTI editor capture before starting the full course bookmark.",
      );
      return;
    }
    if (!crypto?.subtle || !crypto.randomUUID) {
      alert("This Chrome session cannot hash and save a course capture.");
      return;
    }
    const slug = match[1],
      courseId = match[2],
      initialPath = location.pathname;
    const cardId = "cti-direct-data-capture-v1";
    document.getElementById(cardId)?.remove();
    const card = document.createElement("section");
    card.id = cardId;
    card.setAttribute("aria-label", "CTI full course capture");
    card.style.cssText =
      "position:fixed;right:16px;bottom:16px;width:360px;max-width:90vw;max-height:80vh;overflow:auto;background:white;color:#172b4d;border:1px solid #cad5e5;border-radius:12px;padding:16px;z-index:2147483647;box-shadow:0 4px 24px #0003;font:14px/1.5 system-ui;";
    const heading = document.createElement("strong");
    heading.textContent =
      "CTI full course capture · v" + CTI_DIRECT_DATA_VERSION_V1;
    const phase = document.createElement("p"),
      detail = document.createElement("p"),
      count = document.createElement("p");
    const hint = document.createElement("p");
    hint.textContent =
      "Reads authoring drafts in this tab. Progress is saved locally. Keep the Content page open; DevTools can stay closed.";
    const stopButton = document.createElement("button");
    stopButton.textContent = "Pause";
    const downloadButton = document.createElement("button");
    downloadButton.textContent = "Download saved capture";
    downloadButton.disabled = true;
    const resumeButton = document.createElement("button");
    resumeButton.textContent = "Resume";
    resumeButton.hidden = true;
    const startButton = document.createElement("button"),
      freshButton = document.createElement("button"),
      accessButton = document.createElement("button"),
      publisherAccessButton = document.createElement("button"),
      copyAccessButton = document.createElement("button"),
      downloadAccessButton = document.createElement("button"),
      accessText = document.createElement("pre"),
      accessFallback = document.createElement("textarea");
    startButton.textContent = "Capture/resume course";
    freshButton.textContent = "Start a fresh course capture";
    accessButton.textContent = "Check Panopto access";
    publisherAccessButton.textContent = "Check embedded page access";
    copyAccessButton.textContent = "Copy access result";
    downloadAccessButton.textContent = "Download access report";
    accessText.style.cssText = "white-space:pre-wrap;font:inherit;max-height:220px;overflow:auto";
    accessText.setAttribute("role", "status");
    accessFallback.setAttribute("aria-label", "Access report copy fallback");
    accessFallback.readOnly = true;
    accessFallback.hidden = true;
    accessFallback.style.cssText = "width:95%;height:100px";
    for (const button of [freshButton, startButton, accessButton, publisherAccessButton, stopButton, downloadButton, resumeButton, copyAccessButton, downloadAccessButton])
      button.style.cssText =
        "margin:4px;padding:8px;background:#fff;border:1px solid #adc2de;border-radius:6px;color:#172b4d;cursor:pointer";
    freshButton.style.background = "#0052cc";
    freshButton.style.color = "#fff";
    card.append(
      heading,
      phase,
      detail,
      count,
      hint,
      freshButton,
      startButton,
      accessButton,
      publisherAccessButton,
      stopButton,
      downloadButton,
      resumeButton,
      accessText,
      copyAccessButton,
      downloadAccessButton,
      accessFallback,
    );
    document.body.append(card);
    const state = {
      running: false,
      state: "READY",
      phase: "Ready",
      diagnosing: false,
      accessDiagnostic: null,
      runId: "",
      courseId,
      terminal: false,
      counts: { processed: 0, complete: 0, questions: 0, total: 0 },
      version: CTI_DIRECT_DATA_VERSION_V1,
      buildId: CTI_DIRECT_DATA_BUILD_V1,
      result: null,
      downloadAttempts: 0,
      exporting: false,
      exportError: "",
    };
    window.__CTI_COURSERA_DIRECT_DATA_CAPTURE__ = state;
    let reader = null,
      store = null,
      operatorStopped = false,
      items = [],
      inventory = null,
      meta = null;
    let itemStates = new Map(),
      retainedSizes = new Map(),
      panoptoSources = new Map(),
      inlineWidgetSources = new Map(),
      publicPageSources = new Map(),
      publisherPageSources = new Map(),
      externalSourceTargets = new Set(),
      publicPageRetainedByItem = new Map(),
      exporting = false,
      fatalReason = "";
    let budgetBase = { requests: 0, bytes: 0, elapsedMs: 0 },
      budgetLimits = null,
      frozenStats = null,
      mediaReader = null,
      mediaBase = { bytes: 0, requests: 0 },
      frozenMediaStats = null;
    let budgetSaveTail = Promise.resolve(),
      lastBudgetSaveAt = 0,
      lastBudgetSaveRequests = 0,
      materialHash = "",
      metadataReserveBytes = 256 * 1024,
      checkpointReady = false;
    let accessReader = null, providerTransport = null;
    let publicPageStats = { readerOperations: 0, observedEnvelopeBytes: 0, retainedUtf8Bytes: 0 };
    let publisherPageStats = { readerOperations: 0, observedBytes: 0 };
    const publisherImageTargets = new Set();
    const encoder = new TextEncoder();
    const hash = async (value) => {
      const bytes = encoder.encode(directCanonicalSourceTextV1(value));
      return Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    };
    const receipt = (read, id) => ({
      ...read.receipt,
      id,
      sha256: read.receipt?.originalResponseSha256,
    });
    function render(message = "") {
      phase.textContent = state.phase;
      if (message) detail.textContent = message;
      const stats = budgetSnapshot();
      const mediaOnly = ["REFERENCED_READING_MEDIA_ONLY", "REFERENCED_CML_MEDIA_ONLY", "REFERENCED_CML_MEDIA_AND_WIDGET_SOURCES"].includes(
        meta?.directDataCapture?.mediaEnrichment?.scope,
      );
      hint.textContent = state.diagnosing || state.state === "READY"
        ? "After edits, start a fresh course capture to reread questions. Capture/resume continues saved progress; finished runs may only add media. Panopto access is diagnostic only."
        : mediaOnly
        ? "This attempt reads referenced files and supported external providers. Saved questions retain their original capture timestamps. Keep the Content page open; DevTools can stay closed."
        : "Reads authoring drafts in this tab. Progress is saved locally. Keep the Content page open; DevTools can stay closed.";
      const summary = coverageSummary();
      state.coverage = summary;
      count.textContent =
        summary.content.verified +
        "/" +
        summary.content.total +
        " content items verified · " +
        state.counts.processed +
        "/" +
        state.counts.total +
        (mediaOnly
          ? " inventory entries retained · "
          : " inventory entries read · ") +
        summary.structures.verified +
        "/" +
        summary.structures.total +
        " empty structures verified · " +
        summary.questions +
        " question occurrences · " +
        Math.floor((stats.currentAttempt?.elapsedMs || 0) / 60000) +
        "m this attempt · " +
        (stats.currentAttempt?.requests || 0) +
        " API reads this attempt" +
        (budgetBase.elapsedMs
          ? " · " + Math.floor(stats.elapsedMs / 60000) + "m across attempts"
          : "");
      if (summary.assessments.total || summary.readings.total || summary.widgets.total)
        count.textContent +=
          " · Assessments " +
          summary.assessments.verified +
          "/" +
          summary.assessments.total +
          " verified · Readings " +
          summary.readings.verified +
          "/" +
          summary.readings.total +
          " fully verified · " +
          summary.missingPointers.items +
          " readings missing media pointers · " +
          "Widget settings " +
          (summary.widgets.configurations || 0) +
          "/" + summary.widgets.total +
          " captured · external widget bodies unverified";
      const inline = stats.inlineExternalContent;
      state.inlineExternalContent = inline;
      if (inline.settings.total) {
        count.textContent += " · Inline widget settings " + inline.settings.captured + "/" + inline.settings.total +
          " captured in " + inline.readings + " readings · External pages " + inline.pages.saved + "/" + inline.pages.unique + " saved";
        if (inline.pages.historical) count.textContent += " · " + inline.pages.historical + " historical pages retained";
        for (const [label, transport, total] of [
          ["Publisher API sources", inline.publisherApi, inline.publisherApi.unique],
          ["HTML fallbacks", inline.htmlPages, inline.htmlPages.readTargets],
        ]) {
          if (!total) continue;
          count.textContent += " · " + label + " " + transport.saved + "/" + total + " saved";
          const detail = transport.failures, failures = Object.entries(detail.observedHttp || detail.upstreamHttp).map(([status, n]) => n + " HTTP " + status);
          if (detail.timeouts) failures.push(detail.timeouts + " timeout" + (detail.timeouts === 1 ? "" : "s"));
          if (detail.browserUnavailable) failures.push(detail.browserUnavailable + " browser-blocked or network-failed");
          if (detail.limits) failures.push(detail.limits + " resource-resolution limit");
          if (detail.unsupported) failures.push(detail.unsupported + " outside the supported reader scope");
          if (detail.other) failures.push(detail.other + " other failures");
          if (detail.unclassified) failures.push(detail.unclassified + " unverified");
          if (detail.mixed) failures.push(detail.mixed + " mixed failure outcomes");
          if (failures.length) count.textContent += " (" + failures.join("; ") + ")";
        }
        if (inline.publisherImages?.unique || inline.publisherImages?.sourceGaps) {
          const images = inline.publisherImages, failures = [];
          count.textContent += images.unique ? " · Publisher image sources " + images.saved + "/" + images.unique + " saved" : " · Publisher images";
          if (images.browserUnavailable) failures.push(images.browserUnavailable + " browser-blocked or unreadable");
          if (images.failed) failures.push(images.failed + " other read failures");
          if (images.unverified) failures.push(images.unverified + " unverified");
          if (images.sourceGaps) failures.push(images.sourceGaps + " image source gaps");
          if (failures.length) count.textContent += " (" + failures.join("; ") + ")";
          if (images.historical) count.textContent += " · " + images.historical + " historical image originals retained";
        }
        if (inline.limited) count.textContent += " · External-page summary limited; retained source records remain in the capture";
      }
      count.hidden = !meta || state.diagnosing;
      const busy = state.running || state.diagnosing || exporting;
      startButton.disabled = busy || state.terminal;
      freshButton.disabled = busy;
      accessButton.disabled = busy;
      publisherAccessButton.disabled = busy;
      stopButton.disabled = !state.running && !state.diagnosing;
      downloadButton.disabled = busy || !meta;
      resumeButton.hidden =
        state.running || state.terminal || state.state !== "PAUSED";
      resumeButton.disabled = exporting || state.diagnosing;
      copyAccessButton.hidden = downloadAccessButton.hidden = !state.accessDiagnostic;
      copyAccessButton.disabled = downloadAccessButton.disabled = busy;
    }
    function coverageSummary() {
      return directDataCoverageSummaryV1(
        items.map(
          (fp) =>
            itemStates.get(fp.id) || {
              type: fp.type,
              structural: inventory?.leaves.get(fp.id)?.structural === true,
              processed: false,
              contract: { complete: false },
              questions: 0,
            },
        ),
      );
    }
    function requireRead(read) {
      if (!read.ok) throw Error(read.reason || "DIRECT_API_READ_FAILED");
      return read.data;
    }
    function assertContext() {
      return (
        !operatorStopped &&
        location.origin === "https://www.coursera.org" &&
        location.pathname === initialPath
      );
    }
    function budgetSnapshot() {
      const stats = frozenStats || reader?.snapshot();
      const media = frozenMediaStats || mediaReader?.snapshot();
      return {
        ...directDataAttemptMetricsV1(stats || {}, budgetBase),
        limits: { ...budgetLimits },
        media: {
          ...media,
          bytes: mediaBase.bytes + (media?.bytes || 0),
          requests: mediaBase.requests + (media?.requests || 0),
          currentAttempt: media || { bytes: 0, requests: 0 },
        },
        publicPages: { ...publicPageStats, sourceScope: "CURRENT_ATTEMPT", retainedScope: "CURRENT_CAPTURE_HTML_AND_PUBLISHER_JSON",
          limits: { readerOperations: 64, observedEnvelopeBytes: 16 * 1024 * 1024,
            retainedUtf8Bytes: CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1 } },
        publisherPages: { ...publisherPageStats, sourceScope: "CURRENT_ATTEMPT" },
        externalSources: { logicalTargets: externalSourceTargets.size, limit: 64,
          retainedUtf8Bytes: publicPageStats.retainedUtf8Bytes, retainedBytesLimit: CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1 },
        inlineExternalContent: inlineExternalContentSummary(),
      };
    }
    function terminalBudgetReason(reason) {
      return [
        "COURSE_API_TIME_LIMIT",
        "COURSE_API_BYTE_LIMIT",
        "COURSE_API_REQUEST_LIMIT",
        "DIRECT_CAPTURE_EXPORT_BYTE_LIMIT",
        "DIRECT_RUN_BUDGET_METADATA_INVALID",
      ].includes(reason);
    }
    function remainingLimits() {
      const remaining = {
        ...budgetLimits,
        requests: budgetLimits.requests - budgetBase.requests,
        totalBytes: budgetLimits.totalBytes - budgetBase.bytes,
        durationMs: budgetLimits.durationMs - budgetBase.elapsedMs,
      };
      if (remaining.requests <= 0) throw Error("COURSE_API_REQUEST_LIMIT");
      if (remaining.totalBytes <= 0) throw Error("COURSE_API_BYTE_LIMIT");
      if (remaining.durationMs <= 0) throw Error("COURSE_API_TIME_LIMIT");
      return remaining;
    }
    async function saveRun(status, includeMeta = false) {
      if (!store?.available || !state.runId) return;
      const budget = budgetSnapshot(),
        value = {
          runId: state.runId,
          state: status,
          materialHash,
          counts: { ...state.counts },
          buildId: CTI_DIRECT_DATA_BUILD_V1,
          budget: {
            requests: budget.requests,
            bytes: budget.bytes,
            elapsedMs: budget.elapsedMs,
            limits: { ...budgetLimits },
            media: budget.media,
          },
        };
      if (includeMeta && meta) value.captureMeta = meta;
      lastBudgetSaveAt = Date.now();
      lastBudgetSaveRequests = budget.requests;
      // Serialize writes so a delayed RUNNING checkpoint cannot overwrite a
      // final PAUSED/INCOMPLETE state. Capture counters before enqueueing.
      const pending = budgetSaveTail
        .catch(() => {})
        .then(() => store.saveRun(value));
      budgetSaveTail = pending;
      await pending;
    }
    function checkpointBudget() {
      if (
        !state.running ||
        !checkpointReady ||
        !state.runId ||
        !meta ||
        !reader ||
        frozenStats
      )
        return;
      const budget = budgetSnapshot();
      if (
        Date.now() - lastBudgetSaveAt < 5000 &&
        budget.requests - lastBudgetSaveRequests < 30
      )
        return;
      void saveRun("RUNNING").catch(() =>
        reader?.abort("DIRECT_CHECKPOINT_STORAGE_FAILED"),
      );
    }
    function summarizeItem(fp, processed, size) {
      retainedSizes.set(fp.id, size);
      itemStates.set(fp.id, {
        processed,
        contract: fp.captureContract,
        type: fp.type,
        structural: inventory?.leaves.get(fp.id)?.structural === true,
        questions: fp.payload.structuredAssessment?.questions?.length || 0,
        assetReferenceCount:
          fp.payload.directDataEvidence?.assetReferenceCount || 0,
        assetReferenceIds: [
          ...(
            fp.payload.directDataEvidence?.unresolvedAssetReferences || []
          ).map((ref) => ref.id),
          ...(fp.payload.assetDetails || []).map((detail) => detail.assetId),
        ].filter(Boolean),
        missingPointerCount: (
          fp.payload.directDataEvidence?.unresolvedAssetReferences || []
        ).filter((ref) => !ref.id && !ref.url).length,
        inlineExternalContent: summarizeInlineItem(fp),
      });
      state.counts.processed = [...itemStates.values()].filter(
        (value) => value.processed,
      ).length;
      state.counts.complete = [...itemStates.values()].filter(
        (value) => value.contract?.complete,
      ).length;
      state.counts.questions = [...itemStates.values()].reduce(
        (sum, value) => sum + value.questions,
        0,
      );
    }
    function publicPageFailureOutcome(failure) {
      const code = typeof failure?.reason === "string" ? failure.reason : "",
        receipt = failure?.receipt,
        observedStatus = (receipt?.observedAtBasis === "UPSTREAM" && receipt.upstreamRequests > 0 ||
          receipt?.observedAtBasis === "BROWSER_RESPONSE" && receipt.transport === "BROWSER_PUBLISHER_API" &&
          ["PublisherChapter", "PublisherPart"].includes(receipt.resource) && receipt.responseType === "cors") && Number.isInteger(receipt.status) &&
          receipt.status >= 400 && receipt.status <= 599 ? receipt.status : 0,
        reasonStatus = /^(?:PUBLIC_HTML_PROVIDER_HTTP|PUBLISHER_IMAGE_HTTP)_([45]\d\d)$/.exec(code);
      if (code === "PUBLISHER_BROWSER_RESOURCE_RESOLUTION_LIMIT") return "LIMIT";
      if (observedStatus || reasonStatus) return "HTTP_" + (observedStatus || reasonStatus[1]);
      if (["PUBLISHER_BROWSER_BLOCKED_OR_FAILED", "PUBLISHER_IMAGE_BLOCKED_OR_FAILED", "PUBLISHER_IMAGE_RESPONSE_UNREADABLE"].includes(code)) return "BROWSER_UNAVAILABLE";
      if (/TIMEOUT/.test(code)) return "TIMEOUT";
      if (code === "DIRECT_PUBLIC_PAGE_TARGET_UNSUPPORTED") return "UNSUPPORTED";
      return code ? "OTHER" : "UNCLASSIFIED";
    }
    function summarizeInlineItem(fp) {
      const evidence = fp.payload?.directInlineWidgetProviderEvidence,
        providers = Array.isArray(evidence?.providers) ? evidence.providers : [],
        sourceStable = fp.payload?.directDataSources?.receipts?.stability?.stable === true &&
          fp.payload?.directResumeRevalidation?.verified !== false,
        result = { total: providers.length, captured: 0, pages: [], limited: providers.length > 64 };
      const addImageGap = value => {
        result.imageGaps ||= [];
        if (result.imageGaps.length < 256) result.imageGaps.push(value);
        else result.limited = true;
      };
      if (evidence?.method !== "BOUND_INLINE_CML_WIDGET_PROVIDERS") return { ...result, total: 0 };
      for (const provider of providers.slice(0, 64)) {
        if (!sourceStable || provider.courseId !== courseId || provider.itemId !== fp.id || provider.atomId !== fp.atomId ||
            provider.stableSource !== true || provider.failures?.length ||
            !/^[a-f0-9]{64}$/.test(provider.initial?.modelHash || "") || provider.initial.modelHash !== provider.final?.modelHash ||
            !/^[a-f0-9]{64}$/.test(provider.initial?.sourceHash || "") || provider.initial.sourceHash !== provider.final?.sourceHash) continue;
        result.captured++;
        const pages = [...(Array.isArray(provider.publicPages) ? provider.publicPages.map(value => ({ ...value, representation: "HTML" })) : []),
          ...(Array.isArray(provider.publisherPages) ? provider.publisherPages.map(value => ({ ...value, representation: "PUBLISHER_API" })) : [])];
        if (pages.length > 128 - result.pages.length) result.limited = true;
        for (const page of pages.slice(0, Math.max(0, 128 - result.pages.length))) {
          if (typeof page.targetUrl !== "string" || !page.targetUrl || page.targetUrl.length > 8192) { result.limited = true; continue; }
          const failures = Array.isArray(page.failures) ? page.failures : [];
          result.pages.push({ targetUrl: page.targetUrl, saved: !!page.observation && !failures.length,
            historical: !!page.retainedObservation && failures.length > 0,
            representation: page.representation,
            skipped: page.representation === "HTML" && failures.length > 0 && failures.every(value => value.reason === "PUBLIC_HTML_NOT_READ_PUBLISHER_API_SELECTED"),
            outcomes: [...new Set(failures.slice(0, 32).filter(value => value.reason !== "PUBLIC_HTML_NOT_READ_PUBLISHER_API_SELECTED").map(publicPageFailureOutcome))],
            browserUnavailable: failures.some(value => value.reason === "PUBLISHER_BROWSER_BLOCKED_OR_FAILED") });
          if (page.representation === "PUBLISHER_API" && page.media !== undefined) {
            const selected = page.observation || page.retainedObservation,
              media = selected && directPublisherMediaStructureV1(selected, page.targetUrl, page.media);
            if (media) {
              result.images ||= [];
              if (media.failures.length > 256) result.limited = true;
              for (const failure of media.failures.slice(0, 256)) {
                const literal = typeof failure.attributeValue === "string" && failure.attributeValue.length <= 4000 && failure.attributeValue,
                  identity = literal || media.sourceSha256 + "~" + failure.field + "~" + failure.ordinal;
                addImageGap(identity + "~" + failure.reason);
              }
              for (const group of [{ resources: media.resources, historical: !page.observation },
                ...(media.retained || []).slice(0, 128).map(value => ({ resources: value.resources, historical: true }))]) {
                for (const resource of group.resources) {
                  if (result.images.length >= 256) { result.limited = true; break; }
                  result.images.push({ url: resource.url, saved: !group.historical && !!resource.body,
                    historical: group.historical && !!resource.body,
                    outcome: resource.reason ? publicPageFailureOutcome({ reason: resource.reason }) : resource.body ? "" : "UNCLASSIFIED" });
                }
              }
            } else addImageGap((selected?.model?.sha256 || page.targetUrl) + "~PUBLISHER_IMAGE_MEDIA_EVIDENCE_INVALID");
          }
          for (const failure of (Array.isArray(page.mediaFailures) ? page.mediaFailures : []).slice(0, 32))
            if (/^[A-Z0-9_]{1,96}$/.test(failure?.reason || ""))
              addImageGap((page.observation?.model?.sha256 || page.targetUrl) + "~" + failure.reason);
        }
      }
      return result;
    }
    function inlineExternalContentSummary() {
      const failureCounts = (httpKey = "upstreamHttp") => ({ [httpKey]: {}, timeouts: 0, unsupported: 0, other: 0, unclassified: 0, mixed: 0 });
      function addFailures(counts, outcomes, httpKey = "upstreamHttp") {
        const values = [...outcomes], outcome = values[0] || "UNCLASSIFIED";
        if (values.length > 1) counts.mixed++;
        else if (outcome.startsWith("HTTP_")) counts[httpKey][outcome.slice(5)] = (counts[httpKey][outcome.slice(5)] || 0) + 1;
        else {
          const key = { TIMEOUT: "timeouts", UNSUPPORTED: "unsupported", OTHER: "other", UNCLASSIFIED: "unclassified", BROWSER_UNAVAILABLE: "browserUnavailable", LIMIT: "limits" }[outcome] || "other";
          counts[Object.prototype.hasOwnProperty.call(counts, key) ? key : "other"]++;
        }
      }
      const sources = new Map(), imageSources = new Map(), imageGaps = new Set(), result = { method: "CAPTURE_REPORTED_INLINE_SOURCE_SUMMARY", readings: 0,
        settings: { captured: 0, total: 0 }, pages: { saved: 0, unique: 0, historical: 0 },
        failures: failureCounts(),
        htmlPages: { saved: 0, unique: 0, readTargets: 0, skipped: 0, historical: 0, failures: failureCounts() },
        publisherApi: { saved: 0, unique: 0, historical: 0, browserUnavailable: 0, failures: { ...failureCounts("observedHttp"), browserUnavailable: 0, limits: 0 } },
        limited: false, sourceLimit: 256, wholeWidgetVerified: false };
      for (const item of itemStates.values()) {
        const value = item.inlineExternalContent;
        if (!value?.total) continue;
        result.readings++; result.settings.total += value.total; result.settings.captured += value.captured;
        result.limited ||= value.limited;
        for (const page of value.pages) {
          if (!sources.has(page.targetUrl)) {
            if (sources.size >= result.sourceLimit) { result.limited = true; continue; }
            sources.set(page.targetUrl, { saved: false, historical: false, outcomes: new Set(), publisher: false,
              publisherSaved: false, publisherHistorical: false, publisherOutcomes: new Set(), browserUnavailable: false,
              html: false, htmlSaved: false, htmlHistorical: false, htmlRead: false, htmlSkipped: false });
          }
          const source = sources.get(page.targetUrl);
          source.saved ||= page.saved; source.historical ||= page.historical;
          if (page.representation === "PUBLISHER_API") {
            source.publisher = true; source.publisherSaved ||= page.saved; source.publisherHistorical ||= page.historical;
            source.browserUnavailable ||= page.browserUnavailable;
            for (const outcome of page.outcomes) source.publisherOutcomes.add(outcome);
          } else {
            source.html = true; source.htmlSaved ||= page.saved; source.htmlHistorical ||= page.historical;
            source.htmlRead ||= !page.skipped; source.htmlSkipped ||= page.skipped;
            for (const outcome of page.outcomes) source.outcomes.add(outcome);
          }
        }
        for (const image of value.images || []) {
          if (!imageSources.has(image.url)) {
            if (imageSources.size >= 512) { result.limited = true; continue; }
            imageSources.set(image.url, { saved: false, historical: false, outcomes: new Set() });
          }
          const source = imageSources.get(image.url);
          source.saved ||= image.saved; source.historical ||= image.historical;
          if (image.outcome) source.outcomes.add(image.outcome);
        }
        for (const key of value.imageGaps || []) {
          if (imageGaps.size >= 512 && !imageGaps.has(key)) { result.limited = true; continue; }
          imageGaps.add(key);
        }
      }
      result.pages.unique = sources.size;
      for (const source of sources.values()) {
        if (source.publisher) {
          result.publisherApi.unique++;
          if (source.publisherSaved) result.publisherApi.saved++;
          if (source.publisherHistorical) result.publisherApi.historical++;
          if (!source.publisherSaved && source.browserUnavailable) result.publisherApi.browserUnavailable++;
          if (!source.publisherSaved) addFailures(result.publisherApi.failures, source.publisherOutcomes, "observedHttp");
        }
        if (source.html) {
          result.htmlPages.unique++;
          if (source.htmlSaved) result.htmlPages.saved++;
          if (source.htmlHistorical) result.htmlPages.historical++;
          if (source.htmlRead) result.htmlPages.readTargets++;
          else if (source.htmlSkipped) result.htmlPages.skipped++;
          if (source.htmlRead && !source.htmlSaved) addFailures(result.htmlPages.failures, source.outcomes);
        }
        if (source.historical) result.pages.historical++;
        if (source.saved) { result.pages.saved++; continue; }
        addFailures(result.failures, source.outcomes);
      }
      if (imageSources.size || imageGaps.size) {
        result.publisherImages = { unique: imageSources.size, saved: 0, historical: 0, browserUnavailable: 0, failed: 0, unverified: 0 };
        if (imageGaps.size) result.publisherImages.sourceGaps = imageGaps.size;
        for (const image of imageSources.values()) {
          if (image.saved) result.publisherImages.saved++;
          if (image.historical) result.publisherImages.historical++;
          if (image.saved) continue;
          if (image.outcomes.has("BROWSER_UNAVAILABLE")) result.publisherImages.browserUnavailable++;
          else if ([...image.outcomes].some(value => value && value !== "UNCLASSIFIED")) result.publisherImages.failed++;
          else if (!image.historical) result.publisherImages.unverified++;
        }
      }
      return result;
    }
    function retainPublicFailureReceipt(read, targetUrl) {
      const input = read?.receipt, result = {};
      if (!input || input.resource !== "PublicStaticHtml" || input.id !== targetUrl || !directPublicPageTargetV1(targetUrl)) return null;
      for (const key of ["resource", "id", "requestedUrl", "normalizedUrl", "origin", "requestPath", "method", "bodyFormat",
        "originalResponseSha256", "transport", "serviceOrigin", "receivedAt", "observedAt", "observedAtBasis"])
        if (typeof input[key] === "string" && input[key].length <= 4000 && !/[\r\n\0]/.test(input[key])) result[key] = input[key];
      for (const key of ["status", "serviceStatus", "bytes", "upstreamRequests", "upstreamBytes", "declaredEnvelopeBytes"])
        if (Number.isSafeInteger(input[key]) && input[key] >= 0 &&
            (!["status", "serviceStatus"].includes(key) || input[key] <= 599)) result[key] = input[key];
      if (Array.isArray(input.requestQuery) && input.requestQuery.length <= 4 && input.requestQuery.every(pair =>
        Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && typeof pair[1] === "string" &&
        (pair[0] === "action" ? pair[1] === "h5p_embed" : ["p", "h5p-embed", "id"].includes(pair[0]) && /^\d+$/.test(pair[1]))))
        result.requestQuery = input.requestQuery.map(pair => [...pair]);
      return encoder.encode(JSON.stringify(result)).byteLength <= 16 * 1024 ? result : null;
    }
    function retainPublisherFailureReceipt(read, targetUrl) {
      const input = read?.receipt, result = {};
      if (!input || !["PublisherChapter", "PublisherPart"].includes(input.resource) || input.id !== targetUrl || !directPublisherTargetV1(targetUrl)) return null;
      for (const key of ["resource", "id", "requestedUrl", "endpointUrl", "origin", "requestPath", "method", "bodyFormat",
        "originalResponseSha256", "transport", "receivedAt", "observedAt", "observedAtBasis", "responseType", "credentials"])
        if (typeof input[key] === "string" && input[key].length <= 4000 && !/[\r\n\0]/.test(input[key])) result[key] = input[key];
      for (const key of ["status", "bytes"])
        if (Number.isSafeInteger(input[key]) && input[key] >= 0 && (key !== "status" || input[key] <= 599)) result[key] = input[key];
      if (Array.isArray(input.requestQuery) && !input.requestQuery.length) result.requestQuery = [];
      if (Array.isArray(input.attempts) && input.attempts.length <= 2) result.attempts = input.attempts.map(attempt => ({
        credentials: ["omit", "include"].includes(attempt.credentials) ? attempt.credentials : "omit",
        status: Number.isInteger(attempt.status) && attempt.status >= 0 && attempt.status <= 599 ? attempt.status : 0,
        responseType: ["cors", "unreadable"].includes(attempt.responseType) ? attempt.responseType : "unreadable",
        observedAt: typeof attempt.observedAt === "string" && attempt.observedAt.length <= 64 ? attempt.observedAt : "",
        bytes: Number.isSafeInteger(attempt.bytes) && attempt.bytes >= 0 ? attempt.bytes : 0,
        reason: /^[A-Z0-9_]{0,96}$/.test(attempt.reason || "") ? attempt.reason || "" : "PUBLISHER_BROWSER_BLOCKED_OR_FAILED",
      }));
      if (input.resource === "PublisherPart") {
        if (!directPublisherPartResolutionValidV1(input.resolution, targetUrl, input.observedAt)) return null;
        const chapterReceipt = retainPublisherFailureReceipt({ receipt: input.resolution.chapterReceipt }, targetUrl);
        if (!chapterReceipt) return null;
        result.resolution = { method: "CHAPTER_404_TO_PART", chapterReceipt };
      }
      return encoder.encode(JSON.stringify(result)).byteLength <= 16 * 1024 ? result : null;
    }
    async function hydrateSavedItems() {
      // Do not list/load a whole question bank into the renderer. Hydrate one
      // row at a time and retain only its counters and serialized byte size.
      for (const fp of items) {
        const row = await store.getItem(state.runId, fp.id);
        if (!row?.fingerprint || row.fingerprint.id !== fp.id) continue;
        // Recheck retained evidence one item at a time. Source receipts and
        // capture timestamps remain the original observations.
        const retained = row.fingerprint,
          previouslyComplete = retained.captureContract?.complete === true;
        let originalComparison;
        try { originalComparison = directCanonicalSourceTextV1(retained); }
        catch (_) { originalComparison = JSON.stringify(retained); }
        const publicBytes = retainedPublicPageBytes(retained);
        publicPageStats.retainedUtf8Bytes += publicBytes - (publicPageRetainedByItem.get(fp.id) || 0);
        publicPageRetainedByItem.set(fp.id, publicBytes);
        if (publicPageStats.retainedUtf8Bytes > CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1)
          throw Error("DIRECT_PUBLIC_PAGE_RETAINED_LIMIT");
        const bodiesAvailable = await hydrateItemBodies(retained, true);
        try {
          const bound = bindDirectAuthoringDraftV1(
            retained, courseId, slug,
            retained.payload.directDataSources?.atom,
            retained.payload.directDataSources?.relation,
          );
          if (bound.draft.content.typeName === "staffGradedDraft") {
            // Rebuild derived text from the exact retained native definitions.
            // This does not refresh source receipts or observation timestamps.
            const definitions = retained.payload.assessmentApiEvidence?.questionDefinitions || [];
            for (const question of retained.payload.structuredAssessment?.questions || []) {
              const matches = definitions.filter(value => value.id === question.sourceDefinitionId);
              const projection = matches.length === 1 && directAssessmentQuestionProjectionV1(matches[0]);
              if (projection) Object.assign(question, projection);
            }
            directAssessmentContractV1(
              retained, retained.payload.structuredAssessment,
              directDraftAssessmentInventoryV1(bound), bound,
            );
          } else if (bound.draft.content.typeName === "supplementDraft")
            await directReadingPayloadV1(retained, bound, directDraftReadingSourceV1(bound));
          else if (bound.draft.content.typeName === "discussionPromptDraft")
            await directDiscussionPayloadV1(retained, bound, directDraftDiscussionSourceV1(bound));
          else if (bound.draft.content.typeName === "widgetDraft")
            directWidgetContractV1(retained, bound);
        } catch (_) {
          // Keep every original observation, while withdrawing a completion
          // claim that the current source verifier cannot establish.
          if (!inventory.leaves.get(fp.id).structural)
            directUnsupportedContractV1(retained, "DIRECT_RETAINED_SOURCE_REVALIDATION_FAILED");
        }
        // A current pure verifier may withdraw historical completion. It
        // cannot replace the fresh reads needed to finish an unresolved item.
        if (!previouslyComplete && retained.captureContract?.complete === true)
          directUnsupportedContractV1(retained, "DIRECT_RETAINED_SOURCE_REQUIRES_CURRENT_CHECK");
        if (!bodiesAvailable || retained.payload?.directResumeRevalidation?.verified === false)
          directUnsupportedContractV1(retained, !bodiesAvailable
            ? "DIRECT_ARCHIVE_BODY_UNAVAILABLE"
            : "DIRECT_RESUME_REVALIDATION_FAILED");
        await archiveItemBodies(retained);
        const retainedJson = JSON.stringify(retained);
        let retainedComparison;
        try { retainedComparison = directCanonicalSourceTextV1(retained); }
        catch (_) { retainedComparison = retainedJson; }
        // Compare parsed record values without rewriting native array order or
        // literal response strings. Unsupported comparison values conservatively
        // use exact JSON; they do not add a new checkpoint acceptance limit.
        // Unchanged loading must not relabel a saved row with a new write time.
        if (retainedComparison !== originalComparison)
          await store.putItem(state.runId, fp.id, retained, row.state);
        const size = encoder.encode(retainedJson).byteLength;
        summarizeItem(retained, row.state?.processed === true, size);
      }
      render(
        "Saved progress loaded. Current drafts and question references are checked before reuse.",
      );
    }
    function itemBodyEntries(fp) {
      const bodies = [], add = (body, kind, maxBytes) => {
        if (body) bodies.push({body, kind, maxBytes});
      };
      for (const asset of fp.payload?.directAssetEvidence?.assets || []) {
        add(asset.body, "COURSERA_ASSET", 16 * 1024 * 1024);
        add(asset.retainedEvidence?.body, "COURSERA_ASSET", 16 * 1024 * 1024);
      }
      for (const delivery of fp.payload?.directPanoptoEvidence?.deliveries || [])
        for (const podcast of delivery.podcasts || []) {
          add(podcast.body, "PANOPTO_PODCAST_RENDITION", CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1);
          add(podcast.retainedEvidence?.podcast?.body, "PANOPTO_PODCAST_RENDITION", CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1);
        }
      for (const evidence of [fp.payload?.directInlineWidgetProviderEvidence, fp.payload?.directInlineWidgetProviderAttempt])
        for (const provider of evidence?.providers || [])
          for (const page of provider.publisherPages || []) {
            for (const resource of page.media?.resources || []) add(resource.body,"PUBLISHER_IMAGE",16 * 1024 * 1024);
            for (const group of page.media?.retained || [])
              for (const resource of group.resources || []) add(resource.body,"PUBLISHER_IMAGE",16 * 1024 * 1024);
          }
      return bodies;
    }
    function itemBodies(fp) { return itemBodyEntries(fp).map(value => value.body); }
    async function retainOnlyOwnedPublisherBodies(fp) {
      const validProviders = new Set();
      try {
        const payload = {...fp.payload}; delete payload.directResumeRevalidation;
        const retained = {...fp,payload}, sources = payload.directDataSources,
          branch = sources.relation.elements[0].branchRelationMap[courseId + "~" + fp.id],
          bound = bindDirectAuthoringDraftV1(retained,courseId,branch.courseSlug,sources.atom,sources.relation),
          hashes = new Map(), values = [bound.draft];
        for (const proof of payload.directInlineWidgetProviderEvidence?.providers || [])
          for (const stage of ["initial","final"]) {
            values.push(proof[stage]?.model);
            values.push(directInlineWidgetProviderSourceV1(proof,proof[stage]?.model));
          }
        for (const value of values) if (value !== undefined) hashes.set(directCanonicalSourceTextV1(value),await hash(value));
        const checked = directInlineWidgetEvidenceV1(retained,bound,value => hashes.get(directCanonicalSourceTextV1(value)));
        for (const provider of checked?.providers || []) validProviders.add(provider.binding.providerId);
      } catch (_) {}
      for (const evidence of [fp.payload?.directInlineWidgetProviderEvidence,fp.payload?.directInlineWidgetProviderAttempt])
        for (const provider of evidence?.providers || [])
          if (evidence === fp.payload?.directInlineWidgetProviderAttempt || !validProviders.has(provider.providerId))
          for (const page of provider.publisherPages || [])
            for (const group of [{resources:page.media?.resources || []},...(page.media?.retained || [])])
              for (const resource of group.resources || []) if (resource.body) {
                const body = resource.body;
                resource.unretainedBody = {status:"UNRETAINED",sha256:body.sha256,size:body.size,mime:body.mime,receipt:body.receipt};
                resource.reason = "PUBLISHER_IMAGE_NATIVE_BINDING_UNVERIFIED";
                delete resource.body;
              }
    }
    async function hydrateItemBodies(fp, tolerateMissing = false) {
      let available = true;
      for (const body of itemBodies(fp)) {
        if (!body.archivePath || body.bytes instanceof Uint8Array) continue;
        if (body.archivePath !== "files/" + body.sha256)
          throw Error("DIRECT_ARCHIVE_BODY_IDENTITY_INVALID");
        const stored = await store.getBody(state.runId, body.sha256);
        if (!stored?.blob || stored.size !== body.size) {
          if (!tolerateMissing) throw Error("DIRECT_ARCHIVE_BODY_UNAVAILABLE");
          available = false;
          continue;
        }
        const bytes = new Uint8Array(await stored.blob.arrayBuffer());
        Object.defineProperty(body, "bytes", {value: bytes, configurable: true});
      }
      return available;
    }
    async function archiveItemBodies(fp, temporaryBodies = null) {
      let changed = false;
      for (const {body, kind, maxBytes} of itemBodyEntries(fp)) {
        if (body.archivePath && typeof body.base64 !== "string" &&
            !(body.bytes instanceof Uint8Array)) continue;
        const bytes = decodeDirectAssetBodyV1(body, maxBytes);
        if (!bytes) throw Error("DIRECT_ARCHIVE_BODY_INVALID");
        const blob = new Blob([bytes], {type: body.mime});
        if (temporaryBodies) {
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          if ([...digest].map(byte => byte.toString(16).padStart(2, "0")).join("") !== body.sha256)
            throw Error("DIRECT_ARCHIVE_BODY_HASH_INVALID");
          temporaryBodies.set("files/" + body.sha256, blob);
        } else await store.putBody(state.runId, body.sha256, blob, {mime: body.mime, kind});
        body.archivePath = "files/" + body.sha256;
        if (body.receipt?.bodyFormat === "ORIGINAL_BINARY_BYTES_BASE64") {
          body.receipt = {...body.receipt,
            originalBodyFormat: body.receipt.bodyFormat,
            bodyFormat: "ORIGINAL_BINARY_BYTES_ARCHIVE"};
        }
        delete body.base64;
        // The byte view is for the current item's verification only; it is
        // never serialized or cloned into the metadata checkpoint.
        if (Object.prototype.hasOwnProperty.call(body, "bytes")) delete body.bytes;
        changed = true;
      }
      for (const detail of fp.payload?.assetDetails || []) {
        const asset = fp.payload.directAssetEvidence?.assets?.find(value => value.assetId === detail.assetId),
          binding = asset && directAssetMetadataBindingV1(asset.metadata, detail.assetId);
        if (detail.bodyVerified === true && binding?.name && detail.name !== binding.name) {
          detail.referenceName = detail.referenceName || detail.name || "";
          detail.name = binding.name;
          changed = true;
        }
      }
      return changed;
    }
    async function persist(fp, processed) {
      await archiveItemBodies(fp);
      const json = JSON.stringify(fp),
        size = encoder.encode(json).byteLength;
      const total =
        [...retainedSizes.entries()].reduce(
          (sum, [id, bytes]) => sum + (id === fp.id ? 0 : bytes),
          0,
        ) + size;
      if (total > CTI_DIRECT_DATA_EXPORT_BYTES_V1 - metadataReserveBytes)
        throw Error("DIRECT_CAPTURE_EXPORT_BYTE_LIMIT");
      await store.putItem(state.runId, fp.id, fp, {
        processed,
        draftHash:
          fp.payload.directDataSources?.receipts?.stability?.draftHash || "",
      });
      summarizeItem(fp, processed, size);
      await saveRun("RUNNING");
      render();
    }
    async function captureAssessment(fp, bound) {
      const parts = directDraftAssessmentInventoryV1(bound),
        groups = [],
        definitions = new Map(),
        questions = [],
        failures = [];
      if (parts.declared > CTI_DIRECT_DATA_MAX_PARTS_V1) {
        directUnsupportedContractV1(fp, "DIRECT_ASSESSMENT_PART_LIMIT", bound);
        return;
      }
      fp.payload.assessmentApiEvidence = {
        method: "BOUND_AUTHORING_DRAFT_API",
        courseId,
        itemId: fp.id,
        assignmentId: bound.atomId,
        inventory: parts.candidates,
        rawParts: parts.rawParts,
        unsupportedParts: parts.unsupportedParts,
        groups,
        questionDefinitions: [],
        receipts: [],
        groupStability: [],
        failures,
      };
      const evidence = fp.payload.assessmentApiEvidence;
      async function readCandidate(candidate) {
        if (reader.snapshot().stopped) return;
        const currentGroupRead = await reader.readGroup(candidate.id);
        if (!currentGroupRead.ok) {
          failures.push({ id: candidate.id, reason: currentGroupRead.reason });
          return;
        }
        // An interrupted run already retained the mutable group observation.
        // One current GET can certify it unchanged; changed groups use two
        // current observations and their current exact versioned definition.
        const cachedGroup = meta.directDataCapture.resumed
          ? await store.getGroup(state.runId, fp.id, candidate.id)
          : null;
        const reusableGroup = Boolean(
          cachedGroup?.value?.data?.elements?.length === 1 &&
            cachedGroup.value.data.elements[0]?.id === candidate.id &&
            directReceiptSourceValidV1(
              cachedGroup.value.receipt,
              "authoringAssignmentQuestionGroups.v1",
              candidate.id,
            ) &&
            (await hash(cachedGroup.value.data.elements[0])) ===
              (await hash(currentGroupRead.data.elements[0])),
        );
        const groupRead = reusableGroup
          ? { ...cachedGroup.value, ok: true }
          : currentGroupRead;
        if (!groupRead.ok) {
          failures.push({ id: candidate.id, reason: groupRead.reason });
          return;
        }
        const group = groupRead.data.elements[0];
        groups.push(group);
        evidence.receipts.push(receipt(groupRead, candidate.id));
        await store.putGroup(state.runId, fp.id, candidate.id, {
          data: currentGroupRead.data,
          receipt: receipt(currentGroupRead, candidate.id),
        });
        if (
          !Array.isArray(group.questions) ||
          group.questions.length !== 1 ||
          !new RegExp("^" + bound.atomId + "~[A-Za-z0-9_-]+@\\d+$").test(
            group.questions[0] || "",
          )
        ) {
          failures.push({
            id: candidate.id,
            reason: "DIRECT_GROUP_VARIANTS_OR_REFERENCE_UNSUPPORTED",
          });
          return;
        }
        const definitionId = group.questions[0];
        let definitionRead = null;
        const cached = await store.getDefinition(state.runId, definitionId);
        if (
          cached?.value?.modelHash &&
          cached.value.data?.elements?.length === 1 &&
          cached.value.data.elements[0]?.id === definitionId &&
          (await hash(cached.value.data)) === cached.value.modelHash
        )
          definitionRead = { ...cached.value, ok: true };
        if (!definitionRead) {
          definitionRead = await reader.readDefinition(definitionId);
          if (!definitionRead.ok) {
            failures.push({ id: definitionId, reason: definitionRead.reason });
            return;
          }
          await store.putDefinition(state.runId, definitionId, {
            data: definitionRead.data,
            receipt: receipt(definitionRead, definitionId),
            modelHash: await hash(definitionRead.data),
          });
        }
        const raw = definitionRead.data.elements[0];
        definitions.set(raw.id, raw);
        evidence.receipts.push(receipt(definitionRead, definitionId));
        let parsed = null;
        // The existing MCQ parser reads HTML text. Reject media/resource tags
        // first so parsing cannot trigger a browser request or certify lost media.
        const rawText = JSON.stringify(raw);
        if (
          !/<\s*(?:img|iframe|frame|object|embed|script|link|source|video|audio)\b/i.test(
            rawText,
          )
        ) {
          const native = raw.definition?.definition;
          const fields = [
            native?.prompt,
            ...(native?.options || []).flatMap((option) => [
              option.display,
              option.feedback,
            ]),
          ].filter(Boolean);
          const safe = fields.every(
            (field) =>
              field?.typeName === "cml" &&
              directCmlTextV1(field.definition?.value)?.references.length === 0,
          );
          if (safe)
            parsed =
              raw.definition?.typeName === "mcq"
                ? parseCourseraMcqDefinitionV61524(raw, candidate)
                : raw.definition?.typeName === "checkbox"
                  ? parseCourseraCheckboxDefinitionDirectV1(raw, candidate)
                  : null;
        }
        const projection = parsed && directAssessmentQuestionProjectionV1(raw);
        if (projection) Object.assign(parsed, projection);
        else parsed = null;
        const refreshedGroupRead = reusableGroup
          ? currentGroupRead
          : await reader.readGroup(candidate.id);
        const refreshedGroup = refreshedGroupRead.ok
          ? refreshedGroupRead.data.elements[0]
          : null;
        const groupStable = Boolean(
          refreshedGroup &&
            (await hash(refreshedGroup)) === (await hash(group)),
        );
        evidence.groupStability.push({
          id: candidate.id,
          stable: groupStable,
          group: refreshedGroup,
          receipt: receipt(refreshedGroupRead, candidate.id),
        });
        if (!groupStable)
          failures.push({
            id: candidate.id,
            reason:
              refreshedGroupRead.reason ||
              "DIRECT_GROUP_CHANGED_DURING_CAPTURE",
          });
        if (!parsed)
          failures.push({
            id: definitionId,
            reason: "DIRECT_QUESTION_MODEL_OR_MEDIA_UNSUPPORTED",
          });
        else if (groupStable) {
          parsed.observationMethod =
            "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION";
          questions.push(parsed);
        }
        state.phase = "Reading assessment data";
        render(
          fp.name +
            " · " +
            questions.length +
            "/" +
            parts.declared +
            " questions read",
        );
      }
      // A bounded worker count shares the transport pool used for every read.
      // No thousands-of-promises queue or per-question browser rendering.
      let next = 0;
      const work = await Promise.allSettled(
        Array.from(
          { length: Math.min(4, reader.snapshot().limits.concurrentRequests) },
          (_, index) => index,
        ).map(async () => {
          try {
            while (next < parts.candidates.length && !reader.snapshot().stopped)
              await readCandidate(parts.candidates[next++]);
          } catch (error) {
            reader.abort("DIRECT_CHECKPOINT_STORAGE_FAILED");
            throw error;
          }
        }),
      );
      const failed = work.find((value) => value.status === "rejected");
      if (failed) throw failed.reason;
      groups.sort(
        (a, b) =>
          parts.candidates.findIndex((candidate) => candidate.id === a.id) -
          parts.candidates.findIndex((candidate) => candidate.id === b.id),
      );
      questions.sort((a, b) => Number(a.id) - Number(b.id));
      evidence.questionDefinitions = [...definitions.values()];
      const coverage = assessmentCaptureCoverageV613(
        questions,
        parts.declared,
        "AUTHORING_API",
        { declaredContentParts: parts.declared },
      );
      fp.payload.structuredAssessment = {
        schemaVersion: 6,
        parser: "coursera-bound-authoring-draft-api-v1",
        origin: "coursera-authoring-api",
        declaredQuestionCount: parts.declared,
        questionCount: questions.length,
        answerEvidenceQuestionCount: questions.length,
        questions,
        captureCompleteness: coverage,
        parserConfidence: coverage.requiredAnswerCoverageComplete ? 0.98 : 0.84,
        configuration: parts.configuration,
        introduction: parts.introduction,
        reviewCriteria: parts.reviewCriteria,
        passingFraction: parts.passingFraction,
        assignmentLevelRubrics: parts.assignmentLevelRubrics,
        warnings: failures.map((value) => value.reason),
      };
      fp.payload.directAssessmentInventory = parts;
      directAssessmentContractV1(
        fp,
        fp.payload.structuredAssessment,
        parts,
        bound,
      );
    }
    function boundCmlSource(bound) {
      return bound.draft.content.typeName === "supplementDraft"
        ? directDraftReadingSourceV1(bound)
        : directDraftDiscussionSourceV1(bound);
    }
    function retainedCmlMedia(fp, previous, source) {
      if (
        previous?.id !== fp.id ||
        previous?.atomId !== fp.atomId ||
        !previous.payload?.directDataSources
      )
        return null;
      try {
        const bound = bindDirectAuthoringDraftV1(
            fp,
            courseId,
            slug,
            previous.payload.directDataSources.atom,
            previous.payload.directDataSources.relation,
          ),
          reading = boundCmlSource(bound);
        if (
          !source?.cml ||
          reading.cml !== source.cml ||
          reading.dtdId !== source.dtdId ||
          reading.assetId !== source.assetId ||
          (reading.rawDefinition &&
            directCanonicalSourceTextV1(reading.rawDefinition) !==
              directCanonicalSourceTextV1(source.rawDefinition))
        )
          return null;
        return {
          assets: (previous.payload.directAssetEvidence?.assets || []).map(
            (asset) =>
              asset.reason && asset.retainedEvidence?.body
                ? asset.retainedEvidence
                : asset.body
                  ? asset
                  : asset.retainedEvidence?.body
                    ? asset.retainedEvidence
                    : asset,
          ),
        };
      } catch (_) {
        return null;
      }
    }
    function ensureMediaReader() {
      if (!mediaReader)
        mediaReader = createDirectDataMediaReaderV1({
          providerTransport,
          archiveMode: true,
          apiReader: reader,
          assertCurrent: assertContext,
          limits: {
            totalBytes: Math.max(0, CTI_DIRECT_DATA_MEDIA_BYTES_V1 - mediaBase.bytes),
            durationMs: Math.max(1, remainingLimits().durationMs - (reader?.snapshot().elapsedMs || 0)),
          },
          onStats: () => { render(); checkpointBudget(); },
        });
      return mediaReader;
    }
    async function captureCmlMedia(fp, source, previous) {
      const parsed = directCmlTextV1(source.cml);
      if (!parsed || !parsed.references.length) return;
      const refs = parsed.references,
        ids = [
          ...new Set(
            refs
              .map((ref) => ref.id)
              .filter((id) => /^[A-Za-z0-9_-]{22}$/.test(id || "")),
          ),
        ],
        retained = retainedCmlMedia(fp, previous, source),
        assets = [],
        failures = [];
      fp.payload.directAssetEvidence = {
        method: "BOUND_CML_ASSET_METADATA_AND_BODY",
        assets,
        missingPointers: refs.filter((ref) => !ref.id && !ref.url),
        failures,
      };
      if (!ids.length) return;
      ensureMediaReader();
      for (const id of ids) {
        if (reader.snapshot().stopped || !assertContext()) break;
        state.phase = "Reading referenced media";
        render(fp.name + " · Reading the original referenced file.");
        const retainedAsset = retained?.assets.find(
            (asset) => asset.assetId === id,
          ),
          retainedBytes = assets.reduce((sum, asset) => sum + (asset.body?.size || 0), 0),
          // Bound the originals held for one content item independently of the
          // course archive. Remaining source references remain explicit gaps.
          asset = retainedBytes >= 64 * 1024 * 1024
            ? {assetId: id, reason: "DIRECT_READING_MEDIA_BYTE_LIMIT"}
            : await mediaReader.capture(id, retainedAsset, {bodyBytes: 64 * 1024 * 1024 - retainedBytes});
        // Failed current metadata never certifies a historical body. Keep
        // the original proof separately so a later bound read can retry its
        // metadata without losing or downloading the same bytes again.
        if (asset.reason && retainedAsset?.body)
          asset.retainedEvidence = retainedAsset;
        assets.push(asset);
        if (asset.reason) failures.push({ id, reason: asset.reason });
      }
    }
    async function capturePanoptoProviders(fp, binding, targets, previous) {
      const urls = [...new Set(targets.map(target => target.url))]
        .filter(url => directPanoptoAutomaticTargetV1(url));
      if (!urls.length) return;
      const evidence = {method: "BOUND_WIDGET_PANOPTO_DELIVERY", ...binding,
        deliveries: [], wholeWidgetVerified: false, playbackVerified: false,
        launchVerified: false, originalUploadVerified: false};
      fp.payload.directPanoptoEvidence = evidence;
      for (const targetUrl of urls) {
        const delivery = {targetUrl, initial: null, final: null,
          stableSource: false, podcasts: [], failures: []};
        const retained = previous?.payload?.directPanoptoEvidence?.deliveries?.find(value => value.targetUrl === targetUrl);
        const previousFailures = [...(retained?.previousFailures || []), ...(retained?.failures || [])];
        if (previousFailures.length) {
          delivery.previousFailures = structuredClone(previousFailures.slice(-32));
          delivery.previousFailuresTruncated = previousFailures.length > 32 || retained.previousFailuresTruncated === true;
        }
        const retainOriginals = () => {
          for (const old of retained?.podcasts || []) {
            const proof = old.body && retained.stableSource === true && retained.initial && retained.final
              ? {targetUrl, initial: retained.initial, final: retained.final, stableSource: true, podcast: old}
              : old.retainedEvidence;
            if (!proof?.podcast?.body) continue;
            const original = proof.podcast;
            let current = delivery.podcasts.find(value => value.streamFileId === original.streamFileId);
            if (current?.body) continue;
            if (!current) {
              current = {...original, body: undefined, reason: "DIRECT_PANOPTO_PREVIOUS_BODY_ONLY"};
              delete current.retainedEvidence;
              delivery.podcasts.push(current);
            }
            current.retainedEvidence = proof;
          }
        };
        evidence.deliveries.push(delivery);
        state.phase = "Reading Panopto content";
        render(fp.name + " · Reading the configured video source.");
        const initial = await reader.readPanoptoDeliveryInfo(targetUrl);
        if (!initial.ok) {
          delivery.failures.push({reason: initial.reason || "DIRECT_PANOPTO_METADATA_FAILED",
            receipt: initial.receipt ? receipt(initial, directPanoptoAutomaticTargetV1(targetUrl).deliveryPublicId) : null});
          retainOriginals();
          continue;
        }
        try {
          const target = directPanoptoAutomaticTargetV1(targetUrl);
          delivery.initial = {model: initial.data, receipt: receipt(initial, target.deliveryPublicId),
            modelHash: await hash(initial.data),
            sourceHash: await hash(directPanoptoSourceV1(targetUrl, initial.data))};
          const cached = panoptoSources.get(targetUrl);
          for (const candidate of directPanoptoPodcastBindingsV1(initial.data, targetUrl)) {
            const reused = cached?.stableSource === true &&
              cached.initial.sourceHash === delivery.initial.sourceHash &&
              cached.podcasts.find(podcast => podcast.body &&
                podcast.streamFileId === candidate.streamFileId &&
                podcast.streamPublicId === candidate.streamPublicId &&
                podcast.canonicalUrl === candidate.canonicalUrl);
            let podcast;
            if (reused) {
              // This cache lasts one attempt only. Later attempts GET the media
              // again: an unchanged URL does not prove unchanged remote bytes.
              podcast = structuredClone(reused);
              await hydrateItemBodies({payload: {directPanoptoEvidence: {deliveries: [{podcasts: [podcast]}]}}});
            } else podcast = await ensureMediaReader().capturePanoptoPodcast(initial, candidate.streamFileId, null);
            delivery.podcasts.push(podcast);
            if (podcast.reason) delivery.failures.push({streamFileId: candidate.streamFileId, reason: podcast.reason,
              ...(podcast.receipt ? {receipt: podcast.receipt} : {})});
          }
          const final = await reader.readPanoptoDeliveryInfo(targetUrl);
          if (!final.ok) delivery.failures.push({reason: final.reason || "DIRECT_PANOPTO_FINAL_READ_FAILED",
            receipt: final.receipt ? receipt(final, target.deliveryPublicId) : null});
          else {
            delivery.final = {model: final.data, receipt: receipt(final, target.deliveryPublicId),
              modelHash: await hash(final.data),
              sourceHash: await hash(directPanoptoSourceV1(targetUrl, final.data))};
            delivery.stableSource = delivery.initial.sourceHash === delivery.final.sourceHash;
            if (!delivery.stableSource) delivery.failures.push({reason: "DIRECT_PANOPTO_SOURCE_CHANGED"});
          }
        } catch (error) {
          delivery.failures.push({reason: /^[A-Z0-9_]{1,96}$/.test(error?.message || "")
            ? error.message : "DIRECT_PANOPTO_SOURCE_UNSUPPORTED"});
        }
        retainOriginals();
      }
    }
    async function captureWidgetProvider(fp, bound, previous) {
      let binding;
      try { binding = directDraftWidgetProviderV1(bound); }
      catch (_) {
        // An unknown widget model supplies no provider selector. Preserve the
        // normal final atom check without guessing a provider or finder query.
        directUnsupportedContractV1(fp, "DIRECT_WIDGET_PROVIDER_BINDING_FAILED", bound);
        return;
      }
      const evidence = {
          method: "BOUND_AUTHORING_WIDGET_PROVIDER", ...binding,
          initial: null, final: null, stableSource: false, targets: [],
          bodyVerified: false, playbackVerified: false,
          launchVerified: false, wholeWidgetVerified: false,
        };
      fp.payload.directWidgetProviderEvidence = evidence;
      // Provider configuration can change independently of the owning atom.
      // Keep two current reads as well as the item's final atom stability read.
      const initial = await reader.readWidgetProvider(binding.providerId, courseId);
      evidence.initial = {model: initial.data, receipt: receipt(initial, binding.providerId), sourceHash: ""};
      const initialSource = directWidgetProviderSourceV1(bound, requireRead(initial));
      evidence.initial.sourceHash = await hash(initialSource);
      evidence.targets = directWidgetProviderTargetsV1(bound, initial.data);
      await capturePanoptoProviders(fp, binding, evidence.targets, previous);
      const final = await reader.readWidgetProvider(binding.providerId, courseId);
      evidence.final = {model: final.data, receipt: receipt(final, binding.providerId), sourceHash: ""};
      evidence.final.sourceHash = await hash(directWidgetProviderSourceV1(bound, requireRead(final)));
      evidence.stableSource = evidence.initial.sourceHash === evidence.final.sourceHash;
    }
    async function captureInlineWidgetProviders(fp, bound, previous) {
      delete fp.payload.directInlineWidgetProviderEvidence;
      const bindings = directInlineWidgetBindingsV1(fp, bound);
      if (!bindings.length) return;
      const evidence = {
        method: "BOUND_INLINE_CML_WIDGET_PROVIDERS", courseId, itemId: fp.id,
        atomId: bound.atomId, sourceState: "AUTHORING_DRAFT", providers: [], failures: [],
        bodyVerified: false, playbackVerified: false, launchVerified: false, wholeWidgetVerified: false,
      };
      fp.payload.directInlineWidgetProviderEvidence = evidence;
      for (const binding of bindings) {
        const provider = { ...binding, initial: null, final: null, stableSource: false,
          targets: [], failures: [], bodyVerified: false, playbackVerified: false,
          launchVerified: false, wholeWidgetVerified: false };
        evidence.providers.push(provider);
        try {
          const key = courseId + "~" + binding.providerId;
          if (!inlineWidgetSources.has(key)) {
            if (inlineWidgetSources.size >= 64) throw Error("DIRECT_INLINE_WIDGET_PROVIDER_LIMIT");
            // Cache only current observation pairs. Each placement rebinds its
            // own targets and source identity; no previous-attempt proof is reused.
            inlineWidgetSources.set(key, (async () => ({
              initial: await reader.readWidgetProvider(binding.providerId, courseId),
              final: await reader.readWidgetProvider(binding.providerId, courseId),
            }))());
          }
          const reads = await inlineWidgetSources.get(key);
          for (const stage of ["initial", "final"])
            provider[stage] = { model: reads[stage].data, receipt: receipt(reads[stage], binding.providerId),
              sourceHash: "", modelHash: "" };
          for (const stage of ["initial", "final"]) {
            const read = reads[stage];
            requireRead(read);
            if (!directWidgetProviderReceiptValidV1(provider[stage].receipt, binding))
              throw Error("DIRECT_INLINE_WIDGET_PROVIDER_RECEIPT_INVALID");
            provider[stage].modelHash = await hash(read.data);
            provider[stage].sourceHash = await hash(directInlineWidgetProviderSourceV1(binding, read.data));
          }
          provider.targets = directInlineWidgetProviderTargetsV1(binding, reads.initial.data);
          provider.stableSource = provider.initial.sourceHash === provider.final.sourceHash &&
            provider.initial.modelHash === provider.final.modelHash;
          if (!provider.stableSource) throw Error("DIRECT_INLINE_WIDGET_PROVIDER_SOURCE_CHANGED");
        } catch (error) {
          provider.failures.push({ reason: /^[A-Z0-9_]{1,96}$/.test(error?.message || "")
            ? error.message : "DIRECT_INLINE_WIDGET_PROVIDER_CAPTURE_FAILED" });
        }
      }
      // Replace this item's old allocation only after current native selectors
      // are known. Reserve every matching historical page before reading any
      // new bodies, so a failed refresh can keep its exact prior observation.
      publicPageStats.retainedUtf8Bytes -= publicPageRetainedByItem.get(fp.id) || 0;
      for (const provider of evidence.providers)
        if (provider.stableSource) {
          await prepareInlinePublicPages(provider, previous);
          await prepareInlinePublicPages(provider, previous, true);
        }
      for (const provider of evidence.providers)
        if (provider.stableSource) {
          await captureInlinePublisherPages(fp, provider);
          await captureInlinePublicPages(fp, provider);
        }
    }
    async function prepareInlinePublicPages(provider, previous, publisher = false) {
      const collection = publisher ? "publisherPages" : "publicPages";
      provider[collection] = [];
      const targets = new Map();
      for (const target of provider.targets) {
        if (publisher && !directPublisherTargetV1(target.url)) continue;
        if (!targets.has(target.url)) targets.set(target.url, []);
        const fields = targets.get(target.url);
        if (!fields.includes(target.sourceField)) fields.push(target.sourceField);
      }
      for (const [targetUrl, sourceFields] of targets) {
        const page = { targetUrl, sourceFields, observation: null, failures: [] };
        provider[collection].push(page);
        const prior = previous?.payload?.directInlineWidgetProviderEvidence?.providers?.filter(
          value => value.providerId === provider.providerId && value.courseId === provider.courseId &&
            value.itemId === provider.itemId && value.atomId === provider.atomId);
        const pages = prior?.length === 1 ? prior[0][collection]?.filter(value => value.targetUrl === targetUrl) : [];
        if (pages?.length !== 1) continue;
        const candidates = [pages[0].observation, pages[0].retainedObservation]
          .filter(value => publisher ? directPublisherResourceObservationValidV1(value, targetUrl) : directPublicPageObservationValidV1(value, targetUrl))
          .sort((a, b) => Date.parse(b.model.observedAt) - Date.parse(a.model.observedAt));
        for (const observation of candidates) {
          if (!publisher && (await hash(observation.model) !== observation.receipt.originalResponseSha256 ||
              encoder.encode(directCanonicalSourceTextV1(observation.model)).byteLength !== observation.receipt.bytes)
            ) continue;
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(publisher ? observation.model.rawJson : observation.model.html))),
            byte => byte.toString(16).padStart(2, "0")).join("");
          if (digest !== observation.model.sha256) continue;
          if (publicPageStats.retainedUtf8Bytes + observation.model.bytes > CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1)
            throw Error("DIRECT_PUBLIC_PAGE_RETAINED_LIMIT");
          page.retainedObservation = observation;
          publicPageStats.retainedUtf8Bytes += observation.model.bytes;
          if (publisher && pages[0].media && directPublisherMediaStructureV1(observation,targetUrl,pages[0].media)) {
            const media = pages[0].media;
            let historyBytes = 0, valid = true;
            for (const group of media.retained || []) {
              const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(group.observation.model.rawJson))),
                byte => byte.toString(16).padStart(2,"0")).join("");
              if (actual !== group.observation.model.sha256) valid = false;
              historyBytes += group.observation.model.bytes;
            }
            if (!valid) throw Error("PUBLISHER_IMAGE_HISTORY_SOURCE_INVALID");
            if (publicPageStats.retainedUtf8Bytes + historyBytes > CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1)
              throw Error("DIRECT_PUBLISHER_RETAINED_LIMIT");
            publicPageStats.retainedUtf8Bytes += historyBytes;
            page.media = media;
            Object.defineProperty(page,"previousMedia",{value:{observation,media},configurable:true});
          }
          break;
        }
      }
    }
    function claimExternalSource(targetUrl) {
      if (!externalSourceTargets.has(targetUrl) && externalSourceTargets.size >= 64)
        throw Error("DIRECT_EXTERNAL_SOURCE_TARGET_LIMIT");
      externalSourceTargets.add(targetUrl);
    }
    async function captureInlinePublisherPages(fp, provider) {
      for (const page of provider.publisherPages) {
        let attemptedRead = null;
        try {
          claimExternalSource(page.targetUrl);
          if (!publisherPageSources.has(page.targetUrl)) {
            publisherPageStats.readerOperations++;
            publisherPageSources.set(page.targetUrl, (async () => {
              const read = await reader.readPublisherPage(page.targetUrl, { itemId: fp.id, providerId: provider.providerId });
              publisherPageStats.observedBytes += Number(read.receipt?.bytes || 0);
              checkpointBudget(); return read;
            })());
          }
          const read = await publisherPageSources.get(page.targetUrl);
          attemptedRead = read; requireRead(read);
          if (!directPublisherResourceObservationValidV1({ model: read.data, receipt: read.receipt }, page.targetUrl))
            throw Error("DIRECT_PUBLISHER_SOURCE_INVALID");
          const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(read.data.rawJson))),
            byte => byte.toString(16).padStart(2, "0")).join("");
          if (actual !== read.data.sha256) throw Error("DIRECT_PUBLISHER_HASH_INVALID");
          const previousBytes = page.retainedObservation?.model?.bytes || 0;
          if (publicPageStats.retainedUtf8Bytes - previousBytes + read.data.bytes > CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1)
            throw Error("DIRECT_PUBLISHER_RETAINED_LIMIT");
          publicPageStats.retainedUtf8Bytes += read.data.bytes - previousBytes;
          page.observation = { model: read.data, receipt: read.receipt };
          delete page.retainedObservation;
          await capturePublisherImages(fp, page);
        } catch (error) {
          const retainedReceipt = retainPublisherFailureReceipt(attemptedRead, page.targetUrl);
          page.failures.push({ reason: /^[A-Z0-9_]{1,96}$/.test(error?.message || "") ? error.message : "DIRECT_PUBLISHER_CAPTURE_FAILED",
            ...(retainedReceipt ? { receipt: retainedReceipt } : {}) });
        }
      }
    }
    async function capturePublisherImages(fp, page) {
      const before = publicPageStats.retainedUtf8Bytes, current = page.observation;
      try { await collectPublisherImages(fp,page); }
      catch (error) {
        const reason = /^[A-Z0-9_]{1,96}$/.test(error?.message || "") ? error.message : "PUBLISHER_IMAGE_CAPTURE_FAILED";
        if (page.previousMedia && page.observation &&
            !directPublisherMediaStructureV1(page.observation,page.targetUrl,page.media)) {
          const previous = page.previousMedia;
          page.observation = null; page.retainedObservation = previous.observation; page.media = previous.media;
          publicPageStats.retainedUtf8Bytes = before + previous.observation.model.bytes - current.model.bytes;
        } else if (!page.previousMedia && page.media &&
            !directPublisherMediaStructureV1(page.observation,page.targetUrl,page.media)) delete page.media;
        if (!page.observation && page.retainedObservation) page.failures.push({reason});
        else page.mediaFailures = [{reason}];
      }
    }
    async function collectPublisherImages(fp, page) {
      const observation = page.observation, inventory = directPublisherMediaInventoryV1(observation,page.targetUrl),
        previous = page.previousMedia;
      if (!inventory) throw Error("PUBLISHER_IMAGE_INVENTORY_UNSUPPORTED");
      const groups = new Map();
      for (const group of previous?.media.retained || []) groups.set(group.observation.model.sha256,
        {observation:group.observation,resources:group.resources.map(resource => ({...resource}))});
      if (previous) {
        const successful = previous.media.resources.filter(resource => resource.body);
        if (successful.length) {
          const key = previous.observation.model.sha256;
          if (!groups.has(key)) groups.set(key,{observation:previous.observation,resources:[]});
          const group = groups.get(key);
          for (const resource of successful)
            if (!group.resources.some(value => value.url === resource.url && value.body.sha256 === resource.body.sha256))
              group.resources.push({...resource});
        }
      }
      const oldHistoryBytes = (previous?.media.retained || []).reduce((sum,group) => sum + group.observation.model.bytes,0),
        historyBytes = [...groups.values()].reduce((sum,group) => sum + group.observation.model.bytes,0);
      if ([...groups.values()].reduce((sum,group) => sum + group.resources.length,0) > 128 ||
          publicPageStats.retainedUtf8Bytes - oldHistoryBytes + historyBytes > CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1) {
        if (previous) {
          publicPageStats.retainedUtf8Bytes += previous.observation.model.bytes - observation.model.bytes;
          page.observation = null; page.retainedObservation = previous.observation; page.media = previous.media;
        }
        throw Error("PUBLISHER_IMAGE_HISTORY_LIMIT");
      }
      const media = {...inventory,resources:[]};
      page.media = media;
      let count = 0;
      for (const provider of fp.payload.directInlineWidgetProviderEvidence?.providers || [])
        for (const sibling of provider.publisherPages || []) if (sibling !== page) count += sibling.media?.resources?.length || 0;
      const withinItem = count + inventory.resources.length <= 256;
      for (const resource of inventory.resources) {
        const withinCourse = publisherImageTargets.has(resource.url) || publisherImageTargets.size < 1024;
        if (withinCourse) publisherImageTargets.add(resource.url);
        const read = withinItem && withinCourse ? await ensureMediaReader().readPublisherImage(observation,page.targetUrl,resource)
          : {reason:withinItem ? "PUBLISHER_IMAGE_COURSE_URL_LIMIT" : "PUBLISHER_IMAGE_ITEM_URL_LIMIT"};
        media.resources.push({...resource,...(read.body ? {body:read.body} : {reason:read.reason || "PUBLISHER_IMAGE_CAPTURE_FAILED"})});
        if (read.body) {
          if (!directPublisherImageBodyStructureV1(read.body,resource.url,observation.model.sha256))
            throw Error("PUBLISHER_IMAGE_EVIDENCE_INVALID");
          // Private immutable Blob staging bounds memory. The final native
          // ownership check alone decides which descriptors enter the item
          // proof and exported archive; an unreferenced Blob is not evidence.
          await archiveItemBodies(fp);
        }
        checkpointBudget();
      }
      // Freshly observed matching bytes supersede the duplicate historical
      // descriptor only when its exact publisher source hash also matches.
      const same = groups.get(observation.model.sha256);
      if (same) {
        same.resources = same.resources.filter(old => !media.resources.some(fresh => fresh.url === old.url && fresh.body?.sha256 === old.body.sha256));
        if (!same.resources.length) groups.delete(observation.model.sha256);
      }
      const retained = [...groups.values()];
      if (retained.length) media.retained = retained;
      publicPageStats.retainedUtf8Bytes += retained.reduce((sum,group) => sum + group.observation.model.bytes,0) - oldHistoryBytes;
      if (!directPublisherMediaStructureV1(observation,page.targetUrl,media)) throw Error("PUBLISHER_IMAGE_EVIDENCE_INVALID");
      if (Object.hasOwn(page,"previousMedia")) delete page.previousMedia;
    }
    async function captureInlinePublicPages(fp, provider) {
      for (const page of provider.publicPages) {
        const targetUrl = page.targetUrl;
        let attemptedRead = null;
        try {
          if (provider.publisherPages?.some(value => value.targetUrl === targetUrl && value.observation && !value.failures.length))
            throw Error("PUBLIC_HTML_NOT_READ_PUBLISHER_API_SELECTED");
          if (!directPublicPageTargetV1(targetUrl)) throw Error("DIRECT_PUBLIC_PAGE_TARGET_UNSUPPORTED");
          if (!publicPageSources.has(targetUrl)) {
            claimExternalSource(targetUrl);
            if (publicPageStats.observedEnvelopeBytes + CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1 > 16 * 1024 * 1024)
              throw Error("DIRECT_PUBLIC_PAGE_ATTEMPT_LIMIT");
            publicPageStats.readerOperations++;
            publicPageSources.set(targetUrl, (async () => {
              const read = await reader.readPublicPage(targetUrl, { itemId: fp.id, providerId: provider.providerId });
              publicPageStats.observedEnvelopeBytes += Number(read.receipt?.bytes || 0);
              checkpointBudget();
              return read;
            })());
          }
          const read = await publicPageSources.get(targetUrl);
          attemptedRead = read;
          requireRead(read);
          if (!directPublicPageObservationValidV1({ model: read.data, receipt: read.receipt }, targetUrl))
            throw Error("DIRECT_PUBLIC_PAGE_SOURCE_INVALID");
          if (await hash(read.data) !== read.receipt.originalResponseSha256 ||
              encoder.encode(directCanonicalSourceTextV1(read.data)).byteLength !== read.receipt.bytes)
            throw Error("DIRECT_PUBLIC_PAGE_ENVELOPE_HASH_INVALID");
          const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(read.data.html))),
            byte => byte.toString(16).padStart(2, "0")).join("");
          if (actual !== read.data.sha256) throw Error("DIRECT_PUBLIC_PAGE_HASH_INVALID");
          const previousBytes = page.retainedObservation?.model?.bytes || 0;
          if (publicPageStats.retainedUtf8Bytes - previousBytes + read.data.bytes > CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1)
            throw Error("DIRECT_PUBLIC_PAGE_RETAINED_LIMIT");
          publicPageStats.retainedUtf8Bytes += read.data.bytes - previousBytes;
          page.observation = { model: read.data, receipt: read.receipt };
          delete page.retainedObservation;
        } catch (error) {
          const retainedReceipt = retainPublicFailureReceipt(attemptedRead, targetUrl);
          page.failures.push({ reason: /^[A-Z0-9_]{1,96}$/.test(error?.message || "")
            ? error.message : "DIRECT_PUBLIC_PAGE_CAPTURE_FAILED",
            ...(retainedReceipt ? { receipt: retainedReceipt } : {}) });
        }
      }
    }
    function retainedPublicPageBytes(fp) {
      let bytes = 0;
      for (const evidence of [fp.payload?.directInlineWidgetProviderEvidence, fp.payload?.directInlineWidgetProviderAttempt])
        for (const provider of evidence?.providers || [])
          for (const page of [...(provider.publicPages || []), ...(provider.publisherPages || [])])
            for (const observation of [page.observation, page.retainedObservation,...(page.media?.retained || []).map(group => group.observation)])
              if (typeof observation?.model?.html === "string" || typeof observation?.model?.rawJson === "string")
                bytes += encoder.encode(observation.model.rawJson ?? observation.model.html).byteLength;
      return bytes;
    }
    async function captureItem(fp) {
      const source = inventory.leaves.get(fp.id);
      if (source.structural) {
        fp.payload.directDataSources = {
          materials: {
            rootCourseId: courseId,
            leaf: source.node,
            ancestorIds: source.ancestorIds,
          },
          receipts: {
            materials: meta.directDataCapture.materialsReceipt,
            stability: { stable: false },
          },
        };
        applyDirectContractV1(fp, "UNRESOLVED_DIRECT_STRUCTURE", false, [
          "MATERIAL_STABILITY_NOT_CHECKED",
        ]);
        await persist(fp, true);
        return;
      }
      const previousRow = itemStates.has(fp.id)
        ? await store.getItem(state.runId, fp.id)
        : null;
      const previous =
        previousRow?.fingerprint?.id === fp.id &&
        previousRow.fingerprint.atomId === fp.atomId
          ? previousRow.fingerprint
          : null;
      const priorPublisherOriginals = previous?.payload?.directInlineWidgetProviderEvidence?.providers?.some(provider =>
        provider.publisherPages?.some(page => page.media?.resources?.some(resource => resource.body) ||
          page.media?.retained?.some(group => group.resources?.some(resource => resource.body))));
      const previousPublicBytes = publicPageRetainedByItem.get(fp.id) || 0,
        publicBytesBefore = publicPageStats.retainedUtf8Bytes;
      if (previous) await hydrateItemBodies(previous, true);
      state.phase = "Reading item data";
      render(fp.name);
      const [atomRead, relationRead] = await Promise.all([
        reader.readAtom(fp.atomId),
        reader.readRelation(fp.atomId),
      ]);
      fp.payload.directDataSources = {
        atom: atomRead.data,
        relation: relationRead.data,
        receipts: {
          atom: receipt(atomRead, fp.atomId),
          relation: receipt(relationRead, fp.atomId),
          stability: { stable: false },
        },
      };
      let bound = null,
        processed = true;
      try {
        requireRead(atomRead);
        requireRead(relationRead);
        bound = bindDirectAuthoringDraftV1(
          fp,
          courseId,
          slug,
          atomRead.data,
          relationRead.data,
        );
        const draftHash = await hash(bound.draft);
        fp.payload.directDataSources.receipts.stability = {
          stable: false,
          draftHash,
          storedAtomVersion: bound.storedAtomVersion,
          updatedAt: bound.updatedAt,
        };
        fp.sourceIdentity.draftName = bound.draft.name || "";
        fp.sourceIdentity.materialName = fp.name;
        if (typeof bound.draft.name === "string" && bound.draft.name.trim())
          fp.name = bound.draft.name;
        fp.sourceIdentity.publishedName = bound.published?.name || "";
        fp.payload.timeEstimateMinutes = Number.isFinite(
          bound.draftTimeCommitment,
        )
          ? bound.draftTimeCommitment / 60000
          : null;
        fp.payload.timeEstimateSource = "bound-authoring-draft-timeCommitment";
        fp.payload.directPublishedTimeCommitment =
          bound.publishedTimeCommitment ?? null;
        if (
          ["supplementDraft", "discussionPromptDraft"].includes(bound.draft.content.typeName) &&
          previous?.payload?.directDataSources?.receipts?.stability?.stable ===
            true &&
          previous.payload.directDataSources.receipts.stability.draftHash ===
            draftHash &&
          previous.payload.directDataSources.receipts.stability
            .storedAtomVersion === bound.storedAtomVersion &&
          previous.payload.directDataSources.receipts.stability.updatedAt ===
            bound.updatedAt
        ) {
          // Reuse a CML body only after a fresh, bound draft hash matches.
          // Source receipts and the final atom stability read remain current.
          const freshSources = fp.payload.directDataSources;
          fp.payload = {
            ...previous.payload,
            ...fp.payload,
            directDataSources: freshSources,
          };
          delete fp.payload.directResumeRevalidation;
        }
        if (bound.draft.content.typeName === "staffGradedDraft")
          await captureAssessment(fp, bound);
        else if (["supplementDraft", "discussionPromptDraft"].includes(bound.draft.content.typeName)) {
          const cmlSource = boundCmlSource(bound);
          fp.payload.directDraftCml = cmlSource.rawCML;
          await captureCmlMedia(fp, cmlSource, previous);
          if (directCmlTextV1(cmlSource.cml)?.references?.some(reference => reference.tag === "widget"))
            await captureInlineWidgetProviders(fp, bound, previous);
          else delete fp.payload.directInlineWidgetProviderEvidence;
        } else if (bound.draft.content.typeName === "widgetDraft")
          await captureWidgetProvider(fp, bound, previous);
        else
          directUnsupportedContractV1(
            fp,
            "DIRECT_DRAFT_TYPE_UNSUPPORTED",
            bound,
          );
        const stabilityRead = await reader.readAtom(fp.atomId);
        const refreshed = bindDirectAuthoringDraftV1(
          fp,
          courseId,
          slug,
          requireRead(stabilityRead),
          relationRead.data,
        );
        const stable =
          (await hash(refreshed.draft)) === draftHash &&
          refreshed.storedAtomVersion === bound.storedAtomVersion &&
          refreshed.updatedAt === bound.updatedAt;
        fp.payload.directDataSources.receipts.stability = {
          stable,
          draftHash,
          storedAtomVersion: bound.storedAtomVersion,
          updatedAt: bound.updatedAt,
          receipt: receipt(stabilityRead, fp.atomId),
          atom: stabilityRead.data,
        };
        if (!stable) {
          if (priorPublisherOriginals) throw Error("DIRECT_DRAFT_CHANGED_DURING_CAPTURE");
          directUnsupportedContractV1(
            fp,
            "DIRECT_DRAFT_CHANGED_DURING_CAPTURE",
            bound,
          );
        } else if (bound.draft.content.typeName === "supplementDraft")
          await directReadingPayloadV1(
            fp,
            bound,
            directDraftReadingSourceV1(bound),
          );
        else if (bound.draft.content.typeName === "discussionPromptDraft")
          await directDiscussionPayloadV1(
            fp,
            bound,
            directDraftDiscussionSourceV1(bound),
          );
        else if (bound.draft.content.typeName === "staffGradedDraft")
          directAssessmentContractV1(
            fp,
            fp.payload.structuredAssessment,
            fp.payload.directAssessmentInventory,
            bound,
          );
        else if (bound.draft.content.typeName === "widgetDraft")
          directWidgetContractV1(fp, bound);
        else
          directUnsupportedContractV1(
            fp,
            "DIRECT_DRAFT_TYPE_UNSUPPORTED",
            bound,
          );
      } catch (error) {
        const reason = /^[A-Z0-9_]{1,96}$/.test(error?.message || "")
          ? error.message
          : "DIRECT_ITEM_CAPTURE_FAILED";
        const currentQuestions =
          fp.payload.structuredAssessment?.questions?.length || 0;
        const previousQuestions =
          previous?.payload?.structuredAssessment?.questions?.length || 0;
        const cmlMediaAttempt =
          ["supplementDraft", "discussionPromptDraft"].includes(bound?.draft?.content?.typeName) &&
          fp.payload.directAssetEvidence &&
          retainedCmlMedia(fp, previous, boundCmlSource(bound))
            ? {
                directDataSources: fp.payload.directDataSources,
                directDraftCml: fp.payload.directDraftCml,
                directAssetEvidence: fp.payload.directAssetEvidence,
              }
            : null;
        if (previous?.payload && previousQuestions >= currentQuestions && !fp.payload.directPanoptoEvidence) {
          // A failed resumed read must not replace saved observations with an
          // empty body. Retain them, with an explicit failed current check and
          // an incomplete contract; they are not certified as current content.
          fp.payload = {
            ...previous.payload,
            // A failed final atom check remains incomplete, while original
            // bytes obtained for the same bound CML stay available locally.
            ...(cmlMediaAttempt ? {...cmlMediaAttempt,...(priorPublisherOriginals
              ? {directDataSources:previous.payload.directDataSources} : {})} : {}),
            ...(fp.payload.directWidgetProviderEvidence
              ? {directWidgetProviderAttempt: fp.payload.directWidgetProviderEvidence}
              : {}),
            ...(fp.payload.directInlineWidgetProviderEvidence
              ? {directInlineWidgetProviderAttempt: fp.payload.directInlineWidgetProviderEvidence,
                directInlineWidgetProviderAttemptSources:fp.payload.directDataSources}
              : {}),
            directResumeRevalidation: {
              verified: false,
              reason,
              atomReceipt: receipt(atomRead, fp.atomId),
              relationReceipt: receipt(relationRead, fp.atomId),
            },
          };
        } else
          fp.payload.directResumeRevalidation = {
            verified: false,
            reason,
            atomReceipt: receipt(atomRead, fp.atomId),
            relationReceipt: receipt(relationRead, fp.atomId),
          };
        directUnsupportedContractV1(fp, reason, bound);
        processed = !reader.snapshot().stopped;
      }
      await retainOnlyOwnedPublisherBodies(fp);
      let retainedPublicBytes = retainedPublicPageBytes(fp);
      if (publicBytesBefore - previousPublicBytes + retainedPublicBytes > CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1 &&
          fp.payload.directInlineWidgetProviderAttempt) {
        // A failed item revalidation cannot displace its saved originals. Keep
        // the failed current selectors/receipts, with explicit omitted-page gaps.
        for (const provider of fp.payload.directInlineWidgetProviderAttempt.providers || [])
          for (const page of [...(provider.publicPages || []), ...(provider.publisherPages || [])])
            if (page.observation || page.retainedObservation) {
              page.observation = null;
              delete page.retainedObservation;
              page.failures.push({ reason: "DIRECT_PUBLIC_PAGE_RETAINED_LIMIT" });
            }
        retainedPublicBytes = retainedPublicPageBytes(fp);
      }
      publicPageStats.retainedUtf8Bytes += retainedPublicBytes - previousPublicBytes -
        (publicPageStats.retainedUtf8Bytes - publicBytesBefore);
      publicPageRetainedByItem.set(fp.id, retainedPublicBytes);
      if (publicPageStats.retainedUtf8Bytes > CTI_DIRECT_PUBLIC_PAGE_RETAINED_BYTES_V1)
        throw Error("DIRECT_PUBLIC_PAGE_RETAINED_LIMIT");
      await persist(fp, processed);
      // Publish the attempt cache only after the body and item checkpoints
      // commit. A failed final source read must never cache an unpersisted file.
      if (!fp.payload.directResumeRevalidation)
        for (const delivery of fp.payload.directPanoptoEvidence?.deliveries || [])
          if (delivery.stableSource) panoptoSources.set(delivery.targetUrl, delivery);
      for (const asset of fp.payload.directAssetEvidence?.assets || [])
        mediaReader?.release?.(asset.assetId);
      for (const delivery of fp.payload.directPanoptoEvidence?.deliveries || [])
        for (const podcast of delivery.podcasts || []) mediaReader?.release?.(podcast.assetId);
    }
    async function prepareResult() {
      if (!meta) throw Error("DIRECT_INVENTORY_NOT_AVAILABLE");
      const captureItems = items,
        captureRunId = state.runId,
        captureMeta = meta;
      const output = [],
        summaries = [],
        unvisited = [],
        bodyPaths = new Map(),
        temporaryBodies = new Map();
      let itemBytes = 0;
      // One item is loaded/serialized at a time into bounded Blob parts. There
      // is no stringify+parse clone of the full retained question bank.
      for (const base of captureItems) {
        const row = await store.getItem(captureRunId, base.id),
          fp = row?.fingerprint || {
            ...base,
            payload: {},
            captureContract: undefined,
          };
        // A quota/write failure must not prevent exporting older embedded
        // originals that are still readable. Migrate those only in this
        // download snapshot, without requiring another storage transaction.
        await archiveItemBodies(fp, temporaryBodies);
        if (!row?.state?.processed) {
          unvisited.push(fp.id);
          if (!fp.captureContract)
            applyDirectContractV1(fp, "UNVISITED_DIRECT_ITEM", false, [
              "DIRECT_ACQUISITION_STOPPED",
            ]);
        }
        summaries.push({ id: fp.id, type: fp.type, ...fp.captureContract });
        for (const {body, kind, maxBytes} of itemBodyEntries(fp)) {
          if (body.archivePath !== "files/" + body.sha256 ||
              !Number.isSafeInteger(body.size) || body.size < 1 ||
              body.size > maxBytes)
            throw Error("DIRECT_ARCHIVE_BODY_IDENTITY_INVALID");
          const previousBody = bodyPaths.get(body.archivePath);
          if (previousBody !== undefined && previousBody.size !== body.size)
            throw Error("DIRECT_ARCHIVE_BODY_IDENTITY_INVALID");
          bodyPaths.set(body.archivePath, {size: body.size, kind});
        }
        // Each item becomes an immutable byte-backed Blob before the next
        // IDB read. Never retain the full file as UTF-16 JSON strings.
        const part = new Blob([JSON.stringify(fp)], {
          type: "application/json",
        });
        itemBytes += part.size + (output.length ? 1 : 0);
        if (itemBytes > CTI_DIRECT_DATA_EXPORT_BYTES_V1 - metadataReserveBytes)
          throw Error("DIRECT_CAPTURE_EXPORT_BYTE_LIMIT");
        output.push(part);
      }
      captureMeta.captureAccounting = captureAccountingItemsV61531(summaries, {
        unvisitedTargetIds: unvisited,
      });
      captureMeta.noSilentMisses = captureMeta.captureAccounting.noSilentMisses;
      captureMeta.directDataCapture.acquisitionComplete =
        unvisited.length === 0 &&
        state.counts.processed === captureItems.length &&
        !fatalReason;
      captureMeta.directDataCapture.wholeCourseVerified =
        captureMeta.directDataCapture.acquisitionComplete &&
        captureMeta.directDataCapture.sourceStable === true &&
        captureMeta.captureAccounting.complete;
      captureMeta.directDataCapture.stopReason =
        fatalReason ||
        (captureMeta.directDataCapture.wholeCourseVerified
          ? "COMPLETE_BOUND_AUTHORING_DRAFT"
          : captureMeta.directDataCapture.acquisitionComplete
            ? "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS"
            : "ACQUISITION_PAUSED");
      captureMeta.directDataCapture.stats =
        captureMeta.directDataCapture.stats || budgetSnapshot();
      if (typeof CompressionStream !== "function")
        throw Error("DIRECT_ARCHIVE_COMPRESSION_UNAVAILABLE");
      captureMeta.directDataCapture.exportTransport = {
        format: "ZIP_GZIP_JSON_V1",
        uncompressedLimitBytes: CTI_DIRECT_DATA_EXPORT_BYTES_V1,
        compressedLimitBytes: CTI_DIRECT_DATA_COMPRESSED_BYTES_V1,
        originalFilesLimitBytes: CTI_DIRECT_DATA_MEDIA_BYTES_V1,
        archiveLimitBytes: CTI_DIRECT_DATA_ARCHIVE_BYTES_V1,
        uniqueOriginalFiles: bodyPaths.size,
        uniqueOriginalBytes: [...bodyPaths.values()].reduce((sum, value) => sum + value.size, 0),
      };
      captureMeta.exportFileName =
        "CTI__COURSERA__COURSE_" +
        courseId +
        "__" +
        new Date().toISOString().replace(/[:.]/g, "-") +
        "__direct-v1__ITEM_FINGERPRINT.cti.zip";
      const prefix =
        JSON.stringify({
          schemaVersion: 35,
          extractedAt: new Date().toISOString(),
          page: {
            url: location.origin + initialPath,
            title: document.title,
            courseId,
          },
          meta: captureMeta,
          embeddedFiles: [],
        }).slice(0, -1) + ',"fingerprints":[';
      if (
        encoder.encode(prefix).byteLength + itemBytes + 2 >
        CTI_DIRECT_DATA_EXPORT_BYTES_V1
      )
        throw Error("DIRECT_CAPTURE_EXPORT_BYTE_LIMIT");
      const pieces = [prefix];
      for (let i = 0; i < output.length; i++)
        pieces.push(i ? "," : "", output[i]);
      pieces.push("]}");
      const blob = new Blob(pieces, { type: "application/json" });
      if (blob.size > CTI_DIRECT_DATA_EXPORT_BYTES_V1)
        throw Error("DIRECT_CAPTURE_EXPORT_BYTE_LIMIT");
      state.result = {
        schemaVersion: 35,
        meta: captureMeta,
        inventoryCount: captureItems.length,
      };
      return {blob, bodyPaths, temporaryBodies};
    }
    async function download() {
      if (exporting || state.running || state.diagnosing) return;
      exporting = true;
      state.exporting = true;
      state.exportError = "";
      render();
      try {
        const prepared = await prepareResult();
        let blob = prepared.blob;
        await saveRun(state.state, true).catch(() => {
          state.exportError = "Capture prepared from readable checkpoints; saving the export status failed.";
        });
        if (meta.directDataCapture.exportTransport.format === "ZIP_GZIP_JSON_V1") {
          const stream = blob
              .stream()
              .pipeThrough(new CompressionStream("gzip")),
            compressedReader = stream.getReader(),
            pieces = [];
          let bytes = 0;
          try {
            for (;;) {
              const chunk = await compressedReader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > CTI_DIRECT_DATA_COMPRESSED_BYTES_V1)
                throw Error("DIRECT_CAPTURE_COMPRESSED_BYTE_LIMIT");
              pieces.push(new Blob([chunk.value]));
            }
          } finally {
            await compressedReader.cancel().catch(() => {});
          }
          blob = new Blob(pieces, { type: "application/gzip" });
        }
        const entries = [{path: "capture.json.gz", blob}];
        for (const [path, {size, kind}] of prepared.bodyPaths) {
          const temporary = prepared.temporaryBodies.get(path);
          if (temporary) {
            if (temporary.size !== size) throw Error("DIRECT_ARCHIVE_BODY_IDENTITY_INVALID");
            entries.push({path, blob: temporary, kind});
            continue;
          }
          const original = await store.getBody(state.runId, path.slice(6));
          if (!original?.blob || original.size !== size)
            throw Error("DIRECT_ARCHIVE_BODY_UNAVAILABLE");
          entries.push({path, blob: original.blob, kind});
        }
        blob = await createDirectDataArchiveV1(entries);
        const url = URL.createObjectURL(blob),
          anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = meta.exportFileName;
        anchor.style.display = "none";
        document.body.append(anchor);
        state.downloadAttempts++;
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) {
        state.exportError =
          error?.message || "Saved capture could not be downloaded.";
        render(state.exportError);
      } finally {
        exporting = false;
        state.exporting = false;
        render();
      }
    }
    async function checkProviderAccess() {
      if (state.running || state.diagnosing || exporting ||
          location.origin !== "https://www.coursera.org" || location.pathname !== initialPath) return;
      operatorStopped = false;
      providerTransport?.close();
      providerTransport = createDirectProviderHelperV1({courseId,
        onStatus: message => render(message)});
      state.diagnosing = true;
      state.accessDiagnostic = null;
      accessText.textContent = "";
      accessFallback.hidden = true;
      state.phase = "Checking Panopto access";
      const checkedAt = new Date().toISOString(), checks = [], nativeFailures = [],
        requests = new Map();
      let stopReason = "";
      accessReader = createDirectDataReaderV1({
        providerTransport,
        assertCurrent: assertContext,
        sanitize: sanitizeCourseraCourseDataModel,
        limits: {concurrentRequests: 1, requests: 128, totalBytes: 16 * 1024 * 1024,
          requestMs: 10000, durationMs: 120000},
      });
      render("Reading the current outline and plugin settings only. Saved course progress is untouched.");
      try {
        const materials = await accessReader.readCourseMaterials(courseId),
          current = await directCourseInventoryV1(requireRead(materials), courseId),
          widgets = current.fingerprints.filter(fp => /widget|plugin/i.test(fp.typeName || fp.type));
        for (let index = 0; index < widgets.length; index++) {
          const fp = widgets[index];
          if (index >= 32) {
            nativeFailures.push({itemId: fp.id, atomId: fp.atomId, reason: "PROVIDER_ACCESS_CHECK_ITEM_LIMIT"});
            stopReason = "PROVIDER_ACCESS_CHECK_ITEM_LIMIT";
            break;
          }
          if (accessReader.snapshot().stopped) throw Error(accessReader.snapshot().stopReason);
          try {
            const atom = await accessReader.readAtom(fp.atomId),
              relation = await accessReader.readRelation(fp.atomId),
              bound = bindDirectAuthoringDraftV1(fp, courseId, slug, requireRead(atom), requireRead(relation)),
              binding = directDraftWidgetProviderV1(bound),
              provider = await accessReader.readWidgetProvider(binding.providerId, courseId),
              targets = directWidgetProviderTargetsV1(bound, requireRead(provider)),
              urls = [...new Set(targets.map(target => target.url))].filter(directPanoptoAutomaticTargetV1);
            if (!urls.length) continue;
            const sources = {atom: atom.data, relation: relation.data, provider: provider.data,
              receipts: {atom: receipt(atom, fp.atomId), relation: receipt(relation, fp.atomId), provider: receipt(provider, binding.providerId)},
              hashes: {atom: await hash(atom.data), relation: await hash(relation.data), provider: await hash(provider.data)}};
            for (const targetUrl of urls) {
              if (!requests.has(targetUrl)) {
                if (requests.size >= 12) {
                  nativeFailures.push({itemId: fp.id, atomId: fp.atomId, reason: "PROVIDER_ACCESS_CHECK_TARGET_LIMIT"});
                  continue;
                }
                render("Checking configured video source " + (requests.size + 1) + " · " + fp.name);
                const read = await accessReader.readPanoptoDeliveryInfo(targetUrl),
                  target = directPanoptoAutomaticTargetV1(targetUrl);
                requests.set(targetUrl, {reason: read.reason || "", receipt: read.receipt ? receipt(read, target.deliveryPublicId) : null});
              }
              checks.push({itemId: fp.id, atomId: fp.atomId, providerId: binding.providerId,
                targetUrl, sources, request: requests.get(targetUrl)});
            }
          } catch (error) {
            nativeFailures.push({itemId: fp.id, atomId: fp.atomId,
              reason: /^[A-Z0-9_]{1,96}$/.test(error?.message || "") ? error.message : "PROVIDER_ACCESS_SOURCE_UNAVAILABLE"});
          }
        }
      } catch (error) {
        stopReason = /^[A-Z0-9_]{1,96}$/.test(error?.message || "") ? error.message : "PROVIDER_ACCESS_CHECK_FAILED";
      } finally {
        if (accessReader.snapshot().stopped) stopReason = accessReader.snapshot().stopReason;
        accessReader.abort("PROVIDER_ACCESS_CHECK_FINISHED");
        accessReader = null;
        providerTransport?.close();
        providerTransport = null;
        state.diagnosing = false;
      }
      try {
        state.accessDiagnostic = directProviderAccessDiagnosticV1({courseId, courseSlug: slug,
          pageUrl: location.origin + initialPath, checkedAt, items: checks, nativeFailures, stopReason});
        accessText.textContent = directProviderAccessDiagnosticTextV1(state.accessDiagnostic);
        state.phase = "Panopto access check finished";
        render("This is an access diagnostic, not a course capture. Copy the result or download the small report to share in this chat.");
      } catch (_) {
        state.accessDiagnostic = null;
        state.phase = "Access report could not be prepared";
        render("The diagnostic exceeded its report limit or could not validate its source binding. Saved course progress was not changed.");
      }
    }
    async function checkpointPublisherTarget(fp) {
      try {
        // Bound saved JSON before canonical hashing. The diagnostic consumes
        // native configuration proof only, never retained page/media bodies.
        const inline = fp.payload?.directInlineWidgetProviderEvidence;
        if (!Array.isArray(inline?.providers) || inline.providers.length > 32) return null;
        const providers = new Set(inline.providers), pending = [fp.payload?.directDataSources, inline], seen = new Set();
        let nodes = 0, characters = 0;
        while (pending.length) {
          const value = pending.pop();
          if (++nodes > 20000) return null;
          if (typeof value === "string") {
            characters += value.length;
            if (characters > 2 * 1024 * 1024) return null;
          } else if (value && typeof value === "object") {
            if (seen.has(value)) return null;
            seen.add(value);
            const entries = Object.entries(value);
            if (entries.length > 2048) return null;
            for (const [key, child] of entries) {
              characters += key.length;
              if (characters > 2 * 1024 * 1024) return null;
              // External bodies are unrelated to selecting the native target.
              if (!providers.has(value) || key !== "publicPages" && key !== "publisherPages") pending.push(child);
            }
          }
        }
        const sources = fp.payload?.directDataSources,
          bound = bindDirectAuthoringDraftV1(fp, courseId, slug, sources?.atom, sources?.relation),
          bindings = directInlineWidgetBindingsV1(fp, bound), hashes = new Map();
        const remember = async value => hashes.set(directCanonicalSourceTextV1(value), await hash(value));
        await remember(bound.draft);
        for (const proof of fp.payload?.directInlineWidgetProviderEvidence?.providers || []) {
          const binding = bindings.find(value => value.providerId === proof.providerId);
          if (!binding || proof.stableSource !== true || proof.failures?.length) continue;
          for (const observation of [proof.initial, proof.final]) {
            await remember(observation.model);
            await remember(directInlineWidgetProviderSourceV1(binding, observation.model));
          }
        }
        const verified = directInlineWidgetEvidenceV1(fp, bound, value => hashes.get(directCanonicalSourceTextV1(value)));
        for (const provider of verified?.providers || [])
          for (const target of provider.targets)
            if (directPublisherTargetV1(target.url)) return { itemId: fp.id, providerId: provider.binding.providerId,
              targetUrl: target.url, configuredSourceObservedAt: provider.final.receipt.observedAt };
      } catch (_) { /* A stored declaration alone cannot select a request. */ }
      return null;
    }
    async function checkPublisherAccess() {
      if (state.running || state.diagnosing || exporting || location.origin !== "https://www.coursera.org" || location.pathname !== initialPath) return;
      operatorStopped = false; state.diagnosing = true; state.accessDiagnostic = null;
      state.phase = "Checking embedded page access"; accessText.textContent = ""; accessFallback.hidden = true;
      const report = { kind: "CTI_PUBLISHER_ACCESS_DIAGNOSTIC", schemaVersion: 1, diagnosticOnly: true, courseId,
        checkedAt: new Date().toISOString(), source: null, accepted: false, reason: "PUBLISHER_CHECK_NO_RECORDED_SOURCE", requests: 0,
        courseCaptured: false, progressChanged: false };
      render("Checking one recorded embedded page. This does not recapture the course or change saved progress.");
      try {
        const checkpoint = store?.available ? store : await createDirectDataCheckpointStoreV1(courseId);
        if (!checkpoint.available) throw Error("DIRECT_CHECKPOINT_STORAGE_UNAVAILABLE");
        const saved = await checkpoint.getActiveRun({ recoverMediaGaps: true, recoverExportLimit: true });
        if (saved?.captureMeta?.directDataCapture?.materials?.elements?.[0]?.id !== courseId) throw Error("PUBLISHER_CHECK_NO_RECORDED_SOURCE");
        const captured = await directCourseInventoryV1(saved.captureMeta.directDataCapture.materials, courseId),
          selected = /(?:^|[?&])itemId=([A-Za-z0-9_-]{1,128})(?:&|$)/.exec(location.search || "")?.[1],
          candidates = captured.fingerprints.slice(0, 128);
        if (selected) candidates.sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
        for (const item of candidates) {
          if (operatorStopped || !assertContext()) throw Error("PUBLISHER_CHECK_STOPPED_OR_CONTEXT_CHANGED");
          const row = await checkpoint.getItem(saved.runId, item.id);
          const fp = row?.fingerprint;
          const target = fp?.id === item.id && fp.atomId === item.atomId && fp.typeName === item.typeName &&
            await checkpointPublisherTarget(fp);
          if (target) { report.source = target; break; }
        }
        if (!report.source) throw Error("PUBLISHER_CHECK_NO_RECORDED_SOURCE");
        accessReader = createDirectDataReaderV1({ sanitize: sanitizeCourseraCourseDataModel, assertCurrent: assertContext,
          limits: { concurrentRequests: 1, requests: 2, totalBytes: 2 * 1024 * 1024, bodyBytes: 1024 * 1024,
            requestMs: 10000, durationMs: 25000 } });
        const target = report.source, read = await accessReader.readPublisherPage(target.targetUrl, { itemId: target.itemId, providerId: target.providerId });
        report.requests = accessReader.snapshot().requests;
        report.reason = read.reason || "";
        report.receipt = retainPublisherFailureReceipt(read, target.targetUrl);
        if (read.ok && directPublisherResourceObservationValidV1({ model: read.data, receipt: read.receipt }, target.targetUrl)) {
          const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(read.data.rawJson))),
            byte => byte.toString(16).padStart(2, "0")).join("");
          if (operatorStopped || !assertContext()) throw Error("PUBLISHER_CHECK_STOPPED_OR_CONTEXT_CHANGED");
          const resourceType = read.data.kind === "CTI_BROWSER_PUBLISHER_PART" ? "part" : "chapter",
            resource = actual === read.data.sha256 && directPublisherResourceV1(read.data.rawJson, target.targetUrl, resourceType);
          if (resource) {
            report.accepted = true;
            report[resourceType === "part" ? "resource" : "chapter"] = { id: resource.id, type: resource.type, status: resource.status, link: resource.link,
              titleCharacters: (resource.title?.rendered || resource.title?.raw || "").length,
              contentCharacters: (resource.content?.rendered || resource.content?.raw || "").length };
            report.resourceType = resourceType;
            report.body = { bytes: read.data.bytes, sha256: read.data.sha256 };
          } else report.reason = "DIRECT_PUBLISHER_HASH_INVALID";
        }
      } catch (error) {
        report.reason = /^[A-Z0-9_]{1,96}$/.test(error?.message || "") ? error.message : "PUBLISHER_ACCESS_CHECK_FAILED";
      } finally {
        accessReader?.abort("PUBLISHER_ACCESS_CHECK_FINISHED"); accessReader = null; state.diagnosing = false;
      }
      state.accessDiagnostic = report;
      accessText.textContent = accessDiagnosticText();
      state.phase = "Embedded page access check finished";
      render("Access diagnostic only. Source content and saved course progress were not changed.");
    }
    function accessDiagnosticText() {
      const diagnostic = state.accessDiagnostic;
      if (diagnostic?.kind !== "CTI_PUBLISHER_ACCESS_DIAGNOSTIC") return directProviderAccessDiagnosticTextV1(diagnostic);
      return "Publisher page access diagnostic only\n" + JSON.stringify(diagnostic, null, 2) +
        "\nNo course capture, retained page content or complete widget is established by this diagnostic.";
    }
    async function copyAccessResult() {
      if (!state.accessDiagnostic || state.running || state.diagnosing || exporting) return;
      const text = accessDiagnosticText();
      try {
        if (!navigator.clipboard?.writeText) throw Error("CLIPBOARD_UNAVAILABLE");
        await navigator.clipboard.writeText(text);
        detail.textContent = "Access result copied. Paste it into this chat.";
      } catch (_) {
        accessFallback.value = text;
        accessFallback.hidden = false;
        accessFallback.focus?.();
        accessFallback.select?.();
        detail.textContent = "Select and copy the access result below, or download the small access report.";
      }
    }
    function downloadAccessReport() {
      if (!state.accessDiagnostic || state.running || state.diagnosing || exporting) return;
      const blob = new Blob([JSON.stringify(state.accessDiagnostic, null, 2)], {type: "application/json"}),
        url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = (state.accessDiagnostic.kind === "CTI_PUBLISHER_ACCESS_DIAGNOSTIC" ? "CTI_PUBLISHER_ACCESS_DIAGNOSTIC_" : "CTI_PANOPTO_ACCESS_DIAGNOSTIC_") + courseId + "_" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    async function run(fresh = false) {
      if (
        state.running ||
        state.diagnosing ||
        exporting ||
        (state.terminal && !fresh) ||
        location.origin !== "https://www.coursera.org" ||
        location.pathname !== initialPath
      )
        return;
      state.running = true;
      state.terminal = false;
      state.runId = "";
      providerTransport?.close();
      providerTransport = createDirectProviderHelperV1({courseId,
        onStatus: message => render(message)});
      state.state = "RUNNING";
      state.phase = "Reading course structure";
      operatorStopped = false;
      fatalReason = "";
      items = [];
      inventory = null;
      meta = null;
      itemStates = new Map();
      retainedSizes = new Map();
      reader = null;
      frozenStats = null;
      budgetBase = { requests: 0, bytes: 0, elapsedMs: 0 };
      materialHash = "";
      checkpointReady = false;
      mediaReader = null;
      publisherImageTargets.clear();
      panoptoSources = new Map();
      inlineWidgetSources = new Map();
      publicPageSources = new Map();
      publisherPageSources = new Map();
      externalSourceTargets = new Set();
      publisherPageStats = { readerOperations: 0, observedBytes: 0 };
      publicPageRetainedByItem = new Map();
      publicPageStats = { readerOperations: 0, observedEnvelopeBytes: 0, retainedUtf8Bytes: 0 };
      mediaBase = { bytes: 0, requests: 0 };
      frozenMediaStats = null;
      state.counts = { processed: 0, complete: 0, questions: 0, total: 0 };
      render();
      const clock = setInterval(() => {
        render();
        checkpointBudget();
      }, 1000);
      try {
        store = store?.available
          ? store
          : await createDirectDataCheckpointStoreV1(courseId);
        if (!store.available)
          throw Error("DIRECT_CHECKPOINT_STORAGE_UNAVAILABLE");
        const policyReader = createDirectDataReaderV1({
          limits: window.__CTI_COURSERA_DIRECT_DATA_LIMITS__,
        });
        const policy = policyReader.snapshot().limits;
        policyReader.abort("POLICY_ONLY");
        budgetLimits = { ...policy };
        const active = fresh ? null : await store.getActiveRun({
            recoverExportLimit: true,
            recoverMediaGaps: true,
          }),
          candidate = (directRecoverablePublisherBuildV1(active?.buildId) || [
            CTI_DIRECT_DATA_BUILD_V1,
            "v1.0.0-bound-authoring-drafts-20261014",
            "v1.1.0-compressed-resumable-drafts-20261014",
            "v1.2.0-bound-reading-media-20261014",
            "v1.3.0-deduplicated-original-archive-20261014",
            "v1.4.0-bound-content-integrity-20261015",
            "v1.5.0-bound-widget-configuration-20261015",
            "v1.6.0-integrated-panopto-bookmark-20261015",
            "v1.6.1-provider-access-diagnostics-20261015",
            "v1.7.0-public-panopto-helper-20261016",
            "v1.7.1-explicit-fresh-course-capture-20261017",
            "v1.7.2-content-and-structure-coverage-20261017",
            "v1.7.3-panopto-exact-body-length-20261017",
          ].includes(active?.buildId))
            ? active
            : null;
        if (candidate) {
          state.runId = candidate.runId;
          materialHash = candidate.materialHash || "";
          const saved = candidate.budget;
          if (
            !saved ||
            ["requests", "bytes", "elapsedMs"].some(
              (key) => !Number.isFinite(saved[key]) || saved[key] < 0,
            ) ||
            !saved.limits ||
            Object.keys(policy).some(
              (key) =>
                !Number.isFinite(saved.limits[key]) || saved.limits[key] <= 0,
            )
          )
            throw Error("DIRECT_RUN_BUDGET_METADATA_INVALID");
          budgetBase = {
            requests: saved.requests,
            bytes: saved.bytes,
            elapsedMs: saved.elapsedMs,
          };
          if (saved.media) {
            if (
              !["bytes", "requests"].every(
                (key) =>
                  Number.isFinite(saved.media[key]) && saved.media[key] >= 0,
              )
            )
              throw Error("DIRECT_RUN_BUDGET_METADATA_INVALID");
            mediaBase = {
              bytes: saved.media.bytes,
              requests: saved.media.requests,
            };
          }
          for (const key of Object.keys(policy))
            budgetLimits[key] =
              key === "concurrentRequests" &&
              candidate.buildId !== CTI_DIRECT_DATA_BUILD_V1
                ? policy[key]
                : Math.min(policy[key], saved.limits[key]);
          // An interrupted run can be exported locally even if its hard
          // network budget has already been consumed. Never silently reset it.
          if (
            candidate.captureMeta?.directDataCapture?.runId ===
              candidate.runId &&
            candidate.captureMeta.directDataCapture.materials?.elements?.[0]
              ?.id === courseId
          ) {
            meta = candidate.captureMeta;
            inventory = await directCourseInventoryV1(
              meta.directDataCapture.materials,
              courseId,
            );
            items = inventory.fingerprints;
            state.counts.total = items.length;
            metadataReserveBytes =
              encoder.encode(JSON.stringify(meta)).byteLength +
              encoder.encode(JSON.stringify(meta.directDataCapture.materials))
                .byteLength +
              256 * 1024;
            await hydrateSavedItems();
            checkpointReady = true;
          }
        }
        const createReader = () =>
          createDirectDataReaderV1({
            providerTransport,
            sanitize: sanitizeCourseraCourseDataModel,
            assertCurrent: assertContext,
            limits: remainingLimits(),
            onStats: () => {
              render();
              checkpointBudget();
            },
          });
        reader = createReader();
        const [materialsRead, courseRead] = await Promise.all([
          reader.readCourseMaterials(courseId),
          reader.readCourse(courseId),
        ]);
        const materialData = requireRead(materialsRead);
        inventory = await directCourseInventoryV1(materialData, courseId);
        const currentMaterialHash = await hash(materialData.elements[0]);
        const baseCapture = candidate?.captureMeta?.directDataCapture;
        let resuming = candidate?.materialHash === currentMaterialHash;
        if (!resuming && candidate && baseCapture?.acquisitionComplete === true &&
            baseCapture.sourceStable === true && baseCapture.wholeCourseVerified === false &&
            baseCapture.stopReason === "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS" &&
            baseCapture.materialStability?.policy === CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1) {
          try {
            // The same native flag set may arrive in a different array order.
            // Recompute the retained raw proof before using the existing narrow
            // comparison policy; never replace a saved response or its hash.
            await directCourseInventoryV1(baseCapture.materials, courseId);
            await directCourseInventoryV1(baseCapture.finalMaterials, courseId);
            const initialRoot = baseCapture.materials?.elements?.[0],
              finalRoot = baseCapture.finalMaterials?.elements?.[0],
              initialRawHash = await hash(initialRoot),
              finalRawHash = await hash(finalRoot),
              initialComparisonHash = await hash(directMaterialStabilityModelV1(initialRoot)),
              finalComparisonHash = await hash(directMaterialStabilityModelV1(finalRoot)),
              currentComparisonHash = await hash(directMaterialStabilityModelV1(materialData.elements[0]));
            resuming = initialRoot?.id === courseId && finalRoot?.id === courseId &&
              candidate.materialHash === initialRawHash && baseCapture.initialMaterialHash === initialRawHash &&
              baseCapture.finalMaterialHash === finalRawHash &&
              baseCapture.materialStability.initialSha256 === initialComparisonHash &&
              baseCapture.materialStability.finalSha256 === finalComparisonHash &&
              initialComparisonHash === finalComparisonHash && finalComparisonHash === currentComparisonHash;
          } catch (_) { /* Invalid historical proof cannot authorize reuse. */ }
        }
        const enriching =
          resuming &&
          ((baseCapture?.acquisitionComplete === true &&
            baseCapture?.sourceStable === true &&
            baseCapture?.stopReason ===
              "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS") ||
            (["REFERENCED_READING_MEDIA_ONLY", "REFERENCED_CML_MEDIA_ONLY", "REFERENCED_CML_MEDIA_AND_WIDGET_SOURCES"].includes(
              baseCapture?.mediaEnrichment?.scope,
            ) &&
              baseCapture.mediaEnrichment.baseAcquisitionComplete === true));
        if (candidate && !resuming) {
          // The same course now has a different material graph. Preserve the
          // old run and charge the discovery reads to a separate fresh run.
          const discovery = reader.snapshot();
          reader.abort("SOURCE_RUN_REPLACED");
          budgetBase = {
            requests: discovery.requests,
            bytes: discovery.bytes,
            elapsedMs: discovery.elapsedMs,
          };
          budgetLimits = { ...policy };
          frozenStats = null;
          mediaReader = null;
          mediaBase = { bytes: 0, requests: 0 };
          frozenMediaStats = null;
          state.runId = "";
          itemStates = new Map();
          retainedSizes = new Map();
          publicPageRetainedByItem = new Map();
          publicPageStats.retainedUtf8Bytes = 0;
          state.counts = { processed: 0, complete: 0, questions: 0, total: 0 };
          reader = createReader();
        }
        materialHash = currentMaterialHash;
        const opened = await store.openRun(
          resuming ? candidate.runId : undefined,
          { state: "RUNNING", materialHash, buildId: CTI_DIRECT_DATA_BUILD_V1 },
        );
        state.runId = opened.runId;
        items = inventory.fingerprints;
        state.counts.total = items.length;
        meta = {
          extractor: "CTI Direct Course Capture v" + CTI_DIRECT_DATA_VERSION_V1,
          buildId: CTI_DIRECT_DATA_BUILD_V1,
          baseFingerprintCount: items.length,
          checkpoint: { available: true, runId: state.runId },
          directDataCapture: {
            mode: "BOUND_AUTHORING_DRAFT_API",
            version: 1,
            runId: state.runId,
            sourceState: "AUTHORING_DRAFT",
            sourceStable: false,
            resumed: resuming,
            recoveredFromBuild:
              resuming && candidate.buildId !== CTI_DIRECT_DATA_BUILD_V1
                ? candidate.buildId
                : "",
            ...(enriching
              ? {
                  mediaEnrichment: {
                    scope: "REFERENCED_CML_MEDIA_AND_WIDGET_SOURCES",
                    baseAcquisitionComplete: true,
                    baseBuildId:
                      baseCapture.mediaEnrichment?.baseBuildId ||
                      candidate.buildId,
                    baseSourceCapturedAt:
                      baseCapture.mediaEnrichment?.baseSourceCapturedAt ||
                      baseCapture.finalMaterialsReceipt?.observedAt ||
                      "",
                    retainedAssessmentObservations: true,
                  },
                }
              : {}),
            initialMaterialHash: materialHash,
            materialStability: {
              policy: CTI_DIRECT_MATERIAL_STABILITY_POLICY_V1,
              initialSha256: await hash(directMaterialStabilityModelV1(materialData.elements[0])),
            },
            materialVersion: inventory.materialVersion,
            courseBranchVersion: inventory.courseBranchVersion,
            materials: materialData,
            materialsReceipt: receipt(materialsRead, courseId),
            course: courseRead.data,
            courseReceipt: receipt(courseRead, courseId),
            courseReadFailure: courseRead.ok ? "" : courseRead.reason,
            limits: {
              ...reader.snapshot().limits,
              exportBytes: CTI_DIRECT_DATA_EXPORT_BYTES_V1,
              partsPerAssessment: CTI_DIRECT_DATA_MAX_PARTS_V1,
            },
          },
        };
        meta.directDataCapture.limits = {
          ...budgetLimits,
          exportBytes: CTI_DIRECT_DATA_EXPORT_BYTES_V1,
          partsPerAssessment: CTI_DIRECT_DATA_MAX_PARTS_V1,
          mediaBytes: CTI_DIRECT_DATA_MEDIA_BYTES_V1,
          mediaBodyBytes: 16 * 1024 * 1024,
          panoptoPodcastBodyBytes: CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1,
        };
        metadataReserveBytes =
          encoder.encode(JSON.stringify(meta)).byteLength +
          encoder.encode(JSON.stringify(materialData)).byteLength +
          256 * 1024;
        meta.directDataCapture.metadataReserveBytes = metadataReserveBytes;
        if (metadataReserveBytes >= CTI_DIRECT_DATA_EXPORT_BYTES_V1)
          throw Error("DIRECT_CAPTURE_EXPORT_BYTE_LIMIT");
        if (resuming && !itemStates.size) await hydrateSavedItems();
        checkpointReady = true;
        await saveRun("RUNNING", true);
        for (let index = 0; index < items.length; index++) {
          if (reader.snapshot().stopped) break;
          const fp = items[index];
          // A source/media continuation preserves assessment observations and
          // their original timestamps. Widget providers are read again because
          // their configuration may change independently of the owning atom.
          const previous = enriching
            ? await store.getItem(state.runId, fp.id)
            : null;
          const keep =
            enriching &&
            !inventory.leaves.get(fp.id).structural &&
            previous?.state?.processed === true &&
            previous?.fingerprint?.id === fp.id &&
            previous.fingerprint.atomId === fp.atomId &&
            previous.fingerprint.payload?.directDataSources?.atom?.elements?.[0]?.draft?.content?.typeName !== "widgetDraft" &&
            !/widget|plugin|lti/i.test(String(fp.typeName || fp.type || "")) &&
            (previous.fingerprint.captureContract?.complete === true ||
              !["supplement", "discussionPrompt"].includes(previous.fingerprint.typeName));
          if (keep) {
            items[index] = {
              ...previous.fingerprint,
              payload: {},
              captureContract: previous.fingerprint.captureContract,
            };
            continue;
          }
          await captureItem(fp);
          // Finalized item bodies live in IDB. Keep only the inventory and
          // summary in the renderer between items, particularly large banks.
          if (!inventory.leaves.get(fp.id).structural)
            items[index] = {
              ...fp,
              payload: {},
              captureContract: fp.captureContract,
            };
        }
        if (reader.snapshot().stopped)
          throw Error(reader.snapshot().stopReason);
        state.phase = "Checking source stability";
        render();
        const finalRead = await reader.readCourseMaterials(courseId),
          finalData = requireRead(finalRead);
        await directCourseInventoryV1(finalData, courseId);
        const finalHash = await hash(finalData.elements[0]);
        const finalStabilityHash = await hash(directMaterialStabilityModelV1(finalData.elements[0]));
        const sourceStable = finalStabilityHash === meta.directDataCapture.materialStability.initialSha256;
        Object.assign(meta.directDataCapture, {
          finalMaterials: finalData,
          finalMaterialsReceipt: receipt(finalRead, courseId),
          finalMaterialHash: finalHash,
          materialStability: {
            ...meta.directDataCapture.materialStability,
            finalSha256: finalStabilityHash,
          },
          sourceStable,
        });
        for (const fp of items)
          if (inventory.leaves.get(fp.id).structural) {
            fp.payload.directDataSources.receipts.stability.stable =
              sourceStable;
            directEmptyStructureContractV1(
              fp,
              { courseId, stableSource: sourceStable },
              inventory.leaves.get(fp.id).node,
            );
            await persist(fp, true);
          }
        if (!sourceStable)
          fatalReason = "DIRECT_COURSE_CHANGED_DURING_CAPTURE";
        state.state =
          state.counts.complete === items.length && !fatalReason
            ? "COMPLETE"
            : "INCOMPLETE";
        state.phase =
          state.state === "COMPLETE"
            ? "Course draft captured and verified"
            : "Capture finished with evidence gaps";
        await saveRun(state.state, true);
        const summary = coverageSummary();
        render(
          summary.content.verified +
            "/" +
            summary.content.total +
            " content items verified; " +
            summary.structures.verified +
            "/" +
            summary.structures.total +
            " empty structures verified. One capture file retains original media, published snapshots and every unresolved source.",
        );
      } catch (error) {
        fatalReason = /^[A-Z0-9_]{1,96}$/.test(error?.message || "")
          ? error.message
          : "DIRECT_CAPTURE_FAILED";
        if (meta) meta.directDataCapture.stopReason = fatalReason;
        state.terminal = terminalBudgetReason(fatalReason);
        state.state = state.terminal ? "INCOMPLETE" : "PAUSED";
        state.phase = state.terminal
          ? "Capture reached its safety limit"
          : "Capture paused";
        try {
          await saveRun(state.state, true);
        } catch (_) {
          fatalReason = "DIRECT_CHECKPOINT_STORAGE_FAILED";
        }
        render(
          fatalReason +
            (state.terminal
              ? ". Saved progress is preserved. Download this partial capture; a later bookmark click starts a separate run."
              : ". Saved reads remain local. Click Resume after fixing the connection or sign-in."),
        );
      } finally {
        frozenStats = reader?.snapshot() || null;
        frozenMediaStats = mediaReader?.snapshot() || null;
        if (meta) {
          meta.directDataCapture.stats = budgetSnapshot();
          meta.directDataCapture.coverage = coverageSummary();
        }
        mediaReader?.abort("RUN_FINISHED");
        reader?.abort("RUN_FINISHED");
        providerTransport?.close();
        providerTransport = null;
        clearInterval(clock);
        try {
          await saveRun(state.state, true);
        } catch (_) {
          fatalReason = "DIRECT_CHECKPOINT_STORAGE_FAILED";
          state.state = "PAUSED";
          state.phase = "Capture paused";
        }
        state.running = false;
        render();
        if (meta && !operatorStopped) await download();
      }
    }
    state.focus = () => card.scrollIntoView({ block: "nearest" });
    state.stop = () => {
      operatorStopped = true;
      reader?.abort("OPERATOR_PAUSED");
      mediaReader?.abort("OPERATOR_PAUSED");
      accessReader?.abort("OPERATOR_PAUSED");
      providerTransport?.close();
    };
    state.resume = () => void run();
    state.export = () => void download();
    state.start = () => void run();
    state.startFresh = () => void run(true);
    state.checkProviderAccess = () => void checkProviderAccess();
    state.checkPublisherAccess = () => void checkPublisherAccess();
    startButton.onclick = state.start;
    freshButton.onclick = state.startFresh;
    accessButton.onclick = state.checkProviderAccess;
    publisherAccessButton.onclick = state.checkPublisherAccess;
    copyAccessButton.onclick = () => void copyAccessResult();
    downloadAccessButton.onclick = downloadAccessReport;
    stopButton.onclick = state.stop;
    resumeButton.onclick = state.resume;
    downloadButton.onclick = state.export;
    window.addEventListener("pagehide", () => {
      operatorStopped = true;
      reader?.abort("PAGE_CLOSED_OR_NAVIGATED");
      mediaReader?.abort("PAGE_CLOSED_OR_NAVIGATED");
      accessReader?.abort("PAGE_CLOSED_OR_NAVIGATED");
      providerTransport?.close();
    });
    render("After editing Coursera, start a fresh course capture. Capture/resume continues saved progress; prior runs stay saved locally.");
  })().catch(() => {
    alert(
      "CTI capture could not start. Open the course Content page and try the bookmark again.",
    );
  });
})();
