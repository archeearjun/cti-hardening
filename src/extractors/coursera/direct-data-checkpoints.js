export async function createDirectDataCheckpointStoreV1(courseId) {
  const databaseName = "cti-coursera-direct-data-v1";
  const ttlMs = 7 * 24 * 60 * 60 * 1000;
  const names = ["runs", "items", "groups", "definitions"];
  let database = null;
  let closed = false;
  const store = { available: false, error: "" };

  function failure(error) {
    return String(
      error?.message || error || "Direct-data checkpoint storage failed.",
    );
  }
  function validCourse(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
  }
  function runId(value) {
    if (
      typeof value !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        value,
      )
    )
      throw Error("Invalid direct-data checkpoint run identifier.");
    return value.toLowerCase();
  }
  function identity(value, kind) {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 1024 ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw Error("Invalid direct-data checkpoint " + kind + " identifier.");
    return value;
  }
  function metadata(value) {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value))
      throw Error("Invalid direct-data run metadata.");
    if (value.courseId !== undefined && value.courseId !== courseId)
      throw Error("Direct-data checkpoints belong to a different course.");
    return value;
  }
  function state(value, fallback = "RUNNING") {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value))
      throw Error("Invalid direct-data run state.");
    return value;
  }
  function ensureAvailable() {
    if (!database || closed)
      throw Error(
        store.error || "Direct-data checkpoint storage is unavailable.",
      );
  }
  function sameRun(row, id) {
    return Boolean(
      row &&
        row.schemaVersion === 1 &&
        row.courseId === courseId &&
        row.runId === id &&
        Array.isArray(row.key) &&
        row.key.length === 2 &&
        row.key[0] === courseId &&
        row.key[1] === id &&
        Number.isFinite(row.createdAt) &&
        Number.isFinite(row.updatedAt),
    );
  }
  function transact(storeNames, mode, work) {
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let rejected = false;
      function rejectTransaction(error) {
        if (rejected) return;
        rejected = true;
        store.error = failure(error);
        try {
          transaction?.abort();
        } catch (_) {}
        reject(Error(store.error));
      }
      function guard(operation) {
        try {
          operation();
        } catch (error) {
          rejectTransaction(error);
        }
      }
      try {
        ensureAvailable();
        transaction = database.transaction(storeNames, mode);
        transaction.oncomplete = () => {
          if (!rejected) resolve(result);
        };
        transaction.onerror = () =>
          rejectTransaction(
            transaction.error ||
              Error("Direct-data checkpoint transaction failed."),
          );
        transaction.onabort = () =>
          rejectTransaction(
            transaction.error ||
              Error("Direct-data checkpoint transaction was aborted."),
          );
        guard(() =>
          work(
            transaction,
            (value) => {
              result = value;
            },
            guard,
            rejectTransaction,
          ),
        );
      } catch (error) {
        rejectTransaction(error);
      }
    });
  }
  async function read(name, key) {
    return transact(name, "readonly", (transaction, set, guard) => {
      const request = transaction.objectStore(name).get(key);
      request.onsuccess = () => guard(() => set(request.result || null));
    });
  }
  function rowBound(row, id, parts) {
    if (
      !row ||
      row.schemaVersion !== 1 ||
      row.courseId !== courseId ||
      row.runId !== id ||
      !Array.isArray(row.key) ||
      row.key.length !== parts.length + 2 ||
      row.key[0] !== courseId ||
      row.key[1] !== id
    )
      return false;
    return parts.every((part, index) => row.key[index + 2] === part);
  }
  async function put(name, id, parts, valueFields) {
    id = runId(id);
    return transact(["runs", name], "readwrite", (transaction, set, guard) => {
      const runs = transaction.objectStore("runs"),
        rows = transaction.objectStore(name);
      const request = runs.get([courseId, id]);
      request.onsuccess = () =>
        guard(() => {
          const run = request.result;
          if (!sameRun(run, id))
            throw Error(
              "Direct-data checkpoint run was not found for this course.",
            );
          const key = [courseId, id, ...parts],
            existing = rows.get(key);
          existing.onsuccess = () =>
            guard(() => {
              const now = Date.now(),
                old = existing.result;
              if (old && !rowBound(old, id, parts))
                throw Error(
                  "Direct-data checkpoint identity does not match its storage key.",
                );
              rows.put({
                schemaVersion: 1,
                key,
                runKey: [courseId, id],
                courseId,
                runId: id,
                createdAt: old?.createdAt ?? now,
                updatedAt: now,
                ...valueFields,
              });
              runs.put({ ...run, updatedAt: now });
              set(true);
            });
        });
    });
  }
  async function list(name, id, parts = []) {
    id = runId(id);
    return transact(["runs", name], "readonly", (transaction, set, guard) => {
      const request = transaction.objectStore("runs").get([courseId, id]);
      request.onsuccess = () =>
        guard(() => {
          if (!sameRun(request.result, id))
            throw Error(
              "Direct-data checkpoint run was not found for this course.",
            );
          const index = transaction
            .objectStore(name)
            .index(parts.length ? "itemKey" : "runKey");
          const rows = index.getAll([courseId, id, ...parts]);
          rows.onsuccess = () =>
            guard(() => {
              const values = (rows.result || []).filter(
                (row) =>
                  rowBound(
                    row,
                    id,
                    name === "items" ? [row.itemId] : [row.itemId, row.groupId],
                  ) &&
                  (!parts.length || row.itemId === parts[0]),
              );
              values.sort((a, b) =>
                String(name === "items" ? a.itemId : a.groupId).localeCompare(
                  String(name === "items" ? b.itemId : b.groupId),
                ),
              );
              set(values);
            });
        });
    });
  }
  async function prune(protectedId) {
    const cutoff = Date.now() - ttlMs;
    const candidates = await transact(
      "runs",
      "readonly",
      (transaction, set, guard) => {
        const expired = [],
          index = transaction.objectStore("runs").index("courseUpdatedAt");
        const request = index.openCursor(
          IDBKeyRange.bound([courseId, 0], [courseId, cutoff], false, true),
        );
        request.onsuccess = () =>
          guard(() => {
            const cursor = request.result;
            if (!cursor) {
              set(expired);
              return;
            }
            const row = cursor.value;
            if (
              row.runId !== protectedId &&
              sameRun(row, row.runId) &&
              row.updatedAt < cutoff
            )
              expired.push(row.runId);
            if (expired.length >= 8) {
              set(expired);
              return;
            }
            cursor.continue();
          });
      },
    );
    let remaining = 512;
    for (const id of candidates) {
      if (remaining <= 0) break;
      await transact(names, "readwrite", (transaction, set, guard) => {
        const runs = transaction.objectStore("runs"),
          request = runs.get([courseId, id]);
        request.onsuccess = () =>
          guard(() => {
            const run = request.result;
            if (
              id === protectedId ||
              !sameRun(run, id) ||
              run.updatedAt >= cutoff
            ) {
              set(false);
              return;
            }
            let pending = 3;
            function scanned() {
              pending--;
              if (pending) return;
              let countsPending = 3,
                total = 0;
              for (const name of ["items", "groups", "definitions"]) {
                const count = transaction
                  .objectStore(name)
                  .index("runKey")
                  .count([courseId, id]);
                count.onsuccess = () =>
                  guard(() => {
                    total += Number(count.result || 0);
                    if (--countsPending === 0) {
                      if (total === 0) runs.delete([courseId, id]);
                      set(true);
                    }
                  });
              }
            }
            for (const name of ["items", "groups", "definitions"]) {
              const rows = transaction.objectStore(name),
                cursorRequest = rows
                  .index("runKey")
                  .openKeyCursor(IDBKeyRange.only([courseId, id]));
              cursorRequest.onsuccess = () =>
                guard(() => {
                  const cursor = cursorRequest.result;
                  if (!cursor || remaining <= 0) {
                    scanned();
                    return;
                  }
                  const key = cursor.primaryKey;
                  if (
                    Array.isArray(key) &&
                    key[0] === courseId &&
                    key[1] === id
                  ) {
                    rows.delete(key);
                    remaining--;
                  }
                  cursor.continue();
                });
            }
          });
      });
    }
  }

  try {
    if (!validCourse(courseId))
      throw Error("Invalid course identifier for direct-data checkpoints.");
    if (typeof indexedDB === "undefined")
      throw Error("IndexedDB is unavailable for direct-data checkpoints.");
    database = await new Promise((resolve, reject) => {
      let request;
      let settled = false;
      let blocked = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          request?.transaction?.abort();
        } catch (_) {}
        reject(
          Error(
            blocked
              ? "Direct-data checkpoint database is blocked by another open tab."
              : "Opening direct-data checkpoint storage timed out.",
          ),
        );
      }, 5000);
      function fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
      try {
        request = indexedDB.open(databaseName, 1);
        request.onblocked = () => {
          blocked = true;
        };
        request.onupgradeneeded = () => {
          if (settled) {
            try {
              request.transaction.abort();
            } catch (_) {}
            return;
          }
          try {
            const db = request.result;
            for (const name of names) {
              const rows = db.objectStoreNames.contains(name)
                ? request.transaction.objectStore(name)
                : db.createObjectStore(name, { keyPath: "key" });
              if (name === "runs") {
                if (!rows.indexNames.contains("courseUpdatedAt"))
                  rows.createIndex("courseUpdatedAt", [
                    "courseId",
                    "updatedAt",
                  ]);
                if (!rows.indexNames.contains("courseStateUpdatedAt"))
                  rows.createIndex("courseStateUpdatedAt", [
                    "courseId",
                    "state",
                    "updatedAt",
                  ]);
              } else {
                if (!rows.indexNames.contains("runKey"))
                  rows.createIndex("runKey", "runKey");
                if (name === "groups" && !rows.indexNames.contains("itemKey"))
                  rows.createIndex("itemKey", ["courseId", "runId", "itemId"]);
              }
            }
          } catch (error) {
            try {
              request.transaction.abort();
            } catch (_) {}
            fail(error);
          }
        };
        request.onerror = () =>
          fail(
            request.error || Error("Opening direct-data checkpoints failed."),
          );
        request.onsuccess = () => {
          if (settled) {
            request.result.close();
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(request.result);
        };
      } catch (error) {
        fail(error);
      }
    });
    database.onversionchange = () => {
      database.close();
      closed = true;
      store.available = false;
      store.error =
        "Direct-data checkpoint storage changed in another tab. Reopen capture to continue.";
    };
    store.available = true;
  } catch (error) {
    store.error = failure(error);
  }

  store.openRun = async (requestedId, runMetadata) => {
    ensureAvailable();
    const supplied = metadata(runMetadata);
    const id =
      requestedId === undefined || requestedId === null || requestedId === ""
        ? globalThis.crypto.randomUUID()
        : runId(requestedId);
    if (supplied.runId !== undefined && runId(supplied.runId) !== id)
      throw Error("Direct-data run metadata identifies a different run.");
    const result = await transact(
      "runs",
      "readwrite",
      (transaction, set, guard) => {
        const runs = transaction.objectStore("runs"),
          request = runs.get([courseId, id]);
        request.onsuccess = () =>
          guard(() => {
            const old = request.result;
            if (requestedId && !sameRun(old, id))
              throw Error(
                "Direct-data checkpoint run was not found for this course.",
              );
            if (old && !sameRun(old, id))
              throw Error("Direct-data checkpoint run identity is invalid.");
            const now = Date.now(),
              next = {
                ...old,
                ...supplied,
                schemaVersion: 1,
                key: [courseId, id],
                courseId,
                runId: id,
                createdAt: old?.createdAt ?? now,
                updatedAt: now,
                state: state(supplied.state, old?.state || "RUNNING"),
              };
            runs.put(next);
            set(next);
          });
      },
    );
    try {
      await prune(id);
    } catch (error) {
      store.error =
        "Older direct-data checkpoints could not be pruned: " + failure(error);
    }
    return result;
  };
  function recoverableExportRun(row) {
    const capture = row.captureMeta?.directDataCapture,
      budget = row.budget;
    if (
      !capture ||
      capture.mode !== "BOUND_AUTHORING_DRAFT_API" ||
      capture.version !== 1 ||
      capture.runId !== row.runId ||
      capture.materials?.elements?.[0]?.id !== courseId ||
      !budget ||
      !budget.limits ||
      [
        ["requests", "requests"],
        ["bytes", "totalBytes"],
        ["elapsedMs", "durationMs"],
      ].some(
        ([used, limit]) =>
          !Number.isFinite(budget[used]) ||
          budget[used] <= 0 ||
          !Number.isFinite(budget.limits[limit]) ||
          budget.limits[limit] <= budget[used],
      )
    )
      return false;
    if (capture.stopReason === "DIRECT_CAPTURE_EXPORT_BYTE_LIMIT") return true;
    // The first released bookmark saved its terminal state before the exporter
    // assigned stopReason. This exact unfinished legacy shape is recoverable;
    // completed captures and consumed request/byte/time budgets are not.
    return Boolean(
      row.buildId === "v1.0.0-bound-authoring-drafts-20261014" &&
        !capture.stopReason &&
        capture.sourceStable === false &&
        !capture.finalMaterials &&
        capture.acquisitionComplete !== true &&
        capture.wholeCourseVerified !== true &&
        Number.isInteger(row.counts?.processed) &&
        row.counts.processed > 0 &&
        Number.isInteger(row.counts?.total) &&
        row.counts.processed < row.counts.total,
    );
  }
  function recoverableMediaRun(row) {
    const capture = row.captureMeta?.directDataCapture,
      budget = row.budget;
    try {
      if (runId(row.runId) !== row.runId) return false;
    } catch (_) {
      return false;
    }
    return Boolean(
      (row.buildId === "v1.1.0-compressed-resumable-drafts-20261014" ||
        row.buildId === "v1.2.0-bound-reading-media-20261014") &&
        capture &&
        capture.mode === "BOUND_AUTHORING_DRAFT_API" &&
        capture.version === 1 &&
        capture.runId === row.runId &&
        capture.materials?.elements?.[0]?.id === courseId &&
        capture.sourceStable === true &&
        capture.acquisitionComplete === true &&
        capture.wholeCourseVerified === false &&
        capture.stopReason === "ACQUISITION_COMPLETE_WITH_EVIDENCE_GAPS" &&
        Number.isInteger(row.counts?.processed) &&
        row.counts.processed > 0 &&
        Number.isInteger(row.counts?.total) &&
        row.counts.processed === row.counts.total &&
        budget &&
        budget.limits &&
        [
          ["requests", "requests"],
          ["bytes", "totalBytes"],
          ["elapsedMs", "durationMs"],
        ].every(
          ([used, limit]) =>
            Number.isFinite(budget[used]) &&
            budget[used] > 0 &&
            Number.isFinite(budget.limits[limit]) &&
            budget.limits[limit] > budget[used],
        ),
    );
  }
  store.getActiveRun = async (options = {}) => {
    const cutoff = Date.now() - ttlMs;
    return transact("runs", "readonly", (transaction, set, guard) => {
      const index = transaction
        .objectStore("runs")
        .index("courseStateUpdatedAt");
      const activeStates =
        options.recoverExportLimit === true || options.recoverMediaGaps === true
          ? ["RUNNING", "PAUSED", "INCOMPLETE"]
          : ["RUNNING", "PAUSED"];
      let pending = activeStates.length,
        newest = null;
      for (const activeState of activeStates) {
        const request = index.openCursor(
          IDBKeyRange.bound(
            [courseId, activeState, cutoff],
            [courseId, activeState, Number.MAX_SAFE_INTEGER],
          ),
          "prev",
        );
        request.onsuccess = () =>
          guard(() => {
            const cursor = request.result,
              row = cursor?.value;
            if (
              cursor &&
              (!sameRun(row, row.runId) ||
                row.state !== activeState ||
                (activeState === "INCOMPLETE" &&
                  !(
                    (options.recoverExportLimit === true &&
                      recoverableExportRun(row)) ||
                    (options.recoverMediaGaps === true &&
                      recoverableMediaRun(row))
                  )))
            ) {
              cursor.continue();
              return;
            }
            if (row && (!newest || row.updatedAt > newest.updatedAt))
              newest = row;
            if (--pending === 0) set(newest);
          });
      }
    });
  };
  store.saveRun = async (value) => {
    const supplied = metadata(value),
      id = runId(supplied.runId);
    return transact("runs", "readwrite", (transaction, set, guard) => {
      const runs = transaction.objectStore("runs"),
        request = runs.get([courseId, id]);
      request.onsuccess = () =>
        guard(() => {
          const old = request.result;
          if (!sameRun(old, id))
            throw Error(
              "Direct-data checkpoint run was not found for this course.",
            );
          const next = {
            ...old,
            ...supplied,
            schemaVersion: 1,
            key: [courseId, id],
            courseId,
            runId: id,
            createdAt: old.createdAt,
            updatedAt: Date.now(),
            state: state(supplied.state, old.state),
          };
          runs.put(next);
          set(next);
        });
    });
  };
  store.putItem = (id, itemId, fingerprint, itemState) => {
    itemId = identity(itemId, "item");
    if (
      !fingerprint ||
      typeof fingerprint !== "object" ||
      Array.isArray(fingerprint) ||
      fingerprint.id !== itemId
    )
      return Promise.reject(
        Error("Direct-data fingerprint does not match its item identifier."),
      );
    return put("items", id, [itemId], {
      itemId,
      fingerprint,
      state: itemState,
    });
  };
  store.getItem = async (id, itemId) => {
    id = runId(id);
    itemId = identity(itemId, "item");
    const row = await read("items", [courseId, id, itemId]);
    return rowBound(row, id, [itemId]) && row.itemId === itemId ? row : null;
  };
  store.listItems = (id) => list("items", id);
  store.putGroup = (id, itemId, groupId, value) => {
    itemId = identity(itemId, "item");
    groupId = identity(groupId, "group");
    return put("groups", id, [itemId, groupId], {
      itemKey: [courseId, runId(id), itemId],
      itemId,
      groupId,
      value,
    });
  };
  store.getGroup = async (id, itemId, groupId) => {
    id = runId(id);
    itemId = identity(itemId, "item");
    groupId = identity(groupId, "group");
    const row = await read("groups", [courseId, id, itemId, groupId]);
    return rowBound(row, id, [itemId, groupId]) &&
      row.itemId === itemId &&
      row.groupId === groupId
      ? row
      : null;
  };
  store.listGroups = (id, itemId) =>
    list("groups", id, [identity(itemId, "item")]);
  store.putDefinition = (id, definitionId, value) => {
    definitionId = identity(definitionId, "definition");
    return put("definitions", id, [definitionId], { definitionId, value });
  };
  store.getDefinition = async (id, definitionId) => {
    id = runId(id);
    definitionId = identity(definitionId, "definition");
    const row = await read("definitions", [courseId, id, definitionId]);
    return rowBound(row, id, [definitionId]) &&
      row.definitionId === definitionId
      ? row
      : null;
  };
  store.close = () => {
    closed = true;
    store.available = false;
    if (database) database.close();
  };
  return store;
}
