(function (root) {
  "use strict";
  function safetyProblems(activity, session) {
    const problems = [];
    const text = [
      ...activity.fields.map((f) => f.text),
      activity.context.text,
    ].join("\n");
    if (
      /"(?:format|schemaVersion)"\s*:\s*"?(?:course-context-prep|coursera-activity-capture|course-activity-packet)|"(?:fingerprints|correctAnswers|structuredAssessment)"\s*:|BEGIN COURSE DATA|\[(?:TEACHING|ASSESSMENT|GAP) \||SESSION\.json\s*[\n:{]/i.test(
        text,
      )
    )
      problems.push(
        "Internal evidence container detected in activity content. Remove the capture/bank and provide only reviewed activity-specific text.",
      );
    if (
      /\b(?:correct answer|answer key|worked solution)\s*(?::|=|is\b)/i.test(
        text,
      )
    )
      problems.push(
        "Possible assessment key or worked answer detected. Review and remove protected assessment material before copying.",
      );
    for (const source of session?.sources || [])
      for (const doc of source.documents || []) {
        if (
          activity.context.text &&
          doc.text?.length > 120 &&
          activity.context.text.includes(doc.text)
        )
          problems.push(
            "Additional context contains an entire internal evidence document. Prepare a clean, activity-specific context instead.",
          );
      }
    return [...new Set(problems)];
  }
  function check(result, session, activity) {
    const blocking = [],
      warnings = [];
    if (!session)
      blocking.push(
        "Load the matching course evidence to validate this placement.",
      );
    else {
      if (
        result.bundle_created_at !== session.created_at ||
        result.title !== session.title ||
        result.mode !== session.phase
      )
        blocking.push(
          "This proposal belongs to a different course snapshot or workflow stage. Revalidate against the loaded evidence.",
        );
      const p = activity.placement,
        cs = session.courses.filter(
          (c) => c.branch_id === p.branch_id && p.branch_id,
        );
      if (cs.length !== 1)
        blocking.push("Course branch is unresolved or ambiguous.");
      else {
        const c = cs[0],
          ms = c.modules.filter((m) => m.id === p.module_id && p.module_id),
          m = ms.length === 1 ? ms[0] : null;
        const ls =
            m?.lessons.filter((l) => l.id === p.lesson_id && p.lesson_id) || [],
          l = ls.length === 1 ? ls[0] : null;
        if (!m || !l)
          blocking.push("Exact module and lesson IDs are unresolved.");
        else {
          if (
            c.title !== p.course ||
            m.title !== p.module ||
            l.title !== p.lesson
          )
            blocking.push("Placement titles conflict with the recorded IDs.");
          const ai = l.items.findIndex((i) => i.id === p.after_item_id),
            before = ai >= 0 ? l.items[ai + 1] : null;
          if (ai < 0 || l.items[ai].title !== p.after)
            blocking.push("The preceding item is missing or does not match.");
          if (
            before
              ? p.before_item_id !== before.id || p.before !== before.title
              : !!p.before_item_id || p.before !== "End of lesson"
          )
            blocking.push(
              "The following boundary is not the next item or confirmed end of lesson.",
            );
          if (p.export_file && p.export_file !== c.filename)
            blocking.push(
              "The placement export filename differs from this snapshot.",
            );
          if (p.row && l.items[ai]?.row !== p.row)
            blocking.push("The placement row differs from this snapshot.");
          const items = m.lessons
            .flatMap((x) => x.items)
            .filter((i) =>
              /quiz|exam|assessment|assignment|project/i.test(i.type),
            );
          if (
            items.some(
              (i) =>
                !i.assessment_capture ||
                i.assessment_capture.completeness !== "learner_text_captured",
            )
          )
            warnings.push(
              "Some existing practice lacks verified learner-text coverage. Review the recorded gaps before deciding this adds new practice.",
            );
        }
      }
      let readableTeaching = false;
      for (const e of activity.evidence) {
        const resolved = root.ActivityQuality.source(session, e.source_path);
        if (
          resolved.teaching &&
          e.purpose !== "gap" &&
          e.purpose !== "comparison"
        )
          readableTeaching = true;
        if (!resolved.known)
          blocking.push(
            "Supporting source path is not present: " + e.source_path,
          );
        else if (!resolved.readable) {
          const message =
            resolved.item?.capture_coverage === "observed_empty"
              ? "Observed-empty Coursera editor: " +
                e.source_path +
                ". Reconcile intended practice with the source LMS/IMSCC; this is not an unread editor."
              : "Known item has no readable body: " +
                e.source_path +
                ". Capture or inspect this item before using it as evidence.";
          if (activity.status === "draft" && e.purpose !== "gap")
            blocking.push(message);
          else warnings.push(message);
        }
      }
      // Held proposals need the same concrete recovery instructions as drafts.
      blocking.push(
        ...root.ActivityQuality.recovery(session, activity.placement),
      );
      blocking.push(...root.ActivityQuality.problems(activity, session));
      if (!readableTeaching)
        blocking.push(
          "No readable teaching support is cited. Capture or add the relevant teaching before drafting learner content.",
        );
    }
    if (result.mode === "opportunity" && activity.status === "draft")
      blocking.push(
        "Content Map mode produces concepts; final authoring fields need final-stage review.",
      );
    blocking.push(...safetyProblems(activity, session));
    return {
      blocking: [...new Set(blocking)],
      warnings,
      canCopy: activity.status === "draft" && !blocking.length,
    };
  }
  function itemLink(session, activity) {
    const c = session?.courses.find(
      (c) => c.branch_id === activity.placement.branch_id,
    );
    const item = c?.modules
      .flatMap((m) => m.lessons.flatMap((l) => l.items))
      .find((i) => i.id === activity.placement.after_item_id);
    return item
      ? root.CourseCtiAdapter.route(item.link, c.branch_id, item.id)
      : "";
  }
  function resolveDecisions(result, session) {
    const seen = new Set();
    for (const d of result.module_decisions) {
      const found = session.courses
        .filter((c) =>
          d.branch_id ? c.branch_id === d.branch_id : c.title === d.course,
        )
        .flatMap((c) =>
          c.modules
            .filter((m) =>
              d.module_id ? m.id === d.module_id : m.title === d.module,
            )
            .map((m) => ({ c, m })),
        );
      if (found.length !== 1)
        throw Error(
          "Module decision is unresolved or ambiguous: " +
            d.module +
            ". Return exact branch_id and module_id from the packet.",
        );
      const { c, m } = found[0];
      if (d.course !== c.title || d.module !== m.title)
        throw Error("Module decision names disagree with their IDs.");
      d.branch_id = c.branch_id;
      d.module_id = m.id;
      const key = JSON.stringify([d.branch_id, d.module_id || d.module]);
      if (seen.has(key)) throw Error("Duplicate module decision.");
      seen.add(key);
    }
    for (const a of result.activities)
      if (
        !result.module_decisions.some(
          (d) =>
            d.course === a.placement.course &&
            d.module === a.placement.module &&
            (!d.module_id || d.module_id === a.placement.module_id),
        )
      )
        throw Error("An activity has no matching module decision.");
    return result;
  }
  root.ActivityReadiness = {
    check,
    safetyProblems,
    itemLink,
    resolveDecisions,
  };
})(globalThis);
