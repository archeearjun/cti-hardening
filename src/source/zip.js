

export function normalizeZipPath_(value) {
    var parts = String(value || '').replace(/\\/g, '/').split('/'), stack = [];
    parts.forEach(function(part) {
      if (!part || part === '.') return;
      if (part === '..') { if (stack.length) stack.pop(); return; }
      stack.push(part);
    });
    return stack.join('/');
 }

export function resolveZipHref_(manifestPath, href) {
    href = String(href || '').trim();
    if (!href || /^(https?:|mailto:|data:|javascript:|#)/i.test(href)) return null;
    var cleanHref = href.split('#')[0].split('?')[0];
    try { cleanHref = decodeURIComponent(cleanHref); } catch (e) {}
    var slash = String(manifestPath || '').lastIndexOf('/');
    var base = slash > -1 ? manifestPath.slice(0, slash + 1) : '';
    return normalizeZipPath_(base + cleanHref);
 }

export function resolveZipEntryV8_(zipLookup, zipPaths, manifestPath, href) {
    if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(String(href||'').trim()))return {path:null,method:'EXTERNAL_REFERENCE',ambiguous:false,resolved:null};
    var resolved = resolveZipHref_(manifestPath, href);
    var tried = [], seen = Object.create(null);
    function add(v, method) {
      v = normalizeZipPath_(String(v || ''));
      if (!v) return;
      var k = v.toLowerCase();
      if (seen[k]) return;
      seen[k] = true; tried.push({key:k, path:v, method:method});
    }
    add(resolved, 'EXACT_NORMALIZED');
    var raw = String(href || '').split('#')[0].split('?')[0];
    try { add(resolveZipHref_(manifestPath, decodeURIComponent(raw)), 'URL_DECODED'); } catch (e) {}
    // D2L packages can serialize a semicolon-delimited virtual segment with the
    // slash on the ZIP side but not in the manifest (or vice versa).
    (tried.slice()).forEach(function(c) {
      add(c.path.replace(/;([^/])/g, ';/$1'), 'SEMICOLON_SLASH_NORMALIZED');
      add(c.path.replace(/;\//g, ';'), 'SEMICOLON_SLASH_NORMALIZED');
    });
    for (var i=0;i<tried.length;i++) {
      if((zipPaths||[]).indexOf(tried[i].path)>-1)return {path:tried[i].path,method:tried[i].method,ambiguous:false,resolved:tried[i].path};
      var matching=(zipPaths||[]).filter(function(p){return normalizeZipPath_(p).toLowerCase()===tried[i].key;});
      if(matching.length===1)return {path:matching[0],method:tried[i].method,ambiguous:false,resolved:tried[i].path};
      if(matching.length>1)return {path:null,method:'AMBIGUOUS_PATH',ambiguous:true,candidates:matching.slice(0,12),resolved:tried[i].path};
    }
    var clean = raw.replace(/\\/g,'/');
    try { clean = decodeURIComponent(clean); } catch (e) {}
    var baseName = clean.split('/').pop();
    if (baseName) {
      var lower = baseName.toLowerCase();
      var candidates = (zipPaths || []).filter(function(p) {
        var n = String(p || '').replace(/\\/g,'/').split('/').pop().toLowerCase();
        return n === lower;
      });
      if (candidates.length === 1) return {path:candidates[0],method:'UNIQUE_BASENAME_FALLBACK',ambiguous:false,resolved:resolved||clean};
      if (candidates.length > 1) return {path:null,method:'AMBIGUOUS_BASENAME',ambiguous:true,candidates:candidates.slice(0,12),resolved:resolved||clean};
    }
    return {path:null,method:'UNRESOLVED',ambiguous:false,resolved:resolved||clean};
 }

export function uniqueStrings_(values, limit) {
    var seen = Object.create(null), out = [];
    (values || []).forEach(function(value) {
      value = String(value || '').trim();
      if (!value || seen[value]) return;
      seen[value] = true;
      if (!limit || out.length < limit) out.push(value);
    });
    return out;
 }
