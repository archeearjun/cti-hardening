import { writeWorkbook, type Cell } from "../adapters/workbook.ts";
import { verifiedCourseraCaptureInventory } from "./coursera-background-extraction.ts";

// Native item kinds must be explicit. A future/unsupported type is not evidence
// of a reading and must not acquire a fabricated type through this adapter.
const nativeTypeLabels: Readonly<Record<string, string>> = {
  supplement: "Reading", reading: "Reading", lecture: "Reading",
  staffGraded: "Assignment", ungradedAssignment: "Assignment", peerGraded: "Assignment",
  discussionPrompt: "Discussion Prompt", quiz: "Quiz", exam: "Quiz", video: "Video",
  ungradedWidget: "Plugin", gradedWidget: "Plugin",
};

/** Internal adapter for the comparison engine's workbook-shaped inventory.
 * Its provenance is native capture structure, never a supplied XLSX export. */
export function captureStructureWorkbook(capture: unknown) {
  const proof = verifiedCourseraCaptureInventory(capture);
  const rows: Cell[][] = [["CTI native material inventory", proof.courseId]];
  const ids = new Set(proof.inventory.filter(i => i.contentBearing).map(i => i.itemId));
  function visit(node: any, depth: number) {
    if (Array.isArray(node.elements) && node.elements.length) {
      rows.push([depth === 0 ? "Module" : "Lesson"], ["***Name", node.originalName || node.name]);
      node.elements.forEach((child: any) => visit(child, depth + 1));
    } else if (ids.has(node.id)) {
      const type = node.content.typeName;
      const label = Object.prototype.hasOwnProperty.call(nativeTypeLabels, type) ? nativeTypeLabels[type] : "";
      if (!label) throw Error(`Native inventory item ${node.id} has unsupported type ${type}. Supply a matching Coursera XLSX; this type cannot be inferred as Reading.`);
      rows.push([label, node.originalName || node.name, "", "", "", "", "", node.id]);
    }
  }
  proof.material.elements.forEach((node: any) => visit(node, 0));
  if (rows.length > 50000) throw Error("Derived structural inventory exceeds its row bound.");
  const bytes = writeWorkbook({ name: "native-material-inventory", sheets: { Inventory: { values: rows } } });
  return { bytes, name: "CTI-derived-native-inventory.xlsx", proof: { kind: "VERIFIED_NATIVE_CAPTURE_INVENTORY",
    courseId: proof.courseId, materialHash: proof.materialHash, contentItemCount: ids.size,
    independentWorkbook: false, completeContent: false } };
}
