import test from 'node:test';
import assert from 'node:assert/strict';
import {startCourseraLocalSupervisor} from '../src/domain/coursera-local-supervisor.ts';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';
import {courseraSource} from '../src/generated/extractor-sources.js';

const shell='https://www.coursera.org/teach/synthetic/Supervisor_fixture_123/content/edit',token='supervisor_token_123';
function fixture(){
 let listener,tick,now=1000;const navigations=[],acks=[],statuses=[];
 const child={closed:false,location:{set href(value){navigations.push(value)}},postMessage:(value,origin)=>acks.push({value,origin})};
 const host={addEventListener:(name,fn)=>listener=fn,removeEventListener:()=>listener=null,setInterval:fn=>{tick=fn;return 1},clearInterval:()=>{tick=null}};
 const manager=startCourseraLocalSupervisor(host,child,shell,token,status=>statuses.push(status),{timeoutMs:100,intervalMs:10,now:()=>now});
 return {child,manager,navigations,acks,statuses,advance:ms=>{now+=ms;tick?.()},
  send:(data={},origin='https://www.coursera.org',source=child)=>listener?.({origin,source,data:{kind:'CTI_LOCAL_CAPTURE_STATUS_V1',courseId:'Supervisor_fixture_123',token,event:'HEARTBEAT',...data}})};
}
test('a supervisor waits for verified pairing and rejects unrelated windows, origins, tokens and courses',()=>{
 const f=fixture();f.advance(10000);assert.equal(f.navigations.length,0);
 for(const [data,origin,source] of [[{event:'READY',token:'different'},'https://www.coursera.org',f.child],
  [{event:'READY'},'https://evil.test',f.child],[{event:'READY'},'https://www.coursera.org',{}],
  [{event:'READY',courseId:'another-course'},'https://www.coursera.org',f.child]])f.send(data,origin,source);
 assert.equal(f.acks.length,0);f.advance(1000);assert.equal(f.navigations.length,0);
 f.send({event:'READY'});assert.equal(f.acks[0].value.recoveries,0);
 f.advance(101);assert.deepEqual(f.navigations,[shell]);assert.equal(f.manager.getStatus().state,'RECOVERING');
 f.send({event:'READY'});assert.equal(f.acks.at(-1).value.recoveries,1);
});
test('durable progress resets repeated-failure protection while repeated identical receipts do not',()=>{
 const f=fixture();f.send({event:'READY'});f.advance(101);f.send({event:'READY'});
 f.send({event:'PROGRESS',itemId:'quiz',savedQuestions:5});assert.equal(f.manager.getStatus().failuresWithoutProgress,0);
 f.advance(101);f.send({event:'PROGRESS',itemId:'quiz',savedQuestions:5});assert.equal(f.manager.getStatus().failuresWithoutProgress,1);
 f.advance(101);f.send({event:'READY'});f.advance(101);f.send({event:'READY'});f.advance(101);
 assert.equal(f.manager.getStatus().state,'STOPPED');assert.equal(f.navigations.length,4);
});
test('finished or explicitly failed runs stop navigation, and closed links are reported',()=>{
 for(const event of ['FINISHED','ERROR']){
  const f=fixture();f.send({event,complete:true});f.advance(10000);assert.equal(f.navigations.length,0);
  assert.equal(f.manager.getStatus().state,event==='FINISHED'?'FINISHED':'STOPPED');
 }
 const f=fixture();f.child.closed=true;f.advance(10);assert.equal(f.manager.getStatus().state,'STOPPED');
});

test('the retained registration pauses the controller outside the course without exporting authentication data',()=>{
 const f=fixture();f.send({event:'READY'});
 f.send({kind:'CTI_LOCAL_CAPTURE_OUTSIDE_COURSE_V1'},'https://login.example.test');
 assert.equal(f.manager.getStatus().state,'STOPPED');f.advance(10000);assert.equal(f.navigations.length,0);
});
test('managed commands require a precise secure controller origin while regular commands remain standalone',()=>{
 const managed=JSON.parse(createAutomaticLocalCourseraCommand(shell,courseraSource,token,undefined,{controllerOrigin:'https://cti-hardening.pages.dev'}));
 assert(managed.args.source.includes('"controllerOrigin":"https://cti-hardening.pages.dev"'));
 assert(!JSON.parse(createAutomaticLocalCourseraCommand(shell,courseraSource,token)).args.source.includes('"controllerOrigin":'));
 for(const origin of ['https://cti-hardening.pages.dev/path','http://untrusted.test','https://user:pass@cti-hardening.pages.dev'])
  assert.throws(()=>createAutomaticLocalCourseraCommand(shell,courseraSource,token,undefined,{controllerOrigin:origin}),/controller origin/);
});
