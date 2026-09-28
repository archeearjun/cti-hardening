

function qaOwnerActionForResult_(result) {
    if(result&&result.checks&&result.checks.captureGap){
        var gap=result.checks.captureGap;
        return {severity:'EVIDENCE',label:'Inspect unread link carriers',action:gap.reason+' Recover or inspect '+gap.candidates.map(function(c){return c.name+' ['+c.id+']';}).join('; ')+' before creating or restoring a separate item.'};
    }

    var issues = result.issues || [];
    var checks = result.checks || {};
    var actions = [];
    var severity = 'NONE';

    if (result.verdict === 'INGESTION_FAILURE' || issues.indexOf('INGESTION_FAILURE') > -1) {
        var failure = checks.ingestionFailure || {};
        return { severity:'CRITICAL', label:'Repair confirmed ingestion failure', action:'Coursera contains an explicit Smart Ingestion failure artifact (' + ((failure.codes || []).join(', ') || 'INGESTION_FAILURE') + '). '+(failure.reason||'')+' Restore or correct the affected content and verify this item before publication. '+qaQuestionMediaAction_(checks.structuredAssessment) };
    }

    if (result.verdict==='UNVERIFIED' && checks.sourceTextNormalization && checks.sourceTextNormalization.status==='SOURCE_REFRESH_REQUIRED') {
        return {severity:'EVIDENCE',label:'Refresh original source prompt',action:'Re-scan the same original IMSCC to obtain valid learner-facing source instructions, then repeat QA. The stored XML cannot establish prompt equivalence. Compare any listed destination candidate before restoring content; this finding does not prove a missing activity.'};
    }

    if (result.verdict==='UNVERIFIED' && issues.indexOf('SOURCE_DESTINATION_MATCH_UNCONFIRMED')!==-1) {
        var candidates=checks.reconciliationDiagnostic&&checks.reconciliationDiagnostic.candidates||[];
        return {severity:'EVIDENCE',label:'Confirm existing discussion match',action:'Compare the source prompt and attachments with '+candidates.map(function(c){return c.name+' ['+c.id+']';}).join(', ')+'. The destination identity matches, but captured prompt evidence is inconclusive. Refresh or capture the missing source/destination evidence before deciding what to repair. No missing activity or verified equivalence is established by this finding.'};
    }

    if (result.verdict === 'HIDDEN_DEPENDENCY_REVIEW') {
        return { severity:'REVIEW', label:'Review hidden dependency', action:'Verify whether the hidden source dependency is preserved inside its visible parent or another learner-accessible Coursera item. Do not re-ingest solely because the hidden child is absent.' };
    }

    if (result.verdict === 'DEPENDENCY_PROXY' || result.verdict === 'DEPENDENCY_VERIFIED') {
        return { severity:'NONE', label:'Dependency handled', action:'This hidden source node is an attachment/proxy or recovered dependency; do not recreate it as a separate learner item.' };
    }


    if (result.verdict === 'INTENTIONAL_EXCLUSION') {
        return {
            severity:'REVIEW',
            label:'Confirm intentional exclusion',
            action:'Smart Ingestion explicitly reports that this source item was intentionally removed rather than accidentally lost. Confirm that the exclusion is appropriate for the Coursera learner experience; do not recreate it merely because it is absent.'
        };
    }

    if (result.verdict === 'MANUAL_REMOVAL_REVIEW' || issues.indexOf('MANUAL_REMOVAL_SINCE_RAW') > -1) {
        return {
            severity:'REVIEW',
            label:'Confirm manual removal',
            action:'This item existed immediately after Smart Ingestion and disappeared later within the same import attempt. Confirm that the manual deletion/consolidation was intentional and that no required learner content was lost. Do not re-run Smart Ingestion solely for this finding.'
        };
    }

    if(result.verdict==='EXPECTED_TRANSFORMATION' && checks.externalWebpageTransformation && checks.externalWebpageTransformation.kind==='YOUTUBE_PLUGIN_WRAPPER'){
        return {severity:'REVIEW',label:'Check video playback',action:'The source YouTube video target is preserved in the captured plugin configuration: '+checks.externalWebpageTransformation.sourceUrl+'. Confirm playback in learner preview; configuration evidence alone does not prove playback.'};
    }
    if(result.verdict==='EXPECTED_TRANSFORMATION' && checks.externalWebpageTransformation){
        return {severity:'REVIEW',label:'Verify external webpage launch',action:'The source URL is preserved in the Coursera External Webpage plugin: '+checks.externalWebpageTransformation.sourceUrl+'. Open its learner preview to confirm that the intended page loads and is accessible. URL/configuration preservation is verified; launch behavior remains unobserved.'};
    }

    if (result.verdict === 'EXPECTED_TRANSFORMATION' && !(checks.transformationFamily || checks.oneToManyTransformation)) {
        return { severity: 'NONE', label: 'Expected native conversion', action: 'Source document payload is positively represented as native Coursera Assignment/rubric content. Do not restore duplicate PDF files unless the original file attachment itself is a product requirement.' };
    }

    if (result.verdict === 'REPACKAGED') {
        var repCheck = checks.repackaging || {};
        var carriers = repCheck.carriers || (result.repackaging && result.repackaging.carriers) || [];
        var names = carriers.map(function(c) { return c.name || c.id; }).filter(Boolean);
        var carrierText = names.length ? names.join(', ') : 'another Coursera item';
        if (checks.semanticRepackaging && checks.semanticRepackaging.status === 'VERIFIED') {
            return {
                severity:'REVIEW',
                label:'Confirm semantic consolidation',
                action:'Do not recreate this source item. CTI found strong same-module learner-facing text/prompt evidence in ' + carrierText + '. Confirm that the renamed/consolidated destination item is learner-accessible and that the original standalone boundary is not required.' + (repCheck.status === 'PARTIAL' ? ' Some expected assets or links remain unresolved; verify or restore those before accepting the consolidation.' : '')
            };
        }
        if (checks.identityRepackaging && checks.identityRepackaging.status === 'VERIFIED_IDENTITY_PAYLOAD_UNVERIFIED') {
            return {
                severity:'REVIEW',
                label:'Confirm renamed discussion',
                action:'Do not recreate this source Discussion blindly. CTI found one unique same-module Coursera Discussion with the same distinctive activity identity (' + carrierText + ') and strong destination evidence, but the source package did not expose enough prompt text to prove semantic equivalence. Open both source and destination prompts and confirm the learner-facing instructions before keeping the consolidation.'
            };
        }
        if (repCheck.titleDerivedRecovery === true || issues.indexOf('SOURCE_PAYLOAD_NOT_AVAILABLE') > -1) {
            var inferredWithPayload = repCheck.inferredWhilePayloadAvailable === true;
            return {
                severity: 'REVIEW',
                label: 'Confirm inferred consolidation',
                action: inferredWithPayload
                    ? 'Do not recreate this source item blindly. Direct source-payload matching did not produce positive evidence, but a distinctive Coursera asset filename in ' + carrierText + ' strongly matches the source item identity. Confirm that the observed file is the intended learner-accessible content; binary identity is not yet proven.'
                    : 'Do not recreate this source item blindly. The source tree did not preserve an item-level payload fingerprint, but an actual asset filename in ' + carrierText + ' strongly matches this source item. Confirm that file is the intended learner-accessible content and that consolidation is intentional; binary identity is not yet proven.'
            };
        }
        return {
            severity: 'REVIEW',
            label: 'Confirm consolidation',
            action: 'Do not recreate this source item blindly. Positive payload evidence was recovered in ' + carrierText + '. Confirm the consolidation/repackaging is intentional and learner-accessible; restore a standalone item only if the original item boundary is required.'
        };
    }

    if (result.verdict === 'MISSING' || issues.indexOf('MISSING_ITEM') > -1) {
        var diagnostic = checks.reconciliationDiagnostic || {};
        if ((diagnostic.candidates || []).length) return {severity:'CRITICAL',label:'Verify candidate before restoring',action:'A possible same-module destination already exists: ' + diagnostic.candidates.map(function(c){return c.name+' ['+c.id+']';}).join('; ') + '. The automatic source-to-destination match is unconfirmed. Compare its prompt and attachments with the source before creating anything. Refresh the original source fingerprint if its recorded evidence is stale or incomplete; restore only content confirmed absent.'};
        return { severity: 'CRITICAL', label: 'Resolve unmatched source item', action: 'Confirm whether the required learner content is absent or already consolidated elsewhere. Restore confirmed missing content in the matching Coursera module, then re-run fidelity QA. Review any source template instructions or placeholders before copying them into the learner course.' };
    }

    var family = checks.transformationFamily || checks.oneToManyTransformation;
    if (family) {
        actions.push('This source lesson maps to ' + Number(family.childCount || 0) + ' Coursera items: ' + (family.childNames || []).join('; ') + '. CTI compared their combined evidence.');
        if (family.status !== 'VERIFIED') {
            severity = 'REVIEW';
            actions.push('Review the remaining family findings before accepting the split lesson.');
            if(family.directionalSourceCoverage != null && family.directionalSourceCoverage < 0.90) actions.push('The combined text did not reach the stronger family-verification threshold. Inspect the source sections not yet established by the combined capture.');
        }
    }

    // Runtime review and payload repair are concurrent obligations.
    if (result.verdict === 'RUNTIME_REVIEW' || issues.indexOf('RUNTIME_VERIFICATION_REQUIRED') > -1) {
        var runtime = checks.runtime || {};
        var families = (runtime.runtimeFamilies || []).join(', ');
        severity = 'REVIEW';
        actions.push('Open the source activity and its Coursera equivalent to confirm the embedded page, media, or interaction works.' +
            (families ? ' Source runtime signal(s): ' + families + '.' : '') +
            ' Structural/text similarity alone does not verify loading or interaction. An embed signal does not by itself identify a SCORM or interactive package.');
    }
    if (issues.indexOf('LINK_NOT_OBSERVED') > -1 && checks.links && (checks.links.missing || []).length) {
        if (severity === 'NONE') severity = 'REVIEW';
        actions.push('Verify unobserved link target(s) and restore them if still required: ' + checks.links.missing.join(', ') + '.');
    }
    if(checks.structuredAssessment && checks.structuredAssessment.declaredCaptureIncomplete){
        if(severity==='NONE')severity='EVIDENCE';
        var bound=checks.structuredAssessment;
        actions.push('Capture the unobserved assessment questions: source '+bound.sourceQuestionCount+'/'+bound.sourceDeclaredQuestionCount+' declared; destination '+bound.courseraQuestionCount+'/'+bound.courseraDeclaredQuestionCount+' declared. Matching captured subsets do not prove full coverage.');
    }
    if (checks.structuredAssessment && checks.structuredAssessment.captureCoverageUnverified) {
        if(severity==='NONE')severity='EVIDENCE';
        actions.push('The saved destination receipt reports unresolved question positions or identities. Review that item’s outline and capture diagnostics; matching record counts alone do not prove full question coverage.');
    }
    if (checks.structuredAssessment && checks.structuredAssessment.definitionCoverageUnverified) {
        if(severity==='NONE')severity='EVIDENCE';
        actions.push('Question-definition completeness is unverified. Check the retained source/package definitions and the capture coverage receipt; matching observed questions do not establish the full bank. Repeating an unchanged destination capture will not resolve an unknown source total.');
    }
    if (checks.structuredAssessment && checks.structuredAssessment.sourceAnswerRefreshRequired === true) {
        if (severity === 'NONE') severity = 'EVIDENCE';
        actions.push('Use Re-Scan on the existing CTI source package row and select the same original IMSCC to refresh legacy multi-select answer keys. Wait for completion, then repeat QA. This does not require re-ingesting Coursera.');
    }

    if (issues.indexOf('MISSING_ASSET') > -1 && checks.assets && checks.assets.missing && checks.assets.missing.length) {
        severity = 'CRITICAL';
        actions.push('Restore missing asset(s): ' + checks.assets.missing.join(', ') + '.');
    }

    if (issues.indexOf('ASSET_RELOCATED') > -1 && checks.assets && checks.assets.relocated && checks.assets.relocated.length) {
        if (severity === 'NONE') severity = 'REVIEW';
        var assetCarriers = [];
        checks.assets.relocated.forEach(function(m) { if (m.carrierName && assetCarriers.indexOf(m.carrierName) === -1) assetCarriers.push(m.carrierName); });
        actions.push('Expected asset payload was found in ' + (assetCarriers.length ? assetCarriers.join(', ') : 'another Coursera item') + '. Confirm this relocation/consolidation is intentional; do not duplicate the asset unless the original item association is required.');
    }

    if (issues.indexOf('LINK_RELOCATED') > -1 && checks.links && checks.links.relocated && checks.links.relocated.length) {
        if (severity === 'NONE') severity = 'REVIEW';
        var linkCarriers = [];
        checks.links.relocated.forEach(function(m) { if (m.carrierName && linkCarriers.indexOf(m.carrierName) === -1) linkCarriers.push(m.carrierName); });
        actions.push('Expected link payload was found in ' + (linkCarriers.length ? linkCarriers.join(', ') : 'another Coursera item') + '. Confirm the relocation is intentional and learner-accessible.');
    }

    if (issues.indexOf('UNPUBLISHED') > -1) {
        if (severity !== 'CRITICAL') severity = 'REVIEW';
        actions.push('Confirm whether this learner-facing item should be published/visible; publish it if the hidden state is accidental.');
    }

    if (issues.indexOf('BEHAVIOR_MUTATION') > -1) {
        if (severity === 'NONE') severity = 'REVIEW';
        var behavior = checks.behavior || {};
        actions.push('Review the learner behavior transformation' + ((behavior.mismatches || []).length ? ' (' + behavior.mismatches.join(', ') + ')' : '') + '. Confirm that submission/grading/attempt behavior is intentionally equivalent before keeping the shell.');
    }

    if (issues.indexOf('BEHAVIOR_UNVERIFIED') > -1 && issues.indexOf('BEHAVIOR_MUTATION') === -1) {
        if (severity === 'NONE') severity = 'EVIDENCE';
        var uncertainBehavior = checks.behavior || {};
        actions.push((uncertainBehavior.reason ? uncertainBehavior.reason + ' ' : '') +
            'Inspect this Coursera item\'s submission and grading settings, and check learner behavior when preview is available. Captured instructions do not establish that the required submission controls work. Correct the settings only if this check confirms a gap.');
    }

    if (issues.indexOf('TYPE_MUTATION') > -1) {
        if (severity === 'NONE') severity = 'REVIEW';
        if(checks.externalWebpageEvidence)actions.push(checks.externalWebpageEvidence.reason);
        else actions.push('Confirm whether the source ' + result.sourceType + ' → Coursera ' + result.courseraType + ' transformation is intentional.');
    }

    if (issues.some(function(v){ return /^SI_HISTORICAL_/.test(String(v||'')); })) {
        if (severity === 'NONE' || severity === 'EVIDENCE') severity = 'REVIEW';
        actions.push('This Smart Ingestion issue comes from the saved raw snapshot of the same generation. Verify whether your manual cleanup already resolved it; historical provenance is not proof that the issue still exists now.');
    }

    if (issues.indexOf('ASSESSMENT_CHANGED') > -1 || issues.indexOf('ASSESSMENT_DRIFT') > -1) {
        if (severity === 'NONE') severity = 'REVIEW';
        var assessmentCheck = checks.structuredAssessment || {};
        var mismatchText = assessmentCheck.answerMismatchCount ? (' Correct-answer mismatches detected: ' + assessmentCheck.answerMismatchCount + '.') : '';
        var positions=(assessmentCheck.questionResults||[]).filter(function(q){return (q.mismatches||[]).length;}).map(function(q){return 'source Q'+q.sourceIndex+' → Coursera Q'+q.courseraIndex;});
        if(positions.length)mismatchText+=' Review '+positions.join('; ')+'. The question detail shows the source and captured Coursera evidence side by side.';
        actions.push('Review the structured assessment question-by-question; source QTI and the Coursera Assignment differ in prompt/type/options/answers/scoring.' + mismatchText);
    }

    if (issues.indexOf('RUBRIC_CONTENT_CHANGED') > -1) {
        if (severity === 'NONE') severity = 'REVIEW';
        actions.push('Review the native Coursera rubric against the source rubric PDF. Both sides are strongly observed, but the rubric semantics/criterion identities materially differ; do not restore the already-verified Assessment PDF merely because the rubric needs review.');
    }

    if (issues.indexOf('CONTENT_CHANGED') > -1 || issues.indexOf('CONTENT_DRIFT') > -1) {
        if (severity === 'NONE') severity = 'REVIEW';
        actions.push('Review the learner-facing body/prompt; the source and Coursera text fingerprints differ.');
    }

    if (issues.indexOf('MOVED_ITEM') > -1) {
        if (severity === 'NONE') severity = 'REVIEW';
        actions.push('Move the item back to the expected module if the placement change is not intentional.');
    }

    var assetProvenance=checks.ingestionProvenance || {};
    var reportedAssets=issues.indexOf('SI_UNRESOLVED_SOURCE_ASSET')<0 ? [] :
      (assetProvenance.unresolvedAssetClaims || assetProvenance.claims || []).filter(function(c){
        return c.type==='UNRESOLVED_SOURCE_ASSET' && c.provenanceOrigin!=='EVIDENCE_MEMORY' && !!c.subject;
      }).map(function(c){return c.subject;}).filter(function(v,i,a){return a.indexOf(v)===i;});
    if(reportedAssets.length){
        severity='CRITICAL';
        actions.push('Smart Ingestion explicitly reports that it could not include '+reportedAssets.join(', ')+'. Confirm learner access in this assignment and any intended source-file carrier; restore or link the source file if absent. Resolve this reported attachment failure before publication.');
    }

    if (issues.indexOf('PAYLOAD_UNVERIFIED') > -1 && !(checks.structuredAssessment && checks.structuredAssessment.sourceAnswerRefreshRequired === true)) {
        if (severity === 'NONE') severity = 'EVIDENCE';
        var unresolved = checks.assets && checks.assets.unresolved ? checks.assets.unresolved : [];
        var expected = (unresolved.length ? unresolved : (checks.assets && checks.assets.expected ? checks.assets.expected : [])).filter(function(name){
            return !reportedAssets.some(function(asset){return qaCleanName_(qaFileName_(asset))===qaCleanName_(qaFileName_(name));});
        });
        if(checks.content && checks.content.reasonCode==='DESCRIPTION_VS_DOCUMENT_SURFACE') {
            actions.push('The PDF is preserved byte-for-byte. Check whether its short introductory description is present and intended; captured PDF-viewer text cannot establish that. Keep the preserved PDF.');
        } else if(checks.externalWebpageEvidence && checks.externalWebpageEvidence.status==='UNVERIFIED') {
            if(actions.indexOf(checks.externalWebpageEvidence.reason)===-1)actions.push(checks.externalWebpageEvidence.reason);
        } else if (checks.transformation && checks.transformation.sourceRefreshRequired === true) {
            actions.push('Refresh/re-scan the stored source IMSCC once so source-evidence schema 6, source-presence state, and page-aware Assessment/Rubric PDF semantics are persisted. The existing Coursera fingerprint can be reused.');
        } else if (checks.transformation && Number(checks.transformation.pdfEvidenceMappingFailureCount || 0) > 0) {
            actions.push('Current source-evidence schema is present, but PDF parser/text evidence did not reach the Assignment item. This is an evidence-association limitation; do not restore the PDFs based on this result.');
        } else if (checks.transformation && Number(checks.transformation.pdfExtractionFailureCount || 0) > 0) {
            actions.push('Source PDF text extraction failed, was skipped by a bounded limit, or returned no usable text. Do not restore the PDFs based on this result; inspect the recorded parser/status before deciding whether the source document is scanned/image-only.');
        } else if (checks.structuredAssessment && checks.structuredAssessment.status === 'UNVERIFIED' && /Re-process\/update the source IMSCC/i.test(String(checks.structuredAssessment.reason || ''))) {
            actions.push('Refresh the stored source package once so its QTI question structure is persisted; the existing Coursera fingerprint can be reused.');
        } else if (checks.structuredAssessment && checks.structuredAssessment.status === 'UNVERIFIED') {
            var sa = checks.structuredAssessment;
            if(qaConfirmedEmptyComparison_(result)) {
                if(severity==='NONE' || severity==='EVIDENCE')severity='REVIEW';
                actions.push('This destination assignment is confirmed empty; the matched source contains '+sa.sourceQuestionCount+' question definitions. Check their intended placement and any approved exclusion, then restore them here only if required and not already preserved elsewhere. Repeating the same extraction is not needed to establish this empty state.');
            } else if(qaAssessmentAnswerOnlyGap_(sa)) {
                actions.push('All '+sa.sourceQuestionCount+' question prompts align and their captured choices show no material mismatch. Confirm whether an answer key is required for this activity. If required, obtain the missing source and/or destination answer evidence; if no correct answers apply, record that decision explicitly. The title alone does not establish this, and no missing question positions are identified by this comparison.');
            } else if(qaAssessmentMediaOnlyGap_(sa)) {
                actions.push('All '+sa.sourceQuestionCount+' question prompts align, answer evidence is complete, and no material question-field mismatch was detected. The remaining structured-assessment check concerns the referenced media; no missing question positions are identified by this comparison.');
            } else if((sa.captureIssueQuestionNumbers||[]).length)actions.push('Refresh the Coursera capture or inspect the answer fields for question(s) '+sa.captureIssueQuestionNumbers.join(', ')+'. Their captured choices include unresolved feedback text. All '+sa.courseraQuestionCount+' captured questions remain recorded; no answer-key change is proven for these fields.');
            else if(Number(sa.courseraDeclaredQuestionCount)>0 && Number(sa.courseraQuestionCount)===Number(sa.courseraDeclaredQuestionCount) && (sa.unmatchedSourceQuestions||[]).length) {
                actions.push('Captured '+sa.courseraQuestionCount+'/'+sa.courseraDeclaredQuestionCount+' questions declared by this Coursera assessment, compared with '+sa.sourceQuestionCount+' source questions. Source question(s) '+sa.unmatchedSourceQuestions.join(', ')+' have no aligned destination question. Check their intended placement, any approved omission, and question-pool settings before deciding what to restore. This count difference alone does not establish an incomplete Coursera crawl.');
                if(qaAssessmentAnswerEvidenceSide_(sa,'source')==='INCOMPLETE')actions.push('Inspect the original source answer evidence; repeating the Coursera extraction cannot recover missing source keys.');
                if(qaAssessmentAnswerEvidenceSide_(sa,'coursera')==='INCOMPLETE')actions.push('Obtain the missing destination answer evidence for the captured questions before approval.');
            }
            else actions.push('Verify this assessment before approval: source ' + sa.sourceQuestionCount + ' questions; destination ' + sa.courseraQuestionCount + '; aligned ' + sa.alignedQuestionCount + '. Inspect the question bank and random-selection settings, and capture the unobserved questions/answers. An incomplete capture does not prove deletion.');
        } else if (expected.length) actions.push('Separate evidence gap for '+expected.join(', ')+': verify the file content or learner access before approval. Incomplete capture alone does not establish that these additional files need repair.');
        else if(!reportedAssets.length) actions.push('No repair is proven yet. Automated deep verification could not obtain enough learner-facing evidence; escalate to manual inspection only if 100% verification is required.');
    }

    var mediaAction=qaQuestionMediaAction_(checks.structuredAssessment);
    if(mediaAction){actions.push(mediaAction);if(severity==='NONE')severity='EVIDENCE';}
    if (severity === 'NONE' && actions.length) return { severity:'NONE',label:'Family evidence verified',action:actions.join(' ')+' No repair is indicated by the observed family evidence.' };
    if (!actions.length) return { severity: 'NONE', label: 'No action', action: 'No assignment-owner action is required from the observed evidence.' };

    var label = severity === 'CRITICAL' ? 'Fix before completion' : severity === 'REVIEW' ? 'Review required' : 'Evidence needed';
    return { severity: severity, label: label, action: actions.join(' ') };
}

function workApplyPolicyAwareOperatorGuidance_(itemResults, injected) {
    itemResults = Array.isArray(itemResults) ? itemResults : [];
    injected = Array.isArray(injected) ? injected : [];

    itemResults.forEach(function(item) {
        var p = item && item.operationalPolicy;
        if (!item || !p || p.inDecisionGate !== false) return;
        var original = item.ownerAction && typeof item.ownerAction === 'object' ? JSON.parse(JSON.stringify(item.ownerAction)) : null;
        var path = qaCleanText_(item.sourcePath || item.path || '');
        var reason = qaCleanText_(p.reason || 'This source area is excluded from the automatic redo decision.');
        item.policyAwareOwnerAction = { overridden:true, original:original };
        item.ownerAction = {
            severity:'INFO',
            label:'Policy-exempt audit finding',
            action:'Policy-exempt from automatic redo' + (path ? ' for ' + path : '') + ': ' + reason + ' No automatic restoration, publication, or re-ingestion is required from this finding. Keep it visible for audit and act only if the partner/course specification explicitly requires this item.'
        };
    });

    injected.forEach(function(item) {
        var p = item && item.operationalPolicy;
        if (!item || !p || p.inDecisionGate !== false) return;
        if(item.classification==='SOURCE_ASSET_CARRIER' && p.classification!=='NON_LFM_POLICY_EXEMPT')return;
        item.policyAwareOwnerAction = { overridden:true, original:item.ownerAction || '' };
        item.ownerAction = 'Policy-exempt from automatic redo: ' + qaCleanText_(p.reason || 'This extra item is outside the automatic learner-facing redo gate.') + ' No automatic removal, publication change, or re-ingestion is required; retain for audit unless the partner/course specification requires action.';
    });
}

function qaClassifyExtraItem_(item) {
    var text = (String(item.name || '') + ' ' + String(item.path || '')).toLowerCase();
    var classification = 'CONTENT_EXTRA';
    var label = 'Additional Coursera content';
    var severity = 'REVIEW';

    // v6.11.0: an unmatched destination item can itself prove that Smart
    // Ingestion failed. Detect deterministic failure artifacts before treating
    // the item as a harmless extra/template/consolidation carrier.
    var ingestionFailure = qaNormalizeIngestionFailure_(
        item && item.ingestionFailure || null,
        item && item.name || '',
        item && item.textSample || ''
    );
    if (ingestionFailure.detected) {
        return {
            classification:'INGESTION_FAILURE_EXTRA',
            label:'Broken Coursera ingestion artifact',
            severity:'CRITICAL',
            ingestionFailure:ingestionFailure,
            action:'Re-run Smart Ingestion; this unmatched learner-facing destination item explicitly contains an ingestion/conversion failure artifact (' + ((ingestionFailure.codes || []).join(', ') || 'INGESTION_FAILURE') + ').'
        };
    }

    if(item.sourceAssetProvenance && item.sourceAssetProvenance.status==='SOURCE_ASSETS_OBSERVED'){
        var partialProvenance=(item.sourceAssetProvenance.unmatchedHashedFiles||[]).length || (item.sourceAssetProvenance.unresolvedDownloadFiles||[]).length;
        return {classification:partialProvenance?'PARTIAL_SOURCE_ASSET_CARRIER':'SOURCE_ASSET_CARRIER',label:partialProvenance?'Some attachments have source provenance':'Source-backed attachment item',severity:'REVIEW',action:qaSourceAssetCarrierAction_(item.sourceAssetProvenance)};
    }

    var carried = Array.isArray(item.repackagedSourceNames) ? item.repackagedSourceNames.filter(Boolean) : [];
    if (carried.length) {
        return {
            classification: 'CONSOLIDATION_CARRIER',
            label: 'Carries repackaged source payload',
            severity: 'INFO',
            action: 'This item contains positive payload evidence for source item(s): ' + carried.slice(0, 8).join(', ') + (carried.length > 8 ? '…' : '') + '. Confirm the consolidation is intentional; do not restore duplicate standalone items blindly.'
        };
    }

    if (/author alignment|author.?s eyes|delete me|archive|instructor only/.test(text)) {
        classification = 'ADMIN_EXTRA'; label = 'Administrative/generated extra'; severity = 'INFO';
    } else if (/\[empty\]|empty|placeholder|new reading|untitled|supporting content/.test(text)) {
        classification = 'PLACEHOLDER_EXTRA'; label = 'Placeholder extra'; severity = 'REVIEW';
    } else if (/course-specific resources|summative assessment resources|student resources/.test(text)) {
        classification = 'TEMPLATE_EXTRA'; label = 'Template/generated extra'; severity = 'INFO';
    }

    return {
        classification: classification,
        label: label,
        severity: severity,
        action: severity === 'INFO' ? 'Confirm this item is expected template/administrative content; no source restoration is implied.' : 'Confirm this extra item is intentional; remove it if it should not be learner-facing.'
    };
}
