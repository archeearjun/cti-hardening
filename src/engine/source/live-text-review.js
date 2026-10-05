import { normalizeCourseraType_ } from "../matching/text.js";
import { workSourceItemPolicy_ } from "../work/policy.js";

function words(value) {
    return String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean);
}
function windows(tokens) {
    var found=new Set();
    for(var i=0;i+5<=tokens.length;i++)found.add(tokens.slice(i,i+5).join(' '));
    return found;
}

/** Surface positive observed wording, never infer absence from a partial capture.
 * Five-word windows ignore whitespace/punctuation and tolerate small heading
 * changes. Novel passages request a source-version review, not semantic loss. */
export function qaObservedLiveTextPassages_(live, packageText, destinationText) {
    var source=String(live||'').slice(0,40000),baseline=words(String(packageText||'').slice(0,40000));
    var destination=words(String(destinationText||'').slice(0,40000));
    var baselineWindows=windows(baseline),destinationWindows=windows(destination),passages=[];
    var candidates=source.split(/(?<=[.!?])\s+|\n+/).slice(0,256);
    candidates.forEach(function(candidate){
        var tokens=words(candidate),grams=Array.from(windows(tokens));
        if(tokens.length<8 || candidate.length<50 || candidate.length>1600 || !grams.length)return;
        var novel=grams.filter(function(g){return !baselineWindows.has(g);});
        if(novel.length<3 || novel.length/grams.length<0.30)return;
        var unestablished=novel.filter(function(g){return !destinationWindows.has(g);});
        if(unestablished.length<3 || unestablished.length/grams.length<0.30)return;
        if(passages.indexOf(candidate)===-1)passages.push(candidate);
    });
    return {passages:passages.slice(0,6),additionalPassages:Math.max(0,passages.length-6),
        bounded:true,meaning:'Observed wording differs. Paraphrases, approved edits and source-version differences require human reconciliation; this does not establish deletion or complete text coverage.'};
}

export function qaAttachLiveSourceTextReviews_(results, sources, destinations, liveReport, partner) {
    if(!liveReport)return;
    (results||[]).forEach(function(row){
        if(!row.sourceId)return;
        var checks=row.checks||{};
        if(checks.transformationFamily || checks.oneToManyTransformation || checks.repackaging || checks.semanticRepackaging)return;
        var matchingSources=(sources||[]).filter(function(s){return String(s.id)===String(row.sourceId);});
        var matchingDestinations=(destinations||[]).filter(function(d){return !!row.courseraId && String(d.id)===String(row.courseraId);});
        if(matchingSources.length!==1 || matchingDestinations.length!==1)return;
        var source=matchingSources[0],destination=matchingDestinations[0],live=source.liveSource||{};
        if(normalizeCourseraType_(source.type)!=='Reading' || normalizeCourseraType_(destination.type)!=='Reading')return;
        // Retain the strict exact-topic navigation identity gate; a fuzzy title,
        // duplicate or composite family cannot attribute this extra review.
        var mappings=(liveReport.sourceTopicMappings||[]).filter(function(m){return String(m.sourceId)===String(source.id) && String(m.topicId)===String(live.topicId) && m.navigationEligible===true;});
        if(mappings.length!==1 || live.contentEvidenceStatus!=='CAPTURED' || (live.enrichedFields||[]).indexOf('TEXT')!==-1)return;
        if(String(source.textSample||'').length<160 || String(live.textSample||'').length<160)return;
        var observed=qaObservedLiveTextPassages_(live.textSample,source.textSample,destination.textSample);
        if(!observed.passages.length)return;
        var policy=workSourceItemPolicy_(partner||'',source);
        var reason='Captured Brightspace includes wording not established in the package or this Coursera text. Confirm the intended source version and reconcile the listed passages. This does not prove content loss.';
        row.checks=row.checks||{};
        row.checks.liveSourceText={status:'REVIEW',reason:reason,topicId:String(live.topicId),
            capturedAt:liveReport.capturedAt||'',passages:observed.passages,additionalPassages:observed.additionalPassages,
            completeCoverageVerified:false,comparisonLimitCharacters:40000,candidateLimit:256,decisionRelevant:policy.inDecisionGate!==false};
        var owner=row.ownerAction||{},action=reason+' Observed source wording: '+observed.passages.map(function(p){return '“'+p+'”';}).join(' ')+' Compare these with the intended Coursera item; update only confirmed required content. Re-ingestion is not established as a remedy.';
        if(observed.additionalPassages)action+=' '+observed.additionalPassages+' additional candidate passage(s) remain; review the retained source text as well.';
        row.ownerAction={severity:['CRITICAL','REVIEW'].indexOf(owner.severity)>=0?owner.severity:'EVIDENCE',label:'Reconcile captured source wording',
            action:(owner.severity && owner.severity!=='NONE' && owner.action?owner.action+' ':'')+action};
        liveReport.evidenceReviews=liveReport.evidenceReviews||[];
        liveReport.evidenceReviews.push({sourceId:source.id,sourceName:source.name,sourcePath:source.path,topicId:String(live.topicId),
            kind:'LIVE_SOURCE_WORDING_REVIEW',reason:reason,passages:observed.passages,decisionRelevant:policy.inDecisionGate!==false});
    });
    liveReport.evidenceReviewCount=(liveReport.evidenceReviews||[]).length;
    if((liveReport.evidenceReviews||[]).some(function(r){return r.decisionRelevant!==false;}))liveReport.status='REVIEW';
}
