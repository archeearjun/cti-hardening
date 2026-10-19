import { directPanoptoAutomaticTargetV1 } from './direct-data-panopto.js';
import { directPublicPageTargetV1, CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1 } from './direct-data-public-page.js';
import { directPublisherTargetV1 } from './direct-data-publisher.js';
import { directPublisherImageUrlV1, directPublisherImageDateV1, CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1 } from './direct-data-publisher-media.js';

export const CTI_PROVIDER_HELPER_PROTOCOL_V1 = 'CTI_PROVIDER_HELPER_V1';
export const CTI_PROVIDER_HELPER_ORIGIN_V1 = 'https://cti-hardening.pages.dev';
export const CTI_PROVIDER_HELPER_OPERATIONS_V1 = 'metadata,podcast,publicHtml,publisherImage';
export const CTI_PROVIDER_HELPER_HEADERS_V1 = 'content-type,content-length,content-range,content-encoding,x-cti-provider-transport,x-cti-provider-origin,x-cti-upstream-status,x-cti-upstream-observed-at,x-cti-upstream-bytes,x-cti-upstream-content-length,x-cti-upstream-requests,x-cti-validation-bytes,x-cti-validation-source-hash,x-cti-validation-observed-at,x-cti-response-envelope-bytes,x-cti-upstream-sha256,x-cti-publisher-source-hash,x-cti-upstream-challenge';

/** The source hash is declared binding context, never proof the service read
 * the parent publisher document. Source ownership is checked by the consumer. */
export function directProviderPublisherImagePayloadValidV1(payload) {
  const authority=value=>typeof value==='string' && /^https:\/\/(?:opentextbc\.ca|pressbooks\.bccampus\.ca)\//.test(value);
  return !!payload && typeof payload==='object' && !Array.isArray(payload) &&
    Object.keys(payload).every(key=>['targetUrl','imageUrl','sourceSha256','itemId','providerId'].includes(key)) &&
    authority(payload.targetUrl) && !!directPublisherTargetV1(payload.targetUrl) && authority(payload.imageUrl) && !/[?#]/.test(payload.imageUrl) &&
    directPublisherImageUrlV1(payload.imageUrl,payload.targetUrl)===payload.imageUrl &&
    typeof payload.sourceSha256==='string' && /^[a-f0-9]{64}$/.test(payload.sourceSha256) &&
    ['itemId','providerId'].every(key=>payload[key]===undefined || typeof payload[key]==='string' &&
      (key==='providerId' ? /^[A-Za-z0-9_-]{22}@[1-9]\d{0,11}$/.test(payload[key]) || /^[A-Za-z0-9_-]{1,128}$/.test(payload[key]) : /^[A-Za-z0-9_-]{1,128}$/.test(payload[key])));
}

/** The click handler opens one authenticated CTI helper synchronously. Only
 * fixed public provider operations cross this channel; no credentials cross it. */
export function createDirectProviderHelperV1(options = {}) {
  function failure(code) {return Object.assign(Error(code),{code});}
  const host=options.windowImpl || globalThis.window, courseId=options.courseId;
  if (host?.location?.origin!=='https://www.coursera.org' ||
      typeof courseId!=='string' || !/^[A-Za-z0-9_-]{8,128}$/.test(courseId))
    throw failure('PROVIDER_HELPER_INVALID_CONTEXT');
  const nonce=[...globalThis.crypto.getRandomValues(new Uint8Array(32))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
  const origin=CTI_PROVIDER_HELPER_ORIGIN_V1, protocol=CTI_PROVIDER_HELPER_PROTOCOL_V1,
    headerNames=CTI_PROVIDER_HELPER_HEADERS_V1.split(',');
  const jobs=new Map(), queue=[];
  let popup=null, stopped='', connected=false, active=0, activeImages=0, counter=0, total=0, coreRequests=0, imageRequests=0;
  let operations=new Set(['metadata','podcast','publicHtml']);
  let resolveReady, rejectReady, handshakeTimer, watchTimer;
  const readiness=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  readiness.catch(()=>{});
  function status(message) {try {options.onStatus?.(message);} catch {}}
  function frame(type, extra={}) {return {protocol,nonce,courseId,type,...extra};}
  function send(type,extra={}) {
    if (stopped) return;
    try {popup.postMessage(frame(type,extra),origin);}
    catch {close('PROVIDER_HELPER_CONNECTION_LOST');}
  }
  function finish(job,code='',repump=true) {
    if (!jobs.delete(job.id)) return;
    clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);
    if (job.started) {active--;if (job.kind==='publisherImage') activeImages--;}
    if (code) {
      const error=failure(code);job.reject(error);
      try {job.controller?.error(error);} catch {}
    }
    if (repump) pump();
  }
  function arm(job) {
    clearTimeout(job.timer);
    job.timer=setTimeout(()=>{send('cancel',job.binding);finish(job,'PROVIDER_HELPER_TIMEOUT');},30000);
  }
  function pump() {
    if (!connected || stopped) return;
    while (active<2 && queue.length) {
      for (let index=queue.length-1;index>=0;index--) if (!jobs.has(queue[index].id)) queue.splice(index,1);
      const index=queue.findIndex(value=>value.kind!=='publisherImage' || !activeImages);
      if (index<0) break;
      const job=queue.splice(index,1)[0];
      if (job.kind==='publisherImage' && !operations.has(job.kind)) {finish(job,'PROVIDER_HELPER_OPERATION_UNSUPPORTED',false);continue;}
      job.started=true;active++;if (job.kind==='publisherImage') activeImages++;arm(job);
      send('request',{...job.binding,kind:job.kind,payload:job.payload});
    }
  }
  function close(code='PROVIDER_HELPER_CLOSED') {
    if (stopped) return;
    stopped=code;clearTimeout(handshakeTimer);clearInterval(watchTimer);
    host.removeEventListener('message',receive);
    try {popup?.postMessage(frame('close'),origin);popup?.close();} catch {}
    rejectReady(failure(code));
    for (const job of [...jobs.values()]) finish(job,code);
    queue.length=0;
  }
  function receive(event) {
    const m=event.data;
    if (event.origin!==origin || event.source!==popup || !m ||
        m.protocol!==protocol || m.nonce!==nonce || m.courseId!==courseId) return;
    try {if (JSON.stringify({...m,bytes:undefined}).length>8192) return;} catch {return;}
    if (m.type==='ready') {
      const advertised=m.operations===undefined?['metadata','podcast','publicHtml']:m.operations;
      if (!Array.isArray(advertised) || advertised.length>4 || new Set(advertised).size!==advertised.length ||
          advertised.some(kind=>typeof kind!=='string' || !CTI_PROVIDER_HELPER_OPERATIONS_V1.split(',').includes(kind))) {
        close('PROVIDER_HELPER_INVALID_CAPABILITIES');return;
      }
      if (!connected) {operations=new Set(advertised);connected=true;clearTimeout(handshakeTimer);resolveReady();pump();
        status('CTI provider connection ready.');}
      return;
    }
    if (m.type==='error' && !m.id) {
      close(/^PROVIDER_HELPER_[A-Z_]{1,64}$/.test(m.code) ? m.code : 'PROVIDER_HELPER_FAILED');return;
    }
    const job=jobs.get(m.id);
    if (!job || !job.started || m.itemId!==job.binding.itemId || m.providerId!==job.binding.providerId) return;
    arm(job);
    if (m.type==='error') {
      finish(job,/^PROVIDER_HELPER_[A-Z_]{1,64}$/.test(m.code) ? m.code : 'PROVIDER_HELPER_FAILED');return;
    }
    if (m.type==='head' && !job.controller && Number.isInteger(m.status) && m.status>=200 &&
        m.status<=599 && ![204,205,304].includes(m.status) && Array.isArray(m.headers)) {
      try {
        if (m.headers.length>headerNames.length) throw Error();
        const headers=new Headers();
        for (const pair of m.headers) {
          if (!Array.isArray(pair) || pair.length!==2 || typeof pair[0]!=='string' ||
              typeof pair[1]!=='string' || pair[1].length>256 ||
              !headerNames.includes(pair[0]) || headers.has(pair[0])) throw Error();
          headers.set(pair[0],pair[1]);
        }
        if (headers.has('x-cti-upstream-challenge') && (job.kind!=='publisherImage' || m.status!==502 ||
            headers.get('x-cti-upstream-challenge')!=='cloudflare' || headers.get('x-cti-provider-transport')!=='CTI_SERVICE_PUBLIC_IMAGE' ||
            headers.get('x-cti-provider-origin')!==origin || headers.get('x-cti-upstream-status')!=='403' ||
            headers.get('x-cti-upstream-requests')!=='1' || headers.get('x-cti-upstream-bytes')!=='0' ||
            !directPublisherImageDateV1(headers.get('x-cti-upstream-observed-at')))) throw Error();
        if (!['publicHtml','publisherImage'].includes(job.kind) && Number(headers.get('content-length') || 0)>job.limit) throw Error();
        if (job.kind==='publicHtml' && m.status===200) {
          const declared=headers.get('x-cti-response-envelope-bytes');
          const expected=/^[1-9]\d*$/.test(declared || '')?Number(declared):NaN;
          if (!Number.isSafeInteger(expected) || expected>job.limit) throw Error();
          const wire=headers.get('content-length');
          if (headers.get('content-encoding')?.trim().toLowerCase()==='identity' && wire!==null &&
              (!/^[1-9]\d*$/.test(wire) || Number(wire)!==expected)) throw Error();
          job.declaredBytes=expected;
        }
        if (job.kind==='publisherImage' && m.status===200) {
          const declared=headers.get('x-cti-upstream-content-length'),expected=/^[1-9]\d*$/.test(declared || '')?Number(declared):NaN;
          if (!Number.isSafeInteger(expected) || expected>job.limit || headers.has('content-range') ||
              headers.get('x-cti-provider-transport')!=='CTI_SERVICE_PUBLIC_IMAGE' || headers.get('x-cti-provider-origin')!==origin ||
              !/^[a-f0-9]{64}$/.test(headers.get('x-cti-upstream-sha256') || '') ||
              headers.get('x-cti-publisher-source-hash')!==job.payload.sourceSha256) throw Error();
          const wire=headers.get('content-length');
          if (headers.get('content-encoding')?.trim().toLowerCase()==='identity' && wire!==null &&
              (!/^[1-9]\d*$/.test(wire) || Number(wire)!==expected)) throw Error();
          job.declaredBytes=expected;
        }
        const body=new ReadableStream({start(controller){job.controller=controller;},
          pull(){if (!job.waiting && jobs.has(job.id)) {job.waiting=true;send('pull',{
            ...job.binding,seq:job.seq,offset:job.bytes});}},
          cancel(){send('cancel',job.binding);finish(job,'PROVIDER_HELPER_ABORTED');}}, {highWaterMark:0});
        job.resolve(new Response(body,{status:m.status,headers}));return;
      } catch {send('cancel',job.binding);finish(job,'PROVIDER_HELPER_INVALID_RESPONSE');return;}
    }
    if (m.type==='chunk' && job.controller && job.waiting && m.seq===job.seq &&
        m.offset===job.bytes && m.bytes instanceof ArrayBuffer && m.bytes.byteLength>0 &&
        m.bytes.byteLength<=65536) {
      const size=m.bytes.byteLength;total+=size;job.bytes+=size;
      if (job.bytes>job.limit || (job.declaredBytes!==undefined && job.bytes>job.declaredBytes) || total>512*1024*1024) {
        send('cancel',job.binding);finish(job,'PROVIDER_HELPER_BYTE_LIMIT');return;
      }
      job.seq++;job.waiting=false;job.controller.enqueue(new Uint8Array(m.bytes));return;
    }
    if (m.type==='end' && job.controller && job.waiting && m.seq===job.seq && m.offset===job.bytes) {
      if (job.declaredBytes!==undefined && job.bytes!==job.declaredBytes) {
        finish(job,job.kind==='publisherImage'?'PROVIDER_HELPER_PUBLISHER_IMAGE_LENGTH_MISMATCH':'PROVIDER_HELPER_PUBLIC_HTML_LENGTH_MISMATCH');return;
      }
      job.controller.close();finish(job);return;
    }
    send('cancel',job.binding);finish(job,'PROVIDER_HELPER_INVALID_RESPONSE');
  }
  function request(kind,payload,signal) {
    if (stopped) return Promise.reject(failure(stopped));
    if (kind==='publisherImage' ? !directProviderPublisherImagePayloadValidV1(payload) : !payload || typeof payload!=='object' ||
        !(kind==='publicHtml' ? directPublicPageTargetV1(payload.targetUrl) : directPanoptoAutomaticTargetV1(payload.targetUrl)) ||
        !['metadata','podcast','publicHtml'].includes(kind) || Object.keys(payload).some(key=>
          !['targetUrl','itemId','providerId',...(kind==='podcast'?['streamFileId','sourceHash']:[])].includes(key)) ||
        ['itemId','providerId'].some(key=>payload[key]!==undefined &&
          (typeof payload[key]!=='string' || !(key==='providerId' && kind==='publicHtml'
            ? /^[A-Za-z0-9_-]{22}@\d{1,12}$/.test(payload[key]) || /^[A-Za-z0-9_-]{1,128}$/.test(payload[key])
            : /^[A-Za-z0-9_-]{1,128}$/.test(payload[key])))) ||
        (kind==='podcast' && (typeof payload.streamFileId!=='string' || typeof payload.sourceHash!=='string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.streamFileId) ||
          !/^[a-f0-9]{64}$/.test(payload.sourceHash))))
      return Promise.reject(failure('PROVIDER_HELPER_INVALID_REQUEST'));
    if (kind==='publisherImage') {
      try {if (JSON.stringify(frame('request',{id:'9999',itemId:payload.itemId,providerId:payload.providerId,kind,payload})).length>8192) throw Error();}
      catch {return Promise.reject(failure('PROVIDER_HELPER_INVALID_REQUEST'));}
      if (connected && !operations.has(kind)) return Promise.reject(failure('PROVIDER_HELPER_OPERATION_UNSUPPORTED'));
    }
    if (signal?.aborted) return Promise.reject(failure('PROVIDER_HELPER_ABORTED'));
    if (kind==='publisherImage'?imageRequests>=1024:coreRequests>=128) return Promise.reject(failure('PROVIDER_HELPER_REQUEST_LIMIT'));
    return new Promise((resolve,reject)=>{
      if (kind==='publisherImage') imageRequests++;else coreRequests++;
      const id=String(++counter),binding={id,itemId:payload.itemId,providerId:payload.providerId};
      const job={id,binding,kind,payload:{...payload},signal,resolve,reject,seq:0,bytes:0,
        limit:kind==='metadata'?512*1024:kind==='publicHtml'?CTI_DIRECT_PUBLIC_PAGE_ENVELOPE_BYTES_V1:kind==='publisherImage'?CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1:128*1024*1024,started:false,waiting:false};
      job.abort=()=>{send('cancel',binding);finish(job,'PROVIDER_HELPER_ABORTED');};
      jobs.set(id,job);queue.push(job);signal?.addEventListener('abort',job.abort,{once:true});pump();
    });
  }
  try {popup=host.open(origin+'/provider-helper.html#nonce='+nonce+'&courseId='+encodeURIComponent(courseId),
    'CTIProvider_'+nonce,'popup,width=640,height=480');} catch {}
  if (!popup) {close('PROVIDER_HELPER_POPUP_BLOCKED');status('Allow the CTI provider window, then retry capture.');}
  else {
    host.addEventListener('message',receive);
    status('Connecting to CTI. Sign in in the provider window if requested.');
    handshakeTimer=setTimeout(()=>close('PROVIDER_HELPER_NOT_CONNECTED'),30000);
    watchTimer=setInterval(()=>{
      if (popup.closed) {close('PROVIDER_HELPER_WINDOW_CLOSED');return;}
      if (!connected) send('init');
    },500);
    send('init');
  }
  return {request,ready:()=>readiness,supports:kind=>connected && operations.has(kind),close:()=>close()};
}
