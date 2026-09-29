import { assignmentBehaviorTextV61321, mergeNativeRubricModels, parseCourseraRubricsFromText, rubricContainerForHeading, rubricLevelFromRow, rubricRowForPoint } from "./assessment-settings.js";
import { collectCourseraStructuredAssessment } from "./assessments-4.js";
import { collectAssignmentTextBlocksV61321 } from "./assessments.js";
import { collectDomEvidenceFromRoot, mergeCourseraLearnerText } from "./evidence-2.js";
import { mergeEvidence } from "./evidence.js";
import { isVisibleElement } from "./text-and-dom-3.js";
import { collectCourseraAttachmentFacts, exactPointElements, findLabeledCourseraControlValue, stripCourseraAttachmentBadgesFromLearnerText } from "./text-and-dom-4.js";
import { unique } from "./text-and-dom.js";

export function nativeAssignmentSectionsFromText(rawText) {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    const out = {prompt:"", directions:"", expectations:""};
    if (!text) return out;

    const rubric = text.search(/\bRubric\s+\d+\b/i);
    const settings = text.search(/\b(?:Export Settings|Grading Settings)\b/i);

    // Prefer explicit structural labels rather than arbitrary words inside
    // learner prose. This prevents phrases such as "performance expectations"
    // or rubric levels such as "Meets Expectations" from becoming section
    // boundaries.
    let qp = text.search(/\bQuestion\s+Prompt\b/i);
    let qpLabel = "Question Prompt";
    if (qp < 0) {
      const generic = /\bPrompt\b/gi;
      let m;
      while ((m = generic.exec(text)) !== null) {
        const before = text.slice(Math.max(0,m.index-40), m.index);
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 120);
        if (/Rubric\s*$/i.test(before)) continue;
        if (/^\s*(?:For|You|Your|The|This|Please|Read|Write|Answer|Submit|Complete|Select|Choose|Considering|Think|Describe|Explain|Reflect)\b/i.test(after)) {
          qp = m.index; qpLabel = m[0]; break;
        }
      }
    }

    let directions = text.search(/\bAssignment\s+Directions\b/i);
    let directionsLabel = "Assignment Directions";
    if (directions < 0) {
      const dm = /\bDirections\b/gi;
      let m;
      while ((m = dm.exec(text)) !== null) {
        const before = text.slice(Math.max(0,m.index-30),m.index);
        const after = text.slice(m.index+m[0].length,m.index+m[0].length+120);
        if (/Learning\s+objectives|Question\s+Prompt|Rubric/i.test(before)) continue;
        if (/^\s*(?:For|You|Your|The|This|Please|Read|Write|Answer|Submit|Complete|Use|Refer)\b/i.test(after)) {
          directions = m.index; directionsLabel = m[0]; break;
        }
      }
    }

    let expectations = -1;
    let expectationsLabel = "Expectations";
    const em = /\bExpectations\b/gi;
    let ematch;
    while ((ematch = em.exec(text)) !== null) {
      const before = text.slice(Math.max(0,ematch.index-28),ematch.index);
      const after = text.slice(ematch.index+ematch[0].length,ematch.index+ematch[0].length+120);
      if (/(?:performance|smart|meet|meets|exceeds|learning|job|course|clear)\s*$/i.test(before)) continue;
      if (/^\s*\(/.test(after)) continue;
      if (/^\s*(?:Your|You|The|This|Please|Only|Refer|Submit|Complete|Read|Write|Estimated|Learner|Student|Participant|Response|Assignment|Personal|Maximum|Minimum|Use)\b/i.test(after)) {
        expectations = ematch.index; expectationsLabel = ematch[0]; break;
      }
    }

    function earliestAfter(start, candidates) {
      let end = text.length;
      candidates.forEach(v => { if (v >= 0 && v > start) end = Math.min(end, v); });
      return end;
    }

    if (qp >= 0) {
      const start = qp + qpLabel.length;
      const end = earliestAfter(start,[directions,expectations,rubric,settings]);
      out.prompt = text.slice(start,end).trim();
    }
    if (directions >= 0) {
      const start = directions + directionsLabel.length;
      const end = earliestAfter(start,[expectations,rubric,settings]);
      out.directions = text.slice(start,end).trim();
    }
    if (expectations >= 0) {
      const start = expectations + expectationsLabel.length;
      const end = earliestAfter(start,[rubric,settings]);
      out.expectations = text.slice(start,end).trim();
    }
    return out;
  }

export function trimCourseraAssignmentLearnerText(value, kind) {
    let text = String(value || "").replace(/\s+/g," ").trim();
    if (!text) return "";

    // v6.14.7: strip authoring-shell preambles before comparing learner content.
    // Coursera often prepends item title/status/outline chrome to the visible
    // Expectations or Directions block. Prefer the semantic section marker.
    const k = String(kind || "").toLowerCase();
    const starts = [];
    if (k === "directions") starts.push(/\bAssignment Directions\b/i, /\bDirections\b/i);
    if (k === "expectations") starts.push(/\bExpectations\b/i);
    if (k === "prompt") starts.push(/\bQuestion Prompt\b/i, /\bPrompt\b/i);
    for (const re of starts) {
      const matches = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
      if (matches.length) {
        // Repeated headings are common in the sidebar + body. Use the last
        // heading when it still leaves useful learner text behind.
        for (let i=matches.length-1; i>=0; i--) {
          const candidate = text.slice(matches[i].index + matches[i][0].length).trim();
          if (candidate.length >= 25) { text = candidate; break; }
        }
      }
    }

    const stopPatterns = [
      /\bAI Grader Instructions\b/i,
      /\bShow academic integrity options\b/i,
      /\bFor graders\b/i,
      /\bGrading details\b/i,
      /\bInstructions, rubrics\b/i,
      /\bExport Settings\b/i,
      /\bGrade setting\b/i,
      /\bRubric\s+\d+\b/i,
      // Coursera question-panel headers are often rendered as "2AI-Graded"
      // with no whitespace between the ordinal and grader label, so a plain
      // word-boundary before AI does not match. Treat that panel header as an
      // authoring boundary rather than learner-facing expectation text.
      /(?:^|\s|\d)(?:AI|Auto|Staff|Peer)-Graded\b/i
    ];
    let end = text.length;
    stopPatterns.forEach(re => { const m = re.exec(text); if (m && m.index >= 20) end = Math.min(end, m.index); });
    text = text.slice(0,end).trim();

    // If a supposed learner Expectations segment is actually the rubric body,
    // do not feed it into content-fidelity comparison. Rubric semantics are
    // retained separately in nativeAssignment.rubrics.
    if (k === "expectations") {
      const rubricSignals = [
        /\bDoes Not Meet Expectations\b/i,
        /\bMeets Expectations\b/i,
        /\bExceeds Expectations\b/i,
        /\bORGANIZATION\b/,
        /\bEFFORT\b/,
        /\bMECHANICS\b/,
        /\bRubric\s+Prompt\b/i,
        /\bAI Grader Instructions\b/i
      ].reduce((n,re) => n + (re.test(text) ? 1 : 0), 0);
      if (rubricSignals >= 2) return "";
    }
    return text;
  }

export function normalizeAssignmentMetadataV61325(assignment) {
    if (!assignment || typeof assignment !== 'object') return assignment;
    const out={...assignment,settings:{...(assignment.settings || {})},submission:{...(assignment.submission || {})},
      currentStateEvidence:JSON.parse(JSON.stringify(assignment.currentStateEvidence || {})),
      metadataCorrections:(assignment.metadataCorrections || []).slice()};
    const clean=value=>String(value == null?'':value).replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const text=clean(assignment.authoringSemanticText);
    const action=/\b(?:Create|Add|Generate)\s+(?:(?:a|an|new)\s+)?AI[- ]graded\s+(?:question|assignment)\b/ig;
    const hasAction=action.test(text);action.lastIndex=0;
    const withoutActions=text.replace(action,' ');
    // A creation button offers a new question type. It is not evidence of the
    // current grader. Preserve separately observed question/grader headers.
    if(hasAction && !/(?:^|[\s\d])AI[- ]Graded\b|\bAI Grader Instructions\b/i.test(withoutActions) &&
       (out.submission.aiGraded===true || out.settings.graderType==='AI')) {
      out.submission.aiGraded=false;
      if(out.settings.graderType==='AI')delete out.settings.graderType;
      if(!out.settings.graderType && out.submission.peerGraded===true)out.settings.graderType='PEER';
      else if(!out.settings.graderType && out.submission.staffGraded===true)out.settings.graderType='STAFF';
      out.metadataCorrections.push({field:'aiGraded',reason:'AUTHORING_CREATION_CONTROL_NOT_CURRENT_GRADER'});
      if(Array.isArray(out.currentStateEvidence.observedSubmissionSignals))out.currentStateEvidence.observedSubmissionSignals=out.currentStateEvidence.observedSubmissionSignals.filter(k=>k!=='aiGraded');
    }
    for(const key of ['scoringPolicy','feedbackType'])if(typeof out.settings[key]==='string')out.settings[key]=clean(out.settings[key]).replace(/^Required\s+/i,'');
    const value=clean(out.settings.gradeSetting),valid=/^(Graded|Ungraded|Practice)$/i.test(value);
    if(value && !valid) {
      const visible=text.match(/\bGrade setting\s+(?:Required\s+)?(Ungraded|Graded|Practice)\b/i);
      if(visible)out.settings.gradeSetting=visible[1];else delete out.settings.gradeSetting;
      out.metadataCorrections.push({field:'gradeSetting',reason:visible?'VISIBLE_GRADE_LABEL_REPLACES_RAW_CONTROL_VALUE':'UNRECOGNIZED_GRADE_VALUE_UNVERIFIED'});
    }
    if(Array.isArray(out.currentStateEvidence.observedSettingFields))out.currentStateEvidence.observedSettingFields=out.currentStateEvidence.observedSettingFields.filter(k=>Object.prototype.hasOwnProperty.call(out.settings,k));
    // Re-normalizing an imported capture must not accumulate duplicate receipts.
    out.metadataCorrections=out.metadataCorrections.filter((x,i,all)=>all.findIndex(y=>y.field===x.field && y.reason===x.reason)===i);
    return out;
  }

export function collectCourseraNativeAssignment(root, fp, structuredAssessment) {
    if (!root || !fp) return null;
    const type = String(fp.type || fp.typeName || "").toLowerCase();
    if (!/(assignment|assessment|quiz|exam)/.test(type)) return null;
    const rawRootText = String(root.innerText || root.textContent || "");
    const normalizedRootText = rawRootText.replace(/\s+/g, " ").trim();
    const contentBlockEvidence=collectAssignmentTextBlocksV61321(root,fp);
    const submissionText=assignmentBehaviorTextV61321(root);
    const submission = {
      fileUpload: /\bFile Upload\b|\bFile submission\b/i.test(submissionText),
      textSubmission: /\bText submission\b|\bRich Text\b/i.test(submissionText),
      richText: /\bRich Text\b/i.test(submissionText),
      // Coursera can prefix grader labels with a question ordinal without a
      // space (for example "2AI-Graded"). Treat an ordinal-adjacent grader
      // label as the same current-state behavior signal.
      aiGraded: /(?:^|[\s\d])AI-Graded\b/i.test(submissionText),
      peerGraded: /(?:^|[\s\d])Peer[- ]Graded\b/i.test(submissionText),
      staffGraded: /(?:^|[\s\d])Staff[- ]Graded\b/i.test(submissionText)
    };
    const settings = {};
    let sm;
    sm = normalizedRootText.match(/(?:Passing threshold)\s*(\d+(?:\.\d+)?)\s*%/i); if (sm) settings.passingThreshold = Number(sm[1]);
    sm = normalizedRootText.match(/(?:Minutes per attempt|Time limit(?: per attempt)?|\b)(\d+)\s*(?:minute|min)\b/i); if (sm && /time limit|minutes per attempt/i.test(sm[0])) settings.timeLimitMinutes = Number(sm[1]);
    sm = normalizedRootText.match(/Scoring policy\s+([^|]{1,80}?)(?=\s+(?:Time estimate|Attempts|Passing threshold|Feedback type|Collaboration type|Learner grade visibility|$))/i); if (sm) settings.scoringPolicy = sm[1].trim();
    sm = normalizedRootText.match(/Attempts\s+(Unlimited Attempts|\d+\s+Attempts?|\d+)/i); if (sm) settings.attempts = sm[1].trim();
    sm = normalizedRootText.match(/Collaboration type\s+(Individual|Team|Group)/i); if (sm) settings.collaborationType = sm[1];
    sm = normalizedRootText.match(/Learner grade visibility\s+(Visible|Hidden)/i); if (sm) settings.learnerGradeVisibility = sm[1];
    sm = normalizedRootText.match(/Learner response visibility\s+(Visible|Hidden)/i); if (sm) settings.learnerResponseVisibility = sm[1];
    sm = normalizedRootText.match(/Grade setting\s+(?:Required\s+)?(Ungraded|Graded|Practice)/i); if (sm) settings.gradeSetting = sm[1];
    sm = normalizedRootText.match(/Feedback type\s+([^|]{1,80}?)(?=\s+(?:Collaboration type|Learner grade visibility|Learner response visibility|$))/i); if (sm) settings.feedbackType = sm[1].trim();
    sm = normalizedRootText.match(/Time estimate\s+(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)/i); if (sm) settings.timeEstimateMinutes = Number(sm[1]);

    // v6.10: settings such as Passing threshold are often rendered as form
    // control values and are absent from innerText. Resolve them from their
    // labeled input/select row before declaring the control unobserved.
    if (!Object.prototype.hasOwnProperty.call(settings,"passingThreshold")) {
      const v = findLabeledCourseraControlValue(root,/^Passing threshold\b/i);
      const n = String(v||"").match(/-?\d+(?:\.\d+)?/);
      if (n) settings.passingThreshold = Number(n[0]);
    }
    if (!Object.prototype.hasOwnProperty.call(settings,"timeEstimateMinutes")) {
      const v = findLabeledCourseraControlValue(root,/^Time estimate\b/i);
      const n = String(v||"").match(/\d+(?:\.\d+)?/);
      if (n) settings.timeEstimateMinutes = Number(n[0]);
    }
    if (!settings.gradeSetting) settings.gradeSetting = findLabeledCourseraControlValue(root,/^Grade setting\b/i) || settings.gradeSetting;
    if (!settings.scoringPolicy) settings.scoringPolicy = findLabeledCourseraControlValue(root,/^Scoring policy\b/i) || settings.scoringPolicy;
    if (!settings.attempts) settings.attempts = findLabeledCourseraControlValue(root,/^Attempts\b/i) || settings.attempts;
    if (!settings.feedbackType) settings.feedbackType = findLabeledCourseraControlValue(root,/^Feedback type\b/i) || settings.feedbackType;
    if (!settings.collaborationType) settings.collaborationType = findLabeledCourseraControlValue(root,/^Collaboration type\b/i) || settings.collaborationType;
    if (!settings.learnerGradeVisibility) settings.learnerGradeVisibility = findLabeledCourseraControlValue(root,/^Learner grade visibility\b/i) || settings.learnerGradeVisibility;
    if (!settings.learnerResponseVisibility) settings.learnerResponseVisibility = findLabeledCourseraControlValue(root,/^Learner response visibility\b/i) || settings.learnerResponseVisibility;
    Object.keys(settings).forEach(k => { if (settings[k] === "" || settings[k] == null) delete settings[k]; });

    if (submission.aiGraded) settings.graderType = "AI";
    else if (submission.peerGraded) settings.graderType = "PEER";
    else if (submission.staffGraded) settings.graderType = "STAFF";

    const attachments = collectCourseraAttachmentFacts(root);

    const headings = [];
    try {
      [...root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading'],strong,b,span,div")].slice(0, 12000).forEach(el => {
        if (!isVisibleElement(el)) return;
        const t = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (/^Rubric\s+\d+$/i.test(t)) headings.push(el);
      });
    } catch (e) {}

    const byTitle = new Map();
    headings.forEach(heading => {
      const title = String(heading.innerText || heading.textContent || "").replace(/\s+/g, " ").trim();
      const container = rubricContainerForHeading(heading, root);
      if (!container) return;
      const points = exactPointElements(container);
      const levels = [], seenRows = new Set();
      points.forEach(pointEl => {
        const row = rubricRowForPoint(pointEl, container, points);
        if (!row || seenRows.has(row)) return;
        seenRows.add(row);
        const level = rubricLevelFromRow(row, pointEl, levels.length);
        if (level.label || level.description || level.points != null) levels.push(level);
      });

      const rawText = String(container.innerText || container.textContent || "").replace(/\s+/g, " ").trim();
      const candidate = {id:title, title, criterionTitle:"", criterionDescription:"", levels, rawText};
      const previous = byTitle.get(title.toLowerCase());
      const candidateScore = levels.filter(l => l.label || l.description).length * 500 + levels.length * 100 + rawText.length;
      const previousScore = previous ? previous.levels.filter(l => l.label || l.description).length * 500 + previous.levels.length * 100 + previous.rawText.length : -1;
      if (!previous || candidateScore > previousScore) byTitle.set(title.toLowerCase(), candidate);
    });

    let rubrics = [...byTitle.values()];
    const textRubrics = parseCourseraRubricsFromText(rawRootText);
    rubrics = mergeNativeRubricModels(rubrics, textRubrics);

    const structured = structuredAssessment || collectCourseraStructuredAssessment(root, fp);
    const sections = nativeAssignmentSectionsFromText(rawRootText);
    let prompt = sections.prompt || "";
    if (!prompt && structured && structured.questions && structured.questions.length === 1) prompt = String(structured.questions[0].prompt || "");
    const directions = sections.directions || "";
    const expectations = sections.expectations || "";

    const rubricSemantic = rubrics.flatMap(r => [r.title, r.criterionTitle, r.criterionDescription, r.rawText, ...(r.levels || []).flatMap(l => [l.label, l.description, l.points != null ? (String(l.points) + " points") : ""])]).filter(Boolean).join(" ");
    const learnerPrompt = stripCourseraAttachmentBadgesFromLearnerText(trimCourseraAssignmentLearnerText(prompt, "prompt"), attachments);
    const learnerDirections = stripCourseraAttachmentBadgesFromLearnerText(trimCourseraAssignmentLearnerText(directions, "directions"), attachments);
    const learnerExpectations = stripCourseraAttachmentBadgesFromLearnerText(trimCourseraAssignmentLearnerText(expectations, "expectations"), attachments);
    const blockText=contentBlockEvidence?contentBlockEvidence.blocks.map(b=>[b.title,b.text].filter(Boolean).join(' ')).join(' '):'';
    const learnerSemanticText = mergeCourseraLearnerText([learnerDirections, learnerExpectations, learnerPrompt,blockText]);
    const authoringSemanticText = [prompt,directions,expectations,rubricSemantic,normalizedRootText].filter(Boolean).join(" ").replace(/\s+/g," ").trim().slice(0,50000);
    const hasUseful = rubrics.length || attachments.length || Object.values(submission).some(Boolean) || Object.keys(settings).length || learnerSemanticText;
    if (!hasUseful) return null;
    const structuredLevelCount = rubrics.reduce((sum, r) => sum + (r.levels || []).filter(l => l.label || l.description).length, 0);
    const completeLevelCount = rubrics.reduce((sum, r) => sum + (r.levels || []).filter(l => l.label && l.description && l.points != null).length, 0);
    const warnings = [];
    if(contentBlockEvidence && (!contentBlockEvidence.completeTextBlockOnly || contentBlockEvidence.blocks.some(b=>b.embeddedFrameCount)))warnings.push('Instruction text blocks are captured with their individual limits; mixed content, submission controls and embedded pages require their own evidence.');
    if (rubrics.length && !structuredLevelCount) warnings.push("Rubric headings were captured but scoring-level semantics were not structured.");
    else if (structuredLevelCount && completeLevelCount < structuredLevelCount) warnings.push("Some rubric levels are missing a label, description, or point value.");

    return normalizeAssignmentMetadataV61325({
      schemaVersion:4,
      parser:"coursera-native-assignment-dom+controls-v4",
      origin:"coursera-authoring-editor",
      rubricCount:rubrics.length,
      rubrics,
      submission,
      settings,
      attachments,
      prompt,
      directions,
      expectations,
      learnerPrompt,
      learnerDirections,
      learnerExpectations,
      learnerSemanticText,
      contentBlockEvidence,
      authoringSemanticText,
      semanticText:learnerSemanticText,
      currentStateEvidence:{
        editorSurfaceObserved:true,
        observedSettingFields:Object.keys(settings),
        observedSubmissionSignals:Object.keys(submission).filter(k => submission[k] === true),
        attachmentCount:attachments.length,
        rubricCount:rubrics.length
      },
      parserConfidence: rubrics.length ? (completeLevelCount >= 3 ? 0.98 : (structuredLevelCount ? 0.94 : 0.86)) : ((prompt || directions || expectations || attachments.length || Object.keys(settings).length) ? 0.92 : 0.86),
      warnings
    });
  }

export function retainAssessmentSurfaceEvidenceV6138(root,fp) {
    if(!root || !root.isConnected || !isVisibleElement(root) || !fp)return;
    const evidence=collectDomEvidenceFromRoot(root,'active-editor-surface',fp);
    if(!evidence)return;
    delete evidence._diagnostics;
    mergeEvidence(fp.payload,evidence,'active-editor-surface');
    fp.evidenceSources=unique([...(fp.evidenceSources || []),'active-editor-surface'],50);
  }

export function assessmentTextReceiptV6146(assessment, fp) {
    const a=assessment || {}, c=a.captureCompleteness || {}, qs=Array.isArray(a.questions)?a.questions:[];
    const n=Number(a.declaredQuestionCount), ids=new Set();
    const complete=Boolean(fp && fp.id) && Number(a.parserConfidence)>=0.90 && Number.isSafeInteger(n) && n>0 && qs.length===n &&
      c.questionCoverageComplete===true && c.answerCoverageComplete===true &&
      c.declared===n && c.captured===n && c.uniqueQuestionIds===n &&
      c.declaredContentParts===n && Array.isArray(c.nonQuestionPartOrdinals) && !c.nonQuestionPartOrdinals.length &&
      ['missingQuestionOrdinals','missingRequiredAnswerOrdinals','unansweredQuestionOrdinals'].every(k=>Array.isArray(c[k]) && !c[k].length) &&
      c.missingOrdinalListTruncated===false && !(a.warnings || []).length &&
      qs.every(q=>{
        if(!q || Number(q.parserConfidence)<0.90 || !Number.isFinite(Number(q.parserConfidence)))return false;
        const id=String(q.courseraQuestionId || ''), type=String(q.type || '');
        if(!id || ids.has(id) || q.questionOrdinalObserved!==true || !String(q.prompt || '').trim() ||
          q.promptTruncated===true || q.promptBoundaryEvidence?.rawPromptTruncated===true ||
          q.answerTextReliable!==true || !Array.isArray(q.correctAnswers) || !q.correctAnswers.length ||
          !(q.correctAnswers || []).every(v=>typeof v==='string' && v.trim()) ||
          !/^(?:single-select|multi-select|true-false|text-entry|numeric)$/.test(type))return false;
        ids.add(id);
        if(/^(?:single-select|multi-select|true-false)$/.test(type))return q.optionTextReliable===true &&
          Array.isArray(q.options) && q.options.length>=2 && q.options.some(o=>o && o.correct===true) &&
          q.options.every(o=>o && String(o.text || '').trim() && typeof o.correct==='boolean');
        return !(q.options || []).length;
      });
    return {method:'SAME_VISIT_STRUCTURED_QUESTION_TEXT',itemId:String(fp && fp.id || ''),
      complete:Boolean(complete),questionCount:qs.length,declaredQuestionCount:Number.isSafeInteger(n)?n:null,
      scope:'Question, choice and answer text only. Media, behavior and source equivalence are independent checks.'};
  }

export function genericAssessmentTextHeuristicNotApplicableV6146(d) {
    const r=d && d.assessmentTextReceipt;
    return Boolean(r && r.method==='SAME_VISIT_STRUCTURED_QUESTION_TEXT' && r.complete===true &&
      r.itemId===String(d.id || '') && d.editorSurfaceCaptured && d.bodyScoped &&
      d.textScopeKind==='scoped-subtree' && d.questionCycleReactStateTruncated!==true &&
      r.questionCount===Number(d.questionCycleQuestions) && r.declaredQuestionCount===Number(d.questionCycleDeclared));
  }
