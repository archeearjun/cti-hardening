import { expectedForm, mediaBytes, mediaOrigin, metadataPath, source, stateUrl } from "./worker-panopto-source.mjs";

const calls = [], cancelled = [];
function pendingBody(prefix, label) {
  let timer, release;
  return new ReadableStream({
    start(controller) { controller.enqueue(prefix); },
    pull(controller) { return new Promise(resolve => {
      release = resolve;
      timer = setTimeout(() => { controller.enqueue(prefix); resolve(); }, 1000);
    }); },
    cancel() { clearTimeout(timer); release?.(); cancelled.push(label); },
  });
}
export default {
  async fetch(request) {
    if (request.url === stateUrl && request.method === "GET")
      return Response.json({ calls, cancelled });
    const url = new URL(request.url), body = new TextDecoder().decode(await request.arrayBuffer());
    calls.push({ url: request.url, method: request.method, body, headers: [...request.headers] });
    if (request.headers.has("Cookie") || request.headers.has("Authorization"))
      throw Error("The public reader forwarded credentials.");
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
        pendingBody(mediaBytes, "cancel-media.hosted.panopto.com"), { headers: { "content-type": "video/mp4" } });
      return new Response(mediaBytes, { headers: { "content-type": "video/mp4", "content-length": String(mediaBytes.length) } });
    }
    throw Error("Unexpected outbound URL; the fixture has no network capability.");
  },
};
