import { prepareCaptureShareReview } from "../src/domain/capture-share-review.ts";

self.onmessage = async ({ data }: MessageEvent<{ file: File }>) => {
  try {
    const report = await prepareCaptureShareReview(data.file, (phase) =>
      self.postMessage({ kind: "progress", phase }),
    );
    self.postMessage({ kind: "result", report });
  } catch (error) {
    self.postMessage({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
