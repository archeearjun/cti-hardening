/** A javascript URL may retain URI punctuation. Escape query/fragment markers
 * and all whitespace, percent signs and Unicode while preserving exact source
 * after URL decoding. This needs no eval, loader, compression or source rewrite. */
export function encodeJavaScriptBookmarkPayload(source) {
  return encodeURI(source).replace(/[?#]/g, value => encodeURIComponent(value));
}
