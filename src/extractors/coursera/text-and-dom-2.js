import { isAssessmentLikeFingerprintV662 } from "./assessments-2.js";
import { cleanAssignmentOptionFieldV6610 } from "./assessments-3.js";
import { assignmentOutlineLinksV61320, exactAssessmentBadgeElements } from "./assessments.js";
import { isCourseraUiAssetUrl, uniqueAssetDetails } from "./assets.js";
import { MAX_EXACT_READING_TEXT_V61318, MAX_TEXT_SAMPLE } from "./config.js";
import { scoreSurfaceForFingerprint } from "./evidence-2.js";
import { readingNetworkRecordsV61323 } from "./evidence.js";
import { isLikelyWholeOutlineSurface } from "./navigation-2.js";
import { authoringItemRouteV61311 } from "./navigation.js";
import { candidateSurfaceAncestors, isVisibleElement, ownStateValueV61313 } from "./text-and-dom-3.js";
import { isGlobalChromeElement } from "./text-and-dom-4.js";
import { courseId, normalizeName } from "./text-and-dom.js";

export function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

export async function waitForVisibleV6154(onPause) {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return 0;
  const started=Date.now();
  try {
    console.warn('CTI paused: keep the Coursera authoring tab visible while editor items are being inspected.');
    if (typeof onPause === 'function') onPause();
  } catch(_) {}
  await new Promise(resolve=>{
    const onVisibility=()=>{
      if(document.visibilityState==='visible'){
        document.removeEventListener('visibilitychange',onVisibility);
        resolve();
      }
    };
    document.addEventListener('visibilitychange',onVisibility,{passive:true});
  });
  return Date.now()-started;
}

export function readingLoadingOnlyV61312(root) {
    const text=String(root && (root.innerText || root.textContent) || '').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    return /^(?:(?:\d+\s*)?\/\s*\d+\s+\d{1,3}%\s*)?Loading(?:\.{0,3}|…)?$/i.test(text);
  }

export function exactReadingBodyV61318(root, fp) {
    if(!root || !fp || fp.typeName!=='supplement')return null;
    const cid=courseId(),surface=exactReadingEditorV61311(fp,cid);
    if(!surface || surface.root!==root)return null;
    const full=String(root.innerText || root.textContent || '').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const text=full.slice(0,MAX_EXACT_READING_TEXT_V61318);
    return {text,confidence:text?'high':'none',priority:98,scoped:true,
      completeness:text?0.97:0,scopeKind:'reading-content-field',
      fullObservedTextLength:full.length,textCaptureLimit:MAX_EXACT_READING_TEXT_V61318,
      textCaptureEvidence:{method:'EXACT_READING_FIELD',courseId:String(cid),itemId:String(fp.id),
        observedCharacters:full.length,capturedCharacters:text.length,limit:MAX_EXACT_READING_TEXT_V61318,
        truncated:full.length>MAX_EXACT_READING_TEXT_V61318,externalFrameTextIncluded:false}};
  }

export function choiceControlVisibilityV61320(control,part) {
    const out={accepted:false,reason:'OUTSIDE_PART',depth:0};
    if(!control || !part || !part.contains(control) || !control.isConnected || !isVisibleElement(part))return out;
    const native=String(control.tagName || '').toLowerCase()==='input' && /^(radio|checkbox)$/.test(control.getAttribute('type') || '');
    if(!native && !isVisibleElement(control)){out.reason='INVISIBLE_NON_NATIVE_CONTROL';return out;}
    // Walk the actual containing part, not a short guess about wrapper depth.
    // The native control alone may be transparent; its visible label is checked later.
    for(let node=control,depth=0;node && depth<128;node=node.parentElement,depth++) {
      out.depth=depth;
      try {
        const style=getComputedStyle(node);
        const hidden=node.getAttribute('hidden')!==null || node.getAttribute('aria-hidden')==='true';
        if(hidden || style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' ||
          (node!==control && Number(style.opacity || 1)===0)) {
          out.reason='HIDDEN_CONTAINER';out.blockedTag=node.tagName;out.blockedTestId=node.getAttribute('data-testid') || '';return out;
        }
      } catch(_){out.reason='STYLE_UNAVAILABLE';return out;}
      if(node===part){out.accepted=true;out.reason='VISIBLE_PART_CHAIN';return out;}
    }
    out.reason='PART_CHAIN_LIMIT';return out;
  }

export function unmarkedChoiceProbeV61320(part,fp,ordinal) {
    const out={status:'NOT_PARSED',reason:'NOT_ASSIGNMENT_PART',controls:[],question:null};
    if(!part || !isAssessmentLikeFingerprintV662(fp) || !/^assignment-part-\d+$/.test(part.getAttribute('data-testid') || ''))return out;
    if(exactAssessmentBadgeElements(part).length){out.reason='EXPLICIT_BADGE_PARSER_REQUIRED';return out;}
    const flat=String(part.innerText || part.textContent || '').replace(/\s+/g,' ').trim();
    const boundary=flat.match(/\bPrompt\s*\*\s*(.+?)\s+(Options|Answers)\s*\*\s+/i);
    if(!boundary || /\bCorrect Answers?\b/i.test(flat)){out.reason='CHOICE_FIELD_BOUNDARY_NOT_PROVEN';return out;}
    const selector='input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"],.cds-choiceInput-root,.cds-choiceinput-root';
    const controlType=el=>el.getAttribute('type') || el.getAttribute('role') ||
      (/\bcds-radioinput-/i.test(el.getAttribute('class') || '')?'radio':/\bcds-checkboxinput-/i.test(el.getAttribute('class') || '')?'checkbox':'');
    const candidates=[...part.querySelectorAll(selector)].filter(el=>/^(radio|checkbox)$/.test(controlType(el)));
    const leaves=candidates.filter(el=>!candidates.some(other=>other!==el && el.contains(other)));
    const controls=[];
    for(const el of leaves) {
      const visibility=choiceControlVisibilityV61320(el,part);
      out.controls.push({type:controlType(el),...visibility});
      if(visibility.accepted)controls.push(el);
    }
    if(controls.length<2 || controls.length>80){out.reason='CHOICE_CONTROL_COUNT';return out;}
    const rows=[],types=new Set();
    for(const control of controls) {
      const type=controlType(control);types.add(type);
      // These row markers are present in the live TRDE120 diagnostics. They bind
      // the text to one option without depending on the depth of decorative spans.
      let row=control.closest('.rc-AssignmentAuthoringOptionsEditor__optionRow');
      if(!row || !part.contains(row))row=null;
      if(!row)row=control.closest('[data-testid="option"]');
      if(row && (!part.contains(row) || controls.filter(c=>row.contains(c)).length!==1))row=null;
      let label='',method='OBSERVED_OPTION_ROW';
      if(row && isVisibleElement(row))label=cleanAssignmentOptionFieldV6610(String(row.innerText || row.textContent || ''));
      if(!row) {
        method='OBSERVED_CHOICE_CONTROL_ROW';
        for(let node=control,depth=0;node && node!==part && depth<128;node=node.parentElement,depth++) {
          if(controls.filter(c=>node===c || node.contains(c)).length!==1)break;
          const text=cleanAssignmentOptionFieldV6610(String(node.innerText || node.textContent || ''));
          if(text && text.length<=1200 && isVisibleElement(node) && !/\b(?:Prompt|Options|Answers)\s*\*|^(?:Correct|Incorrect)\.?$|\bfeedback\b/i.test(text)){label=text;row=node;break;}
        }
      }
      if(!row || !label || label.length>1200 || /\b(?:Prompt|Options|Answers)\s*\*|\bfeedback\b/i.test(label) || rows.some(o=>o.label===label)) {
        out.reason='OPTION_LABEL_BOUNDARY_NOT_PROVEN';return out;
      }
      rows.push({id:String(rows.length+1),label,text:label,correct:null,
        optionDomEvidence:{method,controlType:type,correctness:'NOT_OBSERVED'}});
    }
    if(types.size!==1){out.reason='MIXED_CHOICE_CONTROLS';return out;}
    const type=types.has('checkbox')?'multiple-select':'single-select';
    out.question={id:String(ordinal || 1),type,rawType:type,prompt:boundary[1].trim(),options:rows,
      correctAnswers:[],points:Number((flat.match(/\b([0-9]+(?:\.[0-9]+)?)\s*points?\b/i) || [])[1]) || null,
      optionTextReliable:true,answerTextReliable:false,parserConfidence:0.90,
      promptBoundaryEvidence:{method:'EXPLICIT_REQUIRED_FIELD',boundary:boundary[2]+' *'},
      responseTypeEvidence:{method:'OBSERVED_CHOICE_CONTROLS',controlType:[...types][0]},
      answerEvidenceStatus:'NOT_OBSERVED',_cycleOrdinal:Number(ordinal || 0)};
    out.status='CHOICES_CAPTURED';out.reason='VISIBLE_OPTIONS_WITHOUT_ANSWER_KEY';return out;
  }

export function choiceControlInVisiblePartV61319(control,part) {
    return choiceControlVisibilityV61320(control,part).accepted;
  }

export function choiceAncestryV61319(control,part) {
    if(!/^(?:INPUT|SPAN)$/.test(String(control.tagName || '')))return [];
    const result=[];
    for(let node=control,depth=0;node && node!==part && depth<12;node=node.parentElement,depth++) {
      let style={};try{const s=getComputedStyle(node);style={display:s.display,visibility:s.visibility,opacity:s.opacity};}catch(_){}
      result.push({tag:node.tagName,testId:node.getAttribute('data-testid') || '',
        className:String(node.getAttribute('class') || '').slice(0,200),visible:isVisibleElement(node),style,
        choiceInputs:node.querySelectorAll('input[type="radio"],input[type="checkbox"]').length,
        text:String(node.innerText || node.textContent || '').replace(/\s+/g,' ').trim().slice(0,800)});
    }
    return result;
  }

export function observedEmptyLayoutV61318(root) {
    if(!root || !root.isConnected || !isVisibleElement(root))return null;
    const marker=/Content you add will show in order here\.?/i;
    for(let node=root,depth=0;node && depth<10;node=node.parentElement,depth++) {
      if(node===document.body || node===document.documentElement)break;
      if(!node.isConnected || !isVisibleElement(node))continue;
      const leaves=[...node.querySelectorAll('h1,h2,h3,h4,p,span,div,[role="heading"]')].slice(0,1600);
      const headings=leaves.filter(el=>isVisibleElement(el) && /^Assignment outline$/i.test(String(el.innerText || el.textContent || '').trim()) &&
        ![...el.children].some(c=>/^Assignment outline$/i.test(String(c.innerText || c.textContent || '').trim())));
      if(headings.length!==1)continue;
      let rail=null;
      for(let parent=headings[0],d=0;parent && parent!==node && d<7;parent=parent.parentElement,d++){
        const text=String(parent.innerText || parent.textContent || '');
        if(marker.test(text) && !/Generate questions|Create AI[- ]graded question/i.test(text)){rail=parent;break;}
      }
      if(!rail || rail.contains(root))continue;
      const bodies=[root,...root.querySelectorAll('div,section,main,article')].filter(el=>{
        if(el===rail || el.contains(rail) || !isVisibleElement(el))return false;
        const text=String(el.innerText || el.textContent || '');
        return /Generate questions/i.test(text) && /Create AI[- ]graded question/i.test(text) && /Select content type/i.test(text);
      }).sort((a,b)=>String(a.innerText || a.textContent || '').length-String(b.innerText || b.textContent || '').length);
      if(!bodies.length)continue;
      if(node.querySelector('[data-testid^="assignment-part-"]') || assignmentOutlineLinksV61320(rail,node).some(a=>!a.structural))continue;
      return {root:node,sidebar:rail,content:bodies[0],method:'VISIBLE_EMPTY_OUTLINE_AND_BODY'};
    }
    return null;
  }

export function choiceDiagnosticsV61318(part) {
    return [...part.querySelectorAll('input,[role="radio"],[role="checkbox"],.cds-choiceinput-root,label,[contenteditable="true"]')].slice(0,60).map(el=>({
      visibilityCheck:choiceControlVisibilityV61320(el,part),
      ancestry:choiceAncestryV61319(el,part),
      tag:el.tagName,role:el.getAttribute('role') || '',type:el.getAttribute('type') || '',
      testId:el.getAttribute('data-testid') || '',ariaLabel:el.getAttribute('aria-label') || '',
      text:String(el.innerText || el.textContent || el.value || '').replace(/\s+/g,' ').trim().slice(0,600),
      parentText:String(el.parentElement && (el.parentElement.innerText || el.parentElement.textContent) || '').replace(/\s+/g,' ').trim().slice(0,900)}));
  }

export function parseUnmarkedChoicesV61318(part,fp,ordinal) {
    return unmarkedChoiceProbeV61320(part,fp,ordinal).question;
  }

export function readingBodyGuardV61312(body, root, fp) {
    if (!fp || !/^(?:supplement|reading)$/i.test(String(fp.typeName || fp.type || ''))) return body;
    const certified=exactReadingBodyV61318(root,fp);
    if(certified)body=certified;
    const text=String(body.text || '').replace(/[\u200b-\u200d\ufeff]/g,'').trim();
    const fullText=String(root && (root.innerText || root.textContent) || '').replace(/\s+/g,' ').trim();
    const viewer=/^(?:\d+\s*)?\/\s*\d+\s+\d{1,3}%\s+\S/.test(text);
    const limit=Number(body.textCaptureLimit || MAX_TEXT_SAMPLE);
    const observed=certified ? certified.fullObservedTextLength : fullText.length;
    const out={...body,fullObservedTextLength:observed,textCaptureLimit:limit,
      textCaptureTruncated:certified ? observed>limit : observed>limit || String(body.text || '').length>=limit};
    if (readingLoadingOnlyV61312(root)) {
      out.completeness=0;out.confidence='low';out.scopeKind='reading-loading-placeholder';out.captureGap='READING_STILL_LOADING';
    } else if (viewer) {
      out.completeness=Math.min(.60,Number(out.completeness || 0));out.scopeKind='document-viewer';out.captureGap='DOCUMENT_PAGES_NOT_VERIFIED';
    }
    if (out.textCaptureTruncated) {
      out.completeness=Math.min(.72,Number(out.completeness || 0));out.captureGap=out.captureGap || 'TEXT_SAMPLE_LIMIT_REACHED';
    }
    return out;
  }

export function exactReadingEditorV61311(fp, courseOrBranchId) {
    if (!fp || String(fp.typeName || '') !== 'supplement') return null;
    const route = authoringItemRouteV61311(location.href);
    if (!route || route.courseId !== String(courseOrBranchId) || route.itemId !== String(fp.id) || route.typeName !== 'supplement') return null;
    const expected = route.courseId + '+' + route.itemId;
    const matches = [];
    try {
      document.querySelectorAll('[contenteditable="true"][role="textbox"][aria-label="Reading Content"]').forEach(el => {
        if (el.getAttribute('data-testid') === expected && el.isConnected && isVisibleElement(el) && !isGlobalChromeElement(el)) matches.push(el);
      });
    } catch (e) {}
    return matches.length === 1 ? {root:matches[0], score:1, routeScoped:true, exactReadingIdentity:true} : null;
  }

export function readingAttachmentLabelsV61323(text) {
    // Recognize the repeated filename/file-type label emitted by attachment cards.
    // A filename mentioned in prose is not an attachment declaration.
    const value=String(text || '').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const labels=[], seen=new Set();
    const types={pdf:'pdf',doc:'word',docx:'word',ppt:'powerpoint',pptx:'powerpoint',xls:'excel',xlsx:'excel',csv:'csv',txt:'text',zip:'zip'};
    const re=/\.(pdf|docx?|pptx?|xlsx?|csv|txt|zip)\s+(.{1,300}?)\s+(PDF|Word|PowerPoint|Excel|CSV|Text|ZIP) File\b/gi;
    let m;
    while((m=re.exec(value))) {
      const ext=m[1].toLowerCase(),stem=m[2].trim(),start=m.index-stem.length;
      if(types[ext]!==m[3].toLowerCase() || start<0 || (start>0 && !/\s/.test(value[start-1])))continue;
      if(value.slice(start,m.index).toLowerCase()!==stem.toLowerCase())continue;
      const label=value.slice(start,m.index+ext.length+1),key=label.toLowerCase();
      if(!seen.has(key)){seen.add(key);labels.push(label);}
    }
    return labels;
  }

export function readingAttachmentCoverageV61323(text,assets) {
    const labels=readingAttachmentLabelsV61323(text),resolved=new Set();
    for(const asset of assets || []) {
      if(!asset || typeof asset!=='object' || !/^https?:\/\/[^\s/]+(?:\/|$)/i.test(String(asset.url || '')))continue;
      const name=String(asset.name || '').replace(/\s+/g,' ').trim().toLowerCase();
      if(name)resolved.add(name);
    }
    const unresolved=labels.filter(name=>!resolved.has(name.toLowerCase()));
    return {method:'EXACT_READING_FIELD_ATTACHMENT_LABELS',observedLabelCount:labels.length,
      resolvedLabelCount:labels.length-unresolved.length,labels,unresolvedLabels:unresolved,
      status:!labels.length?'NO_ATTACHMENT_LABELS_OBSERVED':unresolved.length?'ATTACHMENT_DOWNLOAD_URLS_UNVERIFIED':'OBSERVED_ATTACHMENT_URLS_CAPTURED',
      binaryContentVerified:false,meaning:'Coverage of observed attachment labels by captured download URLs; not proof of all source files, downloaded bytes, or learner access.'};
  }

export function readingAttachmentStateV61324(root,fp,courseIdValue) {
    const out={assets:[],references:[],diagnostics:{scope:'EXACT_READING_FIELD',elements:0,objects:0,limitReached:false,propKeySamples:[]}};
    if(exactReadingEditorV61311(fp,courseIdValue)?.root!==root)return out;
    const labels=readingAttachmentLabelsV61323(root.innerText),names=new Map(labels.map(name=>[name.toLowerCase(),name]));
    if(!labels.length)return out;
    const refs=new Map(),assets=[],seen=new WeakSet(),stack=[];
    const value=(obj,key)=>ownStateValueV61313(obj,key);
    const idValid=id=>typeof id==='string' && /^[A-Za-z0-9_-]{6,128}$/.test(id);
    function reference(id,name,source){if(idValid(id)){const old=refs.get(id);if(!old || (!old.name && name))refs.set(id,{assetId:id,name:name || '',source});}}
    function seed(obj,hint,path){if(obj && typeof obj==='object')stack.push({obj,hint,path,depth:0});}
    const elements=[root,...root.querySelectorAll('*')];
    out.diagnostics.limitReached=elements.length>700;
    for(const el of elements.slice(0,700)) {
      out.diagnostics.elements++;
      const text=String(el.innerText || el.textContent || '').replace(/\s+/g,' ').trim();
      const found=labels.filter(name=>text.includes(name));
      const hint=found.length===1?found[0]:'';
      if(hint)reference(el.getAttribute('data-asset-id'),hint,'attachment-dom-attribute');
      const keys=Object.getOwnPropertyNames(el),propsKey=keys.find(k=>k.startsWith('__reactProps$'));
      if(propsKey)seed(value(el,propsKey),hint,'rendered-props');
      const fiberKey=keys.find(k=>k.startsWith('__reactFiber$'));
      let fiber=fiberKey?value(el,fiberKey):null;
      // Component props may sit between the attachment and its DOM host. Stop at
      // the first host outside the exact field; never inspect application stores.
      for(let n=0;fiber && n<8;n++,fiber=value(fiber,'return')) {
        const host=value(fiber,'stateNode');
        if(host && host.nodeType===1 && host!==root && !root.contains(host))break;
        seed(value(fiber,'memoizedProps'),hint,'rendered-component-props');
      }
    }
    let strings=0;
    const blocked=/^(?:_owner|_store|return|sibling|alternate|stateNode|ref|ownerDocument|window|document|queryClient|client|cache|store|context|memoizedState|updateQueue)$/;
    while(stack.length && out.diagnostics.objects<24000) {
      const {obj,hint,path,depth}=stack.pop();
      if(!obj || typeof obj!=='object' || seen.has(obj) || obj.nodeType || depth>16)continue;
      seen.add(obj);out.diagnostics.objects++;
      const keys=Object.keys(obj);
      if(hint && out.diagnostics.propKeySamples.length<12)out.diagnostics.propKeySamples.push({label:hint,keys:keys.slice(0,20)});
      const candidate=value(obj,'fileName') || value(obj,'filename') || value(obj,'name') || value(obj,'title');
      const name=typeof candidate==='string'?names.get(candidate.replace(/\s+/g,' ').trim().toLowerCase()) || '':'';
      const kind=String(value(obj,'type') || value(obj,'kind') || '');
      const explicitId=value(obj,'assetId') || value(obj,'asset_id');
      const refId=explicitId || ((name || /asset|attachment|file/i.test(kind) || /(?:^|\.)(?:asset|assets|attachment|attachments|file|files)$/.test(path))?value(obj,'id'):'');
      reference(refId,name || hint,path);
      // Only co-located, visible attachment names and actual HTTP URLs qualify.
      // Metadata checksums are not measured binary hashes.
      const rawUrl=value(obj,'downloadUrl') || value(obj,'assetUrl') || value(obj,'url') || value(obj,'href');
      const url=typeof rawUrl==='string'?rawUrl:rawUrl && typeof rawUrl==='object'?value(rawUrl,'url'):'';
      if(name && typeof url==='string' && /^https?:\/\//i.test(url) && !isCourseraUiAssetUrl(url) && !/\/api\/assets\.v1(?:[/?]|$)/i.test(url)) {
        assets.push({name,url,assetId:idValid(refId)?refId:'',size:Number(value(obj,'size') || value(obj,'fileSize') || 0) || 0,
          mime:String(value(obj,'mimeType') || value(obj,'contentType') || ''),sha256:'',perceptualHash:'',hashStatus:'URL_ONLY',evidenceSource:'exact-reading-component-state'});
      }
      for(const key of keys.slice(0,160)) {
        if(blocked.test(key))continue;
        const child=value(obj,key);
        if(child && typeof child==='object')stack.push({obj:child,hint:name || hint,path:key,depth:depth+1});
        else if(typeof child==='string' && /^(?:cml|html|markup|content|value|body|text)$/.test(key) && /<asset\b/i.test(child)) {
          if(strings+child.length>512000){out.diagnostics.limitReached=true;continue;}strings+=child.length;
          for(const tag of child.match(/<asset\b[^>]{0,1600}>/gi) || []) {
            const attrs={};for(const m of tag.matchAll(/\b(id|assetId|name|filename)\s*=\s*(['"])(.*?)\2/gi))attrs[m[1].toLowerCase()]=m[3];
            reference(attrs.assetid || attrs.id,names.get(String(attrs.filename || attrs.name || '').toLowerCase()) || '','exact-reading-cml-asset-reference');
          }
        }
      }
      if(keys.length>160)out.diagnostics.limitReached=true;
    }
    if(stack.length)out.diagnostics.limitReached=true;
    out.assets=uniqueAssetDetails(assets,800);out.references=[...refs.values()].slice(0,256);
    if(refs.size>256)out.diagnostics.limitReached=true;
    out.diagnostics.referenceCount=out.references.length;out.diagnostics.urlCount=out.assets.length;
    return out;
  }

export function readingNetworkDiagnosticsV61324(fp,recorder,initialCount) {
    const records=recorder?recorder.takeFor(fp).slice(initialCount || 0):[],groups=new Map();
    for(const rec of records) {
      let path='';try{path=new URL(rec.url,location.href).pathname;}catch(_){}
      const accepted=readingNetworkRecordsV61323(fp,{takeFor:()=>[rec]},0).records.length>0;
      const key=[rec.method,rec.status,path.split('/').slice(0,3).join('/'),accepted].join('|');
      if(!groups.has(key))groups.set(key,{method:String(rec.method || 'GET'),status:rec.status,pathFamily:path.split('/').slice(0,3).join('/'),eligible:accepted,count:0});
      groups.get(key).count++;
    }
    return {responseGroups:[...groups.values()].slice(0,32),omittedGroups:Math.max(0,groups.size-32)};
  }

export function isRejectedItemNavigationUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      const u = new URL(rawUrl, location.href);
      if (String(u.searchParams.get("changeLog") || "").toLowerCase() === "true") return true;
      if (String(u.searchParams.get("changelog") || "").toLowerCase() === "true") return true;
      if (/(?:^|[?&])(changelog|history)=true(?:&|$)/i.test(u.search)) return true;
      if (/\/change-?log(?:\/|$)|\/history(?:\/|$)/i.test(u.pathname)) return true;
      return false;
    } catch (e) { return false; }
  }

export function elementTextKey(el) {
    if (!el) return "";
    return normalizeName(
      (el.innerText || el.textContent || "") + " " +
      (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-testid") || el.getAttribute("data-e2e") || "")) + " " +
      (el.id || "")
    );
  }

export function elementAttributeBlob(el) {
    if (!el || !el.attributes) return "";
    return [...el.attributes].map(a => String(a.name || "") + "=" + String(a.value || "")).join(" ").toLowerCase();
  }

export function directElementTextKey(el) {
    if (!el) return "";
    const parts = [];
    try {
      for (const node of el.childNodes || []) {
        if (node && node.nodeType === 3) {
          const value = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
          if (value) parts.push(value);
        }
      }
    } catch (e) {}
    try {
      const aria = el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title") || "");
      if (aria) parts.push(aria);
    } catch (e) {}
    return normalizeName(parts.join(" "));
  }

export function isExactVisibleTitleNode(el, fp) {
    if (!el || !isVisibleElement(el) || isGlobalChromeElement(el)) return false;
    const name = normalizeName(fp && fp.name);
    if (!name) return false;
    const direct = directElementTextKey(el);
    if (direct === name) return true;
    const full = normalizeName(el.innerText || el.textContent || "");
    return full === name;
  }

export function isRejectedNavigationSeed(el) {
    if (!el) return true;
    const tag = String(el.tagName || "").toLowerCase();
    if (/^(textarea|input|select|option|iframe|object|embed)$/.test(tag)) return true;
    try {
      const href = el.getAttribute && el.getAttribute("href");
      if (href && isRejectedItemNavigationUrl(href)) return true;
      const attrs = elementAttributeBlob(el);
      if (/change-?log|changeloglink|data-track-component=changelog/.test(attrs)) return true;
      if (String(el.getAttribute && el.getAttribute("contenteditable") || "").toLowerCase() === "true") return true;
      if (el.closest && el.closest("[contenteditable='true'],textarea,input,select")) {
        // Buttons/links inside a real editor toolbar may still be controls, but they
        // must never be selected as the identity seed for a course-outline item.
        if (tag !== "button" && tag !== "a") return true;
      }
    } catch (e) {}
    return false;
  }

export function exactIdentityElements(fp) {
    const id = String((fp && fp.id) || "").toLowerCase();
    if (!id) return [];
    const selectors = "[data-item-id],[data-id],[data-testid],[data-e2e],[id]";
    const out = [];
    try {
      for (const el of document.querySelectorAll(selectors)) {
        if (isGlobalChromeElement(el) || isRejectedNavigationSeed(el)) continue;
        if (elementAttributeBlob(el).includes(id)) out.push(el);
        if (out.length >= 80) break;
      }
    } catch (e) {}
    return out;
  }

export function isDocumentScrollRoot(el) {
    return el === document.scrollingElement || el === document.documentElement || el === document.body;
  }

export function scrollRootPosition(root) {
    if (isDocumentScrollRoot(root)) return Math.round(window.scrollY || 0);
    return Math.round(Number(root && root.scrollTop || 0));
  }

export async function setScrollRootPosition(root, y) {
    try {
      if (isDocumentScrollRoot(root)) window.scrollTo(0, y);
      else {
        root.scrollTop = y;
        root.dispatchEvent(new Event("scroll", { bubbles:true }));
      }
    } catch (e) {}
    await sleepMs(350); // allow virtualized React question rows to mount after each scroll step
  }

export function scrollRootMax(root) {
    try {
      if (isDocumentScrollRoot(root)) {
        const scroller = document.scrollingElement || document.documentElement || document.body;
        return Math.max(0, Number(scroller.scrollHeight || 0) - Number(window.innerHeight || 0));
      }
      return Math.max(0, Number(root.scrollHeight || 0) - Number(root.clientHeight || 0));
    } catch (e) { return 0; }
  }

export function isPerItemNetworkNoise(url) {
    const raw = String(url || "").toLowerCase();
    let path = raw;
    try {
      const parsed = new URL(url, location.origin);
      path = String(parsed.pathname || "").toLowerCase() + String(parsed.search || "").toLowerCase();
    } catch (e) {}
    return /(?:^|\/)eventing(?:\/|$)|(?:^|\/)infobatch(?:[/?]|$)|telemetry|analytics(?:\/|-)events|logging|heartbeat|beacon|metrics|performance(?:\/|-)log|sentry|datadog|rum|trace/.test(path) ||
           /(?:^|\/)eventing(?:\/|$)|(?:^|\/)infobatch(?:[/?]|$)/.test(raw);
  }

export function isCourseWideNetworkResponse(url) {
    const value = String(url || "").toLowerCase();
    return /authoringcoursematerials\.v1|authoringcourses\.v2|authoringbranchproperties\.v1|itemdraftproperties\.v1|ondemandstoredlearningobjectives\.v1|coursetypemetadata\.v1|opencoursememberships\.v1|partners\.v1|\/api\/rest\/v1\/client-gateway\/eval/.test(value);
  }

export async function waitForNetworkQuiet(recorder, fp, initialCount, timeoutMs, deadline) {
  const start = Date.now();
  const hardDeadline=Math.min(start+Math.max(0,Number(timeoutMs)||0),Number.isFinite(Number(deadline))?Number(deadline):Infinity);
  let lastCount = initialCount, stableSince = Date.now();
  while (Date.now() < hardDeadline) {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return recorder.takeFor(fp).length;
    const count = recorder.takeFor(fp).length;
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    }
    if (Date.now() - stableSince >= 700) return count;
    await sleepMs(Math.min(150,Math.max(0,hardDeadline-Date.now())));
  }
  return recorder.takeFor(fp).length;
}

export function hasVisibleLoadingIndicator(root) {
    const scope = root && root.querySelectorAll ? root : document;
    try {
      const nodes = scope.querySelectorAll("[aria-busy='true'],[role='progressbar'],progress,[data-state='loading'],[class*='loading'],[class*='spinner'],[class*='skeleton']");
      for (const el of [...nodes].slice(0, 120)) {
        if (!isVisibleElement(el)) continue;
        const blob = normalizeName(elementAttributeBlob(el) + " " + (el.innerText || el.textContent || ""));
        if (!/\b(not loading|loaded|complete)\b/.test(blob)) return true;
      }
    } catch (e) {}
    return false;
  }

export function findCurrentEditorSurface(fp, baselineOpenSurfaces, strongSessionIdentity) {
    const baseline = baselineOpenSurfaces || new Set();
    const roots = [];
    const seen = new Set();
    function add(root) {
      if (!root || seen.has(root) || baseline.has(root)) return;
      if (root === document.body || root === document.documentElement) return;
      if (!isVisibleElement(root) || isGlobalChromeElement(root) || isLikelyWholeOutlineSurface(root)) return;
      seen.add(root);
      roots.push(root);
    }
    try {
      document.querySelectorAll("[role='dialog'],[aria-modal='true'],dialog,[data-state='open'],main,article,form,section,[role='main']").forEach(add);
    } catch (e) {}
    const name = normalizeName(fp && fp.name);
    if (name) {
      try {
        document.querySelectorAll("h1,h2,h3,[role='heading']").forEach(el => {
          if (!isVisibleElement(el) || normalizeName(el.innerText || el.textContent || "") !== name) return;
          candidateSurfaceAncestors(el).forEach(add);
        });
      } catch (e) {}
    }
    let best = null, bestScore = 0;
    for (const root of roots.slice(0, 450)) {
      const score = scoreSurfaceForFingerprint(root, fp, strongSessionIdentity);
      if (score > bestScore) { best = root; bestScore = score; }
    }
    return bestScore >= 0.90 ? { root: best, score: bestScore } : null;
  }
