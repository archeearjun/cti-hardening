import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceTrace} from '../src/diagnostics/performance.js';
import {createDirectDataReaderV1} from '../src/extractors/coursera/direct-data-network.js';
import {enablePerformance,performanceTrace} from '../src/diagnostics/runtime.ts';
import {hashSourcePackageFile} from '../src/domain/source-package-file.ts';
import {inspectSourceBinary} from '../src/domain/source-asset-recovery.ts';
import fs from 'node:fs';
const sanitize=data=>({data,removedFields:0,redactedUrls:0,limitReached:false});
const reply=url=>new Response(JSON.stringify({elements:[{id:decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1))}]}),{headers:{'content-type':'application/json'}});
test('disabled diagnostics do not read the clock, mutate return values, or export traces',()=>{
 const d=createPerformanceTrace({clock:()=>{throw Error('disabled clock accessed');}}),value={unchanged:true};
 assert.equal(d.measure('scan',()=>value),value);d.begin('scan')();d.count('requests');d.finish();assert.equal(d.snapshot(),null);
});
test('overlap is unioned, partial intervals retained, and no unsupported CPU attribution',()=>{
 let now=0;const d=createPerformanceTrace({enabled:true,clock:()=>now});const a=d.begin('request');now=2;const b=d.begin('request');now=5;a();now=8;b();
 const ongoing=d.begin('item',3);now=10;let report=d.snapshot();assert.equal(report.stages[0].activeWallMs,8);assert.equal(report.stages[0].summedSpanMs,11);
 assert.equal(report.measurementStatus,'partial');assert.equal(report.cpuMs,null);assert.equal(report.spans.at(-1).outcome,'partial');ongoing('failed');d.finish();report=d.snapshot();assert.equal(report.counts.items_verified,undefined);assert.equal(report.measurementStatus,'complete');
});
test('fixed vocabulary and bounded trace never serialize URLs, content, errors or duplicate keys',()=>{
 const d=createPerformanceTrace({enabled:true});d.begin('https://secret.invalid/?token=private')();d.count('answer-secret');d.repeated('https://secret.invalid/?token=private');d.repeated('https://secret.invalid/?token=private');
 assert.throws(()=>d.measure('item',()=>{throw Error('private answer');}));for(let i=0;i<4100;i++)d.begin('request',i)();d.finish();const r=d.snapshot();assert(r.droppedSpans>0);assert.equal(r.measurementStatus,'partial');assert.equal(r.counts.repeated_reads,1);assert(!/secret|private answer/.test(JSON.stringify(r)));
});
test('real request boundary reports 429 backoff separately; successful transport is not verified content',async()=>{
 const d=createPerformanceTrace({enabled:true});let calls=0;
 const reader=createDirectDataReaderV1({performanceDiagnostic:d,sanitize,fetchImpl:async url=>++calls===1?new Response(null,{status:429,headers:{'retry-after':'0'}}):reply(url)});
 assert.equal((await reader.readAtom('safe-atom')).ok,true);d.finish();const r=d.snapshot();assert.equal(calls,2);assert.equal(r.counts.requests,2);assert.equal(r.counts.retries,1);assert.equal(r.counts.rate_limited,1);assert(r.stages.find(s=>s.stage==='backoff').activeWallMs>=450);assert.equal(r.counts.items_verified,undefined);assert(!JSON.stringify(r).includes('safe-atom'));
});
test('authentication and 503 failures preserve existing stop/retry contracts without secret traces',async()=>{
 for(const status of [401,403,503]){const d=createPerformanceTrace({enabled:true});const reader=createDirectDataReaderV1({performanceDiagnostic:d,sanitize,fetchImpl:async()=>new Response('private auth body',{status})});const result=await reader.readAtom('private-id');assert.equal(result.ok,false);const r=d.snapshot();assert.equal(r.counts.requests,status===503?2:1);assert.equal(r.counts[status===503?'unavailable':'authentication_failed'],status===503?2:1);assert(!JSON.stringify(r).includes('private'));}
});
test('aborted request leaves useful partial run and never adds captured items',async()=>{
 const d=createPerformanceTrace({enabled:true});const reader=createDirectDataReaderV1({performanceDiagnostic:d,sanitize,fetchImpl:async(_u,o)=>new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(Error('private token'))))});const pending=reader.readAtom('atom');await new Promise(r=>setTimeout(r,5));reader.abort('OPERATOR_STOPPED');assert.equal((await pending).ok,false);d.finish('partial');assert.equal(d.snapshot().measurementStatus,'partial');assert.equal(d.snapshot().counts.items_verified,undefined);
});
test('real package hash and original binary inspection return identical evidence with diagnostics enabled',async()=>{
 const bytes=fs.readFileSync(new URL('./fixtures/source-assets/publisher-original.png',import.meta.url));const file=new File([bytes],'original.imscc');enablePerformance(false);const before=[await hashSourcePackageFile(file),inspectSourceBinary(bytes)];enablePerformance(true);const after=[await hashSourcePackageFile(file),inspectSourceBinary(bytes)];assert.deepEqual(after,before);const r=performanceTrace().snapshot();assert(r.stages.some(s=>s.stage==='package_hash'));assert(r.stages.some(s=>s.stage==='binary_verify'));enablePerformance(false);
});
test('enabled comparison preserves every item verdict, evidence hash, and owner report',async()=>{
 const {createWorkflows}=await import('../src/domain/workflows.ts');const {workerXml}=await import('../src/adapters/worker-xml.ts');const {comparisonFixture}=await import('./workflow-fixtures.mjs');
 const workflow=createWorkflows(workerXml);enablePerformance(false);const before=workflow.compare(comparisonFixture());enablePerformance(true);const after=workflow.compare(comparisonFixture());
 assert.deepEqual(after.result.itemResults,before.result.itemResults);assert.deepEqual(after.hashes,before.hashes);assert.equal(after.report,before.report);assert(!JSON.stringify(after).includes('CTI_PERFORMANCE_DIAGNOSTICS'));
 const r=performanceTrace().snapshot();for(const stage of ['comparison','normalization','matching','item_parity','owner_report'])assert(r.stages.some(s=>s.stage===stage),stage);enablePerformance(false);
});
