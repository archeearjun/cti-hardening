import { validateItemCheck, type ItemCheckSpec } from "./item-check.ts";
import type { EvidenceObject } from "./workspace-types.ts";

export const EXTENSION_VERSION = "1.0.1";
export interface RefreshResponse {
  ok: boolean;
  error?: string;
  protocol?: number;
  version?: string;
  state?: string;
  phase?: string;
  detail?: string;
  result?: string;
}
export function extensionRequest(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<RefreshResponse> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const requestId = crypto.randomUUID();
    const finish = (error?: Error, response?: RefreshResponse) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(response!);
    };
    const abort = () =>
      finish(
        new DOMException(
          "Refresh cancelled. Previous evidence was preserved.",
          "AbortError",
        ),
      );
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== "CTI_EXTENSION_RESPONSE" ||
        event.data.requestId !== requestId
      )
        return;
      const r = event.data.response;
      if (!r || typeof r.ok !== "boolean")
        return finish(
          Error("Invalid extension response. Update the extension and retry."),
        );
      if (!r.ok)
        return finish(
          Error(typeof r.error === "string" ? r.error : "Item refresh failed."),
        );
      finish(undefined, r);
    };
    const timer = window.setTimeout(
      () =>
        finish(
          Error(
            "CTI extension did not respond. Install or reload it in this Chrome profile, then refresh CTI.",
          ),
        ),
      timeoutMs,
    );
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, { once: true });
    window.postMessage(
      {
        channel: "CTI_EXTENSION_REQUEST",
        requestId,
        body: { ...body, protocol: 1 },
      },
      location.origin,
    );
  });
}
export function validateRefreshCapture(
  text: string,
  spec: ItemCheckSpec,
  startedAt: number,
  previousCount = 0,
): { capture: EvidenceObject; problem: string } {
  if (new TextEncoder().encode(text).length > 16 * 1024 * 1024)
    throw Error(
      "Fresh capture exceeds 16 MiB. Previous evidence was preserved.",
    );
  const capture: EvidenceObject = validateItemCheck(JSON.parse(text), spec);
  if (
    capture.extractorVersion !== "v6.15.11" ||
    capture.extractorBuild !== "v6.15.11-activity-evidence-20261008"
  )
    throw Error(
      "The extension extractor is out of date. Update it before refreshing this item.",
    );
  const start = Date.parse(capture.startedAt),
    end = Date.parse(capture.finishedAt);
  if (
    !Number.isFinite(start) ||
    start < startedAt - 30000 ||
    end < start ||
    end > Date.now() + 30000
  )
    throw Error(
      "The returned capture is stale or has invalid timing. Previous evidence was preserved.",
    );
  const a = capture.payload.structuredAssessment;
  const q = a?.questions || [];
  const diagnostics = capture.crawl?.targetDiagnostics;
  const scoped =
    Array.isArray(diagnostics) &&
    diagnostics.length === 1 &&
    String(diagnostics[0]?.id) === spec.itemId;
  const completeness = a?.captureCompleteness;
  const declared = Number(
    a?.declaredQuestionCount ?? completeness?.declared ?? 0,
  );
  const hasQuestions =
    q.length > 0 ||
    declared > 0 ||
    previousCount > 0 ||
    /\/item\/(?:assignment|quiz|exam)\//i.test(spec.url);
  const questionGap =
    hasQuestions &&
    (completeness?.questionCoverageComplete !== true ||
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      (declared > 0 && q.length !== declared) ||
      completeness?.requiredAnswerCoverageComplete === false);
  const problem =
    !capture.editorObserved || !scoped
      ? "The exact item editor was not fully observed."
      : questionGap
        ? "Question capture is incomplete; the previous saved questions were retained."
        : capture.payload.textCaptureTruncated === true ||
            diagnostics[0].captureContract?.complete === false
          ? "Item content capture is incomplete."
          : diagnostics[0].stabilityTimedOut === true ||
              diagnostics[0].itemAttemptDeadlineReached === true ||
              capture.crawl?.timeBudgetExhausted === true
            ? "The item did not settle within the capture window."
            : "";
  return { capture, problem };
}
export function refreshedItemSummary(
  capture: EvidenceObject,
  previousCount?: number,
): string {
  const e = capture.evaluation;
  const observed = e.findings.filter(
    (f: EvidenceObject) => f.status === "OBSERVED",
  ).length;
  return `Refreshed ${new Date(capture.finishedAt).toLocaleString()}: ${e.questionCount} question records${previousCount === undefined ? "" : ` (previously ${previousCount})`}. ${observed}/${e.findings.length} expected references/prompts observed. Review the updated source comparison and answer checks below; this is not publication approval.`;
}
