import { CTI_RELEASE_REGISTRY_ } from "../engine/release.js";
import { parseCourseraShellUrl } from "./coursera-background-extraction.ts";

/** Run the maintained API reader on the quiz already open in Chrome. The linked
 * declarations precede the entry's run lock, so none of its crawl, recorder,
 * checkpoint, registration or reload orchestration is installed. */
export function createCourseraAssessmentProbeScript(
  shellUrl: string,
  currentScript: string,
): string {
  const target = parseCourseraShellUrl(shellUrl);
  if (new URL(shellUrl.trim()).origin !== "https://www.coursera.org")
    throw new Error("Use the exact https://www.coursera.org authoring origin.");
  const source = String(currentScript || "").replace(/^javascript:/, "");
  const current = CTI_RELEASE_REGISTRY_.courseraExtractor;
  const marker = "  const CTI_RUN_LOCK_KEY =";
  const offset = source.indexOf(marker);
  const expectedEntry = "(async function ctiCourseraCaptureV" +
    current.version.slice(1).replaceAll(".", "") + "() {";
  if (!source.startsWith(expectedEntry) || offset < 0 ||
    source.indexOf(marker, offset + marker.length) !== -1 ||
    !source.includes(current.build) ||
    !source.slice(0, offset).includes("function collectCourseraAssessmentApiV61524("))
    throw new Error("The quiz API check needs the current extractor. Reload CTI before copying it.");
  const config = { courseId: target.courseId, version: current.version,
    buildId: current.build, durationMs: 120000 };
  return "void " + source.slice(0, offset) + "\n" +
    "return (" + runCourseraAssessmentProbe.toString() + ")(" +
    JSON.stringify(config) + ",{collect:collectCourseraAssessmentApiV61524," +
    "layout:assessmentLayoutV61313,identify:assessmentApiEditorIdentityV61524," +
    "count:assessmentPartCountV8});\n})();";
}

interface ProbeConfig { courseId: string; version: string; buildId: string; durationMs: number }
interface ProbeApi {
  collect: (root: Element, fp: any, options: any) => Promise<any>;
  layout: (root: Element) => any;
  identify: (root: Element, fp: any, options: any) => any;
  count: (root: Element) => number;
}

// Self-contained for the copied console program. Only the small aggregate report
// enters the DOM/window/clipboard; raw definitions remain local to the API reader.
async function runCourseraAssessmentProbe(config: ProbeConfig, api: ProbeApi) {
  const host = window as Window & {
    __CTI_COURSERA_ASSESSMENT_PROBE?: { running: boolean; result: any };
    __CTI_ITEM_FIDELITY_RUN_LOCK?: { running: boolean; lastHeartbeatAt?: number; startedAt?: number };
  };
  if (host.__CTI_COURSERA_ASSESSMENT_PROBE?.running) return;
  const began = Date.now(), deadline = began + config.durationMs;
  const state = { running: true, result: null as any };
  host.__CTI_COURSERA_ASSESSMENT_PROBE = state;
  const root = document.createElement("section");
  root.setAttribute("aria-label", "CTI current quiz API check");
  Object.assign(root.style, { position: "fixed", bottom: "12px", right: "12px",
    zIndex: "2147483647", width: "360px", maxWidth: "calc(100vw - 24px)" });
  const shadow = root.attachShadow({ mode: "closed" });
  const panel = document.createElement("div");
  Object.assign(panel.style, { background: "white", color: "#172238", border: "1px solid #9ba5b6",
    borderRadius: "8px", padding: "14px", font: "13px/1.5 system-ui", boxShadow: "0 2px 12px #0003" });
  const title = document.createElement("strong"); title.textContent = "CTI · Current quiz API check";
  const help = document.createElement("p");
  help.textContent = "Reads this quiz only, for up to two minutes. No question clicks or page reloads. This is not a course capture.";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const output = document.createElement("textarea"); output.readOnly = true; output.hidden = true;
  output.setAttribute("aria-label", "Safe quiz API diagnostic result");
  Object.assign(output.style, { width: "100%", height: "150px", boxSizing: "border-box" });
  const copyButton = document.createElement("button"); copyButton.textContent = "Copy diagnostic result"; copyButton.disabled = true;
  const closeButton = document.createElement("button"); closeButton.textContent = "Close"; closeButton.style.marginLeft = "8px";
  panel.append(title, help, status, output, copyButton, closeButton); shadow.append(panel);
  document.documentElement.append(root);
  let expected = 0, captured = 0, requests = 0, finished = false, timer: ReturnType<typeof setTimeout> | undefined;
  const controllers = new Set<AbortController>();
  const safeCode = (value: unknown, fallback: string) => {
    const code = typeof value === "string" ? value : "";
    return /^[A-Z0-9_]{1,100}$/.test(code) ? code : fallback;
  };
  function render() {
    if (!finished) status.textContent = "Reading quiz definitions · " + captured + "/" + expected +
      " verified · " + requests + " GET requests · " + Math.floor((Date.now() - began) / 1000) + "s";
  }
  function finish(code: string, value?: any) {
    if (finished) return;
    finished = true; clearTimeout(timer);
    for (const controller of controllers) controller.abort(); controllers.clear();
    const assessment = value?.assessment, diagnostics = value?.diagnostics;
    const questions = Array.isArray(assessment?.questions) ? assessment.questions : [];
    const keyCount = questions.filter((q: any) => q.answerKeyEvidence?.method === "EXACT_CORRECT_OPTION_ID" &&
      Array.isArray(q.correctAnswers) && q.correctAnswers.length === 1).length;
    const expectedCount = Number(assessment?.declaredQuestionCount || expected);
    const verified = value?.captured === true && expectedCount > 0 && questions.length === expectedCount &&
      keyCount === expectedCount && assessment?.captureCompleteness?.requiredAnswerCoverageComplete === true;
    const resources = new Set(["authoringAssignmentQuestionGroups.v1", "authoringAssignmentMachineEvaluableQuestions.v1"]);
    const failures = (Array.isArray(diagnostics?.failures) ? diagnostics.failures : []).slice(0, 40).map((failure: any) => ({
      resource: resources.has(failure?.resource) ? failure.resource : "UNKNOWN_RESOURCE",
      status: Number.isInteger(failure?.status) && failure.status >= 0 && failure.status <= 599 ? failure.status : 0,
      code: safeCode(failure?.reason, "API_REQUEST_FAILED"),
    }));
    state.result = { kind: "CTI_COURSERA_ASSESSMENT_API_CHECK_V1", notForCourseAudit: true,
      scope: "CURRENT_QUIZ_ONLY", version: config.version, buildId: config.buildId,
      status: verified ? "VERIFIED_CURRENT_QUIZ" : value?.attempted ? "INCOMPLETE_CURRENT_QUIZ" : "NOT_VERIFIED",
      expectedCount, capturedCount: questions.length, keyCount, requests,
      bytes: Number.isFinite(diagnostics?.bytes) ? Math.max(0, diagnostics.bytes) : 0,
      stopReason: safeCode(value?.stopReason || code, "API_CHECK_FAILED"),
      inventoryMethod: safeCode(diagnostics?.inventoryDiscovery?.method, "NOT_ESTABLISHED"),
      elapsedMs: Date.now() - began, failures,
      missingGroupCount: Array.isArray(diagnostics?.missingGroups) ? diagnostics.missingGroups.length : 0,
      missingDefinitionCount: Array.isArray(diagnostics?.missingDefinitions) ? diagnostics.missingDefinitions.length : 0,
      unsupportedGroupCount: Array.isArray(diagnostics?.unsupportedGroups) ? diagnostics.unsupportedGroups.length : 0,
      wholeCourseVerified: false };
    state.running = false;
    output.value = JSON.stringify(state.result, null, 2); output.hidden = false; copyButton.disabled = false;
    status.textContent = verified ? "This quiz verified: " + questions.length + " definitions and explicit keys in " +
      ((Date.now() - began) / 1000).toFixed(1) + "s. Copy the diagnostic result." :
      "Check stopped: " + state.result.stopReason + ". Copy the diagnostic result; no full-course rerun is needed.";
  }
  copyButton.onclick = async () => {
    try { await navigator.clipboard.writeText(output.value); copyButton.textContent = "Copied"; }
    catch { output.focus(); output.select(); copyButton.textContent = "Select and copy the result below"; }
  };
  closeButton.onclick = () => { finish("OPERATOR_STOPPED"); root.remove(); };
  try {
    const address = new URL(location.href);
    const match = address.pathname.match(/^\/teach\/[^/]+\/([A-Za-z0-9_-]+)\/content\/item\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\/?$/);
    if (window !== window.top || address.origin !== "https://www.coursera.org" || !match || match[1] !== config.courseId) {
      finish("OPEN_EXACT_QUIZ_IN_EXPECTED_COURSE"); return;
    }
    const lock = host.__CTI_ITEM_FIDELITY_RUN_LOCK;
    if (lock?.running && Date.now() - Number(lock.lastHeartbeatAt || lock.startedAt || 0) < 45000) {
      finish("STOP_ACTIVE_EXTRACTOR_BEFORE_CHECK"); return;
    }
    const sidebar = [...document.querySelectorAll('[data-testid="item-layout-left-sidebar"]')]
      .find(node => node.isConnected);
    const layout = sidebar ? api.layout(sidebar) : null;
    const fp = { id: match[2], type: "Assessment", typeName: "project", payload: {} };
    const identity = layout ? api.identify(layout.root, fp, { certifiedItem: true, courseId: config.courseId }) : null;
    if (!identity?.verified || identity.method !== "ITEM_SPECIFIC_ROUTE") {
      finish("CURRENT_QUIZ_EDITOR_NOT_CERTIFIED"); return;
    }
    expected = Number(api.count(layout.root) || 0); render();
    const nativeFetch = window.fetch.bind(window);
    const fetchImpl = (input: RequestInfo | URL, options: RequestInit = {}) => {
      if (finished || Date.now() >= deadline) return Promise.reject(new Error("API_CHECK_DEADLINE"));
      const controller = new AbortController(); controllers.add(controller);
      const signal = options.signal;
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener("abort", () => controller.abort(), { once: true });
      requests++; render();
      return nativeFetch(input, { ...options, signal: controller.signal });
    };
    timer = setTimeout(() => finish("API_CHECK_DEADLINE"), Math.max(0, deadline - Date.now()));
    const result = await api.collect(layout.root, fp, { certifiedItem: true, courseId: config.courseId,
      deadline, fetchImpl, onProgress: (count: number, total: number) => {
        if (!finished) { captured = count; expected = total; render(); }
      } });
    finish("API_CHECK_FINISHED", result);
  } catch { finish("API_CHECK_FAILED"); }
}
