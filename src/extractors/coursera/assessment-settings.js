import { isAssignmentTextBlockV61321 } from "./assessments.js";
import { isVisibleElement } from "./text-and-dom-3.js";

export function assignmentBehaviorTextV61321(root) {
    const blocks=[...root.querySelectorAll('[data-testid^="assignment-part-"]')].filter(isAssignmentTextBlockV61321);
    if(!blocks.length)return String(root.innerText || root.textContent || '').replace(/\s+/g,' ').trim();
    const copy=root.cloneNode(true);
    [...copy.querySelectorAll('[data-testid^="assignment-part-"]')].filter(isAssignmentTextBlockV61321).forEach(p=>p.remove());
    return String(copy.textContent || '').replace(/\s+/g,' ').trim();
  }

export function rubricRowForPoint(pointEl, rubricEl, allPoints) {
    let cur = pointEl && pointEl.parentElement;
    while (cur && cur !== rubricEl && rubricEl.contains(cur)) {
      if (isVisibleElement(cur)) {
        const text = String(cur.innerText || cur.textContent || "").replace(/\s+/g, " ").trim();
        const pointCount = (allPoints || []).filter(p => cur.contains(p)).length;
        if (pointCount === 1 && text.length >= 3 && text.length <= 2200) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

export function rubricLevelFromRow(row, pointEl, index) {
    const pointText = String(pointEl && (pointEl.innerText || pointEl.textContent) || "").replace(/\s+/g, " ").trim();
    const pm = pointText.match(/(-?\d+(?:\.\d+)?)/);
    const points = pm && Number.isFinite(Number(pm[1])) ? Number(pm[1]) : null;
    let raw = String(row && (row.innerText || row.textContent) || "");
    let lines = raw.split(/\r?\n+/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    lines = lines.filter((v,i,a) => a.indexOf(v) === i && v !== pointText && !/^Rubric\s+\d+$/i.test(v));
    const label = lines.length ? lines[0] : "";
    const description = lines.slice(1).join(" ").trim();
    return {id:String(index + 1), label, description, points, rawText:lines.join(" ")};
  }

export function rubricContainerForHeading(heading, root) {
    let cur = heading && heading.parentElement;
    let best = null;
    while (cur && cur !== root.parentElement && root.contains(cur)) {
      if (!isVisibleElement(cur)) { cur = cur.parentElement; continue; }
      const text = String(cur.innerText || cur.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 12000) break;
      const rubricMarkers = text.match(/\bRubric\s+\d+\b/gi) || [];
      const pointMarkers = text.match(/\b\d+(?:\.\d+)?\s*(?:points?|pts?)\b/gi) || [];
      if (rubricMarkers.length === 1 && text.length >= 40 && (pointMarkers.length || /criterion|criteria|grading/i.test(text))) {
        best = cur;
        break;
      }
      cur = cur.parentElement;
    }
    return best;
  }

export function parseFlatRubricCandidate(block, number) {
    const text = String(block || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const promptMatch = text.match(/\bRubric\s*Prompt\s*(.+?)\s*Rubric\s*Options\b/i);
    const criterionTitle = promptMatch && promptMatch[1] ? promptMatch[1].trim() : "";

    const levels = [];
    const levelRe = /\bOption\s*Points\s*(-?\d+(?:\.\d+)?)\s*points?\s*([\s\S]*?)(?=\bOption\s*Points\s*-?\d+(?:\.\d+)?\s*points?\b|$)/gi;
    let lm;
    while ((lm = levelRe.exec(text)) !== null && levels.length < 30) {
      const points = Number(lm[1]);
      let payload = String(lm[2] || "").replace(/\s+/g, " ").trim();
      if (!payload) continue;
      let label = "", description = payload;
      const colon = payload.indexOf(":");
      if (colon > 0 && colon <= 120) {
        label = payload.slice(0, colon).trim();
        description = payload.slice(colon + 1).trim();
      } else {
        const sentence = payload.match(/^(.{2,80}?)(?:\.\s+|$)/);
        if (sentence && sentence[1] && sentence[1].split(/\s+/).length <= 8) {
          label = sentence[1].trim();
          description = payload.slice(sentence[0].length).trim();
        }
      }
      levels.push({
        id:String(levels.length + 1),
        label,
        description,
        points:Number.isFinite(points) ? points : null,
        rawText:payload
      });
    }

    // Exact de-duplication only. Coursera's authoring surface can render the first
    // rubric option twice (summary + editable row). Do not count the duplicate as
    // a fifth grading level, but never fuzzy-merge distinct levels.
    const levelSeen = new Set();
    const meaningfulLevels = levels.filter(l => {
      if (!l.label && !l.description) return false;
      const key = [String(l.points), String(l.label || "").toLowerCase(), String(l.description || "").toLowerCase()].join("|");
      if (levelSeen.has(key)) return false;
      levelSeen.add(key);
      return true;
    });
    if (!criterionTitle && !meaningfulLevels.length) return null;
    return {
      id:"Rubric " + number,
      title:"Rubric " + number,
      criterionTitle,
      criterionDescription:"",
      levels:meaningfulLevels,
      rawText:text,
      _score:(meaningfulLevels.length * 500) + meaningfulLevels.filter(l => l.label && l.description).length * 200 + Math.min(200, criterionTitle.length)
    };
  }

export function parseCourseraRubricsFromText(rawText) {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!text || !/\bRubric\s+\d+\b/i.test(text)) return [];
    const occurrences = [];
    const re = /\bRubric\s+(\d+)\b/gi;
    let m;
    while ((m = re.exec(text)) !== null && occurrences.length < 80) occurrences.push({number:Number(m[1]), index:m.index});
    if (!occurrences.length) return [];

    const best = new Map();
    occurrences.forEach((occ, i) => {
      const end = i + 1 < occurrences.length ? occurrences[i + 1].index : text.length;
      const block = text.slice(occ.index, end);
      const candidate = parseFlatRubricCandidate(block, occ.number);
      if (!candidate) return;
      const previous = best.get(occ.number);
      if (!previous || candidate._score > previous._score) best.set(occ.number, candidate);
    });
    return [...best.values()].sort((a,b) => Number((a.title.match(/\d+/) || [999])[0]) - Number((b.title.match(/\d+/) || [999])[0])).map(r => {
      delete r._score;
      return r;
    });
  }

export function mergeNativeRubricModels(domRubrics, textRubrics) {
    const map = new Map();
    function keyFor(r, i) {
      const n = String((r && r.title || "").match(/\d+/) || [i + 1])[0];
      return n;
    }
    (domRubrics || []).forEach((r,i) => map.set(keyFor(r,i), JSON.parse(JSON.stringify(r))));
    (textRubrics || []).forEach((r,i) => {
      const key = keyFor(r,i);
      const prev = map.get(key);
      if (!prev) { map.set(key, JSON.parse(JSON.stringify(r))); return; }
      const prevStructured = (prev.levels || []).filter(l => l.label || l.description).length;
      const nextStructured = (r.levels || []).filter(l => l.label || l.description).length;
      if (r.criterionTitle && (!prev.criterionTitle || prev.criterionTitle.length > 500 || r.criterionTitle.length < prev.criterionTitle.length)) prev.criterionTitle = r.criterionTitle;
      if (r.criterionDescription && !prev.criterionDescription) prev.criterionDescription = r.criterionDescription;
      if (nextStructured > prevStructured || (nextStructured === prevStructured && nextStructured > 0 && (r.levels || []).filter(l => l.label && l.description).length > (prev.levels || []).filter(l => l.label && l.description).length)) {
        prev.levels = JSON.parse(JSON.stringify(r.levels || []));
      }
      if (r.rawText && (!prev.rawText || r.rawText.length > prev.rawText.length)) prev.rawText = r.rawText;
      map.set(key, prev);
    });
    return [...map.values()].sort((a,b) => Number((a.title.match(/\d+/) || [999])[0]) - Number((b.title.match(/\d+/) || [999])[0]));
  }
