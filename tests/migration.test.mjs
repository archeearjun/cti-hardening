import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createEngine } from "../src/engine/index.js";
import { createBrowserServices } from "../src/adapters/browser-services.ts";
import { reviewCapture } from "../src/domain/capture-review.ts";
import { CTI_RELEASE_REGISTRY_ } from "../src/engine/release.js";

const require = createRequire(import.meta.url),
  original = require("../tools/legacy-reference.cjs");
const engine = createEngine(createBrowserServices());
const plain = (value) => JSON.parse(JSON.stringify(value));
const options = { partner: "NAIT", mode: "OPS_CURRENT" };
const fixture = () => ({
  schemaVersion: 34,
  extractedAt: "2026-09-27T00:00:00Z",
  page: { title: "Synthetic QA fixture" },
  meta: {
    extractor: "Fixture extractor",
    buildId: "synthetic-only",
    activeSpaCrawl: {
      eligibleTargets: 3,
      targetIds: ["reading", "quiz", "missing"],
      targetDiagnostics: [
        { id: "reading", editorSurfaceCaptured: true },
        { id: "quiz", editorSurfaceCaptured: true },
      ],
    },
  },
  fingerprints: [
    {
      id: "reading",
      name: "Reading",
      type: "Reading",
      path: "Module 1",
      payload: {
        textSample: "Loading item...",
        textScopeKind: "item-scoped",
        textEvidenceCompleteness: 1,
        links: ["https://example.test/?chapter=1#part"],
        assetDetails: [{ name: "guide.pdf", sha256: "a".repeat(64) }],
      },
    },
    {
      id: "quiz",
      name: "Quiz",
      type: "Assignment",
      path: "Module 1",
      payload: {
        structuredAssessment: {
          questions: [
            { id: "q1", prompt: "Repeated prompt", type: "essay" },
            { id: "q2", prompt: "Repeated prompt", type: "essay" },
          ],
          questionCount: 2,
        },
        textSample: "Answer both questions.",
        textScopeKind: "item-scoped",
      },
    },
    {
      id: "placeholder",
      name: "[empty] Instructor Resources",
      type: "Reading",
      path: "Instructor Resources",
      payload: { textSample: "" },
    },
  ],
});

test("archived Apps Script reference remains immutable", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../archive/apps-script/reference-manifest.json", import.meta.url)));
  const code = fs.readFileSync(new URL("../archive/apps-script/Code.gs", import.meta.url));
  assert.equal(crypto.createHash("sha256").update(code).digest("hex"), manifest.baselineSha256);
});

test("browser byte adapter preserves non-ASCII content, signed bytes and SHA-256", () => {
  const { Utilities: u } = createBrowserServices();
  const value = "Question 2½ — café 日本語";
  assert.equal(
    u.newBlob(u.base64Decode(u.base64Encode(value))).getDataAsString(),
    value,
  );
  assert.deepEqual(
    Buffer.from(u.newBlob(value).getBytes()),
    Buffer.from(value),
  );
  assert.equal(
    Buffer.from(u.computeDigest("SHA_256", value)).toString("hex"),
    crypto.createHash("sha256").update(value).digest("hex"),
  );
  assert.throws(() => u.computeDigest("MD5", value), /Unsupported/);
});

test("unsupported Google services fail explicitly instead of fabricating shared state", () => {
  const s = createBrowserServices();
  for (const service of [
    "DriveApp",
    "SpreadsheetApp",
    "PropertiesService",
    "Session",
    "UrlFetchApp",
  ])
    assert.throws(
      () => s[service].getAnything(),
      /existing Google application/,
    );
});

for (const platform of ["coursera", "brightspace"])
  test(`${platform} delivery retains the accepted extractor identity`, () => {
    const actual = engine.ctiExtractorDelivery_(platform);
    assert.ok(actual.script.length > 40000);
    if (platform === "coursera") {
      const expected = CTI_RELEASE_REGISTRY_.courseraExtractor;
      assert.equal(actual.buildId, expected.build);
      assert.equal(actual.version, expected.version);
      assert.equal(actual.schemaVersion, expected.schema);
      assert.notEqual(
        actual.buildId,
        original.ctiExtractorDelivery_("coursera").buildId,
        "The reviewed v6.15.4 release intentionally differs from the frozen v6.14.7 reference.",
      );
    } else {
      const expected = original.ctiExtractorDelivery_(platform);
      assert.equal(actual.buildId, expected.buildId);
      assert.equal(actual.version, expected.version);
      assert.equal(actual.schemaVersion, expected.schemaVersion);
    }
  });

test("normalization and readiness match GAS with identical capture inputs", () => {
  const capture = fixture(),
    items = capture.fingerprints.map((i) => original.normalizeCourseraItem_(i));
  assert.deepEqual(
    plain(capture.fingerprints.map((i) => engine.normalizeCourseraItem_(i))),
    // The old runtime dropped lesson metadata; an absent lesson stays empty.
    plain(items).map(item => ({...item, lesson: ""})),
  );
  const expected = original.qaAssessDestinationReadiness_(
    items,
    original.qaParseSmartIngestionIntelligence_(items),
    capture.meta,
    { mode: options.mode },
    null,
    options.partner,
  );
  const actual = reviewCapture(capture, "fixture.json", options);
  assert.deepEqual(actual.findings, plain(expected.findings));
  assert.equal(actual.extractor, "Fixture extractor");
  assert.equal(
    actual.counts.questionDefinitions,
    2,
    "Distinct observed question IDs must not be deduplicated by prompt",
  );
  assert.equal(actual.traversal.visited, 2);
  assert.equal(actual.traversal.unresolvedCount, 1);
  assert(
    actual.findings.some((f) => f.code === "EXTRACTOR_FULL_CRAWL_INCOMPLETE"),
  );
  assert.equal(actual.options.mode, options.mode);
  assert(
    !("status" in actual),
    "An inventory must not acquire a global READY verdict",
  );
});

test("Brightspace preserves unverified quiz coverage and does not invent asset or per-topic question counts", () => {
  const capture = {
    schemaVersion: 2,
    extractor: "CTI Brightspace",
    contentTree: [
      {
        kind: "MODULE",
        children: [
          {
            kind: "TOPIC",
            id: "t1",
            title: "Topic",
            path: ["Module", "Topic"],
            contentEvidence: {
              text: "Actual captured body.",
              links: [{ href: "https://example.test" }],
            },
          },
        ],
      },
    ],
    assignments: [],
    discussions: [],
    quizzes: [
      {
        id: "q1",
        name: "Pool",
        questions: [{ id: 1 }, { id: 2 }],
        questionCoverage: { completenessVerified: false },
      },
    ],
  };
  const r = reviewCapture(capture, "source.json", options);
  assert.equal(r.counts.items, 1);
  assert.equal(r.counts.questionDefinitions, 2);
  assert.equal(r.counts.assets, null);
  assert.equal(r.items[0].questionDefinitions, null);
  assert.equal(r.items[0].textLength, "Actual captured body.".length);
  assert.equal(r.findings[0].code, "QUIZ_DEFINITION_COVERAGE_UNVERIFIED");
});

test("partial, malformed, diagnostic and unsupported captures are rejected", () => {
  for (const data of [
    null,
    {},
    [],
    { kind: "FOCUSED_EXTRACTOR_DIAGNOSTIC" },
    { kind: "CTI_COURSERA_READING_RECOVERY" },
    { schemaVersion: 99, fingerprints: [] },
    { schemaVersion: 34, fingerprints: [null] },
    { extractor: "Brightspace", schemaVersion: 2 },
  ])
    assert.throws(() => reviewCapture(data, "bad.json", options));
});

test("empty captures retain an explicit uncertainty warning", () => {
  const r = reviewCapture(
    { schemaVersion: 34, fingerprints: [] },
    "empty.json",
    options,
  );
  assert(
    r.warnings.some((w) =>
      w.includes("not evidence of a complete or empty course"),
    ),
  );
  assert(!("status" in r));
});
