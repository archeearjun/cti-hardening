import { assessmentDeclaredCountV662, assessmentEnvelopeRootV662, assessmentPartCountV8, assessmentPromptKey_, isAssessmentLikeFingerprintV662, mergeCourseraAssessmentEvidence, questionEvidenceReadyV6138 } from "./assessments-2.js";
import { ctiGuardOptionEvidence_, parseAssignmentPartDomV665 } from "./assessments-3.js";
import { assessmentLayoutDiagnosticV61318, assessmentTypeKey, emptyAssessmentProbeV61320, exactAssessmentBadgeElements, isAssignmentTextBlockV61321, observedAssignmentLayoutV61319, optionRowForBadge, optionSemanticPartsFromRow, parseCourseraAssessmentTextFallback } from "./assessments.js";
import { isItemSpecificCourseRoute } from "./navigation-2.js";
import { choiceDiagnosticsV61318, elementAttributeBlob, isDocumentScrollRoot, observedEmptyLayoutV61318, scrollRootMax } from "./text-and-dom-2.js";
import { ctiPlainTextV664, findNamedValueV664, isObservedWrittenResponseV6138, isVisibleElement, ownStateValueV61313, reactFiberForElementV664, stateSearchBudgetV61313, stateSearchStepV61313, textWithoutExactBadges } from "./text-and-dom-3.js";
import { isDangerousEditorControl, isGlobalChromeElement, objectTextV664 } from "./text-and-dom-4.js";
import { reactSignalsForElement } from "./text-and-dom-5.js";
import { courseId } from "./text-and-dom.js";

export function assessmentOutlineCandidatesV613(sidebar, declared) {
    const found = new Map();
    if (!sidebar) return [];
    for (const anchor of sidebar.querySelectorAll('a[href^="#"]')) {
      if (!isVisibleElement(anchor)) continue;
      const href = String(anchor.getAttribute('href') || '').trim();
      if (!href || /^(?:#|#for-content|#learning-objectives)$/.test(href)) continue;
      let id; try { id = decodeURIComponent(href.slice(1)); } catch (_) { continue; }
      const target = document.getElementById(id);
      const row = anchor.closest('[data-testid="assignment-outline"]');
      const targetTestId = String(target && target.getAttribute('data-testid') || '');
      const panelNumber = targetTestId.match(/^assignment-part-(\d+)$/);
      const rowNumber = String(row && (row.innerText || row.textContent) || '').trim().match(/^(\d+)\b/);
      const ordinal = panelNumber ? Number(panelNumber[1]) + 1 : Number(rowNumber && rowNumber[1] || 0);
      const dragId = String(row && row.getAttribute('data-rbd-drag-handle-draggable-id') || '');
      // Accept an unmounted target only when the observed outline itself gives
      // its identity. Never invent an anchor or a question URL from its number.
      if (!panelNumber && !(row && ordinal && (dragId || id.includes('~')))) continue;
      if (declared && ordinal > declared) continue;
      found.set(id, {anchor, href, id, target, ordinal,
        label:String(anchor.innerText || anchor.textContent || '').replace(/\s+/g,' ').trim(), targetTestId, dragId});
    }
    return [...found.values()].sort((a,b)=>(a.ordinal || Infinity)-(b.ordinal || Infinity));
  }

export function assessmentScrollRootsV613(sidebar, envelope) {
    const roots = [], seen = new Set();
    function add(el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      try {
        if (isDocumentScrollRoot(el)) return;
        const style = getComputedStyle(el);
        if (isVisibleElement(el) && el.clientHeight > 40 && el.scrollHeight > el.clientHeight + 8 && /auto|scroll|overlay/.test(style.overflowY || '')) roots.push(el);
      } catch (_) {}
    }
    const seeds = [sidebar, envelope];
    try { seeds.push(...envelope.querySelectorAll('[data-testid^="assignment-part-"]')); } catch (_) {}
    for (const seed of seeds) for (let p=seed, depth=0; p && depth<10; p=p.parentElement, depth++) add(p);
    try { for (const el of sidebar.querySelectorAll('div,section,ul,ol')) add(el); } catch (_) {}
    const docRoot = document.scrollingElement || document.documentElement;
    if (docRoot && scrollRootMax(docRoot) > 8) roots.push(docRoot);
    return roots;
  }

export function assessmentOutlineMoreV613(sidebar) {
    if (!sidebar) return null;
    for (const el of sidebar.querySelectorAll('button,[role="button"]')) {
      if (!isVisibleElement(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (el.closest('[data-testid^="assignment-part-"],[data-testid="option"]')) continue;
      const label = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
      const attrs = elementAttributeBlob(el);
      if (/next-item|previous-item|edititem/i.test(attrs) || isDangerousEditorControl(el)) continue;
      const more = /^(?:load|show) more(?: (?:questions|items|content))?(?: \(\d+\))?$/i.test(label);
      const pageNext = /^(?:next page|next questions)$/i.test(label) || (/^next$/i.test(label) && /pagination/i.test(attrs));
      if (more || pageNext) return el;
    }
    return null;
  }

export function assessmentCaptureCoverageV613(questions, declared, stopReason, partEvidence) {
    const parts=Number(partEvidence && partEvidence.declaredContentParts || declared);
    const excluded=new Set(partEvidence && partEvidence.nonQuestionPartOrdinals || []);
    const qs = (Array.isArray(questions) ? questions : []).map(ctiGuardOptionEvidence_);
    const ids = new Set(qs.map(q=>q.courseraQuestionId || (q.questionOrdinalObserved ? 'ordinal:'+q.id : '')).filter(Boolean));
    const ordinals = new Set(qs.filter(q=>q.questionOrdinalObserved).map(q=>Number(q.id)));
    const answered = qs.filter(q=>q.answerTextReliable === true && Array.isArray(q.correctAnswers) && q.correctAnswers.length).length;
    const missing = [], unanswered = [];
    // Bound the diagnostic list, not the declared count or traversal.
    for (let n=1; n<=Math.min(parts, 2000); n++) if (!excluded.has(n) && !ordinals.has(n)) missing.push(n);
    for (const q of qs) if (!(q.answerTextReliable === true && Array.isArray(q.correctAnswers) && q.correctAnswers.length)) unanswered.push(Number(q.id));
    const written = qs.filter(isObservedWrittenResponseV6138).map(q=>Number(q.id));
    const missingRequiredAnswers = qs.filter(q=>!questionEvidenceReadyV6138(q)).map(q=>Number(q.id));
    const validOrdinals = [...ordinals].filter(n=>Number.isInteger(n) && n>0 && n<=parts && !excluded.has(n));
    const countComplete = declared>0 && parts-excluded.size===declared && qs.length===declared && ids.size===declared && validOrdinals.length===declared;
    return {declared, declaredContentParts:parts, nonQuestionPartOrdinals:[...excluded], captured:qs.length, uniqueQuestionIds:ids.size, answerEvidence:answered,
      questionCoverageComplete:countComplete, answerCoverageComplete:countComplete && answered===declared,
      requiredAnswerCoverageComplete:countComplete && missingRequiredAnswers.length===0,
      answerKeyNotApplicableQuestionOrdinals:written,
      missingRequiredAnswerOrdinals:missingRequiredAnswers,
      missingQuestionOrdinals:missing, missingOrdinalListTruncated:parts>2000,
      unansweredQuestionOrdinals:unanswered, stopReason:String(stopReason || '')};
  }

export function assessmentLayoutV61313(root) {
    // A sibling outline/content pair belongs to the open assignment editor.
    // Never use the course page or a disconnected previous editor as this pair.
    for (let node=root,depth=0;node && depth<7;node=node.parentElement,depth++) {
      if (node===document.body || node===document.documentElement) break;
      if (!node.isConnected || !isVisibleElement(node)) continue;
      const bars=[...node.querySelectorAll('[data-testid="item-layout-left-sidebar"]')].filter(isVisibleElement);
      const bodies=[...node.querySelectorAll('[data-testid="item-layout-content"]')].filter(isVisibleElement);
      if (bars.length===1 && bodies.length===1 && /Assignment outline/i.test(bars[0].innerText || bars[0].textContent || '')) {
        return {root:node,sidebar:bars[0],content:bodies[0]};
      }
    }
    return observedAssignmentLayoutV61319(root) || observedEmptyLayoutV61318(root);
  }

export function exactAssessmentLayoutV61313(root, fp) {
    if (!root || !fp || !isAssessmentLikeFingerprintV662(fp)) return null;
    if (!isItemSpecificCourseRoute(location.href,fp,courseId())) return null;
    return assessmentLayoutV61313(root);
  }

export function emptyAssessmentSnapshotV61313(root,fp) {
    return emptyAssessmentProbeV61320(root,fp).snapshot;
  }

export function assessmentDeadlineV61313(runDeadline, remainingTargets) {
    const now=Date.now(),remaining=Math.max(0,runDeadline-now);
    // Reserve visits for later items. Large assessments may use up to 15 minutes;
    // recovery resumes missing questions within its own bounded budget.
    const reserve=Math.min(remaining*0.65,Math.max(0,remainingTargets)*8000);
    return Math.min(runDeadline,now+900000,now+Math.max(0,remaining-reserve));
  }

export function assessmentSurfaceDiagnosticsV61313(root, fp) {
    const envelope=assessmentEnvelopeRootV662(root,fp) || root;
    if (!envelope) return {partCount:0,parts:[]};
    const nodes=[...envelope.querySelectorAll('[data-testid^="assignment-part-"]')];
    return {rootTag:String(root.tagName || ''),rootTestId:String(root.getAttribute('data-testid') || ''),
      envelopeTag:String(envelope.tagName || ''),partCount:nodes.length,
      layoutDiagnostic:assessmentLayoutDiagnosticV61318(root,fp),
      parts:nodes.slice(0,24).map(node=>({id:String(node.id || ''),testId:String(node.getAttribute('data-testid') || ''),
        visible:isVisibleElement(node),textPreview:String(node.innerText || node.textContent || '').replace(/\s+/g,' ').trim().slice(0,1200),
        choiceDiagnostics:choiceDiagnosticsV61318(node)}))};
  }

export function assessmentStateSeedsV664(surfaceRoot, work) {
    work=work || stateSearchBudgetV61313();
    const seeds = [];
    const seen = new Set();
    function add(v, path) {
      if (!v || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v)) return;
      seen.add(v);
      seeds.push({value:v, path});
    }
    let cur = surfaceRoot;
    for (let depth = 0; cur && depth < 8 && stateSearchStepV61313(work); depth++, cur = cur.parentElement) {
      try {
        const keys = Object.getOwnPropertyNames(cur);
        const pk = keys.find(k => k.indexOf('__reactProps$') === 0);
        if (pk) add(cur[pk], 'dom[' + depth + '].reactProps');
        const fiber = reactFiberForElementV664(cur);
        let f = fiber;
        for (let i = 0; f && i < 16 && stateSearchStepV61313(work); i++, f = f.return) {
          add(f.memoizedProps, 'dom[' + depth + '].fiber[' + i + '].memoizedProps');
          add(f.pendingProps, 'dom[' + depth + '].fiber[' + i + '].pendingProps');
          add(f.memoizedState, 'dom[' + depth + '].fiber[' + i + '].memoizedState');
          if (f.updateQueue && typeof f.updateQueue === 'object') add(f.updateQueue, 'dom[' + depth + '].fiber[' + i + '].updateQueue');
        }
      } catch (e) {}
      if (cur === document.body || cur === document.documentElement) break;
    }

    // A small sample of descendants can hold component-local query data even when
    // the outer editor surface only renders one selected question.
    try {
      const nodes = [...surfaceRoot.querySelectorAll('*')].slice(0, 900);
      for (let i = 0; i < nodes.length && stateSearchStepV61313(work); i++) {
        const el = nodes[i];
        const fiber = reactFiberForElementV664(el);
        if (!fiber) continue;
        add(fiber.memoizedProps, 'desc[' + i + '].memoizedProps');
        add(fiber.memoizedState, 'desc[' + i + '].memoizedState');
      }
    } catch (e) {}
    return seeds.slice(0, 700);
  }

export function parseOptionStateV664(value, index, work) {
    work=work || stateSearchBudgetV61313();
    if (!stateSearchStepV61313(work)) return null;
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'number') {
      const text = ctiPlainTextV664(value, 900);
      return text ? {id:String(index + 1), text, label:text, description:'', aliases:[], correct:false} : null;
    }
    if (typeof value !== 'object') return null;
    const textHit = findNamedValueV664(value, /^(?:text|label|content|answerText|optionText|displayText|title)$/i, 2, undefined, work);
    let text = textHit ? objectTextV664(textHit.value, 2, undefined, work) : objectTextV664(value, 2, undefined, work);
    text = ctiPlainTextV664(text, 900);
    if (!text || text.length < 1) return null;
    let correct = false;
    const correctHit = findNamedValueV664(value, /^(?:correct|isCorrect|is_correct|correctness|isAnswer|isKey)$/i, 2, undefined, work);
    if (correctHit) {
      const cv = correctHit.value;
      correct = cv === true || cv === 1 || /^(?:true|correct|yes|1)$/i.test(String(cv));
    }
    return {id:String(index + 1), text, label:text, description:'', aliases:[], correct};
  }

export function parseQuestionStateV664(obj, index, work) {
    work=work || stateSearchBudgetV61313();
    if (!stateSearchStepV61313(work)) return null;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (ownStateValueV61313(obj,'$$typeof')) return null; // React UI element, not a question record.
    const questionPromptHit = findNamedValueV664(obj, /^(?:prompt|questionPrompt|questionText|stem|question)$/i, 4, undefined, work);
    const promptHit = questionPromptHit || findNamedValueV664(obj, /^title$/i, 4, undefined, work);
    let prompt = promptHit ? objectTextV664(promptHit.value, 3, undefined, work) : '';
    prompt = ctiPlainTextV664(prompt, 1400);
    if (!prompt || prompt.length < 8) {
      // Fallback only when the object itself strongly looks question-shaped.
      const keys = (() => { try { return Object.keys(obj); } catch (e) { return []; } })();
      if (!keys.some(k => /question|prompt|stem|answer|option|choice/i.test(k))) return null;
      const raw = objectTextV664(obj, 3, undefined, work);
      const m = raw.match(/(?:Prompt|Question)\\s*[:*]?\\s*(.{8,500}?)(?=\\s+(?:Options?|Answers?|Choices?|Correct|Feedback)\\b|$)/i);
      if (m) prompt = ctiPlainTextV664(m[1], 1400);
    }
    if (!prompt || prompt.length < 8 || /^(?:question|prompt|content|untitled)$/i.test(prompt)) return null;
    // v6.6.5: React component children such as "Auto-Graded 0" and
    // confirmation labels such as "Delete Auto-Graded Question?" are editor
    // chrome, not assessment questions. Never promote them to question evidence.
    if (/^(?:Auto|Manual|AI|Peer)[- ]Graded(?:\s+\d+)?$/i.test(prompt) ||
        /^Delete\s+(?:Auto|Manual|AI|Peer)?[- ]?Graded?\s*Question\??$/i.test(prompt) ||
        /^Delete\s+.*Question\??$/i.test(prompt) ||
        /^Text\s+block(?:\s+\d+)?$/i.test(prompt) ||
        /^Delete\s+Text\s+Block\??$/i.test(prompt) ||
        /NaptimeAuthoringAssignmentManualGradedQuestionsV1[_\s.-]*rubrics?/i.test(prompt) ||
        /\brubrics?[_\s.-]*(?:prompt|details|criteria|levels?)\b/i.test(prompt)) return null;

    const typeHit = findNamedValueV664(obj, /^(?:questionType|type|interactionType|answerType|responseType)$/i, 3, undefined, work);
    const rawType = typeHit ? ctiPlainTextV664(objectTextV664(typeHit.value, 1, undefined, work), 180) : '';
    const ownIdentity=[obj.id,obj.type,obj.partType,obj.contentType].filter(v=>typeof v==='string').join(' ');
    if (/(?:^|[^a-z])text[-_ ]?block(?:[^a-z]|$)/i.test(ownIdentity+' '+rawType)) return null;

    let options = [];
    const optionsHit = findNamedValueV664(obj, /^(?:options|choices|answers|answerOptions|responseOptions|possibleAnswers)$/i, 4, undefined, work);
    if (optionsHit && Array.isArray(optionsHit.value)) {
      options = optionsHit.value.slice(0, 40).map((v,i) => parseOptionStateV664(v,i,work)).filter(Boolean);
    }

    let correctAnswers = options.filter(o => o.correct).map(o => o.label || o.text).filter(Boolean);
    if (!correctAnswers.length) {
      const answerHit = findNamedValueV664(obj, /^(?:correctAnswers?|answerKey|correctResponse|correctValue)$/i, 3, undefined, work);
      if (answerHit) {
        const av = answerHit.value;
        const vals = Array.isArray(av) ? av : [av];
        correctAnswers = vals.map(v => ctiPlainTextV664(objectTextV664(v,2, undefined, work) || v, 900)).filter(Boolean).slice(0,20);
      }
    }

    const feedbackHit = findNamedValueV664(obj, /^(?:feedback|explanation|incorrectFeedback|generalFeedback)$/i, 3, undefined, work);
    const feedback = feedbackHit ? ctiPlainTextV664(objectTextV664(feedbackHit.value,2, undefined, work), 1500) : '';
    const pointHit = findNamedValueV664(obj, /^(?:points|pointValue|maxPoints|score|weight)$/i, 2, undefined, work);
    let points = pointHit ? Number(pointHit.value) : null;
    if (!Number.isFinite(points)) points = null;

    let type = assessmentTypeKey(rawType || '');
    if (type === 'unknown') {
      if (options.length === 2 && options.map(o => String(o.label||'').toLowerCase()).sort().join('|') === 'false|true') type = 'true-false';
      else if (options.length > 1 && correctAnswers.length > 1) type = 'multiple-select';
      else if (options.length > 1) type = 'single-select';
    }
    // Assignment text-block titles are content, not questions. A title alone
    // requires a recognized response type, choices, or an observed answer key.
    if (!questionPromptHit && type==='unknown' && !options.length && !correctAnswers.length) return null;
    return {
      id:String(index + 1), type, rawType:rawType || type, prompt, options,
      correctAnswers:[...new Set(correctAnswers)], feedback, points,
      optionTextReliable:options.length > 0,
      answerTextReliable:correctAnswers.length > 0,
      parserConfidence:correctAnswers.length ? 0.90 : (options.length ? 0.84 : 0.78)
    };
  }

export function collectReactAssessmentStateV664(surfaceRoot, fp, declaredHint, options) {
    const out = {attempted:false, arraysScanned:0, candidateArrays:[], questionCount:0, assessment:null};
    if (!surfaceRoot || !isAssessmentLikeFingerprintV662(fp)) return out;
    const started=Date.now(),work=stateSearchBudgetV61313(options);
    const declared = Number(declaredHint || 0);
    const seeds = assessmentStateSeedsV664(surfaceRoot,work);
    if (!seeds.length) return out;
    out.attempted = true;
    const visited = new WeakSet();
    const queue = seeds.map(s => ({value:s.value, path:s.path, depth:0}));
    let nodes = 0, cursor=0;
    const parsedQuestions=new WeakMap();
    let best = null;

    function scoreCandidate(questions, arr, path) {
      // v6.6.11: manual-graded assignment rubric arrays are not learner
      // assessment questions. Worked shells can expose rubric criteria through
      // React state under paths containing "rubric"; rejecting those paths
      // prevents rubric criteria from becoming phantom quiz questions.
      const pathText = String(path || '');
      if (/(?:^|[.\[])rubrics?(?:[.\[]|$)|gradingCriteria|rubricCriteria|rubricParts?/i.test(pathText)) return null;
      const unique = new Map();
      questions.forEach(q => {
        const key = assessmentPromptKey_(q && q.prompt || '');
        if (key && !unique.has(key)) unique.set(key, q);
      });
      const qs = [...unique.values()];
      if (qs.length < 2) return null;
      const countFit = declared > 1 ? Math.max(0, 100 - Math.abs(qs.length - declared) * 24) : Math.min(100, qs.length * 15);
      const answerRich = qs.filter(q => q.answerTextReliable).length;
      const optionRich = qs.filter(q => q.optionTextReliable).length;
      const score = countFit + qs.length * 22 + answerRich * 12 + optionRich * 6 - Math.max(0, arr.length - qs.length) * 2;
      return {score, questions:qs, path, arrayLength:arr.length, answerRich, optionRich};
    }

    while (cursor < queue.length && nodes < 18000 && stateSearchStepV61313(work)) {
      const cur = queue[cursor++];
      const v = cur.value;
      if (!v || typeof v !== 'object' || (typeof Element !== 'undefined' && v instanceof Element)) continue;
      if (visited.has(v)) continue;
      visited.add(v); nodes++;

      if (Array.isArray(v)) {
        out.arraysScanned++;
        if (v.length >= 2 && !/(?:^|[.\[])rubrics?(?:[.\[]|$)|gradingCriteria|rubricCriteria|rubricParts?/i.test(cur.path)) {
          const parsed=[];
          for (let i=0;i<v.length && stateSearchStepV61313(work);i++) {
            const value=v[i];
            if (!value || typeof value!=='object') continue;
            if (!parsedQuestions.has(value)) {
              const parsedQuestion=parseQuestionStateV664(value,i,work);
              if (work.stopReason) break; // Never accept half-parsed answer fields.
              parsedQuestions.set(value,parsedQuestion);
            }
            const question=parsedQuestions.get(value);
            if (question) parsed.push(Object.assign({},question,{id:String(i+1)}));
          }
          const candidate = scoreCandidate(parsed, v, cur.path);
          if (candidate) {
            out.candidateArrays.push({path:cur.path, arrayLength:v.length, parsedQuestions:candidate.questions.length, answerRich:candidate.answerRich, optionRich:candidate.optionRich, score:Math.round(candidate.score), prompts:candidate.questions.slice(0,6).map(q => String(q.prompt||'').slice(0,160))});
            if (!best || candidate.score > best.score) best = candidate;
          }
        }
        if (cur.depth < 7) {
          for (let i = 0; i < Math.min(v.length, 120); i++) {
            const child = v[i];
            if (child && typeof child === 'object') queue.push({value:child, path:cur.path + '[' + i + ']', depth:cur.depth + 1});
          }
        }
        continue;
      }

      if (cur.depth >= 7) continue;
      let keys = [];
      try { keys = Object.keys(v).slice(0,140); } catch (e) { continue; }
      const priority = keys.filter(k => /question|assessment|quiz|item|content|answer|option|choice|atom|model|data/i.test(k));
      const ordered = [...priority, ...keys.filter(k => !priority.includes(k))].slice(0,100);
      for (const k of ordered) {
        if (/^(?:_owner|return|child|sibling|stateNode|alternate|dependencies|elementType|type)$/i.test(k)) continue;
        let child;
        try { child = ownStateValueV61313(v,k); } catch (e) { continue; }
        if (!child || typeof child !== 'object' || (typeof Element !== 'undefined' && child instanceof Element)) continue;
        queue.push({value:child, path:cur.path + '.' + String(k).slice(0,80), depth:cur.depth + 1});
      }
    }

    out.elapsedMs=Date.now()-started;
    out.nodesScanned=work.nodes;
    out.stopReason=work.stopReason || (nodes>=18000?'NODE_BUDGET':'SEARCH_EXHAUSTED');
    out.truncated=Boolean(work.stopReason || nodes>=18000);
    out.candidateArrays = out.candidateArrays.sort((a,b) => b.score - a.score).slice(0,12);
    if (!best) return out;
    let questions = best.questions.slice();
    questions.sort((a,b) => Number(a.id||0) - Number(b.id||0));
    questions = questions.map((q,i) => Object.assign({}, q, {id:String(i+1)}));
    out.questionCount = questions.length;
    const finalDeclared = Math.max(declared, questions.length, out.truncated?best.arrayLength:0);
    out.assessment = {
      schemaVersion:3,
      parser:'coursera-react-assessment-state-v1',
      origin:'coursera-authoring-react-state',
      declaredQuestionCount:finalDeclared,
      questionCount:questions.length,
      answerEvidenceQuestionCount:questions.filter(q => q.answerTextReliable && Array.isArray(q.correctAnswers) && q.correctAnswers.length).length,
      questions,
      parserConfidence:finalDeclared === questions.length ? 0.92 : 0.82,
      warnings:finalDeclared === questions.length ? [] : ['React-state recovery did not observe every declared Coursera question.'],
      stateEvidence:{arraysScanned:out.arraysScanned, selectedPath:best.path, candidateArrays:out.candidateArrays}
    };
    return out;
  }

export function assessmentControlDiagnosticsV664(surfaceRoot) {
    const out = [];
    const seen = new Set();
    const roots = [];
    let cur = surfaceRoot;
    for (let i = 0; cur && i < 6; i++, cur = cur.parentElement) roots.push(cur);
    roots.push(document.body);
    for (const root of roots) {
      let nodes = [];
      try { nodes = [...root.querySelectorAll("button,[role='button'],[role='tab'],a[href],[tabindex],[aria-label],[aria-selected],[aria-controls],[data-testid]")].slice(0,5000); } catch (e) {}
      for (const el of nodes) {
        if (!el || seen.has(el) || !isVisibleElement(el) || isGlobalChromeElement(el) || isDangerousEditorControl(el)) continue;
        seen.add(el);
        const text = String(el.innerText || el.textContent || '').replace(/\\s+/g,' ').trim();
        const attrs = elementAttributeBlob(el);
        const sig = reactSignalsForElement(el);
        const blob = (text + ' ' + attrs + ' ' + (sig.text||'')).toLowerCase();
        if (!/(question|content|graded|choice|answer|assessment|quiz|next|previous|chevron|arrow)/.test(blob)) continue;
        if (/datatrackcomponentedititem/.test(blob)) continue;
        out.push({
          tag:String(el.tagName||'').toLowerCase(), role:String(el.getAttribute && el.getAttribute('role') || ''),
          text:text.slice(0,180), attrs:attrs.slice(0,360), reactText:String(sig.text||'').slice(0,180),
          reactProps:Array.isArray(sig.propKeys) ? sig.propKeys.slice(0,18) : [], hasOnClick:Boolean(sig.hasOnClick)
        });
        if (out.length >= 30) return out;
      }
    }
    return out;
  }

export function assessmentAnswerEvidenceCountV667(model) {
    return (model && Array.isArray(model.questions) ? model.questions : []).map(q=>q?ctiGuardOptionEvidence_(q):q).filter(q=>q && q.answerTextReliable===true && Array.isArray(q.correctAnswers) && q.correctAnswers.length).length;
  }

export function assessmentIsFullyAnswerHydratedV667(model, declaredHint) {
    if (!model || !Array.isArray(model.questions)) return false;
    const declared=Math.max(Number(declaredHint || 0),Number(model.declaredQuestionCount || 0),model.questions.length);
    if (!(declared>0) || model.questions.length!==declared) return false;
    if (model.captureCompleteness && model.captureCompleteness.questionCoverageComplete!==true) return false;
    return model.questions.every(questionEvidenceReadyV6138);
  }

export function assessmentFromCycleMapV667(questionMap, declaredHint, evidence) {
    let questions = [...(questionMap || new Map()).values()];
    questions.sort((a,b) => {
      const ao = Number(a && (a._cycleOrdinal || a.id) || 999);
      const bo = Number(b && (b._cycleOrdinal || b.id) || 999);
      return ao - bo;
    });
    questions = questions.map((q, i) => {
      const out = JSON.parse(JSON.stringify(q));
      delete out._cycleOrdinal;
      out.id = String(q.questionOrdinalObserved ? (q._cycleOrdinal || q.id) : i + 1);
      return out;
    });
    if (!questions.length) return null;
    const declared = Math.max(Number(declaredHint || 0), questions.length);
    const answerEvidence = questions.filter(q => q && q.answerTextReliable !== false &&
      Array.isArray(q.correctAnswers) && q.correctAnswers.length).length;
    const countAgreement = declared === questions.length;
    return {
      schemaVersion:5,
      parser:'coursera-editor-question-cycle-v5',
      captureCompleteness:questions.some(q=>q.questionOrdinalObserved || q.courseraQuestionId) ? assessmentCaptureCoverageV613(questions,declared,'CYCLE_FALLBACK',evidence && evidence.contentPartCoverage) : null,
      origin:'coursera-authoring-editor',
      declaredQuestionCount:declared,
      questionCount:questions.length,
      answerEvidenceQuestionCount:answerEvidence,
      questions,
      parserConfidence:countAgreement ? (answerEvidence >= declared && declared > 1 ? 0.98 : 0.95) : 0.84,
      warnings:countAgreement ? [] : ['Question-cycle/React-state capture did not observe every declared Coursera question.'],
      cycleEvidence:evidence || {}
    };
  }

export function collectAssessmentSelectionPolicyFromText_(rawText, questionCountHint) {
    const text=String(rawText || '').replace(/\s+/g,' ').trim();
    if (!text) return {observed:false};
    let m=text.match(/Question Pool\s*(?:[•·-]\s*)?Selecting\s+(\d+)\s+questions?\s+from\s+(\d+)/i);
    if (!m) m=text.match(/Selecting\s+(\d+)\s+questions?\s+from\s+(\d+)/i);
    if (m) return {observed:true, selectCount:Number(m[1]), poolSize:Number(m[2]), randomSelection:Number(m[1]) < Number(m[2]), source:'VISIBLE_AUTHORING_TEXT'};
    if (/\bQuestion Pool\b/i.test(text)) return {observed:true, selectCount:null, poolSize:Number(questionCountHint || 0) || null, randomSelection:null, source:'VISIBLE_AUTHORING_TEXT', warning:'Question-pool UI observed but selection count was not captured.'};
    return {observed:false};
  }

export function collectCourseraStructuredAssessment(root, fp) {
    if (!root || !fp) return null;
    const type = String(fp.type || fp.typeName || "").toLowerCase();
    if (!/(assignment|assessment|quiz|exam)/.test(type)) return null;

    const rootText = String(root.innerText || root.textContent || "").replace(/\s+/g, " ").trim();
    // A typed assignment part is the identity boundary. Parsing its ancestors
    // as separate cards duplicated published questions with different UI tails.
    const parts=[...(root.querySelectorAll('[data-testid^="assignment-part-"]') || [])];
    if(/^assignment-part-\d+$/.test(root.getAttribute && root.getAttribute('data-testid') || ''))parts.unshift(root);
    if(parts.length) {
      const byIdentity=new Map(),excluded=new Set();
      for(const part of parts) {
        if(!isVisibleElement(part))continue;
        const match=String(part.getAttribute('data-testid') || '').match(/^assignment-part-(\d+)$/);
        if(!match)continue;
        const ordinal=Number(match[1])+1;
        if(isAssignmentTextBlockV61321(part)){excluded.add(ordinal);continue;}
        const q=parseAssignmentPartDomV665(part,fp,ordinal,'');
        if(!q || !q.prompt)continue;
        q.id=String(ordinal);q.questionOrdinalObserved=true;
        if(part.id)q.courseraQuestionId=part.id;
        const key=q.courseraQuestionId || 'ordinal:'+ordinal,previous=byIdentity.get(key);
        if(!previous || (questionEvidenceReadyV6138(q) && !questionEvidenceReadyV6138(previous)))byIdentity.set(key,q);
      }
      const questions=[...byIdentity.values()].sort((a,b)=>Number(a.id)-Number(b.id));
      if(!questions.length)return null;
      const partCount=assessmentPartCountV8(root),declared=partCount>0?assessmentDeclaredCountV662(root):questions.length;
      const coverage=assessmentCaptureCoverageV613(questions,declared,'OBSERVED_ASSIGNMENT_PARTS',
        {declaredContentParts:partCount || questions.length,nonQuestionPartOrdinals:[...excluded]});
      return {schemaVersion:6,parser:'coursera-assignment-parts-v3',origin:'coursera-authoring-dom',
        declaredQuestionCount:declared,questionCount:questions.length,answerEvidenceQuestionCount:coverage.answerEvidence,
        questions,captureCompleteness:coverage,selectionPolicy:collectAssessmentSelectionPolicyFromText_(rootText,declared),
        parserConfidence:coverage.requiredAnswerCoverageComplete?0.98:0.84,
        warnings:coverage.questionCoverageComplete?[]:['Only mounted assignment parts were observed; outline traversal must resolve remaining questions.']};
    }
    if (!/\bQuestion Type\b/i.test(rootText) || !/\bPrompt\b/i.test(rootText)) return null;
    const structurallyDeclared = assessmentDeclaredCountV662(root);
    const declared = structurallyDeclared > 0 ? structurallyDeclared : null;

    const rawCandidates = [];
    try {
      const nodes = [root, ...root.querySelectorAll("article,section,li,fieldset,form,div,[role='group'],[role='region']")];
      nodes.slice(0, 8000).forEach((el, order) => {
        if (!el || !isVisibleElement(el) || isGlobalChromeElement(el)) return;
        if(isAssignmentTextBlockV61321(el.closest('[data-testid^="assignment-part-"]')))return;
        const text = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length < 70 || text.length > 6500) return;
        const typeHits = (text.match(/\bQuestion Type\b/gi) || []).length;
        const promptHits = (text.match(/\bPrompt\b/gi) || []).length;
        if (typeHits !== 1 || promptHits !== 1) return;
        let score = 0;
        if (/\bAuto-Graded\b/i.test(text)) score += 20;
        if (/\b\d+(?:\.\d+)?\s*points?\b/i.test(text)) score += 10;
        if (/\bOptions\b/i.test(text)) score += 16;
        if (/\bCorrect Answers?\b/i.test(text)) score += 14;
        if (/\bIncorrect Answers?:\s*Explanation\b/i.test(text)) score += 8;
        const badges = exactAssessmentBadgeElements(el);
        score += Math.min(24, badges.length * 4);
        if (text.length >= 150 && text.length <= 4500) score += 8;
        rawCandidates.push({el, text, score, order, badges});
      });
    } catch (e) {}
    if (!rawCandidates.length) return null;

    // Extract a prompt from each candidate first, then de-duplicate nested wrappers
    // by normalized prompt. Highest-evidence card wins; shorter wins a tie.
    const byPrompt = new Map();
    rawCandidates.forEach(c => {
      const tm = c.text.match(/\bQuestion Type\s+(.+?)\s+Prompt\s+(.+?)(?=\s+(?:Options|Correct Answers?|Incorrect Answers?:\s*Explanation)\b|$)/i);
      if (!tm) return;
      c.rawType = String(tm[1] || "").trim();
      c.prompt = String(tm[2] || "").replace(/\s+/g, " ").trim();
      if (c.prompt.length < 8) return;
      const key = c.prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 500);
      const prev = byPrompt.get(key);
      if (!prev || c.score > prev.score || (c.score === prev.score && c.text.length < prev.text.length)) byPrompt.set(key, c);
    });
    let cards = [...byPrompt.values()];
    if (!cards.length) return null;
    cards.sort((a,b) => a.order - b.order);

    const questions = cards.slice(0, 200).map((c, idx) => {
      const typeKeyRaw = assessmentTypeKey(c.rawType);
      const allBadges = exactAssessmentBadgeElements(c.el);
      const rows = [];
      const seenRows = new Set();
      allBadges.forEach(badge => {
        const row = optionRowForBadge(badge, c.el, allBadges);
        if (!row || seenRows.has(row)) return;
        seenRows.add(row);
        const parts = optionSemanticPartsFromRow(row);
        const rowText = parts.text || textWithoutExactBadges(row);
        if (!rowText || rowText.length > 1200) return;
        const status = String(badge.innerText || badge.textContent || "").trim();
        rows.push({id:String(rows.length + 1), text:rowText, label:parts.label || rowText, description:parts.description || "", aliases:parts.aliases || [], optionFeedback:parts.optionFeedback || undefined, optionFieldIssue:parts.feedbackOnly?'FEEDBACK_ONLY_OPTION_FIELD':parts.optionFieldIssue, optionDomEvidence:parts.optionDomEvidence, correct:status === "Correct"});
      });

      let typeKey = typeKeyRaw;
      const observedCorrectCount=rows.filter(o=>o.correct===true).length;
      if(rows.length>=2 && observedCorrectCount>0 && (typeKey==="essay" || typeKey==="unknown")){
        typeKey=observedCorrectCount>1 ? "multiple-select" : "single-select";
      }
      if (typeKey === "single-select" && rows.length === 2) {
        const pair = rows.map(o => String(o.text || "").toLowerCase()).sort().join("|");
        if (pair === "false|true") typeKey = "true-false";
      }

      let correctAnswers = rows.filter(o => o.correct).map(o => o.label || o.text);
      // Text-entry/regex questions do not always render answer values as option rows.
      if (!correctAnswers.length && /^(regex|text-entry)$/.test(typeKey)) {
        const ca = c.text.match(/\bCorrect Answers?\s+(.+?)(?=\s+Correct\b|\s+Incorrect Answers?:|$)/i);
        if (ca && ca[1]) correctAnswers = [String(ca[1]).replace(/\s+/g, " ").trim()];
      }
      let feedback = "";
      const fb = c.text.match(/\bIncorrect Answers?:\s*Explanation\s+(.+)$/i);
      if (fb && fb[1]) feedback = String(fb[1]).replace(/\s+/g, " ").trim();
      let points = null;
      const pm = c.text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*points?\b/i);
      if (pm && Number.isFinite(Number(pm[1]))) points = Number(pm[1]);

      // Badge rows make answer status reliable. If an authoring redesign hides the
      // exact badges, retain prompt/type/points but do not invent answer evidence.
      const optionTextReliable = rows.length > 0 && rows.every(o => o.text.length <= 900);
      const answerTextReliable = correctAnswers.length > 0 && (optionTextReliable || /^(regex|text-entry)$/.test(typeKey));
      return {
        id:String(idx + 1),
        type:typeKey,
        rawType:c.rawType,
        prompt:c.prompt,
        options:rows,
        correctAnswers:[...new Set(correctAnswers.filter(Boolean))],
        feedback,
        points,
        optionTextReliable,
        answerTextReliable,
        parserConfidence: answerTextReliable ? 0.97 : 0.88
      };
    }).filter(q => q.prompt).map(ctiGuardOptionEvidence_);

    if (!questions.length) return null;
    const countAgreement = declared == null || declared === questions.length;
    const answerEvidenceCount = questions.filter(q => q.correctAnswers && q.correctAnswers.length && q.answerTextReliable !== false).length;
    const selectionPolicy = collectAssessmentSelectionPolicyFromText_(rootText, questions.length);
    const domAssessment = {
      schemaVersion:1,
      parser:"coursera-editor-dom-v2",
      origin:"coursera-authoring-editor",
      declaredQuestionCount:declared || questions.length,
      questionCount:questions.length,
      answerEvidenceQuestionCount:answerEvidenceCount,
      selectionPolicy,
      questions,
      parserConfidence:countAgreement ? 0.97 : 0.82,
      warnings:countAgreement ? [] : ["Declared content count does not equal DOM-parsed question count."]
    };
    const textFallback = parseCourseraAssessmentTextFallback(String(root.innerText || root.textContent || ""));
    return mergeCourseraAssessmentEvidence(domAssessment, textFallback);
  }
