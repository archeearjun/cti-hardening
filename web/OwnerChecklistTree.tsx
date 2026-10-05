import type { ReactNode } from "react";
import type { OwnerTask } from "../src/domain/owner-actions";
import type { EvidenceObject } from "../src/domain/workspace-types";
import { groupTasks, type OwnerGroup } from "../src/domain/owner-scope";
import { formatMinutes, timeTotals } from "../src/domain/owner-time";

export default function OwnerChecklistTree({ groups, visible, reviewFor, renderItem }: {
  groups: OwnerGroup[];
  visible: Set<string>;
  reviewFor: (key: string) => EvidenceObject | undefined;
  renderItem: (task: OwnerTask) => ReactNode;
}) {
  function render(group: OwnerGroup, depth: number): ReactNode {
    const tasks = groupTasks(group);
    if (!tasks.some(t => visible.has(t.key))) return null;
    const totals = timeTotals(tasks, reviewFor);
    return <details key={group.key} open className="owner-outline-group">
      <summary>
        <strong>{group.sourceOnly && depth === 0 ? "Source evidence · " : ""}{group.title}</strong>
        <span className="hint">{tasks.filter(t => visible.has(t.key)).length} displayed item(s)</span>
        {!group.sourceOnly && totals.latest.total > 0 && <span className="hint">
          Latest available: {totals.latest.captured ? formatMinutes(totals.latest.minutes) : "Not captured"}
          {totals.latest.missing ? ` · partial (${totals.latest.captured}/${totals.latest.total} estimates captured)` : ""}
        </span>}
      </summary>
      <div className="owner-outline-children">
        {group.children.map(child => "children" in child ? render(child, depth + 1) : visible.has(child.key) ? <div key={child.key}>{renderItem(child)}</div> : null)}
      </div>
    </details>;
  }
  return <div aria-label="Checklist in Coursera order">{groups.map(g => render(g, 0))}</div>;
}
