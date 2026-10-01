import { ctiGuardAssessmentOptionEvidence_ } from "./assessments-3.js";
import { assetDescriptor, fileNameFromUrl, isCourseraUiAssetUrl, uniqueAssetDetails } from "./assets.js";
import { CTI_API_FETCH_TIMEOUT_MS, MAX_EXACT_READING_TEXT_V61318, MAX_TEXT_SAMPLE, MAX_WALK_NODES } from "./config.js";
import { evidenceFromCapturedRecord, isSessionScopedPayloadEndpoint, mergeCourseraLearnerText, sanitizeSessionPayloadEvidence } from "./evidence-2.js";
import { mergePluginEvidenceV6139 } from "./plugins.js";
import { fetchWithTimeoutV6150 } from "./network.js";
import { isCourseWideNetworkResponse, isPerItemNetworkNoise, readingAttachmentCoverageV61323 } from "./text-and-dom-2.js";
import { sessionAtomIsRelationPaired } from "./text-and-dom-3.js";
import { inferPublished, isAuthoringChromeUrl, normalizeName, normalizeType, sha256, shouldUseDomResourceElement, stripHtml, unique } from "./text-and-dom.js";

export function harvestEvidence(root) {
    const files = [];
    const links = [];
    const images = [];
    const embeddedRefs = [];
    const assetDetails = [];
    const strongTextParts = [];
    const weakTextParts = [];
    let nodes = 0;

    // Only body-like fields are allowed to drive destructive CONTENT_CHANGED
    // verdicts. Generic `content` / `value` fields are retained as low-confidence
    // diagnostics but are not treated as proof that learner-facing text changed.
    const strongTextKeys = /(body|html|(^|[^a-z])text([^a-z]|$)|description|prompt|instruction|transcript|summary|markdown|caption|explanation)/i;
    const weakTextKeys = /(content|definition|value)/i;
    const imageExt = /\.(png|jpe?g|gif|svg|webp)(?:$|[?#])/i;
    const assetExt = /\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i;

    function walk(value, key) {
      if (value == null || nodes++ > MAX_WALK_NODES) return;

      if (typeof value === "string") {
        const s = value.trim();
        if (!s) return;

        (s.match(/https?:\/\/[^\s"'<>\\]+/g) || []).forEach(url => {
          links.push(url);
          if (assetExt.test(url)) {
            files.push(url);
            assetDetails.push(assetDescriptor({ url: url, name: fileNameFromUrl(url) }, "observed-string"));
          }
          if (imageExt.test(url)) images.push(url);
        });

        (s.match(/[^\s"'<>\\]+\.(?:pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:\?[^\s"'<>\\]*)?/gi) || [])
          .forEach(ref => {
            embeddedRefs.push(ref);
            files.push(ref);
            assetDetails.push(assetDescriptor({ url: /^https?:/i.test(ref) ? ref : "", name: fileNameFromUrl(ref) }, "observed-string"));
            if (imageExt.test(ref)) images.push(ref);
          });

        const keyText = String(key || "");
        if ((strongTextKeys.test(keyText) || weakTextKeys.test(keyText)) && s.length >= 20) {
          const clean = stripHtml(s);
          if (clean.length >= 20 && !/^https?:\/\//i.test(clean)) {
            if (strongTextKeys.test(keyText)) strongTextParts.push(clean);
            else weakTextParts.push(clean);
          }
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(v => walk(v, key));
        return;
      }

      if (typeof value === "object") {
        const possible = assetDescriptor(value, "observed-object");
        const possibleText = (possible.name || "") + " " + (possible.url || "");
        if (/\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i.test(possibleText) ||
            /^(image|audio|video)\//i.test(possible.mime) || /pdf/i.test(possible.mime)) {
          assetDetails.push(possible);
          if (possible.url) files.push(possible.url);
          else if (possible.name) files.push(possible.name);
        }
        Object.keys(value).forEach(childKey => walk(value[childKey], childKey));
      }
    }

    walk(root, "");

    const highConfidenceText = unique(strongTextParts, 80).join(" ").replace(/\s+/g, " ").trim();
    const lowConfidenceText = unique(weakTextParts, 80).join(" ").replace(/\s+/g, " ").trim();
    const textConfidence = highConfidenceText ? "high" : (lowConfidenceText ? "low" : "none");
    const textSample = (highConfidenceText || lowConfidenceText).slice(0, MAX_TEXT_SAMPLE);
    return {
      files: unique(files, 500),
      links: unique(links, 500),
      images: unique(images, 500),
      embeddedRefs: unique(embeddedRefs, 500),
      assetDetails: uniqueAssetDetails(assetDetails, 800),
      assetEvidenceConfidence: assetDetails.length ? 0.45 : 0,
      linkEvidenceConfidence: links.length ? 0.45 : 0,
      textSample,
      textLength: textSample.length,
      textSha256: "",
      textConfidence,
      textEvidencePriority: 0,
      published: inferPublished(root),
      evidenceSources: []
    };
  }

export function textEvidenceSourcePriority(sourceLabel) {
    const label = String(sourceLabel || "").toLowerCase();
    if (/active-editor-body|active-crawl-dom/.test(label)) return 95;
    if (/active-crawl-graphql|active-crawl-network/.test(label)) return 85;
    if (/ondemandsupplements|opencourseassets|item-specific-api/.test(label)) return 80;
    if (/authoringcoursematerials/.test(label)) return 45;
    if (/auto-item-page|embedded-page-state/.test(label)) return 35;
    return 20;
  }

export function mergeEvidence(target, extra, sourceLabel) {
    if (!extra) return;
    target.files = unique([...(target.files || []), ...(extra.files || [])], 600);
    target.links = unique([...(target.links || []), ...(extra.links || [])], 600);
    target.images = unique([...(target.images || []), ...(extra.images || [])], 600);
    target.embeddedRefs = unique([...(target.embeddedRefs || []), ...(extra.embeddedRefs || [])], 600);
    target.assetDetails = uniqueAssetDetails([...(target.assetDetails || []), ...(extra.assetDetails || [])], 800);
    target.assetEvidenceConfidence = Math.max(Number(target.assetEvidenceConfidence || 0), Number(extra.assetEvidenceConfidence || 0));
    target.linkEvidenceConfidence = Math.max(Number(target.linkEvidenceConfidence || 0), Number(extra.linkEvidenceConfidence || 0));
    if(extra.pluginEvidence)target.pluginEvidence=mergePluginEvidenceV6139(target.pluginEvidence,extra.pluginEvidence);

    // Structured assessment evidence is also monotonic. Prefer the model that
    // exposes more questions; use parser confidence as the tie-breaker. Do not
    // concatenate two complete models because nested DOM snapshots would duplicate
    // questions across stability samples.
    if (extra.structuredAssessment && typeof extra.structuredAssessment === "object") {
      const currentSa = ctiGuardAssessmentOptionEvidence_(target.structuredAssessment && typeof target.structuredAssessment === "object" ? target.structuredAssessment : null);
      if(currentSa)target.structuredAssessment=currentSa;
      const extraSa = ctiGuardAssessmentOptionEvidence_(extra.structuredAssessment);
      const currentCount = currentSa ? Number(currentSa.questionCount || (currentSa.questions || []).length || 0) : 0;
      const extraCount = Number(extraSa.questionCount || (extraSa.questions || []).length || 0);
      const currentConfidence = currentSa ? Number(currentSa.parserConfidence || 0) : 0;
      const extraConfidenceSa = Number(extraSa.parserConfidence || 0);
      const currentAnswerEvidence = currentSa ? Number(currentSa.answerEvidenceQuestionCount || 0) : 0;
      const extraAnswerEvidence = Number(extraSa.answerEvidenceQuestionCount || 0);
      if (!currentSa || extraCount > currentCount ||
          (extraCount === currentCount && extraAnswerEvidence > currentAnswerEvidence) ||
          (extraCount === currentCount && extraAnswerEvidence === currentAnswerEvidence && extraConfidenceSa > currentConfidence)) {
        target.structuredAssessment = extraSa;
      }
    }

    if (extra.ingestionFailure && extra.ingestionFailure.detected === true) {
      target.ingestionFailure = extra.ingestionFailure;
    }

    if (extra.nativeAssignment && typeof extra.nativeAssignment === "object") {
      const currentNa = target.nativeAssignment && typeof target.nativeAssignment === "object" ? target.nativeAssignment : null;
      const extraNa = extra.nativeAssignment;
      const scoreNative = na => {
        if (!na) return -1;
        const rubrics = Number(na.rubricCount || (na.rubrics || []).length || 0);
        const levels = (na.rubrics || []).reduce((sum, r) => sum + ((r && r.levels) || []).length, 0);
        const submissionSignals = na.submission ? Object.keys(na.submission).filter(k => na.submission[k] === true).length : 0;
        return rubrics * 1000 + levels * 100 + submissionSignals * 20 + Math.round(Number(na.parserConfidence || 0) * 10);
      };
      if (!currentNa || scoreNative(extraNa) > scoreNative(currentNa)) target.nativeAssignment = extraNa;
      else {
        target.nativeAssignment.submission = Object.assign({}, extraNa.submission || {}, target.nativeAssignment.submission || {});
        target.nativeAssignment.settings = Object.assign({}, extraNa.settings || {}, target.nativeAssignment.settings || {});
      }
    }

    const blocks=extra.nativeAssignment && extra.nativeAssignment.contentBlockEvidence;
    if(blocks && target.nativeAssignment) {
      const prior=target.nativeAssignment.contentBlockEvidence;
      const score=e=>(e && e.blocks || []).reduce((n,b)=>n+String(b.text || '').length,0);
      if(!prior || (prior.itemId===blocks.itemId && score(blocks)>=score(prior))) {
        target.nativeAssignment.contentBlockEvidence=blocks;
        target.nativeAssignment.learnerSemanticText=mergeCourseraLearnerText([target.nativeAssignment.learnerSemanticText,
          ...blocks.blocks.map(b=>[b.title,b.text].filter(Boolean).join(' '))]);
        target.nativeAssignment.semanticText=target.nativeAssignment.learnerSemanticText;
      }
    }
    const confidenceRank = { none: 0, low: 1, medium: 2, high: 3 };
    const targetConfidence = String(target.textConfidence || "none").toLowerCase();
    const extraConfidence = String(extra.textConfidence || "none").toLowerCase();
    const targetPriority = Number(target.textEvidencePriority || 0);
    const extraPriority = Math.max(Number(extra.textEvidencePriority || 0), textEvidenceSourcePriority(sourceLabel));
    const targetCompleteness = Math.max(0, Math.min(1, Number(target.textEvidenceCompleteness || 0)));
    const extraCompleteness = Math.max(0, Math.min(1, Number(extra.textEvidenceCompleteness || 0)));
    // v5.9: "high confidence" means item-specific; it does not automatically mean
    // complete. A complete scoped body beats a tiny high-confidence field fragment.
    const targetComposite = ((confidenceRank[targetConfidence] || 0) * 1000) + (targetPriority * 5) + (targetCompleteness * 100);
    const extraComposite = ((confidenceRank[extraConfidence] || 0) * 1000) + (extraPriority * 5) + (extraCompleteness * 100);

    // Evidence is monotonic: a lower-quality editor/network fragment may add links
    // or assets, but it may not replace a stronger/more complete learner-facing text fingerprint.
    if (extra.textSample && extraComposite > targetComposite) {
      target.textSample = extra.textSample || "";
      target.textConfidence = extraConfidence;
      target.textEvidencePriority = extraPriority;
      target.textEvidenceCompleteness = extraCompleteness;
      target.textScopeKind = String(extra.textScopeKind || "");
      if(extra.textCaptureEvidence){target.textCaptureEvidence=extra.textCaptureEvidence;target.textCaptureLimit=extra.textCaptureLimit;}
      else {delete target.textCaptureEvidence;delete target.textCaptureLimit;}
    }
    target.textLength = String(target.textSample || "").length;

    if (target.published == null && extra.published != null) target.published = extra.published;
    target.evidenceSources = unique([...(target.evidenceSources || []), ...(extra.evidenceSources || []), sourceLabel || ""], 50);
  }

export async function fingerprintsFromMaterial(apiResponse) {
    const out = [];
    const root = apiResponse && apiResponse.data ? apiResponse.data : apiResponse;
    let nodes = 0;

    function walk(value, path) {
      if (!value || nodes++ > MAX_WALK_NODES) return;

      if (Array.isArray(value)) {
        value.forEach(child => walk(child, path));
        return;
      }

      if (typeof value !== "object") return;

      const title = value.originalName || value.name || value.title || "";
      const rawType =
        (value.content && value.content.typeName) ||
        value.typeName ||
        value.itemTypeLabel ||
        "";

      const children = Array.isArray(value.elements) ? value.elements : [];
      const itemId = value.id || value.itemId || value.atomId || value.elementId || value.courseMaterialId || value.authoringAtomId || null;
      // Coursera does not always place item type metadata on the same object as
      // the title. Treat titled leaf nodes with stable IDs as structural item
      // candidates and let the Excel export / observed APIs enrich type later.
      const isItem = Boolean(title && (rawType || itemId) && children.length === 0);

      if (isItem) {
        const payload = harvestEvidence(value);
        payload.evidenceSources = ["authoringCourseMaterials"];
        out.push({
          id: itemId,
          name: title,
          type: rawType ? normalizeType(rawType) : "Unknown",
          typeName: rawType,
          path: path.join(" > "),
          payload,
          evidenceLevel: (payload.files.length || payload.links.length || payload.textSample) ? "item-object" : "structure-only",
          evidenceSources: ["authoringCourseMaterials"]
        });
      }

      const nextPath = (!isItem && title && children.length) ? path.concat([title]) : path;
      children.forEach(child => walk(child, nextPath));

      Object.keys(value).forEach(key => {
        if (key === "elements" || key === "content") return;
        const child = value[key];
        if (child && typeof child === "object" && /material|module|lesson|track|section|week/i.test(key)) {
          walk(child, nextPath);
        }
      });
    }

    walk(root, []);

    const seen = new Set();
    const deduped = out.filter(item => {
      const key = String(item.id || "") + "|" + item.path + "|" + normalizeName(item.name) + "|" + item.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const item of deduped) {
      item.payload.textSha256 = item.payload.textSample ? await sha256(item.payload.textSample) : "";
    }
    return deduped;
  }

export function collectCurrentDomEvidence() {
    const files = [], links = [], images = [], details = [];
    let filteredUiAssets = 0, filteredChromeLinks = 0;
    document.querySelectorAll("a[href],img[src],source[src],video[src],audio[src],iframe[src],embed[src],object[data]").forEach(el => {
      const raw = el.getAttribute("href") || el.getAttribute("src") || el.getAttribute("data") || "";
      if (!raw) return;
      let abs = raw;
      try { abs = new URL(raw, location.href).href; } catch (e) {}
      if (!shouldUseDomResourceElement(el, abs)) {
        if (isCourseraUiAssetUrl(abs)) filteredUiAssets++;
        return;
      }
      if (el.matches("a[href]")) {
        if (isAuthoringChromeUrl(abs)) filteredChromeLinks++;
        else links.push(abs);
      }
      if (el.matches("img[src],source[src],video[src],audio[src],iframe[src],embed[src],object[data]")) images.push(abs);
      if (/\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i.test(abs)) {
        files.push(abs);
        details.push(assetDescriptor({ url: abs, name: fileNameFromUrl(abs) }, "current-item-dom"));
      }
    });

    const main = document.querySelector("main,[role='main'],article") || document.body;
    const textSample = stripHtml(main ? main.innerText || main.textContent || "" : "").slice(0, MAX_TEXT_SAMPLE);
    const headings = [...document.querySelectorAll("h1,h2,h3")].map(x => String(x.innerText || "").trim()).filter(Boolean).slice(0, 20);
    const urlIds = (location.href.match(/[A-Za-z0-9_-]{5,}/g) || []).map(x => x.toLowerCase());

    return {
      files: unique(files, 500),
      links: unique(links, 500),
      images: unique(images, 500),
      embeddedRefs: unique(files, 500),
      assetDetails: uniqueAssetDetails(details, 800),
      // Whole-page DOM is navigation/diagnostic evidence only in v5.9. It is not
      // allowed to create hard absence claims or high-confidence learner text.
      assetEvidenceConfidence: details.length ? 0.70 : 0.55,
      linkEvidenceConfidence: links.length ? 0.65 : 0.45,
      textSample,
      textLength: textSample.length,
      textSha256: "",
      textConfidence: textSample.length >= 80 ? "medium" : (textSample ? "low" : "none"),
      textEvidencePriority: 20,
      published: null,
      evidenceSources: ["current-item-dom-diagnostic"],
      headings,
      urlIds,
      _diagnostics: { filteredUiAssets, filteredChromeLinks }
    };
  }

export function matchCurrentPageToFingerprint(fingerprints, domEvidence) {
    let best = null, bestScore = 0;
    const titleText = normalizeName(document.title + " " + (domEvidence.headings || []).join(" "));
    for (const fp of fingerprints || []) {
      let score = 0;
      if (fp.id && (domEvidence.urlIds || []).includes(String(fp.id).toLowerCase())) score = 1;
      else {
        const n = normalizeName(fp.name);
        if (n && titleText.includes(n)) score = 0.94;
      }
      if (score > bestScore) { best = fp; bestScore = score; }
    }
    return bestScore >= 0.90 ? best : null;
  }

export async function fetchHtmlEvidence(url, fp) {
    try {
      const parsed = new URL(url, location.origin);
      if (parsed.origin !== location.origin) return null;
      const response = await fetchWithTimeoutV6150(parsed.href, { credentials: "include", headers: { Accept: "text/html,application/xhtml+xml,*/*" } }, CTI_API_FETCH_TIMEOUT_MS);
      if (!response.ok) return null;
      const html = await response.text();
      if (!html || html.length > 6000000) return null;
      const doc = new DOMParser().parseFromString(html, "text/html");
      const title = normalizeName((doc.title || "") + " " + (doc.body ? doc.body.innerText || "" : "").slice(0, 5000));
      const target = normalizeName(fp.name);
      if (target && target.length >= 5 && !title.includes(target) && !parsed.href.toLowerCase().includes(String(fp.id || "").toLowerCase())) return null;
      const assets = [], links = [], images = [], details = [];
      doc.querySelectorAll("a[href],img[src],source[src],video[src],audio[src],iframe[src],embed[src],object[data]").forEach(el => {
        const raw = el.getAttribute("href") || el.getAttribute("src") || el.getAttribute("data") || "";
        if (!raw) return;
        let abs = raw;
        try { abs = new URL(raw, parsed.href).href; } catch (e) {}
        if (el.matches("a[href]")) links.push(abs);
        if (el.matches("img[src],source[src],video[src],audio[src],iframe[src],embed[src],object[data]")) images.push(abs);
        if (/\.(pdf|pptx?|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp4|webm|mp3|wav|m4a)(?:$|[?#])/i.test(abs)) {
          assets.push(abs);
          details.push(assetDescriptor({ url: abs, name: fileNameFromUrl(abs) }, "auto-item-page"));
        }
      });
      const main = doc.querySelector("main,[role='main'],article") || doc.body;
      const textSample = stripHtml(main ? main.textContent || "" : "").slice(0, MAX_TEXT_SAMPLE);
      return {
        files: unique(assets, 500), links: unique(links, 500), images: unique(images, 500), embeddedRefs: unique(assets, 500),
        assetDetails: uniqueAssetDetails(details, 800),
        assetEvidenceConfidence: details.length ? 0.86 : 0.65,
        linkEvidenceConfidence: links.length ? 0.72 : 0.45,
        textSample, textLength: textSample.length, textSha256: "", textConfidence: textSample.length >= 100 ? "medium" : "none",
        published: null, evidenceSources: ["auto-item-page"]
      };
    } catch (e) { return null; }
  }

export function mergeExactReadingEvidenceV61318(fp, evidence) {
    const p=fp.payload || (fp.payload={});
    const oldText=String(p.textSample || '');
    const receipt=evidence.textCaptureEvidence;
    const certified=receipt && receipt.method==='EXACT_READING_FIELD' && receipt.itemId===String(fp.id);
    const weakOld=Number(p.textEvidencePriority || 0)<80 && Number(p.textEvidenceCompleteness || 0)<0.5;
    const atomOld=/^atom~[A-Za-z0-9_-]+$/.test(oldText);
    if(certified && (weakOld || atomOld)) {
      Object.assign(p,{textSample:'',textLength:0,textSha256:'',textConfidence:'none',
        textEvidencePriority:0,textEvidenceCompleteness:0,textScopeKind:''});
    }
    mergeEvidence(p,evidence,'active-editor-surface');
    if(certified && String(p.textSample || '')===String(evidence.textSample || '')) {
      p.textCaptureEvidence=receipt;p.textCaptureLimit=evidence.textCaptureLimit;
      p.textCaptureTruncated=Boolean(evidence.textCaptureTruncated);
      p.fullObservedTextLength=Number(evidence.fullObservedTextLength || 0);
      p.readingCaptureGap=String(evidence.readingCaptureGap || '');
      if(!p.textSample){p.textScopeKind='reading-content-field';p.textEvidencePriority=98;}
    }
  }

export function finalizeCapturedTextV61318(payload) {
    const p=payload || {},raw=String(p.textSample || ''),r=p.textCaptureEvidence;
    const certified=r && r.method==='EXACT_READING_FIELD' && r.capturedCharacters===raw.length &&
      r.limit===MAX_EXACT_READING_TEXT_V61318 && Number(r.observedCharacters)>=raw.length;
    const limit=certified?MAX_EXACT_READING_TEXT_V61318:MAX_TEXT_SAMPLE;
    p.textSample=raw.slice(0,limit);p.textLength=p.textSample.length;
    if(raw.length>limit){p.textCaptureTruncated=true;p.textEvidenceCompleteness=Math.min(.72,Number(p.textEvidenceCompleteness || 0));}
  }

export function readingFrameEvidenceV61311(root) {
    const frames = [];
    root.querySelectorAll('iframe[src]').forEach(frame => {
      const raw = String(frame.getAttribute('src') || '').trim();
      if (!raw) return;
      let url;
      try { url = new URL(raw,location.href).href; } catch (e) { return; }
      if (!/^https?:/i.test(url) || !shouldUseDomResourceElement(frame,url) || isAuthoringChromeUrl(url)) return;
      let status = 'NOT_READABLE', text = '';
      try {
        const doc = frame.contentDocument;
        if (doc && doc.body && doc.readyState === 'complete' && /^https?:/i.test(String(doc.URL || ''))) {
          text = String(doc.body.innerText || doc.body.textContent || '').replace(/\s+/g,' ').trim();
          status = text ? 'TEXT_CAPTURED' : 'NO_TEXT_OBSERVED';
        }
      } catch (e) { status = 'ACCESS_BLOCKED'; }
      const configParams = {};
      try {
        const parsedFrameUrl = new URL(url, location.href);
        parsedFrameUrl.searchParams.forEach((value, key) => {
          if (!(key in configParams)) configParams[key] = value;
          else if (Array.isArray(configParams[key])) configParams[key].push(value);
          else configParams[key] = [configParams[key], value];
        });
      } catch (e) {}
      frames.push({url,documentStatus:status,textSample:text.slice(0,MAX_TEXT_SAMPLE),textLength:text.length,
        textTruncated:text.length>MAX_TEXT_SAMPLE,playbackVerified:false,configParams,
        configEvidence: Object.keys(configParams).length ? 'IFRAME_SRC_QUERY_PARAMS' : 'NONE'});
    });
    return frames;
  }

export function readingNetworkRecordsV61323(fp,recorder,initialCount) {
    const observed=recorder ? recorder.takeFor(fp).slice(initialCount || 0) : [];
    const eligible=observed.filter(rec=>{
      if(String(rec.method || 'GET').toUpperCase()!=='GET' || (rec.status!=null && (rec.status<200 || rec.status>=300)) || isPerItemNetworkNoise(rec.url) || isCourseWideNetworkResponse(rec.url))return false;
      try {if(new URL(rec.url,location.href).origin!==location.origin)return false;}catch(_){return false;}
      if(isSessionScopedPayloadEndpoint(rec))return true;
      try {const u=new URL(rec.url,location.href);return (u.pathname.split('/').some(x=>decodeURIComponent(x)===String(fp.id)) || [...u.searchParams.values()].some(x=>x===String(fp.id)));}catch(_){return false;}
    });
    // Filter first. Unrelated responses must not consume the payload budget.
    const records=[];let chars=0;
    for(const rec of eligible) {
      const length=String(rec.text || '').length;
      if(records.length>=128 || chars+length>16000000)continue;
      records.push(rec);chars+=length;
    }
    return {records,recordedResponses:observed.length,eligibleResponses:eligible.length,
      processedResponses:records.length,omittedResponses:eligible.length-records.length,
      recordLimit:128,characterLimit:16000000,processedCharacters:chars,
      pendingRequests:recorder && typeof recorder.pendingFor==='function'?recorder.pendingFor(fp):0};
  }

export function mergeReadingNetworkV61312(fp, recorder, initialCount, recovery) {
    const out={responses:0,associated:0,files:0,links:0};
    if (!recovery || !recovery.captured || !recovery.evidence || !recovery.evidence.readingEditorEvidence) return out;
    const selection=readingNetworkRecordsV61323(fp,recorder,initialCount),records=selection.records;
    const {records:ignoredRecords,...networkReceipt}=selection;
    out.responses=records.length;out.networkCapture=networkReceipt;
    for (const rec of records) {
      if (String(rec.method || 'GET').toUpperCase()!=='GET') continue;
      let direct=false;
      try {const u=new URL(rec.url,location.href);direct=u.pathname.split('/').some(x=>decodeURIComponent(x)===String(fp.id)) || [...u.searchParams.values()].some(x=>x===String(fp.id));}catch(e){}
      // Reuse the existing collector's bounded GET endpoint and relation pairing
      // rules after the exact target field has certified the item session.
      if (!direct && !isSessionScopedPayloadEndpoint(rec)) continue;
      if (/\/authoringAtoms\.v2\//i.test(String(rec.url)) && !direct && !sessionAtomIsRelationPaired(rec,records)) continue;
      const harvested=evidenceFromCapturedRecord(rec);
      const evidence=sanitizeSessionPayloadEvidence(harvested,{allowText:false});
      if (!evidence) continue;
      mergeEvidence(fp.payload,evidence,'active-crawl-session-network');
      fp.evidenceSources=unique([...(fp.evidenceSources || []),'active-crawl-session-network'],50);
      out.associated++;out.files+=(evidence.assetDetails || []).length;out.links+=(evidence.links || []).length;
    }
    fp.payload.readingAttachmentEvidence={...recovery.evidence.readingAttachmentEvidence,...readingAttachmentCoverageV61323(recovery.evidence.textSample,fp.payload.assetDetails),
      itemId:String(fp.id),courseId:String(recovery.evidence.readingEditorEvidence.courseId),network:networkReceipt,
      waitStopReason:recovery.evidence.readingAttachmentEvidence && recovery.evidence.readingAttachmentEvidence.waitStopReason || 'NOT_OBSERVED'};
    return out;
  }
