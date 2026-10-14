import test from "node:test";
import assert from "node:assert/strict";
import { createDirectDataCheckpointStoreV1 } from "../src/extractors/coursera/direct-data-checkpoints.js";

const DATABASE = "cti-coursera-direct-data-v1",
  COURSE = "Synthetic_course",
  OTHER = "Other_synthetic_course";
const WEEK = 7 * 24 * 60 * 60 * 1000;

// Requests complete separately from transaction commits. Writes stay in drafts
// until oncomplete, so rollback and early promise resolution are observable.
function fakeIndexedDB() {
  const stores = new Map(),
    metrics = { opens: [], transactions: [], writes: [], reads: [] };
  const control = {
    holdWrites: false,
    held: [],
    abortNextCommitFor: null,
    failNextPutFor: null,
  };
  const encode = (key) => JSON.stringify(key);
  const names = (map) => ({
    contains: (name) => map.has(name),
    [Symbol.iterator]: () => map.keys(),
  });
  const field = (row, path) =>
    Array.isArray(path)
      ? path.map((key) => field(row, key))
      : String(path)
          .split(".")
          .reduce((value, key) => value?.[key], row);
  function compare(left, right) {
    if (Array.isArray(left) && Array.isArray(right)) {
      for (
        let index = 0;
        index < Math.min(left.length, right.length);
        index++
      ) {
        const result = compare(left[index], right[index]);
        if (result) return result;
      }
      return left.length - right.length;
    }
    return left === right ? 0 : left < right ? -1 : 1;
  }
  function matches(key, query) {
    if (query === undefined || query === null) return true;
    if (query && query.range) {
      const lower = query.lower === undefined ? 1 : compare(key, query.lower),
        upper = query.upper === undefined ? -1 : compare(key, query.upper);
      return (
        (query.lower === undefined ||
          lower > 0 ||
          (!query.lowerOpen && lower === 0)) &&
        (query.upper === undefined ||
          upper < 0 ||
          (!query.upperOpen && upper === 0))
      );
    }
    return compare(key, query) === 0;
  }
  function transaction(requested, mode = "readonly") {
    const allowed = new Set(
        typeof requested === "string" ? [requested] : requested,
      ),
      drafts = new Map();
    for (const name of allowed) {
      if (!stores.has(name)) throw Error("NotFoundError: " + name);
      drafts.set(name, new Map(stores.get(name).rows));
    }
    metrics.transactions.push({ stores: [...allowed], mode });
    let pending = 0,
      ended = false,
      scheduled = false;
    const tx = {
      error: null,
      objectStore: (name) => {
        if (!allowed.has(name)) throw Error("NotFoundError: " + name);
        return api(name);
      },
      abort() {
        if (ended) return;
        ended = true;
        tx.error ||= Error("AbortError");
        setImmediate(() => tx.onabort?.({ target: tx }));
      },
    };
    function complete() {
      if (ended || pending) return;
      if (
        control.abortNextCommitFor &&
        allowed.has(control.abortNextCommitFor)
      ) {
        control.abortNextCommitFor = null;
        tx.error = Error("Synthetic transaction commit failure");
        tx.onerror?.({ target: tx });
        tx.abort();
        return;
      }
      ended = true;
      if (mode !== "readonly")
        for (const [name, rows] of drafts) stores.get(name).rows = rows;
      tx.oncomplete?.({ target: tx });
    }
    function finish() {
      if (ended || pending || scheduled) return;
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        if (ended || pending) return;
        if (mode !== "readonly" && control.holdWrites)
          control.held.push(complete);
        else complete();
      });
    }
    function request(operation, name, kind) {
      if (ended) throw Error("TransactionInactiveError");
      pending++;
      const req = { result: undefined, error: null };
      setImmediate(() => {
        if (ended) {
          pending--;
          return;
        }
        try {
          req.result = structuredClone(operation());
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
    function api(name) {
      const spec = stores.get(name),
        rows = drafts.get(name);
      function entries(path, query) {
        return [...rows.values()]
          .map((row) => ({
            row,
            primaryKey: field(row, spec.keyPath),
            key: field(row, path),
          }))
          .filter((entry) => matches(entry.key, query))
          .sort(
            (a, b) =>
              compare(a.key, b.key) || compare(a.primaryKey, b.primaryKey),
          );
      }
      function select(path, query, keys, kind) {
        return request(
          () => {
            metrics.reads.push({ store: name, kind });
            return entries(path, query).map((entry) =>
              keys ? entry.primaryKey : entry.row,
            );
          },
          name,
          kind,
        );
      }
      function cursor(path, query, keysOnly, direction = "next") {
        const all = entries(path, query),
          req = { result: null, error: null };
        if (direction.startsWith("prev")) all.reverse();
        let position = 0;
        pending++;
        function next() {
          setImmediate(() => {
            if (ended) {
              pending--;
              return;
            }
            const entry = all[position++];
            let continuing = false;
            metrics.reads.push({
              store: name,
              kind: keysOnly ? "openKeyCursor" : "openCursor",
            });
            req.result = entry
              ? {
                  primaryKey: structuredClone(entry.primaryKey),
                  key: structuredClone(entry.key),
                  ...(!keysOnly ? { value: structuredClone(entry.row) } : {}),
                  continue() {
                    continuing = true;
                    next();
                  },
                  delete() {
                    return result.delete(entry.primaryKey);
                  },
                  update(value) {
                    return result.put(value);
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
      const result = {
        keyPath: spec.keyPath,
        indexNames: names(spec.indexes),
        get: (key) =>
          request(
            () => {
              metrics.reads.push({ store: name, kind: "get" });
              return rows.get(encode(key));
            },
            name,
            "get",
          ),
        getAll: (query) => select(spec.keyPath, query, false, "getAll"),
        getAllKeys: (query) => select(spec.keyPath, query, true, "getAllKeys"),
        put: (value) =>
          request(
            () => {
              if (mode === "readonly") throw Error("ReadOnlyError");
              const key = field(value, spec.keyPath);
              if (
                key === undefined ||
                (Array.isArray(key) && key.includes(undefined))
              )
                throw Error("DataError: missing key");
              if (control.failNextPutFor === name) {
                control.failNextPutFor = null;
                throw Error("Synthetic QuotaExceededError");
              }
              rows.set(encode(key), structuredClone(value));
              metrics.writes.push({ store: name, kind: "put", key });
              return key;
            },
            name,
            "put",
          ),
        delete: (key) =>
          request(
            () => {
              if (mode === "readonly") throw Error("ReadOnlyError");
              rows.delete(encode(key));
              metrics.writes.push({ store: name, kind: "delete", key });
            },
            name,
            "delete",
          ),
        count: (query) =>
          request(() => entries(spec.keyPath, query).length, name, "count"),
        openCursor: (query, direction) =>
          cursor(spec.keyPath, query, false, direction),
        openKeyCursor: (query, direction) =>
          cursor(spec.keyPath, query, true, direction),
        index: (index) => {
          const path = spec.indexes.get(index);
          if (!path) throw Error("NotFoundError: " + index);
          return {
            getAll: (query) => select(path, query, false, "index.getAll"),
            getAllKeys: (query) =>
              select(path, query, true, "index.getAllKeys"),
            get: (query) =>
              request(() => entries(path, query)[0]?.row, name, "index.get"),
            getKey: (query) =>
              request(
                () => entries(path, query)[0]?.primaryKey,
                name,
                "index.getKey",
              ),
            count: (query) =>
              request(() => entries(path, query).length, name, "index.count"),
            openCursor: (query, direction) =>
              cursor(path, query, false, direction),
            openKeyCursor: (query, direction) =>
              cursor(path, query, true, direction),
          };
        },
      };
      return result;
    }
    finish();
    return tx;
  }
  const db = {
    version: 1,
    objectStoreNames: names(stores),
    close() {},
    transaction,
    createObjectStore(name, { keyPath }) {
      const indexes = new Map();
      stores.set(name, { keyPath, indexes, rows: new Map() });
      return {
        keyPath,
        indexNames: names(indexes),
        createIndex(index, path) {
          indexes.set(index, path);
        },
      };
    },
  };
  const indexedDB = {
    open(name, version) {
      metrics.opens.push({ name, version });
      const req = { result: db, error: null };
      setImmediate(() => {
        if (name !== DATABASE) {
          req.error = Error("Unexpected database access: " + name);
          req.onerror?.({ target: req });
          return;
        }
        if (!stores.size) {
          req.transaction = {
            abort() {
              req.error = Error("AbortError");
            },
          };
          req.onupgradeneeded?.({
            oldVersion: 0,
            newVersion: version,
            target: req,
          });
        }
        if (req.error) req.onerror?.({ target: req });
        else req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
  return {
    indexedDB,
    stores,
    metrics,
    control,
    rows: (name) => [...(stores.get(name)?.rows.values() || [])],
    flushWrites() {
      control.holdWrites = false;
      for (const complete of control.held.splice(0)) complete();
    },
  };
}

async function withDatabase(check) {
  const old = new Map(
    ["indexedDB", "IDBKeyRange", "localStorage"].map((key) => [
      key,
      {
        exists: Object.hasOwn(globalThis, key),
        descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
      },
    ]),
  );
  const fake = fakeIndexedDB(),
    range = (lower, upper, lowerOpen = false, upperOpen = false) => ({
      range: true,
      lower,
      upper,
      lowerOpen,
      upperOpen,
    });
  globalThis.indexedDB = fake.indexedDB;
  globalThis.IDBKeyRange = {
    only: (value) => range(value, value),
    bound: range,
    lowerBound: (value, open = false) => range(value, undefined, open),
    upperBound: (value, open = false) => range(undefined, value, false, open),
  };
  let legacyAccess = 0;
  const rejectLegacyAccess = () => {
    legacyAccess++;
    throw Error("Direct data must not touch legacy localStorage");
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: rejectLegacyAccess,
      setItem: rejectLegacyAccess,
      removeItem: rejectLegacyAccess,
      clear: rejectLegacyAccess,
    },
  });
  try {
    await check(fake);
    assert.equal(
      legacyAccess,
      0,
      "direct-data persistence never reads or writes legacy localStorage",
    );
  } finally {
    fake.flushWrites();
    for (const [key, value] of old)
      if (value.exists)
        Object.defineProperty(globalThis, key, value.descriptor);
      else delete globalThis[key];
  }
}

async function storeFor(course = COURSE) {
  const store = await createDirectDataCheckpointStoreV1(course);
  assert.equal(store.available, true, store.error);
  return store;
}

function source(id, label = "first") {
  return {
    id,
    name: "Synthetic " + id,
    typeName: "supplement",
    payload: {
      rawSnapshot: {
        cml: "<text>" + label + "</text>",
        unknownFutureFields: {
          annotations: [{ enabled: false, amount: 0, empty: null }],
          authoringVersion: "synthetic-only",
        },
      },
      links: ["https://example.invalid/synthetic"],
      textSample: label,
    },
  };
}

function ageRow(row, milliseconds) {
  const stamp = Date.now() - milliseconds;
  row.updatedAt =
    typeof row.updatedAt === "string" ? new Date(stamp).toISOString() : stamp;
  row.createdAt =
    typeof row.createdAt === "string" ? new Date(stamp).toISOString() : stamp;
}

async function assertNoForeignData(read) {
  try {
    const value = await read();
    assert(
      value == null || (Array.isArray(value) && value.length === 0),
      "foreign data must never be returned",
    );
  } catch (error) {
    assert.match(
      String(error?.message || error),
      /course|run|not found|unavailable|invalid/i,
    );
  }
}

test("direct-data storage creates owned UUID runs without legacy database or localStorage access", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      run = await store.openRun(undefined, {
        label: "Synthetic extraction",
        mode: "DIRECT_DATA",
      });
    assert.equal(run.schemaVersion, 1);
    assert.equal(run.courseId, COURSE);
    assert.equal(run.state, "RUNNING");
    assert.match(
      run.runId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(run.label, "Synthetic extraction");
    assert.equal(run.mode, "DIRECT_DATA");
    assert(run.createdAt);
    assert(run.updatedAt);
    assert.deepEqual((await store.getActiveRun()).runId, run.runId);
    assert.deepEqual(fake.metrics.opens, [{ name: DATABASE, version: 1 }]);
    assert.deepEqual([...fake.stores.keys()].sort(), [
      "definitions",
      "groups",
      "items",
      "runs",
    ]);
    store.close();
  });
});

test("incremental items, groups and definitions preserve unknown raw data across reopen", async () => {
  await withDatabase(async () => {
    let store = await storeFor();
    const run = await store.openRun(),
      first = source("item-b"),
      second = source("item-a", "second");
    const group = {
      id: "group-z",
      parts: [
        {
          rawDefinition: {
            type: "future-type",
            unparsed: { nested: [1, false, null, "synthetic"] },
          },
        },
      ],
      unknown: { untouched: true },
    };
    const definition = {
      id: "definition-one",
      prompt: { cml: "<text>synthetic prompt</text>" },
      futureField: { responses: [{ raw: "opaque" }] },
    };
    assert.equal(
      await store.putItem(run.runId, first.id, first, "COMPLETE"),
      true,
    );
    assert.equal(
      await store.putItem(run.runId, second.id, second, "PARTIAL"),
      true,
    );
    assert.equal(
      await store.putGroup(run.runId, first.id, "group-z", group),
      true,
    );
    assert.equal(
      await store.putGroup(run.runId, first.id, "group-a", { partCount: 0 }),
      true,
    );
    assert.equal(
      await store.putDefinition(run.runId, "definition-one", definition),
      true,
    );
    store.close();
    store = await storeFor();
    await store.openRun(run.runId);
    const item = await store.getItem(run.runId, first.id);
    assert.equal(item.courseId, COURSE);
    assert.equal(item.runId, run.runId);
    assert.equal(item.itemId, first.id);
    assert.equal(item.state, "COMPLETE");
    assert.deepEqual(item.fingerprint, first);
    assert.deepEqual(
      (await store.getGroup(run.runId, first.id, "group-z")).value,
      group,
    );
    assert.deepEqual(
      (await store.getDefinition(run.runId, "definition-one")).value,
      definition,
    );
    assert.deepEqual(
      (await store.listItems(run.runId)).map((row) => row.itemId),
      ["item-a", "item-b"],
    );
    assert.deepEqual(
      (await store.listGroups(run.runId, first.id)).map((row) => row.groupId),
      ["group-a", "group-z"],
    );
    item.fingerprint.payload.rawSnapshot.unknownFutureFields.annotations[0].amount = 99;
    assert.equal(
      (await store.getItem(run.runId, first.id)).fingerprint.payload.rawSnapshot
        .unknownFutureFields.annotations[0].amount,
      0,
      "mutating a returned graph cannot change stored raw evidence",
    );
    first.payload.rawSnapshot.unknownFutureFields.annotations[0].amount = 99;
    assert.equal(
      (await store.getItem(run.runId, first.id)).fingerprint.payload.rawSnapshot
        .unknownFutureFields.annotations[0].amount,
      0,
      "stored graphs are independent of later caller mutations",
    );
    const replacement = source(first.id, "new observation");
    assert.equal(
      await store.putItem(run.runId, first.id, replacement, "COMPLETE"),
      true,
    );
    assert.deepEqual(
      (await store.getItem(run.runId, first.id)).fingerprint,
      replacement,
    );
    assert.deepEqual(
      (await store.getItem(run.runId, second.id)).fingerprint,
      second,
      "updating one item preserves earlier independent observations",
    );
    store.close();
  });
});

test("course and run boundaries isolate repeated item, group and definition identifiers", async () => {
  await withDatabase(async () => {
    const owner = await storeFor(),
      other = await storeFor(OTHER),
      one = await owner.openRun(),
      two = await owner.openRun(),
      foreign = await other.openRun();
    for (const [store, run, label] of [
      [owner, one, "one"],
      [owner, two, "two"],
      [other, foreign, "other"],
    ]) {
      await store.putItem(
        run.runId,
        "same-item",
        source("same-item", label),
        "COMPLETE",
      );
      await store.putGroup(run.runId, "same-item", "same-group", { label });
      await store.putDefinition(run.runId, "same-definition", { label });
    }
    assert.equal(
      (await owner.getItem(one.runId, "same-item")).fingerprint.payload
        .textSample,
      "one",
    );
    assert.equal(
      (await owner.getItem(two.runId, "same-item")).fingerprint.payload
        .textSample,
      "two",
    );
    assert.equal(
      (await other.getGroup(foreign.runId, "same-item", "same-group")).value
        .label,
      "other",
    );
    assert.equal(
      (await owner.getDefinition(two.runId, "same-definition")).value.label,
      "two",
    );
    await assert.rejects(other.openRun(one.runId), /course|run|not found/i);
    await assertNoForeignData(() => other.getItem(one.runId, "same-item"));
    await assertNoForeignData(() =>
      other.getGroup(one.runId, "same-item", "same-group"),
    );
    await assertNoForeignData(() =>
      other.getDefinition(one.runId, "same-definition"),
    );
    await assertNoForeignData(() => other.listItems(one.runId));
    await assert.rejects(
      other.putItem(
        one.runId,
        "same-item",
        source("same-item", "wrong owner"),
        "COMPLETE",
      ),
      /course|run|not found/i,
    );
    assert.equal(
      (await owner.getItem(one.runId, "same-item")).fingerprint.payload
        .textSample,
      "one",
    );
    owner.close();
    other.close();
  });
});

test("an explicit absent or invalid run cannot create a fresh replacement", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      before = fake.rows("runs").length;
    await assert.rejects(
      store.openRun("99999999-9999-4999-8999-999999999999"),
      /run|not found/i,
    );
    await assert.rejects(
      store.openRun("legacy-run-identifier"),
      /invalid|UUID|run/i,
    );
    assert.equal(fake.rows("runs").length, before);
    assert.equal(await store.getActiveRun(), null);
    store.close();
  });
});

test("run updates preserve storage ownership and active-run selection excludes terminal and expired runs", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      older = await store.openRun(undefined, { label: "older" }),
      paused = await store.openRun(undefined, { label: "paused" }),
      terminal = await store.openRun(undefined, { label: "terminal" });
    await assert.rejects(
      store.saveRun({ ...paused, courseId: OTHER }),
      /different course|course/i,
    );
    const updated = await store.saveRun({
      ...paused,
      state: "PAUSED",
      label: "paused-updated",
      createdAt: 0,
    });
    assert.equal(updated.courseId, COURSE);
    assert.equal(updated.createdAt, paused.createdAt);
    assert.equal(updated.label, "paused-updated");
    assert.equal(updated.state, "PAUSED");
    await store.saveRun({ ...terminal, state: "COMPLETE" });
    const runs = fake.rows("runs");
    ageRow(
      runs.find((row) => row.runId === older.runId),
      60000,
    );
    ageRow(
      runs.find((row) => row.runId === paused.runId),
      1000,
    );
    assert.equal((await store.getActiveRun()).runId, paused.runId);
    ageRow(
      runs.find((row) => row.runId === paused.runId),
      WEEK + 60000,
    );
    assert.equal((await store.getActiveRun()).runId, older.runId);
    await store.saveRun({ ...older, state: "FAILED" });
    assert.equal(await store.getActiveRun(), null);
    store.close();
  });
});

test("seven-day pruning removes only expired owned runs and preserves the chosen resume", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      other = await storeFor(OTHER),
      selected = await store.openRun(),
      expired = await store.openRun(),
      foreign = await other.openRun();
    for (const [owner, run] of [
      [store, selected],
      [store, expired],
      [other, foreign],
    ]) {
      await owner.putItem(run.runId, "item", source("item"), "COMPLETE");
      await owner.putGroup(run.runId, "item", "group", { raw: true });
      await owner.putDefinition(run.runId, "definition", { raw: true });
    }
    for (const name of ["runs", "items", "groups", "definitions"])
      for (const row of fake.rows(name)) ageRow(row, WEEK + 60000);
    const selectedCreated = fake
      .rows("runs")
      .find((row) => row.runId === selected.runId).createdAt;
    const resumed = await store.openRun(selected.runId);
    assert.equal(resumed.runId, selected.runId);
    assert.equal(resumed.createdAt, selectedCreated);
    assert.equal((await store.getActiveRun()).runId, selected.runId);
    for (const name of ["runs", "items", "groups", "definitions"]) {
      assert.equal(
        fake
          .rows(name)
          .some(
            (row) => row.courseId === COURSE && row.runId === expired.runId,
          ),
        false,
        name + " expired records",
      );
      assert.equal(
        fake
          .rows(name)
          .some(
            (row) => row.courseId === COURSE && row.runId === selected.runId,
          ),
        true,
        name + " selected records",
      );
      assert.equal(
        fake
          .rows(name)
          .some((row) => row.courseId === OTHER && row.runId === foreign.runId),
        true,
        name + " foreign records",
      );
    }
    assert.deepEqual(
      (await store.getItem(selected.runId, "item")).fingerprint,
      source("item"),
    );
    store.close();
    other.close();
  });
});

test("many newer terminal runs cannot hide an older active capture", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      active = await store.openRun();
    for (let index = 0; index < 75; index++) {
      const terminal = await store.openRun();
      await store.saveRun({ ...terminal, state: "COMPLETE" });
    }
    for (const row of fake.rows("runs"))
      ageRow(row, row.runId === active.runId ? 60000 : 1000);
    assert.equal((await store.getActiveRun()).runId, active.runId);
    store.close();
  });
});

test("expired-run pruning is bounded instead of deleting every old capture in one call", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      old = [];
    for (let index = 0; index < 10; index++) old.push(await store.openRun());
    for (const row of fake.rows("runs")) ageRow(row, WEEK + 10000);
    const next = await store.openRun(),
      remaining = fake
        .rows("runs")
        .filter((row) => old.some((run) => run.runId === row.runId));
    assert(
      remaining.length >= 2,
      "one pruning invocation handles at most eight old runs",
    );
    assert(remaining.length < 10, "expired captures are actually pruned");
    assert.equal(
      fake.rows("runs").some((row) => row.runId === next.runId),
      true,
    );
    store.close();
  });
});

test("pruning caps raw-row deletion and retains run metadata until all owned evidence has gone", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      expired = await store.openRun();
    for (let index = 0; index < 520; index++)
      await store.putDefinition(expired.runId, "definition-" + index, {
        synthetic: index,
      });
    for (const name of ["runs", "definitions"])
      for (const row of fake.rows(name)) ageRow(row, WEEK + 10000);
    const fresh = await store.openRun();
    assert.equal(
      fake.rows("definitions").filter((row) => row.runId === expired.runId)
        .length,
      8,
      "one invocation deletes at most 512 raw rows",
    );
    assert.equal(
      fake.rows("runs").some((row) => row.runId === expired.runId),
      true,
      "remaining evidence still has its owning run",
    );
    await store.openRun(fresh.runId);
    assert.equal(
      fake.rows("definitions").some((row) => row.runId === expired.runId),
      false,
    );
    assert.equal(
      fake.rows("runs").some((row) => row.runId === expired.runId),
      false,
    );
    store.close();
  });
});

test("writes resolve only after transaction commit and failed commits preserve existing raw observations", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      run = await store.openRun(),
      original = source("atomic");
    await store.putItem(run.runId, original.id, original, "PARTIAL");
    fake.control.holdWrites = true;
    let settled = false;
    const replacement = source("atomic", "replacement"),
      write = store
        .putItem(run.runId, replacement.id, replacement, "COMPLETE")
        .then((value) => {
          settled = true;
          return value;
        });
    for (let attempt = 0; attempt < 30 && !fake.control.held.length; attempt++)
      await new Promise((resolve) => setImmediate(resolve));
    assert(
      fake.control.held.length > 0,
      "the write reached a transaction whose requests have succeeded",
    );
    assert.equal(
      settled,
      false,
      "successful request events are not durable commit acknowledgements",
    );
    assert.deepEqual(
      fake.rows("items").find((row) => row.itemId === "atomic").fingerprint,
      original,
    );
    fake.flushWrites();
    assert.equal(await write, true);
    assert.deepEqual(
      (await store.getItem(run.runId, "atomic")).fingerprint,
      replacement,
    );
    fake.control.abortNextCommitFor = "items";
    await assert.rejects(
      store.putItem(
        run.runId,
        "atomic",
        source("atomic", "failed write"),
        "PARTIAL",
      ),
      /commit failure|failed|aborted/i,
    );
    assert.deepEqual(
      (await store.getItem(run.runId, "atomic")).fingerprint,
      replacement,
    );
    await store.putGroup(run.runId, "atomic", "group", { before: true });
    fake.control.abortNextCommitFor = "groups";
    await assert.rejects(
      store.putGroup(run.runId, "atomic", "group", { after: true }),
      /commit failure|failed|aborted/i,
    );
    assert.deepEqual(
      (await store.getGroup(run.runId, "atomic", "group")).value,
      { before: true },
    );
    await store.putDefinition(run.runId, "definition", { original: true });
    fake.control.failNextPutFor = "definitions";
    await assert.rejects(
      store.putDefinition(run.runId, "definition", { replacement: true }),
      /QuotaExceeded|failed/i,
    );
    assert.deepEqual(
      (await store.getDefinition(run.runId, "definition")).value,
      { original: true },
    );
    store.close();
  });
});

test("unavailable storage reports an actionable error and every persistence operation rejects", async () => {
  await withDatabase(async () => {
    globalThis.indexedDB = {
      open() {
        throw Error("Synthetic storage disabled");
      },
    };
    const store = await createDirectDataCheckpointStoreV1(COURSE);
    assert.equal(store.available, false);
    assert.match(store.error, /storage disabled|unavailable/i);
    const run = "11111111-1111-4111-8111-111111111111";
    for (const operation of [
      () => store.openRun(),
      () => store.getActiveRun(),
      () => store.saveRun({ runId: run }),
      () => store.putItem(run, "item", source("item"), "COMPLETE"),
      () => store.getItem(run, "item"),
      () => store.listItems(run),
      () => store.putGroup(run, "item", "group", {}),
      () => store.getGroup(run, "item", "group"),
      () => store.listGroups(run, "item"),
      () => store.putDefinition(run, "definition", {}),
      () => store.getDefinition(run, "definition"),
    ]) {
      await assert.rejects(operation(), /storage disabled|unavailable/i);
    }
    assert.doesNotThrow(() => store.close());
  });
});

test("a blocked database open times out promptly and closes a late successful connection", async () => {
  await withDatabase(async () => {
    const oldTimeout = globalThis.setTimeout,
      oldClear = globalThis.clearTimeout;
    const deadlines = new Map();
    let connectionClosed = 0,
      upgradeAborted = 0;
    const request = {
      result: {
        close() {
          connectionClosed++;
        },
      },
      transaction: {
        abort() {
          upgradeAborted++;
        },
      },
    };
    globalThis.indexedDB = {
      open() {
        return request;
      },
    };
    globalThis.setTimeout = (callback, milliseconds, ...arguments_) => {
      if (milliseconds !== 5000)
        return oldTimeout(callback, milliseconds, ...arguments_);
      const token = { syntheticTimer: true };
      deadlines.set(token, { callback, milliseconds });
      return token;
    };
    globalThis.clearTimeout = (token) =>
      deadlines.has(token) ? deadlines.delete(token) : oldClear(token);
    try {
      let settled = false;
      const opening = createDirectDataCheckpointStoreV1(COURSE).then(
        (value) => {
          settled = true;
          return value;
        },
      );
      request.onblocked();
      await Promise.resolve();
      assert.equal(settled, false);
      assert.equal(deadlines.size, 1);
      const deadline = [...deadlines.values()][0];
      assert.equal(
        deadline.milliseconds,
        5000,
        "storage opening has a fixed bounded wait",
      );
      deadline.callback();
      const store = await opening;
      assert.equal(store.available, false);
      assert.match(store.error, /blocked.*another open tab/i);
      assert.equal(upgradeAborted, 1);
      request.onupgradeneeded();
      assert.equal(
        upgradeAborted,
        2,
        "an upgrade arriving after timeout must not create stores",
      );
      request.onsuccess();
      assert.equal(
        connectionClosed,
        1,
        "the late database connection cannot stay open after failure",
      );
      await assert.rejects(store.openRun(), /blocked.*another open tab/i);
      assert.equal(store.available, false);
      store.close();
    } finally {
      globalThis.setTimeout = oldTimeout;
      globalThis.clearTimeout = oldClear;
    }
  });
});
