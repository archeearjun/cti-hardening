import type { OwnerTask } from "./owner-actions.ts";
import { ownerScope, ownerHierarchy, groupTasks } from "./owner-scope.ts";
import type { EvidenceObject, WorkspaceRecord } from "./workspace-types.ts";

export interface TimeEstimate {
  minutes: number | null;
  state: "OBSERVED" | "NOT_CAPTURED" | "CONFLICT";
  evidence: string;
  capturedAt: string;
}
export function timeMinutes(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : null;
}
export function capturedTime(payload: EvidenceObject = {}, capturedAt = ""): TimeEstimate {
  const direct = timeMinutes(payload.timeEstimateMinutes);
  const settings = timeMinutes(payload.nativeAssignment?.settings?.timeEstimateMinutes);
  const conflict = payload.timeEstimateState === "CONFLICT" || (payload.timeEstimateEvidence !== "labeled-editor-time-estimate" && direct !== null && settings !== null && direct !== settings);
  const minutes = conflict ? null : direct ?? settings;
  return { minutes, state: conflict ? "CONFLICT" : minutes === null ? "NOT_CAPTURED" : "OBSERVED", capturedAt,
    evidence: conflict ? "Captured outline and editor estimates disagree; refresh the item settings."
      : minutes === null ? "Time estimate was not captured."
      : payload.timeEstimateEvidence === "labeled-editor-time-estimate" ? "Captured time estimate in this Coursera item’s editor."
      : payload.timeEstimateEvidence === "outline-row" ? "Captured time estimate on this Coursera outline row."
      : String(payload.timeEstimateEvidence || (direct !== null ? "Captured Coursera estimate" : "Captured assignment settings")) };
}
export function validateTimeEstimate(value: unknown): asserts value is TimeEstimate {
  const v = value as TimeEstimate | null;
  if (!v || typeof v !== "object" || !["OBSERVED", "NOT_CAPTURED", "CONFLICT"].includes(v.state) ||
    typeof v.evidence !== "string" || v.evidence.length > 2000 || typeof v.capturedAt !== "string" ||
    (v.capturedAt !== "" && !Number.isFinite(Date.parse(v.capturedAt))) ||
    (v.state === "OBSERVED" ? typeof v.minutes !== "number" || timeMinutes(v.minutes) === null : v.minutes !== null))
    throw Error("Invalid captured time estimate.");
}
export function reviewTime(review: EvidenceObject | undefined): TimeEstimate | undefined {
  const c = review?.capture;
  if (!c) return undefined;
  return c.editorObserved === true ? capturedTime(c.payload, c.finishedAt || "")
    : { ...capturedTime({}, c.finishedAt || ""), evidence: "The latest item check did not observe this editor; its current estimate is unverified." };
}
export function taskTimes(task: OwnerTask, review?: EvidenceObject) {
  const baseline = task.timeEstimate || capturedTime();
  const observed = reviewTime(review) || review?.timeEstimate;
  if (observed) validateTimeEstimate(observed);
  // A newer failed/missing observation is unknown, never a silently reused
  // baseline or zero. Other unchanged items retain their dated baseline.
  const newer = observed && (!baseline.capturedAt || !observed.capturedAt || Date.parse(observed.capturedAt) >= Date.parse(baseline.capturedAt));
  return { baseline, latest: newer ? observed as TimeEstimate : baseline, refreshed: !!newer };
}
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "Not captured";
  const n = Math.round((minutes + Number.EPSILON) * 100) / 100;
  if (n < 60) return `${n} min`;
  const hours = Math.floor(n / 60), rest = Math.round((n - hours * 60) * 100) / 100;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}
export function timeTotals(tasks: OwnerTask[], reviewFor: (key: string) => EvidenceObject | undefined) {
  const included = tasks.filter(t => !t.sourceOnly && ownerScope(t, reviewFor(t.key)).included);
  const estimates = included.map(t => taskTimes(t, reviewFor(t.key)));
  const sum = (side: "baseline" | "latest") => ({
    minutes: estimates.reduce((n, t) => n + (t[side].minutes ?? 0), 0),
    captured: estimates.filter(t => t[side].state === "OBSERVED").length,
    total: included.length,
    missing: estimates.filter(t => t[side].state !== "OBSERVED").length,
  });
  return { baseline: sum("baseline"), latest: sum("latest"), refreshed: estimates.filter(t => t.refreshed).length,
    excluded: tasks.filter(t => !t.sourceOnly).length - included.length };
}
export function moduleTimes(tasks: OwnerTask[], reviews: WorkspaceRecord[] | { itemKey: string; review: EvidenceObject }[]) {
  const reviewFor = (key: string) => {
    const matches = reviews.filter(r => ("data" in r ? r.data.itemKey : r.itemKey) === key);
    return matches.length === 1 ? ("data" in matches[0] ? matches[0].data.review : matches[0].review) : undefined;
  };
  return ownerHierarchy(tasks).filter(g => !g.sourceOnly).map(g => ({ key: g.key, module: g.title, ...timeTotals(groupTasks(g), reviewFor) }));
}
export function moduleTimesText(rows: ReturnType<typeof moduleTimes>): string {
  return ["COURSE MODULE TIME ESTIMATES", "Learner-facing items only. Both columns use current relevance. Latest available combines dated baseline and fresh item checks; missing values are not zero.",
    ...rows.filter(r => r.latest.total > 0).map(r => `${r.module}: baseline ${formatMinutes(r.baseline.captured ? r.baseline.minutes : null)} (${r.baseline.captured}/${r.baseline.total} captured); latest available ${formatMinutes(r.latest.captured ? r.latest.minutes : null)} (${r.latest.captured}/${r.latest.total} captured); ${r.refreshed} item(s) refreshed${r.latest.missing ? "; PARTIAL TOTAL — missing estimates" : ""}.`),
  ].join("\n");
}
