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
      extractor_version: "CTI adapter 1 / " + text(raw.meta?.extractor),
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
        "CTI evidence projection: answer keys, feedback, browser metadata and credentials are omitted. Original CTI files remain unchanged.",
        "CTI fingerprints may lack module/lesson IDs. Add the matching current XLSX to resolve placement. Captured titles alone do not establish identity.",
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
        notes = [];
      const add = (field, value, type) => {
        const content = text(value).trim();
        if (content && root.CourseShell.textQuality(content).readable)
          blocks.push({ field, text: content, kind: type });
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
              o.text,
              "assessment",
            );
        }
        for (const key of [
          "learnerPrompt",
          "learnerDirections",
          "learnerExpectations",
        ])
          add("Assignment / " + key, p.nativeAssignment?.[key], "assessment");
      } else if (
        p.textScopeKind === "reading-content-field" ||
        p.textScopeKind === "discussion-content-field"
      ) {
        add("CTI identity-scoped body", p.textSample, "teaching");
      } else
        notes.push(
          "No supported identity-scoped teaching field in this CTI item. Generic authoring-page text was not used.",
        );
      const trail = text(f.path)
        .split(/\s+>\s+/)
        .filter(Boolean);
      const item = {
        id: f.id,
        title: text(f.name) || f.id,
        type: kind,
        position: position + 1,
        ancestors: trail
          .slice(0, 2)
          .map((title, i) => ({
            id: "",
            title,
            key: trail.slice(0, i + 1).join(" > "),
          })),
        blocks,
        coverage: blocks.length ? "partial" : "unread",
        notes,
        route: route(
          p.readingEditorEvidence?.route || p.typedEditorEvidence?.route,
          branch,
          f.id,
        ),
      };
      if (assessed)
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
          completeness: "partial_unverified",
        };
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
