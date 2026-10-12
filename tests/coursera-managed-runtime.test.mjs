import test from 'node:test';
import assert from 'node:assert/strict';
import {getCourseraManagedRuntime} from '../src/domain/coursera-managed-runtime.ts';

const courseId='Managed_runtime_fixture_123';
const courseUrl='https://www.coursera.org/teach/synthetic/'+courseId+'/content/edit';
const token='managed_runtime_token_123';

function fixture(t){
 let clock=1000000,sequence=0;const listeners=new Set(),timers=new Map();
 t.mock.method(Date,'now',()=>clock);
 const host={
  addEventListener:(name,listener)=>{if(name==='message')listeners.add(listener);},
  removeEventListener:(name,listener)=>{if(name==='message')listeners.delete(listener);},
  setInterval:listener=>{const id=++sequence;timers.set(id,listener);return id;},
  clearInterval:id=>timers.delete(id),
 };
 function makeChild(){
  const navigations=[],acks=[];
  const child={closed:false,closeCalls:0,location:{set href(value){navigations.push(value);}},
   close(){this.closeCalls++;this.closed=true;},postMessage:(value,origin)=>acks.push({value,origin})};
  return {child,navigations,acks};
 }
 const current=makeChild(),runtime=getCourseraManagedRuntime(host);
 const send=(data={},source=current.child,origin='https://www.coursera.org')=>{
  const event={origin,source,data:{kind:'CTI_LOCAL_CAPTURE_STATUS_V1',courseId,token,event:'HEARTBEAT',...data}};
  for(const listener of [...listeners])listener(event);
 };
 const tick=ms=>{clock+=ms;for(const listener of [...timers.values()])listener();};
 return {host,runtime,...current,makeChild,send,tick,listeners,timers};
}

test('unmounting a subscriber preserves the live run and a remount restores its command and progress',t=>{
 const f=fixture(t),first=[];const unsubscribe=f.runtime.subscribe(snapshot=>first.push(snapshot));
 f.runtime.start(f.child,courseUrl,token);f.runtime.setCommand('registered capture command');
 f.send({event:'READY'});f.send({event:'PROGRESS',itemId:'quiz',savedQuestions:79});
 assert.equal(f.acks.length,1);assert.equal(first.at(-1).status.savedQuestions,79);
 const before=first.length;unsubscribe();
 assert.equal(f.listeners.size,1);assert.equal(f.timers.size,1);assert.equal(f.child.closed,false);
 f.tick(45001);assert.deepEqual(f.navigations,[courseUrl]);
 assert.equal(first.length,before,'Unmounted UI must stop receiving receipts');
 const second=[],same=getCourseraManagedRuntime(f.host);
 assert.equal(same,f.runtime);same.subscribe(snapshot=>second.push(snapshot));
 assert.equal(second[0].command,'registered capture command');assert.equal(second[0].child,f.child);
 assert.equal(second[0].status.state,'RECOVERING');assert.equal(second[0].status.savedQuestions,79);
 f.send({event:'READY'});assert.equal(f.acks.length,2);assert.equal(f.acks.at(-1).value.recoveries,1);
 f.send({event:'HEARTBEAT'});f.send({event:'PROGRESS',itemId:'quiz',savedQuestions:80});
 assert.equal(second.at(-1).status.state,'RUNNING');assert.equal(second.at(-1).status.savedQuestions,80);
 f.runtime.stop();
});

test('each browser window owns an independent runtime',t=>{
 const a=fixture(t),b=fixture(t);assert.notEqual(a.runtime,b.runtime);
 a.runtime.start(a.child,courseUrl,token);b.runtime.start(b.child,courseUrl,token);
 a.runtime.setCommand('window A command');b.runtime.setCommand('window B command');
 a.send({event:'READY'});b.send({event:'READY'});a.runtime.stop();
 assert.equal(a.child.closed,true);assert.equal(b.child.closed,false);
 assert.equal(b.runtime.snapshot().command,'window B command');assert.equal(b.runtime.snapshot().status.state,'RUNNING');
 assert.equal(b.listeners.size,1);assert.equal(b.timers.size,1);b.runtime.stop();
});

test('explicit stop closes the child and cancels supervision while retaining saved progress',t=>{
 const f=fixture(t),statuses=[];f.runtime.subscribe(snapshot=>statuses.push(snapshot));
 f.runtime.start(f.child,courseUrl,token);f.runtime.setCommand('active command');
 f.send({event:'READY'});f.send({event:'PROGRESS',itemId:'quiz',savedQuestions:79});
 f.runtime.stop();const stopped=f.runtime.snapshot();
 assert.equal(stopped.child,null);assert.equal(stopped.manager,null);assert.equal(stopped.command,'');
 assert.equal(stopped.status.state,'STOPPED');assert.equal(stopped.status.savedQuestions,79);
 assert.match(stopped.status.message,/checkpoints remain/);assert.equal(f.child.closeCalls,1);
 assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
 const receiptCount=statuses.length;f.send({event:'READY'});f.tick(100000);
 assert.equal(statuses.length,receiptCount);assert.equal(f.navigations.length,0);
});

test('replacement disposes the prior manager and ignores its old child receipts',t=>{
 const f=fixture(t);f.runtime.start(f.child,courseUrl,token);f.send({event:'READY'});
 f.runtime.setCommand('old command');const prior=f.runtime.snapshot().manager,replacement=f.makeChild();
 const nextToken='replacement_runtime_token_456';f.runtime.start(replacement.child,courseUrl,nextToken);
 assert.notEqual(f.runtime.snapshot().manager,prior);assert.equal(f.runtime.snapshot().command,'');
 assert.equal(f.listeners.size,1);assert.equal(f.timers.size,1);
 f.send({event:'PROGRESS',itemId:'old-quiz',savedQuestions:100});
 assert.equal(f.runtime.snapshot().status.savedQuestions,0);
 f.send({event:'READY',token:nextToken},replacement.child);assert.equal(replacement.acks.length,1);
 assert.equal(f.runtime.snapshot().status.state,'RUNNING');f.runtime.stop();
});

test('observer exceptions and mutated UI snapshots do not break acknowledgements or stored status',t=>{
 const f=fixture(t);f.runtime.subscribe(()=>{throw Error('synthetic UI failure');});
 f.runtime.start(f.child,courseUrl,token);f.send({event:'READY'});
 assert.equal(f.acks.length,1);const snapshot=f.runtime.snapshot();snapshot.status.savedQuestions=1000;
 assert.equal(f.runtime.snapshot().status.savedQuestions,0);
 f.send({event:'PROGRESS',itemId:'quiz',savedQuestions:5});
 assert.equal(f.runtime.snapshot().status.savedQuestions,5);f.runtime.stop();
});
