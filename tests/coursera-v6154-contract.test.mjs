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

test("v6.15.6 is the maintained Coursera extractor release", () => {
  assert.deepEqual(CTI_RELEASE_REGISTRY_.courseraExtractor, {
    version: "v6.15.6",
    schema: 35,
    build: "v6.15.6-terminal-evidence-efficiency-20261002",
    delivery: "GENERATED_BROWSER_BUNDLE",
  });
  const script = bundleConsole(
    path.resolve("src/extractors/coursera/entry.js"),
  );
  assert.match(script, /CTI Item Fidelity Extractor v6\.15\.6/);
  assert.match(script, /schemaVersion:\s*35/);
  assert.match(script, /captureAccounting/);
  assert.match(script, /v6\.15\.6_s35/);
});

test("v6.15.6 keeps bounded crawl and text ceilings explicit", () => {
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


test("v6.15.6 uses certified direct-editor routing before outline fallback", () => {
  const script = bundleConsole(
    path.resolve("src/extractors/coursera/entry.js"),
  );
  assert.match(script, /const certifiedDirectRoute=/);
  assert.match(script, /const directRouteFastPath=Boolean\(certifiedDirectRoute\)/);
  assert.match(script, /directRouteFastPathAttempts/);
  assert.match(script, /directRouteFastPathHits/);
  assert.match(script, /directRouteFallbacks/);
  assert.match(script, /outlineResetsAvoided/);
  assert.match(
    script,
    /if\(directRouteFastPath\)\{[\s\S]{0,240}outlineResetsAvoided\+\+[\s\S]{0,240}\} else \{[\s\S]{0,240}returnToOutlineV6142\(startUrl\)/,
  );
  assert.match(
    script,
    /if\(directRecovery && !directRecovery\.captured\)\{[\s\S]{0,240}returnToOutlineV6142\(startUrl\)[\s\S]{0,240}directRouteFallbacks\+\+/,
  );
  assert.match(
    script,
    /meta\.completedTargets = \(meta\.targetDiagnostics \|\| \[\]\)\.filter\(d=>d\.completed===true\)\.length/,
  );
  assert.match(script, /const probeOptions=\{/);
  assert.match(script, /needsEditor:\(fp\)=>captureContractV6150\(fp\)\.needsEditor===true/);
  assert.match(script, /items that still need evidence/);
  assert.doesNotMatch(script, /const backgroundProbeOptions=backgroundChunkMode/);
});


test("v6.15.6 treats a fully observed Practice assessment with no key as review, not a blind retry", () => {
  const fp = {
    id: "survey-1",
    type: "Assignment",
    payload: {
      captureAttempts: 1,
      nativeAssignment: {
        parserConfidence: 0.92,
        learnerSemanticText: "",
        rubricCount: 0,
        submission: {},
        settings: { gradeSetting: "Practice" },
        currentStateEvidence: { editorSurfaceObserved: true },
      },
      structuredAssessment: {
        parserConfidence: 0.95,
        declaredQuestionCount: 2,
        questionCount: 2,
        questions: [
          { id:"1", questionOrdinalObserved:true, prompt:"Preferred format?", correctAnswers:[], answerTextReliable:false },
          { id:"2", questionOrdinalObserved:true, prompt:"Preferred methods?", correctAnswers:[], answerTextReliable:false },
        ],
        captureCompleteness: {
          declared: 2,
          captured: 2,
          uniqueQuestionIds: 2,
          questionCoverageComplete: true,
          requiredAnswerCoverageComplete: false,
          missingQuestionOrdinals: [],
          missingRequiredAnswerOrdinals: [1,2],
        },
      },
    },
  };
  const contract = captureContractV6150(fp);
  assert.equal(contract.complete, false);
  assert.equal(contract.accounted, true);
  assert.equal(contract.retryable, false);
  assert.equal(contract.needsEditor, false);
  assert.equal(contract.status, "UNRESOLVED_ANSWER_APPLICABILITY_REVIEW");
  assert(contract.reasons.includes("ASSESSMENT_ANSWER_APPLICABILITY_REQUIRES_REVIEW"));
});

test("v6.15.6 accepts a proven text-block-only assignment as complete learner content", () => {
  const fp = {
    id: "text-block-1",
    type: "Assignment",
    payload: {
      captureAttempts: 1,
      nativeAssignment: {
        parserConfidence: 0.92,
        learnerSemanticText: "Welcome to the practice assessment. Submit through the associated dropbox.",
        contentBlockEvidence: {
          completeTextBlockOnly: true,
          blocks: [{ id:"part-1", text:"Submit through the associated dropbox.", truncated:false }],
        },
        rubricCount: 0,
        submission: {},
        settings: { gradeSetting:"Practice" },
        currentStateEvidence: { editorSurfaceObserved:true },
      },
    },
  };
  const contract = captureContractV6150(fp);
  assert.equal(contract.complete, true);
  assert.equal(contract.status, "COMPLETE_ASSIGNMENT_TEXT_BLOCKS");
  assert.equal(contract.retryable, false);
});

test("v6.15.6 accounting separates source review, answer review, external limits and technical gaps", () => {
  const sourceReview = {
    id:"empty-1", type:"Assignment",
    payload:{captureAttempts:1,emptyEditorEvidence:{status:"OBSERVED_EMPTY_EDITOR",itemId:"empty-1",scope:"EXACT_ITEM_ASSIGNMENT_LAYOUT"}},
  };
  const answerReview = {
    id:"survey-1", type:"Assignment",
    payload:{
      captureAttempts:1,
      nativeAssignment:{parserConfidence:.92,learnerSemanticText:"",rubricCount:0,submission:{},settings:{gradeSetting:"Practice"},currentStateEvidence:{editorSurfaceObserved:true}},
      structuredAssessment:{declaredQuestionCount:1,questionCount:1,questions:[{id:"1",questionOrdinalObserved:true,prompt:"Preference?",correctAnswers:[],answerTextReliable:false}],
        captureCompleteness:{declared:1,captured:1,uniqueQuestionIds:1,questionCoverageComplete:true,requiredAnswerCoverageComplete:false,missingQuestionOrdinals:[],missingRequiredAnswerOrdinals:[1]}}
    }
  };
  const external = {
    id:"plugin-1", type:"Plugin",
    payload:{pluginEvidence:{targets:[{url:"https://example.test"}],frames:[{access:"CROSS_ORIGIN_UNREADABLE"}],
      readiness:{pending:false,status:"FRAME_CONTENT_UNREADABLE",readableFrames:0,unreadableFrames:1}}}
  };
  const accounting = finalCaptureAccountingV6150([sourceReview,answerReview,external],{unvisitedTargetIds:[]});
  assert.equal(accounting.sourceReviewCount,1);
  assert.equal(accounting.answerApplicabilityReviewCount,1);
  assert.equal(accounting.externalContentUnverifiedCount,1);
  assert.equal(accounting.retryableUnresolvedCount,0);
  assert.equal(accounting.technicalUnresolvedCount,0);
  assert.equal(accounting.noSilentMisses,true);
});

test("v6.15.6 short-circuits known-useless waits without weakening evidence states", () => {
  const script = bundleConsole(path.resolve("src/extractors/coursera/entry.js"));
  assert.match(script, /MATCHING_EDITOR_NOT_FOUND_FAST/);
  assert.match(script, /Date\.now\(\)-started>=6000/);
  assert.match(script, /terminalUnreadable\?3000:10000/);
  assert.match(script, /ASSESSMENT_ANSWER_APPLICABILITY_REQUIRES_REVIEW/);
  assert.match(script, /BOUNDED_COLLAPSED_TEXT_BLOCK_PART/);
  assert.match(script, /technical unresolved/);
});
