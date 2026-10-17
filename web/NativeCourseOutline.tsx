import type { ReactNode } from "react";
import {
  nativeCourseOutlineEvidence,
  nativeOutlineItemUrl,
  type NativeCourseOutlineNode,
} from "../src/domain/native-course-outline";
import type { EvidenceObject } from "../src/domain/workspace-types";

export default function NativeCourseOutline({
  result,
  courseUrl = "",
}: {
  result: EvidenceObject;
  courseUrl?: string;
}) {
  let evidence;
  try {
    evidence = nativeCourseOutlineEvidence(result, courseUrl);
  } catch (error) {
    return (
      <p role="alert" data-testid="native-course-outline-error">
        Captured Coursera shell outline could not be shown:{" "}
        {error instanceof Error ? error.message : String(error)} The saved
        findings remain separate from this invalid outline.
      </p>
    );
  }
  if (!evidence) return null;
  const children = new Map<string, NativeCourseOutlineNode[]>();
  for (const node of evidence.nativeHierarchy) {
    const parentId = node.ancestorIds.at(-1) || "";
    const siblings = children.get(parentId) || [];
    siblings.push(node);
    children.set(parentId, siblings);
  }
  function renderNode(node: NativeCourseOutlineNode): ReactNode {
    const url = nativeOutlineItemUrl(result, node, courseUrl);
    return (
      <li key={node.id} data-native-id={node.id} data-native-kind={node.kind}>
        <strong>{node.title}</strong>{" "}
        <span>
          ·{" "}
          {node.kind === "item"
            ? "Content item"
            : node.kind === "module"
              ? "Module"
              : "Lesson"}
          {node.kind === "item" && (
            <>
              {" "}
              · native type: <code>{node.sourceContentType}</code>
            </>
          )}
        </span>
        <p className="hint">
          Native ID: <code>{node.id}</code>
          {node.emptyContainer && " · 0 child entries observed"}
          {url && (
            <>
              {" "}
              ·{" "}
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open captured item ↗
              </a>
            </>
          )}
        </p>
        {!!children.get(node.id)?.length && (
          <ul>{children.get(node.id)!.map(renderNode)}</ul>
        )}
      </li>
    );
  }
  return (
    <details className="scope" data-testid="native-course-outline">
      <summary>Captured Coursera shell outline</summary>
      <p>
        Original captured order, names and native identities, including
        containers with no child entries. This is structural evidence from the
        retained native capture; it does not establish complete item content,
        media or live playback. A container with 0 child entries is not evidence
        of an empty reading, quiz or widget.
      </p>
      <p>
        {evidence.moduleCount} modules · {evidence.lessonCount} lessons ·{" "}
        {evidence.contentItemCount} content items ·{" "}
        {evidence.emptyContainerCount} containers with 0 child entries
      </p>
      <p className="hint">
        Captured course: <code>{evidence.courseId}</code>. Repeated names retain
        separate native IDs. This view does not add owner tasks or change the
        comparison verdict.
      </p>
      {evidence.nativeHierarchy.length ? (
        <ul aria-label="Captured native Coursera hierarchy">
          {(children.get("") || []).map(renderNode)}
        </ul>
      ) : (
        <p>
          No module, lesson or content entries were observed in this captured
          material tree.
        </p>
      )}
    </details>
  );
}
