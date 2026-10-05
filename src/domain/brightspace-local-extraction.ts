import { MAX_CAPTURE_BYTES, reviewCapture } from "./capture-review.ts";

export async function inspectBrightspaceCaptureFile(
  file: File,
  partner: string,
) {
  if (!file.size) throw Error("The selected Brightspace capture is empty.");
  if (file.size > MAX_CAPTURE_BYTES)
    throw Error("The Brightspace capture exceeds the 40 MiB inspection limit.");
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw Error("The selected Brightspace capture is not valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("extractor" in value) ||
    typeof value.extractor !== "string" ||
    !/brightspace/i.test(value.extractor)
  )
    throw Error(
      "Choose the full CTI Brightspace source JSON, not a Coursera capture or report.",
    );
  return reviewCapture(value, file.name, {
    partner: partner.toUpperCase() === "NAIT" ? "NAIT" : "",
    mode: "OPS_CURRENT",
  });
}
