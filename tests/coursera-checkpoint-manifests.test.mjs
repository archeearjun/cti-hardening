import test from "node:test";
import assert from "node:assert/strict";
import * as completion from "../src/extractors/coursera/completion.js";
import { automaticLocalEvidenceProgressV61526 } from "../src/extractors/coursera/automatic-local.js";
import {
  CTI_CHECKPOINT_DB,
  CTI_CHECKPOINT_STORE,
  CTI_CHECKPOINT_SESSION_PREFIX,
} from "../src/extractors/coursera/config.js";

const MANIFESTS = "item-checkpoint-manifests",
  COURSE = "Synthetic_course";
const RUN = "run-1700000000000-synthetic",
  RUN_KEY = RUN + "|" + COURSE;

// This fake deliberately distinguishes IDB key reads from structured-cloned
// value reads, and commits all stores together. The canonical browser check
// separately exercises Chromium's native IndexedDB implementation.
function makeIndexedDB({ version = 2, rows = [] } = {}) {
  const metrics = {
    opens: [],
    transactions: [],
    reads: [],
    writes: [],
    upgrades: 0,
  };
  const stores = new Map(),
    indexes = new Map();
  function addStore(name) {
    stores.set(name, new Map());
    indexes.set(name, new Map());
  }
  addStore(CTI_CHECKPOINT_STORE);
  indexes.get(CTI_CHECKPOINT_STORE).set("runKey", "runKey");
  if (version >= 2) {
    indexes
      .get(CTI_CHECKPOINT_STORE)
      .set("manifestRevision", "manifestRevision");
    addStore(MANIFESTS);
    indexes.get(MANIFESTS).set("runKey", "runKey");
  }
  for (const row of rows)
    stores.get(CTI_CHECKPOINT_STORE).set(row.key, structuredClone(row));
  const state = {
    version,
    stores,
    indexes,
    metrics,
    failNextManifestPut: false,
    manifestPutCount: 0,
    failManifestPutAt: 0,
  };
  const list = (map) => ({
    contains: (name) => map.has(name),
    [Symbol.iterator]: () => map.keys(),
  });
  const criterion = (query) =>
    query && typeof query === "object" && "only" in query ? query.only : query;
  function transaction(names, mode = "readonly") {
    const allowed = new Set(typeof names === "string" ? [names] : names),
      drafts = new Map();
    for (const name of allowed) {
      if (!stores.has(name)) throw Error("NotFoundError: " + name);
      drafts.set(name, new Map(stores.get(name)));
    }
    metrics.transactions.push({ stores: [...allowed], mode });
    let pending = 0,
      ended = false,
      scheduled = false;
    const tx = {
      error: null,
      objectStore: (name) => {
        if (!allowed.has(name)) throw Error("NotFoundError: " + name);
        return storeApi(name);
      },
      abort: () => {
        if (ended) return;
        ended = true;
        tx.error ||= Error("AbortError");
        setImmediate(() => tx.onabort?.({ target: tx }));
      },
    };
    function finish() {
      if (ended || pending || scheduled) return;
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        if (ended || pending) return;
        ended = true;
        if (mode !== "readonly")
          for (const [name, map] of drafts) stores.set(name, map);
        tx.oncomplete?.({ target: tx });
      });
    }
    function request(operation, { store, kind, key, values = true } = {}) {
      if (ended) throw Error("TransactionInactiveError");
      pending++;
      const req = { result: undefined, error: null };
      setImmediate(() => {
        if (ended) {
          pending--;
          return;
        }
        try {
          const value = operation();
          if (store && kind) metrics.reads.push({ store, kind, key, values });
          req.result = values ? structuredClone(value) : value;
          req.onsuccess?.({ target: req });
        } catch (error) {
          req.error = error;
          tx.error = error;
          req.onerror?.({ target: req });
          tx.onerror?.({ target: tx });
          tx.abort();
        }
        pending--;
        finish();
      });
      return req;
    }
    function cursor(name, field, query, keysOnly) {
      const expected = criterion(query),
        entries = [...drafts.get(name)].filter(
          ([, row]) => expected === undefined || row[field] === expected,
        );
      const req = { result: null, error: null };
      let position = 0;
      pending++;
      function next() {
        setImmediate(() => {
          if (ended) {
            pending--;
            return;
          }
          const entry = entries[position++];
          metrics.reads.push({
            store: name,
            kind: keysOnly ? "openKeyCursor" : "openCursor",
            key: expected,
            values: !keysOnly && !!entry,
          });
          let continuing = false;
          req.result = entry
            ? {
                primaryKey: entry[0],
                key: entry[1][field],
                ...(!keysOnly ? { value: structuredClone(entry[1]) } : {}),
                continue() {
                  continuing = true;
                  next();
                },
              }
            : null;
          req.onsuccess?.({ target: req });
          if (!entry || !continuing) {
            pending--;
            finish();
          }
        });
      }
      next();
      return req;
    }
    function storeApi(name) {
      const map = drafts.get(name);
      return {
        indexNames: list(indexes.get(name)),
        createIndex(index, field) {
          indexes.get(name).set(index, field);
          return this.index(index);
        },
        get: (key) =>
          request(() => map.get(key), { store: name, kind: "get", key }),
        getAll: () =>
          request(() => [...map.values()], { store: name, kind: "getAll" }),
        getAllKeys: () =>
          request(() => [...map.keys()], {
            store: name,
            kind: "getAllKeys",
            values: false,
          }),
        put: (row) =>
          request(
            () => {
              if (mode === "readonly") throw Error("ReadOnlyError");
              if (name === MANIFESTS) {
                state.manifestPutCount++;
                if (
                  state.failNextManifestPut ||
                  state.manifestPutCount === state.failManifestPutAt
                ) {
                  state.failNextManifestPut = false;
                  throw Error("Synthetic manifest write failure");
                }
              }
              metrics.writes.push({ store: name, kind: "put", key: row.key });
              map.set(row.key, structuredClone(row));
              return row.key;
            },
            { values: false },
          ),
        delete: (key) =>
          request(
            () => {
              if (mode === "readonly") throw Error("ReadOnlyError");
              metrics.writes.push({ store: name, kind: "delete", key });
              map.delete(key);
            },
            { values: false },
          ),
        index: (index) => {
          const field = indexes.get(name).get(index);
          if (!field) throw Error("NotFoundError: index " + index);
          function matching(query) {
            const expected = criterion(query);
            return [...map].filter(
              ([, row]) => expected === undefined || row[field] === expected,
            );
          }
          return {
            getAll: (query) =>
              request(() => matching(query).map(([, row]) => row), {
                store: name,
                kind: "index.getAll",
                key: criterion(query),
              }),
            getAllKeys: (query) =>
              request(() => matching(query).map(([key]) => key), {
                store: name,
                kind: "index.getAllKeys",
                key: criterion(query),
                values: false,
              }),
            getKey: (query) =>
              request(() => matching(query)[0]?.[0], {
                store: name,
                kind: "index.getKey",
                key: criterion(query),
                values: false,
              }),
            get: (query) =>
              request(() => matching(query)[0]?.[1], {
                store: name,
                kind: "index.get",
                key: criterion(query),
              }),
            openKeyCursor: (query) => cursor(name, field, query, true),
            openCursor: (query) => cursor(name, field, query, false),
          };
        },
      };
    }
    finish();
    return tx;
  }
  function database() {
    return {
      get version() {
        return state.version;
      },
      objectStoreNames: list(stores),
      close() {},
      transaction,
      createObjectStore(name) {
        addStore(name);
        return upgradeTx.objectStore(name);
      },
    };
  }
  let upgradeTx;
  const indexedDB = {
    databases: async () => [
      { name: CTI_CHECKPOINT_DB, version: state.version },
    ],
    open(name, requestedVersion) {
      metrics.opens.push({ name, version: requestedVersion });
      const req = { result: null, error: null, transaction: null };
      setImmediate(() => {
        if (
          requestedVersion !== undefined &&
          requestedVersion < state.version
        ) {
          req.error = Error("VersionError");
          req.onerror?.({ target: req });
          return;
        }
        req.result = database();
        if (
          requestedVersion !== undefined &&
          requestedVersion > state.version
        ) {
          metrics.upgrades++;
          const previousVersion = state.version;
          state.version = requestedVersion;
          // Upgrade store creation is synchronous, before normal requests begin.
          upgradeTx = {
            objectStore: (name) => ({
              indexNames: list(indexes.get(name)),
              createIndex(index, field) {
                indexes.get(name).set(index, field);
              },
            }),
            abort() {
              state.version = previousVersion;
              req.error = Error("AbortError");
            },
          };
          req.transaction = upgradeTx;
          req.onupgradeneeded?.({
            oldVersion: previousVersion,
            newVersion: requestedVersion,
            target: req,
          });
          if (req.error) {
            req.onerror?.({ target: req });
            return;
          }
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
  return {
    stores,
    indexes,
    metrics,
    indexedDB,
    get version() {
      return state.version;
    },
    get failNextManifestPut() {
      return state.failNextManifestPut;
    },
    set failNextManifestPut(value) {
      state.failNextManifestPut = value;
    },
    set failManifestPutAt(value) {
      state.failManifestPutAt = value;
    },
    resetMetrics() {
      metrics.reads.length = 0;
      metrics.writes.length = 0;
      metrics.transactions.length = 0;
    },
  };
}

async function withHarness(check, options = {}) {
  const previous = new Map(
    ["indexedDB", "IDBKeyRange", "localStorage"].map((key) => [
      key,
      { exists: Object.hasOwn(globalThis, key), value: globalThis[key] },
    ]),
  );
  const db = makeIndexedDB(options),
    values = new Map([
      [
        CTI_CHECKPOINT_SESSION_PREFIX + COURSE,
        JSON.stringify({ id: RUN, createdAt: Date.now() }),
      ],
    ]);
  const storageWrites = [];
  globalThis.indexedDB = db.indexedDB;
  globalThis.IDBKeyRange = { only: (value) => ({ only: value }) };
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      storageWrites.push({ key, value });
      values.set(key, value);
    },
    removeItem(key) {
      storageWrites.push({ key, remove: true });
      values.delete(key);
    },
  };
  try {
    await check(db, storageWrites);
  } finally {
    for (const [key, original] of previous)
      if (original.exists) globalThis[key] = original.value;
      else delete globalThis[key];
  }
}

function reading(id, { complete = true, large = false } = {}) {
  const text = "Synthetic reading " + id;
  return {
    id,
    name: "Reading " + id,
    type: "Reading",
    typeName: "supplement",
    path: ["Synthetic module"],
    evidenceSources: ["synthetic-source"],
    payload: {
      captureAttempts: complete ? 1 : 0,
      textSample: complete ? text : "",
      textConfidence: complete ? "high" : "low",
      textEvidenceCompleteness: complete ? 1 : 0,
      textCaptureTruncated: false,
      ...(complete
        ? {
            textCaptureEvidence: {
              method: "EXACT_READING_FIELD",
              itemId: id,
              observedCharacters: text.length,
              capturedCharacters: text.length,
            },
          }
        : {}),
      ...(large
        ? {
            rawSnapshot: {
              cml:
                "<text>" +
                "synthetic immutable source ".repeat(21000) +
                "</text>",
              unknownAuthoringField: {
                schema: "future-synthetic-schema",
                nested: [{ retained: true, annotations: ["one", "two"] }],
                empty: null,
              },
              serverObservation: { integer: 103, boolean: false },
            },
          }
        : {}),
      files: [],
      links: [],
      images: [],
      assetDetails: [],
    },
  };
}

function placeholder(fp) {
  return {
    id: fp.id,
    name: fp.name,
    type: fp.type,
    typeName: fp.typeName,
    path: fp.path,
    payload: { captureAttempts: 0 },
  };
}
function record(fp, savedAt = Date.now() - 1000) {
  return {
    key: RUN_KEY + "|" + fp.id,
    runKey: RUN_KEY,
    itemId: fp.id,
    savedAt,
    pass: "synthetic",
    fingerprint: structuredClone(fp),
  };
}
function capture(fps, date = new Date(Date.now() - 60000).toISOString()) {
  return {
    schemaVersion: 35,
    page: { courseId: COURSE },
    extractedAt: date,
    fingerprints: fps,
  };
}
function rawValueReads(db) {
  return db.metrics.reads.filter(
    (read) => read.store === CTI_CHECKPOINT_STORE && read.values,
  );
}
async function newManager(options = {}) {
  const manager = await completion.createCheckpointManagerV6150(
    COURSE,
    "",
    options,
  );
  assert.equal(manager.available, true, manager.error);
  return manager;
}

test("continuation restores completed manifests without reading or retaining large raw payloads", async () => {
  await withHarness(async (db) => {
    const originals = ["one", "two", "three"].map((id) =>
      reading(id, { large: true }),
    );
    let manager = await newManager();
    for (const fp of originals)
      assert.equal(
        await manager.save(
          fp,
          { completed: true, version: "v6.15.31" },
          "synthetic-complete",
        ),
        true,
      );
    for (const manifest of db.stores.get(MANIFESTS).values()) {
      assert(
        JSON.stringify(manifest).length < 12000,
        "the manifest cannot retain a large completed source payload",
      );
      assert.equal(manifest.fingerprint, undefined);
      assert.equal(manifest.rawSnapshot, undefined);
    }
    manager.close();
    db.resetMetrics();
    manager = await newManager();
    const fps = originals.map(placeholder),
      restored = await manager.restore(fps, { deferComplete: true });
    assert.equal(restored.restored, 3);
    assert.equal(restored.deferred, 3);
    assert.equal(restored.loaded, 0);
    assert.equal(restored.rawRowsRead, 0);
    assert.deepEqual(
      rawValueReads(db),
      [],
      "completed payload values must not be cloned for each new document",
    );
    for (const fp of fps) {
      assert.equal(fp.payload.rawSnapshot, undefined);
      assert.equal(fp.payload.captureContract, undefined);
      assert.equal(
        completion.captureContractV6150(fp).complete,
        false,
        "raw fidelity cannot use a navigation summary",
      );
      const contract = manager.contractFor(fp);
      assert.equal(contract.complete, true);
      assert.equal(contract.checkpointDeferred, true);
      assert.equal(contract.scope, "CHECKPOINT_NAVIGATION_ONLY");
      contract.complete = false;
      assert.equal(
        manager.contractFor(fp).complete,
        true,
        "callers receive a copied hint",
      );
      const progress = manager.progressFor(fp);
      assert.equal(progress.length, 7);
      assert.deepEqual(progress.slice(5), [1, 1]);
      progress[5] = 0;
      assert.equal(
        manager.progressFor(fp)[5],
        1,
        "progress hints cannot mutate stored state",
      );
    }
    const navigation = completion.checkpointCaptureAccountingV61531(
      fps,
      {},
      (fp) => manager.contractFor(fp),
    );
    assert.equal(navigation.scope, "CHECKPOINT_CONTINUATION_ONLY");
    assert.equal(navigation.completeCount, 3);
    assert.equal(navigation.complete, false);
    assert.equal(
      completion.finalCaptureAccountingV6150(fps, {}).complete,
      false,
    );
    const progress = automaticLocalEvidenceProgressV61526(
      {},
      { fingerprints: fps, meta: { captureAccounting: navigation } },
      (fp) => manager.progressFor(fp),
    );
    assert.equal(progress.record.completeCount, 3);
    assert.equal(
      progress.record.items.every((row) => row[6] === 1 && row[7] === 1),
      true,
    );
    const materialized = await manager.materialize(fps);
    assert.equal(materialized.loaded, 3);
    assert.equal(materialized.deferred, 0);
    assert.deepEqual(materialized.failed, []);
    assert.equal(materialized.rawRowsRead, 3);
    for (let index = 0; index < fps.length; index++) {
      assert.deepEqual(
        fps[index].payload.rawSnapshot,
        originals[index].payload.rawSnapshot,
        "unknown source fields must survive final materialization",
      );
      assert.equal(manager.contractFor(fps[index]), null);
      assert.equal(manager.progressFor(fps[index]), null);
    }
    assert.equal(
      completion.finalCaptureAccountingV6150(fps, {}).complete,
      true,
    );
    manager.close();
  });
});

test("incomplete checkpoint payloads restore with bounded diagnostic receipts while completed rows defer", async () => {
  await withHarness(async (db) => {
    const done = reading("done"),
      partial = reading("partial", { complete: false });
    partial.payload.captureAttempts = 1;
    const diagnostic = {
      version: "v6.15.31",
      authoringAssessmentApiStopReason: "EDITOR_OUTLINE_UNAVAILABLE",
      questionCycleStopReason: "TIME_BUDGET",
      authoringAssessmentApi: {
        requests: 3,
        missingGroups: ["PRIVATE_GROUP"],
        failures: [
          {
            resource: "authoringAssignmentQuestionGroups.v1",
            status: 404,
            reason: "HTTP_404",
            url: "PRIVATE_URL",
          },
        ],
      },
      rawBody: "PRIVATE_BODY",
    };
    let manager = await newManager();
    await manager.save(done, null, "complete");
    await manager.save(partial, diagnostic, "partial");
    manager.close();
    manager = await newManager();
    db.resetMetrics();
    const fps = [placeholder(done), placeholder(partial)];
    const restored = await manager.restore(fps, { deferComplete: true });
    assert.equal(restored.deferred, 1);
    assert.equal(restored.loaded, 1);
    assert.equal(restored.rawRowsRead, 1);
    assert.equal(rawValueReads(db).length, 1);
    assert.equal(fps[1].payload.captureAttempts, 1);
    assert.equal(
      fps[1].payload.captureDiagnostics.authoringAssessmentApiStopReason,
      "EDITOR_OUTLINE_UNAVAILABLE",
    );
    assert.equal(
      fps[1].payload.captureDiagnostics.authoringAssessmentApi.missingGroups,
      1,
    );
    assert(
      !JSON.stringify(fps[1].payload.captureDiagnostics).includes("PRIVATE_"),
    );
    assert.equal(manager.contractFor(fps[1]), null);
    assert.equal(manager.progressFor(fps[1]), null);
    manager.close();
  });
});

test("deferred placeholders cannot overwrite raw evidence before materialization", async () => {
  await withHarness(async (db) => {
    const original = reading("protected", { large: true });
    let manager = await newManager();
    await manager.save(original, null, "complete");
    manager.close();
    const saved = structuredClone(
      db.stores.get(CTI_CHECKPOINT_STORE).get(RUN_KEY + "|" + original.id),
    );
    manager = await newManager();
    const fp = placeholder(original);
    await manager.restore([fp], { deferComplete: true });
    db.resetMetrics();
    assert.equal(await manager.save(fp, null, "accidental-placeholder"), false);
    assert.match(manager.error, /CHECKPOINT_DEFERRED_NOT_MATERIALIZED/);
    assert.deepEqual(db.stores.get(CTI_CHECKPOINT_STORE).get(saved.key), saved);
    assert.deepEqual(db.metrics.writes, []);
    await manager.materialize([fp]);
    assert.equal(await manager.save(fp, null, "materialized"), true);
    manager.close();
  });
});

test("missing and invalid manifests fall back to raw evidence, then migrate once", async () => {
  await withHarness(async (db) => {
    const originals = [
      reading("missing", { large: true }),
      reading("corrupt", { large: true }),
    ];
    let manager = await newManager();
    for (const fp of originals) await manager.save(fp, null, "complete");
    manager.close();
    db.stores.get(MANIFESTS).delete(RUN_KEY + "|missing");
    db.stores.get(MANIFESTS).get(RUN_KEY + "|corrupt").contract.complete =
      false;
    manager = await newManager();
    db.resetMetrics();
    const first = await manager.restore(originals.map(placeholder), {
      deferComplete: true,
    });
    assert.equal(first.rawRowsRead, 2);
    assert.equal(first.restored, 2);
    assert.equal(db.stores.get(MANIFESTS).size, 2);
    manager.close();
    manager = await newManager();
    db.resetMetrics();
    const second = await manager.restore(originals.map(placeholder), {
      deferComplete: true,
    });
    assert.equal(second.rawRowsRead, 0);
    assert.equal(second.deferred, 2);
    assert.deepEqual(rawValueReads(db), []);
    manager.close();
  });
});

test("legacy version 1 checkpoints upgrade without losing raw fields and avoid later full reads", async () => {
  const original = reading("legacy", { large: true }),
    legacy = record(original);
  await withHarness(
    async (db) => {
      let manager = await newManager();
      assert.equal(db.metrics.upgrades, 1);
      const fps = [placeholder(original)];
      const first = await manager.restore(fps, { deferComplete: true });
      assert.equal(first.rawRowsRead, 1);
      assert.equal(first.legacyRowsMigrated, 1);
      assert.deepEqual(
        db.stores.get(CTI_CHECKPOINT_STORE).get(legacy.key).fingerprint.payload
          .rawSnapshot,
        original.payload.rawSnapshot,
      );
      manager.close();
      manager = await newManager();
      db.resetMetrics();
      const later = [placeholder(original)];
      const restored = await manager.restore(later, { deferComplete: true });
      assert.equal(restored.rawRowsRead, 0);
      assert.equal(restored.deferred, 1);
      await manager.materialize(later);
      assert.deepEqual(
        later[0].payload.rawSnapshot,
        original.payload.rawSnapshot,
      );
      manager.close();
    },
    { version: 1, rows: [legacy] },
  );
});

test("read-only recovery opens existing version 1 and restores raw evidence without upgrading or writing", async () => {
  const original = reading("readonly", { large: true }),
    legacy = record(original);
  await withHarness(
    async (db, storageWrites) => {
      const manager = await newManager({ readOnly: true }),
        fps = [placeholder(original)];
      const result = await manager.restore(fps, { deferComplete: true });
      assert.equal(result.restored, 1);
      assert.equal(result.deferred, 0);
      assert.equal(result.loaded, 1);
      assert.equal(result.rawRowsRead, 1);
      assert.deepEqual(
        fps[0].payload.rawSnapshot,
        original.payload.rawSnapshot,
      );
      assert.equal(manager.contractFor(fps[0]), null);
      assert.equal(db.metrics.upgrades, 0);
      assert.equal(db.stores.has(MANIFESTS), false);
      assert.equal(db.metrics.opens[0].version, undefined);
      assert.deepEqual(db.metrics.writes, []);
      assert.deepEqual(storageWrites, []);
      assert.equal(await manager.save(fps[0], null, "forbidden"), false);
      await assert.rejects(
        manager.seed(capture([original]), fps),
        /cannot import or change checkpoints/,
      );
      await manager.clear();
      assert.equal(db.stores.get(CTI_CHECKPOINT_STORE).size, 1);
      assert.deepEqual(db.metrics.writes, []);
      manager.close();
    },
    { version: 1, rows: [legacy] },
  );
});

test("a self-consistent forged completion summary cannot bypass its raw revision index", async () => {
  await withHarness(async (db) => {
    const partial = reading("forged", { complete: false });
    let manager = await newManager();
    await manager.save(partial, null, "partial");
    manager.close();
    const key = RUN_KEY + "|" + partial.id,
      manifest = db.stores.get(MANIFESTS).get(key);
    manifest.contract = {
      ...manifest.contract,
      complete: true,
      accounted: true,
      needsEditor: false,
      retryable: false,
      status: "COMPLETE_READING",
      reasons: [],
    };
    manifest.progress[5] = 1;
    manifest.progress[6] = 1;
    manifest.manifestRevision =
      completion.checkpointManifestRevisionV61531(manifest);
    manager = await newManager();
    db.resetMetrics();
    const fp = placeholder(partial),
      result = await manager.restore([fp], { deferComplete: true });
    assert.equal(result.rawRowsRead, 1);
    assert.equal(result.loaded, 1);
    assert.equal(result.deferred, 0);
    assert.equal(manager.contractFor(fp), null);
    assert.equal(
      completion.finalCaptureAccountingV6150([fp], {}).complete,
      false,
    );
    assert.equal(
      db.stores.get(MANIFESTS).get(key).contract.complete,
      false,
      "fallback must recompute from the stored raw evidence",
    );
    manager.close();
  });
});

test("read-only version 2 recovery leaves corrupt metadata untouched and still reads raw evidence", async () => {
  await withHarness(async (db, storageWrites) => {
    const original = reading("readonly-current", { large: true });
    let manager = await newManager();
    await manager.save(original, null, "complete");
    manager.close();
    const key = RUN_KEY + "|" + original.id;
    db.stores.get(MANIFESTS).get(key).progress = ["invalid"];
    const before = structuredClone(db.stores.get(MANIFESTS).get(key));
    db.resetMetrics();
    storageWrites.length = 0;
    manager = await newManager({ readOnly: true });
    const fp = placeholder(original),
      result = await manager.restore([fp], { deferComplete: true });
    assert.equal(result.rawRowsRead, 1);
    assert.equal(result.loaded, 1);
    assert.equal(result.deferred, 0);
    assert.equal(result.legacyRowsMigrated, 0);
    assert.deepEqual(fp.payload.rawSnapshot, original.payload.rawSnapshot);
    assert.deepEqual(db.stores.get(MANIFESTS).get(key), before);
    assert.deepEqual(db.metrics.writes, []);
    assert.deepEqual(storageWrites, []);
    manager.close();
  });
});

test("orphaned completion manifests cannot restore an absent raw checkpoint", async () => {
  await withHarness(async (db) => {
    const original = reading("orphan");
    let manager = await newManager();
    await manager.save(original, null, "complete");
    manager.close();
    db.stores.get(CTI_CHECKPOINT_STORE).delete(RUN_KEY + "|" + original.id);
    manager = await newManager();
    const fp = placeholder(original),
      result = await manager.restore([fp], { deferComplete: true });
    assert.equal(result.stored, 0);
    assert.equal(result.restored, 0);
    assert.equal(result.deferred, 0);
    assert.equal(manager.contractFor(fp), null);
    assert.equal(
      completion.finalCaptureAccountingV6150([fp], {}).complete,
      false,
    );
    manager.close();
  });
});

test("final materialization fails closed when deferred raw evidence is missing or changed", async () => {
  for (const corruption of ["missing", "identity", "evidence"])
    await withHarness(async (db) => {
      const original = reading(corruption, { large: true });
      let manager = await newManager();
      await manager.save(original, null, "complete");
      manager.close();
      manager = await newManager();
      const fp = placeholder(original);
      await manager.restore([fp], { deferComplete: true });
      const key = RUN_KEY + "|" + original.id,
        row = db.stores.get(CTI_CHECKPOINT_STORE).get(key);
      if (corruption === "missing")
        db.stores.get(CTI_CHECKPOINT_STORE).delete(key);
      if (corruption === "identity")
        row.fingerprint.name = "Different synthetic identity";
      if (corruption === "evidence")
        delete row.fingerprint.payload.textCaptureEvidence;
      const result = await manager.materialize([fp]);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].id, original.id);
      assert.equal(
        result.failed[0].reason,
        {
          missing: "CHECKPOINT_RAW_MISSING",
          identity: "CHECKPOINT_IDENTITY_MISMATCH",
          evidence: "CHECKPOINT_EVIDENCE_CHANGED",
        }[corruption],
      );
      assert.equal(manager.contractFor(fp), null);
      assert.equal(manager.progressFor(fp), null);
      assert.equal(
        completion.finalCaptureAccountingV6150([fp], {}).complete,
        false,
      );
      manager.close();
    });
});

test("checkpoint summaries bind to current item identity and cannot certify renamed items", async () => {
  await withHarness(async (db) => {
    const original = reading("identity");
    let manager = await newManager();
    await manager.save(original, null, "complete");
    manager.close();
    manager = await newManager();
    const fp = placeholder(original);
    await manager.restore([fp], { deferComplete: true });
    assert.equal(manager.contractFor(fp).complete, true);
    fp.name = "Renamed synthetic reading";
    assert.equal(manager.contractFor(fp), null);
    assert.equal(manager.progressFor(fp), null);
    const changed = await newManager(),
      fresh = placeholder(original);
    fresh.typeName = "lecture";
    db.resetMetrics();
    const result = await changed.restore([fresh], { deferComplete: true });
    assert.equal(result.restored, 0);
    assert.equal(changed.contractFor(fresh), null);
    assert.equal(fresh.payload.rawSnapshot, undefined);
    manager.close();
    changed.close();
  });
});

test("raw and manifest writes are atomic for checkpoint saves and saved JSON imports", async () => {
  await withHarness(async (db) => {
    const manager = await newManager(),
      one = reading("atomic-save");
    db.failNextManifestPut = true;
    assert.equal(await manager.save(one, null, "complete"), false);
    assert.equal(db.stores.get(CTI_CHECKPOINT_STORE).size, 0);
    assert.equal(db.stores.get(MANIFESTS).size, 0);
    assert.equal(await manager.save(one, null, "original"), true);
    const originalRaw = structuredClone(
      db.stores.get(CTI_CHECKPOINT_STORE).get(RUN_KEY + "|" + one.id),
    );
    const originalManifest = structuredClone(
      db.stores.get(MANIFESTS).get(RUN_KEY + "|" + one.id),
    );
    one.payload.rawSnapshot = { newObservation: "synthetic replacement" };
    db.failNextManifestPut = true;
    assert.equal(await manager.save(one, null, "failed-replacement"), false);
    assert.deepEqual(
      db.stores.get(CTI_CHECKPOINT_STORE).get(originalRaw.key),
      originalRaw,
    );
    assert.deepEqual(
      db.stores.get(MANIFESTS).get(originalManifest.key),
      originalManifest,
    );
    const two = reading("atomic-seed");
    db.failNextManifestPut = true;
    await assert.rejects(
      manager.seed(capture([two]), [placeholder(two)]),
      /Synthetic manifest write failure|aborted|failed/i,
    );
    assert.equal(db.stores.get(CTI_CHECKPOINT_STORE).size, 1);
    assert.equal(db.stores.get(MANIFESTS).size, 1);
    const imported = await manager.seed(capture([two]), [placeholder(two)]);
    assert.equal(imported.imported, 1);
    const raw = db.stores.get(CTI_CHECKPOINT_STORE).get(RUN_KEY + "|" + two.id);
    const manifest = db.stores.get(MANIFESTS).get(RUN_KEY + "|" + two.id);
    assert.equal(raw.manifestRevision, manifest.manifestRevision);
    assert.deepEqual(raw.fingerprint, two);
    assert.equal(
      db.metrics.transactions
        .filter((tx) => tx.mode === "readwrite")
        .every(
          (tx) =>
            tx.stores.includes(CTI_CHECKPOINT_STORE) &&
            tx.stores.includes(MANIFESTS),
        ),
      true,
    );
    const newer = structuredClone(raw);
    newer.savedAt = Date.now() + 10000;
    db.stores.get(CTI_CHECKPOINT_STORE).set(newer.key, newer);
    const older = await manager.seed(capture([two]), [placeholder(two)]);
    assert.equal(older.keptNewer, 1);
    assert.equal(
      db.stores.get(CTI_CHECKPOINT_STORE).get(newer.key).savedAt,
      newer.savedAt,
    );
    manager.close();
  });
});

test("clearing a capture removes only its raw and manifest records using key cursors", async () => {
  await withHarness(async (db) => {
    const manager = await newManager(),
      original = reading("clear");
    await manager.save(original, null, "complete");
    const unrelated = record(reading("other"));
    unrelated.key = "another-run|" + COURSE + "|other";
    unrelated.runKey = "another-run|" + COURSE;
    db.stores.get(CTI_CHECKPOINT_STORE).set(unrelated.key, unrelated);
    db.stores
      .get(MANIFESTS)
      .set(unrelated.key, { key: unrelated.key, runKey: unrelated.runKey });
    db.resetMetrics();
    await manager.clear();
    assert.deepEqual(
      [...db.stores.get(CTI_CHECKPOINT_STORE).keys()],
      [unrelated.key],
    );
    assert.deepEqual([...db.stores.get(MANIFESTS).keys()], [unrelated.key]);
    assert.deepEqual(rawValueReads(db), []);
    manager.close();
  });
});

test("a failed second legacy migration disables every write after partial restore", async () => {
  const originals = [
    reading("legacy-first", { large: true }),
    reading("legacy-second", { large: true }),
  ];
  const initialRows = originals.map((fp) => record(fp));
  await withHarness(
    async (db, storageWrites) => {
      db.failManifestPutAt = 2;
      const manager = await newManager();
      const fps = originals.map(placeholder);
      const result = await manager.restore(fps, { deferComplete: true });
      assert.equal(result.available, false);
      assert.equal(result.restored, 1);
      assert.equal(result.deferred, 1);
      assert.equal(result.legacyRowsMigrated, 1);
      assert.match(result.error, /Synthetic manifest write failure/);
      assert.equal(manager.available, false);
      assert.equal(manager.contractFor(fps[0]), null);
      assert.equal(manager.progressFor(fps[0]), null);
      const rawBefore = structuredClone([
        ...db.stores.get(CTI_CHECKPOINT_STORE),
      ]);
      const manifestsBefore = structuredClone([...db.stores.get(MANIFESTS)]);
      assert.deepEqual(rawBefore[0][1].fingerprint, originals[0]);
      assert.deepEqual(rawBefore[1][1], initialRows[1]);
      assert.equal(manifestsBefore.length, 1);
      const writesBefore = db.metrics.writes.length;
      const storageWritesBefore = storageWrites.length;
      for (const fp of fps) {
        fp.payload = {
          captureAttempts: 1,
          rawSnapshot: { replacement: "must not replace stored evidence" },
        };
        assert.equal(
          await manager.save(fp, null, "unsafe-after-restore-error"),
          false,
        );
      }
      await assert.rejects(
        manager.seed(capture(originals), fps),
        /CHECKPOINT_RESTORE_FAILED/,
      );
      await manager.clear();
      const materialized = await manager.materialize(fps);
      assert.equal(materialized.available, false);
      assert.deepEqual(materialized.failed, [
        { id: "", reason: "CHECKPOINT_RESTORE_FAILED" },
      ]);
      assert.equal(materialized.rawRowsRead, 0);
      assert.equal(materialized.deferred, 1);
      const retried = await manager.restore(fps, { deferComplete: true });
      assert.equal(retried.available, false);
      assert.match(retried.error, /Synthetic manifest write failure/);
      assert.deepEqual([...db.stores.get(CTI_CHECKPOINT_STORE)], rawBefore);
      assert.deepEqual([...db.stores.get(MANIFESTS)], manifestsBefore);
      assert.equal(db.metrics.writes.length, writesBefore);
      assert.equal(storageWrites.length, storageWritesBefore);
      manager.close();
    },
    { version: 1, rows: initialRows },
  );
});
