(function (root) {
  "use strict";
  // Small native adapter for the standalone parser's non-compact XML contract.
  // No external entity expansion; no HTML insertion or resource fetching.
  root.xml2js = function (text) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw Error("XML declarations are not supported.");
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length)
      throw Error("Malformed XML document.");
    let nodes = 0;
    function convert(node, depth) {
      if (++nodes > 250000 || depth > 120)
        throw Error("XML complexity limit exceeded.");
      if (node.nodeType === 3)
        return { type: "text", text: node.nodeValue || "" };
      if (node.nodeType === 4)
        return { type: "cdata", cdata: node.nodeValue || "" };
      if (node.nodeType !== 1 && node.nodeType !== 9) return null;
      const result = {
        elements: Array.from(node.childNodes)
          .map((x) => convert(x, depth + 1))
          .filter(Boolean),
      };
      if (node.nodeType === 1) {
        result.type = "element";
        result.name = node.nodeName;
        result.attributes = Object.fromEntries(
          Array.from(node.attributes).map((a) => [a.name, a.value]),
        );
      }
      return result;
    }
    return convert(doc, 0);
  };
})(globalThis);
