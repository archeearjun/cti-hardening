import { recoverReadingAssetUrlsV61324 } from "./assets.js";
import { collectDomEvidenceFromRoot, evidenceFromCapturedRecord, quickRootEvidenceSnapshot } from "./evidence-2.js";
import { mergeEvidence, readingFrameEvidenceV61311, readingNetworkRecordsV61323 } from "./evidence.js";
import { safelyRestoreRoute } from "./navigation-2.js";
import { directElementTextKey, elementAttributeBlob, elementTextKey, exactIdentityElements, exactReadingEditorV61311, isDocumentScrollRoot, isRejectedItemNavigationUrl, isRejectedNavigationSeed, readingAttachmentCoverageV61323, readingAttachmentStateV61324, readingLoadingOnlyV61312, readingNetworkDiagnosticsV61324, scrollRootMax, scrollRootPosition, setScrollRootPosition, sleepMs } from "./text-and-dom-2.js";
import { isVisibleElement, scopedWaitBudgetV61321, sessionAtomIsRelationPaired } from "./text-and-dom-3.js";
import { isDangerousEditorControl, isGlobalChromeElement } from "./text-and-dom-4.js";
import { normalizeName } from "./text-and-dom.js";

export function readingRouteTemplateV61312(courseOrBranchId) {
    const live=certifiedReadingRouteV61311(courseOrBranchId);
    if (live) return live;
    try {
      const u=new URL(location.href);
      const m=u.pathname.match(/^\/teach\/([^/]+)\/([A-Za-z0-9_-]+)\/content(?:\/|$)/);
      if (!m || m[2]!==String(courseOrBranchId) || !/^https:\/\/(?:www\.)?coursera\.org$/.test(u.origin)) return null;
      // The supplement route was verified by the TRDE120 live trial. For every
      // other target it remains a candidate until its exact field actually mounts.
      return {origin:u.origin,slug:m[1],courseId:m[2],typeName:'supplement',evidence:'validated-supplement-editor-route-pattern'};
    } catch(e) { return null; }
  }

export function authoringItemRouteV61311(raw) {
    try {
      const u = new URL(raw, location.href);
      if (u.origin !== location.origin || !/^https:\/\/(?:www\.)?coursera\.org$/.test(u.origin)) return null;
      const m = u.pathname.match(/^\/teach\/([^/]+)\/([A-Za-z0-9_-]+)\/content\/item\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/?$/);
      if (!m || isRejectedItemNavigationUrl(u.href)) return null;
      return { url:u.href, origin:u.origin, slug:m[1], courseId:m[2], typeName:m[3], itemId:m[4] };
    } catch (e) { return null; }
  }

export function certifiedReadingRouteV61311(courseOrBranchId) {
    const route = authoringItemRouteV61311(location.href);
    if (!route || route.courseId !== String(courseOrBranchId) || route.typeName !== 'supplement') return null;
    if (!exactReadingEditorV61311({id:route.itemId,typeName:'supplement'},courseOrBranchId)) return null;
    return { courseId:route.courseId, origin:route.origin, slug:route.slug, typeName:'supplement', verifiedItemId:route.itemId,
      verifiedAt:new Date().toISOString(), evidence:'rendered-course-plus-item-reading-content-field' };
  }

export function readingRouteForTargetV61311(fp, courseOrBranchId, template) {
    if (!template || !['rendered-course-plus-item-reading-content-field','validated-supplement-editor-route-pattern'].includes(template.evidence) || template.courseId !== String(courseOrBranchId)) return '';
    if (!fp || fp.typeName !== 'supplement' || !/^[A-Za-z0-9_-]+$/.test(String(fp.id || ''))) return '';
    const url = template.origin + '/teach/' + template.slug + '/' + template.courseId + '/content/item/supplement/' + fp.id;
    const route = authoringItemRouteV61311(url);
    return route && route.courseId === String(courseOrBranchId) && route.itemId === String(fp.id) && isSafeCourseRoute(url,courseOrBranchId) ? url : '';
  }

export async function recoverReadingRouteV61311(fp, courseOrBranchId, template, options) {
  options = options || {};
  const route = readingRouteForTargetV61311(fp,courseOrBranchId,template);
  const started = Date.now();
  const waitBudget=scopedWaitBudgetV61321(45000,15000,options.deadline);
  let deadline=Math.min(started+45000,options.deadline==null?Infinity:Number(options.deadline));
  waitBudget.observe([0,0,0,0]);
  const result = {id:String(fp && fp.id || ''),attempted:false,captured:false,route,reason:'NO_CERTIFIED_READING_ROUTE',dwellMs:0,samples:0};
  if (!route) return result;
  if(Date.now()>=deadline){result.reason='TIME_BUDGET_EXHAUSTED';return result;}
  if (options.shouldStop && options.shouldStop()) {result.reason='STOP_REQUESTED';return result;}
  result.attempted = true;
  if ((!options.reuseMounted || !exactReadingEditorV61311(fp,courseOrBranchId)) && !safelyRestoreRoute(route)) {result.reason='ROUTE_DISPATCH_FAILED';return result;}
  let previous = '', stable = 0, fieldSeen = false, fieldStarted = 0, observedRoot = null;
  const networkCache=new WeakMap();let previousNetwork='',networkStable=0;
  let attachmentState=null,stateSampleAt=-Infinity,assetRecovery=null;
  while (Date.now() < deadline) {
    result.samples++;
    if (options.shouldStop && options.shouldStop()) {result.reason='STOP_REQUESTED';break;}
    const current = authoringItemRouteV61311(location.href);
    if (!current || current.courseId !== String(courseOrBranchId) || current.itemId !== String(fp.id) || current.typeName !== 'supplement') {
      result.reason='ROUTE_CHANGED';break;
    }
    const surface = exactReadingEditorV61311(fp,courseOrBranchId);
    if (!surface) {previous='';stable=0;observedRoot=null;}
    else {
      fieldSeen = true;
      if (observedRoot !== surface.root) {observedRoot=surface.root;fieldStarted=Date.now();previous='';stable=0;attachmentState=null;stateSampleAt=-Infinity;assetRecovery=null;}
      const snapshot = quickRootEvidenceSnapshot(surface.root,fp);
      snapshot.loading = snapshot.loading || readingLoadingOnlyV61312(surface.root);
      const network=readingNetworkRecordsV61323(fp,options.recorder,options.initialCount);
      if(!attachmentState || Date.now()-stateSampleAt>=1200) {
        attachmentState=readingAttachmentStateV61324(surface.root,fp,courseOrBranchId);stateSampleAt=Date.now();
      }
      const referenceIds=new Set(attachmentState.references.map(x=>x.assetId));
      const scopedAssets=[...attachmentState.assets,...(assetRecovery && assetRecovery.assets || []).filter(a=>referenceIds.has(a.assetId))];
      const assets=[...scopedAssets];
      for(const rec of network.records) {
        if(/\/authoringAtoms\.v2\//i.test(String(rec.url)) && !sessionAtomIsRelationPaired(rec,network.records))continue;
        if(!networkCache.has(rec))networkCache.set(rec,evidenceFromCapturedRecord(rec));
        const captured=networkCache.get(rec);
        if(captured)assets.push(...(captured.assetDetails || []));
      }
      const attachments=readingAttachmentCoverageV61323(surface.root.innerText,assets);
      waitBudget.observe([snapshot.textLength,snapshot.files,snapshot.links,snapshot.frames,network.processedResponses,attachments.resolvedLabelCount]);
      deadline=waitBudget.extend(400);
      const visibleText=String(surface.root.innerText || surface.root.textContent || '');
      const signature = snapshot.signature + '|' + visibleText.length + '|' + visibleText.slice(0,320) + '|' + visibleText.slice(-320);
      const networkSignature=network.processedResponses+'|'+network.pendingRequests;
      networkStable=networkSignature===previousNetwork?networkStable+1:0;previousNetwork=networkSignature;
      stable = previous && signature === previous && !snapshot.loading ? stable + 1 : 0;
      previous = signature;
      const meaningful = snapshot.textLength > 0 || snapshot.files > 0 || snapshot.links > 0 || snapshot.frames > 0;
      const minimum = meaningful ? 2000 : 10000;
      if(options.recorder && !assetRecovery && attachmentState.references.length && attachments.unresolvedLabels.length && !network.pendingRequests &&
          Date.now()-fieldStarted>=minimum && stable>=3 && !snapshot.loading) {
        assetRecovery=await recoverReadingAssetUrlsV61324(surface.root,fp,courseOrBranchId,attachmentState,{...options,deadline});
        if(!assetRecovery.assets.length)stateSampleAt=-Infinity;
        continue;
      }
      const waitingForAttachments=Boolean(options.recorder && (network.pendingRequests>0 || attachments.unresolvedLabels.length>0));
      const atLimit=Date.now()+400>=deadline;
      if (Date.now()-fieldStarted >= minimum && stable >= 3 && !snapshot.loading && ((!waitingForAttachments && networkStable>=2) || atLimit)) {
        const evidence = collectDomEvidenceFromRoot(surface.root,'active-editor-surface',fp);
        const frames = readingFrameEvidenceV61311(surface.root);
        if(scopedAssets.length)mergeEvidence(evidence,{assetDetails:scopedAssets,files:scopedAssets.map(a=>a.url),links:scopedAssets.map(a=>a.url),assetEvidenceConfidence:.97},'exact-reading-attachment-state');
        const {records:ignoredRecords,...networkReceipt}=network;
        evidence.readingAttachmentEvidence={...readingAttachmentCoverageV61323(evidence.textSample,[...assets,...(evidence.assetDetails || [])]),
          itemId:String(fp.id),courseId:String(courseOrBranchId),network:networkReceipt,
          stateEvidence:attachmentState.diagnostics,
          assetReferences:attachmentState.references,
          requestRecovery:assetRecovery?{...assetRecovery,assets:undefined}:{attempted:0,reason:attachmentState.references.length?'NOT_NEEDED_OR_NETWORK_PENDING':'NO_ITEM_BOUND_ASSET_REFERENCES'},
          networkDiagnostics:readingNetworkDiagnosticsV61324(fp,options.recorder,options.initialCount),
          waitStopReason:waitingForAttachments?'ATTACHMENT_WAIT_LIMIT_REACHED':'SCOPED_NETWORK_SETTLED'};
        if (exactReadingEditorV61311(fp,courseOrBranchId)?.root !== surface.root) {result.reason='EDITOR_CHANGED_DURING_CAPTURE';break;}
        evidence.readingEditorEvidence = {
          observedAt:new Date().toISOString(),courseId:String(courseOrBranchId),itemId:String(fp.id),route:location.href,
          identity:'exact-course-plus-item-reading-content-field',fieldTestId:surface.root.getAttribute('data-testid'),
          textScope:'Reading Content field; external frame text only where accessible',frames,
          unreadFrameCount:frames.filter(x=>x.documentStatus!=='TEXT_CAPTURED').length,
          externalPlaybackVerified:false,wholeCourseVerified:false
        };
        const exactObservedCharacters=Number(evidence.textCaptureEvidence && evidence.textCaptureEvidence.observedCharacters || 0);
        const itemAssets=(evidence.assetDetails || []).length;
        const scopedPayloadAbsent=Number(snapshot.files || 0)===0 && Number(snapshot.links || 0)===0 && Number(snapshot.frames || 0)===0 &&
          attachmentState.references.length===0 && scopedAssets.length===0;
        // Editor chrome can make the quick snapshot look nonempty while the
        // learner field is empty. Wait for the full empty-field dwell instead
        // of returning a two-second observation that can never prove emptiness.
        if(exactObservedCharacters===0 && itemAssets===0 && scopedPayloadAbsent && frames.length===0 &&
            Date.now()-fieldStarted<10000 && !atLimit) {
          await sleepMs(Math.min(400,Math.max(0,deadline-Date.now())));
          continue;
        }
        if(exactObservedCharacters===0 && itemAssets===0 && scopedPayloadAbsent && frames.length===0 &&
           attachments.unresolvedLabels.length===0 && !network.pendingRequests && stable>=3 && networkStable>=2 && Date.now()-fieldStarted>=10000) {
          evidence.emptyReadingEvidence={status:'OBSERVED_STABLE_EMPTY_READING',itemId:String(fp.id),courseId:String(courseOrBranchId),
            scope:'EXACT_READING_FIELD',observedAt:new Date().toISOString(),stableSamples:stable,
            dwellMs:Date.now()-fieldStarted,networkStableSamples:networkStable,unresolvedAttachmentLabels:0,frameCount:0};
        }
        if (!/document-viewer|reading-loading-placeholder/.test(evidence.textScopeKind || '')) evidence.textScopeKind = 'reading-content-field';
        if (evidence.readingEditorEvidence.unreadFrameCount) evidence.textEvidenceCompleteness = Math.min(0.72,Number(evidence.textEvidenceCompleteness || 0));
        if (evidence._diagnostics) {
          evidence._diagnostics.textScopeKind=evidence.textScopeKind;
          evidence._diagnostics.textCompleteness=evidence.textEvidenceCompleteness;
        }
        result.captured=true;result.reason='EXACT_READING_EDITOR_CAPTURED';result.evidence=evidence;
        break;
      }
    }
    deadline=waitBudget.extend(400);
    await sleepMs(Math.min(400,Math.max(0,deadline-Date.now())));
  }
  result.dwellMs=Date.now()-started;
  result.waitBudget=waitBudget.snapshot();
  if (!result.captured && result.reason === 'NO_CERTIFIED_READING_ROUTE') result.reason=fieldSeen?'READING_NOT_STABLE':'EXACT_READING_EDITOR_NOT_FOUND';
  return result;
}

export function canonicalOutlineUrl(rawUrl) {
    try {
      const u = new URL(rawUrl || location.href, location.href);
      const itemRoute=authoringItemRouteV61311(u.href);
      if (itemRoute) u.pathname='/teach/'+itemRoute.slug+'/'+itemRoute.courseId+'/content/edit';
      if (!/\/teach\/[^/]+\/[A-Za-z0-9_-]+\/content\/edit\/?$/i.test(u.pathname)) return u.href;
      ["itemId","changeLog","changelog","history","modal","drawer"].forEach(key => u.searchParams.delete(key));
      u.hash = "";
      return u.href;
    } catch (e) { return String(rawUrl || location.href); }
  }

export function isSafeCourseRoute(url, courseOrBranchId) {
    if (!url) return false;
    try {
      const u = new URL(url, location.origin);
      if (u.origin !== location.origin) return false;
      const href = u.pathname + u.search;
      if (!/\/teach\/[^/]+\/[A-Za-z0-9_-]+\/content/i.test(u.pathname)) return false;
      const coursePath=u.pathname.match(/^\/teach\/[^/]+\/([A-Za-z0-9_-]+)\/content(?:\/|$)/);
      if (!coursePath || (courseOrBranchId && coursePath[1] !== String(courseOrBranchId))) return false;
      if (/delete|remove|publish|settings|preview|grading|analytics|invite|permissions/i.test(href)) return false;
      if (isRejectedItemNavigationUrl(u.href)) return false;
      return true;
    } catch (e) { return false; }
  }

export function routeCandidateFromElement(el, courseOrBranchId) {
    if (!el) return "";
    const candidates = [];
    const directHref = el.getAttribute && el.getAttribute("href");
    if (directHref) candidates.push(directHref);
    const parentAnchor = el.closest && el.closest("a[href]");
    if (parentAnchor && parentAnchor.getAttribute("href")) candidates.push(parentAnchor.getAttribute("href"));

    if (el.attributes) {
      [...el.attributes].forEach(attr => {
        const value = String(attr.value || "").trim();
        if (!value) return;
        if (/href|url|route|path|link|to/i.test(attr.name) || /\/teach\/|\/content/i.test(value)) candidates.push(value);
      });
    }

    for (const raw of candidates) {
      try {
        const abs = new URL(raw, location.href).href;
        if (isSafeCourseRoute(abs, courseOrBranchId)) return abs;
      } catch (e) {}
    }
    return "";
  }

export function findNavigationTargetInCurrentViewport(fp, courseOrBranchId) {
    const id = String((fp && fp.id) || "").toLowerCase();
    const name = normalizeName(fp && fp.name);
    const selectors = [
      "a[href]",
      "button",
      "[role='link']",
      "[role='button']",
      "[data-testid]",
      "[data-e2e]",
      "[data-item-id]",
      "[data-id]"
    ].join(",");
    const elements = [...document.querySelectorAll(selectors)].slice(0, 7000);
    let best = null, bestScore = 0;
    let hiddenIdMatches = 0;

    // Stable item identity gets first priority. Query it separately so a page with
    // thousands of generic buttons cannot push the real item node beyond a slice cap.
    for (const el of exactIdentityElements(fp)) {
      const attrs = elementAttributeBlob(el);
      if (!isVisibleElement(el)) { hiddenIdMatches++; continue; }
      if (!outlineItemIdentityV61532(el,fp,courseOrBranchId)) continue;
      const route = routeCandidateFromElement(el, courseOrBranchId);
      const text = elementTextKey(el);
      let score = 0.997, reason = "visible-attribute-id";
      if (route && authoringItemRouteV61311(route)?.itemId===String(fp.id)) { score = 1; reason = "visible-route-id"; }
      if (score > bestScore) {
        bestScore = score;
        best = { element:el, route, score, reason, tag:String(el.tagName||"").toLowerCase(), text:text.slice(0,240), hiddenIdMatches };
      }
    }

    for (const el of elements) {
      if (isGlobalChromeElement(el) || isRejectedNavigationSeed(el)) continue;
      const attrs = elementAttributeBlob(el);
      if (id && attrs.includes(id) && !isVisibleElement(el)) hiddenIdMatches++;
      if (!isVisibleElement(el)) continue;
      const route = routeCandidateFromElement(el, courseOrBranchId);
      const text = elementTextKey(el);
      let score = 0;
      let reason = "";

      if (id && outlineItemIdentityV61532(el,fp,courseOrBranchId)) {
        score = route && authoringItemRouteV61311(route)?.itemId===String(fp.id) ? 1 : 0.995;
        reason = score===1 ? "visible-route-id" : "visible-attribute-id";
      }
      else if (name && text === name) { score = 0.99; reason = "visible-exact-title"; }
      else if (name && text && (text.includes(name) || name.includes(text)) && Math.min(text.length, name.length) >= 8) {
        const lenPenalty = text.length > Math.max(900, name.length * 10) ? 0.08 : 0;
        score = 0.90 - lenPenalty; reason = "visible-title-containment";
      }

      if (score > bestScore) {
        bestScore = score;
        best = { element:el, route, score, reason, tag:String(el.tagName||"").toLowerCase(), text:text.slice(0,240), hiddenIdMatches };
      }
    }

    if ((!best || bestScore < 0.995) && name && !id) {
      const root = document.querySelector("main,[role='main']") || document.body;
      const textEls = [...root.querySelectorAll("span,div,p,h1,h2,h3,h4,h5,h6,[aria-label],[title]")].slice(0, 16000);
      for (const el of textEls) {
        if (!isVisibleElement(el) || isGlobalChromeElement(el) || isRejectedNavigationSeed(el)) continue;
        const direct = directElementTextKey(el);
        const full = normalizeName(el.innerText || el.textContent || "");
        const key = direct || full;
        if (!key) continue;
        let score = 0, reason = "";
        if (direct === name) { score = 0.999; reason = "visible-direct-title"; }
        else if (full === name) { score = 0.995; reason = "visible-exact-title-fallback"; }
        else if (direct && (direct.includes(name) || name.includes(direct)) &&
                 Math.min(direct.length, name.length) >= 10 && direct.length <= Math.max(220, name.length * 3)) {
          score = 0.91; reason = "visible-direct-title-containment";
        }
        if (score > bestScore) {
          bestScore = score;
          best = { element:el, route:routeCandidateFromElement(el, courseOrBranchId), score, reason, tag:String(el.tagName||"").toLowerCase(), text:key.slice(0,240), hiddenIdMatches };
        }
      }
    }
    if (best) best.hiddenIdMatches = hiddenIdMatches;
    return bestScore >= 0.86 ? best : null;
  }

export function outlineItemIdentityV61532(el,fp,courseOrBranchId) {
    const id=String(fp && fp.id || '');
    if(!id || !el)return false;
    const owner=el.closest && el.closest('[data-item-id]');
    if(owner && owner.getAttribute('data-item-id')!==id)return false;
    const anchor=el.closest && el.closest('a[href]');
    const linked=authoringItemRouteV61311(anchor && anchor.getAttribute('href'));
    if(linked && (linked.itemId!==id || linked.courseId!==String(courseOrBranchId)))return false;
    const route=routeCandidateFromElement(el,courseOrBranchId);
    if(route){
      const parsed=authoringItemRouteV61311(route);
      if(parsed)return parsed.itemId===id && parsed.courseId===String(courseOrBranchId);
      try {if(new URL(route).searchParams.get('itemId')===id)return true;}catch(_){}
    }
    let node=el;
    for(let i=0;node && i<4;i++,node=node.parentElement){
      if(node===document.body || node===document.documentElement)break;
      for(const name of ['data-item-id','data-id','data-rbd-draggable-id']){
        const value=node.getAttribute && node.getAttribute(name);
        if(value!=null && value!=='')return value===id;
      }
      for(const name of ['id','data-testid','data-e2e']){
        const value=String(node.getAttribute && node.getAttribute(name) || '');
        if(value===id)return true;
        const prefix=value.slice(0,Math.max(0,value.length-id.length));
        if(value.endsWith(id) && /^(?:item|item-row|course-item|content-item|material)[-_:]$/.test(prefix))return true;
      }
    }
    return false;
  }

export function outlineScrollRoots() {
    const roots = [];
    const seen = new Set();
    function add(el, score) {
      if (!el || seen.has(el)) return;
      seen.add(el); roots.push({ el, score:Number(score||0) });
    }
    const docRoot = document.scrollingElement || document.documentElement || document.body;
    add(docRoot, 1);
    const main = document.querySelector("main,[role='main']") || document.body;
    const candidates = [main, ...main.querySelectorAll("div,section,main,ul,ol")].slice(0, 5000);
    for (const el of candidates) {
      if (!el || isGlobalChromeElement(el)) continue;
      try {
        const style = getComputedStyle(el);
        const overflowY = String(style.overflowY || "").toLowerCase();
        const range = Number(el.scrollHeight || 0) - Number(el.clientHeight || 0);
        const rect = el.getBoundingClientRect();
        if (range < 180 || rect.height < 160 || rect.width < 250) continue;
        if (!/(auto|scroll|overlay|hidden)/.test(overflowY) && el !== main) continue;
        const score = range + Math.min(2000, rect.height) + (el === main ? 1200 : 0);
        add(el, score);
      } catch (e) {}
    }
    return roots.sort((a,b) => b.score - a.score).slice(0, 6).map(x => x.el);
  }

export function targetPathTokens(fp) {
    const raw = Array.isArray(fp && fp.path) ? fp.path : [String(fp && fp.path || "")];
    return raw.flatMap(value=>String(value).split(/\s*(?:>|\/|\||::)\s*/)).map(normalizeName).filter(Boolean).slice(0, 8);
  }

export function outlineDisclosureInViewportV61532(el) {
    if(!isVisibleElement(el))return false;
    try {
      const rect=el.getBoundingClientRect();
      let left=0,top=0,right=Number(window.innerWidth || 2000),bottom=Number(window.innerHeight || 800);
      for(let node=el.parentElement;node && node!==document.body;node=node.parentElement){
        const style=getComputedStyle(node),box=node.getBoundingClientRect();
        if(/auto|scroll|hidden|clip|overlay/.test(String(style.overflowY || ''))){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
        if(/auto|scroll|hidden|clip|overlay/.test(String(style.overflowX || ''))){left=Math.max(left,box.left);right=Math.min(right,box.right);}
      }
      return rect.bottom>top && rect.top<bottom && rect.right>left && rect.left<right;
    }catch(_){return false;}
  }

export function outlineDisclosureCandidateV61532(el,fp) {
    if(!outlineDisclosureInViewportV61532(el) || isGlobalChromeElement(el) || isDangerousEditorControl(el))return null;
    const controls=String(el.getAttribute && el.getAttribute('aria-controls') || '');
    const label=normalizeName(elementTextKey(el)+' '+elementAttributeBlob(el));
    if(/\b(more|options|actions|menu|navigation|filter|sort|account|profile|expand all|show all|collapse all)\b/.test(label))return null;
    let scope=controls.split(/\s+/).map(id=>document.getElementById(id)).find(Boolean) || null;
    const controlledScope=Boolean(scope);
    if(!scope)scope=el.closest('section,article,[data-module-id],[data-section-id]');
    let surrounding='';
    for(let parent=el.parentElement,depth=0;parent && depth<4;parent=parent.parentElement,depth++){
      if(parent===document.body || parent.matches('main,[role="main"]'))break;
      const headings=[...parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].slice(0,3);
      if(!surrounding)surrounding=headings.map(node=>elementTextKey(node)).join(' ');
      if(parent.querySelectorAll('[aria-expanded]').length>1)break;
      if(!controlledScope && !el.closest('section,article,[data-module-id],[data-section-id]'))scope=parent;
    }
    if(!scope)scope=el.parentElement;
    if(!scope || scope===document.body || scope.matches('main,[role="main"]'))return null;
    const context=normalizeName(label+' '+surrounding);
    const tokens=targetPathTokens(fp);
    const pathHit=tokens.some(token=>token.length>=3 && (' '+context+' ').includes(' '+token+' '));
    const ancestorHit=(fp && fp.ancestors || []).some(ancestor=>{
      const id=String(ancestor && ancestor.id || '');
      return id && [el,scope,el.parentElement].some(node=>node && ['id','data-id','data-item-id','data-module-id','data-section-id'].some(name=>node.getAttribute(name)===id));
    });
    const id=String(fp && fp.id || '');
    const containedId=Boolean(id && [...scope.querySelectorAll('[data-item-id],[data-id],a[href]')].some(node=>
      node.getAttribute('data-item-id')===id || node.getAttribute('data-id')===id || authoringItemRouteV61311(node.getAttribute('href'))?.itemId===id));
    if(!controls && !pathHit && !ancestorHit && !/\b(expand|show|module|week|section|content|resources|start here|student|instructor|course|lesson)\b/.test(context))return null;
    return {element:el,scope,relevant:containedId || ancestorHit || pathHit,
      priority:containedId?3:ancestorHit?2:pathHit?1:0,key:controls || String(el.id || '') || context};
  }

export async function expandSafeOutlineDisclosures(fp,options) {
    options=options || {};
    const deadline=Number.isFinite(Number(options.deadline))?Number(options.deadline):Infinity;
    if(Date.now()>=deadline)return 0;
    const root=options.scope || document.querySelector('main,[role="main"]') || document.body;
    const candidates=[...root.querySelectorAll("button[aria-expanded='false'],[role='button'][aria-expanded='false']")].slice(0,700)
      .map(el=>outlineDisclosureCandidateV61532(el,fp)).filter(candidate=>candidate &&
        (!options.excluded || !options.excluded.has(candidate.key)) && (!options.requireRelevant || candidate.relevant))
      .sort((a,b)=>b.priority-a.priority);
    const candidate=candidates[0];
    if(!candidate)return 0;
    if(options.excluded)options.excluded.add(candidate.key);
    try {
      candidate.element.click();
      options.lastExpansion=candidate;
      await sleepMs(Math.min(250,Math.max(0,deadline-Date.now())));
      return 1;
    }catch(_){return 0;}
  }

export async function expandAllSafeOutlineDisclosures(options) {
    options=options || {};
    const deadline=Number.isFinite(Number(options.deadline))?Number(options.deadline):Infinity;
    const root = document.querySelector("main,[role='main']") || document.body;
    const buttons = [...root.querySelectorAll("button[aria-expanded='false'],[role='button'][aria-expanded='false']")].slice(0, 700);
    let expanded = 0;
    for (const el of buttons) {
      if(Date.now()>=deadline)break;
      if (!isVisibleElement(el) || isGlobalChromeElement(el) || isDangerousEditorControl(el)) continue;
      const label = normalizeName(elementTextKey(el) + " " + elementAttributeBlob(el));
      if (/\b(more|options|actions|menu|navigation|filter|sort|account|profile|publish|grading|settings)\b/.test(label)) continue;
      const controlsRegion = String(el.getAttribute && el.getAttribute("aria-controls") || "");
      const looksOutline = Boolean(controlsRegion) || /\b(expand|show|module|week|section|content|resources|start here|student|instructor|course|lesson)\b/.test(label);
      if (!looksOutline) continue;
      try {
        el.click();
        expanded++;
        await sleepMs(70);
      } catch (e) {}
    }
    if (expanded && Date.now()<deadline) await sleepMs(300);
    return expanded;
  }

export async function hydrateOutlineSurfaceForCrawl(options) {
    options=options || {};
    const deadline=Number.isFinite(Number(options.deadline))?Number(options.deadline):Infinity;
    const stats = {roots:0, positions:0, disclosuresExpanded:0, maxRange:0,timeBudgetExhausted:false};
    const roots = outlineScrollRoots();
    stats.roots = roots.length;
    const originals = roots.map(root => ({root, pos:scrollRootPosition(root)}));
    try {
      if(Date.now()<deadline)stats.disclosuresExpanded += await expandAllSafeOutlineDisclosures({deadline});
      else stats.timeBudgetExhausted=true;
      for (const root of roots.slice(0, 6)) {
        if(Date.now()>=deadline){stats.timeBudgetExhausted=true;break;}
        let maxY = scrollRootMax(root);
        stats.maxRange = Math.max(stats.maxRange, maxY);
        const viewport = isDocumentScrollRoot(root) ? Number(window.innerHeight || 800) : Number(root.clientHeight || 800);
        const step = Math.max(360, Math.floor(viewport * 0.58));
        const positions = [];
        for (let y=0; y<=maxY && positions.length<34; y+=step) positions.push(y);
        if (!positions.length || positions[positions.length-1] !== maxY) positions.push(maxY);
        for (const y of positions) {
          if(Date.now()>=deadline){stats.timeBudgetExhausted=true;break;}
          await setScrollRootPosition(root, y);
          stats.positions++;
          stats.disclosuresExpanded += await expandAllSafeOutlineDisclosures({deadline});
          maxY = Math.max(maxY, scrollRootMax(root));
        }
      }
    } finally {
      for (const item of originals) await setScrollRootPosition(item.root, item.pos);
    }
    return stats;
  }

export async function findNavigationTargetForFingerprint(fp, courseOrBranchId, trace) {
    const stats=trace || {},started=Date.now();
    const deadline=Math.min(started+30000,Number.isFinite(Number(stats.deadline))?Number(stats.deadline):Infinity);
    Object.assign(stats,{viewportScanSteps:0,outlineExpanded:0,outlineRestored:0,scrollRootsTried:0,foundScrollY:0,
      scanRootTag:'',weakMatchesIgnored:0,targetedOutlineNavigation:true,maxSimultaneousNewBranches:0});
    const STRONG_TARGET_SCORE=0.995;
    let found=null,newBranches=0,expansionCount=0;
    const excluded=new Set(),pathKnown=targetPathTokens(fp).length>0 || Boolean(fp && fp.ancestors && fp.ancestors.length);
    const originals=new Map();
    function acceptStrong(hit,root) {
      if(!hit)return null;
      if(Number(hit.score || 0)<STRONG_TARGET_SCORE){stats.weakMatchesIgnored++;return null;}
      const y=root?scrollRootPosition(root):Math.round(window.scrollY || 0);
      Object.assign(hit,{viewportScanSteps:stats.viewportScanSteps,outlineExpanded:stats.outlineExpanded,foundScrollY:y,
        scrollRootsTried:stats.scrollRootsTried,scanRootTag:root?(isDocumentScrollRoot(root)?'document':String(root.tagName || 'scroll-root').toLowerCase()):'current',
        weakMatchesIgnored:stats.weakMatchesIgnored});
      stats.foundScrollY=y;stats.scanRootTag=hit.scanRootTag;
      return hit;
    }
    function captureScroll(roots) {
      for(const root of roots)if(!originals.has(root))originals.set(root,scrollRootPosition(root));
    }
    async function restoreScroll(saved) {
      for(const [root,pos] of saved)if(root.isConnected)await setScrollRootPosition(root,pos);
    }
    async function current(scope,depth,root) {
      found=acceptStrong(findNavigationTargetInCurrentViewport(fp,courseOrBranchId),root);
      if(found || Date.now()>=deadline)return found;
      // A known module/lesson path restricts opening to that path or a region
      // containing the exact target ID. Unknown paths are explored one branch at
      // a time; each missed branch is closed before the next is mounted.
      while(Date.now()<deadline && depth<10 && expansionCount<160){
        const options={scope,deadline,excluded,requireRelevant:pathKnown};
        const before=new Map(outlineScrollRoots().map(el=>[el,scrollRootPosition(el)]));captureScroll([...before.keys()]);
        const expanded=await expandSafeOutlineDisclosures(fp,options);
        if(!expanded)break;
        stats.outlineExpanded+=expanded;expansionCount+=expanded;newBranches++;
        stats.maxSimultaneousNewBranches=Math.max(stats.maxSimultaneousNewBranches,newBranches);
        const candidate=options.lastExpansion;
        let branchHit=null;
        try {branchHit=await scan(candidate.scope,depth+1);}
        finally {
          newBranches--;
          if(!branchHit){
            try {
              if(candidate.element.isConnected && candidate.element.getAttribute('aria-expanded')==='true' &&
                  !isDangerousEditorControl(candidate.element)){
                candidate.element.click();stats.outlineRestored++;
                await sleepMs(70);
              }
            }catch(_){}
            await restoreScroll(before);
          }
        }
        if(branchHit)return branchHit;
        found=acceptStrong(findNavigationTargetInCurrentViewport(fp,courseOrBranchId),root);
        if(found)return found;
      }
      return null;
    }
    async function scan(scope,depth) {
      found=await current(scope,depth,null);
      if(found)return found;
      const roots=outlineScrollRoots().filter(root=>root===scope || root.contains(scope) || scope.contains(root));
      captureScroll(roots);stats.scrollRootsTried+=roots.length;
      for(const root of roots){
        if(Date.now()>=deadline){stats.timeBudgetExhausted=true;return null;}
        const viewport=isDocumentScrollRoot(root)?Number(window.innerHeight || 800):Number(root.clientHeight || 800);
        const step=Math.max(240,Math.floor(viewport*0.68));
        let startY=0,endY=scrollRootMax(root);
        if(root!==scope && root.contains(scope)){
          const box=scope.getBoundingClientRect(),parentBox=root.getBoundingClientRect();
          const parentTop=isDocumentScrollRoot(root)?0:parentBox.top;
          const position=scrollRootPosition(root);
          startY=Math.max(0,position+box.top-parentTop-viewport*0.15);
          endY=Math.min(endY,Math.max(startY,position+box.bottom-parentTop-viewport*0.6));
        }
        let y=startY,previous=-1;
        for(let positions=0;positions<160;positions++){
          if(Date.now()>=deadline){stats.timeBudgetExhausted=true;return null;}
          const maxY=scrollRootMax(root);stats.maxRange=Math.max(Number(stats.maxRange || 0),maxY);
          y=Math.min(y,maxY,endY);
          if(y===previous)break;
          await setScrollRootPosition(root,y);stats.viewportScanSteps++;
          found=await current(scope,depth,root);
          if(found)return found;
          if(y>=Math.min(scrollRootMax(root),endY))break;
          previous=y;y=Math.min(y+step,scrollRootMax(root),endY);
        }
      }
      return null;
    }
    try {
      found=acceptStrong(findNavigationTargetInCurrentViewport(fp,courseOrBranchId),null);
      if(found)return found;
      const scope=document.querySelector('main,[role="main"]') || document.body;
      captureScroll(outlineScrollRoots());
      found=await scan(scope,0);
      if(!found && Date.now()>=deadline)stats.timeBudgetExhausted=true;
      return found;
    }finally {
      if(!found)await restoreScroll(originals);
      stats.elapsedMs=Date.now()-started;
    }
  }
