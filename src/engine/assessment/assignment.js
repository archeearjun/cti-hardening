// Maintained source: explicit dependencies; no ordered concatenation.
import { normalizeCourseraItem_ } from "../capture/normalization.js";
import { qaCleanText_ } from "../matching/text.js";
import { qaCaptureTraversalSummary_, qaQuestionImageFailures_ } from "../provenance/current-state.js";
import { qaAssessmentText_ } from "./questions.js";

export function normalizeAssignmentMetadataV61325(assignment) {
    if (!assignment || typeof assignment !== 'object') return assignment;
    const out={...assignment,settings:{...(assignment.settings || {})},submission:{...(assignment.submission || {})},
      currentStateEvidence:JSON.parse(JSON.stringify(assignment.currentStateEvidence || {})),
      metadataCorrections:(assignment.metadataCorrections || []).slice()};
    const clean=value=>String(value == null?'':value).replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const text=clean(assignment.authoringSemanticText);
    const action=/\b(?:Create|Add|Generate)\s+(?:(?:a|an|new)\s+)?AI[- ]graded\s+(?:question|assignment)\b/ig;
    const hasAction=action.test(text);action.lastIndex=0;
    const withoutActions=text.replace(action,' ');
    // A creation button offers a new question type. It is not evidence of the
    // current grader. Preserve separately observed question/grader headers.
    if(hasAction && !/(?:^|[\s\d])AI[- ]Graded\b|\bAI Grader Instructions\b/i.test(withoutActions) &&
       (out.submission.aiGraded===true || out.settings.graderType==='AI')) {
      out.submission.aiGraded=false;
      if(out.settings.graderType==='AI')delete out.settings.graderType;
      if(!out.settings.graderType && out.submission.peerGraded===true)out.settings.graderType='PEER';
      else if(!out.settings.graderType && out.submission.staffGraded===true)out.settings.graderType='STAFF';
      out.metadataCorrections.push({field:'aiGraded',reason:'AUTHORING_CREATION_CONTROL_NOT_CURRENT_GRADER'});
      if(Array.isArray(out.currentStateEvidence.observedSubmissionSignals))out.currentStateEvidence.observedSubmissionSignals=out.currentStateEvidence.observedSubmissionSignals.filter(k=>k!=='aiGraded');
    }
    for(const key of ['scoringPolicy','feedbackType'])if(typeof out.settings[key]==='string')out.settings[key]=clean(out.settings[key]).replace(/^Required\s+/i,'');
    const value=clean(out.settings.gradeSetting),valid=/^(Graded|Ungraded|Practice)$/i.test(value);
    if(value && !valid) {
      const visible=text.match(/\bGrade setting\s+(?:Required\s+)?(Ungraded|Graded|Practice)\b/i);
      if(visible)out.settings.gradeSetting=visible[1];else delete out.settings.gradeSetting;
      out.metadataCorrections.push({field:'gradeSetting',reason:visible?'VISIBLE_GRADE_LABEL_REPLACES_RAW_CONTROL_VALUE':'UNRECOGNIZED_GRADE_VALUE_UNVERIFIED'});
    }
    if(Array.isArray(out.currentStateEvidence.observedSettingFields))out.currentStateEvidence.observedSettingFields=out.currentStateEvidence.observedSettingFields.filter(k=>Object.prototype.hasOwnProperty.call(out.settings,k));
    // Re-normalizing an imported capture must not accumulate duplicate receipts.
    out.metadataCorrections=out.metadataCorrections.filter((x,i,all)=>all.findIndex(y=>y.field===x.field && y.reason===x.reason)===i);
    return out;
  }

export function qaNormalizeNativeAssignment_(assignment) {
    assignment = normalizeAssignmentMetadataV61325(assignment);
    if (!assignment || typeof assignment !== 'object') return null;
    var rubrics = Array.isArray(assignment.rubrics) ? assignment.rubrics : [];
    rubrics = rubrics.map(function(r, ri) {
        r = r || {};
        var levels = Array.isArray(r.levels) ? r.levels : [];
        levels = levels.map(function(level, li) {
            level = level || {};
            var points = (level.points !== null && level.points !== undefined && level.points !== '' && Number.isFinite(Number(level.points))) ? Number(level.points) : null;
            return {
                id: String(level.id || (li + 1)),
                label: qaAssessmentText_(level.label || level.title || level.name || ''),
                description: qaAssessmentText_(level.description || level.body || level.text || ''),
                points: points,
                rawText: qaAssessmentText_(level.rawText || '')
            };
        }).filter(function(level) { return level.label || level.description || level.points !== null; });
        return {
            id: String(r.id || (ri + 1)),
            title: qaAssessmentText_(r.title || ('Rubric ' + (ri + 1))),
            criterionTitle: qaAssessmentText_(r.criterionTitle || r.criterion || ''),
            criterionDescription: qaAssessmentText_(r.criterionDescription || r.description || ''),
            levels: levels,
            rawText: qaAssessmentText_(r.rawText || '')
        };
    }).filter(function(r) { return r.title || r.levels.length || r.rawText; });

    var submission = assignment.submission && typeof assignment.submission === 'object' ? assignment.submission : {};
    var confidence = Number(assignment.parserConfidence == null ? 0 : assignment.parserConfidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));

    return {
        schemaVersion: Number(assignment.schemaVersion || 1),
        parser: String(assignment.parser || ''),
        metadataCorrections: (assignment.metadataCorrections || []).slice(),
        origin: String(assignment.origin || 'coursera-authoring-editor'),
        rubricCount: Math.max(Number(assignment.rubricCount || 0), rubrics.length),
        rubrics: rubrics,
        submission: {
            fileUpload: submission.fileUpload === true,
            textSubmission: submission.textSubmission === true,
            richText: submission.richText === true,
            aiGraded: submission.aiGraded === true,
            peerGraded: submission.peerGraded === true,
            staffGraded: submission.staffGraded === true
        },
        settings: (assignment.settings && typeof assignment.settings === 'object') ? JSON.parse(JSON.stringify(assignment.settings)) : {},
        attachments: (Array.isArray(assignment.attachments) ? assignment.attachments : []).map(function(a){
            a=a||{};
            return {
                displayName:qaCleanText_(a.displayName||a.name||''),
                fileType:qaCleanText_(a.fileType||'').toUpperCase(),
                inferredFileName:qaCleanText_(a.inferredFileName||a.fileName||a.name||''),
                url:String(a.url||''),
                evidenceSource:qaCleanText_(a.evidenceSource||''),
                rawText:qaCleanText_(a.rawText||'')
            };
        }).filter(function(a){return a.displayName||a.inferredFileName||a.url;}).slice(0,120),
        currentStateEvidence:(assignment.currentStateEvidence && typeof assignment.currentStateEvidence==='object') ? JSON.parse(JSON.stringify(assignment.currentStateEvidence)) : {},
        prompt: qaAssessmentText_(assignment.prompt || ''),
        directions: qaAssessmentText_(assignment.directions || ''),
        expectations: qaAssessmentText_(assignment.expectations || ''),
        learnerPrompt: qaAssessmentText_(assignment.learnerPrompt || ''),
        learnerDirections: qaAssessmentText_(assignment.learnerDirections || ''),
        learnerExpectations: qaAssessmentText_(assignment.learnerExpectations || ''),
        learnerSemanticText: qaAssessmentText_(assignment.learnerSemanticText || [assignment.learnerPrompt,assignment.learnerDirections,assignment.learnerExpectations].filter(Boolean).join(' ')),
        contentBlockEvidence:assignment.contentBlockEvidence && typeof assignment.contentBlockEvidence==='object'?JSON.parse(JSON.stringify(assignment.contentBlockEvidence)):null,
        authoringSemanticText: qaAssessmentText_(assignment.authoringSemanticText || ''),
        semanticText: qaAssessmentText_(assignment.semanticText || ''),
        parserConfidence: confidence,
        warnings: Array.isArray(assignment.warnings) ? assignment.warnings.slice(0, 20) : []
    };
}

export function qaNormalizeIngestionFailure_(failure, name, textSample, assessment) {
    failure = failure && typeof failure === 'object' ? failure : {};
    var title = qaCleanText_(name || '');
    var text = qaCleanText_(textSample || '');
    var codes = Array.isArray(failure.codes) ? failure.codes.slice() : [];
    var titleSentinel = /^\[ERROR DURING DISTILLATION\]/i.test(title);
    var bodySentinel = /^\[ERROR DURING DISTILLATION\]/i.test(text) || /\[ERROR DURING DISTILLATION\]/i.test(text.slice(0, 1800));
    var rawMarker = /Raw content for the item\s*:/i.test(text);
    var metadataHits = ['x-coursera-structure-node-id','x-coursera-distance-from-root','x-coursera-resource-type','x-coursera-file-path','x-coursera-associated-content-files'].filter(function(marker) {
        return text.toLowerCase().indexOf(marker) > -1;
    }).length;
    var conversionPlaceholder = /there was an error when converting this\s+(?:discussion prompt|reading|assignment|quiz|item)\b/i.test(text) && /please add content to complete this item/i.test(text);
    if (titleSentinel || bodySentinel) codes.push('DISTILLATION_ERROR');
    if (rawMarker && metadataHits >= 2) codes.push('RAW_METADATA_RENDERED');
    if (conversionPlaceholder) codes.push('CONVERSION_ERROR_PLACEHOLDER');
    codes = codes.filter(function(v, i, a) { return v && a.indexOf(v) === i; });
    var questionErrors=qaQuestionImageFailures_(assessment);
    if(questionErrors.length && codes.indexOf('QUESTION_IMAGE_CREATION_ERROR')<0)codes.push('QUESTION_IMAGE_CREATION_ERROR');
    var detected = failure.detected === true || codes.length > 0;
    var defaultReason = '';
    if(questionErrors.length)defaultReason='Coursera question prompt(s) '+questionErrors.map(function(q){return q.ordinal;}).join(', ')+' contain the explicit image-creation failure placeholder instead of the intended prompt.';
    else if (codes.indexOf('DISTILLATION_ERROR') > -1) defaultReason = 'Coursera explicitly renders the Smart Ingestion distillation-error sentinel.';
    else if (codes.indexOf('CONVERSION_ERROR_PLACEHOLDER') > -1) defaultReason = 'Coursera explicitly renders its conversion-error placeholder instead of learner content.';
    else if (codes.indexOf('RAW_METADATA_RENDERED') > -1) defaultReason = 'Raw x-coursera ingestion metadata is rendered as learner content.';
    return {
        detected: detected,
        codes: codes,
        confidence: String(failure.confidence || (detected ? 'VERY_HIGH' : 'LOW')),
        metadataHits: Math.max(Number(failure.metadataHits || 0), metadataHits),
        reason: String(questionErrors.length?defaultReason:(failure.reason || defaultReason)),
        questionErrors:questionErrors.length?questionErrors:(failure.questionErrors||[])
    };
}

export function qaPayloadField_(payload, item, key, fallback) {
    if(Object.prototype.hasOwnProperty.call(payload,key)) return payload[key];
    return Object.prototype.hasOwnProperty.call(item,key)?item[key]:fallback;
}

export function qaApplyReadingRecovery_(base, recovery, fileName) {
    function invalid(message) { throw new Error('Reading recovery JSON: '+message); }
    if(!base || !Array.isArray(base.fingerprints) || !base.page || !base.extractedAt)invalid('attach the original full Coursera fingerprint JSON first.');
    if(!recovery || recovery.kind!=='CTI_COURSERA_READING_RECOVERY' || recovery.scope!=='SUPPLEMENTAL_READING_RECOVERY_NOT_A_FULL_COURSE_CAPTURE')invalid('unsupported recovery format.');
    var courseId=String(base.page.courseId||'');
    if(!courseId || String(recovery.courseId||'')!==courseId)invalid('the course ID differs from the full capture.');
    if(!recovery.targetSelection || recovery.targetSelection.baselineCapture!==base.extractedAt)invalid('this recovery belongs to a different baseline capture. Select its original full JSON.');
    var start=Date.parse(recovery.startedAt),finish=Date.parse(recovery.finishedAt),baseline=Date.parse(base.extractedAt);
    if(!isFinite(start)||!isFinite(finish)||!isFinite(baseline)||start<baseline||finish<start)invalid('capture timestamps are inconsistent.');
    var targets=recovery.targetSelection.ids, rows=recovery.readings;
    if(!Array.isArray(targets)||!Array.isArray(rows)||targets.length>2000)invalid('missing or oversized target inventory.');
    var targetSet=Object.create(null),seen=Object.create(null),index=Object.create(null);
    targets.forEach(function(id){id=String(id);if(!/^[A-Za-z0-9_-]+$/.test(id)||targetSet[id])invalid('invalid or duplicated target ID.');targetSet[id]=true;});
    base.fingerprints.forEach(function(fp){var id=String(fp.id||'');if(index[id])invalid('the full capture has duplicated item IDs.');index[id]=fp;});
    var originalTraversal=qaCaptureTraversalSummary_(base.meta||{});
    if(!originalTraversal.recorded)invalid('the full capture has no editor traversal record.');
    var unresolved=originalTraversal.unresolvedItemIds||[];
    var validated=rows.map(function(row){
        var id=String(row&&row.item&&row.item.id||''),p=row&&row.payload,e=p&&p.readingEditorEvidence;
        if(!targetSet[id]||seen[id])invalid('unknown or duplicated recovered item '+id+'.');seen[id]=true;
        if(!index[id]||index[id].typeName!=='supplement'||!row.item||row.item.typeName!=='supplement')invalid('recovery can only enrich existing reading items.');
        if(unresolved.indexOf(id)<0)invalid('item '+id+' already has editor evidence in the selected capture; use a fresh full capture after course edits.');
        var route=e&&String(e.route||'').match(/^https:\/\/www\.coursera\.org\/teach\/[^/]+\/([A-Za-z0-9_-]+)\/content\/item\/supplement\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/);
        if(!e||e.identity!=='exact-course-plus-item-reading-content-field'||String(e.courseId)!==courseId||String(e.itemId)!==id||e.fieldTestId!==courseId+'+'+id||!route||route[1]!==courseId||route[2]!==id)invalid('the rendered editor identity does not match item '+id+'.');
        var observed=Date.parse(e.observedAt),captured=Date.parse(row.capturedAt);
        if(!isFinite(observed)||!isFinite(captured)||observed<start||observed>finish||captured<observed||captured>finish)invalid('invalid item capture time for '+id+'.');
        ['files','links','images','embeddedRefs','assetDetails'].forEach(function(key){if(p[key]!=null&&!Array.isArray(p[key]))invalid('invalid '+key+' for '+id+'.');});
        return row;
    });
    var out=JSON.parse(JSON.stringify(base)),outIndex=Object.create(null);
    out.fingerprints.forEach(function(fp){outIndex[String(fp.id)]=fp;});
    var gaps=[],source='supplemental-reading-recovery-v'+String(recovery.version||'unknown');
    validated.forEach(function(row){
        var fp=outIndex[String(row.item.id)],old=fp.payload||{},p=row.payload;
        ['files','links','images','embeddedRefs','assetDetails','assetEvidenceConfidence','linkEvidenceConfidence','textSample','textLength','textConfidence','textEvidencePriority','textEvidenceCompleteness','textScopeKind','readingEditorEvidence','textCaptureTruncated','fullObservedTextLength'].forEach(function(key){
            if(Object.prototype.hasOwnProperty.call(p,key)){
                var value=JSON.parse(JSON.stringify(p[key]));
                if(Array.isArray(value)){
                    var unique=Object.create(null);value=(old[key]||[]).concat(value).filter(function(x){var k=JSON.stringify(x);if(unique[k])return false;unique[k]=true;return true;});
                }
                old[key]=value;
            }
        });
        // The earlier atom label is not current body text if the recovered reading
        // consists solely of external embeds. Explicitly preserve empty text.
        old.textSample=String(p.textSample||'');old.textLength=old.textSample.length;
        old.textEvidenceCompleteness=Number(p.textEvidenceCompleteness||0);old.textSha256='';
        old.currentState=Object.assign({},old.currentState||{},{readingObservedAt:row.capturedAt});
        old.evidenceSources=(old.evidenceSources||[]).concat([source]);
        fp.payload=old;fp.evidenceSources=(fp.evidenceSources||[]).concat([source]);
        var normalized=normalizeCourseraItem_(fp),gap=qaReadingEvidenceGap_(normalized);
        if(gap)gaps.push({id:fp.id,code:gap.code,reason:gap.reason});
    });
    out.meta=out.meta||{};
    out.meta.supplementalReadingRecovery={fileName:String(fileName||''),version:String(recovery.version||''),baselineCapture:base.extractedAt,
        startedAt:recovery.startedAt,finishedAt:recovery.finishedAt,recoveredEditorIds:validated.map(function(r){return String(r.item.id);}),
        recoveredEditors:validated.length,requested:targets.length,elapsedMs:Number(recovery.elapsedMs||0),payloadGaps:gaps,
        externalFrameDocumentsVerified:false,wholeCourseRecaptured:false,
        meaning:'Editor evidence combined from the original full capture and a later targeted recovery. Other items retain their original capture time.'};
    return out;
}

export function qaReadingCaptureReceipt_(item) {
    var r=item && item.textCaptureEvidence;
    if(!r || r.method!=='EXACT_READING_FIELD' || item.textScopeKind!=='reading-content-field' ||
        !item.id || String(r.itemId)!==String(item.id) || !r.courseId || r.externalFrameTextIncluded!==false)return null;
    var text=qaCleanText_(item.textSample||'').replace(/[\u200b-\u200d\ufeff]/g,'').trim();
    var observed=r.observedCharacters,captured=r.capturedCharacters,limit=r.limit;
    if(!Number.isSafeInteger(observed) || !Number.isSafeInteger(captured) || observed<0 || captured<0 ||
        limit!==256000 || captured!==text.length || captured!==Math.min(observed,limit) ||
        typeof r.truncated!=='boolean' || r.truncated!==(observed>limit))return null;
    return JSON.parse(JSON.stringify(r));
}

export function qaObservedEmptyAssessmentReceipt_(item) {
    var e=item && item.emptyEditorEvidence;
    if(!item || !/Assignment|Assessment|Quiz/i.test(item.type||'') || !e ||
        e.status!=='OBSERVED_EMPTY_EDITOR' || !item.id || String(e.itemId)!==String(item.id) ||
        e.scope!=='EXACT_ITEM_ASSIGNMENT_LAYOUT' || e.sourceCompleteness!=='NOT_DETERMINED' ||
        !Number.isFinite(Number(e.samples)) || Number(e.samples)<2 || Number(e.samples)%1!==0 ||
        !Number.isFinite(Number(e.intervalMs)) || Number(e.intervalMs)<1200 ||
        e.marker!=='Content you add will show in order here.' || !Number.isFinite(Date.parse(e.observedAt)) ||
        (item.structuredAssessment && (item.structuredAssessment.questions||[]).length))return null;
    var route=String(e.route||'').match(/^https:\/\/(?:www\.)?coursera\.org\/teach\/[^/]+\/[^/]+\/content\/item\/[^/]+\/([^/?#]+)(?:[/?#]|$)/i);
    if(!route)return null;
    try{if(decodeURIComponent(route[1])!==String(item.id))return null;}catch(_){return null;}
    return JSON.parse(JSON.stringify(e));
}

export function qaReadingAttachmentLabels_(text) {
    // Recognize the repeated filename/file-type label emitted by attachment cards.
    // A filename mentioned in prose is not an attachment declaration.
    const value=String(text || '').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const labels=[], seen=new Set();
    const types={pdf:'pdf',doc:'word',docx:'word',ppt:'powerpoint',pptx:'powerpoint',xls:'excel',xlsx:'excel',csv:'csv',txt:'text',zip:'zip'};
    const re=/\.(pdf|docx?|pptx?|xlsx?|csv|txt|zip)\s+(.{1,300}?)\s+(PDF|Word|PowerPoint|Excel|CSV|Text|ZIP) File\b/gi;
    let m;
    while((m=re.exec(value))) {
      const ext=m[1].toLowerCase(),stem=m[2].trim(),start=m.index-stem.length;
      if(types[ext]!==m[3].toLowerCase() || start<0 || (start>0 && !/\s/.test(value[start-1])))continue;
      if(value.slice(start,m.index).toLowerCase()!==stem.toLowerCase())continue;
      const label=value.slice(start,m.index+ext.length+1),key=label.toLowerCase();
      if(!seen.has(key)){seen.add(key);labels.push(label);}
    }
    return labels;
  }

export function qaReadingAttachmentCoverage_(text,assets) {
    const labels=qaReadingAttachmentLabels_(text),resolved=new Set();
    for(const asset of assets || []) {
      if(!asset || typeof asset!=='object' || !/^https?:\/\/[^\s/]+(?:\/|$)/i.test(String(asset.url || '')))continue;
      const name=String(asset.name || '').replace(/\s+/g,' ').trim().toLowerCase();
      if(name)resolved.add(name);
    }
    const unresolved=labels.filter(name=>!resolved.has(name.toLowerCase()));
    return {method:'EXACT_READING_FIELD_ATTACHMENT_LABELS',observedLabelCount:labels.length,
      resolvedLabelCount:labels.length-unresolved.length,labels,unresolvedLabels:unresolved,
      status:!labels.length?'NO_ATTACHMENT_LABELS_OBSERVED':unresolved.length?'ATTACHMENT_DOWNLOAD_URLS_UNVERIFIED':'OBSERVED_ATTACHMENT_URLS_CAPTURED',
      binaryContentVerified:false,meaning:'Coverage of observed attachment labels by captured download URLs; not proof of all source files, downloaded bytes, or learner access.'};
  }

export function qaReadingAttachmentEvidence_(item) {
    if(!item || !/reading|supplement/i.test(String(item.type||item.rawType||'')) || item.textScopeKind!=='reading-content-field')return null;
    var e=item.readingEditorEvidence;
    var route=e && String(e.route||'').match(/^https:\/\/(?:www\.)?coursera\.org\/teach\/[^/]+\/([^/]+)\/content\/item\/supplement\/([^/?#]+)\/?$/i);
    if(!e || e.identity!=='exact-course-plus-item-reading-content-field' || !item.id || String(e.itemId)!==String(item.id) ||
        !route || route[1]!==String(e.courseId) || route[2]!==String(item.id) || e.fieldTestId!==String(e.courseId)+'+'+String(item.id) || !Number.isFinite(Date.parse(e.observedAt)))return null;
    return qaReadingAttachmentCoverage_(item.textSample,item.assetDetails);
}

export function qaReadingEvidenceGap_(item) {
    if(!item || !/reading|supplement/i.test(String(item.type||item.rawType||'')))return null;
    var text=qaCleanText_(item.textSample||'').replace(/[\u200b-\u200d\ufeff]/g,'').trim();
    if(/^(?:(?:\d+\s*)?\/\s*\d+\s+\d{1,3}%\s*)?Loading(?:\.{0,3}|…)?$/i.test(text)||item.textScopeKind==='reading-loading-placeholder')return {code:'READING_STILL_LOADING',reason:'The reading editor was reached, but only a loading placeholder was captured. Its content remains unverified.'};
    if(/^(?:\d+\s*)?\/\s*\d+\s+\d{1,3}%\s+\S/.test(text)||item.textScopeKind==='document-viewer')return {code:'DOCUMENT_PAGES_NOT_VERIFIED',reason:'Captured text comes from a document viewer. Page coverage and the surrounding reading body were not established; do not infer content loss from this text comparison.'};
    var receipt=qaReadingCaptureReceipt_(item);
    if(item.textCaptureTruncated===true || (receipt && receipt.truncated) || (!receipt && text.length>=24000))return {code:'TEXT_SAMPLE_LIMIT_REACHED',reason:'The captured reading text reached its sample limit. The remaining text was not verified.'};
    var e=item.readingEditorEvidence;
    if(e && Number(e.unreadFrameCount)>0)return {code:'EXTERNAL_FRAME_TEXT_UNVERIFIED',reason:'Configured external-page URLs were captured, but '+Number(e.unreadFrameCount)+' embedded page document(s) could not be read. Link presence does not verify page text or playback.'};
    return null;
}
