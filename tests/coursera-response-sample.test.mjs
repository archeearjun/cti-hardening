import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createCourseraResponseSampleScript} from '../src/domain/coursera-response-sample.ts';

const shell='https://www.coursera.org/teach/synthetic/Sample_fixture_123/content/edit';
test('response samples require the exact secure Coursera authoring origin and a course identity',()=>{
 for(const url of ['https://coursera.org/teach/synthetic/Sample_fixture_123/content/edit',
  'http://www.coursera.org/teach/synthetic/Sample_fixture_123/content/edit',
  'https://www.coursera.org:8443/teach/synthetic/Sample_fixture_123/content/edit',
  'https://user:password@www.coursera.org/teach/synthetic/Sample_fixture_123/content/edit',
  'https://www.coursera.org/learn/synthetic','https://www.coursera.org/teach/synthetic/short/content/edit'])
  assert.throws(()=>createCourseraResponseSampleScript(url));
 const source=createCourseraResponseSampleScript(shell+'?token=not-retained');
 assert(!source.includes('not-retained'));assert(source.startsWith('void (function'));
 assert.doesNotThrow(()=>new vm.Script(source));
});
test('a passive sample cannot install in another course or in a subframe',()=>{
 const source=createCourseraResponseSampleScript(shell);
 for(const [path,subframe] of [['/teach/synthetic/Another_course_123/content/edit',false],
  ['/teach/synthetic/Sample_fixture_123/content/edit',true]]){
  const window={};window.top=subframe?{}:window;
  assert.throws(()=>vm.runInNewContext(source,{window,location:{origin:'https://www.coursera.org',pathname:path}}),/selected Coursera authoring course/);
  assert.equal(window.__CTI_COURSERA_RESPONSE_SAMPLE,undefined);
 }
});
