import { isCourseraUiAssetUrl } from "./assets.js";
import { MAX_EMBEDDED_STATE_SCRIPTS, MAX_TEXT_SAMPLE } from "./config.js";
import { isVisibleElement } from "./text-and-dom-3.js";
import { isGlobalChromeElement, reactPropsForElement } from "./text-and-dom-4.js";
import { enrichFromObservedObject, extractConfiguredExternalUrls, isAuthoringChromeUrl } from "./text-and-dom.js";

export function collectEmbeddedPageState(fingerprints) {
    let parsedCount = 0, enriched = 0;
    const scripts = [...document.scripts].slice(0, 200);
    for (const script of scripts) {
      if (parsedCount >= MAX_EMBEDDED_STATE_SCRIPTS) break;
      const type = String(script.type || "").toLowerCase();
      const text = String(script.textContent || "").trim();
      if (!text || text.length > 5000000) continue;
      if (!(type.includes("json") || /^[\[{]/.test(text))) continue;
      try {
        const parsed = JSON.parse(text);
        parsedCount++;
        const before = (fingerprints || []).reduce((n, fp) => n + (fp.evidenceSources || []).length, 0);
        enrichFromObservedObject(parsed, fingerprints, "embedded-page-state");
        const after = (fingerprints || []).reduce((n, fp) => n + (fp.evidenceSources || []).length, 0);
        if (after > before) enriched++;
      } catch (e) {}
    }
    return { parsedScripts: parsedCount, enrichedScripts: enriched };
  }

export function visiblePluginConfigurationV61316(root) {
    const result = {values:[], editorCount:0, parseFailures:0, truncated:false};
    if (!root || !root.querySelectorAll) return result;
    const marker=String(root.innerText || root.textContent || '');
    if (!/\bChoose Plugin\b/i.test(marker) || !/\b(?:Edit Configuration|Save Configuration|configuration JSON)\b/i.test(marker)) return result;
    const fields=[...root.querySelectorAll('textarea,[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""],[role="textbox"],pre,code,.view-lines,.cm-content,.CodeMirror-code')];
    result.truncated=fields.length>40;
    const seen=new Set();
    for(const el of fields.slice(0,40)) {
      if(!isVisibleElement(el) || isGlobalChromeElement(el))continue;
      const value=String(el.value || el.innerText || el.textContent || '').replace(/[\u200b-\u200d\ufeff]/g,'').trim();
      if(!/^[\[{]/.test(value) || seen.has(value))continue;
      seen.add(value);result.editorCount++;
      if(value.length>64000){result.truncated=true;continue;}
      try {const parsed=JSON.parse(value);if(parsed && typeof parsed==='object')result.values.push(parsed);}
      catch(_){result.parseFailures++;}
    }
    return result;
  }

export function clearTypedPluginChromeV61317(evidence) {
    if(!evidence || !evidence.pluginEvidence)return evidence;
    // The plugin frame URL is evidence. Choose Plugin / Edit Configuration and
    // visible configuration JSON are not the external resource's learner text.
    const config=evidence.pluginEvidence.visibleConfiguration;
    Object.assign(evidence,{textSample:'',textLength:0,textSha256:'',textConfidence:'none',textEvidencePriority:0,
      textEvidenceCompleteness:0,textScopeKind:config && config.editors?'plugin-configuration-only':'plugin-target-only',
      textCaptureTruncated:false,fullObservedTextLength:0});
    if(evidence._diagnostics)Object.assign(evidence._diagnostics,{bodyScoped:false,textCompleteness:0,textScopeKind:evidence.textScopeKind});
    return evidence;
  }

export function pluginReadinessV6147(evidence) {
    const frames=evidence && evidence.frames || [],targets=evidence && evidence.targets || [];
    const waiting=frames.some(f=>f.access==='DOCUMENT_UNAVAILABLE' ||
      (f.access==='READABLE' && (f.readyState==='loading' || /^(EMPTY|LOADING)$/.test(f.surfaceStatus))));
    const errors=frames.some(f=>f.surfaceStatus==='ACCESS_OR_ERROR_PAGE');
    const blocked=frames.some(f=>/CROSS_ORIGIN|INACCESSIBLE/.test(f.access));
    return {pending:waiting || (!frames.length && !targets.length),
      status:waiting?'FRAME_STILL_LOADING':!frames.length&&!targets.length?'TARGET_NOT_OBSERVED':
        errors?'FRAME_ACCESS_OR_ERROR_PAGE':blocked?'FRAME_CONTENT_UNREADABLE':frames.length?'READABLE_FRAME_OBSERVED':'CONFIGURATION_ONLY',
      readableFrames:frames.filter(f=>f.access==='READABLE' && f.surfaceStatus==='CONTENT_OBSERVED').length,
      unreadableFrames:frames.filter(f=>f.access!=='READABLE').length,
      interactionVerified:false};
  }

export function collectPluginEvidenceV6139(root, fp) {
    if(!root || !fp || !fp.id || !root.querySelectorAll)return null;
    const body=String(root.innerText || root.textContent || '');
    const viewConfiguration=[...root.querySelectorAll('button,a,[role="button"]')].some(el=>
      isVisibleElement(el) && /^View Configuration$/i.test(String(el.innerText || el.textContent || '').trim()));
    const pluginContext=/plugin|\blti\b/i.test(String(fp.type || ''));
    const youtube=/\bChoose Plugin\s+YouTube\b/i.test(body) || (viewConfiguration && pluginContext &&
      [...root.querySelectorAll('div,span,p,label')].some(el=>isVisibleElement(el) && /^YouTube$/i.test(String(el.innerText || el.textContent || '').trim())));
    const webpage=(/\bChoose Plugin\b/i.test(body) || (viewConfiguration && /plugin|\blti\b/i.test(String(fp.type || '')))) && /\bExternal Webpage\b/i.test(body);
    if(!youtube && !webpage && !/plugin|\blti\b/i.test(String(fp.type || '')))return null;
    const out={schemaVersion:1,itemId:String(fp.id),scope:'ITEM_EDITOR',kind:youtube?'YOUTUBE':webpage?'EXTERNAL_WEBPAGE':'PLUGIN',
      targets:[],frames:[],configurationStatus:'NO_TARGET_OBSERVED',launchStatus:'NOT_VERIFIED',playbackStatus:'NOT_OBSERVED',
      limits:{maxFrames:12,maxElements:80,maxConfigNodes:400,maxConfigDepth:6},truncated:false};
    const seenObjects=new WeakSet(),seenFrames=new WeakSet();let nodes=0,elements=0;
    function own(object,key){try{const d=Object.getOwnPropertyDescriptor(object,key);return d && 'value' in d?d.value:undefined;}catch(e){return undefined;}}
    function addUrl(value,method){
      if(typeof value!=='string' || value.length>8192)return;
      let u;try{u=new URL(value,location.href);}catch(e){return;}
      if(!/^https?:$/.test(u.protocol) || u.username || u.password)return;
      if(isAuthoringChromeUrl(u.href) || isCourseraUiAssetUrl(u.href))return;
      if(youtube && !/^(?:www\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(u.hostname))return;
      if(!out.targets.some(t=>t.url===u.href))out.targets.push({url:u.href,method:method});
    }
    function config(value,key,depth,method,parent){
      if(depth>6 || ++nodes>400){out.truncated=true;return;}
      if(typeof value==='string'){
        if(value.length>16384){out.truncated=true;return;}
        if(youtube && /^(?:videoId|youtubeVideoId)$/i.test(key) && /^[A-Za-z0-9_-]{11}$/.test(value)){
          const target=new URL('https://www.youtube.com/watch?v='+value);
          if(parent)for(const k of ['start','startTime','startSeconds','end','endTime','endSeconds','list']){
            const setting=own(parent,k);if(setting!=null && String(setting)!=='')target.searchParams.set(k,String(setting));
          }
          addUrl(target.href,method+':'+key);
        }
        else if(/^(?:url|src|href|videoUrl|launchUrl|targetUrl|webpageUrl|externalUrl)$/i.test(key) && /^https?:\/\//i.test(value))addUrl(value,method+':'+key);
        else if(/^(?:config|configuration|pluginConfig|pluginConfiguration|parameters|launchData)$/i.test(key) && /^\s*[\[{]/.test(value)){try{config(JSON.parse(value),key,depth+1,method);}catch(e){}}
        return;
      }
      if(!value || typeof value!=='object' || seenObjects.has(value))return;
      seenObjects.add(value);
      const itemId=own(value,'itemId');if(itemId!=null && String(itemId)!==String(fp.id))return;
      for(const k of Object.keys(value).slice(0,60)){
        if(/^(?:children|_owner|return|alternate|parent|course|items|material|token|password|authorization|cookie)$/i.test(k))continue;
        const v=own(value,k);
        if(typeof v==='string'||(v&&typeof v==='object'))config(v,k,depth+1,method,value);
      }
    }
    function inspectFrame(frame,depth){
      if(seenFrames.has(frame))return;seenFrames.add(frame);
      if(out.frames.length>=12 || depth>3){out.truncated=true;return;}
      const raw=String(frame.getAttribute('src') || '');
      const record={src:raw,access:'INACCESSIBLE',surfaceStatus:'NOT_OBSERVED',textLength:0};out.frames.push(record);
      if(raw)addUrl(raw,'FRAME_SRC');
      try{
        const url=new URL(raw,location.href);
        for(const [k,v] of url.searchParams)if(/^(?:config|configuration|pluginConfig|parameters|videoId|youtubeVideoId|videoUrl|url|launchUrl)$/i.test(k))config(v,k,0,'FRAME_PARAMETER');
      }catch(e){}
      try{
        const doc=frame.contentDocument;
        if(!doc){
          record.access='DOCUMENT_UNAVAILABLE';
          try{if(new URL(raw,location.href).origin!==new URL(location.href).origin)record.access='CROSS_ORIGIN_UNREADABLE';}catch(e){}
          return;
        }
        record.access='READABLE';record.readyState=String(doc.readyState||'');
        const text=String(doc.body && (doc.body.innerText||doc.body.textContent) || '').trim();
        record.textLength=text.length;record.textPreview=text.slice(0,400);
        record.textSample=text.slice(0,MAX_TEXT_SAMPLE);record.textTruncated=text.length>MAX_TEXT_SAMPLE;
        record.surfaceStatus=!text?'EMPTY':/^(?:loading(?: item)?[.\s…]*|please wait[.\s…]*)$/i.test(text)?'LOADING':
          /^(?:access denied|403 forbidden|404 not found|sign in to continue|log in to continue)\b/i.test(text)?'ACCESS_OR_ERROR_PAGE':'CONTENT_OBSERVED';
        if(record.surfaceStatus!=='CONTENT_OBSERVED')delete record.textSample;
        if(doc.body)visit(doc.body,depth+1);
      }catch(e){record.access=e&&e.name==='SecurityError'?'CROSS_ORIGIN_UNREADABLE':'INACCESSIBLE';}
    }
    function visit(scope,depth){
      const children=Array.from(scope.querySelectorAll('iframe,[data-testid],[data-test]')).slice(0,80);
      for(const el of [scope].concat(children)){
        if(++elements>80){out.truncated=true;return;}
        const props=reactPropsForElement(el);
        if(props && (own(props,'itemId')==null||String(own(props,'itemId'))===String(fp.id))){
          for(const key of ['config','configuration','pluginConfig','pluginConfiguration','parameters','launchData']){
            const v=own(props,key);if(v!=null)config(v,key,0,'SCOPED_REACT_CONFIGURATION');
          }
        }
        if(String(el.tagName||'').toLowerCase()==='iframe')inspectFrame(el,depth);
      }
    }
    const visibleConfiguration=visiblePluginConfigurationV61316(root);
    visibleConfiguration.values.forEach(value=>config(value,'configuration',0,'VISIBLE_CONFIGURATION_JSON'));
    out.visibleConfiguration={editors:visibleConfiguration.editorCount,parseFailures:visibleConfiguration.parseFailures};
    out.truncated=out.truncated || visibleConfiguration.truncated;
    extractConfiguredExternalUrls(root).forEach(u=>addUrl(u,'VISIBLE_URL_FIELD'));
    visit(root,0);
    out.configurationStatus=out.targets.length?'TARGET_OBSERVED':'NO_TARGET_OBSERVED';
    return out;
  }

export function mergePluginEvidenceV6139(current, extra) {
    if(!extra)return current || null;
    if(!current || current.itemId!==extra.itemId)return extra;
    const out=Object.assign({},extra,{targets:[],frames:[]});
    for(const e of [current,extra]){
      for(const t of e.targets||[])if(!out.targets.some(x=>x.url===t.url))out.targets.push(t);
      for(const f of e.frames||[]){const index=out.frames.findIndex(x=>x.src===f.src&&x.access===f.access&&x.surfaceStatus===f.surfaceStatus);if(index<0)out.frames.push(f);else out.frames[index]=f;}
    }
    out.configurationStatus=out.targets.length?'TARGET_OBSERVED':'NO_TARGET_OBSERVED';
    out.truncated=Boolean(current.truncated||extra.truncated||out.targets.length>60||out.frames.length>24);
    out.targets=out.targets.slice(0,60);out.frames=out.frames.slice(0,24);
    return out;
  }
