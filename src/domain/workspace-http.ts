export interface TransferOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
interface RequestOptions extends TransferOptions {
  context?: string;
  phase?: "prepare" | "upload" | "finalize" | "download" | "read";
  comparisonRecovery?: boolean;
}
export interface WorkspaceFailureDiagnostic {
  code: string;
  context: string;
  phase: string;
  message: string;
  status?: number;
  attempts?: number;
  cloudflare?: { rayId?: string; errorType?: string; errorOrigin?: string };
}
type WorkspaceFailure = Error & WorkspaceFailureDiagnostic;

export function workspaceFailureDiagnostic(
  error: unknown,
): WorkspaceFailureDiagnostic | null {
  const e = error as Partial<WorkspaceFailure> | null;
  if (
    !e ||
    typeof e.code !== "string" ||
    !/^WORKSPACE_[A-Z_]{1,70}$/.test(e.code)
  )
    return null;
  const cloudflare = diagnosticHeaders(e.cloudflare || {});
  return {
    code: e.code,
    context: typeof e.context === "string" ? e.context.slice(0, 600) : "",
    phase: typeof e.phase === "string" ? e.phase.slice(0, 30) : "",
    message: typeof e.message === "string" ? e.message.slice(0, 2400) : "",
    ...(Number.isInteger(e.status) ? { status: e.status } : {}),
    ...(Number.isInteger(e.attempts) ? { attempts: e.attempts } : {}),
    ...(Object.keys(cloudflare).length ? { cloudflare } : {}),
  };
}
function diagnosticHeaders(values: {
  rayId?: string;
  errorType?: string;
  errorOrigin?: string;
}) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) =>
        ["rayId", "errorType", "errorOrigin"].includes(key) &&
        typeof value === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,119}$/.test(value),
    ),
  ) as NonNullable<WorkspaceFailureDiagnostic["cloudflare"]>;
}
async function boundedErrorText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const bytes = new Uint8Array(16 * 1024);
  let offset = 0;
  while (offset < bytes.length) {
    const part = await reader.read();
    if (part.done) break;
    const count = Math.min(part.value.length, bytes.length - offset);
    bytes.set(part.value.subarray(0, count), offset);
    offset += count;
    if (offset === bytes.length) await reader.cancel();
  }
  return new TextDecoder().decode(bytes.subarray(0, offset));
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(new Error("Transfer stopped by you."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
}

/** Retry only reads and digest-checked chunk PUTs, never upload creation/commit. */
async function transfer(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
  binaryMaxBytes?: number,
): Promise<any> {
  const method = (init.method || "GET").toUpperCase();
  const retrySafe =
    method === "GET" ||
    (method === "PUT" && /^uploads\/[^/]+\/chunks\/\d+$/.test(path));
  const signal = options.signal || init.signal || undefined;
  const label = options.context || "Workspace request";
  const phase =
    options.phase ||
    (method === "GET"
      ? "read"
      : path.endsWith("/commit")
        ? "finalize"
        : method === "PUT"
          ? "upload"
          : "prepare");
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new Error("Transfer stopped by you.");
    let failure: WorkspaceFailure;
    let retryable = false;
    let delay = 1000 * 2 ** (attempt - 1);
    let retryAfter: number | undefined;
    try {
      const timeout = AbortSignal.timeout(45000);
      const headers = new Headers(init.headers);
      if (typeof init.body === "string" && !headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");
      const res = await fetch("/api/" + path, {
        ...init,
        credentials: "same-origin",
        headers,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (
        binaryMaxBytes !== undefined &&
        res.ok &&
        !res.redirected &&
        /^application\/octet-stream(?:;|$)/i.test(
          res.headers.get("content-type") || "",
        )
      ) {
        const reader = res.body?.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        if (reader) {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.length;
            if (length > binaryMaxBytes) {
              await reader.cancel();
              throw Object.assign(
                new Error(`${label}: saved evidence chunk exceeds its bound.`),
                {
                  code: "WORKSPACE_BINARY_BOUND_EXCEEDED",
                  context: label,
                  phase,
                },
              );
            }
            chunks.push(part.value);
          }
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return bytes;
      }
      const text =
        binaryMaxBytes !== undefined || !res.ok || res.redirected
          ? await boundedErrorText(res)
          : await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        /* Never display an HTML login/error page as evidence. */
      }
      const validJson =
        data && typeof data === "object" && !Array.isArray(data);
      if (
        binaryMaxBytes === undefined &&
        res.ok &&
        !res.redirected &&
        validJson &&
        !data.error
      )
        return data;
      const cloudflare = diagnosticHeaders({
        rayId: res.headers.get("cf-ray") || "",
        errorType: res.headers.get("cf-error-type") || "",
        errorOrigin: res.headers.get("cf-error-origin") || "",
      });
      const extra = [
        cloudflare.rayId ? `Cloudflare Ray ID: ${cloudflare.rayId}.` : "",
        cloudflare.errorType
          ? `Cloudflare error type: ${cloudflare.errorType}.`
          : "",
        cloudflare.errorOrigin
          ? `Cloudflare error origin: ${cloudflare.errorOrigin}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      const detail = res.redirected
        ? "The request was redirected. Reopen the team site and sign in, then retry."
        : validJson && typeof data.error === "string"
          ? data.error.slice(0, 600)
          : "The service returned a non-JSON or invalid response.";
      failure = Object.assign(
        new Error(
          `${label}: HTTP ${res.status}. ${detail}${extra ? ` ${extra}` : ""}`,
        ),
        {
          status: res.status,
          context: label,
          phase,
          cloudflare,
          code: res.redirected
            ? "WORKSPACE_AUTH_REDIRECT"
            : validJson
              ? "WORKSPACE_HTTP_ERROR"
              : "WORKSPACE_RESPONSE_INVALID",
        },
      );
      retryable =
        !res.redirected &&
        (res.status === 408 || res.status === 429 || res.status >= 500);
      const header = res.headers.get("retry-after");
      if (header !== null) {
        const seconds = /^\d+(\.\d+)?$/.test(header.trim())
          ? Number(header)
          : (Date.parse(header) - Date.now()) / 1000;
        if (Number.isFinite(seconds))
          retryAfter = Math.max(0, Math.ceil(seconds * 1000));
      }
      if (retryAfter !== undefined) delay = Math.max(delay, retryAfter);
    } catch (e) {
      if (signal?.aborted) throw new Error("Transfer stopped by you.");
      if (workspaceFailureDiagnostic(e)) throw e;
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      retryable = timedOut || e instanceof TypeError;
      failure = Object.assign(
        new Error(
          `${label}: ${timedOut ? "The request timed out after 45 seconds." : "The network request did not complete."}`,
        ),
        {
          context: label,
          phase,
          code: timedOut ? "WORKSPACE_TIMEOUT" : "WORKSPACE_NETWORK_FAILED",
        },
      );
    }
    failure.attempts = attempt;
    if (!retrySafe || !retryable || attempt >= 3 || delay > 30000) {
      if (retryAfter !== undefined && retryAfter > 0)
        failure.message += ` The service asked to wait ${Math.ceil(retryAfter / 1000)} seconds before retrying.`;
      if (!retrySafe)
        failure.message += options.comparisonRecovery
          ? " This write was not automatically repeated. Use Check save / retry to check the existing report ID first."
          : " This write was not automatically repeated. Retry the import to check saved IDs first.";
      throw failure;
    }
    options.onProgress?.(
      `${label}: temporary failure${failure.status ? ` (HTTP ${failure.status})` : ""}; retry ${attempt + 1}/3 in ${Math.ceil(delay / 1000)} seconds.`,
    );
    await pause(delay, signal);
  }
}

export async function workspaceRequest(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<any> {
  return transfer(path, init, options);
}

export async function workspaceBinaryRequest(
  path: string,
  options: RequestOptions & { maxBytes: number },
): Promise<Uint8Array> {
  if (
    !Number.isInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    options.maxBytes > 128 * 1024
  )
    throw Error("Invalid saved evidence chunk bound.");
  return transfer(path, {}, options, options.maxBytes);
}
