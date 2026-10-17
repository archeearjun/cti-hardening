import { prepareCaptureFileTransfer } from "../src/domain/capture-file-transfer.ts";

self.onmessage = async ({ data }: MessageEvent<{ file: File }>) => {
  try {
    const result = await prepareCaptureFileTransfer(data.file, (phase) =>
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
