import { directPanoptoAutomaticTargetV1 } from './direct-data-panopto.js';

export const CTI_PROVIDER_HELPER_PROTOCOL_V1 = 'CTI_PROVIDER_HELPER_V1';
export const CTI_PROVIDER_HELPER_ORIGIN_V1 = 'https://cti-hardening.pages.dev';
export const CTI_PROVIDER_HELPER_HEADERS_V1 = 'content-type,content-length,content-range,x-cti-provider-transport,x-cti-provider-origin,x-cti-upstream-status,x-cti-upstream-observed-at,x-cti-upstream-bytes,x-cti-upstream-requests,x-cti-validation-bytes,x-cti-validation-source-hash,x-cti-validation-observed-at';

/** The click handler opens one authenticated CTI helper synchronously. Only
 * fixed Panopto operations cross this channel; no credentials cross it. */
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
  let popup=null, stopped='', connected=false, active=0, counter=0, total=0;
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
  function finish(job,code='') {
    if (!jobs.delete(job.id)) return;
    clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);
    if (job.started) active--;
    if (code) {
      const error=failure(code);job.reject(error);
      try {job.controller?.error(error);} catch {}
    }
    pump();
  }
  function arm(job) {
    clearTimeout(job.timer);
    job.timer=setTimeout(()=>{send('cancel',job.binding);finish(job,'PROVIDER_HELPER_TIMEOUT');},30000);
  }
  function pump() {
    if (!connected || stopped) return;
    while (active<2 && queue.length) {
      const job=queue.shift();if (!jobs.has(job.id)) continue;
      job.started=true;active++;arm(job);
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
      if (!connected) {connected=true;clearTimeout(handshakeTimer);resolveReady();pump();
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
        if (Number(headers.get('content-length') || 0)>job.limit) throw Error();
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
      if (job.bytes>job.limit || total>512*1024*1024) {
        send('cancel',job.binding);finish(job,'PROVIDER_HELPER_BYTE_LIMIT');return;
      }
      job.seq++;job.waiting=false;job.controller.enqueue(new Uint8Array(m.bytes));return;
    }
    if (m.type==='end' && job.controller && job.waiting && m.seq===job.seq && m.offset===job.bytes) {
      job.controller.close();finish(job);return;
    }
    send('cancel',job.binding);finish(job,'PROVIDER_HELPER_INVALID_RESPONSE');
  }
  function request(kind,payload,signal) {
    if (stopped) return Promise.reject(failure(stopped));
    if (!payload || typeof payload!=='object' || !directPanoptoAutomaticTargetV1(payload.targetUrl) ||
        !['metadata','podcast'].includes(kind) || Object.keys(payload).some(key=>
          !['targetUrl','itemId','providerId',...(kind==='podcast'?['streamFileId','sourceHash']:[])].includes(key)) ||
        ['itemId','providerId'].some(key=>payload[key]!==undefined &&
          (typeof payload[key]!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload[key]))) ||
        (kind==='podcast' && (typeof payload.streamFileId!=='string' || typeof payload.sourceHash!=='string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.streamFileId) ||
          !/^[a-f0-9]{64}$/.test(payload.sourceHash))))
      return Promise.reject(failure('PROVIDER_HELPER_INVALID_REQUEST'));
    if (signal?.aborted) return Promise.reject(failure('PROVIDER_HELPER_ABORTED'));
    if (counter>=128) return Promise.reject(failure('PROVIDER_HELPER_REQUEST_LIMIT'));
    return new Promise((resolve,reject)=>{
      const id=String(++counter),binding={id,itemId:payload.itemId,providerId:payload.providerId};
      const job={id,binding,kind,payload:{...payload},signal,resolve,reject,seq:0,bytes:0,
        limit:kind==='metadata'?512*1024:128*1024*1024,started:false,waiting:false};
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
  return {request,ready:()=>readiness,close:()=>close()};
}
