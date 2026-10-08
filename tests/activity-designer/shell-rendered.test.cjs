// DOM contract simulation. This does not certify browser layout/Range or Coursera.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../src/shell-capture.js');
const sandbox={URL,CourseShell:S};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/shell-rendered.js'),'utf8'),sandbox);const R=sandbox.CourseRendered;
const base='https://www.coursera.org/teach/course/b1/content';
const c={url:base+'/edit'},it={type:'ungradedAssignment',id:'q1'};
assert.equal(R.itemURL(c,it),base+'/item/project/q1');
assert.equal(R.itemURL(c,{type:'ungradedWidget',id:'w1'}),base+'/item/plugin/w1');
assert.equal(R.itemURL(c,{type:'unknown',id:'q1'}),null);
assert.equal(R.itemURL(c,it,['https://evil.example/teach/course/b1/content/item/quiz/q1',base+'/item/quiz/other',base+'/item/exam/q1?private=discard#discard']),base+'/item/exam/q1');
assert.equal(R.itemURL(c,it,[base.replace('/b1/','/b2/')+'/item/exam/q1']),base+'/item/project/q1');
class Element{
 constructor(tag,attrs={},children=[]){this.tagName=tag;this.attrs=attrs;this.childNodes=children.map(x=>typeof x==='string'?{nodeType:3,textContent:x}:x);this.nodeType=1;for(const x of this.childNodes)x.parentElement=this;this.type=attrs.type;}
 get textContent(){return this.childNodes.map(x=>x.textContent).join('');}
 getAttribute(k){return this.attrs[k]??null;}
 getClientRects(){for(let x=this;x;x=x.parentElement)if(x.attrs?.hidden!==undefined||x.attrs?.invisible)return [];return [{}];}
 matches(selector){return selector.split(',').some(s=>{const tag=s.match(/^[a-z0-9]+/i)?.[0];if(tag&&tag!==this.tagName)return false;for(const m of s.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g))if(!(m[1] in this.attrs)||(m[2]!==undefined&&this.attrs[m[1]]!==m[2]))return false;return true;});}
 closest(s){for(let x=this;x;x=x.parentElement)if(x.nodeType===1&&x.matches(s))return x;return null;}
 querySelectorAll(s){return descendants(this).filter(x=>x.nodeType===1&&x.matches(s));}
 get labels(){return this.ownerDocument.querySelectorAll('label').filter(x=>x===this.closest('label')||this.attrs.id&&x.attrs.for===this.attrs.id);}
}
const e=(...x)=>new Element(...x),descendants=x=>x.childNodes?.flatMap(n=>[n,...descendants(n)])||[];
function fixture(mode='labels'){
 const body=e('body',{},[
  e('nav',{},[e('h2',{},['Prompt']),'SECRET_NAV']),e('h1',{},['Quiz']),
  e('article',{},[e('h3',{},['1',e('span',{},['Auto-Graded']),e('span',{},['1 point'])]),e('h4',{},['Question Type']),'Multiple choice',e('h4',{},['Prompt']),
   e('p',{},['Which unit measures volume?',e('span',{hidden:''},['SECRET_HIDDEN']),e('span',{'data-testid':'feedback'},['SECRET_FEEDBACK']),e('img',{alt:'Diagram'},[])]),e('h4',{},['Options']),
   e('label',{},[e('input',{type:'radio',name:'mui-1',value:'SECRET_VALUE',checked:''}), 'Cubic metres',e('span',{'data-testid':'correct-indicator'},['Correct answer'])]),
   e('label',{},[e('input',{type:'radio',name:'mui-1',value:'SECRET_VALUE'}),'Metres']),e('h4',{},['Feedback']),'SECRET_KEY']),
  e('article',{},[e('h3',{},['2 Auto-Graded 2 points']),e('h4',{},['Prompt']),e('p',{},['Explain the measurement decision.']),e('h4',{},['Options']),
   e('input',{type:'radio',id:'a',name:'mui-2'}),e('label',{for:'a'},['Use stated dimensions.']),e('input',{type:'radio',id:'b',name:'mui-2'}),e('label',{for:'b'},['Guess.'])]),
  e('article',{},[e('h3',{},['3Auto-Graded1 point']),e('h4',{},['Prompt']),e('p',{hidden:''},['SECRET_PROMPT']),e('h4',{},['Options']),e('input',{type:'radio',name:'mui-3'}),e('input',{type:'radio',name:'mui-3'})]),
  e('h2',{},['Settings']),e('label',{},[e('input',{type:'checkbox',name:'time'}),'SECRET_SETTINGS']),e('textarea',{hidden:''},['SECRET_CHAT'])
 ]);
 if(mode==='rows'){
  const labels=body.querySelectorAll('label').filter(x=>x.querySelectorAll('input[type="radio"]').length===1);
  for(const label of labels){label.tagName='div';const input=label.childNodes[0],wrap=e('span',{},[e('span',{},[input])]);label.childNodes[0]=wrap;wrap.parentElement=label;}
  // A heading-styled option is content, not the end of the Options section.
  const label=labels[0],text=label.childNodes[1];const h=e('h5',{},[text.textContent]);h.parentElement=label;label.childNodes[1]=h;
 }
 if(mode==='unsafe'){
  const article=body.querySelectorAll('article')[0],labels=article.querySelectorAll('label'),row=e('div',{},[...labels.map(x=>x.childNodes[0]),'SECRET_CROSS_OPTION_TEXT']);
  article.childNodes=article.childNodes.filter(x=>!labels.includes(x));row.parentElement=article;article.childNodes.splice(article.childNodes.length-2,0,row);
 }
 let index=0;function number(x){x.start=index++;for(const ch of x.childNodes||[])number(ch);x.end=index++;}number(body);
 const doc={body,defaultView:{getComputedStyle:()=>({visibility:'visible'})},querySelectorAll:s=>body.querySelectorAll(s),getElementById:id=>descendants(body).find(x=>x.attrs?.id===id),
  createTreeWalker(root){const nodes=descendants(root).filter(x=>x.nodeType===3);let i=0;return {nextNode:()=>nodes[i++]||null};},
  createRange(){return {commonAncestorContainer:body,from:0,to:body.end,setStartAfter(x){this.from=x.end;},setEndBefore(x){this.to=x.start;},setEnd(x){this.to=x.end;},selectNodeContents(x){this.from=x.start;this.to=x.end;},intersectsNode(x){return x.end>this.from&&x.start<this.to;},comparePoint(x,offset){const p=offset===0?x.start:x.end;return p<this.from?-1:p>this.to?1:0;}};}};
 for(const x of [body,...descendants(body)])x.ownerDocument=doc;
 return doc;
}
const read=R.read(fixture());assert.equal(read.metrics.visible_question_headers,3);assert.equal(read.metrics.prompts_captured,2);assert.equal(read.metrics.options_captured,4);
assert.equal(read.metrics.completeness,'partial_unverified');assert(read.gaps.some(x=>x.includes('Question 3')));assert(read.gaps.some(x=>x.includes('figure')));
assert.equal(read.blocks[0].text,'Which unit measures volume?');assert.equal(read.blocks[1].text,'Cubic metres');assert.equal(read.blocks[2].text,'Metres');
assert(read.blocks.every(x=>x.kind==='assessment'));assert(!JSON.stringify(read).includes('SECRET_'));assert(!JSON.stringify(read).includes('Correct answer'));
assert.equal(read.metrics.choice_controls_seen,6);assert.equal(read.metrics.questions[0].option_associations.native_label,2);
const rows=R.read(fixture('rows'));assert.equal(rows.metrics.options_captured,4);assert.equal(rows.metrics.questions[0].option_associations.single_control_container,2);assert.equal(rows.blocks[1].text,'Cubic metres');assert(!JSON.stringify(rows).includes('SECRET_'));
const unsafe=R.read(fixture('unsafe'));assert.equal(unsafe.metrics.questions[0].options_captured,0);assert.equal(unsafe.metrics.questions[0].choice_controls_seen,2);assert(!JSON.stringify(unsafe).includes('SECRET_CROSS'));assert.equal(unsafe.metrics.questions[0].option_associations.unresolved,2);
const empty=fixture();empty.body.childNodes=[];assert.equal(R.read(empty).blocks.length,0);
console.log('PASS: route resolution, Prompt/Options association with native labels or bounded single-control rows, heading-styled options, ambiguous row rejection, structural counts, internal tagging and hidden/feedback/key/settings omission. Simulated DOM, not live/browser verification.');
