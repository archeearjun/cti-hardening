// Read-only assessment layouts. No framework internals or selected/correct answer state.
(function (root) {
  "use strict";
  const headings = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
  const question = /^(\d+)\s*Auto[\s-]*Graded\s*\d+(?:[.,]\d+)?\s*points?$/i;
  const controls =
    'nav,button,script,style,noscript,svg,input,textarea,select,[role="navigation"],[role="button"],[hidden],[aria-hidden="true"]';
  const choices = 'input[type="radio"],input[type="checkbox"]';
  const protectedMarker =
    /(?:correct|solution|feedback|explanation|answer.?key|selected.?answer|grading|rubric)/i;
  const sectionBoundary =
    /^(?:feedback|(?:correct|incorrect)(?: answer)?|correctness|answer key|solutions?|explanations?|settings|grading|rubric|learning objectives)(?:\s|:|$)/i;
  function visible(e) {
    if (
      !e ||
      e.closest('[hidden],[aria-hidden="true"]') ||
      !e.getClientRects().length
    )
      return false;
    const style = e.ownerDocument.defaultView?.getComputedStyle(e);
    return !style || !["hidden", "collapse"].includes(style.visibility);
  }
  function blocked(e) {
    if (e.closest(controls)) return true;
    for (let p = e; p && p !== e.ownerDocument.body; p = p.parentElement) {
      // Classes can encode which choice is correct; do not discard the option itself.
      // Only omit explicitly named feedback/key/indicator subtrees, never serialize state.
      const marker = ["data-testid", "aria-label", "data-field"]
        .map((k) => p.getAttribute(k) || "")
        .join(" ");
      if (protectedMarker.test(marker)) return true;
    }
    return false;
  }
  function rangeText(doc, range) {
    const out = [],
      walker = doc.createTreeWalker(range.commonAncestorContainer, 4);
    let node;
    while ((node = walker.nextNode())) {
      if (
        !range.intersectsNode(node) ||
        !visible(node.parentElement) ||
        blocked(node.parentElement)
      )
        continue;
      const t = node.textContent.trim();
      // Standalone correctness badges are authoring metadata, not choice text.
      if (t && !/^(?:correct|incorrect)(?:\s+answer)?$/i.test(t)) out.push(t);
    }
    return out.join(" ").replace(/\s+/g, " ").trim();
  }
  function afterUntil(doc, from, to) {
    const r = doc.createRange();
    r.setStartAfter(from);
    if (to) r.setEndBefore(to);
    else r.setEnd(doc.body, doc.body.childNodes.length);
    return r;
  }
  function inside(range, e) {
    return (
      range.comparePoint(e, 0) === 0 &&
      range.comparePoint(e, e.childNodes.length) === 0
    );
  }
  function nodeText(doc, e) {
    const r = doc.createRange();
    r.selectNodeContents(e);
    return rangeText(doc, r);
  }
  function optionText(doc, input, range) {
    const labels = [...(input.labels || [])].filter(
      (e) => visible(e) && inside(range, e),
    );
    if (labels.length === 1) {
      const text = nodeText(doc, labels[0]);
      if (text) return { text, method: "native_label" };
    }
    // ARIA references count only when they point inside this Options section.
    const ids = (input.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);
    const nodes = ids.map((id) => doc.getElementById(id));
    if (
      nodes.length &&
      nodes.every((e) => e && visible(e) && inside(range, e))
    ) {
      const text = nodes
        .map((e) => nodeText(doc, e))
        .filter(Boolean)
        .join(" ");
      if (text) return { text, method: "aria_labelledby" };
    }
    // Coursera can render the choice beside the radio without a native label.
    // Use the nearest text-bearing row with exactly one choice control, bounded
    // entirely by this question's Options region. Never inspect value/checked.
    for (
      let p = input.parentElement, depth = 0;
      p && p !== doc.body && depth < 8;
      p = p.parentElement, depth++
    ) {
      if (!inside(range, p)) break;
      if (p.querySelectorAll(choices).length !== 1) break;
      if (
        [...p.querySelectorAll(headings)].some((h) =>
          sectionBoundary.test(h.textContent.trim()),
        )
      )
        break;
      const text = nodeText(doc, p);
      if (text) return { text, method: "single_control_container" };
    }
    return { text: "", method: "unresolved" };
  }
  function read(doc) {
    const hs = [...doc.querySelectorAll(headings)].filter(
      (e) => visible(e) && !e.closest('nav,button,a,[role="navigation"]'),
    );
    const qs = hs.filter((e) => question.test(e.textContent.trim()));
    const blocks = [],
      gaps = [];
    let prompts = 0,
      options = 0,
      figures = 0,
      choiceControls = 0;
    const details = [];
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i],
        number = q.textContent.trim().match(question)[1],
        from = hs.indexOf(q),
        until = i + 1 < qs.length ? hs.indexOf(qs[i + 1]) : hs.length;
      const sections = hs.slice(from + 1, until),
        prompt = sections.find((e) => /^Prompt$/i.test(e.textContent.trim())),
        opt = sections.find((e) => /^Options$/i.test(e.textContent.trim()));
      let gotPrompt = false,
        choiceCount = 0,
        controlsSeen = 0,
        groupCount = 0;
      const methods = {};
      if (prompt) {
        const end = hs[hs.indexOf(prompt) + 1];
        if (end) {
          const range = afterUntil(doc, prompt, end),
            text = rangeText(doc, range);
          figures += [...doc.querySelectorAll("img,canvas,svg")].filter(
            (e) => visible(e) && range.intersectsNode(e),
          ).length;
          if (text && root.CourseShell.textQuality(text).readable) {
            blocks.push({
              field: "Question " + number + " / Prompt",
              text,
              kind: "assessment",
            });
            prompts++;
            gotPrompt = true;
          }
        }
      }
      if (!gotPrompt)
        gaps.push(
          "Question " +
            number +
            ": readable prompt not located between section headings.",
        );
      if (opt) {
        // Option content may itself contain headings. End at the next question or
        // a known settings/feedback section, rather than any arbitrary heading.
        const end = hs
          .slice(hs.indexOf(opt) + 1)
          .find(
            (e) =>
              question.test(e.textContent.trim()) ||
              sectionBoundary.test(e.textContent.trim()),
          );
        const range = afterUntil(doc, opt, end);
        const inputs = [...doc.querySelectorAll(choices)].filter(
          (e) => visible(e) && range.intersectsNode(e),
        );
        controlsSeen = inputs.length;
        choiceControls += controlsSeen;
        const groups = new Map();
        for (const input of inputs) {
          const name = input.getAttribute("name");
          if (!name) continue;
          const key = input.type + "|" + name;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(input);
        }
        // Ambiguous settings/groups are left unread; no answer control is clicked or inspected for selection.
        groupCount = groups.size;
        const group = groups.size === 1 ? [...groups.values()][0] : [];
        if (group.length >= 2)
          for (const [index, input] of group.entries()) {
            const result = optionText(doc, input, range);
            methods[result.method] = (methods[result.method] || 0) + 1;
            if (result.text) {
              choiceCount++;
              blocks.push({
                field: "Question " + number + " / Option " + (index + 1),
                text: result.text,
                kind: "assessment",
              });
            }
          }
        if (!choiceCount || choiceCount !== inputs.length)
          gaps.push(
            "Question " +
              number +
              ": captured " +
              choiceCount +
              " of " +
              controlsSeen +
              " visible choice controls across " +
              groupCount +
              " named group(s); unresolved options remain unread.",
          );
      }
      details.push({
        question_number: Number(number),
        prompt_captured: gotPrompt,
        options_section_found: !!opt,
        choice_controls_seen: controlsSeen,
        named_groups: groupCount,
        options_captured: choiceCount,
        option_associations: methods,
      });
      options += choiceCount;
    }
    if (figures)
      gaps.push(
        figures +
          " prompt figure(s) found; diagrams and visual formulas were not interpreted.",
      );
    return {
      blocks,
      gaps,
      metrics: {
        layout: "numbered_auto_graded_prompt_options",
        visible_question_headers: qs.length,
        prompts_captured: prompts,
        choice_controls_seen: choiceControls,
        options_captured: options,
        completeness: "partial_unverified",
        questions: details,
      },
    };
  }
  function itemURL(course, it, observed = []) {
    const base = new URL(course.url),
      prefix = base.pathname.replace(/\/edit\/?$/, "/item/");
    for (const raw of observed) {
      try {
        const u = new URL(raw, base);
        const tail = u.pathname.slice(prefix.length);
        if (
          u.origin === base.origin &&
          u.pathname.startsWith(prefix) &&
          /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(tail) &&
          tail.split("/")[1] === it.id
        )
          return u.origin + u.pathname;
      } catch {}
    }
    const type =
      { ungradedAssignment: "project", ungradedWidget: "plugin" }[it.type] ||
      it.type;
    if (
      !/^[A-Za-z0-9_-]+$/.test(type) ||
      type === "unknown" ||
      !/^[A-Za-z0-9_-]+$/.test(it.id)
    )
      return null;
    return base.origin + prefix + type + "/" + it.id;
  }
  root.CourseRendered = { read, itemURL };
})(typeof shellScope !== "undefined" ? shellScope : globalThis);
