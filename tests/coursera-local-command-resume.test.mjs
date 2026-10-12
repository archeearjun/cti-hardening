import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAutomaticLocalCourseraCommand} from '../src/domain/coursera-local-extraction.ts';

const shell='https://www.coursera.org/teach/synthetic/Course_ResumeFixture123/content/edit';
const program='javascript:(async function ctiCourseraCaptureFixture(){window.observedConfig=window.__CTI_AUTOMATIC_LOCAL_CONFIG__;})();';
const token='fixture_resume_token_123';

function registeredConfig(options){
 const command=JSON.parse(createAutomaticLocalCourseraCommand(shell,program,token,undefined,options));
 assert.equal(command.cmd,'Page.addScriptToEvaluateOnNewDocument');
 assert.equal(command.args.runImmediately,true);
 const window={};window.top=window;
 new vm.Script(command.args.source).runInNewContext({window,location:new URL(shell)});
 return JSON.parse(JSON.stringify(window.observedConfig));
}

test('browser checkpoint resume is carried through the registered source for managed and standalone commands',()=>{
 for(const controllerOrigin of [undefined,'https://cti-hardening.pages.dev']){
  const config=registeredConfig({resumeExisting:true,...(controllerOrigin?{controllerOrigin}:{})});
  assert.equal(config.resumeExisting,true);
  assert.equal(config.courseId,'Course_ResumeFixture123');
  assert.equal(config.token,token);
  assert.equal(config.shellUrl,shell);
  assert.equal(config.controllerOrigin,controllerOrigin);
  assert(!Object.hasOwn(config,'freshRun'));
 }
});

test('ordinary and fresh commands keep their existing selection without an implicit resume request',()=>{
 const ordinary=registeredConfig({});
 assert(!Object.hasOwn(ordinary,'resumeExisting'));
 assert(!Object.hasOwn(ordinary,'freshRun'));
 const fresh=registeredConfig({freshRun:true});
 assert.equal(fresh.freshRun,true);
 assert(!Object.hasOwn(fresh,'resumeExisting'));
 const disabled=registeredConfig({resumeExisting:false});
 assert(!Object.hasOwn(disabled,'resumeExisting'));
});

test('browser checkpoint resume rejects fresh runs, imported captures and nonboolean choices',()=>{
 assert.throws(()=>createAutomaticLocalCourseraCommand(shell,program,token,undefined,{resumeExisting:true,freshRun:true}),/cannot start a fresh/);
 assert.throws(()=>createAutomaticLocalCourseraCommand(shell,program,token,{}, {resumeExisting:true}),/cannot import a saved/);
 for(const resumeExisting of ['true',1,null]){
  assert.throws(()=>createAutomaticLocalCourseraCommand(shell,program,token,undefined,{resumeExisting}),/Invalid browser checkpoint resume option/);
 }
});
