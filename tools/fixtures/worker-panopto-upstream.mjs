import { expectedForm, mediaBytes, mediaOrigin, metadataPath, source, stateUrl,
  publicHtmlOrigin, publicHtmlPath, publicHtmlBytes, publicHtmlUrl } from "./worker-panopto-source.mjs";
import { publisherImageOrigin, publisherImagePath, publisherImageBytes } from "./worker-publisher-image.mjs";

const calls = [], cancelled = [], pulls = [], aborted = [];
function pendingBody(prefix, label, declaredBytes = 0, ctx, signal) {
  let timer, release, output, ended = false;
  const stop = native => {
    if (ended) return; ended = true;
    clearTimeout(timer); release?.(); cancelled.push(label);
    signal?.removeEventListener("abort", nativeAbort);
    if (native) { aborted.push(label); try {output.error(Error("Synthetic public request aborted"));} catch {} }
  };
  const nativeAbort = () => stop(true);
  const source = new ReadableStream({
    start(controller) { output=controller; controller.enqueue(prefix); },
    pull(controller) { pulls.push(label); return new Promise(resolve => {
      release = resolve;
      if (ended) {resolve();return;}
      timer = setTimeout(() => { if (!ended) controller.enqueue(prefix); resolve(); }, 1000);
    }); },
    cancel() { stop(false); },
  });
  if (signal?.aborted) nativeAbort(); else signal?.addEventListener("abort", nativeAbort, {once:true});
  if (!declaredBytes) return source;
  // Native workerd derives Content-Length for streamed responses from this
  // framing primitive, rather than trusting a manually assigned header.
  const framed = new FixedLengthStream(declaredBytes);
  // Keep the asynchronous pump in the mock request's lifetime until the
  // consumer cancels it. A detached pipe can otherwise disappear after the
  // service response is returned, before the provider reads its MP4 prefix.
  ctx.waitUntil(source.pipeTo(framed.writable).catch(() => {}));
  return framed.readable;
}
export default {
  async fetch(request, _env, ctx) {
    if (request.url === stateUrl && request.method === "GET")
      return Response.json({ calls, cancelled, pulls, aborted });
    const url = new URL(request.url), body = new TextDecoder().decode(await request.arrayBuffer());
    calls.push({ url: request.url, method: request.method, body, headers: [...request.headers] });
    if (request.headers.has("Cookie") || request.headers.has("Authorization"))
      throw Error("The public reader forwarded credentials.");
    if (url.origin === publisherImageOrigin && url.pathname.startsWith(publisherImagePath)) {
      if (request.method !== "GET" || body || request.headers.get("accept-encoding") !== "identity")
        throw Error("Images require a bodyless identity GET.");
      const name = url.pathname.slice(publisherImagePath.length).replace(/\.png$/, ""), headers = { "Content-Type":"image/png" };
      if (name === "redirect") return new Response(null,{status:307,headers:{Location:"https://never-follow.invalid/image.png"}});
      if (name === "denied") return new Response("Synthetic private denial",{status:401});
      if (name === "challenge") return new Response("Synthetic challenge",{status:403,headers:{"cf-mitigated":"challenge"}});
      if (name === "html") return new Response("Synthetic source page",{headers:{"Content-Type":"text/html"}});
      if (name === "signature") return new Response("Not raster bytes",{headers});
      if (name === "encoded") return new Response(publisherImageBytes,{headers:{...headers,"Content-Encoding":"gzip"}});
      if (name === "range") return new Response(publisherImageBytes,{headers:{...headers,"Content-Range":"bytes 0-15/100"}});
      if (["held", "held-direct"].includes(name)) return new Response(pendingBody(publisherImageBytes, "publisher-image-" + name, 0, ctx, request.signal),{headers});
      if (name === "short-framed") {
        const framed = new FixedLengthStream(publisherImageBytes.length + 1);
        ctx.waitUntil((async () => {const writer=framed.writable.getWriter();try{await writer.write(publisherImageBytes);await writer.close();}
          catch{try{await writer.abort();}catch{}}finally{writer.releaseLock();}})());
        return new Response(framed.readable,{headers});
      }
      if (name === "chunked") return new Response(new ReadableStream({start(c){c.enqueue(publisherImageBytes.subarray(0,3));c.enqueue(publisherImageBytes.subarray(3));c.close();}}),{headers});
      if (name === "success") return new Response(publisherImageBytes,{headers});
      throw Error("Unexpected synthetic image path");
    }
    if (url.origin === publicHtmlOrigin && url.pathname.startsWith(publicHtmlPath)) {
      if (request.method !== "GET" || body || request.headers.get("accept-encoding") !== "identity")
        throw Error("The public HTML reader must use a bodyless identity GET.");
      const name = url.pathname.slice(publicHtmlPath.length).replace(/\/$/, ""),
        headers = { "Content-Type": "Text/HTML; charset=UTF-8" };
      if (name === "same-book-redirect")
        return new Response(null, { status: 307, headers: { Location: publicHtmlUrl("success") } });
      if (name === "foreign-redirect")
        return new Response(null, { status: 302, headers: { Location: "https://never-follow.invalid/public-html" } });
      if (name === "other-book-redirect")
        return new Response(null, { status: 308, headers: { Location: "/another-book/chapter/body/" } });
      if (name === "invalid-utf8")
        return new Response(Uint8Array.from([...publicHtmlBytes.subarray(0, 20), 0xff, ...publicHtmlBytes.subarray(20)]), { headers });
      if (name === "wrong-charset")
        return new Response(publicHtmlBytes, { headers: { "Content-Type": "text/html; charset=iso-8859-1" } });
      if (name === "range")
        return new Response(publicHtmlBytes, { headers: { ...headers, "Content-Range": "bytes 0-50/1000" } });
      if (name === "encoded")
        return new Response(publicHtmlBytes, { headers: { ...headers, "Content-Encoding": "gzip" } });
      if (name === "too-large" || name === "stream-too-large") {
        const oversized = new Uint8Array(1024 * 1024 + 1).fill(120);
        oversized.set(new TextEncoder().encode("<html>"));
        if (name === "too-large") return new Response(oversized, { headers });
        return new Response(new ReadableStream({ start(controller) {
          for (let index = 0; index < oversized.length; index += 65536)
            controller.enqueue(oversized.subarray(index, Math.min(oversized.length, index + 65536)));
          controller.close();
        } }), { headers });
      }
      if (name === "short-framed") {
        const framed = new FixedLengthStream(publicHtmlBytes.length + 1);
        ctx.waitUntil((async () => {
          const writer = framed.writable.getWriter();
          try { await writer.write(publicHtmlBytes); await writer.close(); }
          catch { try { await writer.abort(); } catch {} }
          finally { writer.releaseLock(); }
        })());
        return new Response(framed.readable, { headers });
      }
      if (name === "success" || name === "chunked") {
        if (name === "success") return new Response(publicHtmlBytes, { headers });
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(publicHtmlBytes.subarray(0, 17));
          controller.enqueue(publicHtmlBytes.subarray(17));
          controller.close();
        } }), { headers });
      }
      throw Error("Unexpected synthetic public HTML path.");
    }
    if (/^[a-z0-9-]+\.hosted\.panopto\.com$/.test(url.hostname) && url.pathname === metadataPath) {
      if (request.method !== "POST" || body !== expectedForm ||
          request.headers.get("content-type") !== "application/x-www-form-urlencoded;charset=UTF-8")
        throw Error("Unexpected native metadata request.");
      const redirect = url.hostname.match(/^redirect-(301|302|303|307|308)\./);
      if (redirect) return new Response(null, { status: Number(redirect[1]), headers: { Location: "https://never-follow.invalid/target" } });
      if (url.hostname === "denied.hosted.panopto.com") return new Response("Synthetic private error text", { status: 401 });
      if (url.hostname === "cancel-metadata.hosted.panopto.com") return new Response(
        pendingBody(new TextEncoder().encode("{"), url.hostname), { headers: { "content-type": "application/json" } });
      return new Response(source(url.hostname).raw, { headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (url.origin === mediaOrigin && /^\/cti-workerd-fixture\/[a-z0-9-]+\.hosted\.panopto\.com\/podcast\.mp4$/.test(url.pathname) && request.method === "GET" && !body) {
      if (url.pathname.includes("/redirect-media.")) return new Response(null, { status: 307, headers: { Location: "https://never-follow.invalid/media" } });
      if (url.pathname.includes("/cancel-media.")) return new Response(
        pendingBody(mediaBytes, "cancel-media.hosted.panopto.com", mediaBytes.length * 100, ctx),
        { headers: { "content-type": "video/mp4", "content-length": String(mediaBytes.length * 100) } });
      return new Response(mediaBytes, { headers: { "content-type": "video/mp4", "content-length": String(mediaBytes.length) } });
    }
    throw Error("Unexpected outbound URL; the fixture has no network capability.");
  },
};
