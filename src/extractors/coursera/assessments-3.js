import { assessmentPromptKey_, inferSelectedQuestionTypeV662, isAssessmentLikeFingerprintV662, mergeQuestionIntoCycleV662, parseSelectedAssessmentQuestionV662, questionEvidenceReadyV6138 } from "./assessments-2.js";
import { assessmentCaptureCoverageV613 } from "./assessments-4.js";
import { assessmentTypeKey, exactAssessmentBadgeElements, isAssignmentTextBlockV61321, optionRowForBadge, optionSemanticPartsFromRow, recoverCollapsedBadgeOptions } from "./assessments.js";
import { hasVisibleLoadingIndicator, parseUnmarkedChoicesV61318, sleepMs } from "./text-and-dom-2.js";
import { feedbackCoreV6611, isVisibleElement, parseWrittenResponsePartV6136, scopedWaitBudgetV61321, textWithoutExactBadges } from "./text-and-dom-3.js";
import { isDangerousEditorControl } from "./text-and-dom-4.js";

export function mergeAssessmentModelIntoCycleV662(map, model) {
    if (!model || !Array.isArray(model.questions)) return;
    model.questions.forEach((q, i) => mergeQuestionIntoCycleV662(map, q, Number(q.id || i + 1)));
  }

export function safeClickAssessmentQuestionV662(el) {
    if (!el || !isVisibleElement(el) || isDangerousEditorControl(el)) return false;
    try {
      if (typeof el.click === "function") { el.click(); return true; }
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent("click", {bubbles:true, cancelable:true, view:window}));
      return true;
    } catch (e) {}
    return false;
  }

export function cleanAssignmentOptionFieldV6610(value) {
    let t = String(value || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    t = t.replace(/\s+(?:Add Variant|Add Answer Variant|Add Option|Add Answer|Remove Option|Delete Option)\s*$/i, '').trim();
    return t;
  }

export function cleanAssignmentOptionAliasesV6610(aliases, label) {
    const canonical = cleanAssignmentOptionFieldV6610(label);
    const out = [];
    (Array.isArray(aliases) ? aliases : []).forEach(a => {
      let t = cleanAssignmentOptionFieldV6610(a);
      if (!t) return;
      if (canonical) {
        const doubled = canonical + ' ' + canonical;
        if (t.toLowerCase().startsWith(doubled.toLowerCase())) {
          t = (canonical + t.slice(doubled.length)).replace(/\s+/g, ' ').trim();
        }
        if (t.toLowerCase() === canonical.toLowerCase()) return;
      }
      if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
    });
    return out;
  }

export function ctiSeparateJoinedOptionFeedback_(rows, sourceRows) {
      // Recover only an entire, consistently decorated choice set. Status markers
      // must already be observed independently; this never assigns correctness.
      if (!Array.isArray(rows) || rows.length < 2) return null;
      var seenCorrect=false, seenIncorrect=false, changes=[], cleaned=[];
      for (var i=0;i<rows.length;i++) {
          var o=rows[i] || {}, raw=String(o.label || o.text || '').trim();
          if (typeof o.correct !== 'boolean' || o.description || String(o.text || raw).trim()!==raw) return null;
          var suffix=o.correct ? 'Correct.' : 'Incorrect.';
          if (raw.slice(-suffix.length)!==suffix) return null;
          var label=raw.slice(0,-suffix.length);
          // Joined terminal feedback only. Do not strip ordinary sentences or
          // whitespace-delimited uses of the words Correct and Incorrect.
          if (!label || /\s$/.test(label)) return null;
          if ((o.aliases || []).some(function(a){return a!==raw && a!==label;})) return null;
          seenCorrect=seenCorrect || o.correct; seenIncorrect=seenIncorrect || !o.correct;
          changes.push({rawText:raw,normalizedText:label,feedbackText:suffix,correct:o.correct});
          var x=Object.assign({},o);x.label=label;x.text=label;
          x.aliases=(o.aliases || []).filter(function(a){return a!==raw;});
          x.optionFeedback={rawText:raw,normalizedText:label,feedbackText:suffix,method:'CONSISTENT_JOINED_FEEDBACK'};
          cleaned.push(x);
      }
      if (!seenCorrect || !seenIncorrect) return null;
      var labels=cleaned.map(function(o){return o.label;});
      if (new Set(labels).size!==labels.length) return null;
      var basis;
      if (Array.isArray(sourceRows)) {
          // Existing JSON is corrected only with a one-to-one, exact option-text
          // match to the source. Source correctness is never used in this proof.
          if (sourceRows.length!==rows.length || sourceRows.some(function(o){return o.description;})) return null;
          var expected=sourceRows.map(function(o){return String(o.label || o.text || '').trim();});
          if (new Set(expected).size!==expected.length || labels.some(function(s){return expected.indexOf(s)<0;})) return null;
          basis='EXACT_SOURCE_OPTION_SET_AND_OBSERVED_STATUS';
      } else {
          // Without a source, allow only symbolic choices whose components also
          // exist as standalone options (A, B, C, A and B, A, B, or C, etc.).
          // General prose requires actual DOM field boundaries instead.
          var symbols=labels.filter(function(s){return /^[A-Z]$/.test(s);});
          if (symbols.length<2 || labels.some(function(s){
              if (!/^[A-Z](?:(?:\s*,\s*(?:(?:and|or)\s+)?)|(?:\s+(?:and|or)\s+))[A-Z]/.test(s) && !/^[A-Z]$/.test(s)) return true;
              var rest=s.replace(/\b(?:and|or)\b/g,'').replace(/[,\s]/g,'');
              return !/^[A-Z]+$/.test(rest) || rest.split('').some(function(v){return symbols.indexOf(v)<0;});
          })) return null;
          basis='SYMBOLIC_OPTION_SET_AND_OBSERVED_STATUS';
      }
      return {rows:cleaned,changes:changes,basis:basis};
  }

export function ctiOptionLabelLooksLikeFeedback_(text) {
      return /^(?:Correct|Incorrect)(?:[.!]\s+\S|\s+(?:according\s+to\s+(?:this|the)\s+(?:item|question)|in\s+this\s+context|because)\b)/i.test(String(text||'').trim());
  }

export function ctiOptionFeedbackRisk_(rows) {
      rows=Array.isArray(rows)?rows:[];
      if(rows.some(function(o){return o.optionFieldIssue==='FEEDBACK_ONLY_OPTION_FIELD';}))return 'FEEDBACK_ONLY_OPTION_FIELD';
      if(rows.some(function(o){return o.optionFieldIssue==='ANSWER_AND_FEEDBACK_BOUNDARY_UNRESOLVED';}))return 'ANSWER_AND_FEEDBACK_BOUNDARY_UNRESOLVED';
      if(rows.length<2)return '';
      var labels=rows.map(function(o){return String(o.label||o.text||'').trim();});
      // Older flattened captures could split abbreviations into neighbouring
      // descriptions and carry an editor button into the final description.
      // Retain those bytes, but neither verify them nor report a course change.
      if(rows.length>=3 && /^(?:Add Variant|Add Answer Variant|Add Option|Add Answer)$/.test(String(rows[rows.length-1].description||'').trim()) &&
          rows.every(function(o){return typeof o.correct==='boolean';}) &&
          new Set(labels).size<labels.length && rows.slice(0,-1).every(function(o){return !!String(o.description||'').trim();}))return 'OPTION_ROW_BOUNDARY_UNRESOLVED';
      // Repeated state badges cannot identify distinct choices. Preserve the
      // legitimate two-choice Correct/Incorrect case; never invent lost labels.
      if (rows.length>2 && new Set(labels.map(function(s){return s.toLowerCase();})).size<rows.length &&
          rows.every(function(o,i){return typeof o.correct==='boolean' && new RegExp('^'+(o.correct?'Correct':'Incorrect')+'[.!]?$','i').test(labels[i]);})) return 'FEEDBACK_TEXT_USED_AS_OPTION';
      var stateDescriptions=rows.every(function(o){return typeof o.correct==='boolean' && new RegExp('^'+(o.correct?'Correct':'Incorrect')+'[.!](?:\\s|$)').test(String(o.description||''));});
      if(stateDescriptions && /^[A-Za-z][A-Za-z0-9+\-]{0,15}$/.test(labels[0]) && labels.slice(1).some(function(s){return /[.!?]\s+[A-Za-z][A-Za-z0-9+\-]{0,15}$/.test(s);}))return 'FEEDBACK_SPILLS_BETWEEN_OPTION_ROWS';
      var joined=labels.filter(function(s){return /^([A-Za-z][A-Za-z0-9+\-]{0,15})\1\s+\S/.test(s) || /[a-z0-9)](?:Correct|Incorrect)(?:[.!]\s+\S|\s+(?:according|because|answer|response|option|choice)\b)/.test(s);});
      if(joined.length>=2)return 'ANSWER_AND_FEEDBACK_BOUNDARY_UNRESOLVED';
      if(rows.some(function(o){return typeof o.correct==='boolean' && ctiOptionLabelLooksLikeFeedback_(o.label||o.text);}))return 'FEEDBACK_TEXT_USED_AS_OPTION';
      return '';
  }

export function ctiGuardOptionEvidence_(q) {
      var issue=String(q.optionCaptureIssue||'') || ctiOptionFeedbackRisk_(q.options);
      if(!issue)return q;
      // Keep the raw text and selected states. Never reconstruct an answer from
      // source choices or feedback prose when the captured field boundary is lost.
      return Object.assign({},q,{optionCaptureIssue:issue,optionTextReliable:false,answerTextReliable:false});
  }

export function ctiGuardAssessmentOptionEvidence_(model) {
    if(!model || !Array.isArray(model.questions))return model;
    const questions=model.questions.map(q=>q?ctiGuardOptionEvidence_(q):q);
    const answers=questions.filter(q=>q && q.answerTextReliable===true && Array.isArray(q.correctAnswers) && q.correctAnswers.length).length;
    const out=Object.assign({},model,{questions,answerEvidenceQuestionCount:answers});
    if(model.captureCompleteness){
      out.captureCompleteness=Object.assign({},model.captureCompleteness,{answerEvidence:answers,
        answerCoverageComplete:model.captureCompleteness.questionCoverageComplete===true && answers===Number(model.captureCompleteness.declared||model.declaredQuestionCount||questions.length),
        unansweredQuestionOrdinals:questions.filter(q=>q && !(q.answerTextReliable===true && Array.isArray(q.correctAnswers) && q.correctAnswers.length)).map(q=>Number(q.id))});
      const actual=assessmentCaptureCoverageV613(questions,Number(model.captureCompleteness.declared || model.declaredQuestionCount || questions.length),model.captureCompleteness.stopReason,model.captureCompleteness);
      out.captureCompleteness.requiredAnswerCoverageComplete=actual.requiredAnswerCoverageComplete;
      out.captureCompleteness.answerKeyNotApplicableQuestionOrdinals=actual.answerKeyNotApplicableQuestionOrdinals;
      out.captureCompleteness.missingRequiredAnswerOrdinals=actual.missingRequiredAnswerOrdinals;
    }
    return out;
  }

export function normalizeAssignmentOptionRowsV6610(rows) {
    const normalized = (Array.isArray(rows) ? rows : []).map((o, idx) => {
      const x = Object.assign({}, o || {});
      x.id = String(idx + 1);
      x.label = cleanAssignmentOptionFieldV6610(x.label || x.text || '');
      x.description = cleanAssignmentOptionFieldV6610(x.description || '');
      x.text = cleanAssignmentOptionFieldV6610([x.label, x.description].filter(Boolean).join(' '));
      x.aliases = cleanAssignmentOptionAliasesV6610(x.aliases, x.label);
      return x;
    }).filter(o => o.label || o.text);
    const separated=ctiSeparateJoinedOptionFeedback_(normalized);
    return separated ? separated.rows : normalized;
  }

export function assignmentEntryTypeFromDomV6611(part, flatText) {
    let blob = String(flatText || '');
    try {
      const nodes = [...part.querySelectorAll('input,textarea,select,option,label,button,[role="combobox"],[role="textbox"],[data-testid]')].slice(0,500);
      for (const el of nodes) {
        blob += ' ' + [
          el.getAttribute && el.getAttribute('data-testid'),
          el.getAttribute && el.getAttribute('aria-label'),
          el.getAttribute && el.getAttribute('name'),
          el.getAttribute && el.getAttribute('placeholder'),
          el.getAttribute && el.getAttribute('type'),
          el.getAttribute && el.getAttribute('role'),
          el.getAttribute && el.getAttribute('class'),
          el.value,
          el.innerText,
          el.textContent
        ].filter(Boolean).join(' ');
      }
    } catch (e) {}
    const low = blob.toLowerCase();
    if (/regular[\s_-]*expression|\bregex\b/.test(low)) return 'regex';
    if (/text[\s_-]*entry|short[\s_-]*answer|fill[\s_-]*in|accepted[\s_-]*answer|answer[\s_-]*pattern/.test(low)) return 'text-entry';
    return '';
  }

export function dropFeedbackPseudoOptionsV6611(rows, feedback) {
    const core = feedbackCoreV6611(feedback).toLowerCase();
    if (!core || core.length < 24) return normalizeAssignmentOptionRowsV6610(rows);
    const cleaned = (Array.isArray(rows) ? rows : []).filter(o => {
      if (!o || o.correct) return true;
      const label = cleanAssignmentOptionFieldV6610(o.label || o.text || '').toLowerCase();
      const text = cleanAssignmentOptionFieldV6610(o.text || '').toLowerCase();
      return !(label === core || text === core);
    });
    return normalizeAssignmentOptionRowsV6610(cleaned);
  }

export function parseAssignmentPartDomV665(part, fp, ordinal, navLabel) {
    if (!part || !isAssessmentLikeFingerprintV662(fp)) return null;
    if(isAssignmentTextBlockV61321(part))return null;
    const written = parseWrittenResponsePartV6136(part, ordinal);
    if (written) return written;
    const unmarked=parseUnmarkedChoicesV61318(part,fp,ordinal);
    if(unmarked)return unmarked;

    // v6.6.11: keep both parsers as independent candidates. The tolerant parser
    // is sometimes superior for Coursera's decorated multi-select rows, while
    // the bounded assignment-part parser is superior for ordinary Q1-Q3 panels.
    let shallow = null;
    try { shallow = parseSelectedAssessmentQuestionV662(part, fp, ordinal, navLabel); } catch (e) {}

    const rawText = String(part.innerText || part.textContent || '');
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text || !/\bPrompt\b/i.test(text)) return shallow && shallow.prompt ? shallow : null;

    const pm = text.match(/\bPrompt\s*\*?\s*(.+?)(?=\s+Options\s*\*?|\s+Correct Answers?\b|\s+Incorrect Answers?\b|\s+Explanation\b|\s+Export Settings\b|$)/i);
    const prompt = pm && pm[1] ? String(pm[1]).replace(/\s+/g, ' ').trim() : '';
    if (!prompt || prompt.length < 8) return shallow && shallow.prompt ? shallow : null;

    // v6.6.11: "Options" is the structural boundary that proves the panel is
    // choice-based. A Correct Answers section without Options is an accepted-
    // answer editor, not a one-option multiple-choice question.
    const hasOptionsSection = /\bOptions\s*\*?/i.test(text);
    const hasCorrectAnswersSection = /\bCorrect Answers?\b/i.test(text);
    const entryDomType = assignmentEntryTypeFromDomV6611(part, text);

    let rows = [];
    try {
      const optionEls = [...part.querySelectorAll('[data-testid="option"],.rc-assignmentauthoringoptionseditor__option')].slice(0,80);
      const seen = new Set();
      const partBadges=exactAssessmentBadgeElements(part);
      optionEls.forEach(el => {
        const ownBadges=partBadges.filter(b=>el.contains(b));
        if(ownBadges.length===1)el=optionRowForBadge(ownBadges[0],part,partBadges)||el;
        if (!el || seen.has(el)) return;
        seen.add(el);
        let t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 1600) return;

        // v6.6.11: a real Coursera answer row must expose an explicit
        // Correct/Incorrect state. In v6.6.9 a feedback/explanation container
        // sharing the option class was incorrectly promoted as an answer.
        let explicitStatus = '';
        try {
          const badges = exactAssessmentBadgeElements(el);
          for (const b of badges) {
            const bt = String(b && (b.innerText || b.textContent) || '').replace(/\s+/g, ' ').trim();
            if (/^(?:Correct|Incorrect)$/i.test(bt)) { explicitStatus = bt; break; }
          }
        } catch (e) {}
        const tail = t.match(/\s+(Correct|Incorrect)\s*$/i);
        if (!explicitStatus && tail && tail[1]) explicitStatus = tail[1];
        if (!/^(?:Correct|Incorrect)$/i.test(explicitStatus)) return;

        const correct = /^Correct$/i.test(explicitStatus);
        t = t.replace(/\s+(?:Incorrect|Correct)\s*$/i, '').trim();
        if (!t) return;
        const parts = optionSemanticPartsFromRow(el);
        rows.push({
          id:String(rows.length + 1),
          text:parts.text || t,
          label:parts.label || parts.text || t,
          description:parts.description || '',
          aliases:parts.aliases || [], optionFeedback:parts.optionFeedback || undefined, optionFieldIssue:parts.feedbackOnly?'FEEDBACK_ONLY_OPTION_FIELD':parts.optionFieldIssue, optionDomEvidence:parts.optionDomEvidence,
          correct
        });
      });
    } catch (e) {}

    if (!rows.length) {
      try {
        const badges = exactAssessmentBadgeElements(part);
        const seenRows = new Set();
        badges.forEach(badge => {
          const row = optionRowForBadge(badge, part, badges);
          if (!row || seenRows.has(row)) return;
          seenRows.add(row);
          const parts = optionSemanticPartsFromRow(row);
          const rowText = parts.text || textWithoutExactBadges(row);
          if (!rowText || rowText.length > 1600) return;
          const status = String(badge.innerText || badge.textContent || '').trim();
          rows.push({id:String(rows.length+1), text:rowText, label:parts.label || rowText, description:parts.description || '', aliases:parts.aliases || [], optionFeedback:parts.optionFeedback || undefined, optionFieldIssue:parts.feedbackOnly?'FEEDBACK_ONLY_OPTION_FIELD':parts.optionFieldIssue, optionDomEvidence:parts.optionDomEvidence, correct:/^Correct$/i.test(status)});
        });
      } catch (e) {}
    }

    let rawType = '';
    const typeText = text.match(/\bQuestion\s*Type\s+(.+?)(?=\s+Prompt\b)/i);
    if (typeText && typeText[1]) rawType = String(typeText[1]).trim();
    let type = inferSelectedQuestionTypeV662(rawType, rows, text, navLabel);

    // Coursera's multi-select authoring UI can place the short option label in a
    // sibling node while [data-testid=option] contains only its explanatory
    // description. Keep collapsed-badge recovery for absent or explicitly
    // contaminated row evidence only; punctuation is not a DOM boundary.
    try {
      const om = hasOptionsSection ? text.match(/\bOptions\s*\*?\s*(.+?)(?=\s+Incorrect Answers?:\s*Explanation\b|\s+Export Settings\b|$)/i) : null;
      const recovered = om && om[1] ? recoverCollapsedBadgeOptions(String(om[1])) : null;
      if (recovered && recovered.length && (!rows.length || recovered.length === rows.length)) {
        const semanticScore = rs => (ctiOptionFeedbackRisk_(rs)?-1000:0) + (Array.isArray(rs) ? rs : []).reduce((score, o) => {
          const label = String(o && (o.label || o.text) || '').replace(/\s+/g,' ').trim();
          const desc = String(o && o.description || '').replace(/\s+/g,' ').trim();
          if (!label) return score - 100;
          score += 20;
          if (label.length <= 90) score += 16;
          else if (label.length > 180) score -= 12;
          if (desc) score += 12;
          if (/^(?:Learners?\b|Points?\s+are\b|The\s+number\s+of\b|Correct\s+points\b)/i.test(label)) score -= 24;
          if (typeof o.correct === 'boolean') score += 5;
          return score;
        }, 0);
        // Punctuation and short labels cannot overrule observed DOM row
        // boundaries. In particular, units and compass abbreviations contain
        // periods without introducing another option's description.
        if (!rows.length || (ctiOptionFeedbackRisk_(rows) && !ctiOptionFeedbackRisk_(recovered) && semanticScore(recovered) > semanticScore(rows) + 8)) rows = recovered;
      }
    } catch (e) {}

    rows = normalizeAssignmentOptionRowsV6610(rows);

    // v6.6.11: feedback is a separate semantic field. Coursera can render the
    // incorrect explanation with the same option-row class/badge family used by
    // answers, so remove an exact non-correct duplicate before type inference.
    let feedback = '';
    const fm = text.match(/\bIncorrect Answers?:\s*Explanation\s+(.+?)(?=\s+Export Settings\b|$)/i);
    if (fm && fm[1]) feedback = cleanAssignmentOptionFieldV6610(String(fm[1]));
    rows = dropFeedbackPseudoOptionsV6611(rows, feedback);

    // Capture accepted-answer evidence before potentially discarding option-like
    // DOM wrappers. For a panel with Correct Answers but no Options section, the
    // wrappers are answer-editor rows, not learner choices.
    let correctAnswers = rows.filter(o => o.correct).map(o => o.label || o.text).filter(Boolean);
    const entryBoundary = !hasOptionsSection && hasCorrectAnswersSection;
    if (entryBoundary) {
      if (!correctAnswers.length) {
        const ca = text.match(/\bCorrect Answers?\s+(.+?)(?=\s+Correct\b|\s+Incorrect Answers?:|\s+Explanation\b|\s+Export Settings\b|$)/i);
        if (ca && ca[1]) correctAnswers = [String(ca[1]).replace(/\s+/g, ' ').trim()].filter(Boolean);
      }
      rows = [];
      type = entryDomType || assessmentTypeKey(rawType) || 'text-entry';
      if (type === 'unknown' || type === 'single-select' || type === 'multiple-select') type = entryDomType || 'text-entry';
      if (!rawType || assessmentTypeKey(rawType) === 'unknown' || /select|choice/i.test(rawType)) rawType = type;
    } else {
      type = inferSelectedQuestionTypeV662(rawType, rows, text, navLabel);
    }

    // Text-entry/regex items have no option rows. Coursera exposes the answer in
    // the same question panel, commonly under "Correct Answers". Preserve it only
    // when it is explicitly visible; never infer an answer from the source.
    if (!correctAnswers.length && !rows.length) {
      const ca = text.match(/\bCorrect Answers?\s+(.+?)(?=\s+Correct\b|\s+Incorrect Answers?:|\s+Explanation\b|\s+Export Settings\b|$)/i);
      if (ca && ca[1]) correctAnswers = [String(ca[1]).replace(/\s+/g, ' ').trim()].filter(Boolean);
      if (entryDomType === 'regex' || /regular expression|regex/i.test(text)) type = 'regex';
      else if (correctAnswers.length && (type === 'unknown' || !type)) type = 'text-entry';
    }

    let points = null;
    const pt = text.slice(0,700).match(/\b([0-9]+(?:\.[0-9]+)?)\s*points?\b/i);
    if (pt && Number.isFinite(Number(pt[1]))) points = Number(pt[1]);

    const optionTextReliable = rows.length > 0 && rows.every(o => String(o.label || o.text || '').length <= 320 && String(o.text || '').length <= 1600);
    const answerTextReliable = correctAnswers.length > 0 && (optionTextReliable || /^(?:regex|text-entry)$/.test(type));
    const bounded = {
      id:String(ordinal || 1), type, rawType:rawType || type, prompt, options:rows,
      correctAnswers:[...new Set(correctAnswers)], feedback, points,
      optionTextReliable, answerTextReliable,
      parserConfidence:answerTextReliable ? 0.97 : (optionTextReliable ? 0.90 : 0.86),
      _cycleOrdinal:Number(ordinal || 0)
    };

    if (entryBoundary) return ctiGuardOptionEvidence_(bounded);
    if (!shallow || !shallow.prompt || assessmentPromptKey_(shallow.prompt) !== assessmentPromptKey_(bounded.prompt)) return ctiGuardOptionEvidence_(bounded);

    const semanticQScore = q => {
      if (!q || !q.prompt) return -10000;
      const opts = Array.isArray(q.options) ? q.options : [];
      let score = (ctiOptionFeedbackRisk_(opts) ? -1000 : 0) + opts.length * 24 + (Array.isArray(q.correctAnswers) ? q.correctAnswers.length : 0) * 45;
      if (q.answerTextReliable) score += 70;
      if (q.optionTextReliable) score += 30;
      if (q.points != null) score += 10;
      score += Math.round(Number(q.parserConfidence || 0) * 20);
      opts.forEach(o => {
        const label = String(o && (o.label || o.text) || '').replace(/\s+/g,' ').trim();
        const desc = String(o && o.description || '').replace(/\s+/g,' ').trim();
        if (label && label.length <= 90) score += 5;
        if (desc) score += 4;
        if (/^(?:Learners?\b|Points?\s+are\b|The\s+number\s+of\b)/i.test(label)) score -= 8;
      });
      return score;
    };

    const shallowWon = semanticQScore(shallow) > semanticQScore(bounded);
    let primary = JSON.parse(JSON.stringify(shallowWon ? shallow : bounded));
    const other = shallowWon ? bounded : shallow;
    primary._cycleOrdinal = Number(ordinal || primary._cycleOrdinal || primary.id || 0);
    if ((!primary.options || !primary.options.length) && Array.isArray(other.options) && other.options.length && other.optionTextReliable !== false) {
      primary.options = other.options;
      primary.optionTextReliable = true;
    }
    if ((!primary.correctAnswers || !primary.correctAnswers.length) && Array.isArray(other.correctAnswers) && other.correctAnswers.length && other.answerTextReliable !== false) {
      primary.correctAnswers = other.correctAnswers;
      primary.answerTextReliable = true;
    }
    if (!primary.feedback && other.feedback) primary.feedback = other.feedback;
    if (primary.points == null && other.points != null && Number.isFinite(Number(other.points))) primary.points = Number(other.points);
    if ((!primary.type || primary.type === 'unknown') && other.type && other.type !== 'unknown') primary.type = other.type;
    if ((!primary.rawType || primary.rawType === 'unknown') && other.rawType) primary.rawType = other.rawType;
    primary.parserConfidence = Math.max(Number(primary.parserConfidence || 0), Number(other.parserConfidence || 0));
    primary.answerTextReliable = Boolean(Array.isArray(primary.correctAnswers) && primary.correctAnswers.length &&
      ((Array.isArray(primary.options) && primary.options.length && primary.optionTextReliable !== false) || /^(?:regex|text-entry)$/.test(String(primary.type || ''))));
    return ctiGuardOptionEvidence_(primary);
  }

export function assignmentPartEvidenceScoreV666(part) {
    if (!part) return 0;
    const text = String(part.innerText || part.textContent || '').replace(/\s+/g, ' ').trim();
    let score = 0;
    if (/\bPrompt\b/i.test(text)) score += 15;
    if (/\bOptions\b/i.test(text)) score += 25;
    if (/\bCorrect Answers?\b/i.test(text)) score += 30;
    if (/\bQuestion\s*Type\b/i.test(text)) score += 10;
    if (/\bIncorrect Answers?:\s*Explanation\b/i.test(text)) score += 8;
    try { score += Math.min(32, exactAssessmentBadgeElements(part).length * 8); } catch (e) {}
    try { score += Math.min(24, part.querySelectorAll('[data-testid="option"],.rc-assignmentauthoringoptionseditor__option').length * 6); } catch (e) {}
    return score;
  }

export function assessmentOutlinePromptAlignedV613(label, prompt) {
    const key=assessmentPromptKey_(String(label || '').replace(/[.…]+$/, ''));
    const actual=assessmentPromptKey_(prompt);
    if (key.length<18 || /^question \d+$/.test(key)) return true;
    if (actual.startsWith(key)) return true;
    const withoutOrdinal=key.replace(/^\d+\s+/, '');
    return withoutOrdinal!==key && withoutOrdinal.length>=18 && actual.startsWith(withoutOrdinal);
  }

export async function hydrateAssignmentPartV666(candidate, existingTarget, deadline) {
    const waitBudget=scopedWaitBudgetV61321(3200,8000,deadline);
    deadline = Math.min(deadline==null?Infinity:Number(deadline), Date.now()+3200);
    const resolve = () => {
      const current = document.getElementById(candidate.id);
      return current && document.contains(current) && current.id===candidate.id ? current : null;
    };
    const aligns = target => {
      const key=assessmentPromptKey_(String(candidate.label || '').replace(/^\d+\s*[.)]?\s*/, '').replace(/[.…]+$/, ''));
      return key.length<18 || /^question \d+$/.test(key) || assessmentPromptKey_(target && (target.innerText || target.textContent) || '').includes(key);
    };
    const ready=target=>{
      if(!target || !aligns(target) || hasVisibleLoadingIndicator(target))return false;
      const parsed=parseAssignmentPartDomV665(target,{type:'Assignment'},candidate.ordinal,candidate.label);
      return Boolean(parsed && assessmentOutlinePromptAlignedV613(candidate.label,parsed.prompt) && questionEvidenceReadyV6138(parsed));
    };
    let target=resolve();
    waitBudget.observe([target?String(target.innerText || target.textContent || '').length:0,assignmentPartEvidenceScoreV666(target)]);
    if (ready(target)) return {target,evidenceScore:assignmentPartEvidenceScoreV666(target),clicked:false};
    let clicked=false;
    const anchor=candidate.anchor;
    // The observed hash anchor belongs to the assignment question index. Its
    // prompt may contain words such as "remove" or "submit"; these are not
    // mutation controls. Only this exact, live in-page navigation link is used.
    if (anchor && anchor.isConnected && String(anchor.tagName || '').toLowerCase()==='a' &&
        String(anchor.getAttribute('href') || '')===candidate.href &&
        anchor.closest('[data-testid="assignment-outline"]')) {
      try { anchor.click(); clicked=true; } catch (_) {}
    }
    let stable=0,last='';
    while(Date.now()<deadline) {
      await sleepMs(Math.min(180,Math.max(0,deadline-Date.now())));
      target=resolve();
      if (!target) continue;
      const score=assignmentPartEvidenceScoreV666(target);
      const signature=String(target.innerText || target.textContent || '');
      waitBudget.observe([signature.length,score]);
      deadline=waitBudget.extend(180);
      stable=signature===last?stable+1:0;last=signature;
      if (ready(target) && stable>=1) break;
    }
    target=resolve();
    return {target,evidenceScore:assignmentPartEvidenceScoreV666(target),clicked,waitBudget:waitBudget.snapshot()};
  }
