

function qaFindCrossItemStructuralRepackagingEvidence_(source, courseraItems, excludeCourseraId) {
    source = source || {};
    if(source.sourceTextRefreshRequired) return null;
    if (normalizeCourseraType_(source.type || '') !== 'Discussion') return null;

    // Never let title identity override real portable source learner text. If an
    // actual prompt sample exists, semantic comparison remains authoritative.
    // Do NOT use source.textLength as the veto here: IMSCC adapters can preserve
    // a declared/raw length even when no comparable Discussion prompt was
    // extracted into textSample. That was the BORL Stock Planning Card false-MISSING.
    var sourceText = qaCleanText_(source.textSample || '');
    if (sourceText.length >= 80) return null;

    var identity = qaInteractionIdentityKey_(source.name || '');
    var identityTokens = identity.split(/\s+/).filter(Boolean);
    if (identity.length < 10 || identityTokens.length < 3) return null;

    var excluded = String(excludeCourseraId || '').toLowerCase();
    var candidates = [], identityCandidateCount = 0;
    (courseraItems || []).forEach(function(item) {
        if (!item || item.syntheticOneToMany === true) return;
        if (excluded && String(item.id || '').toLowerCase() === excluded) return;
        if (normalizeCourseraType_(item.type || '') !== 'Discussion') return;
        if (qaNormalizeIngestionFailure_(item.ingestionFailure, item.name, item.textSample).detected === true) return;

        var targetIdentity = qaInteractionIdentityKey_(item.name || '');
        if (!targetIdentity || targetIdentity !== identity) return;

        var pathScore = qaPathSimilarity_(source.path || '', item.path || '');
        if (pathScore === null || pathScore < 0.92) return;
        identityCandidateCount++; // Weak duplicate evidence must not manufacture uniqueness.

        var completeness = Number(item.textEvidenceCompleteness || 0);
        if (!Number.isFinite(completeness)) completeness = 0;
        var targetText = qaCleanText_(item.textSample || '');
        var targetLength = targetText.length;
        var confidence = String(item.textConfidence || '').toLowerCase();
        var strongLearnerSurface = completeness >= 0.85 && targetLength >= 40 && (!confidence || confidence === 'high');
        var knownConsolidationCarrier = Array.isArray(item.repackagedSourceNames) && item.repackagedSourceNames.length > 0;
        if (!strongLearnerSurface && !knownConsolidationCarrier) return;

        candidates.push({
            score:Number(Math.min(1, 0.78 + (pathScore * 0.12) + (strongLearnerSurface ? 0.07 : 0) + (knownConsolidationCarrier ? 0.03 : 0)).toFixed(3)),
            method:'STRUCTURAL_ACTIVITY_IDENTITY',
            reason:'The source package does not expose enough Discussion prompt text for semantic proof, but exactly one same-module Coursera Discussion has the same distinctive activity identity after generic wrapper terms are removed. Destination learner-surface evidence confirms that the carrier is real; prompt equivalence remains unverified.',
            identityKey:identity,
            carrierId:item.id || '', carrierName:item.name || '', carrierType:item.type || '', carrierPath:item.path || '',
            carrierPublished:item.published === true ? true : (item.published === false ? false : null),
            carrierEvidenceOnly:item.evidenceOnly === true,
            pathScore:Number(pathScore.toFixed(3)),
            textEvidenceCompleteness:Number(completeness.toFixed(3)),
            knownConsolidationCarrier:knownConsolidationCarrier
        });
    });

    // Ambiguity is intentionally unresolved. A title-normalization rule must never
    // choose between duplicate destination Discussions.
    if (identityCandidateCount !== 1 || candidates.length !== 1) return null;
    return candidates[0];
}

function qaAugmentCrossItemRecoveryWithSemanticEvidence_(source, recovery, courseraItems, excludeCourseraId) {
    recovery = recovery || {
        hasPositiveEvidence:false, sourcePayloadAvailable:false, titleDerivedRecovery:false,
        inferredWhilePayloadAvailable:false, explicitHashConflict:false, ignoredSourceReferenceAssets:[],
        totalExpected:0, recoveredCount:0, recoveryRatio:0, allRecovered:false,
        relocatedAssets:[], unresolvedAssets:[], relocatedLinks:[], unresolvedLinks:[], carriers:[]
    };
    if (recovery.hasPositiveEvidence === true) return recovery;

    var semantic = qaFindCrossItemSemanticRepackagingEvidence_(source, courseraItems, excludeCourseraId);
    var structuralIdentity = null;
    if (!semantic) structuralIdentity = qaFindCrossItemStructuralRepackagingEvidence_(source, courseraItems, excludeCourseraId);
    if (!semantic && !structuralIdentity) return recovery;

    recovery.hasPositiveEvidence = true;
    if (semantic) {
        recovery.semanticRecovered = true;
        recovery.semanticCarrierEvidence = semantic;
    } else {
        recovery.identityRecovered = true;
        recovery.identityCarrierEvidence = structuralIdentity;
    }
    var carrierEvidence = semantic || structuralIdentity;
    // A recovered text/identity signal does not recover unresolved attachments.
    recovery.totalExpected = Math.max(0, Number(recovery.totalExpected || 0)) + 1;
    recovery.recoveredCount = Math.max(0, Number(recovery.recoveredCount || 0)) + 1;
    recovery.recoveryRatio = Math.min(1, recovery.recoveredCount / recovery.totalExpected);
    // Semantic equivalence can prove payload preservation when no concrete source
    // payload remains unresolved. Structural identity only proves that the activity
    // survived as a renamed/consolidated destination item, so payload stays UNVERIFIED.
    recovery.allRecovered = semantic ? (recovery.sourcePayloadAvailable === true
        ? ((recovery.unresolvedAssets || []).length === 0 && (recovery.unresolvedLinks || []).length === 0)
        : true) : false;
    if (!Array.isArray(recovery.carriers)) recovery.carriers = [];
    if (!recovery.carriers.some(function(c){ return String(c.id || '') === String(carrierEvidence.carrierId || ''); })) {
        recovery.carriers.push({
            id:carrierEvidence.carrierId || '', name:carrierEvidence.carrierName || '', type:carrierEvidence.carrierType || '', path:carrierEvidence.carrierPath || '',
            published:carrierEvidence.carrierPublished, evidenceOnly:carrierEvidence.carrierEvidenceOnly === true
        });
    }
    return recovery;
}

// -------------------------------------------------------------------
// v6.6 RAW INGESTION INTELLIGENCE
// Coursera Smart Ingestion emits an Author Alignment Report that describes what
// it claims to have generated, merged, adapted, or intentionally removed. CTI
// treats these statements as provenance claims only: hard observed payload/hash
// evidence can confirm them, and contradictory evidence always wins.
// -------------------------------------------------------------------
function qaSmartIngestionReportLooksValid_(item) {
    var text = qaCleanText_(item && item.textSample || '');
    var identity = qaCleanText_((item && item.name || '') + ' ' + (item && item.path || ''));
    return /author alignment report|author.?s eyes|\[delete me\]/i.test(identity) &&
           /smart ingestion|transformations and gap-filling|ai-generated mandatory field|content adaptation/i.test(text);
}

function qaSmartIngestionClaimExcerpt_(value) {
    var text = qaCleanText_(value || '');
    return text.length > 520 ? text.slice(0, 517) + '...' : text;
}

function qaParseSmartIngestionIntelligence_(courseraEvidenceItems) {
    var reportItems = [], texts = [];
    (courseraEvidenceItems || []).forEach(function(item) {
        if (!qaSmartIngestionReportLooksValid_(item)) return;
        reportItems.push({ id:item.id || '', name:item.name || '', path:item.path || '', published:item.published });
        if (item.textSample) texts.push(item.textSample);
    });

    var fullText = qaCleanText_(texts.join(' '));
    var claims = [];
    var seen = Object.create(null);

    function nearestModule(index) {
        var start = Math.max(0, Number(index || 0) - 16000);
        var prefix = fullText.slice(start, Number(index || 0));
        var re = /Module:\s+(.+?)(?=\s+(?:AI-Generated Mandatory Field|Content Adaptation|Content Excluded|Unsupported Content Fallback|Empty Module Structure|Other\s+[0-9.]+%|Item:\s|Module:\s|DO NOT PUBLISH|$))/gi;
        var m, last = '';
        while ((m = re.exec(prefix)) !== null) last = qaCleanText_(m[1] || '');
        return last;
    }
    function contextAround(index, length) {
        var start = Math.max(0, Number(index || 0) - 360);
        return qaSmartIngestionClaimExcerpt_(fullText.slice(start, Math.min(fullText.length, Number(index || 0) + Number(length || 0) + 520)));
    }
    function pushClaim(type, subject, target, excerpt, confidence, detail, meta) {
        excerpt = qaSmartIngestionClaimExcerpt_(excerpt || '');
        meta = meta || {};
        var key = [type, qaCleanName_(subject || ''), qaCleanName_(target || ''), qaCleanName_(meta.pathHint || ''), excerpt.toLowerCase()].join('|');
        if (!excerpt || seen[key]) return;
        seen[key] = true;
        claims.push({
            type:type,
            subject:qaCleanText_(subject || ''),
            target:qaCleanText_(target || ''),
            excerpt:excerpt,
            confidence:Number(confidence || 0.95),
            detail:qaCleanText_(detail || ''),
            pathHint:qaCleanText_(meta.pathHint || ''),
            context:qaCleanText_(meta.context || ''),
            severity:qaCleanText_(meta.severity || 'INFO'),
            remediation:qaCleanText_(meta.remediation || '')
        });
    }
    function collect(re, type, mapper) {
        var m;
        while ((m = re.exec(fullText)) !== null && claims.length < 220) {
            var mapped = mapper ? mapper(m) : {};
            var pathHint = mapped.pathHint != null ? mapped.pathHint : nearestModule(m.index);
            pushClaim(type, mapped.subject || '', mapped.target || '', m[0], mapped.confidence || 0.96, mapped.detail || '', {
                pathHint:pathHint,
                context:mapped.context || contextAround(m.index, m[0].length),
                severity:mapped.severity || 'INFO',
                remediation:mapped.remediation || ''
            });
        }
    }

    // Explicit exclusions. v7.1 supports the actual Smart Ingestion wording used
    // by current Author Alignment Reports, not only the older "Removed ... web content" phrase.
    collect(/Content Excluded\s+Excluded the [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"]\s+(?:weblink|web link|web content) item because\s+([^.]+)\./gi,
        'INTENTIONAL_EXCLUSION', function(m) { return {subject:m[1], detail:'Smart Ingestion explicitly excluded this source item: ' + m[2], severity:'REVIEW', remediation:'Confirm the exclusion is allowed by the operating policy; do not recreate it merely because it is absent.'}; });
    collect(/Removed the [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] web content[^.]*\./gi,
        'INTENTIONAL_EXCLUSION', function(m) { return {subject:m[1], detail:'Smart Ingestion explicitly says this source web content was removed.', severity:'REVIEW'}; });

    // One source item intentionally split into multiple destination items.
    collect(/Structured the massive tabbed [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] page as a chunked item[^.]*\./gi,
        'ONE_TO_MANY_TRANSFORMATION', function(m) { return {subject:m[1], detail:'Smart Ingestion says one large source page was intentionally chunked into multiple Coursera items.', severity:'INFO'}; });

    // v7.8: current Smart Ingestion uses CHUNKED_ITEM wording for large source
    // lessons that are intentionally split into multiple Coursera items. Treat
    // this as explicit transformation provenance rather than a 1:1 mismatch.
    collect(/Reclassified the main lesson webcontent item [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] as CHUNKED_ITEM[^.]*\./gi,
        'CHUNKED_ITEM_TRANSFORMATION', function(m) { return {subject:m[1], detail:'Smart Ingestion explicitly classified this source lesson as CHUNKED_ITEM.', severity:'INFO'}; });
    collect(/\bClassified (?:the )?(?:source )?([^.;]{1,220}?) as a CHUNKED_ITEM[^.]*\./gi,
        'CHUNKED_ITEM_TRANSFORMATION', function(m) { return {subject:qaCleanText_(m[1]).replace(/^[\'\u2018\u2019\"]|[\'\u2018\u2019\"]$/g,''), detail:'Smart Ingestion explicitly classified this source lesson as CHUNKED_ITEM.', severity:'INFO'}; });
    collect(/Reclassified (?!the main lesson webcontent item)([^.;]{1,220}?) as a CHUNKED_ITEM[^.]*\./gi,
        'CHUNKED_ITEM_TRANSFORMATION', function(m) { return {subject:qaCleanText_(m[1]).replace(/^[\'\u2018\u2019\"]|[\'\u2018\u2019\"]$/g,''), detail:'Smart Ingestion explicitly classified this source lesson as CHUNKED_ITEM.', severity:'INFO'}; });

    // Explicit source coverage gaps reported by Smart Ingestion.
    collect(/Other\s+([0-9.]+)%\s+of the source content in module [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] was not claimed by any learning item\s*\(([0-9,]+) of ([0-9,]+) characters/gi,
        'SOURCE_COVERAGE_GAP', function(m) { return {subject:m[2], target:m[1] + '%', detail:'Smart Ingestion reports ' + m[3] + ' of ' + m[4] + ' source characters unclaimed in this module.', pathHint:m[2], severity:Number(m[1]) >= 1 ? 'REVIEW' : 'INFO'}; });

    // Explicit fallbacks/failures. These are stronger than a generic "payload unverified" state.
    collect(/Could not attach or embed the referenced document\s+[\"\u201c\u201d]([^\"\u201c\u201d]+)[\"\u201c\u201d][^.]*\./gi,
        'UNRESOLVED_SOURCE_ASSET', function(m) { return {subject:qaFileName_(m[1]), target:'Coursera attachment', detail:'Smart Ingestion explicitly says the referenced source document was not attached or embedded.', severity:'CRITICAL', remediation:'Upload/link the missing source document or otherwise restore equivalent learner access, then re-run QA.'}; });
    collect(/Generated the reading content based on the course description and learning objectives because the source HTML content for [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] was missing in the ingested payload\./gi,
        'GENERATED_CONTENT_FALLBACK', function(m) { return {subject:m[1], target:'AI-generated replacement reading', detail:'Smart Ingestion says source HTML content was unavailable and generated replacement reading content instead.', severity:'CRITICAL', remediation:'Compare the generated destination reading against the actual source item; restore source content if semantic fidelity is not proven.'}; });
    collect(/Converted a broken local file link for a YouTube video.{0,260}?into clear plain text to prevent navigation errors\./gi,
        'BROKEN_LINK_FALLBACK', function() { return {subject:'YouTube video link', target:'plain text', detail:'Smart Ingestion reports that a broken source video link was converted to plain text rather than a working destination link.', severity:'REVIEW'}; });
    collect(/Classified [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] as a reading placeholder because no content or asset reference was provided[^.]*\./gi,
        'PLACEHOLDER_FALLBACK', function(m) { return {subject:m[1], target:'reading placeholder', detail:'Smart Ingestion created a placeholder because source payload was absent.', severity:'REVIEW'}; });

    // Assessment behavior generated by ingestion must never silently count as source fidelity.
    collect(/Set the passing threshold to\s+([^.,;]+?)\s+because[^.]*?(?:no explicit pass(?:ing)? (?:criterion|requirement)[^.]*|source[^.]*did not[^.]*)\./gi,
        'GENERATED_BEHAVIOR', function(m) { return {subject:'passing threshold', target:m[1], detail:'Smart Ingestion generated a grading threshold that was not explicitly observed in the source.', severity:'REVIEW'}; });
    collect(/Set the grader type to\s+AI[^.]*because[^.]*source system did not specify[^.]*\./gi,
        'GENERATED_BEHAVIOR', function() { return {subject:'grader type', target:'AI', detail:'Smart Ingestion generated AI grading because the source did not specify a grading mode.', severity:'REVIEW'}; });
    collect(/Generated a simple rubric description and allocated\s+[^.]*because the original assignment content did not specify[^.]*\./gi,
        'GENERATED_BEHAVIOR', function() { return {subject:'rubric', target:'generated rubric', detail:'Smart Ingestion generated rubric semantics absent from the observed source.', severity:'REVIEW'}; });

    // Existing positive adaptation classes.
    collect(/Created a single rubric part[^.]*?summarizing the attached\s+([^.;]{1,180}?Rubric\.pdf)[^.]*\./gi,
        'RUBRIC_ADAPTATION', function(m) { return {subject:qaFileName_(m[1]), target:'native Coursera rubric part', detail:'Smart Ingestion says it created a native rubric part from a source rubric PDF.'}; });
    collect(/Merged the instructor note and five distinct scenario workbooks under their parent folder [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"][^.]*\./gi,
        'CONSOLIDATION', function(m) { return {subject:'scenario participant workbooks', target:m[1], detail:'Smart Ingestion claims the five scenario workbooks were consolidated into one Coursera reading.'}; });
    collect(/Merged [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] and [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] web links under the parent node [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"][^.]*\./gi,
        'CONSOLIDATION', function(m) { return {subject:m[1] + ' + ' + m[2], target:m[3], detail:'Smart Ingestion claims two source web-link items were consolidated.'}; });
    collect(/Promoted child items of [\'\u2018\u2019\"]([^\'\u2018\u2019\"]+)[\'\u2018\u2019\"] to standalone items[^.]*\./gi,
        'STRUCTURE_ADAPTATION', function(m) { return {subject:m[1], detail:'Smart Ingestion claims nested source children were promoted to standalone Coursera items.'}; });
    collect(/Converted the Brightspace time limit[^.]*\./gi,
        'ASSESSMENT_ADAPTATION', function() { return {subject:'Brightspace assessment', detail:'Smart Ingestion claims source assessment timing/attempt semantics were mapped to Coursera.'}; });
    collect(/Mapped the four Brightspace item-level feedback blocks[^.]*\./gi,
        'ASSESSMENT_ADAPTATION', function() { return {subject:'Brightspace assessment', detail:'Smart Ingestion claims multiple-select feedback was mapped to Coursera answer options.'}; });
    collect(/(?:Generated|Estimated) (?:the )?(?:estimated )?(?:learner )?time commitment[^.]*\./gi,
        'GENERATED_FIELD', function() { return {subject:'time commitment', detail:'Smart Ingestion generated or estimated a mandatory Coursera duration field that was absent in the source.'}; });
    collect(/Generated module description(?: and minimal learning objectives)?[^.]*\./gi,
        'GENERATED_FIELD', function() { return {subject:'module metadata', detail:'Smart Ingestion generated mandatory Coursera module metadata.'}; });

    var counts = {}, critical = [], review = [];
    claims.forEach(function(c) {
        counts[c.type] = (counts[c.type] || 0) + 1;
        if (c.severity === 'CRITICAL') critical.push(c);
        else if (c.severity === 'REVIEW') review.push(c);
    });
    return {
        detected: reportItems.length > 0,
        parserVersion:'smart-ingestion-provenance-v2',
        reportCount: reportItems.length,
        reportItems: reportItems,
        claims: claims,
        categoryCounts: counts,
        criticalClaims:critical.slice(0,60),
        reviewClaims:review.slice(0,80),
        generatedFieldMentions: (fullText.match(/AI-Generated Mandatory Field/gi) || []).length,
        contentAdaptationMentions: (fullText.match(/Content Adaptation/gi) || []).length,
        emptyModuleMentions: (fullText.match(/Empty Module Structure/gi) || []).length,
        reportTextLength: fullText.length,
        trustModel: 'CLAIM_PLUS_OBSERVATION',
        note: reportItems.length ? 'Smart Ingestion claims are retained as provenance. Positive claims do not substitute for independent CTI evidence; explicit exclusions/fallbacks are surfaced as provenance risks and reconciled with observed evidence.' : ''
    };
}

// Keep format restrictions separate from statements that a source file was not
// attached. Test the failure verb, not a loose "asset ... cannot" word window.
function qaIngestionAssetEventKind_(text) {
    text=qaCleanText_(text||'');
    var direct=/\b(?:could not|cannot|unable to|failed to)\s+(?:be\s+)?(?:attach(?:ed)?|embed(?:ded)?|upload(?:ed)?|include(?:d)?|represent(?:ed)?|resolve(?:d)?)\b/i.test(text) && /\b(?:attachments?|documents?|files?|assets?|images?|videos?)\b/i.test(text);
    var unavailable=/\b(?:attachment|document|file|asset)\b[^.!?]{0,180}\b(?:not (?:available|represented|attached|embedded)|missing from|no corresponding asset)\b/i.test(text);
    var noIdentifier=/\b(?:lacking|without|no|missing)\s+(?:an?\s+)?(?:corresponding\s+)?asset\s+(?:identifier|id)\b/i.test(text) &&
        /\b(?:attachment|document|file)\b/i.test(text) && /\b(?:plain text|embedding|attach|upload)\b/i.test(text);
    if(direct||unavailable||noIdentifier)return 'UNRESOLVED_SOURCE_ASSET';
    var nesting=/\b(?:assets?|images?|tables?)\b[^.!?]{0,90}\b(?:cannot be nested|(?:not|never) (?:allowed|supported) (?:inside|within))\b|\b(?:CML|HTML)\b[^.!?]{0,70}\b(?:does not support|does not allow)\b[^.!?]{0,70}\b(?:inside|within)\b/i.test(text);
    if(nesting && /\b(?:converted|transformed|lifted|extracted|moved)\b/i.test(text))return 'CONTENT_MARKUP_ADAPTATION';
    return '';
}

// Reclassify old memory with the same evidence rules as freshly parsed claims.
// Keep original fields so the audit trail explains every changed interpretation.
function qaNormalizeIngestionClaimScope_(claim) {
    var c=Object.assign({},claim||{}), originalType=c.type, originalSubject=c.subject||'';
    if(['UNRESOLVED_SOURCE_ASSET','UNSUPPORTED_CONTENT_FALLBACK','REPAIR_INSTRUCTION'].indexOf(c.type)<0)return c;
    var text=qaCleanText_((c.excerpt||'')+' '+(c.detail||''));
    var files=[],fileRe=/["\u201c\u201d']([^"\u201c\u201d'\n]{1,220}\.(?:docx?|pdf|pptx?|xlsx?|zip|html?|mp[34]|wav|png|jpe?g))["\u201c\u201d']/gi,fileMatch;
    while((fileMatch=fileRe.exec(text))!==null){var fileName=qaFileName_(fileMatch[1]);if(files.indexOf(fileName)<0)files.push(fileName);}
    if(files.length===1)c.subject=files[0];
    var separate=/\bseparate\s+(?:rubric\s+)?document\b/i.test(text) && /\bnot available\s+(?:with)?in\s+this item\b/i.test(text);
    var explicitLoss=/\b(?:could not|cannot|unable to)\s+(?:attach|embed|upload|include)\b|\b(?:attachment|file|asset)\b.{0,100}\b(?:could not be represented|not represented|missing from|no asset identifier)\b/i.test(text);
    var eventKind=qaIngestionAssetEventKind_(text);
    if(c.type==='REPAIR_INSTRUCTION' && eventKind==='UNRESOLVED_SOURCE_ASSET' && files.length===1){
        c.type='UNRESOLVED_SOURCE_ASSET';c.severity='CRITICAL';
        c.remediation='Confirm learner access to '+c.subject+'; restore or link the source file if absent. A local file path in the prompt does not establish an accessible attachment.';
        c.classificationReason='The ingestion report describes a named file left as text because no asset identifier was available.';
    } else if(c.type==='UNRESOLVED_SOURCE_ASSET' && eventKind==='CONTENT_MARKUP_ADAPTATION'){
        c.type='CONTENT_MARKUP_ADAPTATION';c.severity='INFO';c.remediation='';
        c.classificationReason='The statement describes moving preserved content out of unsupported markup, without reporting file loss.';
    } else if(c.type==='UNRESOLVED_SOURCE_ASSET' && separate&&!explicitLoss){
        c.type='SOURCE_ASSET_SCOPE_REVIEW';c.severity='REVIEW';
        c.remediation='Check the separate rubric document and its learner access. Unavailable within this item does not establish that the document is missing from the course.';
        c.classificationReason='The report describes a document outside this item, without establishing course-wide asset loss.';
    } else if(files.length===1 && c.subject!==originalSubject)c.classificationReason='The quoted source filename identifies the asset; an item-type label does not identify its carrier.';
    if(c.type!==originalType || c.subject!==originalSubject){
        c.originalClaimType=c.originalClaimType||originalType;
        if(!c.originalClaimSubject)c.originalClaimSubject=originalSubject;
    }
    return c;
}

function qaSmartIngestionClaimsForSource_(source, intelligence) {
    if (!source || !intelligence || !Array.isArray(intelligence.claims)) return [];
    var name = qaCleanName_(source.name || '');
    var path = qaCleanName_(source.path || '');
    var sourceText = qaCleanText_(source.textSample || '').toLowerCase();
    var assetNames = (source.assetDetails || []).map(function(d) { return qaCleanName_(qaAssetDescriptor_(d).name || ''); }).filter(Boolean);
    var scenarioItem = /scenario.*participant workbook|participant workbook.*scenario/i.test(String(source.name || ''));

    function pathCompatible(claim) {
        var hint = qaCleanName_(claim.pathHint || '');
        if (!hint) return true;
        if (!path) return false;
        return path.indexOf(hint) > -1 || hint.indexOf(path) > -1 || fuzzyMatchScore_(path,hint) >= 0.78;
    }
    function semanticContextMatch(claim) {
        if (!sourceText || sourceText.length < 80) return false;
        var context = qaCleanText_(claim.context || claim.excerpt || '').toLowerCase();
        if (context.length < 40) return false;
        var tokens = (context.match(/\b[a-z0-9]{6,}\b/g) || []).filter(function(t){return ['because','source','content','coursera','generated','assignment','learning','module'].indexOf(t)===-1;});
        var seen=Object.create(null), hits=0, useful=0;
        tokens.forEach(function(t){ if(seen[t])return; seen[t]=true; useful++; if(sourceText.indexOf(t)>-1)hits++; });
        return useful >= 3 && hits >= Math.min(3, Math.ceil(useful * 0.30));
    }

    return intelligence.claims.map(qaNormalizeIngestionClaimScope_).filter(function(claim) {
        if (!pathCompatible(claim)) return false;
        var subject = qaCleanName_(claim.subject || '');
        if (name && name.length >= 4 && subject.length >= 4 && (subject === name || (subject.length >= name.length + 3 && subject.indexOf(name) > -1) || (name.length >= subject.length + 3 && name.indexOf(subject) > -1))) return true;
        if (assetNames.some(function(a) { return a.length >= 4 && subject && (subject === a || subject.indexOf(a) > -1 || a.indexOf(subject) > -1); })) return true;
        if (scenarioItem && claim.type === 'CONSOLIDATION' && /five distinct scenario workbooks/i.test(String(claim.excerpt || ''))) return true;
        // v7.2: do not smear generic Smart Ingestion claims across every item
        // in the same module. Generated grading behavior, broken-link fallbacks,
        // and generic placeholder fallbacks remain course-level readiness claims
        // unless the claim explicitly matches this source item's name/asset.
        return false;
    }).slice(0, 14);
}

function qaExplicitExclusionClaimForSource_(source, intelligence) {
    var name = qaCleanName_(source && source.name || '');
    if (!name) return null;
    var claims = qaSmartIngestionClaimsForSource_(source, intelligence);
    for (var i = 0; i < claims.length; i++) {
        if (claims[i].type === 'INTENTIONAL_EXCLUSION' && qaCleanName_(claims[i].subject || '') === name) return claims[i];
    }
    return null;
}