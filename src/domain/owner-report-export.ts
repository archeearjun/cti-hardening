import { loadReportContent } from "./report-content-store.ts";
import {
  validateCourseraLinkedCaptures,
  type CourseraLinkedCapture,
} from "./coursera-linked-content.ts";
import type { SourceQuestionCapture } from "./external-source-questions.ts";
import {
  validateContentSnapshot,
  contentQuestion,
  type ContentEvidence,
} from "./content-evidence.ts";
import {
  ctiAnswerCheck,
  ctiAnswerText,
  CTI_ANSWER_VERSION,
} from "./cti-answer-check.ts";
import { itemContentView, itemContentText } from "./owner-content.ts";
import {
  withQuestionFollowUp,
  validateSourceCaptureTargets,
  questionComparisonsText,
  type ReviewedSourceCount,
} from "./question-counts.ts";
import {
  buildOwnerTasks,
  courseraLocation,
  ownerCourseLocation,
  validateOwnerReview,
  normalizeOwnerContext,
  type OwnerReview,
} from "./owner-actions.ts";
import { validateItemCheck } from "./item-check.ts";
import type { WorkspaceStore } from "./workspace-store.ts";
import type { EvidenceObject, WorkspaceRecord } from "./workspace-types.ts";
import { ownerScope } from "./owner-scope.ts";
import { moduleTimes, moduleTimesText } from "./owner-time.ts";

export interface ExportedOwnerReview {
  relevance?: OwnerReview["relevance"];
  recordId: string;
  itemKey: string;
  title: string;
  status: OwnerReview["status"];
  note: string;
  updatedAt: string;
  capture?: EvidenceObject;
  pluginCaptures: EvidenceObject[];
  sourceCounts: ReviewedSourceCount[];
  sourceCaptures: SourceQuestionCapture[];
  courseraLinkedCaptures: CourseraLinkedCapture[];
}

const text = (value: unknown) =>
  typeof value === "string" ? value : "not recorded";
const line = (value: unknown) => text(value).replace(/[\r\n]+/g, " ");

/** Read full records at export time: list() deliberately omits capture bodies.
 * Follow-ups belong to one saved audit, never just the most recent course run.
 * A failed/stale read must fail the export rather than silently omit evidence. */
export async function prepareOwnerReportExport(
  report: EvidenceObject,
  auditId: string,
  course: WorkspaceRecord,
  store: Pick<WorkspaceStore, "list" | "get">,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    !auditId ||
    !course.id ||
    (report.packageId && report.packageId !== course.id)
  )
    throw new Error("Open the saved report for this course before exporting.");
  const records = await store.list();
  const contentEvidence = await loadReportContent(
    report,
    auditId,
    course.id,
    store,
    records,
  );
  const summaries = records.filter(
    (r) =>
      r.kind === "item-review" &&
      r.packageId === course.id &&
      r.data.auditId === auditId,
  );
  signal?.throwIfAborted();
  const sourceMatches =
    !report.sourceScanSha256 ||
    report.sourceScanSha256 === course.data.scan?.fileSha256;
  const tasks = buildOwnerTasks(
    report.result || {},
    sourceMatches ? course.data.scan?.courseTree || [] : [],
    "",
    contentEvidence?.coursera,
  );
  if (report.contentEvidence) validateContentSnapshot(report.contentEvidence);
  const location = ownerCourseLocation(report.result || {});
  const reviews: ExportedOwnerReview[] = [];
  // Bounded reads also work with the authenticated, chunked team store.
  for (let offset = 0; offset < summaries.length; offset += 4) {
    const batch = summaries.slice(offset, offset + 4);
    const loaded = await Promise.all(batch.map((r) => store.get(r.id)));
    signal?.throwIfAborted();
    for (let i = 0; i < loaded.length; i++) {
      const r = loaded[i],
        summary = batch[i];
      if (
        r.id !== summary.id ||
        r.kind !== "item-review" ||
        r.packageId !== course.id ||
        r.data.auditId !== auditId ||
        r.data.itemKey !== summary.data.itemKey ||
        r.version !== summary.version
      )
        throw new Error(
          "Saved item work changed or does not match this report. Retry the export.",
        );
      const review: OwnerReview = r.data.review;
      if (
        !review ||
        typeof review.note !== "string" ||
        typeof r.data.itemKey !== "string"
      )
        throw new Error("Saved item work is invalid. No report was exported.");
      validateOwnerReview(review);
      const task = tasks.find((t) => t.key === r.data.itemKey);
      let capture: EvidenceObject | undefined;
      if (review.capture) {
        const c = review.capture;
        const route = courseraLocation(c.openedUrl);
        if (
          !task?.id ||
          !route ||
          (location && route.courseId !== location.courseId) ||
          !Array.isArray(c.expectations) ||
          c.expectations.some(
            (e) =>
              !e ||
              !["url", "file", "prompt"].includes(e.kind) ||
              typeof e.value !== "string" ||
              typeof e.label !== "string",
          )
        )
          throw new Error(
            "Saved item evidence does not identify this report's item. No report was exported.",
          );
        // Expectations are retained from the original import, not rebuilt from
        // a potentially replaced source scan. Recompute observational claims.
        capture = validateItemCheck(c, {
          auditId,
          itemId: task.id,
          courseId: location?.courseId || route.courseId,
          url: route.url,
          name: task.name,
          checks: c.expectations,
        });
      }
      const pluginCaptures = (review.pluginCaptures || []).map((p) => {
        const expectedCourse = location?.courseId || capture?.courseId;
        if (
          !task?.id ||
          p.auditId !== auditId ||
          p.itemId !== task.id ||
          (expectedCourse && p.courseId !== expectedCourse)
        )
          throw new Error(
            "Saved plugin evidence does not match this report. No report was exported.",
          );
        // Historical evidence remains usable; this is not a new import or a
        // claim that old plugin observations are still true today.
        return {
          ...p,
          wholePluginVerified: false,
          courseLaunchVerified: false,
          interactionVerified: false,
          binaryContentVerified: false,
        };
      });
      const sourceCounts = review.sourceCounts || [];
      const sourceCaptures = review.sourceCaptures || [];
      const courseraLinkedCaptures = review.courseraLinkedCaptures || [];
      validateCourseraLinkedCaptures(courseraLinkedCaptures, task?.id || "");
      validateSourceCaptureTargets(task?.sourceTargets || [], sourceCaptures);
      // Also bind reviewed source references to this audit's exact source mapping.
      withQuestionFollowUp(
        task?.questionComparisons || [],
        capture,
        sourceCounts,
        sourceCaptures.filter((c) =>
          task?.questionComparisons.some((r) => r.sourceKey === c.sourceKey),
        ),
      );
      reviews.push({
        relevance: review.relevance,
        sourceCounts,
        sourceCaptures,
        courseraLinkedCaptures,
        recordId: r.id,
        itemKey: r.data.itemKey,
        title: task?.name || r.title,
        status: review.status,
        note: review.note,
        updatedAt: review.updatedAt,
        ...(capture ? { capture } : {}),
        pluginCaptures,
      });
    }
  }
  reviews.sort(
    (a, b) =>
      a.itemKey.localeCompare(b.itemKey) ||
      a.recordId.localeCompare(b.recordId),
  );
  const questionComparisons = tasks
    .map((task) => {
      const review = reviews.find((r) => r.itemKey === task.key);
      return {
        itemKey: task.key,
        id: task.id,
        name: task.name,
        questionComparisons: withQuestionFollowUp(
          task.questionComparisons,
          review?.capture,
          review?.sourceCounts,
          review?.sourceCaptures.filter((c) =>
            task.questionComparisons.some((r) => r.sourceKey === c.sourceKey),
          ),
        ),
      };
    })
    .filter((group) => group.questionComparisons.length);
  const followUp = {
    itemScope: tasks.map(t => ({ itemKey: t.key, name: t.name, ...ownerScope(t, reviews.find(r => r.itemKey === t.key)) })),
    moduleTimes: moduleTimes(tasks, reviews.map(r => ({ itemKey: r.itemKey, review: r }))),
    contentEvidence,
    contentComparisons: tasks.map((task) => ({
      itemKey: task.key,
      name: task.name,
      view: itemContentView(
        task,
        contentEvidence,
        normalizeOwnerContext(report.ownerContext),
        reviews.find((r) => r.itemKey === task.key)?.capture,
        reviews.find((r) => r.itemKey === task.key)?.sourceCaptures,
        reviews.find((r) => r.itemKey === task.key)?.pluginCaptures,
        reviews.find((r) => r.itemKey === task.key)?.courseraLinkedCaptures,
      ),
    })),
    questionComparisons,
    schemaVersion: 1,
    auditId,
    packageId: course.id,
    exportedAt: new Date().toISOString(),
    originalAuditUnchanged: true,
    automatedResolution: false,
    reviews,
  };
  const answerChecks = followUp.contentComparisons.map((item) => {
    const entries: [string, ContentEvidence][] = [
      ...item.view.source.map((c): [string, ContentEvidence] => ["source", c]),
      ["coursera", item.view.coursera],
      ...item.view.linkedCoursera.map((c): [string, ContentEvidence] => [
        "coursera-linked",
        c,
      ]),
      ...item.view.observations.map((c): [string, ContentEvidence] => [
        "plugin-observation",
        c,
      ]),
      ...item.view.previousLinkedCoursera.map(
        (c): [string, ContentEvidence] => ["previous-coursera-linked", c],
      ),
      ...(item.view.previousCoursera
        ? [
            ["previous-coursera", item.view.previousCoursera] as [
              string,
              ContentEvidence,
            ],
          ]
        : []),
    ];
    return {
      itemKey: item.itemKey,
      evidence: entries.map(([side, c]) => ({
        side,
        basis: c.basis,
        capturedAt: c.capturedAt,
        questions: c.questions.map((q) => ({
          id: q.id,
          ordinal: q.ordinal,
          check: ctiAnswerCheck(q),
        })),
      })),
    };
  });
  const derivedAnswers = {
    version: CTI_ANSWER_VERSION,
    originalKeysUnchanged: true,
    items: answerChecks,
  };
  const lines = [
    "SAVED FOLLOW-UP EVIDENCE",
    `Saved report: ${line(auditId)} | exported: ${followUp.exportedAt}`,
    `Saved item reviews: ${reviews.length} | focused item checks: ${reviews.filter((r) => r.capture).length} | plugin-page checks: ${reviews.reduce((n, r) => n + r.pluginCaptures.length, 0)}`,
    "These later observations and manual notes supplement the original audit below. Its scores, findings and ingestion status are unchanged. No finding is automatically cleared; this is not publication approval.",
    "Only work saved against this exact report is included. Unsaved notes and checks attached to other reports are not included.",
    "CHECKLIST SCOPE: Instructor/instructional resources, archives and owner-excluded items are reference only. Their original findings below are retained history, not publishing tasks.",
    ...followUp.itemScope.filter(t => !t.included).map(t => `Excluded: ${t.name} [${t.itemKey}] — ${t.reason}`),
    moduleTimesText(followUp.moduleTimes),
  ];
  if (!reviews.length)
    lines.push(
      "NO SAVED FOLLOW-UP EVIDENCE FOR THIS REPORT. Import the item-check JSON into the same saved report that generated its script, then export that report. A new comparison is not required.",
    );
  for (const r of reviews) {
    lines.push(
      "",
      `${line(r.title)} [${line(r.itemKey)}]`,
      `  Recorded owner outcome: ${r.status} | saved: ${line(r.updatedAt)}`,
      `  Relevance: ${r.relevance || "auto"}`,
    );
    if (r.note) lines.push(`  Owner note: ${r.note.replace(/\n/g, "\n    ")}`);
    if (r.capture) {
      const c = r.capture,
        evaluation = c.evaluation;
      lines.push(
        `  Focused capture: ${line(c.extractorVersion)} | build: ${line(c.extractorBuild)} | captured: ${line(c.finishedAt)}`,
        `  Item: ${line(c.itemId)} | course: ${line(c.courseId)} | editor observed: ${evaluation.editorObserved ? "yes" : "no"}`,
        `  Captured question positions: ${evaluation.questionCount} | question coverage: ${evaluation.questionCoverageComplete ? "reported complete" : "not established"} | required answer-key coverage: ${evaluation.answerCoverageComplete ? "reported complete" : "not established"}`,
      );
      if (!location)
        lines.push(
          "  Course identity comes from the saved check; the original audit has no usable course URL.",
        );
      const questions: EvidenceObject[] =
        c.payload.structuredAssessment?.questions || [];
      questions.forEach((q, index) => {
        const options: EvidenceObject[] = Array.isArray(q.options)
          ? q.options
          : [];
        lines.push(
          `  Q${index + 1} [${line(q.id)}]: captured type=${line(q.type)} | options=${options.length} | option text reliable=${q.optionTextReliable === true ? "yes" : "not established"} | answer evidence=${line(q.answerEvidenceStatus)}`,
          `    Prompt: ${line(q.prompt)}`,
        );
        options.forEach((o, n) =>
          lines.push(`    Option ${n + 1}: ${line(o.text)}`),
        );
        lines.push(ctiAnswerText(contentQuestion(q, index)));
      });
      for (const finding of evaluation.findings)
        lines.push(
          `  ${line(finding.status)}: ${line(finding.label)} — ${line(finding.value)}`,
          `    ${line(finding.meaning)}`,
        );
      if (evaluation.pluginReadiness)
        lines.push(
          `  Embedded-page readiness: ${line(evaluation.pluginReadiness.status)}`,
        );
      lines.push(
        "  A captured prompt, type or option does not establish source fidelity, correct answers, learner access or working interactions. Review outstanding answer applicability and behavior separately.",
      );
    }
    for (const p of r.pluginCaptures)
      lines.push(
        `  Plugin-page capture: ${line(p.targetUrl)} | captured: ${line(p.finishedAt)} | status: ${line(p.status)}`,
        `    Captured text characters: ${typeof p.text === "string" ? p.text.length : 0}. Visible-screen evidence only; hidden screens, interaction, course launch and binary content remain unverified.`,
      );
  }
  lines.push("", questionComparisonsText(questionComparisons));
  for (const item of followUp.contentComparisons)
    lines.push("", itemContentText(item.name, item.view));
  const original =
    typeof report.report === "string"
      ? report.report
      : JSON.stringify(report.result, null, 2);
  lines.push("", "ORIGINAL AUDIT — UNCHANGED", original);
  return {
    text: lines.join("\n"),
    evidence: { ...report, followUp: { ...followUp, derivedAnswers } },
    followUp: { ...followUp, derivedAnswers },
  };
}
