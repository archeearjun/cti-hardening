// Synthetic DOM regression based on the supplied route/headings diagnostic.
// Real Chromium DOM/Range/layout behavior; no live Coursera request or login.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const root=path.join(__dirname,'..');
const base='https://www.coursera.org/teach/test/b1/content';
const quiz=`<!doctype html><title>Quiz | Test course | Coursera</title>
<style>.hidden{display:none}</style><nav><h2>Prompt</h2>UNRELATED_NAV</nav>
<h1>Quiz</h1><h2>Content</h2>
<article><h3>1<span>Auto-Graded</span><span>1 point</span></h3>
<h4>Question Type</h4><div>Multiple choice</div><h4>Prompt</h4>
<div><p>Which unit measures volume?</p><span class="hidden">SECRET_HIDDEN</span><img alt="A box diagram"><span data-testid="feedback">SECRET_FEEDBACK</span></div>
<h4>Options</h4><div role="radiogroup">
<label><input type="radio" name="mui-1" value="SECRET_VALUE_A" checked>Cubic metres<span data-testid="correct-indicator">Correct answer</span></label>
<label><input type="radio" name="mui-1" value="SECRET_VALUE_B">Metres<svg><title>SECRET_SVG</title></svg></label>
</div><h4>Feedback</h4><p>SECRET_KEY</p></article>
<article><h3>2 Auto-Graded 2 points</h3><h4>Question Type</h4><div>Multiple choice</div>
<h4>Prompt</h4><p>Explain the measurement decision.</p><h4>Options</h4>
<input id="o3" type="radio" name="mui-2" value="SECRET_VALUE_C"><label for="o3">Use the stated dimensions.</label>
<input id="o4" type="radio" name="mui-2" value="SECRET_VALUE_D"><label for="o4">Guess the dimensions.</label></article>
<article><h3>3Auto-Graded1 point</h3><h4>Question Type</h4><h4>Prompt</h4>
<div class="hidden">SECRET_HIDDEN_PROMPT</div><h4>Options</h4>
<input type="radio" name="mui-3"><input type="radio" name="mui-3"></article>
<h2>Settings</h2><label><input type="checkbox" name="time">SECRET_TIME_SETTINGS</label>
<input data-testid="read-only-value" value="SECRET_SETTINGS"><textarea hidden>SECRET_CHAT</textarea>
<button>Edit</button><button>Save</button><button>Publish</button>`;
const outline={elements:[{material:{elements:[{id:'m1',name:'Module',elements:[{id:'l1',name:'Lesson',elements:[
 {id:'i1',name:'Reading',content:{typeName:'supplement'}},
 {id:'i2',name:'Quiz',content:{typeName:'ungradedAssignment'}},
 {id:'i3',name:'Wrong redirect',content:{typeName:'ungradedAssignment'}}
]}]}]}}]};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CTI_CHROMIUM_PATH?{executablePath:process.env.CTI_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();let requests=[],clicks=[];
  await page.exposeFunction('recordClick',x=>clicks.push(x));
  await page.addInitScript(()=>{document.addEventListener('click',e=>window.recordClick(e.target.tagName));const old=setTimeout;window.setTimeout=(f,ms,...args)=>old(f,ms<2000?1:800,...args);});
  await page.route('**/*',async r=>{
   const u=new URL(r.request().url());requests.push({path:u.pathname,method:r.request().method()});
   if(u.pathname.startsWith('/api/authoringCourseMaterials.v1/'))return r.fulfill({contentType:'application/json',body:JSON.stringify(outline)});
   if(u.pathname.endsWith('/project/i3'))return r.fulfill({status:302,headers:{location:base+'/item/project/another-item'}});
   if(u.pathname.endsWith('/project/i2'))return r.fulfill({contentType:'text/html',body:quiz});
   if(u.pathname.endsWith('/supplement/i1'))return r.fulfill({contentType:'text/html',body:'<title>Reading | Test course | Coursera</title><section data-testid="b1+i1"><h1>Reading</h1><textarea aria-label="Content">A complete sentence about volume units.</textarea></section>'});
   return r.fulfill({contentType:'text/html',body:'<title>Edit Content | Test course | Coursera</title><h1>Outline</h1>'});
  });
  await page.goto(base+'/item/project/i2');
  await page.addScriptTag({path:path.join(root,'src/shell-capture.js')});
  await page.addScriptTag({path:path.join(root,'src/shell-rendered.js')});
  const read=await page.evaluate(()=>CourseRendered.read(document));
  assert.equal(read.metrics.visible_question_headers,3);assert.equal(read.metrics.prompts_captured,2);assert.equal(read.metrics.options_captured,4);
  assert.equal(read.metrics.completeness,'partial_unverified');assert(read.gaps.some(s=>s.includes('Question 3')));assert(read.gaps.some(s=>s.includes('figure')));
  assert(!JSON.stringify(read).includes('SECRET_'));assert(read.blocks.every(b=>b.kind==='assessment'));
  assert.deepEqual(read.blocks.slice(0,3).map(b=>b.text),['Which unit measures volume?','Cubic metres','Metres']);
  const urls=await page.evaluate(base=>{
   const c={url:base+'/edit'},i={id:'i2',type:'ungradedAssignment'};
   return [CourseRendered.itemURL(c,i),CourseRendered.itemURL(c,i,['https://evil.example/teach/test/b1/content/item/quiz/i2',base+'/item/exam/wrong',base+'/item/quiz/i2?secret=discard#also']),CourseRendered.itemURL(c,{id:'bad/id',type:'quiz'}),CourseRendered.itemURL(c,{id:'i2',type:'ungradedWidget'})];
  },base);
  assert.deepEqual(urls,[base+'/item/project/i2',base+'/item/quiz/i2',null,base+'/item/plugin/i2']);
  await page.evaluate(fs.readFileSync(path.join(root,'dist/downloads/Coursera_Activity_Test_One_Item.js'),'utf8'));
  let c=await page.evaluate(()=>CourseActivityCapture.data);
  assert.equal(c.capture_scope,'current_item');assert.equal(c.selected_item_id,'i2');assert.equal(c.course.title,'Test course');
  assert.equal(c.items[1].assessment_capture.prompts_captured,2);assert.equal(c.items[1].coverage,'partial');
  assert.equal(c.items[0].coverage,'unread');assert(c.items[0].notes.some(n=>n.includes('Not scanned')));
  assert(!JSON.stringify(c).includes('SECRET_'));assert.equal(await page.locator('iframe').count(),0);
  assert.deepEqual(clicks,[]);assert(requests.every(r=>r.method==='GET'));
  // Full scan uses the mapped project route in an iframe; wrong item redirects stay unread.
  requests=[];await page.goto(base+'/edit');
  await page.evaluate(fs.readFileSync(path.join(root,'dist/downloads/Coursera_Activity_Capture.js'),'utf8'));
  c=await page.evaluate(()=>CourseActivityCapture.data);
  assert.equal(c.status,'finished');assert.equal(c.items[1].type,'ungradedAssignment');assert.equal(c.items[1].route,base+'/item/project/i2');
  assert.equal(c.items[1].assessment_capture.options_captured,4);assert.equal(c.items[0].blocks.length,1);
  assert.equal(c.items[2].coverage,'unread');assert(c.items[2].notes.some(n=>n.includes('could not be loaded')));
  assert(requests.some(r=>r.path.endsWith('/project/i2')));assert(!requests.some(r=>r.path.includes('/ungradedAssignment/')));
  assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(clicks,[]);assert(requests.every(r=>r.method==='GET'));
  assert(!JSON.stringify(c).includes('SECRET_'));
  console.log('PASS: real Chromium synthetic layout, project routes, question/option association, protected/hidden/settings omission, partial coverage, one-item scope, full iframe scan and wrong-item redirect rejection. No live Coursera verification.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
