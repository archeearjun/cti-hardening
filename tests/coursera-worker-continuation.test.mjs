import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { CTI_RELEASE_REGISTRY_ } from "../src/engine/release.js";
import {
  captureContractV6150,
  captureContractSummaryV6150,
  finalCaptureAccountingV6150,
} from "../src/extractors/coursera/completion.js";
import {
  evaluateCourseraCapture,
  parseCourseraShellUrl,
} from "../src/domain/coursera-background-extraction.ts";

// Execute the maintained Worker and Workflow with synthetic platform services.
// Real IndexedDB and generated browser code are exercised by the browser suite.
const source = fs.readFileSync(
  new URL("../workers/coursera-extractor/index.ts", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "worker.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const maintained = parsed.statements
  .filter((statement) => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
  .map((statement) => statement.getFullText(parsed))
  .join("\n");
const executable = ts
  .transpileModule(maintained, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  .outputText.replace(
    "export class CourseraExtractionWorkflow",
    "class CourseraExtractionWorkflow",
  )
  .replace("export default", "const worker =");
const load = new Function(
  "launch",
  "playwrightLimits",
  "WorkflowEntrypoint",
  "courseraSource",
  "CTI_RELEASE_REGISTRY_",
  "captureContractSummaryV6150",
  "finalCaptureAccountingV6150",
  "evaluateCourseraCapture",
  "parseCourseraShellUrl",
  "forwardWorkspaceRuntime",
  executable + ";return {CourseraExtractionWorkflow,worker};",
);
const payload = {
  kind: "extract",
  id: "synthetic-job",
  ownerHash: "synthetic-owner",
  courseId: "Course_id_123",
  shellUrl:
    "https://www.coursera.org/teach/synthetic/Course_id_123/content/edit",
};

function capture(attempts, yielded) {
  const fingerprints = Array.from({ length: 2 }, (_, index) => ({
    id: "reading-" + index,
    name: "Reading " + index,
    type: "Reading",
    typeName: "supplement",
    payload:
      index < attempts
        ? {
            captureAttempts: 1,
            textSample: "Observed learner text.",
            textConfidence: "high",
            textEvidenceCompleteness: 1,
            textScopeKind: "reading-content-field",
            textCaptureEvidence: {
              method: "EXACT_READING_FIELD",
              itemId: "reading-" + index,
              observedCharacters: 22,
              capturedCharacters: 22,
            },
          }
        : {},
  }));
  for (const fp of fingerprints) fp.captureContract = captureContractV6150(fp);
  const activeSpaCrawl = {
    cooperativeChunkYielded: yielded,
    timeBudgetExhausted: yielded,
    unvisitedTargetIds: fingerprints.slice(attempts).map((fp) => fp.id),
  };
  return {
    schemaVersion: 35,
    page: { courseId: payload.courseId },
    meta: {
      baseFingerprintCount: 2,
      backgroundChunk: { enabled: true, yielded },
      activeSpaCrawl,
      captureAccounting: finalCaptureAccountingV6150(
        fingerprints,
        activeSpaCrawl,
      ),
    },
    fingerprints,
  };
}

async function harness(captures, { launchError } = {}) {
  const objects = new Map(),
    receipts = {
      launches: 0,
      closed: 0,
      injected: 0,
      storage: [],
      steps: [],
      statuses: [],
    };
  const env = {
    CTI_SESSION_KEY: "synthetic-test-secret-at-least-32-characters",
    BROWSER: {},
    EXTRACTION_WORKFLOW: {},
    ARTIFACTS: {
      async put(key, value) {
        objects.set(key, value);
        if (key.endsWith("/status.json"))
          receipts.statuses.push(JSON.parse(value));
      },
      async get(key) {
        const value = objects.get(key);
        return value === undefined
          ? null
          : { json: async () => JSON.parse(value), text: async () => value };
      },
      async delete(key) {
        objects.delete(key);
      },
      async head(key) {
        return objects.has(key) ? {} : null;
      },
    },
  };
  await env.ARTIFACTS.put(
    `jobs/${payload.id}/status.json`,
    JSON.stringify({
      ...payload,
      state: "QUEUED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifactAvailable: false,
    }),
  );
  const launch = async () => {
    if (launchError && receipts.launches >= captures.length) throw launchError;
    const raw = captures[Math.min(receipts.launches++, captures.length - 1)];
    const sandbox = vm.createContext({
      window: {},
      document: {
        title: "Edit Content",
        body: { innerText: "Course material content" },
        getElementById: () => null,
        querySelector: () => null,
      },
      location: new URL(payload.shellUrl),
      fetch: async () => ({ ok: true }),
    });
    const page = {
      async goto() {},
      async waitForTimeout() {},
      url: () => payload.shellUrl,
      on() {},
      async evaluate(fn, arg) {
        sandbox.argument = arg;
        return vm.runInContext("(" + fn.toString() + ")(argument)", sandbox);
      },
      async addScriptTag({ content }) {
        assert.equal(content, "synthetic canonical bundle");
        assert(sandbox.window.__CTI_BACKGROUND_CHUNK_DEADLINE_MS > Date.now());
        receipts.injected++;
        sandbox.window.__CTI_LAST_JSON = JSON.stringify(raw);
        sandbox.window.__CTI_LAST_RESULT = raw;
      },
    };
    return {
      async newContext(options) {
        receipts.storage.push(options.storageState || null);
        return {
          newPage: async () => page,
          storageState: async (options) => {
            assert.equal(options.indexedDB, true);
            return {
              cookies: [],
              origins: [
                {
                  origin: "https://www.coursera.org",
                  indexedDB: [
                    {
                      name: "synthetic-checkpoints",
                      observedItems: raw.fingerprints.filter(
                        (fp) => fp.payload.captureAttempts,
                      ).length,
                    },
                  ],
                },
              ],
            };
          },
        };
      },
      async close() {
        receipts.closed++;
      },
    };
  };
  const { CourseraExtractionWorkflow, worker } = load(
    launch,
    async () => ({
      allowedBrowserAcquisitions: 1,
      maxConcurrentSessions: 3,
      activeSessions: [],
    }),
    class {
      constructor(env) {
        this.env = env;
      }
    },
    "synthetic canonical bundle",
    CTI_RELEASE_REGISTRY_,
    captureContractSummaryV6150,
    finalCaptureAccountingV6150,
    evaluateCourseraCapture,
    parseCourseraShellUrl,
    () => { throw Error("Workspace routes use the independent Durable Object runtime fixture."); },
  );
  const workflow = new CourseraExtractionWorkflow(env);
  const run = () =>
    workflow.run(
      { payload },
      {
        async do(name, options, fn) {
          receipts.steps.push({ name, options });
          return fn();
        },
      },
    );
  return {
    run,
    objects,
    receipts,
    health: async (role) =>
      (
        await worker.fetch(
          new Request("https://internal/health", {
            headers: {
              "x-cti-user": "synthetic@example.test",
              "x-cti-role": role,
            },
          }),
          env,
        )
      ).json(),
  };
}

test("Worker resumes encrypted checkpoints in a fresh browser and publishes only the final verdict", async () => {
  const h = await harness([capture(1, true), capture(2, false)]);
  const result = await h.run();
  assert.equal(result.chunks, 2);
  assert.equal(h.receipts.closed, 2);
  assert.equal(h.receipts.storage[0], null);
  assert.equal(h.receipts.storage[1].origins[0].indexedDB[0].observedItems, 1);
  assert(
    h.receipts.statuses
      .filter((status) => status.state === "RUNNING")
      .every((status) => !status.artifactAvailable),
  );
  const final = h.receipts.statuses.at(-1);
  assert.equal(final.state, "COMPLETE", JSON.stringify(final.capture));
  assert.equal(final.artifactAvailable, true);
  assert.equal(final.capture.completeCount, 2);
  assert.equal(h.objects.has(`jobs/${payload.id}/runtime-state.json`), false);
  assert.equal(
    JSON.parse(h.objects.get(`jobs/${payload.id}/capture.json`)).fingerprints
      .length,
    2,
  );
});

test("stalled automatic sessions stop, close each browser and expose the retained partial artifact", async () => {
  const h = await harness([capture(1, true)]);
  await assert.rejects(h.run(), /no item progress across three/);
  assert.equal(h.receipts.closed, 3);
  const final = h.receipts.statuses.at(-1);
  assert.equal(final.state, "FAILED");
  assert.equal(final.artifactAvailable, true);
  assert.equal(final.capture.complete, false);
  assert.equal(h.objects.has(`jobs/${payload.id}/runtime-state.json`), true);
});

test("lost browser capacity preserves the previous raw batch for recovery without false completion", async () => {
  const h = await harness([capture(1, true)], {
    launchError: new Error("synthetic platform unavailable"),
  });
  await assert.rejects(h.run(), /synthetic platform unavailable/);
  assert.equal(h.receipts.closed, 1);
  assert.equal(h.receipts.statuses.at(-1).state, "FAILED");
  assert.equal(h.receipts.statuses.at(-1).artifactAvailable, true);
  assert.equal(
    JSON.parse(h.objects.get(`jobs/${payload.id}/capture.json`)).meta
      .captureAccounting.complete,
    false,
  );
});

test("unavailable item checkpoint storage stops rather than silently continuing", async () => {
  const partial = capture(1, true);
  partial.meta.backgroundChunk.rendererBatch = { checkpointFailed: true };
  const h = await harness([partial]);
  await assert.rejects(h.run(), /item checkpoints could not be saved/);
  assert.equal(h.receipts.closed, 1);
  assert.equal(h.receipts.statuses.at(-1).state, "FAILED");
  assert.equal(h.receipts.statuses.at(-1).artifactAvailable, true);
});

test("capture service discovery reports availability and trusted read-only permission independently of record storage", async () => {
  const h = await harness([capture(2, false)]);
  const viewer = await h.health("viewer"),
    editor = await h.health("editor");
  assert.equal(viewer.ok, true);
  assert.equal(viewer.editable, false);
  assert.equal(editor.editable, true);
  assert.equal(editor.browserBinding, true);
  assert.equal(editor.artifactBinding, true);
  assert.equal(editor.workflowBinding, true);
  assert.equal(editor.sessionEncryption, true);
  assert.equal(h.receipts.launches, 0);
});
