import { createWorkflows } from "../src/domain/workflows.ts";
import { workerXml } from "../src/adapters/worker-xml.ts";
const workflows = createWorkflows(workerXml);
self.onmessage = async (event) => {
  try {
    self.postMessage({
      kind: "result",
      result: await workflows.executeAsync(event.data),
    });
  } catch (error) {
    self.postMessage({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
