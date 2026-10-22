import { decodeDownloadBatch } from "../src/domain/workspace-download-batch.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { CTI_OWNER_EMAIL } from "../server/access.ts";
import { recordSummary } from "../src/domain/workspace-store.ts";
import {
  syntheticRuntimeCourse,
  syntheticRuntimeAudit,
  runtimeFixtureBytes,
  runtimeFixtureQuestionCount,
} from "./fixtures/workspace-runtime-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(path.join(os.tmpdir(), "cti-workspace-workerd-"));
const cli = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
const childEnv = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  CI: "true",
  NO_COLOR: "1",
};
for (const key of [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_API_TOKEN",
  "CF_API_KEY",
])
  delete childEnv[key];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const chunkSize = 131072;
let worker;
let log = "";
function capture(child) {
  child.stdout.on("data", (data) => {
    log += data;
  });
  child.stderr.on("data", (data) => {
    log += data;
  });
}
async function command(args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, {
      cwd: root,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    capture(child);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Wrangler fixture setup timed out."));
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(Error(`Wrangler fixture setup exited ${code}.`));
    });
  });
}
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
try {
  const config = path.join(scratch, "wrangler.json");
  const state = path.join(scratch, "state");
  await writeFile(
    config,
    JSON.stringify({
      name: "cti-synthetic-workspace-runtime-check",
      main: path.join(root, "tools/fixtures/worker-workspace-runtime.mjs"),
      compatibility_date: "2026-10-01",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      durable_objects: {
        bindings: [
          { name: "WORKSPACE_RUNTIME", class_name: "WorkspaceRuntime" },
        ],
      },
      migrations: [
        {
          tag: "synthetic-runtime-v1",
          new_sqlite_classes: ["WorkspaceRuntime"],
        },
      ],
      d1_databases: [
        {
          binding: "CTI_DB",
          database_name: "cti-synthetic-workspace-runtime",
          database_id: "00000000-0000-0000-0000-000000000001",
        },
      ],
    }),
  );
  // Local-only D1, isolated under this temporary directory. No Cloudflare
  // account, credentials, production data, or outbound provider is contacted.
  await command([
    "d1",
    "execute",
    "CTI_DB",
    "--local",
    "--config",
    config,
    "--persist-to",
    state,
    "--file",
    path.join(root, "server/schema.sql"),
    "--yes",
  ]);
  worker = spawn(
    cli,
    [
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "0",
      "--inspector-port",
      "0",
      "--config",
      config,
      "--persist-to",
      state,
    ],
    { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  capture(worker);
  let exited;
  worker.on("error", (error) => {
    exited = error;
  });
  worker.on("exit", (code) => {
    exited = Error(`Wrangler local runtime exited ${code}.`);
  });
  let base;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exited) throw exited;
    const ready = /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/g;
    const matches = [...log.matchAll(ready)];
    for (const match of matches.reverse()) {
      const candidate = `http://127.0.0.1:${match[1]}`;
      try {
        const response = await fetch(candidate + "/__fixture-ready", {
          signal: AbortSignal.timeout(750),
        });
        if (response.ok && (await response.json()).syntheticFixture === true) {
          base = candidate;
          break;
        }
      } catch {
        /* wait for the local listener, without contacting the internet */
      }
    }
    if (base) break;
    await pause(100);
  }
  assert(base, "The actual local Workers runtime did not become ready.");
  const headers = {
    "x-cti-workspace-runtime": "v1",
    "x-cti-user": CTI_OWNER_EMAIL,
    "x-cti-role": "editor",
    Origin: "https://cti-coursera-extractor.internal",
  };
  async function request(
    route,
    method = "GET",
    body,
    overrides = {},
    expected = 200,
  ) {
    const merged = { ...headers, ...overrides };
    for (const [key, value] of Object.entries(merged))
      if (value === null) delete merged[key];
    const response = await fetch(base + "/workspace/api/" + route, {
      method,
      headers: merged,
      body: typeof body === "string" ? body : body,
      signal: AbortSignal.timeout(60000),
    });
    const accepted = Array.isArray(expected) ? expected : [expected];
    assert(
      accepted.includes(response.status),
      `${method} ${route}: expected ${accepted}, received ${response.status}: ${await response.clone().text()}`,
    );
    return response;
  }
  async function prepare(record, expected = 200) {
    const bytes = Buffer.from(JSON.stringify(record.data));
    const manifest = {
      record: recordSummary(record),
      bytes: bytes.length,
      parts: Math.ceil(bytes.length / chunkSize),
      sha256: sha(bytes),
      allowSemanticDuplicate: false,
    };
    const response = await request(
      "uploads",
      "POST",
      JSON.stringify(manifest),
      {},
      expected,
    );
    return { record, bytes, manifest, prepared: await response.json() };
  }
  async function upload(prepared) {
    for (let part = 0; part < prepared.manifest.parts; part++)
      await request(
        `uploads/${prepared.prepared.id}/chunks/${part}`,
        "PUT",
        prepared.bytes.subarray(part * chunkSize, (part + 1) * chunkSize),
      );
  }
  async function commit(prepared, expected = 200) {
    return (
      await request(
        `uploads/${prepared.prepared.id}/commit`,
        "POST",
        JSON.stringify({ allowSemanticDuplicate: false }),
        {},
        expected,
      )
    ).json();
  }
  async function save(record) {
    const staged = await prepare(record);
    await upload(staged);
    return {
      staged,
      saved: { ...(await commit(staged)).record, data: record.data },
    };
  }
  async function read(id) {
    const started = performance.now();
    const manifest = await (await request(`records/${id}`)).json();
    const parts = [];
    for (let part = 0; part < manifest.parts; part++) {
      const response = await request(
        `records/${id}/chunks/${part}?revision=${manifest.revision}`,
      );
      assert.equal(
        response.headers.get("content-type"),
        "application/octet-stream",
      );
      parts.push(Buffer.from(await response.arrayBuffer()));
    }
    const bytes = Buffer.concat(parts);
    assert.equal(
      sha(bytes),
      manifest.sha256,
      "Downloaded bytes match the original persisted SHA-256.",
    );
    console.log(
      "CTI_WORKERD_INDIVIDUAL_PASS " +
        JSON.stringify({
          bytes: bytes.length,
          chunks: manifest.parts,
          requests: 1 + manifest.parts,
          elapsedMs: performance.now() - started,
        }),
    );
    return {
      ...manifest.record,
      data: JSON.parse(bytes.toString()),
      raw: bytes,
      sha256: manifest.sha256,
    };
  }
  async function readBatches(id, expectedBytes) {
    const started = performance.now();
    const manifest = await (await request(`records/${id}`)).json();
    assert.deepEqual(manifest.downloadBatch, { version: 1, maxParts: 8 });
    const parts = [];
    let batches = 0,
      maxFrameBytes = 0;
    for (let first = 0; first < manifest.parts; first += 8) {
      const count = Math.min(8, manifest.parts - first);
      const response = await request(
        `records/${id}/chunk-batch?revision=${manifest.revision}&first=${first}&count=${count}`,
      );
      const frame = new Uint8Array(await response.arrayBuffer());
      maxFrameBytes = Math.max(maxFrameBytes, frame.length);
      parts.push(
        ...(await decodeDownloadBatch(frame, {
          recordId: id,
          revision: manifest.revision,
          sha256: manifest.sha256,
          bytes: manifest.bytes,
          parts: manifest.parts,
          first,
          count,
        })),
      );
      batches++;
    }
    const bytes = Buffer.concat(parts);
    assert.deepEqual(bytes, expectedBytes);
    assert.equal(sha(bytes), manifest.sha256);
    console.log(
      "CTI_WORKERD_BATCH_PASS " +
        JSON.stringify({
          bytes: bytes.length,
          chunks: manifest.parts,
          batches,
          requests: 1 + batches,
          maxFrameBytes,
          elapsedMs: performance.now() - started,
          productionQuotaAttested: false,
        }),
    );
    await request(
      `records/${id}/chunk-batch?revision=${manifest.revision}&first=0&count=9`,
      "GET",
      undefined,
      {},
      400,
    );
    await request(
      `records/${id}/chunk-batch?revision=${manifest.revision}&first=0&count=1`,
      "GET",
      undefined,
      { "x-cti-user": "other@example.test" },
      403,
    );
  }
  // The private service binding is the trust boundary, not a fabricated JWT.
  await request(
    "records",
    "GET",
    undefined,
    { "x-cti-workspace-runtime": null },
    401,
  );
  await request(
    "records",
    "GET",
    undefined,
    { "x-cti-user": "other@example.test" },
    403,
  );
  await request(
    "records",
    "GET",
    undefined,
    { "x-cti-role": "administrator" },
    401,
  );
  await request("records?fixtureForeignOrigin=1", "GET", undefined, {}, 404);
  await request(
    "uploads",
    "POST",
    "{}",
    { Origin: "https://untrusted.example.test" },
    403,
  );
  await request("uploads", "POST", "{}", { "x-cti-role": "viewer" }, 403);

  const course = syntheticRuntimeCourse();
  const savedCourse = (await save(course)).saved;
  const audit = syntheticRuntimeAudit(course, savedCourse);
  const stagedAudit = await prepare(audit);
  assert.equal(
    stagedAudit.manifest.parts,
    81,
    "Realistic synthetic report uses the observed 81-chunk scale.",
  );
  await upload(stagedAudit);
  const status = await (
    await request(`uploads/${stagedAudit.prepared.id}`)
  ).json();
  assert.equal(status.receivedParts.length, 81);
  const savedAudit = (await commit(stagedAudit)).record;
  assert.equal(savedAudit.id, audit.id);
  assert.equal(savedAudit.version, 1);
  const roundTrip = await read(audit.id);
  assert.equal(roundTrip.raw.length, runtimeFixtureBytes);
  assert.equal(roundTrip.sha256, stagedAudit.manifest.sha256);
  assert.deepEqual(roundTrip.data, audit.data);
  await readBatches(audit.id, stagedAudit.bytes);
  assert.equal(roundTrip.updatedBy, CTI_OWNER_EMAIL);
  const immutable = await prepare({ ...audit, version: 1 }, 409);
  assert.match(immutable.prepared.error, /immutable|overwritten/i);

  // The same validated transition path must retain optimistic concurrency.
  const left = await prepare({
    ...savedCourse,
    title: "Synthetic concurrent winner",
  });
  const right = await prepare({
    ...savedCourse,
    title: "Synthetic concurrent stale",
  });
  await upload(left);
  await upload(right);
  const competing = await Promise.all(
    [left, right].map(async (staged) => {
      const response = await request(
        `uploads/${staged.prepared.id}/commit`,
        "POST",
        JSON.stringify({ allowSemanticDuplicate: false }),
        {},
        [200, 409],
      );
      return { status: response.status, data: await response.json() };
    }),
  );
  assert.deepEqual(competing.map((value) => value.status).sort(), [200, 409]);
  assert.match(
    competing.find((value) => value.status === 409).data.error,
    /committed first|Another change|changed/i,
  );

  // A stale automatic basis must fail at commit even though its bytes upload.
  const stale = {
    ...audit,
    id: "synthetic-runtime-stale-basis",
    title: "Synthetic stale basis rejection",
    data: {
      ...audit.data,
      contentEvidence: { schemaVersion: 1, coursera: [], brightspace: [] },
    },
  };
  const staleStaged = await prepare(stale);
  await upload(staleStaged);
  assert.match(
    (await commit(staleStaged, 400)).error,
    /history changed|basis is stale/i,
  );
  await request(`records/${stale.id}`, "GET", undefined, {}, 404);
  const invalid = {
    ...stale,
    id: "synthetic-runtime-invalid-content",
    data: {
      ...stale.data,
      contentEvidence: {
        schemaVersion: 1,
        brightspace: [],
        coursera: [
          {
            ...audit.data.contentEvidence.coursera[0],
            content: {
              ...audit.data.contentEvidence.coursera[0].content,
              textCoverage: "INVENTED_VERIFIED",
            },
          },
        ],
      },
    },
  };
  const invalidStaged = await prepare(invalid);
  await upload(invalidStaged);
  assert.match(
    (await commit(invalidStaged, 400)).error,
    /Invalid saved content evidence/,
  );
  await request(`records/${invalid.id}`, "GET", undefined, {}, 404);
  // Maximum supported original, saved through the unchanged validator/upload path.
  const maxData = { syntheticOriginal: true, padding: "" };
  maxData.padding = "x".repeat(
    32 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(maxData)),
  );
  const maximum = {
    id: "synthetic-max-download",
    kind: "legacy-backup",
    title: "Synthetic maximum original",
    packageId: "",
    version: 0,
    updatedAt: "",
    updatedBy: "",
    data: maxData,
  };
  headers["x-cti-role"] = "admin";
  const maxSaved = await save(maximum);
  headers["x-cti-role"] = "editor";
  await read(maximum.id);
  await readBatches(maximum.id, maxSaved.staged.bytes);
  const viewer = await (
    await request("records", "GET", undefined, { "x-cti-role": "viewer" })
  ).json();
  assert(viewer.records.some((record) => record.id === audit.id));
  console.log(
    "CTI_WORKERD_WORKSPACE_PASS " +
      JSON.stringify({
        synthetic: true,
        actualWorkersRuntime: true,
        actualSqliteD1: true,
        actualDurableObject: true,
        reportBytes: runtimeFixtureBytes,
        reportParts: 81,
        capturedSyntheticQuestionDefinitions: runtimeFixtureQuestionCount,
        invalidContentRejected: true,
        immutableAudit: true,
        optimisticConflict: true,
        staleBasisRejected: true,
        serviceBindingEnvelopeChecked: true,
        productionAccessOrQuotaAttested: false,
      }),
  );
} catch (error) {
  // Only this credential-free local fixture's stdout is printed on failure.
  if (log) process.stderr.write(log.slice(-24000));
  throw error;
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => worker.once("exit", resolve)),
      pause(3000),
    ]);
    if (worker.exitCode === null) worker.kill("SIGKILL");
  }
  await rm(scratch, { recursive: true, force: true });
}
