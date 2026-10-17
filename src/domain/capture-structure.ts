import { writeWorkbook, type Cell } from "../adapters/workbook.ts";
import { verifiedCourseraCaptureInventory } from "./coursera-background-extraction.ts";

// Native item kinds must be explicit. A future/unsupported type is not evidence
// of a reading and must not acquire a fabricated type through this adapter.
const nativeTypeLabels: Readonly<Record<string, string>> = {
  supplement: "Reading",
  reading: "Reading",
  lecture: "Reading",
  staffGraded: "Assignment",
  ungradedAssignment: "Assignment",
  peerGraded: "Assignment",
  discussionPrompt: "Discussion Prompt",
  quiz: "Quiz",
  exam: "Quiz",
  video: "Video",
  ungradedWidget: "Plugin",
  gradedWidget: "Plugin",
};

export interface NativeCaptureHierarchyNode {
  id: string;
  title: string;
  kind: "module" | "lesson" | "item";
  ancestorIds: string[];
  /** A source-observed container with no children, never an empty content body. */
  emptyContainer: boolean;
  sourceContentType: string;
}

/** Independently verified shell evidence, including unsupported native item
 * types. Retaining a source type is separate from adapting it for comparison. */
export function captureStructureEvidence(capture: unknown) {
  const proof = verifiedCourseraCaptureInventory(capture);
  const ids = new Set(
    proof.inventory.filter((i) => i.contentBearing).map((i) => i.itemId),
  );
  const nativeHierarchy: NativeCaptureHierarchyNode[] = [];
  function visit(node: any, ancestorIds: string[]) {
    const title = node.name || node.originalName || node.title;
    if (typeof title !== "string" || !title.trim())
      throw Error(`Native inventory node ${node.id} has no recorded title.`);
    if (!ids.has(node.id)) {
      if (!Array.isArray(node.elements) || Object.hasOwn(node, "content"))
        throw Error(`Native inventory container ${node.id} is ambiguous.`);
      const kind = ancestorIds.length === 0 ? "module" : "lesson";
      nativeHierarchy.push({
        id: node.id,
        title,
        kind,
        ancestorIds,
        emptyContainer: node.elements.length === 0,
        sourceContentType: "",
      });
      node.elements.forEach((child: any) =>
        visit(child, ancestorIds.concat(node.id)),
      );
    } else {
      const type = node.content.typeName;
      nativeHierarchy.push({
        id: node.id,
        title,
        kind: "item",
        ancestorIds,
        emptyContainer: false,
        sourceContentType: type,
      });
    }
  }
  proof.material.elements.forEach((node: any) => visit(node, []));
  return {
    kind: "VERIFIED_NATIVE_CAPTURE_INVENTORY",
    courseId: proof.courseId,
    materialHash: proof.materialHash,
    contentItemCount: ids.size,
    inventoryEntryCount: proof.inventory.length,
    moduleCount: nativeHierarchy.filter((node) => node.kind === "module")
      .length,
    lessonCount: nativeHierarchy.filter((node) => node.kind === "lesson")
      .length,
    emptyContainerCount: nativeHierarchy.filter((node) => node.emptyContainer)
      .length,
    nativeHierarchy,
    independentWorkbook: false,
    completeContent: false,
  };
}

/** Internal adapter for the comparison engine's workbook-shaped inventory.
 * Its provenance is native capture structure, never a supplied XLSX export. */
export function captureStructureWorkbook(capture: unknown) {
  const proof = captureStructureEvidence(capture);
  const rows: Cell[][] = [["CTI native material inventory", proof.courseId]];
  const nodes = new Map(proof.nativeHierarchy.map((node) => [node.id, node]));
  let moduleId = "",
    lessonId = "";
  function moduleHeading(node?: NativeCaptureHierarchyNode) {
    rows.push(
      ["Module"],
      ["***Name", node?.title || "", "", "", "", "", "", node?.id || ""],
    );
    moduleId = node?.id || "";
    lessonId = "";
  }
  function lessonHeading(node: NativeCaptureHierarchyNode) {
    rows.push(["Lesson"], ["***Name", node.title, "", "", "", "", "", node.id]);
    lessonId = node.id;
  }
  for (const node of proof.nativeHierarchy) {
    if (node.kind !== "item") {
      if (node.kind === "module") moduleHeading(node);
      else lessonHeading(node);
      continue;
    }
    const type = node.sourceContentType;
    const label = Object.prototype.hasOwnProperty.call(nativeTypeLabels, type)
      ? nativeTypeLabels[type]
      : "";
    if (!label)
      throw Error(
        `Native inventory item ${node.id} has unsupported type ${type}. Supply a matching Coursera XLSX; this type cannot be inferred as Reading.`,
      );
    const ancestors = node.ancestorIds.map((id) => nodes.get(id));
    const module = ancestors.find((ancestor) => ancestor?.kind === "module");
    const lesson = [...ancestors]
      .reverse()
      .find((ancestor) => ancestor?.kind === "lesson");
    // The workbook reader retains the last lesson until a module heading resets
    // it. Native preorder can return from an empty or nonempty lesson to a direct
    // module child. Restore that child's actual context, keyed by native IDs.
    if (moduleId !== (module?.id || "") || (!lesson && lessonId))
      moduleHeading(module);
    if (lesson && lessonId !== lesson.id) lessonHeading(lesson);
    rows.push([label, node.title, "", "", "", "", "", node.id]);
  }
  if (rows.length > 50000)
    throw Error("Derived structural inventory exceeds its row bound.");
  const bytes = writeWorkbook({
    name: "native-material-inventory",
    sheets: { Inventory: { values: rows } },
  });
  return {
    bytes,
    name: "CTI-derived-native-inventory.xlsx",
    proof,
  };
}
