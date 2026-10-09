(function (root) {
  "use strict";
  const text = (value) => (typeof value === "string" ? value : "");
  const idPattern = /^[A-Za-z0-9_-]+$/;
  function matches(raw) {
    return Array.isArray(raw?.fingerprints) && !!raw?.page?.courseId;
  }
  function route(value, branch, item) {
    try {
      const u = new URL(value);
      if (u.origin !== "https://www.coursera.org" || u.username || u.password)
        return "";
      const p = u.pathname.match(
        /^\/teach\/[^/]+\/([A-Za-z0-9_-]+)\/content\/item\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\/?$/,
      );
      return p && p[1] === branch && p[2] === item ? u.origin + u.pathname : "";
    } catch {
      return "";
    }
  }
  function externalUrl(value) {
    try {
      const u = new URL(value);
      // Preserve only recorded public resource URLs. Never export signed links,
      // credentials or a rewritten URL that might point to a different item.
      return u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !/[?=&]/.test(u.hash) &&
        [...u.searchParams.keys()].every((k) => /^(p|page)$/.test(k))
        ? u.href
        : "";
    } catch {
      return "";
    }
  }
  function failedImagePrompt(value) {
    return /^\s*\[Error:\s*Image could not be created\]\s*$/i.test(text(value));
  }
  function placeholderOption(value) {
    return /^Enter an option(?:\.{3}|…)?$/i.test(
      text(value)
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .trim(),
    );
  }
  function learnerMetrics(assessment, blocks, ingestionFailure) {
    const questions = Array.isArray(assessment?.questions)
      ? assessment.questions
      : [];
    const receipt = assessment?.captureCompleteness;
    const failed =
      ingestionFailure || questions.some((q) => failedImagePrompt(q.prompt));
    const prompts = blocks.filter((b) => /\/ Prompt$/.test(b.field)).length;
    const options = blocks.filter((b) => /\/ Option \d+$/.test(b.field)).length;
    const declared = Number.isInteger(assessment?.declaredQuestionCount)
      ? assessment.declaredQuestionCount
      : null;
    let unresolved = receipt?.questionCoverageComplete === false;
    let placeholderOptions = 0;
    let knownTypes = true;
    for (const q of questions) {
      const choices = Array.isArray(q.options) ? q.options : [];
      const placeholders = choices.filter((o) =>
        placeholderOption(text(o.label) || text(o.text)),
      ).length;
      placeholderOptions += placeholders;
      const choiceType =
        /^(single-select|multiple-select|multiple-choice|true-false)$/.test(
          q.type,
        );
      const openType =
        /^(text-entry|numeric|numeric-entry|essay|short-answer|free-response|file-upload)$/.test(
          q.type,
        );
      knownTypes &&= choiceType || openType;
      unresolved ||=
        placeholders > 0 ||
        q.promptTextReliable === false ||
        !root.CourseShell.textQuality(q.prompt).readable ||
        !!q.optionCaptureIssue ||
        ((choiceType || choices.length > 0) &&
          (q.optionTextReliable === false ||
            !choices.length ||
            choices.some(
              (o) =>
                !root.CourseShell.textQuality(text(o.label) || text(o.text))
                  .readable,
            )));
    }
    const ids = questions.map((q) => q.courseraQuestionId || q.id);
    const complete =
      !failed &&
      !unresolved &&
      knownTypes &&
      declared > 0 &&
      questions.length === declared &&
      prompts === declared &&
      receipt?.questionCoverageComplete === true &&
      receipt.declared === declared &&
      (receipt.declaredContentParts == null ||
        receipt.declaredContentParts === declared) &&
      receipt.captured === declared &&
      receipt.uniqueQuestionIds === declared &&
      Array.isArray(receipt.missingQuestionOrdinals) &&
      !receipt.missingQuestionOrdinals.length &&
      ids.every((id) => typeof id === "string" && id.length > 0) &&
      new Set(ids).size === declared &&
      questions.every(
        (q) => !q.options?.length || q.optionTextReliable === true,
      );
    return {
      prompts_captured: prompts,
      options_captured: options,
      placeholder_options: placeholderOptions,
      declared_questions: declared,
      has_unresolved_capture_issues:
        failed || unresolved || (declared != null && prompts !== declared),
      has_ingestion_failure: failed,
      completeness: failed
        ? "ingestion_failure"
        : complete
          ? "learner_text_captured"
          : "partial_unverified",
    };
  }
  function observedEmpty(p, item, branch, blocks) {
    const e = p.emptyEditorEvidence,
      c = p.captureContract;
    return (
      !blocks.length &&
      !p.structuredAssessment?.questions?.length &&
      !(p.structuredAssessment?.declaredQuestionCount > 0) &&
      e?.status === "OBSERVED_EMPTY_EDITOR" &&
      e.itemId === item &&
      e.scope === "EXACT_ITEM_ASSIGNMENT_LAYOUT" &&
      e.marker === "Content you add will show in order here." &&
      Number.isInteger(e.samples) &&
      e.samples >= 2 &&
      e.intervalMs >= 1000 &&
      Number.isFinite(Date.parse(e.observedAt)) &&
      !!route(e.route, branch, item) &&
      c?.itemId === item &&
      c.status === "UNRESOLVED_SOURCE_REVIEW" &&
      c.reasons?.includes("OBSERVED_EMPTY_EDITOR_REQUIRES_SOURCE_REVIEW")
    );
  }
  function adapt(raw) {
    if (
      !matches(raw) ||
      !idPattern.test(raw.page.courseId) ||
      raw.fingerprints.length > 5000 ||
      !Number.isFinite(Date.parse(raw.extractedAt))
    )
      throw Error("Unsupported CTI Coursera capture.");
    const branch = raw.page.courseId;
    const page = new URL(raw.page.url);
    if (
      page.origin !== "https://www.coursera.org" ||
      !page.pathname.includes("/" + branch + "/content")
    )
      throw Error("CTI course URL and identity do not agree.");
    const capture = {
      format: "coursera-activity-capture",
      schema_version: 1,
      created_at: raw.extractedAt,
      extractor_version: "CTI adapter 3 / " + text(raw.meta?.extractor),
      course: {
        id: branch,
        title:
          text(raw.page.title)
            .replace(/\s*\|\s*Coursera.*$/i, "")
            .split("|")
            .at(-1)
            .trim() || branch,
        url: page.origin + page.pathname,
      },
      capture_scope: "cti_snapshot",
      status: "imported",
      items: [],
      issues: [
        "CTI evidence projection omits explicit key/feedback fields, settings and browser credentials. Internal captured bodies can contain worked examples; never copy a source bank into learner context. Original CTI files remain unchanged.",
        "Exact ancestry is retained when recorded. Older CTI snapshots may need a matching current XLSX to resolve module/lesson IDs.",
      ],
    };
    for (const [position, f] of raw.fingerprints.entries()) {
      if (
        !idPattern.test(text(f?.id)) ||
        !f.payload ||
        typeof f.payload !== "object"
      )
        throw Error("Malformed CTI item identity or payload.");
      const p = f.payload,
        assessment = p.structuredAssessment;
      const kind = text(f.typeName) || text(f.type) || "unknown";
      const assessed =
        root.CourseShell.isAssessmentType(kind) ||
        root.CourseShell.isAssessmentType(text(f.type));
      const blocks = [],
        notes = [],
        seen = new Set();
      const add = (field, value, type) => {
        const content = text(value).trim();
        if (
          content &&
          (type !== "teaching" || !seen.has(content)) &&
          root.CourseShell.textQuality(content).readable
        ) {
          seen.add(content);
          blocks.push({ field, text: content, kind: type });
        }
      };
      if (assessed) {
        // Explicit projection only: never copy generic assessment textSample,
        // scores, correctness, feedback, rubrics or arbitrary nested fields.
        for (const [i, q] of (Array.isArray(assessment?.questions)
          ? assessment.questions
          : []
        ).entries()) {
          add(
            "Question " +
              (i + 1) +
              (failedImagePrompt(q.prompt)
                ? " / Ingestion error"
                : " / Prompt"),
            q.prompt,
            failedImagePrompt(q.prompt) ? "gap" : "assessment",
          );
          for (const [n, o] of (Array.isArray(q.options)
            ? q.options
            : []
          ).entries()) {
            const label = text(o.label) || text(o.text);
            add(
              "Question " +
                (i + 1) +
                (placeholderOption(label)
                  ? " / Unresolved option placeholder "
                  : " / Option ") +
                (n + 1),
              [label, text(o.description)].filter(Boolean).join("\n"),
              placeholderOption(label) ? "gap" : "assessment",
            );
          }
        }
        for (const key of [
          "learnerPrompt",
          "learnerDirections",
          "learnerExpectations",
        ])
          add("Assignment / " + key, p.nativeAssignment?.[key], "assessment");
        for (const b of p.nativeAssignment?.contentBlockEvidence?.blocks || [])
          add(
            "Assignment block / " + (text(b.title) || "Learner instructions"),
            b.text,
            "assessment",
          );
      } else if (
        p.textScopeKind === "reading-content-field" ||
        [
          "discussion-content-field",
          "discussion-prompt",
          "discussion-prompt-field",
          "document-viewer",
        ].includes(p.textScopeKind)
      ) {
        add(
          p.textScopeKind === "document-viewer"
            ? "Document viewer excerpt (pages not verified)"
            : "CTI identity-scoped body",
          p.textSample,
          /discussion/i.test(kind) ? "assessment" : "teaching",
        );
      } else
        notes.push(
          "No supported identity-scoped teaching field in this CTI item. Generic authoring-page text was not used.",
        );
      const identity = (e) => e?.itemId === f.id && e?.courseId === branch;
      const externalResources = [];
      if (!assessed && identity(p.readingEditorEvidence))
        for (const frame of p.readingEditorEvidence.frames || []) {
          if (frame.documentStatus === "TEXT_CAPTURED")
            add("Reading frame excerpt", frame.textSample, "teaching");
          if (frame.documentStatus !== "TEXT_CAPTURED") {
            externalResources.push({
              url: externalUrl(frame.url),
              status: "external_body_unread",
              action:
                "Open the recorded resource and supply its teaching text or original file. Another shell capture may still be unable to read a cross-origin frame.",
            });
          }
          notes.push(
            "Reading frame: " +
              text(frame.documentStatus) +
              (frame.textTruncated
                ? "; text truncated."
                : "; full document/interaction not verified."),
          );
        }
      if (
        identity(p.typedEditorEvidence) &&
        p.pluginEvidence?.itemId === f.id
      ) {
        for (const frame of p.pluginEvidence.frames || [])
          if (
            frame.access === "READABLE" &&
            frame.surfaceStatus === "CONTENT_OBSERVED"
          )
            // Interactive plugin text can contain tasks or feedback. Keep internal,
            // never use it as certified teaching support or learner context.
            add(
              "Plugin visible interaction (internal comparison only)",
              frame.textSample,
              "assessment",
            );
        notes.push(
          "Plugin state is a visible excerpt; hidden steps, media and complete interaction remain unverified.",
        );
      }
      const trail = text(f.path)
        .split(/\s+>\s+/)
        .filter(Boolean);
      const item = {
        id: f.id,
        title: text(f.name) || f.id,
        type: kind,
        position: position + 1,
        ancestors:
          Array.isArray(f.ancestors) && f.ancestors.length
            ? f.ancestors.map((a) => ({
                id: idPattern.test(text(a.id)) ? a.id : "",
                title: text(a.title),
                key: text(a.key) || text(a.id) || text(a.title),
              }))
            : trail.slice(-2).map((title, i) => ({
                id: "",
                title,
                key: trail.slice(0, i + 1).join(" > "),
              })),
        blocks,
        coverage: blocks.length ? "partial" : "unread",
        external_resources: externalResources,
        notes,
        route:
          [
            p.readingEditorEvidence?.route,
            p.typedEditorEvidence?.route,
            p.nativeAssignment?.contentBlockEvidence?.route,
            p.emptyEditorEvidence?.route,
            ...(Array.isArray(raw.meta?.activeSpaCrawl?.targetDiagnostics)
              ? raw.meta.activeSpaCrawl.targetDiagnostics
              : []
            )
              .filter((d) => d.id === f.id)
              .map((d) => d.route),
          ]
            .map((value) => route(value, branch, f.id))
            .find(Boolean) || "",
      };
      if (assessed || /discussion/i.test(kind))
        item.assessment_capture = learnerMetrics(
          assessment,
          blocks,
          p.ingestionFailure?.detected === true ||
            p.captureContract?.status === "INGESTION_FAILURE_CAPTURED",
        );
      if (item.assessment_capture?.has_ingestion_failure)
        notes.push(
          "An ingestion failure is recorded in this item. Error placeholders are gap evidence, not learner prompts. Restore missing source content/media in Coursera and capture the repaired item before verifying practice coverage.",
        );
      if (assessed && observedEmpty(p, f.id, branch, blocks)) {
        item.coverage = "observed_empty";
        notes.push(
          "Coursera's exact assignment editor was observed empty in two stable samples. Compare this item with the source LMS/IMSCC and restore intended practice or resolve its scope. Do not repeat extraction just to recover text from an empty editor. Source practice is not established absent.",
        );
      }
      if (item.assessment_capture?.completeness === "learner_text_captured")
        notes.push(
          "All declared question prompts and applicable choice text were captured in this snapshot. Text-entry and file-upload questions need no choice options. This receipt covers learner text only, not source equivalence, media, grading configuration or approval. Answer keys are deliberately excluded from activity design.",
        );
      if (p.textScopeKind === "document-viewer")
        notes.push(
          "Rendered viewer excerpt only; full PDF pages, diagrams and formulas need review. Captured PDF originals are processed separately when available.",
        );
      if (p.textCaptureTruncated)
        notes.push("CTI marked its body text as truncated.");
      if (
        (p.files?.length || 0) +
        (p.images?.length || 0) +
        (p.links?.length || 0)
      )
        notes.push(
          "Attachment/media/link references exist. Their full content is not verified by this projection.",
        );
      notes.push(
        "Capture status: " +
          text(p.captureContract?.status) +
          ". Text presence does not certify teaching or assessment completeness.",
      );
      capture.items.push(item);
    }
    return root.CourseShell.validate(capture);
  }
  root.CourseCtiAdapter = { matches, adapt, route, externalUrl };
})(globalThis);
