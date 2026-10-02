

export function qaCaptureInputsText_(res) {
    res=res||{};
    var meta=(res.stats&&res.stats.extractorMeta)||{},review=res.captureReadiness||{};
    var captured=qaCapturedExtractorLabel_(res);
    var lines=['CAPTURE INPUTS','Report evidence source: uploaded Coursera capture JSON','Coursera captured extractor: '+captured];
    if(meta.capturedAt)lines.push('Coursera capture time: '+meta.capturedAt);
    var recovery=meta.supplementalReadingRecovery;
    if(recovery){
      lines.push('Recovery baseline capture: '+recovery.baselineCapture);
      lines.push('Reading recovery: '+recovery.recoveredEditors+'/'+recovery.requested+' editors | version='+recovery.version+' | captured='+recovery.finishedAt+' | file='+recovery.fileName);
      lines.push(recovery.meaning);
      (recovery.payloadGaps||[]).forEach(function(g){lines.push('  Recovered editor '+g.id+' | '+g.code+' | '+g.reason);});
    }
    var currentBuild=String(CTI_RELEASE_REGISTRY_.courseraExtractor.build||'');
    if(review.expectedVersion)lines.push('Current available Coursera extractor: '+review.expectedVersion+
      (currentBuild?' | build='+currentBuild:'')+' | capture status='+review.status);
    if(review.olderCapture)lines.push('Version relationship: HISTORICAL_CAPTURE — this report remains anchored to '+captured+'; the current extractor does not retroactively change its evidence.');
    else if(review.status==='NEWER_CAPTURE')lines.push('Version relationship: CAPTURE_NEWER_THAN_APP — refresh CTI before interpreting version-sensitive checks.');
    else if(review.expectedVersion)lines.push('Version relationship: CURRENT_CAPTURE_VERSION.');
    lines.push('Version meaning: This report is anchored to the uploaded capture build. The current available extractor is informational and never rewrites historical capture evidence.');
    if(review.action)lines.push('ACTION: '+review.action);
    if(review.traversal&&review.traversal.recorded)lines.push('Item editors observed: '+review.traversal.visited+'/'+review.traversal.eligible+' | unresolved='+review.traversal.unresolvedCount+(review.traversal.unresolvedItemIds.length?' | unresolved IDs: '+review.traversal.unresolvedItemIds.join(', '):''));
    (review.observedEmptySourceAssessments||[]).forEach(function(q){lines.push('  '+q.name+(q.id?' ['+q.id+']':'')+': destination editor confirmed empty | matched source questions='+q.sourceQuestions+' | review content and intended placement');});
    (review.assessmentGaps||[]).forEach(function(q){lines.push('  '+q.name+(q.id?' ['+q.id+']':'')+': source questions='+Number(q.sourceQuestions||0)+' | captured questions='+q.captured+' | destination declared='+(q.declaredObserved===false?'not observed':q.declared)+(q.sourceEvidenceOnly?' | source answer evidence incomplete; captured destination keys complete':q.answerEvidenceOnly?' | answer evidence or applicability needs review':q.answerEvidenceIncomplete?' | answer evidence incomplete':''));});
    var live=res.liveSourceGroundTruth||(res.summary&&res.summary.liveSourceGroundTruth)||(res.stats&&res.stats.sourceGroundTruth);
    if(!live){lines.push('Live Brightspace file: not recorded in this report. A console completion message does not attach its JSON to QA.');return lines.join('\n')+'\n\n';}
    lines.push('Live Brightspace file: '+String(live.fileName||'Included')+' | extractor='+String(live.buildId||live.extractor||'Not recorded')+' | captured='+String(live.capturedAt||'Not recorded'));
    lines.push('Live-source corroboration: '+String(live.status||'RECORDED')+' | matched package items='+Number(live.matchedSourceItems||0)+' | live-only='+Number(live.liveOnlyCount||0)+' | contradictions='+Number(live.contradictionCount||0)+' | permission blocks='+Number(live.permissionBlocks||0));
    var quiz=live.quizCapture;
    if(quiz){
      lines.push('Brightspace quiz evidence: '+quiz.capturedQuestionDefinitions+' question definitions across '+quiz.quizzes+' quizzes | quizzes needing evidence review='+quiz.quizEvidenceGaps);
      (quiz.items||[]).forEach(function(q){lines.push('  '+q.name+' ['+q.id+']: captured definitions='+q.capturedQuestionDefinitions+' | description states='+(q.descriptionQuestionCount==null?'not observed':q.descriptionQuestionCount)+' | '+q.status);});
      lines.push(quiz.countMeaning);
    }
    if(live.matchedBundledAssetCount)lines.push('Matched package attachments='+Number(live.matchedBundledAssetCount)+' (identity matched; file content not verified by this match).');
    (live.evidenceReviews||[]).forEach(function(x){lines.push('  Live-source evidence review: '+String(x.sourceName||'')+' | '+String(x.kind||'')+' | '+String(x.reason||''));});
    (live.warnings||[]).forEach(function(w){lines.push('  Brightspace capture note: '+String(w));});
    (live.contradictions||[]).forEach(function(x){lines.push('  Package/live finding: '+String(x.sourceName||'Untitled')+' | '+String(x.kind||'CONTRADICTION')+(x.liveTopic?' → '+x.liveTopic:'')+(x.decisionRelevant===false?' [policy-exempt]':''));});
    (live.liveOnlyItems||[]).forEach(function(x){lines.push('  Live-only item: '+String(x.title||'Untitled')+' @ '+String(x.path||'Root')+(x.decisionRelevant===false?' [policy-exempt]':''));});
    return lines.join('\n')+'\n\n';
 }

export function qaCapturedExtractorLabel_(res) {
    var meta=(res.stats&&res.stats.extractorMeta)||{},crawl=meta.activeSpaCrawl||{},review=res.captureReadiness||{};
    return String(crawl.buildId||meta.buildId||crawl.version||meta.extractor||review.observedBuild||'Not recorded');
 }

export function qaMissingScopeText_(res) {
   res=res||{};
   var rows=(res.itemResults||[]).filter(function(r){return r.verdict==='MISSING';});
   var exempt=rows.filter(function(r){return r.operationalPolicy&&r.operationalPolicy.inDecisionGate===false;}).length;
   var total=res.summary&&res.summary.missing!=null?Number(res.summary.missing):rows.length;
   if(!total)return '';
   var policy=res.operationalPolicy||{},gate=policy.learnerFacingMissing;
   return 'Missing rows across all source areas: '+total+' | excluded from automatic redo: '+exempt+(gate!=null?' | learner-facing missing in decision gate: '+Number(gate):'')+'. These are item-match counts, not a count of required course edits. Unread editors remain evidence gaps; zero missing in the decision gate does not establish complete preservation.';
 }
