import { qtiLocalName_, qtiClean_ } from "./qti.js";

export function xmlParserErrorText_(doc) {
    if (!doc) return 'XML parser returned no document.';
    try {
      var all = Array.from(doc.getElementsByTagName('*'));
      var err = all.find(function(el) { return qtiLocalName_(el) === 'parsererror'; });
      return err ? qtiClean_(err.textContent || '').slice(0, 500) : '';
    } catch (e) { return String(e && e.message || e || '').slice(0, 500); }
 }

export function repairXmlForBrowser_(raw) {
    var text = String(raw == null ? '' : raw);
    // Remove BOM plus XML-illegal C0 controls while preserving TAB/LF/CR.
    text = text.replace(/^\uFEFF/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    // XML only defines five named entities. Escape every other bare ampersand;
    // this also safely converts HTML entities such as &nbsp; into literal text.
    text = text.replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|amp;|lt;|gt;|quot;|apos;)/g, '&amp;');
    // Browser XML parsers require the declaration, when present, to be at the
    // beginning. Remove harmless leading whitespace before it.
    text = text.replace(/^\s+(<\?xml\b)/i, '$1');
    return text;
 }

export function parseXmlCompat_(raw) {
    var original = String(raw == null ? '' : raw);
    var strictDoc = null, strictError = '';
    try {
      strictDoc = new DOMParser().parseFromString(original, 'application/xml');
      strictError = xmlParserErrorText_(strictDoc);
      if (!strictError) return { doc: strictDoc, mode: 'strict-xml', repaired: false, strictError: '' };
    } catch (e) { strictError = String(e && e.message || e || 'XML parse failed.').slice(0, 500); }

    var repairedText = repairXmlForBrowser_(original);
    try {
      var repairedDoc = new DOMParser().parseFromString(repairedText, 'application/xml');
      var repairedError = xmlParserErrorText_(repairedDoc);
      if (!repairedError) {
        return { doc: repairedDoc, mode: 'repaired-xml', repaired: true, strictError: strictError, repairedText: repairedText };
      }
      return { doc: null, mode: 'record-fallback', repaired: true, strictError: strictError, repairedError: repairedError, repairedText: repairedText };
    } catch (e2) {
      return { doc: null, mode: 'record-fallback', repaired: true, strictError: strictError, repairedError: String(e2 && e2.message || e2 || '').slice(0, 500), repairedText: repairedText };
    }
 }

export function xmlElementsByLocalName_(root, localName) {
    if (!root) return [];
    var wanted = String(localName || '').toLowerCase();
    try {
      return Array.from(root.getElementsByTagName('*')).filter(function(el) { return qtiLocalName_(el) === wanted; });
    } catch (e) { return []; }
 }

export function decodeXmlAttribute_(value) {
    return String(value == null ? '' : value)
      .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
 }

export function attrFromMarkup_(markup, name) {
    var escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(?:^|\\s)' + escaped + '\\s*=\\s*(?:"([^"]*)"|\\\'([^\\\']*)\\\')', 'i');
    var m = String(markup || '').match(re);
    return m ? decodeXmlAttribute_(m[1] != null ? m[1] : m[2]) : '';
 }

export function manifestResourceRecords_(xmlString) {
    var parsed = parseXmlCompat_(xmlString);
    var records = [];
    if (parsed.doc) {
      xmlElementsByLocalName_(parsed.doc, 'resource').forEach(function(res) {
        var files = xmlElementsByLocalName_(res, 'file').map(function(fileEl) {
          return String(fileEl.getAttribute('href') || '');
        }).filter(Boolean);
        var deps = xmlElementsByLocalName_(res, 'dependency').map(function(depEl) {
          return String(depEl.getAttribute('identifierref') || '');
        }).filter(Boolean);
        var resourceHref = String(res.getAttribute('href') || '');
        records.push({
          identifier: String(res.getAttribute('identifier') || ''),
          type: String(res.getAttribute('type') || ''),
          href: resourceHref,
          files: files,
          dependencies: deps
        });
      });
      return { records: records, mode: parsed.mode, repaired: parsed.repaired, strictError: parsed.strictError || '' };
    }

    // Last-resort manifest-only reader. It intentionally extracts only resource
    // identity/type and nested file hrefs; it does not try to interpret course
    // structure. The original untouched manifest is still sent to Apps Script
    // for the authoritative course-tree parse.
    var text = String(parsed.repairedText || repairXmlForBrowser_(xmlString));
    var resourceRe = /<(?:[A-Za-z_][\w.-]*:)?resource\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?resource\s*>/gi;
    var rm;
    while ((rm = resourceRe.exec(text)) && records.length < 25000) {
      var attrs = rm[1] || '', body = rm[2] || '';
      var fileHrefs = [];
      var fileRe = /<(?:[A-Za-z_][\w.-]*:)?file\b([^>]*)\/?\s*>/gi;
      var fm;
      while ((fm = fileRe.exec(body)) && fileHrefs.length < 5000) {
        var href = attrFromMarkup_(fm[1] || '', 'href');
        if (href) fileHrefs.push(href);
      }
      var depIds = [];
      var depRe = /<(?:[A-Za-z_][\w.-]*:)?dependency\b([^>]*)\/?\s*>/gi;
      var dm;
      while ((dm = depRe.exec(body)) && depIds.length < 5000) {
        var identifierref = attrFromMarkup_(dm[1] || '', 'identifierref');
        if (identifierref) depIds.push(identifierref);
      }
      var identifier = attrFromMarkup_(attrs, 'identifier');
      if (identifier) records.push({
        identifier: identifier,
        type: attrFromMarkup_(attrs, 'type'),
        href: attrFromMarkup_(attrs, 'href'),
        files: fileHrefs,
        dependencies: depIds
      });
    }
    return {
      records: records,
      mode: 'record-fallback',
      repaired: true,
      strictError: parsed.strictError || '',
      repairedError: parsed.repairedError || ''
    };
 }
