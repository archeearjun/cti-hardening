import { reviewCapture } from "./capture-review.ts";
import { readCaptureFileJson } from "./capture-file.ts";

export async function inspectBrightspaceCaptureFile(
  file: File,
  partner: string,
) {
  if (!file.size) throw Error("The selected Brightspace capture is empty.");
  const value = await readCaptureFileJson(file);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("extractor" in value) ||
    typeof value.extractor !== "string" ||
    !/brightspace/i.test(value.extractor)
  )
    throw Error(
      "Choose the full CTI Brightspace source capture, not a Coursera capture or report.",
    );
  return reviewCapture(value, file.name, {
    partner: partner.toUpperCase() === "NAIT" ? "NAIT" : "",
    mode: "OPS_CURRENT",
  });
}
