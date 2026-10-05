import type { OwnerTask, OwnerReview } from "./owner-actions.ts";

export type ItemRelevance = "auto" | "relevant" | "not_relevant";
export function referenceArea(path: string): boolean {
  // Folder names, not title/body keywords: Student Resources and a lesson
  // about archives remain learner content. A named ancestor applies to children.
  return path.split(/\s*(?:>|\||\/)\s*/).some(part =>
    /^(?:instructor resources?|instruction(?:al)? resources?|archives?)$/i.test(part.trim()),
  );
}
export function ownerScope(task: Pick<OwnerTask, "path" | "findings" | "sourceOnly">, review?: Pick<OwnerReview, "relevance">) {
  const choice = review?.relevance || "auto";
  if (choice === "relevant") return { included: true, choice, reason: "Included by the assignment owner." };
  if (choice === "not_relevant") return { included: false, choice, reason: "Excluded by the assignment owner. No publishing or repair task is required." };
  // Source-only findings can inherit source scope. A learner-facing destination
  // must not disappear just because its matching source lives in an archive.
  const sourceReference = task.sourceOnly && task.findings.length > 0 && task.findings.every(f => referenceArea(String(f.sourcePath || "")));
  const excluded = referenceArea(task.path) || sourceReference;
  return { included: !excluded, choice, reason: excluded
    ? "Instructor/instructional resources or archive material: retained for reference, excluded from publishing work."
    : "Included in the learner-facing checklist by default." };
}

export interface OwnerGroup {
  key: string;
  title: string;
  path: string[];
  sourceOnly: boolean;
  children: (OwnerGroup | OwnerTask)[];
}
export function ownerHierarchy(tasks: OwnerTask[]): OwnerGroup[] {
  const roots: OwnerGroup[] = [];
  // Consecutive equal paths share a group; repeated later paths are not moved
  // or collapsed across another module with the same title.
  for (const task of tasks) {
    const path = task.path.split(/\s*>\s*/).filter(Boolean);
    const parts = path.length ? path : ["Placement not recorded"];
    let siblings: (OwnerGroup | OwnerTask)[] = roots;
    for (let depth = 0; depth < parts.length; depth++) {
      const last = siblings.at(-1);
      let group = last && "children" in last && last.title === parts[depth] && last.sourceOnly === task.sourceOnly ? last : undefined;
      if (!group) {
        group = { key: `${task.key}:group:${depth}`, title: parts[depth], path: parts.slice(0, depth + 1), sourceOnly: task.sourceOnly, children: [] };
        siblings.push(group);
      }
      siblings = group.children;
    }
    siblings.push(task);
  }
  return roots;
}
export function groupTasks(group: OwnerGroup): OwnerTask[] {
  return group.children.flatMap(child => "children" in child ? groupTasks(child) : [child]);
}
