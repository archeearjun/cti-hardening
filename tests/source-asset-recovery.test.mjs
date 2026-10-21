import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import {
  sourceAssetCandidates,
  boundSourceUrl,
  inspectSourceBinary,
  sourceAssetBinding,
  createSourceAssetSession,
  recoverSourceAssets,
  recoveryReceipt,
  validateRecoveryReceipt,
  safeAssetReference,
} from "../src/domain/source-asset-recovery.ts";
import { assessmentMediaResolution } from "../src/engine/assessment/media-recovery.js";
const png = new Uint8Array(
  await readFile(
    new URL("./fixtures/source-assets/publisher-original.png", import.meta.url),
  ),
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const report = {
  sourceScanSha256: "a".repeat(64),
  hashes: { json: "b".repeat(64) },
  result: {
    itemResults: [{ sourceId: "source-quiz", courseraId: "dest-quiz" }],
  },
};
const binding = () =>
  sourceAssetBinding(report, "saved-audit", "source-quiz", "dest-quiz");
async function fixture(files, refs = ["diagram.png"]) {
  const z = new JSZip();
  for (const [p, b] of Object.entries(files)) z.file(p, b);
  const data = await z.generateAsync({ type: "uint8array" }),
    file = new File([data], "course.imscc");
  const r = structuredClone(report);
  r.sourceScanSha256 = sha(data);
  const scan = {
    fileSha256: r.sourceScanSha256,
    sourceEvidence: {
      resources: {
        "source-quiz": {
          files: [],
          structuredAssessment: {
            questions: [
              {
                id: "source-question",
                sourceFile: "quiz/questions.xml",
                mediaRefs: refs,
              },
            ],
          },
        },
      },
    },
  };
  return {
    file,
    scan,
    session: createSourceAssetSession(
      sourceAssetBinding(r, "saved-audit", "source-quiz", "dest-quiz"),
    ),
  };
}
test("TRDE120 grounded Content alternative is a candidate, never an inserted directory", () => {
  const p = sourceAssetCandidates(
    {
      ref: "Floor%20Plan%20Square%20Ft%20area.png?time=1672598520063",
      sourceFile: "quiz/questions.xml",
    },
    ["quiz/Content/Floor Plan Square Ft area.png"],
  );
  assert.equal(
    p.candidates[0].path,
    "quiz/Content/Floor Plan Square Ft area.png",
  );
  assert.equal(p.candidates[0].method, "FILENAME_CANDIDATE");
  assert.equal(
    sourceAssetCandidates({ ref: "diagram.png" }, ["other.png"]).candidateCount,
    0,
  );
});
test("different course directories, relative encoding, and exact paths remain literal", () => {
  const p = sourceAssetCandidates(
    { ref: "../figures/room%20a.png", sourceFile: "tests/quiz.xml" },
    ["figures/room a.png", "tests/room a.png"],
  );
  assert.equal(p.expectedPath, "figures/room a.png");
  assert.equal(p.candidates[0].method, "EXACT_QUESTION_REFERENCE");
  assert.equal(
    sourceAssetCandidates({ ref: "../../outside.png", sourceFile: "q.xml" }, [
      "outside.png",
    ]).expectedPath,
    "",
  );
});
test("same-name collisions preserved, case variants never silently resolve", () => {
  const p = sourceAssetCandidates({ ref: "room.png" }, [
    "a/room.png",
    "b/room.png",
    "c/Room.png",
  ]);
  assert.equal(p.candidateCount, 2);
  assert.deepEqual(p.caseVariants, ["c/Room.png"]);
  const overflow = sourceAssetCandidates(
    { ref: "room.png" },
    Array.from({ length: 20 }, (_, i) => `${i}/room.png`),
  );
  assert.equal(overflow.candidateCount, 20);
  assert.equal(overflow.truncated, true);
  assert.equal(overflow.candidates.length, 16);
});
test("authorized URL checks reject cross-course, credentials, signed URLs and traversal", () => {
  const root = "https://lms.example/content/enforced/123-course/";
  assert.equal(
    boundSourceUrl(root + "assets/room.png", root),
    root + "assets/room.png",
  );
  for (const url of [
    "https://lms.example/content/enforced/124-course/room.png",
    root + "%2e%2e/other.png",
    root + "x.png?token=private",
    "https://user:password@lms.example/content/enforced/123-course/x.png",
  ])
    assert.equal(boundSourceUrl(url, root), null);
  assert.equal(
    safeAssetReference("https://example/a?X-Amz-Signature=secret"),
    false,
  );
});
test("actual archived original rehash, PNG structure, dimensions; no rendering claim", () => {
  const r = inspectSourceBinary(png);
  assert.equal(
    r.sha256,
    "c0a9dbab0d104503d32e8a9102a2fddb4c2d172a78414fd1e5d93c0eb66c8514",
  );
  assert.equal(r.format, "PNG");
  assert.ok(r.width > 0 && r.height > 0);
  assert.equal(r.validationScope, "BINARY_STRUCTURE_NOT_RENDERING");
  const corrupt = png.slice();
  corrupt[30] ^= 1;
  assert.throws(() => inspectSourceBinary(corrupt), /CRC/);
});
test("HTTP-200 login HTML is rejected as a binary, no URL implies acquired bytes", () => {
  assert.throws(
    () =>
      inspectSourceBinary(
        new TextEncoder().encode("<html>Log in to Brightspace</html>"),
      ),
    /INVALID_BINARY/,
  );
  const p = sourceAssetCandidates({ ref: "https://lms.example/diagram.png" }, [
    "diagram.png",
  ]);
  assert.equal(p.candidateCount, 0);
});
test("same filename and wrong bytes cannot satisfy an expected hash", () => {
  const a = {
    path: "diagram.png",
    originalBytes: png,
    sha256: sha(png),
    integrity: "VERIFIED_RETAINED_ORIGINAL",
  };
  const r = assessmentMediaResolution(
    { ref: "diagram.png", sha256: "f".repeat(64) },
    [a],
    true,
  );
  assert.equal(r.status, "CONTENT_IDENTITY_CONFLICT");
  assert.equal(r.resolved.length, 0);
});
test("local original exact reference recovered independently; live and destination remain unverified", async () => {
  const f = await fixture({ "quiz/diagram.png": png });
  const r = await recoverSourceAssets(f.file, f.scan, f.session);
  assert.equal(r.rows[0].status, "RECOVERED_VERIFIED_ORIGINAL");
  assert.equal(r.rows[0].sourceQuestionId, "source-question");
  assert.equal(r.rows[0].liveSourceReference, "UNVERIFIED");
  assert.equal(r.rows[0].destinationStatus, "DESTINATION_ASSET_UNVERIFIED");
  assert.equal(r.questionParityVerified, false);
  assert.equal(r.assets[0].sha256, sha(png));
  assert.deepEqual([...f.session.assets.values()][0].bytes, png);
});
test("alternate path binary is acquired but association remains candidate-only", async () => {
  const f = await fixture({ "quiz/Content/diagram.png": png });
  const r = await recoverSourceAssets(f.file, f.scan, f.session);
  assert.equal(r.rows[0].status, "CANDIDATE_FOUND_IDENTITY_UNVERIFIED");
  assert.equal(r.rows[0].association, "UNVERIFIED");
  assert.equal(r.rows[0].candidates[0].status, "BINARY_ACQUIRED");
  assert.equal(r.rows[0].originalRef, "diagram.png");
});
test("package absence is separate from LMS absence or source-reference HTTP failure", async () => {
  const f = await fixture({ "unrelated.txt": "text" });
  const r = await recoverSourceAssets(f.file, f.scan, f.session);
  assert.equal(r.rows[0].status, "SOURCE_ASSET_NOT_IN_PACKAGE");
  assert.equal(r.rows[0].liveSourceReference, "UNVERIFIED");
});
test("duplicate references read once, interrupted recovery retains bytes and timestamps on retry", async () => {
  const f = await fixture({ "quiz/diagram.png": png, "quiz/other.png": png }, [
    "diagram.png",
    "diagram.png",
    "other.png",
  ]);
  const controller = new AbortController();
  await assert.rejects(
    recoverSourceAssets(f.file, f.scan, f.session, {
      signal: controller.signal,
      progress: (s) => {
        if (s.includes("3/3")) controller.abort();
      },
    }),
    /paused/,
  );
  assert.equal(f.session.assets.size, 1);
  const date = f.session.assets.get("quiz/diagram.png").receipt.observedAt;
  await recoverSourceAssets(f.file, f.scan, f.session);
  assert.equal(f.session.assets.size, 2);
  assert.equal(
    f.session.assets.get("quiz/diagram.png").receipt.observedAt,
    date,
  );
  assert.equal(f.session.complete, true);
});
test("wrong archive, item, audit or revision cannot be imported or read as matching evidence", async () => {
  const f = await fixture({ "quiz/diagram.png": png });
  await recoverSourceAssets(f.file, f.scan, f.session);
  const receipt = recoveryReceipt(f.session);
  for (const k of [
    "auditId",
    "sourceId",
    "destinationId",
    "evidenceRevision",
    "packageSha256",
  ])
    assert.throws(
      () =>
        validateRecoveryReceipt(receipt, {
          ...f.session.binding,
          [k]: "wrong",
        }),
      /different/,
    );
  assert.equal(
    validateRecoveryReceipt(receipt, f.session.binding).status,
    "ORIGINAL_PACKAGE_REVALIDATION_REQUIRED",
  );
  await assert.rejects(
    recoverSourceAssets(
      new File(
        [
          await (
            await fixture({ "quiz/diagram.png": "wrong" })
          ).file.arrayBuffer(),
        ],
        "other.imscc",
      ),
      f.scan,
      f.session,
    ),
    /does not match/,
  );
});
test("excluded Archive and Instructor scope does not create automatic repair work", () => {
  for (const policy of [
    { inDecisionGate: false },
    { classification: "NON_LFM_POLICY_EXEMPT" },
  ]) {
    const r = structuredClone(report);
    r.result.itemResults[0].operationalPolicy = policy;
    assert.throws(
      () => sourceAssetBinding(r, "audit", "source-quiz", "dest-quiz"),
      /Excluded/,
    );
  }
});

test("destination ingestion failures remain independent of source question order and recovered bytes", async () => {
  const { destinationMediaFailures } = await import(
    "../src/domain/source-asset-recovery.ts"
  );
  const failures = destinationMediaFailures([
    {
      id: "dest-four",
      ordinal: 4,
      prompt: "[Error: Image could not be created]",
    },
    {
      id: "dest-two",
      ordinal: 2,
      prompt: "[Error: Image could not be created]",
    },
  ]);
  assert.equal(failures.length, 2);
  assert.equal(failures[0].questionId, "dest-four");
  assert.equal(failures[0].sourceQuestionBinding, "UNVERIFIED");
  assert.equal(failures[0].status, "DESTINATION_INGESTION_FAILURE");
  assert.equal(failures[0].learnerRenderingVerified, false);
});

test("same-named different binaries stay separate candidates after independent reads", async () => {
  const gif = Uint8Array.from(
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  );
  const f = await fixture({ "a/diagram.png": png, "b/diagram.png": gif });
  const r = await recoverSourceAssets(f.file, f.scan, f.session);
  assert.equal(new Set(r.rows[0].candidates.map((c) => c.sha256)).size, 2);
  assert.equal(r.rows[0].association, "UNVERIFIED");
  assert.equal(r.rows[0].status, "CANDIDATE_FOUND_IDENTITY_UNVERIFIED");
});

test("a retained scan hash conflict blocks exact-reference identity promotion", async () => {
  const f = await fixture({ "quiz/diagram.png": png });
  f.scan.sourceEvidence.resources["source-quiz"].files = [
    { path: "quiz/diagram.png", sha256: "f".repeat(64) },
  ];
  const r = await recoverSourceAssets(f.file, f.scan, f.session);
  assert.equal(r.rows[0].status, "CANDIDATE_FOUND_IDENTITY_UNVERIFIED");
  assert.equal(r.rows[0].candidates[0].status, "CONTENT_IDENTITY_CONFLICT");
});

test("saved TRDE120 media gap discovers its exact retained alternative without path guessing", async () => {
  const saved = JSON.parse(
    await readFile(
      new URL(
        "./fixtures/coursera/trde120-assessment-recovery.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const gap = (saved.result?.itemResults || saved.itemResults)
    .flatMap(
      (r) => r.checks?.structuredAssessment?.sourcePackageMediaGaps || [],
    )
    .find((g) => g.status === "PRESENT_DIFFERENT_PATH");
  assert.ok(gap);
  const plan = sourceAssetCandidates(
    { ref: gap.ref, expectedPath: gap.expectedPath },
    gap.candidates,
  );
  assert.deepEqual(
    plan.candidates.map((c) => c.path),
    gap.candidates,
  );
  assert.ok(
    plan.candidates.every((c) => c.method !== "EXACT_QUESTION_REFERENCE"),
  );
});
