// Synthetic HTTPS origins; no real publisher requests or user cookies.
// Explicit Runtime.evaluate fallback validates execution, NOT bookmark activation.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createCourseraDirectDataCaptureBookmark} from '../src/domain/coursera-direct-data-capture.ts';
import {directPublisherFirstPartyPlanV1,directPublisherFirstPartyPlanHashV1} from '../src/extractors/coursera/direct-data-publisher-first-party.js';
const bookmark=createCourseraDirectDataCaptureBookmark(), source=decodeURIComponent(bookmark.slice(11));
const courseId='Publisher_fixture_123',nonce='a'.repeat(64),sessionId='b'.repeat(32);
const entries=[{itemId:'ReprH',atomId:'fixtureAtom',providerId:'fixtureProvider@1',targetUrl:'https://opentextbc.ca/mathfortrades2/?p=179/#main',imageUrl:'https://opentextbc.ca/mathfortrades2/wp-content/uploads/original.png',sourceSha256:'c'.repeat(64)}];
const plan=directPublisherFirstPartyPlanV1(courseId,entries),planSha256=await directPublisherFirstPartyPlanHashV1(plan);
const browser=await chromium.launch({headless:true,executablePath:process.env.CTI_CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const context=await browser.newContext();
 let imageRequests=0;
 await context.route('**/*',route=>{
  if(route.request().resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Recovery fixture</title><p id="original">Original publisher page</p>'});
  imageRequests++;return route.abort();
 });
 const parent=await context.newPage();await parent.goto('https://www.coursera.org/teach/fixture/'+courseId+'/content');
 await parent.evaluate(({courseId,nonce,sessionId,entries,planSha256})=>{
  window.received=[];window.connected=false;
  window.addEventListener('message',e=>{
   const m=e.data;
   if(e.origin!=='https://opentextbc.ca'||e.source!==window.publisher||m?.protocol!=='CTI_PUBLISHER_FIRST_PARTY_V1'||m.nonce!==nonce||m.sessionId!==sessionId||m.courseId!==courseId)return;
   window.received.push(m.type);
   if(m.type==='hello'){window.hello=true;e.source.postMessage({...m,type:'plan',entries,planSha256},e.origin)}
   if(m.type==='ready'&&window.hello&&m.planSha256===planSha256)window.connected=true;
  });
 },{courseId,nonce,sessionId,entries,planSha256});
 const popupPromise=parent.waitForEvent('popup');
 await parent.evaluate(url=>{window.publisher=window.open(url,'RecoveryFixture')},entries[0].targetUrl.split('#')[0]+'#cti-publisher-recovery=1&nonce='+nonce+'&session='+sessionId+'&courseId='+courseId);
 const publisher=await popupPromise;await publisher.waitForLoadState('domcontentloaded');
 const initialUrl=publisher.url(),errors=[];let crashed=false,closed=false;
 publisher.on('pageerror',e=>errors.push(e.message));publisher.on('crash',()=>crashed=true);publisher.on('close',()=>closed=true);
 assert.equal(await parent.evaluate(()=>window.connected),false);
 // Check the URL in Chromium, including literal brackets and encoded ?/#.
 assert.equal(await publisher.evaluate(url=>decodeURIComponent(new URL(url).pathname),bookmark),source);
 const cdp=await context.newCDPSession(publisher);
 const navigation=await cdp.send('Page.navigate',{url:bookmark,transitionType:'auto_bookmark'});
 let native=true;
 try{await publisher.waitForSelector('#cti-publisher-recovery-panel',{timeout:2000})}catch{
  assert.equal(closed,false);assert.equal(crashed,false);assert.equal(publisher.url(),initialUrl);
  native=false;
  if(process.env.CTI_PUBLISHER_EXECUTION_HARNESS!=='1')throw Error('Native bookmark did not execute; use CTI_PUBLISHER_EXECUTION_HARNESS=1 for explicitly non-native execution coverage. '+(navigation.errorText||''));
  await publisher.evaluate(source);
 }
 await parent.waitForFunction(()=>window.connected);
 assert.equal(await publisher.evaluate(()=>window.__CTI_PUBLISHER_FIRST_PARTY_CAPTURE__.snapshot().connected),true);
 assert.equal(publisher.url(),initialUrl);assert.equal(await publisher.locator('#original').count(),1);
 assert.deepEqual(errors,[]);assert.equal(closed,false);assert.equal(crashed,false);assert.equal(imageRequests,0);
 await publisher.locator('#cti-publisher-recovery-panel button').click();
 assert.equal(closed,false);assert.equal(publisher.url(),initialUrl);
 // Invalid context remains on the publisher and shows an actionable panel.
 await publisher.evaluate(()=>{location.hash=''});await publisher.evaluate(source);
 await publisher.waitForFunction(()=>document.querySelector('#cti-publisher-recovery-panel')?.textContent.includes('INVALID_RECOVERY_URL'));
 assert.equal(closed,false);assert.equal(crashed,false);
 console.log(JSON.stringify({nativeBookmarkExecution:native,executionHarness:!native,handshakeVerified:true,originalDocumentPreserved:true,windowClosed:false,windowCrashed:false,imageBytesRecovered:0,pageErrors:errors}));
} finally {await browser.close()}
