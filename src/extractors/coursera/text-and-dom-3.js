import { cleanAssignmentOptionFieldV6610 } from "./assessments-3.js";
import { assignmentTextBlockBodyV61321, isStructuredAssessmentFingerprint } from "./assessments.js";
import { MAX_TEXT_SAMPLE } from "./config.js";
import { isDiscussionFingerprintV6612, scoreSurfaceForFingerprint } from "./evidence-2.js";
import { isLikelyWholeOutlineSurface } from "./navigation-2.js";
import { elementAttributeBlob } from "./text-and-dom-2.js";
import { isGlobalChromeElement } from "./text-and-dom-4.js";
import { normalizeName, stripHtml, unique } from "./text-and-dom.js";

export function scopedWaitBudgetV61321(baseMs,extraMs,outerDeadline) {
    const started=Date.now(),outer=outerDeadline==null?Infinity:Number(outerDeadline);
    const baseDeadline=Math.min(started+baseMs,outer),hardDeadline=Math.min(started+baseMs+extraMs,outer);
    let deadline=baseDeadline,maxima=null,lastProgress=-1,extendedFor=-1;
    const extensions=[];
    return {
      observe(values) {
        const next=values.map(x=>Number(x)||0);
        if(maxima && next.some((x,i)=>x>(maxima[i]||0)))lastProgress=Date.now()-started;
        maxima=maxima?next.map((x,i)=>Math.max(x,maxima[i]||0)):next;
      },
      extend(sampleMs) {
        const now=Date.now(),elapsed=now-started;
        if(now+sampleMs>=deadline && now<outer && deadline<hardDeadline && lastProgress>extendedFor && elapsed-lastProgress<=4000) {
          const old=deadline;deadline=Math.min(deadline+4000,hardDeadline);extendedFor=lastProgress;
          extensions.push({atMs:elapsed,addedMs:deadline-old,progressAtMs:lastProgress,reason:'NEW_SCOPED_PAYLOAD_EVIDENCE'});
        }
        return deadline;
      },
      snapshot() {return {baseMs:Math.max(0,baseDeadline-started),hardMs:Math.max(0,hardDeadline-started),grantedMs:Math.max(0,deadline-started),extensions};}
    };
  }

export function sessionEndpointContentKey(record) {
    if (!record) return "";
    let path = String(record.url || "");
    try { path = new URL(record.url, location.origin).pathname; } catch (e) {}
    const m = path.match(/\/api\/(?:authoringItemContentRelations\.v1|authoringAtoms\.v2)\/([^/?]+)/i);
    return m ? decodeURIComponent(m[1]) : "";
  }

export function sessionAtomIsRelationPaired(record, records) {
    let path = String(record && record.url || "");
    try { path = new URL(record.url, location.origin).pathname; } catch (e) {}
    if (!/\/api\/authoringAtoms\.v2\//i.test(path)) return false;
    const key = sessionEndpointContentKey(record);
    if (!key) return false;
    return (records || []).some(r => {
      let p = String(r && r.url || "");
      try { p = new URL(r.url, location.origin).pathname; } catch (e) {}
      return /\/api\/authoringItemContentRelations\.v1\//i.test(p) && sessionEndpointContentKey(r) === key;
    });
  }

export function isVisibleElement(el) {
    try {
      if (!el || !el.isConnected) return false;
      const style = getComputedStyle(el);
      if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    } catch (e) { return false; }
  }

export function surfaceRoleBonus(el) {
    if (!el || !el.getAttribute) return 0;
    const role = String(el.getAttribute("role") || "").toLowerCase();
    const modal = String(el.getAttribute("aria-modal") || "").toLowerCase();
    const attrs = elementAttributeBlob(el);
    if (role === "dialog" || modal === "true") return 0.05;
    if (/drawer|modal|dialog|editor|panel|sheet|flyout/.test(attrs)) return 0.03;
    return 0;
  }

export function isGenericSmartIngestionName(fp) {
    const name = normalizeName(fp && fp.name);
    return /^(untitled(?: item)?|new reading|new discussion prompt|new plugin item|new assignment|new quiz|new item|assignment|assessment|quiz|reading|discussion)$/.test(name);
  }

export function editorSurfaceSignalScore(root, fp) {
    if (!root || !isVisibleElement(root)) return 0;
    let score = 0;
    const attrs = normalizeName(elementAttributeBlob(root));
    let text = "";
    try { text = normalizeName(String(root.innerText || root.textContent || "").slice(0, 30000)); } catch (e) {}
    if (/editor|drawer|dialog|modal|sheet|flyout|itemcontent|assignment|discussion/.test(attrs)) score += 0.28;
    try {
      if (root.querySelector("textarea,[contenteditable='true'],iframe,input,select")) score += 0.28;
      if (root.querySelector("form,[role='dialog'],[aria-modal='true']")) score += 0.12;
    } catch (e) {}
    const typeBlob = normalizeName([fp && fp.type, fp && fp.typeName].filter(Boolean).join(" "));
    if (/assignment|quiz|assessment/.test(typeBlob) && /question prompt|assignment outline|rubric|file upload|grading|attempts|passing threshold|instructions/.test(text)) score += 0.34;
    else if (/discussion/.test(typeBlob) && /discussion|prompt|instructions|grading/.test(text)) score += 0.34;
    else if (/plugin|widget|lti/.test(typeBlob) && /plugin|url|launch|configuration|external/.test(text)) score += 0.28;
    else if (/reading|supplement/.test(typeBlob) && /reading|content|body|text|time estimate/.test(text)) score += 0.20;
    if (text.length >= 120) score += 0.08;
    return Math.min(1, score);
  }

export function candidateSurfaceAncestors(el) {
    const out = [];
    let cur = el;
    for (let i = 0; cur && i < 7; i++, cur = cur.parentElement) {
      if (cur === document.body || cur === document.documentElement) break;
      if (isVisibleElement(cur)) out.push(cur);
    }
    return out;
  }

export function snapshotOpenSurfaceRoots() {
    const out = new Set();
    try {
      document.querySelectorAll("[role='dialog'],[aria-modal='true'],dialog,[data-state='open']").forEach(el => {
        if (isVisibleElement(el)) out.add(el);
      });
    } catch (e) {}
    return out;
  }

export function findOpenedEditorSurface(fp, changedNodes, clickedElement, baselineOpenSurfaces, strongSessionIdentity) {
    const roots = [];
    const seen = new Set();
    const baseline = baselineOpenSurfaces || new Set();
    function addRoot(root) {
      if (!root || seen.has(root) || root === document.body || root === document.documentElement) return;
      if (!isVisibleElement(root) || isGlobalChromeElement(root) || isLikelyWholeOutlineSurface(root)) return;
      seen.add(root); roots.push(root);
    }

    // Only DOM that changed after the attempted item interaction is eligible.
    // Do NOT add ancestors of the clicked control itself; that caused the normal
    // Course Outline page to be mistaken for an item editor in v4.9.1.
    for (const node of changedNodes || []) candidateSurfaceAncestors(node).forEach(addRoot);

    // Newly opened dialogs/drawers are valid even if their internal subtree did not
    // produce a convenient MutationRecord target.
    try {
      document.querySelectorAll("[role='dialog'],[aria-modal='true'],dialog,[data-state='open']").forEach(root => {
        if (isVisibleElement(root) && !baseline.has(root)) addRoot(root);
      });
    } catch (e) {}

    let best = null, bestScore = 0;
    for (const root of roots.slice(0, 350)) {
      const score = scoreSurfaceForFingerprint(root, fp, strongSessionIdentity);
      if (score > bestScore) { best = root; bestScore = score; }
    }
    return bestScore >= 0.90 ? { root: best, score: bestScore } : null;
  }

export function estimateTextCompleteness(fp, text, root, scopeKind, partCount) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text) return 0;
    let rootText = "";
    try { rootText = stripHtml(root.innerText || root.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) {}
    const ratio = rootText ? Math.min(1, text.length / Math.max(text.length, rootText.length)) : 1;
    const structured = isStructuredAssessmentFingerprint(fp);
    const typeBlob = normalizeName([fp && fp.type, fp && fp.typeName].filter(Boolean).join(" "));
    const markerCount = (text.match(/\b(prompt|question|rubric|criteria|option|answer|instruction|point|feedback)\b/gi) || []).length;
    let completeness;

    if (structured) {
      // Structured assignments/quizzes often expose one rich-text field while the rest
      // of the questions/rubrics are elsewhere in the editor. Short fragments are not
      // complete enough to support a hard CONTENT_CHANGED verdict.
      completeness = 0.35;
      if (text.length >= 350) completeness = 0.58;
      if (text.length >= 700) completeness = 0.76;
      if (text.length >= 1200) completeness = 0.88;
      if (markerCount >= 6 && text.length >= 450) completeness = Math.max(completeness, 0.82);
      if (markerCount >= 12 && text.length >= 900) completeness = Math.max(completeness, 0.90);
      if (ratio >= 0.60 && text.length >= 350) completeness = Math.max(completeness, 0.84);
      if ((partCount || 0) >= 3 && text.length >= 500) completeness = Math.max(completeness, 0.82);
    } else if (/discussion/.test(typeBlob)) {
      completeness = text.length >= 80 ? 0.92 : 0.55;
      if (ratio < 0.18 && rootText.length > 900) completeness = Math.min(completeness, 0.72);
    } else {
      completeness = text.length >= 80 ? 0.88 : 0.50;
      if (ratio >= 0.55) completeness = 0.95;
      if (ratio < 0.12 && rootText.length > 1600) completeness = Math.min(completeness, 0.68);
    }

    if (scopeKind === "generic-root") completeness = Math.min(completeness, 0.45);
    return Math.max(0, Math.min(1, completeness));
  }

export function cleanDiscussionPromptTextV6612(value) {
    let text = String(value || "").replace(/\s+/g, " ").trim();
    const original = text;
    if (!text) return { text:"", changed:false, chromeStripped:false, originalLength:0 };

    // "Prompt" is an editor field label, not part of the learner prompt.
    text = text.replace(/^\s*Prompt\s+/i, "").trim();

    // Coursera has used both of these authoring advisories. Keep the rules narrow:
    // they only run for Discussion fingerprints and only cut from a known guidance
    // sentence onward, preserving all preceding learner-authored prompt text.
    const chromeBoundaries = [
      /\s+Editing a discussion prompt only changes the prompt in sessions that have not yet begun\.?[\s\S]*$/i,
      /\s+Visit the discussion forums to update discussion prompts in live sessions\.?[\s\S]*$/i,
      /\s+If this discussion prompt was updated through the discussion forum after the session started,?\s*then those changes (?:won[’']t|will not) be reflected here\.?[\s\S]*$/i
    ];
    let chromeStripped = false;
    for (const pattern of chromeBoundaries) {
      if (pattern.test(text)) {
        text = text.replace(pattern, "").trim();
        chromeStripped = true;
      }
    }

    return {
      text,
      changed: text !== original,
      chromeStripped,
      originalLength: original.length
    };
  }

export function collectSurfaceBodyText(root, fp) {
    if (!root) return { text: "", confidence: "none", priority: 0, scoped:false, completeness:0, scopeKind:"none" };
    // This root is a bounded production prompt field, not an arbitrary page node.
    // Exact course/item identity is checked separately by the typed-editor caller.
    const promptTag=String(root.tagName || '').toLowerCase();
    const editable=root.getAttribute && root.getAttribute('contenteditable');
    const promptField=promptTag==='textarea' || (root.getAttribute && root.getAttribute('role')==='textbox') || editable==='' || editable==='true' || editable==='plaintext-only';
    if (isDiscussionFingerprintV6612(fp) && promptField && root.closest && root.closest('.rc-DiscussionPromptBodyEditor') && isVisibleElement(root) && !isGlobalChromeElement(root)) {
      const value=String(root.value != null ? root.value : root.innerText || root.textContent || '').replace(/\s+/g,' ').trim();
      return {text:value.slice(0,MAX_TEXT_SAMPLE),confidence:value?'high':'none',priority:value?98:0,scoped:true,
        completeness:value && value.length<=MAX_TEXT_SAMPLE?1:0,scopeKind:'discussion-prompt-field',
        originalTextLength:value.length,truncated:value.length>MAX_TEXT_SAMPLE};
    }
    const blockBody=assignmentTextBlockBodyV61321(root,fp);
    if(blockBody)return blockBody;
    const structured = isStructuredAssessmentFingerprint(fp);
    const strongParts = [];
    try {
      const selector="textarea,[role='textbox'],[contenteditable='true'],[contenteditable='plaintext-only']";
      const fields=[...(root.querySelectorAll(selector) || [])];
      if (root.matches && root.matches(selector)) fields.unshift(root);
      fields.forEach(el => {
        if (!isVisibleElement(el) || isGlobalChromeElement(el)) return;
        const attrs = normalizeName(elementAttributeBlob(el));
        if (/\b(itemname|title|search|filter|comment|password)\b/.test(attrs)) return;
        const value = String(el.value || el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (value.length >= 40) strongParts.push(value);
      });
    } catch (e) {}
    try {
      root.querySelectorAll("iframe").forEach(frame => {
        if (!isVisibleElement(frame) || isGlobalChromeElement(frame)) return;
        try {
          const doc = frame.contentDocument;
          const value = String(doc && doc.body ? doc.body.innerText || doc.body.textContent || "" : "").replace(/\s+/g, " ").trim();
          if (value.length >= 40) strongParts.push(value);
        } catch (e) {}
      });
    } catch (e) {}
    const strong = unique(strongParts, 40).join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_SAMPLE);
    // For readings/discussions, a strong field is normally the actual body. For a
    // structured assignment/quiz, do not stop at a tiny explanation/rubric field;
    // continue looking for a broader content container.
    if (strong.length >= 80 && (!structured || strong.length >= 650 || strongParts.length >= 4)) {
      return {
        text: strong,
        confidence: "high",
        priority: 95,
        scoped:true,
        completeness: estimateTextCompleteness(fp, strong, root, "field-aggregate", strongParts.length),
        scopeKind: "field-aggregate"
      };
    }

    // Generic root.innerText is often the entire Coursera authoring shell. Prefer
    // a smaller content/prompt/editor subtree and explicitly reject known shell chrome.
    const candidates = [];
    function consider(el) {
      if (!el || !isVisibleElement(el) || isGlobalChromeElement(el)) return;
      const attrs = normalizeName(elementAttributeBlob(el));
      if (!/(content|prompt|reading|assignment|discussion|question|editor|supplement|plugin|description|body|richtext|atom|rubric|option)/.test(attrs)) return;
      const text = stripHtml(el.innerText || el.textContent || "").slice(0, MAX_TEXT_SAMPLE);
      if (text.length < 80) return;
      const chrome = /asset library resources app manager plugin manager|items last edited|this is a fake course|programmed messages|view as learner close/i.test(text);
      if (chrome) return;
      let score = 10;
      if (/(prompt|description|body|richtext|reading|discussion|question|rubric)/.test(attrs)) score += 18;
      if (/(content|editor|supplement|assignment|plugin)/.test(attrs)) score += 8;
      try {
        const controls = el.querySelectorAll("a[href],button,input,select").length;
        if (controls <= 12) score += 8;
        if (controls > 35) score -= 18;
        const headings = el.querySelectorAll("h1,h2,h3,[role='heading']").length;
        if (headings > 0 && headings <= 6) score += 6;
      } catch (e) {}
      if (text.length <= 8000) score += 5;
      if (structured) {
        const markers = (text.match(/\b(prompt|question|rubric|criteria|option|answer|instruction|point|feedback)\b/gi) || []).length;
        if (text.length >= 400) score += 4;
        if (text.length >= 900) score += 6;
        if (markers >= 5) score += 6;
        if (markers >= 10) score += 6;
      }
      candidates.push({ text, score, len:text.length });
    }
    consider(root);
    try {
      [...root.querySelectorAll("article,form,section,[role='region'],[data-testid],[data-e2e],[class]")].slice(0, 5000).forEach(consider);
    } catch (e) {}
    candidates.sort((a,b) => (b.score - a.score) || (structured ? (b.len - a.len) : (a.len - b.len)));
    if (candidates.length && candidates[0].score >= 28) {
      let chosen = candidates[0];
      if (structured) {
        // If several candidates are similarly specific, choose the broadest one so a
        // single explanation/rubric label cannot masquerade as the whole assignment.
        const near = candidates.filter(c => c.score >= candidates[0].score - 5).slice(0, 30);
        near.sort((a,b) => b.len - a.len);
        if (near[0]) chosen = near[0];
      }
      return {
        text:chosen.text,
        confidence:"high",
        priority:90,
        scoped:true,
        completeness:estimateTextCompleteness(fp, chosen.text, root, "scoped-subtree", strongParts.length),
        scopeKind:"scoped-subtree"
      };
    }

    // If structured content had a genuine editable field but no safe broader subtree,
    // retain it as evidence but mark it incomplete instead of elevating it to a hard
    // content verdict.
    if (strong.length >= 80) {
      return {
        text:strong,
        confidence:"high",
        priority:88,
        scoped:true,
        completeness:estimateTextCompleteness(fp, strong, root, "field-fragment", strongParts.length),
        scopeKind:"field-fragment"
      };
    }

    const generic = stripHtml(root.innerText || root.textContent || "").slice(0, MAX_TEXT_SAMPLE);
    if (generic.length >= 80) return { text: generic, confidence: "medium", priority: 40, scoped:false, completeness:0.40, scopeKind:"generic-root" };
    return { text: generic, confidence: generic ? "low" : "none", priority: generic ? 20 : 0, scoped:false, completeness:generic ? 0.20 : 0, scopeKind:"generic-root" };
  }

export function textWithoutExactBadges(el) {
    if (!el) return "";
    function walk(node) {
      if (!node) return "";
      if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || "");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const own = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (own === "Correct" || own === "Incorrect") return "";
      const parts = [];
      try { node.childNodes.forEach(ch => { const p = walk(ch); if (p) parts.push(p); }); } catch (e) {}
      return parts.join(" ");
    }
    let t = walk(el).replace(/\s+/g, " ").trim();
    t = t.replace(/^\s*option\s+\d+[.)]?\s+/i, "").trim();
    return t;
  }

export function splitCarryDescriptionAndLabel(segment) {
    const text = String(segment || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    let best = null;
    const boundary = /[.!?](?=\s+[A-Z0-9])/g;
    let m;
    while ((m = boundary.exec(text)) !== null) {
      const tail = text.slice(m.index + 1).trim();
      if ((tail.length >= 3 || /^[A-Za-z0-9][A-Za-z0-9+\-]?$/.test(tail)) && tail.length <= 220) best = {description:text.slice(0, m.index + 1).trim(), label:tail};
    }
    return best;
  }

export function isObservedWrittenResponseV6138(q) {
    if(!q || !String(q.prompt || '').trim() || q.optionCaptureIssue ||
      (q.options || []).length || (q.correctAnswers || []).length ||
      !q.responseTypeEvidence || !q.promptBoundaryEvidence)return false;
    const type=q.responseTypeEvidence, boundary=q.promptBoundaryEvidence;
    if(q.type==='essay' && type.method==='OBSERVED_EDITOR_TYPE_FIELD' &&
      /^Reflective text answer$/i.test(type.text || '') && boundary.method==='EXPLICIT_PROMPT_FIELD')return true;
    const expected=q.type==='file-upload' ? /^(?:AI|Manual|Peer|Staff)[- ]Graded\s+File\s+Upload(?:\s+Test)?\s+Question$/i :
      q.type==='essay' ? /^(?:AI|Manual|Peer|Staff)[- ]Graded\s+(?:Rich\s+Text|Essay|Long\s+Answer)(?:\s+Test)?\s+Question$/i : null;
    return Boolean(expected && type.method==='OBSERVED_EDITOR_HEADING' && expected.test(type.text || '') &&
      boundary.method==='EXPLICIT_AUTHORING_SECTION');
  }

export function parseWrittenResponsePartV6136(part, ordinal) {
    const rawText=String(part && (part.innerText || part.textContent) || '');
    const text=rawText.replace(/\s+/g,' ').trim();
    // Published reflective questions have a disabled type field and a bounded
    // prompt viewer. A phrase inside the prompt cannot establish response type.
    if(part && /^assignment-part-\d+$/.test(part.getAttribute('data-testid') || '')) {
      const field=part.querySelector('select[data-testid="read-only-value"]');
      const promptField=part.querySelector('[data-testid="prompt-editor"]');
      const viewer=promptField && promptField.querySelector('[data-testid="cml-viewer"]');
      const observedType=String(field && (field.innerText || field.textContent) || '').trim();
      const prompt=String(viewer && (viewer.innerText || viewer.textContent) || '').replace(/\s+/g,' ').trim();
      if(field && field.getAttribute('disabled')!==null && /^Reflective text answer$/i.test(observedType) && prompt) {
        const points=text.match(/^(?:\d+\s*)?Auto[- ]Graded\s+(\d+(?:\.\d+)?)\s+points?\b/i);
        return {id:String(ordinal || 1),type:'essay',rawType:observedType,prompt,options:[],correctAnswers:[],feedback:'',
          points:points?Number(points[1]):null,optionTextReliable:false,answerTextReliable:false,parserConfidence:0.96,
          responseTypeEvidence:{method:'OBSERVED_EDITOR_TYPE_FIELD',text:observedType},
          promptBoundaryEvidence:{method:'EXPLICIT_PROMPT_FIELD',boundary:'prompt-editor/cml-viewer'},_cycleOrdinal:Number(ordinal || 0)};
      }
    }
    // Use the editor's response-type heading, never words inside the prompt.
    const heading=text.match(/^(?:\d+\s*)?((?:AI|Manual|Peer|Staff)[- ]Graded\s+(?:Rich\s+Text|Essay|Long\s+Answer|File\s+Upload)(?:\s+Test)?\s+Question)\s+Prompt\s*\*?\s*/i);
    if(!heading)return null;
    const body=text.slice(heading[0].length);
    const boundary=body.match(/\s+(?:AI Grader Instructions\s*\(Not shown to learners\)|Show academic integrity options|Rubric\s*\d|Export Settings)(?=\s|$)/i);
    // Without a visible end boundary, leave the ordinary parser's uncertainty.
    if(!boundary)return null;
    const prompt=body.slice(0,boundary.index).trim();
    if(!prompt)return null;
    return {id:String(ordinal || 1),type:/File\s+Upload/i.test(heading[1])?'file-upload':'essay',rawType:heading[1],prompt,
      options:[],correctAnswers:[],feedback:'',points:null,
      optionTextReliable:false,answerTextReliable:false,parserConfidence:0.96,
      responseTypeEvidence:{method:'OBSERVED_EDITOR_HEADING',text:heading[1]},
      promptBoundaryEvidence:{method:'EXPLICIT_AUTHORING_SECTION',boundary:boundary[0].trim(),rawPrompt:body.slice(0,8000),rawPromptTruncated:body.length>8000},
      _cycleOrdinal:Number(ordinal || 0)};
  }

export function feedbackCoreV6611(value) {
    return cleanAssignmentOptionFieldV6610(value)
      .replace(/^\s*\(Optional\)\s*/i, '')
      .replace(/^\s*Incorrect(?:\s+Answers?)?(?:\s*:\s*Explanation)?\s*/i, '')
      .replace(/^\s*Explanation\s*/i, '')
      .replace(/\s+/g, ' ').trim();
  }

export function stateSearchBudgetV61313(options) {
    options=options || {};
    return {deadline:Math.min(Number(options.deadline || Infinity),Date.now()+5000),
      remaining:60000,stopReason:'',nodes:0};
  }

export function stateSearchStepV61313(work) {
    if (work.stopReason) return false;
    if (Date.now()>=work.deadline) {work.stopReason='TIME_BUDGET';return false;}
    if (work.remaining--<=0) {work.stopReason='NODE_BUDGET';return false;}
    work.nodes++;return true;
  }

export function ownStateValueV61313(obj,key) {
    try {const descriptor=Object.getOwnPropertyDescriptor(obj,key);return descriptor && 'value' in descriptor?descriptor.value:undefined;} catch (e) {return undefined;}
  }

export function ctiPlainTextV664(value, maxLen) {
    const limit = Number(maxLen || 1200);
    if (value == null) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value !== 'string') return '';
    let text = String(value);
    try {
      if (/[<>]/.test(text) && /<[^>]+>/.test(text)) {
        const div = document.createElement('div');
        div.innerHTML = text;
        text = div.innerText || div.textContent || text;
      }
    } catch (e) {}
    return text.replace(/\\s+/g, ' ').trim().slice(0, limit);
  }

export function reactFiberForElementV664(el) {
    if (!el) return null;
    try {
      const key = Object.getOwnPropertyNames(el).find(k => k.indexOf('__reactFiber$') === 0);
      return key ? el[key] : null;
    } catch (e) { return null; }
  }

export function findNamedValueV664(obj, keyRe, depth, seen, work) {
    work=work || stateSearchBudgetV61313();
    if (!stateSearchStepV61313(work) || !obj || typeof obj !== 'object' || depth < 0) return null;
    seen = seen || new WeakSet();
    if (seen.has(obj)) return null;
    seen.add(obj);
    let keys = [];
    try { keys = Object.keys(obj).slice(0, 120); } catch (e) { return null; }
    for (const k of keys) {
      if (!stateSearchStepV61313(work)) return null;
      let v;
      try { v = ownStateValueV61313(obj,k); } catch (e) { continue; }
      if (keyRe.test(String(k))) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v)) return {key:k, value:v};
        if (v && typeof v === 'object') return {key:k, value:v};
      }
    }
    if (depth === 0) return null;
    for (const k of keys) {
      if (!stateSearchStepV61313(work)) return null;
      if (/^(?:children|_owner|return|child|sibling|stateNode|alternate|dependencies)$/i.test(k)) continue;
      let v;
      try { v = ownStateValueV61313(obj,k); } catch (e) { continue; }
      if (!v || typeof v !== 'object' || (typeof Element !== 'undefined' && v instanceof Element)) continue;
      const hit = findNamedValueV664(v, keyRe, depth - 1, seen, work);
      if (hit) return hit;
    }
    return null;
  }
