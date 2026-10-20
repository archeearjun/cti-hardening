/** A javascript URL may retain URI punctuation. Escape query/fragment markers
 * and all whitespace, percent signs and Unicode while preserving exact source
 * after URL decoding. This needs no eval, loader, compression or source rewrite. */
export function encodeJavaScriptBookmarkPayload(source) {
  // Brackets and braces are safe in the opaque javascript: path (not an HTTP authority).
  // Preserve them literally; decoding still yields the byte-for-byte program.
  return encodeURI(source).replace(/%5B/g, "[").replace(/%5D/g, "]").replace(/%7B/g, "{").replace(/%7D/g, "}")
    .replace(/[?#]/g, value => encodeURIComponent(value));
}
