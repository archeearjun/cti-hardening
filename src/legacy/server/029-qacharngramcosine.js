

function qaCharNgramCosine_(left, right, n) {
    n = n || 3;
    function grams(text) {
        text = qaCleanText_(text).toLowerCase().replace(/\s+/g, ' ');
        var map = Object.create(null);
        for (var i = 0; i <= text.length - n; i++) {
            var gram = text.slice(i, i + n);
            map[gram] = (map[gram] || 0) + 1;
        }
        return map;
    }

    var a = grams(left), b = grams(right);
    var keys = Object.keys(a);
    if (!keys.length || !Object.keys(b).length) return 0;

    var dot = 0, aNorm = 0, bNorm = 0;
    keys.forEach(function(key) {
        aNorm += a[key] * a[key];
        if (b[key]) dot += a[key] * b[key];
    });
    Object.keys(b).forEach(function(key) { bNorm += b[key] * b[key]; });
    if (!aNorm || !bNorm) return 0;
    return dot / Math.sqrt(aNorm * bNorm);
}

function qaTextPreview_(text) {
    text = qaCleanText_(text);
    return text.length > 220 ? text.slice(0, 217) + '...' : text;
}


// -------------------------------------------------------------------
// v6.5 STRUCTURED ASSESSMENT FIDELITY
// Deterministic QTI -> Coursera Assignment question-level comparison.
// The source parser runs in the browser while the IMSCC ZIP is available;
// this server-side parser also derives a normalized Coursera question model
// from the captured authoring-editor text for backward-compatible v6.4 JSON.
// -------------------------------------------------------------------
function qaLearnerMarkupText_(value) {
    var text = String(value == null ? '' : value);
    // Text extraction only, not a display sanitizer. Strip actual HTML before
    // decoding entities, so encoded code examples remain literal text.
    text = text.replace(/<!--[^]*?-->/g, ' ')
        .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
        .replace(/<\/?(?:p|div|br|li|ul|ol|table|caption|colgroup|col|thead|tbody|tfoot|tr|td|th|blockquote|h[1-6]|section|article|hr)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, ' ')
        .replace(/<\/?(?:a|span|strong|em|b|i|u|s|font|small|sup|sub|code|pre|img|o:p)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, '');
    var entities = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', ndash:'–', mdash:'—', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”', hellip:'…', bull:'•', times:'×', divide:'÷', minus:'−', le:'≤', ge:'≥', copy:'©', reg:'®', trade:'™' };
    text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function(all, key) {
        if (key.charAt(0) !== '#') return Object.prototype.hasOwnProperty.call(entities, key) ? entities[key] : all;
        var n = key.charAt(1).toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
    });
    return text.replace(/\s+/g, ' ').trim();
}

function qaAssessmentText_(value) {
    return qaCleanText_(value).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

function qaQuestionTypeKey_(value) {
    var t = qaAssessmentText_(value).toLowerCase();
    if (!t) return 'unknown';
    if (/multiple correct|multiple select|select multiple|multiple response|checkbox/.test(t)) return 'multiple-select';
    if (/single correct|multiple choice|single choice|radio/.test(t)) return 'single-select';
    if (/true\s*(?:or|\/)\s*false|truefalse/.test(t)) return 'true-false';
    if (/regular expression|regex/.test(t)) return 'regex';
    if (/^(?:text match|text[- ]entry|numeric|numeric answer)$/.test(t) || /fill|text entry|string|short answer/.test(t)) return 'text-entry';
    if (/^reflective text answer$/.test(t)) return 'essay';
    if (/^(?:(?:ai|manual|peer|staff)[- ]graded )?file upload(?: test)?(?: question)?$/.test(t)) return 'file-upload';
    if (/essay|long answer/.test(t)) return 'essay';
    return t.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function qaNormalizeQuestion_(q, index) {
    q = q || {};
    var options = Array.isArray(q.options) ? q.options : [];
    var cleanOptions = options.map(function(o, idx) {
        if (typeof o === 'string') {
            var stringText = qaAssessmentText_(o);
            return { id: String(idx + 1), label: stringText, description: '', text: stringText, aliases: [], correct: null };
        }
        o = o || {};
        var label = qaAssessmentText_(o.label || o.title || o.name || '');
        var description = qaAssessmentText_(o.description || o.body || o.detail || o.explanation || '');
        var text = qaAssessmentText_(o.text || o.value || '');
        if (!label && text) label = text;
        if (!text) text = qaAssessmentText_([label, description].filter(Boolean).join(' '));
        var aliases = Array.isArray(o.aliases) ? o.aliases.map(qaAssessmentText_).filter(Boolean) : [];
        return {
            id: String(o.id || o.identifier || (idx + 1)),
            label: label,
            description: description,
            text: text,
            aliases: aliases.filter(function(v, i, a) { return a.indexOf(v) === i; }),
            optionFieldIssue: String(o.optionFieldIssue || ''),
            optionFeedback: o.optionFeedback && typeof o.optionFeedback==='object' ? {
                rawText:qaAssessmentText_(o.optionFeedback.rawText),normalizedText:qaAssessmentText_(o.optionFeedback.normalizedText),
                feedbackText:qaAssessmentText_(o.optionFeedback.feedbackText),method:qaAssessmentText_(o.optionFeedback.method)
            } : undefined,
            correct: o.correct === true ? true : (o.correct === false ? false : null)
        };
    }).filter(function(o) { return o.label || o.description || o.text; });

    var correctAnswers = Array.isArray(q.correctAnswers) ? q.correctAnswers.map(function(a) {
        if (a && typeof a === 'object') return qaAssessmentText_(a.label || a.text || a.value || a.id || '');
        return qaAssessmentText_(a);
    }).filter(Boolean) : [];
    if (!correctAnswers.length) {
        cleanOptions.forEach(function(o) { if (o.correct === true) correctAnswers.push(o.label || o.text); });
    }

    return {
        id: String(q.id || q.identifier || (index + 1)),
        index: index + 1,
        type: /^(?:text match|reflective text answer)$/i.test(qaAssessmentText_(q.rawType)) ? qaQuestionTypeKey_(q.rawType) : qaQuestionTypeKey_(q.type && q.type!=='unknown' ? q.type : (q.questionType || q.rawType || q.type || '')),
        rawType: qaAssessmentText_(q.rawType || q.questionType || q.type || ''),
        courseraQuestionId: String(q.courseraQuestionId || ''),
        questionOrdinalObserved: q.questionOrdinalObserved === true,
        responseTypeEvidence: q.responseTypeEvidence ? JSON.parse(JSON.stringify(q.responseTypeEvidence)) : null,
        promptBoundaryEvidence: q.promptBoundaryEvidence ? JSON.parse(JSON.stringify(q.promptBoundaryEvidence)) : null,
        mediaRefs:Array.isArray(q.mediaRefs)?q.mediaRefs.map(String).filter(Boolean):[],
        sourceTypeEvidence:q.sourceTypeEvidence||null,
        mediaPresence:Array.isArray(q.mediaPresence)?q.mediaPresence:[],
        prompt: qaAssessmentText_(q.prompt || q.stem || q.text || ''),
        options: cleanOptions,
        correctAnswers: correctAnswers.filter(function(v, i, a) { return a.indexOf(v) === i; }),
        feedback: qaAssessmentText_(q.feedback || q.explanation || ''),
        points: (q.points !== null && q.points !== undefined && q.points !== '' && Number.isFinite(Number(q.points))) ? Number(q.points) : null,
        optionTextReliable: q.optionTextReliable === false ? false : true,
        answerTextReliable: q.answerTextReliable === false ? false : true,
        optionCaptureIssue: String(q.optionCaptureIssue || ''),
        parserConfidence: Math.max(0, Math.min(1, Number(q.parserConfidence == null ? 0.9 : q.parserConfidence)))
    };
}

function qaNormalizeAssessment_(assessment, origin) {
    if (!assessment || typeof assessment !== 'object') return null;
    var qs = Array.isArray(assessment.questions) ? assessment.questions : [];
    // Stored source models up to v3 retained escaped HTML. Normalize a copy,
    // never destination learner text or the already-normalized v4 source model.
    if (/^ims-qti-dom(?:-v[123](?:-|$)|$)/i.test(String(assessment.parser || '')) &&
        (String(origin || '').toLowerCase() === 'source-qti' || /source/i.test(String(assessment.origin || '')))) {
        qs = JSON.parse(JSON.stringify(qs));
        qs.forEach(function(q) {
            ['prompt','stem','text','feedback','explanation'].forEach(function(k) { if (typeof q[k] === 'string') q[k] = qaLearnerMarkupText_(q[k]); });
            ['options','correctAnswers'].forEach(function(k) {
                if (!Array.isArray(q[k])) return;
                q[k] = q[k].map(function(o) {
                    if (typeof o === 'string') return qaLearnerMarkupText_(o);
                    if (o && typeof o === 'object') ['label','text','description','title','name','body','detail','explanation','value'].forEach(function(f) { if (typeof o[f] === 'string') o[f] = qaLearnerMarkupText_(o[f]); });
                    return o;
                });
            });
        });
    }
    qs = qs.map(qaNormalizeQuestion_).filter(function(q) { return q.prompt || q.options.length || q.correctAnswers.length; });
    if (!qs.length) return null;

    // v6.5.3: IMS QTI 1.x/2.x SCORE maxima are grading scales, not reliable
    // learner-facing item-point values. Earlier v6.5.x source fingerprints
    // stored decvar maxvalue / outcome normalMaximum in `points`, which caused
    // false POINTS mismatches against Coursera's per-question point values.
    // Keep the source QTI structure, prompts, options and answers, but do not
    // compare those normalized SCORE maxima as portable item points.
    var parserName = String(assessment.parser || '').toLowerCase();
    var isSourceQti = String(origin || '').toLowerCase() === 'source-qti' || String(assessment.origin || '').toLowerCase().indexOf('source') > -1;
    if (isSourceQti && parserName.indexOf('ims-qti-dom') === 0) {
        qs.forEach(function(q) {
            q.points = null;
            // Legacy parsers flattened NOT(varequal) into selected correct options.
            // The stored answer list cannot reveal which values were negated.
            if (/^ims-qti-dom(?:-v[12](?:-|$)|$)/.test(parserName) && q.type === 'multiple-select') q.answerTextReliable = false;
        });
    }
    if (!isSourceQti && /coursera/.test(String(origin||'')+' '+parserName)) qs=qs.map(ctiGuardOptionEvidence_);
    var declared = Number(assessment.declaredQuestionCount || assessment.questionCount || qs.length);
    if (!Number.isFinite(declared) || declared < 1) declared = qs.length;
    var confidence = Number(assessment.parserConfidence == null ? 0.9 : assessment.parserConfidence);
    if (!Number.isFinite(confidence)) confidence = 0.9;
    confidence = Math.max(0, Math.min(1, confidence));
    var answerable = qs.filter(function(q) {
        return /^(true-false|single-select|multiple-select|regex|text-entry)$/.test(String(q.type || ''));
    });
    var answerEvidence = answerable.filter(function(q) {
        return q.answerTextReliable !== false && Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0;
    });
    return {
        schemaVersion: Number(assessment.schemaVersion || 1),
        origin: String(origin || assessment.origin || assessment.parser || ''),
        parser: String(assessment.parser || ''),
        declaredQuestionCount: declared,
        questionCount: qs.length,
        definitionCoverage: assessment.definitionCoverage && typeof assessment.definitionCoverage === 'object'
            ? JSON.parse(JSON.stringify(assessment.definitionCoverage))
            : (/^brightspace-question-api/.test(parserName) ? {scope:'BRIGHTSPACE_QUESTION_DEFINITIONS',completenessVerified:false,status:'LEGACY_TOTAL_UNVERIFIED',observedDeclaredQuestionCount:null,capturedDefinitions:qs.length} : null),
        answerableQuestionCount: answerable.length,
        answerEvidenceQuestionCount: answerEvidence.length,
        selectionPolicy: (assessment.selectionPolicy && typeof assessment.selectionPolicy === 'object') ? {
            observed: assessment.selectionPolicy.observed === true,
            selectCount: assessment.selectionPolicy.selectCount!=null && Number.isFinite(Number(assessment.selectionPolicy.selectCount)) ? Number(assessment.selectionPolicy.selectCount) : null,
            poolSize: assessment.selectionPolicy.poolSize!=null && Number.isFinite(Number(assessment.selectionPolicy.poolSize)) ? Number(assessment.selectionPolicy.poolSize) : null,
            randomSelection: assessment.selectionPolicy.randomSelection === true ? true : (assessment.selectionPolicy.randomSelection === false ? false : null),
            source: String(assessment.selectionPolicy.source || '')
        } : { observed:false, selectCount:null, poolSize:null, randomSelection:null, source:'' },
        questions: qs,
        captureCompleteness: assessment.captureCompleteness ? JSON.parse(JSON.stringify(assessment.captureCompleteness)) : null,
        outlineEvidence: assessment.outlineEvidence ? JSON.parse(JSON.stringify(assessment.outlineEvidence)) : null,
        cycleEvidence: assessment.cycleEvidence ? JSON.parse(JSON.stringify(assessment.cycleEvidence)) : null,
        parserConfidence: confidence,
        warnings: Array.isArray(assessment.warnings) ? assessment.warnings.slice(0, 20) : []
    };
}

function qaParseCourseraAssignmentText_(rawText) {
    var text = qaAssessmentText_(rawText);
    if (!text || text.length < 120 || text.indexOf('Question Type') === -1 || text.indexOf('Prompt') === -1) return null;

    var declared = null;
    var declaredMatch = text.match(/\bContent\s*\((\d+)\)/i);
    if (declaredMatch) declared = Number(declaredMatch[1]);

    // Prefer the detailed editor section after the second Content marker rather
    // than the abbreviated assignment outline at the beginning of the page.
    var detailStart = text.search(/\bContent\s+1\s*Auto-Graded\b/i);
    if (detailStart < 0) detailStart = text.search(/\b1\s*Auto-Graded\b/i);
    var detail = detailStart >= 0 ? text.slice(detailStart) : text;
    var exportIdx = detail.search(/\bExport Settings\b/i);
    if (exportIdx > 0) detail = detail.slice(0, exportIdx);

    var marker = /(\d+)\s*Auto-Graded\s+([0-9]+(?:\.[0-9]+)?)\s*point(?:s)?\s+Question Type\s+(.+?)\s+Prompt\s+/gi;
    var found = [], m;
    while ((m = marker.exec(detail)) !== null) {
        found.push({ index: m.index, end: marker.lastIndex, number: Number(m[1]), points: Number(m[2]), rawType: qaAssessmentText_(m[3]) });
        if (found.length >= 200) break;
    }
    if (!found.length) return null;

    var questions = [];
    for (var i = 0; i < found.length; i++) {
        var f = found[i];
        var end = i + 1 < found.length ? found[i + 1].index : detail.length;
        var body = qaAssessmentText_(detail.slice(f.end, end));
        var prompt = body;
        var remainder = '';
        var split = body.match(/\s+(Options|Correct Answers?|Incorrect Answers?:\s*Explanation)\s+/i);
        if (split) {
            var idx = body.toLowerCase().indexOf(String(split[0]).toLowerCase());
            if (idx >= 0) {
                prompt = qaAssessmentText_(body.slice(0, idx));
                remainder = qaAssessmentText_(body.slice(idx));
            }
        }

        var options = [];
        var correctAnswers = [];
        var feedback = '';
        if (/\bOptions\b/i.test(remainder)) {
            var optionBlock = remainder.replace(/^.*?\bOptions\b\s*/i, '');
            var feedbackIdx = optionBlock.search(/\bIncorrect Answers?:\s*Explanation\b/i);
            if (feedbackIdx >= 0) {
                feedback = qaAssessmentText_(optionBlock.slice(feedbackIdx).replace(/^.*?Explanation\s*/i, ''));
                optionBlock = optionBlock.slice(0, feedbackIdx);
            }
            // Coursera's editor flattens each option followed by a Correct/Incorrect
            // badge. Treat the text before each badge as the option payload. For
            // complex multiple-select options this can include descriptive copy, so
            // comparison gives option count more weight than exact option wording.
            var badge = /\s+(Correct|Incorrect)(?!\s+(?:Selections|Answers?)(?:\b|,))(?=\s|$)/g;
            var last = 0, bm, optionIndex = 0;
            while ((bm = badge.exec(optionBlock)) !== null) {
                var chunk = qaAssessmentText_(optionBlock.slice(last, bm.index));
                if (chunk) {
                    var opt = { id: String(++optionIndex), text: chunk, correct: String(bm[1]).toLowerCase() === 'correct' };
                    options.push(opt);
                    if (opt.correct) correctAnswers.push(chunk);
                }
                last = badge.lastIndex;
            }
        } else {
            var ca = remainder.match(/Correct Answers?\s+(.+?)(?:\s+Correct\b|\s+Incorrect Answers?:|$)/i);
            if (ca && ca[1]) correctAnswers.push(qaAssessmentText_(ca[1]));
            var fb = remainder.match(/Incorrect Answers?:\s*Explanation\s+(.+)$/i);
            if (fb && fb[1]) feedback = qaAssessmentText_(fb[1]);
        }

        var typeKey = qaQuestionTypeKey_(f.rawType);
        if (typeKey === 'single-select' && options.length === 2) {
            var pair = options.map(function(o) { return o.text.toLowerCase(); }).sort().join('|');
            if (pair === 'false|true') typeKey = 'true-false';
        }
        var optionTextReliable = true;
        if (typeKey === 'multiple-select') {
            // Flat editor text is ambiguous for multi-select because legitimate option
            // labels/descriptions can contain words such as "Correct Selections" and
            // "Correct Answers". If the tokenization looks suspicious, discard option
            // answer evidence rather than inventing wrong boundaries. Native v6.5 DOM
            // extraction uses exact visual badges and does not need this fallback.
            var suspiciousMulti = options.length > 6 || !options.length || options.some(function(o) {
                var t = String(o.text || '');
                return t.length > 180 || /\bCorrect (?:Selections|Answers?)\b/i.test(t);
            });
            optionTextReliable = !suspiciousMulti;
            if (suspiciousMulti) {
                options = [];
                correctAnswers = [];
            }
        }
        questions.push({
            id: String(f.number),
            type: typeKey,
            rawType: f.rawType,
            prompt: prompt,
            options: options,
            correctAnswers: correctAnswers,
            feedback: feedback,
            points: f.points,
            optionTextReliable: optionTextReliable,
            answerTextReliable: optionTextReliable || typeKey === 'regex' || typeKey === 'text-entry',
            parserConfidence: optionTextReliable ? 0.90 : 0.84
        });
    }

    var selectionPolicy = { observed:false, selectCount:null, poolSize:null, randomSelection:null, source:'' };
    var poolMatch = text.match(/Question Pool\s*(?:[•·-]\s*)?Selecting\s+(\d+)\s+questions?\s+from\s+(\d+)/i) || text.match(/Selecting\s+(\d+)\s+questions?\s+from\s+(\d+)/i);
    if (poolMatch) selectionPolicy = { observed:true, selectCount:Number(poolMatch[1]), poolSize:Number(poolMatch[2]), randomSelection:Number(poolMatch[1]) < Number(poolMatch[2]), source:'COURsera_FLAT_TEXT' };
    var countAgreement = declared == null || declared === questions.length;
    return qaNormalizeAssessment_({
        schemaVersion: 1,
        parser: 'coursera-editor-text-v1',
        origin: 'coursera-authoring-editor',
        declaredQuestionCount: declared || questions.length,
        selectionPolicy: selectionPolicy,
        questions: questions,
        parserConfidence: countAgreement ? 0.92 : 0.76,
        warnings: countAgreement ? [] : ['Declared content count does not equal parsed question count.']
    }, 'coursera-authoring-editor');
}

function qaQuestionPromptSimilarity_(a, b) {
    a = qaAssessmentText_(a); b = qaAssessmentText_(b);
    if (!a || !b) return 0;
    var jac = qaJaccard_(a, b);
    var tri = qaCharNgramCosine_(a, b, 3);
    var contain = (a.length >= 20 && b.length >= 20 && (a.indexOf(b) > -1 || b.indexOf(a) > -1)) ? 1 : 0;
    return Math.max(contain, (jac * 0.58) + (tri * 0.42));
}

function qaQuestionTypesCompatible_(a, b) {
    a = qaQuestionTypeKey_(a); b = qaQuestionTypeKey_(b);
    if (a === b) return true;
    if ((a === 'single-select' && b === 'true-false') || (a === 'true-false' && b === 'single-select')) return true;
    if ((a === 'regex' && b === 'text-entry') || (a === 'text-entry' && b === 'regex')) return true;
    return false;
}
