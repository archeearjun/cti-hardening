// Maintained source: explicit dependencies; no ordered concatenation.
import { qaAssessmentText_, qaLearnerMarkupText_, qaNormalizeAssessment_, qaQuestionPromptSimilarity_, qaQuestionTypeKey_ } from "../assessment/questions.js";
import { bindServices } from "../bind-services.js";
import { nonNegativeInteger_ } from "../validation.js";
import { qaExternalLinks_, qaFileName_, qaIsTechnicalSchemaUrl_, qaUniqueAssetDescriptors_ } from "../matching/assets.js";
import { qaCleanName_, qaCleanText_ } from "../matching/text.js";
import { qaCaptureTraversalSummary_ } from "../provenance/current-state.js";
import { qaBrightspaceText_ } from "./brightspace-assessment.js";
import { qaPluginRuntimeSummary_, qaYoutubeVideoId_ } from "./metrics.js";

export function qaHiddenDependencyKind_(item) {
    item = item || {};
    var name = qaCleanText_(item.name || '');
    var parent = qaCleanText_(item.parentSourceName || '');
    var rawType = qaCleanText_(item.sourceTypeRaw || '').toLowerCase();
    var hidden = /^hidden\s+plugin\s*\(/i.test(name) || (rawType === 'plugin' && !!parent);
    if (!hidden) return null;

    var inner = name.replace(/^hidden\s+plugin\s*\(/i, '').replace(/\)\s*$/, '').trim();
    var lower = inner.toLowerCase();
    var parentLower = parent.toLowerCase();
    var ext = (lower.match(/\.([a-z0-9]{2,6})$/) || [,''])[1];
    var attachmentExt = /^(pdf|docx?|pptx?|xlsx?|csv|zip)$/i.test(ext);
    var mediaExt = /^(png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)$/i.test(ext);
    var canonicalInner = qaCleanName_(inner);
    var canonicalParent = qaCleanName_(parent);
    var sameNamed = canonicalInner && canonicalParent && (canonicalInner === canonicalParent || canonicalParent.indexOf(canonicalInner) > -1 || canonicalInner.indexOf(canonicalParent) > -1);

    if (/\.practice\.json$/i.test(lower)) {
        return { kind:'INTERACTIVE_RUNTIME_DEPENDENCY', hidden:true, parentName:parent, childName:name, portableStandalone:false,
            reason:'Hidden .practice.json content is treated as an interactive/runtime dependency of the visible parent. It is not a second learner activity, but its parent requires runtime-aware verification.' };
    }
    if (attachmentExt && sameNamed) {
        return { kind:'ATTACHMENT_PROXY', hidden:true, parentName:parent, childName:name, portableStandalone:false,
            reason:'Hidden child mirrors the parent downloadable document and is treated as an IMSCC attachment/proxy representation, not a second learner activity.' };
    }
    if (mediaExt && parent) {
        return { kind:'EMBEDDED_MEDIA_DEPENDENCY', hidden:true, parentName:parent, childName:name, portableStandalone:false,
            reason:'Hidden media child is treated as a payload dependency of the visible parent. Its standalone absence does not prove learner-content loss.' };
    }
    return { kind:'HIDDEN_DEPENDENCY_REVIEW', hidden:true, parentName:parent, childName:name, portableStandalone:false,
        reason:'Hidden child requires parent/payload-aware verification and must not independently trigger a missing learner-activity verdict.' };
}

export function create_qaLegacyDiscussionText_(services) {
const {XmlService} = services;
return function qaLegacyDiscussionText_(item) {
    var raw=String(item.sourceTextSample||'');
    // A release label cannot prove extraction succeeded. Only an explicit
    // per-payload format protects already decoded learner literals.
    if(item.sourceTextFormat === 'learner-text') return null;
    if (!/imsdt/i.test(String(item.sourceTypeRaw||'')) || !/^\s*(?:<\?xml\b|<!DOCTYPE\b|<(?:[\w.-]+:)?topic\b)/i.test(raw)) return null;
    var result={status:'SOURCE_REFRESH_REQUIRED',text:'',reason:'Stored discussion XML is incomplete or unsupported. Re-scan the same original IMSCC before judging prompt equivalence.'};
    if(item.sourceEvidenceTruncated===true || /<!DOCTYPE|<!ENTITY/i.test(raw)) return result;
    try {
        var root=XmlService.parse(raw).getRootElement();
        var ns=root.getNamespace().getURI();
        if(root.getName()!=='topic' || !/^https?:\/\/www\.imsglobal\.org\/xsd\/imsccv[\dp]+\/imsdt_v[\dp]+\/?$/.test(ns)) return result;
        var children=root.getChildren();
        var bodies=children.filter(function(n){return n.getName()==='text'&&n.getNamespace().getURI()===ns;});
        var titles=children.filter(function(n){return n.getName()==='title'&&n.getNamespace().getURI()===ns;});
        if(bodies.length!==1 || titles.length>1 || bodies[0].getChildren().length || (titles.length&&titles[0].getChildren().length)) return result;
        var attr=bodies[0].getAttribute('texttype'), kind=attr?String(attr.getValue()).toLowerCase():'';
        if(kind!=='text/html'&&kind!=='text/plain') return result;
        var body=bodies[0].getText();
        body=kind==='text/html'?qaLearnerMarkupText_(body):qaCleanText_(body);
        if(!body) return result;
        return {status:'NORMALIZED_LEGACY_DISCUSSION_XML',text:qaCleanText_((titles.length?titles[0].getText()+' ':'')+body),reason:'Parsed the stored IMS discussion title and learner body; excluded XML declaration, schema metadata and attachment URLs. Original source evidence is retained.'};
    } catch(e) { return result; }
};
}

export function qaApplyUnreachedCarrierGap_(result,source,courseraItems,extractorMeta) {
    if(!result||result.verdict!=='MISSING'||!(source.links||[]).length)return result;
    var traversal=qaCaptureTraversalSummary_(extractorMeta),unread=Object.create(null);
    (traversal.unresolvedItemIds||[]).forEach(function(id){unread[id]=true;});
    var module=qaCleanName_(String(source.path||'').split('>')[0]);
    if(!module||/^(root|course)$/.test(module))return result;
    var candidates=(courseraItems||[]).filter(function(item){return unread[String(item.id||'')] &&
        qaCleanName_(String(item.path||'').split('>')[0])===module && /reading|plugin|lti/i.test(item.type||'');
    });
    if(!candidates.length)return result;
    result.verdict='UNVERIFIED';result.evidenceCoverage=0;
    result.issues=(result.issues||[]).filter(function(v){return v!=='MISSING_ITEM';}).concat(['UNREAD_DESTINATION_CARRIER','PAYLOAD_UNVERIFIED']);
    result.checks=result.checks||{};
    result.checks.captureGap={status:'UNVERIFIED',reasonCode:'UNREACHED_POSSIBLE_LINK_CARRIER',standaloneMatch:'NOT_FOUND',
        expectedLinks:(source.links||[]).map(function(l){return typeof l==='string'?l:l.raw||l.normalized||'';}),
        candidates:candidates.map(function(c){return {id:c.id,name:c.name,path:c.path};}),
        reason:'No standalone match was found, but same-module reading/plugin editors remain unread. The expected source links may have been consolidated there; neither preservation nor loss is established.'};
    return result;
}

export function qaApplySourceTextGap_(result, source) {
    var diag=result.checks&&result.checks.reconciliationDiagnostic;
    if(result.verdict!=='MISSING'||!diag||!diag.candidates.length) return result;
    var candidate=diag.candidates.length===1?diag.candidates[0]:null;
    var uncertainCandidate=!!candidate && candidate.confidence==='high' && candidate.completeness>=0.85 &&
        candidate.comparison && candidate.comparison.status==='UNVERIFIED';
    if(!source.sourceTextRefreshRequired&&!uncertainCandidate) return result;
    // Identity is not proof of equivalent content. A strong, unique candidate
    // with an inconclusive text check also cannot prove an absent activity.
    result.verdict='UNVERIFIED';
    result.issues=[source.sourceTextRefreshRequired?'SOURCE_TEXT_REFRESH_REQUIRED':'SOURCE_DESTINATION_MATCH_UNCONFIRMED','PAYLOAD_UNVERIFIED'];
    result.evidenceCoverage=0;
    result.checks.structure={status:'UNVERIFIED',weight:30};
    if(source.sourceTextNormalization) result.checks.sourceTextNormalization=source.sourceTextNormalization;
    return result;
}

export function create_qaLegacyAssignmentText_(services) {
const {XmlService} = services;
return function qaLegacyAssignmentText_(item) {
    var raw=String(item.sourceTextSample||'');
    if(item.sourceTextFormat==='learner-text' || !/^assignment_xml/i.test(String(item.sourceTypeRaw||'')) || !/^\s*(?:<\?xml\b|<!DOCTYPE\b|<(?:[\w.-]+:)?assignment\b)/i.test(raw))return null;
    var gap={status:'SOURCE_REFRESH_REQUIRED',text:'',reason:'Stored assignment XML is incomplete or unsupported. Re-scan the original IMSCC before judging the assignment instructions.'};
    if(item.sourceEvidenceTruncated===true || /<!DOCTYPE|<!ENTITY/i.test(raw))return gap;
    try {
        var root=XmlService.parse(raw).getRootElement(),ns=root.getNamespace().getURI();
        if(root.getName()!=='assignment' || !/^https?:\/\/www\.imsglobal\.org\/xsd\/imscc_extensions\/assignment\/?$/.test(ns))return gap;
        var children=root.getChildren(),body=children.filter(function(n){return n.getName()==='instructor_text'&&n.getNamespace().getURI()===ns;}),titles=children.filter(function(n){return n.getName()==='title'&&n.getNamespace().getURI()===ns;});
        if(body.length!==1 || titles.length>1 || body[0].getChildren().length || (titles.length&&titles[0].getChildren().length))return gap;
        var attr=body[0].getAttribute('texttype'),kind=attr?String(attr.getValue()).toLowerCase():'';
        if(kind!=='text/html'&&kind!=='text/plain')return gap;
        var text=kind==='text/html'?qaLearnerMarkupText_(body[0].getText()):qaCleanText_(body[0].getText());
        if(!text)return gap;
        return {status:'NORMALIZED_LEGACY_ASSIGNMENT_XML',text:qaCleanText_((titles.length?titles[0].getText()+' ':'')+text),reason:'Parsed the IMS assignment title and instruction field; excluded XML schema and submission-format metadata from learner text. Original source evidence is retained.'};
    }catch(e){return gap;}
};
}

export function qaNormalizeBrightspaceAssignment_(assignment) {
    var a=Object.assign({},assignment||{}),raw=a.raw||{};
    var candidates=[['instructions',a.instructions],['raw.CustomInstructions',raw.CustomInstructions],['raw.Instructions',raw.Instructions],['raw.Description',raw.Description],['raw.description',raw.description]];
    for(var i=0;i<candidates.length;i++){
        var text=qaBrightspaceText_(candidates[i][1]);
        if(text){var value=candidates[i][1];a.instructions={text:text,html:value&&typeof value==='object'?String(value.html||value.Html||''):''};a.instructionEvidence={sourceField:candidates[i][0],recovered:candidates[i][0]!=='instructions'};break;}
    }
    return a;
}

export function create_qaLegacyWebLinkEvidence_(services) {
const {XmlService} = services;
return function qaLegacyWebLinkEvidence_(item) {
    var raw=String(item.sourceTextSample||'');
    if(!/^imswl_/i.test(String(item.sourceTypeRaw||'')) || item.sourceTextFormat==='learner-text' || !/^\s*(?:<\?xml\b|<!DOCTYPE\b|<(?:[\w.-]+:)?webLink\b)/i.test(raw))return null;
    var gap={status:'SOURCE_REFRESH_REQUIRED',reasonCode:'SOURCE_WEBLINK_XML_UNREADABLE',urls:[],reason:'The stored source web-link XML is incomplete or unsupported. Re-scan the same original IMSCC to recover its exact launch URL.'};
    if(item.sourceEvidenceTruncated===true || /<!DOCTYPE|<!ENTITY/i.test(raw))return gap;
    try {
        var root=XmlService.parse(raw).getRootElement(),ns=root.getNamespace().getURI();
        if(root.getName()!=='webLink' || !/^https?:\/\/www\.imsglobal\.org\/xsd\/imsccv[\dp]+\/imswl_v[\dp]+\/?$/.test(ns))return gap;
        var children=root.getChildren(),urls=children.filter(function(n){return n.getName()==='url'&&n.getNamespace().getURI()===ns;}),titles=children.filter(function(n){return n.getName()==='title'&&n.getNamespace().getURI()===ns;});
        if(urls.length!==1 || titles.length>1 || children.length!==urls.length+titles.length || urls[0].getChildren().length || qaCleanText_(urls[0].getText()) || (titles.length&&titles[0].getChildren().length))return gap;
        var attr=urls[0].getAttribute('href'),url=attr?String(attr.getValue()).trim():'';
        if(!/^https?:\/\/[^\s\/?#<>]+(?:[\/?#][^\s<>]*)?$/i.test(url) || qaIsTechnicalSchemaUrl_(url))return gap;
        var existing=(item.sourceLinks||[]).map(function(u){return typeof u==='string'?u.trim():String(u&&(u.raw||u.href||u.url)||'').trim();}).filter(function(u){return /^https?:\/\//i.test(u)&&!qaIsTechnicalSchemaUrl_(u);});
        if(existing.some(function(u){return u!==url;}))return {status:'SOURCE_REFRESH_REQUIRED',reasonCode:'SOURCE_WEBLINK_URL_CONFLICT',urls:[],reason:'The stored web-link XML and extracted source URLs disagree. Inspect or re-scan the original IMSCC before accepting either launch target.'};
        return {status:'RECOVERED_STORED_WEBLINK_XML',reasonCode:'SOURCE_WEBLINK_URL_RECOVERED',urls:[url],text:titles.length?qaCleanText_(titles[0].getText()):'',reason:'Recovered the exact launch URL from the stored IMS webLink/url href attribute, including its query and fragment. Original source XML is retained.'};
    } catch(e) {return gap;}
};
}

export function qaLaunchUrlComparisonKey_(value) {
    // HTTP(S) empty paths and '/' are equivalent. Preserve path case, non-root
    // trailing slashes, query strings and fragments; they can select content.
    return String(value||'').trim().replace(/^(https?:\/\/[^/?#\s]+)(?=[?#]|$)/i,'$1/');
}

export function qaExternalWebpageEvidence_(source,coursera) {
    if(!/^(?:Ungraded )?Plugin$/i.test(coursera.type) || !(/^imswl_/i.test(String(source.sourceTypeRaw||'')) || source.type==='Reading'))return null;
    var raw=coursera.original||{},payload=raw.payload||{},plugin=coursera.pluginEvidence||payload.pluginEvidence||null;
    var expected=(source.sourceLinkUrls||(source.original||{}).sourceLinks||source.links||[]).map(function(u){return typeof u==='string'?u.trim():String(u&&(u.raw||u.href||u.url)||'').trim();}).filter(function(u){return /^https?:\/\//i.test(u)&&!qaIsTechnicalSchemaUrl_(u);});
    var captured=(coursera.capturedLinkUrls||payload.links||raw.links||[]).filter(function(u){return typeof u==='string';}).map(function(u){return u.trim();});
    expected=expected.filter(function(u,i,a){return a.indexOf(u)===i;});captured=captured.filter(function(u,i,a){return a.indexOf(u)===i;});
    var confidence=Number(coursera.linkEvidenceConfidence),text=String(payload.textSample||coursera.textSample||'');
    var marker=/\bChoose Plugin\s+External Webpage\b/i.test(text),youtube=/\bChoose Plugin\s+YouTube\b/i.test(text);
    var scoped=plugin && plugin.itemId===coursera.id && plugin.scope==='ITEM_EDITOR';
    if(scoped){
        marker=marker||plugin.kind==='EXTERNAL_WEBPAGE';youtube=youtube||plugin.kind==='YOUTUBE';
        // Published authoring surfaces expose View Configuration instead of
        // Choose Plugin. Require the same item's scoped capture and exact UI
        // boundary; prose mentioning a plugin does not establish configuration.
        if(plugin.kind==='PLUGIN' && (payload.textScopeKind||coursera.textScopeKind)==='scoped-subtree' &&
            /^PLUGIN\s+.+\s+External Webpage\s+View Configuration(?:\s+Settings\b|$)/i.test(text.trim()))marker=true;
    }
    var out={status:'UNVERIFIED',kind:youtube?'YOUTUBE_PLUGIN_WRAPPER':'EXTERNAL_WEBPAGE_WRAPPER',sourceTypeRaw:String(source.sourceTypeRaw||''),sourceUrls:expected,capturedUrls:captured,
        linkEvidenceConfidence:Number.isFinite(confidence)?confidence:null,configurationMarkerObserved:marker||youtube,launchStatus:'NOT_OBSERVED',
        transformationCandidate:/^imswl_/i.test(String(source.sourceTypeRaw||'')),runtime:qaPluginRuntimeSummary_(scoped?plugin:null)};
    function gap(code,reason){out.reasonCode=code;out.reason=reason;return out;}
    if(!/^imswl_/i.test(out.sourceTypeRaw))return gap('SOURCE_WEBLINK_TYPE_UNCONFIRMED','The stored source resource type does not establish an IMS web link. Inspect the source resource before accepting the plugin conversion.');
    if(source.sourceLinkNormalization && source.sourceLinkNormalization.status==='SOURCE_REFRESH_REQUIRED')return gap(source.sourceLinkNormalization.reasonCode,source.sourceLinkNormalization.reason);
    if(!expected.length)return gap('SOURCE_URL_NOT_CAPTURED','No exact source launch URL is available. Re-scan the same original IMSCC to capture the web-link URL; a matching title cannot establish URL preservation.');
    if(expected.length!==1)return gap('SOURCE_URL_AMBIGUOUS','Multiple distinct source URLs were captured. Identify the intended launch target before accepting the conversion.');
    if(!marker&&!youtube)return gap('PLUGIN_CONFIGURATION_UNOBSERVED','The capture does not identify the plugin configuration. Inspect its configuration or refresh the Coursera capture.');
    var targets=captured;
    if(youtube){
        targets=captured.filter(function(u){return /^https?:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\//i.test(u);});
        if(scoped)(plugin.targets||[]).forEach(function(t){if(t.url&&/^https?:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\//i.test(t.url)&&targets.indexOf(t.url)<0)targets.push(t.url);});
        if(!targets.length)return gap('YOUTUBE_TARGET_UNOBSERVED','A Coursera YouTube plugin was observed, but its configured video target was not captured. Inspect the plugin configuration or learner preview against the source video URL. The wrapper URL does not establish a missing or preserved video.');
    }
    out.configuredTargets=targets;
    if(!Number.isFinite(confidence)||confidence<0.9)return gap('CAPTURED_LINK_CONFIDENCE_LOW','The captured destination URL evidence is too weak to verify the plugin configuration. Inspect its configuration or refresh the Coursera capture.');
    if(!targets.length)return gap('CAPTURED_URL_NOT_AVAILABLE','No complete destination URL survived a confirmed item-identity match. Check the XLSX item ID and refresh the Coursera capture if needed.');
    // Collapse equivalent bare YouTube forms only; semantic query parameters survive.
    var uniqueTargets=[];targets.forEach(function(u){if(!uniqueTargets.some(function(v){return qaLaunchUrlComparisonKey_(v)===qaLaunchUrlComparisonKey_(u)||(qaYoutubeVideoId_(u)&&qaYoutubeVideoId_(u)===qaYoutubeVideoId_(v));}))uniqueTargets.push(u);});
    if(uniqueTargets.length!==1)return gap('CAPTURED_URL_AMBIGUOUS','Multiple distinct destination targets were captured. The intended launch target is not established.');
    var exact=qaLaunchUrlComparisonKey_(expected[0])===qaLaunchUrlComparisonKey_(uniqueTargets[0]),sameVideo=youtube&&qaYoutubeVideoId_(expected[0])&&qaYoutubeVideoId_(expected[0])===qaYoutubeVideoId_(uniqueTargets[0]);
    if(!exact&&!sameVideo)return gap('LAUNCH_URL_DIFFERS','The source and destination targets differ. Query, fragment and video identity differences remain material; review the recorded targets.');
    out.status='VERIFIED_CONFIGURATION';out.sourceUrl=expected[0];out.courseraUrl=uniqueTargets[0];out.reasonCode=sameVideo?'YOUTUBE_VIDEO_ID_PRESERVED':(expected[0]===uniqueTargets[0]?'EXACT_LAUNCH_URL_PRESERVED':'EQUIVALENT_ROOT_URL_PRESERVED');
    out.reason=youtube?'The source video target is preserved in the observed Coursera YouTube configuration. Playback remains unverified.':'The source web-link target is preserved in a captured Coursera External Webpage plugin'+(out.reasonCode==='EQUIVALENT_ROOT_URL_PRESERVED'?' (equivalent empty path and root slash)':'')+'. Learner launch and remote availability have not been observed.';
    return out;
}

export function create_normalizeSourceItem_(services) {
const qaLegacyWebLinkEvidence_ = function(...args) { return bindServices(create_qaLegacyWebLinkEvidence_, services).apply(this, args); };
const qaLegacyDiscussionText_ = function(...args) { return bindServices(create_qaLegacyDiscussionText_, services).apply(this, args); };
const qaLegacyAssignmentText_ = function(...args) { return bindServices(create_qaLegacyAssignmentText_, services).apply(this, args); };
return function normalizeSourceItem_(item) {
    var assetCandidates = [];
    (item.sourceFiles || []).forEach(function(value) { assetCandidates.push(value); });
    (item.sourceImages || []).forEach(function(value) {
        // DOM image URLs are observations, not additional package payloads.
        // Concrete manifest files remain in sourceFiles, with hashes/presence.
        if (typeof value === 'string') {
            assetCandidates.push({ href:value, name:qaFileName_(value), evidenceSource:'source-image-reference', referenceOnly:true, presentInPackage:null });
        } else assetCandidates.push(value);
    });
    // v6.5.8: embeddedRefs are parser observations, not proof of an independent
    // package file. Keep them for diagnostics without letting a bare filename
    // re-enter the expected-payload denominator after ZIP presence was resolved.
    (item.sourceEmbeddedRefs || []).forEach(function(value) {
        var raw = String(value || '');
        if (!raw) return;
        assetCandidates.push({ href: raw, name: qaFileName_(raw), evidenceSource: 'source-embedded-reference', referenceOnly: true, presentInPackage: null });
    });

    var assetDetails = qaUniqueAssetDescriptors_(assetCandidates);
    var webLink=qaLegacyWebLinkEvidence_(item);
    var recoveredUrls=webLink&&webLink.status==='RECOVERED_STORED_WEBLINK_XML'?webLink.urls:[];
    var sourceLinkUrls=(item.sourceLinks||[]).concat(recoveredUrls);
    var rawSourceText = qaCleanText_(item.sourceTextSample);
    var sourceText = item.sourceTextFormat !== 'learner-text' && /imsdt|imsqti/i.test(String(item.sourceTypeRaw || '')) && !/v6\.8\.(?:2-learner-text|3-table-text)/.test(String(item.sourceEvidenceBuildId || '')) ? qaLearnerMarkupText_(rawSourceText) : rawSourceText;
    var discussionText = item.sourceTextNormalizationStatus === 'SOURCE_REFRESH_REQUIRED'
        ? {status:'SOURCE_REFRESH_REQUIRED',text:'',reason:'The source scanner could not extract learner text from one or more files. Inspect the source extraction error and refresh the original IMSCC before judging content equivalence.'}
        : (qaLegacyDiscussionText_(item) || qaLegacyAssignmentText_(item));
    if(discussionText) sourceText=discussionText.text;
    if(webLink&&webLink.status==='RECOVERED_STORED_WEBLINK_XML')sourceText=webLink.text;
    var textChanged = sourceText !== rawSourceText;

    return {
        id: String(item.id || ''),
        name: qaCleanText_(item.name),
        type: qaCleanText_(item.type) || 'Reading',
        path: qaCleanText_(item.path) || 'Root',
        files: assetDetails.map(function(desc) { return desc.name || desc.url; }),
        assetDetails: assetDetails,
        links: qaExternalLinks_(sourceLinkUrls),
        sourceLinkUrls:sourceLinkUrls,
        sourceLinkNormalization:webLink?{status:webLink.status,reasonCode:webLink.reasonCode,reason:webLink.reason}:null,
        sourceTextNormalization: discussionText ? {status:discussionText.status,reason:discussionText.reason} : null,
        sourceTextRefreshRequired: !!discussionText && discussionText.status==='SOURCE_REFRESH_REQUIRED',
        textSample: sourceText,
        textSha256: textChanged ? '' : String(item.sourceTextSha256 || ''),
        textLength: textChanged && item.sourceEvidenceTruncated !== true ? sourceText.length : nonNegativeInteger_(item.sourceTextLength),
        evidenceTruncated: item.sourceEvidenceTruncated === true,
        sourceTypeRaw: qaCleanText_(item.sourceTypeRaw || ''),
        contentComparable: !/(imswl|imsbasiclti)/i.test(String(item.sourceTypeRaw || '')),
        isStructuredAssessment: /imsqti/i.test(String(item.sourceTypeRaw || '')),
        structuredAssessment: (item.sourceStructuredAssessment && typeof item.sourceStructuredAssessment === 'object') ? item.sourceStructuredAssessment : null,
        behavior: (item.sourceBehavior && typeof item.sourceBehavior === 'object') ? item.sourceBehavior : null,
        interactiveSignals: (item.sourceInteractiveSignals && typeof item.sourceInteractiveSignals === 'object') ? item.sourceInteractiveSignals : null,
        parentSourceId: String(item.parentSourceId || ''),
        parentSourceName: qaCleanText_(item.parentSourceName || ''),
        parentSourceType: qaCleanText_(item.parentSourceType || ''),
        hierarchyPath: qaCleanText_(item.hierarchyPath || item.path || 'Root'),
        hiddenDependency: qaHiddenDependencyKind_(item),
        sourceEvidenceSchemaVersion: nonNegativeInteger_(item.sourceEvidenceSchemaVersion),
        sourceEvidenceExtractor: qaCleanText_(item.sourceEvidenceExtractor || ''),
        sourceEvidenceBuildId: qaCleanText_(item.sourceEvidenceBuildId || ''),
        original: item
    };
};
}

export function qaMergeCourseraStructuredEvidence_(primary, fallback) {
    if (!primary || typeof primary !== 'object') return fallback || null;
    if (!fallback || typeof fallback !== 'object') return primary;

    var p = qaNormalizeAssessment_(primary, 'coursera-assignment');
    var f = qaNormalizeAssessment_(fallback, 'coursera-assignment');
    if (!p) return f || primary;
    if (!f) return p || primary;

    // Modern item-scoped question identities and explicit coverage outrank a
    // flattened text sample. A clipped viewer must not reorder or duplicate them.
    if (primary.captureCompleteness && p.questions.some(function(q){return q.courseraQuestionId;})) return p;

    // The text parser sees explicit numbered question boundaries and therefore
    // provides the safer canonical order/count. Overlay higher-trust DOM badge
    // evidence on the matching prompt. This prevents an omitted middle DOM card
    // from renumbering every later question.
    var out = {
        schemaVersion: 1,
        origin: 'coursera-authoring-editor',
        parser: 'coursera-editor-dom+text-v2',
        declaredQuestionCount: Math.max(
            Number(p.declaredQuestionCount || 0),
            Number(f.declaredQuestionCount || 0),
            Number(p.questionCount || 0),
            Number(f.questionCount || 0)
        ),
        questions: [],
        parserConfidence: 0,
        warnings: []
    };

    var usedPrimary = {};
    for (var i = 0; i < f.questions.length; i++) {
        var fq = JSON.parse(JSON.stringify(f.questions[i]));
        var best = -1, bestScore = 0;
        for (var j = 0; j < p.questions.length; j++) {
            if (usedPrimary[j]) continue;
            var sc = qaQuestionPromptSimilarity_(fq.prompt, p.questions[j].prompt);
            if (i === j) sc += 0.02;
            if (sc > bestScore) { bestScore = sc; best = j; }
        }

        if (best >= 0 && bestScore >= 0.58) {
            usedPrimary[best] = true;
            var pq = p.questions[best];

            if (qaAssessmentText_(pq.prompt)) fq.prompt = pq.prompt;
            if (qaAssessmentText_(pq.rawType)) fq.rawType = pq.rawType;
            if (qaQuestionTypeKey_(pq.type) !== 'unknown') fq.type = pq.type;

            if (pq.options && pq.options.length && pq.optionTextReliable !== false) {
                fq.options = pq.options;
                fq.optionTextReliable = true;
            }
            if (pq.correctAnswers && pq.correctAnswers.length && pq.answerTextReliable !== false) {
                fq.correctAnswers = pq.correctAnswers;
                fq.answerTextReliable = true;
            }
            if (pq.points !== null && pq.points !== undefined && Number.isFinite(Number(pq.points))) {
                fq.points = Number(pq.points);
            }
            if (qaAssessmentText_(pq.feedback)) fq.feedback = pq.feedback;
            fq.parserConfidence = Math.max(Number(fq.parserConfidence || 0), Number(pq.parserConfidence || 0));
        }

        fq.id = String(i + 1);
        out.questions.push(fq);
    }

    for (var k = 0; k < p.questions.length; k++) {
        if (usedPrimary[k]) continue;
        var clone = JSON.parse(JSON.stringify(p.questions[k]));
        clone.id = String(out.questions.length + 1);
        out.questions.push(clone);
    }

    out.questionCount = out.questions.length;
    out.selectionPolicy = (primary.selectionPolicy && primary.selectionPolicy.observed) ? primary.selectionPolicy : ((fallback.selectionPolicy && fallback.selectionPolicy.observed) ? fallback.selectionPolicy : { observed:false });
    var countAgreement = out.declaredQuestionCount === out.questionCount;
    out.parserConfidence = countAgreement
        ? Math.max(Number(p.parserConfidence || 0), Number(f.parserConfidence || 0), 0.94)
        : 0.82;

    out.warnings = (p.warnings || []).concat(f.warnings || []).filter(function(v, idx, arr) {
        return v && arr.indexOf(v) === idx;
    });
    if (countAgreement) {
        out.warnings = out.warnings.filter(function(w) { return !/declared content count/i.test(String(w)); });
    }
    return out;
}
