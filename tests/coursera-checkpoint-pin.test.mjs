import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointSessionIdV6150} from '../src/extractors/coursera/completion.js';

test('a pinned ordinary namespace survives TTL without resetting its creation time',()=>{
 const previous=globalThis.localStorage;
 const saved={id:'run-1729000000000-existing',createdAt:Date.now()-13*60*60*1000},writes=[];
 globalThis.localStorage={getItem:()=>JSON.stringify(saved),setItem:(key,value)=>writes.push(JSON.parse(value))};
 try{
  const session=checkpointSessionIdV6150('Fixture_course_123',saved.id);
  assert.equal(session.id,saved.id);assert(session.key);
  assert.deepEqual(writes,[saved]);
 }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});

test('pinning an unrelated ordinary namespace cannot replace the course checkpoint pointer',()=>{
 const previous=globalThis.localStorage,saved={id:'run-1729000000000-existing',createdAt:Date.now()};
 let writes=0;globalThis.localStorage={getItem:()=>JSON.stringify(saved),setItem:()=>writes++};
 try{
  const session=checkpointSessionIdV6150('Fixture_course_123','run-1729000000001-other');
  assert.equal(session.key,'');assert.match(session.id,/^volatile-/);assert.equal(writes,0);
 }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
