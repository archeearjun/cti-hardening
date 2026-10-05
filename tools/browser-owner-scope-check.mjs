import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { comparisonFixture } from '../tests/workflow-fixtures.mjs';
import { createWorkflows } from '../src/domain/workflows.ts';
import { workerXml } from '../src/adapters/worker-xml.ts';
import { buildOwnerTasks } from '../src/domain/owner-actions.ts';

export async function checkOwnerScope(page, tab, shots) {
  page.setDefaultTimeout(20000);
  const openCard=async card=>{if(await card.getAttribute("open")===null)await card.locator(":scope > summary").click();};
  const input=comparisonFixture();
  input.course.title='Scope and duration fixture';
  const raw=JSON.parse(new TextDecoder().decode(input.json.bytes));
  raw.extractedAt='2026-10-01T10:00:00Z';
  raw.fingerprints.forEach(f=>f.path='Module 1 > Lesson 1');
  raw.fingerprints[0].payload.timeEstimateMinutes=10;
  raw.fingerprints[1].payload.timeEstimateMinutes=15;
  input.json.bytes=new TextEncoder().encode(JSON.stringify(raw));
  const output=createWorkflows(workerXml).compare(input);
  // Additional owner-view rows exercise reference folders independently of
  // matching decisions. Original source/audit evidence remains unchanged.
  output.result.ownerView.items.push(
    {id:'archive-only',name:'Old instructor guide',type:'Reading',path:'Archive > Legacy lesson',status:'REVIEW',actions:[{severity:'REVIEW',action:'Original diagnostic retained'}]},
    {id:'instructor-only',name:'Teaching notes',type:'Reading',path:'Instructor Resources > Guide',status:'REVIEW',actions:[{severity:'REVIEW',action:'Original diagnostic retained'}]},
  );
  const audit={...input.course,id:'scope-audit',kind:'audit',packageId:input.course.id,title:'Scope and time report',data:output};
  await page.setViewportSize({width:1440,height:1000});
  await tab('Setup');
  await page.getByLabel('Workspace migration or backup JSON').setInputFiles({name:'scope.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({kind:'CTI_BROWSER_WORKSPACE',schemaVersion:1,records:[input.course,audit]}))});
  await page.getByRole('button',{name:'Import prepared records',exact:true}).click();
  await page.getByText('Imported 2 records;',{exact:false}).waitFor();
  const open=async()=>{
    await page.getByRole('combobox',{name:'Selected source course',exact:true}).selectOption(input.course.id);
    await page.locator('.full-workspace .status').waitFor({state:'hidden'});
    await tab('History');await page.getByRole('button',{name:audit.title,exact:true}).click();
    await page.getByRole('heading',{name:'Coursera content view',exact:true}).waitFor();
  };
  await open();
  const all=()=>page.getByRole('button',{name:/^All items \(/});
  const excluded=()=>page.getByRole('button',{name:/^Excluded \/ reference only/});
  await all().click();
  assert.equal(await page.locator('.action-card').count(),2);
  assert.match(await excluded().innerText(),/2/);
  assert.equal(await page.locator('.owner-outline-group .owner-outline-group').count(),1,'lesson is nested under its module');
  const summary=page.locator('details').filter({has:page.locator(':scope > summary').filter({hasText:'Module time estimates for the content map'})});
  assert.match(await summary.innerText(),/25 min[\s\S]*25 min[\s\S]*2\/2 captured/);
  await page.getByRole('button',{name:'Copy module time totals',exact:true}).click();
  const text=await page.evaluate(()=>navigator.clipboard.readText());
  assert.match(text,/Module 1: baseline 25 min/);assert.doesNotMatch(text,/https?:\/\//);
  await excluded().click();
  assert.equal(await page.locator('.action-card').count(),2);
  const archive=page.locator('.action-card').filter({hasText:'Old instructor guide'});
  await openCard(archive);
  assert.equal(await archive.getByRole('heading',{name:'Your next action',exact:true}).count(),0);
  await archive.getByLabel('Relevance to publishing work').selectOption('relevant');
  await archive.getByRole('button',{name:'Save relevance',exact:true}).click();
  await page.getByRole('button',{name:'All items (3)',exact:true}).waitFor();
  assert.equal(await page.locator('.action-card').count(),3);
  await openCard(archive);
  await archive.getByLabel('Relevance to publishing work').selectOption('auto');
  await archive.getByRole('button',{name:'Save relevance',exact:true}).click();
  await page.getByRole('button',{name:'All items (2)',exact:true}).waitFor();
  await all().click();
  const reading=page.locator('.action-card').filter({has:page.locator(':scope > summary strong').filter({hasText:/^Reading$/})});
  await openCard(reading);
  await reading.getByLabel('Relevance to publishing work').selectOption('not_relevant');
  await reading.getByRole('button',{name:'Save relevance',exact:true}).click();
  await page.getByRole('button',{name:'All items (1)',exact:true}).waitFor();
  await page.reload();await open();await excluded().click();
  await openCard(reading);
  assert.equal(await reading.getByLabel('Relevance to publishing work').inputValue(),'not_relevant');
  await reading.getByLabel('Relevance to publishing work').selectOption('relevant');
  await reading.getByRole('button',{name:'Save relevance',exact:true}).click();
  await page.getByRole('button',{name:'All items (2)',exact:true}).waitFor();
  await openCard(reading);
  const task=buildOwnerTasks(output.result,input.course.data.scan.courseTree)[0];
  const capture={kind:'CTI_COURSERA_ITEM_CHECK',schemaVersion:1,notForCourseAudit:true,auditId:audit.id,itemId:task.id,courseId:'course',openedUrl:task.url,expectations:task.checks,finishedAt:'2026-10-05T12:00:00Z',editorObserved:true,payload:{timeEstimateMinutes:25,timeEstimateEvidence:'labeled-editor-time-estimate'}};
  await reading.getByText('Import the downloaded item-check JSON',{exact:true}).click();
  await reading.getByLabel('Upload this item’s check JSON',{exact:true}).setInputFiles({name:'fresh-time.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(capture))});
  await reading.getByText('Fresh item evidence saved. Review the observations below; no finding was automatically cleared.',{exact:true}).waitFor();
  await page.reload();await open();await all().click();
  assert.match(await summary.innerText(),/25 min[\s\S]*40 min[\s\S]*2\/2 captured · 1 refreshed/);
  await page.getByText('Module time estimates for the content map',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shots,'scope-time-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'nested checklist must not overflow mobile');
  await page.getByText('Module time estimates for the content map',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shots,'scope-time-mobile.png')});
  await page.locator('.owner-outline-group').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shots,'scope-tree-mobile.png')});
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download complete report',exact:true}).click();
  const report=fs.readFileSync(await(await download).path(),'utf8');
  assert.match(report,/baseline 25 min.*latest available 40 min/);
  assert.match(report,/Old instructor guide/);
  console.log('PASS: reference exclusion/restoration, per-item relevance survives reload, nested module/lesson layout, 25→40 min refreshed module total, exports, clipboard without item links, and 390px layout.');
}
