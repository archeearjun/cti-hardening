/** Canonical JSON for hashes of parsed, sanitized source models. Object key
 * order is irrelevant; array order remains part of the source identity. This
 * is not the original response byte representation. */
export function directCanonicalSourceTextV1(value) {
  const maxDepth = 64,
    maxNodes = 1000000,
    maxBytes = 32 * 1024 * 1024;
  const chunks = [],
    active = new WeakSet();
  let nodes = 0,
    bytes = 0;
  function fail(reason) {
    throw new Error(reason);
  }
  function append(text, size) {
    if (bytes + size > maxBytes) fail("DIRECT_DATA_CANONICAL_BYTE_LIMIT");
    bytes += size;
    chunks.push(text);
  }
  function quoted(text) {
    // Count encoded JSON bytes before allocating an escaped copy of a large
    // string. Well-formed JSON escapes lone UTF-16 surrogates as six ASCII bytes.
    const remaining = maxBytes - bytes;
    if (text.length + 2 > remaining) fail("DIRECT_DATA_CANONICAL_BYTE_LIMIT");
    let size = 2;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (
        code === 34 ||
        code === 92 ||
        code === 8 ||
        code === 9 ||
        code === 10 ||
        code === 12 ||
        code === 13
      )
        size += 2;
      else if (code < 32) size += 6;
      else if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          size += 4;
          index++;
        } else size += 6;
      } else if (code >= 0xdc00 && code <= 0xdfff) size += 6;
      else size += 3;
      if (size > remaining) fail("DIRECT_DATA_CANONICAL_BYTE_LIMIT");
    }
    append(JSON.stringify(text), size);
  }
  function ownValue(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !("value" in descriptor))
      fail("DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE");
    return descriptor.value;
  }
  function ordinaryObject(object) {
    const prototype = Object.getPrototypeOf(object);
    if (prototype === null) return true;
    const constructor = Object.getOwnPropertyDescriptor(
      prototype,
      "constructor",
    );
    return (
      Object.getPrototypeOf(prototype) === null &&
      constructor &&
      "value" in constructor &&
      typeof constructor.value === "function" &&
      constructor.value.name === "Object"
    );
  }
  function walk(entry, depth) {
    if (depth > maxDepth) fail("DIRECT_DATA_CANONICAL_DEPTH_LIMIT");
    if (++nodes > maxNodes) fail("DIRECT_DATA_CANONICAL_NODE_LIMIT");
    if (entry === null) {
      append("null", 4);
      return;
    }
    if (typeof entry === "string") {
      quoted(entry);
      return;
    }
    if (typeof entry === "boolean") {
      append(entry ? "true" : "false", entry ? 4 : 5);
      return;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry))
        fail("DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE");
      const text = JSON.stringify(entry);
      append(text, text.length);
      return;
    }
    if (typeof entry !== "object")
      fail("DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE");
    if (active.has(entry)) fail("DIRECT_DATA_CANONICAL_CYCLE");
    if (Object.getOwnPropertySymbols(entry).length)
      fail("DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE");
    const array = Array.isArray(entry);
    if (!array && !ordinaryObject(entry))
      fail("DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE");
    active.add(entry);
    if (array) {
      if (entry.length > maxNodes - nodes)
        fail("DIRECT_DATA_CANONICAL_NODE_LIMIT");
      if (Object.keys(entry).length !== entry.length)
        fail("DIRECT_DATA_CANONICAL_UNSUPPORTED_VALUE");
      append("[", 1);
      for (let index = 0; index < entry.length; index++) {
        if (index) append(",", 1);
        walk(ownValue(entry, String(index)), depth + 1);
      }
      append("]", 1);
    } else {
      const keys = Object.keys(entry).sort();
      if (keys.length > maxNodes - nodes)
        fail("DIRECT_DATA_CANONICAL_NODE_LIMIT");
      append("{", 1);
      for (let index = 0; index < keys.length; index++) {
        if (index) append(",", 1);
        quoted(keys[index]);
        append(":", 1);
        walk(ownValue(entry, keys[index]), depth + 1);
      }
      append("}", 1);
    }
    active.delete(entry);
  }
  walk(value, 0);
  return chunks.join("");
}
