import { runProbe } from "./probe-core.mjs";

export function createProbeWorker(nonce) {
  if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce)) throw Error("INVALID_LOCAL_PREVIEW_NONCE");
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get("X-CTI-Public-Probe-Nonce") !== nonce)
        return new Response("", { status: 404 });
      if (request.method === "GET" && url.pathname === "/health" && !url.search)
        return new Response("ready", { headers: { "Cache-Control": "no-store" } });
      if (request.method !== "POST" || url.pathname !== "/run" || url.search || request.headers.has("Cookie") || request.headers.has("Authorization"))
        return new Response("", { status: 404 });
      // Input content is deliberately ignored. All public destinations are fixed.
      const result = await runProbe();
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    },
  };
}
