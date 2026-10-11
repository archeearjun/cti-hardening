export function assessmentBrowserFixture(count = 100, initiallyHidden = false) {
  return `<!doctype html><meta charset="utf-8"><style>
 #editor{position:relative;${initiallyHidden ? 'display:none' : ''}}#rail{width:350px;height:320px;overflow-y:auto}#rows{height:${count * 32}px;position:relative}
 [data-testid=assignment-outline]{position:absolute;height:32px;width:340px}#content{margin-left:380px;min-height:600px}
</style><button id="open-assessment">Open assessment</button><main id="editor"><aside id="rail" data-testid="item-layout-left-sidebar"><p>Assignment outline Content (${count})</p><div id="rows"></div></aside><div id="content" data-testid="item-layout-content"></div></main>
<script>
 const rail=document.getElementById('rail'),rows=document.getElementById('rows'),content=document.getElementById('content');
 const prompt=n=>'Which result is correct for scenario '+n+' in this assessment?';
 function open(n,record=true){
  if(record){const visits=JSON.parse(localStorage.getItem('fixture-question-visits') || '[]');visits.push(n);localStorage.setItem('fixture-question-visits',JSON.stringify(visits));}
  content.innerHTML='<section id="assessment~q'+n+'" data-testid="assignment-part-'+(n-1)+'"><h3>'+n+'Auto-Graded 1 point</h3><p>Question Type Multiple Choice Prompt</p><p>'+prompt(n)+'</p><p>Options</p><div data-testid="option"><p>Correct choice café '+n+'</p><span>Correct</span></div><div data-testid="option"><p>Other choice 日本語 '+n+'</p><span>Incorrect</span></div><p>Incorrect Answers: Explanation</p><p>Explanation '+n+'.</p><p>Export Settings</p></section>';
 }
 function render(){
  const first=Math.min(${Math.max(0, count - 10)},Math.max(0,Math.floor(rail.scrollTop/32)));
  rows.replaceChildren();
  for(let i=first;i<Math.min(${count},first+10);i++){
   const row=document.createElement('div');row.dataset.testid='assignment-outline';row.style.top=(i*32)+'px';row.setAttribute('data-rbd-drag-handle-draggable-id','q'+(i+1));
   const number=document.createElement('span');number.textContent=(i+1)+' ';
   const anchor=document.createElement('a');anchor.href='#assessment~q'+(i+1);anchor.textContent=prompt(i+1).slice(0,47);anchor.onclick=event=>{event.preventDefault();open(i+1)};
   row.append(number,anchor);rows.append(row);
  }
 }
 rail.addEventListener('scroll',render);render();open(1,false);
 document.getElementById('open-assessment').onclick=()=>document.getElementById('editor').style.display='block';
</script>`;
}
