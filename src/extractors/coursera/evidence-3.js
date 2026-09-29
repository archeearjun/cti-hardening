import { elementAttributeBlob, isRejectedNavigationSeed } from "./text-and-dom-2.js";
import { isVisibleElement } from "./text-and-dom-3.js";
import { countNormalizedOccurrence, isGlobalChromeElement } from "./text-and-dom-4.js";
import { normalizeName } from "./text-and-dom.js";

export function itemRowRootForFingerprint(fp, seed) {
    if (!seed || isRejectedNavigationSeed(seed)) return null;
    const name = normalizeName(fp && fp.name);
    const id = String((fp && fp.id) || "").toLowerCase();
    let cur = seed;
    let best = null, bestScore = -1;
    for (let i = 0; cur && i < 9; i++, cur = cur.parentElement) {
      if (cur === document.body || cur === document.documentElement) break;
      if (!isVisibleElement(cur) || isGlobalChromeElement(cur)) continue;
      const text = normalizeName(cur.innerText || cur.textContent || "");
      const attrs = elementAttributeBlob(cur);
      if (!name || !text.includes(name)) continue;
      const controls = cur.querySelectorAll ? [...cur.querySelectorAll("button,[role='button'],a[href],[role='link']")].filter(x => !isGlobalChromeElement(x)) : [];
      const occurrences = countNormalizedOccurrence(text, name);
      let rect = {height:9999,width:9999};
      try { rect = cur.getBoundingClientRect(); } catch (e) {}
      let score = 0;
      if (id && attrs.includes(id)) score += 100;
      if (/item|atom|activity|lesson|reading|assessment|assignment|discussion|outline|content-row|course-item/.test(attrs)) score += 25;
      if (occurrences === 1) score += 20; else if (occurrences <= 2) score += 8;
      if (rect.height > 0 && rect.height <= 420) score += 20;
      if (text.length <= Math.max(1800, name.length * 12)) score += 15;
      if (controls.length && controls.length <= 16) score += 10;
      if (score > bestScore) { best = cur; bestScore = score; }
      if (score >= 145) return cur;
    }
    return bestScore >= 55 ? best : null;
  }
