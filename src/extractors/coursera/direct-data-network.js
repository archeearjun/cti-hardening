import { sanitizeCourseraCourseDataModel } from './direct-data-privacy.js';
import { CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1,
  CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1 } from './direct-data-widget.js';
import { directPanoptoAutomaticTargetV1, sanitizeDirectPanoptoModelV1,
  directPanoptoPodcastBindingsV1 } from './direct-data-panopto.js';
import { createDirectProviderDiagnosticsV1 } from './direct-data-provider-diagnostics.js';

/** A cooperating CTI service observes the upstream response; the browser only
 * observes service delivery. Keep those clocks and HTTP statuses separate. */
export function directProviderTransportReceiptV1(response, receipt = {}, maximumRequests = 2) {
  Object.assign(receipt,{transport:'CTI_PUBLIC_BACKEND',serviceOrigin:'https://cti-hardening.pages.dev',
    receivedAt:new Date().toISOString(),serviceStatus:Number(response?.status || 0),
    observedAt:receipt.observedAt || new Date().toISOString(),observedAtBasis:'CLIENT_ATTEMPT',status:0,upstreamRequests:0});
  const headers=response?.headers;
  if (headers?.get('X-CTI-Provider-Transport')!=='CTI_PUBLIC_BACKEND' ||
      headers.get('X-CTI-Provider-Origin')!==receipt.serviceOrigin) return false;
  const integer=name=>{const value=headers.get(name);return /^(?:0|[1-9]\d*)$/.test(value || '')?Number(value):NaN;};
  const status=integer('X-CTI-Upstream-Status'), requests=integer('X-CTI-Upstream-Requests'),
    bytes=integer('X-CTI-Upstream-Bytes'), observedAt=headers.get('X-CTI-Upstream-Observed-At');
  if (!Number.isSafeInteger(status) || status<0 || status>599 || !Number.isSafeInteger(requests) ||
      requests<0 || requests>maximumRequests || !Number.isSafeInteger(bytes) || bytes<0 || bytes>129*1024*1024) return false;
  if (status) {
    if (status<100 || !observedAt || !Number.isFinite(Date.parse(observedAt)) ||
        new Date(observedAt).toISOString()!==observedAt || !requests) return false;
    receipt.status=status;receipt.observedAt=observedAt;receipt.observedAtBasis='UPSTREAM';
  } else if (observedAt) return false;
  receipt.upstreamRequests=requests;
  return true;
}

/** Service errors are tiny typed JSON, never native error pages or messages. */
export async function directProviderTransportErrorV1(response) {
  let count=0;const chunks=[];
  try {
    const reader=response?.body?.getReader();
    if (!reader) return 'PROVIDER_HELPER_REQUEST_FAILED';
    try {
      while (true) {
        const next=await reader.read();if (next.done) break;
        if (!(next.value instanceof Uint8Array) || (count+=next.value.length)>2048) {
          await reader.cancel();return 'PROVIDER_HELPER_REQUEST_FAILED';
        }
        chunks.push(next.value);
      }
    } finally {reader.releaseLock();}
    const bytes=new Uint8Array(count);let offset=0;
    for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
    const code=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))?.error;
    return /^PANOPTO_PROVIDER_[A-Z0-9_]{1,80}$/.test(code || '')
      ? 'PROVIDER_HELPER_'+code.slice(17) : 'PROVIDER_HELPER_REQUEST_FAILED';
  } catch {return 'PROVIDER_HELPER_REQUEST_FAILED';}
}

/** Bounded transport for the observed Coursera authoring GET resources.
 * The caller supplies source binding and credential sanitization. This module
 * never guesses a resource, enumerates a collection, or renders an editor.
 */
export function createDirectDataReaderV1(options = {}) {
  const origin = 'https://www.coursera.org';
  const defaults = {concurrentRequests:4, bodyBytes:2*1024*1024, totalBytes:64*1024*1024,
    requests:20000, requestMs:30000, durationMs:60*60*1000};
  const limits = {};
  for (const [name, maximum] of Object.entries(defaults)) {
    const requested = Number(options.limits?.[name]);
    limits[name] = Number.isFinite(requested) && requested > 0
      ? Math.min(maximum, Math.max(1, Math.floor(requested))) : maximum;
  }
  const startedAt = Date.now(), fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const queue = [], controllers = new Set(), cancellation = new AbortController();
  const stats = {requests:0, bytes:0, completed:0, failed:0, retries:0, rateLimitRetries:0,
    active:0, maxConcurrentRequests:0, queued:0, statsHookFailures:0, byResource:{}};
  let stopReason = '', authenticationFailed = false, durationTimer = null;

  function snapshot() {
    return {...stats, queued:queue.length, elapsedMs:Math.max(0, Date.now()-startedAt),
      stopped:!!stopReason, stopReason, authenticationFailed, limits:{...limits},
      byResource:{...stats.byResource}};
  }
  function notify() {
    if (typeof options.onStats !== 'function') return;
    try {
      const result = options.onStats(snapshot());
      if (result && typeof result.catch === 'function') result.catch(() => {stats.statsHookFailures++;});
    } catch {stats.statsHookFailures++;}
  }
  function failure(job, reason) {
    if (job?.diagnostics) job.receipt.diagnostics=job.diagnostics.finish(
      reason==='PANOPTO_REQUEST_TIMEOUT' ? 'TIMEOUT' :
      (stopReason || /(?:ABORTED|STOPPED)$/.test(reason)) ? 'ABORTED' :
      reason==='PANOPTO_ACCESS_BLOCKED_OR_FAILED' ? 'CORS_OR_NETWORK' : 'UNKNOWN');
    return {ok:false, data:null, reason, authenticationFailed,
      receipt:job?.receipt ? {...job.receipt,
        requestQuery:job.receipt.requestQuery.map(pair=>pair.slice()),
        ...(job.receipt.requestForm ? {requestForm:job.receipt.requestForm.map(pair=>pair.slice())} : {})} : null};
  }
  function abort(reason = 'OPERATOR_STOPPED') {
    if (stopReason) return;
    stopReason = typeof reason === 'string' && /^[A-Z0-9_]{1,96}$/.test(reason) ? reason : 'OPERATOR_STOPPED';
    clearTimeout(durationTimer);durationTimer = null;
    cancellation.abort();
    for (const controller of controllers) controller.abort();
    while (queue.length) {const job=queue.shift();stats.failed++;job.resolve(failure(job,stopReason));}
    notify();
  }
  function current() {
    if (stopReason) return false;
    if (Date.now()-startedAt >= limits.durationMs) {abort('COURSE_API_TIME_LIMIT');return false;}
    if (typeof options.assertCurrent === 'function') {
      try {
        const checked=options.assertCurrent();
        if (checked && typeof checked.then==='function') {
          if (typeof checked.catch==='function') checked.catch(()=>{});
          abort('SOURCE_CONTEXT_CHECK_FAILED');return false;
        }
        if (checked === false) {abort('SOURCE_CONTEXT_CHANGED');return false;}
      }
      catch {abort('SOURCE_CONTEXT_CHECK_FAILED');return false;}
    }
    return !stopReason;
  }
  function descriptor(resource, id, courseId) {
    if (typeof resource !== 'string' || typeof id !== 'string') return null;
    const simple = /^[A-Za-z0-9_-]{1,128}$/;
    const group = /^[A-Za-z0-9_-]{1,128}~[A-Za-z0-9_-]{1,128}$/;
    const definition = /^[A-Za-z0-9_-]{1,128}~[A-Za-z0-9_-]{1,128}@\d{1,12}$/;
    let fields = '', includes = '', all = false, trailing = false, collection = false;
    if (resource === 'authoringCourseMaterials.v1') {
      if (!simple.test(id)) return null;
      fields='material,conflictMetadata,authoringAtomRelations.v1(embeddedContentSourceCourseId)';
      includes='embeddedContentMapping';trailing=true;
    } else if (resource === 'authoringCourses.v2') {
      if (!simple.test(id)) return null;
    } else if (resource === 'authoringAtoms.v2' || resource === 'authoringItemContentRelations.v1') {
      if (!simple.test(id)) return null;
      all=true;includes='_links';
    } else if (resource === 'authoringAssignmentQuestionGroups.v1') {
      if (!group.test(id)) return null;
      all=true;includes='_links';fields='id,questions,typeName';
    } else if (resource === 'authoringAssignmentMachineEvaluableQuestions.v1') {
      if (!definition.test(id)) return null;
      all=true;includes='_links';fields='id,definition,validation';
    } else if (resource === 'authoringWidgetSessionProviders.v1') {
      if (!/^[A-Za-z0-9_-]{22}$/.test(id) || typeof courseId !== 'string' ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(courseId)) return null;
      fields=CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1;
      includes=CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1;collection=true;trailing=true;
    } else if (resource === 'assets.v1') {
      // This endpoint was observed in successful reading captures. Its known
      // multiGet format is used for one exact CML reference, never enumeration.
      if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
      all=true;collection=true;
    } else return null;
    const pathKey=encodeURIComponent(id).replace(/%40/gi,'@');
    const url=new URL('/api/'+resource+(collection?(trailing?'/':''):'/'+pathKey+(trailing?'/':'')),origin);
    if (resource === 'authoringWidgetSessionProviders.v1') {
      url.searchParams.set('q','getWithCourseId');
      url.searchParams.set('widgetSessionProviderId',id);
      url.searchParams.set('courseId',courseId);
    } else if (collection) url.searchParams.set('ids',id);
    if (resource === 'authoringAssignmentQuestionGroups.v1') url.searchParams.set('id',id);
    if (fields) url.searchParams.set('fields',fields);
    if (includes) url.searchParams.set('includes',includes);
    return {resource,id,url,all};
  }
  function receiptFor(d) {
    const value={resource:d.resource, requestPath:d.url.pathname, requestQuery:[...d.url.searchParams.entries()],
      ...(d.external ? {origin:d.url.origin,id:d.id,targetUrl:d.targetUrl,method:'POST',
        requestForm:d.form.map(pair=>pair.slice()),mime:''} : {}),
      observedAt:new Date().toISOString(), status:0, bytes:0, originalResponseSha256:'',
      bodyFormat:'PARSED_SANITIZED_JSON_MODEL', credentialFieldsRemoved:0, credentialUrlsRedacted:0};
    if (d.external && options.providerTransport) directProviderTransportReceiptV1(null,value);
    return value;
  }
  async function discard(response) {
    try {if (response?.body && typeof response.body.cancel === 'function') await response.body.cancel();}
    catch { /* A failed response body is never retained. */ }
  }
  async function bodyBytes(response, job, controller) {
    const maximum=job.descriptor.external ? Math.min(limits.bodyBytes,512*1024) : limits.bodyBytes;
    const declared=Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declared) && declared > maximum) {
      controller.abort();await discard(response);return {ok:false,reason:'API_RESPONSE_BYTE_LIMIT'};
    }
    const chunks=[];let count=0;
    function add(bytes) {
      count+=bytes.byteLength;stats.bytes+=bytes.byteLength;job.receipt.bytes=count;
      if (stats.bytes > limits.totalBytes) {abort('COURSE_API_BYTE_LIMIT');return false;}
      if (count > maximum) {controller.abort();return false;}
      chunks.push(bytes);return true;
    }
    if (response.body && typeof response.body.getReader === 'function') {
      const reader=response.body.getReader();
      const cancelBody=()=>{void reader.cancel().catch(()=>{});};
      controller.signal.addEventListener('abort',cancelBody,{once:true});
      try {
        while (!controller.signal.aborted && current()) {
          const next=await reader.read();
          if (controller.signal.aborted) return {ok:false,reason:stopReason || job.cancelReason || 'API_REQUEST_ABORTED'};
          if (next.done) break;
          if (!(next.value instanceof Uint8Array)) return {ok:false,reason:'INVALID_RESPONSE_STREAM'};
          if (!add(next.value)) {
            await reader.cancel();return {ok:false,reason:stopReason || 'API_RESPONSE_BYTE_LIMIT'};
          }
        }
        if (stopReason || controller.signal.aborted) {await reader.cancel();return {ok:false,reason:stopReason || job.cancelReason || 'API_REQUEST_ABORTED'};}
      } finally {controller.signal.removeEventListener('abort',cancelBody);reader.releaseLock();}
    } else if (typeof response.arrayBuffer === 'function') {
      const bytes=new Uint8Array(await response.arrayBuffer());
      if (controller.signal.aborted || !current()) return {ok:false,reason:stopReason || job.cancelReason || 'API_REQUEST_ABORTED'};
      if (!add(bytes)) return {ok:false,reason:stopReason || 'API_RESPONSE_BYTE_LIMIT'};
    } else return {ok:false,reason:'RESPONSE_BODY_UNAVAILABLE'};
    const bytes=new Uint8Array(count);let offset=0;
    for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return {ok:true,bytes};
  }
  async function attemptPanopto(job) {
    if (!current()) return failure(job,stopReason);
    if (stats.requests >= limits.requests) {abort('COURSE_API_REQUEST_LIMIT');return failure(job,stopReason);}
    const d=job.descriptor, controller=new AbortController();
    job.controller=controller;controllers.add(controller);
    job.receipt=receiptFor(d);stats.requests++;
    const helper=options.providerTransport;
    if (!helper) {
      job.diagnostics=createDirectProviderDiagnosticsV1(d.url.href,options.policyDocument);
      job.receipt.diagnostics=job.diagnostics.snapshot();
    }
    stats.byResource[d.resource]=(stats.byResource[d.resource] || 0)+1;notify();
    let response;
    function active() {return !controller.signal.aborted && current();}
    try {
      response=helper ? await helper.request('metadata',{targetUrl:d.targetUrl},controller.signal) :
        await fetchImpl(d.url.href,{method:'POST',mode:'cors',credentials:'omit',redirect:'error',
        headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body:new URLSearchParams(d.form).toString(),signal:controller.signal});
      if (!active()) {await discard(response);return failure(job,stopReason || job.cancelReason || 'PANOPTO_REQUEST_ABORTED');}
      if (helper) {
        const valid=directProviderTransportReceiptV1(response,job.receipt,1);
        if (!response.ok || !valid || job.receipt.status!==200 || job.receipt.upstreamRequests!==1) {
          const wire=Number(response.headers.get('X-CTI-Upstream-Bytes'));
          if (valid && Number.isSafeInteger(wire) && wire>=0 && wire<=129*1024*1024) {
            stats.bytes+=wire;job.receipt.bytes=wire;
            if (stats.bytes>limits.totalBytes) abort('COURSE_API_BYTE_LIMIT');
          }
          const reason=await directProviderTransportErrorV1(response);
          return failure(job,stopReason || (!valid?'PROVIDER_HELPER_RECEIPT_INVALID':reason));
        }
      } else {
        job.receipt.status=Number(response.status || 0);
        job.diagnostics.recordHttp(job.receipt.status);
        job.receipt.diagnostics=job.diagnostics.snapshot();
        if (!response.ok || response.status!==200) {await discard(response);return failure(job,'PANOPTO_HTTP_'+Number(response.status || 0));}
      }
      if (response.redirected || (response.url || d.url.href)!==d.url.href) {
        await discard(response);return failure(job,'PANOPTO_UNEXPECTED_REDIRECT');
      }
      const mime=String(response.headers.get('content-type') || '');
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(mime)) {
        await discard(response);return failure(job,'PANOPTO_UNEXPECTED_MIME');
      }
      job.receipt.mime=mime.split(';')[0].trim().toLowerCase();
      const body=await bodyBytes(response,job,controller);
      if (!body.ok) return failure(job,body.reason);
      if (helper && Number(response.headers.get('X-CTI-Upstream-Bytes'))!==body.bytes.length)
        return failure(job,'PROVIDER_HELPER_RECEIPT_INVALID');
      if (!active()) return failure(job,stopReason || job.cancelReason || 'PANOPTO_REQUEST_ABORTED');
      if (!globalThis.crypto?.subtle) return failure(job,'RESPONSE_HASH_UNAVAILABLE');
      const hash=await globalThis.crypto.subtle.digest('SHA-256',body.bytes);
      job.receipt.originalResponseSha256=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
      let parsed, sanitized;
      try {parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.bytes));}
      catch {return failure(job,'PANOPTO_INVALID_JSON');}
      try {sanitized=sanitizeDirectPanoptoModelV1(parsed,d.targetUrl);}
      catch {return failure(job,'PANOPTO_SOURCE_INVALID');}
      if (!sanitized || sanitized.limitReached || !sanitized.data) return failure(job,'SANITIZER_INCOMPLETE');
      const locations=new Map();
      for (const binding of directPanoptoPodcastBindingsV1(sanitized.data,d.targetUrl)) {
        const matches=parsed.Delivery?.PodcastStreams?.filter(stream=>stream?.StreamFileId===binding.streamFileId);
        const location=matches?.length===1 ? matches[0].StreamUrl : '';
        const clean=sanitizeCourseraCourseDataModel({url:location});
        if (!clean.limitReached && clean.data?.url===binding.canonicalUrl) locations.set(binding.streamFileId,location);
      }
      job.receipt.credentialFieldsRemoved=Math.max(0,Number(sanitized.removedFields) || 0);
      job.receipt.credentialUrlsRedacted=Math.max(0,Number(sanitized.redactedUrls) || 0);
      job.receipt.protectedContentIdFieldsRestored=Math.max(0,Number(sanitized.protectedContentIdFieldsRestored) || 0);
      if (!active()) return failure(job,stopReason || job.cancelReason || 'PANOPTO_REQUEST_ABORTED');
      if (job.diagnostics) job.receipt.diagnostics=job.diagnostics.snapshot();
      const result={ok:true,data:sanitized.data,receipt:{...job.receipt},reason:'',authenticationFailed:false};
      Object.defineProperty(result,'takePanoptoPodcastLocation',{enumerable:false,value:streamFileId=>{
        const location=current() ? locations.get(streamFileId) || '' : '';
        locations.delete(streamFileId);return location;
      }});
      return result;
    } catch (error) {
      // Browsers can queue the matching CSP event after rejecting fetch. One
      // bounded task turn observes that event without retrying or probing URLs.
      if (!helper && !stopReason && !controller.signal.aborted) await new Promise(resolve=>setTimeout(resolve,0));
      return failure(job,stopReason || job.cancelReason || (controller.signal.aborted?'PANOPTO_REQUEST_ABORTED':
        helper ? (/^PROVIDER_HELPER_[A-Z0-9_]{1,64}$/.test(error?.code || '')?error.code:'PROVIDER_HELPER_REQUEST_FAILED') :
          'PANOPTO_ACCESS_BLOCKED_OR_FAILED'));
    } finally {controllers.delete(controller);job.controller=null;}
  }
  async function attempt(job) {
    if (!current()) return failure(job,stopReason);
    if (stats.requests >= limits.requests) {abort('COURSE_API_REQUEST_LIMIT');return failure(job,stopReason);}
    const controller=new AbortController();controllers.add(controller);
    job.receipt=receiptFor(job.descriptor);stats.requests++;
    stats.byResource[job.descriptor.resource]=(stats.byResource[job.descriptor.resource] || 0)+1;notify();
    const headers={Accept:'application/json'};
    // ALL overrides query projections; credential removal is always delegated
    // to the required sanitizer, never claimed from a negative field query.
    if (job.descriptor.all) headers['X-Coursera-Naptime-Fields']='ALL';
    let response;
    try {
      response=await fetchImpl(job.descriptor.url.href,{method:'GET',credentials:'same-origin',
        redirect:'error',headers,signal:controller.signal});
      if (!current()) {await discard(response);return failure(job,stopReason);}
      job.receipt.status=Number(response.status || 0);
      if ([401,403].includes(response.status)) {
        authenticationFailed=true;abort('AUTHORING_API_AUTHENTICATION_FAILED');
        await discard(response);return failure(job,stopReason);
      }
      if (response.status===429) {
        const retryAfter=response.headers.get('retry-after');await discard(response);
        return {...failure(job,'RATE_LIMITED'),retryAfter};
      }
      if (!response.ok) {await discard(response);return failure(job,'HTTP_'+response.status);}
      const actual=new URL(response.url || job.descriptor.url.href);
      if (response.redirected || actual.origin!==origin || actual.pathname!==job.descriptor.url.pathname ||
          actual.search!==job.descriptor.url.search) {
        await discard(response);return failure(job,'UNEXPECTED_API_REDIRECT');
      }
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
        await discard(response);return failure(job,'UNEXPECTED_API_MIME');
      }
      const body=await bodyBytes(response,job,controller);
      if (!body.ok) return failure(job,body.reason);
      if (!current()) return failure(job,stopReason);
      if (!globalThis.crypto?.subtle) return failure(job,'RESPONSE_HASH_UNAVAILABLE');
      const hash=await globalThis.crypto.subtle.digest('SHA-256',body.bytes);
      job.receipt.originalResponseSha256=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
      let parsed;
      try {parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.bytes));}
      catch {return failure(job,'INVALID_API_JSON');}
      if (!parsed || !Array.isArray(parsed.elements) || parsed.elements.length!==1 ||
          !parsed.elements[0] || parsed.elements[0].id!==job.descriptor.id) return failure(job,'UNEXPECTED_API_IDENTITY');
      if (parsed.paging && parsed.paging.next!=null) return failure(job,'UNEXPECTED_API_PAGINATION');
      // Signed delivery locations are deliberately not part of the returned
      // JSON model. The media reader can consume this short-lived closure once.
      let assetLocation = job.descriptor.resource === 'assets.v1' &&
          typeof parsed.elements[0]?.url?.url === 'string' ? parsed.elements[0].url.url : '';
      let sanitized;
      try {sanitized=await options.sanitize(parsed);}
      catch {return failure(job,'SANITIZER_FAILED');}
      if (!sanitized || typeof sanitized!=='object' || sanitized.limitReached ||
          !Object.prototype.hasOwnProperty.call(sanitized,'data') || !sanitized.data ||
          typeof sanitized.data!=='object') return failure(job,'SANITIZER_INCOMPLETE');
      if (!Array.isArray(sanitized.data.elements) || sanitized.data.elements.length!==1 ||
          sanitized.data.elements[0]?.id!==job.descriptor.id) return failure(job,'SANITIZER_INCOMPLETE');
      if (['assets.v1','authoringWidgetSessionProviders.v1'].includes(job.descriptor.resource)) {
        const protectedModel=sanitizeCourseraCourseDataModel(sanitized.data);
        if (protectedModel.limitReached) return failure(job,'SANITIZER_INCOMPLETE');
        sanitized={...protectedModel,removedFields:Math.max(0,Number(sanitized.removedFields) || 0)+protectedModel.removedFields,
          redactedUrls:Math.max(0,Number(sanitized.redactedUrls) || 0)+protectedModel.redactedUrls};
      }
      job.receipt.credentialFieldsRemoved=Math.max(0,Number(sanitized.removedFields) || 0);
      job.receipt.credentialUrlsRedacted=Math.max(0,Number(sanitized.redactedUrls) || 0);
      if (!current()) return failure(job,stopReason);
      const result={ok:true,data:sanitized.data,receipt:{...job.receipt},reason:'',authenticationFailed:false};
      if (job.descriptor.resource === 'assets.v1') Object.defineProperty(result,'takeAssetLocation',{
        enumerable:false,value:()=>{const location=current()?assetLocation:'';assetLocation='';return location;}});
      return result;
    } catch {
      return failure(job,stopReason || (controller.signal.aborted?'API_REQUEST_ABORTED':'API_REQUEST_FAILED'));
    } finally {controllers.delete(controller);}
  }
  async function retries(job) {
    for (let retry=0;retry<2;retry++) {
      const result=await attempt(job);
      if (result.ok || stopReason) return result;
      if (result.reason==='RATE_LIMITED') {
        const value=result.retryAfter, seconds=value==null?NaN:Number(value), date=Date.parse(String(value || ''));
        const requested=Number.isFinite(seconds)?Math.max(0,seconds*1000):Number.isFinite(date)?Math.max(0,date-Date.now()):1000;
        const wait=Math.max(500,requested);
        if (retry || wait>10000 || Date.now()+wait>=job.deadline) {
          abort('AUTHORING_API_RATE_LIMITED');return failure(job,stopReason);
        }
        stats.retries++;stats.rateLimitRetries++;notify();
        await new Promise(resolve=>{
          let timer;
          const done=()=>{clearTimeout(timer);cancellation.signal.removeEventListener('abort',done);resolve();};
          cancellation.signal.addEventListener('abort',done,{once:true});
          timer=setTimeout(done,wait);
          if (cancellation.signal.aborted) done();
        });
        if (!current()) return failure(job,stopReason);
        continue;
      }
      const status=result.receipt?.status || 0;
      if (!retry && (result.reason==='API_REQUEST_FAILED' || status>=500 && status<=599) && Date.now()<job.deadline) {
        stats.retries++;notify();continue;
      }
      return result;
    }
    return failure(job,'API_RETRY_LIMIT');
  }
  async function execute(job) {
    job.deadline=Math.min(Date.now()+(job.descriptor.external ? Math.min(20000,limits.requestMs) : limits.requestMs),startedAt+limits.durationMs);
    let timer, listener;
    const cancelled=new Promise(resolve=>{
      listener=()=>resolve(failure(job,stopReason || 'OPERATOR_STOPPED'));
      cancellation.signal.addEventListener('abort',listener,{once:true});
      timer=setTimeout(()=>{
        if (job.descriptor.external && Date.now()<startedAt+limits.durationMs) {
          job.cancelReason=options.providerTransport?'PROVIDER_HELPER_REQUEST_TIMEOUT':'PANOPTO_REQUEST_TIMEOUT';job.controller?.abort();
          resolve(failure(job,job.cancelReason));return;
        }
        // An implementation ignoring AbortSignal can remain unresolved. Do not
        // release its slot and start further requests after such a timeout.
        abort(Date.now()>=startedAt+limits.durationMs?'COURSE_API_TIME_LIMIT':'API_REQUEST_TIMEOUT');
      },Math.max(1,job.deadline-Date.now()));
    });
    try {return await Promise.race([job.descriptor.external?attemptPanopto(job):retries(job),cancelled]);}
    finally {clearTimeout(timer);cancellation.signal.removeEventListener('abort',listener);job.diagnostics?.close();}
  }
  function pump() {
    if (!current()) return;
    if (!durationTimer && queue.length) durationTimer=setTimeout(()=>abort('COURSE_API_TIME_LIMIT'),
      Math.max(1,startedAt+limits.durationMs-Date.now()));
    while (!stopReason && queue.length && stats.active<limits.concurrentRequests) {
      const job=queue.shift();stats.active++;stats.maxConcurrentRequests=Math.max(stats.maxConcurrentRequests,stats.active);notify();
      const settle=result=>{
        if (result.ok) stats.completed++;else stats.failed++;
        stats.active--;if (!stats.active && !queue.length) {clearTimeout(durationTimer);durationTimer=null;}
        notify();job.resolve(result);pump();
      };
      execute(job).then(settle,()=>settle(failure(job,stopReason || 'API_READER_FAILED')));
    }
  }
  function read(value) {
    if (!value || typeof value!=='object' || Array.isArray(value) || value.url!==undefined) return Promise.resolve(failure(null,'INVALID_API_DESCRIPTOR'));
    const d=descriptor(value.resource,value.id,value.courseId);
    if (!d) return Promise.resolve(failure(null,'INVALID_API_DESCRIPTOR'));
    if (typeof fetchImpl!=='function') return Promise.resolve(failure(null,'FETCH_UNAVAILABLE'));
    if (typeof options.sanitize!=='function') return Promise.resolve(failure(null,'SANITIZER_UNAVAILABLE'));
    if (!current()) return Promise.resolve(failure(null,stopReason));
    if (queue.length>=limits.requests) return Promise.resolve(failure(null,'API_QUEUE_LIMIT'));
    return new Promise(resolve=>{queue.push({descriptor:d,receipt:receiptFor(d),resolve});notify();pump();});
  }
  function readPanoptoDeliveryInfo(targetUrl) {
    const target=directPanoptoAutomaticTargetV1(targetUrl);
    if (!target) return Promise.resolve(failure(null,'INVALID_PANOPTO_TARGET'));
    if (!options.providerTransport && typeof fetchImpl!=='function') return Promise.resolve(failure(null,'FETCH_UNAVAILABLE'));
    if (!current()) return Promise.resolve(failure(null,stopReason));
    if (queue.length>=limits.requests) return Promise.resolve(failure(null,'API_QUEUE_LIMIT'));
    const d={resource:'PanoptoDeliveryInfo',external:true,id:target.deliveryPublicId,targetUrl,
      url:new URL('/Panopto/Pages/Viewer/DeliveryInfo.aspx',target.origin),form:[
        ['deliveryId',target.deliveryPublicId],['isLiveNotes','false'],['refreshAuthCookie','false'],
        ['isActiveBroadcast','false'],['isEditing','false'],['isKollectiveAgentInstalled','false'],
        ['isEmbed','true'],['responseType','json']]};
    return new Promise(resolve=>{queue.push({descriptor:d,receipt:receiptFor(d),resolve});notify();pump();});
  }
  return {read, snapshot, abort, readPanoptoDeliveryInfo,
    readCourseMaterials:id=>read({resource:'authoringCourseMaterials.v1',id}),
    readCourse:id=>read({resource:'authoringCourses.v2',id}),
    readAtom:id=>read({resource:'authoringAtoms.v2',id}),
    readRelation:id=>read({resource:'authoringItemContentRelations.v1',id}),
    readGroup:id=>read({resource:'authoringAssignmentQuestionGroups.v1',id}),
    readDefinition:id=>read({resource:'authoringAssignmentMachineEvaluableQuestions.v1',id}),
    readAsset:id=>read({resource:'assets.v1',id}),
    readWidgetProvider:(id,courseId)=>read({resource:'authoringWidgetSessionProviders.v1',id,courseId})};
}
