import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDirectDataCheckpointStoreV1 } from "../src/extractors/coursera/direct-data-checkpoints.js";
import { CTI_DIRECT_DATA_BUILD_V1 } from "../src/extractors/coursera/direct-data-config.js";

const DATABASE = "cti-coursera-direct-data-v1",
  COURSE = "Synthetic_course",
  OTHER = "Other_synthetic_course";
const WEEK = 7 * 24 * 60 * 60 * 1000;

// Requests complete separately from transaction commits. Writes stay in drafts
// until oncomplete, so rollback and early promise resolution are observable.
function fakeIndexedDB() {
  const stores = new Map(),
    metrics = { opens: [], transactions: [], writes: [], reads: [] },
    heldWriteWaiters = new Set();
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
        if (mode !== "readonly" && control.holdWrites) {
          control.held.push(complete);
          for (const resolve of [...heldWriteWaiters]) resolve();
        } else complete();
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
    version: 0,
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
        if (version<db.version) {
          req.error=Error("VersionError");req.onerror?.({target:req});return;
        }
        if (version>db.version) {
          const oldVersion=db.version;
          req.transaction = {
            abort() {
              req.error = Error("AbortError");
            },
            objectStore(storeName) {
              const spec=stores.get(storeName);
              if (!spec) throw Error("NotFoundError: "+storeName);
              return {indexNames:names(spec.indexes),createIndex(index,path){spec.indexes.set(index,path);}};
            },
          };
          req.onupgradeneeded?.({
            oldVersion,
            newVersion: version,
            target: req,
          });
          if (!req.error) db.version=version;
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
    database:db,
    metrics,
    control,
    rows: (name) => [...(stores.get(name)?.rows.values() || [])],
    waitForHeldWrite() {
      if (control.held.length) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const ready = () => {
          clearTimeout(timer);
          heldWriteWaiters.delete(ready);
          resolve();
        };
        const timer = setTimeout(() => {
          heldWriteWaiters.delete(ready);
          reject(Error("The write did not reach the held commit gate within 5 seconds."));
        }, 5000);
        heldWriteWaiters.add(ready);
      });
    },
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

function originalBody(label="synthetic original",mime="image/png") {
  const bytes=Buffer.from(label),blob=new Blob([bytes],{type:mime});
  return {blob,sha256:createHash("sha256").update(bytes).digest("hex")};
}

test("database v2 adds an isolated body store while preserving v1 source rows and indexes",async()=>{
  await withDatabase(async fake=>{
    const oldRun="11111111-1111-4111-8111-111111111111",stamp=Date.now();
    for(const name of ["runs","items","groups","definitions"]) {
      const indexes=name==="runs"?new Map([["courseUpdatedAt",["courseId","updatedAt"]],["courseStateUpdatedAt",["courseId","state","updatedAt"]]]):
        new Map([["runKey","runKey"],...(name==="groups"?[["itemKey",["courseId","runId","itemId"]]]:[])]);
      fake.stores.set(name,{keyPath:"key",indexes,rows:new Map()});
    }
    const run={schemaVersion:1,key:[COURSE,oldRun],courseId:COURSE,runId:oldRun,createdAt:stamp,updatedAt:stamp,state:"PAUSED",unknownFuture:{raw:[0,false,null]}},
      item={schemaVersion:1,key:[COURSE,oldRun,"old-item"],runKey:[COURSE,oldRun],courseId:COURSE,runId:oldRun,itemId:"old-item",fingerprint:source("old-item"),createdAt:stamp,updatedAt:stamp};
    fake.stores.get("runs").rows.set(JSON.stringify(run.key),structuredClone(run));
    fake.stores.get("items").rows.set(JSON.stringify(item.key),structuredClone(item));
    fake.database.version=1;
    const store=await storeFor();
    assert.equal(fake.database.version,2);assert(fake.stores.has("bodies"));
    assert.deepEqual(await store.getActiveRun(),run);assert.deepEqual(await store.getItem(oldRun,"old-item"),item);
    assert.deepEqual(fake.rows("runs"),[run]);assert.deepEqual(fake.rows("items"),[item]);
    const body=originalBody();await store.putBody(oldRun,body.sha256,body.blob);
    assert.equal((await store.getBody(oldRun,body.sha256)).schemaVersion,2);
    assert.equal(fake.rows("items")[0].schemaVersion,1);store.close();
  });
});

test("original body storage verifies bytes and deduplicates exact hashes without overwriting source metadata",async()=>{
  await withDatabase(async fake=>{
    const store=await storeFor(),run=await store.openRun(),body=originalBody();
    const descriptor=await store.putBody(run.runId,body.sha256,body.blob,{mime:"image/png",unknownFuture:{source:"first",enabled:false}});
    assert.equal(descriptor.archivePath,"files/"+body.sha256);assert.equal(descriptor.size,body.blob.size);
    assert.equal(descriptor.blob,undefined);assert.equal(descriptor.courseId,COURSE);assert.equal(descriptor.runId,run.runId);
    const existing=structuredClone(fake.rows("bodies")[0]),firstWrites=fake.metrics.writes.filter(row=>row.store==="bodies").length;
    const duplicate=await store.putBody(run.runId,body.sha256,new Blob([await body.blob.arrayBuffer()],{type:"application/octet-stream"}),
      {mime:"application/octet-stream",unknownFuture:{source:"second"}});
    assert.deepEqual(duplicate.metadata,{mime:"image/png",unknownFuture:{enabled:false,source:"first"}});
    assert.equal(duplicate.mime,"image/png");assert.equal(duplicate.createdAt,existing.createdAt);
    assert.deepEqual(fake.rows("bodies"),[existing]);assert.equal(fake.metrics.writes.filter(row=>row.store==="bodies").length,firstWrites);
    const stored=await store.getBody(run.runId,body.sha256);
    assert(stored.blob instanceof Blob);assert.deepEqual(Buffer.from(await stored.blob.arrayBuffer()),Buffer.from(await body.blob.arrayBuffer()));
    stored.metadata.unknownFuture.source="caller changed";
    assert.equal((await store.getBody(run.runId,body.sha256)).metadata.unknownFuture.source,"first");
    store.close();
  });
});

test("body descriptors scan cursors without collecting Blob values or whole-store arrays",async()=>{
  await withDatabase(async fake=>{
    const store=await storeFor(),run=await store.openRun();
    for(let index=0;index<20;index++) {
      const body=originalBody("body"+index);await store.putBody(run.runId,body.sha256,body.blob);
    }
    const readStart=fake.metrics.reads.length,descriptors=await store.listBodyDescriptors(run.runId),reads=fake.metrics.reads.slice(readStart);
    assert.equal(descriptors.length,20);assert(descriptors.every(row=>!Object.hasOwn(row,"blob")));
    assert(descriptors.every(row=>row.archivePath==="files/"+row.sha256));
    assert(reads.some(row=>row.store==="bodies" && row.kind==="openCursor"));
    assert(!reads.some(row=>row.store==="bodies" && /getAll/i.test(row.kind)));
    assert.equal(JSON.stringify(descriptors).includes("base64"),false);store.close();
  });
});

test("only scoped and checksum-verified MP4 podcast renditions can exceed the ordinary body bound",async()=>{
  await withDatabase(async fake=>{
    const store=await storeFor(),run=await store.openRun(),bytes=Buffer.alloc(16*1024*1024+1);
    bytes.writeUInt32BE(24,0);bytes.write("ftypmp42",4,"ascii");
    const hash=createHash("sha256").update(bytes).digest("hex"),blob=new Blob([bytes],{type:"video/mp4"}),
      metadata={mime:"video/mp4",kind:"PANOPTO_PODCAST_RENDITION"};
    for(const value of [{mime:"video/mp4"},{mime:"video/mp4",kind:"COURSERA_ASSET"},{mime:"image/png",kind:"PANOPTO_PODCAST_RENDITION"}])
      await assert.rejects(store.putBody(run.runId,hash,blob,value),/Blob|MIME/i);
    const descriptor=await store.putBody(run.runId,hash,blob,metadata);
    assert.equal(descriptor.size,bytes.length);assert.equal(descriptor.metadata.kind,metadata.kind);
    const retained=await store.getBody(run.runId,hash);
    assert.equal(retained.blob.size,bytes.length);
    assert.equal((await store.listBodyDescriptors(run.runId))[0].metadata.kind,metadata.kind);
    const tampered=Buffer.from(bytes);tampered[tampered.length-1]=1;
    await assert.rejects(store.putBody(run.runId,hash,new Blob([tampered],{type:"video/mp4"}),metadata),/SHA-256/);
    const row=fake.rows("bodies")[0],key=JSON.stringify(row.key);
    fake.stores.get("bodies").rows.set(key,{...row,metadata:{mime:"video/mp4",kind:"COURSERA_ASSET"}});
    await assert.rejects(store.getBody(run.runId,hash),/identity/);
    class OversizedBlob extends Blob {get size(){return 128*1024*1024+1;}}
    await assert.rejects(store.putBody(run.runId,hash,new OversizedBlob(["x"]),metadata),/Blob/);
    const wrong=Buffer.from("<html>not an MP4 rendition</html>"),wrongHash=createHash("sha256").update(wrong).digest("hex");
    await assert.rejects(store.putBody(run.runId,wrongHash,new Blob([wrong],{type:"video/mp4"}),metadata),/MP4/);
    store.close();
  });
});

test("body keys, ownership, metadata and actual checksums fail closed without replacing retained originals",async()=>{
  await withDatabase(async fake=>{
    const store=await storeFor(),other=await storeFor(OTHER),run=await store.openRun(),foreign=await other.openRun(),body=originalBody(),wrong=originalBody("different");
    await store.putBody(run.runId,body.sha256,body.blob,{mime:"image/png"});
    const before=structuredClone(fake.rows("bodies"));
    await assert.rejects(store.putBody(run.runId,body.sha256,wrong.blob),/SHA-256/);
    for(const metadata of [{courseId:OTHER},{runId:foreign.runId},{sha256:wrong.sha256},{size:999},{archivePath:"files/foreign"},
      {mime:"text/html\r\nBad"},{oversized:"x".repeat(17000)}])
      await assert.rejects(store.putBody(run.runId,body.sha256,body.blob,metadata),/course|run|key|MIME|limit/i);
    for(const hash of ["short",body.sha256.toUpperCase(),"../"+body.sha256]) {
      await assert.rejects(store.putBody(run.runId,hash,body.blob),/SHA-256/);
      await assert.rejects(store.getBody(run.runId,hash),/SHA-256/);
    }
    for(const blob of [null,{size:body.blob.size,arrayBuffer:()=>body.blob.arrayBuffer()},new Blob([]),new Blob([new Uint8Array(16*1024*1024+1)])])
      await assert.rejects(store.putBody(run.runId,body.sha256,blob),/Blob/);
    await assert.rejects(other.putBody(run.runId,body.sha256,body.blob),/course|run/i);
    assert.equal(await other.getBody(run.runId,body.sha256),null);assert.deepEqual(await other.listBodyDescriptors(run.runId),[]);
    assert.equal(await store.getBody(foreign.runId,body.sha256),null);assert.deepEqual(fake.rows("bodies"),before);
    store.close();other.close();
  });
});

test("corrupted stored body bytes cannot be reused, replaced or exported under an old hash",async()=>{
  await withDatabase(async fake=>{
    const store=await storeFor(),run=await store.openRun(),body=originalBody("first");
    await store.putBody(run.runId,body.sha256,body.blob);
    const row=fake.rows("bodies")[0];row.blob=new Blob(["other"],{type:"image/png"});
    await assert.rejects(store.getBody(run.runId,body.sha256),/SHA-256/);
    await assert.rejects(store.putBody(run.runId,body.sha256,body.blob),/SHA-256/);
    assert.equal(Buffer.from(await fake.rows("bodies")[0].blob.arrayBuffer()).toString(),"other");store.close();
  });
});

test("body writes acknowledge durable commit and preserve prior originals on quota or commit failures",async()=>{
  await withDatabase(async fake=>{
    const store=await storeFor(),run=await store.openRun(),first=originalBody("first"),second=originalBody("second"),third=originalBody("third");
    await store.putBody(run.runId,first.sha256,first.blob);
    fake.control.holdWrites=true;let settled=false;
    const writing=store.putBody(run.runId,second.sha256,second.blob).then(value=>{settled=true;return value;});
    await fake.waitForHeldWrite();
    assert(fake.control.held.length);assert.equal(settled,false);assert.equal(fake.rows("bodies").length,1);
    fake.flushWrites();await writing;assert.equal(fake.rows("bodies").length,2);
    fake.control.failNextPutFor="bodies";
    await assert.rejects(store.putBody(run.runId,third.sha256,third.blob),/QuotaExceeded/);
    assert.equal(fake.rows("bodies").length,2);assert((await store.getBody(run.runId,first.sha256)).blob instanceof Blob);
    fake.control.abortNextCommitFor="bodies";
    await assert.rejects(store.putBody(run.runId,third.sha256,third.blob),/commit failure|failed|aborted/i);
    assert.equal(fake.rows("bodies").length,2);store.close();
  });
});

test("body expiry and pruning stay bound to the owning course and retain live unrelated originals",async()=>{
  await withDatabase(async fake=>{
    const store=await storeFor(),other=await storeFor(OTHER),expired=await store.openRun(),foreign=await other.openRun(),body=originalBody();
    await store.putBody(expired.runId,body.sha256,body.blob);await other.putBody(foreign.runId,body.sha256,body.blob);
    ageRow(fake.rows("runs").find(row=>row.runId===expired.runId),WEEK+1000);
    assert.equal(await store.getBody(expired.runId,body.sha256),null);assert.deepEqual(await store.listBodyDescriptors(expired.runId),[]);
    await assert.rejects(store.putBody(expired.runId,body.sha256,body.blob),/expired|not found/i);
    await store.openRun();
    assert.equal(fake.rows("bodies").some(row=>row.runId===expired.runId),false);
    assert.equal(fake.rows("runs").some(row=>row.runId===expired.runId),false);
    assert((await other.getBody(foreign.runId,body.sha256)).blob instanceof Blob);
    assert.equal((await other.listBodyDescriptors(foreign.runId)).length,1);store.close();other.close();
  });
});

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
    assert.deepEqual(fake.metrics.opens, [{ name: DATABASE, version: 2 }]);
    assert.deepEqual([...fake.stores.keys()].sort(), [
      "bodies",
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

function interruptedExportRun(run, captureChanges = {}, runChanges = {}) {
  return {
    ...run,
    state: "INCOMPLETE",
    buildId: "v1.0.0-bound-authoring-drafts-20261014",
    counts: { processed: 129, complete: 45, questions: 3306, total: 185 },
    budget: {
      requests: 10562,
      bytes: 20000000,
      elapsedMs: 32 * 60 * 1000,
      limits: {
        requests: 20000,
        totalBytes: 64 * 1024 * 1024,
        durationMs: 60 * 60 * 1000,
      },
    },
    captureMeta: {
      directDataCapture: {
        mode: "BOUND_AUTHORING_DRAFT_API",
        version: 1,
        runId: run.runId,
        sourceStable: false,
        materials: { elements: [{ id: run.courseId }] },
        ...captureChanges,
      },
    },
    ...runChanges,
  };
}

test("export recovery is opt-in, course-bound, and preserves the original saved evidence and budget", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      foreignStore = await storeFor(OTHER),
      paused = await store.openRun(undefined, { state: "PAUSED" }),
      stopped = await store.openRun(),
      foreign = await foreignStore.openRun();
    await store.putItem(
      stopped.runId,
      "saved-item",
      source("saved-item"),
      "COMPLETE",
    );
    await store.putGroup(stopped.runId, "saved-item", "group", {
      raw: "saved-group",
    });
    await store.putDefinition(stopped.runId, "definition@1", {
      raw: "saved-definition",
    });
    const stoppedMetadata = interruptedExportRun(stopped, {
      stopReason: "DIRECT_CAPTURE_EXPORT_BYTE_LIMIT",
    });
    await store.saveRun(stoppedMetadata);
    await foreignStore.saveRun(
      interruptedExportRun(foreign, {
        stopReason: "DIRECT_CAPTURE_EXPORT_BYTE_LIMIT",
      }),
    );
    ageRow(
      fake.rows("runs").find((row) => row.runId === paused.runId),
      60000,
    );
    ageRow(
      fake.rows("runs").find((row) => row.runId === stopped.runId),
      1000,
    );
    assert.equal((await store.getActiveRun()).runId, paused.runId);
    assert.equal(
      (await store.getActiveRun({ recoverExportLimit: false })).runId,
      paused.runId,
    );
    const beforeWrites = fake.metrics.writes.length,
      recovered = await store.getActiveRun({ recoverExportLimit: true });
    assert.equal(recovered.runId, stopped.runId);
    assert.equal(
      recovered.state,
      "INCOMPLETE",
      "selection never labels resumed work verified",
    );
    assert.deepEqual(recovered.budget, stoppedMetadata.budget);
    assert.deepEqual(recovered.counts, stoppedMetadata.counts);
    assert.equal(
      fake.metrics.writes.length,
      beforeWrites,
      "recovery selection is read-only",
    );
    assert.deepEqual(
      (await store.getItem(stopped.runId, "saved-item")).fingerprint,
      source("saved-item"),
    );
    assert.deepEqual(
      (await store.getGroup(stopped.runId, "saved-item", "group")).value,
      { raw: "saved-group" },
    );
    assert.deepEqual(
      (await store.getDefinition(stopped.runId, "definition@1")).value,
      { raw: "saved-definition" },
    );
    ageRow(
      fake.rows("runs").find((row) => row.runId === stopped.runId),
      WEEK + 60000,
    );
    assert.equal(
      (await store.getActiveRun({ recoverExportLimit: true })).runId,
      paused.runId,
    );
    store.close();
    foreignStore.close();
  });
});

test("the released legacy export interruption is recoverable without its missing terminal reason", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      stopped = await store.openRun();
    await store.saveRun(interruptedExportRun(stopped));
    assert.equal(await store.getActiveRun(), null);
    assert.equal(
      (await store.getActiveRun({ recoverExportLimit: true })).runId,
      stopped.runId,
    );
    const variations = [
      [{ sourceStable: true }, {}],
      [{ finalMaterials: { elements: [{ id: COURSE }] } }, {}],
      [{ acquisitionComplete: true }, {}],
      [{ wholeCourseVerified: true }, {}],
      [{ stopReason: "DIRECT_CAPTURE_FAILED" }, {}],
      [{ mode: "UNRECOGNIZED_CAPTURE" }, {}],
      [{ version: 2 }, {}],
      [{ runId: "99999999-9999-4999-8999-999999999999" }, {}],
      [{ materials: { elements: [{ id: OTHER }] } }, {}],
      [{}, { buildId: "unrecognized-build" }],
      [{}, { counts: { processed: 185, total: 185 } }],
      [{}, { counts: { processed: 0, total: 185 } }],
      [{}, { counts: { processed: 129.5, total: 185 } }],
      [{}, { counts: { processed: 129, total: Infinity } }],
    ];
    for (const [captureChanges, runChanges] of variations) {
      await store.saveRun(
        interruptedExportRun(stopped, captureChanges, runChanges),
      );
      assert.equal(
        await store.getActiveRun({ recoverExportLimit: true }),
        null,
        "unrelated terminal shape must not resume: " +
          JSON.stringify([captureChanges, runChanges]),
      );
    }
    assert.equal(
      fake.rows("runs").length,
      1,
      "checks never create a replacement run",
    );
    store.close();
  });
});

test("export recovery excludes exhausted or invalid cumulative budgets and generic terminal states", async () => {
  await withDatabase(async () => {
    const store = await storeFor(),
      stopped = await store.openRun(),
      metadata = interruptedExportRun(stopped, {
        stopReason: "DIRECT_CAPTURE_EXPORT_BYTE_LIMIT",
      });
    for (const [used, limit] of [
      ["requests", "requests"],
      ["bytes", "totalBytes"],
      ["elapsedMs", "durationMs"],
    ]) {
      for (const value of [
        0,
        -1,
        Infinity,
        NaN,
        undefined,
        metadata.budget.limits[limit],
      ]) {
        await store.saveRun({
          ...metadata,
          budget: { ...metadata.budget, [used]: value },
        });
        assert.equal(
          await store.getActiveRun({ recoverExportLimit: true }),
          null,
          used + "=" + value,
        );
      }
      await store.saveRun({
        ...metadata,
        budget: {
          ...metadata.budget,
          limits: { ...metadata.budget.limits, [limit]: undefined },
        },
      });
      assert.equal(
        await store.getActiveRun({ recoverExportLimit: true }),
        null,
        "missing " + limit,
      );
    }
    for (const terminalState of ["COMPLETE", "FAILED", "CANCELLED"]) {
      await store.saveRun({ ...metadata, state: terminalState });
      assert.equal(
        await store.getActiveRun({ recoverExportLimit: true }),
        null,
        terminalState,
      );
    }
    await store.saveRun(metadata);
    assert.equal(
      (await store.getActiveRun({ recoverExportLimit: true })).runId,
      stopped.runId,
    );
    store.close();
  });
});

test("newer unrelated incomplete runs cannot hide an older eligible export recovery", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      stopped = await store.openRun();
    await store.saveRun(
      interruptedExportRun(stopped, {
        stopReason: "DIRECT_CAPTURE_EXPORT_BYTE_LIMIT",
      }),
    );
    for (let index = 0; index < 75; index++) {
      const unrelated = await store.openRun();
      await store.saveRun(
        interruptedExportRun(unrelated, {
          stopReason: "COURSE_API_TIME_LIMIT",
        }),
      );
    }
    for (const row of fake.rows("runs"))
      ageRow(row, row.runId === stopped.runId ? 60000 : 1000);
    assert.equal(
      (await store.getActiveRun({ recoverExportLimit: true })).runId,
      stopped.runId,
    );
    assert.equal(await store.getActiveRun(), null);
    store.close();
  });
});

function completedMediaGapRun(run, captureChanges = {}, runChanges = {}) {
  const base = interruptedExportRun(run);
  return {
    ...base,
    buildId: "v1.1.0-compressed-resumable-drafts-20261014",
    counts: { processed: 185, complete: 81, questions: 4007, total: 185 },
    budget: {
      ...base.budget,
      requests: 16269,
      elapsedMs: 42 * 60 * 1000,
    },
    captureMeta: {
      directDataCapture: {
        ...base.captureMeta.directDataCapture,
        sourceStable: true,
        acquisitionComplete: true,
        wholeCourseVerified: false,
        stopReason: "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS",
        finalMaterials: { elements: [{ id: run.courseId }] },
        historicalSourceScope: { observations: "original-assessment-proof" },
        ...captureChanges,
      },
    },
    ...runChanges,
  };
}

test("media-gap recovery is opt-in and preserves the completed inventory, all definitions and historical metadata", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      stopped = await store.openRun();
    for (let index = 0; index < 185; index++)
      await store.putItem(
        stopped.runId,
        "item-" + index,
        source("item-" + index),
        index < 81 ? "COMPLETE" : "INCOMPLETE",
      );
    await store.putGroup(stopped.runId, "item-0", "original-group", {
      id: "original-group",
      questions: ["original-definition@1"],
      receipt: { originalResponseSha256: "original-native-receipt" },
    });
    for (let index = 0; index < 4007; index++)
      await store.putDefinition(stopped.runId, "definition-" + index + "@1", {
        id: "definition-" + index + "@1",
        raw: { futureSourceField: [index, false, null] },
        receipt: { originalResponseSha256: "retained-" + index },
      });
    const metadata = completedMediaGapRun(stopped);
    await store.saveRun(metadata);
    assert.equal(await store.getActiveRun(), null);
    assert.equal(await store.getActiveRun({ recoverExportLimit: true }), null);
    assert.equal(await store.getActiveRun({ recoverMediaGaps: false }), null);
    const before = structuredClone(
        Object.fromEntries(
          ["runs", "items", "groups", "definitions"].map((name) => [
            name,
            fake.rows(name),
          ]),
        ),
      ),
      beforeWrites = fake.metrics.writes.length,
      recovered = await store.getActiveRun({ recoverMediaGaps: true });
    assert.equal(recovered.runId, stopped.runId);
    assert.equal(recovered.state, "INCOMPLETE");
    assert.deepEqual(recovered.captureMeta, metadata.captureMeta);
    assert.deepEqual(recovered.counts, metadata.counts);
    assert.deepEqual(recovered.budget, metadata.budget);
    assert.equal(
      (
        await store.getActiveRun({
          recoverExportLimit: true,
          recoverMediaGaps: true,
        })
      ).runId,
      stopped.runId,
    );
    assert.equal(fake.metrics.writes.length, beforeWrites);
    for (const name of ["runs", "items", "groups", "definitions"])
      assert.deepEqual(fake.rows(name), before[name], name + " is unchanged");
    assert.equal(fake.rows("items").length, 185);
    assert.equal(fake.rows("definitions").length, 4007);
    recovered.captureMeta.directDataCapture.historicalSourceScope.observations =
      "caller-mutated";
    assert.equal(
      (await store.getActiveRun({ recoverMediaGaps: true })).captureMeta
        .directDataCapture.historicalSourceScope.observations,
      "original-assessment-proof",
      "the returned historical metadata is an independent snapshot",
    );
    store.close();
  });
});

test("media-gap recovery accepts only explicitly compatible builds and owned complete-acquisition metadata", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      stopped = await store.openRun();
    for (const buildId of [
      "v1.1.0-compressed-resumable-drafts-20261014",
      "v1.2.0-bound-reading-media-20261014",
      "v1.3.0-deduplicated-original-archive-20261014",
      "v1.4.0-bound-content-integrity-20261015",
      "v1.5.0-bound-widget-configuration-20261015",
      "v1.6.0-integrated-panopto-bookmark-20261015",
      "v1.6.1-provider-access-diagnostics-20261015",
      "v1.8.0-inline-widget-public-html-20261018",
      "v1.8.1-browser-publisher-api-20261018",
      "v1.8.2-historical-publisher-checkpoint-20261018",
      "v1.8.3-publisher-sections-original-images-20261018", "v1.8.4-public-publisher-images-20261019",
      CTI_DIRECT_DATA_BUILD_V1,
    ]) {
      await store.saveRun(completedMediaGapRun(stopped, {}, { buildId }));
      assert.equal(
        (await store.getActiveRun({ recoverMediaGaps: true })).runId,
        stopped.runId,
        buildId,
      );
    }
    const variations = [
      [{ sourceStable: false }, {}],
      [{ sourceStable: undefined }, {}],
      [{ acquisitionComplete: false }, {}],
      [{ acquisitionComplete: undefined }, {}],
      [{ wholeCourseVerified: true }, {}],
      [{ wholeCourseVerified: undefined }, {}],
      [{ stopReason: "DIRECT_CAPTURE_FAILED" }, {}],
      [{ stopReason: undefined }, {}],
      [{ mode: "UNRECOGNIZED_CAPTURE" }, {}],
      [{ version: 2 }, {}],
      [{ runId: "99999999-9999-4999-8999-999999999999" }, {}],
      [{ materials: { elements: [{ id: OTHER }] } }, {}],
      [{ materials: undefined }, {}],
      [{}, { buildId: "v1.0.0-bound-authoring-drafts-20261014" }],
      [{}, { buildId: "v1.7.4-native-cml-block-boundaries-20261017" }],
      [{}, { buildId: "v1.7.5-bound-reading-and-material-stability-20261018" }],
      [{}, { buildId: "v1.7.6-native-dwg-originals-20261018" }],
      [{}, { buildId: "unknown-build" }],
      [{}, { buildId: undefined }],
      [{}, { counts: { processed: 184, total: 185 } }],
      [{}, { counts: { processed: 186, total: 185 } }],
      [{}, { counts: { processed: 0, total: 0 } }],
      [{}, { counts: { processed: 185.5, total: 185.5 } }],
      [{}, { counts: { processed: Infinity, total: Infinity } }],
      [{}, { counts: { processed: "185", total: "185" } }],
      [{}, { counts: undefined }],
      [{}, { captureMeta: undefined }],
    ];
    for (const [captureChanges, runChanges] of variations) {
      await store.saveRun(
        completedMediaGapRun(stopped, captureChanges, runChanges),
      );
      assert.equal(
        await store.getActiveRun({ recoverMediaGaps: true }),
        null,
        "incompatible media-gap capture must not resume: " +
          JSON.stringify([captureChanges, runChanges]),
      );
    }
    await store.saveRun(completedMediaGapRun(stopped));
    const row = fake.rows("runs")[0];
    row.runId = "non-uuid-run";
    row.key = [COURSE, row.runId];
    row.captureMeta.directDataCapture.runId = row.runId;
    assert.equal(await store.getActiveRun({ recoverMediaGaps: true }), null);
    assert.equal(fake.rows("runs").length, 1);
    store.close();
  });
});

test("real checkpoint selection recovers exact publisher-era runs read-only with all 80 originals and assessment history intact", async () => {
  for (const buildId of ["v1.8.0-inline-widget-public-html-20261018", "v1.8.1-browser-publisher-api-20261018", "v1.8.2-historical-publisher-checkpoint-20261018", "v1.8.3-publisher-sections-original-images-20261018", "v1.8.4-public-publisher-images-20261019"]) {
    await withDatabase(async fake => {
      const store = await storeFor(), opened = await store.openRun(), originalObservedAt = "2026-10-18T12:00:00.000Z", originals = [];
      for (let index = 0; index < 80; index++) {
        const body = originalBody("Distinct native original " + index, "application/acad");
        const descriptor = await store.putBody(opened.runId, body.sha256, body.blob, { mime: body.blob.type, kind: "COURSERA_ASSET" });
        originals.push({ ...body, descriptor });
        const fp = source("Reading" + index);
        fp.payload.directAssetEvidence = { assets: [{ assetId: "Original" + String(index).padStart(14, "0"),
          body: { sha256: body.sha256, size: body.blob.size, mime: body.blob.type, archivePath: descriptor.archivePath,
            receipt: { observedAt: originalObservedAt, bodyFormat: "ORIGINAL_BINARY_BYTES_ARCHIVE" } } }] };
        await store.putItem(opened.runId, fp.id, fp, { processed: true });
      }
      await store.putDefinition(opened.runId, "saved-native-question@1", { id: "saved-native-question@1",
        raw: { prompt: "Original native prompt", answerEvidence: "Original native answer evidence" },
        receipt: { observedAt: originalObservedAt, originalResponseSha256: "a".repeat(64) } });
      await store.putGroup(opened.runId, "AssessmentZ", "saved-native-group", { questions: ["saved-native-question@1"],
        receipt: { observedAt: originalObservedAt } });
      const saved = completedMediaGapRun(opened, {}, { buildId,
        counts: { processed: 80, total: 80, complete: 39, questions: 7 } });
      saved.captureMeta.buildId = buildId;
      saved.budget.media = { requests: 80, bytes: originals.reduce((sum, body) => sum + body.blob.size, 0) };
      await store.saveRun(saved);
      const before = structuredClone(Object.fromEntries(["runs", "items", "groups", "definitions", "bodies"].map(name => [name, fake.rows(name)]))),
        writes = fake.metrics.writes.length, transactions = fake.metrics.transactions.length;
      assert.equal(await store.getActiveRun(), null, "Completed evidence gaps require explicit recovery opt-in");
      const selected = await store.getActiveRun({ recoverMediaGaps: true, recoverExportLimit: true });
      assert.equal(selected.runId, opened.runId, buildId + " must reach ENTRY source selection through the real store");
      assert.equal(selected.buildId, buildId); assert.deepEqual(selected.captureMeta, saved.captureMeta);
      assert.deepEqual(selected.budget, saved.budget); assert.deepEqual(selected.counts, saved.counts);
      assert.equal(fake.metrics.writes.length, writes, "Selecting a diagnostic source cannot migrate or update saved evidence");
      assert(fake.metrics.transactions.slice(transactions).every(tx => tx.mode === "readonly"));
      for (const name of Object.keys(before)) assert.deepEqual(fake.rows(name), before[name], name + " changed during selection");
      for (const original of originals) {
        const retained = await store.getBody(opened.runId, original.sha256);
        assert.deepEqual(Buffer.from(await retained.blob.arrayBuffer()), Buffer.from(await original.blob.arrayBuffer()));
        assert.equal(retained.archivePath, original.descriptor.archivePath);
      }
      assert.equal((await store.getDefinition(opened.runId, "saved-native-question@1")).value.receipt.observedAt, originalObservedAt);
      for (const [captureChanges, runChanges] of [
        [{ sourceStable: false }, {}], [{ acquisitionComplete: false }, {}], [{ wholeCourseVerified: true }, {}],
        [{ materials: { elements: [{ id: OTHER }] } }, {}], [{ runId: "99999999-9999-4999-8999-999999999999" }, {}],
        [{}, { state: "COMPLETE" }], [{}, { state: "FAILED" }], [{}, { state: "CANCELLED" }],
        [{}, { counts: { processed: 79, total: 80 } }],
      ]) {
        await store.saveRun({ ...saved, ...runChanges, captureMeta: { ...saved.captureMeta,
          directDataCapture: { ...saved.captureMeta.directDataCapture, ...captureChanges } } });
        assert.equal(await store.getActiveRun({ recoverMediaGaps: true, recoverExportLimit: true }), null, buildId + " rejected guard " + JSON.stringify([captureChanges, runChanges]));
      }
      for (const [used, limit] of [["requests", "requests"], ["bytes", "totalBytes"], ["elapsedMs", "durationMs"]]) {
        await store.saveRun({ ...saved, budget: { ...saved.budget, [used]: saved.budget.limits[limit] } });
        assert.equal(await store.getActiveRun({ recoverMediaGaps: true, recoverExportLimit: true }), null, buildId + " cannot reset " + used);
      }
      await store.saveRun(saved);
      ageRow(fake.rows("runs").find(row => row.runId === opened.runId), WEEK + 1000);
      assert.equal(await store.getActiveRun({ recoverMediaGaps: true, recoverExportLimit: true }), null, "The seven-day checkpoint limit remains unchanged");
      assert.equal(fake.rows("bodies").length, 80, "Rejected selection never prunes original bodies");
      store.close();
    });
  }
});

test("media-gap recovery excludes exhausted cumulative budgets, verified captures and terminal failures", async () => {
  await withDatabase(async () => {
    const store = await storeFor(),
      stopped = await store.openRun(),
      metadata = completedMediaGapRun(stopped);
    for (const [used, limit] of [
      ["requests", "requests"],
      ["bytes", "totalBytes"],
      ["elapsedMs", "durationMs"],
    ]) {
      for (const value of [
        0,
        -1,
        Infinity,
        NaN,
        undefined,
        metadata.budget.limits[limit],
        metadata.budget.limits[limit] + 1,
      ]) {
        await store.saveRun({
          ...metadata,
          budget: { ...metadata.budget, [used]: value },
        });
        assert.equal(
          await store.getActiveRun({ recoverMediaGaps: true }),
          null,
          used + "=" + value,
        );
      }
      for (const value of [0, -1, Infinity, NaN, undefined]) {
        await store.saveRun({
          ...metadata,
          budget: {
            ...metadata.budget,
            limits: { ...metadata.budget.limits, [limit]: value },
          },
        });
        assert.equal(
          await store.getActiveRun({ recoverMediaGaps: true }),
          null,
          limit + " limit=" + value,
        );
      }
    }
    for (const budget of [
      undefined,
      { ...metadata.budget, limits: undefined },
    ]) {
      await store.saveRun({ ...metadata, budget });
      assert.equal(await store.getActiveRun({ recoverMediaGaps: true }), null);
    }
    for (const state of ["COMPLETE", "FAILED", "CANCELLED"]) {
      await store.saveRun({ ...metadata, state });
      assert.equal(await store.getActiveRun({ recoverMediaGaps: true }), null);
    }
    await store.saveRun(
      completedMediaGapRun(stopped, { wholeCourseVerified: true }),
    );
    assert.equal(await store.getActiveRun({ recoverMediaGaps: true }), null);
    await store.saveRun(metadata);
    assert.equal(
      (await store.getActiveRun({ recoverMediaGaps: true })).runId,
      stopped.runId,
    );
    store.close();
  });
});

test("media-gap selection stays course-bound, skips unrelated newer runs and excludes expired saved work", async () => {
  await withDatabase(async (fake) => {
    const store = await storeFor(),
      other = await storeFor(OTHER),
      stopped = await store.openRun(),
      foreign = await other.openRun();
    await store.saveRun(completedMediaGapRun(stopped));
    await other.saveRun(completedMediaGapRun(foreign));
    for (let index = 0; index < 10; index++) {
      const unrelated = await store.openRun();
      await store.saveRun(
        completedMediaGapRun(unrelated, {
          stopReason: "COURSE_API_TIME_LIMIT",
        }),
      );
    }
    for (const row of fake.rows("runs"))
      ageRow(row, row.runId === stopped.runId ? 60000 : 1000);
    assert.equal(
      (await store.getActiveRun({ recoverMediaGaps: true })).runId,
      stopped.runId,
    );
    ageRow(
      fake.rows("runs").find((row) => row.runId === stopped.runId),
      WEEK + 1000,
    );
    assert.equal(await store.getActiveRun({ recoverMediaGaps: true }), null);
    assert.equal(
      (await other.getActiveRun({ recoverMediaGaps: true })).runId,
      foreign.runId,
    );
    store.close();
    other.close();
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
    const archived=originalBody("expired archive original");
    await store.putBody(expired.runId,archived.sha256,archived.blob);
    for (const name of ["runs", "definitions"])
      for (const row of fake.rows(name)) ageRow(row, WEEK + 10000);
    const fresh = await store.openRun();
    assert.equal(
      fake.rows("definitions").filter((row) => row.runId === expired.runId)
        .length + fake.rows("bodies").filter(row=>row.runId===expired.runId).length,
      9,
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
    assert.equal(fake.rows("bodies").some(row=>row.runId===expired.runId),false);
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
    await fake.waitForHeldWrite();
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
      () => store.putBody(run,"a".repeat(64),new Blob(["body"])),
      () => store.getBody(run,"a".repeat(64)),
      () => store.listBodyDescriptors(run),
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
