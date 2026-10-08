// Course Activity Inspector 1.0 — run on ONE Coursera authoring item opened normally.
// Reads page structure only. No fetch, reload, navigation, clicks, edits or AI calls.
// Does not export input values or read cookies, storage or request headers.
(() => {
  "use strict";
  const start = new URL(location.href);
  if (
    !/^https:\/\/(?:www\.)?coursera\.org$/.test(start.origin) ||
    !/^\/teach\//.test(start.pathname)
  )
    throw Error(
      "Open the course item normally in Coursera authoring, then run this inspector.",
    );
  const secret =
    /(password|token|secret|cookie|authorization|email|student|learner|submission|correct|answer|solution|feedback|score)/i;
  const clean = (s) =>
    String(s || "")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email omitted]")
      .slice(0, 180);
  const visible = (e) =>
    !!e.getClientRects().length && e.getAttribute("aria-hidden") !== "true";
  function safeURL(raw) {
    try {
      const u = new URL(raw, start);
      if (!/^https?:$/.test(u.protocol)) return null;
      return u.origin + u.pathname;
    } catch {
      return null;
    }
  }
  function fieldLabel(e, doc) {
    const ids = (e.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);
    return clean(
      [
        e.getAttribute("aria-label"),
        ...ids.map((id) => doc.getElementById(id)?.textContent || ""),
        e.labels?.[0]?.textContent,
        e.getAttribute("name"),
        e.getAttribute("placeholder"),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  function describe(e, doc) {
    const label = fieldLabel(e, doc),
      blocked = secret.test(label) || e.getAttribute("type") === "password";
    return {
      tag: e.tagName,
      role: clean(e.getAttribute("role")),
      type: clean(e.getAttribute("type")),
      visible: visible(e),
      label: blocked ? "[protected label]" : label,
      test_id: clean(e.getAttribute("data-testid")),
      item_id: clean(e.getAttribute("data-item-id")),
      editable: e.getAttribute("contenteditable"),
      text_characters: blocked
        ? null
        : String(e.value || e.innerText || e.textContent || "").trim().length,
    };
  }
  const seen = new Set(),
    pages = [],
    frames = [];
  let processed = 0;
  function read(doc, win, depth, label) {
    if (!doc || seen.has(doc) || depth > 3 || processed++ >= 15) return;
    seen.add(doc);
    const fields = [
      ...doc.querySelectorAll(
        'textarea,input,[contenteditable],[role="textbox"]',
      ),
    ];
    const controls = [
      ...doc.querySelectorAll(
        'button,[role="button"],[role="tab"],[role="treeitem"]',
      ),
    ].filter(visible);
    const headings = [
      ...doc.querySelectorAll('h1,h2,h3,h4,[role="heading"]'),
    ].filter(visible);
    const data = {
      frame: label,
      path: safeURL(win.location.href),
      ready_state: doc.readyState,
      title: clean(doc.title),
      field_count: fields.length,
      fields: fields.slice(0, 120).map((e) => describe(e, doc)),
      controls: controls.slice(0, 120).map((e) => {
        const label = clean(e.getAttribute("aria-label") || e.textContent);
        return {
          tag: e.tagName,
          role: clean(e.getAttribute("role")),
          label: secret.test(label) ? "[protected label]" : label,
        };
      }),
      headings: headings.slice(0, 30).map((e) => clean(e.textContent)),
      item_links: [...doc.querySelectorAll("a[href]")]
        .map((a) => safeURL(a.href))
        .filter(
          (u) =>
            u && u.startsWith(start.origin + "/teach/") && /\/item\//.test(u),
        )
        .slice(0, 100),
      resource_requests: [],
      open_shadow_hosts: [],
    };
    // Names and paths only: no URL query values, headers, bodies, timing or user identifiers.
    try {
      data.resource_requests = [
        ...new Map(
          win.performance
            .getEntriesByType("resource")
            .filter((x) => {
              try {
                return (
                  new URL(x.name).origin === start.origin &&
                  /^\/api\//.test(new URL(x.name).pathname) &&
                  !/^\/api\/(?:oauth|authn|login|sessions?|users?|profiles?|grades?|submissions?|memberships?)(?:[.\/]|$)/i.test(
                    new URL(x.name).pathname,
                  )
                );
              } catch {
                return false;
              }
            })
            .map((x) => {
              const u = new URL(x.name);
              return [
                u.pathname,
                {
                  path: u.pathname,
                  query_keys: [...new Set(u.searchParams.keys())].filter(
                    (k) => !secret.test(k),
                  ),
                  initiator: x.initiatorType,
                },
              ];
            }),
        ).values(),
      ].slice(0, 120);
    } catch {}
    // Bound the DOM survey. Shadow-root field structure is useful for editor diagnosis.
    const all = doc.querySelectorAll("*");
    for (let i = 0; i < Math.min(all.length, 12000); i++)
      if (all[i].shadowRoot) {
        const host = all[i],
          sf = [
            ...host.shadowRoot.querySelectorAll(
              'textarea,input,[contenteditable],[role="textbox"]',
            ),
          ];
        data.open_shadow_hosts.push({
          tag: host.tagName,
          field_count: sf.length,
          fields: sf.slice(0, 30).map((e) => describe(e, doc)),
        });
      }
    pages.push(data);
    for (const [n, f] of [...doc.querySelectorAll("iframe")]
      .slice(0, 20)
      .entries()) {
      const entry = {
        parent: label,
        frame: label + "." + n,
        src: safeURL(f.src),
        title: clean(f.title),
        same_origin_readable: false,
      };
      frames.push(entry);
      try {
        if (
          f.contentDocument &&
          f.contentWindow.location.origin === start.origin
        ) {
          entry.same_origin_readable = true;
          read(f.contentDocument, f.contentWindow, depth + 1, entry.frame);
        }
      } catch {}
    }
  }
  // Exclude our own panel on repeat runs.
  document.getElementById("course-activity-inspector")?.remove();
  read(document, window, 0, "top");
  const result = {
    format: "course-activity-page-diagnostic",
    schema_version: 1,
    created_at: new Date().toISOString(),
    page_url: start.origin + start.pathname,
    purpose:
      "Diagnose current item route, editor fields, nested frames and observed API paths. Content values are not captured.",
    pages,
    frames,
  };
  const text = JSON.stringify(result, null, 2),
    host = document.createElement("div");
  host.id = "course-activity-inspector";
  host.style.cssText =
    "position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(440px,90vw)";
  document.body.append(host);
  const ui = host.attachShadow({ mode: "open" }),
    style = document.createElement("style");
  style.textContent =
    "section{font:14px/1.5 system-ui;background:#112b3d;color:white;padding:20px;border-radius:12px;box-shadow:0 8px 30px #0005}h2{font-size:18px;margin:0 0 10px}a,button{display:inline-block;font:inherit;background:#c1ef7c;color:#112b3d;border:0;border-radius:5px;padding:9px;margin:5px 6px 5px 0;text-decoration:none;cursor:pointer}textarea{box-sizing:border-box;width:100%;height:120px}";
  ui.append(style);
  const box = document.createElement("section");
  ui.append(box);
  function el(tag, value) {
    const e = document.createElement(tag);
    e.textContent = value;
    box.append(e);
    return e;
  }
  el("h2", "One-page inspection ready");
  el(
    "p",
    "This reads the page you opened normally. It does not change the course or capture answer values. Save the JSON and send it back.",
  );
  const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    ),
    a = el("a", "Save diagnostic JSON");
  a.href = url;
  a.download = "Course_Activity_Page_Diagnostic.json";
  const area = el("textarea", "");
  area.value = text;
  area.readOnly = true;
  area.hidden = true;
  const copy = el("button", "Copy JSON");
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
    } catch {
      area.hidden = false;
      area.select();
    }
  };
  const close = el("button", "Close");
  close.onclick = () => {
    URL.revokeObjectURL(url);
    host.remove();
  };
})();
