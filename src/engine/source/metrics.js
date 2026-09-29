// Maintained source: explicit dependencies; no ordered concatenation.
import { qaNormalizeIngestionFailure_ } from "../assessment/assignment.js";
import { qaTextPreview_ } from "../assessment/questions.js";
import { qaFileName_ } from "../matching/assets.js";
import { qaTextComparison_ } from "../matching/payload.js";
import { qaInteractionIdentityKey_ } from "../matching/recovery.js";
import { normalizeCourseraType_, qaCleanName_, qaCleanText_, qaPathSimilarity_ } from "../matching/text.js";
import { qaOwnerActionForResult_ } from "../reporting/actions.js";

export function qaReadinessForDestination_(item, items, readiness) {
    return (readiness && readiness.findings || []).filter(function(f) {
        if (f.itemId) return String(f.itemId) === String(item.id);
        if (!f.itemName || qaCleanName_(f.itemName) !== qaCleanName_(item.name)) return false;
        if (f.path && qaCleanText_(f.path) !== qaCleanText_(item.path)) return false;
        return (items || []).filter(function(x) { return qaCleanName_(x.name) === qaCleanName_(f.itemName) && (!f.path || qaCleanText_(x.path) === qaCleanText_(f.path)); }).length === 1;
    });
}

export function qaAttachReadinessActions_(results, items, readiness) {
    (results || []).forEach(function(r) {
        var item = (items || []).filter(function(x) {return String(x.id) === String(r.courseraId) && !!x.id;})[0];
        if (!item) return;
        var active = qaReadinessForDestination_(item, items, readiness).filter(function(f) {return ['CRITICAL','REVIEW','EVIDENCE'].indexOf(f.severity) !== -1;});
        if (!active.length) return;
        r.checks = r.checks || {}; r.checks.destinationReadiness = active;
        var owner = r.ownerAction && typeof r.ownerAction === 'object' ? r.ownerAction : qaOwnerActionForResult_(r);
        var handlesAsset=!!(r.checks.ingestionProvenance && (r.checks.ingestionProvenance.unresolvedAssetClaims||[]).length && (r.issues||[]).indexOf('SI_UNRESOLVED_SOURCE_ASSET')>=0);
        var detail = active.filter(function(f){return !(handlesAsset && f.code==='SI_UNRESOLVED_SOURCE_ASSET');}).map(function(f) {return f.action;}).filter(Boolean).filter(function(action,i,all){return all.indexOf(action)===i;}).join(' ');
        var severity=owner.severity === 'CRITICAL' || active.some(function(f){return f.severity==='CRITICAL';}) ? 'CRITICAL' : owner.severity === 'REVIEW' || active.some(function(f){return f.severity==='REVIEW';}) ? 'REVIEW' : 'EVIDENCE';
        r.ownerAction = {severity:severity, label:'Destination readiness action', action:(owner.severity==='NONE'?'Source fidelity and destination readiness are separate checks. ':owner.action+' ') + detail};
    });
}

export function qaReadinessActionRepresented_(row, finding) {
    var owner=row.ownerAction || {};
    if(row.operationalPolicy && row.operationalPolicy.inDecisionGate===false)return false;
    if(['CRITICAL','REVIEW','EVIDENCE'].indexOf(owner.severity)<0 || !owner.action)return false;
    return (row.checks && row.checks.destinationReadiness || []).some(function(x){
        return x.code===finding.code && x.itemName===finding.itemName && x.path===finding.path &&
          (!finding.itemId || String(x.itemId||'')===String(finding.itemId));
    });
}

export function qaApplyReadinessToSummary_(summary, results, items, readiness) {
    summary.destinationReadiness=readiness;
    // Mapped actions already contribute to the summary. Add only findings that
    // have no matching source-result carrier, to avoid double-counting blockers.
    var extras=(readiness&&readiness.findings||[]).filter(function(f){
        if(f.policyExempt || ['CRITICAL','REVIEW','EVIDENCE'].indexOf(f.severity)<0)return false;
        return !(results||[]).some(function(r){return qaReadinessActionRepresented_(r,f);});
    });
    extras.forEach(function(f){var key=f.severity==='CRITICAL'?'ownerCritical':f.severity==='REVIEW'?'ownerReview':'ownerEvidence';summary[key]=Number(summary[key]||0)+1;});
    summary.criticalBlockers=Number(summary.criticalBlockers||0)+extras.filter(function(f){return f.severity==='CRITICAL';}).length;
    if(summary.criticalBlockers){summary.headlineStatus='BLOCKED';summary.headlineText='BLOCKED — '+summary.criticalBlockers+' critical learner-facing finding'+(summary.criticalBlockers===1?'':'s');}
    else if(extras.length){summary.headlineStatus='REVIEW';summary.headlineText='REVIEW — evidence gaps or owner checks remain';}
    return summary;
}

export function qaMissingReconciliationDiagnostic_(source, destinations) {
    var raw=source.original||{};
    var key=qaInteractionIdentityKey_(source.name);
    var candidates=(destinations||[]).filter(function(d){
        return key && normalizeCourseraType_(source.type)==='Discussion' && normalizeCourseraType_(d.type)==='Discussion' &&
            qaInteractionIdentityKey_(d.name)===key && qaPathSimilarity_(source.path,d.path)>=0.62 &&
            !qaNormalizeIngestionFailure_(d.ingestionFailure,d.name,d.textSample).detected;
    }).map(function(d){
        var comparison=qaTextComparison_(source,d);
        return {id:d.id,name:d.name,path:d.path,textLength:Number(d.textLength||0),scope:d.textScopeKind||'',completeness:Number(d.textEvidenceCompleteness||0),confidence:d.textConfidence||'',comparison:comparison};
    });
    return {sourceTextNormalization:source.sourceTextNormalization||null,sourceTypeRaw:source.sourceTypeRaw||'',sourceScanner:source.sourceEvidenceExtractor||'',sourceBuild:source.sourceEvidenceBuildId||'',sourceSampleLength:String(source.textSample||'').length,sourceDeclaredLength:Number(source.textLength||0),rawSampleLength:String(raw.sourceTextSample||'').length,sourcePreview:qaTextPreview_(source.textSample),candidates:candidates,meaning:'Candidate identity alone does not establish prompt equivalence. An unreadable source or a strong unique candidate with an inconclusive prompt comparison requires evidence follow-up. Neither condition proves absence or equivalent content.'};
}

export function qaBuildDestinationOwnerView_(items, results, readiness) {
    var rows=(items||[]).filter(function(d){return !d.evidenceOnly && !d.syntheticOneToMany;}).map(function(d,index){
        var linked=(results||[]).filter(function(r){
            var checks=r.checks||{}, family=checks.transformationFamily||checks.oneToManyTransformation||{}, rep=checks.repackaging||r.repackaging||{};
            return (!!d.id && String(r.courseraId)===String(d.id)) || (family.childIds||[]).indexOf(d.id)!==-1 || (rep.carriers||[]).some(function(c){return String(c.id)===String(d.id);});
        });
        var findings=qaReadinessForDestination_(d,items,readiness);
        var actions=linked.map(function(r){return {sourceName:r.sourceName,verdict:r.verdict,action:r.ownerAction&&r.ownerAction.action||'',severity:r.ownerAction&&r.ownerAction.severity||'EVIDENCE'};});
        (results||[]).forEach(function(r){
            if((r.checks&&r.checks.reconciliationDiagnostic&&r.checks.reconciliationDiagnostic.candidates||[]).some(function(c){return String(c.id)===String(d.id);})) {
                actions.push({sourceName:'Unconfirmed source: '+r.sourceName,verdict:'MATCH_UNCONFIRMED',action:r.ownerAction&&r.ownerAction.action||'Compare source and destination before creating a duplicate.',severity:'REVIEW'});
            }
        });
        findings.forEach(function(f){
            var alreadyAttached=linked.some(function(r){return (r.checks&&r.checks.destinationReadiness||[]).some(function(x){return x.code===f.code&&x.itemName===f.itemName&&x.path===f.path;});});
            if(!alreadyAttached) actions.push({sourceName:'Destination readiness',verdict:f.code,action:f.action,severity:f.severity});
        });
        var severity=actions.some(function(a){return a.severity==='CRITICAL';})?'REPAIR_OR_CONFIRM':actions.some(function(a){return a.severity==='REVIEW';})?'REVIEW':actions.some(function(a){return a.severity==='EVIDENCE';})?'EVIDENCE_NEEDED':linked.length?'VERIFIED_EVIDENCE':'NOT_SOURCE_VERIFIED';
        return {id:d.id,name:d.name,type:d.type,path:d.path||'Root',order:index,status:severity,published:d.published===true?true:d.published===false?false:null,actions:actions,sourceNames:linked.map(function(r){return r.sourceName;}),excerpt:qaCleanText_(d.textSample||'').slice(0,900),excerptComplete:false,pluginTargets:(d.pluginEvidence&&d.pluginEvidence.itemId===d.id&&d.pluginEvidence.targets||[]).map(function(t){return t.url;}).filter(Boolean)};
    });
    return {schemaVersion:1,authority:'Coursera XLSX order and names; captured payload excerpts. This is an audit outline, not a screenshot or a complete learner rendering.',items:rows,unmappedSource:(results||[]).filter(function(r){return !r.courseraId && (['MISSING','HIDDEN_DEPENDENCY_REVIEW'].indexOf(r.verdict)!==-1 || (r.issues||[]).indexOf('SOURCE_TEXT_REFRESH_REQUIRED')!==-1 || (r.issues||[]).indexOf('SOURCE_DESTINATION_MATCH_UNCONFIRMED')!==-1);}).map(function(r){return {name:r.sourceName,path:r.sourcePath,verdict:r.verdict,action:r.ownerAction&&r.ownerAction.action||'',diagnostic:r.checks&&r.checks.reconciliationDiagnostic||null};})};
}

export function qaAttachSourceAssetProvenance_(destinations, originalItems) {
    var byHash=Object.create(null);
    (originalItems||[]).forEach(function(item){
        (item.sourceFiles||[]).forEach(function(file){
            var hash=String(file.sha256||'').toLowerCase();
            if(file.presentInPackage!==true || file.referenceOnly===true || !/^[a-f0-9]{64}$/.test(hash))return;
            if(!byHash[hash])byHash[hash]=[];
            byHash[hash].push({sourceId:item.id||'',sourceName:item.name||'',sourcePath:item.path||'',
                fileName:file.name||qaFileName_(file.path||file.href||''),filePath:file.path||file.href||''});
        });
    });
    (destinations||[]).forEach(function(item){
        var seen=Object.create(null),matches=[],unmatched=[];
        var hashedUrls=Object.create(null);
        (item.assetDetails||[]).forEach(function(f){if(f.url&&/^[a-f0-9]{64}$/i.test(String(f.sha256||'')))hashedUrls[f.url]=true;});
        (item.assetDetails||[]).forEach(function(file){
            var hash=String(file.sha256||'').toLowerCase();
            if(!/^[a-f0-9]{64}$/.test(hash) || seen[hash])return;
            seen[hash]=true;
            if(byHash[hash])matches.push({sha256:hash,destinationFile:file.name||qaFileName_(file.url||''),sources:byHash[hash]});
            else unmatched.push({sha256:hash,destinationFile:file.name||qaFileName_(file.url||'')});
        });
        // Clear any imported assertion: only this comparison can establish provenance.
        item.sourceAssetProvenance=matches.length?{status:'SOURCE_ASSETS_OBSERVED',method:'SHA256_EXACT',
            matchedFileCount:matches.length,matches:matches,unmatchedHashedFiles:unmatched,
            unresolvedDownloadFiles:(item.assetDetails||[]).filter(function(f){return f.url && !f.sha256 && !hashedUrls[f.url];}).map(function(f){return {name:f.name||'',url:f.url};}),
            itemContentVerified:false,placementVerified:false,visibilityVerified:false}:null;
    });
}

export function qaSourceAssetCarrierAction_(evidence) {
    var names=[];
    (evidence.matches||[]).forEach(function(m){(m.sources||[]).forEach(function(s){if(names.indexOf(s.fileName)<0)names.push(s.fileName);});});
    return 'Source attachment provenance verified by SHA-256 for '+evidence.matchedFileCount+' file(s): '+names.join('; ')+
        '. Keep the source-backed material while reviewing its intended module placement and learner visibility, including any answer keys. '+
        'This verifies those file bytes only; it does not verify all surrounding text, additional files or item behavior.'+
        ((evidence.unmatchedHashedFiles||[]).length?' Additional hashed files have no exact source match and require review.':'')+
        ((evidence.unresolvedDownloadFiles||[]).length?' Additional download files lack a complete fingerprint and remain unverified.':'');
}

export function qaDocumentScopeComparison_(source,coursera) {
    var text=qaCleanText_(coursera.textSample||'').replace(/[\u200b-\u200d\ufeff]/g,'').trim();
    var viewer=/^(?:\d+\s*)?\/\s*\d+\s+\d{1,3}%\s+\S/.test(text) || coursera.textScopeKind==='document-viewer';
    var description=qaCleanText_(source.textSample||'');
    if(!viewer || description.length<80 || description.length>600 || Number(source.textLength||description.length)>600)return null;
    var originals=(source.original||{}).sourceFiles||[],sourcePdf=[];
    originals.forEach(function(f){
        if(/\.pdf$/i.test(String(f.name||f.path||f.href||'')) && f.presentInPackage===true && !f.referenceOnly && /^[a-f0-9]{64}$/i.test(String(f.sha256||'')))sourcePdf.push(f);
    });
    // A substantive HTML body alongside the document is not reduced to a caption.
    if(originals.some(function(f){return /\.html?$/i.test(String(f.name||f.path||f.href||'')) && Number(f.textLength||0)>600;}))return null;
    var matches=sourcePdf.filter(function(f){return (coursera.assetDetails||[]).some(function(d){return String(d.sha256||'').toLowerCase()===String(f.sha256).toLowerCase();});});
    if(!matches.length)return null;
    return {status:'UNVERIFIED',mode:'DOCUMENT_DESCRIPTION_SCOPE',reasonCode:'DESCRIPTION_VS_DOCUMENT_SURFACE',similarity:null,
        documentIdentity:'SHA256_EXACT',matchedDocuments:matches.map(function(f){return f.name||f.path||f.href;}),
        descriptionStatus:'NOT_OBSERVED',sourcePreview:description,courseraPreview:qaTextPreview_(text),sourceLength:description.length,courseraLength:text.length,
        sourceScopeKind:'source-description',scopeKind:'document-viewer',
        reason:'The source PDF bytes are preserved exactly. Captured text comes from the PDF viewer, while the source text is a short surrounding description. These fields are not comparable; description preservation remains unverified.'};
}

export function qaYoutubeVideoId_(value) {
    var s=String(value||'').trim(),match;
    // Compare only an unambiguous bare video target. Start/end/list parameters
    // and fragments require an exact full-URL comparison instead.
    match=s.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/i);
    if(!match)match=s.match(/^https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})$/i);
    if(!match)match=s.match(/^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})$/i);
    return match?match[1]:'';
}

export function qaPluginRuntimeSummary_(plugin) {
    var frames=plugin&&Array.isArray(plugin.frames)?plugin.frames:[];
    return {launchStatus:'NOT_VERIFIED',frameCount:frames.length,
        readableFrames:frames.filter(function(f){return f.access==='READABLE';}).length,
        inaccessibleFrames:frames.filter(function(f){return f.access==='CROSS_ORIGIN_UNREADABLE'||f.access==='INACCESSIBLE'||f.access==='DOCUMENT_UNAVAILABLE';}).length,
        playbackStatus:'NOT_OBSERVED',submissionStatus:'NOT_TESTED'};
}
