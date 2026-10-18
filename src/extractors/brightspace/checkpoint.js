export const BRIGHTSPACE_CHECKPOINT_DB_V110 = "cti-brightspace-source-v110";
export const BRIGHTSPACE_CHECKPOINT_MAX_BYTES_V110 = 134217728;
export const BRIGHTSPACE_CHECKPOINT_MAX_RUNS_V110 = 3;

/** Read the immediately preceding compatible schema-2 release for historical
 * download only. Never rewrite its build, dates, scope or run identity, and
 * never save new observations through the old checkpoint session. */
export async function loadBrightspacePreviousRecoveryV111(options) {
  const builds = options.buildId === "v1.2.1-course-dwg-originals-20261018"
    ? ["v1.2.0-blob-archive-20261017", "v1.1.1-native-image-view-20261017", "v1.1.0-faithful-bookmark-20261016"]
    : options.buildId === "v1.2.0-blob-archive-20261017"
    ? ["v1.1.1-native-image-view-20261017", "v1.1.0-faithful-bookmark-20261016"]
    : options.buildId === "v1.1.1-native-image-view-20261017"
      ? ["v1.1.0-faithful-bookmark-20261016"] : [];
  for (const buildId of builds) {
    const previous = createBrightspaceCheckpointV110({ ...options, buildId });
    try {
      const saved = options.finishedOnly
        ? await previous.loadLatestFinished() : await previous.load();
      if (saved) return saved;
    } finally { await previous.close(); }
  }
  return null;
}

/** Local recovery evidence only. Saved observations retain their original dates;
 * saving or loading never makes an API/body observation newly observed. */
export function createBrightspaceCheckpointV110(options) {
  options = options || {};
  const origin = String(
    options.origin || (globalThis.location && globalThis.location.origin) || "",
  );
  const courseId = String(options.courseId || ""),
    buildId = String(options.buildId || "");
  if (
    !/^https?:\/\/[^/]+$/.test(origin) ||
    (globalThis.location && origin !== globalThis.location.origin) ||
    !/^\d{1,30}$/.test(courseId) ||
    !/^[A-Za-z0-9._-]{1,160}$/.test(buildId)
  )
    throw Error(
      "A checkpoint requires the current origin, exact Brightspace course ID and build ID.",
    );
  const scopeKey = JSON.stringify([origin, courseId, buildId]);
  let runId = String(options.runId || globalThis.crypto.randomUUID());
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(runId))
    throw Error("Invalid Brightspace checkpoint run ID.");
  let key = JSON.stringify([origin, courseId, buildId, runId]);
  let startedAt = new Date().toISOString(),
    currentStatus = "",
    currentAttemptId = "";
  const idb = options.indexedDB || globalThis.indexedDB;
  let database = null,
    opening = null,
    closed = false,
    tail = Promise.resolve(),
    lastWrite = null,
    pending = 0;
  let savedAt = "",
    lastError = "",
    available = null;
  function failure(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    lastError = message;
    if (typeof options.onError === "function") {
      try {
        options.onError(error);
      } catch (_) {}
    }
    return error;
  }
  async function digest(bytes) {
    if (!globalThis.crypto || !globalThis.crypto.subtle)
      throw failure(
        "BRIGHTSPACE_CHECKPOINT_HASH_UNAVAILABLE",
        "This browser cannot verify the saved checkpoint. Keep a downloaded capture before closing the page.",
      );
    return Array.from(
      new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("");
  }
  async function fingerprint(json) {
    const hashes = [];
    let bytes = 0;
    for (let start = 0; start < json.length; ) {
      let end = Math.min(json.length, start + 1048576);
      const last = json.charCodeAt(end - 1);
      if (end < json.length && last >= 55296 && last <= 56319) end--;
      const part = new TextEncoder().encode(json.slice(start, end));
      bytes += part.byteLength;
      if (bytes > BRIGHTSPACE_CHECKPOINT_MAX_BYTES_V110)
        throw Error("Checkpoint exceeds the 128 MiB limit.");
      hashes.push(await digest(part));
      start = end;
    }
    return {
      bytes,
      sha256: await digest(new TextEncoder().encode(JSON.stringify(hashes))),
    };
  }
  function range(status) {
    const keyRange = options.IDBKeyRange || globalThis.IDBKeyRange;
    if (!keyRange) throw Error("Checkpoint key ranges are unavailable.");
    return status
      ? keyRange.bound([scopeKey, status, ""], [scopeKey, status, "\uffff"])
      : keyRange.bound([scopeKey, ""], [scopeKey, "\uffff"]);
  }
  function open() {
    if (closed)
      return Promise.reject(
        failure(
          "BRIGHTSPACE_CHECKPOINT_CLOSED",
          "This checkpoint session is closed. Click the bookmark again to recover saved progress.",
        ),
      );
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!idb || typeof idb.open !== "function") {
        available = false;
        reject(
          failure(
            "BRIGHTSPACE_CHECKPOINT_UNAVAILABLE",
            "Browser checkpoint storage is unavailable. Download the current capture before closing or reloading this page.",
          ),
        );
        return;
      }
      let settled = false,
        request;
      const timer = setTimeout(
        () =>
          fail(
            "Checkpoint storage did not open. Close other CTI capture tabs and try again.",
          ),
        5000,
      );
      function fail(message) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        available = false;
        reject(
          failure(
            "BRIGHTSPACE_CHECKPOINT_STORAGE_FAILED",
            message,
            request && request.error,
          ),
        );
      }
      try {
        request = idb.open(BRIGHTSPACE_CHECKPOINT_DB_V110, 1);
      } catch (error) {
        fail(
          "Browser checkpoint storage could not open. Download the current capture before closing this page.",
        );
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("runs")) {
          const store = db.createObjectStore("runs", { keyPath: "key" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
          store.createIndex("scopeSavedAt", ["scopeKey", "savedAt", "runId"], {
            unique: false,
          });
          store.createIndex(
            "scopeStatusSavedAt",
            ["scopeKey", "status", "savedAt", "runId"],
            { unique: false },
          );
        }
      };
      request.onerror = () =>
        fail(
          "Browser checkpoint storage could not open. Download the current capture before closing this page.",
        );
      request.onblocked = () =>
        fail(
          "Checkpoint storage is blocked by another CTI capture tab. Close that tab, then try again.",
        );
      request.onsuccess = () => {
        if (settled || closed) {
          request.result.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        database = request.result;
        available = true;
        database.onversionchange = () => {
          database.close();
          database = null;
        };
        resolve(database);
      };
    }).finally(() => {
      opening = null;
    });
    return opening;
  }
  function readLatest(db, status) {
    return new Promise((resolve, reject) => {
      let row = null,
        tx;
      try {
        tx = db.transaction("runs", "readonly");
        const request = tx
          .objectStore("runs")
          .index(status ? "scopeStatusSavedAt" : "scopeSavedAt")
          .openCursor(range(status), "prev");
        request.onsuccess = () => {
          row = request.result ? request.result.value : null;
        };
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(row);
      tx.onerror = () => reject(tx.error || Error("Checkpoint read failed."));
      tx.onabort = () =>
        reject(tx.error || Error("Checkpoint read was interrupted."));
    });
  }
  function validateState(state) {
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      (state.course && String(state.course.orgUnitId) !== courseId)
    )
      throw Error("Checkpoint course identity differs.");
    if (Object.prototype.hasOwnProperty.call(state, "capture")) {
      const capture = state.capture;
      if (
        !capture ||
        typeof capture !== "object" ||
        Array.isArray(capture) ||
        !capture.course ||
        String(capture.course.orgUnitId) !== courseId ||
        capture.buildId !== buildId ||
        !capture.page ||
        capture.page.origin !== origin
      )
        throw Error(
          "Checkpoint capture course, build or origin identity differs.",
        );
    }
  }
  async function load(status) {
    try {
      const row = await readLatest(await open(), status);
      if (!row) return null;
      if (
        row.schemaVersion !== 1 ||
        row.scopeKey !== scopeKey ||
        row.origin !== origin ||
        row.courseId !== courseId ||
        row.buildId !== buildId ||
        !/^[A-Za-z0-9._-]{1,160}$/.test(row.runId) ||
        row.key !== JSON.stringify([origin, courseId, buildId, row.runId]) ||
        !["PARTIAL", "PAUSED", "FINISHED"].includes(row.status) ||
        !Number.isFinite(Date.parse(row.savedAt)) ||
        typeof row.json !== "string" ||
        row.json.length > BRIGHTSPACE_CHECKPOINT_MAX_BYTES_V110
      )
        throw Error("Checkpoint identity or format changed.");
      const proof = await fingerprint(row.json);
      if (
        row.fingerprintAlgorithm !== "SHA256_CHUNKS_V1" ||
        proof.bytes !== row.bytes ||
        proof.sha256 !== row.payloadFingerprint
      )
        throw Error("Checkpoint body identity changed.");
      const state = JSON.parse(row.json);
      validateState(state);
      if (!savedAt || row.savedAt > savedAt) savedAt = row.savedAt;
      return {
        runId: row.runId,
        status: row.status,
        savedAt: row.savedAt,
        startedAt: row.startedAt,
        state,
      };
    } catch (error) {
      if (error.code && /^BRIGHTSPACE_CHECKPOINT_/.test(error.code))
        throw error;
      throw failure(
        "BRIGHTSPACE_CHECKPOINT_READ_FAILED",
        "Saved Brightspace progress could not be verified. It was not reused as current evidence. Keep any downloaded capture.",
        error,
      );
    }
  }
  function save(state, settings) {
    settings = settings || {};
    const status = settings.status || "PARTIAL";
    if (closed)
      return Promise.reject(
        failure(
          "BRIGHTSPACE_CHECKPOINT_CLOSED",
          "This checkpoint session is closed.",
        ),
      );
    if (!["PARTIAL", "PAUSED", "FINISHED"].includes(status))
      return Promise.reject(
        failure(
          "BRIGHTSPACE_CHECKPOINT_INVALID",
          "Choose an explicit partial, paused or finished checkpoint state.",
        ),
      );
    if (pending >= 2)
      return Promise.reject(
        failure(
          "BRIGHTSPACE_CHECKPOINT_BUSY",
          "Checkpoint storage is still saving earlier work. Pause capture until its pending save completes.",
        ),
      );
    try {
      validateState(state);
    } catch (error) {
      return Promise.reject(
        failure(
          "BRIGHTSPACE_CHECKPOINT_IDENTITY",
          "This checkpoint does not match the current Brightspace course, build and origin. It was not saved or reused as course evidence.",
          error,
        ),
      );
    }
    const attemptId =
      state.capture &&
      state.capture.attempt &&
      typeof state.capture.attempt.id === "string"
        ? state.capture.attempt.id
        : "";
    let json;
    try {
      let estimate = 0;
      json = JSON.stringify(state, (name, value) => {
        estimate +=
          name.length + (typeof value === "string" ? value.length : 4);
        if (estimate > BRIGHTSPACE_CHECKPOINT_MAX_BYTES_V110)
          throw Error("Checkpoint exceeds the 128 MiB limit.");
        return value;
      });
      if (json.length > BRIGHTSPACE_CHECKPOINT_MAX_BYTES_V110)
        throw Error("Checkpoint exceeds the 128 MiB limit.");
    } catch (error) {
      return Promise.reject(
        failure(
          "BRIGHTSPACE_CHECKPOINT_LIMIT",
          "This checkpoint cannot be retained within the 128 MiB evidence limit. Download the in-memory capture before closing this page.",
          error,
        ),
      );
    }
    pending++;
    const job = tail
      .then(async () => {
        if (
          ["FINISHED", "PAUSED"].includes(currentStatus) &&
          (status === "PARTIAL" ||
            (attemptId && attemptId !== currentAttemptId))
        ) {
          runId = globalThis.crypto.randomUUID();
          key = JSON.stringify([origin, courseId, buildId, runId]);
          startedAt = new Date().toISOString();
        }
        let proof;
        try {
          proof = await fingerprint(json);
        } catch (error) {
          if (error.code) throw error;
          throw failure(
            "BRIGHTSPACE_CHECKPOINT_LIMIT",
            "This checkpoint cannot be retained within the 128 MiB evidence limit. Download the in-memory capture before closing this page.",
            error,
          );
        }
        const db = await open();
        const now = new Date().toISOString();
        const row = {
          schemaVersion: 1,
          key,
          scopeKey,
          origin,
          courseId,
          buildId,
          runId,
          startedAt,
          savedAt: now,
          status,
          bytes: proof.bytes,
          payloadFingerprint: proof.sha256,
          fingerprintAlgorithm: "SHA256_CHUNKS_V1",
          json,
        };
        await new Promise((resolve, reject) => {
          let tx;
          try {
            tx = db.transaction("runs", "readwrite");
            const store = tx.objectStore("runs"),
              latest = store
                .index("scopeSavedAt")
                .openKeyCursor(range(), "prev");
            latest.onsuccess = () => {
              // A monotonic local storage timestamp orders same-millisecond
              // writes. Native observation timestamps inside json are untouched.
              const previousTime = latest.result
                ? Date.parse(latest.result.key[1])
                : 0;
              row.savedAt = new Date(
                Math.max(Date.now(), previousTime + 1),
              ).toISOString();
              const finishedRequest = store
                .index("scopeStatusSavedAt")
                .openKeyCursor(range("FINISHED"), "prev");
              finishedRequest.onsuccess = () => {
                const preserved =
                  status === "FINISHED"
                    ? row.key
                    : finishedRequest.result &&
                      finishedRequest.result.primaryKey;
                store.put(row);
                const request = store
                  .index("scopeSavedAt")
                  .openKeyCursor(range(), "prev");
                let retained = 0;
                request.onsuccess = () => {
                  const cursor = request.result;
                  if (!cursor) return;
                  if (cursor.primaryKey !== preserved) {
                    retained++;
                    if (
                      retained >
                      BRIGHTSPACE_CHECKPOINT_MAX_RUNS_V110 - (preserved ? 1 : 0)
                    )
                      store.delete(cursor.primaryKey);
                  }
                  cursor.continue();
                };
              };
            };
          } catch (error) {
            reject(error);
            return;
          }
          tx.oncomplete = resolve;
          tx.onerror = () =>
            reject(tx.error || Error("Checkpoint save failed."));
          tx.onabort = () =>
            reject(tx.error || Error("Checkpoint save was interrupted."));
        });
        savedAt = row.savedAt;
        currentStatus = status;
        currentAttemptId = attemptId;
        lastError = "";
        return {
          runId,
          status,
          savedAt: row.savedAt,
          bytes: row.bytes,
          payloadFingerprint: row.payloadFingerprint,
          fingerprintAlgorithm: row.fingerprintAlgorithm,
        };
      })
      .catch((error) => {
        if (error.code && /^BRIGHTSPACE_CHECKPOINT_/.test(error.code))
          throw error;
        throw failure(
          "BRIGHTSPACE_CHECKPOINT_WRITE_FAILED",
          "Browser checkpoint storage could not save this attempt, possibly because storage is full. Earlier saved progress remains retained. Download the in-memory capture before closing this page.",
          error,
        );
      })
      .finally(() => {
        pending--;
      });
    tail = job.catch(() => {});
    lastWrite = job;
    return job;
  }
  return {
    load() {
      return load();
    },
    loadLatestFinished() {
      return load("FINISHED");
    },
    save,
    flush() {
      return lastWrite || tail;
    },
    async close() {
      await tail;
      closed = true;
      if (database) database.close();
      database = null;
    },
    snapshot() {
      return {
        origin,
        courseId,
        buildId,
        runId,
        available,
        pending,
        savedAt,
        lastError,
        maxBytes: BRIGHTSPACE_CHECKPOINT_MAX_BYTES_V110,
        maxRuns: BRIGHTSPACE_CHECKPOINT_MAX_RUNS_V110,
        fingerprintAlgorithm: "SHA256_CHUNKS_V1",
      };
    },
  };
}
