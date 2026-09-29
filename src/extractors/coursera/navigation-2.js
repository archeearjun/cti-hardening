import { questionEvidenceReadyV6138 } from "./assessments-2.js";
import { ACTIVE_CRAWL_BASE_BUDGET_MS, ACTIVE_CRAWL_FIXED_OVERHEAD_MS, ACTIVE_CRAWL_MAX_TOTAL_MS, ACTIVE_CRAWL_PER_TARGET_BUDGET_MS } from "./config.js";
import { evidenceHasUsefulPayload, scoreSurfaceForFingerprint } from "./evidence-2.js";
import { harvestEvidence, mergeEvidence } from "./evidence.js";
import { authoringItemRouteV61311, isSafeCourseRoute } from "./navigation.js";
import { elementAttributeBlob, exactReadingEditorV61311, isCourseWideNetworkResponse, isPerItemNetworkNoise, sleepMs } from "./text-and-dom-2.js";
import { editorSurfaceSignalScore, isVisibleElement } from "./text-and-dom-3.js";
import { isGlobalChromeElement } from "./text-and-dom-4.js";
import { dismissEditorSurfaceSafely } from "./text-and-dom-5.js";
import { getJson, normalizeName, unique } from "./text-and-dom.js";

export async function waitForRouteChange(oldHref, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (location.href !== oldHref) return true;
      await sleepMs(120);
    }
    return false;
  }

export function isLikelyWholeOutlineSurface(root) {
    if (!root || !isVisibleElement(root)) return true;
    if (isGlobalChromeElement(root)) return true;
    try {
      const role = String(root.getAttribute && root.getAttribute("role") || "").toLowerCase();
      const attrs = elementAttributeBlob(root);
      if (role === "dialog" || /drawer|modal|dialog|editor|sheet|flyout/.test(attrs)) return false;
      const rect = root.getBoundingClientRect();
      const huge = rect.width >= window.innerWidth * 0.88 && rect.height >= window.innerHeight * 0.72;
      const textLen = String(root.innerText || root.textContent || "").length;
      const headings = root.querySelectorAll ? root.querySelectorAll("h1,h2,h3,[role='heading']").length : 0;
      if (huge && (textLen > 4500 || headings > 12)) return true;
    } catch (e) {}
    return false;
  }

export function findRouteScopedItemEditorSurface(fp, courseOrBranchId, strongSessionIdentity, routeChanged) {
    if (!strongSessionIdentity) return null;
    if (!routeChanged || !isItemSpecificCourseRoute(location.href,fp,courseOrBranchId)) return null;
    const exact=exactReadingEditorV61311(fp,courseOrBranchId);
    if (exact) return exact;

    const main = document.querySelector("main,[role='main']") || document.body;
    const candidates = [];
    const seen = new Set();
    function add(el) {
      if (!el || seen.has(el) || !isVisibleElement(el) || isGlobalChromeElement(el)) return;
      seen.add(el); candidates.push(el);
    }
    try {
      main.querySelectorAll("[role='dialog'],[aria-modal='true'],form,[data-testid*='editor'],[data-e2e*='editor'],[class*='editor'],section,article").forEach(add);
    } catch (e) {}
    add(main);

    let best = null, bestScore = 0;
    for (const root of candidates.slice(0, 700)) {
      const signal = editorSurfaceSignalScore(root, fp);
      if (signal < 0.55) continue;
      let score = scoreSurfaceForFingerprint(root, fp, true);
      score = Math.max(score, Math.min(0.96, 0.90 + signal * 0.06));
      // Prefer a bounded editor region over the whole main page when scores tie.
      try {
        const rect = root.getBoundingClientRect();
        if (root !== main && rect.width < window.innerWidth * 0.98) score += 0.005;
      } catch (e) {}
      if (score > bestScore) { best = root; bestScore = score; }
    }
    return bestScore >= 0.90 ? {root:best, score:Math.min(1,bestScore), routeScoped:true} : null;
  }

export function interleaveCrawlTargetsV61313(sortedTargets) {
    // Keep priority within each type, while preventing assessments from consuming
    // the whole run before any reading, plugin, or discussion can be observed.
    const buckets=new Map();
    for (const fp of sortedTargets) {
      const type=String(fp.typeName || fp.type || 'unknown');
      const key=/assignment|quiz|exam|assessment/i.test(type)?'assessment':
        /supplement|reading/i.test(type)?'reading':/discussion/i.test(type)?'discussion':'other';
      if (!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push(fp);
    }
    const result=[];let offset=0,added=true;
    while (added) {
      added=false;
      for (const group of buckets.values()) if (offset<group.length) {result.push(group[offset]);added=true;}
      offset++;
    }
    return result;
  }

export function typedEditorRouteTypeV61316(fp) {
    const type=String(fp && fp.typeName || '');
    return type==='ungradedWidget' || type==='plugin' ? 'plugin' : type==='discussionPrompt' ? 'discussionPrompt' : '';
  }

export function typedEditorRouteV61316(fp, courseId, template) {
    const type=typedEditorRouteTypeV61316(fp);
    if(!['plugin','discussionPrompt'].includes(type) || !/^[A-Za-z0-9_-]+$/.test(String(fp && fp.id || '')))return '';
    if(!template || template.courseId!==String(courseId))return '';
    const candidate=template.origin+'/teach/'+template.slug+'/'+template.courseId+'/content/item/'+type+'/'+fp.id;
    const route=authoringItemRouteV61311(candidate);
    return route && route.courseId===String(courseId) && route.itemId===String(fp.id) && route.typeName===type && isSafeCourseRoute(candidate,courseId) ? candidate : '';
  }

export function crawlTargetPriority(fp, startingItemId) {
    const name = normalizeName(fp && fp.name);
    const type = normalizeName((fp && (fp.type || fp.typeName)) || "");
    const p = fp && fp.payload || {};
    let score = 0;
    if (fp && fp.id) score += 10;
    if (startingItemId && String(fp && fp.id || "") === String(startingItemId)) score += 120;
    if (fp && fp.type && fp.type !== "Unknown") score += 4;
    if (!/^(overview content|archive content|new reading|untitled|overview|archive|content)$/.test(name)) score += 8;
    // Overview is decision-relevant source-equivalence evidence in virtually
    // every course, and outline/API summaries are often misleadingly shallow.
    // Inspect it before spending the crawl budget on already-observable items.
    if (/^overview(?: content)?$/.test(name) || /(?:^|\s)overview(?:\s|$)/.test(normalizeName(fp && fp.path || ""))) score += 110;
    if (/welcome|start here/.test(name)) score += 24;
    // Low-evidence items deserve attention even when their names are generic.
    const completeness = Number(p.textEvidenceCompleteness || 0);
    if (!p.textSample || completeness < 0.50) score += 34;
    else if (completeness < 0.75) score += 20;
    if (!Array.isArray(p.evidenceSources) || !p.evidenceSources.some(x => /active-editor|active-crawl/i.test(String(x)))) score += 12;
    // Controls whose correctness cannot be inferred from the outline are high value.
    if (/assignment|assessment|quiz|exam/.test(type)) score += 28;
    if (/discussion/.test(type)) score += 14;
    if (/rubric|grading|assignment/.test(name)) score += 12;
    if ((p.assetDetails || []).length) score += 2;
    return score;
  }

export function safelyRouteWithHistory(targetUrl) {
    try {
      const u = new URL(targetUrl, location.href);
      if(u.href===location.href)return true;
      history.replaceState(history.state, "", u.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      return true;
    } catch (e) { return false; }
  }

export function safelyRestoreRoute(startUrl) {
    try {
      const u=new URL(startUrl,location.href);
      if(u.href===location.href)return true;
      history.replaceState(history.state, "", u.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      return true;
    } catch (e) { return false; }
  }

export function isGenericCourseEditRoute(route, courseOrBranchId) {
    if (!route) return false;
    try {
      const u = new URL(route, location.origin);
      const path = u.pathname.replace(/\/+$/, "");
      const expectedTail = "/" + String(courseOrBranchId || "") + "/content/edit";
      return path.toLowerCase().endsWith(expectedTail.toLowerCase());
    } catch (e) { return false; }
  }

export function isItemSpecificCourseRoute(route, fp, courseOrBranchId) {
    if (!route || !fp || !fp.id || !isSafeCourseRoute(route,courseOrBranchId)) return false;
    try {
      const u=new URL(route,location.origin), id=String(fp.id);
      const item=authoringItemRouteV61311(u.href);
      if (item) return item.itemId===id && (!courseOrBranchId || item.courseId===String(courseOrBranchId));
      if (u.searchParams.has('itemId')) return u.searchParams.get('itemId')===id;
      if (isGenericCourseEditRoute(route,courseOrBranchId)) return false;
      const tail=u.pathname.split('/content/')[1] || '';
      return tail.split('/').some(part=>decodeURIComponent(part)===id);
    } catch (e) { return false; }
  }

export async function returnToOutlineV6142(startUrl) {
    // Give Coursera's close handler a turn to finish its own navigation before
    // using history fallback. A route no-op alone does not certify an editor.
    const dismissed=dismissEditorSurfaceSafely();
    if(dismissed)await sleepMs(350);
    const restored=safelyRestoreRoute(startUrl);
    await sleepMs(220);
    return restored;
  }

export function recoveryCrawlBudgetV61326(targets) {
    let questionWork=0;
    for(const fp of targets || []){
      const a=fp.payload?.structuredAssessment || {},qs=a.questions || [];
      const ready=qs.filter(q=>q.courseraQuestionId && q.questionOrdinalObserved && questionEvidenceReadyV6138(q)).length;
      questionWork+=Math.max(0,Math.max(Number(a.declaredQuestionCount || 0),qs.length)-ready);
    }
    return Math.min(1200000,Math.max(activeCrawlBudgetMs((targets || []).length,true),30000+(targets || []).length*16000+questionWork*4500));
  }

export function activeCrawlBudgetMs(targetCount, retryPass) {
    if (retryPass) return Math.min(4 * 60 * 1000, Math.max(90000, Number(targetCount || 0) * 16000 + 30000));
    const scaled = ACTIVE_CRAWL_FIXED_OVERHEAD_MS + Math.max(0, Number(targetCount || 0)) * ACTIVE_CRAWL_PER_TARGET_BUDGET_MS;
    return Math.min(ACTIVE_CRAWL_MAX_TOTAL_MS, Math.max(ACTIVE_CRAWL_BASE_BUDGET_MS, scaled));
  }

export function diagnosticNavigated(d) {
    return Boolean(d && (d.routeChanged || d.domCaptured || d.editorSurfaceCaptured));
  }

export async function targetedItemPayloadProbes(fingerprints, knownResponses, courseOrBranchId) {
    const resourceUrls = unique(performance.getEntriesByType("resource").map(x => x.name), 800);
    const probeMeta = { attempted: 0, usable: 0, supplementHits: 0, assetHits: 0, speculativeSupplementProbes: 0 };

    for (const fp of fingerprints || []) {
      if (!fp.id) continue;
      const idLower = String(fp.id).toLowerCase();
      const directUrls = resourceUrls.filter(url => {
        try {
          const parsed = new URL(url);
          if (parsed.origin !== location.origin || !parsed.pathname.includes("/api/")) return false;
          if (isPerItemNetworkNoise(parsed.href) || isCourseWideNetworkResponse(parsed.href)) return false;
          return (parsed.pathname + parsed.search).toLowerCase().includes(idLower);
        } catch (e) { return false; }
      }).slice(0, 6);

      // Re-fetch only URLs Coursera actually requested for this exact stable item ID.
      // v4.7 guessed /onDemandSupplements/<branch>~<item>, producing many 400/404s
      // because supplement IDs are not universally authoring item IDs.
      for (const url of directUrls) {
        const response = await getJson(url);
        probeMeta.attempted++;
        if (!response.ok || !response.data) continue;
        probeMeta.usable++;
        const evidence = harvestEvidence(response.data);
        if (!evidenceHasUsefulPayload(evidence)) continue;
        if ((evidence.assetDetails || []).length) evidence.assetEvidenceConfidence = Math.max(Number(evidence.assetEvidenceConfidence || 0), 0.88);
        if ((evidence.links || []).length) evidence.linkEvidenceConfidence = Math.max(Number(evidence.linkEvidenceConfidence || 0), 0.82);
        evidence.evidenceSources = ["item-specific-observed-api"];
        mergeEvidence(fp.payload, evidence, "item-specific-observed-api");
        fp.evidenceSources = unique([...(fp.evidenceSources || []), "item-specific-observed-api"], 50);
        if (/onDemandSupplements\.v1/i.test(url)) probeMeta.supplementHits++;
      }
    }
    return probeMeta;
  }
