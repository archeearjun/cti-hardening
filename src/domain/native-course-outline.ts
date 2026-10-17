import { courseraItemUrl, ownerCourseLocation } from "./owner-urls.ts";
import type { EvidenceObject } from "./workspace-types.ts";

export interface NativeCourseOutlineNode {
  id: string;
  title: string;
  kind: "module" | "lesson" | "item";
  ancestorIds: string[];
  emptyContainer: boolean;
  sourceContentType: string;
}

export interface NativeCourseOutlineEvidence {
  kind: "VERIFIED_NATIVE_CAPTURE_INVENTORY";
  courseId: string;
  materialHash: string;
  contentItemCount: number;
  inventoryEntryCount: number;
  moduleCount: number;
  lessonCount: number;
  emptyContainerCount: number;
  nativeHierarchy: NativeCourseOutlineNode[];
  independentWorkbook: false;
  completeContent: false;
}

function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Validate a saved display projection. This checks its structure and course
 * binding; it does not reproduce the importer’s retained-source hash proof. */
export function validateNativeCourseOutlineEvidence(
  value: unknown,
  expectedCourseId = "",
): NativeCourseOutlineEvidence {
  function fail(reason: string): never {
    throw Error(`Invalid captured native outline: ${reason}.`);
  }
  if (
    !object(value) ||
    value.kind !== "VERIFIED_NATIVE_CAPTURE_INVENTORY" ||
    typeof value.courseId !== "string" ||
    !/^[A-Za-z0-9_-]{8,160}$/.test(value.courseId) ||
    typeof value.materialHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.materialHash) ||
    value.independentWorkbook !== false ||
    value.completeContent !== false
  )
    fail("the recorded structural evidence or its scope is invalid");
  if (expectedCourseId && value.courseId !== expectedCourseId)
    fail("the outline belongs to a different Coursera course");
  const countKeys = [
    "contentItemCount",
    "inventoryEntryCount",
    "moduleCount",
    "lessonCount",
    "emptyContainerCount",
  ] as const;
  for (const key of countKeys)
    if (
      !Number.isSafeInteger(value[key]) ||
      value[key] < 0 ||
      value[key] > 50000
    )
      fail(`the ${key} count is outside the supported bound`);
  if (
    !Array.isArray(value.nativeHierarchy) ||
    value.nativeHierarchy.length > 50000 ||
    value.inventoryEntryCount > 20000
  )
    fail("the recorded hierarchy is missing or exceeds the supported bound");

  const seen = new Map<string, NativeCourseOutlineNode>();
  const children = new Map<string, number>();
  let activePath: string[] = [];
  let modules = 0,
    lessons = 0,
    items = 0,
    emptyContainers = 0;
  for (const entry of value.nativeHierarchy) {
    if (
      !object(entry) ||
      typeof entry.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(entry.id) ||
      seen.has(entry.id) ||
      typeof entry.title !== "string" ||
      !entry.title.trim() ||
      entry.title.length > 20000 ||
      !["module", "lesson", "item"].includes(entry.kind) ||
      typeof entry.emptyContainer !== "boolean" ||
      !Array.isArray(entry.ancestorIds) ||
      entry.ancestorIds.length > 32 ||
      typeof entry.sourceContentType !== "string" ||
      entry.sourceContentType.length > 512
    )
      fail("a node has an invalid or duplicate native identity, title or type");
    const ancestors = entry.ancestorIds;
    if (
      ancestors.length > activePath.length ||
      ancestors.some((id: unknown, index: number) => id !== activePath[index])
    )
      fail("parent paths do not retain the recorded preorder");
    for (let index = 0; index < ancestors.length; index++) {
      const parent = seen.get(ancestors[index]);
      if (
        !parent ||
        parent.kind === "item" ||
        parent.ancestorIds.length !== index
      )
        fail("a node has an absent or non-container parent");
    }
    if (entry.kind === "item") {
      if (!entry.sourceContentType.trim() || entry.emptyContainer)
        fail(
          "a content item has no native type or is marked as an empty folder",
        );
      items++;
    } else {
      if (
        entry.sourceContentType !== "" ||
        (entry.kind === "module") !== (ancestors.length === 0)
      )
        fail("a container has an ambiguous kind, path or native content type");
      if (entry.kind === "module") modules++;
      else lessons++;
      if (entry.emptyContainer) emptyContainers++;
    }
    if (ancestors.length) {
      const parentId = ancestors.at(-1)!;
      children.set(parentId, (children.get(parentId) || 0) + 1);
    }
    const node = entry as NativeCourseOutlineNode;
    seen.set(node.id, node);
    activePath =
      node.kind === "item" ? [...ancestors] : [...ancestors, node.id];
  }
  for (const node of seen.values())
    if (
      node.kind !== "item" &&
      node.emptyContainer !== ((children.get(node.id) || 0) === 0)
    )
      fail("an empty-container flag contradicts the recorded children");
  if (
    modules !== value.moduleCount ||
    lessons !== value.lessonCount ||
    items !== value.contentItemCount ||
    emptyContainers !== value.emptyContainerCount ||
    items + emptyContainers !== value.inventoryEntryCount ||
    modules + lessons + items !== value.nativeHierarchy.length
  )
    fail("the recorded counts contradict the hierarchy");
  return value as NativeCourseOutlineEvidence;
}

/** Old reports have no such projection. Do not manufacture it from findings,
 * workbook rows, or a source package's differently scoped hierarchy. */
export function nativeCourseOutlineEvidence(
  result: EvidenceObject,
  override = "",
): NativeCourseOutlineEvidence | null {
  if (!Object.hasOwn(result, "nativeCourseOutlineEvidence")) return null;
  return validateNativeCourseOutlineEvidence(
    result.nativeCourseOutlineEvidence,
    ownerCourseLocation(result, override)?.courseId,
  );
}

// Unknown native kinds remain visible, but do not inherit a guessed editor
// family through an unrelated diagnostic or similarly named owner item.
const knownNativeTypes = new Set([
  "supplement",
  "reading",
  "lecture",
  "staffGraded",
  "ungradedAssignment",
  "peerGraded",
  "discussionPrompt",
  "quiz",
  "exam",
  "video",
  "ungradedWidget",
  "gradedWidget",
]);

export function nativeOutlineItemUrl(
  result: EvidenceObject,
  node: NativeCourseOutlineNode,
  override = "",
): string {
  return node.kind === "item" && knownNativeTypes.has(node.sourceContentType)
    ? courseraItemUrl(result, node.id, override, {
        typeName: node.sourceContentType,
      })
    : "";
}

export function nativeCourseOutlineText(result: EvidenceObject): string {
  const evidence = nativeCourseOutlineEvidence(result);
  if (!evidence) return "";
  return [
    "CAPTURED COURSERA SHELL OUTLINE",
    `Native course: ${evidence.courseId}; retained material SHA-256: ${evidence.materialHash}`,
    `${evidence.moduleCount} modules; ${evidence.lessonCount} lessons; ${evidence.contentItemCount} content items; ${evidence.emptyContainerCount} zero-child containers; ${evidence.inventoryEntryCount} native inventory entries.`,
    "Structural evidence only. A zero-child container is not an empty content body. Content fidelity, interaction behavior and independent XLSX agreement remain separate.",
    ...evidence.nativeHierarchy.map(
      (node) =>
        `${"  ".repeat(node.ancestorIds.length)}${node.kind.toUpperCase()} [${node.id}] ${node.title}${node.emptyContainer ? " [observed zero children]" : ""}${node.kind === "item" ? ` [native type: ${node.sourceContentType}]` : ""}`,
    ),
    "",
  ].join("\n");
}
