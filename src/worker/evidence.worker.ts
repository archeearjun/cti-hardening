import {
  getExtractor,
  readCaptureReviewFile,
  reviewCapture,
} from "../domain/capture-review.ts";
import type { WorkerRequest, WorkerResponse } from "../domain/types.ts";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};
scope.onmessage = async ({ data }) => {
  const post = (message: WorkerResponse) => scope.postMessage(message);
  try {
    if (data.kind === "extractor") {
      post({
        id: data.id,
        kind: "extractor",
        result: getExtractor(data.platform),
      });
      return;
    }
    post({ id: data.id, kind: "progress", phase: "Reading capture JSON" });
    const value: unknown = await readCaptureReviewFile(data.file);
    const result = reviewCapture(value, data.file.name, data.options, (phase) =>
      post({ id: data.id, kind: "progress", phase }),
    );
    post({ id: data.id, kind: "review", result });
  } catch (error) {
    post({
      id: data.id,
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
