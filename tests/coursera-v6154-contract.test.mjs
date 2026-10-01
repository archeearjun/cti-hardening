import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { bundleConsole } from "../tools/console-bundle.mjs";
import { CTI_RELEASE_REGISTRY_ } from "../src/engine/release.js";
import {
  ACTIVE_CRAWL_MAX_TOTAL_MS,
  MAX_EXACT_READING_TEXT_V61318,
  MAX_TEXT_SAMPLE,
  CTI_MAX_ITEM_ATTEMPTS,
  CTI_WHOLE_RUN_MAX_MS,
} from "../src/extractors/coursera/config.js";
import {
  captureContractV6150,
  finalCaptureAccountingV6150,
} from "../src/extractors/coursera/completion.js";

test("v6.15.4 is the maintained Coursera extractor release", () => {
  assert.deepEqual(CTI_RELEASE_REGISTRY_.courseraExtractor, {
    version: "v6.15.4",
    schema: 35,
    build: "v6.15.4-empty-reading-visibility-20261001",
    delivery: "GENERATED_BROWSER_BUNDLE",
  });
  const script = bundleConsole(
    path.resolve("src/extractors/coursera/entry.js"),
  );
  assert.match(script, /CTI Item Fidelity Extractor v6\.15\.4/);
  assert.match(script, /schemaVersion:\s*35/);
  assert.match(script, /captureAccounting/);
  assert.match(script, /v6\.15\.4_s35/);
});

test("v6.15.4 keeps bounded crawl and text ceilings explicit", () => {
  assert.equal(ACTIVE_CRAWL_MAX_TOTAL_MS, 90 * 60 * 1000);
  assert.equal(CTI_WHOLE_RUN_MAX_MS, 120 * 60 * 1000);
  assert.equal(CTI_MAX_ITEM_ATTEMPTS, 2);
  assert.equal(MAX_TEXT_SAMPLE, 512000);
  assert.equal(MAX_EXACT_READING_TEXT_V61318, 4000000);
});

test("stable exact empty Reading is complete only with explicit empty proof", () => {
  const base = {
    id: "reading-1",
    type: "Reading",
    typeName: "supplement",
    payload: {
      textCaptureEvidence: {
        method: "EXACT_READING_FIELD",
        itemId: "reading-1",
        observedCharacters: 0,
        capturedCharacters: 0,
      },
      textCaptureTruncated: false,
      textConfidence: "high",
      textEvidenceCompleteness: 1,
      readingAttachmentEvidence: { unresolvedLabels: [] },
      assetDetails: [],
      links: [],
    },
  };
  const unresolved = captureContractV6150(structuredClone(base));
  assert.equal(unresolved.complete, false);
  assert(unresolved.reasons.includes("EMPTY_READING_NOT_STABLY_PROVEN"));

  const proven = structuredClone(base);
  proven.payload.emptyReadingEvidence = {
    status: "OBSERVED_STABLE_EMPTY_READING",
    itemId: "reading-1",
    scope: "EXACT_READING_FIELD",
  };
  const complete = captureContractV6150(proven);
  assert.equal(complete.complete, true);
  assert.equal(complete.status, "COMPLETE_EMPTY_READING");
});

test("settings-only assignment is never promoted to complete", () => {
  const fp = {
    id: "assignment-1",
    type: "Assignment",
    payload: {
      captureAttempts: 2,
      nativeAssignment: {
        parserConfidence: 0.99,
        learnerSemanticText: "",
        rubricCount: 0,
        submission: {},
        settings: { gradeSetting: "Graded" },
        currentStateEvidence: { editorSurfaceObserved: true },
      },
    },
  };
  const contract = captureContractV6150(fp);
  assert.equal(contract.complete, false);
  assert.equal(contract.accounted, true);
  assert.equal(contract.retryable, false);
  assert.equal(contract.status, "UNRESOLVED_AFTER_MAX_ATTEMPTS");
  assert(
    contract.reasons.includes("ASSIGNMENT_SETTINGS_ONLY_CONTENT_NOT_PROVEN"),
  );
});

test("cross-origin plugin target is accounted but external body stays unverified", () => {
  const contract = captureContractV6150({
    id: "plugin-1",
    type: "Plugin",
    payload: {
      pluginEvidence: {
        targets: [{ url: "https://external.example/player" }],
        frames: [
          {
            access: "CROSS_ORIGIN_UNREADABLE",
            surfaceStatus: "UNREADABLE",
          },
        ],
      },
    },
  });
  assert.equal(contract.complete, false);
  assert.equal(contract.accounted, true);
  assert.equal(contract.retryable, false);
  assert.equal(contract.externalBodyVerified, false);
  assert.equal(contract.status, "ACCOUNTED_EXTERNAL_TARGET_ONLY");
});

test("final accounting cannot claim complete with any explicit unresolved item", () => {
  const fingerprints = [
    {
      id: "reading-ok",
      type: "Reading",
      typeName: "supplement",
      payload: {
        textCaptureEvidence: {
          method: "EXACT_READING_FIELD",
          itemId: "reading-ok",
          observedCharacters: 10,
          capturedCharacters: 10,
        },
        textCaptureTruncated: false,
        readingAttachmentEvidence: { unresolvedLabels: [] },
      },
    },
    {
      id: "assignment-gap",
      type: "Assignment",
      payload: {
        captureAttempts: 2,
        nativeAssignment: {
          parserConfidence: 0.99,
          learnerSemanticText: "",
          rubricCount: 0,
          submission: {},
          settings: { gradeSetting: "Graded" },
          currentStateEvidence: { editorSurfaceObserved: true },
        },
      },
    },
  ];
  const accounting = finalCaptureAccountingV6150(fingerprints, {
    unvisitedTargetIds: [],
  });
  assert.equal(accounting.inventoryCount, 2);
  assert.equal(accounting.completeCount, 1);
  assert.equal(accounting.unresolvedCount, 1);
  assert.equal(accounting.unknownCount, 0);
  assert.equal(accounting.unvisitedCount, 0);
  assert.equal(accounting.noSilentMisses, true);
  assert.equal(accounting.complete, false);
});


test("Playwright-observed external plugin body improves evidence but stays fail-closed without scope proof", () => {
  const fp = {
    id: "plugin-background",
    type: "Plugin",
    payload: {
      pluginEvidence: {
        targets: [{ url: "https://video.example.test/watch/abc" }],
        frames: [
          {
            src: "https://video.example.test/embed/abc",
            access: "CROSS_ORIGIN_UNREADABLE",
            surfaceStatus: "NOT_OBSERVED",
          },
        ],
        backgroundFrames: [
          {
            itemId: "plugin-background",
            safeUrl: "https://video.example.test/embed/abc",
            hostname: "video.example.test",
            readyState: "complete",
            status: "CONTENT_OBSERVED",
            textSample: "Observed external player title and transcript text.",
            observedTextLength: 50,
            textTruncated: false,
            links: [],
            media: [{ tag: "video", src: "", poster: "", duration: 120, trackCount: 1 }],
          },
        ],
        externalBodyVerified: true,
        backgroundCapture: {
          method: "PLAYWRIGHT_CROSS_ORIGIN_FRAME",
          observedFrames: 1,
          bodyObservedFrames: 1,
          interactionVerified: false,
          scopeComplete: false,
        },
        readiness: {
          pending: false,
          status: "BACKGROUND_FRAME_CONTENT_OBSERVED",
          readableFrames: 1,
          unreadableFrames: 0,
          interactionVerified: false,
        },
      },
    },
  };
  const contract = captureContractV6150(fp);
  assert.equal(contract.complete, false);
  assert.equal(contract.accounted, true);
  assert.equal(contract.status, "ACCOUNTED_EXTERNAL_BODY_OBSERVED");
  assert.equal(contract.externalBodyVerified, true);
  assert(contract.reasons.includes("EXTERNAL_PLUGIN_SCOPE_NOT_VERIFIED"));
  const accounting = finalCaptureAccountingV6150([fp], { unvisitedTargetIds: [] });
  assert.equal(accounting.complete, false);
  assert.equal(accounting.externalContentUnverifiedCount, 1);
});
