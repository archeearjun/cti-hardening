import type {
  EvidenceObject,
  WorkflowJob,
} from "../src/domain/workspace-types";
export function runWorkflow(
  job: WorkflowJob,
  signal: AbortSignal,
): Promise<EvidenceObject> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Cancelled. No report was saved."));
      return;
    }
    const worker = new Worker(
      new URL("./workflow.worker.ts", import.meta.url),
      { type: "module" },
    );
    function finish(error?: Error, result?: EvidenceObject) {
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    }
    function abort() {
      finish(new Error("Cancelled. No report was saved."));
    }
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) =>
      finish(
        new Error(
          event.message || "The workflow could not run. Refresh and retry.",
        ),
      );
    worker.onmessage = (event) =>
      event.data.kind === "error"
        ? finish(new Error(event.data.message))
        : finish(undefined, event.data.result);
    // Comparison inputFile() buffers belong to this one dispatched job. Move
    // capture metadata and originals into the worker instead of cloning a large
    // archive. The selected File and saved history remain owned by the UI.
    const transfers: ArrayBuffer[] = [];
    if (job.kind === "compare") {
      const seen = new Set<ArrayBuffer>();
      for (const value of [
        job.input.json?.bytes,
        job.input.brightspace?.bytes,
        ...(job.input.json?.archiveFiles || []).map((file) => file.bytes),
      ]) {
        if (value?.buffer instanceof ArrayBuffer && !seen.has(value.buffer)) {
          seen.add(value.buffer);
          transfers.push(value.buffer);
        }
      }
    }
    try {
      worker.postMessage(job, transfers);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
