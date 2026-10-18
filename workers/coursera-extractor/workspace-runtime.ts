import { DurableObject } from "cloudflare:workers";
import { handleAuthorized, type Database } from "../../server/api.ts";
import { panoptoProviderErrorResponse } from "../../server/panopto-provider.ts";
import { publicHtmlProviderErrorResponse } from "../../server/public-html-provider.ts";
import { publisherImageProviderErrorResponse } from "../../server/publisher-image-provider.ts";
import {
  isProviderApiPath,
  isPublicHtmlApiPath,
  isPublisherImageApiPath,
  WORKSPACE_RUNTIME_PREFIX,
  workspaceRuntimeCaller,
  workspaceRuntimeApiRequest,
  workspaceRuntimeError,
} from "../../server/workspace-runtime.ts";

export const WORKSPACE_RUNTIME_OBJECT_NAME = "cti-workspace-v1";
export const PANOPTO_RUNTIME_OBJECT_NAME = "cti-panopto-public-v1";
export const PANOPTO_RUNTIME_MAX_STREAMS = 8;
export const PUBLISHER_IMAGE_RUNTIME_MAX_STREAMS = 1;

export interface WorkspaceRuntimeEnvironment {
  CTI_DB?: Database;
  WORKSPACE_RUNTIME?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}

/** This entry is reached exclusively through the private CTI service binding. */
export async function forwardWorkspaceRuntime(
  request: Request,
  env: WorkspaceRuntimeEnvironment,
): Promise<Response> {
  try {
    workspaceRuntimeCaller(request);
    if (!env.WORKSPACE_RUNTIME)
      return new Response(
        JSON.stringify({
          error: "The durable workspace runtime is not configured.",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    return await env.WORKSPACE_RUNTIME.get(
      env.WORKSPACE_RUNTIME.idFromName(isProviderApiPath(
        new URL(request.url).pathname.slice(WORKSPACE_RUNTIME_PREFIX.length),
      ) ? PANOPTO_RUNTIME_OBJECT_NAME : WORKSPACE_RUNTIME_OBJECT_NAME),
    ).fetch(request);
  } catch (error) {
    return workspaceRuntimeError(error);
  }
}

/** SQLite Durable Objects have their own request CPU allowance, including on
 * Workers Free. Complete existing evidence validation runs here, rather than
 * in a Pages request with a 10 ms CPU allowance. D1 bounds still apply. */
export class WorkspaceRuntime extends DurableObject<WorkspaceRuntimeEnvironment> {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private providerActive = 0;
  private publisherImageActive = 0;

  /** Provider streams use a dedicated object identity and never enter the
   * workspace mutation queue. Keep the permit until EOF/cancel/error, rather
   * than releasing it when the HTTP response headers become available. */
  private async provider(request: Request): Promise<Response> {
    const api = workspaceRuntimeApiRequest(request);
    const publisherImage = isPublisherImageApiPath(new URL(api.url).pathname);
    if (publisherImage && (this.publisherImageActive >= PUBLISHER_IMAGE_RUNTIME_MAX_STREAMS || this.providerActive >= PANOPTO_RUNTIME_MAX_STREAMS))
      return publisherImageProviderErrorResponse("PUBLISHER_IMAGE_PROVIDER_BUSY", 503, new URL(api.url).origin);
    if (this.providerActive >= PANOPTO_RUNTIME_MAX_STREAMS)
      return isPublicHtmlApiPath(new URL(api.url).pathname) ? publicHtmlProviderErrorResponse("PUBLIC_HTML_PROVIDER_BUSY", 503, new URL(api.url).origin) : panoptoProviderErrorResponse("PANOPTO_PROVIDER_BUSY", 503, new URL(api.url).origin);
    this.providerActive++;
    if (publisherImage) this.publisherImageActive++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.providerActive--;
      if (publisherImage) this.publisherImageActive--;
    };
    let response: Response;
    try {
      // The provider branch of this shared handler runs before any D1 access.
      // It retains the exact public-origin receipt, ownership and source rules.
      response = await handleAuthorized(api, this.env.CTI_DB!, workspaceRuntimeCaller(request));
    } catch (error) {
      release();
      return workspaceRuntimeError(error);
    }
    if (!response.body) {release();return response;}
    const reader = response.body.getReader();
    let finished = false;
    let onAbort = () => {};
    let output: ReadableStreamDefaultController<Uint8Array>;
    const finish = (cancel = false) => {
      if (finished) return;
      finished = true;
      api.signal.removeEventListener("abort", onAbort);
      if (cancel) void reader.cancel().catch(() => {});
      try {reader.releaseLock();} catch {}
      release();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller;
        onAbort = () => {
          if (!finished) {
            controller.error(Error("Provider transfer cancelled."));
            finish(true);
          }
        };
        if (api.signal.aborted) onAbort();
        else api.signal.addEventListener("abort", onAbort, {once: true});
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (finished) return;
          if (next.done) {controller.close();finish();}
          else controller.enqueue(next.value);
        } catch {
          if (!finished) {
            controller.error(Error("Provider transfer interrupted."));
            finish(true);
          }
        }
      },
      cancel() {finish(true);},
    }, {highWaterMark: 0});
    // An upstream deadline can fail while the receiver is paused. Observe
    // errors independently of pull so a failed stream cannot retain a permit.
    // Normal reader closure is left to pull, preserving every buffered byte.
    void reader.closed.catch(() => {
      if (!finished) {output.error(Error("Provider transfer interrupted."));finish(true);}
    });
    return new Response(stream, {status: response.status, headers: response.headers});
  }

  async fetch(request: Request): Promise<Response> {
    try {
      workspaceRuntimeCaller(request);
    } catch (error) {
      return workspaceRuntimeError(error);
    }
    if (isProviderApiPath(new URL(request.url).pathname.slice(WORKSPACE_RUNTIME_PREFIX.length)))
      return this.provider(request);
    if (this.pending >= 8)
      return new Response(
        JSON.stringify({
          error:
            "The workspace is processing other evidence. Retry this exact upload after a moment.",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Retry-After": "1",
          },
        },
      );
    // Establish the queue slot synchronously, before any awaited body/DB work.
    // blockConcurrencyWhile has a 30-second wall deadline; a promise queue
    // preserves serialization while allowing ordinary D1 I/O to take longer.
    this.pending++;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (request.signal.aborted)
        return new Response(
          JSON.stringify({ error: "Workspace transfer was cancelled." }),
          {
            status: 409,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      if (!this.env.CTI_DB)
        return new Response(
          JSON.stringify({
            error: "The durable workspace database binding is missing.",
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      return await handleAuthorized(
        workspaceRuntimeApiRequest(request),
        this.env.CTI_DB,
        workspaceRuntimeCaller(request),
      );
    } catch (error) {
      return workspaceRuntimeError(error);
    } finally {
      this.pending--;
      release();
    }
  }
}
