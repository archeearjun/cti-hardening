

function qaCourseraCaptureReadiness_(meta, itemResults) {
  meta=meta||{};
  var crawl=meta.activeSpaCrawl||{};
  var observed=String(crawl.buildId||meta.buildId||crawl.version||meta.extractor||'');
  var expected=CTI_RELEASE_REGISTRY_.courseraExtractor.version;
  function version(value){var m=String(value||'').match(/\bv?(\d+)\.(\d+)\.(\d+)(?:\b|[-_])/);return m?m.slice(1).map(Number):null;}
  var actual=version(observed),latest=version(expected),order=0;
  if(actual) for(var i=0;i<3;i++){if(actual[i]!==latest[i]){order=actual[i]<latest[i]?-1:1;break;}}
  var gaps=[],observedEmpty=[];
  (itemResults||[]).forEach(function(r){
    var q=r.checks&&r.checks.structuredAssessment;if(!q)return;
    if(qaConfirmedEmptyComparison_(r)) {
      observedEmpty.push({id:String(r.courseraId||''),name:String(r.courseraName||r.sourceName||'Assessment'),sourceQuestions:Number(q.sourceQuestionCount||0),destinationQuestions:0,state:'OBSERVED_EMPTY_EDITOR'});
      return;
    }
    var captured=Number(q.courseraQuestionCount||0),declared=Number(q.courseraDeclaredQuestionCount||0);
    var partial=declared>0&&captured<declared;
    var answerGap=q.status==='UNVERIFIED'&&q.answerEvidenceApplicable!==false&&q.answerEvidenceCoverage!=null&&Number(q.answerEvidenceCoverage)<1;
    if(partial||answerGap)gaps.push({id:String(r.courseraId||''),name:String(r.courseraName||r.sourceName||'Assessment'),captured:captured,declared:declared,sourceQuestions:Number(q.sourceQuestionCount||0),declaredObserved:declared>0,questionCaptureIncomplete:partial,answerEvidenceIncomplete:answerGap,sourceAnswerEvidence:qaAssessmentAnswerEvidenceSide_(q,'source'),destinationAnswerEvidence:qaAssessmentAnswerEvidenceSide_(q,'coursera'),answerEvidenceOnly:qaAssessmentAnswerOnlyGap_(q),sourceEvidenceOnly:answerGap&&!partial&&declared>0&&captured===declared&&!(q.captureIssueQuestionNumbers||[]).length&&qaAssessmentAnswerEvidenceSide_(q,'source')==='INCOMPLETE'&&qaAssessmentAnswerEvidenceSide_(q,'coursera')==='COMPLETE'});
  });
  var status=!actual?'VERSION_UNKNOWN':(order<0?'OLDER_CAPTURE':(order>0?'NEWER_CAPTURE':'CURRENT_VERSION'));
  var action='';
  if(gaps.length&&gaps.every(function(g){return g.sourceEvidenceOnly;})) {
    status=actual?'SOURCE_ASSESSMENT_EVIDENCE_REVIEW':'VERSION_UNKNOWN_WITH_GAPS';
    action='Captured Coursera question counts meet their destination declarations. The remaining answer evidence gaps are in the source assessment data. Inspect original source keys and any source-to-destination question differences; repeating the Coursera extraction cannot resolve these source gaps. This does not establish complete course fidelity.';
  }
  else if(gaps.length&&order<0&&actual&&!gaps.every(function(g){return g.answerEvidenceOnly;})){status='OLDER_CAPTURE_WITH_GAPS';action='The uploaded Coursera JSON was captured with '+('v'+actual.join('.'))+'; '+expected+' is available. A newer version alone does not establish that these evidence gaps are fixed. Inspect the specific uncaptured fields and stopping reasons; repeat extraction when a relevant recovery fix is available or the course has changed. Existing captured evidence remains usable.';}
  else if(gaps.length && gaps.every(function(g){return g.answerEvidenceOnly;})) {
    status=actual?'ANSWER_EVIDENCE_REVIEW':'VERSION_UNKNOWN_WITH_GAPS';
    action='The captured question counts and prompts align for '+gaps.length+' assessment(s); answer evidence or its applicability still needs review. Confirm whether answer keys apply and obtain any required source/destination keys before approval. These comparisons do not identify missing question positions.';
  }
  else if(gaps.length&&gaps.every(function(g){return !g.questionCaptureIncomplete;})){status=actual?'ASSESSMENT_EVIDENCE_REVIEW':'VERSION_UNKNOWN_WITH_GAPS';action='Assessment answer evidence still needs review. Inspect the source and destination answer fields and their applicability; the captured counts do not identify a shortfall against a known destination declaration. Unknown totals and missing answer evidence remain unresolved. This does not establish complete assessment fidelity.';}
  else if(gaps.length){status=actual?'CAPTURE_INCOMPLETE':'VERSION_UNKNOWN_WITH_GAPS';action='Assessment capture is incomplete. Review the uncaptured question positions, answer evidence, and stopping reason before approval. A capture gap does not prove content deletion.';}
  if(observedEmpty.length)action+=(action?' ':'')+observedEmpty.length+' source-matched assignment editor(s) were confirmed empty. Review their source content and intended placement; the empty-state evidence does not require another identical crawl. This is a content review, and does not establish course completeness.';
  var traversal=qaCaptureTraversalSummary_(meta);
  if(traversal.recorded&&!traversal.complete){status='EDITOR_TRAVERSAL_INCOMPLETE';action='Only '+traversal.visited+'/'+traversal.eligible+' item editors were observed; '+traversal.unresolvedCount+' remain unresolved. Recover or inspect those specific items before concluding that their payload is missing. Independently observed content defects still require correction. '+action;}
  return {status:status,observedVersion:actual?'v'+actual.join('.'):'',observedBuild:observed,expectedVersion:expected,traversal:traversal,olderCapture:!!actual&&order<0,assessmentGaps:gaps,observedEmptySourceAssessments:observedEmpty,action:action};
}

function qaMergeCourseraPayload_(excelItem, liveItem) {
    if (!liveItem) return excelItem;
    excelItem.assetDetails = qaUniqueAssetDescriptors_((excelItem.assetDetails || []).concat(liveItem.assetDetails || []).concat(liveItem.files || []));
    excelItem.files = excelItem.assetDetails.map(function(desc) { return desc.name || desc.url; });
    excelItem.assetEvidenceConfidence = Math.max(Number(excelItem.assetEvidenceConfidence || 0), Number(liveItem.assetEvidenceConfidence || 0));
    excelItem.linkEvidenceConfidence = Math.max(Number(excelItem.linkEvidenceConfidence || 0), Number(liveItem.linkEvidenceConfidence || 0));
    // Exact launch evidence belongs to the captured stable item ID. Name-only
    // enrichment cannot establish the configuration of a different item.
    excelItem.pluginEvidence = excelItem.id && excelItem.id===liveItem.id && liveItem.pluginEvidence && liveItem.pluginEvidence.itemId===excelItem.id ? JSON.parse(JSON.stringify(liveItem.pluginEvidence)) : null;
    excelItem.readingEditorEvidence = excelItem.id && excelItem.id===liveItem.id ? liveItem.readingEditorEvidence || null : null;
    var sameEvidenceItem=Boolean(excelItem.id && excelItem.id===liveItem.id);
    excelItem.readingAttachmentEvidence=sameEvidenceItem && liveItem.readingAttachmentEvidence?JSON.parse(JSON.stringify(liveItem.readingAttachmentEvidence)):null;
    excelItem.textCaptureEvidence=sameEvidenceItem && liveItem.textCaptureEvidence?JSON.parse(JSON.stringify(liveItem.textCaptureEvidence)):null;
    excelItem.emptyEditorEvidence=sameEvidenceItem?qaObservedEmptyAssessmentReceipt_(liveItem):null;
    excelItem.textCaptureTruncated = liveItem.textCaptureTruncated===true;
    excelItem.readingCaptureGap = liveItem.readingCaptureGap || '';
    excelItem.capturedLinkUrls = excelItem.id && excelItem.id === liveItem.id && Array.isArray(liveItem.capturedLinkUrls) ? liveItem.capturedLinkUrls.slice() : [];

    var mergedLinks = (excelItem.links || []).concat(liveItem.links || []);
    var seenLinks = Object.create(null), uniqueLinks = [];
    mergedLinks.forEach(function(link) {
        var key = String((link && (link.normalized || link.raw)) || link || '');
        if (!key || seenLinks[key]) return;
        seenLinks[key] = true;
        uniqueLinks.push(link);
    });
    excelItem.links = uniqueLinks;

    if (liveItem.textSample) {
        excelItem.textSample = liveItem.textSample;
        excelItem.textSha256 = liveItem.textSha256 || '';
        excelItem.textLength = liveItem.textLength || liveItem.textSample.length;
        excelItem.textConfidence = liveItem.textConfidence || '';
        excelItem.textEvidenceCompleteness = Number(liveItem.textEvidenceCompleteness || 0);
        excelItem.textScopeKind = liveItem.textScopeKind || '';
        excelItem.textEvidenceCompletenessObserved=liveItem.textEvidenceCompletenessObserved===true;
    }
    if (liveItem.structuredAssessment && typeof liveItem.structuredAssessment === 'object') {
        excelItem.structuredAssessment = liveItem.structuredAssessment;
    }
    if (liveItem.nativeAssignment && typeof liveItem.nativeAssignment === 'object') {
        excelItem.nativeAssignment = liveItem.nativeAssignment;
    }
    if (liveItem.ingestionFailure && liveItem.ingestionFailure.detected === true) {
        excelItem.ingestionFailure = liveItem.ingestionFailure;
    }
    if (liveItem.published === true || liveItem.published === false) excelItem.published = liveItem.published;
    if (Number.isFinite(Number(liveItem.timeEstimateMinutes))) { excelItem.timeEstimateMinutes = Number(liveItem.timeEstimateMinutes); excelItem.timeEstimateEvidence = liveItem.timeEstimateEvidence || 'Coursera extractor'; }

    excelItem.evidenceLevel = liveItem.evidenceLevel || excelItem.evidenceLevel;
    excelItem.evidenceSources = (excelItem.evidenceSources || []).concat(liveItem.evidenceSources || []);
    excelItem.liveObservedName = liveItem.name || '';
    excelItem.liveObservedType = liveItem.type || '';
    return excelItem;
}

function qaAssertNotDiagnosticCapture_(parsed) {
    if(parsed && (parsed.kind==='FOCUSED_EXTRACTOR_DIAGNOSTIC' || parsed.notForCourseAudit===true || parsed.schemaVersion==='CTI_EXTRACTOR_TRIAL_V1')) {
        throw new Error('This is a focused extractor trial, not a full Coursera capture. Keep it for diagnostic review and use the full extractor JSON for course QA.');
    }
}
