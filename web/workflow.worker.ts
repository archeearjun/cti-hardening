import { enablePerformance } from "../src/diagnostics/runtime.ts";
import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
const workflows = createWorkflows(workerXml);
self.onmessage = async (event) => {
  const trace = enablePerformance(event.data.performanceDiagnostics === true);
  const timer = trace.enabled
    ? setInterval(
        () =>
          self.postMessage({ kind: "performance", report: trace.snapshot() }),
        1000,
      )
    : undefined;
  try {
    const result = await workflows.executeAsync(event.data);
    trace.finish();
    if (trace.enabled)
      self.postMessage({ kind: "performance", report: trace.snapshot() });
    self.postMessage({ kind: "result", result });
  } catch (error) {
    trace.finish("partial");
    if (trace.enabled)
      self.postMessage({ kind: "performance", report: trace.snapshot() });
    self.postMessage({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearInterval(timer);
    trace.finish();
    if (trace.enabled)
      self.postMessage({ kind: "performance", report: trace.snapshot() });
  }
};
