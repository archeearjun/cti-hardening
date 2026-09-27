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
  try {
    const result = await scanPackage(event.data.file, (progress) =>
      send({ kind: "package-progress", progress }),
    );
    send({ kind: "package-result", result });
  } catch (error) {
    send({
      kind: "package-error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
send({ kind: "package-ready" });
