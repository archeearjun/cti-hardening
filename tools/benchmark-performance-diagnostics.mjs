// Synthetic local workload: real package ZIP reads/hashes + original binary checks
// + bounded native-reader responses. No LMS requests or private course content.
import fs from 'node:fs';
import JSZip from 'jszip';
import {performance} from 'node:perf_hooks';
import {enablePerformance,performanceTrace} from '../src/diagnostics/runtime.ts';
import {hashSourcePackageFile} from '../src/domain/source-package-file.ts';
import {openSourcePackageZip} from '../src/adapters/source-package-zip.ts';
import {inspectSourceBinary} from '../src/domain/source-asset-recovery.ts';
import {createDirectDataReaderV1} from '../src/extractors/coursera/direct-data-network.js';
const z=new JSZip();for(let i=0;i<32;i++)z.file('content/'+i+'.html','<p>Synthetic instructional body</p>'.repeat(2048));
const file=new File([await z.generateAsync({type:'uint8array',compression:'DEFLATE'})],'synthetic.imscc');
const original=fs.readFileSync(new URL('../tests/fixtures/source-assets/publisher-original.png',import.meta.url));
async function workload(enabled){enablePerformance(enabled);const start=performance.now();await hashSourcePackageFile(file);const zip=await openSourcePackageZip(file);try{for(const e of Object.values(zip.files))if(!e.dir)await e.async('uint8array');}finally{await zip.close();}for(let i=0;i<100;i++)inspectSourceBinary(original);const reader=createDirectDataReaderV1({performanceDiagnostic:performanceTrace(),sanitize:data=>({data}),fetchImpl:async url=>new Response(JSON.stringify({elements:[{id:decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1))}]}),{headers:{'content-type':'application/json'}})});for(let i=0;i<100;i++)await reader.readAtom('synthetic-'+i);const elapsed=performance.now()-start;const exportStart=performance.now();const report=performanceTrace().snapshot();if(report)JSON.stringify(report);const exportMs=performance.now()-exportStart;return {elapsedMs:elapsed,exportMs,spans:report?.spans.length||0};}
await workload(false);await workload(true);const pairs=[];for(let i=0;i<11;i++){const order=i%2?[true,false]:[false,true],pair={};for(const enabled of order)pair[enabled?'enabled':'disabled']=await workload(enabled);pairs.push(pair);}
const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];const off=median(pairs.map(p=>p.disabled.elapsedMs)),on=median(pairs.map(p=>p.enabled.elapsedMs));
const result={kind:'CTI_DIAGNOSTIC_OVERHEAD_BENCHMARK',node:process.version,platform:process.platform,workload:{packageCompressedBytes:file.size,expandedFiles:32,expandedBytes:32*2048*Buffer.byteLength('<p>Synthetic instructional body</p>'),binaryChecks:100,nativeResponses:100,pairs:11},disabledMedianMs:off,enabledMedianMs:on,medianDifferenceMs:on-off,medianDifferencePercent:100*(on-off)/off,enabledExportMedianMs:median(pairs.map(p=>p.enabled.exportMs)),pairs,limitations:['Synthetic local workload, not live LMS or server CPU.','Alternating warm trials; scheduler/JIT noise remains.','Includes real hashing, ZIP validation/decompression, binary inspection and mocked native responses.']};console.log(JSON.stringify(result,null,2));
