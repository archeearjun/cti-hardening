(function (root) {
  "use strict";
  const practice = (i) =>
    /quiz|exam|assessment|assignment|project|discussion|peer|role.?play|dialogue/i.test(
      i.type || "",
    );
  function source(session, path) {
    const docs = (session.sources || [])
      .flatMap((s) => s.documents || [])
      .filter((d) => d.path === path);
    const refs = (session.references || []).filter((r) => r.filename === path);
    const gaps = (session.sources || [])
      .flatMap((s) => s.unread || [])
      .filter((u) => u.path === path);
    let item = null;
    for (const c of session.courses || [])
      for (const m of c.modules || [])
        for (const l of m.lessons || [])
          item ||=
            l.items.find((i) => `coursera/${c.branch_id}/${i.id}` === path) ||
            null;
    const readable = docs
      .concat(refs)
      .some((d) => root.CourseShell.textQuality(d.text).readable);
    const teaching =
      docs.some(
        (d) =>
          root.CourseShell.textQuality(d.text).readable &&
          (!/\[(?:TEACHING|ASSESSMENT|GAP) \|/.test(d.text) ||
            /\[TEACHING \|/.test(d.text)),
      ) ||
      refs.some(
        (r) =>
          !/^Shell_capture_receipt_/.test(r.filename) &&
          root.CourseShell.textQuality(r.text).readable,
      );
    return {
      known: !!(docs.length || refs.length || gaps.length || item),
      readable,
      teaching,
      docs,
      refs,
      gaps,
      item,
    };
  }
  function coverage(session, placement) {
    const c = session?.courses.find((c) =>
      placement.branch_id
        ? c.branch_id === placement.branch_id
        : c.title === placement.course,
    );
    const m = c?.modules.find((m) =>
      placement.module_id
        ? m.id === placement.module_id
        : m.title === placement.module,
    );
    const items = m?.lessons.flatMap((l) => l.items) || [];
    const assessments = items.filter(practice);
    const empty = assessments.filter(
      (i) => i.capture_coverage === "observed_empty",
    );
    const failed = assessments.filter(
      (i) => i.assessment_capture?.has_ingestion_failure === true,
    );
    const unread = assessments.filter(
      (i) =>
        i.capture_coverage !== "observed_empty" &&
        !failed.includes(i) &&
        !source(session, `coursera/${c.branch_id}/${i.id}`).readable &&
        !i.body_available,
    );
    const incomplete = assessments.filter((i) => {
      const q = i.assessment_capture;
      return (
        q &&
        !failed.includes(i) &&
        (q.has_unresolved_capture_issues === true ||
          (q.declared_questions != null &&
            q.prompts_captured < q.declared_questions) ||
          (q.visible_question_headers != null &&
            q.prompts_captured < q.visible_question_headers) ||
          (q.choice_controls_seen != null &&
            q.options_captured < q.choice_controls_seen))
      );
    });
    const external = items.filter((i) => i.external_resources?.length);
    return {
      course: c,
      module: m,
      items,
      assessments,
      empty,
      failed,
      unread,
      incomplete,
      external,
    };
  }
  function recovery(session, placement) {
    const cv = coverage(session, placement),
      messages = [];
    const names = (items) =>
      items.map((i) => `${i.title} (${i.id})`).join(", ");
    if (cv.empty.length)
      messages.push(
        "Source reconciliation needed: Coursera editors were observed empty for " +
          names(cv.empty) +
          ". Compare these items with the source LMS/IMSCC, restore intended practice or resolve its scope, then capture after changes. Repeating capture on the unchanged empty editors will not recover missing source content.",
      );
    if (cv.failed.length)
      messages.push(
        "Repair captured ingestion errors: " +
          names(cv.failed) +
          ". Error placeholders do not count as learner questions. Restore missing source content or diagrams in Coursera, then capture the repaired items. A captured failure is not a successful import.",
      );
    if (cv.unread.length)
      messages.push(
        "Read existing practice before using this draft: " +
          names(cv.unread) +
          ". Open the exact items to inspect their learner content. Capture again after resolving the recorded loading/content issue, or supply the original resource. Unread is not absent.",
      );
    if (cv.incomplete.length)
      messages.push(
        "Question/option coverage is incomplete for " +
          names(cv.incomplete) +
          ". Capture the missing visible prompts or applicable choices before deciding this adds new practice. Text-entry questions do not require options.",
      );
    return messages;
  }
  function problems(a, session) {
    if (a.status !== "draft") return [];
    const issues = recovery(session, a.placement),
      d = a.design;
    const cv = coverage(session, a.placement);
    if (!d) {
      issues.push(
        "Regenerate with the current AI packet: this result lacks its case facts, interaction plan, observable criteria and comparison with existing practice.",
      );
      return issues;
    }
    if (
      !d.learner_task.trim() ||
      !d.interaction.trim() ||
      d.success_criteria.length < 2 ||
      d.success_criteria.some((t) => !t.trim())
    )
      issues.push(
        "Complete the design brief: a concrete learner deliverable, how the conversation responds, and at least two observable success criteria.",
      );
    if (a.type === "role_play" && !d.case_facts.length)
      issues.push(
        "Supply self-contained case facts. Include any dimensions, constraints and capacities the learner needs; do not refer to an unavailable plan or diagram.",
      );
    const learnerText = a.fields
      .filter(
        (f) => !/Advanced|Intermediate|Beginner|AI persona/i.test(f.label),
      )
      .map((f) => f.text)
      .join("\n");
    for (const f of d.case_facts) {
      if (!f.text.trim() || !learnerText.includes(f.text))
        issues.push(
          "Put each declared case fact in the learner-facing scenario/purpose so the task can be completed without missing attachments.",
        );
      if (
        f.origin === "source" &&
        (!f.source_path || !source(session, f.source_path).teaching)
      )
        issues.push(
          "A source-derived case fact lacks readable teaching evidence: " +
            (f.source_path || "no source path") +
            ".",
        );
      if (
        f.origin === "fictional" &&
        !/fictional|hypothetical|invented practice/i.test(learnerText)
      )
        issues.push(
          "Label invented case facts as fictional practice in the learner-facing scenario.",
        );
    }
    if (
      cv.assessments.some(
        (i) =>
          !d.comparison.some((x) => x.item_id === i.id && x.difference.trim()),
      )
    )
      issues.push(
        "Explain how the proposed task differs from every existing practice item in this module; titles and counts alone are insufficient.",
      );
    const normalized = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const fieldText = normalized(
      a.fields
        .filter(
          (f) => !/^(Title|Advanced|Intermediate|Beginner)$/.test(f.label),
        )
        .map((f) => f.text)
        .join("\n"),
    );
    if (
      [d.learner_task, d.interaction].some(
        (t) => t.trim() && !fieldText.includes(normalized(t)),
      )
    )
      issues.push(
        "Put the brief’s learner deliverable and interaction plan into the actual Tasks / Scenario definition or Purpose of activity fields; a detailed brief cannot substitute for usable Coursera content.",
      );
    const rubricText = normalized(
      a.fields
        .filter((f) => /^(Advanced|Intermediate|Beginner)$/.test(f.label))
        .map((f) => f.text)
        .join("\n"),
    );
    if (
      d.success_criteria.some(
        (t) => t.trim() && !rubricText.includes(normalized(t)),
      )
    )
      issues.push(
        "Carry each observable success criterion into the grading fields, with distinct performance levels; generic confidence or difficulty wording does not describe task performance.",
      );
    const rubrics = a.fields.filter((f) =>
      /^(Advanced|Intermediate|Beginner)$/.test(f.label),
    );
    if (new Set(rubrics.map((f) => f.text.trim().toLowerCase())).size !== 3)
      issues.push(
        "Give distinct, observable Advanced, Intermediate and Beginner criteria.",
      );
    return [...new Set(issues)];
  }
  root.ActivityQuality = { source, coverage, recovery, problems, practice };
})(globalThis);
