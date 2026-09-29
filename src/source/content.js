import { parseXmlCompat_ } from "./xml.js";
import { qtiLocalName_, qtiLearnerNodeText_ } from "./qti.js";
import { uniqueStrings_ } from "./zip.js";

export function isTechnicalSourceUrl_(raw) {
    raw = String(raw || '').trim().toLowerCase();
    if (!raw) return true;
    return /(?:imsglobal\.org\/(?:xsd|profile\/cc)|w3\.org\/2001\/(?:xmlschema|xmlschema-instance)|imsccv\d|ccv\d.*\.xsd|imswl_v\d.*\.xsd)/i.test(raw);
 }

export function extractTextEvidence_(text, extension) {
    text = String(text || '');
    var normalizedText = text.replace(/\s+/g, ' ').trim();
    var links = [], images = [], refs = [], assignmentFormats = [], declaredAttachments = [];
    var ext = String(extension || '').toLowerCase();

    if (ext === 'html' || ext === 'htm' || ext === 'xhtml') {
      try {
        var doc = new DOMParser().parseFromString(text, 'text/html');
        Array.from(doc.querySelectorAll('script,style,noscript,template')).forEach(function(el){el.remove();});
        normalizedText = String(doc.body ? doc.body.textContent : doc.documentElement.textContent || '').replace(/\s+/g, ' ').trim();
        Array.from(doc.querySelectorAll('a[href]')).forEach(function(el) { var href = el.getAttribute('href'); if (href && !isTechnicalSourceUrl_(href)) links.push(href); });
        Array.from(doc.querySelectorAll('img[src],source[src],video[src],audio[src]')).forEach(function(el) {
          var src = el.getAttribute('src'); if (src) images.push(src);
        });
        Array.from(doc.querySelectorAll('iframe[src],embed[src]')).forEach(function(el){
          var src=el.getAttribute('src');if(src){refs.push(src);if(/^https?:\/\//i.test(src)&&!isTechnicalSourceUrl_(src))links.push(src);}
        });
        Array.from(doc.querySelectorAll('object[data]')).forEach(function(el) { var src = el.getAttribute('data'); if (src) images.push(src); });
      } catch (e) {}
    } else if (ext === 'xml') {
      // Use the same compatibility parser as QTI/manifest scanning. A parse
      // failure must never silently promote raw XML to learner content.
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Source XML declarations are unsupported for learner-text extraction.');
      var parsedXml = parseXmlCompat_(text);
      if (!parsedXml.doc) throw new Error('Source XML learner-text extraction failed: ' + String(parsedXml.repairedError || parsedXml.strictError || 'invalid XML'));
      var xdoc = parsedXml.doc;
      var elements = Array.from(xdoc.getElementsByTagName('*'));
      var root = xdoc.documentElement;
      var semanticNodes = elements.filter(function(el) { return /^(title|description|text|mattext|prompt|instructions?|label|name)$/.test(qtiLocalName_(el)); });
      if (qtiLocalName_(root) === 'topic') {
        var ns = String(root.namespaceURI || '');
        if (!/^https?:\/\/www\.imsglobal\.org\/xsd\/imsccv[\dp]+\/imsdt_v[\dp]+\/?$/.test(ns)) throw new Error('Unsupported discussion XML namespace.');
        var children = Array.from(root.children || []);
        var bodies = children.filter(function(el) { return qtiLocalName_(el) === 'text' && el.namespaceURI === ns; });
        var titles = children.filter(function(el) { return qtiLocalName_(el) === 'title' && el.namespaceURI === ns; });
        if (bodies.length !== 1 || titles.length > 1 || bodies[0].children.length || (titles.length && titles[0].children.length)) throw new Error('Unsupported discussion XML learner-text structure.');
        if (!/^(text\/html|text\/plain)$/i.test(String(bodies[0].getAttribute('texttype') || ''))) throw new Error('Unsupported discussion learner-text type.');
        semanticNodes = titles.concat(bodies);
      }
      if(qtiLocalName_(root)==='assignment') {
        var assignmentNs=String(root.namespaceURI||'');
        if(!/^https?:\/\/www\.imsglobal\.org\/xsd\/imscc_extensions\/assignment\/?$/.test(assignmentNs))throw new Error('Unsupported assignment XML namespace.');
        var assignmentChildren=Array.from(root.children||[]);
        var assignmentBodies=assignmentChildren.filter(function(el){return qtiLocalName_(el)==='instructor_text'&&el.namespaceURI===assignmentNs;});
        var assignmentTitles=assignmentChildren.filter(function(el){return qtiLocalName_(el)==='title'&&el.namespaceURI===assignmentNs;});
        if(assignmentBodies.length!==1 || assignmentTitles.length>1 || assignmentBodies[0].children.length || (assignmentTitles.length&&assignmentTitles[0].children.length))throw new Error('Unsupported assignment XML instruction structure.');
        if(!/^text\/(?:html|plain)$/i.test(String(assignmentBodies[0].getAttribute('texttype')||'')))throw new Error('Unsupported assignment instruction text type.');
        semanticNodes=assignmentTitles.concat(assignmentBodies);
        elements.filter(function(el){return qtiLocalName_(el)==='attachment'&&el.namespaceURI===assignmentNs;}).forEach(function(el){
          var href=String(el.getAttribute('href')||'').trim();
          if(href)declaredAttachments.push({href:href,role:String(el.getAttribute('role')||'')});
        });
        assignmentChildren.filter(function(el){return qtiLocalName_(el)==='submission_formats'&&el.namespaceURI===assignmentNs;}).forEach(function(container){Array.from(container.children||[]).forEach(function(el){if(qtiLocalName_(el)==='format'&&el.namespaceURI===assignmentNs)assignmentFormats.push(String(el.getAttribute('type')||''));});});
      }
      normalizedText = semanticNodes.map(qtiLearnerNodeText_).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      elements.forEach(function(el) {
        Array.from(el.attributes || []).forEach(function(attr) {
          var attrName = String(attr.name || '').toLowerCase();
          var value = String(attr.value || '').trim();
          if (!value || /xmlns|schema(?:location)?/.test(attrName)) return;
          if (/^https?:\/\//i.test(value) && !isTechnicalSourceUrl_(value)) links.push(value);
        });
      });
    } else {
      var urlMatches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
      links = links.concat(urlMatches.filter(function(url) { return !isTechnicalSourceUrl_(url); }));
    }

    var fileMatches = text.match(/[^\s"'<>]+\.(?:pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|mp4|webm|mp3|wav|m4a)(?:\?[^\s"'<>]*)?/gi) || [];
    refs = refs.concat(fileMatches);
    return {
      normalizedText: normalizedText,
      assignmentFormats: assignmentFormats,
      declaredAttachments: declaredAttachments,
      links: uniqueStrings_(links.filter(function(url) { return !isTechnicalSourceUrl_(url); }), 200),
      images: uniqueStrings_(images, 200),
      refs: uniqueStrings_(refs, 300)
    };
 }

export function sourceBehaviorEvidence_(resourceType, rawText, fileNames) {
    var type = String(resourceType || '').toLowerCase();
    var text = String(rawText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    var low = text.toLowerCase();
    var behavior = { observed:false, source:'IMSCC_EXPLICIT_METADATA', submission:{}, settings:{}, evidence:[] };
    function hit(key, value, evidence) { if (value) { behavior.observed = true; behavior.submission[key] = true; if (evidence) behavior.evidence.push(evidence); } }
    if (type.indexOf('assignment') > -1 || /\bassignment\b/.test(low)) {
      hit('fileUpload', /\bfile[ _-]+(?:upload|submission)\b|\bsubmit(?:ted)?[ _-]+(?:a[ _-]+)?file\b/i.test(text), 'Explicit file-submission phrase in exported assignment metadata.');
      hit('textSubmission', /\btext[ _-]+submission\b|\binline[ _-]+text\b/i.test(text), 'Explicit text-submission phrase in exported assignment metadata.');
    }
    var attempts = text.match(/\b(?:attempts?|submissions?)\s*[:=]?\s*(unlimited|\d+)\b/i);
    if (attempts) { behavior.observed=true; behavior.settings.attempts=attempts[1]; behavior.evidence.push('Explicit attempts/submissions value in source metadata.'); }
    var points = text.match(/\b(?:grade\s+out\s+of|points?)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i);
    if (points) { behavior.observed=true; behavior.settings.points=Number(points[1]); behavior.evidence.push('Explicit source point value.'); }
    behavior.fileNames = (fileNames || []).slice(0,40);
    return behavior;
 }

export function sourceInteractiveSignals_(resourceType, files, resourceHref) {
    var explicit=[], supporting=[], practice=[];
    var type = String(resourceType || '').toLowerCase();
    var href = String(resourceHref || '').toLowerCase().replace(/\\/g,'/');
    var families=[];
    function family(name) { if (families.indexOf(name) === -1) families.push(name); }

    if (/scorm|adlcp/.test(type) || /(?:^|\/)(?:scorm|scormengine|index_lms\.html)(?:\/|$|[?#])/.test(href)) { family('SCORM'); explicit.push(resourceType || resourceHref || 'SCORM manifest marker'); }
    if (/aicc/.test(type)) { family('AICC'); explicit.push(resourceType || 'AICC manifest marker'); }
    if (/tincan|xapi/.test(type) || /tincan\.xml/.test(href)) { family('TINCAN_XAPI'); explicit.push(resourceType || resourceHref || 'TinCan/xAPI marker'); }

    (files || []).forEach(function(raw) {
      var f=String(raw || '').toLowerCase().replace(/\\/g,'/');
      if (/\.practice\.json(?:$|[?#])/.test(f)) { practice.push(raw); family('D2L_PRACTICE_RUNTIME'); }
      if (/(?:^|\/)(?:story\.html|index_lms\.html|tincan\.xml)(?:$|[?#])/.test(f) || /(?:storyline|scorm2004|scorm_?1\.2|scormdriver|articulate|\/rise(?:\/|[-_.]))/.test(f)) {
        explicit.push(raw);
        if (/storyline|story\.html|story_content/.test(f)) family('STORYLINE');
        if (/articulate|\/rise(?:\/|[-_.])/.test(f)) family('RISE_ARTICULATE');
        if (/scorm|index_lms\.html/.test(f)) family('SCORM');
        if (/tincan\.xml/.test(f)) family('TINCAN_XAPI');
      } else if (/\/(?:story_content|scorm|tincan|lms)\//.test(f) || /(?:player|launcher|launch)\.(?:html?|js)(?:$|[?#])/.test(f)) supporting.push(raw);
    });
    explicit=uniqueStrings_(explicit,20); supporting=uniqueStrings_(supporting,20); practice=uniqueStrings_(practice,20);
    var detected = explicit.length > 0 || supporting.length >= 3 || practice.length > 0 || families.length > 0;
    return {
      detected: detected,
      confidence: explicit.length ? 'HIGH' : ((supporting.length >= 3 || practice.length) ? 'MEDIUM' : 'LOW'),
      runtimeFamilies: families,
      explicitMarkers: explicit,
      supportingMarkers: supporting,
      practiceConfigMarkers: practice,
      launchHref: resourceHref || '',
      runtimeVerificationRequired: detected,
      note: explicit.length ? 'Explicit interactive runtime/package marker observed in this IMSCC resource.' : (practice.length ? 'D2L .practice.json runtime dependency observed; validate the visible parent interaction rather than treating the config as a standalone learner item.' : (supporting.length >= 3 ? 'Multiple package-runtime markers observed; interactive carrier is plausible but not fully typed.' : 'No strong interactive runtime signature found in this resource.'))
    };
 }
