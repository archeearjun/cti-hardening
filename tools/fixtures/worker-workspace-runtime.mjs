import {
  forwardWorkspaceRuntime,
  WorkspaceRuntime,
} from "../../workers/coursera-extractor/workspace-runtime.ts";

export { WorkspaceRuntime };

// CI-only front door. The localhost listener stands in for the private Pages
// service binding; the production forwarder and Durable Object run unchanged.
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname === "/__fixture-ready")
      return Response.json({ syntheticFixture: true });
    const origin = incoming.searchParams.has("fixtureForeignOrigin")
      ? "https://untrusted.example.test"
      : "https://cti-coursera-extractor.internal";
    const target = new URL(incoming.pathname + incoming.search, origin);
    return forwardWorkspaceRuntime(new Request(target, request), env);
  },
};
