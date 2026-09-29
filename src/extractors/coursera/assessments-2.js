import { ctiGuardOptionEvidence_, dropFeedbackPseudoOptionsV6611 } from "./assessments-3.js";
import { assessmentTypeKey, exactAssessmentBadgeElements, isAssignmentTextBlockV61321, optionRowForBadge, optionSemanticPartsFromRow, recoverCollapsedBadgeOptions } from "./assessments.js";
import { elementAttributeBlob } from "./text-and-dom-2.js";
import { isObservedWrittenResponseV6138, isVisibleElement, parseWrittenResponsePartV6136, textWithoutExactBadges } from "./text-and-dom-3.js";
import { isDangerousEditorControl, isGlobalChromeElement } from "./text-and-dom-4.js";
import { reactSignalsForElement } from "./text-and-dom-5.js";

export function assessmentPromptKey_(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

export function mergeCourseraAssessmentEvidence(primary, fallback) {
    if (!primary) return fallback;
    if (!fallback) return primary;

    // The text parser sees explicit numbered "1Auto-Graded ... 4Auto-Graded"
    // boundaries, so use it as the canonical order/count. Overlay higher-trust
    // DOM badge evidence onto the matching prompt. This avoids renumbering when
    // the DOM card finder misses a middle question.
    const out = JSON.parse(JSON.stringify(fallback));
    out.questions = Array.isArray(out.questions) ? out.questions : [];
    const usedPrimary = new Set();

    out.questions.forEach((q, outIdx) => {
      const qKey = assessmentPromptKey_(q.prompt);
      let best = -1, bestScore = 0;
      (primary.questions || []).forEach((pq, idx) => {
        if (usedPrimary.has(idx)) return;
        const pKey = assessmentPromptKey_(pq.prompt);
        let score = 0;
        if (qKey && pKey && qKey === pKey) score = 1;
        else if (qKey && pKey && (qKey.includes(pKey) || pKey.includes(qKey))) score = 0.95;
        else {
          const qa = new Set(qKey.split(" ").filter(Boolean)), pa = new Set(pKey.split(" ").filter(Boolean));
          if (qa.size && pa.size) {
            let inter = 0; qa.forEach(t => { if (pa.has(t)) inter++; });
            score = inter / Math.max(qa.size, pa.size);
          }
        }
        if (score > bestScore) { bestScore = score; best = idx; }
      });
      if (best < 0 || bestScore < 0.60) return;
      usedPrimary.add(best);
      const pq = primary.questions[best] || {};

      // Preserve numbered identity from the text fallback, but prefer DOM values
      // where DOM actually observed learner-facing semantics.
      if (pq.prompt) q.prompt = pq.prompt;
      if (pq.rawType) q.rawType = pq.rawType;
      if (pq.type && pq.type !== "unknown") q.type = pq.type;
      if (pq.options && pq.options.length && pq.optionTextReliable !== false) {
        q.options = pq.options; q.optionTextReliable = true;
      }
      if (pq.correctAnswers && pq.correctAnswers.length && pq.answerTextReliable !== false) {
        q.correctAnswers = pq.correctAnswers; q.answerTextReliable = true;
      }
      // v6.6.5: keep the numbered text-fallback point value. It is parsed
      // from the exact "N Auto-Graded X point(s) Question Type" header, while
      // a DOM card may contain unrelated numeric scoring text (for example
      // 0.25-point grading-scheme labels) that can masquerade as item points.
      if ((q.points == null || !Number.isFinite(Number(q.points))) && pq.points != null && Number.isFinite(Number(pq.points))) q.points = Number(pq.points);
      if (pq.feedback) q.feedback = pq.feedback;
      q.parserConfidence = Math.max(Number(q.parserConfidence || 0), Number(pq.parserConfidence || 0));
      q.id = String(outIdx + 1);
    });

    (primary.questions || []).forEach((pq, idx) => {
      if (usedPrimary.has(idx)) return;
      const clone = JSON.parse(JSON.stringify(pq));
      clone.id = String(out.questions.length + 1);
      out.questions.push(clone);
    });

    out.questionCount = out.questions.length;
    out.declaredQuestionCount = Math.max(Number(primary.declaredQuestionCount || 0), Number(fallback.declaredQuestionCount || 0), out.questionCount);
    out.answerEvidenceQuestionCount = out.questions.filter(q => q && q.answerTextReliable !== false && Array.isArray(q.correctAnswers) && q.correctAnswers.length).length;
    out.selectionPolicy = (primary.selectionPolicy && primary.selectionPolicy.observed) ? primary.selectionPolicy : ((fallback.selectionPolicy && fallback.selectionPolicy.observed) ? fallback.selectionPolicy : {observed:false});
    const countAgreement = out.declaredQuestionCount === out.questionCount;
    out.parser = "coursera-editor-dom+text-v2";
    out.parserConfidence = countAgreement ? Math.max(Number(primary.parserConfidence || 0), Number(fallback.parserConfidence || 0), 0.94) : 0.82;
    out.warnings = [...new Set([...(primary.warnings || []), ...(fallback.warnings || [])])];
    if (countAgreement) out.warnings = out.warnings.filter(w => !/declared content count/i.test(String(w)));
    return out;
  }

export function isAssessmentLikeFingerprintV662(fp) {
    const blob = String((fp && (fp.type || fp.typeName)) || "").toLowerCase();
    return /assignment|assessment|quiz|exam/.test(blob);
  }

export function assessmentPartCountV8(root) {
    for(let cur=root,i=0;cur&&i<7;cur=cur.parentElement,i++){
      const text=String(cur.innerText||cur.textContent||'');
      const m=text.match(/\bContent\s*\(\s*(\d+)\s*\)/i);
      if(m&&Number.isSafeInteger(Number(m[1])))return Number(m[1]);
      if(cur===document.body||cur===document.documentElement)break;
    }
    return 0;
  }

export function assessmentDeclaredCountV662(root) {
    const total=assessmentPartCountV8(root),textIds=new Set();
    // Content(N) is an upper bound until all parts are classified. Text blocks
    // are excluded only by observed typed IDs, never by arbitrary prompt text.
    for(let cur=root,i=0;cur&&i<7;cur=cur.parentElement,i++){
      for(const part of cur.querySelectorAll('[data-testid^="assignment-part-"]'))if(isAssignmentTextBlockV61321(part))textIds.add(part.id);
      for(const a of cur.querySelectorAll('a[href^="#"]')){try{const id=decodeURIComponent(a.getAttribute('href').slice(1));if(/~textBlock!~/i.test(id))textIds.add(id);}catch(_) {}}
      if(assessmentPartCountV8(cur)===total&&cur.querySelector('[data-testid="item-layout-left-sidebar"]'))break;
      if(cur===document.body||cur===document.documentElement)break;
    }
    return Math.max(0,total-textIds.size);
  }

export function assessmentEnvelopeRootV662(surfaceRoot, fp) {
    if (!surfaceRoot || !isAssessmentLikeFingerprintV662(fp)) return surfaceRoot;
    let cur = surfaceRoot, best = surfaceRoot, bestScore = -1;
    for (let i = 0; cur && i < 8; i++, cur = cur.parentElement) {
      if (!isVisibleElement(cur)) continue;
      let raw = "";
      try { raw = String(cur.innerText || cur.textContent || ""); } catch (e) {}
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text || text.length > 90000) continue;
      const declared = Number(((text.match(/\bContent\s*\((\d+)\)/i) || [])[1]) || 0);
      const numbered = (text.match(/\b\d+\s*(?:Auto[- ]Graded|Manual[- ]Graded|AI[- ]Graded|Peer[- ]Graded)\b/gi) || []).length;
      const qtypes = (text.match(/\bQuestion\s*Type\b/gi) || []).length;
      const prompts = (text.match(/\bPrompt\b/gi) || []).length;
      let score = 0;
      if (declared >= 2) score += 50 + Math.min(30, declared * 4);
      score += Math.min(30, numbered * 8);
      score += Math.min(20, qtypes * 4);
      score += Math.min(16, prompts * 2);
      if (/\bContent\b/i.test(text)) score += 5;
      if (score > bestScore && (declared >= 2 || numbered >= 2 || (qtypes >= 2 && prompts >= 2))) {
        best = cur; bestScore = score;
      }
      if (cur === document.body || cur === document.documentElement) break;
    }
    return best;
  }

export function assessmentQuestionNavCandidatesV662(surfaceRoot, fp, declaredHint) {
    if (!surfaceRoot || !isAssessmentLikeFingerprintV662(fp)) return [];
    const declared = Number(declaredHint || assessmentDeclaredCountV662(surfaceRoot) || 0);
    const envelope = assessmentEnvelopeRootV662(surfaceRoot, fp) || surfaceRoot;
    const searchRoots = [];
    const seenRoots = new Set();
    function addRoot(root, scopeName) {
      if (!root || seenRoots.has(root)) return;
      seenRoots.add(root);
      searchRoots.push({root, scopeName});
    }
    addRoot(envelope, 'envelope');
    let p = envelope.parentElement;
    for (let i = 0; p && i < 6; i++, p = p.parentElement) {
      addRoot(p, 'ancestor-' + (i + 1));
      if (p === document.body || p === document.documentElement) break;
    }
    addRoot(document.body, 'document');

    const questionSemanticRe = /\b(?:auto[- ]graded|manual[- ]graded|ai[- ]graded|peer[- ]graded|question(?:\s+type)?|quiz\s+item|assessment\s+item|content\s+item|multiple[- ]choice|multiple[- ]select|single\s+correct|multiple\s+correct|regular\s+expression|text\s+entry|true\s*\/?\s*false)\b/i;
    const byOrdinal = new Map();
    const unordered = [];
    const seenElements = new Set();
    let domOrder = 0;

    function ordinalFrom(el, blob) {
      const vals = [];
      try {
        const pos = Number(el.getAttribute('aria-posinset') || 0);
        if (pos > 0) vals.push(pos);
        const oneBased = Number(el.getAttribute('data-question-index') || el.getAttribute('data-item-index') || 0);
        if (oneBased > 0) vals.push(oneBased);
      } catch (e) {}
      const patterns = [
        /^\s*(\d{1,3})\s*(?:[.)\-:]\s*)?(?:Auto[- ]Graded|Manual[- ]Graded|AI[- ]Graded|Peer[- ]Graded|Question|Content\s+Item)\b/i,
        /\bQuestion\s*#?\s*(\d{1,3})\b/i,
        /\b(?:Content|Assessment|Quiz)\s+Item\s*#?\s*(\d{1,3})\b/i,
        /\b(?:Item|Question)\s*(\d{1,3})\s*(?:of|\/)\s*\d{1,3}\b/i,
        /\b(\d{1,3})\s*(?:of|\/)\s*\d{1,3}\s*(?:questions?|items?)?\b/i
      ];
      for (const re of patterns) {
        const m = String(blob || '').match(re);
        if (m && Number(m[1]) > 0) vals.push(Number(m[1]));
      }
      const filtered = vals.filter(n => n > 0 && Number.isSafeInteger(n) && (!declared || n <= declared));
      return filtered.length ? filtered[0] : 0;
    }

    function candidateClickable(el) {
      let cur = el;
      for (let i = 0; cur && i < 6; i++, cur = cur.parentElement) {
        if (cur === document.body || cur === document.documentElement) break;
        if (!isVisibleElement(cur) || isGlobalChromeElement(cur) || isDangerousEditorControl(cur)) continue;
        const tag = String(cur.tagName || '').toLowerCase();
        const role = String(cur.getAttribute && cur.getAttribute('role') || '').toLowerCase();
        const sig = reactSignalsForElement(cur);
        let cursor = '';
        try { cursor = String(getComputedStyle(cur).cursor || '').toLowerCase(); } catch (e) {}
        if (tag === 'button' || tag === 'a' || role === 'button' || role === 'tab' || Number(cur.tabIndex) >= 0 || cursor === 'pointer' || sig.hasOnClick) return cur;
      }
      return null;
    }

    function consider(el, scopeName) {
      if (!el || seenElements.has(el) || !isVisibleElement(el) || isGlobalChromeElement(el) || isDangerousEditorControl(el)) return;
      // v6.6.11: answer rows inside an assignment-part are content evidence, not
      // question navigation. v6.6.8 could mistake answer-option role=button nodes
      // for selectors because their learner text contained the word "question".
      // Never click controls from within a question panel; the deterministic
      // assignment-outline hash anchors are the only preferred question index.
      try {
        if (el.closest('[data-testid^="assignment-part-"], [data-testid="option"], .rc-assignmentauthoringoptionseditor__option, [data-testid="prompt-editor"]')) return;
      } catch (e) {}
      seenElements.add(el);
      let text = '', attrs = '', sigText = '';
      try { text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); } catch (e) {}
      if (text.length > 1400) return;
      try { attrs = elementAttributeBlob(el); } catch (e) {}
      try { sigText = reactSignalsForElement(el).text || ''; } catch (e) {}
      const blob = [text, attrs, sigText].filter(Boolean).join(' ');
      if (!questionSemanticRe.test(blob)) return;
      // A full-document fallback must be explicitly question-semantic. In
      // particular, ordinary course-outline rows such as "graded assignment" are
      // not enough and data-track-component=edititem is rejected here.
      if (scopeName === 'document' && /data-track-component\s*edititem|trackcomponent\s*edititem/i.test(blob) && !/\bquestion\b/i.test(blob)) return;
      const clickable = candidateClickable(el);
      if (!clickable || isDangerousEditorControl(clickable) || isGlobalChromeElement(clickable)) return;
      const clickAttrs = elementAttributeBlob(clickable);
      const clickText = String(clickable.innerText || clickable.textContent || text).replace(/\s+/g, ' ').trim();
      const clickSig = reactSignalsForElement(clickable);
      const clickBlob = [clickText, clickAttrs, clickSig.text || ''].join(' ');
      if (!questionSemanticRe.test(blob + ' ' + clickBlob)) return;
      if (/\b(?:generate questions?|add|import|export|save|delete|remove|publish|unpublish)\b/i.test(clickText) && !/^\s*\d/.test(clickText)) return;
      const ordinal = ordinalFrom(clickable, blob + ' ' + clickBlob) || ordinalFrom(el, blob);
      const label = (clickText || text || clickSig.text || '').slice(0, 700);
      const compactness = label.length + (clickable === el ? 0 : 20) + (scopeName === 'document' ? 30 : 0);
      const rec = {ordinal, element:clickable, label, compactness, scope:scopeName, order:domOrder++};
      if (ordinal) {
        const prev = byOrdinal.get(ordinal);
        if (!prev || compactness < prev.compactness) byOrdinal.set(ordinal, rec);
      } else if (/\b(?:auto[- ]graded|manual[- ]graded|ai[- ]graded|peer[- ]graded|question\s+type)\b/i.test(blob + ' ' + clickBlob)) {
        // v6.6.5: do not manufacture question ordinals from arbitrary question
        // content descendants. The v6.6.3 fallback mistook the selected question's
        // prompt/options for four different navigation controls. Only retain a
        // compact, genuinely interactive question-selector-like control here.
        const clickTag = String(clickable.tagName || '').toLowerCase();
        const clickRole = String(clickable.getAttribute && clickable.getAttribute('role') || '').toLowerCase();
        const ariaSelected = String(clickable.getAttribute && clickable.getAttribute('aria-selected') || '').toLowerCase();
        const compactInteractive = label.length <= 180 && (
          clickTag === 'button' || clickTag === 'a' || clickRole === 'button' || clickRole === 'tab' ||
          ariaSelected === 'true' || ariaSelected === 'false'
        );
        const selectorCue = /\b(?:question\s*type|auto[- ]graded|manual[- ]graded|ai[- ]graded|peer[- ]graded)\b/i.test(label + ' ' + clickBlob);
        if (compactInteractive && selectorCue) unordered.push(rec);
      }
    }

    for (const entry of searchRoots) {
      let nodes = [];
      try {
        nodes = [entry.root, ...entry.root.querySelectorAll("button,[role='button'],[role='tab'],a[href],[tabindex],[aria-label],[title],[aria-posinset],[data-question-index],[data-item-index],li,article,section,div")].slice(0, entry.scopeName === 'document' ? 24000 : 14000);
      } catch (e) {}
      nodes.forEach(el => consider(el, entry.scopeName));
      if (declared > 1 && byOrdinal.size >= declared) break;
    }

    let ordered = [...byOrdinal.values()].sort((a,b) => a.ordinal - b.ordinal);
    if (declared > 1 && ordered.length < declared && unordered.length) {
      const usedEls = new Set(ordered.map(r => r.element));
      const uniqueUnordered = [];
      unordered.sort((a,b) => a.order - b.order || a.compactness - b.compactness).forEach(r => {
        if (usedEls.has(r.element)) return;
        // Collapse nested duplicates by keeping the smaller/earlier interactive node.
        const duplicate = uniqueUnordered.some(x => x.element === r.element || x.label === r.label);
        if (!duplicate) { uniqueUnordered.push(r); usedEls.add(r.element); }
      });
      let nextOrdinal = 1;
      for (const r of uniqueUnordered) {
        while (byOrdinal.has(nextOrdinal) && nextOrdinal <= declared) nextOrdinal++;
        if (nextOrdinal > declared) break;
        r.ordinal = nextOrdinal;
        byOrdinal.set(nextOrdinal, r);
        nextOrdinal++;
      }
      ordered = [...byOrdinal.values()].sort((a,b) => a.ordinal - b.ordinal);
    }
    return declared > 0 ? ordered.slice(0, declared) : ordered;
  }

export function expandAssessmentContentShellV663(surfaceRoot, declared) {
    if (!surfaceRoot || Number(declared || 0) < 2) return false;
    const targetRe = new RegExp('^\\s*Content\\s*\\(\\s*' + Number(declared) + '\\s*\\)\\s*$', 'i');
    const roots = [surfaceRoot];
    let p = surfaceRoot.parentElement;
    for (let i = 0; p && i < 6; i++, p = p.parentElement) roots.push(p);
    roots.push(document.body);
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = [...root.querySelectorAll("button,[role='button'],[aria-expanded]")].slice(0,12000); } catch (e) {}
      for (const el of nodes) {
        if (!el || seen.has(el) || !isVisibleElement(el) || isGlobalChromeElement(el) || isDangerousEditorControl(el)) continue;
        seen.add(el);
        const label = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
        if (!targetRe.test(label)) continue;
        const expanded = String(el.getAttribute('aria-expanded') || '').toLowerCase();
        if (expanded === 'false' || !expanded) {
          try { el.click(); return true; } catch (e) {
            try { el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return true; } catch (_) {}
          }
        }
      }
    }
    return false;
  }

export function assessmentQuestionDetailRootV662(surfaceRoot) {
    if (!surfaceRoot) return null;
    const candidates = [];
    try {
      const nodes = [surfaceRoot, ...surfaceRoot.querySelectorAll("article,section,fieldset,form,div,[role='group'],[role='region']")].slice(0,10000);
      nodes.forEach((el, order) => {
        if (!el || !isVisibleElement(el) || isGlobalChromeElement(el)) return;
        const text = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length < 55 || text.length > 8500 || !/\bPrompt\b/i.test(text)) return;
        const promptHits = (text.match(/\bPrompt\b/gi) || []).length;
        if (promptHits > 2) return;
        const badges = exactAssessmentBadgeElements(el);
        let score = 0;
        if (/\bOptions\b/i.test(text)) score += 25;
        if (/\bQuestion\s*Type\b/i.test(text)) score += 20;
        if (badges.length) score += Math.min(36, badges.length * 6);
        if (/\bCorrect Answers?\b/i.test(text)) score += 12;
        if (/\bIncorrect Answers?:\s*Explanation\b/i.test(text)) score += 8;
        if (text.length >= 120 && text.length <= 5000) score += 12;
        score -= Math.min(10, Math.max(0, text.length - 5000) / 500);
        candidates.push({el, text, score, order});
      });
    } catch (e) {}
    candidates.sort((a,b) => (b.score - a.score) || (a.text.length - b.text.length) || (a.order - b.order));
    return candidates.length ? candidates[0].el : surfaceRoot;
  }

export function inferSelectedQuestionTypeV662(rawType, options, detailText, navLabel) {
    let type = assessmentTypeKey(rawType);
    const rows = Array.isArray(options) ? options : [];
    if (type === "unknown") {
      const blob = (String(detailText || "") + " " + String(navLabel || "")).toLowerCase();
      type = assessmentTypeKey(blob);
    }
    if ((type === "unknown" || type === "single-select" || type === "true-false") && rows.length === 2) {
      const pair = rows.map(o => String(o.label || o.text || "").toLowerCase()).sort().join("|");
      if (pair === "false|true") return "true-false";
    }
    const correctCount = rows.filter(o => o.correct).length;
    if ((type === "unknown" || type === "single-select") && rows.length > 1 && correctCount > 1) return "multiple-select";
    if (type === "unknown" && rows.length > 1 && correctCount === 1) return "single-select";
    if (type === "unknown" && /regular expression|regex/.test(String(detailText || "").toLowerCase())) return "regex";
    if (type === "unknown" && /text entry|short answer|fill in/.test(String(detailText || "").toLowerCase())) return "text-entry";
    return type;
  }

export function questionEvidenceReadyV6138(q) {
    if(!q)return false;
    q=ctiGuardOptionEvidence_(q);
    return Boolean((q.answerTextReliable===true && (q.correctAnswers || []).length) || isObservedWrittenResponseV6138(q));
  }

export function parseSelectedAssessmentQuestionV662(surfaceRoot, fp, ordinal, navLabel) {
    if (!surfaceRoot || !isAssessmentLikeFingerprintV662(fp)) return null;
    const detail = assessmentQuestionDetailRootV662(surfaceRoot) || surfaceRoot;
    const written = parseWrittenResponsePartV6136(detail, ordinal);
    if (written) return written;
    const rawText = String(detail.innerText || detail.textContent || "");
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text || !/\bPrompt\b/i.test(text)) return null;

    let rawType = "";
    const tm = text.match(/\bQuestion\s*Type\s+(.+?)\s+Prompt\b/i);
    if (tm && tm[1]) rawType = String(tm[1]).trim();

    const promptMatch = text.match(/\bPrompt\s*\*?\s*(.+?)(?=\s+Options\s*\*?|\s+Correct Answers?\b|\s+Incorrect Answers?\b|\s+Explanation\b|\s+Export Settings\b|\s+Question\s*Type\b|$)/i);
    let prompt = promptMatch && promptMatch[1] ? String(promptMatch[1]).replace(/\s+/g, " ").trim() : "";
    if (!prompt || prompt.length < 8) return null;

    let rows = [];
    const allBadges = exactAssessmentBadgeElements(detail);
    const seenRows = new Set();
    allBadges.forEach(badge => {
      const row = optionRowForBadge(badge, detail, allBadges);
      if (!row || seenRows.has(row)) return;
      seenRows.add(row);
      const parts = optionSemanticPartsFromRow(row);
      const rowText = parts.text || textWithoutExactBadges(row);
      if (!rowText || rowText.length > 1200) return;
      const status = String(badge.innerText || badge.textContent || "").trim();
      rows.push({id:String(rows.length + 1), text:rowText, label:parts.label || rowText, description:parts.description || "", aliases:parts.aliases || [], optionFeedback:parts.optionFeedback || undefined, optionFieldIssue:parts.feedbackOnly?'FEEDBACK_ONLY_OPTION_FIELD':parts.optionFieldIssue, optionDomEvidence:parts.optionDomEvidence, correct:status === "Correct"});
    });

    if (!rows.length) {
      const om = text.match(/\bOptions\s*\*?\s*(.+?)(?=\s+Incorrect Answers?:\s*Explanation\b|\s+Export Settings\b|$)/i);
      if (om && om[1]) {
        const recovered = recoverCollapsedBadgeOptions(String(om[1]));
        if (recovered && recovered.length) rows = recovered;
      }
    }

    let correctAnswers = rows.filter(o => o.correct).map(o => o.label || o.text).filter(Boolean);
    let type = inferSelectedQuestionTypeV662(rawType, rows, text, navLabel);
    if (!correctAnswers.length && /^(regex|text-entry)$/.test(type)) {
      const cm = text.match(/\bCorrect Answers?\s+(.+?)(?=\s+Correct\b|\s+Incorrect Answers?:|\s+Export Settings\b|$)/i);
      if (cm && cm[1]) correctAnswers = [String(cm[1]).replace(/\s+/g, " ").trim()];
    }

    let feedback = "";
    const fm = text.match(/\bIncorrect Answers?:\s*Explanation\s+(.+?)(?=\s+Export Settings\b|$)/i);
    if (fm && fm[1]) feedback = String(fm[1]).replace(/\s+/g, " ").trim();
    rows = dropFeedbackPseudoOptionsV6611(rows, feedback);
    correctAnswers = rows.filter(o => o.correct).map(o => o.label || o.text).filter(Boolean);

    let points = null;
    const pointSources = [String(navLabel || ""), text.slice(0,900)];
    for (const source of pointSources) {
      const pm = source.match(/\b([0-9]+(?:\.[0-9]+)?)\s*points?\b/i);
      if (pm && Number.isFinite(Number(pm[1]))) { points = Number(pm[1]); break; }
    }

    const optionTextReliable = rows.length > 0 && rows.every(o => String(o.label || o.text || "").length <= 240 && String(o.text || "").length <= 1200);
    const answerTextReliable = correctAnswers.length > 0 && (optionTextReliable || /^(regex|text-entry)$/.test(type));
    return {
      id:String(ordinal || 1),
      type,
      rawType:rawType || type,
      prompt,
      options:rows,
      correctAnswers:[...new Set(correctAnswers)],
      feedback,
      points,
      optionTextReliable,
      answerTextReliable,
      parserConfidence:answerTextReliable ? 0.96 : 0.86,
      _cycleOrdinal:Number(ordinal || 0)
    };
  }

export function assessmentCycleKeyV613(question, ordinal) {
    if (question.courseraQuestionId) return 'id:'+String(question.courseraQuestionId);
    if (question.questionOrdinalObserved && Number(ordinal)>0) return 'ordinal:'+Number(ordinal);
    return 'prompt:'+assessmentPromptKey_(question.prompt);
  }

export function mergeQuestionIntoCycleV662(map, question, ordinalHint) {
    if(question)question=ctiGuardOptionEvidence_(question);
    if (!question || !assessmentPromptKey_(question.prompt)) return;
    const q=JSON.parse(JSON.stringify(question));
    q._cycleOrdinal=Number(ordinalHint || q._cycleOrdinal || q.id || 0);
    const promptKey=assessmentPromptKey_(q.prompt);
    const strong=Boolean(q.courseraQuestionId || q.questionOrdinalObserved);
    let key=assessmentCycleKeyV613(q,q._cycleOrdinal);
    if (!q.courseraQuestionId && q.questionOrdinalObserved) {
      const identified=[...map.entries()].find(([k,v])=>v.courseraQuestionId && v.questionOrdinalObserved && Number(v._cycleOrdinal || v.id)===q._cycleOrdinal);
      if (identified) {
        if (assessmentPromptKey_(identified[1].prompt)!==promptKey) return;
        q.courseraQuestionId=identified[1].courseraQuestionId;
        key=identified[0];
      }
    }
    const same=[...map.entries()].filter(([k,v])=>assessmentPromptKey_(v.prompt)===promptKey);
    if (strong) {
      for (const [k,v] of same) if (!v.courseraQuestionId && !v.questionOrdinalObserved) map.delete(k);
      // An observed ordinal ties generic selectors to a later hash anchor.
      for (const [k,v] of map) if (q.courseraQuestionId && !v.courseraQuestionId && v.questionOrdinalObserved && Number(v._cycleOrdinal)===q._cycleOrdinal) map.delete(k);
    } else {
      const identified=same.filter(([k,v])=>v.courseraQuestionId || v.questionOrdinalObserved);
      if (identified.length) return; // Ambiguous prompt-only evidence cannot overwrite identified questions.
    }
    const prev=map.get(key);
    const score=x=>(x.answerTextReliable?1000:0)+(x.optionTextReliable?100:0)+Number(x.parserConfidence || 0)*10+(x.points!=null?1:0);
    if (!prev || score(q)>score(prev)) {
      const canonicalOrdinal=Number(prev && (prev._cycleOrdinal || prev.id) || 0);
      if (canonicalOrdinal>0) q._cycleOrdinal=canonicalOrdinal;
      map.set(key,q);
    }
  }
