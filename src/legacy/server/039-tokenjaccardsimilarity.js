


// -------------------------------------------------------------------
// AI QA SYNTHESIZER (Semantic Resolver & Remediation Engine)
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// LOCAL ZERO-CREDIT QA DECISION ENGINE (Token Jaccard + Heuristics)
// -------------------------------------------------------------------
function tokenJaccardSimilarity_(str1, str2) {
    var tokens1 = String(str1 || '').toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
    var tokens2 = String(str2 || '').toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
    if (tokens1.length === 0 || tokens2.length === 0) return 0;
    
    var set1 = {};
    tokens1.forEach(function(t) { set1[t] = true; });
    
    var intersection = 0;
    var set2 = {};
    tokens2.forEach(function(t) {
        if (!set2[t]) {
            set2[t] = true;
            if (set1[t]) intersection++;
        }
    });
    
    var union = Object.keys(set1).length + Object.keys(set2).length - intersection;
    return union === 0 ? 0 : (intersection / union);
}

function synthesizeQaRemediationPlanDb(qaPayloadStr) {
    authorize_('editor');

    try {
        var qa = JSON.parse(qaPayloadStr);
        if (!qa || !Array.isArray(qa.itemResults)) {
            return { success: false, error: "Invalid Item Fidelity payload." };
        }

        var policyExempt = qa.itemResults.filter(function(item) { return item.operationalPolicy && item.operationalPolicy.inDecisionGate === false; });
        var actionable = qa.itemResults.filter(function(item) { return item.verdict !== 'VERIFIED' && item.verdict !== 'EXPECTED_TRANSFORMATION' && !(item.operationalPolicy && item.operationalPolicy.inDecisionGate === false); });
        var allExtras = Array.isArray(qa.injected) ? qa.injected : [];
        var extras = allExtras.filter(function(item) { return !(item.operationalPolicy && item.operationalPolicy.inDecisionGate === false) && String(item.severity || '').toUpperCase() !== 'INFO'; });
        var informationalExtras = allExtras.filter(function(item) { return extras.indexOf(item) === -1; });

        if (actionable.length === 0 && extras.length === 0) {
            return {
                success: true,
                report: "<div style='padding:20px; background:#F0FDF4; border:1px solid #A7F3D0; border-radius:8px;'><h3 style='color:#065F46; margin-top:0;'>🎉 No deterministic remediation required</h3><p style='color:#047857; margin:0;'>Every compared item passed the evidence-backed checks. Review Evidence Coverage before treating this as a complete fidelity guarantee.</p></div>"
            };
        }

        function esc(value) { return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
        var html = "<div style='font-size:14px; line-height:1.6;'>";
        html += "<div style='display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #E5E7EB; padding-bottom:12px; margin-bottom:20px;'>";
        html += "<h3 style='color:#111827; margin:0;'>⚡ Deterministic Remediation Plan</h3>";
        html += "<span style='background:#E0E7FF; color:#4338CA; padding:4px 10px; border-radius:9999px; font-size:11px; font-weight:600;'>No AI judgement used</span>";
        html += "</div>";

        if (qa.operationalPolicy) {
            var op = qa.operationalPolicy;
            html += "<div style='background:#F9FAFB;border:1px solid #D1D5DB;border-radius:7px;padding:10px 12px;margin-bottom:14px;color:#374151;font-size:12px;'><b>Operational redo policy:</b> " + esc(op.recommendationCode || '') + " — " + esc(op.recommendationReason || '') + "<br><span style='color:#6B7280;'>" + esc(op.description || '') + "</span></div>";
        }
        if (policyExempt.length || informationalExtras.length) {
            html += "<details style='margin-bottom:14px;border:1px solid #E5E7EB;border-radius:7px;padding:8px 10px;'><summary style='cursor:pointer;font-weight:700;color:#4B5563;'>Policy/informational findings not used to force re-ingestion (" + (policyExempt.length + informationalExtras.length) + " )</summary><div style='font-size:12px;color:#6B7280;margin-top:8px;'>";
            policyExempt.forEach(function(item){ html += "<div>• " + esc(item.sourceName || item.name || 'Untitled') + " — " + esc(item.operationalPolicy && item.operationalPolicy.reason || 'Policy-exempt') + "</div>"; });
            informationalExtras.forEach(function(item){ html += "<div>• Extra: " + esc(item.name || 'Untitled') + " — " + esc(item.extraLabel || item.classification || 'informational') + "</div>"; });
            html += "</div></details>";
        }

        var groups = {
            MISSING: [],
            INTENTIONAL_EXCLUSION: [],
            REPACKAGED: [],
            TYPE_MUTATION: [],
            STATE_MUTATION: [],
            MANUAL_REMOVAL_REVIEW: [],
            PARTIAL: [],
            MOVED: [],
            UNVERIFIED: []
        };

        actionable.forEach(function(item) {
            if (groups[item.verdict]) groups[item.verdict].push(item);
            else groups.UNVERIFIED.push(item);
        });

        if (groups.MISSING.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#FEF2F2; border:1px solid #FCA5A5; border-radius:8px;'><h4 style='color:#991B1B; margin:0 0 8px;'>1. Resolve Missing-Item Findings (" + groups.MISSING.length + ")</h4><ul style='margin:0; padding-left:20px; color:#7F1D1D;'>";
            groups.MISSING.forEach(function(item) {
                html += "<li><b>" + esc(item.sourceName) + "</b> [" + esc(item.sourceType) + "]<br><span style='font-size:12px;'>📍 " + esc(item.sourcePath || 'Root') + "</span><br>" + esc(item.ownerAction && item.ownerAction.action || 'Compare source and destination evidence before restoring content confirmed absent.') + "</li>";
            });
            html += "</ul></div>";
        }

        if (groups.INTENTIONAL_EXCLUSION.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px;'><h4 style='color:#1E40AF; margin:0 0 8px;'>Intentional Smart-Ingestion Exclusions (" + groups.INTENTIONAL_EXCLUSION.length + ")</h4><ul style='margin:0; padding-left:20px; color:#1E3A8A;'>";
            groups.INTENTIONAL_EXCLUSION.forEach(function(item) {
                html += "<li><b>" + esc(item.sourceName) + "</b>: " + esc((item.ownerAction && item.ownerAction.action) || 'Confirm the recorded intentional exclusion.') + "</li>";
            });
            html += "</ul></div>";
        }

        if (groups.REPACKAGED.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#ECFDF5; border:1px solid #6EE7B7; border-radius:8px;'><h4 style='color:#065F46; margin:0 0 8px;'>2. Confirm Repackaged / Consolidated Items (" + groups.REPACKAGED.length + ")</h4><p style='font-size:12px; color:#047857;'>These source rows are absent structurally, but their payload was positively recovered elsewhere. Do not recreate them blindly.</p><ul style='margin:0; padding-left:20px; color:#065F46;'>";
            groups.REPACKAGED.forEach(function(item) {
                var carriers = (item.checks && item.checks.repackaging && item.checks.repackaging.carriers) || [];
                html += "<li><b>" + esc(item.sourceName) + "</b> → " + esc(carriers.map(function(c){ return c.name || c.id; }).join(', ') || 'another Coursera item') + "<br><span style='font-size:12px;'>" + esc(item.ownerAction && item.ownerAction.action ? item.ownerAction.action : 'Confirm consolidation.') + "</span></li>";
            });
            html += "</ul></div>";
        }

        if (groups.MANUAL_REMOVAL_REVIEW.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#F5F3FF; border:1px solid #C4B5FD; border-radius:8px;'><h4 style='color:#6D28D9; margin:0 0 8px;'>Same-generation Manual Removals (" + groups.MANUAL_REMOVAL_REVIEW.length + ")</h4><p style='font-size:12px;color:#6D28D9;'>These items existed in the saved raw snapshot after Smart Ingestion and disappeared only during later manual cleanup. They are not Smart Ingestion failures.</p><ul style='margin:0;padding-left:20px;color:#5B21B6;'>";
            groups.MANUAL_REMOVAL_REVIEW.forEach(function(item){
                html += "<li><b>" + esc(item.sourceName) + "</b><br><span style='font-size:12px;'>" + esc(item.ownerAction && item.ownerAction.action ? item.ownerAction.action : 'Confirm that this manual deletion/consolidation was intentional.') + "</span></li>";
            });
            html += "</ul></div>";
        }

        if (groups.TYPE_MUTATION.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#FEF3C7; border:1px solid #FDE68A; border-radius:8px;'><h4 style='color:#92400E; margin:0 0 8px;'>3. Correct Type Mutations (" + groups.TYPE_MUTATION.length + ")</h4><ul style='margin:0; padding-left:20px; color:#78350F;'>";
            groups.TYPE_MUTATION.forEach(function(item) {
                html += "<li><b>" + esc(item.sourceName) + "</b>: expected <b>" + esc(item.sourceType) + "</b>, observed <b>" + esc(item.courseraType) + "</b>. Verify grading/tool semantics after correction.</li>";
            });
            html += "</ul></div>";
        }

        if (groups.STATE_MUTATION.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#FDF4FF; border:1px solid #E9D5FF; border-radius:8px;'><h4 style='color:#7E22CE; margin:0 0 8px;'>4. Review Visibility / Publication State (" + groups.STATE_MUTATION.length + ")</h4><ul style='margin:0; padding-left:20px; color:#6B21A8;'>";
            groups.STATE_MUTATION.forEach(function(item) {
                html += "<li><b>" + esc(item.sourceName) + "</b>: " + esc(item.ownerAction && item.ownerAction.action ? item.ownerAction.action : 'Confirm whether the hidden/unpublished state is intentional.') + "</li>";
            });
            html += "</ul></div>";
        }

        if (groups.PARTIAL.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#FFF7ED; border:1px solid #FDBA74; border-radius:8px;'><h4 style='color:#9A3412; margin:0 0 8px;'>5. Repair Partial Imports (" + groups.PARTIAL.length + ")</h4><ul style='margin:0; padding-left:20px; color:#9A3412;'>";
            groups.PARTIAL.forEach(function(item) {
                var checks = item.checks || {};
                var actions = [];
                if (checks.assets && checks.assets.missing && checks.assets.missing.length) actions.push("restore/recheck assets: " + checks.assets.missing.join(', '));
                if (checks.assets && checks.assets.relocated && checks.assets.relocated.length) actions.push("confirm relocated assets in: " + checks.assets.relocated.map(function(m){ return m.carrierName || m.carrierId; }).filter(Boolean).join(', '));
                if (checks.links && checks.links.missing && checks.links.missing.length) actions.push("restore/recheck links: " + checks.links.missing.join(', '));
                if (checks.content && checks.content.status === 'CHANGED') actions.push("compare and restore the source body/content");
                if (checks.content && checks.content.status === 'DRIFT') actions.push("review content drift");
                if (checks.publication && checks.publication.status === 'UNPUBLISHED') actions.push("publish/unhide the item");
                html += "<li><b>" + esc(item.sourceName) + "</b>: " + esc(actions.join('; ') || 'review the flagged fidelity checks') + "<br><span style='font-size:12px;'>Fidelity " + item.fidelityPercent + "% · Coverage " + item.evidenceCoverage + "%</span></li>";
            });
            html += "</ul></div>";
        }

        if (groups.MOVED.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px;'><h4 style='color:#1E40AF; margin:0 0 8px;'>6. Restore Placement (" + groups.MOVED.length + ")</h4><ul style='margin:0; padding-left:20px; color:#1E40AF;'>";
            groups.MOVED.forEach(function(item) {
                html += "<li><b>" + esc(item.sourceName) + "</b><br>Source: " + esc(item.sourcePath) + "<br>Coursera: " + esc(item.courseraPath || 'Unavailable') + "</li>";
            });
            html += "</ul></div>";
        }

        if (groups.UNVERIFIED.length) {
            html += "<div style='margin-bottom:16px; padding:15px; background:#F9FAFB; border:1px solid #D1D5DB; border-radius:8px;'><h4 style='color:#374151; margin:0 0 8px;'>7. Evidence Follow-up Required (" + groups.UNVERIFIED.length + ")</h4><p style='font-size:12px; color:#6B7280;'>These are not confirmed failures. Follow each item-specific action: some findings require refreshing the original source; others require destination evidence or manual comparison.</p><ul style='margin:0; padding-left:20px; color:#4B5563;'>";
            groups.UNVERIFIED.forEach(function(item) {
                html += "<li><b>" + esc(item.sourceName) + "</b> — coverage " + item.evidenceCoverage + "%<br><span style='font-size:12px;'>" + esc(item.ownerAction && item.ownerAction.action ? item.ownerAction.action : 'Run Deep Payload Capture on this item.') + "</span></li>";
            });
            html += "</ul></div>";
        }

        if (extras.length) {
            html += "<div style='padding:15px; background:#F9FAFB; border:1px solid #D1D5DB; border-radius:8px;'><h4 style='color:#374151; margin:0 0 8px;'>Extra Coursera Items (" + extras.length + ")</h4><ul style='margin:0; padding-left:20px; color:#4B5563;'>";
            extras.forEach(function(item) {
                html += "<li>" + esc(item.name) + " [" + esc(item.type) + "]" + (item.path ? " — " + esc(item.path) : "");
                if (item.extraLabel) html += "<br><span style='font-size:12px;'>" + esc(item.extraLabel) + " · " + esc(item.ownerAction || '') + "</span>";
                html += "</li>";
            });
            html += "</ul></div>";
        }

        html += "</div>";
        return { success: true, report: html };
    } catch (e) {
        return { success: false, error: "Local Remediation Engine Error: " + e.toString() };
    }
}

// v7.9.8: presentation projections never change evidence or matching verdicts.
function qaReadinessForDestination_(item, items, readiness) {
    return (readiness && readiness.findings || []).filter(function(f) {
        if (f.itemId) return String(f.itemId) === String(item.id);
        if (!f.itemName || qaCleanName_(f.itemName) !== qaCleanName_(item.name)) return false;
        if (f.path && qaCleanText_(f.path) !== qaCleanText_(item.path)) return false;
        return (items || []).filter(function(x) { return qaCleanName_(x.name) === qaCleanName_(f.itemName) && (!f.path || qaCleanText_(x.path) === qaCleanText_(f.path)); }).length === 1;
    });
}
function qaAttachReadinessActions_(results, items, readiness) {
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
function qaReadinessActionRepresented_(row, finding) {
    var owner=row.ownerAction || {};
    if(row.operationalPolicy && row.operationalPolicy.inDecisionGate===false)return false;
    if(['CRITICAL','REVIEW','EVIDENCE'].indexOf(owner.severity)<0 || !owner.action)return false;
    return (row.checks && row.checks.destinationReadiness || []).some(function(x){
        return x.code===finding.code && x.itemName===finding.itemName && x.path===finding.path &&
          (!finding.itemId || String(x.itemId||'')===String(finding.itemId));
    });
}
function qaApplyReadinessToSummary_(summary, results, items, readiness) {
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
function qaMissingReconciliationDiagnostic_(source, destinations) {
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
function qaBuildDestinationOwnerView_(items, results, readiness) {
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
        return {id:d.id,name:d.name,type:d.type,path:d.path||'Root',order:index,status:severity,published:d.published===true?true:d.published===false?false:null,actions:actions,sourceNames:linked.map(function(r){return r.sourceName;}),excerpt:qaCleanText_(d.textSample||'').slice(0,900),excerptComplete:false};
    });
    return {schemaVersion:1,authority:'Coursera XLSX order and names; captured payload excerpts. This is an audit outline, not a screenshot or a complete learner rendering.',items:rows,unmappedSource:(results||[]).filter(function(r){return !r.courseraId && (['MISSING','HIDDEN_DEPENDENCY_REVIEW'].indexOf(r.verdict)!==-1 || (r.issues||[]).indexOf('SOURCE_TEXT_REFRESH_REQUIRED')!==-1 || (r.issues||[]).indexOf('SOURCE_DESTINATION_MATCH_UNCONFIRMED')!==-1);}).map(function(r){return {name:r.sourceName,path:r.sourcePath,verdict:r.verdict,action:r.ownerAction&&r.ownerAction.action||'',diagnostic:r.checks&&r.checks.reconciliationDiagnostic||null};})};
}

// Package-file provenance is independent of whether a resource is a top-level item.
function qaAttachSourceAssetProvenance_(destinations, originalItems) {
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

function qaSourceAssetCarrierAction_(evidence) {
    var names=[];
    (evidence.matches||[]).forEach(function(m){(m.sources||[]).forEach(function(s){if(names.indexOf(s.fileName)<0)names.push(s.fileName);});});
    return 'Source attachment provenance verified by SHA-256 for '+evidence.matchedFileCount+' file(s): '+names.join('; ')+
        '. Keep the source-backed material while reviewing its intended module placement and learner visibility, including any answer keys. '+
        'This verifies those file bytes only; it does not verify all surrounding text, additional files or item behavior.'+
        ((evidence.unmatchedHashedFiles||[]).length?' Additional hashed files have no exact source match and require review.':'')+
        ((evidence.unresolvedDownloadFiles||[]).length?' Additional download files lack a complete fingerprint and remain unverified.':'');
}

// A PDF viewer is a document surface, not evidence of its surrounding description.
function qaDocumentScopeComparison_(source,coursera) {
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

function qaYoutubeVideoId_(value) {
    var s=String(value||'').trim(),match;
    // Compare only an unambiguous bare video target. Start/end/list parameters
    // and fragments require an exact full-URL comparison instead.
    match=s.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/i);
    if(!match)match=s.match(/^https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})$/i);
    if(!match)match=s.match(/^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})$/i);
    return match?match[1]:'';
}

function qaPluginRuntimeSummary_(plugin) {
    var frames=plugin&&Array.isArray(plugin.frames)?plugin.frames:[];
    return {launchStatus:'NOT_VERIFIED',frameCount:frames.length,
        readableFrames:frames.filter(function(f){return f.access==='READABLE';}).length,
        inaccessibleFrames:frames.filter(function(f){return f.access==='CROSS_ORIGIN_UNREADABLE'||f.access==='INACCESSIBLE'||f.access==='DOCUMENT_UNAVAILABLE';}).length,
        playbackStatus:'NOT_OBSERVED',submissionStatus:'NOT_TESTED'};
}