import type { PackageNode, PackageScan } from "./package-types.ts";

/** Authored manifest items only. Comparison projection and dependency-derived
 * items remain in courseTree; they must not rewrite the source navigation. */
export function readSourceHierarchy(doc: Document): PackageNode[] {
  const root = doc.documentElement;
  if (root.localName !== "manifest")
    throw Error("The XML root is not an IMS manifest.");
  const children = (node: Element, name: string) =>
    Array.from(node.children).filter(
      (el) => el.localName === name && el.namespaceURI === root.namespaceURI,
    );
  const resources = children(root, "resources").flatMap((r) =>
    children(r, "resource"),
  );
  if (resources.length > 20000)
    throw Error("The manifest exceeds the 20,000-resource safety limit.");
  const resourceTypes = new Map<string, string>();
  for (const resource of resources) {
    const id = resource.getAttribute("identifier");
    if (!id || resourceTypes.has(id))
      throw Error("Manifest resource identifiers must be present and unique.");
    resourceTypes.set(id, resource.getAttribute("type") || "missing_type");
  }
  const organizations = children(root, "organizations")[0];
  if (!organizations) return [];
  const choices = children(organizations, "organization");
  const defaultId = organizations.getAttribute("default");
  const selected = defaultId
    ? choices.find((o) => o.getAttribute("identifier") === defaultId)
    : choices[0];
  if (defaultId && !selected)
    throw Error("The manifest's default organization could not be resolved.");
  let count = 0;
  function walk(items: Element[], depth: number): PackageNode[] {
    if (items.length && depth > 100)
      throw Error("The manifest exceeds the 100-level hierarchy safety limit.");
    return items.map((item) => {
      if (++count > 50000)
        throw Error("The manifest exceeds the 50,000-item safety limit.");
      const idref = item.getAttribute("identifierref") || null;
      return {
        title:
          children(item, "title")[0]?.textContent?.trim() || "Untitled entry",
        type: idref
          ? resourceTypes.get(idref) || "unresolved-resource"
          : "folder",
        idref,
        children: walk(children(item, "item"), depth + 1),
      };
    });
  }
  return selected ? walk(children(selected, "item"), 1) : [];
}

export interface SourceTreeRow {
  node: PackageNode;
  key: string;
  path: string;
  ancestors: string[];
}
export function sourceTreeRows(scan: PackageScan): SourceTreeRow[] {
  const rows: SourceTreeRow[] = [];
  function walk(nodes: PackageNode[], path: string, ancestors: string[]) {
    for (const [index, node] of nodes.entries()) {
      const key = `${ancestors.at(-1) || "source"}.${index}`;
      rows.push({ node, key, path, ancestors });
      walk(
        node.children || [],
        [path, node.title].filter(Boolean).join(" / "),
        [...ancestors, key],
      );
    }
  }
  walk(scan.sourceHierarchy || scan.courseTree, "", []);
  return rows;
}
