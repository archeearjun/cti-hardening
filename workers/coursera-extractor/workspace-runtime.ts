import { DurableObject } from "cloudflare:workers";
import { handleAuthorized, type Database } from "../../server/api.ts";
import {
  workspaceRuntimeCaller,
  workspaceRuntimeApiRequest,
  workspaceRuntimeError,
} from "../../server/workspace-runtime.ts";

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
      env.WORKSPACE_RUNTIME.idFromName("cti-workspace-v1"),
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

  async fetch(request: Request): Promise<Response> {
    try {
      workspaceRuntimeCaller(request);
    } catch (error) {
      return workspaceRuntimeError(error);
    }
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
