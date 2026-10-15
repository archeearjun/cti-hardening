import {
  CTI_DIRECT_DATA_VERSION_V1,
  CTI_DIRECT_DATA_BUILD_V1,
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
import { createDirectDataCheckpointStoreV1 } from "./direct-data-checkpoints.js";
import { sanitizeCourseraCourseDataModel } from "./direct-data-privacy.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import { directDraftWidgetProviderV1, directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1 } from "./direct-data-widget.js";
import { directPanoptoAutomaticTargetV1, directPanoptoSourceV1,
  directPanoptoPodcastBindingsV1, CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1 } from "./direct-data-panopto.js";
import { directProviderAccessDiagnosticV1, directProviderAccessDiagnosticTextV1 } from "./direct-data-provider-diagnostic.js";
import { directCourseInventoryV1 } from "./direct-data-inventory.js";
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
      accessButton = document.createElement("button"),
      copyAccessButton = document.createElement("button"),
      downloadAccessButton = document.createElement("button"),
      accessText = document.createElement("pre"),
      accessFallback = document.createElement("textarea");
    startButton.textContent = "Capture/resume course";
    accessButton.textContent = "Check Panopto access";
    copyAccessButton.textContent = "Copy access result";
    downloadAccessButton.textContent = "Download access report";
    accessText.style.cssText = "white-space:pre-wrap;font:inherit;max-height:220px;overflow:auto";
    accessText.setAttribute("role", "status");
    accessFallback.setAttribute("aria-label", "Access report copy fallback");
    accessFallback.readOnly = true;
    accessFallback.hidden = true;
    accessFallback.style.cssText = "width:95%;height:100px";
    for (const button of [startButton, accessButton, stopButton, downloadButton, resumeButton, copyAccessButton, downloadAccessButton])
      button.style.cssText =
        "margin:4px;padding:8px;background:#fff;border:1px solid #adc2de;border-radius:6px;color:#172b4d;cursor:pointer";
    card.append(
      heading,
      phase,
      detail,
      count,
      hint,
      startButton,
      accessButton,
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
    let accessReader = null;
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
        ? "Capture/resume reads the course. Check Panopto access only checks configured video sources; it does not reread questions, download videos, or change saved progress."
        : mediaOnly
        ? "This attempt reads referenced files and supported external providers. Saved questions retain their original capture timestamps. Keep the Content page open; DevTools can stay closed."
        : "Reads authoring drafts in this tab. Progress is saved locally. Keep the Content page open; DevTools can stay closed.";
      count.textContent =
        state.counts.processed +
        "/" +
        state.counts.total +
        (mediaOnly
          ? " inventory entries retained · "
          : " inventory entries read · ") +
        state.counts.complete +
        " verified · " +
        state.counts.questions +
        " questions · " +
        Math.floor((stats.currentAttempt?.elapsedMs || 0) / 60000) +
        "m this attempt · " +
        (stats.currentAttempt?.requests || 0) +
        " API reads this attempt" +
        (budgetBase.elapsedMs
          ? " · " + Math.floor(stats.elapsedMs / 60000) + "m across attempts"
          : "");
      const summary = coverageSummary();
      state.coverage = summary;
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
      count.hidden = !meta || state.diagnosing;
      const busy = state.running || state.diagnosing || exporting;
      startButton.disabled = busy || state.terminal;
      accessButton.disabled = busy;
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
        await store.putItem(state.runId, fp.id, retained, row.state);
        const size = encoder.encode(JSON.stringify(row.fingerprint)).byteLength;
        summarizeItem(row.fingerprint, row.state?.processed === true, size);
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
      return bodies;
    }
    function itemBodies(fp) { return itemBodyEntries(fp).map(value => value.body); }
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
            if (podcast.reason) delivery.failures.push({streamFileId: candidate.streamFileId, reason: podcast.reason});
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
            ...(cmlMediaAttempt || {}),
            ...(fp.payload.directWidgetProviderEvidence
              ? {directWidgetProviderAttempt: fp.payload.directWidgetProviderEvidence}
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
      state.diagnosing = true;
      state.accessDiagnostic = null;
      accessText.textContent = "";
      accessFallback.hidden = true;
      state.phase = "Checking Panopto access";
      const checkedAt = new Date().toISOString(), checks = [], nativeFailures = [],
        requests = new Map();
      let stopReason = "";
      accessReader = createDirectDataReaderV1({
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
    async function copyAccessResult() {
      if (!state.accessDiagnostic || state.running || state.diagnosing || exporting) return;
      const text = directProviderAccessDiagnosticTextV1(state.accessDiagnostic);
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
      anchor.download = "CTI_PANOPTO_ACCESS_DIAGNOSTIC_" + courseId + "_" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    async function run() {
      if (
        state.running ||
        state.diagnosing ||
        exporting ||
        state.terminal ||
        location.origin !== "https://www.coursera.org" ||
        location.pathname !== initialPath
      )
        return;
      state.running = true;
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
      panoptoSources = new Map();
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
        const active = await store.getActiveRun({
            recoverExportLimit: true,
            recoverMediaGaps: true,
          }),
          candidate = [
            CTI_DIRECT_DATA_BUILD_V1,
            "v1.0.0-bound-authoring-drafts-20261014",
            "v1.1.0-compressed-resumable-drafts-20261014",
            "v1.2.0-bound-reading-media-20261014",
            "v1.3.0-deduplicated-original-archive-20261014",
            "v1.4.0-bound-content-integrity-20261015",
            "v1.5.0-bound-widget-configuration-20261015",
            "v1.6.0-integrated-panopto-bookmark-20261015",
          ].includes(active?.buildId)
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
        const resuming = candidate?.materialHash === currentMaterialHash;
        const baseCapture = candidate?.captureMeta?.directDataCapture;
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
        Object.assign(meta.directDataCapture, {
          finalMaterials: finalData,
          finalMaterialsReceipt: receipt(finalRead, courseId),
          finalMaterialHash: finalHash,
          sourceStable: finalHash === materialHash,
        });
        for (const fp of items)
          if (inventory.leaves.get(fp.id).structural) {
            fp.payload.directDataSources.receipts.stability.stable =
              finalHash === materialHash;
            directEmptyStructureContractV1(
              fp,
              { courseId, stableSource: finalHash === materialHash },
              inventory.leaves.get(fp.id).node,
            );
            await persist(fp, true);
          }
        if (finalHash !== materialHash)
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
        render(
          state.counts.complete +
            "/" +
            items.length +
            " verified. One capture file retains original media, published snapshots and every unresolved source.",
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
    };
    state.resume = () => void run();
    state.export = () => void download();
    state.start = () => void run();
    state.checkProviderAccess = () => void checkProviderAccess();
    startButton.onclick = state.start;
    accessButton.onclick = state.checkProviderAccess;
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
    });
    render("Choose Capture/resume course, or check only Panopto access without recapturing the course.");
  })().catch(() => {
    alert(
      "CTI capture could not start. Open the course Content page and try the bookmark again.",
    );
  });
})();
