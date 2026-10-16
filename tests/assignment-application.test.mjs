import test from 'node:test';import assert from 'node:assert/strict';
import { externalApplicationNeedsCapture } from '../src/domain/assignment-evidence.ts';
const change={kind:'operations',packageId:'course',updatedAt:'2026-10-16T08:00:00Z',data:{type:'assignment-deliverable',event:'external-application-recorded',createdAt:'2026-10-15T01:00:00Z'}};
const audit=time=>({kind:'audit',data:{result:{stats:{extractorMeta:{capturedAt:time}}}}});
test('recorded external application needs a later capture, not a later comparison of old bytes',()=>{
 for(const time of ['', 'invalid','2026-10-16T07:00:00Z','2026-10-16T08:00:00Z'])assert.equal(externalApplicationNeedsCapture('course',audit(time),[change]),true);
 assert.equal(externalApplicationNeedsCapture('course',audit('2026-10-16T08:00:01Z'),[change]),false);
});
test('another course and structural draft do not declare this LMS changed',()=>{
 assert.equal(externalApplicationNeedsCapture('another',null,[change]),false);
 assert.equal(externalApplicationNeedsCapture('course',null,[{...change,data:{...change.data,event:'approved'}}]),false);
});
