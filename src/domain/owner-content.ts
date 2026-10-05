import {
  capturedContent,
  contentEvidenceText,
  type ContentEvidence,
  type ContentSnapshot,
} from "./content-evidence.ts";
import type { OwnerTask } from "./owner-actions.ts";
import { resolveSourceTopic } from "./source-navigation.ts";
import {
  publicSourceUrl,
  type SourceQuestionCapture,
} from "./external-source-questions.ts";
import {
  courseraLinkedTargets,
  validateCourseraLinkedCaptures,
  type CourseraLinkedCapture,
} from "./coursera-linked-content.ts";
import type { EvidenceObject } from "./workspace-types.ts";
import { validateSourceCaptureTargets } from "./question-counts.ts";
import {
  sourceBankSummary,
  sourceBankSettings,
} from "./source-bank-summary.ts";

export interface ItemContentView {
  source: ContentEvidence[];
  coursera: ContentEvidence;
  previousCoursera?: ContentEvidence;
  observations: ContentEvidence[];
  courseraTargets: string[];
  linkedCoursera: ContentEvidence[];
  previousLinkedCoursera: ContentEvidence[];
}
function fetchedContent(
  s: SourceQuestionCapture,
  destination = false,
): ContentEvidence[] {
  const source: ContentEvidence[] = [];
  const banks = s.bank ? [s.bank] : s.observedBanks || [];
  for (const bank of banks) {
    const content = capturedContent(
      {
        structuredAssessment: {
          questions: bank.questions,
          declaredQuestionCount:
            s.status === "CAPTURED" ? bank.count : undefined,
          definitionCoverage: {
            completenessVerified: s.status === "CAPTURED",
          },
        },
      },
      {
        basis: `${destination ? "Fetched Coursera linked page" : "Fetched external source"} · bank ${bank.id}`,
        capturedAt: s.capturedAt,
        url: s.targetUrl,
        source: true,
      },
    );
    content.limitations.push(s.reason);
    content.limitations.push(sourceBankSummary(bank));
    const settings = sourceBankSettings(bank);
    if (settings)
      content.limitations.push(
        "Explicit assessment settings (bank overrides can supersede question settings):\n" +
          settings,
      );
    if (bank.questions.some((q) => q.promptTruncated === undefined))
      content.limitations.push(
        "Older source capture: prompt truncation was not recorded. Refresh source questions for current text evidence.",
      );
    if (bank.selectedPerAttempt !== null)
      content.limitations.push(
        `${bank.count} bank definitions; ${bank.selectedPerAttempt} selected per attempt.`,
      );
    source.push(content);
  }
  for (const page of s.pages || [])
    source.push(
      capturedContent(
        {
          textSample: page.text,
          textLength: page.observedCharacters,
          textTruncated: page.truncated,
        },
        {
          basis: destination
            ? "Fetched Coursera linked page (static document only)"
            : "Fetched public page text (static document only)",
          capturedAt: s.capturedAt,
          url: page.url,
          source: true,
        },
      ),
    );
  return source;
}

export function itemContentView(
  task: OwnerTask,
  snapshot?: ContentSnapshot,
  context: EvidenceObject = {},
  capture?: EvidenceObject,
  sources: SourceQuestionCapture[] = [],
  plugins: EvidenceObject[] = [],
  linked: CourseraLinkedCapture[] = [],
): ItemContentView {
  validateSourceCaptureTargets(task.sourceTargets, sources);
  validateCourseraLinkedCaptures(linked, task.id);
  const courseraTargets = courseraLinkedTargets(task, snapshot, capture);
  const linkedCoursera: ContentEvidence[] = [],
    previousLinkedCoursera: ContentEvidence[] = [];
  for (const c of linked) {
    const current = courseraTargets.includes(
      publicSourceUrl(c.fetch.targetUrl),
    );
    for (const evidence of fetchedContent(c.fetch, true)) {
      evidence.limitations.push(
        "Fetched independently from a URL recorded in this Coursera item. This does not verify loading inside Coursera, learner access, interactions, or native Coursera question counts.",
      );
      if (!current) {
        evidence.basis =
          "Previous linked-page observation — current Coursera reference unverified";
        evidence.limitations.push(
          "This URL is absent from the current captured references. This older observation is retained separately and is not current destination evidence.",
        );
      }
      (current ? linkedCoursera : previousLinkedCoursera).push(evidence);
    }
  }
  const original = snapshot?.coursera.filter((c) => c.id === task.id) || [];
  const old =
    original.length === 1
      ? { ...original[0].content, url: task.url || original[0].content.url }
      : capturedContent(
          { textSample: task.excerpt },
          {
            basis: task.sourceOnly
              ? "No mapped Coursera item"
              : "Older report excerpt",
            excerpt: true,
          },
        );
  const source: ContentEvidence[] = [];
  for (const s of sources) source.push(...fetchedContent(s));
  for (const s of task.sources) {
    source.push(
      capturedContent(s.sourcePayload, {
        basis: `Source package · ${s.title}`,
        source: true,
      }),
    );
    const topic = resolveSourceTopic(s, context),
      live =
        topic && snapshot?.brightspace.filter((c) => c.id === String(topic.id));
    if (topic && live?.length === 1)
      source.push({ ...live[0].content, url: topic.url });
  }
  if (!source.length)
    source.push(
      capturedContent(
        {},
        {
          basis: "Source content not captured or source mapping unresolved",
          source: true,
        },
      ),
    );
  const current = capture
    ? capturedContent(capture.payload, {
        basis: "Focused Coursera item capture",
        capturedAt: capture.finishedAt,
        url: capture.openedUrl,
        itemId: task.id,
        editorObserved: capture.editorObserved === true,
      })
    : old;
  return {
    source,
    courseraTargets,
    linkedCoursera,
    previousLinkedCoursera,
    coursera: current,
    ...(capture ? { previousCoursera: old } : {}),
    observations: plugins.map((p) =>
      capturedContent(
        {
          textSample: p.text,
          textTruncated: p.textTruncated,
          textLength: p.observedLength,
        },
        {
          basis: "Separate plugin page observation — course launch unverified",
          capturedAt: p.finishedAt,
          url: p.openedUrl,
        },
      ),
    ),
  };
}
export function itemContentText(name: string, view: ItemContentView) {
  return [
    `CONTENT COMPARISON — ${name}`,
    "Saved evidence, not a live learner rendering. Source and destination positions are not paired by number.",
    "SOURCE",
    ...view.source.map(contentEvidenceText),
    "COURSERA",
    contentEvidenceText(view.coursera),
    ...view.linkedCoursera.map(contentEvidenceText),
    ...view.previousLinkedCoursera.map(contentEvidenceText),
    ...(view.previousCoursera
      ? [
          "PREVIOUS COURSERA OBSERVATION",
          contentEvidenceText(view.previousCoursera),
        ]
      : []),
    ...view.observations.map(contentEvidenceText),
  ].join("\n\n");
}
