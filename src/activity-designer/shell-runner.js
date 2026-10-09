// Included after the small CourseShell helpers by build.py. No CTI dependency.
const S = shellScope.CourseShell,
  R = shellScope.CourseRendered,
  start = new URL(location.href);
const route = start.pathname.match(
  /^\/teach\/([^/]+)\/([A-Za-z0-9_-]+)\/content(?:\/|$)/,
);
if (!/^https:\/\/(?:www\.)?coursera\.org$/.test(start.origin) || !route)
  throw Error(
    "Open the signed-in Coursera authoring Course Outline, then run this script.",
  );
const currentItem = start.pathname.match(
  /\/content\/item\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\/?$/,
);
if (captureScope === "current_item" && !currentItem)
  throw Error(
    "Open the specific Coursera authoring quiz/item first, then run the one-item test.",
  );
if (window.CourseActivityCapture?.running)
  throw Error("An activity capture is already running. Use its Stop button.");
window.CourseActivityCapture?.close?.();
const run = { running: true, stopped: false, data: null, close: null };
window.CourseActivityCapture = run;
const course = {
  id: route[2],
  title: document.title
    .replace(/\s*\|\s*Coursera.*$/i, "")
    .split("|")
    .at(-1)
    .trim(),
  url: start.origin + "/teach/" + route[1] + "/" + route[2] + "/content/edit",
};
const observedLinks = [start.href, ...document.querySelectorAll("a[href]")].map(
  (x) => (typeof x === "string" ? x : x.href),
);
const host = document.createElement("div");
host.id = "course-activity-capture";
document.body.append(host);
host.style.cssText =
  "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(400px,calc(100vw - 32px))";
const ui = host.attachShadow({ mode: "open" });
const style = document.createElement("style");
style.textContent =
  ":host{font:14px/1.5 system-ui;color:#fff}section{background:#112b3d;padding:18px;border:1px solid #587184;border-radius:12px;box-shadow:0 10px 35px #0005}h2{font-size:18px;margin:0 0 8px}p{margin:8px 0}button,a{font:inherit;display:inline-block;background:#c1ef7c;color:#112b3d;border:0;border-radius:6px;padding:8px 10px;margin:4px 6px 4px 0;cursor:pointer;text-decoration:none}button:disabled{opacity:.5}progress,textarea{width:100%;box-sizing:border-box}textarea{height:140px}small{color:#d1dde6}";
ui.append(style);
const box = document.createElement("section");
ui.append(box);
function el(tag, text) {
  const x = document.createElement(tag);
  x.textContent = text || "";
  box.append(x);
  return x;
}
el(
  "h2",
  "Course Activity Capture v1.2.1" +
    (captureScope === "current_item" ? " · One-item test" : ""),
);
const status = el("p", "Reading the course outline…"),
  progress = el("progress");
progress.max = 1;
progress.value = 0;
el(
  "small",
  "Independent reader. No Save, Publish, answer-selection or course-edit actions. Keep this tab open.",
);
const stop = el("button", "Stop & keep captured text");
stop.onclick = () => {
  run.stopped = true;
  status.textContent = "Stopping after the current read…";
};
const downloads = el("div"),
  fallback = el("textarea");
fallback.hidden = true;
fallback.readOnly = true;
const urls = [];
let frame = null;
const started = Date.now(),
  MAX_RUN = 30 * 60 * 1000;
run.close = () => {
  if (run.running) {
    run.stopped = true;
    return;
  }
  host.remove();
  frame?.remove();
  urls.forEach(URL.revokeObjectURL);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const shouldStop = () => run.stopped || Date.now() - started > MAX_RUN;
function clean(value) {
  const doc = new DOMParser().parseFromString(String(value), "text/html");
  doc.querySelectorAll("script,style,noscript").forEach((e) => e.remove());
  return (doc.body.textContent || "").replace(/\u00a0/g, " ").trim();
}
function safeAPI(url) {
  try {
    const u = new URL(url, start.origin);
    return u.origin === start.origin &&
      /^\/api\/(?:authoring[A-Za-z]+|itemDraftProperties|onDemand(?:Supplements|Lectures|Videos|Assessments|Exams|Discussions|Assignments)[A-Za-z]*)\.v\d+(?:\/|$)/.test(
        u.pathname,
      ) &&
      !/(?:delete|publish|submit|enroll|user|session|grade|permission|login)/i.test(
        u.pathname,
      )
      ? u
      : null;
  } catch {
    return null;
  }
}
async function get(url) {
  const u = safeAPI(url);
  if (!u) throw Error("Unsupported read URL.");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(u.href, {
      method: "GET",
      credentials: "same-origin",
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw Error("HTTP " + response.status);
    const text = await response.text();
    if (text.length > 6000000)
      throw Error("Response exceeds 6 MB; not parsed.");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
function apiForItem(raw, id) {
  const u = safeAPI(raw);
  if (!u) return false;
  const values = [...u.pathname.split("/"), ...u.searchParams.values()];
  return values.some((v) => {
    try {
      v = decodeURIComponent(v);
    } catch {}
    return (
      v === id ||
      v === course.id + "~" + id ||
      v === course.id + "!" + id ||
      v === course.id + "+" + id
    );
  });
}
function add(it, blocks, source) {
  const prior = new Set(it.blocks.map((b) => b.field + "|" + b.text));
  let chars = it.blocks.reduce((n, b) => n + b.text.length, 0);
  for (const b of blocks) {
    if (b.kind !== "gap" && !S.textQuality(b.text).readable) continue;
    const field = source + " / " + b.field,
      key = field + "|" + b.text;
    if (prior.has(key)) continue;
    if (chars + b.text.length > 2000000) {
      if (!it.notes.includes("Item text limit reached; further text omitted."))
        it.notes.push("Item text limit reached; further text omitted.");
      break;
    }
    prior.add(key);
    chars += b.text.length;
    it.blocks.push({
      ...b,
      field,
      kind:
        S.isAssessmentType(it.type) && b.kind !== "gap" ? "assessment" : b.kind,
    });
  }
}
function visible(e) {
  return (
    !!e.getClientRects().length && e.getAttribute("aria-hidden") !== "true"
  );
}
function editor(doc, it) {
  const fields = [
    ...doc.querySelectorAll(
      'textarea,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]',
    ),
  ].filter(visible);
  const exact = [...doc.querySelectorAll("[data-testid],[data-item-id]")]
    .filter(
      (e) =>
        e.getAttribute("data-testid") === course.id + "+" + it.id ||
        e.getAttribute("data-item-id") === it.id,
    )
    .filter((e) => fields.some((f) => e === f || e.contains(f)));
  if (exact.length) return exact.sort((a, b) => (a.contains(b) ? 1 : -1))[0];
  const titleNodes = [...doc.querySelectorAll("h1,h2,h3,h4,input,textarea")]
    .filter(visible)
    .filter(
      (e) =>
        !e.closest('nav,a,button,[role="navigation"]') &&
        (e.value || e.textContent || "").trim() === it.title,
    );
  if (!titleNodes.length) return null;
  for (const title of titleNodes) {
    for (
      let p = title.parentElement, n = 0;
      p && p !== doc.body && n < 10;
      p = p.parentElement, n++
    )
      if (fields.some((f) => p.contains(f) && f !== title)) return p;
  }
  return null;
}
function readEditor(doc, it, label) {
  const root = editor(doc, it);
  if (!root) return false;
  const fields = [
    ...root.querySelectorAll(
      'textarea,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],input[type="text"]',
    ),
  ].filter(visible);
  if (root.matches('textarea,[contenteditable],[role="textbox"]'))
    fields.unshift(root);
  const blocks = [];
  for (const f of fields) {
    if (fields.some((other) => other !== f && other.contains(f))) continue;
    const labelled = f.getAttribute("aria-labelledby"),
      labels = labelled
        ? labelled
            .split(/\s+/)
            .map((id) => doc.getElementById(id)?.textContent || "")
            .join(" ")
        : "";
    const field =
      [
        f.getAttribute("aria-label"),
        labels,
        f.labels?.[0]?.textContent,
        f.getAttribute("name"),
        f.getAttribute("placeholder"),
      ]
        .filter(Boolean)
        .join(" ") || "Visible editor field";
    if (
      S.protectedField.test(field) ||
      /title|item.?name|search|filter|time.?estimate/i.test(field)
    )
      continue;
    const text = (f.value || f.innerText || f.textContent || "").trim();
    if (!text || text === it.title || !S.textQuality(text).readable) continue;
    blocks.push({
      field: label + " / " + field,
      text,
      kind: S.isAssessmentType(it.type) ? "assessment" : "teaching",
    });
  }
  add(it, blocks, "Editor");
  return blocks.length > 0;
}
function questionButtons(doc) {
  return [...doc.querySelectorAll('button,[role="tab"],[role="treeitem"]')]
    .filter(visible)
    .filter((e) =>
      /^Question\s+\d+\s*$/i.test(
        (e.getAttribute("aria-label") || e.textContent || "").trim(),
      ),
    );
}
function readRendered(doc, it) {
  if (!S.isAssessmentType(it.type)) return false;
  const r = R.read(doc);
  if (!r.metrics.visible_question_headers) return false;
  if (
    (it.assessment_capture?.prompts_captured || 0) > r.metrics.prompts_captured
  )
    return false;
  it.assessment_capture = r.metrics;
  it.assessment_gaps = r.gaps;
  it.blocks = it.blocks.filter(
    (b) => !b.field.startsWith("Read-only assessment / "),
  );
  add(it, r.blocks, "Read-only assessment");
  return r.blocks.length > 0;
}
async function visit(it, current = false) {
  const url = R.itemURL(course, it, observedLinks);
  if (!url) {
    it.notes.push("No supported item editor route type was present.");
    return;
  }
  it.route = current ? start.origin + start.pathname : url;
  let doc, view;
  if (current) {
    doc = document;
    view = window;
  } else {
    let ready = false;
    await new Promise((resolve) => {
      let ended = false;
      const done = () => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        frame.onload = null;
        resolve();
      };
      const timer = setTimeout(done, 20000);
      frame.onload = () => {
        try {
          ready =
            frame.contentWindow.location.origin === start.origin &&
            frame.contentWindow.location.pathname === new URL(url).pathname;
        } catch {}
        done();
      };
      frame.src = url;
    });
    if (!ready) {
      it.notes.push(
        "Editor could not be loaded in the reader frame (login, policy or unsupported route).",
      );
      return;
    }
    doc = frame.contentDocument;
    view = frame.contentWindow;
  }
  let found = false,
    previous = "",
    stable = 0;
  // A stable loading screen is not ready content. Wait up to ~30 seconds for readable text.
  for (let tries = 0; tries < 46 && !shouldStop(); tries++) {
    await pause(650);
    const editable = readEditor(doc, it, "Current content"),
      rendered = readRendered(doc, it);
    found = editable || rendered || found;
    const text = it.blocks.map((b) => b.text).join("\n");
    stable = text && text === previous ? stable + 1 : 0;
    previous = text;
    if (stable >= 3) break;
  }
  const qs = questionButtons(doc),
    seenQuestions = new Set();
  for (let n = 0; n < Math.min(qs.length, 150) && !shouldStop(); n++) {
    const candidate = questionButtons(doc)[n];
    if (!candidate) continue;
    const label = (
      candidate.getAttribute("aria-label") ||
      candidate.textContent ||
      ""
    ).trim();
    if (seenQuestions.has(label)) continue;
    seenQuestions.add(label);
    candidate.click();
    await pause(900);
    readEditor(doc, it, label);
  }
  if (S.isAssessmentType(it.type))
    it.notes.push(
      "Assessment editor text is internal design evidence. " +
        seenQuestions.size +
        " explicit question navigation controls visited; hidden/randomized parts and total question completeness are not certified. Answer/feedback fields are omitted by label when recognized.",
    );
  if (it.assessment_capture) {
    const m = it.assessment_capture;
    it.notes.push(
      "Read-only assessment capture: " +
        m.prompts_captured +
        "/" +
        m.visible_question_headers +
        " visible question prompts; " +
        m.options_captured +
        "/" +
        m.choice_controls_seen +
        " visible choice controls have text. Completeness remains partial and unverified.",
    );
    it.notes.push(...it.assessment_gaps);
    delete it.assessment_gaps;
  }
  const observed = [
    ...new Set(
      view.performance.getEntriesByType("resource").map((x) => x.name),
    ),
  ]
    .filter((u) => apiForItem(u, it.id))
    .slice(0, 6);
  for (const u of observed) {
    if (shouldStop()) break;
    try {
      add(it, S.fields(await get(u), clean), "Item API " + new URL(u).pathname);
    } catch (e) {
      it.notes.push(
        "An observed item response could not be read: " + e.message,
      );
    }
  }
  if (!found && !it.blocks.length)
    it.notes.push(
      "No identity-associated readable editor fields or supported read-only question sections were found.",
    );
  if (!it.blocks.length) {
    const diagnostic = {
      identity_container: !!editor(doc, it),
      visible_text_fields: [
        ...doc.querySelectorAll(
          'textarea,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]',
        ),
      ].filter(visible).length,
      question_controls: seenQuestions.size,
      matched_read_requests: observed.length,
    };
    it.notes.push(
      "Read diagnostics (counts only): " + JSON.stringify(diagnostic),
    );
  }
  if (it.blocks.some((b) => S.textQuality(b.text).viewer_text))
    it.notes.push(
      "Document viewer text only: captured rendered pages may omit later pages, diagrams and formulas. Complete attachment text was not retrieved.",
    );
  it.notes.push(
    "Media, figures, external plugins and unattached documents were not interpreted. Text may be partial.",
  );
}
function deliver(c) {
  run.data = c;
  const text = JSON.stringify(c, null, 2),
    blob = new Blob([text], { type: "application/json" }),
    url = URL.createObjectURL(blob);
  urls.push(url);
  const single = c.capture_scope === "current_item";
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (single ? "Course_Activity_One_Item_Test_" : "Course_Activity_Capture_") +
    c.course.id +
    ".json";
  a.textContent = single ? "Download one-item test" : "Download course capture";
  downloads.append(a);
  const copy = el("button", "Copy capture data");
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
    } catch {
      fallback.hidden = false;
      fallback.value = text;
      fallback.select();
    }
  };
  const close = el("button", "Close");
  close.onclick = run.close;
  const s = S.summary(c),
    tested = c.items.find((x) => x.id === c.selected_item_id),
    m = tested?.assessment_capture;
  status.textContent = single
    ? "One-item test: " +
      (tested?.title || "item") +
      ". " +
      (m
        ? m.prompts_captured +
          "/" +
          m.visible_question_headers +
          " visible prompts and " +
          m.options_captured +
          "/" +
          m.choice_controls_seen +
          " visible options captured. "
        : tested?.blocks.length
          ? "Readable text captured. "
          : "No readable body captured. ") +
      "Other items were not scanned. Download this test to check the capture."
    : s.with_text +
      "/" +
      s.items +
      " items have non-placeholder text (not necessarily complete). " +
      s.unread +
      " unread. Assessments with text: " +
      s.assessments_with_text +
      "/" +
      s.quizzes +
      ". " +
      (c.status === "stopped" ? "Stopped early. " : "") +
      "Import this JSON in Course Activity Designer.";
}
try {
  const raw = await get(
    "/api/authoringCourseMaterials.v1/" +
      encodeURIComponent(course.id) +
      "/?fields=material",
  );
  const capture = S.outline(raw, course);
  capture.extractor_version = "1.2.1";
  capture.capture_scope = captureScope;
  run.data = capture;
  if (!capture.items.length)
    throw Error(
      "No module/item structure was recognized. No course understanding can be claimed.",
    );
  const targets =
    captureScope === "current_item"
      ? capture.items.filter((it) => it.id === currentItem[1])
      : capture.items;
  if (!targets.length)
    throw Error(
      "The current item ID was not found in the course outline; no content was read.",
    );
  if (captureScope === "current_item") {
    capture.selected_item_id = currentItem[1];
    capture.issues.push(
      "One-item test only. Other outline items were not scanned; do not use this test as a complete course review.",
    );
    for (const it of capture.items)
      if (it.id !== currentItem[1])
        it.notes.push("Not scanned: this export is a one-item test.");
  }
  progress.max = targets.length;
  // One isolated reader frame; no input values, answer controls or course mutations are sent.
  if (captureScope !== "current_item") {
    frame = document.createElement("iframe");
    frame.title = "Read-only course item capture";
    frame.style.cssText =
      "position:fixed;left:0;top:0;width:1000px;height:760px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(frame);
  }
  for (let i = 0; i < targets.length; i++) {
    if (shouldStop()) break;
    const it = targets[i];
    status.textContent =
      i +
      1 +
      "/" +
      targets.length +
      " · " +
      it.title +
      " · " +
      Math.floor((Date.now() - started) / 1000) +
      "s";
    try {
      await visit(it, captureScope === "current_item");
    } catch (e) {
      it.notes.push("Read failed: " + e.message);
    }
    it.coverage = it.blocks.some((b) => b.kind !== "gap")
      ? "partial"
      : "unread";
    progress.value = i + 1;
    if (
      capture.items.reduce(
        (sum, x) => sum + x.blocks.reduce((n, b) => n + b.text.length, 0),
        0,
      ) > 25000000
    ) {
      run.stopped = true;
      capture.issues.push(
        "Course capture text budget reached (25 million characters).",
      );
    }
  }
  capture.status = shouldStop() ? "stopped" : "finished";
  capture.issues.push(
    "Text-only shell capture. Every item retains its own coverage; finishing the run does not certify complete content.",
  );
  if (shouldStop())
    capture.issues.push(
      "Capture stopped or reached the 30-minute limit. Unvisited items remain unread.",
    );
  run.running = false;
  deliver(capture);
} catch (e) {
  run.running = false;
  status.textContent = "Capture stopped: " + e.message;
  console.error("Course Activity Capture:", e);
  if (run.data?.items?.length) {
    run.data.status = "stopped";
    run.data.issues.push(e.message);
    deliver(run.data);
  } else {
    const close = el("button", "Close");
    close.onclick = run.close;
  }
} finally {
  run.running = false;
  stop.disabled = true;
  frame?.remove();
  frame = null;
}
