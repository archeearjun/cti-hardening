import { ownerAccessFixture } from './browser-owner-fixture.mjs';
import { ownerTool } from './browser-workspace-navigation.mjs';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require=createRequire(root+'/package.json');const JSZip=require('jszip');
const policies=fs.readFileSync(root+'/public/_headers','utf8').split('\n').filter(l=>l.includes('Content-Security-Policy:')).map(l=>l.split('Content-Security-Policy: ')[1]);
const requests=[],errors=[];
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const f=root+'/dist'+(pathname==='/'?'/index.html':pathname);const type=/\.(js|mjs)$/.test(pathname)?'text/javascript':pathname.endsWith('.css')?'text/css':'text/html';try{const body=fs.readFileSync(f);res.writeHead(200,{'content-type':type,'Content-Security-Policy':pathname==='/package-runner.html'?policies.join(', '):policies[0]});res.end(body);}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH ? {executablePath:process.env.CTI_CHROMIUM_PATH} : {}),args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:1080}});await ownerAccessFixture(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Content Security Policy'))console.error(m.text().slice(0,300));});
function pdf(){const stream='BT /F1 12 Tf 50 700 Td (Assignment instructions: submit a written response and follow the grading rubric carefully.) Tj ET';const bodies=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let out='%PDF-1.4\n',offsets=[0];for(let i=0;i<bodies.length;i++){offsets.push(out.length);out+=`${i+1} 0 obj\n${bodies[i]}\nendobj\n`;}const xref=out.length;out+=`xref\n0 ${bodies.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${bodies.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(out);}
const qti='<questestinterop><assessment ident="a"><section ident="s">'+[1,2].map(n=>`<item ident="q${n}" title="Repeated title"><presentation><material><mattext texttype="text/plain">Same visible question wording?</mattext></material><response_lid ident="r" rcardinality="Single"><render_choice><response_label ident="a"><material><mattext>First</mattext></material></response_label><response_label ident="b"><material><mattext>Second</mattext></material></response_label></render_choice></response_lid></presentation><resprocessing><respcondition><conditionvar><varequal respident="r">a</varequal></conditionvar><setvar varname="SCORE" action="Set">100</setvar></respcondition></resprocessing></item>`).join('')+'</section></assessment></questestinterop>';
const manifest='<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1"><organizations><organization><item identifier="root"><title>Course</title><item identifier="mod"><title>Module One</title><item identifierref="r1"><title>Read me</title></item><item identifierref="q1"><title>Quiz</title></item><item identifierref="a1"><title>Assignment</title></item></item></item></organization></organizations><resources><resource identifier="r1" type="webcontent"><file href="reading.html"/></resource><resource identifier="q1" type="imsqti_xmlv1p2"><file href="quiz.xml"/></resource><resource identifier="a1" type="assignment_xmlv1p0"><file href="assignment.xml"/><dependency identifierref="pdf"/></resource><resource identifier="pdf" type="webcontent"><file href="rubric.pdf"/></resource></resources></manifest>';
const z=new JSZip();z.file('imsmanifest.xml',manifest);z.file('reading.html','<p>Verified reading text.</p><script>parent.document.body.textContent="BAD"</script><iframe src="https://example.test/embed"></iframe>');z.file('quiz.xml',qti);z.file('assignment.xml','<assignment xmlns="http://www.imsglobal.org/xsd/imscc_extensions/assignment"><title>Assignment</title><instructor_text texttype="text/html">&lt;p&gt;Submit your file.&lt;/p&gt;</instructor_text></assignment>');z.file('rubric.pdf',pdf());z.file('embedded/imsmanifest.xml','<manifest/>');const fixture=await z.generateAsync({type:'nodebuffer'});
// A valid stored ZIP whose large media body is a sparse file hole. The fixture
// has the same 450 MiB logical size seen by Chromium without a 450 MiB Buffer.
async function largeSparseFixture(directory) {
  const fileName = 'trde130.imscc', targetBytes = 450 * 1024 * 1024;
  const readingText = 'Literal source reading retained from a 450 MiB IMSCC.';
  const manifestText = '<manifest><organizations><organization identifier="course"><item identifier="module"><title>Large source module</title><item identifier="reading-item" identifierref="reading-resource"><title>Retained reading</title></item><item identifier="video-item" identifierref="video-resource"><title>Original large video</title></item></item></organization></organizations><resources><resource identifier="reading-resource" type="webcontent"><file href="reading.html"/></resource><resource identifier="video-resource" type="webcontent"><file href="media/original.mp4"/></resource></resources></manifest>';
  const entries = [
    {name:'imsmanifest.xml', body:Buffer.from(manifestText)},
    {name:'reading.html', body:Buffer.from('<p>'+readingText+'</p>')},
    {name:'media/original.mp4', body:null},
  ];
  const overhead = 22 + entries.reduce((n, entry) => n + 30 + 46 + 2 * Buffer.byteLength(entry.name) + (entry.body?.length || 0), 0);
  const videoBytes = targetBytes - overhead, zeroes = Buffer.alloc(1024 * 1024);
  let videoCrc = 0;
  for (let offset = 0; offset < videoBytes; offset += zeroes.length)
    videoCrc = crc32(zeroes.subarray(0, Math.min(zeroes.length, videoBytes - offset)), videoCrc);
  const filePath = path.join(directory, fileName), descriptor = fs.openSync(filePath, 'w');
  let position = 0;
  const write = bytes => {
    let written = 0;
    while (written < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, written, bytes.length - written, position + written);
      assert(count > 0, 'Fixture write must make progress');
      written += count;
    }
    position += bytes.length;
  };
  try {
    for (const entry of entries) {
      entry.nameBytes = Buffer.from(entry.name);
      entry.size = entry.body ? entry.body.length : videoBytes;
      entry.crc = entry.body ? crc32(entry.body) : videoCrc;
      entry.offset = position;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x0021, 12);
      header.writeUInt32LE(entry.crc, 14); header.writeUInt32LE(entry.size, 18);
      header.writeUInt32LE(entry.size, 22); header.writeUInt16LE(entry.nameBytes.length, 26);
      write(header); write(entry.nameBytes);
      if (entry.body) write(entry.body);
      else position += videoBytes;
    }
    const centralOffset = position;
    for (const entry of entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0021, 14);
      header.writeUInt32LE(entry.crc, 16); header.writeUInt32LE(entry.size, 20);
      header.writeUInt32LE(entry.size, 24); header.writeUInt16LE(entry.nameBytes.length, 28);
      header.writeUInt32LE(entry.offset, 42);
      write(header); write(entry.nameBytes);
    }
    const centralBytes = position - centralOffset, end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBytes, 12); end.writeUInt32LE(centralOffset, 16);
    write(end);
    assert.equal(position, targetBytes);
  } finally { fs.closeSync(descriptor); }
  assert.equal(fs.statSync(filePath).size, targetBytes);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, {highWaterMark:2 * 1024 * 1024})) hash.update(chunk);
  return {filePath, fileName, bytes:targetBytes, videoBytes, readingText, sha256:hash.digest('hex')};
}
let sparseDirectory;
try{
await page.goto('http://127.0.0.1:4173');await ownerTool(page, 'Inspect a package');
async function scan(input){await page.locator('#package-file').setInputFiles(input);await page.getByRole('button',{name:'Inspect package',exact:false}).click();await Promise.race([page.getByText('Package inspection complete',{exact:true}).waitFor({timeout:120000}),page.getByRole('alert').waitFor({timeout:120000}).then(async()=>{throw Error(await page.getByRole('alert').innerText());})]);const promise=page.waitForEvent('download');await page.getByRole('button',{name:'Download package evidence'}).click();return JSON.parse(fs.readFileSync(await (await promise).path(),'utf8'));}
const r=await scan({name:'synthetic.imscc',mimeType:'application/zip',buffer:fixture});assert.equal(r.kind,'CTI_PACKAGE_SCAN');assert.equal(r.stats.totalResources,4);assert.equal(r.moduleCount,1);assert.equal(r.sourceEvidence.resources.q1.structuredAssessment.questionCount,2);assert.deepEqual(r.sourceEvidence.resources.q1.structuredAssessment.questions.map(q=>q.id),['q1','q2']);assert.equal(r.sourceEvidence.resources.r1.textSample,'Verified reading text.');assert(r.sourceEvidence.resources.r1.files[0].sha256);const pf=r.sourceEvidence.resources.pdf.files[0];assert.equal(pf.pdfParser,'pdfjs-6.3.289');assert.equal(pf.pdfPagesRead,1);assert(pf.textSample.includes('submit a written response'));assert(r.sourceEvidence.resources.a1.files.some(f=>f.dependencyResourceId==='pdf'&&f.sha256));assert.equal(r.sourceEvidence.manifestPath,'imsmanifest.xml');
// Opt-in diagnostic export stays separate from source evidence and has no body text.
await page.getByText('Performance diagnostics',{exact:true}).click();
await page.getByLabel('Enable local diagnostics for subsequent operations').check();
const instrumented=await scan({name:'synthetic.imscc',mimeType:'application/zip',buffer:fixture});
assert.deepEqual(instrumented.sourceEvidence,r.sourceEvidence);
const perfDownload=page.waitForEvent('download');
await page.getByRole('button',{name:'Download performance diagnostics',exact:true}).click();
const performanceBundle=JSON.parse(fs.readFileSync(await (await perfDownload).path(),'utf8'));
const scanPerformance=performanceBundle.reports.find(report=>report.stages.some(stage=>stage.stage==='scan'));
assert(scanPerformance);assert.equal(scanPerformance.measurementStatus,'complete');
for(const stage of ['package_hash','archive_index','archive_read','manifest_parse','qti_parse','content_inventory','structure_analysis'])assert(scanPerformance.stages.some(row=>row.stage===stage),stage);
assert(!JSON.stringify(performanceBundle).includes('Verified reading text'));
await page.getByLabel('Enable local diagnostics for subsequent operations').uncheck();

await page.getByLabel('Find an item').fill('Quiz');
assert.equal(await page.locator('.package-items li > details').count(),3,'Course and module ancestors stay with the matching quiz');
await page.locator('.package-items li > details > summary').filter({hasText:'Quiz'}).click();
await page.getByText('Full entry evidence',{exact:true}).click();await page.locator('.evidence-json').waitFor({state:'visible'});
const hierarchy=r.sourceHierarchy;assert.equal(hierarchy[0].title,'Course');assert.equal(hierarchy[0].children[0].title,'Module One');assert.equal(hierarchy[0].children[0].children[1].title,'Quiz');

// Reproduce the real 450 MB source-package rejection using an actual native
// file input, scanner iframe, byte fingerprint and seekable archive reader.
sparseDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'cti-large-source-package-'));
const largeFixture=await largeSparseFixture(sparseDirectory);
await page.addInitScript(() => {
  const original = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = function (...args) {
    if (window.top.__CTI_LARGE_PACKAGE_GUARD__ && this.size > 24 * 1024 * 1024) {
      window.top.__CTI_LARGE_PACKAGE_READS__.push(this.size);
      throw Error('The scanner attempted an unbounded large-package read.');
    }
    return Reflect.apply(original, this, args);
  };
});
await page.evaluate(() => { window.__CTI_LARGE_PACKAGE_GUARD__=true; window.__CTI_LARGE_PACKAGE_READS__=[]; });
const large=await scan(largeFixture.filePath);
assert.equal(large.fileName,'trde130.imscc','Keep the original selected filename');
const selectedLarge=await page.getByTestId('selected-package-file').innerText();
assert(selectedLarge.includes('trde130.imscc'));assert.match(selectedLarge,/450\s+MiB/);
assert.equal(large.fileSha256,largeFixture.sha256,'The exact 450 MiB archive receives a complete chunked SHA-256');
assert.equal(large.sourceEvidence.environment.packageReadMode,'BLOB_RANGES');
assert.equal(large.sourceEvidence.environment.packageHashChunkBytes,2*1024*1024);
assert.equal(large.sourceEvidence.environment.packageArchiveLimitBytes,640*1024*1024);
assert.equal(large.sourceHierarchy[0].title,'Large source module');
assert.equal(large.sourceHierarchy[0].children.length,2);
assert.equal(large.sourceEvidence.resources['reading-resource'].textSample,largeFixture.readingText);
assert(large.sourceEvidence.resources['reading-resource'].files[0].sha256);
const largeVideo=large.sourceEvidence.resources['video-resource'].files[0];
assert.equal(largeVideo.presentInPackage,true);assert.equal(largeVideo.size,largeFixture.videoBytes);
assert(!largeVideo.sha256,'A large media body is not promoted to byte-verified evidence');
assert(largeVideo.size>large.sourceEvidence.limits.maxHashedFileBytes);
assert(large.warnings.some(w=>/no SHA-256 fingerprint/.test(w)),'Large original media retains an explicit bounded-inspection gap');
assert.deepEqual(await page.evaluate(()=>window.__CTI_LARGE_PACKAGE_READS__),[],'No archive-sized or large-media arrayBuffer read is attempted');
await page.evaluate(()=>{window.__CTI_LARGE_PACKAGE_GUARD__=false;});


// Regression fixtures exercise the real parser in its browser runner.
const item=(id)=>`<item ident="${id}"><presentation><material><mattext>Question ${id}?</mattext></material><response_str ident="answer"/></presentation></item>`;
const bank=(items)=>`<questestinterop><assessment><section>${items}</section></assessment></questestinterop>`;
const regressionManifest=`<manifest><organizations default="chosen"><organization identifier="other"><item><title>Wrong organization</title></item></organization><organization identifier="chosen"><item><title>Module 1</title><item><title>Week 1</title><item identifierref="large"><title>Large quiz</title></item><item identifierref="parent"><title>Combined banks</title></item></item></item></organization></organizations><resources>
<resource identifier="large" type="imsqti_xmlv1p2"><file href="large.xml"/></resource>
<resource identifier="bankA" type="imsqti_xmlv1p2"><file href="a.xml"/></resource><resource identifier="bankB" type="imsqti_xmlv1p2"><file href="b.xml"/></resource>
<resource identifier="parent" type="imsqti_xmlv1p2"><dependency identifierref="bankA"/><dependency identifierref="bankB"/></resource>
<resource identifier="sibling" type="imsqti_xmlv1p2"><dependency identifierref="bankA"/></resource>
<resource identifier="draws" type="imsqti_xmlv1p2"><file href="draws.xml"/></resource>
<resource identifier="external" type="webcontent"><file href="https://example.test/reference.pdf"/></resource>
<resource identifier="long" type="webcontent"><file href="long.txt"/></resource>
</resources></manifest>`;
const rz=new JSZip();rz.file('imsmanifest.xml',regressionManifest);rz.file('large.xml',bank(Array.from({length:260},(_,i)=>item(i)).join('')));rz.file('a.xml',bank(item('shared')));rz.file('b.xml',bank(item('shared')));
rz.file('draws.xml','<questestinterop><assessment>'+['first','second'].map(n=>`<section ident="${n}"><selection_ordering><selection><selection_number>2</selection_number></selection></selection_ordering>${[1,2,3].map(i=>item(n+i)).join('')}</section>`).join('')+'</assessment></questestinterop>');
rz.file('long.txt','Long source text '.repeat(1300));
const rr=await scan({name:'regressions.imscc',mimeType:'application/zip',buffer:await rz.generateAsync({type:'nodebuffer'})});const ev=rr.sourceEvidence.resources;
assert.equal(rr.sourceHierarchy[0].title,'Module 1');assert.equal(rr.sourceHierarchy[0].children[0].title,'Week 1');assert.equal(rr.courseTree[0].title,'Week 1','Comparison keeps the existing single-wrapper projection while honoring the chosen organization');
assert.equal(ev.large.structuredAssessment.questionCount,250);assert.equal(ev.large.structuredAssessment.declaredQuestionCount,260);assert.equal(ev.large.structuredAssessment.captureCompleteness.questionCoverageComplete,false);assert(rr.warnings.some(w=>w.includes('incomplete question capture')));
assert.equal(ev.parent.structuredAssessment.questionCount,2);assert.equal(ev.sibling.structuredAssessment.questionCount,1);assert.equal(ev.bankA.structuredAssessment.questionCount,1);assert.equal(ev.bankB.structuredAssessment.questionCount,1);
assert.deepEqual(ev.draws.structuredAssessment.selectionPolicy.rawSelectionCounts,[2,2]);assert.equal(ev.draws.structuredAssessment.selectionPolicy.selectCount,4);
assert.equal(ev.external.files[0].presentInPackage,null);assert(!rr.warnings.some(w=>w.includes('not resolved in the archive')));assert.equal(ev.long.evidenceTruncated,true);
await page.getByLabel('Find an item').fill('Large quiz');const rootSummary=page.locator('.package-items > li > details > summary');await rootSummary.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.package-items > li > details').getAttribute('open'),null);await page.keyboard.press('Enter');await page.getByText('Week 1',{exact:true}).waitFor();
await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('.source-tree').scrollIntoViewIfNeeded();assert(await page.locator('.source-tree .badge').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),'Type badges wrap inside mobile tree entries');await page.screenshot({path:'/tmp/cti-tree-mobile.png'});await page.setViewportSize({width:1440,height:1080});await page.screenshot({path:'/tmp/cti-tree-desktop.png'});
const orphan=new JSZip();orphan.file('imsmanifest.xml','<manifest><organizations/><resources><resource identifier="orphan" type="imsqti_xmlv1p2"/></resources></manifest>');orphan.file('candidate.xml',bank(item('only')));orphan.file('unread.xml',' '.repeat(2500001));
const or=await scan({name:'orphan-limit.imscc',mimeType:'application/zip',buffer:await orphan.generateAsync({type:'nodebuffer'})});assert.equal(or.sourceEvidence.qtiDiagnostics.orphanSearchIncomplete,true);assert.deepEqual(or.sourceEvidence.qtiDiagnostics.unresolvedQtiResources,['orphan']);
async function rejectedManifest(xml,message){await page.locator('#package-file').setInputFiles({name:'invalid.xml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'Inspect package',exact:false}).click();await page.getByRole('alert').waitFor();assert((await page.getByRole('alert').innerText()).includes(message));}
await rejectedManifest('<manifest><organizations default="missing"><organization identifier="different"/></organizations><resources/></manifest>','default organization');
await rejectedManifest('<manifest><resources><resource identifier="same"/><resource identifier="same"/></resources></manifest>','identifiers');
let real=null;
let trde=null;
if(process.env.CTI_TRDE120_FIXTURE){trde=await scan(process.env.CTI_TRDE120_FIXTURE);const flatten=n=>n.flatMap(x=>[x,...flatten(x.children||[])]);assert.equal(flatten(trde.sourceHierarchy).length,261);assert(flatten(trde.sourceHierarchy).some(n=>n.title.includes('Module 1')&&n.children.length));fs.writeFileSync('/tmp/cti-trde120-rescan.json',JSON.stringify(trde));}
if(process.env.CTI_CITC923_FIXTURE){real=await scan(process.env.CTI_CITC923_FIXTURE);assert.equal(real.stats.totalResources,29);assert.equal(real.stats.assignments,3);assert.equal(real.stats.discussions,2);assert.equal(real.stats.weblinks,6);}
await page.locator('#package-file').setInputFiles({name:'broken.xml',mimeType:'application/xml',buffer:Buffer.from('<manifest><broken>')});await page.getByRole('button',{name:'Inspect package',exact:false}).click();await page.getByRole('alert').waitFor();assert(await page.getByRole('button',{name:'Inspect package',exact:false}).isEnabled());
const xml=await scan({name:'manifest.xml',mimeType:'application/xml',buffer:Buffer.from(manifest)});assert.equal(xml.sourceEvidence.manifestOnly,true);assert(xml.warnings.some(w=>w.includes('Manifest only')));assert.equal(xml.stats.fingerprintedFiles,0);
await page.locator('#package-file').setInputFiles({name:'cancel.imscc',mimeType:'application/zip',buffer:fixture});await page.getByRole('button',{name:'Inspect package',exact:false}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('iframe').count(),0);await page.getByText('Cancelled',{exact:true}).waitFor();
await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith('http://127.0.0.1:4173/')));
console.log(JSON.stringify({status:'PASS',checks:['450 MiB native source package accepted with exact hash and no whole-archive allocation','original trde130.imscc filename and size retained','large media presence and bounded-inspection gap stay separate from reading text','nested manifest hierarchy and default organization','large QTI banks retain expected vs captured counts','shared banks do not mutate dependencies','independent repeated selection draws','external reference uncertainty','bounded incomplete orphan recovery','text truncation markers','duplicate resource identifiers rejected','keyboard disclosure and mobile tree','root manifest wins over nested runtime','QTI distinct question identity','reading text and SHA256','PDF text and parser identity','assignment dependency PDF propagation','search/expand/download','malformed XML recovery','manifest-only uncertainty','cancel removes job','390px viewport','no external requests'],privateTRDE120:trde?{hierarchyEntries:261,resources:trde.stats.totalResources,warnings:trde.warnings}: 'NOT_RUN',privateCITC923:real ? {resources:real.stats.totalResources,files:real.stats.fingerprintedFiles,warnings:real.warnings.length}: 'NOT_RUN',pageErrors:errors},null,2));
}finally{if(sparseDirectory)fs.rmSync(sparseDirectory,{recursive:true,force:true});await browser.close();server.close();}
