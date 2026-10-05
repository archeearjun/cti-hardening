import { isVisibleElement } from "./text-and-dom-3.js";

export function parseCourseraTimeEstimate(text) {
  const s=String(text==null?'':text).replace(/\s+/g,' ').replace(/^Time estimate\s*:?\s*/i,'').trim();
  const m=s.match(/^(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*)?(?:(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m))?$/i);
  if(!m || (!m[1] && !m[2]))return null;
  const n=Number(m[1]||0)*60+Number(m[2]||0);
  return Number.isFinite(n) && n>=0 && n<=1000000?n:null;
}

/** Read-only, exact editor root only. Never parse arbitrary lesson prose or
 * treat an unlabeled number, question time limit, blank or null as minutes. */
export function collectCourseraTimeEstimate(root) {
  if(!root)return {};
  const values=[];
  const add=value=>{if(value!==null && !values.includes(value))values.push(value);};
  const labelPattern=/^Time estimate(?:\s*\(?\s*(?:minutes?|mins?|hours?|hrs?)\s*\)?)?\s*:?$/i;
  for(const control of root.querySelectorAll('input,select')) {
    if(!isVisibleElement(control) || control.closest('[contenteditable="true"],[data-testid^="assignment-part-"]'))continue;
    const labels=[control.getAttribute('aria-label')||'',...[...(control.labels||[])].filter(l=>root.contains(l)).map(l=>l.textContent||'')];
    for(const id of String(control.getAttribute('aria-labelledby')||'').split(/\s+/)) {
      const label=control.ownerDocument.getElementById(id);
      if(label && root.contains(label))labels.push(label.textContent||'');
    }
    const label=labels.map(s=>s.replace(/\s+/g,' ').trim()).find(s=>labelPattern.test(s));
    if(!label)continue;
    const value=String(control.value||'').trim();
    if(!value)continue;
    const unit=label.match(/\b(minutes?|mins?|hours?|hrs?)\b/i);
    add(parseCourseraTimeEstimate(unit && /^\d+(?:\.\d+)?$/.test(value)?value+' '+unit[1]:value));
    // Unit suffixes commonly live beside a number input. Require a compact,
    // exact setting row containing this one control and a stated unit.
    let row=control.parentElement;
    for(let depth=0;row && root.contains(row) && depth<3;depth++,row=row.parentElement) {
      if(row.querySelectorAll('input,select').length!==1)break;
      let t=String(row.innerText||row.textContent||'').replace(/\s+/g,' ').trim();
      if(t.length>180)break;
      if(/^Time estimate\s*:?\s*(?:minutes?|mins?|hours?|hrs?)$/i.test(t))t=t.replace(/(minutes?|mins?|hours?|hrs?)$/i,' '+value+' $1');
      if(/^Time estimate\b/i.test(t))add(parseCourseraTimeEstimate(t));
    }
  }
  // Some authoring settings use a visible caption without a native label.
  // Still require the exact caption, one local control and an explicit unit.
  for(const label of root.querySelectorAll('label,span,div,p')) {
    if(!isVisibleElement(label) || label.closest('[contenteditable="true"],[data-testid^="assignment-part-"]'))continue;
    const caption=String(label.innerText||label.textContent||'').replace(/\s+/g,' ').trim();
    if(!labelPattern.test(caption))continue;
    let row=label.parentElement;
    for(let depth=0;row && root.contains(row) && depth<3;depth++,row=row.parentElement) {
      const controls=[...row.querySelectorAll('input,select')];
      if(controls.length>1)break;
      let t=String(row.innerText||row.textContent||'').replace(/\s+/g,' ').trim();
      if(t.length>180)break;
      if(controls.length===1) {
        const value=String(controls[0].value||'').trim();
        if(!isVisibleElement(controls[0]) || !/^\d+(?:\.\d+)?$/.test(value))continue;
        if(/^Time estimate\s*:?\s*(?:minutes?|mins?|hours?|hrs?)$/i.test(t))t=t.replace(/(minutes?|mins?|hours?|hrs?)$/i,' '+value+' $1');
        const unit=caption.match(/\b(minutes?|mins?|hours?|hrs?)\b/i);
        if(unit)add(parseCourseraTimeEstimate(value+' '+unit[1]));
      }
      if(/^Time estimate\b/i.test(t))add(parseCourseraTimeEstimate(t));
    }
  }
  if(values.length>1)return {timeEstimateMinutes:null,timeEstimateState:'CONFLICT',timeEstimateEvidence:'Conflicting labeled editor time estimates'};
  return values.length===1?{timeEstimateMinutes:values[0],timeEstimateState:'OBSERVED',timeEstimateEvidence:'labeled-editor-time-estimate'}:{};
}

export function collectOutlineTimeEstimate(root, itemName) {
  if(!root)return {};
  const values=[];
  for(const el of root.querySelectorAll('span,time,[aria-label]')) {
    if(!isVisibleElement(el) || el.children.length || el.closest('[contenteditable="true"]'))continue;
    const text=String(el.getAttribute('aria-label')||el.innerText||el.textContent||'').trim();
    if(text.length>80 || text.toLowerCase()===String(itemName||'').trim().toLowerCase())continue;
    const n=parseCourseraTimeEstimate(text);
    if(n!==null && !values.includes(n))values.push(n);
  }
  return values.length===1?{timeEstimateMinutes:values[0],timeEstimateEvidence:'outline-row',timeEstimateState:'OBSERVED'}:{};
}
