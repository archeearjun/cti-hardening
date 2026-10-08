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
      extractor_version: "CTI adapter 2 / " + text(raw.meta?.extractor),
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
      const assessed = /quiz|exam|assessment|assignment|project/i.test(
        kind + " " + text(f.type),
      );
      const blocks = [],
        notes = [],
        seen = new Set();
      const add = (field, value, type) => {
        const content = text(value).trim();
        if (
          content &&
          (type === "assessment" || !seen.has(content)) &&
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
          add("Question " + (i + 1) + " / Prompt", q.prompt, "assessment");
          for (const [n, o] of (Array.isArray(q.options)
            ? q.options
            : []
          ).entries())
            add(
              "Question " + (i + 1) + " / Option " + (n + 1),
              [text(o.label) || text(o.text), text(o.description)]
                .filter(Boolean)
                .join("\n"),
              "assessment",
            );
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
      if (!assessed && identity(p.readingEditorEvidence))
        for (const frame of p.readingEditorEvidence.frames || []) {
          if (frame.documentStatus === "TEXT_CAPTURED")
            add("Reading frame excerpt", frame.textSample, "teaching");
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
        notes,
        route:
          [
            p.readingEditorEvidence?.route,
            p.typedEditorEvidence?.route,
            p.nativeAssignment?.contentBlockEvidence?.route,
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
        item.assessment_capture = {
          prompts_captured: blocks.filter((b) => /\/ Prompt$/.test(b.field))
            .length,
          options_captured: blocks.filter((b) => /\/ Option \d+$/.test(b.field))
            .length,
          declared_questions: Number.isInteger(
            assessment?.declaredQuestionCount,
          )
            ? assessment.declaredQuestionCount
            : null,
          has_unresolved_capture_issues:
            assessment?.captureCompleteness?.questionCoverageComplete ===
              false ||
            (assessment?.questions || []).some(
              (q) =>
                q.promptTextReliable === false ||
                q.optionTextReliable === false ||
                !!q.optionCaptureIssue,
            ),
          completeness: "partial_unverified",
        };
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
  root.CourseCtiAdapter = { matches, adapt, route };
})(globalThis);
