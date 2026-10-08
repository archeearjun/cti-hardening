import {
  authenticateAccess,
  isCtiOwner,
  accessError,
  type AccessAuthenticator,
  type AccessEnvironment,
} from "./access.ts";

export const SITE_CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
export interface SiteContext {
  request: Request;
  env: AccessEnvironment & {
    ASSETS: { fetch(request: Request): Promise<Response> };
  };
  next(): Promise<Response>;
}
const activityFiles = new Set([
  "index.html",
  "style.css",
  "configuration.js",
  "app.js",
  "compact-ui.js",
  "compact.js",
  "core.js",
  "cti-adapter.js",
  "cti-documents.js",
  "activity-quality.js",
  "designer.js",
  "inspect-current-page.js",
  "readiness.js",
  "results.js",
  "shell-capture.js",
  "shell-rendered.js",
  "shell-runner.js",
  "xml-reader.js",
  "vendor/jszip.min.js",
  "vendor/jszip-LICENSE.txt",
  "vendor/pdf.min.mjs",
  "vendor/pdf.worker.min.mjs",
  "vendor/pdfjs-LICENSE.txt",
  "downloads/Coursera_Activity_Capture.js",
  "downloads/CTI_Coursera_Capture.js",
  "downloads/Coursera_Activity_Test_One_Item.js",
]);
export function isSharedActivityPath(path: string) {
  return (
    path === "/activity-designer" ||
    path === "/activity-designer/" ||
    (path.startsWith("/activity-designer/") &&
      activityFiles.has(path.slice("/activity-designer/".length)))
  );
}
function privateResponse(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Cf-Access-Jwt-Assertion");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  if (!headers.has("Content-Security-Policy"))
    headers.set(
      "Content-Security-Policy",
      new URL(request.url).pathname === "/package-runner.html"
        ? "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'none'; img-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
        : SITE_CSP,
    );
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers,
  });
}
export function createSiteBoundary(
  authenticate: AccessAuthenticator = authenticateAccess,
) {
  return async (context: SiteContext) => {
    const { request, env } = context,
      path = new URL(request.url).pathname;
    // The API independently verifies the JWT and owner before data access.
    if (path.startsWith("/api/"))
      return privateResponse(await context.next(), request);
    try {
      const identity = await authenticate(request, env);
      if (!["GET", "HEAD"].includes(request.method))
        throw accessError("Method not allowed.", 405);
      if (!isCtiOwner(identity)) {
        if (path === "/" || path === "/index.html") {
          const target = new URL("/activity-gateway", request.url);
          return privateResponse(
            await env.ASSETS.fetch(new Request(target, request)),
            request,
          );
        }
        if (
          !isSharedActivityPath(path) &&
          ![
            "/activity-gateway",
            "/activity-gateway.html",
            "/activity-gateway.css",
          ].includes(path)
        )
          throw accessError(
            "This CTI workspace is restricted to its owner. Open Role Play & Dialogue from the gateway.",
            403,
          );
      }
      return privateResponse(await context.next(), request);
    } catch (error) {
      return privateResponse(
        new Response(
          JSON.stringify({
            error:
              error instanceof Error
                ? error.message
                : "Access could not be verified.",
          }),
          {
            status: Number((error as { status?: number }).status) || 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
        request,
      );
    }
  };
}
export const enforceSiteAccess = createSiteBoundary();
