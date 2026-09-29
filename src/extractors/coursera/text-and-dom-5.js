import { itemRowRootForFingerprint } from "./evidence-3.js";
import { diagnosticNavigated, isGenericCourseEditRoute, isItemSpecificCourseRoute, safelyRouteWithHistory } from "./navigation-2.js";
import { authoringItemRouteV61311, isSafeCourseRoute, routeCandidateFromElement } from "./navigation.js";
import { directElementTextKey, elementAttributeBlob, elementTextKey, isExactVisibleTitleNode, isRejectedNavigationSeed } from "./text-and-dom-2.js";
import { isVisibleElement } from "./text-and-dom-3.js";
import { elementsAreNear, interactiveAncestor, isDangerousEditorControl, isGlobalChromeElement, isStrongItemIdentityNode, reactPropsForElement } from "./text-and-dom-4.js";
import { normalizeName } from "./text-and-dom.js";

export function previewHandlerSource(fn) {
    try {
      if (typeof fn !== "function") return "";
      return Function.prototype.toString.call(fn).replace(/\s+/g, " ").slice(0, 260);
    } catch (e) { return ""; }
  }

export function reactSignalsForElement(el) {
    const props = reactPropsForElement(el) || {};
    const textBits = [];
    function add(v) {
      if (typeof v === "string" || typeof v === "number") textBits.push(String(v));
    }
    try {
      add(props["aria-label"]); add(props.title); add(props.href); add(props.to); add(props.id); add(props.name);
      if (typeof props.children === "string" || typeof props.children === "number") add(props.children);
    } catch (e) {}
    const trackComponent = normalizeName(
      (el && el.getAttribute && el.getAttribute("data-track-component")) ||
      props["data-track-component"] || ""
    );
    const trackAction = normalizeName(
      (el && el.getAttribute && el.getAttribute("data-track-action")) ||
      props["data-track-action"] || ""
    );
    return {
      hasOnClick: typeof props.onClick === "function",
      hasOnDoubleClick: typeof props.onDoubleClick === "function",
      hasOnKeyPress: typeof props.onKeyPress === "function",
      hasOnKeyDown: typeof props.onKeyDown === "function",
      href: typeof props.href === "string" ? props.href : (typeof props.to === "string" ? props.to : ""),
      text: normalizeName(textBits.join(" ")),
      trackComponent,
      trackAction,
      onClickPreview: previewHandlerSource(props.onClick),
      onKeyPressPreview: previewHandlerSource(props.onKeyPress || props.onKeyDown),
      propKeys: Object.keys(props).filter(k => /^on[A-Z]|href|to|aria-|title|role|tabIndex|data-/i.test(k)).slice(0, 28)
    };
  }

export function isDragHandleLike(el) {
    if (!el) return false;
    const attrs = elementAttributeBlob(el);
    const label = normalizeName(elementTextKey(el) + " " + attrs);
    return /data-rbd-drag-handle|draggable=true|drag handle|reorder|grab/.test(attrs + " " + label);
  }

export function rowSubtreeInteractionCandidates(fp, row, seed, courseOrBranchId) {
    if (!row || !row.querySelectorAll) return { candidates: [], subtreeSize: 0, reactClickCount: 0, nativeInteractiveCount: 0 };
    const name = normalizeName(fp && fp.name);
    const id = String((fp && fp.id) || "").toLowerCase();
    const nodes = [row, ...row.querySelectorAll("*")].slice(0, 700);
    const out = [];
    const seen = new Set();
    let reactClickCount = 0, nativeInteractiveCount = 0;

    function add(el, scope, bonus) {
      if (!el || seen.has(el) || !isVisibleElement(el) || isGlobalChromeElement(el) || isDangerousEditorControl(el) || isRejectedNavigationSeed(el) || isDragHandleLike(el)) return;
      const tag = String(el.tagName || "").toLowerCase();
      if (/^(textarea|input|select|option|iframe|object|embed)$/.test(tag)) return;
      const sig = reactSignalsForElement(el);
      const label = normalizeName(elementTextKey(el) + " " + sig.text + " " + elementAttributeBlob(el));
      const direct = directElementTextKey(el);
      const role = String(el.getAttribute && el.getAttribute("role") || "").toLowerCase();
      const nativeInteractive = tag === "button" || tag === "a" || role === "button" || role === "link" || Number(el.tabIndex) >= 0;
      const exactTitle = Boolean(name && (direct === name || normalizeName(elementTextKey(el)) === name));
      const usefulReact = sig.hasOnClick || sig.hasOnDoubleClick || sig.hasOnKeyPress || sig.hasOnKeyDown;
      const trackedEditItem = /(?:^|\b)edititem(?:\b|$)/.test(sig.trackComponent || "") || /datatrackcomponentedititem/.test(label);
      const trackedItemName = /(?:^|\b)itemname(?:\b|$)/.test(sig.trackComponent || "") || /datatrackcomponentitemname/.test(label);
      const safeAction = trackedEditItem || /\b(edit|open|author|modify|details|configure)\b/.test(label);
      const menuAction = /\b(more|options|actions|menu)\b/.test(label);
      if (trackedItemName && !trackedEditItem) return;
      if (!nativeInteractive && !usefulReact && !exactTitle && !safeAction && !menuAction) return;
      if (nativeInteractive) nativeInteractiveCount++;
      if (usefulReact) reactClickCount++;
      seen.add(el);
      out.push({ el, scope, bonus: bonus || 0, sig, label, direct, nativeInteractive, exactTitle, safeAction, menuAction, trackedEditItem, trackedItemName });
    }

    for (const el of nodes) {
      const sig = reactSignalsForElement(el);
      const tag = String(el.tagName || "").toLowerCase();
      const role = String(el.getAttribute && el.getAttribute("role") || "").toLowerCase();
      const nativeInteractive = tag === "button" || tag === "a" || role === "button" || role === "link" || Number(el.tabIndex) >= 0;
      const direct = directElementTextKey(el);
      if (sig.hasOnClick || sig.hasOnDoubleClick) add(el, "react-handler-descendant", 0.06);
      else if (nativeInteractive) add(el, "native-row-descendant", 0.05);
      else if (name && direct === name) add(el, "exact-title-descendant", 0.08);
    }

    // Hit-test the physical row at several horizontal points. React apps sometimes
    // place the actual click target in an overlay element that is hard to discover by selector.
    try {
      const r = row.getBoundingClientRect();
      const ys = [0.35, 0.5, 0.68];
      const xs = [0.08, 0.25, 0.5, 0.75, 0.9];
      for (const yf of ys) for (const xf of xs) {
        const x = Math.max(1, Math.min(window.innerWidth - 2, r.left + r.width * xf));
        const y = Math.max(1, Math.min(window.innerHeight - 2, r.top + r.height * yf));
        const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
        for (const el of stack.slice(0, 8)) {
          if (el === row || row.contains(el)) add(el, "row-hit-test", 0.03);
        }
      }
    } catch (e) {}

    return { candidates: out, subtreeSize: nodes.length, reactClickCount, nativeInteractiveCount };
  }

export function editorControlCandidates(fp, found, courseOrBranchId) {
    const seed = found && found.element;
    const row = itemRowRootForFingerprint(fp, seed);
    const pool = [];
    const seen = new Set();
    function add(el, scope, extra) {
      if (!el || seen.has(el) || !isVisibleElement(el) || isDangerousEditorControl(el) || isGlobalChromeElement(el) || isDragHandleLike(el)) return;
      if (isRejectedNavigationSeed(el) && String(el.tagName || "").toLowerCase() !== "button" && String(el.tagName || "").toLowerCase() !== "a") return;
      seen.add(el); pool.push({el, scope, ...(extra || {})});
    }

    const subtree = rowSubtreeInteractionCandidates(fp, row || seed, seed, courseOrBranchId);
    for (const c of subtree.candidates) add(c.el, c.scope, c);

    // Keep the known item node only as a low-priority fallback. In Coursera this
    // is often a react-beautiful-dnd wrapper (rc-ItemRowV2), not the click target.
    if (seed && isStrongItemIdentityNode(seed, fp)) add(seed, "exact-item-node-fallback");
    if (seed && isExactVisibleTitleNode(seed, fp) && String(seed.tagName || "").toLowerCase() !== "a") add(seed, "exact-title-bubble");
    const clickable = interactiveAncestor(seed, fp);
    if (clickable) add(clickable, "interactive-ancestor");

    if (row && row.querySelectorAll) {
      row.querySelectorAll("button,[role='button'],a[href],[role='link'],[tabindex],[aria-haspopup],[data-testid],[data-e2e]").forEach(el => add(el, "certified-row"));
    }

    const id = String((fp && fp.id) || "").toLowerCase();
    const name = normalizeName(fp && fp.name);
    const scored = pool.map(entry => {
      const el = entry.el;
      const sig = entry.sig || reactSignalsForElement(el);
      const label = normalizeName(entry.label || (elementTextKey(el) + " " + sig.text + " " + elementAttributeBlob(el)));
      const direct = entry.direct || directElementTextKey(el);
      const routeRaw = routeCandidateFromElement(el, courseOrBranchId) || sig.href || "";
      const itemRoute = isItemSpecificCourseRoute(routeRaw, fp, courseOrBranchId) ? routeRaw : "";
      const attrs = elementAttributeBlob(el);
      let score = 0;

      if (id && itemRoute && itemRoute.toLowerCase().includes(id)) score = 1;
      else if ((entry.trackedEditItem || /(?:^|\b)edititem(?:\b|$)/.test(sig.trackComponent || "")) && (sig.hasOnClick || sig.hasOnKeyPress || sig.hasOnKeyDown)) score = 0.9995;
      else if (name && direct === name && sig.hasOnClick) score = 0.999;
      else if (/\b(edit|open|author|modify|details|configure)\b/.test(label) && (sig.hasOnClick || entry.nativeInteractive)) score = 0.992;
      else if (entry.scope === "react-handler-descendant" && sig.hasOnClick) score = 0.965;
      else if (entry.scope === "native-row-descendant" && entry.nativeInteractive) score = 0.955;
      else if (entry.scope === "exact-title-descendant" || entry.scope === "exact-title-bubble") score = 0.95;
      else if (/\b(more|options|actions|menu)\b/.test(label) && (sig.hasOnClick || entry.nativeInteractive)) score = 0.88;
      else if (entry.scope === "row-hit-test" && (sig.hasOnClick || entry.nativeInteractive)) score = 0.87;
      else if (entry.scope === "interactive-ancestor") score = 0.84;
      else if (entry.scope === "certified-row") score = 0.82;
      else if (entry.scope === "exact-item-node-fallback") score = sig.hasOnClick ? 0.90 : 0.73;

      if (id && attrs.includes(id) && score > 0) score = Math.min(1, score + 0.006);
      if (isGenericCourseEditRoute(routeRaw, courseOrBranchId) || /\bopen navigation menu\b/.test(label) || isDragHandleLike(el)) score = 0;
      return {
        element: el,
        route: itemRoute,
        score: Math.min(1, score),
        label: label.slice(0, 240),
        tag: String(el.tagName || "").toLowerCase(),
        scope: entry.scope,
        reactClick: Boolean(sig.hasOnClick),
        reactDoubleClick: Boolean(sig.hasOnDoubleClick),
        reactKeyPress: Boolean(sig.hasOnKeyPress || sig.hasOnKeyDown),
        reactPropKeys: sig.propKeys || [],
        trackComponent: sig.trackComponent || "",
        trackAction: sig.trackAction || "",
        onClickPreview: sig.onClickPreview || "",
        onKeyPressPreview: sig.onKeyPressPreview || "",
        // Live-only handler snapshots. These are deliberately not serialized;
        // they survive a React rerender between synthetic click and direct fallback.
        directOnClick: typeof (reactPropsForElement(el) || {}).onClick === "function" ? (reactPropsForElement(el) || {}).onClick : null,
        directOnKeyPress: typeof (reactPropsForElement(el) || {}).onKeyPress === "function" ? (reactPropsForElement(el) || {}).onKeyPress : null,
        directOnKeyDown: typeof (reactPropsForElement(el) || {}).onKeyDown === "function" ? (reactPropsForElement(el) || {}).onKeyDown : null,
        directAllowed: false,
        subtreeSize: subtree.subtreeSize,
        reactClickCount: subtree.reactClickCount,
        nativeInteractiveCount: subtree.nativeInteractiveCount
      };
    }).filter(x => x.score >= 0.72).sort((a,b) => b.score - a.score).slice(0, 12);
    scored.forEach(c => { c.directAllowed = canDirectInvokeReactControl(c); });
    return scored;
  }

export function snapshotVisibleMenuRoots() {
    const out = new Set();
    try {
      document.querySelectorAll("[role='menu'],[role='listbox'],[data-state='open']").forEach(el => {
        if (isVisibleElement(el) && !isGlobalChromeElement(el)) out.add(el);
      });
    } catch (e) {}
    return out;
  }

export function visibleMenuEditorAction(fp, courseOrBranchId, triggerElement, baselineMenus) {
    const candidates = [];
    const seen = new Set();
    const roots = [];
    const baseline = baselineMenus || new Set();
    const controlledId = triggerElement && triggerElement.getAttribute && triggerElement.getAttribute("aria-controls");
    if (controlledId) {
      const controlled = document.getElementById(controlledId);
      if (controlled && isVisibleElement(controlled) && !isGlobalChromeElement(controlled)) roots.push(controlled);
    }
    try {
      document.querySelectorAll("[role='menu'],[role='listbox'],[data-state='open']").forEach(root => {
        if (!isVisibleElement(root) || isGlobalChromeElement(root) || baseline.has(root)) return;
        if (triggerElement && !elementsAreNear(root, triggerElement)) {
          const role = String(root.getAttribute("role") || "").toLowerCase();
          if (role !== "menu" && role !== "listbox") return;
        }
        roots.push(root);
      });
    } catch (e) {}

    function add(el) {
      if (!el || seen.has(el) || !isVisibleElement(el) || isDangerousEditorControl(el) || isGlobalChromeElement(el)) return;
      seen.add(el); candidates.push(el);
    }
    roots.forEach(root => root.querySelectorAll && root.querySelectorAll("button,[role='button'],a[href],[role='link'],[role='menuitem'],[role='option']").forEach(add));

    let best = null, bestScore = 0;
    for (const el of candidates) {
      const label = normalizeName(elementTextKey(el) + " " + elementAttributeBlob(el));
      const routeRaw = routeCandidateFromElement(el, courseOrBranchId);
      const route = isItemSpecificCourseRoute(routeRaw, fp, courseOrBranchId) ? routeRaw : "";
      let score = 0;
      if (route && String(fp && fp.id || "") && route.toLowerCase().includes(String(fp.id).toLowerCase())) score = 1;
      else if (/\b(edit|open|author|modify)\b/.test(label)) score = 0.98;
      else if (normalizeName(fp && fp.name) && label.includes(normalizeName(fp.name))) score = 0.88;
      if (/\b(edit content|open navigation menu)\b/.test(label) && !route) score = 0;
      if (score > bestScore) { bestScore = score; best = { element: el, route, score, label: label.slice(0,220), tag:String(el.tagName||"...").toLowerCase(), scope:"new-menu" }; }
    }
    return bestScore >= 0.86 ? best : null;
  }

export function makeDirectReactEvent(el, kind) {
    const isKey = kind === "keypress" || kind === "keydown";
    let defaultPrevented = false;
    let propagationStopped = false;
    let nativeEvent = null;
    try {
      nativeEvent = isKey
        ? new KeyboardEvent(kind === "keydown" ? "keydown" : "keypress", { key:"Enter", code:"Enter", bubbles:true, cancelable:true })
        : new MouseEvent("click", { bubbles:true, cancelable:true, view:window, button:0, detail:1 });
    } catch (e) {}
    return {
      type: isKey ? (kind === "keydown" ? "keydown" : "keypress") : "click",
      target: el, currentTarget: el, nativeEvent,
      key: isKey ? "Enter" : undefined, code: isKey ? "Enter" : undefined,
      charCode: isKey ? 13 : 0, keyCode: isKey ? 13 : 0, which: isKey ? 13 : 0,
      button: 0, buttons: 1, detail: 1, timeStamp: Date.now(),
      preventDefault() { defaultPrevented = true; },
      stopPropagation() { propagationStopped = true; },
      isDefaultPrevented() { return defaultPrevented; },
      isPropagationStopped() { return propagationStopped; },
      persist() {}
    };
  }

export function canDirectInvokeReactControl(control) {
    if (!control || !control.element) return false;
    const track = normalizeName(control.trackComponent || "");
    const action = normalizeName(control.trackAction || "");

    // v5.5 bug: this gate scanned the whole row label. Every normal item row
    // contains the status word "published", so /publish/ rejected even the
    // proven data-track-component=edititem control.
    // Direct invocation is now based on an explicit tracked-control allowlist.
    const safeTrackedControl = /^(edititem|openitem|authoritem|configureitem)$/.test(track);
    if (!safeTrackedControl) return false;

    // Reject only the tracked control/action itself if Coursera ever changes it
    // into a mutating action. Do not inspect unrelated row text/status.
    if (/^(itemname|drag|reorder|publish|unpublish|delete|remove|save|submit|archive|move|duplicate|settings|grading)$/.test(track)) return false;
    if (/^(publish|unpublish|delete|remove|save|submit|archive|move|duplicate|settings|grading)$/.test(action)) return false;
    return true;
  }

export function invokeDirectReactControl(control, kind) {
    if (!canDirectInvokeReactControl(control)) return { attempted:false, mode:"react-direct-blocked", error:"" };
    const liveProps = reactPropsForElement(control.element) || {};
    let fn = null, mode = "";
    if (kind === "click") {
      fn = typeof control.directOnClick === "function" ? control.directOnClick : liveProps.onClick;
      mode = "react-direct-onclick";
    } else if (kind === "keypress") {
      fn = typeof control.directOnKeyPress === "function" ? control.directOnKeyPress : liveProps.onKeyPress;
      mode = "react-direct-enter";
    } else if (kind === "keydown") {
      fn = typeof control.directOnKeyDown === "function" ? control.directOnKeyDown : liveProps.onKeyDown;
      mode = "react-direct-keydown-enter";
    }
    if (typeof fn !== "function") return { attempted:false, mode:"react-direct-no-handler", error:"" };
    try {
      try { control.element.focus({ preventScroll:true }); } catch (e) { try { control.element.focus(); } catch (_) {} }
      fn.call(null, makeDirectReactEvent(control.element, kind));
      return { attempted:true, mode, error:"" };
    } catch (e) {
      return { attempted:true, mode: mode || "react-direct-error", error:String(e && e.message || e).slice(0,220) };
    }
  }

export function clearBlockingToasts() {
    // Read-only crawl hardening: neutralize transient overlays that can intercept
    // synthetic navigation clicks. Do not remove editor content or action dialogs.
    try {
      document.querySelectorAll('[role="alert"], .rc-Notification, .rc-Toast, #onetrust-banner-sdk').forEach(function(toast) {
        if (!toast || !toast.style) return;
        toast.style.pointerEvents = 'none';
        toast.style.opacity = '0';
        toast.style.visibility = 'hidden';
      });
    } catch (e) {}
  }

export function dispatchReadOnlyEditorControl(control, courseOrBranchId) {
    if (!control || !control.element || isDangerousEditorControl(control.element) || isGlobalChromeElement(control.element)) return { attempted:false, mode:"blocked" };
    const ctag = String(control.element.tagName || "").toLowerCase();
    if (/^(textarea|input|select|option|iframe|object|embed)$/.test(ctag)) return { attempted:false, mode:"blocked-editor-control" };
    try { if (String(control.element.getAttribute && control.element.getAttribute("contenteditable") || "").toLowerCase() === "true") return { attempted:false, mode:"blocked-editor-control" }; } catch (e) {}
    if (control.route && isSafeCourseRoute(control.route, courseOrBranchId)) {
      return { attempted: safelyRouteWithHistory(control.route), mode:"history-popstate" };
    }
    const tag = String(control.element.tagName || "").toLowerCase();
    if (tag === "a") return { attempted:false, mode:"unsafe-anchor" };
    try {
      clearBlockingToasts();
      try { control.element.scrollIntoView({ block:"center", inline:"nearest" }); } catch (e) {}
      // HTMLElement.click() most closely follows the event path used by React's
      // delegated click handlers; it is safe here because anchors without an
      // item-specific route have already been blocked above.
      if (typeof control.element.click === "function") control.element.click();
      else control.element.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, view:window, button:0 }));
      return { attempted:true, mode: control.scope === "certified-row-root" || control.scope === "exact-item-node" ? "safe-item-row-click" : "safe-button-click" };
    } catch (e) { return { attempted:false, mode:"click-error" }; }
  }

export function dismissEditorSurfaceSafely() {
    try {
      const close=[...document.querySelectorAll('button.rc-TunnelVisionClose')].find(el=>
        isVisibleElement(el) && el.closest('.rc-CourseAuthoringTool,.rc-WidgetAuthoringTool') &&
        /^close$/i.test(String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim()) && !isDangerousEditorControl(el));
      if(close){close.click();return true;}
    } catch(_) {}
    try {
      const closers = [...document.querySelectorAll("[role='dialog'] button,[aria-modal='true'] button,dialog button,[data-state='open'] button")].filter(isVisibleElement);
      const close = closers.find(el => /\b(close|cancel|dismiss)\b/.test(normalizeName(elementTextKey(el) + " " + elementAttributeBlob(el))) && !isDangerousEditorControl(el));
      if (close) {
        close.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, view:window, button:0 }));
        return true;
      }
    } catch (e) {}
    try {
      // Do not broadcast Escape while already on the outline. Repeated close
      // events and popstate dispatches can trigger overlapping SPA transitions.
      if(!authoringItemRouteV61311(location.href) && ![...document.querySelectorAll("[role='dialog'],[aria-modal='true'],dialog[open],[data-state='open']")].some(isVisibleElement))return false;
      window.dispatchEvent(new KeyboardEvent("keydown", { key:"Escape", code:"Escape", bubbles:true, cancelable:true }));
      return true;
    } catch (e) { return false; }
  }

export function diagnosticQualityScore(d) {
    if (!d) return 0;
    let score = 0;
    if (d.found) score += 12;
    if (diagnosticNavigated(d)) score += 12;
    if (d.editorSurfaceCaptured) score += 16;
    if (d.upgraded) score += 12;
    if (d.bodyScoped) score += 10;
    if (!d.stabilityTimedOut) score += 5;
    score += Math.min(20, Math.round(Number(d.textCompleteness || 0) * 20));
    if (Number(d.questionCycleDeclared || 0) > 1 && Number(d.questionCycleQuestions || 0) >= Number(d.questionCycleDeclared || 0)) score += 18;
    if (Number(d.sessionPayloadFiles || 0) > 0) score += 16;
    if (Number(d.launchUrlsFound || 0) > 0) score += 10;
    return score;
  }
