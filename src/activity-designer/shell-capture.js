(function (root) {
  "use strict";
  const FORMAT = "coursera-activity-capture",
    VERSION = 1;
  const arr = (x) => (Array.isArray(x) ? x : []),
    str = (x) => (typeof x === "string" ? x : "");
  const protectedField =
    /(correct|answer|solution|feedback|explanation|score|rubric|grading|password|token|secret|cookie|authorization|email|learner|student|submission)/i;
  function textQuality(raw) {
    const text = String(raw || "")
      .replace(/^\[(?:TEACHING|ASSESSMENT|GAP) \|[^\n]*\]\s*/gm, "")
      .replace(/[\u200b\ufeff]/g, "")
      .trim();
    const lines = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    const loading = lines.some((x) => /^loading(?:\.{1,3}|…)?$/i.test(x));
    const viewer =
      lines.some((x) => /^\/\s*\d+$/.test(x)) &&
      lines.some((x) => /^\d+(?:\.\d+)?%$/.test(x));
    const remaining =
      loading || viewer
        ? lines.filter(
            (x) =>
              !/^loading(?:\.{1,3}|…)?$/i.test(x) &&
              !/^\/\s*\d+$/.test(x) &&
              !/^\d+(?:\.\d+)?%$/.test(x),
          )
        : lines;
    return {
      readable: remaining.length > 0,
      placeholder_only: !!text && !remaining.length,
      viewer_text: viewer,
    };
  }
  function outline(raw, course) {
    const items = [],
      seen = new Set();
    let walked = 0;
    function walk(v, ancestors, trail) {
      if (!v || typeof v !== "object" || ++walked > 100000) return;
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, ancestors, trail.concat(i)));
        return;
      }
      const title = str(v.originalName || v.name || v.title),
        id = str(v.id || v.itemId || v.atomId || v.elementId),
        type = str(v.content?.typeName || v.typeName || v.itemTypeLabel);
      const childKeys = [
        "material",
        "elements",
        "modules",
        "lessons",
        "items",
        "sections",
        "weeks",
        "tracks",
      ];
      const children = childKeys.filter(
        (k) => v[k] && typeof v[k] === "object",
      );
      const container = children.some(
        (k) => !Array.isArray(v[k]) || v[k].length,
      );
      if (title && id && !container && (type || ancestors.length >= 2)) {
        const identity = id + "|" + ancestors.map((x) => x.key).join("/");
        if (seen.has(identity)) return;
        seen.add(identity);
        items.push({
          id,
          title,
          type: type || "unknown",
          position: items.length + 1,
          ancestors,
          blocks: [],
          coverage: "unread",
          notes: [],
        });
        return;
      }
      const next =
        title && container
          ? ancestors.concat({ id, title, key: trail.join("/") })
          : ancestors;
      children.forEach((k) => walk(v[k], next, trail.concat(k)));
      if (!children.length && !title)
        Object.entries(v).forEach(([k, x]) => {
          if (x && typeof x === "object" && !protectedField.test(k))
            walk(x, next, trail.concat(k));
        });
    }
    walk(raw, [], []);
    return {
      format: FORMAT,
      schema_version: VERSION,
      created_at: new Date().toISOString(),
      course: {
        id: str(course.id),
        title: str(course.title),
        url: str(course.url),
      },
      items,
      issues:
        walked > 100000
          ? ["Outline traversal limit reached; inventory may be incomplete."]
          : [],
      status: "capturing",
    };
  }
  function fields(value, clean = (x) => x) {
    const blocks = [];
    let nodes = 0,
      chars = 0;
    const seen = new Set();
    function walk(v, path) {
      if (v === null || v === undefined || ++nodes > 30000 || chars >= 2000000)
        return;
      if (typeof v === "string") {
        const field = path.join("."),
          leaf = path.filter((x) => !/^\d+$/.test(x)).at(-1) || "";
        if (
          !/^(text|html|body|content|prompt|question|stem|choice|option|caption|transcript|description|objective|instructions?|value|cml|richText)$/i.test(
            leaf,
          ) ||
          path.some((k) => protectedField.test(k))
        )
          return;
        const text = clean(v).trim();
        if (text.length < 2 || seen.has(text)) return;
        if (text.length + chars > 2000000) {
          blocks.push({
            field: "Capture limit",
            text: "Further text was omitted (2 million character item limit).",
            kind: "gap",
          });
          chars = 2000000;
          return;
        }
        seen.add(text);
        chars += text.length;
        blocks.push({
          field,
          text,
          kind: /question|quiz|choice|option|stem/i.test(field)
            ? "assessment"
            : "teaching",
        });
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, path.concat(String(i))));
        return;
      }
      if (typeof v === "object")
        Object.entries(v).forEach(([k, x]) => {
          if (!protectedField.test(k)) walk(x, path.concat(k));
        });
    }
    walk(value, []);
    if (nodes > 30000)
      blocks.push({
        field: "Capture limit",
        text: "Further fields were not traversed (node limit).",
        kind: "gap",
      });
    return blocks;
  }
  function validate(x) {
    if (
      x?.format !== FORMAT ||
      x.schema_version !== VERSION ||
      !x.course ||
      typeof x.course.id !== "string" ||
      !x.course.id ||
      !Array.isArray(x.items) ||
      x.items.length > 5000
    )
      throw Error("Unsupported or malformed Coursera activity capture.");
    if (!/^[A-Za-z0-9_-]+$/.test(x.course.id))
      throw Error("Invalid captured course ID.");
    if (!Number.isFinite(Date.parse(x.created_at)) || !str(x.course.title))
      throw Error("Capture needs its course title and timestamp.");
    let chars = 0;
    const ids = new Set();
    for (const it of x.items) {
      if (
        !it ||
        !str(it.id) ||
        !str(it.title) ||
        !Array.isArray(it.ancestors) ||
        !Array.isArray(it.blocks) ||
        !Array.isArray(it.notes)
      )
        throw Error(
          "Captured item is missing identity, ancestry, content or coverage.",
        );
      if (!/^[A-Za-z0-9_-]+$/.test(it.id) || ids.has(it.id))
        throw Error("Captured item IDs are invalid or duplicated.");
      ids.add(it.id);
      if (!["unread", "partial", "text_captured"].includes(it.coverage))
        throw Error("Invalid item coverage.");
      for (const a of it.ancestors)
        if (
          !a ||
          typeof a.id !== "string" ||
          typeof a.title !== "string" ||
          typeof a.key !== "string"
        )
          throw Error("Malformed ancestry.");
      for (const b of it.blocks) {
        if (
          !b ||
          typeof b.text !== "string" ||
          typeof b.field !== "string" ||
          !["teaching", "assessment", "gap"].includes(b.kind)
        )
          throw Error("Malformed captured text.");
        chars += b.text.length;
      }
    }
    if (chars > 30000000)
      throw Error("Capture exceeds the 30 million character import limit.");
    return x;
  }
  function assessmentMetrics(m) {
    if (!m || typeof m !== "object") return null;
    const result = {
      completeness: "partial_unverified",
      has_unresolved_capture_issues: m.has_unresolved_capture_issues === true,
    };
    for (const key of [
      "visible_question_headers",
      "prompts_captured",
      "choice_controls_seen",
      "options_captured",
      "declared_questions",
    ])
      result[key] = Number.isInteger(m[key]) && m[key] >= 0 ? m[key] : null;
    return result;
  }
  function summary(c) {
    const read = (i) =>
      i.blocks.some((b) => b.kind !== "gap" && textQuality(b.text).readable);
    return {
      items: c.items.length,
      with_text: c.items.filter(read).length,
      unread: c.items.filter((i) => !read(i)).length,
      quizzes: c.items.filter((i) =>
        /quiz|assessment|exam|assignment/i.test(i.type),
      ).length,
      assessments_with_text: c.items.filter(
        (i) => /quiz|assessment|exam|assignment/i.test(i.type) && read(i),
      ).length,
    };
  }
  function toSession(c, filename, core) {
    validate(c);
    const s = core.newSession(c.course.title, "final");
    s.created_at = c.created_at;
    const name = "shell_" + c.course.id + ".json";
    const course = {
      kind: "coursera_shell_capture",
      filename: name,
      branch_id: c.course.id,
      title: c.course.title,
      description:
        "Direct shell capture, not an IMSCC/source equivalence check.",
      template_header: c.created_at,
      capture_scope: c.capture_scope || "unrecorded",
      url: c.course.url,
      modules: [],
      item_count: c.items.length,
      time_seconds: 0,
      warnings: [],
      sha256: null,
    };
    const moduleMap = new Map(),
      lessonMaps = new Map();
    const source = {
      kind: "captured_shell",
      course_id: c.course.id,
      filename: "Captured_shell_" + c.course.id,
      sha256: null,
      archive_file_count: c.items.length,
      manifests: [],
      documents: [],
      unread: [],
      external_links: [],
      warnings: [
        "All captured content is text-only evidence. Images, media, hidden quiz parts and external plugins may remain unread.",
      ],
    };
    for (const it of c.items) {
      const ancestors = it.ancestors,
        ma = ancestors.at(-2) ||
          ancestors[0] || {
            id: "",
            title: "[Module unresolved]",
            key: "unresolved",
          },
        la =
          ancestors.length >= 2
            ? ancestors.at(-1)
            : { id: "", title: "[Lesson unresolved]", key: "unresolved" };
      const mk = ma.key + "|" + ma.id;
      let m = moduleMap.get(mk);
      if (!m) {
        m = {
          ordinal: course.modules.length + 1,
          title: ma.title,
          id: ma.id,
          description: "",
          objectives: [],
          lessons: [],
          row: null,
        };
        moduleMap.set(mk, m);
        lessonMaps.set(mk, new Map());
        course.modules.push(m);
      }
      const lm = lessonMaps.get(mk),
        lk = la.key + "|" + la.id;
      let l = lm.get(lk);
      if (!l) {
        l = {
          ordinal: m.lessons.length + 1,
          title: la.title,
          id: la.id,
          row: null,
          items: [],
        };
        lm.set(lk, l);
        m.lessons.push(l);
      }
      const accepted = it.blocks.filter(
          (b) => b.kind === "gap" || textQuality(b.text).readable,
        ),
        body = accepted.filter((b) => b.kind !== "gap");
      l.items.push({
        id: it.id,
        title: it.title,
        type: it.type,
        row: null,
        position: it.position,
        time_estimate: null,
        time_seconds: null,
        body_available: body.length > 0,
        capture_coverage: it.coverage,
        assessment_capture: assessmentMetrics(it.assessment_capture),
        link: root.CourseCtiAdapter?.route(it.route, c.course.id, it.id) || "",
        notes: it.notes,
      });
      const path = "coursera/" + c.course.id + "/" + it.id;
      if (body.length)
        source.documents.push({
          id: it.id,
          path,
          title: it.title,
          coverage: "partial_text",
          sha256: null,
          note:
            "Captured from Coursera shell; text coverage is partial, not full media/question coverage. " +
            it.notes.join(" "),
          associations: [
            {
              resource_id: it.id,
              items: [
                {
                  id: it.id,
                  title: it.title,
                  path: ancestors.map((a) => a.title).concat(it.title),
                },
              ],
            },
          ],
          assessment_capture: assessmentMetrics(it.assessment_capture),
          text: accepted
            .map(
              (b) =>
                "[" + b.kind.toUpperCase() + " | " + b.field + "]\n" + b.text,
            )
            .join("\n\n"),
        });
      else
        source.unread.push({
          path,
          kind: it.type,
          reason:
            (it.blocks.some((b) => textQuality(b.text).placeholder_only)
              ? "Only loading/viewer controls were captured; no readable teaching content. "
              : "") + (it.notes.join(" ") || "No readable body captured."),
        });
      if (!m.id || !l.id)
        s.issues.push({
          file: it.title,
          reason:
            "Module or lesson identity is unresolved. Do not invent exact placement.",
        });
    }
    s.courses.push(course);
    s.sources.push(source);
    s.references.push({
      filename: "Shell_capture_receipt_" + c.course.id + ".txt",
      coverage: "text",
      text: JSON.stringify(
        {
          input: filename,
          captured_at: c.created_at,
          extractor_version: c.extractor_version || "unrecorded",
          capture_scope: c.capture_scope || "unrecorded",
          selected_item_id: c.selected_item_id || null,
          course: c.course,
          status: c.status,
          coverage: summary(c),
          issues: c.issues,
        },
        null,
        2,
      ),
    });
    for (const issue of arr(c.issues))
      s.issues.push({ file: filename, reason: String(issue) });
    s.issues.push({
      file: filename,
      reason:
        "Direct Coursera teaching evidence. Assessment text is internal overlap/design evidence; never reproduce solutions or use the whole capture as learner AI context. No source LMS equivalence or approval is established.",
    });
    return s;
  }
  root.CourseShell = {
    FORMAT,
    VERSION,
    outline,
    fields,
    validate,
    summary,
    toSession,
    protectedField,
    textQuality,
  };
  if (typeof module !== "undefined" && module.exports)
    module.exports = root.CourseShell;
})(globalThis);
