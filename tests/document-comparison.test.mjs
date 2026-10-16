import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDocumentComparisonScope,
  documentComparisonText,
} from "../src/domain/document-comparison.ts";
import { buildOwnerTasks } from "../src/domain/owner-actions.ts";

function fixture() {
  const scan = {
    fileSha256: "a".repeat(64),
    fileName: "literal-source.md",
    scope: "Supplied document sections only; not a complete LMS inventory.",
    sourceEvidence: {
      kind: "CTI_SOURCE_DOCUMENT_BASELINE",
      document: {
        text: "# Reading\nLiteral image link.\n# More reading\nNo image is supplied.\n",
      },
    },
    courseTree: [
      {
        idref: "section-1",
        title: "Reading",
        sourcePayload: { textSample: "# Reading\nLiteral image link.\n" },
        children: [],
      },
      {
        idref: "section-2",
        title: "More reading",
        sourcePayload: {
          textSample: "# More reading\nNo image is supplied.\n",
        },
        children: [],
      },
    ],
  };
  const result = {
    success: true,
    stats: {
      coursera: 2,
      originalCore: 2,
      extractorMeta: {
        page: {
          url: "https://www.coursera.org/teach/test/native/content/edit",
        },
      },
    },
    captureReadiness: { status: "CAPTURE_REPORTED_COMPLETE" },
    summary: {
      verified: 1,
      missing: 1,
      observedFidelity: 50,
      evidenceCoverage: 100,
      headlineStatus: "BLOCKED",
    },
    operationalPolicy: {
      recommendationCode: "REINGEST",
      adjustedObservedFidelity: 50,
    },
    itemResults: [
      {
        sourceId: "section-1",
        sourceName: "Reading",
        sourcePath: "",
        sourceType: "Reading",
        courseraId: "native-destination-1",
        courseraName: "Reading",
        verdict: "VERIFIED",
        fidelityPercent: 100,
        evidenceCoverage: 100,
        checks: {
          content: { status: "VERIFIED", similarity: 1 },
          assets: { status: "NOT_APPLICABLE" },
          structuredAssessment: {
            sourceQuestionCount: 0,
            status: "NOT_APPLICABLE",
          },
        },
        ownerAction: { severity: "NONE", action: "No change" },
      },
      {
        sourceId: "section-2",
        sourceName: "More reading",
        sourcePath: "",
        sourceType: "Reading",
        courseraId: "",
        verdict: "MISSING",
        fidelityPercent: 0,
        evidenceCoverage: 100,
        checks: {
          assets: { status: "MISSING", expected: ["drawing.png"] },
          reconciliationDiagnostic: {
            candidates: [
              {
                id: "native-destination-2",
                name: "Candidate reading",
                path: "Week 2",
              },
            ],
          },
        },
        ownerAction: {
          severity: "CRITICAL",
          action: "Repair missing content by creating another reading.",
        },
      },
    ],
    ownerView: {
      items: [
        {
          id: "native-destination-1",
          name: "Reading",
          type: "Reading",
          path: "Week 1",
          status: "VERIFIED_EVIDENCE",
          published: true,
          actions: [],
        },
        {
          id: "native-destination-2",
          name: "Candidate reading",
          type: "Reading",
          path: "Week 2",
          status: "REPAIR_OR_CONFIRM",
          published: false,
          actions: [{ severity: "CRITICAL", action: "Repair missing media." }],
        },
      ],
      unmappedSource: [
        {
          name: "More reading",
          verdict: "MISSING",
          action: "Create another reading.",
        },
      ],
    },
    destinationReadiness: {
      status: "BLOCKED",
      findings: [{ code: "INFERRED_REPAIR", action: "Repair this item" }],
    },
    currentStateResolution: {
      resolvedCount: 1,
      resolutions: [
        { status: "RESOLVED", currentItemId: "native-destination-1" },
      ],
    },
    injected: [{ id: "native-destination-2", classification: "EXTRA" }],
    missing: [{ name: "More reading" }],
    verified: [{ name: "Reading" }],
    matched: [{ id: "native-destination-1" }],
    liveSourceGroundTruth: {
      sourceTopicMappings: [
        { sourceId: "section-1", topicId: "brightspace-native" },
      ],
    },
  };
  return { scan, result };
}

test("document scope preserves original evidence and computed observations while withholding unsupported LMS decisions", () => {
  const { scan, result } = fixture(),
    original = structuredClone(result),
    source = structuredClone(scan);
  assert.equal(applyDocumentComparisonScope(result, scan), result);
  const scope = result.documentComparisonScope;
  assert.deepEqual(scan, source);
  assert.deepEqual(
    scope.computedObservations.itemResults,
    original.itemResults,
  );
  assert.deepEqual(scope.computedObservations.ownerView, original.ownerView);
  assert.deepEqual(scope.computedObservations.summary, original.summary);
  assert.deepEqual(scope.computedObservations.missing, original.missing);
  assert.deepEqual(result.captureReadiness, original.captureReadiness);
  assert.equal(scope.fullLmsInventory, "UNKNOWN");
  assert.equal(scope.fullLmsFidelity, "UNKNOWN");
  assert.equal(scope.assessmentCoverage, "UNKNOWN");
  assert.equal(scope.mediaCoverage, "UNKNOWN");
  assert.equal(scope.runtimeCoverage, "UNKNOWN");
  assert.equal(result.summary.observedFidelity, null);
  assert.equal(result.summary.evidenceCoverage, null);
  assert.equal(result.summary.totalSourceItems, null);
  assert.equal(result.summary.missing, 0);
  assert.equal(result.summary.verified, 0);
  assert.equal(result.operationalPolicy.adjustedObservedFidelity, null);
  assert.equal(
    result.operationalPolicy.recommendationCode,
    "REVIEW_SOURCE_DOCUMENT",
  );
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.verified, []);
  assert.deepEqual(result.injected, []);
  assert.deepEqual(result.liveSourceGroundTruth.sourceTopicMappings, []);
  assert.match(scope.computedObservations.interpretation, /Unapproved/);
  assert.notEqual(scope.computedObservations.itemResults, original.itemResults);
});

test("candidate identities remain suggestions and owner tasks request review rather than missing-content repair", () => {
  const { scan, result } = fixture();
  applyDocumentComparisonScope(result, scan);
  assert.deepEqual(
    result.documentComparisonScope.candidateMappings.map((mapping) =>
      mapping.candidates.map((candidate) => candidate.id),
    ),
    [["native-destination-1"], ["native-destination-2"]],
  );
  for (const mapping of result.documentComparisonScope.candidateMappings)
    for (const candidate of mapping.candidates) {
      assert.equal(candidate.status, "SUGGESTION");
      assert.equal(candidate.nativeIdentityConfirmed, false);
    }
  for (const finding of result.itemResults) {
    assert.equal(finding.verdict, "UNVERIFIED");
    assert.equal(finding.courseraId, "");
    assert.equal(finding.fidelityPercent, null);
    assert.equal(finding.matchScore, null);
    assert.equal(finding.ownerAction.severity, "REVIEW");
    assert.equal(finding.checks.assets.status, "UNKNOWN");
    assert.equal(finding.checks.questions.status, "UNKNOWN");
    assert.equal(finding.checks.runtime.status, "UNKNOWN");
    assert.equal("structuredAssessment" in finding.checks, false);
  }
  const tasks = buildOwnerTasks(result, scan.courseTree);
  assert.equal(tasks.length, 4);
  assert.ok(
    tasks.every(
      (task) =>
        !["VERIFIED_EVIDENCE", "REPAIR_OR_CONFIRM"].includes(task.status),
    ),
  );
  assert.ok(
    tasks.every((task) =>
      task.actions.every((action) => action.severity !== "CRITICAL"),
    ),
  );
  assert.ok(
    tasks
      .filter((task) => !task.sourceOnly)
      .every((task) => task.sources.length === 0),
  );
  assert.ok(
    tasks
      .filter((task) => task.sourceOnly)
      .every((task) => task.actions[0].verdict === "UNVERIFIED"),
  );
  assert.equal(result.ownerView.items[1].published, false); // Native destination metadata is retained.
});

test("document reports do not publish package-derived percentages, loss or creation instructions", () => {
  const { scan, result } = fixture();
  applyDocumentComparisonScope(result, scan);
  const report = documentComparisonText(result);
  assert.match(report, /DOCUMENT-SCOPED REVIEW/);
  assert.match(report, /UNKNOWN/);
  assert.match(
    report,
    /Destination suggestions: Reading \[native-destination-1\]/,
  );
  assert.match(report, /not established as extra/);
  assert.equal(/\d+%|null%/.test(report), false);
  assert.equal(report.includes("Repair missing"), false);
  assert.equal(report.includes("Create another reading"), false);
});

test("repeated document headings keep their own exact section bodies in owner tasks", () => {
  const { scan, result } = fixture();
  scan.courseTree[1].title = scan.courseTree[0].title;
  result.itemResults[1].sourceName = result.itemResults[0].sourceName;
  applyDocumentComparisonScope(result, scan);
  const sourceTasks = buildOwnerTasks(result, scan.courseTree).filter(
    (task) => task.sourceOnly,
  );
  assert.equal(sourceTasks.length, 2);
  assert.notEqual(sourceTasks[0].key, sourceTasks[1].key);
  assert.deepEqual(
    sourceTasks.map((task) => task.findings.map((finding) => finding.sourceId)),
    [["section-1"], ["section-2"]],
  );
  assert.deepEqual(
    sourceTasks.map((task) =>
      task.sources.map((node) => node.sourcePayload.textSample),
    ),
    [
      ["# Reading\nLiteral image link.\n"],
      ["# More reading\nNo image is supplied.\n"],
    ],
  );
});

test("scoping is idempotent and normal packages and failed comparisons remain unchanged", () => {
  const { scan, result } = fixture();
  applyDocumentComparisonScope(result, scan);
  const scoped = structuredClone(result);
  assert.equal(applyDocumentComparisonScope(result, scan), result);
  assert.deepEqual(result, scoped);
  assert.throws(
    () =>
      applyDocumentComparisonScope(result, {
        ...scan,
        fileSha256: "b".repeat(64),
      }),
    /rebound/,
  );
  const packageResult = fixture().result,
    original = structuredClone(packageResult);
  assert.equal(
    applyDocumentComparisonScope(packageResult, {
      ...scan,
      sourceEvidence: { kind: "IMSCC" },
    }),
    packageResult,
  );
  assert.deepEqual(packageResult, original);
  assert.equal(documentComparisonText(packageResult), null);
  const failed = { success: false, error: "Source input invalid" };
  assert.equal(applyDocumentComparisonScope(failed, scan), failed);
  assert.deepEqual(failed, { success: false, error: "Source input invalid" });
});
