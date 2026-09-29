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
    const waitBudget=scopedWaitBudgetV61321(12000,16000,options.deadline);
    let deadline=Math.min(started+12000,options.deadline==null?Infinity:Number(options.deadline));
    waitBudget.observe([0,0,0,0]);
    const result = {id:String(fp && fp.id || ''),attempted:false,captured:false,route,reason:'NO_CERTIFIED_READING_ROUTE',dwellMs:0,samples:0};
    if (!route) return result;
    if(Date.now()>=deadline){result.reason='TIME_BUDGET_EXHAUSTED';return result;}
    if (options.shouldStop && options.shouldStop()) {result.reason='STOP_REQUESTED';return result;}
    result.attempted = true;
    // replaceState keeps a bounded history while requesting the same read-only SPA route.
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
        // Include full scoped markup: equal-length text and unchanged frame counts
        // must not hide a URL/content change while the editor is hydrating.
        const signature = snapshot.signature + '|' + String(surface.root.innerHTML || '') + '|' + String(surface.root.innerText || '');
        const networkSignature=network.processedResponses+'|'+network.pendingRequests;
        networkStable=networkSignature===previousNetwork?networkStable+1:0;previousNetwork=networkSignature;
        stable = previous && signature === previous && !snapshot.loading ? stable + 1 : 0;
        previous = signature;
        const meaningful = snapshot.textLength > 0 || snapshot.files > 0 || snapshot.links > 0 || snapshot.frames > 0;
        const minimum = meaningful ? 2000 : 5000;
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
          if (!/document-viewer|reading-loading-placeholder/.test(evidence.textScopeKind || '')) evidence.textScopeKind = 'reading-content-field';
          // Short headings around unread embeds are not complete external text.
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
      const route = routeCandidateFromElement(el, courseOrBranchId);
      const text = elementTextKey(el);
      let score = 0.997, reason = "visible-attribute-id";
      if (id && route && route.toLowerCase().includes(id)) { score = 1; reason = "visible-route-id"; }
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

      if (id && route && route.toLowerCase().includes(id)) { score = 1; reason = "visible-route-id"; }
      else if (id && attrs.includes(id)) { score = 0.995; reason = "visible-attribute-id"; }
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

    if ((!best || bestScore < 0.995) && name) {
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
    const raw = Array.isArray(fp && fp.path) ? fp.path.join(" ") : String(fp && fp.path || "");
    return normalizeName(raw).split(/\s*(?:>|\/|\||::)\s*/).filter(Boolean).slice(0, 8);
  }

export async function expandSafeOutlineDisclosures(fp) {
    const root = document.querySelector("main,[role='main']") || document.body;
    const buttons = [...root.querySelectorAll("button[aria-expanded='false'],[role='button'][aria-expanded='false']")].slice(0, 400);
    const pathTokens = targetPathTokens(fp);
    let expanded = 0;
    for (const el of buttons) {
      if (!isVisibleElement(el) || isGlobalChromeElement(el) || isDangerousEditorControl(el)) continue;
      const label = normalizeName(elementTextKey(el) + " " + elementAttributeBlob(el));
      if (/\b(more|options|actions|menu|navigation|filter|sort|account|profile)\b/.test(label)) continue;
      const controlsRegion = String(el.getAttribute && el.getAttribute("aria-controls") || "");
      const pathHit = pathTokens.some(t => t.length >= 4 && (label.includes(t) || t.includes(label)));
      const looksDisclosure = Boolean(controlsRegion) || pathHit || /\b(expand|show|module|week|section|content|resources|start here|student|instructor|course)\b/.test(label);
      if (!looksDisclosure) continue;
      try {
        el.click();
        expanded++;
        await sleepMs(90);
      } catch (e) {}
    }
    if (expanded) await sleepMs(350);
    return expanded;
  }

export async function expandAllSafeOutlineDisclosures() {
    const root = document.querySelector("main,[role='main']") || document.body;
    const buttons = [...root.querySelectorAll("button[aria-expanded='false'],[role='button'][aria-expanded='false']")].slice(0, 700);
    let expanded = 0;
    for (const el of buttons) {
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
    if (expanded) await sleepMs(300);
    return expanded;
  }

export async function hydrateOutlineSurfaceForCrawl() {
    const stats = {roots:0, positions:0, disclosuresExpanded:0, maxRange:0};
    const roots = outlineScrollRoots();
    stats.roots = roots.length;
    const originals = roots.map(root => ({root, pos:scrollRootPosition(root)}));
    try {
      stats.disclosuresExpanded += await expandAllSafeOutlineDisclosures();
      for (const root of roots.slice(0, 6)) {
        let maxY = scrollRootMax(root);
        stats.maxRange = Math.max(stats.maxRange, maxY);
        const viewport = isDocumentScrollRoot(root) ? Number(window.innerHeight || 800) : Number(root.clientHeight || 800);
        const step = Math.max(360, Math.floor(viewport * 0.58));
        const positions = [];
        for (let y=0; y<=maxY && positions.length<34; y+=step) positions.push(y);
        if (!positions.length || positions[positions.length-1] !== maxY) positions.push(maxY);
        for (const y of positions) {
          await setScrollRootPosition(root, y);
          stats.positions++;
          stats.disclosuresExpanded += await expandAllSafeOutlineDisclosures();
          maxY = Math.max(maxY, scrollRootMax(root));
        }
      }
    } finally {
      for (const item of originals) await setScrollRootPosition(item.root, item.pos);
    }
    return stats;
  }

export async function findNavigationTargetForFingerprint(fp, courseOrBranchId, trace) {
    const stats = trace || {};
    const deadline=Number(stats.deadline || Infinity);
    stats.viewportScanSteps = 0;
    stats.outlineExpanded = 0;
    stats.scrollRootsTried = 0;
    stats.foundScrollY = 0;
    stats.scanRootTag = "";
    stats.weakMatchesIgnored = 0;

    // V5.9: a broad module/container that merely *contains* an item title is not
    // sufficient identity. In v5.7 this short-circuited viewport scanning when the
    // outline was scrolled/virtualized, so the real data-item-id row was never
    // brought into the DOM. Require stable-ID/exact-title strength before stopping.
    const STRONG_TARGET_SCORE = 0.995;
    let bestWeak = null;
    function acceptStrong(hit) {
      if (!hit) return null;
      if (Number(hit.score || 0) >= STRONG_TARGET_SCORE) return hit;
      stats.weakMatchesIgnored++;
      if (!bestWeak || Number(hit.score || 0) > Number(bestWeak.score || 0)) bestWeak = hit;
      return null;
    }

    let found = acceptStrong(findNavigationTargetInCurrentViewport(fp, courseOrBranchId));
    if (found) {
      found.viewportScanSteps = 0;
      found.outlineExpanded = 0;
      found.foundScrollY = Math.round(window.scrollY || 0);
      found.scrollRootsTried = 0;
      found.scanRootTag = "current";
      found.weakMatchesIgnored = stats.weakMatchesIgnored;
      return found;
    }

    const roots = outlineScrollRoots();
    stats.scrollRootsTried = roots.length;
    const originals = roots.map(root => ({ root, pos:scrollRootPosition(root) }));

    async function scanRoot(root) {
      let maxY = scrollRootMax(root);
      const viewport = isDocumentScrollRoot(root) ? Number(window.innerHeight || 800) : Number(root.clientHeight || 800);
      const step = Math.max(420, Math.floor(viewport * 0.68));
      const positions = [];
      for (let y = 0; y <= maxY && positions.length < 42; y += step) positions.push(y);
      if (!positions.length || positions[positions.length - 1] !== maxY) positions.push(maxY);
      for (const y of positions) {
        if (Date.now()>=deadline) {stats.timeBudgetExhausted=true;return null;}
        await setScrollRootPosition(root, y);
        stats.viewportScanSteps++;
        const hit = acceptStrong(findNavigationTargetInCurrentViewport(fp, courseOrBranchId));
        if (hit) {
          hit.viewportScanSteps = stats.viewportScanSteps;
          hit.outlineExpanded = stats.outlineExpanded;
          hit.foundScrollY = scrollRootPosition(root);
          hit.scrollRootsTried = stats.scrollRootsTried;
          hit.scanRootTag = isDocumentScrollRoot(root) ? "document" : String(root.tagName || "scroll-root").toLowerCase();
          hit.weakMatchesIgnored = stats.weakMatchesIgnored;
          stats.foundScrollY = hit.foundScrollY;
          stats.scanRootTag = hit.scanRootTag;
          return hit;
        }
        maxY = Math.max(maxY, scrollRootMax(root));
      }
      return null;
    }

    try {
      for (const root of roots) {
        found = await scanRoot(root);
        if (found) return found;
      }
      if (Date.now()>=deadline) {stats.timeBudgetExhausted=true;return null;}
      stats.outlineExpanded += await expandSafeOutlineDisclosures(fp);
      if (stats.outlineExpanded) {
        for (const root of roots) {
          found = await scanRoot(root);
          if (found) return found;
        }
      }

      // Do not fall back to the v5.7 0.90 title-containment container: it may be
      // an entire module or even a global "Resources" region and can expose controls
      // for unrelated items. A miss is safer than a wrong-item click.
      return null;
    } finally {
      if (!found) {
        for (const item of originals) await setScrollRootPosition(item.root, item.pos);
      }
    }
  }
