import { createCtiProgressPanelV1 } from "./progress.js";
import { sha256, absoluteUrl, sameOrigin, findOrgUnitId, listObjects, getId, activityTypeLabel, ctiDeclaredQuizCountFromText_, flattenTree, download } from "./text-and-dom.js";
import { topicEvidencePolicy } from "./evidence.js";
/*
 * CTI Source LMS Ground-Truth Extractor — Brightspace v1.0.8
 * Read-only live-source ground-truth collector for a Brightspace course you are already authorized to view.
 *
 * Safety model:
 *   - GET requests only. No POST, PUT, PATCH, DELETE, Save, Publish, Edit, Grade, or enrollment actions.
 *   - Does not fetch learner submissions, quiz attempts, discussion posts, grades, classlists, or rendered dynamic assessment/discussion/submission pages.
 *   - Same-origin API/content requests only; external URLs are recorded but not fetched.
 *   - Does not click through the UI, so it will not intentionally alter navigation or course content.
 *
 * Run from DevTools Console while logged into the Brightspace course.
 * Output:
 *   CTI__BRIGHTSPACE__<course>__ORG_<orgUnitId>__<local-date-time-zone>__v1.0.8_s2__SOURCE_GROUND_TRUTH.json
 *
 * JSON-only build: no HTML report is generated or downloaded.
 */
(async () => {
  'use strict';

  const VERSION = 'v1.0.8';
  const BUILD_ID = 'v1.0.8-described-counts-20260930';
  const SCHEMA_VERSION = 2;
  const MAX_HTML_BYTES = 3_000_000;
  const MAX_TEXT_CHARS = 80_000;
  const MAX_LINKS_PER_PAGE = 250;
  const MAX_QUIZZES = 100;
  const MAX_ASSIGNMENTS = 150;
  const MAX_FORUMS = 100;
  const MAX_QUESTIONS_PER_QUIZ = 5000;
  const MAX_REQUESTS = 1200;
  const REQUEST_DELAY_MS = 120;

  if (window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__) {
    console.warn('CTI Brightspace Source Ground-Truth Extractor is already running in this tab.');
    return;
  }
  window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__ = true;

  // CTI_PROGRESS_BEGIN
  // CTI_PROGRESS_BEGIN: isolated display; never part of course evidence.

  // CTI_PROGRESS_END
  const ctiProgress = createCtiProgressPanelV1("CTI · Brightspace v1.0.8", {key:"__CTI_BRIGHTSPACE_PROGRESS__"});
  function brightspaceProgressV1(patch) { try { ctiProgress.update(patch); } catch (_) {} }
  brightspaceProgressV1({phase:"Find course",detail:"Identifying the current course and API access."});
  // CTI_PROGRESS_END
  const startedAt = new Date().toISOString();
  const diagnostics = [];
  const apiAccess = {};
  const permissionBlocks = [];
  let requestCount = 0;
  let apiGloballyBlocked = false;

  const log = (msg, data) => {
    console.log('%c[CTI Brightspace] ' + msg, 'color:#2563eb;font-weight:600', data === undefined ? '' : data);
  };
  const warn = (msg, data) => {
    console.warn('[CTI Brightspace] ' + msg, data === undefined ? '' : data);
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = v => String(v == null ? '' : v).replace(/\u0000/g, '').replace(/[\t\r]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const slug = s => clean(s).replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'course';
  const now = () => new Date().toISOString();
  const fileTimestamp = (date = new Date()) => {
    const pad = n => String(n).padStart(2, '0');
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? 'p' : 'm';
    const abs = Math.abs(offset);
    const zone = `UTC${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${zone}`;
  };

  function richText(value, depth=0) {
    if(value==null||depth>12) return {html:'',text:''};
    if(typeof value==='string'){
      const div=document.createElement('div');div.innerHTML=value;
      return {html:value,text:clean(div.innerText||div.textContent||'')};
    }
    if(typeof value!=='object')return {html:'',text:''};
    const nested=value.Text==null?value.text:value.Text;
    const child=nested&&typeof nested==='object'?richText(nested,depth+1):null;
    const rawHtml=value.Html||value.html||value.Content||value.content;
    const html=typeof rawHtml==='string'?rawHtml:(child?child.html:'');
    let text=typeof nested==='string'?clean(nested):(child?child.text:'');
    if(!text&&html){const div=document.createElement('div');div.innerHTML=html;text=clean(div.innerText||div.textContent||'');}
    return {html,text};
  }

  function assignmentInstructions(a) {
    for(const value of [a.CustomInstructions,a.Instructions,a.Description,a.description]){const result=richText(value);if(result.text || result.html)return result;}
    return {html:'',text:''};
  }

  function getCourseTitle() {
    const pageH1 = clean((document.querySelector('h1') || {}).textContent || '');
    let docTitle = clean(document.title).replace(/\s*[|]\s*Brightspace.*$/i, '');
    // Common Brightspace page prefixes are UI context, not part of the course title.
    docTitle = docTitle.replace(/^(?:Homepage|Content|Course Home|Course Admin(?:istration)?|Grades|Discussions|Assignments|Quizzes)\s*[-–—:]\s*/i, '');
    // NCE commonly formats the browser title as "Current item - Course name".
    if (pageH1 && docTitle.toLowerCase().startsWith(pageH1.toLowerCase() + ' - ')) {
      const tail = clean(docTitle.slice(pageH1.length + 3));
      if (tail) return tail;
    }
    const selectors = ['[data-testid="course-title"]', '.d2l-navigation-s-main-wrapper h1', 'header h1', 'h1'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = clean(el && el.textContent);
      if (t && t.length < 250 && !/^(?:course administration|homepage|content)$/i.test(t)) return t.replace(/^Homepage\s*[-–—:]\s*/i, '');
    }
    return docTitle || 'Brightspace Course';
  }

  function requestGuard(label, url) {
    if (requestCount >= MAX_REQUESTS) {
      const err = new Error(`Safety request cap reached (${MAX_REQUESTS}). No further requests will be made.`);
      err.code = 'REQUEST_CAP';
      throw err;
    }
    requestCount++;  // CTI_PROGRESS_BEGIN
    if (typeof brightspaceProgressV1 === "function") brightspaceProgressV1({detail:"Request: " + label, count:requestCount + " requests started"});
  // CTI_PROGRESS_END

    return true;
  }

  function markPermissionDenied(label, url, status) {
    const item = {label, url, status, at:now()};
    permissionBlocks.push(item);
    return item;
  }

  async function fetchJson(url, label) {
    const abs = absoluteUrl(url);
    if (!abs || !sameOrigin(abs)) throw new Error('Blocked non-same-origin request: ' + url);
    requestGuard(label, abs);
    const t0 = performance.now();
    try {
      const res = await fetch(abs, {
        method:'GET',
        credentials:'same-origin',
        cache:'no-store',
        redirect:'follow',
        headers:{'Accept':'application/json, text/plain, */*'}
      });
      const ms = Math.round(performance.now() - t0);
      const ct = res.headers.get('content-type') || '';
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) {}
      diagnostics.push({label, url:abs, status:res.status, ok:res.ok, contentType:ct, bytes:text.length, ms});
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) markPermissionDenied(label, abs, res.status);
        const err = new Error(label + ' returned HTTP ' + res.status);
        err.status = res.status;
        err.permissionDenied = (res.status === 401 || res.status === 403);
        err.body = text.slice(0, 500);
        throw err;
      }
      if (json == null) throw new Error(label + ' did not return JSON.');
      return json;
    } catch (e) {
      diagnostics.push({label, url:abs, status:e.status || 0, ok:false, error:String(e.message || e)});
      throw e;
    }
  }

  async function fetchSameOriginPage(url, label) {
    const abs = absoluteUrl(url);
    if (!abs || !sameOrigin(abs)) return { status:'EXTERNAL_NOT_FETCHED', url:abs || clean(url) };
    if (/\/d2l\/api\//i.test(abs)) return { status:'API_URL_SKIPPED', url:abs };
    requestGuard(label, abs);
    const t0 = performance.now();
    try {
      const res = await fetch(abs, {method:'GET', credentials:'same-origin', cache:'no-store', redirect:'follow'});
      const ms = Math.round(performance.now() - t0);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const len = Number(res.headers.get('content-length') || 0);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) markPermissionDenied(label, abs, res.status);
        return { status:'HTTP_' + res.status, url:abs, contentType:ct, ms };
      }
      if (len && len > MAX_HTML_BYTES) return { status:'SKIPPED_LARGE', url:abs, contentType:ct, contentLength:len, ms };
      if (!/(text\/html|text\/plain|application\/xhtml\+xml)/i.test(ct)) {
        return { status:'NON_TEXT_ASSET', url:abs, contentType:ct, contentLength:len || null, ms };
      }
      const html = await res.text();
      if (html.length > MAX_HTML_BYTES) return { status:'SKIPPED_LARGE', url:abs, contentType:ct, contentLength:html.length, ms };
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const documentUrl=res.url || abs;
      const baseElement=doc.querySelector('base[href]');
      const declaredBase=baseElement ? baseElement.getAttribute('href') : '';
      const documentBase=declaredBase ? (absoluteUrl(declaredBase,documentUrl) || documentUrl) : documentUrl;
      doc.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
      const text = clean((doc.body && (doc.body.innerText || doc.body.textContent)) || '').slice(0, MAX_TEXT_CHARS);
      const links = Array.from(doc.querySelectorAll('a[href]')).slice(0,MAX_LINKS_PER_PAGE).map(a => ({
        text:clean(a.textContent).slice(0,500), rawHref:a.getAttribute('href'), href:absoluteUrl(a.getAttribute('href'),documentBase)
      })).filter(x => x.href);
      const embeds = Array.from(doc.querySelectorAll('iframe[src],embed[src],object[data],video[src],audio[src],source[src]')).slice(0,200).map(el => ({
        tag:el.tagName.toLowerCase(), rawUrl:el.getAttribute('src') || el.getAttribute('data') || '', url:absoluteUrl(el.getAttribute('src') || el.getAttribute('data') || '',documentBase)
      })).filter(x => x.url);
      const images = Array.from(doc.querySelectorAll('img[src]')).slice(0,200).map(img => ({
        alt:clean(img.getAttribute('alt') || '').slice(0,500), rawUrl:img.getAttribute('src') || '', url:absoluteUrl(img.getAttribute('src') || '',documentBase)
      })).filter(x => x.url);
      return {
        status:'CAPTURED', url:abs, documentUrl, documentBase, contentType:ct, text, textLength:text.length,
        textSha256:await sha256(text), links, embeds, images, ms
      };
    } catch (e) {
      return { status:'FETCH_ERROR', url:abs, error:String(e.message || e) };
    }
  }

  // Documented ObjectListPage.Next is followed only within this exact quiz's
  // question-definition endpoint. No attempt, grade or response endpoints.
  async function fetchDefinitionPagesV106(initialUrl,label,limit,idFields) {
    const base=new URL(initialUrl,location.origin),objects=[],seen=new Set(),ids=new Set();
    const evidence={pages:0,returnedDefinitions:0,capturedDefinitions:0,duplicates:0,complete:false,stopReason:'',responseKeys:[]};
    let next=base.href;
    while(next && evidence.pages<300) {
      let url;try{url=new URL(next,base.href);}catch(_){evidence.stopReason='INVALID_NEXT_URL';break;}
      if(url.origin!==base.origin || url.pathname.replace(/\/$/,'')!==base.pathname.replace(/\/$/,'') || url.username || url.password || url.hash){evidence.stopReason='OUT_OF_SCOPE_NEXT_URL';break;}
      if(seen.has(url.href)){evidence.stopReason='REPEATED_PAGE';break;}seen.add(url.href);
      let payload;try{payload=await fetchJson(url.href,label+' page '+(evidence.pages+1));}
      catch(e){if(!evidence.pages)throw e;evidence.stopReason='PAGE_UNAVAILABLE';evidence.error=String(e.message || e);break;}
      evidence.pages++;
      const list=Array.isArray(payload)?payload:payload && Array.isArray(payload.Objects)?payload.Objects:null;
      if(!list){evidence.stopReason='UNRECOGNIZED_PAGE_SHAPE';break;}
      evidence.responseKeys=Array.isArray(payload)?['ARRAY']:Object.keys(payload).slice(0,20);
      evidence.returnedDefinitions+=list.length;
      let omitted=false;
      for(const q of list) {
        const rawId=getId(q,idFields || ['QuestionId']);
        const id=rawId==null?'':String(rawId);
        if(id && ids.has(id)){evidence.duplicates++;continue;}
        if(objects.length>=limit){omitted=true;continue;}
        if(id)ids.add(id);objects.push(q);
      }
      if(omitted){evidence.stopReason='DEFINITION_LIMIT';break;}
      if(!Array.isArray(payload) && !Object.prototype.hasOwnProperty.call(payload,'Next')){evidence.stopReason='MISSING_NEXT_MARKER';break;}
      next=Array.isArray(payload)?null:payload.Next;
      if(next==null || next===''){evidence.complete=true;evidence.stopReason='END_OF_API_PAGES';break;}
      if(typeof next!=='string'){evidence.stopReason='INVALID_NEXT_URL';break;}
      if(objects.length>=limit){evidence.stopReason='DEFINITION_LIMIT';break;}
      await sleep(REQUEST_DELAY_MS);
    }
    if(!evidence.stopReason)evidence.stopReason='PAGE_LIMIT';
    evidence.capturedDefinitions=objects.length;
    return {objects,evidence};
  }

  async function fetchQuestionPagesV105(initialUrl,label,limit) {
    return fetchDefinitionPagesV106(initialUrl,label,limit,['QuestionId']);
  }

  async function getLeVersion() {
    try {
      const v = await fetchJson('/d2l/api/le/versions/', 'LE versions');
      apiAccess.versions = {status:'PASS'};
      if (v && v.LatestVersion) return String(v.LatestVersion);
      if (v && Array.isArray(v.SupportedVersions) && v.SupportedVersions.length) return String(v.SupportedVersions[v.SupportedVersions.length-1]);
      apiAccess.versions = {status:'UNAVAILABLE', error:'Version endpoint returned no usable LE version.'};
      return '';
    } catch (e) {
      apiAccess.versions = {
        status:e && e.permissionDenied ? 'PERMISSION_DENIED' : 'UNAVAILABLE',
        error:String(e.message || e)
      };
      if (e && e.permissionDenied) apiGloballyBlocked = true;
      return '';
    }
  }

  const orgUnitDetection = findOrgUnitId();
  const orgUnitId = orgUnitDetection && orgUnitDetection.id;
  if (!orgUnitId) {
    window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__ = false;
    console.error('[CTI Brightspace] Org Unit detection diagnostics:', {
      href:location.href,
      title:document.title,
      resourceCount:(performance.getEntriesByType('resource') || []).length,
      detection:orgUnitDetection
    });
    throw new Error('Could not determine the Brightspace Org Unit ID from the current page. Make sure you are inside the intended Brightspace course. The course Home or Content page is recommended.');
  }
  const courseTitle = getCourseTitle();
  // CTI_PROGRESS_BEGIN
  brightspaceProgressV1({phase:"Check API access",detail:courseTitle});
  // CTI_PROGRESS_END
  const leVersion = await getLeVersion();

  log('Starting read-only capture', {courseTitle, orgUnitId, orgUnitSource:orgUnitDetection.source, leVersion:leVersion || 'API unavailable'});

  const topicById = new Map();
  const moduleVisited = new Set();

  async function normalizeTopic(topic, path) {
    const id = getId(topic, ['Id','TopicId','id','topicId']);  // CTI_PROGRESS_BEGIN
    if (typeof brightspaceProgressV1 === "function") brightspaceProgressV1({detail:String(topic.Title || topic.Name || id || "Content topic"),count:topicById.size + " topic definitions collected"});
  // CTI_PROGRESS_END

    let detail = topic || {};
    if (id != null) {
      try {
        detail = await fetchJson(`/d2l/api/le/${leVersion}/${orgUnitId}/content/topics/${id}`, `Content topic ${id}`);
        apiAccess.contentTopics = apiAccess.contentTopics || {status:'PASS', fetched:0, failed:0};
        apiAccess.contentTopics.fetched++;
      } catch (e) {
        apiAccess.contentTopics = apiAccess.contentTopics || {status:'PARTIAL', fetched:0, failed:0};
        apiAccess.contentTopics.status = 'PARTIAL';
        apiAccess.contentTopics.failed++;
      }
    }
    const desc = richText(detail.Description || detail.description || topic.Description || topic.description);
    const url = absoluteUrl(detail.Url || detail.URL || detail.url || topic.Url || topic.URL || topic.url || '');
    const out = {
      kind:'TOPIC',
      id:id == null ? '' : String(id),
      title:clean(detail.Title || detail.Name || detail.title || topic.Title || topic.Name || topic.title || 'Untitled topic'),
      path:path.slice(),
      topicType:detail.TopicType == null ? (topic.TopicType == null ? null : topic.TopicType) : detail.TopicType,
      contentType:detail.Type == null ? (topic.Type == null ? 1 : topic.Type) : detail.Type,
      typeIdentifier:clean(detail.TypeIdentifier || detail.typeIdentifier || topic.TypeIdentifier || topic.typeIdentifier || ''),
      activityId:getId(detail,['ActivityId','activityId']) || getId(topic,['ActivityId','activityId']) || null,
      activityType:detail.ActivityType == null ? (topic.ActivityType == null ? null : topic.ActivityType) : detail.ActivityType,
      activityTypeLabel:activityTypeLabel(detail.ActivityType == null ? topic.ActivityType : detail.ActivityType),
      parentModuleId:getId(detail,['ParentModuleId','parentModuleId']) || getId(topic,['ParentModuleId','parentModuleId']) || null,
      toolId:getId(detail,['ToolId','toolId']) || getId(topic,['ToolId','toolId']) || null,
      toolItemId:getId(detail,['ToolItemId','toolItemId']) || getId(topic,['ToolItemId','toolItemId']) || null,
      gradeItemId:getId(detail,['GradeItemId','gradeItemId']) || getId(topic,['GradeItemId','gradeItemId']) || null,
      lastModifiedDate:detail.LastModifiedDate || topic.LastModifiedDate || null,
      duration:detail.Duration == null ? (topic.Duration == null ? null : topic.Duration) : detail.Duration,
      url,
      isHidden:detail.IsHidden == null ? (topic.IsHidden == null ? null : !!topic.IsHidden) : !!detail.IsHidden,
      isLocked:detail.IsLocked == null ? (topic.IsLocked == null ? null : !!topic.IsLocked) : !!detail.IsLocked,
      isBroken:detail.IsBroken == null ? (topic.IsBroken == null ? null : !!topic.IsBroken) : !!detail.IsBroken,
      openAsExternalResource:detail.OpenAsExternalResource == null ? null : !!detail.OpenAsExternalResource,
      startDate:detail.StartDate || topic.StartDate || null,
      endDate:detail.EndDate || topic.EndDate || null,
      dueDate:detail.DueDate || topic.DueDate || null,
      description:desc,
      contentEvidence:null
    };
    const evidencePolicy = topicEvidencePolicy(out.activityType, url);
    out.evidencePolicy = evidencePolicy;
    if (evidencePolicy.fetch) out.contentEvidence = await fetchSameOriginPage(url, `Topic content ${id || out.title}`);
    else if (url) out.contentEvidence = {status:evidencePolicy.status, url, reason:evidencePolicy.reason};
    if (id != null) topicById.set(String(id), out);  // CTI_PROGRESS_BEGIN
    if (typeof brightspaceProgressV1 === "function") brightspaceProgressV1({detail:out.title,count:topicById.size + " topic definitions collected"});
  // CTI_PROGRESS_END

    return out;
  }

  async function normalizeModule(module, parentPath) {
    const id = getId(module, ['Id','ModuleId','id','moduleId']);
    const title = clean(module.Title || module.Name || module.title || module.name || 'Untitled module');
    const path = parentPath.concat([title]);
    const out = {
      kind:'MODULE', id:id == null ? '' : String(id), title, path,
      isHidden:module.IsHidden == null ? null : !!module.IsHidden,
      isLocked:module.IsLocked == null ? null : !!module.IsLocked,
      description:richText(module.Description || module.description),
      children:[]
    };
    if (id == null || moduleVisited.has(String(id))) return out;
    moduleVisited.add(String(id));
    try {
      const structure = await fetchJson(`/d2l/api/le/${leVersion}/${orgUnitId}/content/modules/${id}/structure/`, `Module structure ${id}`);
      apiAccess.contentModules = apiAccess.contentModules || {status:'PASS', fetched:0, failed:0};
      apiAccess.contentModules.fetched++;
      const modules = (!Array.isArray(structure) && (structure.Modules || structure.modules) || []).slice();
      const topics = (!Array.isArray(structure) && (structure.Topics || structure.topics) || []).slice();
      // Brightspace documents this route as a JSON array of ContentObject blocks.
      // Some contracts can instead wrap children in Structure/Items, so support both.
      const ordered = Array.isArray(structure)
        ? structure
        : (structure.Structure || structure.structure || structure.Items || structure.items || []);
      if (Array.isArray(ordered) && ordered.length) {
        for (const child of ordered) {
          if (!child || typeof child !== 'object') continue;
          const numericType = child.Type == null
            ? (child.ContentType == null ? NaN : Number(child.ContentType))
            : Number(child.Type);
          const isModule = numericType === 0
            || (numericType !== 1 && (/module/i.test(String(child.TypeIdentifier || child.ObjectType || child.type || ''))
              || Array.isArray(child.Structure) || Array.isArray(child.Modules) || Array.isArray(child.Topics)));
          if (isModule) out.children.push(await normalizeModule(child, path));
          else out.children.push(await normalizeTopic(child, path));
          await sleep(REQUEST_DELAY_MS);
        }
      } else {
        for (const m of modules) { out.children.push(await normalizeModule(m, path)); await sleep(REQUEST_DELAY_MS); }
        for (const t of topics) { out.children.push(await normalizeTopic(t, path)); await sleep(REQUEST_DELAY_MS); }
      }
    } catch (e) {
      apiAccess.contentModules = apiAccess.contentModules || {status:'PARTIAL', fetched:0, failed:0};
      apiAccess.contentModules.status = 'PARTIAL';
      apiAccess.contentModules.failed++;
      out.structureError = String(e.message || e);
    }
    return out;
  }

  // CTI_PROGRESS_BEGIN
  brightspaceProgressV1({phase:"Read modules and topics",detail:"Discovering the content tree. Total is not yet known."});
  // CTI_PROGRESS_END
  let contentTree = [];
  if (!leVersion || apiGloballyBlocked) {
    apiAccess.contentRoot = {status:'SKIPPED', error:'Brightspace LE API version was not available to this session; no further API routes were attempted.'};
  } else try {
    const root = await fetchJson(`/d2l/api/le/${leVersion}/${orgUnitId}/content/root/`, 'Content root');
    apiAccess.contentRoot = {status:'PASS'};
    const roots = Array.isArray(root) ? root : listObjects(root);
    for (const mod of roots) {
      contentTree.push(await normalizeModule(mod, []));
      await sleep(REQUEST_DELAY_MS);
    }
  } catch (e) {
    apiAccess.contentRoot = {status:e && e.permissionDenied ? 'PERMISSION_DENIED' : 'FAIL', error:String(e.message || e)};
    // Do not try alternate API routes after a permission denial.
    if (e && e.permissionDenied) {
      apiAccess.contentToc = {status:'SKIPPED', error:'Alternate content route was not attempted after 401/403.'};
    } else try {
      const toc = await fetchJson(`/d2l/api/le/${leVersion}/${orgUnitId}/content/toc`, 'Content TOC');
      apiAccess.contentToc = {status:'PASS'};
      const roots = Array.isArray(toc) ? toc : listObjects(toc);
      for (const mod of roots) contentTree.push(await normalizeModule(mod, []));
    } catch (tocErr) {
      apiAccess.contentToc = {status:tocErr && tocErr.permissionDenied ? 'PERMISSION_DENIED' : 'FAIL', error:String(tocErr.message || tocErr)};
    }
  }

  // Assignments: definitions only. Never submissions or learner data.
  // CTI_PROGRESS_BEGIN
  brightspaceProgressV1({phase:"Read assignments",detail:"Reading assignment definitions and instructions."});
  // CTI_PROGRESS_END
  let assignments = [];
  if (!leVersion || apiGloballyBlocked) {
    apiAccess.assignments = {status:'SKIPPED', error:'LE API unavailable; not attempted.'};
  } else try {
    const payload = await fetchJson(`/d2l/api/le/${leVersion}/${orgUnitId}/dropbox/folders/`, 'Assignments list');
    apiAccess.assignments = {status:'PASS'};
    assignments = listObjects(payload).slice(0, MAX_ASSIGNMENTS).map(a => ({
      id:String(getId(a,['Id','FolderId','id','folderId']) || ''),
      name:clean(a.Name || a.Title || a.name || a.title || ''),
      type:a.Type == null ? null : a.Type,
      categoryId:a.CategoryId == null ? null : a.CategoryId,
      startDate:a.StartDate || null,
      endDate:a.EndDate || null,
      dueDate:a.DueDate || null,
      isHidden:a.IsHidden == null ? null : !!a.IsHidden,
      assessment:a.Assessment || null,
      instructions:assignmentInstructions(a),
      raw:a
    }));
  } catch (e) { apiAccess.assignments = {status:e && e.permissionDenied ? 'PERMISSION_DENIED' : 'UNAVAILABLE', error:String(e.message || e)}; }

  function declaredQuestionCountFromQuiz(q) {
    const rt = richText(q && (q.Description || q.description));
    return ctiDeclaredQuizCountFromText_(clean(rt.text));
  }

  // Quizzes + question definitions only. Never attempts, grades, or user responses.
  // CTI_PROGRESS_BEGIN
  brightspaceProgressV1({phase:"Read quizzes",detail:"Reading quiz and question definitions."});
  // CTI_PROGRESS_END
  let quizzes = [];
  if (!leVersion || apiGloballyBlocked) {
    apiAccess.quizzes = {status:'SKIPPED', error:'LE API unavailable; not attempted.'};
  } else try {
    const inventory = await fetchDefinitionPagesV106(`/d2l/api/le/${leVersion}/${orgUnitId}/quizzes/`, 'Quizzes list', MAX_QUIZZES, ['QuizId','Id','quizId','id']);
    apiAccess.quizzes = {status:inventory.evidence.complete?'PASS':'PARTIAL', inventoryEvidence:inventory.evidence};
    const qs = inventory.objects;
    for (const q of qs) {  // CTI_PROGRESS_BEGIN
      brightspaceProgressV1({detail:String(q.Name || q.Title || "Quiz"),completed:quizzes.length,total:qs.length,
        count:quizzes.length + "/" + qs.length + " quizzes processed"});
  // CTI_PROGRESS_END

      const qid = getId(q,['QuizId','Id','quizId','id']);
      const quiz = {
        id:String(qid || ''),
        name:clean(q.Name || q.Title || q.name || q.title || ''),
        description:richText(q.Description || q.description),
        isActive:q.IsActive == null ? null : !!q.IsActive,
        startDate:q.StartDate || null,
        endDate:q.EndDate || null,
        dueDate:q.DueDate || null,
        attemptsAllowed:q.AttemptsAllowed == null ? null : q.AttemptsAllowed,
        timeLimit:q.SubmissionTimeLimit == null ? (q.TimeLimit == null ? null : q.TimeLimit) : q.SubmissionTimeLimit,
        raw:q,
        questions:[],
        questionsStatus:'NOT_REQUESTED'
      };
      if (qid != null) {
        try {
          const qp = await fetchQuestionPagesV105(`/d2l/api/le/${leVersion}/${orgUnitId}/quizzes/${qid}/questions/`, `Quiz questions ${qid}`, MAX_QUESTIONS_PER_QUIZ);
          quiz.questions = qp.objects;
          quiz.questionPageEvidence = qp.evidence;
          quiz.questionsStatus = qp.evidence.complete ? 'CAPTURED' : 'PARTIAL';
        } catch (qe) {
          quiz.questionsStatus = 'UNAVAILABLE';
          quiz.questionsError = String(qe.message || qe);
        }
      }
      quiz.declaredQuestionCount = declaredQuestionCountFromQuiz(q);
      quiz.capturedQuestionCount = quiz.questions.length;
      quiz.questionCountStatus = quiz.questionsStatus !== 'CAPTURED' ? 'UNAVAILABLE' : (quiz.declaredQuestionCount == null ? 'CAPTURED_NO_DECLARED_COUNT' : (quiz.declaredQuestionCount === quiz.capturedQuestionCount ? 'MATCH' : 'MISMATCH'));
      quiz.questionCoverage = {definitionCount:quiz.questions.length,
        status:quiz.questionsStatus!=='CAPTURED'?'PARTIAL_OR_UNAVAILABLE':!quiz.questions.length?'NO_DEFINITIONS_RETURNED':quiz.declaredQuestionCount==null?'TOTAL_UNVERIFIED':quiz.questionCountStatus,
        completenessVerified:false, describedCountMatchesDefinitions:quiz.questionsStatus==='CAPTURED' && quiz.declaredQuestionCount!=null && quiz.declaredQuestionCount===quiz.questions.length,
        meaning:'API page completion does not verify pool membership or the total source question bank. No returned definitions is not proof of an empty quiz.'};
      quizzes.push(quiz);  // CTI_PROGRESS_BEGIN
      brightspaceProgressV1({detail:quiz.name,completed:quizzes.length,total:qs.length,
        count:quizzes.length + "/" + qs.length + " quizzes processed · " + quizzes.reduce((n,q) => n + q.questions.length,0) + " question definitions collected"});
  // CTI_PROGRESS_END

      await sleep(REQUEST_DELAY_MS);
    }
  } catch (e) { apiAccess.quizzes = {status:e && e.permissionDenied ? 'PERMISSION_DENIED' : 'UNAVAILABLE', error:String(e.message || e)}; }

  // Discussion forum/topic definitions only. Never posts or learner participation.
  // CTI_PROGRESS_BEGIN
  brightspaceProgressV1({phase:"Read discussions",detail:"Reading forum and topic definitions."});
  // CTI_PROGRESS_END
  let discussions = [];
  if (!leVersion || apiGloballyBlocked) {
    apiAccess.discussions = {status:'SKIPPED', error:'LE API unavailable; not attempted.'};
  } else try {
    const payload = await fetchJson(`/d2l/api/le/${leVersion}/${orgUnitId}/discussions/forums/`, 'Discussion forums');
    apiAccess.discussions = {status:'PASS'};
    const forums = (Array.isArray(payload) ? payload : listObjects(payload)).slice(0, MAX_FORUMS);
    for (const f of forums) {  // CTI_PROGRESS_BEGIN
      brightspaceProgressV1({detail:String(f.Name || f.Title || "Forum"),completed:discussions.length,total:forums.length,count:discussions.length + "/" + forums.length + " forums processed"});
  // CTI_PROGRESS_END

      const fid = getId(f,['ForumId','Id','forumId','id']);
      const forum = {
        id:String(fid || ''), name:clean(f.Name || f.Title || ''), description:richText(f.Description || f.description),
        isHidden:f.IsHidden == null ? null : !!f.IsHidden, raw:f, topics:[], topicsStatus:'NOT_REQUESTED'
      };
      if (fid != null) {
        try {
          const tp = await fetchJson(`/d2l/api/le/${leVersion}/${orgUnitId}/discussions/forums/${fid}/topics/`, `Discussion topics ${fid}`);
          forum.topics = Array.isArray(tp) ? tp : listObjects(tp);
          forum.topicsStatus = 'CAPTURED';
        } catch (te) {
          forum.topicsStatus = 'UNAVAILABLE';
          forum.topicsError = String(te.message || te);
        }
      }
      discussions.push(forum);  // CTI_PROGRESS_BEGIN
      brightspaceProgressV1({detail:forum.name,completed:discussions.length,total:forums.length,count:discussions.length + "/" + forums.length + " forums processed"});
  // CTI_PROGRESS_END

      await sleep(REQUEST_DELAY_MS);
    }
  } catch (e) { apiAccess.discussions = {status:e && e.permissionDenied ? 'PERMISSION_DENIED' : 'UNAVAILABLE', error:String(e.message || e)}; }

  // CTI_PROGRESS_BEGIN
  brightspaceProgressV1({phase:"Prepare JSON",detail:"Building the source inventory and recording evidence gaps."});
  // CTI_PROGRESS_END
  // DOM fallback/visual context from the page currently open. This is observational only.
  const visibleLinks = Array.from(document.querySelectorAll('a[href]')).slice(0,500).map(a => ({
    text:clean(a.textContent).slice(0,500), href:absoluteUrl(a.getAttribute('href'))
  })).filter(x => x.text || x.href);
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).slice(0,300).map(h => ({
    level:h.tagName.toLowerCase(), text:clean(h.textContent).slice(0,1000)
  })).filter(x => x.text);
  const currentBodyText = clean(document.body && (document.body.innerText || document.body.textContent) || '').slice(0, MAX_TEXT_CHARS);

  const flat = flattenTree(contentTree, []);
  const modules = flat.filter(x => x.kind === 'MODULE');
  const topics = flat.filter(x => x.kind === 'TOPIC');
  const runtimeCarriers = topics.filter(t => [7,20,21,22,23,24,26,27].includes(Number(t.activityType))).map(t => ({
    id:t.id,title:t.title,path:t.path,url:t.url,typeIdentifier:t.typeIdentifier,
    activityType:t.activityType,activityTypeLabel:t.activityTypeLabel,toolId:t.toolId,toolItemId:t.toolItemId,
    family:/scorm/i.test(t.activityTypeLabel || '') ? 'SCORM' : (/lti/i.test(t.activityTypeLabel || '') ? 'LTI' : 'RUNTIME_CARRIER'),
    contentEvidence:t.contentEvidence
  }));
  const interactiveEmbeds = [];
  topics.forEach(t => {
    const ev=t.contentEvidence || {};
    (ev.embeds || []).forEach(embed => {
      const u=String(embed && embed.url || '');
      let family='EMBED';
      if (/practices\.lcs\.brightspace\.com|practice\.html/i.test(u)) family='D2L_PRACTICE_RUNTIME';
      else if (/h5p/i.test(u)) family='H5P';
      else if (/storyline|articulate|rise/i.test(u)) family='ARTICULATE_RUNTIME';
      else if (/youtube|vimeo/i.test(u)) family='VIDEO_EMBED';
      interactiveEmbeds.push({topicId:t.id,topicTitle:t.title,path:t.path,family,tag:embed.tag || '',url:u});
    });
  });
  const interactiveHtmlTopics = Array.from(new Set(interactiveEmbeds.filter(x => x.family !== 'VIDEO_EMBED').map(x => String(x.topicId || x.topicTitle)))).length;
  const quizCountMismatches = quizzes.filter(q => q.questionCountStatus === 'MISMATCH').map(q => ({id:q.id,name:q.name,declared:q.declaredQuestionCount,captured:q.capturedQuestionCount}));
  const captureWarnings = [];
  if(apiAccess.quizzes && apiAccess.quizzes.status!=='PASS')captureWarnings.push('Quiz inventory is incomplete or unavailable: '+String(apiAccess.quizzes.inventoryEvidence && apiAccess.quizzes.inventoryEvidence.stopReason || apiAccess.quizzes.status)+'. The number of captured quizzes is not a verified course total.');
  const quizCoverageUnverified=quizzes.filter(q=>!q.questionCoverage.completenessVerified);
  if(quizCoverageUnverified.length)captureWarnings.push(quizCoverageUnverified.length+' quizzes have unverified question-definition coverage. Inspect questionCoverage and questionPageEvidence; do not treat an empty API response as an empty source quiz.');
  if (permissionBlocks.length) captureWarnings.push('Some resources were unavailable because Brightspace returned 401/403. They remain unverified; the extractor did not attempt a workaround.');
  if (quizCountMismatches.length) captureWarnings.push('One or more Brightspace quiz declared-question counts differ from the definitions returned by the question API. Review the per-quiz mismatch records.');

  const capture = {
    schemaVersion:SCHEMA_VERSION,
    extractor:'CTI Source LMS Ground-Truth Extractor — Brightspace ' + VERSION,
    buildId:BUILD_ID,
    capturedAt:now(),
    startedAt,
    page:{url:location.href,title:document.title,origin:location.origin},
    course:{orgUnitId:String(orgUnitId), orgUnitDetection, title:courseTitle, leApiVersion:leVersion},
    safety:{
      readOnly:true,
      methodsUsed:['GET'],
      intentionallyNotCollected:['learner submissions','quiz attempts','discussion posts','grades','classlist/user roster','private messages'],
      externalUrlsFetched:false,
      uiClicksPerformed:false,
      permissionRule:'401/403 means unavailable. The script does not attempt to bypass or work around denied resources.',
      maxRequests:MAX_REQUESTS,
      requestDelayMs:REQUEST_DELAY_MS
    },
    requestCount,
    permissionBlocks,
    apiAccess,
    summary:{
      modules:modules.length,
      topics:topics.length,
      assignments:assignments.length,
      quizzes:quizzes.length,
      quizQuestions:quizzes.reduce((n,q) => n + (q.questions || []).length,0),
      discussionForums:discussions.length,
      discussionTopics:discussions.reduce((n,f) => n + (f.topics || []).length,0),
      runtimeCarriers:runtimeCarriers.length,
      scormPackages:runtimeCarriers.filter(x => x.family === 'SCORM').length,
      ltiActivities:runtimeCarriers.filter(x => x.family === 'LTI').length,
      interactiveEmbedCount:interactiveEmbeds.filter(x => x.family !== 'VIDEO_EMBED').length,
      interactiveHtmlTopics,
      videoEmbeds:interactiveEmbeds.filter(x => x.family === 'VIDEO_EMBED').length,
      quizDeclaredCountMismatches:quizCountMismatches.length,
      quizQuestionCoverageUnverified:quizCoverageUnverified.length,
      topicsWithCapturedPageText:topics.filter(t => t.contentEvidence && t.contentEvidence.status === 'CAPTURED').length,
      topicsWithDefinitionOnlyEvidence:topics.filter(t => t.contentEvidence && t.contentEvidence.status === 'DEFINITION_API_ONLY').length,
      topicsWithExternalOrBinaryContent:topics.filter(t => t.contentEvidence && !['CAPTURED','DEFINITION_API_ONLY'].includes(t.contentEvidence.status)).length
    },
    contentTree,
    assignments,
    quizzes,
    discussions,
    runtimeCarriers,
    interactiveEmbeds,
    quizCountMismatches,
    captureWarnings,
    domFallback:{headings,visibleLinks,currentPageText:currentBodyText,currentPageTextSha256:await sha256(currentBodyText)},
    diagnostics
  };

  const exportFileName = `CTI__BRIGHTSPACE__${slug(courseTitle)}__ORG_${slug(orgUnitId)}__${fileTimestamp(new Date())}__v1.0.8_s2__SOURCE_GROUND_TRUTH.json`;
  capture.exportFileName = exportFileName;
  // CTI_PROGRESS_BEGIN
  capture.runtime = {elapsedMs:ctiProgress.snapshot().elapsedMs, phaseDurationsMs:ctiProgress.snapshot().phaseDurationsMs};
  // CTI_PROGRESS_END
  download(exportFileName, JSON.stringify(capture, null, 2), 'application/json;charset=utf-8');

  window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_LAST__ = capture;
  window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__ = false;
  console.log('%cCTI Brightspace Source Ground-Truth Capture complete', 'color:#059669;font-size:16px;font-weight:bold');
  console.table(capture.summary);
  console.log('Full capture is also available as window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_LAST__');  // CTI_PROGRESS_BEGIN
  const progressHasGaps = captureWarnings.length > 0 || Object.values(apiAccess).some(a => a.status !== "PASS") ||
    topics.some(t => !t.contentEvidence || t.contentEvidence.status !== "CAPTURED") || quizzes.some(q => !q.questionCoverage.completenessVerified) || discussions.some(f => f.topicsStatus !== "CAPTURED");
  brightspaceProgressV1({phase:progressHasGaps ? "Capture finished · review gaps" : "Capture finished"});
  ctiProgress.finish(progressHasGaps ? "review" : "success", "JSON prepared; download requested. External and definition-only content remain subject to their recorded evidence limits.",
    topics.length + " topics · " + quizzes.length + " quizzes · " + capture.summary.quizQuestions + " question definitions collected");
  // CTI_PROGRESS_END

})().catch(err => {
  window.__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__ = false;
  console.error('[CTI Brightspace] Capture failed:', err);  // CTI_PROGRESS_BEGIN
  try {
    const panel = window.__CTI_BRIGHTSPACE_PROGRESS__;
    if (panel) { panel.update({phase:"Capture interrupted"}); panel.finish("error", String(err && err.message || err) + " · JSON export was not completed."); }
  } catch (_) {}
  // CTI_PROGRESS_END

});
