import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { courseraSource } from "../src/generated/extractor-sources.js";
import {
  createSavedCourseraResumeScript,
  inspectLocalCourseraCapture,
} from "../src/domain/coursera-local-extraction.ts";
import { mergeReadingRecoveryV61311 } from "../src/extractors/coursera/evidence-2.js";
import { captureContractV6150 } from "../src/extractors/coursera/completion.js";
import { validateSavedCaptureResumeV61515 } from "../src/extractors/coursera/runtime.js";

const courseId = "synthetic_course",
  itemId = "reading_1";
const shell = `https://www.coursera.org/teach/synthetic/${courseId}/content/edit`;
const fingerprint = () => ({
  id: itemId,
  name: "Reading",
  type: "Reading",
  typeName: "supplement",
  payload: { captureAttempts: 1 },
});
const emptyEvidence = () => ({
  textSample: "",
  textCaptureTruncated: false,
  textScopeKind: "reading-content-field",
  textCaptureEvidence: {
    method: "EXACT_READING_FIELD",
    courseId,
    itemId,
    observedCharacters: 0,
    capturedCharacters: 0,
  },
  emptyReadingEvidence: {
    status: "OBSERVED_STABLE_EMPTY_READING",
    courseId,
    itemId,
    scope: "EXACT_READING_FIELD",
    dwellMs: 10400,
    stableSamples: 25,
    networkStableSamples: 25,
    unresolvedAttachmentLabels: 0,
    frameCount: 0,
  },
});

test("Reading recovery preserves exact stable-empty proof through merging and serialization", () => {
  const fp = fingerprint(),
    evidence = emptyEvidence();
  mergeReadingRecoveryV61311(fp, { captured: true, evidence });
  const restored = JSON.parse(JSON.stringify(fp));
  assert.deepEqual(
    restored.payload.emptyReadingEvidence,
    evidence.emptyReadingEvidence,
  );
  assert.equal(captureContractV6150(restored).status, "COMPLETE_EMPTY_READING");
});
test("Missing, short-dwell, wrong-item and wrong-course empty receipts remain incomplete", () => {
  for (const changed of [
    null,
    { dwellMs: 2400 },
    { itemId: "different" },
    { courseId: "different" },
    { stableSamples: 1 },
    { networkStableSamples: 0 },
    { frameCount: 1 },
    { unresolvedAttachmentLabels: 1 },
  ]) {
    const fp = fingerprint(),
      evidence = emptyEvidence();
    evidence.emptyReadingEvidence =
      changed === null
        ? null
        : { ...evidence.emptyReadingEvidence, ...changed };
    mergeReadingRecoveryV61311(fp, { captured: true, evidence });
    assert.equal(captureContractV6150(fp).complete, false);
    assert.equal(fp.payload.emptyReadingEvidence, undefined);
  }
});
test("An unstable replacement observation invalidates the earlier empty receipt", () => {
  const fp = fingerprint();
  mergeReadingRecoveryV61311(fp, { captured: true, evidence: emptyEvidence() });
  const next = emptyEvidence();
  delete next.emptyReadingEvidence;
  mergeReadingRecoveryV61311(fp, { captured: true, evidence: next });
  assert.equal(captureContractV6150(fp).complete, false);
});
const partial = () => ({
  schemaVersion: 35,
  extractedAt: "2026-10-11T00:00:00Z",
  page: { courseId },
  meta: { localCaptureBatch: { requiresReload: true, visits: 1 } },
  fingerprints: [fingerprint()],
});
test("Saved JSON resume carries literal data and the entire current canonical script", () => {
  const capture = partial();
  capture.fingerprints[0].name =
    "</script>\u2028\u2029 & ${window.injected=true}";
  const program = createSavedCourseraResumeScript(
    capture,
    shell,
    courseraSource,
  );
  assert(program.includes(courseraSource.slice("javascript:".length)));
  assert(!program.includes("</script>"));
  const context = {
    window: {},
    location: {
      origin: "https://wrong.example",
      pathname: "/teach/synthetic/synthetic_course/content/edit",
    },
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(program, context);
  assert.equal(context.window.injected, undefined);
  assert.equal(
    context.window.__CTI_LOCAL_CAPTURE_RESUME__,
    undefined,
    "The wrong-site guard consumes data without storing it",
  );
  assert.equal(context.window.__CTI_ITEM_FIDELITY_RUN_LOCK, undefined);
  assert.equal(
    inspectLocalCourseraCapture(capture, shell).resumeAvailable,
    true,
  );
  assert.equal(inspectLocalCourseraCapture(capture, shell).pausedBatch, true);
  assert.equal(
    capture.fingerprints[0].payload.captureAttempts,
    1,
    "Resume generation does not mutate input evidence",
  );
});
test("Resume rejects a different course, duplicate identity, diagnostic or unsupported schema", () => {
  for (const capture of [
    { ...partial(), page: { courseId: "other" } },
    { ...partial(), fingerprints: [fingerprint(), fingerprint()] },
    { ...partial(), notForCourseAudit: true },
    { ...partial(), schemaVersion: 34 },
    { ...partial(), extractedAt: "invalid" },
  ]) {
    assert.throws(() => validateSavedCaptureResumeV61515(capture, courseId));
    assert.throws(() =>
      createSavedCourseraResumeScript(capture, shell, courseraSource),
    );
  }
});
test("Recorded authoring URLs can fill the shell only when their course identity matches", () => {
  const capture = partial();
  capture.page.url = shell;
  assert.equal(inspectLocalCourseraCapture(capture).authoringShellUrl, shell);
  capture.page.url =
    "https://www.coursera.org/teach/synthetic/different/content/edit";
  assert.equal(inspectLocalCourseraCapture(capture).authoringShellUrl, "");
  capture.page.url = "https://example.test/untrusted";
  assert.equal(inspectLocalCourseraCapture(capture).authoringShellUrl, "");
});
