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
    worker.postMessage(job);
  });
}
