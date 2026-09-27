


function qaOneToManyAggregateForSource_(source, courseraItems, intelligence) {
    if (!source) return null;
    var sourceKey = qaCleanName_(source.name || '');
    var pathKey = qaCleanName_(source.path || '');
    if (!sourceKey) return null;

    var sourceClaims = intelligence && Array.isArray(intelligence.claims) ? qaSmartIngestionClaimsForSource_(source, intelligence) : [];
    var claims = sourceClaims.filter(function(c){ return c.type === 'ONE_TO_MANY_TRANSFORMATION' || c.type === 'CHUNKED_ITEM_TRANSFORMATION'; });
    var explicitChunkClaim = claims.filter(function(c){return c.type === 'CHUNKED_ITEM_TRANSFORMATION';})[0] || null;
    var explicitOneToManyClaim = claims.filter(function(c){return c.type === 'ONE_TO_MANY_TRANSFORMATION';})[0] || null;

    function pathCompatible(item) {
        if (!pathKey) return true;
        var itemPath = qaCleanName_(item && item.path || '');
        if (!itemPath) return false;
        return itemPath === pathKey || itemPath.indexOf(pathKey) > -1 || pathKey.indexOf(itemPath) > -1 || qaPathSimilarity_(source.path,item.path) >= 0.80;
    }
    function titleFamily(item) {
        if (!item || item.syntheticOneToMany === true) return false;
        var name = qaCleanName_(item.name || '');
        if (!name) return false;
        if (!pathCompatible(item)) return false;
        if (name === sourceKey) return true;
        return name.indexOf(sourceKey + ' ') === 0 || name.indexOf(sourceKey + ' - ') === 0 || name.indexOf(sourceKey + ': ') === 0;
    }

    var familyCandidates = (courseraItems || []).filter(titleFamily);
    var prefixedChildren = familyCandidates.filter(function(item){return qaCleanName_(item.name||'') !== sourceKey;});

    // Explicit Smart Ingestion provenance permits a 2+ child family. Without
    // provenance, infer only a strong same-module prefix family of 3+ children.
    // This catches BORL Lesson 1-style chunking while avoiding casual title overlap.
    var inferred = false;
    if (!claims.length) {
        var sourceType = String(source.type || '').toLowerCase();
        var sourceTextLen = qaCleanText_(source.textSample || '').length;
        if (sourceType !== 'reading' || prefixedChildren.length < 3 || sourceTextLen < 500) return null;
        inferred = true;
    }
    if (familyCandidates.length < 2 || prefixedChildren.length < 1) return null;

    var mode = explicitChunkClaim ? 'EXPLICIT_CHUNKED_ITEM' : (explicitOneToManyClaim ? 'EXPLICIT_ONE_TO_MANY' : 'INFERRED_PREFIX_FAMILY');
    var primaryClaim = explicitChunkClaim || explicitOneToManyClaim || {
        type:'INFERRED_CHUNK_FAMILY', subject:source.name || '', pathHint:source.path || '',
        excerpt:'CTI inferred a same-module source→destination family because multiple destination items share the complete source title prefix.',
        detail:'No explicit CHUNKED_ITEM claim was required because the destination structure provides strong one-to-many evidence.', severity:'INFO'
    };

    var children = familyCandidates;
    var seenAssets=Object.create(null), assetDetails=[];
    var seenLinks=Object.create(null), links=[];
    var seenText=Object.create(null), textParts=[];
    var evidenceSources=[];
    var textChildren=0, strongPayloadChildren=0, publishedKnown=0, publishedTrue=0, timeEvidence=0;
    children.forEach(function(item){
        (item.assetDetails||[]).forEach(function(a){var d=qaAssetDescriptor_(a),k=d.sha256||d.key||d.url||d.name;if(k&&!seenAssets[k]){seenAssets[k]=true;assetDetails.push(a);}});
        (item.links||[]).forEach(function(l){var k=String((l&&(l.normalized||l.raw))||l||'');if(k&&!seenLinks[k]){seenLinks[k]=true;links.push(l);}});
        var t=qaCleanText_(item.textSample||''); if(t){textChildren++; var h=String(item.textSha256||t.slice(0,240)); if(!seenText[h]){seenText[h]=true;textParts.push(t);}}
        var childScope=String(item.textScopeKind||'');
        var childCompleteness=Number(item.textEvidenceCompleteness||0);
        var childSources=(item.evidenceSources||[]).join(' ').toLowerCase();
        var strongPayload=(childCompleteness>=0.80 && /scoped-subtree|field-aggregate|route-scoped|discussion-prompt|assignment-learner-body/.test(childScope)) ||
            /active-editor-surface|active-crawl-network|active-crawl-graphql/.test(childSources);
        if(strongPayload) strongPayloadChildren++;
        (item.evidenceSources||[]).forEach(function(e){if(evidenceSources.indexOf(e)===-1)evidenceSources.push(e);});
        if(item.published===true||item.published===false){publishedKnown++;if(item.published===true)publishedTrue++;}
        if(Number.isFinite(Number(item.timeEstimateMinutes))) timeEvidence++;
    });
    var aggregateText=textParts.join(' ');
    var sourceText=qaCleanText_(source.textSample||'');
    var aggregate = {
        id:'cti-aggregate:' + String(source.id || sourceKey),
        name:source.name,
        type:source.type,
        rawType:'CTI_TRANSFORMATION_FAMILY_AGGREGATE',
        path:source.path,
        files:assetDetails.map(function(a){var d=qaAssetDescriptor_(a);return d.name||d.url||'';}).filter(Boolean),
        assetDetails:assetDetails,
        assetEvidenceConfidence:children.reduce(function(m,i){return Math.max(m,Number(i.assetEvidenceConfidence||0));},0),
        linkEvidenceConfidence:children.reduce(function(m,i){return Math.max(m,Number(i.linkEvidenceConfidence||0));},0),
        links:links,
        textSample:aggregateText,
        textLength:aggregateText.length,
        textConfidence:textChildren===children.length?'high':(textChildren?'medium':''),
        textEvidenceCompleteness:children.length ? textChildren/children.length : 0,
        textScopeKind:'transformation-family-aggregate',
        published:publishedKnown===children.length ? publishedTrue===children.length : null,
        evidenceLevel:'aggregate-evidence',
        evidenceSources:evidenceSources,
        syntheticOneToMany:true,
        transformationFamily:true,
        oneToMany:{
            claim:primaryClaim,
            mode:mode,
            inferred:inferred,
            childIds:children.map(function(i){return i.id||'';}),
            childNames:children.map(function(i){return i.name||'';}),
            childCount:children.length,
            textEvidenceChildren:textChildren,
            textEvidenceRatio:children.length?textChildren/children.length:0,
            strongPayloadChildren:strongPayloadChildren,
            strongPayloadEvidenceRatio:children.length?strongPayloadChildren/children.length:0,
            timeEvidenceChildren:timeEvidence,
            aggregateLengthRatio:sourceText.length ? aggregateText.length/sourceText.length : null
        },
        original:{children:children}
    };
    return {aggregate:aggregate, children:children, claim:primaryClaim, mode:mode, inferred:inferred};
}

function qaDecorateOneToManyResult_(source, aggregate, result) {
    if (!aggregate || aggregate.syntheticOneToMany !== true || !result) return result;
    var meta=aggregate.oneToMany||{};
    var ratio=Number(meta.textEvidenceRatio||0);
    var strongRatio=Number(meta.strongPayloadEvidenceRatio||0);
    var directional=source && source.textSample && aggregate.textSample ? qaDirectionalSemanticSimilarity_(source.textSample,aggregate.textSample) : 0;
    var aggregateLengthRatio=meta.aggregateLengthRatio == null ? null : Number(meta.aggregateLengthRatio);
    result.checks=result.checks||{};

    var issues=Array.isArray(result.issues)?result.issues.slice():[];
    function removeIssue(v){issues=issues.filter(function(x){return x!==v;});}
    function hasIssue(v){return issues.indexOf(v)>-1;}

    // Content must be judged against the UNION of destination children. Strong
    // source-directional semantic coverage means chunking itself is not content loss.
    if (directional >= 0.72 && ratio >= 0.80 && result.checks.content && ['CHANGED','DRIFT','UNVERIFIED'].indexOf(String(result.checks.content.status||''))>-1) {
        var old=String(result.checks.content.status||'');
        if(old==='CHANGED') result.earnedPoints=Number(result.earnedPoints||0)+10;
        else if(old==='DRIFT') result.earnedPoints=Number(result.earnedPoints||0)+5;
        else if(old==='UNVERIFIED') { result.possiblePoints=Number(result.possiblePoints||0)+10; result.earnedPoints=Number(result.earnedPoints||0)+10; }
        result.checks.content.status='VERIFIED';
        result.checks.content.similarity=Math.max(Number(result.checks.content.similarity||0),directional);
        result.checks.content.reason='The source item was intentionally/inferentially split across a destination family. Unioned child evidence covers the source strongly enough to verify semantic preservation.';
        removeIssue('CONTENT_CHANGED'); removeIssue('CONTENT_DRIFT'); removeIssue('PAYLOAD_UNVERIFIED');
    } else if (ratio < 0.80 && hasIssue('CONTENT_CHANGED')) {
        removeIssue('CONTENT_CHANGED');
        if(!hasIssue('PAYLOAD_UNVERIFIED')) issues.push('PAYLOAD_UNVERIFIED');
        if(result.checks.content){result.checks.content.status='UNVERIFIED';result.checks.content.reason='A source→destination transformation family is observed, but too few destination children have deep text evidence to prove a hard content-loss verdict.';}
    }

    var hardIndependent = hasIssue('MISSING_ASSET') || hasIssue('ASSESSMENT_CHANGED') || hasIssue('RUBRIC_CONTENT_CHANGED') || hasIssue('SI_GENERATED_CONTENT_FALLBACK_HARD');
    var runtimeOnly = hasIssue('RUNTIME_VERIFICATION_REQUIRED') || hasIssue('LINK_NOT_OBSERVED');
    var familyStatus;
    if (hardIndependent && strongRatio>=0.85) familyStatus='DEFECT';
    else if (ratio<0.60 || strongRatio<0.60) familyStatus='UNVERIFIED';
    else if (runtimeOnly || hasIssue('PAYLOAD_UNVERIFIED') || directional<0.90) familyStatus='REVIEW';
    else familyStatus='VERIFIED';

    var tf={
        status:familyStatus,
        familyStatus:familyStatus,
        mode:String(meta.mode||'EXPLICIT_ONE_TO_MANY'),
        inferred:Boolean(meta.inferred),
        sourceItem:source && source.name || '',
        childCount:Number(meta.childCount||0),
        childNames:(meta.childNames||[]).slice(0,40),
        childIds:(meta.childIds||[]).slice(),
        textEvidenceChildren:Number(meta.textEvidenceChildren||0),
        textEvidenceRatio:Number(ratio.toFixed(3)),
        strongPayloadChildren:Number(meta.strongPayloadChildren||0),
        strongPayloadEvidenceRatio:Number(strongRatio.toFixed(3)),
        directionalSourceCoverage:Number(directional.toFixed(3)),
        aggregateLengthRatio:aggregateLengthRatio == null ? null : Number(aggregateLengthRatio.toFixed(3)),
        claim:meta.claim||null,
        reason:'CTI compares one source item against the union of its destination family before declaring loss. Chunking is not itself a defect; only residual missing/changed learner payload or unverified runtime remains actionable.'
    };
    result.checks.oneToManyTransformation=tf; // compatibility with v7.1-v7.7 logic
    result.checks.transformationFamily=tf;
    result.courseraName=Number(meta.childCount||0)+' destination items (transformation family)';
    result.courseraType='Composite transformation';

    if(!hasIssue('ONE_TO_MANY_TRANSFORMATION')) issues.push('ONE_TO_MANY_TRANSFORMATION');
    if(String(meta.mode||'').indexOf('CHUNKED')>-1 || meta.inferred===true) {
        if(!hasIssue('CHUNKED_TRANSFORMATION_FAMILY')) issues.push('CHUNKED_TRANSFORMATION_FAMILY');
    }
    result.issues=issues;
    result.fidelityPercent=Number(result.possiblePoints||0)?Math.round(Number(result.earnedPoints||0)/Number(result.possiblePoints||1)*100):Number(result.fidelityPercent||0);

    var critical=issues.some(function(x){return ['MISSING_ASSET','RUBRIC_CONTENT_CHANGED','ASSESSMENT_CHANGED','SI_GENERATED_CONTENT_FALLBACK_HARD'].indexOf(x)>-1;});
    if(!critical){
        if(issues.indexOf('RUNTIME_VERIFICATION_REQUIRED')>-1) result.verdict='RUNTIME_REVIEW';
        else if(issues.indexOf('PAYLOAD_UNVERIFIED')>-1 || ratio<0.80) result.verdict='UNVERIFIED';
        else if(issues.indexOf('BEHAVIOR_MUTATION')>-1) result.verdict='BEHAVIOR_MUTATION';
        else if(issues.indexOf('BEHAVIOR_UNVERIFIED')>-1) result.verdict='UNVERIFIED';
        else result.verdict='EXPECTED_TRANSFORMATION';
    }
    if (familyStatus==='DEFECT' && result.verdict==='EXPECTED_TRANSFORMATION') result.verdict='PARTIAL';
    result.ownerAction=qaOwnerActionForResult_(result);
    result.evidenceStrength=qaEvidenceStrength_(result);
    return result;
}

function qaApplySmartIngestionProvenanceToResult_(source, result, intelligence, courseraItems) {
    if(!result || !source || !intelligence) return result;
    var claims=qaSmartIngestionClaimsForSource_(source,intelligence);
    if(!claims.length) return result;
    result.checks=result.checks||{};
    result.checks.ingestionProvenance={status:'CLAIMS_OBSERVED',claims:claims,unresolvedAssetClaims:[],trustModel:'CLAIM_PLUS_OBSERVATION',reason:'Smart Ingestion provenance claims were mapped to this source item. Positive claims do not override observed evidence; explicit failure/fallback claims are treated as direct ingestion diagnostics.'};
    result.evidenceSources=(result.evidenceSources||[]).concat(['Smart Ingestion Author Alignment Report']);
    var issues=Array.isArray(result.issues)?result.issues.slice():[];
    function addIssue(v){if(issues.indexOf(v)===-1)issues.push(v);}
    var hasSourcePayload=qaCleanText_(source.textSample||'').length>=80 || (source.assetDetails||[]).some(function(a){var d=qaAssetDescriptor_(a);return d.referenceOnly!==true&&d.presentInPackage!==false;}) || (source.links||[]).length>0;
    claims.forEach(function(c){
        var inherited = c && c.provenanceOrigin === 'EVIDENCE_MEMORY';
        if(inherited){
            // v7.3: historical provenance is not itself a current defect.
            // A separate current-state resolver decides whether the claim is
            // RESOLVED, STILL_PRESENT, PARTIAL, or UNOBSERVED.
            return;
        }
        if(c.type==='UNRESOLVED_SOURCE_ASSET'){
            var hit=qaFindCurrentAttachmentEvidence_(c.subject,courseraItems||[],result.courseraId);
            if(qaCurrentAttachmentIsObserved_(hit))return;
            result.checks.ingestionProvenance.unresolvedAssetClaims.push(c);
            addIssue('SI_UNRESOLVED_SOURCE_ASSET');
        }
        else if(c.type==='GENERATED_CONTENT_FALLBACK') addIssue(hasSourcePayload?'SI_GENERATED_CONTENT_FALLBACK_HARD':'SI_GENERATED_CONTENT_FALLBACK_REVIEW');
        else if(c.type==='GENERATED_BEHAVIOR') addIssue('SI_GENERATED_BEHAVIOR');
        else if(c.type==='BROKEN_LINK_FALLBACK') addIssue('SI_BROKEN_LINK_FALLBACK');
        else if(c.type==='PLACEHOLDER_FALLBACK') addIssue('SI_PLACEHOLDER_FALLBACK');
    });
    result.issues=issues;
    if(issues.indexOf('SI_GENERATED_CONTENT_FALLBACK_HARD')>-1) result.verdict='INGESTION_FAILURE';
    else if(issues.indexOf('SI_UNRESOLVED_SOURCE_ASSET')>-1 && result.verdict!=='INGESTION_FAILURE') result.verdict='PARTIAL';
    else if(issues.indexOf('SI_GENERATED_BEHAVIOR')>-1 && ['VERIFIED','EXPECTED_TRANSFORMATION','REPACKAGED'].indexOf(result.verdict)>-1) result.verdict='UNVERIFIED';
    result.ownerAction=qaOwnerActionForResult_(result);
    result.evidenceStrength=qaEvidenceStrength_(result);
    return result;
}


function qaClaimResolutionKey_(claim) {
    claim=claim||{};
    return [claim.type||'',qaCleanName_(claim.subject||''),qaCleanName_(claim.target||''),qaCleanName_(claim.pathHint||''),qaCleanName_(claim.excerpt||'')].join('|');
}

function qaCurrentItemDeepObserved_(item) {
    if(!item) return false;
    var src=(item.evidenceSources||[]).join(' ').toLowerCase();
    var na=item.nativeAssignment||{};
    var cse=na.currentStateEvidence||{};
    return cse.editorSurfaceObserved===true ||
        /active-editor-surface|active-crawl-network|active-crawl-graphql|active-crawl-session-network|route-scoped/.test(src) ||
        (Number(item.textEvidenceCompleteness||0)>=0.80 && /scoped-subtree|field-aggregate|route-scoped/.test(String(item.textScopeKind||'')));
}

function qaCurrentAttachmentCandidates_(item) {
    var out=[];
    if(!item) return out;
    (item.assetDetails||[]).forEach(function(a){out.push({descriptor:a,item:item,kind:'asset'});});
    var na=item.nativeAssignment||{};
    (na.attachments||[]).forEach(function(a){
        var inferred=qaCleanText_(a.inferredFileName||a.displayName||'');
        if(!inferred && a.url) inferred=qaFileName_(a.url);
        out.push({descriptor:{name:inferred,url:a.url||'',evidenceSource:a.evidenceSource||'visible-editor-attachment'},item:item,kind:'assignment-attachment',attachment:a});
    });
    return out;
}

function qaCurrentAttachmentIsObserved_(hit) {
    return !!(hit && hit.score>=0.90 && hit.presenceObserved &&
      (hit.concrete || /^(SHA256_EXACT|NAME_SIZE_EXACT|NAME_EXACT)$/.test(hit.method)));
}

function qaFindCurrentAttachmentEvidence_(expectedName, courseraItems, preferredId) {
    var best=null;
    (courseraItems||[]).forEach(function(item){
        qaCurrentAttachmentCandidates_(item).forEach(function(entry){
            var cmp=qaAssetSimilarity_(expectedName,entry.descriptor);
            var preferred=preferredId && String(item.id||'')===String(preferredId||'');
            var evidenceSource=String((entry.attachment&&entry.attachment.evidenceSource)||entry.descriptor.evidenceSource||'').toLowerCase();
            var url=String(entry.descriptor.url||'').trim();
            var downloadable=/^https?:\/\/[^\s/]+(?:[/?#]|$)/i.test(url);
            var chip=entry.kind==='assignment-attachment' && evidenceSource==='visible-editor-file-chip' && qaCurrentItemDeepObserved_(item);
            var concrete=chip || (entry.kind==='assignment-attachment' && downloadable && /visible-editor-file-link|active-editor/.test(evidenceSource));
            var presenceObserved=downloadable || /^[a-f0-9]{64}$/i.test(String(entry.descriptor.sha256||'')) || !!entry.descriptor.assetId || chip;
            var adjusted=Number(cmp.score||0)+(preferred?0.02:0)+(concrete?0.02:0)+(presenceObserved?1:0);
            if(!best||adjusted>best.adjusted){
                best={adjusted:adjusted,score:Number(cmp.score||0),method:cmp.method,reason:cmp.reason,itemId:item.id||'',itemName:item.name||'',itemPath:item.path||'',candidate:entry.descriptor,kind:entry.kind,attachment:entry.attachment||null,concrete:concrete,presenceObserved:presenceObserved};
            }
        });
    });
    return best;
}

function qaCurrentGeneratedBehaviorMatches_(claim,courseraItems,preferredId) {
    var subject=qaCleanName_(claim&&claim.subject||'');
    var target=qaCleanText_(claim&&claim.target||'');
    var matches=[], observed=[];
    (courseraItems||[]).forEach(function(item){
        var na=item.nativeAssignment;
        if(!na) return;
        var deep=qaCurrentItemDeepObserved_(item);
        if(!deep && !na.currentStateEvidence) return;
        var settings=na.settings||{}, sub=na.submission||{}, hit=false, currentValue='';
        if(subject==='passing threshold'){
            if(Object.prototype.hasOwnProperty.call(settings,'passingThreshold')){
                currentValue=String(settings.passingThreshold)+'%';
                var expected=String(target).match(/-?\d+(?:\.\d+)?/);
                hit=!!expected && Number(expected[0])===Number(settings.passingThreshold);
                observed.push({item:item,value:currentValue});
            }
        } else if(subject==='grader type'){
            if(sub.aiGraded===true || String(settings.graderType||'').toUpperCase()==='AI'){hit=/\bAI\b/i.test(target||'AI');currentValue='AI';observed.push({item:item,value:currentValue});}
            else if(sub.peerGraded===true || String(settings.graderType||'').toUpperCase()==='PEER'){currentValue='PEER';observed.push({item:item,value:currentValue});}
            else if(sub.staffGraded===true || String(settings.graderType||'').toUpperCase()==='STAFF'){currentValue='STAFF';observed.push({item:item,value:currentValue});}
        } else if(subject==='rubric'){
            if(Number(na.rubricCount||0)>0){
                currentValue=String(Number(na.rubricCount||0))+' rubric(s)';
                // A rubric exists now, but provenance only said Smart Ingestion
                // generated *a* rubric. Count alone cannot prove this is still the
                // same generated rubric after human cleanup.
                observed.push({item:item,value:currentValue,rubricIdentityUnproven:true});
            } else if(deep){observed.push({item:item,value:'0 rubrics',rubricIdentityUnproven:false});}
        }
        if(hit) matches.push({item:item,value:currentValue,preferred:preferredId&&String(item.id||'')===String(preferredId||'')});
    });
    matches.sort(function(a,b){return Number(b.preferred)-Number(a.preferred);});
    return {matches:matches,observed:observed};
}

function qaFindCurrentItemBySubject_(subject,courseraItems) {
    var key=qaCleanName_(subject||'').replace(/\.(html?|docx?|pdf|pptx?|xlsx?)$/,'').trim();
    if(!key) return null;
    var best=null,bestScore=0;
    (courseraItems||[]).forEach(function(item){
        var name=qaCleanName_(item.name||'');
        var score=fuzzyMatchScore_(key,name);
        if(name===key) score=1;
        if(score>bestScore){bestScore=score;best=item;}
    });
    return bestScore>=0.78?best:null;
}