import { collectCourseraStructuredAssessment, exactAssessmentLayoutV61313 } from "./assessments-4.js";
import { collectCourseraNativeAssignment } from "./assessments-5.js";
import { isStructuredAssessmentFingerprint } from "./assessments.js";
import { assetDescriptor, fileNameFromUrl, isCourseraUiAssetUrl, uniqueAssetDetails } from "./assets.js";
import { MAX_CAPTURED_RESPONSE_CHARS, MAX_TEXT_SAMPLE } from "./config.js";
import { harvestEvidence, mergeEvidence, mergeExactReadingEvidenceV61318 } from "./evidence.js";
import { collectPluginEvidenceV6139 } from "./plugins.js";
import { elementAttributeBlob, hasVisibleLoadingIndicator, isCourseWideNetworkResponse, isPerItemNetworkNoise, readingBodyGuardV61312 } from "./text-and-dom-2.js";
import { cleanDiscussionPromptTextV6612, collectSurfaceBodyText, editorSurfaceSignalScore, isGenericSmartIngestionName, isVisibleElement, surfaceRoleBonus } from "./text-and-dom-3.js";
import { detectCourseraIngestionFailure } from "./text-and-dom-4.js";
import { extractConfiguredExternalUrls, isAuthoringChromeUrl, normalizeName, shouldUseDomResourceElement, unique } from "./text-and-dom.js";

export function mergeReadingRecoveryV61311(fp, recovery) {
    if (!recovery || !recovery.captured || !recovery.evidence) return false;
    const evidence=recovery.evidence;
    fp.payload=fp.payload || {};
    mergeExactReadingEvidenceV61318(fp,evidence);
    fp.payload.readingEditorEvidence=evidence.readingEditorEvidence;
    fp.payload.readingAttachmentEvidence=evidence.readingAttachmentEvidence || null;
    if(!evidence.textCaptureEvidence){
      fp.payload.textCaptureTruncated=Boolean(evidence.textCaptureTruncated);
      fp.payload.fullObservedTextLength=Number(evidence.fullObservedTextLength || 0);
      fp.payload.readingCaptureGap=String(evidence.readingCaptureGap || '');
    }
    fp.evidenceSources=unique([...(fp.evidenceSources || []),'active-editor-surface'],50);
    return true;
  }

export function evidenceHasUsefulPayload(evidence) {
    if (!evidence) return false;
    return Boolean((evidence.assetDetails || []).length || (evidence.links || []).length || String(evidence.textSample || "").trim() || evidence.published === true || evidence.published === false);
  }

export function installReadOnlyNetworkRecorder() {
    const records=[],pending=new Set(),ownersByItem=new Map();
    const bodyReaders=new Map();
    const copyStats={oversize:0,timedOut:0,released:0,unreadable:0};
    let activeItem=null,stopped=false,ignoredNoise=0,ignoredCourseWide=0;
    // Counts are retained string characters, not a measurement of browser heap.
    let retainedChars=0,peakRetainedChars=0,releasedRecords=0,releasedChars=0,lateResponsesIgnored=0;
    function releasedOwner(owner) {
      if(owner && owner.released){lateResponsesIgnored++;return true;}
      return false;
    }
    function releaseFor(fp) {
      const id=String(fp && fp.id || ''),owners=ownersByItem.get(id);
      if(owners)for(const owner of owners)owner.released=true;
      ownersByItem.delete(id);
      if(activeItem && activeItem.id===id)activeItem=null;
      for(const copy of bodyReaders.values())if(copy.owner.id===id)copy.cancel('released');
      let count=0,chars=0,pendingAtRelease=0;
      for(let i=records.length-1;i>=0;i--)if(records[i].itemId===id){
        const rec=records[i];count++;chars+=rec.text.length+rec.requestBody.length;
        // Harvested evidence is already merged. Also clear strings in record
        // objects referenced by the just-finished item's temporary arrays.
        rec.text='';rec.requestBody='';records.splice(i,1);
      }
      for(const token of pending)if(token.owner.id===id){pendingAtRelease++;pending.delete(token);}
      retainedChars-=chars;releasedRecords+=count;releasedChars+=chars;
      return {releasedRecords:count,releasedChars:chars,pendingAtRelease,retainedRecords:records.length,retainedChars};
    }
    const nativeFetch=window.fetch;
    const xhrProto=window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    const nativeXhrOpen=xhrProto && xhrProto.open,nativeXhrSend=xhrProto && xhrProto.send;
    function requestBodyText(body) {
      if(body==null)return '';
      try {
        if(typeof body==='string')return body.slice(0,120000);
        if(body instanceof URLSearchParams)return body.toString().slice(0,120000);
        if(body instanceof FormData){const parts=[];for(const [k,v] of body.entries())parts.push(k+'='+(typeof v==='string'?v:'[file]'));return parts.join('&').slice(0,120000);}
        return JSON.stringify(body).slice(0,120000);
      }catch(_){return '';}
    }
    function startRequest(owner,url,method) {
      if(!owner || stopped || owner.released)return null;
      try {
        const parsed=new URL(url,location.origin);
        if(parsed.origin!==location.origin || method!=='GET' || isPerItemNetworkNoise(parsed.href) || isCourseWideNetworkResponse(parsed.href))return null;
        const direct=parsed.pathname.split('/').some(x=>decodeURIComponent(x)===owner.id) || [...parsed.searchParams.values()].some(x=>x===owner.id);
        if(!direct && !isSessionScopedPayloadEndpoint({url:parsed.href,method}))return null;
        const token={owner};pending.add(token);return token;
      }catch(_){return null;}
    }
    function capture(owner,url,method,reqBody,status,type,text,source) {
      if(!owner || stopped || releasedOwner(owner) || !text || text.length>MAX_CAPTURED_RESPONSE_CHARS)return;
      try {
        const parsed=new URL(url,location.origin);
        if(parsed.origin!==location.origin)return;
        if(isPerItemNetworkNoise(parsed.href)){ignoredNoise++;return;}
        if(isCourseWideNetworkResponse(parsed.href)){ignoredCourseWide++;return;}
        if(!/(json|text|javascript|html|xml)/.test(type))return;
        records.push({itemId:owner.id,itemName:owner.name,url:parsed.href,status,method,
          requestBody:reqBody,contentType:type,text,source,capturedAt:Date.now(),sessionStartedAt:owner.startedAt});
        retainedChars+=text.length+reqBody.length;peakRetainedChars=Math.max(peakRetainedChars,retainedChars);
      }catch(_){}
    }
    async function recordFetchResponse(owner,response,url,method,reqBody) {
      if(!owner || stopped || releasedOwner(owner))return;
      try {
        const parsed=new URL(url || response.url,location.origin);
        if(parsed.origin!==location.origin)return;
        if(isPerItemNetworkNoise(parsed.href)){ignoredNoise++;return;}
        if(isCourseWideNetworkResponse(parsed.href)){ignoredCourseWide++;return;}
        const type=String(response.headers.get('content-type') || '').toLowerCase();
        if(!/(json|text|javascript|html|xml)/.test(type))return;
        const declared=Number(response.headers.get('content-length') || 0);
        if(declared>MAX_CAPTURED_RESPONSE_CHARS){copyStats.oversize++;return;}
        const text=await readResponseCopy(owner,response);
        capture(owner,parsed.href,method,reqBody,response.status,type,text,'fetch');
      }catch(_){}
    }
    async function readResponseCopy(owner,response) {
      // Bound the copied stream before materializing its body. Cancelling a
      // clone's reader must never abort Coursera's original response/request.
      let reader,timer,ended=false,cancelled=false;
      function cancel(reason) {
        if(ended || cancelled)return;
        cancelled=true;copyStats[reason]++;
        try {Promise.resolve(reader.cancel()).catch(()=>{});}catch(_){}
        if(reader)bodyReaders.delete(reader);
      }
      try {
        const clone=response.clone();
        if(!clone.body || typeof clone.body.getReader!=='function' || typeof TextDecoder!=='function'){
          copyStats.unreadable++;return null;
        }
        reader=clone.body.getReader();bodyReaders.set(reader,{owner,cancel});
        timer=setTimeout(()=>cancel('timedOut'),12000);
        const decoder=new TextDecoder(),pieces=[];let chars=0;
        while(true){
          const chunk=await reader.read();
          if(cancelled)return null;
          if(owner.released || stopped){cancel('released');return null;}
          const value=chunk.done?decoder.decode():decoder.decode(chunk.value,{stream:true});
          chars+=value.length;
          if(chars>MAX_CAPTURED_RESPONSE_CHARS){cancel('oversize');return null;}
          if(value)pieces.push(value);
          if(chunk.done){ended=true;return pieces.join('');}
        }
      }catch(_){if(!cancelled)cancel('unreadable');return null;}
      finally {
        clearTimeout(timer);
        if(reader){bodyReaders.delete(reader);try {reader.releaseLock();}catch(_) {}}
      }
    }
    const wrappedFetch=async function(input,init) {
      // Ownership is fixed before the request, including while clone.text() waits.
      const owner=activeItem;
      const method=String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const url=typeof input==='string'?input:(input && input.url) || (input instanceof URL?input.href:'');
      const reqBody=requestBodyText(init && init.body);
      const token=startRequest(owner,url,method);
      try {
        const response=await nativeFetch.call(window,input,init);
        recordFetchResponse(owner,response,url || response.url,method,reqBody).finally(()=>pending.delete(token));
        return response;
      }catch(error){pending.delete(token);throw error;}
    };
    window.fetch=wrappedFetch;
    let wrappedOpen,wrappedSend;
    if(xhrProto && nativeXhrOpen && nativeXhrSend) {
      wrappedOpen=function(method,url){this.__ctiMethod=String(method || 'GET').toUpperCase();this.__ctiUrl=String(url || '');return nativeXhrOpen.apply(this,arguments);};
      wrappedSend=function(body) {
        const owner=activeItem,url=this.__ctiUrl,method=this.__ctiMethod || 'GET',reqBody=requestBodyText(body);
        const token=startRequest(owner,url,method),xhr=this;
        function loaded(){
          if(!owner || stopped || releasedOwner(owner))return;
          try {
            const type=String(xhr.getResponseHeader('content-type') || '').toLowerCase();
            const text=!xhr.responseType || xhr.responseType==='text'?String(xhr.responseText || ''):xhr.responseType==='json'?JSON.stringify(xhr.response || null):'';
            capture(owner,url,method,reqBody,xhr.status,type,text,'xhr');
          }catch(_){}
        }
        function cleanup(){pending.delete(token);xhr.removeEventListener('load',loaded);xhr.removeEventListener('loadend',cleanup);}
        xhr.addEventListener('load',loaded);xhr.addEventListener('loadend',cleanup);
        try{return nativeXhrSend.apply(this,arguments);}catch(error){cleanup();throw error;}
      };
      xhrProto.open=wrappedOpen;xhrProto.send=wrappedSend;
    }
    return {
      setActive(fp){
        if(stopped)return;
        activeItem=fp?{id:String(fp.id || ''),name:String(fp.name || ''),startedAt:Date.now(),released:false}:null;
        if(activeItem){
          if(!ownersByItem.has(activeItem.id))ownersByItem.set(activeItem.id,new Set());
          ownersByItem.get(activeItem.id).add(activeItem);
        }
      },
      releaseFor,
      takeFor(fp){return records.filter(r=>r.itemId===String(fp && fp.id || ''));},
      fetchObservedAsset(url,options) {
        const u=new URL(url,location.href);
        if(u.origin!==location.origin || !/^\/api\/assets\.v1(?:\/|$)/i.test(u.pathname) || options.method!=='GET')throw Error('Only observed same-origin asset metadata GETs are allowed.');
        return nativeFetch.call(window,u.href,options);
      },
      pendingFor(fp){let count=0;for(const request of pending)if(request.owner.id===String(fp && fp.id || ''))count++;return count;},
      stats(){return {ignoredNoise,ignoredCourseWide,pendingRequests:pending.size,
        activeResponseCopies:bodyReaders.size,responseCopyLimits:Object.assign({},copyStats),
        retainedRecords:records.length,retainedChars,peakRetainedChars,releasedRecords,releasedChars,lateResponsesIgnored};},
      restore(){stopped=true;for(const id of [...ownersByItem.keys()])releaseFor({id});activeItem=null;pending.clear();if(window.fetch===wrappedFetch)window.fetch=nativeFetch;if(xhrProto && xhrProto.open===wrappedOpen)xhrProto.open=nativeXhrOpen;if(xhrProto && xhrProto.send===wrappedSend)xhrProto.send=nativeXhrSend;}
    };
  }

export function evidenceFromCapturedRecord(record) {
    if (!record || !record.text || isPerItemNetworkNoise(record.url) || isCourseWideNetworkResponse(record.url)) return null;
    let evidence = null;
    try { evidence = harvestEvidence(JSON.parse(record.text)); }
    catch (e) { evidence = harvestEvidence({ html: record.text }); }
    if (!evidence || !evidenceHasUsefulPayload(evidence)) return null;

    // Presence can be strong; absence from an arbitrary response is not proof.
    if ((evidence.assetDetails || []).length) evidence.assetEvidenceConfidence = Math.max(Number(evidence.assetEvidenceConfidence || 0), 0.97);
    if ((evidence.links || []).length) evidence.linkEvidenceConfidence = Math.max(Number(evidence.linkEvidenceConfidence || 0), 0.92);
    // Keep harvestEvidence's native text confidence. Never promote generic response
    // metadata to a high-confidence learner-facing body simply because it was captured.
    evidence.textEvidencePriority = String(evidence.textConfidence || "").toLowerCase() === "high" ? 85 : 40;
    evidence.evidenceSources = ["active-crawl-network"];
    return evidence;
  }

export function isHeavyHydrationFingerprint(fp) {
    const blob = normalizeName([fp && fp.type, fp && fp.typeName, fp && fp.name].filter(Boolean).join(" "));
    return isStructuredAssessmentFingerprint(fp) ||
      /\b(workbook|glossary|rubric|assessment|resources|resource|syllabus|iap|pdf|file|document|presentation)\b/.test(blob);
  }

export function quickRootEvidenceSnapshot(root, fp) {
    const snap = { files:0, links:0, frames:0, textLength:0, textScope:"", textCompleteness:0, loading:false, signature:"" };
    if (!root || !root.querySelectorAll || !isVisibleElement(root)) return snap;
    const files = [], links = [], frames = [];
    try {
      root.querySelectorAll("a[href],img[src],source[src],video[src],audio[src],iframe[src],embed[src],object[data]").forEach(el => {
        const raw = el.getAttribute("href") || el.getAttribute("src") || el.getAttribute("data") || "";
        if (!raw) return;
        let abs = raw;
        try { abs = new URL(raw, location.href).href; } catch (e) {}
        if (!shouldUseDomResourceElement(el, abs)) return;
        const isFile = /\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i.test(abs);
        if (isFile) files.push(abs.split("#")[0].split("?")[0]);
        if (el.matches("a[href]") && !isAuthoringChromeUrl(abs)) links.push(abs.split("#")[0]);
        if (el.matches("iframe[src],embed[src],object[data]")) frames.push(abs.split("#")[0]);
      });
    } catch (e) {}
    const body = collectSurfaceBodyText(root, fp);
    snap.files = unique(files, 500).length;
    snap.links = unique(links, 500).length;
    snap.frames = unique(frames, 200).length;
    snap.textLength = String(body.text || "").length;
    snap.textScope = String(body.scopeKind || "");
    snap.textCompleteness = Number(body.completeness || 0);
    snap.loading = hasVisibleLoadingIndicator(root);
    // Keep the signature lightweight and deterministic; final evidence collection
    // still performs the full scoped extraction/hash path once stability is reached.
    const tail = String(body.text || "").replace(/\s+/g, " ").slice(-220);
    snap.signature = [snap.files, snap.links, snap.frames, snap.textLength, snap.textScope,
      Math.round(snap.textCompleteness * 100), tail].join("|");
    return snap;
  }

export function quickNetworkEvidenceSnapshot(recorder, fp, initialCount, summaryCache) {
    const records = recorder.takeFor(fp).slice(initialCount);
    let useful = 0, files = 0, links = 0, text = 0;
    const paths = [];
    for (const rec of records.slice(-40)) {
      let entry=summaryCache && summaryCache.get(rec);
      if(!entry || entry.text!==rec.text || entry.url!==rec.url || entry.status!==rec.status) {
        const evidence=evidenceFromCapturedRecord(rec);
        entry={text:rec.text,url:rec.url,status:rec.status,present:Boolean(evidence),
          a:evidence?(evidence.assetDetails || []).length:0,
          l:evidence?(evidence.links || []).length:0,
          t:evidence?String(evidence.textSample || '').length:0};
        if(summaryCache)summaryCache.set(rec,entry);
      }
      if (!entry.present) continue;
      const a=entry.a,l=entry.l,t=entry.t;
      if (a || l || t) useful++;
      files += a; links += l; text = Math.max(text, t);
      try { paths.push(new URL(rec.url, location.origin).pathname); } catch (e) {}
    }
    return {
      records: records.length,
      useful,
      files,
      links,
      text,
      signature: [records.length, useful, files, links, text, unique(paths, 20).join(",")].join("|")
    };
  }

export function isSessionScopedPayloadEndpoint(record) {
    if (!record || String(record.method || "GET").toUpperCase() !== "GET") return false;
    let path = String(record.url || "").toLowerCase();
    try { path = String(new URL(record.url, location.origin).pathname || "").toLowerCase(); } catch (e) {}
    return /\/api\/assets\.v1(?:\/|$)|\/api\/authoringitemcontentrelations\.v1\/|\/api\/authoringatoms\.v2\//.test(path);
  }

export function sanitizeSessionPayloadEvidence(evidence, options) {
    options = options || {};
    if (!evidence) return null;
    const details = (evidence.assetDetails || []).filter(d => {
      const url = String(d && d.url || "");
      const name = String(d && d.name || "");
      if (isCourseraUiAssetUrl(url || name)) return false;
      return /\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i.test(url || name);
    });
    const links = (evidence.links || []).filter(u => !isAuthoringChromeUrl(u) && !isCourseraUiAssetUrl(u));
    if (!details.length && !links.length) return null;
    return {
      files: unique(details.map(d => d.url || d.name).filter(Boolean), 500),
      links: unique(links, 500),
      images: unique((evidence.images || []).filter(u => !isCourseraUiAssetUrl(u)), 500),
      embeddedRefs: unique(details.map(d => d.url || d.assetId || "").filter(Boolean), 500),
      assetDetails: uniqueAssetDetails(details, 800),
      assetEvidenceConfidence: details.length ? Math.max(0.97, Number(evidence.assetEvidenceConfidence || 0)) : 0.79,
      linkEvidenceConfidence: links.length ? Math.max(0.92, Number(evidence.linkEvidenceConfidence || 0)) : 0.74,
      textSample: options.allowText && String(evidence.textSample || "").length >= 40 ? String(evidence.textSample || "").slice(0, MAX_TEXT_SAMPLE) : "",
      textLength: options.allowText && String(evidence.textSample || "").length >= 40 ? String(evidence.textSample || "").slice(0, MAX_TEXT_SAMPLE).length : 0,
      textSha256: "",
      textConfidence: options.allowText && String(evidence.textSample || "").length >= 40 ? String(evidence.textConfidence || "low") : "none",
      textEvidencePriority: options.allowText && String(evidence.textSample || "").length >= 40 ? 82 : 0,
      textEvidenceCompleteness: options.allowText && String(evidence.textSample || "").length >= 40 ? 0.72 : 0,
      textScopeKind: options.allowText && String(evidence.textSample || "").length >= 40 ? "strong-session-atom" : "",
      published: null,
      evidenceSources: ["active-crawl-session-network"]
    };
  }

export function startDomMutationCapture() {
    const changed = new Set();
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.target && mutation.target.nodeType === 1) changed.add(mutation.target);
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(node => { if (node && node.nodeType === 1) changed.add(node); });
        }
      }
    });
    try {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class","style","hidden","aria-hidden","aria-expanded","aria-selected","data-state"]
      });
    } catch (e) {}
    return {
      stop() {
        try { observer.disconnect(); } catch (e) {}
        return [...changed];
      }
    };
  }

export function genericSurfaceNeedsPayloadUpgrade(fp, surface) {
    if (!isGenericSmartIngestionName(fp)) return false;
    if (!surface || !surface.root) return true;
    // Generic atom labels do not make an exact, mounted assignment layout
    // incomplete. Stabilize this editor instead of activating its row again.
    if (exactAssessmentLayoutV61313(surface.root,fp)) return false;
    return Number(surface.score || 0) < 0.98;
  }

export function scoreSurfaceForFingerprint(root, fp, strongSessionIdentity) {
    if (!root || !isVisibleElement(root)) return 0;
    const id = String((fp && fp.id) || "").toLowerCase();
    const name = normalizeName(fp && fp.name);
    const attrs = elementAttributeBlob(root);
    const textRaw = String(root.innerText || root.textContent || "").slice(0, 40000);
    const text = normalizeName(textRaw);
    let score = surfaceRoleBonus(root);
    if (id && attrs.includes(id)) score = Math.max(score, 0.99);
    if (name && text === name) score = Math.max(score, 0.98);
    else if (name && text.includes(name)) score = Math.max(score, 0.93);
    try {
      const headingText = normalizeName([...root.querySelectorAll("h1,h2,h3,[role='heading']")].map(x => x.innerText || x.textContent || "").join(" "));
      if (name && headingText.includes(name)) score = Math.max(score, 0.97);
    } catch (e) {}
    try {
      if (root.querySelector("textarea,[contenteditable='true'],iframe,input,select")) score += 0.02;
    } catch (e) {}
    // v6.6.5: untouched Smart Ingestion shells frequently expose generic base names
    // (Untitled/New Reading) even though the exact outline row was identified by a
    // stable Coursera item ID. In that bounded strong-ID session, accept a newly
    // opened surface only when it also has independent editor/type signals.
    if (strongSessionIdentity && isGenericSmartIngestionName(fp)) {
      const editorSignal = editorSurfaceSignalScore(root, fp);
      if (editorSignal >= 0.55) score = Math.max(score, Math.min(0.97, 0.90 + editorSignal * 0.07));
    }
    return Math.min(1, score);
  }

export function isDiscussionFingerprintV6612(fp) {
    const blob = normalizeName([fp && fp.type, fp && fp.typeName, fp && fp.name].filter(Boolean).join(" "));
    return /discussion|discussionprompt/.test(blob);
  }

export function normalizeDiscussionBodyEvidenceV6612(fp, evidence) {
    evidence = evidence || { text:"", confidence:"none", priority:0, scoped:false, completeness:0, scopeKind:"none" };
    if (!isDiscussionFingerprintV6612(fp) || evidence.scopeKind === "discussion-prompt-field") return evidence;
    const cleaned = cleanDiscussionPromptTextV6612(evidence.text);
    if (!cleaned.changed || !cleaned.text) return evidence;

    const next = Object.assign({}, evidence, {
      text: cleaned.text.slice(0, MAX_TEXT_SAMPLE),
      confidence: "high",
      priority: Math.max(97, Number(evidence.priority || 0)),
      scoped: true,
      // Once a known authoring boundary is removed, the remaining text is the
      // bounded learner prompt itself. Short discussion prompts are valid content,
      // so do not penalize them merely for being <80 characters.
      completeness: Math.max(Number(evidence.completeness || 0), cleaned.chromeStripped ? 0.97 : 0.94),
      scopeKind: "discussion-prompt",
      discussionPromptCleanup: true,
      discussionChromeStripped: cleaned.chromeStripped,
      discussionOriginalTextLength: cleaned.originalLength
    });
    return next;
  }

export function mergeCourseraLearnerText(parts) {
    const clean = (parts || []).map(x => String(x || "").replace(/\s+/g," ").trim()).filter(Boolean);
    const kept = [];
    clean.forEach(part => {
      const n = normalizeName(part);
      if (!n) return;
      // Do not repeat a prompt already contained inside fuller directions or
      // expectations. Prefer the more informative learner-facing segment.
      for (let i=kept.length-1; i>=0; i--) {
        const kn = normalizeName(kept[i]);
        if (kn.includes(n)) return;
        if (n.includes(kn)) kept.splice(i,1);
      }
      kept.push(part);
    });
    return kept.join(" ").replace(/\s+/g," ").trim().slice(0,30000);
  }

export function mergeTypedEditorRecoveryV61317(fp, recovery) {
    if(!recovery?.captured || !recovery.evidence?.typedEditorEvidence)return false;
    const evidence=recovery.evidence;
    fp.payload=fp.payload || {};
    const p=fp.payload,oldText=String(p.textSample || '');
    const clearOldPluginText=evidence.pluginEvidence && (
      /^(?:generic-root|plugin-target-only|plugin-configuration-only)$/.test(p.textScopeKind || '') ||
      /^(?:atom~)?[A-Za-z0-9_-]{12,}(?:@\d+)?$/.test(oldText.trim()) || Number(p.textEvidencePriority || 0)<=20);
    mergeEvidence(p,evidence,'active-typed-editor');
    if(clearOldPluginText)for(const key of ['textSample','textLength','textSha256','textConfidence','textEvidencePriority','textEvidenceCompleteness','textScopeKind','textCaptureTruncated','fullObservedTextLength'])p[key]=evidence[key];
    p.typedEditorEvidence=evidence.typedEditorEvidence;
    fp.observedTitle=evidence.typedEditorEvidence.observedTitle;
    fp.evidenceSources=unique([...(fp.evidenceSources || []),'active-typed-editor'],50);
    return true;
  }

export function collectDomEvidenceFromRoot(root, sourceLabel, fp) {
    if (!root) return null;
    const files = [], links = [], images = [], details = [];
    let filteredUiAssets = 0, filteredChromeLinks = 0, launchUrlsFound = 0;
    root.querySelectorAll("a[href],img[src],source[src],video[src],audio[src],iframe[src],embed[src],object[data]").forEach(el => {
      const raw = el.getAttribute("href") || el.getAttribute("src") || el.getAttribute("data") || "";
      if (!raw) return;
      let abs = raw;
      try { abs = new URL(raw, location.href).href; } catch (e) {}
      if (!shouldUseDomResourceElement(el, abs)) {
        if (isCourseraUiAssetUrl(abs)) filteredUiAssets++;
        return;
      }
      const isAnchor = el.matches("a[href]");
      const isFrameLike = el.matches("iframe[src],embed[src],object[data]");
      const isVisualMedia = el.matches("img[src],source[src],video[src],audio[src]");
      const isFileUrl = /\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i.test(abs);

      if (isAnchor) {
        if (isAuthoringChromeUrl(abs)) filteredChromeLinks++;
        else links.push(abs);
      }

      // Plugin/external-webpage editors often expose the learner destination as an
      // iframe/embed src rather than an <a> or URL input. That is strong launch-link
      // evidence and should not be misclassified as an "image".
      if (isFrameLike && /^https?:/i.test(abs) && !isAuthoringChromeUrl(abs) && !isFileUrl) {
        links.push(abs);
        launchUrlsFound++;
      }
      if (isVisualMedia || (isFrameLike && isFileUrl)) images.push(abs);

      if (isFileUrl) {
        files.push(abs);
        details.push(assetDescriptor({ url: abs, name: fileNameFromUrl(abs) }, sourceLabel || "active-editor-surface"));
      }
    });

    const pluginEvidence = collectPluginEvidenceV6139(root,fp);
    const configuredUrls = extractConfiguredExternalUrls(root).concat(pluginEvidence ? pluginEvidence.targets.map(t=>t.url) : []);
    configuredUrls.forEach(u => links.push(u));
    const bodyEvidenceRaw = readingBodyGuardV61312(collectSurfaceBodyText(root, fp), root, fp);
    const bodyEvidence = normalizeDiscussionBodyEvidenceV6612(fp, bodyEvidenceRaw);
    const structuredAssessment = collectCourseraStructuredAssessment(root, fp);
    const nativeAssignment = collectCourseraNativeAssignment(root, fp, structuredAssessment);
    const ingestionFailure = detectCourseraIngestionFailure(root, fp);
    const cleanDetails = uniqueAssetDetails(details, 800);
    const cleanLinks = unique(links, 500);
    const strongConfiguredLink = Boolean(configuredUrls.length || launchUrlsFound);
    return {
      files: unique(files, 500),
      links: cleanLinks,
      images: unique(images, 500),
      embeddedRefs: unique(files, 500),
      assetDetails: cleanDetails,
      // High confidence now means learner/content assets were actually observed,
      // not merely that Coursera chrome happened to contain icons/logos.
      assetEvidenceConfidence: cleanDetails.length ? 0.98 : 0.79,
      linkEvidenceConfidence: cleanLinks.length ? (strongConfiguredLink ? 0.97 : 0.92) : 0.74,
      textSample: bodyEvidence.text,
      textLength: bodyEvidence.text.length,
      textSha256: "",
      textConfidence: bodyEvidence.confidence,
      textEvidencePriority: bodyEvidence.priority,
      textEvidenceCompleteness: Number(bodyEvidence.completeness || 0),
      textScopeKind: String(bodyEvidence.scopeKind || ""),
      textCaptureTruncated: Boolean(bodyEvidence.textCaptureTruncated),
      fullObservedTextLength: Number(bodyEvidence.fullObservedTextLength || 0),
      textCaptureLimit: Number(bodyEvidence.textCaptureLimit || MAX_TEXT_SAMPLE),
      textCaptureEvidence: bodyEvidence.textCaptureEvidence || null,
      readingCaptureGap: String(bodyEvidence.captureGap || ''),
      pluginEvidence: pluginEvidence,
      structuredAssessment: structuredAssessment,
      nativeAssignment: nativeAssignment,
      ingestionFailure: ingestionFailure,
      published: null,
      evidenceSources: [sourceLabel || "active-editor-surface"],
      _diagnostics: {
        filteredUiAssets,
        filteredChromeLinks,
        configuredUrls: configuredUrls.length,
        launchUrls: launchUrlsFound,
        bodyScoped: Boolean(bodyEvidence.scoped),
        textCompleteness: Number(bodyEvidence.completeness || 0),
        textScopeKind: String(bodyEvidence.scopeKind || ""),
        discussionPromptCleanup: Boolean(bodyEvidence.discussionPromptCleanup),
        discussionChromeStripped: Boolean(bodyEvidence.discussionChromeStripped),
        discussionOriginalTextLength: Number(bodyEvidence.discussionOriginalTextLength || 0),
        structuredQuestions: structuredAssessment ? Number(structuredAssessment.questionCount || 0) : 0,
        structuredAnswerEvidence: structuredAssessment ? Number(structuredAssessment.answerEvidenceQuestionCount || 0) : 0,
        nativeRubrics: nativeAssignment ? Number(nativeAssignment.rubricCount || 0) : 0,
        ingestionFailure: ingestionFailure.detected === true
      }
    };
  }
