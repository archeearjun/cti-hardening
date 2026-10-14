/** Bounded transport for the observed Coursera authoring GET resources.
 * The caller supplies source binding and credential sanitization. This module
 * never guesses a resource, enumerates a collection, or renders an editor.
 */
export function createDirectDataReaderV1(options = {}) {
  const origin = 'https://www.coursera.org';
  const defaults = {concurrentRequests:2, bodyBytes:2*1024*1024, totalBytes:64*1024*1024,
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
    return {ok:false, data:null, reason, authenticationFailed,
      receipt:job?.receipt ? {...job.receipt, requestQuery:job.receipt.requestQuery.map(pair=>pair.slice())} : null};
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
  function descriptor(resource, id) {
    if (typeof resource !== 'string' || typeof id !== 'string') return null;
    const simple = /^[A-Za-z0-9_-]{1,128}$/;
    const group = /^[A-Za-z0-9_-]{1,128}~[A-Za-z0-9_-]{1,128}$/;
    const definition = /^[A-Za-z0-9_-]{1,128}~[A-Za-z0-9_-]{1,128}@\d{1,12}$/;
    let fields = '', includes = '', all = false, trailing = false;
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
    } else return null;
    const pathKey=encodeURIComponent(id).replace(/%40/gi,'@');
    const url=new URL('/api/'+resource+'/'+pathKey+(trailing?'/':''),origin);
    if (resource === 'authoringAssignmentQuestionGroups.v1') url.searchParams.set('id',id);
    if (fields) url.searchParams.set('fields',fields);
    if (includes) url.searchParams.set('includes',includes);
    return {resource,id,url,all};
  }
  function receiptFor(d) {
    return {resource:d.resource, requestPath:d.url.pathname, requestQuery:[...d.url.searchParams.entries()],
      observedAt:new Date().toISOString(), status:0, bytes:0, originalResponseSha256:'',
      bodyFormat:'PARSED_SANITIZED_JSON_MODEL', credentialFieldsRemoved:0, credentialUrlsRedacted:0};
  }
  async function discard(response) {
    try {if (response?.body && typeof response.body.cancel === 'function') await response.body.cancel();}
    catch { /* A failed response body is never retained. */ }
  }
  async function bodyBytes(response, job, controller) {
    const declared=Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declared) && declared > limits.bodyBytes) {
      controller.abort();await discard(response);return {ok:false,reason:'API_RESPONSE_BYTE_LIMIT'};
    }
    const chunks=[];let count=0;
    function add(bytes) {
      count+=bytes.byteLength;stats.bytes+=bytes.byteLength;job.receipt.bytes=count;
      if (stats.bytes > limits.totalBytes) {abort('COURSE_API_BYTE_LIMIT');return false;}
      if (count > limits.bodyBytes) {controller.abort();return false;}
      chunks.push(bytes);return true;
    }
    if (response.body && typeof response.body.getReader === 'function') {
      const reader=response.body.getReader();
      try {
        while (current()) {
          const next=await reader.read();
          if (next.done) break;
          if (!(next.value instanceof Uint8Array)) return {ok:false,reason:'INVALID_RESPONSE_STREAM'};
          if (!add(next.value)) {
            await reader.cancel();return {ok:false,reason:stopReason || 'API_RESPONSE_BYTE_LIMIT'};
          }
        }
        if (stopReason) {await reader.cancel();return {ok:false,reason:stopReason};}
      } finally {reader.releaseLock();}
    } else if (typeof response.arrayBuffer === 'function') {
      const bytes=new Uint8Array(await response.arrayBuffer());
      if (!add(bytes)) return {ok:false,reason:stopReason || 'API_RESPONSE_BYTE_LIMIT'};
    } else return {ok:false,reason:'RESPONSE_BODY_UNAVAILABLE'};
    const bytes=new Uint8Array(count);let offset=0;
    for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return {ok:true,bytes};
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
      let sanitized;
      try {sanitized=await options.sanitize(parsed);}
      catch {return failure(job,'SANITIZER_FAILED');}
      if (!sanitized || typeof sanitized!=='object' || sanitized.limitReached ||
          !Object.prototype.hasOwnProperty.call(sanitized,'data') || !sanitized.data ||
          typeof sanitized.data!=='object') return failure(job,'SANITIZER_INCOMPLETE');
      if (!Array.isArray(sanitized.data.elements) || sanitized.data.elements.length!==1 ||
          sanitized.data.elements[0]?.id!==job.descriptor.id) return failure(job,'SANITIZER_INCOMPLETE');
      job.receipt.credentialFieldsRemoved=Math.max(0,Number(sanitized.removedFields) || 0);
      job.receipt.credentialUrlsRedacted=Math.max(0,Number(sanitized.redactedUrls) || 0);
      if (!current()) return failure(job,stopReason);
      return {ok:true,data:sanitized.data,receipt:{...job.receipt},reason:'',authenticationFailed:false};
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
    job.deadline=Math.min(Date.now()+limits.requestMs,startedAt+limits.durationMs);
    let timer, listener;
    const cancelled=new Promise(resolve=>{
      listener=()=>resolve(failure(job,stopReason || 'OPERATOR_STOPPED'));
      cancellation.signal.addEventListener('abort',listener,{once:true});
      timer=setTimeout(()=>{
        // An implementation ignoring AbortSignal can remain unresolved. Do not
        // release its slot and start further requests after such a timeout.
        abort(Date.now()>=startedAt+limits.durationMs?'COURSE_API_TIME_LIMIT':'API_REQUEST_TIMEOUT');
      },Math.max(1,job.deadline-Date.now()));
    });
    try {return await Promise.race([retries(job),cancelled]);}
    finally {clearTimeout(timer);cancellation.signal.removeEventListener('abort',listener);}
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
    const d=descriptor(value.resource,value.id);
    if (!d) return Promise.resolve(failure(null,'INVALID_API_DESCRIPTOR'));
    if (typeof fetchImpl!=='function') return Promise.resolve(failure(null,'FETCH_UNAVAILABLE'));
    if (typeof options.sanitize!=='function') return Promise.resolve(failure(null,'SANITIZER_UNAVAILABLE'));
    if (!current()) return Promise.resolve(failure(null,stopReason));
    if (queue.length>=limits.requests) return Promise.resolve(failure(null,'API_QUEUE_LIMIT'));
    return new Promise(resolve=>{queue.push({descriptor:d,receipt:receiptFor(d),resolve});notify();pump();});
  }
  return {read, snapshot, abort,
    readCourseMaterials:id=>read({resource:'authoringCourseMaterials.v1',id}),
    readCourse:id=>read({resource:'authoringCourses.v2',id}),
    readAtom:id=>read({resource:'authoringAtoms.v2',id}),
    readRelation:id=>read({resource:'authoringItemContentRelations.v1',id}),
    readGroup:id=>read({resource:'authoringAssignmentQuestionGroups.v1',id}),
    readDefinition:id=>read({resource:'authoringAssignmentMachineEvaluableQuestions.v1',id})};
}
