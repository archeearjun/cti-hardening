import {
  courseraDirectDataSource,
  courseraDirectDataBookmarkSource,
} from "../generated/extractor-sources.js";
import { encodeJavaScriptBookmarkPayload } from "./bookmark-address.js";

export const COURSERA_DIRECT_DATA_CAPTURE_VERSION = "1.8.9";
export const COURSERA_DIRECT_DATA_CAPTURE_BUILD =
  "v1.8.9-native-recheck-and-owner-handoff-20261019";
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
  // Formatting happens during the build. Explicit caller-supplied programs are
  // still encoded verbatim; the readable console fallback keeps its own source.
  source: string = courseraDirectDataBookmarkSource,
): string {
  const address =
    "javascript:" +
    encodeJavaScriptBookmarkPayload(createCourseraDirectDataCaptureScript(source));
  if (
    new TextEncoder().encode(address).byteLength >=
    COURSERA_DIRECT_DATA_BOOKMARK_MAX_BYTES
  )
    throw new Error(
      "The Coursera capture bookmark is too large to save safely. Use the complete script copy fallback.",
    );
  return address;
}
