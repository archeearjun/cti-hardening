import { createBrightspaceProgressPanelV110 } from "./progress.js";
import { createBrightspaceBodyStoreV120 } from "./body-store.js";
import { createBrightspaceArchiveV120 } from "./archive.js";
import {
  createBrightspaceCheckpointV110,
  loadBrightspacePreviousRecoveryV111,
} from "./checkpoint.js";
import {
  sha256,
  absoluteUrl,
  sameOrigin,
  findOrgUnitId,
  getId,
  activityTypeLabel,
  ctiDeclaredQuizCountFromText_,
  flattenTree,
  download,
} from "./text-and-dom.js";
import {
  topicEvidencePolicy,
  brightspaceNativeIdV110,
  fetchBrightspaceInventoryV110,
  brightspaceModuleChildrenV110,
} from "./evidence.js";
import {
  createBrightspaceContentReader,
  readBrightspaceJsonResponse,
} from "./content-reader.js";

/* CTI Brightspace v1.2.0. Bookmark entry: explicit on-page start, bounded GET-only
 * source observations, native identities, original bodies and honest gaps.
 * No learner attempts, submissions, posts, grades or tool launches are read. */
(async () => {
  "use strict";
  const VERSION = "v1.2.0",
    BUILD_ID = "v1.2.0-blob-archive-20261017",
    SCHEMA_VERSION = 2;
  const MAX_REQUESTS = 1200,
    MAX_JSON_BYTES = 4 * 1024 * 1024,
    MAX_API_BYTES = 32 * 1024 * 1024;
  const MAX_EXPORT_BYTES = 128 * 1024 * 1024,
    MAX_QUIZZES = 100,
    MAX_ASSIGNMENTS = 150,
    MAX_FORUMS = 100;
  const MAX_QUESTIONS_PER_QUIZ = 5000,
    MAX_DISCUSSION_TOPICS = 5000,
    MAX_MODULES = 20000,
    MAX_TOPICS = 50000;
  const REQUEST_DELAY_MS = 120;
  const origin = location.origin,
    startPage = { url: location.href, title: document.title, origin };
  const detection = findOrgUnitId(),
    courseId = String(detection.id || "");
  if (!/^\d{1,30}$/.test(courseId))
    throw Error(
      "Open the intended Brightspace course before using the capture bookmark. A numeric course Org Unit ID is required.",
    );
  const existing = window.__CTI_BRIGHTSPACE_PROGRESS__;
  if (
    existing?.isAlive?.() &&
    ((existing.snapshot()?.courseId === courseId &&
      existing.snapshot()?.buildId === BUILD_ID) ||
      existing.isRunning?.())
  ) {
    existing.reveal();
    return;
  }
  if (existing?.isAlive?.()) existing.dispose();
  const clean = (value) =>
    String(value == null ? "" : value)
      .replace(/\u0000/g, "")
      .trim();
  const now = () => new Date().toISOString();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function courseTitleV110() {
    const pageH1 = clean(document.querySelector("h1")?.textContent || "");
    let documentTitle = clean(document.title)
      .replace(/\s*[|]\s*Brightspace.*$/i, "")
      .replace(
        /^(?:Homepage|Content|Course Home|Course Admin(?:istration)?|Grades|Discussions|Assignments|Quizzes)\s*[-–—:]\s*/i,
        "",
      );
    if (
      pageH1 &&
      documentTitle.toLowerCase().startsWith(pageH1.toLowerCase() + " - ")
    )
      return clean(documentTitle.slice(pageH1.length + 3)) || documentTitle;
    const declared = clean(
      document.querySelector('[data-testid="course-title"]')?.textContent || "",
    );
    return declared || documentTitle || "Brightspace course";
  }
  const title = courseTitleV110();
  const slug = (value) =>
    clean(value)
      .replace(/[^a-z0-9._-]+/gi, "_")
      .slice(0, 100) || "course";
  let progress,
    activeController = null,
    lastCapture = null,
    previousFinishedCapture = null,
    previousFinishedCaptureRef = null,
    preparedCapture = null,
    preparedArchive = null,
    storageError = "",
    checkpointReady;
  const checkpoint = createBrightspaceCheckpointV110({
    courseId,
    buildId: BUILD_ID,
    origin,
    onError: (error) => {
      storageError = String(error?.message || error);
      progress?.update({ storageError, downloadAvailable: !!lastCapture });
      activeController?.abort(Error("CHECKPOINT_STORAGE_FAILED"));
    },
  });
  const previousRecovery = (finishedOnly = false) =>
    loadBrightspacePreviousRecoveryV111({
      courseId,
      buildId: BUILD_ID,
      origin,
      finishedOnly,
    });
  async function exportCapture(capture) {
    if (!capture) throw Error("There is no retained capture to download yet.");
    const json = JSON.stringify(capture), manifest = new Blob([json], {
      type: "application/json;charset=utf-8",
    });
    if (manifest.size > MAX_EXPORT_BYTES)
      throw Error(
        "Capture exceeds the 128 MiB export bound. Its recovery checkpoint and in-memory observations are retained; content was not silently truncated.",
      );
    if (capture.originalBodyTransport?.format === "CTI_BRIGHTSPACE_ARCHIVE_V1") {
      if (preparedCapture === capture && preparedArchive) {
        progress.setDownloadArtifact(preparedArchive, capture.exportFileName).click();
        return;
      }
      if (typeof CompressionStream !== "function")
        throw Error("This browser cannot compress the capture manifest. Use current Chrome and keep this tab open; its saved originals remain retained.");
      const store = createBrightspaceBodyStoreV120({
        origin, courseId, buildId: capture.buildId,
        runId: capture.originalBodyTransport.runId,
      });
      try {
        const compressed = await new Response(manifest.stream().pipeThrough(new CompressionStream("gzip"))).blob(),
          entries = [{ path: "capture.json.gz", blob: compressed }];
        for (const [hash, body] of Object.entries(capture.assetBodies || {})) {
          if (hash !== body.sha256) throw Error("BRIGHTSPACE_BODY_IDENTITY_INVALID");
          entries.push({ path: body.archivePath, blob: await store.get(body) });
        }
        const archive = await createBrightspaceArchiveV120(entries);
        preparedCapture = capture;
        preparedArchive = archive;
        // The URL remains on a real user-clickable link for browsers that block
        // the automatic download after asynchronous archive preparation.
        progress.setDownloadArtifact(archive, capture.exportFileName || "CTI__BRIGHTSPACE__ORG_" + courseId + "__v1.2.0.cti.zip").click();
      } finally { store.close(); }
      return;
    }
    // Earlier checkpoint downloads remain byte-equivalent historical JSON.
    download(
      capture.exportFileName ||
        "CTI__BRIGHTSPACE__ORG_" +
          courseId +
          "__" +
          (capture.buildId === "v1.1.0-faithful-bookmark-20261016"
            ? "v1.1.0"
            : capture.buildId === "v1.1.1-native-image-view-20261017" ? "v1.1.1" : VERSION) +
          "_s2__SOURCE_GROUND_TRUTH.json",
      json,
      "application/json;charset=utf-8",
    );
  }
  async function savedDownload() {
    if (!lastCapture && !previousFinishedCapture) {
      const finished =
        (await checkpoint.loadLatestFinished?.()) ||
        (await previousRecovery(true));
      previousFinishedCapture = finished?.state?.capture || null;
    }
    await exportCapture(lastCapture || previousFinishedCapture);
  }
  progress = createBrightspaceProgressPanelV110("CTI · Brightspace v1.2.0", {
    key: "__CTI_BRIGHTSPACE_PROGRESS__",
    courseId,
    buildId: BUILD_ID,
    runningKey: "__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__",
    onStart: async () => {
      await checkpointReady;
      if (storageError)
        throw Error(
          "Browser checkpoint storage is unavailable. Retry after allowing site storage; source reads have not started. " +
            storageError,
        );
      activeController = new AbortController();
      try {
        await runAttempt(activeController.signal);
      } finally {
        activeController = null;
        window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__ = false;
      }
    },
    onPause: () => activeController?.abort(Error("PAUSED_BY_OWNER")),
    onDownload: savedDownload,
  });
  checkpointReady = (async () => {
    try {
      const saved = (await checkpoint.load()) || (await previousRecovery());
      if (saved?.state) {
        if (saved.status === "FINISHED")
          previousFinishedCaptureRef = {
            runId: saved.runId,
            savedAt: saved.savedAt,
            buildId: saved.state.capture?.buildId || BUILD_ID,
          };
        lastCapture = saved.state.capture || null;
        previousFinishedCapture =
          previousFinishedCapture ||
          (saved.status === "FINISHED" ? lastCapture : null);
        previousFinishedCaptureRef =
          previousFinishedCaptureRef ||
          saved.state.previousFinishedCaptureRef ||
          null;
        if (lastCapture)
          window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_LAST__ = lastCapture;
        progress.update({
          phase:
            lastCapture?.buildId && lastCapture.buildId !== BUILD_ID
              ? "Earlier-version recovery available"
              : "Saved recovery available",
          detail:
            "Capture/resume makes fresh API and body observations. Saved observations keep their original timestamps and remain downloadable.",
          downloadAvailable: !!lastCapture,
        });
      } else
        progress.update({
          phase: "Ready to capture",
          detail:
            "Capture/resume reads this course. Keep this tab open; no network work starts before you choose the button.",
        });
    } catch (error) {
      storageError = String(error.message || error);
      progress.update({
        storageError,
        phase: "Checkpoint storage unavailable",
        detail: "Source reads have not started.",
      });
    }
  })();
  await checkpointReady;

  async function runAttempt(signal) {
    const startedAt = now(),
      attemptId = crypto.randomUUID();
    const bodyStore = createBrightspaceBodyStoreV120({
      origin, courseId, buildId: BUILD_ID, runId: attemptId,
      onError(error) {
        storageError = "Original-file storage failed: " + String(error.code || error.message) +
          ". Existing saved originals remain retained. Keep this tab open and download saved progress.";
        activeController?.abort(Error("ORIGINAL_STORAGE_FAILED"));
      },
    });
    try { await bodyStore.open(); }
    catch (error) { bodyStore.close(); throw error; }
    const diagnostics = [],
      permissionBlocks = [],
      captureWarnings = [],
      traversal = {
        complete: true,
        stopReasons: [],
        anomalies: [],
        modulesDiscovered: 0,
        topicsDiscovered: 0,
        limits: { modules: MAX_MODULES, topics: MAX_TOPICS, depth: 60 },
      };
    const apiAccess = {
      versions: { status: "NOT_STARTED" },
      contentRoot: { status: "NOT_STARTED" },
      contentModules: { status: "NOT_STARTED", fetched: 0, failed: 0 },
      contentTopics: { status: "NOT_STARTED", fetched: 0, failed: 0 },
      assignments: { status: "NOT_STARTED" },
      quizzes: { status: "NOT_STARTED" },
      discussions: { status: "NOT_STARTED" },
    };
    const inventoryEvidence = {
      content: traversal,
      assignments: null,
      quizzes: null,
      discussionForums: null,
      discussionTopics: {},
    };
    const contentTree = [],
      assignments = [],
      quizzes = [],
      discussions = [],
      seenModules = new Map(),
      seenTopics = new Set();
    let leVersion = "",
      requestCount = 0,
      apiObservedBytes = 0,
      lastCheckpointAt = 0,
      checkpointTopicCount = 0,
      rootInitial = null,
      rootUrl = "",
      stopped = null,
      complete = false,
      definitionReferencesComplete = true;
    if (lastCapture?.attempt?.status === "FINISHED")
      previousFinishedCapture = lastCapture;
    const active = () => {
      signal.throwIfAborted();
      if (storageError) throw Error("CHECKPOINT_STORAGE_FAILED");
      if (apiObservedBytes > MAX_API_BYTES) {
        const error = Error("Native API response-body budget reached.");
        error.code = "API_BYTE_CAP";
        throw error;
      }
    };
    const fatal = (error) => {
      if (
        signal.aborted ||
        ["REQUEST_CAP", "API_BYTE_CAP"].includes(error?.code)
      )
        throw error;
    };
    const gap = (kind, detail) => {
      traversal.complete = false;
      traversal.anomalies.push({ kind, ...detail });
    };
    async function request(url, options = {}) {
      active();
      const target = new URL(url, origin);
      if (
        target.origin !== origin ||
        target.username ||
        target.password ||
        target.hash
      )
        throw Error("OUT_OF_SCOPE_REQUEST");
      if (requestCount >= MAX_REQUESTS) {
        const error = Error(
          "Safety request limit reached. Remaining source references are unverified.",
        );
        error.code = "REQUEST_CAP";
        throw error;
      }
      requestCount++;
      progress.update({
        detail: options.label || target.pathname,
        count: requestCount + " requests started",
      });
      return fetch(target.href, {
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        cache: "no-store",
        redirect:
          options.purpose === "COURSE_ORIGINAL_BODY" &&
          options.redirect === "follow"
            ? "follow"
            : "error",
        signal: AbortSignal.any([
          signal,
          options.signal || signal,
          AbortSignal.timeout(30000),
        ]),
        headers: { Accept: options.accept || "*/*" },
      });
    }
    async function fetchJson(url, label) {
      const target = new URL(url, origin).href,
        observedAt = now();
      let response;
      try {
        response = await request(target, { label, accept: "application/json" });
        if (
          response.redirected ||
          new URL(response.url || target).origin !== origin
        )
          throw Error("REDIRECT_NOT_ALLOWED");
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          const error = Error(label + " returned HTTP " + response.status);
          error.status = response.status;
          error.permissionDenied = [401, 403].includes(response.status);
          if (error.permissionDenied)
            permissionBlocks.push({
              label,
              url: target,
              status: response.status,
              at: observedAt,
            });
          throw error;
        }
        const value = await readBrightspaceJsonResponse(response, {
          signal,
          maxBytes: MAX_JSON_BYTES,
          onBytes: (bytes) => {
            apiObservedBytes += bytes;
            if (apiObservedBytes > MAX_API_BYTES) {
              const error = Error(
                "Native API response-body byte budget reached.",
              );
              error.code = "API_BYTE_CAP";
              throw error;
            }
          },
        });
        diagnostics.push({
          label,
          url: target,
          status: response.status,
          ok: true,
          observedAt,
        });
        return value;
      } catch (error) {
        diagnostics.push({
          label,
          url: target,
          status: response?.status || error.status || 0,
          ok: false,
          observedAt,
          error: String(error.message || error),
        });
        throw error;
      }
    }
    const reader = createBrightspaceContentReader({
      origin,
      signal,
      request,
      maxAssetBytes: 64 * 1024 * 1024,
      maxTotalBytes: 768 * 1024 * 1024,
      maxRetainedBytes: 512 * 1024 * 1024,
      retainOriginal: (bytes, hash) => bodyStore.put(bytes, hash),
      sha256: async (bytes) => {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      },
    });
    const pages = (path, label, limit, idFields) =>
      fetchBrightspaceInventoryV110({
        initialUrl: new URL(path, origin).href,
        label,
        limit,
        idFields,
        fetchJson,
        sleep,
        delayMs: REQUEST_DELAY_MS,
        check: active,
      });
    function richText(value, depth = 0) {
      if (value == null || depth > 12) return { html: "", text: "" };
      if (typeof value === "object") {
        const nested = value.Text ?? value.text,
          html = value.Html ?? value.html ?? value.Content ?? value.content;
        if (typeof html === "string")
          return { html, text: html.replace(/<[^>]*>/g, " ") };
        return richText(nested, depth + 1);
      }
      if (typeof value !== "string") return { html: "", text: "" };
      return /<[^>]+>/.test(value)
        ? { html: value, text: value.replace(/<[^>]*>/g, " ") }
        : { html: "", text: value };
    }
    async function descriptionReferences(value, kind, id, path, parentId) {
      const rich = richText(value);
      if (id && rich.html)
        await reader.readReferences(
          reader.discoverReferences(
            rich.html,
            { kind, id, path, ...(parentId ? { parentId } : {}) },
            startPage.url,
          ),
        );
      return rich;
    }
    async function nativeDefinitionReferences(value, kind, id, path, parentId) {
      if (!id) return;
      let visited = 0;
      const sourceBinding = {
        kind,
        id,
        path,
        ...(parentId ? { parentId } : {}),
      };
      const walk = async (node, depth, key) => {
        active();
        if (++visited > 50000 || depth > 20) {
          definitionReferencesComplete = false;
          return;
        }
        if (typeof node === "string") {
          if (
            /<(?:a|area|img|iframe|embed|object|video|audio|source|track)\b/i.test(
              node,
            )
          )
            await reader.readReferences(
              reader.discoverReferences(node, sourceBinding, startPage.url),
            );
          else if (
            /(?:url|href|src)$/i.test(key || "") &&
            node &&
            !/^javascript:/i.test(node)
          )
            await reader.readReferences([
              {
                url: absoluteUrl(node, startPage.url),
                rawUrl: node,
                tag: "native-property",
                sourceBinding,
                property: key,
              },
            ]);
        } else if (Array.isArray(node)) {
          for (const child of node) {
            if (visited >= 50000) {
              definitionReferencesComplete = false;
              break;
            }
            await walk(child, depth + 1, key);
          }
        } else if (node && typeof node === "object")
          for (const [field, child] of Object.entries(node)) {
            if (visited >= 50000) {
              definitionReferencesComplete = false;
              break;
            }
            await walk(child, depth + 1, field);
          }
      };
      await walk(value, 0, "");
    }
    function snapshot(status, reason = "") {
      const flat = flattenTree(contentTree, []),
        modules = flat.filter((node) => node.kind === "MODULE"),
        topics = flat.filter((node) => node.kind === "TOPIC");
      const acquired = reader.snapshot(),
        assetBodies = acquired.assetBodies;
      delete acquired.assetBodies;
      const runtimeCarriers = topics
        .filter((topic) =>
          [7, 20, 21, 22, 23, 24, 26, 27].includes(Number(topic.activityType)),
        )
        .map((topic) => ({
          id: topic.id,
          title: topic.title,
          path: topic.path,
          url: topic.url,
          typeIdentifier: topic.typeIdentifier,
          activityType: topic.activityType,
          activityTypeLabel: topic.activityTypeLabel,
          toolId: topic.toolId,
          toolItemId: topic.toolItemId,
          family: /scorm/i.test(topic.activityTypeLabel)
            ? "SCORM"
            : /lti/i.test(topic.activityTypeLabel)
              ? "LTI"
              : "RUNTIME_CARRIER",
        }));
      const interactiveEmbeds = topics.flatMap((topic) =>
        (topic.contentEvidence?.embeds || []).map((embed) => ({
          topicId: topic.id,
          topicTitle: topic.title,
          path: topic.path,
          tag: embed.tag,
          url: embed.url,
          family: /panopto/i.test(embed.url)
            ? "PANOPTO"
            : /yuja/i.test(embed.url)
              ? "YUJA"
              : /youtube|vimeo/i.test(embed.url)
                ? "VIDEO_EMBED"
                : /h5p/i.test(embed.url)
                  ? "H5P"
                  : embed.kind || "EMBED",
        })),
      );
      const providerReferences = Array.from(
        new Map(
          acquired.gaps
            .filter(
              (row) =>
                ["PANOPTO", "YUJA", "LTI"].includes(row.kind) ||
                /panopto|yuja|type=lti/i.test(row.url || ""),
            )
            .map((row) => [
              JSON.stringify([row.sourceBinding, row.url]),
              {
                url: row.url,
                sourceBinding: row.sourceBinding,
                provider: /panopto/i.test(row.url)
                  ? "PANOPTO"
                  : /yuja/i.test(row.url)
                    ? "YUJA"
                    : "LTI",
                status: "REFERENCE_ONLY_NOT_FETCHED",
              },
            ]),
        ).values(),
      );
      const quizCountMismatches = quizzes
        .filter((quiz) => quiz.questionCountStatus === "MISMATCH")
        .map((quiz) => ({
          id: quiz.id,
          name: quiz.name,
          declared: quiz.declaredQuestionCount,
          captured: quiz.questions.length,
        }));
      const inventories = [
        inventoryEvidence.assignments,
        inventoryEvidence.quizzes,
        inventoryEvidence.discussionForums,
        ...Object.values(inventoryEvidence.discussionTopics),
      ];
      const inventoryComplete =
        traversal.complete &&
        inventories.every((receipt) => receipt?.complete === true);
      const pageBodiesComplete = topics.every((topic) =>
        ["CAPTURED", "CAPTURED_ORIGINAL"].includes(
          topic.contentEvidence?.status,
        ),
      );
      const warnings = [...captureWarnings];
      if (!inventoryComplete)
        warnings.push(
          "One or more native inventories, identities or module placements remain incomplete. Captured counts are not verified course totals.",
        );
      if (quizzes.length)
        warnings.push(
          "Quiz definitions retain native IDs, duplicates and missing-ID anomalies. API paging does not establish the complete question library, random pools or authored variants.",
        );
      if (acquired.gaps.length)
        warnings.push(
          acquired.gaps.length +
            " original-content references remain unresolved or intentionally unlaunched.",
        );
      if (reason) warnings.push(reason);
      return {
        schemaVersion: SCHEMA_VERSION,
        extractor:
          "CTI Source LMS Ground-Truth Extractor — Brightspace " + VERSION,
        buildId: BUILD_ID,
        originalBodyTransport: {
          format: "CTI_BRIGHTSPACE_ARCHIVE_V1", version: 1,
          bodyEncoding: "archive", hashAlgorithm: "SHA-256", runId: attemptId,
        },
        capturedAt: now(),
        startedAt,
        attempt: {
          id: attemptId,
          status,
          finished: status === "FINISHED",
          metadataObservation: "FRESH_THIS_ATTEMPT",
          bodyObservation: "FRESH_THIS_ATTEMPT",
          checkpointReuse:
            "Historical recovery only; cached observations are not re-labelled as fresh.",
        },
        page: startPage,
        finalPage: {
          url: location.href,
          title: document.title,
          origin: location.origin,
        },
        course: {
          orgUnitId: courseId,
          orgUnitDetection: detection,
          title,
          leApiVersion: leVersion,
        },
        safety: {
          readOnly: true,
          methodsUsed: ["GET"],
          intentionallyNotCollected: [
            "learner submissions",
            "quiz attempts",
            "discussion posts",
            "grades",
            "classlist/user roster",
            "private messages",
          ],
          externalUrlsFetched: false,
          uiClicksPerformed: false,
          permissionRule:
            "401/403 remains unavailable; no alternate permission workaround.",
          maxRequests: MAX_REQUESTS,
          requestDelayMs: REQUEST_DELAY_MS,
        },
        requestCount,
        apiObservedBytes,
        byteAccounting:
          "Browser-exposed decoded response-body bytes, not wire bytes.",
        permissionBlocks,
        apiAccess,
        inventoryEvidence,
        captureCoverage: {
          inventoryComplete,
          pageBodiesComplete,
          definitionCoverageComplete: false,
          originalReferencesComplete:
            acquired.gaps.length === 0 && definitionReferencesComplete,
          definitionReferenceDiscoveryComplete: definitionReferencesComplete,
          originalReferenceScope:
            "Supported explicit URL and HTML references in captured native models; unsupported tool internals, implicit attachment IDs, libraries and variants are not established.",
          wholeCourseComplete: false,
          meaning:
            "Inventory, returned definitions, original bodies and external providers have separate evidence. No empty API response or unavailable source is treated as authored absence.",
        },
        summary: {
          modules: modules.length,
          topics: topics.length,
          assignments: assignments.length,
          quizzes: quizzes.length,
          quizQuestions: quizzes.reduce(
            (sum, quiz) => sum + quiz.questions.length,
            0,
          ),
          discussionForums: discussions.length,
          discussionTopics: discussions.reduce(
            (sum, forum) => sum + forum.topics.length,
            0,
          ),
          runtimeCarriers: runtimeCarriers.length,
          scormPackages: runtimeCarriers.filter((row) => row.family === "SCORM")
            .length,
          ltiActivities: runtimeCarriers.filter((row) => row.family === "LTI")
            .length,
          interactiveEmbedCount: interactiveEmbeds.filter(
            (row) => !["PANOPTO", "YUJA", "VIDEO_EMBED"].includes(row.family),
          ).length,
          interactiveHtmlTopics: new Set(
            interactiveEmbeds.map((row) => row.topicId),
          ).size,
          videoEmbeds: interactiveEmbeds.filter((row) =>
            ["PANOPTO", "YUJA", "VIDEO_EMBED"].includes(row.family),
          ).length,
          quizDeclaredCountMismatches: quizCountMismatches.length,
          quizQuestionCoverageUnverified: quizzes.length,
          topicsWithCapturedPageText: topics.filter(
            (topic) => topic.contentEvidence?.status === "CAPTURED",
          ).length,
          topicsWithDefinitionOnlyEvidence: topics.filter(
            (topic) => topic.contentEvidence?.status === "DEFINITION_API_ONLY",
          ).length,
          topicsWithExternalOrBinaryContent: topics.filter(
            (topic) => topic.contentEvidence?.status !== "CAPTURED",
          ).length,
          providerReferences: {
            panopto: providerReferences.filter(
              (row) => row.provider === "PANOPTO",
            ).length,
            yuja: providerReferences.filter((row) => row.provider === "YUJA")
              .length,
            lti: providerReferences.filter((row) => row.provider === "LTI")
              .length,
          },
          originalBodies: Object.keys(assetBodies).length,
          originalBodyBytes: acquired.retainedBytes,
        },
        contentTree,
        assignments,
        quizzes,
        discussions,
        runtimeCarriers,
        interactiveEmbeds,
        providerReferences,
        quizCountMismatches,
        captureWarnings: warnings,
        assetBodies,
        contentAcquisition: acquired,
        domFallback: {
          headings: [],
          visibleLinks: [],
          currentPageText: "",
          status: "DYNAMIC_PAGE_BODY_NOT_COLLECTED",
        },
        diagnostics,
        runtime: progress.snapshot(),
        exportFileName:
          "CTI__BRIGHTSPACE__" +
          slug(title) +
          "__ORG_" +
          courseId +
          "__" +
          now().replace(/[:.]/g, "-") +
          "__v1.2.0_s2__SOURCE_GROUND_TRUTH.cti.zip",
      };
    }
    async function saveCheckpoint(
      force = false,
      status = "PARTIAL",
      reason = "",
    ) {
      const time = Date.now();
      if (
        !force &&
        traversal.topicsDiscovered - checkpointTopicCount < 10 &&
        time - lastCheckpointAt < 5000
      )
        return;
      const capture = snapshot(status, reason);
      lastCapture = capture;
      window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_LAST__ = capture;
      progress.update({ downloadAvailable: true });
      try {
        const receipt = await checkpoint.save(
          { capture, previousFinishedCaptureRef },
          { status },
        );
        if (status === "FINISHED")
          previousFinishedCaptureRef = {
            runId: receipt.runId,
            savedAt: receipt.savedAt,
          };
        lastCheckpointAt = time;
        checkpointTopicCount = traversal.topicsDiscovered;
        progress.update({ checkpointSavedAt: now() });
      } catch (error) {
        storageError = String(error.message || error);
        progress.update({ storageError, downloadAvailable: true });
        throw error;
      }
    }
    async function normalizeTopic(topic, path, target) {
      active();
      if (traversal.topicsDiscovered >= MAX_TOPICS) {
        gap("TOPIC_LIMIT", { path });
        return {
          kind: "TOPIC",
          id: "",
          title: clean(topic?.Title || topic?.Name),
          path,
          raw: topic,
          contentEvidence: { status: "NOT_READ", reason: "TOPIC_LIMIT" },
        };
      }
      traversal.topicsDiscovered++;
      const id = brightspaceNativeIdV110(topic, [
        "Id",
        "TopicId",
        "id",
        "topicId",
      ]);
      const out = {
        kind: "TOPIC",
        id,
        title: clean(topic.Title || topic.Name || topic.title || ""),
        path: path.slice(),
        raw: topic,
        contentEvidence: {
          status: "NOT_READ",
          reason: "Body reading has not completed.",
        },
      };
      target.push(out);
      if (!id) {
        gap("MISSING_OR_INVALID_TOPIC_ID", { path, title: out.title });
        out.contentEvidence = {
          status: "UNVERIFIED",
          reason: "MISSING_NATIVE_ID",
        };
        return out;
      }
      if (seenTopics.has(id)) gap("DUPLICATE_TOPIC_ID", { id, path });
      seenTopics.add(id);
      let detail = topic;
      try {
        detail = await fetchJson(
          "/d2l/api/le/" + leVersion + "/" + courseId + "/content/topics/" + id,
          "Content topic " + id,
        );
        const returnedId = brightspaceNativeIdV110(detail, [
          "Id",
          "TopicId",
          "id",
          "topicId",
        ]);
        if (returnedId !== id) throw Error("TOPIC_RESPONSE_ID_MISMATCH");
        apiAccess.contentTopics.fetched++;
      } catch (error) {
        fatal(error);
        apiAccess.contentTopics.failed++;
        apiAccess.contentTopics.status = "PARTIAL";
        out.definitionError = String(error.message || error);
        detail = topic;
      }
      Object.assign(out, {
        rawDetail: detail,
        title: clean(
          detail.Title || detail.Name || topic.Title || topic.Name || "",
        ),
        topicType: detail.TopicType ?? topic.TopicType ?? null,
        contentType: detail.Type ?? topic.Type ?? null,
        typeIdentifier: clean(
          detail.TypeIdentifier || topic.TypeIdentifier || "",
        ),
        activityId:
          getId(detail, ["ActivityId", "activityId"]) ??
          getId(topic, ["ActivityId", "activityId"]) ??
          null,
        activityType: detail.ActivityType ?? topic.ActivityType ?? null,
        activityTypeLabel: activityTypeLabel(
          detail.ActivityType ?? topic.ActivityType,
        ),
        parentModuleId:
          brightspaceNativeIdV110(detail, ["ParentModuleId"]) ||
          brightspaceNativeIdV110(topic, ["ParentModuleId"]) ||
          null,
        toolId:
          brightspaceNativeIdV110(detail, ["ToolId"]) ||
          brightspaceNativeIdV110(topic, ["ToolId"]) ||
          null,
        toolItemId:
          brightspaceNativeIdV110(detail, ["ToolItemId"]) ||
          brightspaceNativeIdV110(topic, ["ToolItemId"]) ||
          null,
        lastModifiedDate:
          detail.LastModifiedDate || topic.LastModifiedDate || null,
        url: absoluteUrl(
          detail.Url || detail.URL || topic.Url || topic.URL || "",
        ),
        isHidden: detail.IsHidden ?? topic.IsHidden ?? null,
        isLocked: detail.IsLocked ?? topic.IsLocked ?? null,
        isBroken: detail.IsBroken ?? topic.IsBroken ?? null,
        description: richText(detail.Description || topic.Description),
      });
      // Publish the exact native owner/model before any asset can be retained:
      // a pause during acquisition must still export a bound partial capture.
      await descriptionReferences(out.description, "TOPIC", id, path);
      await nativeDefinitionReferences(detail, "TOPIC", id, path);
      out.evidencePolicy = topicEvidencePolicy(out.activityType, out.url);
      out.contentEvidence = out.url
        ? await reader.readTopic(out, {
            onEvidence(evidence) {
              out.contentEvidence = evidence;
            },
          })
        : { status: "NO_URL", reason: "No authored body URL was returned." };
      if (apiAccess.contentTopics.status === "NOT_STARTED")
        apiAccess.contentTopics.status = "PASS";
      progress.update({
        detail: out.title,
        count: traversal.topicsDiscovered + " topics read",
      });
      return out;
    }
    async function normalizeModule(
      module,
      parentPath,
      ancestors = [],
      source = "API",
      target = contentTree,
    ) {
      active();
      const id = brightspaceNativeIdV110(module, [
          "Id",
          "ModuleId",
          "id",
          "moduleId",
        ]),
        name = clean(module.Title || module.Name || module.title || ""),
        path = parentPath.concat([name]);
      const out = {
        kind: "MODULE",
        id,
        title: name,
        path,
        raw: module,
        isHidden: module.IsHidden ?? null,
        isLocked: module.IsLocked ?? null,
        description: richText(module.Description),
        children: [],
        structureEvidence: { status: "NOT_READ", complete: false, source },
      };
      target.push(out);
      if (
        traversal.modulesDiscovered >= MAX_MODULES ||
        ancestors.length >= 60
      ) {
        out.structureEvidence.status = "LIMIT";
        gap("MODULE_OR_DEPTH_LIMIT", { id, path });
        return out;
      }
      traversal.modulesDiscovered++;
      let children = brightspaceModuleChildrenV110(module),
        apiFailed = false;
      if (!id) {
        out.structureEvidence.status = "MISSING_NATIVE_ID";
        gap("MISSING_OR_INVALID_MODULE_ID", { path });
      } else if (ancestors.includes(id)) {
        out.structureEvidence.status = "CYCLE_REFERENCE";
        out.structureEvidence.referencePath = seenModules.get(id);
        gap("MODULE_CYCLE", { id, path });
        return out;
      } else if (seenModules.has(id)) {
        out.structureEvidence.status = "REUSED_REFERENCE";
        out.structureEvidence.referencePath = seenModules.get(id);
        gap("MODULE_REUSE_REFERENCE", { id, path });
        return out;
      } else {
        seenModules.set(id, path.slice());
        await descriptionReferences(module.Description, "MODULE", id, path);
        try {
          const raw = await fetchJson(
            "/d2l/api/le/" +
              leVersion +
              "/" +
              courseId +
              "/content/modules/" +
              id +
              "/structure/",
            "Module structure " + id,
          );
          const parsed = brightspaceModuleChildrenV110(raw);
          if (!parsed.recognized) throw Error("UNRECOGNIZED_MODULE_STRUCTURE");
          children = parsed;
          out.rawStructure = raw;
          out.structureEvidence = {
            status: "CAPTURED",
            complete: true,
            source: "API",
            ordering: parsed.ordering,
          };
          apiAccess.contentModules.fetched++;
        } catch (error) {
          fatal(error);
          apiFailed = true;
          apiAccess.contentModules.failed++;
          apiAccess.contentModules.status = "PARTIAL";
          out.structureEvidence = {
            status: children.recognized ? "INLINE_FALLBACK" : "UNAVAILABLE",
            complete: children.recognized,
            source,
            reason: String(error.message || error),
            ordering: children.ordering,
          };
          if (!children.recognized)
            gap("MODULE_STRUCTURE_UNAVAILABLE", { id, path });
        }
      }
      if (children.recognized) {
        if (out.structureEvidence.status === "NOT_READ")
          out.structureEvidence = {
            status: "INLINE_FALLBACK",
            complete: false,
            source,
            ordering: children.ordering,
          };
        for (const child of children.children) {
          active();
          if (child.kind === "MODULE")
            await normalizeModule(
              child.raw,
              path,
              id ? ancestors.concat([id]) : ancestors,
              apiFailed ? source : "API",
              out.children,
            );
          else if (child.kind === "TOPIC")
            await normalizeTopic(child.raw, path, out.children);
          else {
            out.children.push({
              kind: "UNRECOGNIZED",
              raw: child.raw,
              ordinal: child.ordinal,
              path,
            });
            out.structureEvidence.complete = false;
            gap("UNRECOGNIZED_CONTENT_ROW", {
              moduleId: id,
              path,
              ordinal: child.ordinal,
            });
          }
          await saveCheckpoint();
          await sleep(REQUEST_DELAY_MS);
        }
      }
      if (apiAccess.contentModules.status === "NOT_STARTED")
        apiAccess.contentModules.status = "PASS";
      await saveCheckpoint();
      return out;
    }
    try {
      progress.update({ phase: "Check API access", detail: title });
      const versions = await fetchJson("/d2l/api/le/versions/", "LE versions");
      leVersion = String(
        versions.LatestVersion ||
          (Array.isArray(versions.SupportedVersions)
            ? versions.SupportedVersions.at(-1)
            : "") ||
          "",
      );
      if (!/^\d+\.\d+$/.test(leVersion))
        throw Error(
          "No supported numeric Brightspace LE API version was returned.",
        );
      apiAccess.versions = { status: "PASS", version: leVersion };
      progress.update({
        phase: "Read modules and topics",
        detail: "Reading fresh source definitions and referenced originals.",
      });
      try {
        let roots;
        try {
          rootUrl =
            "/d2l/api/le/" + leVersion + "/" + courseId + "/content/root/";
          rootInitial = await fetchJson(rootUrl, "Content root");
          roots = Array.isArray(rootInitial)
            ? rootInitial
            : rootInitial.Modules || rootInitial.Objects || rootInitial.Items;
          if (!Array.isArray(roots)) throw Error("UNRECOGNIZED_CONTENT_ROOT");
          apiAccess.contentRoot = { status: "PASS", source: "ROOT" };
        } catch (error) {
          fatal(error);
          apiAccess.contentRoot = {
            status: error.permissionDenied
              ? "PERMISSION_DENIED"
              : "UNAVAILABLE",
            error: String(error.message || error),
          };
          if (error.permissionDenied) throw error;
          rootUrl =
            "/d2l/api/le/" + leVersion + "/" + courseId + "/content/toc";
          rootInitial = await fetchJson(rootUrl, "Content TOC");
          roots = Array.isArray(rootInitial)
            ? rootInitial
            : rootInitial.Modules || rootInitial.Objects || rootInitial.Items;
          if (!Array.isArray(roots)) throw Error("UNRECOGNIZED_CONTENT_TOC");
          apiAccess.contentToc = { status: "PASS" };
        }
        traversal.rootSource = {
          url: new URL(rootUrl, origin).href,
          raw: rootInitial,
          observedAt: now(),
        };
        for (const row of roots) {
          await normalizeModule(
            row,
            [],
            [],
            apiAccess.contentToc ? "TOC" : "ROOT",
            contentTree,
          );
          await saveCheckpoint();
        }
      } catch (error) {
        fatal(error);
        traversal.complete = false;
        traversal.stopReasons.push("CONTENT_INVENTORY_UNAVAILABLE");
        captureWarnings.push(
          "Content inventory unavailable: " + String(error.message || error),
        );
      }
      progress.update({ phase: "Read assignments" });
      try {
        const assignmentPages = await pages(
          "/d2l/api/le/" + leVersion + "/" + courseId + "/dropbox/folders/",
          "Assignments list",
          MAX_ASSIGNMENTS,
          ["Id", "FolderId", "id", "folderId"],
        );
        inventoryEvidence.assignments = assignmentPages.evidence;
        apiAccess.assignments = {
          status: assignmentPages.evidence.complete ? "PASS" : "PARTIAL",
          inventoryEvidence: assignmentPages.evidence,
        };
        for (const raw of assignmentPages.objects) {
          active();
          const id = brightspaceNativeIdV110(raw, [
            "Id",
            "FolderId",
            "id",
            "folderId",
          ]);
          let instructions = { html: "", text: "" };
          for (const field of [
            "CustomInstructions",
            "Instructions",
            "Description",
            "description",
          ]) {
            const candidate = richText(raw[field]);
            if (candidate.html || candidate.text) {
              instructions = candidate;
              break;
            }
          }
          const assignment = {
            id,
            name: clean(raw.Name || raw.Title || ""),
            type: raw.Type ?? null,
            categoryId: raw.CategoryId ?? null,
            startDate: raw.StartDate || null,
            endDate: raw.EndDate || null,
            dueDate: raw.DueDate || null,
            isHidden: raw.IsHidden ?? null,
            assessment: raw.Assessment || null,
            instructions,
            raw,
          };
          assignments.push(assignment);
          if (id)
            await nativeDefinitionReferences(raw, "ASSIGNMENT", id, [
              assignment.name,
            ]);
          await saveCheckpoint();
        }
      } catch (error) {
        fatal(error);
        apiAccess.assignments = {
          status: error.permissionDenied ? "PERMISSION_DENIED" : "UNAVAILABLE",
          error: String(error.message || error),
        };
        inventoryEvidence.assignments = inventoryEvidence.assignments || {
          complete: false,
          stopReason: "ASSIGNMENT_INVENTORY_UNAVAILABLE",
        };
      }
      progress.update({ phase: "Read quizzes" });
      try {
        const quizPages = await pages(
          "/d2l/api/le/" + leVersion + "/" + courseId + "/quizzes/",
          "Quizzes list",
          MAX_QUIZZES,
          ["QuizId", "Id", "quizId", "id"],
        );
        inventoryEvidence.quizzes = quizPages.evidence;
        apiAccess.quizzes = {
          status: quizPages.evidence.complete ? "PASS" : "PARTIAL",
          inventoryEvidence: quizPages.evidence,
        };
        for (const raw of quizPages.objects) {
          active();
          const id = brightspaceNativeIdV110(raw, [
              "QuizId",
              "Id",
              "quizId",
              "id",
            ]),
            description = richText(raw.Description || raw.description);
          const quiz = {
            id,
            name: clean(raw.Name || raw.Title || ""),
            description,
            isActive: raw.IsActive ?? null,
            startDate: raw.StartDate || null,
            endDate: raw.EndDate || null,
            dueDate: raw.DueDate || null,
            attemptsAllowed: raw.AttemptsAllowed ?? null,
            timeLimit: raw.SubmissionTimeLimit ?? raw.TimeLimit ?? null,
            raw,
            questions: [],
            questionsStatus: "NOT_REQUESTED",
          };
          quizzes.push(quiz);
          await nativeDefinitionReferences(raw, "QUIZ", id, [quiz.name]);
          if (id)
            try {
              const questionPages = await pages(
                "/d2l/api/le/" +
                  leVersion +
                  "/" +
                  courseId +
                  "/quizzes/" +
                  id +
                  "/questions/",
                "Quiz questions " + id,
                MAX_QUESTIONS_PER_QUIZ,
                ["QuestionId", "questionId"],
              );
              quiz.questions = questionPages.objects;
              quiz.questionPageEvidence = questionPages.evidence;
              quiz.questionsStatus = questionPages.evidence.complete
                ? "CAPTURED"
                : "PARTIAL";
              for (const question of quiz.questions)
                await nativeDefinitionReferences(question, "QUIZ", id, [
                  quiz.name,
                ]);
            } catch (error) {
              fatal(error);
              quiz.questionsStatus = "UNAVAILABLE";
              quiz.questionsError = String(error.message || error);
            }
          quiz.declaredQuestionCount = ctiDeclaredQuizCountFromText_(
            description.text,
          );
          quiz.capturedQuestionCount = quiz.questions.length;
          quiz.questionCountStatus =
            quiz.questionsStatus !== "CAPTURED"
              ? "UNAVAILABLE"
              : quiz.declaredQuestionCount == null
                ? "CAPTURED_NO_DECLARED_COUNT"
                : quiz.declaredQuestionCount === quiz.questions.length
                  ? "MATCH"
                  : "MISMATCH";
          quiz.questionCoverage = {
            definitionCount: quiz.questions.length,
            status:
              quiz.questionsStatus !== "CAPTURED"
                ? "PARTIAL_OR_UNAVAILABLE"
                : quiz.questions.length
                  ? "TOTAL_UNVERIFIED"
                  : "NO_DEFINITIONS_RETURNED",
            completenessVerified: false,
            describedCountMatchesDefinitions:
              quiz.questionsStatus === "CAPTURED" &&
              quiz.declaredQuestionCount != null &&
              quiz.declaredQuestionCount === quiz.questions.length,
            meaning:
              "Native returned rows are retained without synthesizing IDs. API pages and described exam length do not establish question-library totals or pool membership.",
          };
          await saveCheckpoint();
        }
      } catch (error) {
        fatal(error);
        apiAccess.quizzes = {
          status: error.permissionDenied ? "PERMISSION_DENIED" : "UNAVAILABLE",
          error: String(error.message || error),
        };
        inventoryEvidence.quizzes = inventoryEvidence.quizzes || {
          complete: false,
          stopReason: "QUIZ_INVENTORY_UNAVAILABLE",
        };
      }
      progress.update({ phase: "Read discussions" });
      try {
        const forumPages = await pages(
          "/d2l/api/le/" + leVersion + "/" + courseId + "/discussions/forums/",
          "Discussion forums",
          MAX_FORUMS,
          ["ForumId", "Id", "forumId", "id"],
        );
        inventoryEvidence.discussionForums = forumPages.evidence;
        apiAccess.discussions = {
          status: forumPages.evidence.complete ? "PASS" : "PARTIAL",
          inventoryEvidence: forumPages.evidence,
        };
        for (const raw of forumPages.objects) {
          active();
          const id = brightspaceNativeIdV110(raw, [
              "ForumId",
              "Id",
              "forumId",
              "id",
            ]),
            forum = {
              id,
              name: clean(raw.Name || raw.Title || ""),
              description: richText(raw.Description || raw.description),
              isHidden: raw.IsHidden ?? null,
              raw,
              topics: [],
              topicsStatus: "NOT_REQUESTED",
            };
          discussions.push(forum);
          await nativeDefinitionReferences(raw, "DISCUSSION", id, [forum.name]);
          if (id)
            try {
              const topicPages = await pages(
                "/d2l/api/le/" +
                  leVersion +
                  "/" +
                  courseId +
                  "/discussions/forums/" +
                  id +
                  "/topics/",
                "Discussion topics " + id,
                MAX_DISCUSSION_TOPICS,
                ["TopicId", "Id", "topicId", "id"],
              );
              forum.topics = topicPages.objects;
              forum.topicPageEvidence = topicPages.evidence;
              inventoryEvidence.discussionTopics[id] = topicPages.evidence;
              forum.topicsStatus = topicPages.evidence.complete
                ? "CAPTURED"
                : "PARTIAL";
              for (const topic of forum.topics) {
                const topicId = brightspaceNativeIdV110(topic, [
                  "TopicId",
                  "Id",
                  "topicId",
                  "id",
                ]);
                await nativeDefinitionReferences(
                  topic,
                  "DISCUSSION_TOPIC",
                  topicId,
                  [forum.name, clean(topic.Name || topic.Title)],
                  id,
                );
              }
            } catch (error) {
              fatal(error);
              forum.topicsStatus = "UNAVAILABLE";
              forum.topicsError = String(error.message || error);
              apiAccess.discussions.status = "PARTIAL";
            }
          await saveCheckpoint();
        }
      } catch (error) {
        fatal(error);
        apiAccess.discussions = {
          status: error.permissionDenied ? "PERMISSION_DENIED" : "UNAVAILABLE",
          error: String(error.message || error),
        };
        inventoryEvidence.discussionForums =
          inventoryEvidence.discussionForums || {
            complete: false,
            stopReason: "DISCUSSION_INVENTORY_UNAVAILABLE",
          };
      }
      active();
      progress.update({ phase: "Check source stability" });
      try {
        if (
          !rootInitial ||
          apiAccess.contentRoot.status === "PERMISSION_DENIED"
        )
          throw Error("INITIAL_CONTENT_INVENTORY_UNAVAILABLE");
        const finalRoot = await fetchJson(rootUrl, "Final content root"),
          initialHash = await sha256(JSON.stringify(rootInitial)),
          finalHash = await sha256(JSON.stringify(finalRoot));
        traversal.rootStability = {
          initialModelSha256: initialHash,
          finalModelSha256: finalHash,
          status: initialHash === finalHash ? "UNCHANGED" : "CHANGED",
          scope:
            "Content-root model only; individual definition stability remains unverified.",
        };
        if (initialHash !== finalHash) gap("CONTENT_ROOT_CHANGED", {});
      } catch (error) {
        fatal(error);
        traversal.rootStability = {
          status: "UNAVAILABLE",
          reason: String(error.message || error),
        };
        gap("FINAL_CONTENT_ROOT_UNAVAILABLE", {});
      }
      complete = true;
    } catch (error) {
      stopped = error;
      traversal.complete = false;
      traversal.stopReasons.push(
        signal.aborted
          ? "PAUSED_OR_ABORTED"
          : error.code || "CAPTURE_INTERRUPTED",
      );
      captureWarnings.push(
        "Capture stopped before all planned reads: " +
          String(error.message || error),
      );
    } finally {
      const status = complete
        ? "FINISHED"
        : signal.aborted
          ? "PAUSED"
          : "PARTIAL";
      const capture = snapshot(status);
      lastCapture = capture;
      window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_LAST__ = capture;
      progress.update({ downloadAvailable: true });
      try {
        await saveCheckpoint(true, status);
      } catch (error) {
        progress.update({
          storageError: String(error.message || error),
          downloadAvailable: true,
        });
      }
      if (complete) {
        try {
          await exportCapture(capture);
        } catch (error) {
          capture.exportError = String(error.message || error);
          progress.finish(
            "error",
            capture.exportError,
            "Recovery observations remain available.",
          );
          bodyStore.close();
          return;
        }
        progress.finish(
          "review",
          "Your source capture is ready. Review the retained content and unresolved sources in CTI. Whole-course completeness remains unverified.",
          capture.summary.topics +
            " topics · " +
            capture.summary.quizQuestions +
            " question definitions · " +
            capture.summary.originalBodies +
            " original files retained · " +
            capture.contentAcquisition.gaps.length +
            " unresolved references",
        );
      } else
        progress.finish(
          signal.aborted ? "paused" : "error",
          String(stopped?.message || "Capture interrupted") +
            " Saved and in-memory observations remain downloadable.",
          capture.summary.topics + " topics retained",
        );
      bodyStore.close();
    }
  }
})().catch((error) => {
  window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__ = false;
  const message =
    "Open the intended Brightspace course Home or Content page, then click the bookmark again. " +
    String(error?.message || error);
  try {
    const panel = createBrightspaceProgressPanelV110(
      "CTI · Brightspace capture",
      { key: "__CTI_BRIGHTSPACE_SETUP_ERROR__" },
    );
    panel.update({ phase: "Capture could not start" });
    panel.finish("error", message);
  } catch (_) {
    try {
      window.alert(message);
    } catch (_) {}
  }
  console.error("[CTI Brightspace] Capture setup failed:", error);
});
