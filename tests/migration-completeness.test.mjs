import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalDisplayFileName,
  normalizeFileName,
  packageIdentityKey,
  packageMatchKey,
  packageSemanticKey,
} from "../src/domain/package-identity.ts";
import {
  defaultCourseWorkState,
  nextCourseWorkAction,
  validateCourseWorkState,
} from "../src/domain/work-state.ts";
import {
  deterministicPreflight,
  sourceManifestCsv,
} from "../src/domain/source-operations.ts";
import {
  validateCourseStatus,
  validateDateOnly,
  validateDriveLink,
} from "../src/domain/workspace-validation.ts";
import {
  planDuplicateResolution,
  restoreArchivedPackage,
} from "../src/domain/duplicate-resolution.ts";
import { buildSystemHealth } from "../src/domain/system-health.ts";

const packageRecord = (id, fileName, scannedAt = "2026-09-01T00:00:00.000Z") => ({
  id,
  kind: "package",
  title: fileName,
  packageId: "",
  version: 1,
  updatedAt: scannedAt,
  updatedBy: "test",
  data: {
    partner: "NAIT",
    owner: "",
    status: "In Queue",
    assignedDate: "",
    deadline: "",
    driveLink: "",
    scan: {
      kind: "CTI_PACKAGE_SCAN",
      schemaVersion: 1,
      fileName,
      scannedAt,
      fileSha256: id.padEnd(64, "0").slice(0, 64),
      scope: "test",
      moduleCount: 1,
      courseTree: [],
      stats: { totalItems: 5, emptyFolders: 0, lti: 0 },
      unknownTypesLog: {},
      fileExtensionsLog: {},
      sourceEvidence: { manifestOnly: false, resources: {} },
      warnings: [],
    },
  },
});

test("semantic package identity preserves the legacy duplicate rules", () => {
  assert.equal(normalizeFileName(" BORL 113 (2).IMSCC ", true), "borl 113.imscc");
  assert.equal(canonicalDisplayFileName("BORL 113 (2).IMSCC"), "BORL 113.IMSCC");
  assert.equal(packageMatchKey("B0RL-113 (2).imscc"), "borl113");
  assert.equal(packageSemanticKey("B0RL-113 (2).imscc"), "borl113");
  assert.equal(
    packageIdentityKey(" NAIT ", "B0RL-113 (2).imscc"),
    "nait|borl113",
  );
});

test("metadata validation distinguishes empty values from malformed values", () => {
  assert.equal(validateDateOnly("", "Deadline"), "");
  assert.equal(validateDateOnly("2026-10-01", "Deadline"), "2026-10-01");
  assert.throws(() => validateDateOnly("2026-02-30", "Deadline"), /valid calendar/);
  assert.equal(validateCourseStatus("QA Review"), "QA Review");
  assert.throws(() => validateCourseStatus("Done-ish"), /Invalid course status/);
  assert.equal(validateDriveLink(""), "");
  assert.equal(
    validateDriveLink("https://drive.google.com/file/d/abc"),
    "https://drive.google.com/file/d/abc",
  );
  assert.throws(
    () => validateDriveLink("https://example.com/drive"),
    /Google Drive or Docs/,
  );
});

test("deterministic preflight blocks the same retained risk conditions", () => {
  const scan = packageRecord("a", "A.imscc").data.scan;
  assert.equal(deterministicPreflight(scan).verdict, "CLEARED_TO_INGEST");
  const blocked = structuredClone(scan);
  blocked.stats.emptyFolders = 1;
  assert.equal(deterministicPreflight(blocked).verdict, "BLOCKED");
  assert.match(deterministicPreflight(blocked).message, /empty folder/);
  assert.match(sourceManifestCsv(scan), /^Depth,Path,Title,Type,IDREF,Auto deleted/);
});

test("work-state validation and audit-first next action stay deterministic", () => {
  const state = defaultCourseWorkState();
  assert.equal(validateCourseWorkState(state).courseraRedo, "NOT_STARTED");
  assert.throws(
    () => validateCourseWorkState({ ...state, courseraRedo: "MAYBE" }),
    /Invalid work-state/,
  );
  assert.equal(
    nextCourseWorkAction(
      {
        hasSourcePackage: true,
        sourceRescanned: true,
        existingImportOnlyShell: true,
        rawQaFresh: false,
      },
      state,
    ).code,
    "AUDIT_EXISTING_RAW",
  );
});

test("duplicate reconciliation is recoverable and retains the newest source scan", () => {
  const older = packageRecord("older", "BORL 113.imscc", "2026-09-01T00:00:00.000Z");
  const newer = packageRecord("newer", "B0RL-113 (2).imscc", "2026-10-01T00:00:00.000Z");
  const plan = planDuplicateResolution([older, newer], "older", "2026-10-01T01:00:00.000Z");
  assert.equal(plan.survivor.id, "older");
  assert.equal(plan.survivor.data.scan.scannedAt, "2026-10-01T00:00:00.000Z");
  assert.equal(plan.archived[0].data.archived, true);
  assert.equal(plan.archived[0].data.archive.survivorId, "older");
  const restored = restoreArchivedPackage(plan.archived[0]);
  assert.notEqual(restored.data.archived, true);
  assert.equal(restored.data.archive.recoverable, true);
});

test("system health surfaces semantic duplicates without destroying evidence", () => {
  const a = packageRecord("a", "BORL 113.imscc");
  const b = packageRecord("b", "B0RL-113 (2).imscc");
  const health = buildSystemHealth([a, b], "local");
  assert.equal(health.status, "REVIEW");
  assert(
    health.findings.some((finding) => finding.code === "SEMANTIC_PACKAGE_DUPLICATE"),
  );
});
