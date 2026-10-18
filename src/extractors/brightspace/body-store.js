export const BRIGHTSPACE_BODY_DB_V120 = "cti-brightspace-originals-v120";

/** Original bytes stay as immutable Blobs outside the JSON checkpoint. A native
 * receipt is published only after the corresponding IDB write commits. Scope
 * includes the exact course, origin, build and attempt, never a title. */
export function createBrightspaceBodyStoreV120(options = {}) {
  const origin = String(options.origin || ""),
    courseId = String(options.courseId || ""),
    buildId = String(options.buildId || ""),
    runId = String(options.runId || "");
  if (!/^https?:\/\/[^/]+$/.test(origin) ||
      (globalThis.location && origin !== globalThis.location.origin) ||
      !/^\d{1,30}$/.test(courseId) ||
      !/^[A-Za-z0-9._-]{1,160}$/.test(buildId) ||
      !/^[A-Za-z0-9._-]{1,160}$/.test(runId))
    throw Error("BRIGHTSPACE_BODY_SCOPE_INVALID");
  const scope = JSON.stringify([origin, courseId, buildId, runId]),
    idb = options.indexedDB || globalThis.indexedDB;
  let database = null, opening = null, closed = false;
  function fail(code, cause) {
    const error = Error(code);
    error.code = code;
    if (cause) error.cause = cause;
    options.onError?.(error);
    return error;
  }
  function descriptor(sha256, bytes) {
    if (!/^[a-f0-9]{64}$/.test(sha256) ||
        !Number.isSafeInteger(bytes) || bytes < 0 || bytes > 64 * 1024 * 1024)
      throw fail("BRIGHTSPACE_BODY_IDENTITY_INVALID");
    return { encoding: "archive", archivePath: "files/" + sha256, bytes, sha256 };
  }
  async function digest(bytes) {
    const value = options.sha256 ? await options.sha256(bytes) :
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!/^[a-f0-9]{64}$/.test(value)) throw fail("BRIGHTSPACE_BODY_HASH_UNAVAILABLE");
    return value;
  }
  function open() {
    if (closed) return Promise.reject(fail("BRIGHTSPACE_BODY_STORE_CLOSED"));
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!idb || typeof idb.open !== "function") {
        reject(fail("BRIGHTSPACE_BODY_STORAGE_UNAVAILABLE")); return;
      }
      let request, settled = false;
      const timer = setTimeout(() => rejectOpen("BRIGHTSPACE_BODY_STORAGE_TIMEOUT"), 5000);
      function rejectOpen(code) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(fail(code, request?.error));
      }
      try { request = idb.open(BRIGHTSPACE_BODY_DB_V120, 1); }
      catch (error) { rejectOpen("BRIGHTSPACE_BODY_STORAGE_FAILED"); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("bodies"))
          db.createObjectStore("bodies", { keyPath: "key" });
      };
      request.onblocked = () => rejectOpen("BRIGHTSPACE_BODY_STORAGE_BLOCKED");
      request.onerror = () => rejectOpen("BRIGHTSPACE_BODY_STORAGE_FAILED");
      request.onsuccess = () => {
        if (settled || closed) { request.result.close(); return; }
        settled = true; clearTimeout(timer); database = request.result;
        database.onversionchange = () => { database.close(); database = null; };
        resolve(database);
      };
    }).finally(() => { opening = null; });
    return opening;
  }
  async function rowFor(sha256) {
    descriptor(sha256, 0);
    const db = await open();
    return new Promise((resolve, reject) => {
      let row = null, tx;
      try {
        tx = db.transaction("bodies", "readonly");
        const request = tx.objectStore("bodies").get(JSON.stringify([scope, sha256]));
        request.onsuccess = () => { row = request.result || null; };
      } catch (error) { reject(fail("BRIGHTSPACE_BODY_READ_FAILED", error)); return; }
      tx.oncomplete = () => resolve(row);
      tx.onerror = tx.onabort = () => reject(fail("BRIGHTSPACE_BODY_READ_FAILED", tx.error));
    });
  }
  async function get(body) {
    const exact = descriptor(body?.sha256, body?.bytes);
    if (body.encoding !== exact.encoding || body.archivePath !== exact.archivePath)
      throw fail("BRIGHTSPACE_BODY_IDENTITY_INVALID");
    const row = await rowFor(exact.sha256);
    if (!row || row.scope !== scope || row.sha256 !== exact.sha256 ||
        row.bytes !== exact.bytes || !(row.blob instanceof Blob) || row.blob.size !== exact.bytes)
      throw fail("BRIGHTSPACE_BODY_MISSING_OR_CHANGED");
    if (await digest(new Uint8Array(await row.blob.arrayBuffer())) !== exact.sha256)
      throw fail("BRIGHTSPACE_BODY_MISSING_OR_CHANGED");
    return row.blob;
  }
  async function put(bytes, sha256) {
    if (!(bytes instanceof Uint8Array)) throw fail("BRIGHTSPACE_BODY_IDENTITY_INVALID");
    // Snapshot before the first await: a caller may reuse or mutate its network
    // buffer while hashing or the IDB read is pending. Hash and persist the same
    // owned bytes, never a later view of that caller-owned buffer.
    const body = descriptor(sha256, bytes.byteLength),
      owned = Uint8Array.from(bytes), blob = new Blob([owned]);
    if (await digest(owned) !== sha256) throw fail("BRIGHTSPACE_BODY_HASH_MISMATCH");
    const prior = await rowFor(sha256);
    if (prior) { await get(body); return body; }
    const db = await open();
    await new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction("bodies", "readwrite");
        tx.objectStore("bodies").add({ key: JSON.stringify([scope, sha256]),
          scope, sha256, bytes: owned.byteLength, blob });
      } catch (error) { reject(fail("BRIGHTSPACE_BODY_WRITE_FAILED", error)); return; }
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(fail("BRIGHTSPACE_BODY_WRITE_FAILED", tx.error));
    });
    return body;
  }
  return { put, get, open, close() { closed = true; database?.close(); database = null; },
    scope: { origin, courseId, buildId, runId } };
}
