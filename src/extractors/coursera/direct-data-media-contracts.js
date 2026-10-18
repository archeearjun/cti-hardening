import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import {
  canonicalDirectAssetUrlV1,
  directAssetMetadataBindingV1,
  decodeDirectAssetBodyV1,
  directAssetBodyKindV1,
} from "./direct-data-media.js";

/** Derive native media ownership and plain text from the original XML without a
 * DOM. This bounded lexer never mounts markup or resolves external resources.
 * @returns {{valid: boolean, references: Array<{tag: string, id: string, url: string, name: string, locationResolved: boolean, bodyVerified: boolean}>, reason: string, text: string}}
 */
export function directCmlMediaInventoryV1(value, textProjectionVersion = 1) {
  const fail = (reason = "DIRECT_CML_NOT_SUPPORTED") => ({
    valid: false,
    references: [],
    reason,
    text: "",
  });
  if (
    ![1, 2].includes(textProjectionVersion) ||
    typeof value !== "string" ||
    value.length > 4000000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
      value,
    )
  )
    return fail();
  const references = [],
    stack = [],
    namespaceScopes = [],
    text = [];
  const xmlNamespace = "http://www.w3.org/XML/1998/namespace",
    xmlnsNamespace = "http://www.w3.org/2000/xmlns/",
    initialNamespace = Object.assign(Object.create(null), {
      xml: xmlNamespace,
    });
  const validName = (name) =>
    /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/.test(name);
  let index = 0,
    count = 0,
    roots = 0;
  const decode = (source) => {
    if (/&(?!(?:[A-Za-z]+|#\d+|#x[0-9a-f]+);)/i.test(source))
      throw new Error("DIRECT_CML_ENTITY_UNSUPPORTED");
    return source.replace(/&([^;\s]+);/g, (_, entity) => {
      const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
      if (Object.hasOwn(named, entity)) return named[entity];
      const code = /^#x[0-9a-f]+$/i.test(entity)
        ? parseInt(entity.slice(2), 16)
        : /^#\d+$/.test(entity)
          ? Number(entity.slice(1))
          : 0;
      if (
        !Number.isSafeInteger(code) ||
        (code < 0x20 && code !== 9 && code !== 10 && code !== 13) ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff) ||
        code === 0xfffe ||
        code === 0xffff
      )
        throw new Error("DIRECT_CML_ENTITY_UNSUPPORTED");
      return String.fromCodePoint(code);
    });
  };
  // Native Coursera headings use <heading level="…"> rather than HTML h1–h6.
  // Keep the original projection available for immutable historical captures;
  // v2 adds authored heading/list boundaries without changing inline text.
  const block = (tag) =>
    /^(?:text|p|div|section|article|header|footer|h[1-6]|li|ul|ol|blockquote|pre|table|thead|tbody|tfoot|tr|td|th|caption|br|hr)$/.test(
      tag,
    ) ||
    (textProjectionVersion === 2 && /^(?:heading|list)$/.test(tag));
  try {
    while (index < value.length) {
      const opening = value.indexOf("<", index);
      const endText = opening < 0 ? value.length : opening;
      const plain = value.slice(index, endText);
      if (
        !stack.length &&
        /[^\x20\t\r\n]/.test(index === 0 ? plain.replace(/^\ufeff/, "") : plain)
      )
        return fail();
      if (plain.includes("]]>")) return fail();
      text.push(decode(plain));
      if (opening < 0) break;
      if (++count > 100000) return fail();
      if (value.startsWith("<!--", opening)) {
        const end = value.indexOf("-->", opening + 4);
        if (end < 0) return fail();
        const comment = value.slice(opening + 4, end);
        if (comment.includes("--") || comment.endsWith("-")) return fail();
        index = end + 3;
        continue;
      }
      if (value.startsWith("<![CDATA[", opening)) {
        const end = value.indexOf("]]>", opening + 9);
        if (end < 0 || !stack.length) return fail();
        text.push(value.slice(opening + 9, end));
        index = end + 3;
        continue;
      }
      if (value[opening + 1] === "!" || value[opening + 1] === "?")
        return fail();
      let end = opening + 1,
        quote = "";
      for (; end < value.length; end++) {
        const character = value[end];
        if (quote) {
          if (character === quote) quote = "";
        } else if (character === '"' || character === "'") quote = character;
        else if (character === ">") break;
        else if (character === "<") return fail();
      }
      if (end === value.length || quote) return fail();
      const token = value.slice(opening + 1, end),
        closing = token.startsWith("/"),
        selfClosing = token.endsWith("/"),
        body = closing ? token.slice(1) : token,
        name = /^([A-Za-z_][\w.:-]*)/.exec(body);
      if (!name || !validName(name[1])) return fail();
      const qualified = name[1],
        tag = qualified.split(":").at(-1).toLowerCase();
      if (closing) {
        if (body.slice(qualified.length).trim() || stack.pop() !== qualified)
          return fail();
        namespaceScopes.pop();
        if (block(tag)) text.push(" ");
        index = end + 1;
        continue;
      }
      if (
        !stack.length &&
        (++roots !== 1 || qualified.split(":").at(-1) !== "co-content")
      )
        return fail();
      if (
        /^(?:script|style|link|input|select|option|textarea|button|form|canvas|svg|math|equation|latex|formula|template|noscript|base|meta)$/.test(
          tag,
        )
      )
        return fail();
      if (block(tag)) text.push(" ");
      const attributes = Object.create(null);
      let remainder = body.slice(qualified.length);
      if (selfClosing) remainder = remainder.replace(/\/\s*$/, "");
      while (remainder.trim()) {
        const attribute =
          /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(
            remainder,
          );
        if (
          !attribute ||
          !validName(attribute[1]) ||
          Object.hasOwn(attributes, attribute[1])
        )
          return fail();
        const raw = attribute[2] ?? attribute[3];
        if (
          raw.includes("<") ||
          /&(?!(?:[A-Za-z]+|#\d+|#x[0-9a-f]+);)/i.test(raw)
        )
          return fail();
        attributes[attribute[1]] = decode(raw);
        remainder = remainder.slice(attribute[0].length);
      }
      // Resolve declarations before checking either element or attribute names;
      // declaration order in an XML start tag carries no semantic meaning.
      const namespace = Object.create(
        namespaceScopes.at(-1) || initialNamespace,
      );
      for (const [attribute, uri] of Object.entries(attributes)) {
        if (attribute !== "xmlns" && !attribute.startsWith("xmlns:")) continue;
        const prefix = attribute === "xmlns" ? "" : attribute.slice(6);
        if (
          prefix === "xmlns" ||
          uri === xmlnsNamespace ||
          (prefix === "xml" ? uri !== xmlNamespace : uri === xmlNamespace) ||
          (prefix && !uri) ||
          /\s/.test(uri)
        )
          return fail();
        namespace[prefix] = uri;
      }
      const elementPrefix = qualified.includes(":")
        ? qualified.split(":")[0]
        : "";
      if (elementPrefix && !namespace[elementPrefix]) return fail();
      const expandedAttributes = new Set();
      for (const attribute of Object.keys(attributes)) {
        if (attribute === "xmlns" || attribute.startsWith("xmlns:")) continue;
        const parts = attribute.split(":"),
          prefix = parts.length === 2 ? parts[0] : "",
          local = parts.at(-1);
        if (prefix && !namespace[prefix]) return fail();
        const expanded = (prefix ? namespace[prefix] : "") + "~" + local;
        if (expandedAttributes.has(expanded)) return fail();
        expandedAttributes.add(expanded);
      }
      const href = attributes.href || "",
        nativeAsset =
          Object.hasOwn(attributes, "assetId") ||
          Object.hasOwn(attributes, "assetid"),
        attachment =
          tag === "a" &&
          (nativeAsset ||
            Object.hasOwn(attributes, "download") ||
            /\.(?:pdf|docx?|pptx?|xlsx?|zip|csv|png|jpe?g|gif|webp)(?:[?#]|$)/i.test(
              href,
            ));
      if (
        Object.hasOwn(attributes, "assetId") &&
        Object.hasOwn(attributes, "assetid") &&
        attributes.assetId !== attributes.assetid
      )
        return fail();
      if (
        attachment ||
        /^(?:asset|img|image|iframe|frame|video|audio|source|track|embed|object|widget)$/.test(
          tag,
        )
      ) {
        const url =
          href || attributes.src || attributes.url || attributes.data || "";
        references.push({
          tag,
          // An anchor's DOM id identifies its navigation target, not a native
          // file. Only an explicit source asset field can bind its body.
          id:
            attributes.assetId ||
            attributes.assetid ||
            (tag === "a" ? "" : attributes.id || ""),
          url,
          name:
            attributes.filename || attributes.name || attributes.title || "",
          locationResolved:
            /^https?:\/\//i.test(url) &&
            !/^(?:iframe|frame|embed|object|widget)$/.test(tag),
          bodyVerified: false,
        });
      }
      if (!selfClosing) {
        stack.push(qualified);
        namespaceScopes.push(namespace);
        if (stack.length > 128) return fail();
      }
      index = end + 1;
    }
    if (stack.length || roots !== 1) return fail();
    return {
      valid: true,
      references,
      reason: "",
      text: text
        .join("")
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    };
  } catch (_) {
    return fail();
  }
}

export function directAssetMetadataReceiptValidV1(receipt, id) {
  const hash = receipt?.originalResponseSha256;
  return Boolean(
    receipt?.resource === "assets.v1" &&
      receipt.id === id &&
      receipt.requestPath === "/api/assets.v1" &&
      Array.isArray(receipt.requestQuery) &&
      receipt.requestQuery.length === 1 &&
      receipt.requestQuery[0]?.[0] === "ids" &&
      receipt.requestQuery[0]?.[1] === id &&
      receipt.status === 200 &&
      receipt.bodyFormat === "PARSED_SANITIZED_JSON_MODEL" &&
      /^[a-f0-9]{64}$/.test(hash || "") &&
      (!receipt.sha256 || receipt.sha256 === hash),
  );
}

/** Compare complete observed metadata, normalizing only its delivery URL.
 * Native content/version metadata remains part of source stability. */
export function directAssetStableMetadataTextV1(envelope, id) {
  const binding = directAssetMetadataBindingV1(envelope, id);
  if (!binding) return null;
  try {
    return directCanonicalSourceTextV1(binding.sourceModel);
  } catch (_) {
    return null;
  }
}

/** Validate source ownership and binary shape before the caller independently
 * hashes original bytes. The same structure check runs in Chrome and import. */
export function directMediaEvidenceStructureV1(media, references) {
  const unresolved = [...references],
    decoded = [],
    resolved = [];
  const fail = (reason) => ({
    complete: false,
    reason,
    unresolvedAssetReferences: unresolved,
    decoded,
    resolved,
  });
  if (!references.length) {
    if (
      media &&
      (media.assets?.length ||
        media.failures?.length ||
        media.missingPointers?.length)
    )
      return fail("DIRECT_ASSET_REFERENCE_INVENTORY_MISMATCH");
    return {
      complete: true,
      reason: "",
      unresolvedAssetReferences: [],
      decoded,
      resolved,
    };
  }
  if (
    references.some(
      (reference) => !/^(?:asset|img|image|a)$/.test(reference.tag),
    )
  )
    return fail("DIRECT_CML_MEDIA_REFERENCE_UNSUPPORTED");
  if (
    references.some(
      (reference) => !/^[A-Za-z0-9_-]{22}$/.test(reference.id || ""),
    )
  )
    return fail("DIRECT_CML_MEDIA_REFERENCE_MISSING");
  if (
    media?.method !== "BOUND_CML_ASSET_METADATA_AND_BODY" ||
    !Array.isArray(media.assets) ||
    !Array.isArray(media.failures) ||
    media.failures.length ||
    !Array.isArray(media.missingPointers) ||
    media.missingPointers.length
  )
    return fail("DIRECT_READING_ASSETS_UNRESOLVED");
  const expected = new Set(references.map((reference) => reference.id)),
    assets = new Map();
  for (const asset of media.assets) {
    if (!asset || !expected.has(asset.assetId) || assets.has(asset.assetId))
      return fail("DIRECT_ASSET_REFERENCE_INVENTORY_MISMATCH");
    assets.set(asset.assetId, asset);
  }
  if (assets.size !== expected.size)
    return fail("DIRECT_READING_ASSETS_UNRESOLVED");
  let retainedBodyBytes = 0;
  for (const [id, asset] of assets) {
    if (
      !Number.isSafeInteger(asset.body?.size) ||
      asset.body.size < 1 ||
      (retainedBodyBytes += asset.body.size) > 64 * 1024 * 1024
    )
      return fail("DIRECT_ASSET_SOURCE_OR_BODY_INVALID");
    const initial = directAssetMetadataBindingV1(asset.metadata, id),
      fresh = directAssetMetadataBindingV1(asset.stability?.metadata, id),
      initialText = directAssetStableMetadataTextV1(asset.metadata, id),
      freshText = directAssetStableMetadataTextV1(
        asset.stability?.metadata,
        id,
      ),
      bytes = decodeDirectAssetBodyV1(asset.body),
      body = asset.body,
      receipt = body?.receipt;
    if (
      !initial ||
      !fresh ||
      !initialText ||
      initialText !== freshText ||
      asset.stability?.stable !== true ||
      !directAssetMetadataReceiptValidV1(asset.metadataReceipt, id) ||
      !directAssetMetadataReceiptValidV1(asset.stability.receipt, id) ||
      !bytes ||
      !/^[a-f0-9]{64}$/.test(body.sha256 || "") ||
      !body.size ||
      body.size !== bytes.byteLength ||
      body.canonicalUrl !== initial.canonicalUrl ||
      canonicalDirectAssetUrlV1(body.canonicalUrl) !== initial.canonicalUrl ||
      receipt?.status !== 200 ||
      (body.archivePath !== undefined
        ? receipt.bodyFormat !== "ORIGINAL_BINARY_BYTES_ARCHIVE" ||
          body.archivePath !== "files/" + body.sha256
        : receipt.bodyFormat !== "ORIGINAL_BINARY_BYTES_BASE64") ||
      receipt.bytes !== body.size ||
      receipt.mime !== body.mime ||
      receipt.canonicalUrl !== initial.canonicalUrl ||
      receipt.sha256 !== body.sha256 ||
      typeof receipt.observedAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.observedAt))
    )
      return fail("DIRECT_ASSET_SOURCE_OR_BODY_INVALID");
    const kind = directAssetBodyKindV1(bytes, body.mime, initial.name);
    if (!kind) return fail("DIRECT_ASSET_SOURCE_OR_BODY_INVALID");
    for (const reference of references.filter(
      (reference) => reference.id === id,
    )) {
      if (
        /^(?:img|image)$/.test(reference.tag) &&
        !/^(?:PNG|JPEG|GIF|WEBP)$/.test(kind)
      )
        return fail("DIRECT_ASSET_SOURCE_OR_BODY_INVALID");
      if (
        reference.url &&
        canonicalDirectAssetUrlV1(reference.url) !== initial.canonicalUrl
      )
        return fail("DIRECT_ASSET_REFERENCE_INVENTORY_MISMATCH");
      resolved.push({ reference, asset, binding: initial, kind });
    }
    decoded.push({ asset, bytes, kind });
  }
  return {
    complete: true,
    reason: "",
    unresolvedAssetReferences: [],
    decoded,
    resolved,
  };
}
