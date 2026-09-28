export interface TransferOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
interface RequestOptions extends TransferOptions {
  context?: string;
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
export async function workspaceRequest(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<any> {
  const method = (init.method || "GET").toUpperCase();
  const retrySafe =
    method === "GET" ||
    (method === "PUT" && /^uploads\/[^/]+\/chunks\/\d+$/.test(path));
  const signal = options.signal || init.signal || undefined;
  const label = options.context || "Workspace request";
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new Error("Transfer stopped by you.");
    let failure: Error & { status?: number };
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
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        /* Never display an HTML login/error page as evidence. */
      }
      const validJson =
        data && typeof data === "object" && !Array.isArray(data);
      if (res.ok && !res.redirected && validJson && !data.error) return data;
      const ray = res.headers.get("cf-ray") || "";
      const detail = res.redirected
        ? "The request was redirected. Reopen the team site and sign in, then retry."
        : validJson && typeof data.error === "string"
          ? data.error.slice(0, 600)
          : "The service returned a non-JSON or invalid response.";
      failure = Object.assign(
        new Error(
          `${label}: HTTP ${res.status}. ${detail}${/^[a-zA-Z0-9-]{1,100}$/.test(ray) ? ` Cloudflare Ray ID: ${ray}.` : ""}`,
        ),
        { status: res.status },
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
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      retryable = timedOut || e instanceof TypeError;
      failure = new Error(
        `${label}: ${timedOut ? "The request timed out after 45 seconds." : "The network request did not complete."}`,
      );
    }
    if (!retrySafe || !retryable || attempt >= 3 || delay > 30000) {
      if (retryAfter !== undefined && retryAfter > 0)
        failure.message += ` The service asked to wait ${Math.ceil(retryAfter / 1000)} seconds before retrying.`;
      if (!retrySafe)
        failure.message +=
          " This write was not automatically repeated. Retry the import to check saved IDs first.";
      throw failure;
    }
    options.onProgress?.(
      `${label}: temporary failure${failure.status ? ` (HTTP ${failure.status})` : ""}; retry ${attempt + 1}/3 in ${Math.ceil(delay / 1000)} seconds.`,
    );
    await pause(delay, signal);
  }
}
