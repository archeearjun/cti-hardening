import { normalizeType } from "./text-and-dom.js";
import { CTI_DIRECT_DATA_MAX_ITEMS_V1 } from "./direct-data-config.js";

/** Validate the complete ordered hierarchy. Inventory stubs are constructed
 * without broad evidence harvesting: sanitized nested models are not URLs or
 * item bodies. A truncated walk or hidden duplicate fails. */
export async function directCourseInventoryV1(envelope, courseId) {
  if (
    !envelope ||
    !Array.isArray(envelope.elements) ||
    envelope.elements.length !== 1 ||
    envelope.elements[0]?.id !== courseId ||
    envelope.paging?.next != null
  )
    throw Error("DIRECT_MATERIAL_ROOT_NOT_COMPLETE");
  const root = envelope.elements[0],
    material = root.material;
  if (!material || !Array.isArray(material.elements))
    throw Error("DIRECT_MATERIAL_TREE_UNAVAILABLE");
  const leaves = new Map(),
    nodes = new Set();
  function walk(node, ancestors, depth) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      depth > 32 ||
      nodes.size >= 50000 ||
      typeof node.id !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(node.id) ||
      nodes.has(node.id) ||
      typeof (node.name || node.originalName) !== "string" ||
      !(node.name || node.originalName) ||
      (!Array.isArray(node.elements) &&
        !Object.prototype.hasOwnProperty.call(node, "content"))
    )
      throw Error("DIRECT_MATERIAL_TREE_AMBIGUOUS");
    nodes.add(node.id);
    const children = Array.isArray(node.elements) ? node.elements : [];
    if (children.length) {
      if (node.content)
        throw Error("DIRECT_MATERIAL_NODE_AND_CONTENT_CONFLICT");
      const parent = {
        id: node.id,
        title: node.name || node.originalName,
        key: ancestors
          .map((value) => value.id)
          .concat(node.id)
          .join("/"),
      };
      for (const child of children)
        walk(child, ancestors.concat(parent), depth + 1);
      return;
    }
    if (leaves.size >= CTI_DIRECT_DATA_MAX_ITEMS_V1)
      throw Error("DIRECT_MATERIAL_ITEM_LIMIT");
    const structural = !Object.prototype.hasOwnProperty.call(node, "content");
    if (
      !structural &&
      (!node.content ||
        typeof node.content.typeName !== "string" ||
        !/^[A-Za-z0-9_-]{22}$/.test(node.atomId || "") ||
        node.contentId !== "atom~" + node.atomId)
    )
      throw Error("DIRECT_MATERIAL_CONTENT_REFERENCE_INVALID");
    leaves.set(node.id, {
      node,
      ancestorIds: ancestors.map((value) => value.id),
      ancestors,
      structural,
    });
  }
  for (const module of material.elements) walk(module, [], 1);
  const fingerprints = [...leaves.values()].map((source) => ({
    id: source.node.id,
    type: source.structural
      ? "Unknown"
      : normalizeType(source.node.content.typeName),
    typeName: source.structural ? "" : source.node.content.typeName,
    path: source.ancestors.map((value) => value.title).join(" > "),
    ancestors: source.ancestors,
    evidenceLevel: "structure-only",
    evidenceSources: ["authoringCourseMaterials"],
  }));
  for (const fp of fingerprints) {
    const source = leaves.get(fp.id),
      node = source.node;
    fp.name = node.name || node.originalName;
    fp.atomId = node.atomId || "";
    fp.contentId = node.contentId || "";
    fp.sourceIdentity = {
      materialName: node.name || "",
      originalName: node.originalName || "",
      published: typeof node.published === "boolean" ? node.published : null,
      structural: source.structural,
    };
    // Material stubs are inventory evidence; only a bound draft supplies body.
    fp.payload = {
      files: [],
      links: [],
      images: [],
      assetDetails: [],
      textSample: "",
      textLength: 0,
      textSha256: "",
      evidenceSources: ["authoringCourseMaterials"],
    };
  }
  return {
    fingerprints,
    leaves,
    root,
    materialVersion: root.conflictMetadata?.version,
    courseBranchVersion: root.conflictMetadata?.courseBranchVersion,
  };
}
