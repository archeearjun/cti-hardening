import { enablePerformance } from "../src/diagnostics/runtime.ts";
import { scanPackage } from "../src/domain/package-scan.ts";
import type { PackageMessage } from "../src/domain/package-types.ts";

// A disposable browser document retains native HTML/XML parsing and Canvas
// semantics from the canonical scanner. Removing it cancels the complete job,
// including PDF workers. Package HTML is parsed as data and never displayed.
const send = (message: PackageMessage) =>
  parent.postMessage(message, location.origin);
let started = false;
addEventListener("message", async (event) => {
  if (event.origin !== location.origin || event.source !== parent || started)
    return;
  if (event.data?.kind !== "scan-package" || !(event.data.file instanceof File))
    return;
  started = true;
  const trace = enablePerformance(event.data.performanceDiagnostics === true);
  let lastTrace = 0;
  const sendTrace = (force = false) => {
    if (trace.enabled && (force || performance.now() - lastTrace > 1000)) {
      lastTrace = performance.now();
      parent.postMessage(
        { kind: "package-performance", report: trace.snapshot() },
        location.origin,
      );
    }
  };
  try {
    const result = await scanPackage(event.data.file, (progress) => {
      send({ kind: "package-progress", progress });
      sendTrace();
    });
    trace.finish();
    sendTrace(true);
    send({ kind: "package-result", result });
  } catch (error) {
    trace.finish("partial");
    sendTrace(true);
    send({
      kind: "package-error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
send({ kind: "package-ready" });
