import { uniqueStrings_, resolveZipHref_ } from "./zip.js";
import { parseXmlCompat_ } from "./xml.js";

export function qtiClean_(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
 }

export function sourceLearnerMarkupText_(value) {
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

export function qtiLearnerNodeText_(node) {
    var raw = String(node && node.textContent || '');
    var kind = String(node && node.getAttribute('texttype') || '').toLowerCase();
    var tag = String(node && (node.localName || node.nodeName) || '').toLowerCase();
    // QTI2 prompt/simpleChoice textContent is already DOM-decoded. QTI1
    // mattext and Common Cartridge discussion text may contain escaped HTML.
    return kind === 'text/html' || (!kind && /^(mattext|text)$/.test(tag)) ? sourceLearnerMarkupText_(raw) : qtiClean_(raw);
 }

export function qtiLocalName_(el) {
    return String((el && (el.localName || el.nodeName)) || '').toLowerCase().replace(/^.*:/, '');
 }

export function qtiDesc_(root, localName) {
    if (!root) return [];
    return Array.from(root.getElementsByTagName('*')).filter(function(el) { return qtiLocalName_(el) === String(localName || '').toLowerCase(); });
 }

export function qtiHasAncestor_(el, names, stopAt) {
    names = names || [];
    var cur = el && el.parentElement;
    while (cur && cur !== stopAt) {
      if (names.indexOf(qtiLocalName_(cur)) > -1) return true;
      cur = cur.parentElement;
    }
    return false;
 }

export function qtiOptionText_(el) {
    if (!el) return '';
    var mat = qtiDesc_(el, 'mattext');
    if (mat.length) return qtiClean_(mat.map(function(x) { return x.textContent || ''; }).join(' '));
    return qtiClean_(el.textContent || '');
 }

export function qtiOptionParts_(el) {
    if (!el) return { label:'', description:'', text:'', aliases:[] };
    var explicitLabel = qtiClean_(el.getAttribute('label') || el.getAttribute('title') || '');
    var segments = [];
    var mat = qtiDesc_(el, 'mattext');
    mat.forEach(function(node) {
      var raw = String(node.textContent || '');
      // Some QTI stores rich HTML inside MATTEXT as escaped markup. Preserve
      // block boundaries so title/label and explanatory body do not collapse.
      if (String(node.getAttribute('texttype') || '').toLowerCase() !== 'text/plain' && /<\/?(?:p|div|strong|b|h[1-6]|span|br)\b/i.test(raw)) {
        try {
          var hdoc = new DOMParser().parseFromString(raw, 'text/html');
          var blocks = Array.from(hdoc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,div'))
            .map(function(n) { return qtiClean_(n.textContent || ''); }).filter(Boolean);
          if (blocks.length) segments = segments.concat(blocks);
          else if (qtiClean_(hdoc.body.textContent || '')) segments.push(qtiClean_(hdoc.body.textContent || ''));
        } catch (e) { if (qtiLearnerNodeText_(node)) segments.push(qtiLearnerNodeText_(node)); }
      } else if (qtiLearnerNodeText_(node)) segments.push(qtiLearnerNodeText_(node));
    });
    if (!segments.length) {
      var full = qtiClean_(el.textContent || '');
      if (full) segments.push(full);
    }
    segments = uniqueStrings_(segments, 20);
    var fullText = qtiClean_(segments.join(' '));
    var label = explicitLabel, description = '';
    if (!label && segments.length >= 2 && segments[0].length <= 220) {
      label = segments[0];
      description = qtiClean_(segments.slice(1).join(' '));
    } else if (!label) {
      var marker = fullText.match(/\bDescription\s*:\s*/i);
      if (marker && marker.index != null) {
        label = qtiClean_(fullText.slice(0, marker.index));
        description = qtiClean_(fullText.slice(marker.index + marker[0].length));
      } else label = fullText;
    } else {
      description = qtiClean_(segments.filter(function(s) { return s !== label; }).join(' '));
    }
    return { label:label, description:description, text:fullText || qtiClean_([label, description].filter(Boolean).join(' ')), aliases:[] };
 }

export function qtiMediaPresence_(refs,sourceFile,zipLookup) {
    return (refs||[]).map(function(ref){
      var expected=resolveZipHref_(sourceFile,ref),exact=expected&&zipLookup[expected.toLowerCase()];
      if(!expected)return {ref:ref,status:'EXTERNAL_OR_EMBEDDED',expectedPath:'',candidates:[]};
      if(exact)return {ref:ref,status:'PRESENT_AT_REFERENCE',expectedPath:expected,candidates:[exact]};
      var name=expected.split('/').pop().toLowerCase(),candidates=Object.keys(zipLookup).filter(function(k){return k.split('/').pop()===name;}).map(function(k){return zipLookup[k];});
      return {ref:ref,status:candidates.length?'PRESENT_DIFFERENT_PATH':'NOT_IN_PACKAGE',expectedPath:expected,candidates:candidates};
    });
 }

export function qtiQuestionMediaRefs_(item) {
    var refs=qtiDesc_(item,'matimage').map(function(el){return el.getAttribute('uri')||el.getAttribute('src')||'';}).filter(Boolean);
    qtiDesc_(item,'img').forEach(function(el){var src=el.getAttribute('src');if(src)refs.push(src);});
    qtiDesc_(item,'mattext').forEach(function(el){
      var raw=String(el.textContent||'');if(!/<(?:img|video|audio|iframe|embed)\b/i.test(raw))return;
      try{var doc=new DOMParser().parseFromString(raw,'text/html');Array.from(doc.querySelectorAll('img[src],video[src],audio[src],iframe[src],embed[src]')).forEach(function(node){var src=node.getAttribute('src');if(src)refs.push(src);});}catch(e){}
    });
    return uniqueStrings_(refs,100);
 }

export function qtiQuestionType_(item, options) {
    var responseLid = qtiDesc_(item, 'response_lid')[0];
    var responseStr = qtiDesc_(item, 'response_str')[0];
    var choiceInteraction = qtiDesc_(item, 'choiceinteraction')[0];
    var textEntry = qtiDesc_(item, 'textentryinteraction')[0] || qtiDesc_(item, 'extendedtextinteraction')[0];
    var type = 'unknown';
    // response_str is used by both fill-in and essay questions in QTI 1.x.
    // Trust the explicit CC profile or QTI2 extended interaction, never prompt wording.
    var profiles=qtiDesc_(item,'qtimetadatafield').filter(function(f){
      var label=qtiDesc_(f,'fieldlabel')[0];return label&&qtiClean_(label.textContent||'').toLowerCase()==='cc_profile';
    }).map(function(f){var entry=qtiDesc_(f,'fieldentry')[0];return entry?qtiClean_(entry.textContent||'').toLowerCase():'';});
    if(!choiceInteraction&&!responseLid && (qtiDesc_(item,'extendedtextinteraction').length || profiles.indexOf('cc.essay.v0p1')>=0))return 'essay';
    if (choiceInteraction) {
      var responseIdentifier = String(choiceInteraction.getAttribute('responseIdentifier') || choiceInteraction.getAttribute('responseidentifier') || '');
      var matchingDecl = qtiDesc_(item, 'responsedeclaration').find(function(decl) {
        return !responseIdentifier || String(decl.getAttribute('identifier') || '') === responseIdentifier;
      });
      var declaredCardinality = String(matchingDecl ? (matchingDecl.getAttribute('cardinality') || '') : '').toLowerCase();
      var maxChoicesAttr = choiceInteraction.getAttribute('maxChoices') || choiceInteraction.getAttribute('maxchoices');
      var maxChoices = maxChoicesAttr == null || maxChoicesAttr === '' ? 1 : Number(maxChoicesAttr);
      type = declaredCardinality === 'multiple' || maxChoices === 0 || maxChoices > 1 ? 'multiple-select' : 'single-select';
    } else if (responseLid) {
      var card = String(responseLid.getAttribute('rcardinality') || responseLid.getAttribute('cardinality') || '').toLowerCase();
      type = card.indexOf('multiple') > -1 ? 'multiple-select' : 'single-select';
    } else if (responseStr || textEntry) {
      var raw = qtiClean_(item.textContent || '').toLowerCase();
      type = /regex|regular expression|varsubstring/.test(raw) ? 'regex' : 'text-entry';
    }
    if (type === 'single-select' && options && options.length === 2) {
      var pair = options.map(function(o) { return String(o.text || '').toLowerCase(); }).sort().join('|');
      if (pair === 'false|true') type = 'true-false';
    }
    return type;
 }

export function parseQtiAssessmentStructure_(xmlText, fileName) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) throw new Error("QTI XML declarations are unsupported.");
    var qtiParsed = parseXmlCompat_(xmlText);
    var doc = qtiParsed && qtiParsed.doc;
    // QTI semantics require a real XML DOM. The manifest can use a record
    // fallback, but individual QTI files stay conservative if repair still fails.
    if (!doc) return null;

    var all = Array.from(doc.getElementsByTagName('*'));
    var items = all.filter(function(el) {
      var n = qtiLocalName_(el);
      return n === 'assessmentitem' || n === 'item';
    });
    if (!items.length) return null;

    var questions = [];
    var warnings = [];
    items.slice(0, 250).forEach(function(item, idx) {
      var itemId = item.getAttribute('identifier') || item.getAttribute('ident') || String(idx + 1);
      var itemTitle = item.getAttribute('title') || '';

      var optionNodes = qtiDesc_(item, 'simplechoice');
      if (!optionNodes.length) optionNodes = qtiDesc_(item, 'response_label');
      var options = optionNodes.map(function(el, oi) {
        var parts = qtiOptionParts_(el);
        return {
          id: el.getAttribute('identifier') || el.getAttribute('ident') || String(oi + 1),
          label: parts.label,
          description: parts.description,
          text: parts.text,
          aliases: parts.aliases || [],
          correct: null
        };
      }).filter(function(o) { return o.text || o.label || o.description; });

      var prompt = '';
      var promptNode = qtiDesc_(item, 'prompt')[0];
      if (promptNode) prompt = qtiLearnerNodeText_(promptNode);
      if (!prompt) {
        var presentation = qtiDesc_(item, 'presentation')[0] || item;
        var promptParts = qtiDesc_(presentation, 'mattext').filter(function(el) {
          return !qtiHasAncestor_(el, ['response_label','itemfeedback','feedback','solution'], presentation);
        }).map(function(el) { return qtiLearnerNodeText_(el); }).filter(Boolean);
        if (promptParts.length) prompt = qtiClean_(promptParts.join(' '));
      }
      if (!prompt) {
        var body = qtiDesc_(item, 'itembody')[0];
        if (body) {
          var clone = body.cloneNode(true);
          Array.from(clone.querySelectorAll('simpleChoice, simplechoice, response_label')).forEach(function(el) { el.remove(); });
          prompt = qtiClean_(clone.textContent || '');
        }
      }
      if (!prompt) prompt = qtiClean_(itemTitle);

      var correctIds = [];
      var responseDecls = qtiDesc_(item, 'responsedeclaration');
      responseDecls.forEach(function(decl) {
        qtiDesc_(decl, 'correctresponse').forEach(function(cr) {
          qtiDesc_(cr, 'value').forEach(function(v) { var t = qtiClean_(v.textContent || ''); if (t) correctIds.push(t); });
        });
      });

      // QTI 1.x: only positive SCORE Set/Add branches can identify selected
      // answers. NOT(varequal) constrains an option to be unselected.
      var answerTextReliable = true;
      var declaredCorrectResponse = correctIds.length > 0;
      if (!declaredCorrectResponse) qtiDesc_(item, 'respcondition').forEach(function(cond) {
        var scoreVars = qtiDesc_(cond, 'setvar').filter(function(sv) {
          return String(sv.getAttribute('varname') || 'SCORE').toUpperCase() === 'SCORE';
        });
        var positiveScore = scoreVars.some(function(sv) {
          var n = Number(qtiClean_(sv.textContent || ''));
          var action = String(sv.getAttribute('action') || 'Set').toLowerCase();
          return Number.isFinite(n) && n > 0 && (action === 'set' || action === 'add');
        });
        var correctFeedback = !scoreVars.length && qtiDesc_(cond, 'displayfeedback').some(function(df) {
          var ref = String(df.getAttribute('linkrefid') || '').toLowerCase();
          return /(^|[^a-z])(correct|right|success)([^a-z]|$)/.test(ref);
        });
        if (!positiveScore && !correctFeedback) return;
        var response = qtiDesc_(item, 'response_lid')[0] || qtiDesc_(item, 'response_str')[0];
        var responseId = response ? String(response.getAttribute('ident') || '') : '';
        var selected = [], excluded = [], supported = true;
        function visitCondition(node) {
          var tag = qtiLocalName_(node);
          var children = Array.from(node.children || []);
          if (tag === 'conditionvar' || tag === 'and') {
            children.forEach(visitCondition);
          } else if (tag === 'varequal') {
            var id = qtiClean_(node.textContent || '');
            var ref = String(node.getAttribute('respident') || '');
            if (!id || (responseId && ref && ref !== responseId)) supported = false;
            else selected.push(id);
          } else if (tag === 'not' && children.length === 1 && qtiLocalName_(children[0]) === 'varequal') {
            var neg = children[0];
            var negId = qtiClean_(neg.textContent || '');
            var negRef = String(neg.getAttribute('respident') || '');
            if (!negId || (responseId && negRef && negRef !== responseId)) supported = false;
            else excluded.push(negId);
          } else {
            // OR/extension/nested negation cannot safely become one answer set.
            supported = false;
          }
        }
        var conditions = qtiDesc_(cond, 'conditionvar');
        if (conditions.length !== 1) supported = false;
        else visitCondition(conditions[0]);
        if (selected.some(function(id) { return excluded.indexOf(id) !== -1; })) supported = false;
        if (supported && (selected.length || excluded.length)) correctIds = correctIds.concat(selected);
        else {
          answerTextReliable = false;
          warnings.push('Question ' + itemId + ': scoring condition needs manual answer-key verification.');
        }
      });
      correctIds = Array.from(new Set(correctIds));

      var correctAnswers = [];
      correctIds.forEach(function(id) {
        var opt = options.find(function(o) { return String(o.id) === String(id); });
        correctAnswers.push(opt ? (opt.label || opt.text) : id);
      });
      options.forEach(function(o) { o.correct = correctIds.length ? (correctIds.indexOf(String(o.id)) > -1) : null; });

      var points = null;
      var decvar = qtiDesc_(item, 'decvar')[0];
      if (decvar) {
        var maxv = decvar.getAttribute('maxvalue') || decvar.getAttribute('maxValue');
        if (maxv != null && maxv !== '' && Number.isFinite(Number(maxv))) points = Number(maxv);
      }
      if (points == null) {
        var outcomes = qtiDesc_(item, 'outcomedeclaration');
        for (var od = 0; od < outcomes.length; od++) {
          var ident = String(outcomes[od].getAttribute('identifier') || '').toUpperCase();
          var normal = outcomes[od].getAttribute('normalMaximum') || outcomes[od].getAttribute('normalmaximum');
          if ((ident === 'SCORE' || !ident) && normal != null && Number.isFinite(Number(normal))) { points = Number(normal); break; }
        }
      }

      var feedbackParts = [];
      ['itemfeedback','modalfeedback','feedbackblock','feedbackinline'].forEach(function(tag) {
        qtiDesc_(item, tag).forEach(function(el) { var t = qtiClean_(el.textContent || ''); if (t) feedbackParts.push(t); });
      });

      questions.push({
        id: String(itemId),
        sourceOrdinal: idx + 1,
        title: qtiClean_(itemTitle),
        type: qtiQuestionType_(item, options),
        mediaRefs:qtiQuestionMediaRefs_(item),
        sourceTypeEvidence:{method:'QTI_RESPONSE_AND_CC_PROFILE',profiles:qtiDesc_(item,'qtimetadatafield').filter(function(f){var n=qtiDesc_(f,'fieldlabel')[0];return n&&qtiClean_(n.textContent||'').toLowerCase()==='cc_profile';}).map(function(f){var n=qtiDesc_(f,'fieldentry')[0];return n?qtiClean_(n.textContent||''):'';})},
        prompt: prompt,
        options: options,
        correctAnswers: Array.from(new Set(correctAnswers.filter(Boolean))),
        feedback: qtiClean_(feedbackParts.join(' ')),
        points: points,
        answerTextReliable: answerTextReliable && correctIds.length > 0,
        parserConfidence: answerTextReliable ? (correctIds.length || !options.length ? 0.95 : 0.84) : 0.65,
        sourceFile: String(fileName || '')
      });
    });

    if (!questions.length) return null;
    // Counts belong to selection scopes. Repeated values in different sections
    // are separate draws; nested/overlapping rules cannot safely be summed.
    var rules = [], invalidSelection = false;
    function selectionRule(el, raw) {
      var n = Number(raw);
      if (raw === '' || !Number.isInteger(n) || n < 0) { invalidSelection = true; return; }
      var scope = el.parentElement;
      while (scope && !/^(section|assessmentsection|assessment|assessmenttest)$/.test(qtiLocalName_(scope))) scope = scope.parentElement;
      var pool = scope ? items.filter(function(item) { return scope.contains(item); }) : [];
      rules.push({ count:n, pool:pool });
    }
    qtiDesc_(doc, 'selection_number').concat(qtiDesc_(doc, 'selectionnumber')).forEach(function(el) {
      selectionRule(el, qtiClean_(el.textContent || ''));
    });
    qtiDesc_(doc, 'selection').forEach(function(el) {
      var raw = el.getAttribute('select') ?? el.getAttribute('selectionNumber') ?? el.getAttribute('selectionnumber');
      if (raw != null) selectionRule(el, raw);
    });
    var selectionNumbers = rules.map(function(rule) { return rule.count; });
    var selectedPool = new Set(), selectCount = null;
    rules.forEach(function(rule) {
      if (!rule.pool.length || rule.count > rule.pool.length) invalidSelection = true;
      rule.pool.forEach(function(item) {
        if (selectedPool.has(item)) invalidSelection = true;
        selectedPool.add(item);
      });
    });
    if (rules.length && !invalidSelection) selectCount = items.length - selectedPool.size + selectionNumbers.reduce(function(a,b) { return a+b; },0);
    if (invalidSelection) warnings.push('Selection scopes are incomplete, overlapping or unsupported; learner question count requires verification.');
    if (items.length > questions.length) warnings.push('Question capture limited to ' + questions.length + ' of ' + items.length + ' declared definitions.');
    var selectionPolicy = {
      observed: selectionNumbers.length > 0 || invalidSelection,
      selectCount: selectCount,
      poolSize: items.length,
      randomSelection: selectCount != null ? selectCount < items.length : null,
      rawSelectionCounts: selectionNumbers.slice(0,20),
      source: 'IMS_QTI_SELECTION_RULE'
    };
    return {
      schemaVersion: 3,
      parser: 'ims-qti-dom-v6-coverage-scopes',
      origin: 'source-imscc',
      declaredQuestionCount: items.length,
      sourceCounts: [{ sourceFile:String(fileName || ""), declared:items.length, captured:questions.length }],
      captureCompleteness: { questionCoverageComplete: items.length === questions.length },
      questionCount: questions.length,
      selectionPolicy: selectionPolicy,
      questions: questions,
      parserConfidence: questions.reduce(function(sum, q) { return sum + Number(q.parserConfidence || 0); }, 0) / questions.length,
      warnings: warnings
    };
 }

export function mergeStructuredAssessment_(base, incoming) {
    if (!incoming || !Array.isArray(incoming.questions) || !incoming.questions.length) return base || null;
    // Never mutate a dependency's assessment: several parents can share it.
    if (!base || !Array.isArray(base.questions)) return structuredClone(incoming);
    var merged = structuredClone(base);
    function identity(q) { return JSON.stringify([q.sourceFile || '', q.sourceOrdinal ?? null, q.id || '', qtiClean_(q.prompt || '').toLowerCase()]); }
    var seen = new Set(merged.questions.map(identity));
    incoming.questions.forEach(function(q) {
      var key = identity(q);
      if (!seen.has(key)) { seen.add(key); merged.questions.push(structuredClone(q)); }
    });
    var counts = new Map();
    (base.sourceCounts || []).concat(incoming.sourceCounts || []).forEach(function(c) { counts.set(c.sourceFile, c); });
    merged.sourceCounts = Array.from(counts.values());
    merged.questionCount = merged.questions.length;
    merged.declaredQuestionCount = Math.max(Number(base.declaredQuestionCount || 0), Number(incoming.declaredQuestionCount || 0), merged.questionCount, merged.sourceCounts.reduce(function(n,c) { return n + c.declared; },0));
    merged.captureCompleteness = { questionCoverageComplete: merged.declaredQuestionCount === merged.questionCount && base.captureCompleteness?.questionCoverageComplete !== false && incoming.captureCompleteness?.questionCoverageComplete !== false };
    // A merged dependency bank is not evidence of how many a learner is assigned.
    if (merged.sourceCounts.length > 1 || JSON.stringify(base.selectionPolicy) !== JSON.stringify(incoming.selectionPolicy)) {
      merged.selectionPolicy = { observed:!!(base.selectionPolicy?.observed || incoming.selectionPolicy?.observed), selectCount:null, poolSize:merged.declaredQuestionCount, randomSelection:null, source:'MULTIPLE_QTI_FILES_REQUIRES_REVIEW' };
    }
    merged.parserConfidence = Math.min(Number(base.parserConfidence ?? 0.9), Number(incoming.parserConfidence ?? 0.9));
    merged.warnings = uniqueStrings_([...(base.warnings || []), ...(incoming.warnings || [])], 20);
    return merged;
 }
