

// Narrow representation equivalence only: never evaluate, round, or repair math.
// Historical captures may contain visual, TeX and screen-reader copies together.
function qaAssessmentMathKey_(value) {
    var text = qaAssessmentText_(value).replace(/[\u200b-\u200d\ufeff]/g, '').replace(/−/g, '-').trim();
    var duplicate = text.match(/^(\d+)′′\s+((\d*)\\frac\{(\d+)\}\{(\d+)\}'')\s+(\d+)′′(.+)$/);
    if (duplicate) {
        var whole=duplicate[3], numerator=duplicate[4], denominator=duplicate[5];
        var spoken=(whole ? whole+', ' : '')+'start fraction, '+numerator+', divided by, '+denominator+', end fraction, start superscript, prime, prime, end superscript';
        if (duplicate[1]!==whole+numerator+denominator || duplicate[6]!==whole+denominator+numerator || duplicate[7]!==spoken) return null;
        text=duplicate[2];
    }
    var spokenCopy=text.match(/^((\d*)\\frac\{(\d+)\}\{(\d+)\}'')\s+(.+)$/);
    if(spokenCopy) {
        var expected=(spokenCopy[2]?spokenCopy[2]+', ':'')+'start fraction, '+spokenCopy[3]+', divided by, '+spokenCopy[4]+', end fraction, start superscript, prime, prime, end superscript';
        if(spokenCopy[5]!==expected)return null;
        text=spokenCopy[1];
    }
    text=text.replace(/^\\\(\s*([\s\S]*?)\s*\\\)$/, '$1').trim();
    text=text.replace(/′′|″/g, "''").replace(/′/g, "'");
    var fraction=text.match(/^(\d*)\s*\\frac\{(\d+)\}\{(\d+)\}\s*(''|'|in|ft)?$/);
    if (fraction) return 'math:fraction:'+fraction[1]+':'+fraction[2]+'/'+fraction[3]+':'+(fraction[4]||'');
    var number=text.match(/^([+-]?\d+(?:\.\d+)?|[+-]?\.\d+)\s*(?:(mm|cm|km|m|in|ft)(?:\s*(?:\^\s*([23])|([23])|([²³])))?|(%|''|'))?$/i);
    if (!number) return null;
    var exponent=number[3]||number[4]||(number[5]==='²'?'2':number[5]==='³'?'3':'');
    return 'math:number:'+number[1]+':'+String(number[2]||number[6]||'').toLowerCase()+':'+exponent;
}

function qaAssessmentFieldSimilarity_(a, b) {
    a = qaAssessmentText_(a); b = qaAssessmentText_(b);
    if (!a || !b) return 0;
    var am=qaAssessmentMathKey_(a), bm=qaAssessmentMathKey_(b);
    if (am && bm) return am===bm ? 1 : 0;
    var an = a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    var bn = b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!an || !bn) return 0;
    if (an === bn) return 1;
    var shorter = an.length <= bn.length ? an : bn;
    var longer = an.length <= bn.length ? bn : an;
    // Coursera may render an option label together with explanatory copy. A
    // distinctive source label that survives intact at the start/inside that row
    // is strong equivalence evidence, not a wording change.
    if (shorter.length >= 8) {
        if (longer.indexOf(shorter + ' ') === 0) return 0.98;
        if ((' ' + longer + ' ').indexOf(' ' + shorter + ' ') > -1) return 0.95;
    }
    return qaQuestionPromptSimilarity_(a, b);
}

function qaAnswerSetSimilarity_(left, right) {
    left = (left || []).map(qaAssessmentText_).filter(Boolean);
    right = (right || []).map(qaAssessmentText_).filter(Boolean);
    if (!left.length || !right.length) return null;
    var used = {};
    var total = 0;
    for (var i = 0; i < left.length; i++) {
        var best = 0, bestIdx = -1;
        for (var j = 0; j < right.length; j++) {
            if (used[j]) continue;
            var sc = qaAssessmentFieldSimilarity_(left[i], right[j]);
            if (sc > best) { best = sc; bestIdx = j; }
        }
        if (bestIdx >= 0) used[bestIdx] = true;
        total += best;
    }
    var cardinalityPenalty = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return (total / left.length) * cardinalityPenalty;
}

function qaAssessmentLabelKey_(value) {
    var text = qaAssessmentText_(value).toLowerCase();
    // Scoring annotations such as "(0.25 pts per answer)" are presentation/grading
    // decoration, not the semantic identity of a multiple-select option.
    text = text.replace(/\(\s*(?:\+\/-\s*)?\d+(?:\.\d+)?\s*(?:pts?|points?)\s+per\s+answer\s*\)/gi, ' ');
    text = text.replace(/(?:\+\/-\s*)?\d+(?:\.\d+)?\s*(?:pts?|points?)\s+per\s+answer/gi, ' ');
    return qaAssessmentMathKey_(text) || text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function qaNormalizeOptionSemantic_(option) {
    option = option || {};
    if (typeof option === 'string') option = { text: option, label: option };
    var label = qaAssessmentText_(option.label || option.title || option.name || '');
    var description = qaAssessmentText_(option.description || option.body || option.detail || option.explanation || '');
    var text = qaAssessmentText_(option.text || option.value || '');
    if (!label && text) label = text;
    if (!text) text = qaAssessmentText_([label, description].filter(Boolean).join(' '));
    var aliases = Array.isArray(option.aliases) ? option.aliases.map(qaAssessmentText_).filter(Boolean) : [];
    return { label: label, description: description, text: text, aliases: aliases, correct: option.correct };
}

function qaOptionSemanticSimilarity_(left, right) {
    var a = qaNormalizeOptionSemantic_(left), b = qaNormalizeOptionSemantic_(right);
    var aLabels = [a.label].concat(a.aliases || []).filter(Boolean);
    var bLabels = [b.label].concat(b.aliases || []).filter(Boolean);
    var labelScore = 0;
    aLabels.forEach(function(al) {
        bLabels.forEach(function(bl) {
            var ak = qaAssessmentLabelKey_(al), bk = qaAssessmentLabelKey_(bl);
            var sc = ak && bk && ak === bk ? 1 : qaAssessmentFieldSimilarity_(al, bl);
            if (sc > labelScore) labelScore = sc;
        });
    });

    // Backward compatibility: older fingerprints may have label+description flattened
    // into text. Compare labels against the complete row as a secondary representation.
    labelScore = Math.max(labelScore,
        qaAssessmentFieldSimilarity_(a.label || a.text, b.text || b.label),
        qaAssessmentFieldSimilarity_(b.label || b.text, a.text || a.label));

    var descriptionScore = null;
    if (a.description && b.description) descriptionScore = qaAssessmentFieldSimilarity_(a.description, b.description);
    var combinedScore = qaAssessmentFieldSimilarity_(a.text || [a.label, a.description].join(' '), b.text || [b.label, b.description].join(' '));

    var score;
    if (labelScore >= 0.92 && descriptionScore === null) score = Math.max(labelScore, combinedScore);
    else if (descriptionScore !== null) score = (labelScore * 0.68) + (descriptionScore * 0.24) + (combinedScore * 0.08);
    else score = Math.max(labelScore, combinedScore);

    return { score: Math.max(0, Math.min(1, score || 0)), labelSimilarity: labelScore, descriptionSimilarity: descriptionScore, combinedSimilarity: combinedScore };
}

function qaOptionSetSimilarity_(left, right) {
    left = (left || []).map(qaNormalizeOptionSemantic_).filter(function(o) { return o.label || o.description || o.text; });
    right = (right || []).map(qaNormalizeOptionSemantic_).filter(function(o) { return o.label || o.description || o.text; });
    if (!left.length || !right.length) return null;
    var used = {}, pairs = [], total = 0;
    for (var i = 0; i < left.length; i++) {
        var best = null, bestIdx = -1;
        for (var j = 0; j < right.length; j++) {
            if (used[j]) continue;
            var comparison = qaOptionSemanticSimilarity_(left[i], right[j]);
            if (!best || comparison.score > best.score) { best = comparison; bestIdx = j; }
        }
        if (bestIdx >= 0) used[bestIdx] = true;
        var pairScore = best ? best.score : 0;
        total += pairScore;
        pairs.push({ source: left[i].label || left[i].text, coursera: bestIdx >= 0 ? (right[bestIdx].label || right[bestIdx].text) : '', score: pairScore,
            labelSimilarity: best ? best.labelSimilarity : 0, descriptionSimilarity: best ? best.descriptionSimilarity : null });
    }
    var cardinalityPenalty = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return { similarity: (total / left.length) * cardinalityPenalty, pairs: pairs };
}

function qaCorrectOptionModels_(q) {
    var correct = (q.options || []).filter(function(o) { return o.correct === true; });
    if (correct.length) return correct;
    return (q.correctAnswers || []).map(function(text) { return { label: text, text: text, description: '', correct: true }; });
}

function ctiSeparateJoinedOptionFeedback_(rows, sourceRows) {
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

function qaSeparateCourseraOptionFeedback_(sourceQ, courseraQ) {
    if (sourceQ.optionTextReliable===false || courseraQ.optionTextReliable===false || courseraQ.answerTextReliable===false) return null;
    if (!/^(single-select|multiple-select|true-false)$/.test(courseraQ.type)) return null;
    var separated=ctiSeparateJoinedOptionFeedback_(courseraQ.options, sourceQ.options);
    if (!separated) return null;
    var answers=(courseraQ.correctAnswers || []).map(function(a){
        var match=separated.changes.filter(function(change){return change.rawText===a;});
        return match.length===1 ? match[0].normalizedText : a;
    });
    var marked=separated.rows.filter(function(o){return o.correct;}).map(function(o){return o.label;});
    if (answers.length!==marked.length || answers.some(function(a){return marked.indexOf(a)<0;})) return null;
    var question=Object.assign({},courseraQ,{options:separated.rows,correctAnswers:answers});
    return {question:question,audit:{basis:separated.basis,changes:separated.changes,rawCorrectAnswers:courseraQ.correctAnswers.slice(),normalizedCorrectAnswers:answers.slice()}};
}

function ctiOptionLabelLooksLikeFeedback_(text) {
    return /^(?:Correct|Incorrect)(?:[.!]\s+\S|\s+(?:according\s+to\s+(?:this|the)\s+(?:item|question)|in\s+this\s+context|because)\b)/i.test(String(text||'').trim());
}

function ctiOptionFeedbackRisk_(rows) {
    rows=Array.isArray(rows)?rows:[];
    if(rows.some(function(o){return o.optionFieldIssue==='FEEDBACK_ONLY_OPTION_FIELD';}))return 'FEEDBACK_ONLY_OPTION_FIELD';
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

function ctiGuardOptionEvidence_(q) {
    var issue=String(q.optionCaptureIssue||'') || ctiOptionFeedbackRisk_(q.options);
    if(!issue)return q;
    // Keep the raw text and selected states. Never reconstruct an answer from
    // source choices or feedback prose when the captured field boundary is lost.
    return Object.assign({},q,{optionCaptureIssue:issue,optionTextReliable:false,answerTextReliable:false});
}

function qaCompareAssessmentQuestion_(sourceQ, courseraQ) {
    sourceQ = qaNormalizeQuestion_(sourceQ || {}, 0);
    courseraQ = ctiGuardOptionEvidence_(qaNormalizeQuestion_(courseraQ || {}, 0));
    var earned = 0, possible = 0, mismatches = [], details = {};
    if(courseraQ.optionCaptureIssue)details.optionCaptureIssue=courseraQ.optionCaptureIssue;
    var feedbackRepair=qaSeparateCourseraOptionFeedback_(sourceQ,courseraQ);
    if(feedbackRepair){courseraQ=feedbackRepair.question;details.optionFeedbackNormalization=feedbackRepair.audit;}
    else {
        var observed=courseraQ.options.filter(function(o){return o.optionFeedback;});
        if(observed.length)details.optionFeedbackNormalization={basis:'EXTRACTOR_SEPARATED_FEEDBACK',changes:observed.map(function(o){return o.optionFeedback;})};
    }

    // Same v6.5 field weights. v6.5.8 changes evidence representation, not thresholds:
    // prompt 35, type 15, option count 10, option semantics 10,
    // correct-answer count 10, correct-answer semantics 15, points 5.
    possible += 35;
    var promptSimilarity = qaQuestionPromptSimilarity_(sourceQ.prompt, courseraQ.prompt);
    earned += 35 * promptSimilarity;
    details.promptSimilarity = promptSimilarity;
    if (promptSimilarity < 0.70) mismatches.push('PROMPT');

    if (sourceQ.type !== 'unknown' && courseraQ.type !== 'unknown') {
        possible += 15;
        var typeOk = qaQuestionTypesCompatible_(sourceQ.type, courseraQ.type);
        if (typeOk) earned += 15; else mismatches.push('TYPE');
        details.typeMatch = typeOk;
    }

    if (sourceQ.options.length && courseraQ.options.length) {
        possible += 10;
        var optionCountRatio = Math.min(sourceQ.options.length, courseraQ.options.length) / Math.max(sourceQ.options.length, courseraQ.options.length);
        earned += 10 * optionCountRatio;
        details.optionCountSource = sourceQ.options.length;
        details.optionCountCoursera = courseraQ.options.length;
        if (sourceQ.options.length !== courseraQ.options.length) mismatches.push('OPTION_COUNT');

        if (sourceQ.optionTextReliable !== false && courseraQ.optionTextReliable !== false) {
            possible += 10;
            var optionComparison = qaOptionSetSimilarity_(sourceQ.options, courseraQ.options);
            var optionSimilarity = optionComparison ? optionComparison.similarity : null;
            if (optionSimilarity != null) earned += 10 * optionSimilarity;
            details.optionSimilarity = optionSimilarity;
            details.optionPairs = optionComparison ? optionComparison.pairs : [];
            if (optionSimilarity != null && optionSimilarity < 0.72) mismatches.push('OPTIONS');
        } else {
            details.optionTextComparison = 'SKIPPED_UNRELIABLE_OPTION_TEXT';
        }
    }

    var sourceCorrectOptions = qaCorrectOptionModels_(sourceQ);
    var courseraCorrectOptions = qaCorrectOptionModels_(courseraQ);
    if (sourceCorrectOptions.length && courseraCorrectOptions.length && sourceQ.answerTextReliable !== false && courseraQ.answerTextReliable !== false) {
        possible += 10;
        var correctCountMatch = sourceCorrectOptions.length === courseraCorrectOptions.length;
        if (correctCountMatch) earned += 10; else mismatches.push('CORRECT_ANSWER_COUNT');
        details.correctCountSource = sourceCorrectOptions.length;
        details.correctCountCoursera = courseraCorrectOptions.length;

        if (sourceQ.answerTextReliable !== false && courseraQ.answerTextReliable !== false) {
            possible += 15;
            var correctComparison = qaOptionSetSimilarity_(sourceCorrectOptions, courseraCorrectOptions);
            var answerSimilarity = correctComparison ? correctComparison.similarity : null;
            if (answerSimilarity != null) earned += 15 * answerSimilarity;
            details.answerSimilarity = answerSimilarity;
            details.correctAnswerPairs = correctComparison ? correctComparison.pairs : [];
            if (answerSimilarity != null && answerSimilarity < 0.72) mismatches.push('CORRECT_ANSWER');
        } else {
            details.answerTextComparison = 'SKIPPED_UNRELIABLE_ANSWER_TEXT';
        }
    }

    if (sourceQ.points != null && courseraQ.points != null) {
        possible += 5;
        var pointOk = Math.abs(Number(sourceQ.points) - Number(courseraQ.points)) < 0.001;
        if (pointOk) earned += 5; else mismatches.push('POINTS');
        details.pointsSource = sourceQ.points;
        details.pointsCoursera = courseraQ.points;
    }

    var score = possible ? earned / possible : 0;
    var coverage = Math.min(1, possible / 100);
    if(mismatches.length || details.optionFeedbackNormalization || details.optionCaptureIssue) {
        // Preserve both observed sides so a question-level finding is reviewable
        // without rerunning extraction or guessing an answer from a percentage.
        details.sourceOptions=sourceQ.options.map(function(o){return {label:o.label||o.text||'',text:o.text||o.label||'',description:o.description||'',correct:o.correct===true?true:(o.correct===false?false:null)};});
        details.courseraOptions=courseraQ.options.map(function(o){return {label:o.label||o.text||'',text:o.text||o.label||'',description:o.description||'',correct:o.correct===true?true:(o.correct===false?false:null)};});
        details.sourceCorrectAnswers=sourceCorrectOptions.map(function(o){return o.label||o.text||'';});
        details.courseraCorrectAnswers=courseraCorrectOptions.map(function(o){return o.label||o.text||'';});
        details.sourceAnswerTextReliable=sourceQ.answerTextReliable!==false;
        details.courseraAnswerTextReliable=courseraQ.answerTextReliable!==false;
    }
    return {
        score: score,
        coverage: coverage,
        mismatches: mismatches.filter(function(v, i, a) { return a.indexOf(v) === i; }),
        prompt: sourceQ.prompt,
        courseraPrompt: courseraQ.prompt,
        sourceType: sourceQ.type,
        courseraType: courseraQ.type,
        details: details
    };
}
