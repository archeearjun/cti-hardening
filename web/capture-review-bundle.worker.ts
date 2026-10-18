import { prepareCaptureReviewBundle } from "../src/domain/capture-review-bundle.ts";

self.onmessage = async ({ data }: MessageEvent<{ file: File }>) => {
  try {
    const result = await prepareCaptureReviewBundle(data.file, (phase) =>
      self.postMessage({ kind: "progress", phase }),
    );
    self.postMessage({ kind: "result", result });
  } catch (error) {
    self.postMessage({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
