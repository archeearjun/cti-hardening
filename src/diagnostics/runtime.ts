import { CTI_QA_ENGINE_BUILD_ID_ } from "../engine/matching/text.js";
import { createPerformanceTrace } from "./performance.js";
export type PerformanceTrace = ReturnType<typeof createPerformanceTrace>;
// One local UI/worker realm, never part of engine services or saved evidence.
let trace = createPerformanceTrace();
const reports = new Map<string, unknown>();
export function performanceTrace() {
  return trace;
}
export function enablePerformance(enabled: boolean) {
  if (trace.enabled) {
    trace.finish("partial");
    retainPerformance(trace.snapshot());
  }
  trace = createPerformanceTrace({
    enabled,
    operation: "session",
    build: CTI_QA_ENGINE_BUILD_ID_,
  });
  return trace;
}
export function retainPerformance(report: any) {
  if (!report || report.kind !== "CTI_PERFORMANCE_DIAGNOSTICS") return;
  if (reports.size >= 30 && !reports.has(report.runId))
    reports.delete(reports.keys().next().value!);
  reports.set(report.runId, report);
}
export function performanceReports() {
  return [...reports.values(), ...(trace.enabled ? [trace.snapshot()] : [])];
}
