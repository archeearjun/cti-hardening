import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateCorpusManifest,inspectSavedCapture,runEvidenceCorpus} from '../tools/replay-evidence-corpus.mjs';
import {comparisonFixture} from './workflow-fixtures.mjs';
test('Corpus manifest refuses ambiguous cases and output traversal',()=>{
  const valid={kind:'CTI_EVIDENCE_CORPUS',schemaVersion:1,cases:[{id:'case-1',course:'Example',coursera:'capture.json'}]};
  assert.equal(validateCorpusManifest(valid),valid);
  for(const cases of [[{...valid.cases[0],id:'../input'}],[valid.cases[0],valid.cases[0]],
    [{...valid.cases[0],sourceScan:'scan.json',excel:'file.xlsx'}]])assert.throws(()=>validateCorpusManifest({...valid,cases}));
});
test('Capture review keeps the historical build and distinguishes attempts from observed editors',()=>{
  const capture={schemaVersion:33,meta:{buildId:'v6.13.27-historical',activeSpaCrawl:{targets:2,eligibleTargets:2,targetIds:['a','b'],routeAttempts:2,
    targetDiagnostics:[{id:'a',editorSurfaceCaptured:true},{id:'b',found:true}]}},fingerprints:[]};
  const raw=JSON.stringify(capture),r=inspectSavedCapture(capture);
  assert.equal(r.capturedBuild,'v6.13.27-historical');assert.equal(r.traversal.visited,1);
  assert.deepEqual(Array.from(r.traversal.unresolvedItemIds),['b']);assert(r.groups.includes('EDITOR_NOT_OBSERVED'));
  assert.equal(JSON.stringify(capture),raw);
});
test('One batch replays complete inputs, retains partial reviews, and records failures without dropping later cases',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cti-corpus-'));
  try{
    const input=comparisonFixture();
    fs.writeFileSync(path.join(dir,'capture.json'),input.json.bytes);
    fs.writeFileSync(path.join(dir,'export.xlsx'),input.excel.bytes);
    fs.writeFileSync(path.join(dir,'scan.json'),JSON.stringify({...input.course.data.scan,kind:'CTI_PACKAGE_SCAN'}));
    fs.writeFileSync(path.join(dir,'bad.json'),'{bad');
    const c={id:'complete',course:'Example',sourceScan:'scan.json',coursera:'capture.json',excel:'export.xlsx',mode:'raw'};
    const manifest={kind:'CTI_EVIDENCE_CORPUS',schemaVersion:1,cases:[c,{id:'bad',course:'Bad',coursera:'bad.json'},
      {id:'review-only',course:'Other',coursera:'capture.json',excel:'export.xlsx'}]};
    const mf=path.join(dir,'manifest.json');fs.writeFileSync(mf,JSON.stringify(manifest));
    const before=fs.readFileSync(path.join(dir,'capture.json'));
    const r=runEvidenceCorpus(mf,path.join(dir,'output'));
    assert.equal(r.replayed,1);assert.equal(r.reviewOnly,1);assert.equal(r.failed,1);assert.equal(r.liveExtractorTested,false);
    assert.equal(r.cases[0].qa.coherence.intersectingItemIds,2);
    assert.equal(r.cases[0].qa.coherence.status,'UNVERIFIED'); // two synthetic IDs do not satisfy the real coherence threshold
    assert.equal(r.cases[0].hashes.coursera.length,64);
    assert(!r.cases[2].qa);assert(r.cases[2].workbook.sheets.length);
    const full=JSON.parse(fs.readFileSync(path.join(dir,'output/complete.json')));
    assert.equal(full.result.itemResults.length,2);assert.match(full.report,/Discussion/);
    assert.deepEqual(fs.readFileSync(path.join(dir,'capture.json')),before);
    manifest.cases=[{id:'capture',course:'Example',coursera:'capture.json'}];fs.writeFileSync(mf,JSON.stringify(manifest));
    assert.throws(()=>runEvidenceCorpus(mf,dir),/overwrite/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
