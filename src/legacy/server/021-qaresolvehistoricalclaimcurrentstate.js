

function qaResolveHistoricalClaimCurrentState_(claim, source, currentItem, courseraItems, extractorMeta, snapshotContext) {
    claim=qaNormalizeIngestionClaimScope_(claim);
    var type=String(claim.type||'');
    var base={
        key:qaClaimResolutionKey_(claim),
        claimType:type,subject:claim.subject||'',target:claim.target||'',pathHint:claim.pathHint||'',
        sourceName:source&&source.name||'',sourcePath:source&&source.path||'',
        currentItemId:currentItem&&currentItem.id||'',currentItemName:currentItem&&currentItem.name||'',currentItemPath:currentItem&&currentItem.path||'',
        status:'UNOBSERVED',severity:'EVIDENCE',detail:'Current destination evidence is not sufficient to resolve this historical Smart Ingestion claim.',action:'Inspect the current destination state only if this finding matters to completion.',evidence:[]
    };
    var laterStage=String(snapshotContext&&snapshotContext.mode||'')!=='RAW_INGESTION';
    if(type==='SOURCE_ASSET_SCOPE_REVIEW'){
        base.status='SOURCE_ASSET_SCOPE_REVIEW';base.severity='REVIEW';base.detail=claim.detail||claim.excerpt||'';
        base.action=claim.remediation;return base;
    }
    if(!qaCleanText_(claim.subject||'') && /^(UNRESOLVED_SOURCE_ASSET|GENERATED_CONTENT_FALLBACK|GENERATED_BEHAVIOR|UNSUPPORTED_CONTENT_FALLBACK|SI_PROCESSING_FAILURE)$/.test(type)){
        base.status='UNLOCALIZED_PROVENANCE';base.severity='EVIDENCE';
        base.detail=(claim.detail||claim.excerpt||'')+' The report does not identify one source item or asset.';
        base.action='Identify the affected item in the ingestion report'+(base.pathHint?' under '+base.pathHint:'')+' and compare it with the captured source and destination. This unlocalized claim alone does not establish a course repair.';
        return base;
    }
    var rawAssetHit=type==='UNRESOLVED_SOURCE_ASSET'?qaFindCurrentAttachmentEvidence_(claim.subject,courseraItems,currentItem&&currentItem.id):null;
    var rawAssetObserved=qaCurrentAttachmentIsObserved_(rawAssetHit);
    if(!laterStage && claim.provenanceOrigin!=='EVIDENCE_MEMORY' && !rawAssetObserved){
        base.status='RAW_PROVENANCE'; base.severity=claim.severity||'REVIEW'; base.detail=claim.detail||'Smart Ingestion provenance observed in the raw snapshot.'; base.action=claim.remediation||'Review this ingestion-time finding.';
        return base;
    }

    if(type==='UNRESOLVED_SOURCE_ASSET'){
        var hit=qaFindCurrentAttachmentEvidence_(claim.subject,courseraItems,currentItem&&currentItem.id);
        if(qaCurrentAttachmentIsObserved_(hit)){
            base.status='RESOLVED'; base.severity='RESOLVED';
            base.currentItemId=hit.itemId;base.currentItemName=hit.itemName;base.currentItemPath=hit.itemPath;
            base.detail='The source asset that Smart Ingestion originally failed to attach is now positively observed in the current Coursera shell.';
            base.action='No repair is required for this historical asset finding.';
            base.evidence.push({kind:hit.kind,method:hit.method,score:hit.score,itemName:hit.itemName,observedName:(hit.candidate&&hit.candidate.name)||'',url:(hit.candidate&&hit.candidate.url)||''});
            return base;
        }
        base.status='UNOBSERVED';base.severity='EVIDENCE';
        base.detail='Smart Ingestion originally failed to attach this asset, and the current extractor has not yet produced strong positive evidence that the asset is present.';
        base.action='Do not assume it is still missing. Deep-inspect the mapped assignment/reading or confirm the attachment manually.';
        if(hit) base.evidence.push({kind:hit.kind,method:hit.method,score:hit.score,itemName:hit.itemName,observedName:(hit.candidate&&hit.candidate.name)||''});
        return base;
    }

    if(type==='GENERATED_BEHAVIOR'){
        var b=qaCurrentGeneratedBehaviorMatches_(claim,courseraItems,currentItem&&currentItem.id);
        if(b.matches.length){
            if(b.matches.length>1 && !currentItem){
                base.status='STILL_PRESENT_MULTIPLE_CARRIERS';base.severity='REVIEW';
                base.detail='The same Smart Ingestion-generated behavior is positively observed in multiple current assignments, but the historical report does not identify one exact carrier strongly enough to localize it safely.';
                base.action='Review the listed current assignments; do not assume the first match is the historical target.';
                base.evidence=b.matches.slice(0,12).map(function(m){return {itemName:m.item.name||'',itemPath:m.item.path||'',value:m.value};});
                return base;
            }
            var first=b.matches[0];
            base.status='STILL_PRESENT';base.severity='REVIEW';
            base.currentItemId=first.item.id||'';base.currentItemName=first.item.name||'';base.currentItemPath=first.item.path||'';
            base.detail='The generated Smart Ingestion behavior is positively observed in the current Coursera state: '+first.value+'.';
            base.action='Decide whether this current setting is pedagogically/source correct. If not, change it; re-ingestion is not required.';
            base.evidence=b.matches.slice(0,8).map(function(m){return {itemName:m.item.name||'',itemPath:m.item.path||'',value:m.value};});
            return base;
        }
        if(qaCleanName_(claim.subject||'')==='rubric' && b.observed.some(function(m){return m.rubricIdentityUnproven===true;})){
            var ro=b.observed.filter(function(m){return m.rubricIdentityUnproven===true;});
            base.status='CURRENT_RUBRIC_PRESENT_IDENTITY_UNPROVEN';base.severity='REVIEW';
            base.currentItemId=ro[0].item.id||'';base.currentItemName=ro[0].item.name||'';base.currentItemPath=ro[0].item.path||'';
            base.detail='A rubric is currently present, but rubric existence/count alone does not prove that the historical Smart Ingestion-generated rubric is still the same rubric after manual cleanup.';
            base.action='Compare the current rubric semantics with the intended/source rubric. Do not treat rubric count alone as proof that the old generated rubric survived.';
            base.evidence=ro.slice(0,8).map(function(m){return {itemName:m.item.name||'',itemPath:m.item.path||'',value:m.value,identityProven:false};});
            return base;
        }
        if(b.observed.length){
            base.status='RESOLVED_CHANGED';base.severity='RESOLVED';
            base.detail='Current assignment settings were observed, but the originally generated behavior is no longer present with the same value.';
            base.action='No action is required for the historical generated setting unless the replacement setting itself is incorrect.';
            base.evidence=b.observed.slice(0,8).map(function(m){return {itemName:m.item.name||'',itemPath:m.item.path||'',value:m.value};});
            return base;
        }
        base.status='UNOBSERVED';base.severity='EVIDENCE';
        base.detail='The current extractor did not expose the relevant assignment control deeply enough to determine whether the generated behavior is still present.';
        base.action='Re-run the deep-controls extractor or inspect the mapped assignment setting.';
        return base;
    }

    if(type==='GENERATED_CONTENT_FALLBACK'){
        var item=currentItem||qaFindCurrentItemBySubject_(claim.subject,courseraItems);
        if(item){
            base.currentItemId=item.id||'';base.currentItemName=item.name||'';base.currentItemPath=item.path||'';
            var destText=qaCleanText_(item.textSample||'');
            var liveText=qaCleanText_(source&&source.liveSource&&source.liveSource.textSample||'');
            var packageText=qaCleanText_(source&&source.textSample||'');
            var referenceText=liveText||packageText;
            var complete=Number(item.textEvidenceCompleteness||0);
            if(destText.length>=120 && referenceText.length>=120 && complete>=0.70){
                var a=qaDirectionalSemanticSimilarity_(referenceText,destText);
                var b2=qaDirectionalSemanticSimilarity_(destText,referenceText);
                var sim=Math.max(a,b2);
                base.evidence.push({kind:liveText?'live-source-text':'package-source-text',similarity:Number(sim.toFixed(3)),destinationCompleteness:complete});
                if(sim>=0.72){
                    base.status='RESOLVED_SOURCE_EQUIVALENT';base.severity='RESOLVED';
                    base.detail='The current destination reading is positively observed and semantically aligns with '+(liveText?'live Brightspace':'the source package')+' strongly enough to resolve the historical generated-content fallback.';
                    base.action='No further repair is required for this historical fallback.';
                    return base;
                }
                base.status='STILL_NEEDS_SOURCE_REVIEW';base.severity='REVIEW';
                base.detail='Current destination content is observed, but it does not align strongly enough with the available source text to automatically resolve the historical generated-content fallback.';
                base.action='Compare the current reading against the live/source item and correct it if needed.';
                return base;
            }
            if(destText.length>=120){
                base.status='CURRENT_CONTENT_PRESENT_EQUIVALENCE_UNPROVEN';base.severity='REVIEW';
                base.detail='Current destination content is present, but source-equivalence cannot be proven from the available source/deep-text evidence.';
                base.action='Do one source-equivalence check; do not treat the old ingestion claim as proof that the current page is wrong.';
                return base;
            }
        }
        return base;
    }

    if(type==='PLACEHOLDER_FALLBACK'){
        var ph=qaFindCurrentItemBySubject_(claim.subject,courseraItems);
        if(!ph){
            base.status='RESOLVED_BY_REMOVAL';base.severity='RESOLVED';
            base.detail='The placeholder item created at ingestion is no longer present in the current structural inventory.';
            base.action='No action is required unless the source requires replacement content.';
            return base;
        }
        base.currentItemId=ph.id||'';base.currentItemName=ph.name||'';base.currentItemPath=ph.path||'';
        var combined=qaCleanText_((ph.name||'')+' '+(ph.textSample||''));
        if(/^\[empty\]/i.test(ph.name||'') || combined.length<80){
            base.status='STILL_PRESENT';base.severity='REVIEW';
            base.detail='The ingestion-created placeholder still appears to exist in the current Coursera shell.';
            base.action='Populate it if required or remove it if it is intentionally unnecessary.';
            return base;
        }
        base.status='RESOLVED_CHANGED';base.severity='RESOLVED';
        base.detail='The former placeholder item now contains substantive current content.';
        base.action='No action is required for the historical placeholder finding.';
        return base;
    }

    if(type==='BROKEN_LINK_FALLBACK'){
        var youtube=[];
        (courseraItems||[]).forEach(function(item){
            (item.links||[]).forEach(function(l){
                var raw=String((l&&(l.raw||l.normalized))||l||'');
                if(/youtu\.be|youtube\.com/i.test(raw)) youtube.push({itemName:item.name||'',itemPath:item.path||'',url:raw});
            });
        });
        if(youtube.length===1){
            base.status='POSSIBLY_RESOLVED_LINK_OBSERVED';base.severity='REVIEW';
            base.currentItemName=youtube[0].itemName;base.currentItemPath=youtube[0].itemPath;
            base.detail='A current YouTube link is positively observed, but the historical claim is not localized precisely enough to prove it is the same formerly broken source link.';
            base.action='Open this one current link once. If it is the intended source video and launches, mark the historical finding resolved.';
            base.evidence=youtube.slice(0,5);
            return base;
        }
        if(youtube.length>1){
            base.status='UNLOCALIZED_CURRENT_LINKS';base.severity='EVIDENCE';
            base.detail='Multiple current YouTube links are observed, but the historical Smart Ingestion wording does not identify which one was converted to plain text.';
            base.action='CTI cannot safely assign this historical warning to a specific current item yet.';
            base.evidence=youtube.slice(0,8);
            return base;
        }
        base.status='UNOBSERVED';base.severity='EVIDENCE';
        base.detail='No current YouTube link was positively observed; incomplete deep coverage prevents treating that as proof of absence.';
        base.action='Inspect the relevant source/destination section only if the video is required.';
        return base;
    }

    if(type==='INTENTIONAL_EXCLUSION'){
        base.status='INTENTIONAL_EXCLUSION';base.severity='REVIEW';
        base.detail=claim.detail||'Smart Ingestion intentionally excluded this item.';
        base.action='Confirm the exclusion is acceptable; do not recreate it merely because it is absent.';
        return base;
    }

    base.status='PROVENANCE_ONLY';base.severity='INFO';base.detail=claim.detail||'Historical Smart Ingestion provenance retained for audit.';base.action='';
    return base;
}

function qaResolveHistoricalCurrentState_(sourceItems,courseraItems,itemResults,intelligence,extractorMeta,snapshotContext) {
    sourceItems=Array.isArray(sourceItems)?sourceItems:[];
    courseraItems=Array.isArray(courseraItems)?courseraItems:[];
    itemResults=Array.isArray(itemResults)?itemResults:[];
    var currentById=Object.create(null), resultBySource=Object.create(null);
    courseraItems.forEach(function(i){if(i&&i.id)currentById[String(i.id)]=i;});
    itemResults.forEach(function(r){if(r&&r.sourceId)resultBySource[String(r.sourceId)]=r;});
    var seen=Object.create(null), resolutions=[], mappedClaimKeys=Object.create(null);

    sourceItems.forEach(function(source){
        var claims=qaSmartIngestionClaimsForSource_(source,intelligence);
        claims.forEach(function(claim){
            var k=qaClaimResolutionKey_(claim);
            if(seen[k]) return;
            seen[k]=true;mappedClaimKeys[k]=true;
            var r=resultBySource[String(source.id||'')]||null;
            var current=r&&r.courseraId?currentById[String(r.courseraId)]||null:null;
            var resolved=qaResolveHistoricalClaimCurrentState_(claim,source,current,courseraItems,extractorMeta,snapshotContext);
            resolutions.push(resolved);
            if(r){
                r.checks=r.checks||{};
                r.checks.currentStateResolution=r.checks.currentStateResolution||[];
                r.checks.currentStateResolution.push(resolved);
            }
        });
    });

    (intelligence&&intelligence.claims||[]).map(qaNormalizeIngestionClaimScope_).forEach(function(claim){
        var k=qaClaimResolutionKey_(claim);
        if(seen[k]) return;
        seen[k]=true;
        resolutions.push(qaResolveHistoricalClaimCurrentState_(claim,null,null,courseraItems,extractorMeta,snapshotContext));
    });

    var counts={};
    resolutions.forEach(function(r){counts[r.status]=(counts[r.status]||0)+1;});
    return {
        engineVersion:'current-state-resolution-v3',
        resolutions:resolutions,
        counts:counts,
        resolvedCount:resolutions.filter(function(r){return /^RESOLVED/.test(r.status);}).length,
        stillPresentCount:resolutions.filter(function(r){return r.status==='STILL_PRESENT'||r.status==='STILL_NEEDS_SOURCE_REVIEW';}).length,
        reviewCount:resolutions.filter(function(r){return r.severity==='REVIEW';}).length,
        evidenceGapCount:resolutions.filter(function(r){return r.severity==='EVIDENCE';}).length
    };
}

function qaApplyCurrentStateResolutionsToResults_(itemResults,resolutionReport) {
    var bySourceName=Object.create(null);
    (resolutionReport&&resolutionReport.resolutions||[]).forEach(function(r){
        if(!r.sourceName)return;
        var k=qaCleanName_(r.sourceName);
        (bySourceName[k]||(bySourceName[k]=[])).push(r);
    });
    (itemResults||[]).forEach(function(result){
        var list=bySourceName[qaCleanName_(result.sourceName||'')]||[];
        if(!list.length)return;
        result.checks=result.checks||{};
        result.checks.currentStateResolution=list;
        var active=list.filter(function(r){return r.severity==='REVIEW';});
        if(active.length){
            var phrases=active.slice(0,3).map(function(r){return (r.subject||r.claimType)+': '+r.status;});
            var action = result.ownerAction && typeof result.ownerAction === 'object' ? result.ownerAction : {severity:'REVIEW',label:'Review current state',action:String(result.ownerAction||'')};
            action.action=qaCleanText_(action.action+' Current-state resolution: '+phrases.join('; ')+'.');
            if(action.severity==='NONE'||action.severity==='EVIDENCE') action.severity='REVIEW';
            result.ownerAction=action;
        }
    });
    return itemResults;
}

// A searched-for item is not a visited editor. Reconstruct coverage for older captures too.
function qaCaptureTraversalSummary_(meta) {
    var c=meta&&meta.activeSpaCrawl||{}, rows=c.targetDiagnostics||[], retry=c.retryDiagnostics||[];
    var ids=Array.isArray(c.targetIds)?c.targetIds.map(String).filter(function(v,i,a){return v&&a.indexOf(v)===i;}):[];
    var total=Number(c.eligibleTargets!=null?c.eligibleTargets:c.targets||ids.length), map=Object.create(null);
    rows.forEach(function(d){if(d&&d.id)map[String(d.id)]=d;});
    var visited=Object.create(null);
    function reached(d){return !!(d&&(d.editorSurfaceCaptured||d.domCaptured||d.surface));}
    rows.forEach(function(d){if(d&&d.id&&(reached(d)||reached(d.retryResult)))visited[String(d.id)]=true;});
    retry.forEach(function(d){if(d&&d.id&&(reached(d.after)||reached(d.result)))visited[String(d.id)]=true;});
    var recovery=meta&&meta.supplementalReadingRecovery;
    (recovery&&recovery.recoveredEditorIds||[]).forEach(function(id){if(ids.indexOf(String(id))>=0)visited[String(id)]=true;});
    var observed=ids.length&&rows.length?ids.filter(function(id){return visited[id];}).length:Number(c.effectiveNavigated!=null?c.effectiveNavigated:c.navigated||c.completedTargets||0);
    observed=Math.max(0,Math.min(total,observed));
    var unresolved=ids.filter(function(id){return !visited[id];});
    return {recorded:total>0,eligible:total,searched:rows.length||Number(c.routeAttempts||0),visited:observed,
        unresolvedCount:Math.max(0,total-observed),unresolvedItemIds:rows.length?unresolved:[],
        neverSearchedItemIds:ids.filter(function(id){return !map[id];}),
        complete:total>0&&observed>=total&&c.coverageLimitedByCap!==true,
        meaning:'Visited means an item editor or item-scoped DOM surface was observed; search attempts alone do not establish access.'};
}

function qaQuestionImageFailures_(assessment) {
    return (assessment&&assessment.questions||[]).map(function(q,i){
        var prompt=qaCleanText_(q.prompt||q.stem||q.text||'').replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
        return /^\[Error:\s*Image could not be created\]$/i.test(prompt)?{ordinal:i+1,id:String(q.id||''),prompt:prompt}:null;
    }).filter(Boolean);
}

function qaObservedEmptyAssessmentBody_(item,extractorMeta) {
    if(!item || !/Assignment|Assessment|Quiz/i.test(item.type||'') || !/scoped|assignment/.test(item.textScopeKind||''))return false;
    if(item.structuredAssessment && (item.structuredAssessment.questions||[]).length)return false;
    var text=qaCleanText_(item.textSample||'').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();
    // Exact observed Coursera creation-panel wording. A mention in assignment
    // instructions or an incomplete/loading editor is insufficient evidence.
    if(!/^Learning objectives This assignment is testing \d+ learning objectives Content\s*\*?\s*Generate questions Use Generative AI to create auto-graded questions based on your learning objectives Create AI-graded question Craft open-ended questions and get instant AI-powered grading\. Prefer to manually add content\? Select content type$/i.test(text))return false;
    var crawl=extractorMeta && extractorMeta.activeSpaCrawl || {};
    return (crawl.targetDiagnostics||[]).some(function(d){
        return String(d.id||'')===String(item.id||'') && d.editorSurfaceCaptured===true && d.strongIdentitySeed===true && d.stabilityTimedOut!==true;
    });
}

function qaHasAiGraderPlaceholder_(item) {
    item=item||{};
    if(!/Assignment|Assessment|Quiz/i.test(item.type||''))return false;
    var native=item.nativeAssignment||{},settings=native.settings||{},submission=native.submission||{};
    var hasNative=!!item.nativeAssignment;
    if(hasNative && submission.aiGraded!==true && !/^AI$/i.test(String(settings.graderType||'')))return false;
    var body=qaCleanText_(item.textSample||'');
    if(/Enter instructions for AI graders/i.test(body))return true;
    if(!hasNative || !qaCurrentItemDeepObserved_(item))return false;
    var authoring=qaCleanText_(native.authoringSemanticText||'');
    return /AI Grader Instructions\s*(?:\(Not shown to learners\))?\s*\*?\s*Enter instructions for AI graders(?:\.{3}|…)?(?:\s+(?:Show academic integrity options|Rubric\b|Grading details)|$)/i.test(authoring);
}