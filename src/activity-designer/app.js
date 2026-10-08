(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    C = globalThis.CoursePrep;
  const setup = globalThis.CourseActivitySetup;
  const captureScript = globalThis.CourseCtiCaptureScript;
  const testScript = globalThis.CourseActivityCaptureScript.replace(
    "const captureScope='course';",
    "const captureScope='current_item';",
  )
    .replace(
      "Open your signed-in Coursera Course Outline.",
      "Open the specific signed-in Coursera authoring quiz/item to test.",
    )
    .replace(
      "Use Download course capture, then import that JSON in Course Activity Designer.",
      "Use Download one-item test. Other items are not scanned; this is not a full course capture.",
    );
  $("test-script-text").value = testScript;
  $("copy-test-script").onclick = () => copy(testScript);
  $("download-test-script").onclick = () =>
    download(testScript, "Coursera_Activity_Test_One_Item.txt");
  $("capture-script-text").value = captureScript;
  $("copy-capture-script").onclick = () => copy(captureScript);
  $("download-capture-script").onclick = () =>
    download(captureScript, "CTI_Coursera_Capture.txt");
  $("use-shell-json").onclick = () => {
    try {
      const raw = $("shell-json").value;
      const parsed = JSON.parse(raw);
      if (CourseCtiAdapter.matches(parsed)) CourseCtiAdapter.adapt(parsed);
      else CourseShell.validate(parsed);
      const bytes = new TextEncoder().encode(raw);
      addFiles([
        {
          name: "Pasted_Course_Activity_Capture.json",
          size: bytes.length,
          lastModified: Date.now(),
          arrayBuffer: async () => bytes.buffer,
        },
      ]);
      $("shell-json").value = "";
      toast("Capture added. Select Prepare files.");
    } catch (e) {
      error("Could not use capture: " + e.message);
    }
  };
  let selected = [],
    session = null,
    output = null,
    busy = false,
    controller = null,
    ticker = null,
    pdfEngine = null,
    toastTimer = null;
  let bundleRevision = 0,
    bundleBlob = null,
    bundleFilename = "",
    bulkText = "",
    exportURLs = [];
  const deliveryURLs = [];
  const bytesLabel = (n) =>
    n < 1024
      ? `${n} B`
      : n < 1048576
        ? `${(n / 1024).toFixed(0)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;
  const slug = (s) =>
    String(s)
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "Course";
  function el(tag, text, cls) {
    const x = document.createElement(tag);
    if (text !== undefined) x.textContent = text;
    if (cls) x.className = cls;
    return x;
  }
  function toast(t) {
    $("toast").textContent = t;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
  }
  function error(t) {
    $("error").textContent = t;
    $("error").hidden = !t;
  }
  function fileLink(
    data,
    name,
    type = "text/plain;charset=utf-8",
    urls = exportURLs,
  ) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return { blob, url, name };
  }
  function bindLink(node, file) {
    node.href = file.url;
    node.download = file.name;
    node.removeAttribute("aria-disabled");
  }
  function download(data, name, type = "text/plain;charset=utf-8") {
    const f = fileLink(data, name, type, deliveryURLs);
    const box = $("file-delivery");
    box.hidden = false;
    const row = el("div", undefined, "delivery-row");
    row.append(el("strong", "File ready: " + name));
    const link = el("a", "Save " + name, "primary");
    bindLink(link, f);
    row.append(
      link,
      el(
        "p",
        "Click the file link to save. If this embedded view blocks downloads, open the app in a separate browser tab.",
        "small",
      ),
    );
    box.append(row);
    box.scrollIntoView?.({ behavior: "smooth", block: "start" });
    toast("File ready. Use the visible Save link.");
  }
  function resetExports() {
    bundleRevision++;
    bundleBlob = null;
    bundleFilename = "";
    bulkText = "";
    for (const u of exportURLs) URL.revokeObjectURL(u);
    exportURLs = [];
    for (const id of ["download-zip", "download-text"]) {
      $(id).removeAttribute("href");
      $(id).removeAttribute("download");
      $(id).setAttribute("aria-disabled", "true");
    }
    $("download-zip").textContent = "Preparing ZIP…";
    $("save-bundle").hidden = true;
    $("save-bundle").disabled = false;
    $("bundle-status").textContent = "";
    $("export-help").hidden = true;
    $("text-fallback").open = false;
    $("export-text").value = "";
    $("export-text").hidden = true;
    $("text-copy-status").textContent = "";
  }
  async function updateExports() {
    resetExports();
    const revision = bundleRevision,
      files = output;
    if (!files || !session) return false;
    const basename = slug(session.title);
    bundleFilename = basename + "_Full_Backup.zip";
    bulkText =
      "COURSE CONTEXT PREP — COMPLETE TEXT HANDOFF\nThis single file contains the handoff, all numbered context parts and coverage. SESSION.json is not duplicated here; the same curriculum and source text are presented below. Read every section.\n\n" +
      Object.entries(files)
        .filter(
          ([name, body]) => name !== "SESSION.json" && typeof body === "string",
        )
        .map(([name, text]) => `===== ${name} =====\n${text}`)
        .join("\n\n");
    bindLink(
      $("download-text"),
      fileLink(bulkText, basename + "_Course_Context.txt"),
    );
    $("download-text").textContent = "Download course text";
    $("download-parts").replaceChildren();
    const details = el("details");
    details.append(el("summary", "Individual files and saved session"));
    const list = el("div", undefined, "parts");
    for (const [name, body] of Object.entries(files)) {
      const a = el("a", name, "text-button");
      bindLink(
        a,
        fileLink(
          body,
          name,
          name.endsWith(".pdf")
            ? "application/pdf"
            : name.endsWith(".json")
              ? "application/json"
              : "text/plain;charset=utf-8",
        ),
      );
      list.append(a);
    }
    details.append(list);
    $("download-parts").append(details);
    $("bundle-status").textContent =
      "Creating ZIP… Course text is already available below.";
    try {
      const zip = new JSZip();
      for (const [name, body] of Object.entries(files)) zip.file(name, body);
      const bytes = await zip.generateAsync(
        {
          type: "uint8array",
          compression: "DEFLATE",
          compressionOptions: { level: 4 },
        },
        (metadata) => {
          if (revision === bundleRevision)
            $("bundle-status").textContent =
              `Creating ZIP… ${Math.round(metadata.percent)}%`;
        },
      );
      if (revision !== bundleRevision) return false;
      const f = fileLink(bytes, bundleFilename, "application/zip");
      bundleBlob = f.blob;
      bindLink($("download-zip"), f);
      $("download-zip").textContent = "Download full backup";
      $("save-bundle").hidden = typeof window.showSaveFilePicker !== "function";
      $("bundle-status").textContent =
        `Ready · ${bytesLabel(bundleBlob.size)}. Click Download full backup to save ${bundleFilename}.`;
      return true;
    } catch (e) {
      if (revision === bundleRevision) {
        $("download-zip").textContent = "ZIP unavailable";
        $("bundle-status").textContent =
          "ZIP creation failed: " +
          e.message +
          ". Use Download course text below.";
        $("text-fallback").open = true;
      }
      return false;
    }
  }
  async function saveBundleAs() {
    if (!bundleBlob) return;
    const blob = bundleBlob,
      name = bundleFilename,
      revision = bundleRevision;
    let writable;
    // Request the picker immediately during the click; ZIP creation has already completed.
    try {
      const picker = window.showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: "Course context ZIP",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      $("save-bundle").disabled = true;
      const handle = await picker;
      writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      writable = null;
      if (revision === bundleRevision)
        $("bundle-status").textContent =
          "Saved " +
          name +
          ". Keep it to resume later. Use a compact packet for the AI chat.";
    } catch (e) {
      if (writable?.abort)
        try {
          await writable.abort();
        } catch {}
      if (revision === bundleRevision) {
        $("bundle-status").textContent =
          e.name === "AbortError"
            ? "Save cancelled. Your bundle is still ready."
            : "This browser view could not save the ZIP: " +
              e.message +
              ". Try the file link or the course-text option.";
        if (e.name !== "AbortError") {
          $("export-help").hidden = false;
          $("text-fallback").open = true;
        }
      }
    } finally {
      if (revision === bundleRevision) $("save-bundle").disabled = false;
    }
  }
  function showCourseText() {
    if (!bulkText) return;
    $("text-fallback").open = true;
    $("export-text").value = bulkText;
    $("export-text").hidden = false;
    $("export-text").focus?.();
    $("export-text").select();
    $("text-copy-status").textContent =
      "All course text is selected. Press Command+C on Mac or Ctrl+C on Windows to copy it.";
  }
  async function copyCourseText() {
    if (!bulkText) return;
    const text = bulkText;
    showCourseText();
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      $("text-copy-status").textContent =
        "Copied all course text. If it is too long for a chat message, paste it into a plain-text file and attach that file to ChatGPT.";
    } catch {
      $("text-copy-status").textContent =
        "Automatic copy is unavailable. The full text is selected above; press Command+C on Mac or Ctrl+C on Windows.";
    }
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.");
    } catch {
      const t = el("textarea");
      t.value = text;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.append(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      toast(
        ok
          ? "Copied."
          : "Copy is unavailable. Select the text and copy it manually.",
      );
    }
  }
  function showView(which) {
    for (const w of ["prepare", "activities", "setup"])
      $(w + "-view").hidden = w !== which;
    for (const w of ["prepare", "activities", "setup"]) {
      const b = $("nav-" + w);
      b.classList.toggle("active", w === which);
      if (w === which) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
  }
  function invalidate() {
    resetExports();
    session = null;
    output = null;
    $("result").hidden = true;
    $("empty-result").hidden = false;
    $("step-label").textContent = "01 / ADD FILES";
    globalThis.CourseResults?.refreshChecks();
    globalThis.CoursePackets?.refresh();
  }
  function refreshFiles() {
    $("file-list").replaceChildren();
    $("file-count").textContent = selected.length
      ? `${selected.length} file${selected.length === 1 ? "" : "s"} · ${bytesLabel(selected.reduce((n, f) => n + f.size, 0))}`
      : "No files selected";
    selected.forEach((f, i) => {
      const li = el("li");
      const box = el("div");
      box.append(el("strong", f.name), el("span", bytesLabel(f.size), "small"));
      const b = el("button", "×", "remove-file");
      b.type = "button";
      b.title = "Remove " + f.name;
      b.setAttribute("aria-label", "Remove " + f.name);
      b.disabled = busy;
      b.onclick = () => {
        selected.splice(i, 1);
        refreshFiles();
      };
      li.append(box, b);
      $("file-list").append(li);
    });
    $("process").disabled = busy || !selected.length;
    $("clear").disabled = busy || !selected.length;
    $("choose").disabled = busy;
    $("title").disabled = busy;
    $("phase").disabled = busy;
  }
  function addFiles(files) {
    if (busy) return;
    for (const f of files)
      if (
        !selected.some(
          (x) =>
            x.name === f.name &&
            x.size === f.size &&
            x.lastModified === f.lastModified,
        )
      )
        selected.push(f);
    error("");
    refreshFiles();
  }
  async function pdfText(bytes) {
    if (!pdfEngine)
      pdfEngine = (async () => {
        const engine = await import("./vendor/pdf.min.mjs");
        engine.GlobalWorkerOptions.workerSrc = new URL(
          "./vendor/pdf.worker.min.mjs",
          location.href,
        ).href;
        return engine;
      })();
    const engine = await pdfEngine;
    const task = engine.getDocument({
      data: bytes.slice(),
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
    });
    const abort = () => task.destroy();
    controller?.signal.addEventListener("abort", abort, { once: true });
    let doc;
    try {
      doc = await task.promise;
      const parts = [],
        links = [];
      let blank = 0;
      const maxPages = 1500;
      const pages = Math.min(doc.numPages, maxPages);
      for (let i = 1; i <= pages; i++) {
        if (controller?.signal.aborted)
          throw new DOMException("Processing cancelled", "AbortError");
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        let t = "";
        for (const item of tc.items)
          if ("str" in item) t += item.str + (item.hasEOL ? "\n" : " ");
        if (!t.trim()) blank++;
        const annotations = await page.getAnnotations();
        const urls = annotations
          .map((a) => a.url)
          .filter((u) => /^https?:\/\//i.test(u || ""));
        links.push(...urls);
        parts.push(
          `[PAGE ${i}]\n${t.trim() || "[No text layer on this page]"}${urls.length ? "\nPage link annotations (not fetched):\n" + urls.join("\n") : ""}`,
        );
        page.cleanup();
        if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      return {
        text: parts.join("\n\n"),
        links: [...new Set(links)],
        coverage: pages < doc.numPages ? "partial_text" : "text_only",
        note: `PDF text layer and link annotations only. Images/diagrams were not interpreted. ${blank} of ${pages} processed pages had no text. ${pages < doc.numPages ? `Pages ${pages + 1}–${doc.numPages} were not processed (1,500-page limit).` : ""}`.trim(),
      };
    } finally {
      controller?.signal.removeEventListener("abort", abort);
      await task.destroy();
    }
  }
  function attention(s) {
    return [
      ...s.issues.map((i) => `${i.file}: ${i.reason}`),
      ...s.sources.flatMap((x) => [
        ...(x.warnings || []).map((w) => `${x.filename}: ${w}`),
        ...x.unread.map((u) => `${x.filename} / ${u.path}: ${u.reason}`),
        ...x.external_links.map(
          (l) => `${l.url} — linked from ${l.path}; not fetched.`,
        ),
        ...x.documents
          .filter((d) => d.coverage === "partial_text")
          .map((d) => `${x.filename} / ${d.path}: ${d.note}`),
      ]),
      ...s.references
        .filter((r) => r.coverage === "partial_text")
        .map((r) => `${r.filename}: ${r.note}`),
    ];
  }
  function render(s) {
    const st = C.stats(s);
    $("result").hidden = false;
    $("empty-result").hidden = true;
    $("step-label").textContent = "02 / USE YOUR AI CHAT";
    $("result-title").textContent = s.title;
    $("result-subtitle").textContent =
      `${s.phase === "final" ? "Final drafting evidence" : "Early opportunity evidence"} · ready for your AI chat`;
    $("stats").replaceChildren();
    for (const [value, label] of [
      [st.courses, "course snapshots"],
      [st.modules, "modules"],
      [st.items, "target items"],
      [st.documents, "source documents"],
    ]) {
      const d = el("div", undefined, "stat");
      d.append(el("strong", String(value)), el("span", label));
      $("stats").append(d);
    }
    const shellRead = new Set(
        s.sources
          .filter((x) => x.kind === "captured_shell")
          .flatMap((x) =>
            x.documents
              .filter((d) => CourseShell.textQuality(d.text).readable)
              .map((d) => x.course_id + ":" + d.id),
          ),
      ),
      shellAssessments = s.courses
        .filter((c) => c.kind === "coursera_shell_capture")
        .flatMap((c) =>
          c.modules.flatMap((m) =>
            m.lessons.flatMap((l) =>
              l.items
                .filter((i) => /quiz|exam|assessment|assignment/i.test(i.type))
                .map((i) => c.branch_id + ":" + i.id),
            ),
          ),
        );
    const gaps = attention(s);
    const shell = s.sources.filter((x) => x.kind === "captured_shell");
    $("coverage-message").textContent = shell.length
      ? `${shell.reduce((n, x) => n + x.documents.filter((d) => CourseShell.textQuality(d.text).readable).length, 0)} shell items have non-placeholder text; ${shell.reduce((n, x) => n + x.unread.length + x.documents.filter((d) => !CourseShell.textQuality(d.text).readable).length, 0)} have no readable body. Assessments with text: ${shellAssessments.filter((id) => shellRead.has(id)).length}/${shellAssessments.length}. Text presence does not certify full document pages, questions or media. Review the gaps below.`
      : st.documents
        ? `${st.documents} source documents captured. ${st.unread} archive entries unread; ${st.external} external links not fetched. ${st.matched} target items have unique title candidates—these still need content-based verification.`
        : "No source teaching documents were captured. Your AI chat can review available structure and references, but cannot verify lesson-level fit from exports alone.";
    $("coverage-message").classList.toggle(
      "warning",
      !st.documents || st.unread > 0 || st.issues > 0,
    );
    $("attention-count").textContent = String(gaps.length);
    $("issues").replaceChildren();
    for (const g of gaps.slice(0, 150)) $("issues").append(el("li", g));
    if (gaps.length > 150)
      $("issues").append(
        el(
          "li",
          `${gaps.length - 150} more entries appear in 99_COVERAGE.txt.`,
        ),
      );
    if (!gaps.length)
      $("issues").append(
        el(
          "li",
          "No extraction errors or unsupported archive entries were recorded. Text-only extraction still excludes visual interpretation.",
        ),
      );
    $("tree").replaceChildren();
    for (const c of s.courses) {
      const d = el("details", undefined, "course-tree");
      d.open = s.courses.length === 1;
      d.append(el("summary", `${c.title} · ${c.item_count} items`));
      const ul = el("ul");
      for (const m of c.modules) {
        const li = el("li");
        li.append(
          el("strong", `${m.ordinal}. ${m.title}`),
          el(
            "div",
            `${m.lessons.length} lessons · ${m.lessons.reduce((n, l) => n + l.items.length, 0)} items · ${m.id || "no module ID"}`,
            "small",
          ),
        );
        const lessons = el("ul");
        for (const lesson of m.lessons) {
          const row = el("li");
          row.append(el("strong", lesson.title));
          const items = el("ul");
          for (const item of lesson.items) {
            const entry = el("li", item.title);
            const metrics = item.assessment_capture;
            if (metrics)
              entry.append(
                el(
                  "p",
                  `Captured prompts: ${metrics.prompts_captured ?? "unknown"} / ${metrics.visible_question_headers ?? metrics.declared_questions ?? "unknown"} observed or declared. Captured options: ${metrics.options_captured ?? "unknown"} / ${metrics.choice_controls_seen ?? "unknown"} visible controls. Completeness unverified.`,
                  "small",
                ),
              );
            else
              entry.append(
                el(
                  "span",
                  item.body_available
                    ? " · Text present; completeness unverified"
                    : " · Body not captured",
                  "small",
                ),
              );
            items.append(entry);
          }
          row.append(items);
          lessons.append(row);
        }
        li.append(lessons);
        ul.append(li);
      }
      d.append(ul);
      $("tree").append(d);
    }
    for (const x of s.sources)
      $("tree").append(
        el(
          "p",
          `${x.filename}: ${x.documents.length} text documents, ${x.manifests.length} manifests.`,
          "small",
        ),
      );
    for (const r of s.references)
      $("tree").append(
        el("p", `Reference: ${r.filename} (${r.coverage}).`, "small"),
      );
    $("prompt-preview").value = C.handoff(s);
    globalThis.CourseResults?.refreshChecks();
    globalThis.CoursePackets?.refresh();
  }
  async function prepare() {
    if (busy || !selected.length)
      return { error: "Select course files first." };
    busy = true;
    error("");
    refreshFiles();
    controller = new AbortController();
    $("cancel").hidden = false;
    $("progress-wrap").hidden = false;
    $("progress").value = 0;
    const start = Date.now();
    ticker = setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000);
      $("timer").textContent =
        `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    }, 1000);
    try {
      const prepared = await C.processFiles(selected, {
        title: $("title").value.trim(),
        phase: $("phase").value,
        signal: controller.signal,
        pdf: pdfText,
        progress: (p) => {
          $("progress-label").textContent = p.file;
          $("progress-detail").textContent = p.path;
          $("progress").value = p.total
            ? Math.min(99, (p.done / p.total) * 100)
            : 0;
        },
      });
      if (controller.signal.aborted)
        throw new DOMException("Processing cancelled", "AbortError");
      const preparedOutput = C.bundleFiles(prepared, setup);
      session = prepared;
      output = preparedOutput;
      $("cancel").hidden = true;
      render(session);
      const zipReady = await updateExports();
      $("progress").value = 100;
      $("progress-label").textContent = "Preparation complete";
      $("progress-detail").textContent = zipReady
        ? "Your ZIP and course text are ready to save."
        : "Your course text is ready; ZIP creation was not completed.";
      return { title: session.title, ...C.stats(session) };
    } catch (e) {
      error(
        e.name === "AbortError"
          ? "Preparation cancelled. Your previous prepared work is unchanged."
          : `Could not prepare the bundle: ${e.message}. Your previous prepared work is unchanged.`,
      );
      return { error: e.message };
    } finally {
      busy = false;
      clearInterval(ticker);
      $("cancel").hidden = true;
      refreshFiles();
    }
  }
  async function zipDownload(files, name, button) {
    button.disabled = true;
    const old = button.textContent;
    button.textContent = "Creating download…";
    try {
      const zip = new JSZip();
      for (const [n, b] of Object.entries(files)) zip.file(n, b);
      download(
        await zip.generateAsync({
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 4 },
        }),
        name,
        "application/zip",
      );
    } catch (e) {
      error("Download could not be created: " + e.message);
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }
  const setupFiles = () => ({
    "README.txt": setup.readme,
    "GPT_Profile.txt": `${setup.name}\n\n${setup.description}\n\nConversation starters:\n${setup.starters.map((x) => "- " + x).join("\n")}`,
    "GPT_Instructions.txt": setup.instructions,
    "Coursera_Field_Guide.txt": setup.field_guide,
    "03_RESULT_FORMAT.json": JSON.stringify(ActivityDesigner.template, null, 2),
  });
  globalThis.CoursePrepUI = {
    getSession: () => session,
    getOutput: () => output,
    setup,
    showView,
    copy,
    download,
    zipDownload,
    restoreSession: async (saved) => {
      if (busy)
        throw Error(
          "Wait for file preparation to finish before restoring saved work.",
        );
      C.validateSession(saved);
      await CourseCtiDocuments.verify(saved.visual_assets || []);
      if (!["opportunity", "final"].includes(saved.phase))
        throw Error("Saved work has an unsupported stage.");
      const restoredOutput = C.bundleFiles(saved, setup);
      session = saved;
      $("title").value = saved.title;
      $("phase").value = saved.phase;
      phaseHelp();
      output = restoredOutput;
      render(session);
      await updateExports();
    },
  };
  $("nav-activities").onclick = $("go-activities").onclick = () =>
    showView("activities");
  $("back-to-files").onclick = () => showView("prepare");
  $("nav-prepare").onclick = () => showView("prepare");
  $("nav-setup").onclick = $("setup-inline").onclick = () => showView("setup");
  $("choose").onclick = () => $("file-input").click();
  $("file-input").onchange = (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  };
  $("clear").onclick = () => {
    selected = [];
    invalidate();
    refreshFiles();
  };
  for (const type of ["dragenter", "dragover"])
    $("drop-zone").addEventListener(type, (e) => {
      e.preventDefault();
      if (!busy) $("drop-zone").classList.add("drag");
    });
  for (const type of ["dragleave", "drop"])
    $("drop-zone").addEventListener(type, (e) => {
      e.preventDefault();
      $("drop-zone").classList.remove("drag");
      if (type === "drop") addFiles(e.dataTransfer.files);
    });
  // Prevent dropped files outside the target from navigating away from the unsaved session.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  $("process").onclick = prepare;
  $("cancel").onclick = () => {
    controller?.abort();
    $("progress-detail").textContent = "Cancelling after the current read…";
  };
  function phaseHelp() {
    $("phase-help").textContent =
      $("phase").value === "final"
        ? "Use a shell capture, or exports with source teaching content. Add an existing outline or feedback if available. The AI returns exact placement and final fields."
        : "Use the original source and initial shell export. Add the Content Map if available. The AI proposes opportunities for partner review.";
  }
  $("title").onchange = $("phase").onchange = () => {
    phaseHelp();
    if (session) {
      session = { ...session, created_at: new Date().toISOString() };
      session.title = $("title").value.trim() || session.title;
      session.phase = $("phase").value;
      output = C.bundleFiles(session, setup);
      render(session);
      void updateExports();
    }
  };
  $("copy-prompt").onclick = () => session && copy(C.handoff(session));
  $("download-zip").onclick = (e) => {
    if (!bundleBlob) {
      e.preventDefault();
      return;
    }
    $("export-help").hidden = false;
    $("bundle-status").textContent =
      "Download requested. If no file appears, use Save bundle as… or the course text below.";
  };
  $("save-bundle").onclick = saveBundleAs;
  $("show-text").onclick = showCourseText;
  $("copy-text").onclick = copyCourseText;
  $("system-instructions").value = setup.instructions;
  $("copy-system").onclick = () => copy(setup.instructions);
  $("download-setup").onclick = () =>
    zipDownload(
      setupFiles(),
      "Course_Activity_Designer_GPT_Setup.zip",
      $("download-setup"),
    );
  phaseHelp();
  refreshFiles();
})();
