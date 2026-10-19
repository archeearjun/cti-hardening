import { directPublisherTargetV1 } from "./direct-data-publisher.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import { directPublisherImageUrlV1, directPublisherImageDateV1,
  CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1 } from "./direct-data-publisher-media.js";

export const CTI_PUBLISHER_FIRST_PARTY_PROTOCOL_V1 = "CTI_PUBLISHER_FIRST_PARTY_V1";
export const CTI_PUBLISHER_FIRST_PARTY_FRAGMENT_V1 = "cti-publisher-recovery";
export const CTI_PUBLISHER_FIRST_PARTY_IMAGE_MIMES_V1 = "image/png,image/jpeg,image/jpg,image/gif,image/webp";

/** Public source identities only. No cookies, caller headers, arbitrary URLs,
 * alternate renditions or response bodies form part of the recovery plan. */
export function directPublisherFirstPartyPlanV1(courseId, entries) {
  if (typeof courseId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(courseId) ||
      !Array.isArray(entries) || !entries.length || entries.length > 1024) return null;
  const result = [], seen = new Set(); let origin = "";
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).length !== 6 || Object.keys(entry).some(key =>
          !["itemId","atomId","providerId","targetUrl","imageUrl","sourceSha256"].includes(key)) ||
        ["itemId","atomId","providerId"].some(key => typeof entry[key] !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}(?:@[1-9]\d{0,11})?$/.test(entry[key])) ||
        !directPublisherTargetV1(entry.targetUrl) ||
        directPublisherImageUrlV1(entry.imageUrl,entry.targetUrl) !== entry.imageUrl ||
        !/^[a-f0-9]{64}$/.test(entry.sourceSha256 || "")) return null;
    const here = new URL(entry.targetUrl).origin;
    if (new URL(entry.imageUrl).origin !== here || origin && origin !== here) return null;
    origin = here;
    const copy = {itemId:entry.itemId,atomId:entry.atomId,providerId:entry.providerId,
      targetUrl:entry.targetUrl,imageUrl:entry.imageUrl,sourceSha256:entry.sourceSha256},
      key = directCanonicalSourceTextV1(copy);
    if (!seen.has(key)) {seen.add(key);result.push(Object.freeze(copy));}
  }
  if (directCanonicalSourceTextV1({courseId,entries:result}).length > 1040000) return null;
  return Object.freeze({courseId,origin,entries:Object.freeze(result)});
}

/** A capability fragment is necessary because browsers clear cross-site
 * window.name. It carries no source content or account credentials. */
export function directPublisherFirstPartyContextV1(location) {
  try {
    if (!["https://opentextbc.ca","https://pressbooks.bccampus.ca"].includes(location?.origin)) return null;
    const values = new URLSearchParams(String(location.hash || "").slice(1));
    if ([...values].length !== 4 || values.get(CTI_PUBLISHER_FIRST_PARTY_FRAGMENT_V1) !== "1" ||
        !/^[a-f0-9]{64}$/.test(values.get("nonce") || "") ||
        !/^[a-f0-9]{32}$/.test(values.get("session") || "") ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(values.get("courseId") || "") ||
        [...values.keys()].some(key => ![CTI_PUBLISHER_FIRST_PARTY_FRAGMENT_V1,"nonce","session","courseId"].includes(key))) return null;
    return {origin:location.origin,nonce:values.get("nonce"),sessionId:values.get("session"),courseId:values.get("courseId")};
  } catch (_) {return null;}
}

export async function directPublisherFirstPartyPlanHashV1(plan) {
  const bytes = new TextEncoder().encode(directCanonicalSourceTextV1({courseId:plan.courseId,entries:plan.entries})),
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return [...digest].map(value => value.toString(16).padStart(2,"0")).join("");
}

/** The publisher page is an untrusted browser collector. Exact window/origin,
 * capability and source bindings prevent unrelated sessions from joining; they
 * are not cryptographic proof of an HTTP response or the operator's login. */
export function createDirectPublisherFirstPartyV1(options = {}) {
  const code = suffix => "PUBLISHER_FIRST_PARTY_"+suffix;
  const host = options.windowImpl || globalThis.window,
    plan = directPublisherFirstPartyPlanV1(options.courseId,options.entries),
    fail = code => Object.assign(Error(code),{code});
  if (host?.location?.origin !== "https://www.coursera.org" || !plan)
    throw fail(code("INVALID_PLAN"));
  const hex = count => [...crypto.getRandomValues(new Uint8Array(count))].map(v => v.toString(16).padStart(2,"0")).join(""),
    nonce = hex(32), sessionId = hex(16), protocol = CTI_PUBLISHER_FIRST_PARTY_PROTOCOL_V1,
    origin = plan.origin, courseId = plan.courseId, initialParentLocation=host.location.href || "", jobs = new Map(), queue = [],
    totalLimit=Number.isSafeInteger(options.limits?.totalBytes) && options.limits.totalBytes > 0 ? Math.min(536870912,options.limits.totalBytes) : 536870912;
  let popup = null, stopped = "", connected = false, helloSeen = false, planSent = false, planSha256 = "", active = 0,
    serial = 0, requests = 0, receivedBytes = 0, observedBytes = 0, lastMessageAt=Date.now(), resolveReady, rejectReady, handshakeTimer, watchTimer;
  const ready = new Promise((resolve,reject) => {resolveReady=resolve;rejectReady=reject;});
  ready.catch(() => {});
  const status = message => {try {options.onStatus?.(message);} catch (_) {}};
  const frame = (type,extra = {}) => ({protocol,nonce,sessionId,courseId,type,...extra});
  function send(type,extra = {}) {
    if (stopped) return;
    try {popup.postMessage(frame(type,extra),origin);} catch (_) {close(code("CONNECTION_LOST"));}
  }
  function finish(job,code = "",context = {},repump = true) {
    if (!jobs.delete(job.id)) return;
    clearTimeout(job.timer);job.signal?.removeEventListener("abort",job.abort);
    if (job.started) active--;
    if (code) {
      const error = Object.assign(fail(code),context);
      job.reject(error);try {job.controller?.error(error);} catch (_) {}
    }
    if (repump) pump();
  }
  function arm(job) {
    clearTimeout(job.timer);
    job.timer=setTimeout(() => {send("cancel",{id:job.id});finish(job,code("TIMEOUT"));},30000);
  }
  function close(reason = code("CLOSED")) {
    if (stopped) return;
    try {popup?.postMessage(frame("close"),origin);} catch (_) {}
    stopped=reason;clearTimeout(handshakeTimer);clearInterval(watchTimer);
    host.removeEventListener("message",receive);rejectReady(fail(reason));
    for (const job of [...jobs.values()]) finish(job,reason);
    queue.length=0;
    status(reason);
  }
  function pump() {
    if (!connected || stopped) return;
    if (observedBytes >= totalLimit) {
      for (const job of queue.splice(0)) finish(job,code("BYTE_LIMIT"),{},false);
      return;
    }
    while (active < 2 && queue.length) {
      const job=queue.shift();if (!jobs.has(job.id)) continue;
      job.started=true;active++;requests++;arm(job);
      send("request",{id:job.id,index:job.index,planSha256});
    }
  }
  function expected(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const bound=payload.binding;
    if (Object.keys(payload).some(key => !["targetUrl","imageUrl","sourceSha256",...(bound ? ["binding"] : ["itemId","atomId","providerId"])].includes(key))) return null;
    const native=bound || payload;
    const index=plan.entries.findIndex(entry => ["targetUrl","imageUrl","sourceSha256"].every(key => entry[key] === payload[key]) &&
      ["itemId","atomId","providerId"].every(key => entry[key] === native[key]));
    if (index < 0) return null;
    const entry=plan.entries[index], binding={courseId,itemId:entry.itemId,atomId:entry.atomId,providerId:entry.providerId,
      targetUrl:entry.targetUrl,sourceSha256:entry.sourceSha256,planSha256,sessionId};
    if (bound && directCanonicalSourceTextV1(bound) !== directCanonicalSourceTextV1(binding)) return null;
    return {index,entry,binding:Object.freeze(binding)};
  }
  function receive(event) {
    const m=event.data;
    if (event.origin !== origin || event.source !== popup || !m || m.protocol !== protocol ||
        m.nonce !== nonce || m.sessionId !== sessionId || m.courseId !== courseId) return;
    try {if (JSON.stringify({...m,bytes:undefined}).length > 2048) return;} catch (_) {return;}
    lastMessageAt=Date.now();
    if (m.type === "pong") return;
    if (m.type === "hello") {helloSeen=true;if (planSha256) {planSent=true;send("plan",{planSha256,entries:plan.entries});}return;}
    if (m.type === "ready" && planSent && m.planSha256 === planSha256 && planSha256) {
      if (!connected) {connected=true;clearTimeout(handshakeTimer);resolveReady(Object.freeze({planSha256,sessionId}));pump();status("Publisher recovery connected. Cookies stay in the publisher tab.");}
      return;
    }
    if (m.type === "error" && !m.id) {close(/^PUBLISHER_FIRST_PARTY_[A-Z0-9_]{1,80}$/.test(m.code || "") ? m.code : code("FAILED"));return;}
    const job=jobs.get(m.id);
    if (!job || !job.started || m.index !== job.index || m.planSha256 !== planSha256) return;
    arm(job);
    if (m.type === "error") {
      if (Number.isSafeInteger(m.observedBytes) && m.observedBytes >= job.observedBytes) {
        const extra=m.observedBytes-job.observedBytes;
        if (extra > Number.MAX_SAFE_INTEGER-observedBytes) {close(code("ACCOUNTING_OVERFLOW"));return;}
        observedBytes+=extra;job.observedBytes=m.observedBytes;
      }
      const context=Number.isInteger(m.status) && m.status >= 100 && m.status <= 599 && directPublisherImageDateV1(m.observedAt)
        ? {status:m.status,observedAt:m.observedAt,...(m.challenge === "cloudflare" && m.status === 403 ? {challenge:"cloudflare"} : {})} : {};
      const challenge=context.challenge === "cloudflare";
      finish(job,/^PUBLISHER_FIRST_PARTY_[A-Z0-9_]{1,80}$/.test(m.code || "") ? m.code : code("FAILED"),{...context,observedBytes:job.observedBytes},!challenge && observedBytes <= totalLimit);
      if (challenge) close(code("ORIGIN_CHALLENGE"));
      else if (observedBytes > totalLimit) close(code("BYTE_LIMIT"));
      return;
    }
    if (m.type === "head" && !job.controller && m.status === 200 && m.responseType === "basic" &&
        m.url === job.entry.imageUrl && directPublisherImageDateV1(m.observedAt) && typeof m.contentType === "string" &&
        m.contentType.length <= 256 && !/[\u0000-\u001f\u007f]/.test(m.contentType) &&
        CTI_PUBLISHER_FIRST_PARTY_IMAGE_MIMES_V1.split(",").includes(m.contentType.split(";")[0].trim().toLowerCase())) {
      const receipt=Object.freeze({transport:"FIRST_PARTY_BROWSER",origin,requestedUrl:job.entry.imageUrl,finalUrl:job.entry.imageUrl,
        method:"GET",credentials:"same-origin",mode:"same-origin",responseType:"basic",status:200,
        observedAt:m.observedAt,originalContentType:m.contentType,collectorContext:"PROVIDER_PAGE_BROWSER",firstPartyBinding:job.binding}),
        body=new ReadableStream({start(controller) {job.controller=controller;},
          pull() {if (!job.waiting && jobs.has(job.id)) {job.waiting=true;send("pull",{id:job.id,index:job.index,planSha256,seq:job.seq,offset:job.bytes});}},
          cancel() {send("cancel",{id:job.id});finish(job,code("ABORTED"));}}, {highWaterMark:0}),
        response={status:200,ok:true,type:"basic",url:job.entry.imageUrl,headers:new Headers({"content-type":m.contentType}),body,observedAt:m.observedAt,
          observedBytes:() => job.observedBytes};
      job.resolve({response,firstPartyBinding:job.binding,receipt});return;
    }
    if (m.type === "chunk" && job.controller && job.waiting && m.seq === job.seq && m.offset === job.bytes &&
        m.bytes instanceof ArrayBuffer && m.bytes.byteLength > 0 && m.bytes.byteLength <= 65536 &&
        Number.isSafeInteger(m.observedBytes) && m.observedBytes >= job.observedBytes &&
        m.observedBytes >= job.bytes+m.bytes.byteLength && m.observedBytes <= 536870912) {
      observedBytes+=m.observedBytes-job.observedBytes;job.observedBytes=m.observedBytes;
      receivedBytes+=m.bytes.byteLength;job.bytes+=m.bytes.byteLength;
      if (job.observedBytes > CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1 || observedBytes > totalLimit) {
        send("cancel",{id:job.id});finish(job,code("BYTE_LIMIT"),{},observedBytes <= totalLimit);
        if (observedBytes > totalLimit) close(code("BYTE_LIMIT"));
        return;
      }
      job.seq++;job.waiting=false;job.controller.enqueue(new Uint8Array(m.bytes));return;
    }
    if (m.type === "end" && job.controller && job.waiting && m.seq === job.seq && m.offset === job.bytes && job.bytes) {
      job.controller.close();finish(job);return;
    }
    send("cancel",{id:job.id});finish(job,code("INVALID_RESPONSE"));
  }
  function request(payload,signal) {
    if (stopped) return Promise.reject(fail(stopped));
    if (host.location.origin !== "https://www.coursera.org" || initialParentLocation && host.location.href !== initialParentLocation) {
      close(code("CONTEXT_CHANGED"));return Promise.reject(fail(stopped));
    }
    const match=expected(payload);
    if (!connected || !match) return Promise.reject(fail(code("SOURCE_NOT_PLANNED")));
    if (signal?.aborted) return Promise.reject(fail(code("ABORTED")));
    if (observedBytes >= totalLimit) return Promise.reject(fail(code("BYTE_LIMIT")));
    if (serial >= 1024) return Promise.reject(fail(code("REQUEST_LIMIT")));
    return new Promise((resolve,reject) => {
      const id=String(++serial), job={id,...match,signal,resolve,reject,seq:0,bytes:0,observedBytes:0,waiting:false,started:false};
      job.abort=() => {send("cancel",{id});finish(job,code("ABORTED"));};
      jobs.set(id,job);queue.push(job);signal?.addEventListener("abort",job.abort,{once:true});pump();
    });
  }
  const target=new URL(plan.entries[0].targetUrl);
  target.hash=CTI_PUBLISHER_FIRST_PARTY_FRAGMENT_V1+"=1&nonce="+nonce+"&session="+sessionId+"&courseId="+courseId;
  host.addEventListener("message",receive);
  try {popup=host.open(target.href,"CTIPublisher_"+sessionId);} catch (_) {}
  if (!popup) close(code("POPUP_BLOCKED"));
  else {
    handshakeTimer=setTimeout(() => close(code(helloSeen ? "PLAN_NOT_ACKNOWLEDGED" : "HANDLER_NOT_OBSERVED")),300000);
    watchTimer=setInterval(() => {
      if (host.location.origin !== "https://www.coursera.org" || initialParentLocation && host.location.href !== initialParentLocation)
        close(code("CONTEXT_CHANGED"));
      else if (popup.closed) close(code("WINDOW_CLOSED"));
      else if (connected && Date.now()-lastMessageAt > 30000) close(code("CONNECTION_LOST"));
      else if (connected) send("ping");
    },500);
    directPublisherFirstPartyPlanHashV1(plan).then(hash => {if (!stopped) {planSha256=hash;send("init");}},
      () => close(code("PLAN_HASH_FAILED")));
    status("In the publisher tab, complete its normal access check if shown, then click the same CTI course capture bookmark once.");
  }
  return {ready:() => ready,request,supports:payload => connected && !stopped && !!expected(payload),
    snapshot:() => ({requests,receivedBytes,observedBytes,active,queued:queue.filter(job => jobs.has(job.id)).length,stopped,connected,origin,planSha256,sessionId}),close:() => close()};
}

/** Runs only after the user clicks the SAME universal bookmark in the exact
 * publisher tab. Normal same-origin browser credentials never leave this tab.
 * No challenge is solved, retried or hidden; inaccessible responses stay gaps. */
export function runDirectPublisherFirstPartyV1(options = {}) {
  const code = suffix => "PUBLISHER_FIRST_PARTY_"+suffix;
  const host=options.windowImpl || globalThis.window, context=directPublisherFirstPartyContextV1(host?.location);
  if (!context || host !== host.top || !host.opener || host.opener.closed) return null;
  const initial=host.location.href, opener=host.opener, origin="https://www.coursera.org",
    protocol=CTI_PUBLISHER_FIRST_PARTY_PROTOCOL_V1, jobs=new Map(), seenIds=new Set(),
    totalLimit=Number.isSafeInteger(options.limits?.totalBytes) && options.limits.totalBytes > 0 ? Math.min(536870912,options.limits.totalBytes) : 536870912;
  let plan=null, planSha256="", stopped="", requests=0, observedBytes=0, validating=false, lastMessageAt=Date.now(), handshakeTimer, watchTimer;
  const status=message => {try {options.onStatus?.(message);} catch (_) {}};
  const frame=(type,extra = {}) => ({protocol,nonce:context.nonce,sessionId:context.sessionId,courseId:context.courseId,type,...extra});
  function send(type,extra = {},transfer = []) {
    if (stopped) return;
    try {opener.postMessage(frame(type,extra),origin,transfer);} catch (_) {close(code("CONNECTION_LOST"));}
  }
  function current() {return !stopped && host.location.href === initial && host.location.origin === context.origin && !opener.closed;}
  function finish(job) {
    if (!jobs.delete(job.id)) return;
    clearTimeout(job.timer);job.controller.abort();
    try {void job.reader?.cancel().catch(() => {});} catch (_) {}
  }
  function close(reason = code("CLOSED")) {
    if (stopped) return;
    // Mark closed before notifying an opener that may already be detached.
    // Routing this notification through send() would recursively close when
    // postMessage itself throws after a window/COOP connection is lost.
    stopped=reason;
    try {opener.postMessage(frame("error",{code:reason}),origin);} catch (_) {}
    clearTimeout(handshakeTimer);clearInterval(watchTimer);
    host.removeEventListener("message",receive);
    for (const job of [...jobs.values()]) finish(job);
    status(reason);
  }
  function discard(response) {try {void response.body?.cancel().catch(() => {});} catch (_) {}}
  function binding(job) {return {id:job.id,index:job.index,planSha256};}
  function failed(job,code,extra = {}) {send("error",{...binding(job),code,observedBytes:job.observedBytes,...extra});finish(job);}
  function arm(job) {
    clearTimeout(job.timer);
    job.timer=setTimeout(() => failed(job,code("TIMEOUT")),30000);
  }
  async function start(m) {
    const entry=plan.entries[m.index], job={id:m.id,index:m.index,controller:new AbortController(),seq:0,bytes:0,observedBytes:0,pulling:false,pending:null};
    jobs.set(job.id,job);requests++;arm(job);
    try {
      const response=await (options.fetchImpl || fetch)(entry.imageUrl,{method:"GET",mode:"same-origin",credentials:"same-origin",redirect:"error",signal:job.controller.signal}),
        observedAt=new Date().toISOString(), http={status:response.status,observedAt};
      if (!current() || !jobs.has(job.id)) {discard(response);return;}
      if (response.type !== "basic" || response.url !== entry.imageUrl || response.redirected) {
        discard(response)
        failed(job,code("RESPONSE_UNSUPPORTED"));return;
      }
      if (response.headers.has("content-range")) {
        discard(response)
        failed(job,code("RESPONSE_UNSUPPORTED"),http);return;
      }
      if (response.status !== 200) {
        discard(response)
        const challenge=response.status === 403 && response.headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge";
        failed(job,code("HTTP_")+response.status,{...http,...(challenge ? {challenge:"cloudflare"} : {})});
        if (challenge) close(code("ORIGIN_CHALLENGE"));
        return;
      }
      const contentType=response.headers.get("content-type") || "";
      if (contentType.length > 256 || /[\u0000-\u001f\u007f]/.test(contentType) ||
          !CTI_PUBLISHER_FIRST_PARTY_IMAGE_MIMES_V1.split(",").includes(contentType.split(";")[0].trim().toLowerCase())) {
        discard(response)
        failed(job,code("MIME_UNSUPPORTED"),http);return;
      }
      job.reader=response.body?.getReader();
      if (!job.reader) {failed(job,code("BODY_UNREADABLE"),http);return;}
      send("head",{...binding(job),status:200,responseType:"basic",url:entry.imageUrl,contentType,observedAt});
    } catch (_) {if (jobs.has(job.id)) failed(job,current() ? code("FETCH_FAILED") : code("CONTEXT_CHANGED"));}
  }
  async function pull(job,m) {
    if (job.pulling || !job.reader || m.seq !== job.seq || m.offset !== job.bytes) {failed(job,code("INVALID_PULL"));return;}
    job.pulling=true;arm(job);
    try {
      let part=job.pending;
      if (!part) {
        const result=await job.reader.read();
        // A cancellation may win while an already requested read settles.
        // Charge locally observed bytes even when this document/session may
        // no longer send them. Lost-channel bytes cannot be reconciled by the
        // parent and these counters never claim network-wire accounting.
        if (!result.done && result.value instanceof Uint8Array && result.value.byteLength) {
          observedBytes+=result.value.byteLength;job.observedBytes+=result.value.byteLength;
        }
        if (!current() || !jobs.has(job.id)) return;
        if (result.done) {
          if (!job.bytes) {failed(job,code("BODY_EMPTY"));return;}
          send("end",{...binding(job),seq:job.seq,offset:job.bytes});finish(job);return;
        }
        if (!(result.value instanceof Uint8Array) || !result.value.byteLength) {failed(job,code("BODY_UNREADABLE"));return;}
        part=result.value;
        if (observedBytes > totalLimit || job.bytes+part.byteLength > CTI_DIRECT_PUBLISHER_IMAGE_BYTES_V1) {
          failed(job,code("BYTE_LIMIT"));
          if (observedBytes > totalLimit) close(code("BYTE_LIMIT"));
          return;
        }
      }
      const chunk=part.slice(0,65536), size=chunk.byteLength;job.pending=part.length > size ? part.subarray(size) : null;
      send("chunk",{...binding(job),seq:job.seq,offset:job.bytes,observedBytes:job.observedBytes,bytes:chunk.buffer},[chunk.buffer]);
      job.seq++;job.bytes+=size;
    } catch (_) {if (jobs.has(job.id)) failed(job,code("BODY_UNREADABLE"));}
    finally {job.pulling=false;}
  }
  function receive(event) {
    const m=event.data;
    if (event.origin !== origin || event.source !== opener || !m || m.protocol !== protocol ||
        m.nonce !== context.nonce || m.sessionId !== context.sessionId || m.courseId !== context.courseId) return;
    if (!current()) {close(code("CONTEXT_CHANGED"));return;}
    try {if (JSON.stringify(m).length > (m.type === "plan" ? 1048576 : 2048)) return;} catch (_) {return;}
    lastMessageAt=Date.now();
    if (m.type === "ping") {send("pong");return;}
    if (m.type === "init") {send("hello");return;}
    if (m.type === "close") {close();return;}
    if (m.type === "plan" && !plan && !validating) {
      const proposed=directPublisherFirstPartyPlanV1(context.courseId,m.entries);
      if (!proposed || proposed.origin !== context.origin || !/^[a-f0-9]{64}$/.test(m.planSha256 || "")) {close(code("INVALID_PLAN"));return;}
      validating=true;
      directPublisherFirstPartyPlanHashV1(proposed).then(hash => {
        if (!current()) return;
        if (hash !== m.planSha256) {close(code("PLAN_HASH_MISMATCH"));return;}
        plan=proposed;planSha256=hash;clearTimeout(handshakeTimer);send("ready",{planSha256});
        status("Reading only the original image URLs requested by the Coursera capture. Cookies stay in this tab.");
      },() => close(code("PLAN_HASH_FAILED")));return;
    }
    if (!plan || m.planSha256 !== planSha256 && !["cancel"].includes(m.type)) return;
    if (m.type === "request") {
      if (!/^[1-9]\d{0,3}$/.test(m.id || "") || seenIds.has(m.id) || !Number.isSafeInteger(m.index) || !plan.entries[m.index] || jobs.size >= 2 || requests >= 1024) {
        close(code("INVALID_REQUEST"));return;
      }
      if (observedBytes >= totalLimit) {close(code("BYTE_LIMIT"));return;}
      seenIds.add(m.id);
      void start(m);return;
    }
    const job=jobs.get(m.id);
    if (!job) return;
    if (m.type === "cancel") {finish(job);return;}
    if (m.type === "pull" && m.index === job.index) {void pull(job,m);return;}
    failed(job,code("INVALID_REQUEST"));
  }
  host.addEventListener("message",receive);send("hello");
  handshakeTimer=setTimeout(() => close(code("NOT_CONNECTED")),30000);
  watchTimer=setInterval(() => {
    if (!current()) close(code("CONTEXT_CHANGED"));
    else if (plan && Date.now()-lastMessageAt > 30000) close(code("CONNECTION_LOST"));
  },500);
  return {close:() => close(),snapshot:() => ({requests,observedBytes,active:jobs.size,connected:!!plan,stopped}),focus:() => {try {host.focus();} catch (_) {}}};
}
