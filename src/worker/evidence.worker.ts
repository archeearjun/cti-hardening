import {
  getExtractor,
  MAX_CAPTURE_BYTES,
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
    if (data.file.size > MAX_CAPTURE_BYTES)
      throw new Error(
        "This preview accepts capture JSON files up to 40 MiB. Keep larger files in the existing CTI workflow.",
      );
    post({ id: data.id, kind: "progress", phase: "Reading capture JSON" });
    const value: unknown = JSON.parse(await data.file.text());
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
