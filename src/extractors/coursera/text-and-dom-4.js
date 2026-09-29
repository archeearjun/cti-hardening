import { attachmentFileTypeFromText, fileNameFromUrl } from "./assets.js";
import { typedEditorRouteTypeV61316 } from "./navigation-2.js";
import { authoringItemRouteV61311 } from "./navigation.js";
import { elementAttributeBlob, elementTextKey, isExactVisibleTitleNode } from "./text-and-dom-2.js";
import { ctiPlainTextV664, isVisibleElement, ownStateValueV61313, stateSearchBudgetV61313, stateSearchStepV61313 } from "./text-and-dom-3.js";
import { normalizeName } from "./text-and-dom.js";

export function objectTextV664(obj, depth, seen, work) {
    work=work || stateSearchBudgetV61313();
    if (!stateSearchStepV61313(work) || obj == null) return '';
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return ctiPlainTextV664(obj, 1200);
    if (typeof obj !== 'object' || depth < 0) return '';
    if (typeof Element !== 'undefined' && obj instanceof Element) return '';
    seen = seen || new WeakSet();
    if (seen.has(obj)) return '';
    seen.add(obj);
    const parts = [];
    let keys = [];
    try { keys = Object.keys(obj).slice(0, 80); } catch (e) { return ''; }
    const preferred = keys.filter(k => /(?:text|label|prompt|stem|title|content|body|value|html|cml|description)/i.test(k));
    const ordered = [...preferred, ...keys.filter(k => !preferred.includes(k))].slice(0, 45);
    for (const k of ordered) {
      if (!stateSearchStepV61313(work)) break;
      if (/^(?:children|_owner|return|child|sibling|stateNode|alternate)$/i.test(k)) continue;
      let v;
      try { v = ownStateValueV61313(obj,k); } catch (e) { continue; }
      if (typeof v === 'string' || typeof v === 'number') {
        const t = ctiPlainTextV664(v, 500);
        if (t && !parts.includes(t)) parts.push(t);
      } else if (v && typeof v === 'object' && depth > 0 && !Array.isArray(v)) {
        const t = objectTextV664(v, depth - 1, seen, work);
        if (t && !parts.includes(t)) parts.push(t);
      }
      if (parts.join(' ').length > 1800) break;
    }
    return parts.join(' ').replace(/\\s+/g, ' ').trim().slice(0, 1800);
  }

export function exactPointElements(root) {
    const out = [];
    if (!root || !root.querySelectorAll) return out;
    try {
      [...root.querySelectorAll("span,div,p,strong,b,label,[role='text'],[role='status']")].slice(0, 8000).forEach(el => {
        if (!isVisibleElement(el)) return;
        const t = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (!/^(?:\+\/-\s*)?\d+(?:\.\d+)?\s*(?:points?|pts?)$/i.test(t)) return;
        let childExact = false;
        try { [...el.children].forEach(ch => { if (String(ch.innerText || ch.textContent || "").replace(/\s+/g, " ").trim() === t) childExact = true; }); } catch (e) {}
        if (!childExact) out.push(el);
      });
    } catch (e) {}
    return out;
  }

export function cleanAttachmentDisplayName(raw, fileType) {
    let text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    text = text.replace(/\b(?:PDF|DOCX?|PPTX?|XLSX?|CSV|ZIP|PNG|JPE?G|WEBP|MP4|WEBM|MP3|WAV)\s+File\b/ig, " ");
    text = text.replace(/\b(?:download|open|preview|remove|delete|replace)\b/ig, " ");
    text = text.replace(/\s+/g, " ").trim().replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, "");
    if (fileType && text && !new RegExp("\\." + fileType.replace("DOCX","docx").replace("PPTX","pptx").replace("XLSX","xlsx") + "$","i").test(text)) {
      // Keep the human display name as-is; filename inference is stored separately.
    }
    return text.slice(0, 220);
  }

export function collectCourseraAttachmentFacts(root) {
    const out = [], seen = new Set();
    if (!root || !root.querySelectorAll) return out;
    // v6.10: attachment evidence must come from the local file-chip/link itself,
    // not a large ancestor whose text happens to contain "DOCX File" somewhere.
    // This prevents the whole assignment page from being fabricated as several
    // pseudo-DOCX filenames while preserving the real short file chip.
    const nodes = [root, ...root.querySelectorAll("a[href],button,[role='button'],[data-testid],[data-e2e],span,div")].slice(0, 14000);
    function add(displayName, fileType, url, evidence, rawText) {
      displayName = cleanAttachmentDisplayName(displayName, fileType);
      fileType = String(fileType || "").toUpperCase();
      url = String(url || "");
      // A bare badge such as "Download DOCX File" is not a second attachment.
      // Keep it only when it has a real URL; otherwise require a human filename.
      if (!displayName && !url) return;
      if (displayName && displayName.length > 190 && !url) return;
      // v6.14: "upload/submit your work as a .pdf" is an instruction, not a file.
      // URL-less evidence must look like a bounded file identity/chip, not prose.
      if(!url && displayName){
        const d=String(displayName).replace(/\s+/g,' ').trim();
        const instruction=/^(?:please\s+)?(?:upload|submit|save|open|attach|complete|send|export|provide|return|once|you\s+(?:should|must|can)|your\s+work)\b/i.test(d);
        const sentenceLike=d.split(/\s+/).length>12 || /\b(?:your|assignment|work)\b.*\b(?:as|in)\b.*\.(?:pdf|docx?|pptx?|xlsx?)\b/i.test(d);
        if((instruction||sentenceLike) && evidence!=="visible-editor-file-chip")return;
      }
      let inferredName = displayName;
      if (displayName && fileType && !new RegExp("\\." + fileType + "$","i").test(displayName)) inferredName = displayName + "." + fileType.toLowerCase();
      const key = normalizeName(inferredName || url || rawText);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({
        displayName: displayName,
        fileType: fileType,
        inferredFileName: inferredName,
        url: url,
        evidenceSource: evidence || "visible-editor-attachment",
        rawText: String(rawText || "").replace(/\s+/g," ").trim().slice(0,320)
      });
    }
    for (const el of nodes) {
      if (!isVisibleElement(el) || isGlobalChromeElement(el)) continue;
      const own = String(el.innerText || el.textContent || "").replace(/\s+/g," ").trim();
      const href = String(el.getAttribute && (el.getAttribute("href") || el.getAttribute("data-href")) || "");
      if (!own && !href) continue;
      const type = attachmentFileTypeFromText(own + " " + href);
      const extHit = /\.(pdf|docx?|pptx?|xlsx?|csv|zip|png|jpe?g|webp|mp4|webm|mp3|wav)(?:\b|[?#])/i.test(own + " " + href);
      const fileLabelHit = /\b(PDF|DOCX?|PPTX?|XLSX?|CSV|ZIP|PNG|JPE?G|WEBP|MP4|WEBM|MP3|WAV)\s+File\b/i.test(own);
      if (!extHit && !fileLabelHit) continue;

      const isLink = String(el.tagName || "").toLowerCase() === "a" && !!href;
      const hasIdentityAttr = !!(el.getAttribute && (el.getAttribute("data-testid") || el.getAttribute("data-e2e") || el.getAttribute("aria-label") || el.getAttribute("title")));
      // Large ancestor containers are diagnostic text, not attachment chips.
      if (!isLink && !hasIdentityAttr && own.length > 220) continue;
      if (fileLabelHit && own.length > 260 && !isLink) continue;

      let display = "";
      const hrefName = fileNameFromUrl(href);
      if (hrefName && /\.[a-z0-9]{2,5}$/i.test(hrefName)) display = hrefName;
      if (!display) {
        const extName = own.match(/([A-Za-z0-9][A-Za-z0-9 _().\-]{2,180}\.(?:pdf|docx?|pptx?|xlsx?|csv|zip|png|jpe?g|webp|mp4|webm|mp3|wav))/i);
        if (extName) display = extName[1];
      }
      if (!display && fileLabelHit) {
        const marker = own.search(/\b(?:PDF|DOCX?|PPTX?|XLSX?|CSV|ZIP|PNG|JPE?G|WEBP|MP4|WEBM|MP3|WAV)\s+File\b/i);
        display = marker > 0 ? own.slice(0, marker).trim() : "";
        // If this element is only the "DOCX File" badge, use one nearby short
        // sibling/parent label, but never climb into the full assignment body.
        if (!display && el.parentElement) {
          const p = String(el.parentElement.innerText || el.parentElement.textContent || "").replace(/\s+/g," ").trim();
          if (p.length <= 190) {
            const pm = p.search(/\b(?:PDF|DOCX?|PPTX?|XLSX?|CSV|ZIP|PNG|JPE?G|WEBP|MP4|WEBM|MP3|WAV)\s+File\b/i);
            if (pm > 0) display = p.slice(0, pm).trim();
          }
        }
      }
      if (!display && isLink) display = own.slice(0,180);
      if (!display) continue;
      add(display, type, href, fileLabelHit ? "visible-editor-file-chip" : "visible-editor-file-link", own);
    }
    return out.slice(0,120);
  }

export function courseraControlValue(el) {
    if (!el) return "";
    try {
      const tag = String(el.tagName || "").toLowerCase();
      if (tag === "select") {
        const opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
        return String((opt && (opt.textContent || opt.value)) || el.value || "").replace(/\s+/g," ").trim();
      }
      if (tag === "input" || tag === "textarea") {
        const v = el.value != null ? el.value : el.getAttribute("value");
        return String(v == null ? "" : v).replace(/\s+/g," ").trim();
      }
      const aria = el.getAttribute && (el.getAttribute("aria-valuenow") || el.getAttribute("aria-valuetext") || el.getAttribute("data-value"));
      if (aria != null && String(aria).trim()) return String(aria).replace(/\s+/g," ").trim();
      if (el.getAttribute && el.getAttribute("data-testid") === "read-only-value") return String(el.innerText || el.textContent || "").replace(/\s+/g," ").trim();
    } catch (e) {}
    return "";
  }

export function findLabeledCourseraControlValue(root, labelRe) {
    if (!root || !root.querySelectorAll) return "";
    const labels = [...root.querySelectorAll("label,[data-testid],h1,h2,h3,h4,h5,h6,div,span,p")].slice(0,14000);
    for (const label of labels) {
      if (!isVisibleElement(label) || isGlobalChromeElement(label)) continue;
      const own = String(label.innerText || label.textContent || "").replace(/\s+/g," ").trim();
      if (!own || own.length > 140 || !labelRe.test(own)) continue;
      // Native <label for=> is the strongest identity.
      try {
        const forId = label.getAttribute && label.getAttribute("for");
        if (forId) {
          const target = root.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(forId) : forId.replace(/([:.\[\],=@])/g,"\\$1")));
          const v = courseraControlValue(target); if (v) return v;
        }
      } catch (e) {}
      // Inspect a small local settings row only. Values frequently live in an
      // <input value="80"> and therefore never appear in innerText.
      let row = label;
      for (let depth=0; row && depth<4; depth++, row=row.parentElement) {
        if (row === root.parentElement || row === document.body) break;
        const rowText = String(row.innerText || row.textContent || "").replace(/\s+/g," ").trim();
        if (rowText.length > 900) break;
        const controls = [...row.querySelectorAll("input,select,textarea,[role='spinbutton'],[aria-valuenow],[aria-valuetext],[data-testid='read-only-value']")].slice(0,40);
        for (const c of controls) {
          if (!isVisibleElement(c) && String(c.tagName||"").toLowerCase() !== "input") continue;
          const v = courseraControlValue(c);
          if (v) return v;
        }
      }
    }
    return "";
  }

export function stripCourseraAttachmentBadgesFromLearnerText(text, attachments) {
    let out = String(text || "");
    function esc(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    (attachments || []).forEach(a => {
      const vals = [a && a.rawText, a && a.inferredFileName, a && a.displayName,
        a && a.displayName && a && a.fileType ? (a.displayName + " " + a.fileType + " File") : ""];
      vals.filter(Boolean).forEach(v => {
        const clean = String(v).replace(/\s+/g," ").trim();
        if (clean.length < 4 || clean.length > 260) return;
        out = out.replace(new RegExp(esc(clean), "ig"), " ");
      });
    });
    return out.replace(/\s+/g," ").trim();
  }

export function detectCourseraIngestionFailure(root, fp) {
    const title = String((fp && fp.name) || '');
    const raw = String(root && (root.innerText || root.textContent) || '').replace(/\s+/g,' ').trim();
    const head = raw.slice(0,14000);
    const titleSentinel = /^\s*\[ERROR DURING DISTILLATION\]/i.test(title);
    const bodySentinel = /^\s*\[ERROR DURING DISTILLATION\]/i.test(head) || /\[ERROR DURING DISTILLATION\]/i.test(head.slice(0,1600));
    const rawMarker = /Raw content for the item\s*:/i.test(head);
    const markerNames=['x-coursera-structure-node-id','x-coursera-distance-from-root','x-coursera-resource-type','x-coursera-file-path','x-coursera-associated-content-files'];
    const low=head.toLowerCase();
    const metadataHits=markerNames.filter(k => low.indexOf(k) > -1).length;
    const rawMetadata = rawMarker && metadataHits >= 2;
    const conversionPlaceholder = /there was an error when converting this\s+(?:discussion prompt|reading|assignment|quiz|item)\b/i.test(head) && /please add content to complete this item/i.test(head);
    if (!titleSentinel && !bodySentinel && !rawMetadata && !conversionPlaceholder) return {detected:false,codes:[],confidence:'LOW'};
    const codes=[];
    if (titleSentinel || bodySentinel) codes.push('DISTILLATION_ERROR');
    if (rawMetadata) codes.push('RAW_METADATA_RENDERED');
    if (conversionPlaceholder) codes.push('CONVERSION_ERROR_PLACEHOLDER');
    const reason = (titleSentinel || bodySentinel) ? 'Coursera explicitly renders the Smart Ingestion distillation-error sentinel.' : (conversionPlaceholder ? 'Coursera explicitly renders its conversion-error placeholder instead of learner content.' : 'Raw x-coursera ingestion metadata is rendered as learner content.');
    return {detected:true,codes,confidence:'VERY_HIGH',metadataHits,reason};
  }

export function typedEditorIdentityV61316(root, fp, courseId) {
    const expected=String(courseId)+'+'+String(fp.id);
    let matched=false, conflict=false;
    function own(obj,key){try{const d=obj && Object.getOwnPropertyDescriptor(obj,key);return d && 'value' in d?d.value:undefined;}catch(_){return undefined;}}
    const nodes=[root,...root.querySelectorAll('[data-testid],[data-item-id],[data-course-id],[contenteditable],textarea,iframe')].slice(0,180);
    for(const el of nodes){
      const testid=String(el.getAttribute('data-testid') || '');
      if(testid===expected)matched=true;
      const item=el.getAttribute('data-item-id'),course=el.getAttribute('data-branch-id');
      if(item && String(item)!==String(fp.id))conflict=true;
      if(course && String(course)!==String(courseId))conflict=true;
      if(item===String(fp.id))matched=true;
      if(testid.endsWith('+'+fp.id) && testid!==expected)conflict=true;
      const props=reactPropsForElement(el);
      const propItem=own(props,'itemId'), propCourse=own(props,'branchId');
      if(propItem!=null && String(propItem)!==String(fp.id))conflict=true;
      if(propCourse!=null && String(propCourse)!==String(courseId))conflict=true;
      if(propItem!=null && String(propItem)===String(fp.id))matched=true;
    }
    return {matched,conflict};
  }

export function typedEditorTitleAnchorsV61316(expectedTitle) {
    const normalize=value=>String(value || '').replace(/\s+/g,' ').trim();
    const title=normalize(expectedTitle);
    if(!title)return [];
    // Authoring titles may be an input, textarea, editable block, or generic div.
    // Searching structure does not make the body an item evidence root.
    const nodes=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],input,textarea,div,span,p,label')];
    const matches=[];
    for(const el of nodes){
      if(matches.length>=60)break;
      if(['password','hidden','search','email'].includes(String(el.getAttribute('type') || '').toLowerCase()))continue;
      const field=/^(INPUT|TEXTAREA)$/.test(String(el.tagName || ''));
      const raw=field?String(el.value || ''):String(el.textContent || '');
      if(raw.length>Math.max(600,title.length*4) || normalize(raw)!==title)continue;
      if(!isVisibleElement(el) || isGlobalChromeElement(el))continue;
      // A title in an item-navigation link is not the title of an open editor.
      if(el.closest('a,[role="link"],button,[role="button"],[role="menuitem"]'))continue;
      matches.push(el);
    }
    return matches.filter(el=>!matches.some(other=>other!==el && el.contains(other)));
  }

export function typedEditorFieldsV61316(root, expectedTitle) {
    const normalize=value=>String(value || '').replace(/\s+/g,' ').trim();
    const fields=[...root.querySelectorAll('textarea,[role="textbox"],[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""]')]
      .filter(el=>isVisibleElement(el) && !isGlobalChromeElement(el))
      .filter(el=>!/(?:title|item[\s_-]*name|search|filter)/i.test(['aria-label','name','placeholder','data-testid','id'].map(k=>el.getAttribute(k) || '').join(' ')))
      .filter(el=>normalize(el.value || el.innerText || el.textContent || '')!==normalize(expectedTitle));
    // Some editors nest editable elements; their outer field owns the full prompt.
    return fields.filter(el=>!fields.some(other=>other!==el && other.contains(el)));
  }

export function typedEditorSurfaceV61316(fp, courseId, expectedTitle) {
    const route=authoringItemRouteV61311(location.href);
    if(!route || route.courseId!==String(courseId) || route.itemId!==String(fp.id) || route.typeName!==typedEditorRouteTypeV61316(fp))return null;
    const title=String(expectedTitle || '').replace(/\s+/g,' ').trim();
    if(!title)return null; // The caller must supply an observed title from its identified editor.
    const candidates=[];
    const headings=typedEditorTitleAnchorsV61316(title);
    for(const heading of headings.slice(0,12)){
      for(let root=heading.parentElement,depth=0;root && depth<14;root=root.parentElement,depth++){
        if(root===document.body || root===document.documentElement)break;
        // display:contents and zero-box layout wrappers can hold visible fields.
        // The title and actual fields/controls must still be independently visible.
        if(!root.isConnected || isGlobalChromeElement(root))continue;
        const text=String(root.innerText || root.textContent || '');
        const fields=typedEditorFieldsV61316(root,title);
        const chooseControls=[...root.querySelectorAll('button,[role="button"]')].filter(el=>isVisibleElement(el) &&
          !isGlobalChromeElement(el) && /^Choose Plugin$/i.test(String(el.innerText || el.textContent || '').trim()));
        const plugin=typedEditorRouteTypeV61316(fp)==='plugin' && chooseControls.length===1 &&
          (/\b(?:External Webpage|YouTube|Edit Configuration|Save Configuration)\b/i.test(text) || root.querySelectorAll('iframe').length>0);
        const discussion=fp.typeName==='discussionPrompt' && /\bPrompt\b/i.test(text) && fields.length===1;
        if(!plugin && !discussion)continue;
        const identity=typedEditorIdentityV61316(root,fp,courseId);
        if(identity.conflict)continue;
        if(!candidates.some(c=>c.root===root))candidates.push({root,fields,heading: title,titleTag:String(heading.tagName || ''),
          identity:identity.matched?'ITEM_ID_AND_OBSERVED_TITLE':'OBSERVED_TITLE_AND_TYPED_ROUTE',
          itemIdObserved:identity.matched});
        break;
      }
    }
    const smallest=candidates.filter(c=>!candidates.some(other=>other!==c && c.root.contains(other.root)));
    return smallest.length===1?smallest[0]:null;
  }

export function typedEditorDiagnosticsV61316(root, fp, courseId, expectedTitle) {
    // This diagnostic fallback intentionally includes body structure. It never
    // supplies body text, field values, or a fallback evidence root to capture.
    const scope=root || document.body || document.documentElement;
    if(!scope)return {status:'DOCUMENT_NOT_AVAILABLE',nodes:[],evidenceEligible:false};
    const anchors=typedEditorTitleAnchorsV61316(expectedTitle),selected=[],seen=new Set();
    function add(el){if(el && !seen.has(el)){seen.add(el);selected.push(el);}}
    function ancestry(el){for(let p=el,n=0;p && n<12;p=p.parentElement,n++)add(p);}
    const fields=[...scope.querySelectorAll('textarea,input,[contenteditable],[role="textbox"],iframe,pre,code,.view-lines,.cm-content,.CodeMirror-code')];
    fields.slice(0,90).forEach(add);anchors.forEach(add);add(scope);
    fields.slice(0,20).forEach(ancestry);anchors.forEach(ancestry);
    [...scope.querySelectorAll('h1,h2,h3,[role="heading"],[data-testid],[data-item-id],[data-branch-id],button,[role="button"]')].slice(0,120).forEach(add);
    const rows=[];
    for(const el of selected.slice(0,180)){
      const attrs={};
      for(const key of ['id','data-testid','data-item-id','data-course-id','data-branch-id','role','aria-label','contenteditable','name','class','type']){
        const v=el.getAttribute(key);if(v!=null)attrs[key]=String(v).slice(0,240);
      }
      const props=reactPropsForElement(el);
      const keys=props && typeof props==='object'?Object.getOwnPropertyNames(props).filter(k=>! /token|password|cookie|secret|authorization/i.test(k)).slice(0,35):[];
      const row={tag:String(el.tagName || ''),attributes:attrs,visible:isVisibleElement(el),globalChrome:isGlobalChromeElement(el),
        titleAnchor:anchors.includes(el),reactPropKeys:keys,ancestorTags:[]};
      try{const style=getComputedStyle(el);row.display=String(style.display || '');row.visibility=String(style.visibility || '');}catch(_){}
      for(let p=el.parentElement,n=0;p && n<6;p=p.parentElement,n++)row.ancestorTags.push({tag:String(p.tagName || ''),class:String(p.getAttribute('class') || '').slice(0,160)});
      if(String(el.tagName || '')==='IFRAME'){
        try{const u=new URL(el.getAttribute('src') || '',location.href);row.frameLocation={origin:u.origin,path:u.pathname};}catch(_){}
        try{row.frameAccess=el.contentDocument?'READABLE':'DOCUMENT_UNAVAILABLE';}catch(e){row.frameAccess=e && e.name==='SecurityError'?'CROSS_ORIGIN_UNREADABLE':'INACCESSIBLE';}
      }
      rows.push(row);
    }
    let topLevelDocument=null;try{topLevelDocument=window===window.top;}catch(_){}
    return {status:root?'SCOPED_EDITOR_STRUCTURE':'UNVERIFIED_DOCUMENT_STRUCTURE_ONLY',evidenceEligible:false,
      route:authoringItemRouteV61311(location.href),readyState:String(document.readyState || ''),topLevelDocument,
      requestedItemId:String(fp && fp.id || ''),requestedCourseId:String(courseId || ''),
      titleAnchorCount:anchors.length,fieldCount:fields.length,mainElementCount:document.querySelectorAll('main,[role="main"]').length,
      nodes:rows,truncated:selected.length>180 || fields.length>90};
  }

export function typedEditorNameFieldsV61317() {
    const fields=[];
    for(const root of document.querySelectorAll('[data-testid="itemNameEditor"]')){
      for(const field of root.querySelectorAll('textarea,input')){
        if(field.getAttribute('aria-label')==='Name' && isVisibleElement(field) && !isGlobalChromeElement(field) && !fields.includes(field))fields.push(field);
      }
    }
    return fields;
  }

export function typedEditorProductionSurfaceV61317(fp, courseId, previousNameFields) {
    const route=authoringItemRouteV61311(location.href),type=typedEditorRouteTypeV61316(fp);
    if(!type || !route || route.courseId!==String(courseId) || route.itemId!==String(fp.id) || route.typeName!==type)return null;
    const selector=type==='plugin'?'.rc-WidgetAuthoringTool':'.rc-DiscussionPromptAuthoringTool';
    const candidates=[];
    for(const field of typedEditorNameFieldsV61317()){
      const component=field.closest(selector);
      if(!component)continue;
      const title=String(field.value || '').replace(/\s+/g,' ').trim();
      if(!title || title.length>2048)continue;
      const identity=typedEditorIdentityV61316(component,fp,courseId);
      if(identity.conflict || (!identity.matched && previousNameFields.has(field)))continue;
      const surface=typedEditorSurfaceV61316(fp,courseId,title);
      if(!surface || !surface.root.contains(field) || !component.contains(surface.root))continue;
      // These component classes and the Name field were observed in the live
      // v6.13.16 capture. Dynamic css-* class names are deliberately not used.
      if(type==='plugin' && !surface.root.querySelector('.rc-WidgetEditor'))continue;
      if(type==='discussionPrompt' && !surface.fields[0]?.closest('.rc-DiscussionPromptBodyEditor'))continue;
      candidates.push({...surface,nameField:field,identity:identity.matched?'EXACT_ITEM_ID_AND_TYPED_ROUTE':'FRESH_TYPED_EDITOR_AND_EXACT_ROUTE',
        itemIdObserved:identity.matched,freshEditor:!previousNameFields.has(field)});
    }
    return candidates.length===1?candidates[0]:null;
  }

export function isDangerousEditorControl(el) {
    const blob = normalizeName(elementTextKey(el) + " " + elementAttributeBlob(el));
    return /\b(delete|remove|publish|unpublish|duplicate|move|archive|restore|grading|analytics|invite|permission|settings|reset|submit|save|apply)\b/.test(blob);
  }

export function isGlobalChromeElement(el) {
    if (!el) return false;
    try {
      if (el.closest("header,nav,[role='navigation']")) return true;
    } catch (e) {}
    let cur = el;
    for (let i = 0; cur && i < 6; i++, cur = cur.parentElement) {
      if (cur === document.body || cur === document.documentElement) break;
      const tag = String(cur.tagName || "").toLowerCase();
      const blob = normalizeName(elementAttributeBlob(cur) + " " + (cur.getAttribute && (cur.getAttribute("aria-label") || cur.getAttribute("title") || "")));
      if (tag === "header" || tag === "nav") return true;
      if (/\b(global navigation|main navigation|site navigation|mobile menu|navbar|topbar|app header|navigation menu)\b/.test(blob)) return true;
    }
    return false;
  }

export function countNormalizedOccurrence(haystack, needle) {
    if (!haystack || !needle) return 0;
    let count = 0, pos = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) { count++; pos += Math.max(1, needle.length); }
    return count;
  }

export function clickableAncestor(el) {
    let cur = el;
    for (let i = 0; cur && i < 5; i++, cur = cur.parentElement) {
      if (cur === document.body || cur === document.documentElement) break;
      const tag = String(cur.tagName || "").toLowerCase();
      const role = String(cur.getAttribute && cur.getAttribute("role") || "").toLowerCase();
      if (tag === "button" || tag === "a" || role === "button" || role === "link") return cur;
    }
    return null;
  }

export function isStrongItemIdentityNode(el, fp) {
    if (!el || !isVisibleElement(el) || isGlobalChromeElement(el)) return false;
    const id = String((fp && fp.id) || "").toLowerCase();
    const name = normalizeName(fp && fp.name);
    const attrs = elementAttributeBlob(el);
    const text = elementTextKey(el);
    if (id && attrs.includes(id)) return true;
    if (name && text === name) return true;
    return false;
  }

export function interactiveAncestor(el, fp) {
    let cur = el;
    for (let i = 0; cur && i < 7; i++, cur = cur.parentElement) {
      if (cur === document.body || cur === document.documentElement) break;
      if (!isVisibleElement(cur) || isGlobalChromeElement(cur) || isDangerousEditorControl(cur)) continue;
      const tag = String(cur.tagName || "").toLowerCase();
      const role = String(cur.getAttribute && cur.getAttribute("role") || "").toLowerCase();
      let cursor = "";
      try { cursor = String(getComputedStyle(cur).cursor || "").toLowerCase(); } catch (e) {}
      const attrs = elementAttributeBlob(cur);
      const interactive = tag === "button" || tag === "a" || role === "button" || role === "link" ||
        Number(cur.tabIndex) >= 0 || cursor === "pointer" || /aria-haspopup|data-action|data-testid|data-e2e|onclick/.test(attrs);
      if (!interactive) continue;
      const name = normalizeName(fp && fp.name);
      const text = normalizeName(cur.innerText || cur.textContent || "");
      let rect = null;
      try { rect = cur.getBoundingClientRect(); } catch (e) {}
      const compact = text.length <= Math.max(700, name.length * 9) && (!rect || rect.height <= 420);
      const identity = isStrongItemIdentityNode(cur, fp) || (isExactVisibleTitleNode(el, fp) && cur.contains(el) && compact);
      if (identity) return cur;
    }
    return null;
  }

export function elementsAreNear(a, b) {
    if (!a || !b || !isVisibleElement(a) || !isVisibleElement(b)) return false;
    try {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const verticalOverlap = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
      const centerDelta = Math.abs((ar.top + ar.bottom)/2 - (br.top + br.bottom)/2);
      const horizontalGap = Math.max(0, Math.max(ar.left, br.left) - Math.min(ar.right, br.right));
      return verticalOverlap > 0 || (centerDelta <= 90 && horizontalGap <= 700);
    } catch (e) { return false; }
  }

export function reactPropsForElement(el) {
    if (!el) return null;
    try {
      const keys = Object.getOwnPropertyNames(el);
      const propsKey = keys.find(k => k.indexOf("__reactProps$") === 0);
      if (propsKey && el[propsKey] && typeof el[propsKey] === "object") return el[propsKey];
      const fiberKey = keys.find(k => k.indexOf("__reactFiber$") === 0);
      let fiber = fiberKey ? el[fiberKey] : null;
      for (let i = 0; fiber && i < 4; i++, fiber = fiber.return) {
        if (fiber.memoizedProps && typeof fiber.memoizedProps === "object") return fiber.memoizedProps;
      }
    } catch (e) {}
    return null;
  }
