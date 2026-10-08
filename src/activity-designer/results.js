(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    A = globalThis.ActivityDesigner,
    UI = globalThis.CoursePrepUI;
  let result = null,
    importing = false;
  function el(tag, text, cls) {
    const x = document.createElement(tag);
    if (text !== undefined) x.textContent = text;
    if (cls) x.className = cls;
    return x;
  }
  function warn(text) {
    $("result-error").hidden = !text;
    $("result-error").textContent = text;
    $("repair-result").hidden = !text;
  }
  function label(a) {
    return a.type === "role_play" ? "Role Play" : "Dialogue";
  }
  function button(title, fn, cls = "secondary") {
    const b = el("button", title, cls);
    b.type = "button";
    b.onclick = fn;
    return b;
  }
  function field(f, canCopy) {
    const box = el("section", undefined, "copy-field");
    const top = el("div", undefined, "field-heading");
    const copyButton = button("Copy", () => UI.copy(f.text), "text-button");
    copyButton.disabled = !canCopy;
    top.append(
      el("h4", (canCopy ? "Paste into “" : "Review “") + f.label + "”"),
      copyButton,
    );
    box.append(top, el("pre", f.text));
    return box;
  }
  function render() {
    if (!result) return;
    const check = A.issues(result, UI.getSession());
    $("activities-empty").hidden = true;
    $("activities-result").hidden = false;
    $("activities-title").textContent = result.title;
    const ready = result.activities.filter(
      (a) => ActivityReadiness.check(result, UI.getSession(), a).canCopy,
    ).length;
    $("activities-summary").textContent =
      `${ready} draft(s) passed the automated evidence and structure checks; ${result.activities.length - ready} proposal(s) need review or evidence. Human content review is still required. AI recommendation: ${result.summary}`;
    $("result-warnings").replaceChildren();
    $("result-warnings").hidden = !check.all.length;
    for (const w of check.all) $("result-warnings").append(el("p", w));
    $("activity-cards").replaceChildren();
    if (!result.activities.length)
      $("activity-cards").append(
        el(
          "p",
          result.module_decisions.some((d) => d.decision === "hold")
            ? "No activity draft is ready. Some modules are on hold; see the reasons below."
            : "No additional Role Play or Dialogue is recommended for the reviewed scope. See the module decisions below.",
          "panel",
        ),
      );
    for (const a of result.activities) {
      const readiness = ActivityReadiness.check(result, UI.getSession(), a);
      const card = el("article", undefined, "activity-card panel");
      const head = el("div", undefined, "activity-head");
      const title = el("div");
      title.append(
        el(
          "p",
          label(a) +
            " · " +
            (a.status === "draft"
              ? readiness.canCopy
                ? "Draft for content review"
                : "Needs evidence / design review"
              : a.status === "idea"
                ? "Proposed opportunity"
                : "On hold") +
            (a.minutes > 0
              ? " · Estimated " + a.minutes + " min"
              : " · Time not estimated"),
          "eyebrow",
        ),
        el("h2", a.title),
      );
      head.append(title);
      if (readiness.canCopy)
        head.append(
          button("Copy all fields", () =>
            UI.copy(a.fields.map((f) => f.label + "\n" + f.text).join("\n\n")),
          ),
        );
      card.append(head);
      const placement = el("section", undefined, "placement-box");
      placement.append(el("h3", "Where to add it"));
      const dl = el("dl");
      for (const [k, v] of [
        ["Course", a.placement.course],
        ["Module", a.placement.module],
        ["Lesson", a.placement.lesson],
        ["Immediately after", a.placement.after],
        ["Before", a.placement.before],
      ]) {
        dl.append(el("dt", k), el("dd", v || "Not resolved"));
      }
      placement.append(dl);
      const link = ActivityReadiness.itemLink(UI.getSession(), a);
      if (link) {
        const aLink = el("a", "Open preceding Coursera item");
        aLink.href = link;
        aLink.target = "_blank";
        aLink.rel = "noopener noreferrer";
        placement.append(aLink);
      } else
        placement.append(
          el("p", "No verified item deep link in this snapshot.", "small"),
        );
      card.append(placement, el("p", a.why, "activity-reason"));
      if (a.objective)
        card.append(el("p", "Learning goal: " + a.objective, "small"));
      if (readiness.blocking.length) {
        const notice = el("section", undefined, "notice");
        notice.append(el("h3", "What to do next"));
        const list = el("ul");
        for (const w of readiness.blocking) list.append(el("li", w));
        notice.append(list);
        const cv = ActivityQuality.coverage(UI.getSession(), a.placement);
        for (const item of [
          ...new Map(
            [...cv.empty, ...cv.unread, ...cv.incomplete].map((i) => [i.id, i]),
          ).values(),
        ]) {
          const href = CourseCtiAdapter.route(
            item.link,
            cv.course.branch_id,
            item.id,
          );
          if (href) {
            const link = el("a", "Open " + item.title + " (" + item.id + ")");
            link.href = href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            const line = el("p");
            line.append(link);
            notice.append(line);
          }
        }
        card.append(notice);
      }
      const externalItems = ActivityQuality.coverage(
        UI.getSession(),
        a.placement,
      ).external;
      if (externalItems.length) {
        const details = el("details", undefined, "detail-box");
        details.append(
          el(
            "summary",
            "Embedded resources need separate review (" +
              externalItems.length +
              " items)",
          ),
          el(
            "p",
            "These resources could not be read from the Coursera frame. Open the recorded resource and supply its teaching text or original file if needed for this activity. Another shell capture may have the same limitation.",
          ),
        );
        for (const item of externalItems) {
          const line = el("p", item.title + " (" + item.id + "): ");
          for (const resource of item.external_resources) {
            const href = CourseCtiAdapter.externalUrl(resource.url);
            if (href) {
              const link = el("a", "Open embedded resource");
              link.href = href;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              line.append(link, document.createTextNode(" "));
            } else
              line.append(
                document.createTextNode(
                  "Use the recorded Coursera item; no safe public resource URL is available. ",
                ),
              );
          }
          details.append(line);
        }
        card.append(details);
      }
      const cardChecks = [
        ...new Set([...readiness.warnings, ...check.cards[a.id]]),
      ].filter((w) => !readiness.blocking.includes(w));
      if (cardChecks.length) {
        const details = el("details", undefined, "detail-box");
        details.append(
          el(
            "summary",
            "Evidence notes and AI checks (" + cardChecks.length + ")",
          ),
        );
        const ul = el("ul");
        for (const w of cardChecks) ul.append(el("li", w));
        details.append(ul);
        card.append(details);
      }
      if (a.status === "draft") {
        const fields = el("div", undefined, "activity-fields");
        for (const f of a.fields) fields.append(field(f, readiness.canCopy));
        card.append(fields);
        if (a.context.text && readiness.canCopy) {
          const ctx = el("details", undefined, "detail-box");
          ctx.append(
            el("summary", "Additional AI context"),
            el(
              "p",
              "Use only this activity’s context file in the additional-context field. Review its contents first.",
              "small",
            ),
            button("Download context .txt", () =>
              UI.download(a.context.text, a.context.filename),
            ),
            button("Copy context", () => UI.copy(a.context.text)),
            el("pre", a.context.text),
          );
          card.append(ctx);
        }
      } else {
        card.append(
          el(
            "p",
            a.status === "idea"
              ? "Concept for Content Map review. Generate final Coursera fields when the teaching and target placement are established."
              : "No paste-ready content is offered for a held activity.",
            "notice",
          ),
        );
        for (const f of a.fields)
          card.append(el("h4", f.label), el("p", f.text));
      }
      const details = el("details", undefined, "detail-box");
      details.append(el("summary", "Source references & export IDs"));
      for (const e of a.evidence)
        details.append(el("p", e.source_path + " · " + e.locator, "small"));
      const p = a.placement;
      details.append(
        el(
          "p",
          "Proposal " +
            a.id +
            " · Branch " +
            (p.branch_id || "unresolved") +
            " · Module " +
            (p.module_id || "unresolved") +
            " · Lesson " +
            (p.lesson_id || "unresolved") +
            " · After item " +
            (p.after_item_id || "unresolved") +
            (p.export_file ? " · " + p.export_file : "") +
            (p.row ? " · row " + p.row : ""),
          "small",
        ),
      );
      if (p.notes) details.append(el("p", p.notes, "small"));
      card.append(details);
      $("activity-cards").append(card);
    }
    $("module-decisions").replaceChildren();
    for (const d of result.module_decisions) {
      const row = el("div", undefined, "module-decision");
      const cv = ActivityQuality.coverage(UI.getSession(), d);
      const unresolved =
        d.decision === "neither" &&
        (cv.empty.length || cv.unread.length || cv.incomplete.length);
      row.append(
        el("strong", d.course + " / " + d.module),
        el(
          "span",
          {
            role_play: "Role Play",
            dialogue: "Dialogue",
            neither: "No addition",
            hold: "Hold",
          }[d.decision] + (unresolved ? " — evidence incomplete" : ""),
        ),
        el(
          "p",
          (unresolved
            ? "AI suggestion only: unresolved source reconciliation or practice coverage prevents confirming that no addition is needed. "
            : "") + d.reason,
        ),
      );
      $("module-decisions").append(row);
    }
    $("result-coverage").textContent = result.coverage_note;
  }
  function importText(text, replace = false) {
    const parsed = A.parse(text);
    const s = UI.getSession();
    if (
      s &&
      (parsed.bundle_created_at !== s.created_at ||
        parsed.title !== s.title ||
        parsed.mode !== s.phase)
    )
      throw Error(
        "This result does not match the loaded course snapshot and stage. Load its matching work ZIP or revalidate with the current packet.",
      );
    if (s) ActivityReadiness.resolveDecisions(parsed, s);
    result =
      replace || $("result-merge-mode").value === "replace"
        ? parsed
        : A.merge(result, parsed);
    warn("");
    render();
    UI.showView("activities");
    return { title: result.title, activities: result.activities.length };
  }
  async function importFile(file) {
    if (!file || importing) return;
    importing = true;
    $("choose-result").disabled = true;
    try {
      if (file.size > 100 * 1024 * 1024)
        throw Error(
          "Result file exceeds 100 MB. Import the result JSON by itself.",
        );
      let text,
        saved = null;
      if (/\.zip$/i.test(file.name)) {
        const z = await JSZip.loadAsync(await file.arrayBuffer());
        const entry = z.file("ACTIVITY_RESULTS.json");
        if (!entry)
          throw Error(
            "This ZIP has no ACTIVITY_RESULTS.json. Use the result from your AI chat, not the input evidence bundle.",
          );
        if (entry._data?.uncompressedSize > 8 * 1024 * 1024)
          throw Error("Result JSON exceeds 8 MB.");
        text = await entry.async("string");
        const se = z.file("SESSION.json");
        if (se) {
          if (se._data?.uncompressedSize > 32 * 1024 * 1024)
            throw Error("Saved session exceeds the 32 MB restore limit.");
          saved = JSON.parse(await se.async("string"));
          CoursePrep.validateSession(saved);
        }
      } else {
        if (file.size > 8 * 1024 * 1024)
          throw Error("Result JSON exceeds 8 MB.");
        text = await file.text();
      }
      const parsed = A.parse(text); // Validate both files before replacing either state.
      if (
        saved &&
        (parsed.bundle_created_at !== saved.created_at ||
          parsed.title !== saved.title ||
          parsed.mode !== saved.phase)
      )
        throw Error("Saved result and session are from different snapshots.");
      if (saved) ActivityReadiness.resolveDecisions(parsed, saved);
      if (saved) await UI.restoreSession(saved);
      importText(text, !!saved);
    } catch (e) {
      warn(
        "Could not import: " +
          e.message +
          " Your previous cards are unchanged.",
      );
    } finally {
      importing = false;
      $("choose-result").disabled = false;
    }
  }
  $("choose-result").onclick = () => $("result-file").click();
  $("result-file").onchange = (e) => {
    const pending = importFile(e.target.files[0]);
    e.target.value = "";
    return pending;
  };
  $("import-result").onclick = () => {
    try {
      importText($("result-json").value);
    } catch (e) {
      warn(
        "Could not import: " +
          e.message +
          " Your previous cards are unchanged.",
      );
    }
  };
  $("repair-result").onclick = () =>
    UI.copy(
      "Please correct your ACTIVITY_RESULTS.json to match 03_RESULT_FORMAT.json from the bundle. Return the full corrected JSON, not a report. Error from the site: " +
        $("result-error").textContent +
        " Preserve the supported content and IDs; do not invent facts or create an activity just to satisfy the format.",
    );
  $("save-results").onclick = () => {
    if (!result) return;
    const files = {
      ...(UI.getOutput() || {}),
      "ACTIVITY_RESULTS.json": JSON.stringify(result, null, 2),
      "READ_ME.txt": UI.setup.readme,
    };
    for (const a of result.activities)
      if (ActivityReadiness.check(result, UI.getSession(), a).canCopy) {
        const safe = a.id.replace(/[^a-zA-Z0-9_-]/g, "_");
        files[safe + "_Coursera_fields.txt"] = A.text(a);
        if (a.context.text) files[a.context.filename] = a.context.text;
      }
    return UI.zipDownload(
      files,
      "Course_Activity_Designer_Work.zip",
      $("save-results"),
    );
  };
  globalThis.CourseResults = { refreshChecks: render };
})();
