(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    A = globalThis.ActivityDesigner,
    UI = globalThis.CoursePrepUI;
  let plan = null,
    recommendations = null;
  let resultSession = null;
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
  function currentPlan() {
    try {
      ActivityApproval.assertSaved(plan);
      return plan;
    } catch {
      return null;
    }
  }
  function savePlan(next, session = UI.getSession()) {
    return ActivityApproval.save(next, session);
  }
  function render() {
    renderPlan();
    if (!result) return;
    const check = A.issues(result, UI.getSession());
    $("activities-empty").hidden = true;
    $("activities-result").hidden = false;
    $("activities-title").textContent = result.title;
    const ready = result.activities.filter(
      (a) =>
        ActivityReadiness.check(result, UI.getSession(), a, currentPlan())
          .canCopy,
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
      const readiness = ActivityReadiness.check(
        result,
        UI.getSession(),
        a,
        currentPlan(),
      );
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
            [...cv.empty, ...cv.failed, ...cv.unread, ...cv.incomplete].map(
              (i) => [i.id, i],
            ),
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
      for (const e of a.evidence) {
        details.append(el("p", e.source_path + " · " + e.locator, "small"));
        const resolved =
          UI.getSession() &&
          ActivityQuality.source(UI.getSession(), e.source_path);
        if (resolved?.asset) {
          details.append(
            el(
              "p",
              resolved.readable
                ? "Original PDF available; text layer captured. Review the cited pages and diagrams."
                : "Original PDF available; no readable text layer. Visual review is still required.",
              "small",
            ),
            button("Download cited PDF", () =>
              UI.download(
                CourseCtiDocuments.bytes(resolved.asset),
                resolved.asset.sha256 + ".pdf",
                "application/pdf",
              ),
            ),
          );
        }
      }
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
        (cv.empty.length ||
          cv.failed.length ||
          cv.unread.length ||
          cv.incomplete.length);
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
  function act(fn) {
    try {
      fn();
      warn("");
      render();
    } catch (e) {
      warn(e.message);
    }
  }
  function renderPlan() {
    $("approval-panel").hidden = !plan;
    if (!plan) return;
    let stale = "";
    try {
      ActivityApproval.validate(plan, UI.getSession());
      ActivityApproval.assertSaved(plan);
    } catch (e) {
      stale = e.message;
    }
    const counts = ["approved", "pending", "held", "rejected"].map(
      (d) =>
        plan.entries.filter((e) => e.decision === d).length +
        " " +
        (d === "pending" ? "awaiting review" : d),
    );
    $("approval-status").textContent =
      stale ||
      counts.join(" · ") +
        ". Decisions saved in this browser. Save work ZIP to restore the evidence and decisions together.";
    $("generate-approved").disabled =
      !!stale ||
      !plan.entries.some(
        (e) => e.decision === "approved" && e.proposal.type !== "neither",
      );
    $("approval-cards").replaceChildren();
    for (const entry of plan.entries) {
      const p = entry.proposal;
      const card = el("article", undefined, "activity-card");
      card.dataset.proposalId = p.id;
      card.append(
        el(
          "h3",
          p.title +
            " · " +
            (p.type === "neither"
              ? p.module_decision === "hold"
                ? "Evidence hold (no activity)"
                : "No addition"
              : label(p)),
        ),
        el(
          "p",
          "Decision: " +
            entry.decision +
            " · Proposal revision " +
            entry.proposal_revision,
        ),
        el(
          "p",
          [p.placement.course, p.placement.module, p.placement.lesson]
            .filter(Boolean)
            .join(" / "),
        ),
        el(
          "p",
          "Learning goal: " +
            (p.objective || "Not applicable to no-addition decision"),
        ),
        el("p", "Incremental value: " + p.why),
      );
      if (p.type !== "neither") {
        card.append(
          el(
            "p",
            "Estimated time: " +
              p.minutes +
              " min · Placement: " +
              (p.recommendation?.placement_status || "Not specified"),
          ),
          el(
            "p",
            "Confidence: " +
              (p.recommendation?.confidence || "Not specified") +
              " · Limitations: " +
              (p.recommendation?.limitations || "Not specified"),
          ),
        );
        for (const e of p.evidence)
          card.append(
            el("p", "Source: " + e.source_path + " · " + e.locator, "small"),
          );
        for (const c of p.recommendation?.existing_practice || [])
          card.append(
            el(
              "p",
              "Existing practice " + c.item_id + ": " + c.difference,
              "small",
            ),
          );
      }
      if (entry.reviewer)
        card.append(
          el(
            "p",
            "Reviewed by " +
              entry.reviewer +
              " · " +
              entry.decided_at +
              " · " +
              entry.note,
            "small",
          ),
        );
      const noteLabel = el("label", "Review note for " + p.id);
      const note = el("textarea");
      note.maxLength = 5000;
      note.value = entry.note;
      noteLabel.append(note);
      card.append(noteLabel);
      const actions = el("div", undefined, "action-row");
      for (const [text, decision] of [
        ["Approve", "approved"],
        ["Reject", "rejected"],
        ["Hold for evidence", "held"],
      ]) {
        const b = button(text, () =>
          act(() => {
            ActivityApproval.assertSaved(plan);
            plan = savePlan(
              ActivityApproval.decide(
                plan,
                UI.getSession(),
                p.id,
                decision,
                $("reviewer-name").value,
                note.value,
              ),
            );
          }),
        );
        b.disabled = !!stale;
        actions.append(b);
      }
      if (p.type !== "neither") {
        const details = el("details");
        details.append(el("summary", "Revise recommendation"));
        const inputs = {};
        function input(key, caption, value, choices) {
          const lab = el("label", caption),
            n = el(choices ? "select" : "textarea");
          if (choices)
            for (const value of choices) {
              const o = el("option", value);
              o.value = value;
              n.append(o);
            }
          n.value = value;
          n.maxLength = 5000;
          inputs[key] = n;
          lab.append(n);
          details.append(lab);
        }
        input("type", "Activity type (ungraded)", p.type, [
          "dialogue",
          "role_play",
        ]);
        for (const [k, title] of [
          ["title", "Title"],
          ["objective", "Learning objective"],
          ["why", "Incremental instructional value"],
          ["minutes", "Estimated minutes"],
        ])
          input(k, title, p[k]);
        for (const k of Object.keys(p.placement))
          input(
            "placement." + k,
            "Placement: " + k.replaceAll("_", " "),
            p.placement[k] ?? "",
          );
        input(
          "confidence",
          "Confidence",
          p.recommendation?.confidence || "low",
          ["high", "medium", "low"],
        );
        input(
          "limitations",
          "Evidence limitations",
          p.recommendation?.limitations || "",
        );
        input(
          "placement_status",
          "Placement status",
          p.recommendation?.placement_status || "provisional",
          ["exact", "provisional"],
        );
        input(
          "placement_source",
          "Outline/reference path for provisional placement",
          p.recommendation?.placement_source || "",
        );
        details.append(
          el(
            "p",
            "Existing source citations and practice comparisons are retained. For different evidence or a revised duplication analysis, import revised recommendations from your chat. Saving a revision removes this proposal’s approval; other decisions remain unchanged.",
            "small",
          ),
        );
        const save = button("Save revision for review", () =>
          act(() => {
            ActivityApproval.assertSaved(plan);
            const next = JSON.parse(JSON.stringify(recommendations));
            const a = next.activities.find((a) => a.id === p.id);
            for (const k of ["title", "objective", "why", "type"])
              a[k] = inputs[k].value;
            a.minutes = Number(inputs.minutes.value);
            for (const k of Object.keys(p.placement))
              a.placement[k] =
                k === "row"
                  ? Number(inputs["placement." + k].value) || null
                  : inputs["placement." + k].value;
            a.recommendation = {
              ...(a.recommendation || {}),
              existing_practice: a.recommendation?.existing_practice || [],
            };
            for (const k of [
              "confidence",
              "limitations",
              "placement_status",
              "placement_source",
            ])
              a.recommendation[k] = inputs[k].value;
            const parsed = A.parse(next);
            plan = savePlan(
              ActivityApproval.sync(parsed, UI.getSession(), plan),
            );
            recommendations = parsed;
            if (result.mode === "opportunity") result = parsed;
          }),
        );
        save.disabled = !!stale;
        details.append(save);
        card.append(details);
      }
      card.append(actions);
      $("approval-cards").append(card);
    }
  }
  $("save-approval").onclick = () =>
    plan &&
    UI.download(
      JSON.stringify(plan, null, 2),
      "ACTIVITY_APPROVAL.json",
      "application/json",
    );
  $("generate-approved").onclick = () =>
    act(() => {
      ActivityApproval.assertSaved(plan);
      const packet = ActivityApproval.handoff(
        plan,
        UI.getSession(),
        UI.setup.field_guide,
      );
      void UI.zipDownload(
        {
          "APPROVED_CONTENT_HANDOFF.txt": packet.text,
          ...packet.assets,
          "READ_ME.txt":
            (packet.oversize
              ? `Above advisory target: approximately ${packet.estimated_tokens} input tokens. No required text was truncated. Use a chat with sufficient capacity or generate a smaller approved plan; do not silently omit dependencies.\n\n`
              : "") +
            "Unzip and send APPROVED_CONTENT_HANDOFF.txt plus any Teaching_PDFs to your work-approved AI chat. Request ACTIVITY_RESULTS.json. Only approved proposals may be drafted. Bring the result back to this unchanged work session. Save work ZIP before closing. Review semantic accuracy before Coursera authoring.",
        },
        "Approved_Activity_Handoff.zip",
        $("generate-approved"),
      );
    });
  function importText(text, replace = false, restoredReview = false) {
    const parsed = A.parse(text);
    const s = UI.getSession();
    if (
      s &&
      (parsed.bundle_created_at !== s.created_at || parsed.title !== s.title)
    )
      throw Error(
        "This result does not match the loaded course snapshot and stage. Load its matching work ZIP or revalidate with the current packet.",
      );
    if (s && s.courses.length) ActivityReadiness.resolveDecisions(parsed, s);
    if (
      parsed.mode === "final" &&
      !restoredReview &&
      parsed.activities.some((a) => a.approval_ref)
    ) {
      ActivityApproval.assertSaved(plan);
      for (const a of parsed.activities) {
        const problems = ActivityApproval.problems(parsed, s, a, plan);
        if (problems.length) throw Error(problems.join(" "));
      }
    }
    const nextResult =
      replace || $("result-merge-mode").value === "replace"
        ? parsed
        : A.merge(result?.mode === parsed.mode ? result : null, parsed);
    if (parsed.mode === "opportunity" && s) {
      if (plan) ActivityApproval.assertSaved(plan);
      const combined =
        replace || $("result-merge-mode").value === "replace"
          ? parsed
          : A.merge(recommendations, parsed);
      const next = ActivityApproval.sync(combined, s, plan);
      plan = savePlan(next);
      recommendations = combined;
    }
    result = nextResult;
    resultSession = s;
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
        saved = null,
        savedPlan = null,
        savedRecommendations = null;
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
        for (const name of [
          "ACTIVITY_APPROVAL.json",
          "ACTIVITY_RECOMMENDATIONS.json",
        ])
          if (z.file(name)?._data?.uncompressedSize > 8 * 1024 * 1024)
            throw Error("Saved approval data exceeds 8 MB.");
        if (z.file("ACTIVITY_APPROVAL.json")) {
          if (!$("restore-human-decisions").checked)
            throw Error(
              "To restore your own saved decisions, select Restore my saved human decisions. Never restore an approval created by an AI.",
            );
          savedPlan = JSON.parse(
            await z.file("ACTIVITY_APPROVAL.json").async("string"),
          );
          if (!z.file("ACTIVITY_RECOMMENDATIONS.json"))
            throw Error("Approval ZIP is missing its recommendations.");
          savedRecommendations = A.parse(
            await z.file("ACTIVITY_RECOMMENDATIONS.json").async("string"),
          );
        }
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
          parsed.title !== saved.title)
      )
        throw Error("Saved result and session are from different snapshots.");
      if (saved?.courses.length)
        ActivityReadiness.resolveDecisions(parsed, saved);
      if (saved && !savedPlan && parsed.activities.some((a) => a.approval_ref))
        throw Error(
          "This saved final result is missing its approval record. Restore the complete work ZIP; no approval is inferred.",
        );
      if (
        savedPlan &&
        parsed.mode === "opportunity" &&
        ActivityApproval.canonical(parsed) !==
          ActivityApproval.canonical(savedRecommendations)
      )
        throw Error(
          "Saved displayed recommendations and approved plan disagree.",
        );
      if (savedPlan) {
        ActivityApproval.validate(savedPlan, saved);
        const expected = ActivityApproval.sync(
          savedRecommendations,
          saved,
          savedPlan,
        );
        if (
          ActivityApproval.canonical(expected.entries) !==
          ActivityApproval.canonical(savedPlan.entries)
        )
          throw Error(
            "Saved recommendations conflict with the approval record.",
          );
        // A saved work ZIP may retain an older final draft after a human revises
        // or revokes its proposal. Restore it for review; readiness still blocks
        // every stale/unapproved field. Ordinary final imports remain strict.
      }
      if (saved) {
        await CourseCtiDocuments.verify(saved.visual_assets || []);
        if (savedPlan) savePlan(savedPlan, saved);
        await UI.restoreSession(saved);
        plan = savedPlan;
        recommendations = savedRecommendations;
      }
      importText(text, !!saved, !!(saved && savedPlan));
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
      ...(resultSession ? CoursePrep.bundleFiles(resultSession, UI.setup) : {}),
      "ACTIVITY_RESULTS.json": JSON.stringify(result, null, 2),
      "READ_ME.txt": UI.setup.readme,
      ...(plan
        ? {
            "ACTIVITY_APPROVAL.json": JSON.stringify(plan, null, 2),
            "ACTIVITY_RECOMMENDATIONS.json": JSON.stringify(
              recommendations,
              null,
              2,
            ),
          }
        : {}),
    };
    for (const a of result.activities)
      if (
        ActivityReadiness.check(result, UI.getSession(), a, currentPlan())
          .canCopy
      ) {
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
  window.addEventListener("storage", () => render());
  globalThis.CourseResults = { refreshChecks: render, getPlan: () => plan };
})();
