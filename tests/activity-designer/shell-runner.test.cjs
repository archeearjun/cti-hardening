// Browser-API simulation for the independent reader; not a live Coursera/CSP test.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/downloads/Coursera_Activity_Capture.js'),'utf8');
const material={elements:[{material:{elements:[{id:'m1',name:'Module',elements:[{id:'l1',name:'Lesson',elements:[{id:'i1',name:'Reading',content:{typeName:'supplement'}},{id:'i2',name:'Quiz',content:{typeName:'quiz'}},{id:'i3',name:'Unsupported',content:{typeName:'unknown'}},{id:'i4',name:'Slow PDF',content:{typeName:'supplement'}},{id:'i5',name:'Stuck PDF',content:{typeName:'supplement'}}]}]}]}}]};
class E{
 constructor(tag){this.tagName=tag;this.style={};this.children=[];this.attributes={};this.textContent='';this.value='';this.hidden=false;}
 append(...xs){xs.forEach(x=>{this.children.push(x);x.parentElement=this;});}
 attachShadow(){return this.shadow=new E('shadow');}
 getAttribute(k){return this.attributes[k]||null;}
 getClientRects(){return [{}];}
 contains(e){return this===e||this.children.some(x=>x.contains(e));}
 matches(){return this.tagName==='textarea';}
 querySelectorAll(){return this.children;}
 closest(){return null;}
 remove(){this.removed=true;}
 select(){}
 click(){this.onclick?.();}
}
function editorDoc(id){
 const root=new E('section');root.attributes['data-testid']='b1+'+id;const body=new E('textarea');body.attributes['aria-label']=id==='i2'?'Question prompt':'Content';body.value=id==='i2'?'Quiz prompt one.':'Complete captured lesson text.';
 if(id==='i4'||id==='i5'){let reads=0;Object.defineProperty(body,'value',{get(){reads++;return id==='i4'&&reads>12?'Actual late-loaded PDF teaching.':'\u200b\n/ 0\n100%\nLoading...';}});}
 const answer=new E('textarea');answer.attributes['aria-label']='Correct answer';answer.value='SECRET_KEY';root.append(body,answer);
 const buttons=[1,2].map(n=>{const e=new E('button');e.textContent='Question '+n;e.onclick=()=>{body.value=n===1?'Quiz prompt one.':'Quiz prompt two.';};return e;});
 return {body:new E('body'),querySelectorAll:q=>q==='[data-testid],[data-item-id]'?[root]:q.startsWith('textarea')?root.children:q.startsWith('button')&&id==='i2'?buttons:[],getElementById:()=>null};
}
const requests=[],created=[],blobs=[],timers=new Set();
const document={querySelectorAll:()=>[],title:'Edit Content | Test title | Coursera',body:new E('body'),createElement(tag){const el=new E(tag);created.push(el);if(tag==='iframe')Object.defineProperty(el,'src',{set(url){el.contentWindow={location:new URL(url),performance:{getEntriesByType:()=>[]}};el.contentDocument=editorDoc(new URL(url).pathname.split('/').at(-1));queueMicrotask(()=>el.onload?.());}});return el;}};
const BrowserURL=class extends URL{};BrowserURL.createObjectURL=b=>{blobs.push(b);return 'blob:mock-'+blobs.length;};BrowserURL.revokeObjectURL=()=>{};
const context={console,URL:BrowserURL,Blob,AbortController,document,location:new URL('https://www.coursera.org/teach/test/b1/content/edit'),navigator:{clipboard:{writeText:async()=>{}}},
 fetch:async(url,options)=>{requests.push({url,options});assert.equal(options.method,'GET');return {ok:true,status:200,text:async()=>JSON.stringify(material)};},
 setTimeout:(f,ms)=>{const h=setTimeout(f,ms<2000?0:1000);timers.add(h);return h;},clearTimeout,queueMicrotask};context.window=context;
(async()=>{try{await vm.runInNewContext(source,context);const c=context.CourseActivityCapture.data;assert.equal(c.status,'finished');assert.equal(c.items.length,5);assert.equal(c.items[0].blocks.length,1);assert(c.items[0].blocks[0].text.includes('lesson text'));assert(c.items[1].blocks.some(b=>b.text==='Quiz prompt two.'));assert(!JSON.stringify(c).includes('SECRET_KEY'));assert.equal(c.items[2].coverage,'unread');assert.equal(c.extractor_version,'1.2.1');assert(c.items[3].blocks.some(b=>b.text==='Actual late-loaded PDF teaching.'));assert.equal(c.items[4].blocks.length,0);assert.equal(c.items[4].coverage,'unread');assert(c.items[4].notes.some(n=>n.includes('Read diagnostics')));assert.equal(requests.length,1);assert.equal(context.CourseActivityCapture.running,false);assert(created.find(e=>e.tagName==='iframe').removed);const saved=JSON.parse(await blobs[0].text());assert.equal(saved.course.id,'b1');assert.equal(saved.items[0].id,'i1');const iframeCount=created.filter(e=>e.tagName==='iframe').length;context.location=new URL('https://www.coursera.org/teach/test/b1/content/item/project/i2');context.performance={getEntriesByType:()=>[]};document.querySelectorAll=editorDoc('i2').querySelectorAll;document.title='Quiz | Test title | Coursera';await vm.runInNewContext(source.replace("const captureScope='course';","const captureScope='current_item';"),context);const single=context.CourseActivityCapture.data;assert.equal(single.capture_scope,'current_item');assert.equal(single.selected_item_id,'i2');assert.equal(single.course.title,'Test title');assert(single.items[1].blocks.some(b=>b.text==='Quiz prompt two.'));assert.equal(single.items[0].coverage,'unread');assert(single.items[0].notes.some(n=>n.includes('Not scanned')));assert(single.issues.some(n=>n.includes('One-item test only')));assert.equal(created.filter(e=>e.tagName==='iframe').length,iframeCount);assert(created.some(e=>e.download?.startsWith('Course_Activity_One_Item_Test_')));console.log('PASS: current-item-only scope, unvisited coverage, no extra iframe, independent reader run, GET-only outline read, item frame cleanup, reading/quiz text, protected field omission, duplicate suppression, unread items and downloadable capture. Simulated APIs only.');}finally{for(const h of timers)clearTimeout(h);}})().catch(e=>{console.error(e);process.exitCode=1;});
