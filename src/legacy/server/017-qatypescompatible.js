

function qaTypesCompatible_(sourceType, courseraType) {
    var s = String(sourceType || '').toLowerCase();
    var c = String(courseraType || '').toLowerCase();
    if (s === c) return true;
    if ((s === 'lti' || s === 'plugin') && (c === 'lti' || c === 'plugin')) return true;
    if (s === 'assessment' && (c === 'assessment' || c === 'quiz' || c === 'assignment')) return true;
    if (s === 'assignment' && (c === 'assignment' || c.indexOf('peer') > -1)) return true;
    return false;
}

function qaFileName_(value) {
    var raw = typeof value === 'string' ? value : String((value && (value.name || value.href || value.path || value.url)) || '');
    raw = raw.split('#')[0].split('?')[0].replace(/\\/g, '/');
    try { raw = decodeURIComponent(raw); } catch (e) {}
    return raw.split('/').pop() || raw;
}

function qaAssetKey_(value) {
    return qaFileName_(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function qaLooksLikeAsset_(value) {
    return /\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i.test(String(value || ''));
}

function qaAssetDescriptor_(value) {
    var obj = (value && typeof value === 'object') ? value : {};
    var raw = typeof value === 'string' ? value : String(obj.url || obj.href || obj.path || obj.src || obj.name || obj.fileName || obj.filename || '');
    var name = qaFileName_(obj.name || obj.fileName || obj.filename || raw);
    var url = String(obj.url || obj.href || obj.src || '');
    var size = Number(obj.size || obj.contentLength || obj.fileSize || 0);
    if (!Number.isFinite(size) || size < 0) size = 0;
    var sha256 = String(obj.sha256 || obj.hash || obj.contentSha256 || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (sha256.length !== 64) sha256 = '';
    var extension = '';
    var dot = name.lastIndexOf('.');
    if (dot > -1) extension = name.slice(dot + 1).toLowerCase();
    return {
        name: name,
        key: qaAssetKey_(name),
        url: url,
        size: size,
        sha256: sha256,
        perceptualHash: String(obj.perceptualHash || obj.dhash || ''),
        mime: qaCleanText_(obj.mime || obj.mimeType || obj.contentType || ''),
        extension: extension,
        assetId: String(obj.assetId || obj.id || ''),
        hashStatus: qaCleanText_(obj.hashStatus || ''),
        evidenceSource: qaCleanText_(obj.evidenceSource || obj.source || ''),
        // v6.5.8: source PDFs can carry bounded text evidence. Keeping it on the
        // asset descriptor lets the transformation verifier prove that a specific
        // source document became native Coursera content instead of merely vanishing.
        textSample: qaCleanText_(obj.textSample || ''),
        textLength: nonNegativeInteger_(obj.textLength),
        textSha256: String(obj.textSha256 || ''),
        pdfParser: qaCleanText_(obj.pdfParser || ''),
        pdfPageCount: nonNegativeInteger_(obj.pdfPageCount),
        pdfPagesRead: nonNegativeInteger_(obj.pdfPagesRead),
        pdfReadError: qaCleanText_(obj.pdfReadError || ''),
        // v6.5.8: retain source-package provenance. A manifest href that the
        // ZIP scanner positively determined is not present is a source reference,
        // not an independent learner-facing payload that Coursera must reproduce.
        presentInPackage: obj.presentInPackage === true ? true : (obj.presentInPackage === false ? false : null),
        // v6.5.8: parser-only embedded filenames/refs remain diagnostic evidence,
        // but they are not promoted to independent source payload without package bytes.
        referenceOnly: obj.referenceOnly === true,
        path: qaCleanText_(obj.path || ''),
        href: qaCleanText_(obj.href || ''),
        dependencyResourceId: qaCleanText_(obj.dependencyResourceId || ''),
        pdfSampleStrategy: qaCleanText_(obj.pdfSampleStrategy || ''),
        pdfPageSamples: Array.isArray(obj.pdfPageSamples) ? obj.pdfPageSamples.slice(0, 16).map(function(sample) {
            return { page: nonNegativeInteger_(sample && sample.page), text: qaCleanText_(sample && sample.text || '').slice(0, 3500) };
        }).filter(function(sample) { return sample.page > 0 && sample.text; }) : []
    };
}

function qaUniqueAssetDescriptors_(values) {
    var seen = Object.create(null), out = [];
    (values || []).forEach(function(value) {
        var desc = qaAssetDescriptor_(value);
        if (!desc.name && !desc.url) return;
        if (desc.name && !qaLooksLikeAsset_(desc.name) && !desc.mime.match(/^(image|audio|video)\//i) && desc.mime.indexOf('pdf') === -1) return;
        var dedupeKey = desc.sha256 ? 'hash:' + desc.sha256 :
            (desc.key ? 'name:' + desc.key + ':' + String(desc.size || '') : 'url:' + qaNormalizeUrl_(desc.url));
        if (!dedupeKey || seen[dedupeKey]) return;
        seen[dedupeKey] = true;
        out.push(desc);
    });
    return out;
}

function qaUniqueAssets_(values) {
    return qaUniqueAssetDescriptors_(values).map(function(desc) { return desc.name || desc.url; });
}

function qaPerceptualHashSimilarity_(left, right) {
    var a = String(left || ''), b = String(right || '');
    if (!a || !b || a.length !== b.length) return null;
    var distance = 0;
    for (var i = 0; i < a.length; i++) if (a.charAt(i) !== b.charAt(i)) distance++;
    return 1 - (distance / a.length);
}

function qaAssetSimilarity_(left, right) {
    var a = qaAssetDescriptor_(left), b = qaAssetDescriptor_(right);
    if (a.sha256 && b.sha256 && a.sha256 === b.sha256) {
        return { score: 1, method: 'SHA256_EXACT', reason: 'Cryptographic SHA-256 match.' };
    }

    var visualSimilarity = qaPerceptualHashSimilarity_(a.perceptualHash, b.perceptualHash);
    if (visualSimilarity !== null && visualSimilarity >= 0.90) {
        return { score: 0.97, method: 'IMAGE_PERCEPTUAL', reason: 'Perceptual image hash indicates the same visual image despite byte-level changes.' };
    }

    if (a.sha256 && b.sha256 && a.sha256 !== b.sha256) {
        return { score: 0.45, method: 'HASH_MISMATCH', reason: 'SHA-256 hashes differ; filename similarity does not establish identical payload.' };
    }

    if (a.key && b.key && a.key === b.key) {
        if (a.size && b.size) {
            var sizeRatio = Math.min(a.size, b.size) / Math.max(a.size, b.size);
            if (sizeRatio >= 0.995) return { score: 0.98, method: 'NAME_SIZE_EXACT', reason: 'Filename matches and byte size is effectively identical.' };
            if (sizeRatio >= 0.90) return { score: 0.92, method: 'NAME_SIZE_NEAR', reason: 'Filename matches and byte size is close.' };
        }
        return { score: 0.94, method: 'NAME_EXACT', reason: 'Normalized filename matches.' };
    }

    var nameScore = fuzzyMatchScore_(a.name, b.name);
    var sameExt = a.extension && b.extension && a.extension === b.extension;
    var sizeScore = 0;
    if (a.size && b.size) sizeScore = Math.min(a.size, b.size) / Math.max(a.size, b.size);

    if (sameExt && nameScore >= 0.90) {
        var score = 0.78 + (nameScore * 0.14) + (sizeScore * 0.06);
        return { score: Math.min(0.97, score), method: 'FUZZY_NAME', reason: 'Strong filename similarity with the same extension.' };
    }

    if (sameExt && sizeScore >= 0.995 && a.size && b.size) {
        return { score: 0.82, method: 'SIZE_EXTENSION', reason: 'Different filename, but extension and byte size match.' };
    }

    return { score: Math.max(0, nameScore * 0.45), method: 'WEAK_NAME', reason: 'Only weak filename evidence is available.' };
}

function qaNormalizeUrl_(value) {
    var raw=qaCleanText_(value);if(!/^https?:\/\//i.test(raw))return '';
    var match=raw.match(/^(https?):\/\/([^\/?#]+)([^?#]*)(?:\?([^#]*))?(#.*)?$/i);
    if(!match)return raw;
    var host=match[2].toLowerCase().replace(/^www\./,''),path=(match[3]||'/').replace(/\/+/g,'/').replace(/\/+$/,'');
    var query=String(match[4]||'').split('&').filter(function(part){
        if(!part)return false;var key=part.split('=')[0];try{key=decodeURIComponent(key);}catch(e){}
        return !/^(?:utm_[a-z0-9_]+|gclid|fbclid|msclkid)$/i.test(key);
    }).join('&');
    return host+(path||'/')+(query?'?'+query:'')+(match[5]||'');
}

function qaIsTechnicalSchemaUrl_(raw) {
    raw = String(raw || '').trim().toLowerCase();
    if (!raw) return true;
    return /(?:imsglobal\.org\/(?:xsd|profile\/cc)|w3\.org\/2001\/(?:xmlschema|xmlschema-instance)|imsccv\d|ccv\d.*\.xsd|imswl_v\d.*\.xsd)/i.test(raw);
}

function qaExternalLinks_(values) {
    var seen = Object.create(null), out = [];
    (values || []).forEach(function(value) {
        var raw = typeof value === 'string' ? value : String((value && (value.href || value.url || value.value)) || '');
        if (qaIsTechnicalSchemaUrl_(raw)) return;
        var normalized = qaNormalizeUrl_(raw);
        if (!normalized || seen[normalized]) return;
        seen[normalized] = true;
        out.push({ raw: raw, normalized: normalized });
    });
    return out;
}

function qaAssetEvidenceCandidates_(expected, candidates) {
    var a=qaAssetDescriptor_(expected), all=(candidates||[]).map(qaAssetDescriptor_);
    if(!a.sha256) return all;
    var known=Object.create(null);
    function key(d){return qaCleanName_(qaCrossItemCanonicalAssetName_(d.name||d.url));}
    all.forEach(function(d){var k=key(d);if(k&&d.sha256){known[k]=known[k]||Object.create(null);known[k][d.sha256]=true;}});
    return all.filter(function(d){var bucket=known[key(d)];return !!d.sha256 || !bucket || bucket[a.sha256]===true;});
}

function qaFindAssetEvidence_(expected, candidates) {
    candidates=qaAssetEvidenceCandidates_(expected,candidates);
    var best = null;
    for (var i = 0; i < (candidates || []).length; i++) {
        var comparison = qaAssetSimilarity_(expected, candidates[i]);
        if (!best || comparison.score > best.score) {
            best = {
                score: comparison.score,
                method: comparison.method,
                reason: comparison.reason,
                candidate: qaAssetDescriptor_(candidates[i])
            };
        }
    }
    return best || { score: 0, method: 'NONE', reason: 'No Coursera asset candidate was available.', candidate: null };
}

function qaFindAsset_(expectedName, candidates) {
    return qaFindAssetEvidence_(expectedName, candidates).score >= 0.78;
}

function qaFindLink_(expected, candidates) {
    var key = typeof expected === 'string' ? qaNormalizeUrl_(expected) : (expected.raw?qaNormalizeUrl_(expected.raw):expected.normalized);
    if (!key) return false;
    for (var i = 0; i < (candidates || []).length; i++) {
        var candidateKey = typeof candidates[i] === 'string' ? qaNormalizeUrl_(candidates[i]) : (candidates[i].raw?qaNormalizeUrl_(candidates[i].raw):candidates[i].normalized);
        if (!candidateKey) continue;
        if (candidateKey === key) return true;
    }
    return false;
}

// -------------------------------------------------------------------
// v6.5 CROSS-ITEM POSITIVE EVIDENCE GRAPH (v6.3 concrete relocation guard preserved)
// -------------------------------------------------------------------
// Item-level absence is not the same as course-level absence. Source items can
// be consolidated into resource hubs or native Coursera items. These helpers
// use only POSITIVE evidence observed elsewhere; global non-observation never
// proves that an asset is missing.
function qaCrossItemCanonicalAssetName_(value) {
    var name = qaFileName_(value);
    try { name = decodeURIComponent(name); } catch (e) {}
    // Coursera asset CDN filenames commonly prepend a UUID and an internal
    // 32-char key, and encode spaces as "-20". Strip transport identity before
    // semantic filename comparison; never use this to override a hash mismatch.
    name = name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i, '');
    name = name.replace(/^[0-9a-f]{32}_/i, '');
    name = name.replace(/-20/gi, ' ');
    name = name.replace(/[_-]+/g, ' ');
    name = name.replace(/\bPW\b/gi, 'Participant Workbook');
    name = name.replace(/\bIG\b/gi, 'Instructor Guide');
    return qaCleanText_(name);
}


function qaCrossItemInformativeTokens_(value) {
    var raw = qaCrossItemCanonicalAssetName_(value)
        .toLowerCase()
        .replace(/\.(pdf|docx?|pptx?|xlsx?|csv|zip|png|jpe?g|webp)$/i, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    if (!raw) return [];
    var stop = {
        cdem:1, cdem114:1, scenario:1, scenarios:1, file:1, combined:1,
        version:1, final:1, current:1, redacted:1, training:1, use:1,
        participant:1, workbook:1, instructor:1, guide:1, document:1,
        resource:1, resources:1, course:1, material:1, v1:1, v2:1,
        pdf:1, doc:1, docx:1, ppt:1, pptx:1, xls:1, xlsx:1, pw:1, ig:1
    };
    var out = [];
    raw.split(/\s+/).forEach(function(token) {
        if (!token || stop[token] || token.length < 3 || /^\d+(?:\.\d+)*$/.test(token)) return;
        if (out.indexOf(token) === -1) out.push(token);
    });
    return out;
}


function qaCrossItemRoleSignature_(value) {
    var name = qaCrossItemCanonicalAssetName_(value).toLowerCase();
    if (/\bparticipant workbook\b/.test(name)) return 'participant-workbook';
    if (/\binstructor guide\b/.test(name)) return 'instructor-guide';
    if (/\bpresentation slides?\b/.test(name)) return 'presentation-slides';
    if (/\brubric\b/.test(name)) return 'rubric';
    if (/\bsyllabus\b/.test(name)) return 'syllabus';
    return '';
}

function qaCrossItemCandidateIsConcrete_(value) {
    var raw = value || {};
    var desc = qaAssetDescriptor_(raw);
    var source = String((raw && raw.evidenceSource) || desc.evidenceSource || '').toLowerCase();

    // Parser fragments such as "Rubric.pdf" / "Combined.pdf" can be emitted as
    // observed-string evidence while harvesting a larger object. They are useful
    // diagnostically but are not proof that a standalone asset with that exact
    // filename exists in another Coursera item.
    if (source === 'observed-string' &&
        !desc.url && !desc.assetId && !desc.sha256 && !desc.perceptualHash && !desc.size) {
        return false;
    }

    return Boolean(
        desc.sha256 ||
        desc.perceptualHash ||
        desc.assetId ||
        Number(desc.size || 0) > 0 ||
        /^https?:\/\//i.test(String(desc.url || ''))
    );
}

function qaCrossItemGenericExpectedAsset_(value) {
    var desc = qaAssetDescriptor_(value);
    var name = qaCrossItemCanonicalAssetName_(desc.name || desc.url)
        .toLowerCase()
        .replace(/\.(pdf|docx?|pptx?|xlsx?|csv|zip|png|jpe?g|webp)$/i, '')
        .replace(/\b(?:final|combined|current|copy|v\d+(?:\.\d+)*)\b/gi, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // A bare role/generic filename is too ambiguous for course-wide relocation
    // by name alone. It needs cryptographic, perceptual, or name+size evidence.
    return /^(?:rubric|assessment|assignment|worksheet|workbook|participant workbook|instructor guide|syllabus|glossary|resource|resources|document|file|attachment|image|logo|answer key|answers?)$/.test(name);
}

function qaCrossItemGenericMethodIsSufficient_(method) {
    method = String(method || '');
    return method === 'SHA256_EXACT' ||
           method === 'IMAGE_PERCEPTUAL' ||
           method === 'NAME_SIZE_EXACT' ||
           method === 'NAME_SIZE_NEAR';
}

function qaCrossItemDirectionalCoverage_(expectedName, observedName) {
    var expectedTokens = qaCrossItemInformativeTokens_(expectedName);
    var observedTokens = qaCrossItemInformativeTokens_(observedName);
    var observedMap = Object.create(null);
    observedTokens.forEach(function(t) { observedMap[t] = true; });
    var hits = expectedTokens.filter(function(t) { return observedMap[t]; }).length;
    var anchors = expectedTokens.filter(function(t) {
        return !/^(rail|incident|hazmat|civil|unrest|ess|fire|planning|section)$/.test(t);
    });
    var anchorHits = anchors.filter(function(t) { return observedMap[t]; }).length;
    return {
        expectedCount: expectedTokens.length,
        observedCount: observedTokens.length,
        hits: hits,
        coverage: expectedTokens.length ? hits / expectedTokens.length : 0,
        anchorHits: anchorHits,
        expectedTokens: expectedTokens,
        observedTokens: observedTokens
    };
}