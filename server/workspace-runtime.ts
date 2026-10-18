import { requireCtiOwner } from "./access.ts";

export interface WorkspaceRuntimeUser {
  email: string;
  role: string;
}
interface RuntimeService {
  fetch(request: Request, init?: RequestInit): Promise<Response>;
}
export const WORKSPACE_SERVICE_ORIGIN =
  "https://cti-coursera-extractor.internal";
export const WORKSPACE_RUNTIME_ORIGIN = "https://cti-workspace.internal";
export const WORKSPACE_RUNTIME_PREFIX = "/workspace";

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

export function isWorkspaceApiPath(path: string): boolean {
  return /^\/api\/(records|uploads)(?:\/|$)/.test(path);
}

export function isPanoptoApiPath(path: string): boolean {
  return /^\/api\/provider\/panopto\/(metadata|podcast)$/.test(path);
}
export function isPublicHtmlApiPath(path: string): boolean {
  return path === "/api/provider/public-html";
}
export function isPublisherImageApiPath(path: string): boolean {
  return path === "/api/provider/publisher-image";
}
export function isProviderApiPath(path: string): boolean {
  return isPanoptoApiPath(path) || isPublicHtmlApiPath(path) || isPublisherImageApiPath(path);
}

export function isDelegatedApiPath(path: string): boolean {
  return isWorkspaceApiPath(path) || isProviderApiPath(path);
}

function publicOrigin(value: string | null): string {
  try {
    const url = new URL(value || "");
    if (url.origin === value && /^https?:$/.test(url.protocol) && !url.username && !url.password)
      return value!;
  } catch {}
  return fail("The delegated provider public origin is invalid.", 403);
}

/** Only the authenticated Pages API calls this bridge. It forwards neither
 * browser credentials nor caller-supplied delegation headers. The destination
 * Worker has no public route, workers.dev or preview URL. */
export async function forwardWorkspaceApi(
  request: Request,
  user: WorkspaceRuntimeUser,
  service: RuntimeService,
): Promise<Response> {
  requireCtiOwner(user);
  const source = new URL(request.url);
  if (!isDelegatedApiPath(source.pathname))
    fail("Invalid workspace runtime route.", 404);
  if (isProviderApiPath(source.pathname) && request.method !== "POST")
    fail("Provider reads require POST.", 405);
  if (request.method !== "GET") {
    if (request.headers.get("Origin") !== source.origin)
      fail("Cross-origin writes are not allowed.", 403);
    if (!["admin", "editor"].includes(user.role))
      fail("Your account has read-only access.", 403);
  }
  const target = new URL(
    WORKSPACE_RUNTIME_PREFIX + source.pathname,
    WORKSPACE_SERVICE_ORIGIN,
  );
  target.search = source.search;
  const headers = new Headers({
    "x-cti-workspace-runtime": "v1",
    "x-cti-user": user.email,
    "x-cti-role": user.role,
  });
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  if (isProviderApiPath(source.pathname))
    headers.set("x-cti-public-origin", publicOrigin(source.origin));
  if (request.method !== "GET") headers.set("Origin", target.origin);
  return service.fetch(
    new Request(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      signal: request.signal,
      // Node's Request fixture requires this for a stream; workerd accepts the
      // same streamed body without materializing the artifact in Pages.
      duplex: "half",
    } as RequestInit),
    { signal: request.signal },
  );
}

/** Private service-binding envelope; this is not a public identity header API. */
export function workspaceRuntimeCaller(request: Request): WorkspaceRuntimeUser {
  const url = new URL(request.url);
  if (
    url.origin !== WORKSPACE_SERVICE_ORIGIN ||
    !url.pathname.startsWith(WORKSPACE_RUNTIME_PREFIX) ||
    !isDelegatedApiPath(url.pathname.slice(WORKSPACE_RUNTIME_PREFIX.length))
  )
    fail("Invalid private workspace runtime route.", 404);
  if (request.headers.get("x-cti-workspace-runtime") !== "v1")
    fail("Trusted workspace delegation is missing.", 401);
  const email = request.headers.get("x-cti-user") || "";
  const role = request.headers.get("x-cti-role") || "";
  if (!email || !["admin", "editor", "viewer"].includes(role))
    fail("Trusted workspace identity is missing.", 401);
  const user = { email, role };
  requireCtiOwner(user);
  if (isProviderApiPath(url.pathname.slice(WORKSPACE_RUNTIME_PREFIX.length))) {
    if (request.method !== "POST") fail("Provider reads require POST.", 405);
    publicOrigin(request.headers.get("x-cti-public-origin"));
  }
  if (request.method !== "GET") {
    if (request.headers.get("Origin") !== url.origin)
      fail("Invalid delegated write origin.", 403);
    if (!["admin", "editor"].includes(role))
      fail("Your account has read-only access.", 403);
  }
  return user;
}

export function workspaceRuntimeApiRequest(request: Request): Request {
  workspaceRuntimeCaller(request);
  const source = new URL(request.url);
  const path = source.pathname.slice(WORKSPACE_RUNTIME_PREFIX.length);
  const target = new URL(path, isProviderApiPath(path)
    ? publicOrigin(request.headers.get("x-cti-public-origin"))
    : WORKSPACE_RUNTIME_ORIGIN);
  target.search = source.search;
  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  if (request.method !== "GET") headers.set("Origin", target.origin);
  return new Request(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    signal: request.signal,
    duplex: "half",
  } as RequestInit);
}

export function workspaceRuntimeError(error: unknown): Response {
  return new Response(
    JSON.stringify({
      error:
        error instanceof Error
          ? error.message
          : "Workspace runtime request failed.",
    }),
    {
      status: Number((error as { status?: number })?.status) || 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
