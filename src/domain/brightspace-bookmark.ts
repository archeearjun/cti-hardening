import { brightspaceSource } from "../generated/extractor-sources.js";
import { encodeJavaScriptBookmarkPayload } from "./bookmark-address.js";

export const BRIGHTSPACE_BOOKMARK_NAME = "CTI Brightspace capture";
// Match the source-preserving Coursera bookmark's verified Chrome input bound.
// The encoded address is ASCII: character length and byte size are identical.
export const BRIGHTSPACE_BOOKMARK_MAX_BYTES = 500 * 1024;

/** Keep the maintained program intact; void preserves the current document. */
export function createBrightspaceCaptureScript(
  source: string = brightspaceSource,
): string {
  if (typeof source !== "string" || !source.trim())
    throw new Error(
      "The Brightspace capture bookmark is unavailable in this build.",
    );
  return `void ${source}`;
}

export function createBrightspaceCaptureBookmark(
  source: string = brightspaceSource,
): string {
  const address =
    "javascript:" +
    encodeJavaScriptBookmarkPayload(createBrightspaceCaptureScript(source));
  if (
    new TextEncoder().encode(address).byteLength >=
    BRIGHTSPACE_BOOKMARK_MAX_BYTES
  )
    throw new Error(
      "The Brightspace capture bookmark is too large to save safely. Use the complete script copy fallback.",
    );
  return address;
}
