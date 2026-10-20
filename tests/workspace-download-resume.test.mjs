import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { teamStore } from '../src/domain/workspace-store.ts';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const size = 131072;
function fixture(t, parts = 3) {
  const prior = {fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, random: Math.random};
  const waits = [], calls = [], progress = [];
  globalThis.setTimeout = (fn, ms, ...args) => { waits.push(ms); return prior.setTimeout(fn, 0, ...args); };
  Math.random = () => 0.5;
  t.after(() => { Object.assign(globalThis, {fetch:prior.fetch, setTimeout:prior.setTimeout}); Math.random = prior.random; });
  const f = {calls, waits, progress, revision:'original', fault:async()=>null, active:0, peak:0};
  f.data = {text:'Exact original\r\nCML <text></text>', empty:'', padding:'x'.repeat((parts-1)*size)};
  f.bytes = Buffer.from(JSON.stringify(f.data));
  globalThis.fetch = async (path, init = {}) => {
    assert.equal(init.method || 'GET', 'GET', 'Downloads cannot create imports');
    if (path === '/api/session') return Response.json({email:'synthetic@example.test',role:'admin'});
    f.active++; f.peak = Math.max(f.peak, f.active);
    try {
      const u = new URL(path, 'https://cti.example.test');
      const match = /^\/api\/records\/([^/]+)(?:\/chunks\/(\d+))?$/.exec(u.pathname);
      assert(match);
      const id = match[1], part = match[2] === undefined ? null : Number(match[2]);
      calls.push({id,part,revision:u.searchParams.get('revision')});
      const faulty = await f.fault({id,part});
      if (faulty) return faulty;
      if (part === null) return Response.json({record:{id,kind:'audit',version:1,title:'Original'},revision:f.revision,parts:Math.ceil(f.bytes.length/size),sha256:sha(f.bytes)});
      assert.equal(u.searchParams.get('revision'), f.revision);
      return new Response(f.bytes.subarray(part*size,(part+1)*size), {headers:{'content-type':'application/octet-stream'}});
    } finally { f.active--; }
  };
  return f;
}
const busy = (retryAfter='1') => Response.json({error:'The workspace is processing other evidence. Retry this exact request after a moment.'}, {status:503,headers:{'retry-after':retryAfter,'cf-ray':'synthetic-BOM'}});

test('chunk 2/27 recovers after repeated busy responses without repeating chunk 1 or changing bytes', async t => {
  const f = fixture(t,27); let failures = 0;
  f.fault = async ({part}) => part === 1 && failures++ < 4 ? busy() : null;
  const store = await teamStore({onProgress:m=>f.progress.push(m)});
  assert.deepEqual((await store.get('record')).data,f.data);
  assert.equal(f.calls.filter(x=>x.part===0).length,1);
  assert.equal(f.calls.filter(x=>x.part===1).length,5);
  assert.deepEqual(f.waits,[1125,2250,4500,9000]);
  assert(f.progress.some(x=>/chunk 2\/27.*HTTP 503.*retry 5\/6/.test(x)));
  assert(f.progress.some(x=>/Verifying.*27 chunks/.test(x)));
});

test('exhausted retry budget retains completed chunks and explicit retry checks the same revision',async t=>{
  const f=fixture(t); f.fault=async({part})=>part===1?busy():null;
  const store=await teamStore({onProgress:m=>f.progress.push(m)});
  await assert.rejects(store.get('record'),e=>e.attempts===6 && /budget exhausted.*1\/3 chunks retained/.test(e.message) && /synthetic-BOM/.test(e.message));
  assert.equal(f.calls.filter(x=>x.part===1).length,6);
  f.fault=async()=>null;
  assert.deepEqual((await store.get('record')).data,f.data);
  assert.equal(f.calls.filter(x=>x.part===0).length,1);
  assert.equal(f.calls.filter(x=>x.part===null).length,2);
  assert(f.progress.some(x=>/Resuming.*chunk 2\/3/.test(x)));
});

test('Retry-After dates and seconds are honored; unaffordable delay stops without retrying early',async t=>{
  const f=fixture(t); let count=0;
  f.fault=async({part})=>part===1 && count++===0?busy('10'):null;
  const store=await teamStore(); await store.get('record'); assert.equal(f.waits[0],10000);
  count=0; const future=Date.now()+15000;
  f.fault=async({part})=>part===1 && count++===0?busy(new Date(future).toUTCString()):null;
  await store.get('record'); assert(f.waits[1]>=13000 && f.waits[1]<=15000);
  f.fault=async({part})=>part===1?busy('120'):null;
  const before=f.waits.length; await assert.rejects(store.get('record'),/wait 120 seconds/); assert.equal(f.waits.length,before);
});

test('interrupted stream is discarded and only that chunk is retried',async t=>{
  const f=fixture(t); let once=true;
  f.fault=async({part})=>{
    if(part!==1 || !once)return null; once=false; let pulled=false;
    return new Response(new ReadableStream({pull(c){if(!pulled){pulled=true;c.enqueue(new Uint8Array([99]));}else c.error(new TypeError('connection lost'));}}),{headers:{'content-type':'application/octet-stream'}});
  };
  assert.deepEqual((await (await teamStore()).get('record')).data,f.data);
  assert.equal(f.calls.filter(x=>x.part===0).length,1); assert.equal(f.calls.filter(x=>x.part===1).length,2);
});

test('Stop retains complete chunks, then recovery resumes; concurrent reads are serialized',async t=>{
  const f=fixture(t), store=await teamStore(), controller=new AbortController();
  f.fault=async({part})=>part===1?busy():null;
  await assert.rejects(store.get('record',{signal:controller.signal,onProgress:m=>{if(m.includes('retry'))controller.abort();}}),/stopped by you/);
  f.fault=async()=>{await new Promise(r=>setImmediate(r));return null;};
  const records=await Promise.all(Array.from({length:12},(_,i)=>store.get(i===0?'record':'other'+i)));
  assert(records.every(r=>JSON.stringify(r.data)===JSON.stringify(f.data)));
  assert.equal(f.peak,1); assert.equal(f.calls.filter(x=>x.id==='record' && x.part===0).length,1);
});

test('revision changes never mix retained bytes; checksum corruption discards partial state',async t=>{
  const f=fixture(t), store=await teamStore();
  f.fault=async({part})=>part===1?busy('120'):null;
  await assert.rejects(store.get('record'));
  f.revision='changed'; f.data.text='New exact revision'; f.bytes=Buffer.from(JSON.stringify(f.data)); f.fault=async()=>null;
  assert.deepEqual((await store.get('record')).data,f.data);
  assert.equal(f.calls.filter(x=>x.part===0).length,2);
  f.fault=async({part})=>part===1?new Response(new Uint8Array([1,2]),{headers:{'content-type':'application/octet-stream'}}):null;
  await assert.rejects(store.get('record'),/checksum failed/);
  f.fault=async()=>null; await store.get('record');
  assert.equal(f.calls.filter(x=>x.part===0).length,4,'Corrupt partial state must be re-read');
});

test('partial cache is bounded and isolated between authenticated store instances',async t=>{
  const f=fixture(t), store=await teamStore();
  f.fault=async({part})=>part===1?busy('120'):null;
  for(const id of ['old','keep','new']) await assert.rejects(store.get(id));
  const other=await teamStore(); f.fault=async()=>null;
  await other.get('keep'); await store.get('keep'); await store.get('old');
  assert.equal(f.calls.filter(x=>x.id==='keep' && x.part===0).length,2,'Other store cannot reuse partial bytes');
  assert.equal(f.calls.filter(x=>x.id==='old' && x.part===0).length,2,'Oldest partial record was evicted');
});
