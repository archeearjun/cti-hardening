import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright';
import {bundleConsole} from './console-bundle.mjs';
import {extractorFunctions} from './extractor-functions.cjs';
import * as config from '../src/extractors/coursera/config.js';

// Native navigation helpers on synthetic pages: no acquisition substitutions,
// injected source IDs or private course content. A crash cause is not simulated.
const functions=extractorFunctions(bundleConsole(path.resolve('src/extractors/coursera/entry.js')));
const runtime=Object.entries(config).map(([name,value])=>`const ${name}=${JSON.stringify(value)};`).join('\n')+'\n'+[...functions.values()].join('\n');
const courseId='OutlineTargetFixture_123',url='https://www.coursera.org/teach/synthetic/'+courseId+'/content/edit';
const fixture=({virtual=false,noControls=false,wrongCourse=false,conflictingId=false,nested=false}={})=>`<!doctype html><style>
body{margin:0;font:16px Arial}main{height:430px;width:900px;overflow-y:auto}section{padding:12px;border:1px solid #ccc}section p{height:2px;margin:0;overflow:hidden}button,a{display:inline-block}#virtual{height:5760px;position:relative}#virtual section{position:absolute;height:94px;box-sizing:border-box;width:850px}
</style><main id="outline"><button id="expand-all" aria-expanded="false">Expand all</button><button id="danger" aria-expanded="false">Save module settings</button>${virtual?'<div id="virtual"></div>':''}</main><script>
window.metrics={opened:[],closed:[],maxOpen:0,open:0,all:0,unsafe:0,scrolls:0};
document.getElementById('expand-all').onclick=()=>metrics.all++;
document.getElementById('danger').onclick=()=>metrics.unsafe++;
function addModule(n,parent,top){
 const section=document.createElement('section');section.dataset.moduleId='module_'+n;if(top!=null)section.style.top=top+'px';
 const heading=document.createElement('h2');heading.textContent='Module '+n;
 const button=document.createElement('button');button.id='toggle_'+n;button.textContent=${JSON.stringify(noControls?'Expand':'Module ')}+${noControls?'""':'n'};button.setAttribute('aria-expanded','false');
 const content=document.createElement('div');content.id='contents_'+n;content.hidden=true;
 ${noControls?'':'button.setAttribute("aria-controls",content.id);'}
 button.onclick=()=>{const open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));content.hidden=!open;
  if(open){metrics.open++;metrics.maxOpen=Math.max(metrics.maxOpen,metrics.open);metrics.opened.push(n);content.innerHTML='<a data-item-id="${conflictingId?'Wrong_':'Quiz_'}'+n+'" href="/teach/synthetic/${wrongCourse?'OtherCourse_123':courseId}/content/item/project/Quiz_'+n+'">Same quiz title</a>'+Array.from({length:180},(_,i)=>'<p>Mounted synthetic row '+i+'</p>').join('');}
  if(open && n===7 && ${nested}){const markup=content.innerHTML;content.replaceChildren();const header=document.createElement('div'),lesson=document.createElement('button'),body=document.createElement('div');body.id='lesson-'+n;body.hidden=true;lesson.textContent='Lesson Blue';lesson.setAttribute('aria-expanded','false');lesson.setAttribute('aria-controls',body.id);lesson.onclick=()=>{const on=lesson.getAttribute('aria-expanded')!=='true';lesson.setAttribute('aria-expanded',String(on));body.hidden=!on;if(on){metrics.open++;metrics.maxOpen=Math.max(metrics.maxOpen,metrics.open);metrics.opened.push('lesson'+n);body.innerHTML=markup;}else{metrics.open--;metrics.closed.push('lesson'+n);body.replaceChildren();}};header.append(lesson);content.append(header,body);}
  if(!open){metrics.open--;metrics.closed.push(n);content.replaceChildren();}};
 section.append(heading,button,content);parent.append(section);
}
const root=document.getElementById('outline');
${virtual?`function render(){const host=document.getElementById('virtual');host.replaceChildren();const first=Math.max(1,Math.min(41,Math.floor(Math.max(0,root.scrollTop-50)/120)+1));for(let n=first;n<first+8;n++)addModule(n,host,(n-1)*120);}root.addEventListener('scroll',()=>{metrics.scrolls++;render()});render();`:'for(let n=1;n<=10;n++)addModule(n,root);root.addEventListener("scroll",()=>metrics.scrolls++);'}
</script>`;

const browser=await chromium.launch({headless:true,executablePath:process.env.CTI_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1100,height:800}});
let html=fixture();await context.route('https://www.coursera.org/**',route=>route.fulfill({contentType:'text/html',body:html}));
const page=await context.newPage();
async function run(fp,options={}){
 html=fixture(options);await page.goto(url);await page.addScriptTag({content:runtime});
 if(options.initialScroll)await page.evaluate(y=>document.getElementById('outline').scrollTop=y,options.initialScroll);
 const before=await page.evaluate(()=>({scroll:document.getElementById('outline').scrollTop,document:scrollY}));
 const result=await page.evaluate(async({fp,courseId})=>{const trace={deadline:Date.now()+25000};const hit=await findNavigationTargetForFingerprint(fp,courseId,trace);return {hit:hit&&{score:hit.score,route:hit.route,reason:hit.reason},trace,metrics,scroll:document.getElementById('outline').scrollTop,document:scrollY};},{fp,courseId});
 assert.equal(result.metrics.all,0,'Never click global Expand all');assert.equal(result.metrics.unsafe,0,'Never click a mutating disclosure-like control');
 return {before,...result};
}
try{
 const known=await run({id:'Quiz_7',name:'Same quiz title',path:'Synthetic Course > Module 7',ancestors:[]});
 assert(known.hit?.score>=0.995);assert.match(known.hit.route,/\/Quiz_7$/);assert.deepEqual(known.metrics.opened,[7]);assert.equal(known.metrics.maxOpen,1);
 const unknown=await run({id:'Quiz_7',name:'Same quiz title',path:''});
 assert.match(unknown.hit.route,/\/Quiz_7$/);assert.deepEqual(unknown.metrics.opened,[1,2,3,4,5,6,7]);assert.deepEqual(unknown.metrics.closed,[1,2,3,4,5,6]);assert.equal(unknown.metrics.maxOpen,1);
 const miss=await run({id:'Quiz_70',name:'Same quiz title',path:'Module 7'},{initialScroll:150});
 assert.equal(miss.hit,null,'Same title and an ID prefix do not certify a stale item');assert.deepEqual(miss.metrics.opened,[7]);assert.deepEqual(miss.metrics.closed,[7]);assert.equal(miss.metrics.open,0);assert.equal(miss.scroll,miss.before.scroll);assert.equal(miss.document,miss.before.document);
 const empty=await run({id:'Quiz_missing',name:'Same quiz title',path:''});assert.equal(empty.hit,null);assert.equal(empty.metrics.open,0);assert.equal(empty.metrics.maxOpen,1);assert.equal(empty.metrics.opened.length,10);assert.equal(empty.metrics.closed.length,10);
 const wrong=await run({id:'Quiz_7',name:'Same quiz title',path:'Module 7'},{wrongCourse:true});assert.equal(wrong.hit,null,'Another course route cannot be rescued by an exact data-item-id');
 const conflict=await run({id:'Quiz_7',name:'Same quiz title',path:'Module 7'},{conflictingId:true});assert.equal(conflict.hit,null,'Contradictory row ID and exact route fail closed');
 const sibling=await run({id:'Quiz_7',name:'Same quiz title',path:'Module 7'},{noControls:true});assert.match(sibling.hit.route,/\/Quiz_7$/);assert.deepEqual(sibling.metrics.opened,[7]);
 const nested=await run({id:'Quiz_7',name:'Same quiz title',path:'Synthetic Course > Module 7 > Lesson Blue'},{nested:true,noControls:true});assert.match(nested.hit.route,/\/Quiz_7$/);assert.deepEqual(nested.metrics.opened,[7,'lesson7']);assert.equal(nested.trace.maxSimultaneousNewBranches,2);
 const virtual=await run({id:'Quiz_44',name:'Same quiz title',path:'Module 44',ancestors:[{id:'module_44',title:'Module 44'}]},{virtual:true});
 assert.match(virtual.hit.route,/\/Quiz_44$/);assert.deepEqual(virtual.metrics.opened,[44]);assert.equal(virtual.metrics.maxOpen,1);assert(virtual.metrics.scrolls>0);assert(virtual.trace.viewportScanSteps>0);
 console.log(JSON.stringify({status:'PASS',cases:9,knownPathOpenings:known.metrics.opened,unknownPathMaxOpen:unknown.metrics.maxOpen,
  unknownPathOpenings:unknown.metrics.opened.length,lateVirtualOpenings:virtual.metrics.opened,lateVirtualScanSteps:virtual.trace.viewportScanSteps,
  scope:'Native target finder and disclosures: exact identity, known path, sequential unknown branches, miss cleanup, wrong-course rejection, controls-free headings, nested lesson, late virtual target. Does not reproduce a live Coursera renderer crash.'}));
}finally{await browser.close();}
