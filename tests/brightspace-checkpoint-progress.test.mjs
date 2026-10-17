import test from "node:test";
import assert from "node:assert/strict";
import {
  createBrightspaceCheckpointV110,
  loadBrightspacePreviousRecoveryV111,
  BRIGHTSPACE_CHECKPOINT_MAX_BYTES_V110,
} from "../src/extractors/brightspace/checkpoint.js";
import { createBrightspaceProgressPanelV110 } from "../src/extractors/brightspace/progress.js";

function storageFixture() {
  const stores = new Map(),
    indices = new Map(),
    reads = [];
  let created = false,
    failWrites = false,
    opens = 0;
  const compare = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let n = 0; n < Math.min(a.length, b.length); n++) {
        const c = compare(a[n], b[n]);
        if (c) return c;
      }
      return a.length - b.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };
  function connection() {
    return {
      objectStoreNames: { contains: (name) => stores.has(name) },
      close() {},
      createObjectStore(name) {
        stores.set(name, new Map());
        indices.set(name, new Map());
        return {
          createIndex(index, path) {
            indices.get(name).set(index, path);
          },
        };
      },
      transaction(name, mode) {
        const source = stores.get(name),
          working = new Map(source),
          queue = [];
        const tx = {
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
        };
        let scheduled = false,
          done = false;
        function enqueue(fn) {
          queue.push(fn);
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(drain);
          }
        }
        function drain() {
          scheduled = false;
          if (done) return;
          const fn = queue.shift();
          try {
            if (fn) fn();
          } catch (error) {
            done = true;
            tx.error = error;
            tx.onabort?.();
            return;
          }
          if (queue.length) {
            scheduled = true;
            queueMicrotask(drain);
          } else
            queueMicrotask(() => {
              if (!done && !queue.length) {
                done = true;
                if (mode === "readwrite") stores.set(name, working);
                tx.oncomplete?.();
              }
            });
        }
        const store = {
          put(row) {
            enqueue(() => {
              if (failWrites)
                throw new DOMException(
                  "Synthetic quota failure",
                  "QuotaExceededError",
                );
              working.set(row.key, structuredClone(row));
            });
          },
          delete(key) {
            enqueue(() => working.delete(key));
          },
          index(index) {
            const field = indices.get(name).get(index);
            if (!field) throw Error("Unknown index");
            function cursor(range, direction, keysOnly) {
              const request = { result: null, onsuccess: null };
              let position = 0,
                rows;
              reads.push({ keysOnly, index });
              function step() {
                if (!rows) {
                  rows = [...working.values()]
                    .map((value) => ({
                      value,
                      key: field.map((part) => value[part]),
                    }))
                    .filter(
                      (row) =>
                        compare(row.key, range.lower) >= 0 &&
                        compare(row.key, range.upper) <= 0,
                    )
                    .sort((a, b) => compare(a.key, b.key));
                  if (direction === "prev") rows.reverse();
                }
                const row = rows[position++];
                request.result = row
                  ? {
                      key: row.key,
                      primaryKey: row.value.key,
                      continue() {
                        enqueue(step);
                      },
                      ...(!keysOnly
                        ? { value: structuredClone(row.value) }
                        : {}),
                    }
                  : null;
                request.onsuccess?.();
              }
              enqueue(step);
              return request;
            }
            return {
              openCursor: (range, direction) => cursor(range, direction, false),
              openKeyCursor: (range, direction) =>
                cursor(range, direction, true),
            };
          },
        };
        tx.objectStore = () => store;
        return tx;
      },
    };
  }
  return {
    indexedDB: {
      open() {
        opens++;
        const request = {
          result: null,
          onupgradeneeded: null,
          onsuccess: null,
        };
        queueMicrotask(() => {
          request.result = connection();
          if (!created) {
            created = true;
            request.onupgradeneeded?.();
          }
          request.onsuccess?.();
        });
        return request;
      },
    },
    IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) },
    rows: () => [...(stores.get("runs") || new Map()).values()],
    reads,
    opens: () => opens,
    failWrites(value) {
      failWrites = value;
    },
    tamper(fn) {
      for (const row of stores.get("runs").values()) fn(row);
    },
  };
}
function session(storage, change = {}) {
  return createBrightspaceCheckpointV110({
    origin: "https://lms.example.test",
    courseId: "123",
    buildId: "v1.1.0-test",
    indexedDB: storage.indexedDB,
    IDBKeyRange: storage.IDBKeyRange,
    ...change,
  });
}
const observation = {
  course: { orgUnitId: "123" },
  capture: {
    course: { orgUnitId: "123" },
    buildId: "v1.1.0-test",
    page: { origin: "https://lms.example.test" },
    capturedAt: "2026-10-15T10:00:00.000Z",
    body: {
      observedAt: "2026-10-15T09:59:00.000Z",
      text: "Literal source text café 日本語",
    },
  },
};

test("checkpoint factory is passive; exact saved observation dates survive reload without fresh API claims", async () => {
  const db = storageFixture(),
    s = session(db, { runId: "initial" });
  assert.equal(db.opens(), 0);
  const input = structuredClone(observation),
    pending = s.save(input, { status: "PAUSED" });
  input.capture.body.text = "A later in-memory edit";
  const receipt = await pending;
  assert.equal(receipt.fingerprintAlgorithm, "SHA256_CHUNKS_V1");
  assert.equal(
    (await session(db).load()).state.capture.body.text,
    observation.capture.body.text,
  );
  assert.deepEqual((await session(db).load()).state, observation);
  assert.equal((await session(db).load()).status, "PAUSED");
  assert(
    db.reads.every((row) => row.index !== "scopeKey"),
    "No read loads historical capture bodies with getAll",
  );
  assert.equal(BRIGHTSPACE_CHECKPOINT_MAX_BYTES_V110, 128 * 1024 * 1024);
  await s.close();
});

test("course, build and origin scopes never read or prune one another", async () => {
  const db = storageFixture();
  await session(db).save(observation);
  assert.equal(await session(db, { courseId: "456" }).load(), null);
  assert.equal(await session(db, { buildId: "another-build" }).load(), null);
  assert.equal(
    await session(db, { origin: "https://another-lms.example.test" }).load(),
    null,
  );
  await assert.rejects(
    session(db, { courseId: "456" }).save(observation),
    (error) => error.code === "BRIGHTSPACE_CHECKPOINT_IDENTITY",
  );
  assert.equal(db.rows().length, 1);
});

test("v1.1.1 can recover the exact earlier v1.1.0 observations read-only while new attempts retain their own build scope", async () => {
  const db = storageFixture(),
    previousBuild = "v1.1.0-faithful-bookmark-20261016",
    currentBuild = "v1.1.1-native-image-view-20261017",
    old = structuredClone(observation);
  old.capture.buildId = previousBuild;
  old.capture.attempt = { id: "previous-finished" };
  const legacy = session(db, { buildId: previousBuild });
  await legacy.save(old, { status: "FINISHED" });
  const partial = structuredClone(old);
  partial.capture.attempt.id = "previous-paused";
  partial.capture.body.text += " Original paused attempt";
  await legacy.save(partial, { status: "PAUSED" });
  const before = structuredClone(db.rows());
  const options = {
    origin: "https://lms.example.test",
    courseId: "123",
    buildId: currentBuild,
    indexedDB: db.indexedDB,
    IDBKeyRange: db.IDBKeyRange,
  };
  assert.equal(await session(db, { buildId: currentBuild }).load(), null);
  const recovered = await loadBrightspacePreviousRecoveryV111(options),
    finished = await loadBrightspacePreviousRecoveryV111({
      ...options,
      finishedOnly: true,
    });
  assert.deepEqual(recovered.state, partial);
  assert.equal(recovered.status, "PAUSED");
  assert.deepEqual(finished.state, old);
  assert.equal(finished.status, "FINISHED");
  assert.equal(
    recovered.state.capture.body.observedAt,
    observation.capture.body.observedAt,
  );
  assert.equal(recovered.state.capture.buildId, previousBuild);
  assert.deepEqual(
    db.rows(),
    before,
    "Recovery never rewrites or prunes old-version evidence",
  );
  assert.equal(
    await loadBrightspacePreviousRecoveryV111({ ...options, courseId: "456" }),
    null,
  );
  assert.equal(
    await loadBrightspacePreviousRecoveryV111({
      ...options,
      origin: "https://another-lms.example.test",
    }),
    null,
  );
  assert.equal(
    await loadBrightspacePreviousRecoveryV111({
      ...options,
      buildId: "unrelated-build",
    }),
    null,
  );
  const current = session(db, { buildId: currentBuild }),
    fresh = structuredClone(old);
  fresh.capture.buildId = currentBuild;
  fresh.capture.capturedAt = "2026-10-17T08:00:00.000Z";
  fresh.capture.body.observedAt = "2026-10-17T07:59:00.000Z";
  await current.save(fresh, { status: "PAUSED" });
  assert.deepEqual((await current.load()).state, fresh);
  assert.deepEqual(
    db.rows().filter((row) => row.buildId === previousBuild),
    before,
  );
  assert.deepEqual(
    (await loadBrightspacePreviousRecoveryV111(options)).state,
    partial,
  );
  await assert.rejects(
    current.save(partial),
    (error) => error.code === "BRIGHTSPACE_CHECKPOINT_IDENTITY",
  );
});

test("capture wrappers require exact nested course, build and origin on save and verified load", async () => {
  const db = storageFixture(),
    s = session(db);
  for (const change of [
    (capture) => {
      capture.course.orgUnitId = "456";
    },
    (capture) => {
      capture.buildId = "different-build";
    },
    (capture) => {
      capture.page.origin = "https://different-lms.example.test";
    },
    (capture) => {
      delete capture.course;
    },
    (capture) => {
      delete capture.buildId;
    },
    (capture) => {
      delete capture.page;
    },
  ]) {
    const input = {
      capture: structuredClone(observation.capture),
      previousFinishedCaptureRef: null,
    };
    change(input.capture);
    await assert.rejects(
      s.save(input),
      (error) => error.code === "BRIGHTSPACE_CHECKPOINT_IDENTITY",
    );
  }
  assert.equal(db.rows().length, 0);
  await s.save({
    capture: observation.capture,
    previousFinishedCaptureRef: null,
  });
  const changed = {
    capture: { ...observation.capture, course: { orgUnitId: "456" } },
    previousFinishedCaptureRef: null,
  };
  const json = JSON.stringify(changed),
    bytes = new TextEncoder().encode(json);
  const hash = async (data) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("");
  const fingerprint = await hash(
    new TextEncoder().encode(JSON.stringify([await hash(bytes)])),
  );
  db.tamper((row) => {
    row.json = json;
    row.bytes = bytes.byteLength;
    row.payloadFingerprint = fingerprint;
  });
  await assert.rejects(
    session(db).load(),
    (error) => error.code === "BRIGHTSPACE_CHECKPOINT_READ_FAILED",
  );
  const generic = storageFixture();
  await session(generic).save({
    course: { orgUnitId: "123" },
    observedAt: "2026-10-15T09:59:00.000Z",
  });
  assert.equal((await session(generic).load()).state.course.orgUnitId, "123");
});

test("history is key-pruned to three runs while preserving the latest finished capture", async () => {
  const db = storageFixture();
  const first = session(db, { runId: "finished" });
  await first.save(observation, { status: "FINISHED" });
  for (let n = 0; n < 5; n++)
    await session(db, { runId: "partial-" + n }).save({
      ...observation,
      attempt: n,
    });
  assert.equal(db.rows().length, 3);
  const finished = await session(db).loadLatestFinished();
  assert.equal(finished.runId, "finished");
  assert.deepEqual(finished.state, observation);
  assert.equal((await session(db).load()).state.attempt, 4);
  assert.equal(
    db.reads.filter((row) => !row.keysOnly).length,
    2,
    "Only the two explicit loads request one capture body each",
  );
  await first.save({ ...observation, attempt: "new attempt" });
  assert.notEqual(
    first.snapshot().runId,
    "finished",
    "Starting after finish does not overwrite that historical run",
  );
  assert.equal((await session(db).loadLatestFinished()).runId, "finished");
});

test("a different native attempt finishing without partial saves retains the previous completed run", async () => {
  const db = storageFixture(),
    s = session(db, { runId: "first-completed" });
  const first = {
    capture: {
      ...observation.capture,
      attempt: { id: "native-attempt-one" },
      items: [{ id: "reading-one" }],
    },
  };
  const initial = await s.save(first, { status: "FINISHED" });
  const repeated = await s.save(first, { status: "FINISHED" });
  assert.equal(repeated.runId, initial.runId);
  assert.equal(
    db.rows().length,
    1,
    "Same-attempt final saves remain idempotent",
  );
  const empty = {
    capture: {
      ...observation.capture,
      attempt: { id: "native-attempt-two" },
      items: [],
    },
  };
  const next = await s.save(empty, { status: "FINISHED" });
  assert.notEqual(next.runId, initial.runId);
  assert.equal(db.rows().length, 2);
  assert.deepEqual(
    JSON.parse(db.rows().find((row) => row.runId === initial.runId).json),
    first,
    "The earlier full finished capture remains downloadable",
  );
  assert.equal(
    (await session(db).loadLatestFinished()).state.capture.attempt.id,
    "native-attempt-two",
  );
  const repeatedNext = await s.save(empty, { status: "FINISHED" });
  assert.equal(repeatedNext.runId, next.runId);
  assert.equal(db.rows().length, 2);
});

test("quota failure retains earlier evidence and rejects save and flush with a visible storage error", async () => {
  const db = storageFixture(),
    errors = [],
    s = session(db, { onError: (error) => errors.push(error.message) });
  await s.save(observation);
  const prior = structuredClone(db.rows());
  db.failWrites(true);
  await assert.rejects(
    s.save({ ...observation, attempt: "must not be claimed durable" }),
    (error) => error.code === "BRIGHTSPACE_CHECKPOINT_WRITE_FAILED",
  );
  await assert.rejects(s.flush(), /storage could not save/);
  assert.deepEqual(db.rows(), prior);
  assert(s.snapshot().lastError.includes("Download the in-memory capture"));
  assert.equal(errors.length, 1);
});

test("bounded serialized saves reject a third queued snapshot and detect changed retained bodies", async () => {
  const db = storageFixture(),
    s = session(db);
  const first = s.save({ ...observation, sequence: 1 }),
    second = s.save({ ...observation, sequence: 2 });
  await assert.rejects(
    s.save({ ...observation, sequence: 3 }),
    (error) => error.code === "BRIGHTSPACE_CHECKPOINT_BUSY",
  );
  await Promise.all([first, second]);
  assert.equal((await s.load()).state.sequence, 2);
  db.tamper((row) => {
    row.json = row.json.replace("Literal", "Changed");
  });
  await assert.rejects(
    session(db).load(),
    (error) => error.code === "BRIGHTSPACE_CHECKPOINT_READ_FAILED",
  );
});

test("blocked browser storage is explicit and never reported as saved progress", async () => {
  const errors = [];
  const s = createBrightspaceCheckpointV110({
    origin: "https://lms.example.test",
    courseId: "123",
    buildId: "test",
    onError: (error) => errors.push(error),
    indexedDB: {
      open() {
        throw new DOMException("Synthetic denied storage", "SecurityError");
      },
    },
  });
  await assert.rejects(s.load(), /storage could not open/);
  assert.equal(s.snapshot().savedAt, "");
  assert.equal(s.snapshot().available, false);
  assert.equal(errors.length, 1);
});

function panelDom() {
  const original = { window: globalThis.window, document: globalThis.document },
    roots = [];
  class Element {
    constructor() {
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.isConnected = false;
      this.textContent = "";
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      child.isConnected = true;
      return child;
    }
    remove() {
      this.isConnected = false;
      if (this.parent)
        this.parent.children = this.parent.children.filter(
          (child) => child !== this,
        );
    }
    attachShadow(options) {
      this.mode = options.mode;
      const nodes = new Map();
      const root = {
        getElementById: (id) => nodes.get(id),
        addEventListener() {},
        set innerHTML(html) {
          this.html = html;
          for (const [, id] of html.matchAll(/id="([^"]+)"/g))
            nodes.set(id, new Element());
        },
      };
      roots.push(root);
      return root;
    }
  }
  const body = new Element();
  body.textContent = "Original Brightspace course text";
  const html = new Element();
  html.appendChild(body);
  globalThis.window = { __CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__: true };
  globalThis.document = {
    body,
    documentElement: html,
    createElement: () => new Element(),
  };
  return {
    roots,
    html,
    body,
    restore() {
      for (const key of ["window", "document"])
        if (original[key] === undefined) delete globalThis[key];
        else globalThis[key] = original[key];
    },
  };
}

test("launcher requires an explicit action, isolates its closed display, and recovers stale running flags", async () => {
  const dom = panelDom();
  let calls = 0,
    downloads = 0,
    release;
  const p = createBrightspaceProgressPanelV110("Brightspace", {
    courseId: "123",
    buildId: "test",
    onStart: () => {
      calls++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    onPause: () => release(),
    onDownload: () => {
      downloads++;
    },
  });
  try {
    assert.equal(calls, 0);
    assert.equal(window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__, false);
    assert.equal(p.snapshot().elapsedMs, 0);
    assert.equal(dom.html.children.length, 2);
    assert.equal(dom.html.children[1].mode, "closed");
    assert.equal(dom.body.textContent, "Original Brightspace course text");
    assert(dom.roots[0].html.includes("Capture/resume"));
    assert(dom.roots[0].html.includes("Download saved capture"));
    assert.equal(
      createBrightspaceProgressPanelV110("Again", {
        courseId: "123",
        buildId: "test",
      }),
      p,
    );
    const active = p.start();
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(p.isRunning(), true);
    assert.equal(p.dispose(), false);
    assert.throws(
      () =>
        createBrightspaceProgressPanelV110("Another", {
          courseId: "456",
          buildId: "test",
        }),
      /Pause the existing/,
    );
    await p.pause();
    await active;
    assert.equal(p.snapshot().phase, "Paused");
    assert.equal(p.isRunning(), false);
    p.update({
      storageError: "Storage quota reached; download this partial capture.",
      downloadAvailable: true,
    });
    assert.equal(dom.roots[0].getElementById("storage").hidden, false);
    assert(p.snapshot().storageError.includes("quota"));
    await p.download();
    assert.equal(downloads, 1);
    assert.equal(p.snapshot().downloadAvailable, true);
  } finally {
    release?.();
    p.dispose();
    dom.restore();
  }
});

test("finished and interrupted captures replace the last processing phase with a terminal label", async () => {
  const dom = panelDom();
  let panel;
  panel = createBrightspaceProgressPanelV110("Brightspace", {
    courseId: "123",
    buildId: "test",
    onStart: () => {
      panel.update({ phase: "Check source stability" });
      panel.finish(
        "review",
        "Capture ready; review remaining gaps.",
        "5 original files retained",
      );
    },
  });
  try {
    await panel.start();
    assert.equal(panel.snapshot().phase, "Capture finished");
    assert.equal(panel.isRunning(), false);
    assert.equal(
      dom.roots[0].getElementById("phase").textContent,
      "Capture finished",
    );
    assert.equal(panel.snapshot().count, "5 original files retained");
    panel.update({ phase: "Read source files" });
    panel.finish("error", "Source request interrupted.");
    assert.equal(panel.snapshot().phase, "Capture interrupted");
  } finally {
    panel.dispose();
    dom.restore();
  }
});
