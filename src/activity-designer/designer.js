(function (root) {
  "use strict";
  const FORMAT = "course-activity-design";
  const required = {
    dialogue: [
      "Title",
      "Purpose of activity",
      "Advanced",
      "Intermediate",
      "Beginner",
    ],
    role_play: [
      "Title",
      "Scenario definition",
      "Tasks",
      "AI persona title",
      "Advanced",
      "Intermediate",
      "Beginner",
      "Overview — Scenario",
      "Overview — Learner goal",
      "Communication mode",
    ],
  };
  const template = {
    format: FORMAT,
    schema_version: 1,
    title: "Use the bundle title",
    mode: "final",
    bundle_created_at: "Copy SESSION.created_at exactly",
    summary: "One short recommendation.",
    activities: [
      {
        id: "A01",
        type: "role_play",
        status: "draft",
        title: "Activity title",
        placement: {
          course: "Exact course title",
          module: "Exact module title",
          lesson: "Exact lesson title",
          after: "Exact preceding item title",
          before: "Exact following item title or End of lesson",
          branch_id: "Exact ID when available, otherwise empty string",
          module_id: "",
          lesson_id: "",
          after_item_id: "",
          before_item_id: "",
          export_file: "",
          row: null,
          notes: "",
        },
        objective: "One observable learning goal",
        why: "One sentence: added practice value over existing work.",
        minutes: 15,
        fields: [
          { label: "Title", text: "Activity title" },
          {
            label: "Scenario definition",
            text: "Complete configuration, not a placeholder.",
          },
          { label: "Tasks", text: "1. ...\n2. ..." },
          { label: "AI persona title", text: "Name and role" },
          { label: "AI persona first line", text: "Optional opening." },
          { label: "Advanced", text: "Observable criteria for each task." },
          { label: "Intermediate", text: "Observable criteria for each task." },
          { label: "Beginner", text: "Observable criteria for each task." },
          {
            label: "Overview — Scenario",
            text: "Complete learner-facing facts.",
          },
          {
            label: "Overview — Learner goal",
            text: "What the learner should accomplish.",
          },
          { label: "Communication mode", text: "Text" },
        ],
        context: {
          filename: "A01_context.txt",
          text: "Only needed teaching context. Empty string when unnecessary.",
        },
        design: {
          case_facts: [
            {
              text: "Complete case fact also present in the scenario.",
              origin: "fictional",
              source_path: "",
            },
          ],
          learner_task: "Concrete learner deliverable.",
          interaction:
            "Persona, adaptive follow-ups, mistake response and end condition.",
          success_criteria: [
            "First observable task-specific action.",
            "Second observable task-specific action.",
          ],
          comparison: [
            {
              item_id: "Existing practice ID",
              difference:
                "How this task adds practice beyond the captured item.",
            },
          ],
        },
        evidence: [
          {
            source_path: "Exact captured source path",
            locator: "Source ID/page/slide or item locator",
          },
        ],
        checks: [],
      },
    ],
    module_decisions: [
      {
        course: "Exact course title",
        module: "Exact module title",
        decision: "neither",
        reason: "One short reason.",
      },
    ],
    coverage_note: "Only material gaps that affect the recommendations.",
  };
  function string(x, label, max = 60000) {
    if (typeof x !== "string" || x.length > max)
      throw Error(label + " must be text of at most " + max + " characters.");
    return x;
  }
  function parse(raw) {
    if (typeof raw === "string") {
      if (raw.length > 8 * 1024 * 1024)
        throw Error("Result is too large (8 MB maximum).");
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      raw = JSON.parse(fenced ? fenced[1] : raw.trim());
    }
    if (!raw || raw.format !== FORMAT || raw.schema_version !== 1)
      throw Error(
        "Use the ACTIVITY_RESULTS.json produced by the new handoff. This is not a supported activity result.",
      );
    const r = {
      format: FORMAT,
      schema_version: 1,
      title: string(raw.title, "Title", 500),
      mode: raw.mode,
      bundle_created_at: string(
        raw.bundle_created_at || "",
        "Bundle date",
        100,
      ),
      summary: string(raw.summary || "", "Summary", 5000),
      activities: [],
      module_decisions: [],
      coverage_note: string(raw.coverage_note || "", "Coverage note", 10000),
    };
    if (!["opportunity", "final"].includes(r.mode))
      throw Error("Mode must be opportunity or final.");
    if (!Array.isArray(raw.activities) || raw.activities.length > 200)
      throw Error("Activities must be an array (maximum 200).");
    const ids = new Set();
    for (const x of raw.activities) {
      const a = {
        id: string(x.id, "Activity ID", 100),
        type: x.type,
        status: x.status,
        title: string(x.title, "Activity title", 500),
        placement: {},
        objective: string(x.objective || "", "Objective", 5000),
        why: string(x.why || "", "Reason", 5000),
        minutes: x.minutes,
        fields: [],
        context: { filename: "", text: "" },
        evidence: [],
        checks: [],
      };
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(a.id) ||
        ["constructor", "prototype", "__proto__"].includes(a.id) ||
        ids.has(a.id)
      )
        throw Error(
          "Use unique activity IDs containing letters, numbers, hyphens or underscores.",
        );
      ids.add(a.id);
      if (
        !Object.hasOwn(required, a.type) ||
        !Array.isArray(required[a.type]) ||
        !["draft", "idea", "hold"].includes(a.status)
      )
        throw Error(
          a.id + ": use type role_play/dialogue and status draft/idea/hold.",
        );
      if (!Number.isFinite(a.minutes) || a.minutes < 0 || a.minutes > 180)
        throw Error(a.id + ": minutes must be a number between 0 and 180.");
      if (!x.placement || typeof x.placement !== "object")
        throw Error(a.id + ": placement is missing.");
      for (const key of [
        "course",
        "module",
        "lesson",
        "after",
        "before",
        "branch_id",
        "module_id",
        "lesson_id",
        "after_item_id",
        "before_item_id",
        "export_file",
        "notes",
      ])
        a.placement[key] = string(
          x.placement[key] || "",
          a.id + " placement " + key,
          5000,
        );
      a.placement.row =
        Number.isInteger(x.placement.row) && x.placement.row > 0
          ? x.placement.row
          : null;
      if (!Array.isArray(x.fields) || x.fields.length > 40)
        throw Error(a.id + ": fields must be an array, maximum 40.");
      const labels = new Set();
      for (const f of x.fields) {
        const label = string(f.label, "Field label", 150),
          text = string(f.text, "Field text");
        if (labels.has(label)) throw Error(a.id + ": duplicate field " + label);
        labels.add(label);
        a.fields.push({ label, text });
      }
      if (r.mode === "opportunity" && a.status === "draft")
        throw Error(
          "Content Map mode accepts ideas or holds, not final drafts.",
        );
      if (a.status === "draft") {
        const missing = required[a.type].filter(
          (l) => !a.fields.some((f) => f.label === l && f.text.trim()),
        );
        if (missing.length)
          throw Error(
            a.id +
              ": missing complete Coursera fields: " +
              missing.join(", ") +
              ". Ask the chat to complete them or mark this activity idea/hold.",
          );
        if (
          !a.placement.course ||
          !a.placement.module ||
          !a.placement.lesson ||
          !a.placement.after
        )
          throw Error(
            a.id +
              ": a draft needs course, module, lesson and preceding item titles.",
          );
        if (a.fields.find((f) => f.label === "Title").text !== a.title)
          throw Error(a.id + ": Title field must match the activity title.");
      }
      if (x.design !== undefined) {
        const d = x.design;
        if (
          !d ||
          typeof d !== "object" ||
          !Array.isArray(d.case_facts) ||
          d.case_facts.length > 50 ||
          !Array.isArray(d.success_criteria) ||
          d.success_criteria.length > 20 ||
          !Array.isArray(d.comparison) ||
          d.comparison.length > 500
        )
          throw Error(a.id + ": malformed activity design brief.");
        a.design = {
          learner_task: string(
            d.learner_task || "",
            "Learner deliverable",
            5000,
          ),
          interaction: string(d.interaction || "", "Interaction plan", 5000),
          case_facts: d.case_facts.map((f) => {
            if (!["source", "fictional"].includes(f.origin))
              throw Error("Case fact origin must be source or fictional.");
            return {
              text: string(f.text, "Case fact", 5000),
              origin: f.origin,
              source_path: string(
                f.source_path || "",
                "Case fact source",
                2000,
              ),
            };
          }),
          success_criteria: d.success_criteria.map((t) =>
            string(t, "Observable success criterion", 2000),
          ),
          comparison: d.comparison.map((x) => ({
            item_id: string(x.item_id, "Comparison item ID", 200),
            difference: string(x.difference, "Practice comparison", 5000),
          })),
        };
      }
      if (x.context) {
        a.context.text = string(x.context.text || "", "Additional context");
        a.context.filename =
          a.id.replace(/[^a-zA-Z0-9_-]/g, "_") + "_context.txt";
      }
      if (
        x.evidence !== undefined &&
        (!Array.isArray(x.evidence) || x.evidence.length > 100)
      )
        throw Error(a.id + ": evidence must be an array.");
      for (const e of (x.evidence || []).slice(0, 100))
        a.evidence.push({
          source_path: string(e.source_path, "Source path", 2000),
          locator: string(e.locator || "", "Source locator", 2000),
          purpose: ["teaching", "comparison", "gap"].includes(e.purpose)
            ? e.purpose
            : "teaching",
        });
      if (a.status === "draft" && !a.evidence.length)
        throw Error(a.id + ": a draft must identify its supporting source.");
      if (
        x.checks !== undefined &&
        (!Array.isArray(x.checks) || x.checks.length > 100)
      )
        throw Error(a.id + ": checks must be an array.");
      a.checks = (x.checks || [])
        .slice(0, 100)
        .map((t) => string(t, "Check", 5000));
      r.activities.push(a);
    }
    if (
      !Array.isArray(raw.module_decisions) ||
      raw.module_decisions.length > 1000
    )
      throw Error("Module decisions must be an array, maximum 1,000.");
    for (const d of raw.module_decisions) {
      if (!["role_play", "dialogue", "neither", "hold"].includes(d.decision))
        throw Error("Invalid module decision.");
      r.module_decisions.push({
        course: string(d.course, "Decision course", 500),
        module: string(d.module, "Decision module", 500),
        decision: d.decision,
        reason: string(d.reason || "", "Decision reason", 5000),
        branch_id: string(d.branch_id || "", "Decision branch", 200),
        module_id: string(d.module_id || "", "Decision module ID", 200),
      });
    }
    return r;
  }
  function issues(r, s) {
    const all = [],
      cards = Object.create(null);
    if (!s)
      all.push(
        "No course bundle is loaded. Placement and source references have not been checked against an export.",
      );
    else {
      if (r.bundle_created_at !== s.created_at)
        all.push(
          "This result was produced for a different bundle version. Recheck it against the loaded files before using its placements.",
        );
      if (r.title !== s.title)
        all.push("The result title differs from the loaded course title.");
      const decisions = new Set(
        r.module_decisions.map((d) => d.course + "|" + d.module),
      );
      const missing = s.courses.flatMap((c) =>
        c.modules.filter((m) => !decisions.has(c.title + "|" + m.title)),
      );
      if (missing.length)
        all.push(
          missing.length +
            " exported module(s) have no matching module decision.",
        );
      for (const d of r.module_decisions.filter(
        (d) => d.decision === "neither",
      )) {
        const c = s.courses.find(
            (c) => c.kind === "coursera_shell_capture" && c.title === d.course,
          ),
          m = c?.modules.find((m) => m.title === d.module);
        if (!m) continue;
        const docs = s.sources
            .filter(
              (src) =>
                src.kind === "captured_shell" && src.course_id === c.branch_id,
            )
            .flatMap((src) => src.documents),
          read = new Set(
            docs
              .filter(
                (x) =>
                  root.CourseShell?.textQuality(x.text).readable ??
                  !!x.text?.trim(),
              )
              .map((x) => x.id),
          ),
          unread = m.lessons
            .flatMap((l) => l.items)
            .filter(
              (i) =>
                /quiz|exam|assessment|assignment/i.test(i.type) &&
                !read.has(i.id),
            );
        if (unread.length)
          all.push(
            d.module +
              ": the “No addition” decision has not been checked against " +
              unread.length +
              " unread assessment item(s). Item counts/titles do not establish that existing practice is sufficient.",
          );
      }
    }
    for (const a of r.activities) {
      const warnings = [...a.checks];
      cards[a.id] = warnings;
      if (!s) continue;
      const p = a.placement,
        c = s.courses.find((c) => c.branch_id && c.branch_id === p.branch_id);
      if (!c) {
        warnings.push("Course branch is not resolved in the loaded exports.");
        continue;
      }
      if (c.title !== p.course)
        warnings.push("Course title differs from this branch in the export.");
      const m = c.modules.find((m) => m.id && m.id === p.module_id),
        l = m?.lessons.find((l) => l.id && l.id === p.lesson_id);
      if (!m || !l) {
        warnings.push("Module or lesson ID is not resolved in this branch.");
        continue;
      }
      if (c.kind === "coursera_shell_capture") {
        const docs = s.sources
            .filter(
              (src) =>
                src.kind === "captured_shell" && src.course_id === c.branch_id,
            )
            .flatMap((src) => src.documents),
          read = new Set(
            docs
              .filter(
                (d) =>
                  root.CourseShell?.textQuality(d.text).readable ??
                  !!d.text?.trim(),
              )
              .map((d) => d.id),
          );
        const items = m.lessons.flatMap((x) => x.items),
          missing = items.filter((i) => !read.has(i.id)),
          assessments = items.filter((i) =>
            /quiz|exam|assessment|assignment/i.test(i.type),
          ),
          unreadAssessments = assessments.filter((i) => !read.has(i.id));
        if (missing.length)
          warnings.push(
            "Evidence check required: " +
              missing.length +
              " of " +
              items.length +
              " items in this module lack readable body text. Correct placement IDs do not establish complete teaching or practice coverage.",
          );
        if (unreadAssessments.length)
          warnings.push(
            "Practice comparison unresolved: " +
              unreadAssessments.length +
              " of " +
              assessments.length +
              " assessment items are unread. Do not treat the AI’s confidence or non-duplication claim as verified.",
          );
      }
      if (m.title !== p.module || l.title !== p.lesson)
        warnings.push("Module or lesson title differs from the recorded IDs.");
      const after = l.items.find((i) => i.id === p.after_item_id);
      if (!after) warnings.push("Preceding item ID is not in this lesson.");
      else {
        if (after.title !== p.after)
          warnings.push("Preceding item title differs from its exported ID.");
        if (p.row && after.row !== p.row)
          warnings.push("Preceding item row differs from the export.");
      }
      if (p.export_file && p.export_file !== c.filename)
        warnings.push(
          "Export filename differs from this branch in the loaded bundle.",
        );
      if (p.before_item_id) {
        const bi = l.items.findIndex((i) => i.id === p.before_item_id),
          ai = l.items.findIndex((i) => i.id === p.after_item_id);
        if (bi < 0 || bi <= ai)
          warnings.push(
            "Following item is missing or is not after the preceding item.",
          );
        else if (ai >= 0 && bi !== ai + 1)
          warnings.push(
            "Other exported items fall between the preceding and following items. Confirm the exact insertion point.",
          );
        if (bi >= 0 && l.items[bi].title !== p.before)
          warnings.push("Following item title differs from its exported ID.");
      }
      for (const e of a.evidence) {
        const doc = s.sources
          .flatMap((src) => src.documents)
          .find((d) => d.path === e.source_path);
        if (
          !doc &&
          !s.references.some((ref) => ref.filename === e.source_path) &&
          !s.sources.some((src) =>
            (src.unread || []).some((u) => u.path === e.source_path),
          ) &&
          !s.courses.some((c) =>
            c.modules.some((m) =>
              m.lessons.some((l) =>
                l.items.some(
                  (i) => `coursera/${c.branch_id}/${i.id}` === e.source_path,
                ),
              ),
            ),
          )
        )
          warnings.push(
            "Source path not found in loaded bundle: " + e.source_path,
          );
        if (doc && root.CourseShell?.textQuality(doc.text).placeholder_only)
          warnings.push(
            "Cited source contains only loading/viewer controls, not teaching: " +
              e.source_path,
          );
      }
    }
    return { all, cards };
  }
  function merge(previous, incoming) {
    if (!previous) return incoming;
    if (
      previous.title !== incoming.title ||
      previous.bundle_created_at !== incoming.bundle_created_at ||
      previous.mode !== incoming.mode
    )
      throw Error(
        "Results are from different titles, versions or stages. Save current work, then choose Replace all displayed results.",
      );
    const key = (x) =>
      JSON.stringify(
        x.branch_id && x.module_id
          ? [x.branch_id, x.module_id]
          : [x.course, x.module],
      );
    const scope = new Set(incoming.module_decisions.map(key));
    if (!scope.size)
      throw Error(
        "A packet result needs module decisions before it can be combined.",
      );
    if (incoming.activities.some((a) => !scope.has(key(a.placement))))
      throw Error(
        "Each incoming activity must belong to a module in its module decisions.",
      );
    const activities = [
      ...previous.activities.filter((a) => !scope.has(key(a.placement))),
      ...incoming.activities,
    ];
    if (new Set(activities.map((a) => a.id)).size !== activities.length)
      throw Error(
        "Activity IDs conflict across packets. Ask the chat to use unique packet-prefixed IDs; current cards are unchanged.",
      );
    return parse({
      ...incoming,
      activities,
      module_decisions: [
        ...previous.module_decisions.filter((d) => !scope.has(key(d))),
        ...incoming.module_decisions,
      ],
      summary:
        "Combined module reviews. Latest: " +
        incoming.summary.replace(/^Combined module reviews\. Latest: /, ""),
      coverage_note: uniqueNotes(
        previous.coverage_note,
        incoming.coverage_note,
      ),
    });
  }
  function uniqueNotes(a, b) {
    return [...new Set([a, b].filter(Boolean))].join("\n");
  }
  function text(a) {
    return [
      a.type === "role_play" ? "ROLE PLAY" : "DIALOGUE",
      a.title,
      "Where: " +
        [a.placement.course, a.placement.module, a.placement.lesson].join(
          " / ",
        ),
      "After: " + a.placement.after,
      "Before: " + a.placement.before,
      "Status: " + a.status + " — proposed, not published",
      "Reason: " + a.why,
      ...a.fields.map((f) => "\nREVIEW FIELD " + f.label + "\n" + f.text),
    ].join("\n");
  }
  root.ActivityDesigner = {
    FORMAT,
    required,
    template,
    parse,
    issues,
    text,
    merge,
  };
  if (typeof module !== "undefined" && module.exports)
    module.exports = root.ActivityDesigner;
})(globalThis);
