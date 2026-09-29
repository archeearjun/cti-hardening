import { ctiLocalFileTimestamp, ctiSafeFileToken, isCourseraUiAssetUrl } from "./assets.js";
import { MAX_AUTO_DEEP_API_PROBES, MAX_AUTO_DEEP_PAGE_FETCHES, MAX_WALK_NODES } from "./config.js";
import { evidenceHasUsefulPayload } from "./evidence-2.js";
import { fetchHtmlEvidence, harvestEvidence, mergeEvidence } from "./evidence.js";
import { collectEmbeddedPageState } from "./plugins.js";
import { elementAttributeBlob, isCourseWideNetworkResponse, isPerItemNetworkNoise, isRejectedItemNavigationUrl } from "./text-and-dom-2.js";
import { isGlobalChromeElement } from "./text-and-dom-4.js";

export function downloadJson(name, data) {
    const json = JSON.stringify(data, null, 2);
    window.__CTI_LAST_RESULT = data;
    window.__CTI_LAST_JSON = json;
    window.__CTI_LAST_FILENAME = name;

    function triggerDownload() {
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // Best-effort automatic download. Chrome may ignore this after a long async run
    // because there is no longer a transient user activation.
    try { triggerDownload(); } catch (e) { console.warn("Automatic CTI download failed:", e); }

    // Persistent real-click fallback: a physical click restores browser user activation,
    // making the save reliable even when the synthetic click above was blocked.
    try {
      let panel = document.getElementById("__cti_download_panel");
      if (panel) panel.remove();
      panel = document.createElement("div");
      panel.id = "__cti_download_panel";
      panel.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#111827;color:#fff;padding:14px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:13px/1.4 system-ui,-apple-system,sans-serif;max-width:340px";

      const title = document.createElement("div");
      title.textContent = "CTI extraction complete";
      title.style.cssText = "font-weight:700;margin-bottom:8px";
      panel.appendChild(title);

      const note = document.createElement("div");
      note.textContent = "If the JSON did not download automatically, click below.";
      note.style.cssText = "margin-bottom:10px;color:#D1D5DB";
      panel.appendChild(note);

      const btn = document.createElement("button");
      btn.textContent = "Download CTI JSON";
      btn.style.cssText = "background:#10B981;color:#06281f;border:0;border-radius:7px;padding:9px 12px;font-weight:700;cursor:pointer;margin-right:8px";
      btn.onclick = () => triggerDownload();
      panel.appendChild(btn);

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy JSON";
      copyBtn.style.cssText = "background:#374151;color:white;border:0;border-radius:7px;padding:9px 12px;font-weight:600;cursor:pointer";
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(json);
          copyBtn.textContent = "Copied ✓";
        } catch (e) {
          console.log("CTI JSON is available as window.__CTI_LAST_JSON");
          copyBtn.textContent = "Use console fallback";
        }
      };
      panel.appendChild(copyBtn);

      const close = document.createElement("button");
      close.textContent = "×";
      close.title = "Close";
      close.style.cssText = "position:absolute;top:4px;right:7px;background:transparent;color:#9CA3AF;border:0;font-size:20px;cursor:pointer";
      close.onclick = () => panel.remove();
      panel.appendChild(close);
      document.body.appendChild(panel);
    } catch (e) {
      console.warn("Could not render CTI download button:", e);
    }

    console.log("CTI result retained as window.__CTI_LAST_RESULT and window.__CTI_LAST_JSON");
  }

export function absolute(url) {
    return new URL(url, location.origin).href;
  }

export async function getJson(url) {
    try {
      const response = await fetch(absolute(url), {
        credentials: "include",
        headers: { Accept: "application/json, text/plain, */*" }
      });
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) {}
      return {
        ok: response.ok,
        status: response.status,
        url: response.url,
        data,
        bytes: text.length
      };
    } catch (error) {
      return { ok: false, status: 0, url: absolute(url), data: null, error: error.message, bytes: 0 };
    }
  }

export function courseId() {
    let match = location.href.match(/\/teach\/[^/]+\/([A-Za-z0-9_-]+)\/content/);
    if (match) return match[1];

    const resources = performance.getEntriesByType("resource").map(x => x.name);
    for (const url of resources) {
      match = url.match(/authoringCourseMaterials\.v1\/([^/?]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
    return null;
  }

export function normalizeType(typeName) {
    const value = String(typeName || "").toLowerCase();
    if (/supplement|reading|lecture/.test(value)) return "Reading";
    if (/assignment|staffgraded|peer/.test(value)) return "Assignment";
    if (/discussion/.test(value)) return "Discussion";
    if (/widget|plugin|lti/.test(value)) return "Plugin";
    if (/quiz|exam/.test(value)) return "Assessment";
    if (/video/.test(value)) return "Video";
    return value || "Reading";
  }

export function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
  }

export function unique(values, limit = 500) {
    const seen = new Set();
    const out = [];
    for (const value of values || []) {
      const text = String(value || "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= limit) break;
    }
    return out;
  }

export function stripHtml(value) {
    const raw = String(value || "");
    if (!/[<>]/.test(raw)) return raw.replace(/\s+/g, " ").trim();
    try {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      return String(doc.body ? doc.body.textContent : doc.documentElement.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
    } catch (e) {
      return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  }

export async function sha256(value) {
    if (!crypto || !crypto.subtle || typeof TextEncoder === "undefined") return "";
    try {
      const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
      return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      return "";
    }
  }

export async function sha256Buffer(buffer) {
    if (!crypto || !crypto.subtle || !buffer) return "";
    try {
      const hash = await crypto.subtle.digest("SHA-256", buffer);
      return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      return "";
    }
  }

export function ctiCourseraCourseLabel() {
    let title = String(document.title || "").trim();
    title = title.replace(/\s*\|\s*Coursera.*$/i, "")
      .replace(/^Edit Content\s*\|\s*/i, "")
      .replace(/^\[update\]\s*/i, "")
      .replace(/\s+Session\s+\d+.*$/i, "")
      .trim();
    if (!title || /^Edit Content$/i.test(title)) {
      const m = location.pathname.match(/\/teach\/([^/]+)/i);
      title = m ? decodeURIComponent(m[1]).replace(/[-_]+/g, " ") : "Coursera Course";
    }
    return title;
  }

export function ctiCourseraExportName(courseIdValue, suffix = "ITEM_FINGERPRINT") {
    const label = ctiSafeFileToken(ctiCourseraCourseLabel(), 110);
    const idToken = ctiSafeFileToken(courseIdValue || "UNKNOWN", 80);
    const stamp = ctiLocalFileTimestamp(new Date());
    return `CTI__COURSERA__${label}__COURSE_${idToken}__${stamp}__v6.14.7_s34__${suffix}.json`;
  }

export function inferPublished(obj) {
    let answer = null;
    let nodes = 0;

    function walk(value, key) {
      if (answer !== null || value == null || nodes++ > 4000) return;

      const k = String(key || "").toLowerCase();
      if (typeof value === "boolean") {
        if (/^(ispublished|published|isvisible|visible)$/.test(k)) answer = value;
        if (/^(isdraft|draft)$/.test(k)) answer = !value;
        return;
      }

      if (typeof value === "string" && /(status|state|visibility)/.test(k)) {
        const s = value.toLowerCase();
        if (/published|live|visible|active/.test(s)) answer = true;
        if (/draft|unpublished|hidden|inactive/.test(s)) answer = false;
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(v => walk(v, key));
      } else if (typeof value === "object") {
        Object.keys(value).forEach(childKey => walk(value[childKey], childKey));
      }
    }

    walk(obj, "");
    return answer;
  }

export function safeSourceLabel(url) {
    try {
      const parsed = new URL(url, location.origin);
      return parsed.pathname;
    } catch (e) {
      return "observed-api";
    }
  }

export function enrichFromObservedObject(root, fingerprints, sourceLabel) {
    const byId = new Map();
    const byName = new Map();

    fingerprints.forEach(fp => {
      if (fp.id) byId.set(String(fp.id).toLowerCase(), fp);
      const nameKey = normalizeName(fp.name);
      if (nameKey.length >= 5) {
        const list = byName.get(nameKey) || [];
        list.push(fp);
        byName.set(nameKey, list);
      }
    });

    let nodes = 0;

    function walk(value) {
      if (!value || nodes++ > MAX_WALK_NODES) return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (typeof value !== "object") return;

      let targets = [];
      const ids = [
        value.id, value.itemId, value.atomId, value.elementId,
        value.courseMaterialId, value.authoringAtomId
      ].filter(Boolean).map(x => String(x).toLowerCase());

      ids.forEach(id => {
        if (byId.has(id)) targets.push(byId.get(id));
      });

      const title = value.originalName || value.name || value.title || "";
      const titleKey = normalizeName(title);
      if (titleKey && byName.has(titleKey)) {
        targets = targets.concat(byName.get(titleKey));
      }

      targets = [...new Set(targets)];
      if (targets.length) {
        const evidence = harvestEvidence(value);
        evidence.evidenceSources = [sourceLabel];
        targets.forEach(fp => {
          mergeEvidence(fp.payload, evidence, sourceLabel);
          fp.evidenceSources = unique([...(fp.evidenceSources || []), sourceLabel], 50);
          if (fp.evidenceLevel === "structure-only" &&
              (evidence.files.length || evidence.links.length || evidence.textSample || evidence.published != null)) {
            fp.evidenceLevel = "observed-api";
          } else if (fp.evidenceLevel !== "structure-only") {
            fp.evidenceLevel = "enriched";
          }
        });
      }

      Object.keys(value).forEach(key => {
        const child = value[key];
        if (child && typeof child === "object") walk(child);
      });
    }

    walk(root);
  }

export function collectFieldValues(root, keyRegex, limit = 40) {
    const out = [];
    const seen = new Set();
    let nodes = 0;
    function walk(value, key) {
      if (value == null || nodes++ > MAX_WALK_NODES) return;
      if (typeof value === "string" || typeof value === "number") {
        if (keyRegex.test(String(key || ""))) {
          const text = String(value).trim();
          if (text && !seen.has(text)) { seen.add(text); out.push(text); }
        }
        return;
      }
      if (Array.isArray(value)) value.forEach(v => walk(v, key));
      else if (typeof value === "object") Object.keys(value).forEach(k => walk(value[k], k));
    }
    walk(root, "");
    return out.slice(0, limit);
  }

export function isAuthoringChromeUrl(url) {
    const raw = String(url || "");
    if (!raw) return true;
    try {
      const u = new URL(raw, location.href);
      const host = String(u.hostname || "").toLowerCase();
      const path = String(u.pathname || "");
      if (u.origin === location.origin) {
        if (/^\/(?:admin|api)(?:\/|$)/i.test(path)) return true;
        if (/^\/teach(?:\/|$)/i.test(path)) return true;
        if (/^\/about\/(?:cookies|privacy|terms)(?:\/|$)/i.test(path)) return true;
      }
      if (/partner\.coursera\.help$/.test(host)) return true;
      if (/cookielaw\.org$|onetrust\.com$/.test(host)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

export function extractConfiguredExternalUrls(root) {
    const out = [];
    if (!root || !root.querySelectorAll) return out;
    const urlRe = /https?:\/\/[^\s\"'<>]+/ig;
    try {
      root.querySelectorAll("input,textarea,[contenteditable='true'],[contenteditable='plaintext-only']").forEach(el => {
        if (isGlobalChromeElement(el)) return;
        const type = String(el.getAttribute && el.getAttribute("type") || "").toLowerCase();
        const attrs = normalizeName(elementAttributeBlob(el));
        const value = String(el.value || el.innerText || el.textContent || "").trim();
        if (!(type === "url" || /\b(url|uri|link|href|website|webpage|launch|source)\b/.test(attrs) || /^https?:\/\//i.test(value))) return;
        const matches = value.match(urlRe) || [];
        matches.forEach(u => {
          if (!isAuthoringChromeUrl(u) && !isCourseraUiAssetUrl(u)) out.push(u.replace(/[),.;]+$/, ""));
        });
      });
    } catch (e) {}
    return unique(out, 100);
  }

export function shouldUseDomResourceElement(el, abs) {
    if (!el || isGlobalChromeElement(el)) return false;
    if (isCourseraUiAssetUrl(abs)) return false;
    return true;
  }

export function objectAssociationScore(root, fp) {
    const targetId = String((fp && fp.id) || "").toLowerCase();
    const targetName = normalizeName(fp && fp.name);
    let idHit = false, nameHit = false, nodes = 0;
    function walk(value, key) {
      if (value == null || nodes++ > 12000 || (idHit && nameHit)) return;
      if (typeof value === "string" || typeof value === "number") {
        const text = String(value);
        if (targetId && text.toLowerCase() === targetId) idHit = true;
        if (!nameHit && targetName && targetName.length >= 5 && normalizeName(text) === targetName) nameHit = true;
        return;
      }
      if (Array.isArray(value)) value.forEach(v => walk(v, key));
      else if (typeof value === "object") Object.keys(value).forEach(k => walk(value[k], k));
    }
    walk(root, "");
    if (idHit) return 1;
    if (nameHit) return 0.92;
    return 0;
  }

export function discoverObservedItemTemplates(fingerprints) {
    const fps = (fingerprints || []).filter(fp => fp.id);
    const resources = unique(performance.getEntriesByType("resource").map(x => x.name), 1200);
    const templates = [];
    const seen = new Set();

    for (const rawUrl of resources) {
      let parsed;
      try { parsed = new URL(rawUrl, location.origin); } catch (e) { continue; }
      if (parsed.origin !== location.origin || !parsed.pathname.includes("/api/")) continue;
      if (/graphql-gateway/i.test(parsed.pathname)) continue;
      // Do not learn templates from course-wide, telemetry, or supplement endpoints.
      // Supplement IDs are not reliably the same identifier as authoring item IDs.
      if (isPerItemNetworkNoise(parsed.href) || isCourseWideNetworkResponse(parsed.href) || /onDemandSupplements\.v1/i.test(parsed.pathname)) continue;

      for (const fp of fps) {
        const id = String(fp.id);
        const encoded = encodeURIComponent(id);
        let template = rawUrl;
        let found = false;
        if (template.includes(id)) { template = template.split(id).join("{ITEM_ID}"); found = true; }
        else if (template.includes(encoded)) { template = template.split(encoded).join("{ITEM_ID_ENC}"); found = true; }
        if (!found) continue;
        if (seen.has(template)) break;
        seen.add(template);
        templates.push({ template, sampleItemId: id, pathname: parsed.pathname });
        break;
      }
      if (templates.length >= 40) break;
    }
    return templates;
  }

export function instantiateObservedTemplate(template, itemId) {
    return String(template || "")
      .split("{ITEM_ID}").join(String(itemId || ""))
      .split("{ITEM_ID_ENC}").join(encodeURIComponent(String(itemId || "")));
  }

export async function automaticDeepVerify(fingerprints) {
    const templates = discoverObservedItemTemplates(fingerprints);
    const targets = (fingerprints || []).filter(fp => {
      const p = fp.payload || {};
      return fp.id && (!(p.assetDetails || []).length || !p.textSample || p.published == null || Number(p.assetEvidenceConfidence || 0) < 0.90);
    });
    const meta = {
      targets: targets.length,
      learnedApiTemplates: templates.length,
      apiAttempts: 0,
      apiUsable: 0,
      apiAssociated: 0,
      pageAttempts: 0,
      pageUsable: 0,
      evidenceUpgrades: 0,
      embeddedState: collectEmbeddedPageState(fingerprints)
    };

    // Reuse only API shapes Coursera already requested in this authenticated page.
    for (const fp of targets) {
      if (meta.apiAttempts >= MAX_AUTO_DEEP_API_PROBES) break;
      let perItem = 0;
      for (const spec of templates) {
        if (meta.apiAttempts >= MAX_AUTO_DEEP_API_PROBES || perItem >= 5) break;
        const url = instantiateObservedTemplate(spec.template, fp.id);
        const response = await getJson(url);
        meta.apiAttempts++; perItem++;
        if (!response.ok || !response.data) continue;
        meta.apiUsable++;
        const association = objectAssociationScore(response.data, fp);
        if (association < 0.85 && !String(url).toLowerCase().includes(String(fp.id).toLowerCase())) continue;
        meta.apiAssociated++;
        const before = JSON.stringify({ a:(fp.payload.assetDetails||[]).length, l:(fp.payload.links||[]).length, t:String(fp.payload.textSample||'').length, p:fp.payload.published });
        const evidence = harvestEvidence(response.data);
        if (!evidenceHasUsefulPayload(evidence)) continue;
        if ((evidence.assetDetails || []).length) evidence.assetEvidenceConfidence = Math.max(Number(evidence.assetEvidenceConfidence || 0), association >= 0.99 ? 0.94 : 0.86);
        if ((evidence.links || []).length) evidence.linkEvidenceConfidence = Math.max(Number(evidence.linkEvidenceConfidence || 0), association >= 0.99 ? 0.90 : 0.82);
        evidence.evidenceSources = ["auto-observed-api-template"];
        mergeEvidence(fp.payload, evidence, "auto-observed-api-template");
        fp.evidenceSources = unique([...(fp.evidenceSources || []), "auto-observed-api-template"], 50);
        const after = JSON.stringify({ a:(fp.payload.assetDetails||[]).length, l:(fp.payload.links||[]).length, t:String(fp.payload.textSample||'').length, p:fp.payload.published });
        if (before !== after) meta.evidenceUpgrades++;
      }
    }

    // v6.2: generic /content/edit SPA-shell HTML is diagnostic only, not
    // item evidence. Static page harvesting is allowed only for genuinely deeper
    // same-origin content routes; ?itemId= and changeLog URLs are excluded.
    const anchors = [...document.querySelectorAll("a[href]")].map(a => ({
      href: a.href,
      text: normalizeName(a.innerText || a.textContent || "")
    })).filter(x => {
      if (!x.href || !x.href.startsWith(location.origin) || isRejectedItemNavigationUrl(x.href)) return false;
      try {
        const u = new URL(x.href);
        if (/\/content\/edit\/?$/i.test(u.pathname)) return false;
        if (u.searchParams.has("itemId")) return false;
        return /\/teach\/[^/]+\/[A-Za-z0-9_-]+\/content\/(?!edit\/?$)[^/?#]+/i.test(u.pathname);
      } catch (e) { return false; }
    });

    for (const fp of targets) {
      if (meta.pageAttempts >= MAX_AUTO_DEEP_PAGE_FETCHES) break;
      const idLower = String(fp.id || "").toLowerCase();
      const nameKey = normalizeName(fp.name);
      const link = anchors.find(a => (idLower && a.href.toLowerCase().includes(idLower)) || (nameKey && a.text === nameKey));
      if (!link) continue;
      meta.pageAttempts++;
      const evidence = await fetchHtmlEvidence(link.href, fp);
      if (!evidence) continue;
      meta.pageUsable++;
      const before = JSON.stringify({ a:(fp.payload.assetDetails||[]).length, l:(fp.payload.links||[]).length, t:String(fp.payload.textSample||'').length });
      mergeEvidence(fp.payload, evidence, "auto-item-page");
      fp.evidenceSources = unique([...(fp.evidenceSources || []), "auto-item-page"], 50);
      const after = JSON.stringify({ a:(fp.payload.assetDetails||[]).length, l:(fp.payload.links||[]).length, t:String(fp.payload.textSample||'').length });
      if (before !== after) meta.evidenceUpgrades++;
    }
    return meta;
  }
