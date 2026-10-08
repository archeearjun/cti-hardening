import { MAX_REMOTE_ASSET_BYTES, REMOTE_ASSET_FETCH_TIMEOUT_MS } from "./config.js";
import { harvestEvidence } from "./evidence.js";
import { exactReadingEditorV61311, readingAttachmentLabelsV61323 } from "./text-and-dom-2.js";
import { normalizeName, sha256Buffer } from "./text-and-dom.js";

export async function perceptualHashBuffer(buffer, mime) {
    if (!buffer || typeof createImageBitmap !== "function") return "";
    try {
      const bitmap = await createImageBitmap(new Blob([buffer], { type: mime || "application/octet-stream" }));
      const canvas = document.createElement("canvas");
      canvas.width = 9; canvas.height = 8;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, 9, 8);
      if (bitmap.close) bitmap.close();
      const data = ctx.getImageData(0, 0, 9, 8).data;
      const gray = [];
      for (let i = 0; i < data.length; i += 4) gray.push((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114));
      let bits = "";
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[(y * 9) + x] > gray[(y * 9) + x + 1] ? "1" : "0";
      return bits;
    } catch (e) {
      return "";
    }
  }

export function ctiSafeFileToken(value, maxLen = 96) {
    return String(value == null ? "" : value)
      .replace(/\s*\|\s*Coursera.*$/i, "")
      .replace(/^Edit Content\s*\|\s*/i, "")
      .replace(/^\[update\]\s*/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[^A-Za-z0-9._()-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, maxLen) || "COURSE";
  }

export function ctiLocalFileTimestamp(date = new Date()) {
    const pad = n => String(n).padStart(2, "0");
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "p" : "m";
    const abs = Math.abs(offset);
    const zone = `UTC${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${zone}`;
  }

export function fileNameFromUrl(value) {
    let raw = String(value || "").split("#")[0].split("?")[0].replace(/\\/g, "/");
    try { raw = decodeURIComponent(raw); } catch (e) {}
    return raw.split("/").pop() || raw;
  }

export function assetDescriptor(value, sourceLabel) {
    const obj = value && typeof value === "object" ? value : {};
    let url = "";
    if (typeof obj.url === "string") url = obj.url;
    else if (obj.url && typeof obj.url.url === "string") url = obj.url.url;
    url = url || obj.href || obj.src || obj.downloadUrl || obj.assetUrl || "";
    const name = obj.fileName || obj.filename || obj.name || fileNameFromUrl(url || value);
    const size = Number(obj.size || obj.contentLength || obj.fileSize || 0) || 0;
    const mime = String(obj.mimeType || obj.contentType || obj.mime || "");
    const assetId = String(obj.assetId || obj.id || "");
    return {
      name: String(name || ""),
      url: String(url || ""),
      size,
      mime,
      assetId,
      sha256: String(obj.sha256 || ""),
      perceptualHash: String(obj.perceptualHash || obj.dhash || ""),
      hashStatus: String(obj.hashStatus || ""),
      documentRef: String(obj.documentRef || ""),
      evidenceSource: sourceLabel || String(obj.evidenceSource || "")
    };
  }

export function uniqueAssetDetails(values, limit = 800) {
    const seen = new Set(), out = [];
    for (const value of values || []) {
      const d = assetDescriptor(value, value && value.evidenceSource);
      const looksAsset = /\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i.test(d.name || d.url) ||
        /^(image|audio|video)\//i.test(d.mime) || /pdf/i.test(d.mime);
      if (!looksAsset && !d.assetId) continue;
      const key = d.sha256 ? "h:" + d.sha256 : "n:" + normalizeName(d.name) + "|" + d.size + "|" + d.assetId;
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(d);
      if (out.length >= limit) break;
    }
    return out;
  }

export function canonicalRemoteAssetKeyV614(detail) {
    if(!detail || !detail.url)return '';
    try {
      const u=new URL(detail.url,location.origin);
      // Remove delivery credentials only on known CDN domains. Representation
      // parameters (page, width, format, version...) remain part of byte identity.
      if(/(?:^|\.)(?:cloudfront\.net|amazonaws\.com|coursera\.org)$/.test(u.hostname)){
        for(const key of [...u.searchParams.keys()])if(/^(?:Expires|Signature|Key-Pair-Id|Policy|X-Amz-(?:Algorithm|Credential|Date|Expires|SignedHeaders|Signature|Security-Token))$/i.test(key))u.searchParams.delete(key);
      }
      u.hash='';return u.href;
    } catch(_){return String(detail.url);}
  }

export async function hashRemoteAsset(detail, budgetState) {
    if(!detail || !detail.url || detail.sha256)return detail;
    const key=canonicalRemoteAssetKeyV614(detail),cached=budgetState.cache&&budgetState.cache.get(key);
    if(cached){Object.assign(detail,cached,{hashStatus:'SHA256_CACHE'});return detail;}
    if(budgetState.remaining<=0){detail.hashStatus='SKIPPED_BYTE_BUDGET';return detail;}
    const remainingMs=budgetState.deadline==null?Infinity:budgetState.deadline-Date.now();
    if(remainingMs<=0){detail.hashStatus='SKIPPED_STAGE_BUDGET';return detail;}
    const timeoutMs=Math.min(REMOTE_ASSET_FETCH_TIMEOUT_MS,remainingMs),controller=typeof AbortController==='function'?new AbortController():null;
    let timer,reader,expired=false;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;if(controller)controller.abort();if(reader)Promise.resolve(reader.cancel()).catch(()=>{});const e=new Error('Asset deadline');e.name='AbortError';reject(e);},timeoutMs);});
    try {
      const work=(async()=>{
        const u=new URL(detail.url,location.origin),response=await fetch(u.href,{credentials:u.origin===location.origin?'include':'omit',headers:{Accept:'*/*'},signal:controller?controller.signal:undefined});
        if(!response.ok)return {hashStatus:'HTTP_'+response.status};
        const limit=Math.min(MAX_REMOTE_ASSET_BYTES,budgetState.remaining),declared=Number(response.headers.get('content-length')||0);
        if(declared>limit){if(controller)controller.abort();return {hashStatus:'SKIPPED_SIZE'};}
        let buffer;
        if(response.body && typeof response.body.getReader==='function'){
          reader=response.body.getReader();const chunks=[];let size=0;
          while(true){const chunk=await reader.read();if(expired)throw Object.assign(new Error('Asset deadline'),{name:'AbortError'});if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit){await reader.cancel();return {hashStatus:'SKIPPED_SIZE'};}chunks.push(chunk.value);}
          const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}buffer=bytes.buffer;
        }else buffer=await response.arrayBuffer();
        if(expired)throw Object.assign(new Error('Asset deadline'),{name:'AbortError'});
        if(buffer.byteLength>limit)return {hashStatus:'SKIPPED_SIZE'};
        const mime=String(response.headers.get('content-type')||detail.mime||''),sha256=await sha256Buffer(buffer);
        if(expired)throw Object.assign(new Error('Asset deadline'),{name:'AbortError'});
        let perceptualHash='';
        if(/^image\//i.test(mime))perceptualHash=await perceptualHashBuffer(buffer,mime);
        // Reuse already fetched PDF bytes; never make an additional request for this.
        // A bounded, hash-addressed archive lets the local activity importer read
        // every page and provide originals for visual review without embedding keys
        // or credential-bearing delivery URLs in AI packets.
        let documentRef='';
        const pdf = new Uint8Array(buffer);
        if (budgetState.documents && sha256 && pdf.length>=5 && String.fromCharCode(...pdf.subarray(0,5))==='%PDF-') {
          if (budgetState.documents.has(sha256)) documentRef=sha256;
          else if (buffer.byteLength<=Number(budgetState.documentRemaining || 0)) {
            let binary='';for(let offset=0;offset<pdf.length;offset+=16384)binary+=String.fromCharCode(...pdf.subarray(offset,offset+16384));
            budgetState.documents.set(sha256,{sha256,size:pdf.length,mime:'application/pdf',base64:btoa(binary)});
            budgetState.documentRemaining-=pdf.length;documentRef=sha256;
          }
        }
        return {size:buffer.byteLength,mime,sha256,perceptualHash,documentRef,hashStatus:sha256?'SHA256':'UNAVAILABLE'};
      })();
      const result=await Promise.race([work,timeout]);Object.assign(detail,result);
      if(result.size!=null)budgetState.remaining-=result.size;
      // A temporary failure for one signed URL must not poison a later valid URL.
      if(result.sha256&&key&&budgetState.cache)budgetState.cache.set(key,result);
    }catch(e){detail.hashStatus=expired?(timeoutMs===remainingMs?'SKIPPED_STAGE_BUDGET':'FETCH_TIMEOUT'):(e&&e.name==='AbortError'?'FETCH_TIMEOUT':'FETCH_ERROR');}
    finally{clearTimeout(timer);}
    return detail;
  }

export function isCourseraUiAssetUrl(url) {
    const raw = String(url || "");
    if (!raw) return false;
    try {
      const u = new URL(raw, location.href);
      const host = String(u.hostname || "").toLowerCase();
      const path = String(u.pathname || "");
      const name = decodeURIComponent(path.split("/").pop() || "");
      if (/cookielaw\.org$|onetrust\.com$|cdn\.cookielaw\.org$/.test(host)) return true;
      if (/coursera_assets\.s3\.amazonaws\.com$/.test(host) &&
          /^[a-f0-9]{24,}\.(?:svg|png|jpe?g|gif|webp)$/i.test(name)) return true;
      if (/(?:^|[-_])(coursera[-_]?logo|powered[-_]?by[-_]?logo|favicon|sprite)(?:[-_.]|$)/i.test(name)) return true;
      return false;
    } catch (e) {
      return /cookielaw|onetrust|coursera-logo|powered_by_logo|favicon|sprite/i.test(raw);
    }
  }

export function readingAssetRequestsV61324(references,resourceUrls) {
    const ids=new Set((references || []).map(r=>r.assetId).filter(id=>/^[A-Za-z0-9_-]{6,128}$/.test(id))),requests=[],covered=new Set();
    let template=null;
    for(const raw of resourceUrls || []) {
      let u;try{u=new URL(raw,location.href);}catch(_){continue;}
      if(u.origin!==location.origin || !/^\/api\/assets\.v1(?:\/|$)/i.test(u.pathname))continue;
      const single=u.pathname.match(/^\/api\/assets\.v1\/([A-Za-z0-9_-]{6,128})(\/?)$/i);
      if(single && [...u.searchParams.keys()].every(k=>k==='fields' || k==='includes'))template=template || u;
      const tokens=[...u.pathname.split('/'),...u.searchParams.values()].flatMap(x=>{try{return decodeURIComponent(x).split(/[,~]/);}catch(_){return [];}});
      const matches=[...ids].filter(id=>tokens.includes(id));
      if(matches.length){requests.push({url:u.href,assetIds:matches,source:'observed-asset-request'});matches.forEach(id=>covered.add(id));}
    }
    // Reuse an actually observed read-only asset route only for IDs referenced by
    // this exact reading. No item IDs or endpoint families are guessed.
    if(template)for(const id of ids)if(!covered.has(id)) {
      const u=new URL(template.href);u.pathname=u.pathname.replace(/\/([A-Za-z0-9_-]{6,128})(\/?)$/,()=>'/'+id+(u.pathname.endsWith('/')?'/':''));
      requests.push({url:u.href,assetIds:[id],source:'observed-asset-route-with-exact-reading-reference'});
    }
    const uniqueRequests=[],seen=new Set();for(const r of requests)if(!seen.has(r.url)){seen.add(r.url);uniqueRequests.push(r);}
    return {requests:uniqueRequests.slice(0,64),omittedRequests:Math.max(0,uniqueRequests.length-64),
      referencedIds:ids.size,observedEndpoint:!!template || requests.length>0};
  }

export async function recoverReadingAssetUrlsV61324(root,fp,courseIdValue,state,options) {
    const started=Date.now(),deadline=Math.min(started+6500,options.deadline==null?Infinity:Number(options.deadline));
    const out={assets:[],attempted:0,completed:0,statuses:[],omittedRequests:0,unattempted:0,reason:'NO_OBSERVED_ASSET_ROUTE',elapsedMs:0};
    let resources=[];try{resources=performance.getEntriesByType('resource').map(x=>x.name);}catch(_){}
    const plan=readingAssetRequestsV61324(state.references,resources);
    out.referenceCount=plan.referencedIds;out.observedEndpoint=plan.observedEndpoint;out.omittedRequests=plan.omittedRequests;
    if(!plan.requests.length){out.reason=plan.referencedIds?'NO_OBSERVED_ASSET_ROUTE':'NO_ITEM_BOUND_ASSET_REFERENCES';return out;}
    const names=new Set(readingAttachmentLabelsV61323(root.innerText).map(x=>x.toLowerCase()));
    const allowedIds=new Set(state.references.map(x=>x.assetId));
    let next=0,blocked=false;
    const sameField=()=>exactReadingEditorV61311(fp,courseIdValue)?.root===root && !(options.shouldStop && options.shouldStop());
    async function worker(){
      while(next<plan.requests.length && Date.now()<deadline && !blocked && sameField()) {
        const request=plan.requests[next++],controller=new AbortController();out.attempted++;
        const timer=setTimeout(()=>controller.abort(),Math.min(3000,Math.max(1,deadline-Date.now())));
        const status={assetIds:request.assetIds,source:request.source,status:'STARTED'};
        try {
          const fetcher=options.recorder && options.recorder.fetchObservedAsset?options.recorder.fetchObservedAsset:window.fetch.bind(window);
          const response=await fetcher(request.url,{method:'GET',credentials:'same-origin',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
          status.httpStatus=response.status;
          if(response.status===401 || response.status===403){blocked=true;status.status='ACCESS_DENIED';}
          else if(!response.ok)status.status='HTTP_ERROR';
          else if(!/json/i.test(String(response.headers.get('content-type') || '')))status.status='NON_JSON_RESPONSE';
          else if(Number(response.headers.get('content-length') || 0)>2500000)status.status='RESPONSE_SIZE_LIMIT';
          else {
            const text=await response.text();
            if(text.length>2500000)status.status='RESPONSE_SIZE_LIMIT';
            else if(!sameField())status.status='EDITOR_CHANGED';
            else {
              const evidence=harvestEvidence(JSON.parse(text));
              const matched=(evidence.assetDetails || []).filter(a=>allowedIds.has(a.assetId) && request.assetIds.includes(a.assetId) && names.has(String(a.name || '').replace(/\s+/g,' ').trim().toLowerCase()) && /^https?:\/\//i.test(a.url || '') && !isCourseraUiAssetUrl(a.url) && !/\/api\/assets\.v1(?:[/?]|$)/i.test(a.url));
              out.assets.push(...matched.map(a=>({...a,sha256:'',perceptualHash:'',hashStatus:'URL_ONLY',evidenceSource:'exact-reading-reference-api'})));
              status.status=matched.length?'REFERENCED_ASSET_URL_CAPTURED':'NO_MATCHING_ASSET';status.matched=matched.length;
            }
          }
        }catch(error){status.status=controller.signal.aborted?'TIME_LIMIT':'REQUEST_FAILED';}
        finally{clearTimeout(timer);out.completed++;out.statuses.push(status);}
      }
    }
    await Promise.all(Array.from({length:Math.min(4,plan.requests.length)},()=>worker()));
    out.unattempted=plan.requests.length-out.attempted;out.assets=uniqueAssetDetails(out.assets,800);out.elapsedMs=Date.now()-started;
    out.reason=blocked?'ACCESS_DENIED':!sameField()?'EDITOR_CHANGED':out.unattempted?'TIME_LIMIT':'OBSERVED_REQUESTS_FINISHED';
    return out;
  }

export function attachmentFileTypeFromText(raw) {
    const text = String(raw || "");
    const label = text.match(/\b(PDF|DOCX?|PPTX?|XLSX?|CSV|ZIP|PNG|JPE?G|WEBP|MP4|WEBM|MP3|WAV)\s+File\b/i);
    if (label) return String(label[1] || "").toUpperCase().replace(/^DOC$/,"DOC").replace(/^JPE?G$/,"JPG");
    const ext = text.match(/\.([a-z0-9]{2,5})(?:\b|[?#])/i);
    return ext ? String(ext[1] || "").toUpperCase() : "";
  }
