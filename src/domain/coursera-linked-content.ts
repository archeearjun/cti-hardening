import { capturedContent, type ContentSnapshot } from "./content-evidence.ts";
import {
  publicSourceUrl,
  validateSourceQuestionCapture,
  type SourceQuestionCapture,
} from "./external-source-questions.ts";
import type { OwnerTask } from "./owner-actions.ts";
import type { EvidenceObject } from "./workspace-types.ts";

/** The response uses the existing bounded public-fetch transport. This wrapper
 * records destination provenance; it is never source or native-question proof. */
export interface CourseraLinkedCapture {
  kind: "CTI_COURSERA_LINKED_PAGE";
  schemaVersion: 1;
  itemId: string;
  linkBasis: "RECORDED_COURSERA_LINK";
  courseLaunchVerified: false;
  fetch: SourceQuestionCapture;
}
export function courseraPageKey(itemId: string, url: string) {
  return JSON.stringify(["coursera-linked-page", itemId, publicSourceUrl(url)]);
}
export function courseraLinkedTargets(
  task: OwnerTask,
  snapshot?: ContentSnapshot,
  capture?: EvidenceObject,
): string[] {
  if (!task.id || task.sourceOnly) return [];
  const original = snapshot?.coursera.filter((c) => c.id === task.id) || [];
  // An observed newer editor supersedes old references. Never infer a
  // destination link from source expectations or source package content.
  const references =
    capture?.editorObserved === true
      ? capturedContent(capture.payload, { basis: "Coursera", itemId: task.id })
          .references
      : original.length === 1
        ? original[0].content.references
        : task.pluginTargets;
  return [...new Set(references.map(publicSourceUrl).filter(Boolean))].filter(
    (url) => courseraPageKey(task.id, url).length <= 4000,
  );
}
export function validateCourseraLinkedCaptures(
  value: unknown,
  itemId?: string,
): asserts value is CourseraLinkedCapture[] {
  if (!Array.isArray(value) || value.length > 12)
    throw Error("Invalid Coursera linked-page captures.");
  const seen = new Set<string>();
  for (const c of value) {
    if (
      !c ||
      c.kind !== "CTI_COURSERA_LINKED_PAGE" ||
      c.schemaVersion !== 1 ||
      typeof c.itemId !== "string" ||
      !c.itemId ||
      c.itemId.length > 500 ||
      (itemId !== undefined && c.itemId !== itemId) ||
      c.linkBasis !== "RECORDED_COURSERA_LINK" ||
      c.courseLaunchVerified !== false
    )
      throw Error("Coursera linked-page evidence does not identify this item.");
    validateSourceQuestionCapture(c.fetch);
    const key = courseraPageKey(c.itemId, c.fetch.targetUrl);
    if (c.fetch.sourceKey !== key || seen.has(key))
      throw Error("Invalid or duplicate Coursera linked-page identity.");
    seen.add(key);
  }
}
export function bindCourseraLinkedCapture(
  itemId: string,
  targets: string[],
  value: unknown,
): CourseraLinkedCapture {
  validateSourceQuestionCapture(value);
  if (!targets.includes(publicSourceUrl(value.targetUrl)))
    throw Error(
      "This URL was not recorded in the Coursera item. Evidence was not saved.",
    );
  const bound: CourseraLinkedCapture = {
    kind: "CTI_COURSERA_LINKED_PAGE",
    schemaVersion: 1,
    itemId,
    linkBasis: "RECORDED_COURSERA_LINK",
    courseLaunchVerified: false,
    fetch: value,
  };
  validateCourseraLinkedCaptures([bound], itemId);
  return bound;
}
