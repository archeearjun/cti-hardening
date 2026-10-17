import test from "node:test";
import assert from "node:assert/strict";
import {
  pendingComparison,
  rememberPendingComparison,
  sessionPendingComparison,
  forgetPendingComparison,
  recordComparisonSaveFailure,
  recoverComparisonSave,
  unconfirmedComparisonExport,
} from "../src/domain/comparison-save-recovery.ts";

const copy = (value) => JSON.parse(JSON.stringify(value));
const notFound = () =>
  Object.assign(new Error("Workspace request: HTTP 404. Record not found."), {
    status: 404,
  });
const historyVersion = (rows, courseId) =>
  JSON.stringify(
    rows
      .filter((row) => row.kind === "audit" && row.packageId === courseId)
      .map((row) => [row.id, row.version, row.updatedAt])
      .sort(),
  );

async function fixture() {
  const course = {
    id: "course-a",
    kind: "package",
    title: "Original source course",
    packageId: "",
    version: 2,
    updatedAt: "2026-10-17T10:00:00Z",
    updatedBy: "owner@example.org",
    data: { scan: { fileSha256: "a".repeat(64) } },
  };
  const report = {
    packageId: course.id,
    generation: 3,
    report: "ORIGINAL FINDINGS\nAn image remains unavailable.",
    result: { summary: { critical: 1 } },
    contentEvidence: { schemaVersion: 1, coursera: [], brightspace: [] },
  };
  const calls = [];
  const rows = [course];
  let committed;
  const store = {
    mode: "team",
    role: "editor",
    email: "owner@example.org",
    async get(id) {
      calls.push(["get", id]);
      if (!committed) throw notFound();
      return copy(committed);
    },
    async list() {
      calls.push(["list"]);
      return copy(rows);
    },
    async save(record) {
      calls.push(["save", record.id, record.version]);
      committed = {
        ...copy(record),
        version: record.version + 1,
        updatedAt: "2026-10-17T11:00:00Z",
        updatedBy: "owner@example.org",
      };
      return copy(committed);
    },
  };
  const pending = await pendingComparison(
    report,
    "Original source course · generation 3 · ops",
    course,
    store,
    historyVersion(rows, course.id),
  );
  return {
    course,
    report,
    store,
    rows,
    calls,
    pending,
    setCommitted(value) {
      committed = value;
    },
    receipt() {
      return {
        ...copy(pending.record),
        version: 1,
        updatedAt: "2026-10-17T11:00:00Z",
        updatedBy: "owner@example.org",
      };
    },
  };
}

test("lost commit response adopts the identical existing audit without another write", async () => {
  const f = await fixture();
  f.setCommitted(f.receipt());
  const saved = await recoverComparisonSave(f.pending, f.store, historyVersion);
  assert.equal(saved.id, f.pending.record.id);
  assert.deepEqual(f.calls, [["get", f.pending.record.id]]);
});

test("explicit absence refreshes history and retries the original ID/version", async () => {
  const f = await fixture();
  let refreshed;
  const saved = await recoverComparisonSave(
    f.pending,
    f.store,
    historyVersion,
    (rows) => {
      refreshed = rows;
    },
  );
  assert.equal(saved.id, f.pending.record.id);
  assert.equal(saved.version, 1);
  assert.deepEqual(f.calls, [
    ["get", f.pending.record.id],
    ["list"],
    ["save", f.pending.record.id, 0],
  ]);
  assert.equal(refreshed[0].id, f.course.id);
  assert.equal(f.pending.record.version, 0);
  assert.equal(f.pending.record.updatedAt, "");
});

test("a failed retry retains identity and a later read recovers its committed audit", async () => {
  const f = await fixture();
  const actualSave = f.store.save;
  f.store.save = async (record) => {
    await actualSave(record);
    throw Object.assign(new Error("Commit response lost."), { status: 503 });
  };
  await assert.rejects(
    recoverComparisonSave(f.pending, f.store, historyVersion),
    /Commit response lost/,
  );
  const saved = await recoverComparisonSave(f.pending, f.store, historyVersion);
  assert.equal(saved.id, f.pending.record.id);
  assert.equal(f.calls.filter(([kind]) => kind === "save").length, 1);
  assert.equal(f.calls.at(-1)[0], "get");
});

test("uncertain reads, unknown-route responses and HTML404 never authorize a write", async () => {
  for (const [status, message] of [
    [503, "Service unavailable."],
    [409, "The saved revision changed."],
    [404, "Workspace request: HTTP 404. Unknown workspace route."],
    [
      404,
      "Workspace request: HTTP 404. The service returned a non-JSON or invalid response.",
    ],
    [401, "Sign in again."],
    [undefined, "Network failed."],
  ]) {
    const f = await fixture();
    f.store.get = async (id) => {
      f.calls.push(["get", id]);
      throw Object.assign(new Error(message), { status });
    };
    await assert.rejects(
      recoverComparisonSave(f.pending, f.store, historyVersion),
      (error) => error.message === message,
    );
    assert.deepEqual(f.calls, [["get", f.pending.record.id]]);
  }
});

test("an existing conflicting record never gets overwritten or treated as this report", async () => {
  const changes = [
    (r) => (r.kind = "operations"),
    (r) => (r.packageId = "another-course"),
    (r) => (r.id = "another-id"),
    (r) => (r.title = "different title"),
    (r) => (r.version = 2),
    (r) => (r.updatedBy = ""),
    (r) => (r.updatedAt = ""),
    (r) => (r.data.result.summary.critical = 0),
  ];
  for (const change of changes) {
    const f = await fixture();
    const record = f.receipt();
    change(record);
    f.setCommitted(record);
    await assert.rejects(
      recoverComparisonSave(f.pending, f.store, historyVersion),
      /different evidence or an invalid save receipt/,
    );
    assert.deepEqual(f.calls, [["get", f.pending.record.id]]);
    assert.equal(
      unconfirmedComparisonExport(f.pending).evidence.result.summary.critical,
      1,
    );
  }
});

test("fresh course or ingestion-history changes keep the result downloadable without saving", async () => {
  for (const change of [
    (f) => f.rows.splice(0),
    (f) => (f.rows[0].version = 3),
    (f) =>
      f.rows.push({
        ...f.receipt(),
        id: "another-audit",
        updatedAt: "2026-10-17T11:30:00Z",
      }),
  ]) {
    const f = await fixture();
    change(f);
    await assert.rejects(
      recoverComparisonSave(f.pending, f.store, historyVersion),
      /evidence or ingestion history changed/,
    );
    assert.equal(
      f.calls.some(([kind]) => kind === "save"),
      false,
    );
    assert.equal(unconfirmedComparisonExport(f.pending).evidence.generation, 3);
  }
});

test("account changes prevent checking another account; viewers can confirm but cannot retry", async () => {
  const f = await fixture();
  f.store.email = "different@example.org";
  await assert.rejects(
    recoverComparisonSave(f.pending, f.store, historyVersion),
    /Reconnect the workspace account/,
  );
  assert.deepEqual(f.calls, []);
  f.store.email = f.pending.actor.email;
  f.store.role = "viewer";
  await assert.rejects(
    recoverComparisonSave(f.pending, f.store, historyVersion),
    /account is read-only/,
  );
  f.setCommitted(f.receipt());
  assert.equal(
    (await recoverComparisonSave(f.pending, f.store, historyVersion)).id,
    f.pending.record.id,
  );
  assert.equal(
    f.calls.some(([kind]) => kind === "save"),
    false,
  );
});

test("local-store absence is explicit; cancellation never triggers a retry", async () => {
  const f = await fixture();
  f.store.mode = "local";
  f.pending.actor.mode = "local";
  f.store.get = async () => {
    throw Error("Record not found.");
  };
  assert.equal(
    (await recoverComparisonSave(f.pending, f.store, historyVersion)).id,
    f.pending.record.id,
  );
  const abort = new AbortController();
  abort.abort();
  f.calls.splice(0);
  await assert.rejects(
    recoverComparisonSave(
      f.pending,
      f.store,
      historyVersion,
      undefined,
      abort.signal,
    ),
    { name: "AbortError" },
  );
  assert.deepEqual(f.calls, []);
});

test("local exports retain the exact computed evidence and label the unconfirmed save", async () => {
  const f = await fixture();
  // Unsaved edits on the working report cannot alter the detached recovery copy.
  f.report.result.summary.critical = 0;
  f.report.unsavedOwnerNote = "Not part of the computed audit.";
  const exported = unconfirmedComparisonExport(f.pending);
  assert.equal(exported.evidence.result.summary.critical, 1);
  assert.equal(exported.evidence.unsavedOwnerNote, undefined);
  assert.equal(
    exported.evidence.localComparisonRecovery.status,
    "SAVE_UNCONFIRMED",
  );
  assert.equal(
    exported.evidence.localComparisonRecovery.sharedSaveConfirmed,
    false,
  );
  assert.equal(
    exported.evidence.localComparisonRecovery.savedFollowUpsIncluded,
    false,
  );
  assert.equal(
    exported.evidence.localComparisonRecovery.auditId,
    f.pending.record.id,
  );
  assert.match(exported.text, /SHARED SAVE UNCONFIRMED/);
  assert.match(exported.text, /An image remains unavailable/);
  assert.equal(
    exported.text.includes("Not part of the computed audit."),
    false,
  );
  assert.equal(f.pending.record.data.localComparisonRecovery, undefined);
});

test("changed recovery bytes cannot be saved under the original computed hash", async () => {
  const f = await fixture();
  f.pending.record.data.result.summary.critical = 0;
  await assert.rejects(
    recoverComparisonSave(f.pending, f.store, historyVersion),
    /recovery copy changed/,
  );
  assert.deepEqual(f.calls, []);
});

test("memory-only remount recovery is scoped to the same account and workspace", async () => {
  const f = await fixture();
  rememberPendingComparison(f.pending);
  assert.equal(sessionPendingComparison(f.store), f.pending);
  assert.equal(
    sessionPendingComparison({ ...f.store, email: "other@example.org" }),
    null,
  );
  assert.equal(sessionPendingComparison({ ...f.store, mode: "local" }), null);
  forgetPendingComparison({
    ...f.pending,
    record: { ...f.pending.record, id: "another-id" },
  });
  assert.equal(sessionPendingComparison(f.store), f.pending);
  forgetPendingComparison(f.pending);
  assert.equal(sessionPendingComparison(f.store), null);
});

test("save diagnostics supplement recovery exports without changing computed audit bytes", async () => {
  const f = await fixture();
  const before = JSON.stringify(f.pending.record.data);
  const failure = Object.assign(
    new Error("Finalizing synthetic: HTTP 503. Gateway unavailable."),
    {
      code: "WORKSPACE_RESPONSE_INVALID",
      context: "Finalizing synthetic",
      phase: "finalize",
      status: 503,
      attempts: 1,
      cloudflare: {
        rayId: "synthetic-BOM",
        errorType: "1102",
        errorOrigin: "worker",
        cookie: "never export",
      },
      responseBody: "<html>never export</html>",
    },
  );
  assert.equal(recordComparisonSaveFailure(f.pending, failure), true);
  const exported = unconfirmedComparisonExport(f.pending);
  assert.equal(
    exported.evidence.localComparisonRecovery.lastSaveFailure.status,
    503,
  );
  assert.deepEqual(
    exported.evidence.localComparisonRecovery.lastSaveFailure.cloudflare,
    { rayId: "synthetic-BOM", errorType: "1102", errorOrigin: "worker" },
  );
  assert.equal(JSON.stringify(exported).includes("never export"), false);
  assert.equal(JSON.stringify(f.pending.record.data), before);
  assert.equal(f.pending.record.data.lastSaveFailure, undefined);
  assert.equal(
    recordComparisonSaveFailure(f.pending, new Error("unstructured")),
    false,
  );
});
