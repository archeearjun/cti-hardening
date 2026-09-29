

export function qaOwnerTasksText(res) {
    var lines=['OWNER TASKS — what to do and where'],refresh=[],tasks=[],byKey=Object.create(null);
    function add(severity,path,name,id,action,sourceLabel) {
      if(['CRITICAL','REVIEW','EVIDENCE'].indexOf(severity)===-1||!action) return;
      name=name||'Unmapped finding — identify the affected item';
      var key=JSON.stringify([id||'',path,name,severity,action]);
      // Without stable destination identity, keep separate source tasks.
      if(!id) key+=':'+tasks.length;
      var task=byKey[key];
      if(!task){task={severity:severity,path:path,name:name,id:id,action:action,sources:[]};byKey[key]=task;tasks.push(task);}
      if(sourceLabel && task.sources.indexOf(sourceLabel)===-1) task.sources.push(sourceLabel);
    }
    (res.itemResults||[]).forEach(function(r){
      var a=r.ownerAction||{},check=r.checks&&r.checks.structuredAssessment;
      if(check&&check.sourceAnswerRefreshRequired && refresh.indexOf(r.sourceName)===-1) refresh.push(r.sourceName);
      if(check&&check.sourceAnswerRefreshRequired && r.verdict==='UNVERIFIED' && !(r.checks.destinationReadiness||[]).length && (r.issues||[]).every(function(x){return x==='PAYLOAD_UNVERIFIED';})) return;
      add(a.severity||'REVIEW',r.courseraPath||r.sourcePath||'Root',r.courseraName||r.sourceName,r.courseraId||'',a.action,(r.sourcePath||'Root')+' → '+r.sourceName+(r.sourceId?' ['+r.sourceId+']':''));
    });
    if(refresh.length) lines.push('[EVIDENCE] Refresh the same original IMSCC once: use Re-Scan on its existing CTI package row, select the original .imscc file, and wait for completion. Then repeat QA. Legacy answer evidence affects: '+refresh.join('; ')+'. No answer change is established solely by this evidence gap.');
    var sourceCarriers=(res.injected||[]).filter(function(i){return i.classification==='SOURCE_ASSET_CARRIER' && !(i.operationalPolicy&&i.operationalPolicy.classification==='NON_LFM_POLICY_EXEMPT');});
    if(sourceCarriers.length)lines.push('[REVIEW] Source attachment placement and visibility: '+sourceCarriers.length+' destination item(s) contain exact source-file matches. Review their organization and any answer-key visibility in the additional-items section. File provenance is verified; the intended learner visibility and surrounding item content remain separate checks.');
    (res.destinationReadiness&&res.destinationReadiness.findings||[]).forEach(function(f){
      if(f.policyExempt)return;
      if((res.itemResults||[]).some(function(r){return qaReadinessActionRepresented_(r,f);})) return;
      add(f.severity,f.path||'Course',f.itemName,f.itemId||'',f.action,'');
    });
    tasks.forEach(function(t){
      lines.push('['+t.severity+'] '+t.path+' → '+t.name+(t.id&&!/^cti-aggregate:/.test(t.id)?' ['+t.id+']':'')+'\n  '+t.action+(t.sources.length>1?'\n  Applies to source items: '+t.sources.join('; '):''));
    });
    if(lines.length===1) lines.push('No active owner task is recorded. This does not establish unobserved content as complete.');
    return lines.join('\n')+'\n\n';
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
