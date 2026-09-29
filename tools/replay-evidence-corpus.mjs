import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createEngine} from '../src/engine/index.js';
import {createBrowserServices} from '../src/adapters/browser-services.ts';
import {fileURLToPath} from 'node:url';
import {createWorkflows} from '../src/domain/workflows.ts';
import {workerXml} from '../src/adapters/worker-xml.ts';
import {readWorkbook} from '../src/adapters/workbook.ts';
import {newRecord} from '../src/domain/workspace-store.ts';
const qa=createEngine({...createBrowserServices(),XmlService:workerXml});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeId=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const limits={coursera:25*1024*1024,brightspace:40*1024*1024,excel:25*1024*1024,sourceScan:64*1024*1024,historicalReport:10*1024*1024};

export function validateCorpusManifest(manifest) {
  if(manifest?.kind!=='CTI_EVIDENCE_CORPUS'||manifest.schemaVersion!==1||!Array.isArray(manifest.cases)||!manifest.cases.length)
    throw Error('Expected a non-empty CTI_EVIDENCE_CORPUS schema 1 manifest.');
  const seen=new Set();
  for(const c of manifest.cases){
    if(typeof c.id!=='string'||!safeId.test(c.id)||seen.has(c.id))throw Error('Case IDs must be unique safe file names.');
    seen.add(c.id);
    if(typeof c.course!=='string'||!c.course.trim()||typeof c.coursera!=='string'||!c.coursera)
      throw Error('Every case needs an explicit course and Coursera capture path.');
    if(c.sourceScan&&(!c.excel||!['raw','ops','published','auto'].includes(c.mode)))
      throw Error('Full replays need XLSX and an explicit snapshot mode.');
    for(const key of Object.keys(limits))if(c[key]!=null&&(typeof c[key]!=='string'||!c[key]))throw Error('Invalid input path: '+key);
  }
  return manifest;
}

export function inspectSavedCapture(capture,brightspace) {
  qa.qaAssertNotDiagnosticCapture_(capture);
  if(!Array.isArray(capture?.fingerprints))throw Error('Corpus review expects a full fingerprint capture, not an inferred or focused item collection.');
  const normalized=capture.fingerprints.map(qa.normalizeCourseraItem_);
  const assessments=normalized.filter(x=>x.structuredAssessment).map(x=>{
    const a=x.structuredAssessment,questions=a.questions||[],ids=questions.map(q=>String(q.id||'')).filter(Boolean);
    const coverage=a.captureCompleteness;
    return {id:x.id,name:x.name,records:questions.length,declared:a.declaredQuestionCount,
      uniqueQuestionIds:new Set(questions.map(q=>q.courseraQuestionId).filter(Boolean)).size,
      questionCoverageComplete:typeof coverage?.questionCoverageComplete==='boolean'?coverage.questionCoverageComplete:null,
      unresolvedQuestionPositions:coverage?.missingQuestionOrdinals||[],
      uniqueRecordIds:new Set(ids).size,unknownTypes:questions.filter(q=>!q.type||q.type==='unknown').length,
      optionBoundaryGaps:questions.filter(q=>q.optionCaptureIssue).length,
      capturedBelowDeclaration:Number(a.declaredQuestionCount)>questions.length};
  });
  const traversal=qa.qaCaptureTraversalSummary_({... (capture.meta||capture.extractionMeta||{}),xlsxTraversalInventory:undefined});
  const source=brightspace?qa.qaParseBrightspaceGroundTruthCapture_(Buffer.from(JSON.stringify(brightspace)).toString('base64'),'saved-brightspace.json'):null;
  const sourceQuizzes=source?qa.qaBrightspaceQuizCaptureSummary_(source.quizzes):null;
  const groups=[];
  if(traversal.recorded&&!traversal.complete)groups.push('EDITOR_NOT_OBSERVED');
  if(assessments.some(a=>a.capturedBelowDeclaration))groups.push('QUESTION_COUNT_EVIDENCE_GAP');
  if(assessments.some(a=>a.unknownTypes))groups.push('UNKNOWN_QUESTION_TYPE');
  if(assessments.some(a=>a.questionCoverageComplete===false))groups.push('QUESTION_COVERAGE_UNVERIFIED');
  if(assessments.some(a=>a.optionBoundaryGaps))groups.push('OPTION_FEEDBACK_BOUNDARY');
  if(sourceQuizzes?.quizEvidenceGaps)groups.push('SOURCE_QUESTION_TOTAL_UNVERIFIED');
  return {capturedAt:capture.extractedAt||capture.capturedAt||'',
    capturedBuild:capture.meta?.buildId||capture.buildId||capture.meta?.extractor||'',schema:capture.schemaVersion,
    itemRecords:normalized.length,traversal,assessments,sourceQuizEvidence:sourceQuizzes,groups,
    scope:'Saved capture review. Records and declared counts are not proof of course completeness; no live extraction was executed.'};
}

export function runEvidenceCorpus(manifestFile,outputDirectory,{onCase=()=>{}}={}) {
  const manifestPath=path.resolve(manifestFile),base=path.dirname(manifestPath);
  const manifestBytes=fs.readFileSync(manifestPath),manifest=validateCorpusManifest(JSON.parse(manifestBytes));
  const out=path.resolve(outputDirectory),workflows=createWorkflows(workerXml),records=[];
  // Validate before writing anything; never replace a supplied input with output.
  const inputs=new Set([manifestPath,...manifest.cases.flatMap(c=>Object.keys(limits).filter(k=>c[k]).map(k=>path.resolve(base,c[k])))]);
  const destinations=['review.json','review.md',...manifest.cases.flatMap(c=>[c.id+'.json',c.id+'.txt'])].map(p=>path.join(out,p));
  if(destinations.some(p=>inputs.has(p)))throw Error('Output would overwrite a corpus input. Choose another output directory.');
  fs.mkdirSync(out,{recursive:true});
  for(const c of manifest.cases){
    const start=Date.now(),hashes={},loaded={};
    const row={id:c.id,course:c.course,label:c.label||'',status:'ERROR',hashes};
    try{
      for(const [key,limit] of Object.entries(limits))if(c[key]){
        const file=path.resolve(base,c[key]);if(fs.statSync(file).size>limit)throw Error(key+' exceeds its replay limit.');
        const bytes=fs.readFileSync(file);hashes[key]=sha(bytes);loaded[key]={name:path.basename(file),bytes:new Uint8Array(bytes)};
      }
      const json=key=>JSON.parse(new TextDecoder().decode(loaded[key].bytes));
      row.capture=inspectSavedCapture(json('coursera'),loaded.brightspace?json('brightspace'):null);
      if(loaded.excel){
        const wb=readWorkbook(loaded.excel.bytes,loaded.excel.name);row.workbook={sheets:Object.entries(wb.sheets).map(([name,s])=>({name,rows:s.values.length}))};
        const capture=json('coursera'),rows=(wb.sheets['FOR IMPORT']||Object.values(wb.sheets)[0]).values;
        const inventory=qa.qaXlsxTraversalInventory_(rows,capture.fingerprints.map(qa.normalizeCourseraItem_),capture.page,loaded.excel.name,loaded.coursera.name);
        row.capture.rawTraversal=row.capture.traversal;
        row.capture.traversal=qa.qaCaptureTraversalSummary_({... (capture.meta||capture.extractionMeta||{}),xlsxTraversalInventory:inventory});
        row.capture.structuralInventory=inventory;
        row.capture.groups=row.capture.groups.filter(g=>g!=='EDITOR_NOT_OBSERVED');
        if(row.capture.traversal.recorded&&!row.capture.traversal.complete)row.capture.groups.push('EDITOR_NOT_OBSERVED');
      }
      if(loaded.brightspace){
        const guard=qa.qaBrightspaceIdentityGuard_({course:json('brightspace').course,page:json('brightspace').page},{fileName:c.course+'.imscc'});
        if(!guard.ok)throw Error(guard.reason);
      }
      if(loaded.sourceScan){
        const scan=json('sourceScan');
        if(scan.kind!=='CTI_PACKAGE_SCAN'||!Array.isArray(scan.courseTree)||!/^[a-f0-9]{64}$/i.test(scan.fileSha256||''))throw Error('Full replay requires a package scan with source SHA-256 and course tree.');
        const course=newRecord('package',c.course,{partner:c.partner||'',scan});
        // Independent replay: no invented before/after lineage or remembered claims.
        const id=sha(Buffer.from(c.course+'|'+scan.fileSha256));
        course.id=id.slice(0,8)+'-'+id.slice(8,12)+'-4'+id.slice(13,16)+'-8'+id.slice(17,20)+'-'+id.slice(20,32);
        const replay=workflows.compare({course,excel:loaded.excel,json:loaded.coursera,brightspace:loaded.brightspace,
          mode:c.mode,generation:0,history:[],ingestionCapabilityStatus:'UNKNOWN'});
        fs.writeFileSync(path.join(out,c.id+'.json'),JSON.stringify(replay));
        fs.writeFileSync(path.join(out,c.id+'.txt'),replay.report);
        const r=replay.result,s=r.summary||{},policy=r.operationalPolicy||{};
        row.status='REPLAYED';row.qa={engineBuild:r.engineBuildId,coherence:r.inputCoherence,
          counts:Object.fromEntries(['totalSourceItems','verified','missing','unverified','ingestionFailures','evidenceCoverage'].map(k=>[k,s[k]])),
          learnerFacingMissing:policy.learnerFacingMissing,policyExempt:policy.policyExemptSourceItems,
          sourcePackageSha256:scan.fileSha256,sourceScannerEnvironment:scan.sourceEvidence?.environment||null,
          decision:'Independent replay only; historical policy/memory and present-day course state are not reconstructed.'};
      }else{row.status='CAPTURE_REVIEW_ONLY';row.limit='Source package scan was not supplied. No source-to-destination fidelity verdict was computed.';}
    }catch(e){row.error=e.message;}
    row.elapsedMs=Date.now()-start;records.push(row);onCase(row);
  }
  const groups={};
  for(const r of records)for(const group of r.capture?.groups||[]){groups[group]??={courses:[],cases:[]};if(!groups[group].courses.includes(r.course))groups[group].courses.push(r.course);groups[group].cases.push(r.id);}
  const review={kind:'CTI_EVIDENCE_CORPUS_REVIEW',schemaVersion:1,reviewedAt:new Date().toISOString(),manifestSha256:sha(manifestBytes),
    qaBuild:qa.CTI_QA_ENGINE_BUILD_ID_,availableExtractors:qa.CTI_RELEASE_REGISTRY_,
    liveExtractorTested:false,historicalInputsModified:false,caseCount:records.length,courseCount:new Set(records.map(r=>r.course)).size,
    replayed:records.filter(r=>r.status==='REPLAYED').length,reviewOnly:records.filter(r=>r.status==='CAPTURE_REVIEW_ONLY').length,failed:records.filter(r=>r.status==='ERROR').length,
    scope:'Offline evidence replay, not a publication sign-off or validation of current live extractors. Old captures remain old captures. Grouped gaps identify investigation areas, not automatic rerun instructions.',groups,cases:records};
  fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(review,null,2));
  const cell=x=>String(x??'').replace(/[\r\n|]/g,' ');
  fs.writeFileSync(path.join(out,'review.md'),[
    '# Saved evidence batch review','',review.scope,'',
    `QA build: ${review.qaBuild}. ${review.courseCount} courses; ${review.replayed} full comparisons; ${review.reviewOnly} capture-only reviews; ${review.failed} errors.`,
    '', '| Case | Capture build | Editors observed | Review scope | Groups |','|---|---|---|---|---|',
    ...records.map(r=>{const t=r.capture?.traversal;return '| '+[r.id,r.capture?.capturedBuild,t?.recorded?`${t.visited}/${t.eligible}`:'Not recorded',r.status,r.error||(r.capture?.groups||[]).join(', ')].map(cell).join(' | ')+' |';}),
    '', 'Each JSON retains input hashes and source limitations. Comparisons use explicit snapshot modes with no historical memory. Missing scans and failed cases are not counted as successful full comparisons.',
    '', 'A version difference alone does not justify a new extraction. Review one representative of each unresolved mechanism after a relevant fix; retain the other saved inputs as regression evidence.','',
  ].join('\n'));
  return review;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4){console.error('Usage: node tools/replay-evidence-corpus.mjs PRIVATE_MANIFEST.json PRIVATE_OUTPUT_DIRECTORY');process.exitCode=2;}
  else{try{const r=runEvidenceCorpus(process.argv[2],process.argv[3],{onCase:r=>console.log(JSON.stringify({id:r.id,status:r.status,elapsedMs:r.elapsedMs,error:r.error}))});console.log(JSON.stringify({courses:r.courseCount,replayed:r.replayed,reviewOnly:r.reviewOnly,failed:r.failed}));if(r.failed)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
}
