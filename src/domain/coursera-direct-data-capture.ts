import { courseraDirectDataSource } from "../generated/extractor-sources.js";

export const COURSERA_DIRECT_DATA_CAPTURE_VERSION = "1.3.0";
export const COURSERA_DIRECT_DATA_CAPTURE_BUILD =
  "v1.3.0-deduplicated-original-archive-20261014";
// Chromium Bookmark Manager truncates pasted addresses beyond 500 KiB. The
// percent-encoded address is ASCII, so its UTF-16 length equals its byte size.
export const COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES = 500 * 1024;

/** The universal program binds itself to the signed-in authoring Content page.
 * `void` prevents a bookmark's completion value from replacing that document. */
export function createCourseraDirectDataCaptureScript(
  source: string = courseraDirectDataSource,
): string {
  if (typeof source !== "string" || !source.trim())
    throw new Error(
      "The Coursera capture bookmark is unavailable in this build.",
    );
  return `void ${source}`;
}

export function createCourseraDirectDataCaptureBookmark(
  source: string = courseraDirectDataSource,
): string {
  const address =
    "javascript:" +
    encodeURIComponent(createCourseraDirectDataCaptureScript(source));
  if (
    new TextEncoder().encode(address).byteLength >=
    COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES
  )
    throw new Error(
      "The Coursera capture bookmark is too large to save safely. Use the complete script copy fallback.",
    );
  return address;
}
