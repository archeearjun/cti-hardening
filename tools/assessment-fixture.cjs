// Deterministic DOM simulation. Production discovery, hydration, question parsing,
// identity merging and coverage logic execute unchanged; time and DOM are local.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const source=require('./check.cjs').ctiCanonicalCourseraExtractorSource_();
const starts=[...source.matchAll(/^  (?:async )?function (\w+)\(/gm)];
function functionCode(name){const i=starts.findIndex(m=>m[1]===name);assert(i>=0,name);return source.slice(starts[i].index,starts[i+1].index);}
function matches(el,selector){
 if(el.nodeType!==1)return false;
 return selector.split(/,(?![^\[]*\])/).some(part=>{
  part=part.trim();if(!part)return false;
  const tag=part.match(/^[\w*-]+/);if(tag&&tag[0]!=='*'&&el.tagName.toLowerCase()!==tag[0].toLowerCase())return false;
  for(const m of part.matchAll(/\.([\w-]+)/g))if(!String(el.getAttribute('class')||'').split(/\s+/).includes(m[1]))return false;
  for(const m of part.matchAll(/\[([^\s\]=^*$]+)\s*(?:(\^=|\*=|\$=|=)\s*["']?([^\]"']*)["']?)?\]/g)){
   const val=el.getAttribute(m[1]);if(val===null)return false;const want=(m[3]||'').trim();
   if(m[2]==='='&&val!==want)return false;if(m[2]==='^='&&!val.startsWith(want))return false;if(m[2]==='*='&&!val.includes(want))return false;if(m[2]==='$='&&!val.endsWith(want))return false;
  }
  return true;
 });
}
class TextNode{constructor(text){this.nodeType=3;this.nodeValue=text;this.parentElement=null;}get textContent(){return this.nodeValue;}cloneNode(){return new TextNode(this.nodeValue);}}
class El{
 constructor(tag,attrs={},text=''){this.nodeType=1;this.tagName=tag.toUpperCase();this.attrs={...attrs};this.childNodes=[];this.parentElement=null;this.clientHeight=100;this.scrollHeight=100;this.style={display:'block',visibility:'visible',opacity:'1',overflowY:'visible'};this._scrollTop=0;if(text)this.append(new TextNode(text));}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.childNodes.push(n);}}
 get children(){return this.childNodes.filter(x=>x.nodeType===1);}get id(){return this.attrs.id||'';}
 get innerText(){return this.isConnected?this.childNodes.map(x=>x.innerText??x.textContent).join('\n'):this.textContent;}get textContent(){return this.childNodes.map(x=>x.textContent).join('');}
 set textContent(v){this.replaceChildren(new TextNode(v));}
 get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));}
 get isConnected(){let p=this;while(p.parentElement)p=p.parentElement;return p.documentRoot===true;}
 get scrollTop(){return this._scrollTop;}set scrollTop(v){this._scrollTop=Math.max(0,Math.min(v,this.scrollHeight-this.clientHeight));if(this.onScroll)this.onScroll(this._scrollTop);}
 getAttribute(k){return this.attrs[k]===undefined?null:String(this.attrs[k]);}setAttribute(k,v){this.attrs[k]=String(v);}
 getBoundingClientRect(){return {width:400,height:this.clientHeight,x:0,y:0,top:0,bottom:this.clientHeight};}
 querySelectorAll(s){const result=[];const walk=p=>{for(const c of p.children){if(matches(c,s))result.push(c);walk(c);}};walk(this);return result;}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 closest(s){for(let p=this;p;p=p.parentElement)if(matches(p,s))return p;return null;}
 contains(el){for(let p=el;p;p=p.parentElement)if(p===this)return true;return false;}
 click(){if(this.onClick)this.onClick();}dispatchEvent(e){if(e.type==='scroll'&&this.onScroll)this.onScroll(this.scrollTop);return true;}
 replaceChildren(...nodes){for(const c of this.childNodes)c.parentElement=null;this.childNodes=[];this.append(...nodes);}
 remove(){if(this.parentElement){const p=this.parentElement;p.childNodes=p.childNodes.filter(n=>n!==this);this.parentElement=null;}}
 cloneNode(deep){const e=new El(this.tagName,this.attrs);if(deep)e.append(...this.childNodes.map(x=>x.cloneNode(true)));return e;}
}
function fixture({count=79,windowSize=27,mode='virtual',delay=0,missing=[],unanswered=[],duplicates=false,numericPrompts=false,feedbackMode='',writtenMode='',budget=300000}={}){
 let now=0,page=0,loaded=windowSize,mutations=0,clicks=0;const scheduled=[];
 const html=new El('html');html.documentRoot=true;const body=new El('body');html.append(body);const envelope=new El('div');body.append(envelope);
 const sidebar=new El('div',{'data-testid':'item-layout-left-sidebar'}),content=new El('div',{'data-testid':'item-layout-content'});envelope.append(sidebar,content);
 sidebar.clientHeight=320;sidebar.scrollHeight=count*32;sidebar.style.overflowY=mode==='paginated'?'visible':'auto';
 content.clientHeight=400;content.scrollHeight=count*100;content.style.overflowY=mode==='body-lazy'?'auto':'visible';
 const document={body,documentElement:html,scrollingElement:html,contains:el=>html.contains(el),getElementById:id=>[html,...html.querySelectorAll('*')].find(n=>n.id===id)||null,querySelectorAll:s=>html.querySelectorAll(s),querySelector:s=>html.querySelector(s)};
 const fp={id:'assessment-under-test',type:'Assignment',name:'Fixture assessment'};
 const prompt=n=>numericPrompts?`${n*10} seedlings were planted in this scenario; how many survived?`:duplicates&&n===28?'Which result is correct for scenario 27 in this assessment?':`Which result is correct for scenario ${n} in this assessment?`;
 function card(n,answerReady=true){
  const card=new El('section',{id:'assessment~q'+n,'data-testid':'assignment-part-'+(n-1)});
  if(writtenMode==='all' || (writtenMode==='mixed' && n>2)){card.append(new El('h3',{},n+'AI-Graded Rich Text Test Question'),new El('p',{},'Prompt *'),new El('p',{},answerReady?prompt(n):''));if(answerReady)card.append(new El('p',{},'AI Grader Instructions (Not shown to learners)'),new El('p',{},'Enter instructions for AI graders...'),new El('p',{},'Show academic integrity options'));return card;}
  card.append(new El('h3',{},n+'Auto-Graded 1 point'),new El('p',{},'Question Type Multiple Choice Prompt'),new El('p',{},prompt(n)),new El('p',{},'Options'));
  if(answerReady)for(const [label,status] of [[`Correct choice ${n}`,unanswered.includes(n)?'Incorrect':'Correct'],[`Wrong choice ${n}`,'Incorrect']]){
   if(feedbackMode && (n===55 || n===56))continue;
   const option=new El('div',{'data-testid':'option'});option.append(new El('p',{},label),new El('span',{},status));card.append(option);
  }
  if(answerReady && feedbackMode && (n===55 || n===56)) {
   const choices=['A','B','C','A and B','A, B, or C'],correct=n===55?3:2;
   choices.forEach((label,i)=>{
    const status=i===correct?'Correct':'Incorrect',option=new El('div',{'data-testid':'option'});
    if(feedbackMode==='joined')option.append(new El('p',{},label+status+'.'));
    else if(feedbackMode==='gradefeedback') {const field=new El('div',{'data-testid':i===correct?'GradeFeedback-success':'GradeFeedback-failure'});field.append(new El('div',{'data-testid':'GradeFeedback-caption'},status),new El('div',{},status+'.'));option.append(new El('p',{},label),field);}
    else {const value=new El('div');value.append(new El('span',{},label),new El('span',{'data-testid':'option-feedback'},status+'.'));option.append(value);}
    option.append(new El('span',{},status));card.append(option);
   });
  }
  card.append(new El('p',{},'Incorrect Answers: Explanation'),new El('p',{},`Explanation for scenario ${n}.`),new El('p',{},'Export Settings'));return card;
 }
 function open(n){clicks++;content.replaceChildren(card(n,!delay));if(delay)scheduled.push({at:now+delay,fn:()=>{if(content.querySelector('[data-testid="assignment-part-'+(n-1)+'"]'))content.replaceChildren(card(n,true));}});}
 function render(start){
  const max=mode==='lazy'||mode==='body-lazy'?Math.min(count,loaded):Math.min(count,start+windowSize);
  const rows=[new El('p',{},`Assignment outline Learning objectives Content (${count})`)];
  for(let n=(mode==='lazy'||mode==='body-lazy'?1:start+1);n<=max;n++){
   if(missing.includes(n))continue;
   const row=new El('div',{'data-testid':'assignment-outline','data-rbd-drag-handle-draggable-id':'q'+n});
   const anchor=new El('a',{href:'#assessment~q'+n},prompt(n).slice(0,47));anchor.onClick=()=>open(n);row.append(new El('span',{},String(n)),anchor);rows.push(row);
  }
  if(mode==='paginated'&&max<count){const more=new El('button',{},'Next page');more.onClick=()=>{page++;render(page*windowSize);};rows.push(more);}
  const dangerous=new El('button',{'data-test':'next-item'},'Next');dangerous.onClick=()=>mutations++;rows.push(dangerous);
  const save=new El('button',{},'Save');save.onClick=()=>mutations++;rows.push(save);
  sidebar.replaceChildren(...rows);
 }
 if(mode==='virtual')sidebar.onScroll=y=>render(Math.min(Math.floor(y/32),Math.max(0,count-windowSize)));
 if(mode==='lazy') {sidebar.scrollHeight=loaded*32;sidebar.onScroll=y=>{if(y>=sidebar.scrollHeight-sidebar.clientHeight-1&&loaded<count){loaded=Math.min(count,loaded+windowSize);sidebar.scrollHeight=loaded*32;render(0);}};}
 if(mode==='body-lazy') {sidebar.style.overflowY='visible';content.scrollHeight=loaded*100;content.onScroll=y=>{if(y>=content.scrollHeight-content.clientHeight-1&&loaded<count){loaded=Math.min(count,loaded+windowSize);content.scrollHeight=loaded*100;render(0);}};}
 render(0);content.append(card(1,!delay));
 const c={console,document,window:{innerHeight:700,scrollY:0,scrollTo(x,y){this.scrollY=y;}},Node:{TEXT_NODE:3,ELEMENT_NODE:1},Element:El,Event:class{constructor(type){this.type=type;}},getComputedStyle:e=>e.style,Date:{now:()=>now},MAX_TEXT_SAMPLE:24000};vm.createContext(c);
 const wanted=['hasVisibleLoadingIndicator','normalizeName','elementTextKey','elementAttributeBlob','isVisibleElement','isDangerousEditorControl','isGlobalChromeElement','isDocumentScrollRoot','scrollRootPosition','setScrollRootPosition','scrollRootMax','unique','uniqueAssetDetails','textEvidenceSourcePriority','mergeEvidence'];
 for(const name of wanted)vm.runInContext(functionCode(name),c);
 for(const name of ['scopedWaitBudgetV61321','isAssignmentTextBlockV61321','parseAssignmentTextBlockV61321','collectAssignmentTextBlocksV61321','assignmentTextBlockBodyV61321','assignmentBehaviorTextV61321','mergeCourseraLearnerText','assignmentOutlineLinksV61320', 'choiceControlVisibilityV61320', 'unmarkedChoiceProbeV61320', 'emptyAssessmentProbeV61320'])vm.runInContext(functionCode(name),c);
 for(const name of ['observedAssignmentLayoutV61319', 'choiceControlInVisiblePartV61319', 'choiceAncestryV61319'])vm.runInContext(functionCode(name),c);
 for(const name of ['exactReadingBodyV61318', 'mergeExactReadingEvidenceV61318', 'finalizeCapturedTextV61318', 'observedEmptyLayoutV61318', 'assessmentLayoutDiagnosticV61318', 'choiceDiagnosticsV61318', 'parseUnmarkedChoicesV61318', 'attachQuestionFailureEvidenceV61318', 'retryDecisionV61318'])vm.runInContext(functionCode(name),c);
 const begin=source.indexOf('  function assessmentTypeKey('),end=source.indexOf('  function ctiPlainTextV664(');vm.runInContext(source.slice(begin,end),c);
 for(const name of ['assessmentAnswerEvidenceCountV667','assessmentIsFullyAnswerHydratedV667','assessmentFromCycleMapV667','collectAssessmentSelectionPolicyFromText_','retryReasonsForDiagnostic','retrySeverity'])vm.runInContext(functionCode(name),c);
 for(const name of ['ctiPlainTextV664','reactFiberForElementV664','assessmentStateSeedsV664','findNamedValueV664','objectTextV664','parseQuestionStateV664','collectReactAssessmentStateV664','assessmentControlDiagnosticsV664','collectCourseraAssessmentByQuestionCycleV662','collectCourseraStructuredAssessment'])vm.runInContext(functionCode(name),c);
 c.sleepMs=async ms=>{now+=ms;for(const item of scheduled.splice(0)){if(item.at<=now)item.fn();else scheduled.push(item);}};
 c.reactSignalsForElement=()=>({text:'',propKeys:[],hasOnClick:false});
 return {c,fp,envelope,sidebar,content,now:()=>now,mutations:()=>mutations,clicks:()=>clicks,run:()=>c.collectAssessmentFromOutlineDomV665(envelope,fp,count,{deadline:budget}),runFull:()=>c.collectCourseraAssessmentByQuestionCycleV662(envelope,fp,{deadline:budget})};
}

module.exports={fixture,El,TextNode,functionCode};
