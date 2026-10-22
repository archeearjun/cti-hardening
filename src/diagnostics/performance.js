/** Local, content-free instrumentation. Fixed vocabulary prevents accidental body,
 * URL, token or exception-message export. No evidence objects enter this module. */
export function createPerformanceTrace(options = {}) {
  const PERFORMANCE_STAGES = [
    "evidence_export",
    "first_report",
    "qti_parse",
    "matching",
    "item_parity",
    "session",
    "scan",
    "package_hash",
    "archive_index",
    "archive_read",
    "manifest_parse",
    "content_inventory",
    "structure_analysis",
    "comparison",
    "input_validation",
    "normalization",
    "reconciliation",
    "assessment",
    "owner_report",
    "evidence_load",
    "transfer_request",
    "batch_validate",
    "backoff",
    "source_recovery",
    "binary_verify",
    "receipt_validation",
    "focused_check",
    "source_capture",
    "destination_capture",
    "inventory",
    "item",
    "question",
    "request",
    "checkpoint",
    "browser_wait",
    "render",
  ];
  const PERFORMANCE_COUNTS = [
    "batch_requests",
    "chunks_acquired",
    "download_bytes",
    "reused_chunks",
    "batches_1", "batches_2", "batches_3", "batches_4", "batches_5", "batches_6", "batches_7", "batches_8",
    "requests",
    "failed",
    "authentication_failed",
    "rate_limited",
    "unavailable",
    "retries",
    "bytes",
    "files",
    "cache_hits",
    "repeated_reads",
    "items_expected",
    "items_verified",
    "items_observed",
    "questions_observed",
    "unresolved",
    "unsupported",
    "operator_actions",
  ];

  const enabled = options.enabled === true;
  const clock = options.clock || (() => performance.now());
  const start = enabled ? clock() : 0;
  const startedAt = enabled ? new Date().toISOString() : null;
  const spans = [],
    open = new Map(),
    counts = {},
    seen = new Set();
  let serial = 0,
    finished = null,
    dropped = 0,
    status = "partial";
  const runId = enabled
    ? options.runId || globalThis.crypto?.randomUUID?.() || String(Date.now())
    : "";
  function count(name, value = 1) {
    if (
      !enabled ||
      !PERFORMANCE_COUNTS.includes(name) ||
      !Number.isFinite(value) ||
      value < 0
    )
      return;
    counts[name] = (counts[name] || 0) + value;
  }
  function begin(stage, item = null) {
    if (!enabled || finished !== null || !PERFORMANCE_STAGES.includes(stage))
      return () => {};
    if (spans.length + open.size >= 4000) {
      dropped++;
      return () => {};
    }
    const id = ++serial;
    const span = {
      stage,
      startMs: Math.max(0, clock() - start),
      item: Number.isSafeInteger(item) && item >= 0 ? item : null,
    };
    open.set(id, span);
    return (outcome = "observed") => {
      if (!open.has(id)) return;
      open.delete(id);
      spans.push({
        ...span,
        endMs: Math.max(span.startMs, clock() - start),
        outcome: ["observed", "failed", "partial", "reused"].includes(outcome)
          ? outcome
          : "observed",
      });
    };
  }
  function repeated(key) {
    if (!enabled || typeof key !== "string") return;
    // Keys stay in memory and never enter snapshots. Repeated is not necessarily unnecessary.
    if (seen.has(key)) count("repeated_reads");
    else if (seen.size < 4000) seen.add(key);
  }
  function snapshot() {
    if (!enabled) return null;
    const end = finished === null ? clock() : finished;
    const duration = Math.max(0, end - start);
    const records = spans.concat(
      [...open.values()].map((s) => ({
        ...s,
        endMs: duration,
        outcome: "partial",
      })),
    );
    const stages = PERFORMANCE_STAGES.map((stage) => {
      const rows = records
        .filter((s) => s.stage === stage)
        .sort((a, b) => a.startMs - b.startMs);
      let union = 0,
        until = 0;
      for (const row of rows) {
        union += Math.max(0, row.endMs - Math.max(until, row.startMs));
        until = Math.max(until, row.endMs);
      }
      return {
        stage,
        calls: rows.length,
        activeWallMs: union,
        summedSpanMs: rows.reduce((n, s) => n + s.endMs - s.startMs, 0),
      };
    })
      .filter((s) => s.calls)
      .sort((a, b) => b.activeWallMs - a.activeWallMs);
    return {
      kind: "CTI_PERFORMANCE_DIAGNOSTICS",
      schemaVersion: 1,
      instrumentationVersion: "pr105-v1",
      runId,
      startedAt,
      build:
        typeof options.build === "string" &&
        /^[a-zA-Z0-9._-]{1,120}$/.test(options.build)
          ? options.build
          : "unspecified",
      operation: PERFORMANCE_STAGES.includes(options.operation)
        ? options.operation
        : "session",
      measurementStatus: status,
      durationMs: duration,
      counts: { ...counts },
      stages,
      slowest: records
        .slice()
        .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
        .slice(0, 30),
      spans: records,
      droppedSpans: dropped,
      cpuMs: null,
      limitations: [
        "Wall-clock spans include scheduling and I/O; CPU is not measured.",
        "Stage unions overlap; do not add stages or ranked spans to estimate total time.",
        "Request success is not content verification. Counts retain their stated scope.",
        "Repeated reads may be required stability checks, not waste.",
        "Item numbers are run-local ordinals; no course IDs, URLs or bodies are exported.",
        "Page closure loses this local trace; export before closing.",
        "Direct request spans cover native API transport; provider/media subrequests remain inside item cost, not individually timed.",
        "Brightspace request spans end at response headers; inventory/item spans include body consumption.",
        "First report measures report paint, not whether the operator has read or acted on a finding.",
        "Server CPU/queue time, browser login before enabling, and detailed editor hydration are unmeasured.",
      ],
      summary:
        Math.round(duration) +
        " ms observed; " +
        (finished === null ? "running/partial" : status) +
        "; " +
        (counts.requests || 0) +
        " requests; " +
        (counts.failed || 0) +
        " failed; " +
        dropped +
        " spans omitted by bound.",
    };
  }
  function finish(value = "complete") {
    if (!enabled || finished !== null) return;
    finished = clock();
    status =
      value === "complete" && !open.size && !dropped ? "complete" : "partial";
  }
  /** @template T
   * @param {string} stage
   * @param {() => T} fn
   * @param {number|null} item
   * @returns {T} */
  function measure(stage, fn, item = null) {
    if (!enabled) return fn();
    const end = begin(stage, item);
    try {
      const value = fn();
      if (value && typeof value.then === "function")
        return value.then(
          (result) => {
            end();
            return result;
          },
          (error) => {
            end("failed");
            throw error;
          },
        );
      end();
      return value;
    } catch (error) {
      end("failed");
      throw error;
    }
  }
  return { enabled, begin, count, repeated, snapshot, finish, measure };
}

export function mountPerformanceControls(parent, operation, build) {
  let trace = createPerformanceTrace();
  try {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML =
      '<label><input type="checkbox"> Performance diagnostics (local)</label> <button type="button">Download diagnostics</button><small style="display:block">Enable before starting. Export partial results before closing this tab. Timings do not certify content.</small>';
    const checkbox = root.querySelector("input"),
      button = root.querySelector("button");
    button.disabled = true;
    button.onclick = () => {
      const report = trace.snapshot();
      if (!report) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "CTI-performance-" + operation + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    parent.appendChild(host);
    return {
      start() {
        trace = createPerformanceTrace({
          enabled: checkbox.checked,
          operation,
          build,
        });
        checkbox.disabled = true;
        button.disabled = !trace.enabled;
        return trace;
      },
      finish(status) {
        trace.finish(status);
        checkbox.disabled = false;
      },
      get trace() {
        return trace;
      },
    };
  } catch {
    return {
      start: () => trace,
      finish: () => {},
      get trace() {
        return trace;
      },
    };
  }
}
