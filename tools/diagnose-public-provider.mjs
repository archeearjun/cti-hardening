// Diagnostic branch only. No production Worker, Pages, D1 or LMS is modified.
// CF credentials remain in the runner. The ephemeral Worker gets only a random
// path secret, six fixed case selectors and an independently enforced expiry.
import { randomBytes } from "node:crypto";

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const runId = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT || "1";
if (
  !token ||
  !account ||
  !/^\d{1,24}$/.test(runId || "") ||
  !/^\d{1,6}$/.test(attempt)
)
  throw Error("PUBLIC_PROBE_CONFIGURATION_MISSING");
const workerName = `cti-public-probe-${runId}-${attempt}`;
if (!/^cti-public-probe-\d{1,24}-\d{1,6}$/.test(workerName))
  throw Error("PUBLIC_PROBE_WORKER_NAME_INVALID");
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}`;
const scriptPath = `/workers/scripts/${workerName}`;
const apiHeaders = { Authorization: `Bearer ${token}` };

async function boundedResponseText(response, maximum) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (
        !(next.value instanceof Uint8Array) ||
        (size += next.value.length) > maximum ||
        chunks.length >= 8192
      )
        throw Error("PUBLIC_PROBE_RESPONSE_LIMIT");
      chunks.push(next.value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {}
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Error("PUBLIC_PROBE_RESPONSE_UTF8_INVALID");
  }
}

async function api(path, { method = "GET", body, allowAbsent = false } = {}) {
  const headers = new Headers(apiHeaders);
  if (body && !(body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(apiBase + path, {
    method,
    headers,
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  const raw = await boundedResponseText(response, 2 * 1024 * 1024);
  let model;
  try {
    model = JSON.parse(raw);
  } catch {
    throw Error(`PUBLIC_PROBE_CONTROL_NON_JSON_HTTP_${response.status}`);
  }
  if (
    allowAbsent &&
    (response.status === 404 ||
      model.errors?.some((error) => Number(error.code) === 10007))
  )
    return null;
  if (!response.ok || model.success !== true) {
    const codes = (model.errors || [])
      .map((error) => Number(error.code) || 0)
      .slice(0, 5)
      .join("_");
    throw Error(`PUBLIC_PROBE_CONTROL_HTTP_${response.status}_CODES_${codes}`);
  }
  return model.result;
}

async function cleanup() {
  let last;
  for (let index = 0; index < 3; index++) {
    try {
      // Disabling public access is attempted before deletion. This Worker has
      // no routes, bindings, schedules or callers outside this diagnostic.
      try {
        await api(scriptPath + "/subdomain", {
          method: "POST",
          body: { enabled: false, previews_enabled: false },
          allowAbsent: true,
        });
      } catch {}
      await api(scriptPath, { method: "DELETE", allowAbsent: true });
      console.log(JSON.stringify({ cleanup: "CONFIRMED", worker: workerName }));
      return;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

// This function is uploaded as a standalone module. It imports no dependency,
// accepts no arbitrary destination and never returns or logs publisher bodies.
async function publicProbeFetch(request, env) {
  const expiresAt = __PROBE_EXPIRES_AT__;
  if (
    Date.now() >= expiresAt ||
    typeof env.PROBE_NONCE !== "string" ||
    !/^[a-f0-9]{64}$/.test(env.PROBE_NONCE) ||
    request.method !== "POST" ||
    new URL(request.url).pathname !== "/probe/" + env.PROBE_NONCE ||
    new URL(request.url).search
  )
    return new Response("Not found", { status: 404 });
  const targets = {
    original: "https://opentextbc.ca/mathfortrades2/?p=179",
    canonical: "https://opentextbc.ca/mathfortrades2/chapter/area/",
    api: "https://opentextbc.ca/mathfortrades2/wp-json/pressbooks/v2/chapters/179",
  };
  const cases = {
    "original-default": { target: "original", honest: false },
    "canonical-default": { target: "canonical", honest: false },
    "api-default": { target: "api", honest: false },
    "original-honest-cti": { target: "original", honest: true },
    "canonical-honest-cti": { target: "canonical", honest: true },
    "api-honest-cti": { target: "api", honest: true },
  };
  const outputHeaders = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    "X-Content-Type-Options": "nosniff",
  };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(20000, expiresAt - Date.now())),
  );
  async function wait(pending) {
    if (controller.signal.aborted || Date.now() >= expiresAt)
      throw Error("PUBLIC_PROBE_TIMEOUT");
    let listener;
    const cancelled = new Promise((_, reject) => {
      listener = () => reject(Error("PUBLIC_PROBE_TIMEOUT"));
      controller.signal.addEventListener("abort", listener, { once: true });
    });
    try {
      return await Promise.race([pending, cancelled]);
    } finally {
      controller.signal.removeEventListener("abort", listener);
    }
  }
  let input;
  try {
    if (
      Number(request.headers.get("content-length") || 0) > 1024 ||
      !request.body
    )
      throw Error();
    const inputReader = request.body.getReader(),
      inputChunks = [];
    let inputBytes = 0;
    try {
      while (true) {
        const next = await wait(inputReader.read());
        if (next.done) break;
        if (
          !(next.value instanceof Uint8Array) ||
          (inputBytes += next.value.length) > 1024 ||
          inputChunks.length >= 64
        ) {
          await inputReader.cancel();
          throw Error();
        }
        inputChunks.push(next.value);
      }
    } catch (error) {
      try {
        void inputReader.cancel().catch(() => {});
      } catch {}
      throw error;
    } finally {
      try {
        inputReader.releaseLock();
      } catch {}
    }
    const inputBuffer = new Uint8Array(inputBytes);
    let inputOffset = 0;
    for (const chunk of inputChunks) {
      inputBuffer.set(chunk, inputOffset);
      inputOffset += chunk.length;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(inputBuffer);
    input = JSON.parse(raw);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      typeof input.caseId !== "string" ||
      !Object.hasOwn(cases, input.caseId)
    )
      throw Error();
  } catch {
    clearTimeout(timer);
    controller.abort();
    return new Response(JSON.stringify({ error: "INVALID_FIXED_CASE" }), {
      status: 400,
      headers: outputHeaders,
    });
  }
  const selected = cases[input.caseId],
    initial = targets[selected.target];
  const report = {
    caseId: input.caseId,
    target: initial,
    headerVariant: selected.honest
      ? "HONEST_CTI_USER_AGENT"
      : "NORMAL_FETCH_HEADERS",
    checkedAt: new Date().toISOString(),
    requests: [],
    stoppedReason: "",
    bodyRetained: false,
    rawBodyPrinted: false,
  };
  let reader;
  function discard(response) {
    try {
      void response.body?.cancel().catch(() => {});
    } catch {}
  }
  const safeHeader = (response, name) => {
    const value = response.headers.get(name);
    return typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 256)
      : null;
  };
  try {
    let url = initial;
    const visited = new Set();
    let response;
    while (true) {
      if (Date.now() >= expiresAt || controller.signal.aborted)
        throw Error("PUBLIC_PROBE_TIMEOUT");
      if (visited.has(url) || report.requests.length >= 4)
        throw Error("PUBLIC_PROBE_REDIRECT_LIMIT");
      visited.add(url);
      const headers = {
        Accept:
          selected.target === "api"
            ? "application/json"
            : "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
      };
      if (selected.honest)
        headers["User-Agent"] =
          "CTI-Public-Publisher-Diagnostic/1.0 (read-only public content check; no cookies)";
      const pending = fetch(url, {
        method: "GET",
        credentials: "omit",
        redirect: "manual",
        headers,
        signal: controller.signal,
      });
      void pending.then(
        (value) => {
          if (controller.signal.aborted) discard(value);
        },
        () => {},
      );
      response = await wait(pending);
      const observed = {
        url,
        method: "GET",
        status: response.status,
        observedAt: new Date().toISOString(),
        mime: safeHeader(response, "content-type"),
        cfMitigated: safeHeader(response, "cf-mitigated"),
        server: safeHeader(response, "server"),
        rawContentLength: safeHeader(response, "content-length"),
        contentEncoding: safeHeader(response, "content-encoding"),
      };
      report.requests.push(observed);
      if (response.redirected || (response.url || url) !== url) {
        discard(response);
        throw Error("PUBLIC_PROBE_AUTOMATIC_REDIRECT");
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      discard(response);
      if (!location || /[\u0000-\u0020\u007f\\%]/.test(location))
        throw Error("PUBLIC_PROBE_REDIRECT_SCOPE");
      const next = new URL(location, url);
      if (
        next.protocol !== "https:" ||
        next.origin !== "https://opentextbc.ca" ||
        next.username ||
        next.password ||
        next.port ||
        !next.pathname.startsWith("/mathfortrades2/") ||
        /(?:wp-admin|wp-login)/i.test(next.pathname) ||
        [...next.searchParams].some(
          ([key, value]) => key !== "p" || value !== "179",
        )
      )
        throw Error("PUBLIC_PROBE_REDIRECT_SCOPE");
      next.hash = "";
      url = next.href;
    }
    report.finalUrl = url;
    report.finalStatus = response.status;
    reader = response.body?.getReader();
    if (!reader) throw Error("PUBLIC_PROBE_NO_BODY");
    const cancel = () => {
      try {
        void reader.cancel().catch(() => {});
      } catch {}
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const chunks = [];
    let size = 0,
      empty = 0;
    try {
      while (true) {
        const next = await wait(reader.read());
        if (next.done) break;
        if (
          !(next.value instanceof Uint8Array) ||
          (!next.value.length && ++empty > 8)
        )
          throw Error("PUBLIC_PROBE_INVALID_STREAM");
        if (next.value.length) empty = 0;
        size += next.value.length;
        report.observedBodyBytes = size;
        if (size > 1048576 || chunks.length >= 8192)
          throw Error("PUBLIC_PROBE_BODY_LIMIT");
        chunks.push(next.value);
      }
    } catch (error) {
      cancel();
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      try {
        reader.releaseLock();
      } catch {}
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    report.bodySha256 = [
      ...new Uint8Array(await wait(crypto.subtle.digest("SHA-256", bytes))),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    if (
      selected.target === "api" &&
      response.status === 200 &&
      /^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(
        response.headers.get("content-type") || "",
      )
    ) {
      try {
        const parsed = JSON.parse(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            bytes,
          ),
        );
        const length = (value) =>
          typeof value === "string" ? value.length : null;
        const linked =
          typeof parsed.link === "string" && parsed.link === targets.canonical
            ? parsed.link
            : null;
        report.apiSummary = {
          id: Number.isSafeInteger(parsed.id) ? parsed.id : null,
          status: [
            "publish",
            "draft",
            "private",
            "pending",
            "future",
            "trash",
          ].includes(parsed.status)
            ? parsed.status
            : null,
          type: ["chapter", "front-matter", "back-matter"].includes(parsed.type)
            ? parsed.type
            : null,
          link: linked,
          exactExpectedIdentity:
            parsed.id === 179 &&
            parsed.status === "publish" &&
            parsed.type === "chapter" &&
            linked === targets.canonical,
          titleRawCharacters: length(parsed.title?.raw),
          titleRenderedCharacters: length(parsed.title?.rendered),
          contentRawCharacters: length(parsed.content?.raw),
          contentRenderedCharacters: length(parsed.content?.rendered),
        };
      } catch {
        report.stoppedReason = "PUBLIC_PROBE_API_JSON_INVALID";
      }
    }
  } catch (error) {
    const message = controller.signal.aborted
      ? "PUBLIC_PROBE_TIMEOUT"
      : error instanceof Error
        ? error.message
        : "";
    report.stoppedReason = /^PUBLIC_PROBE_[A-Z0-9_]{1,80}$/.test(message)
      ? message
      : "PUBLIC_PROBE_REQUEST_FAILED";
  } finally {
    clearTimeout(timer);
  }
  return new Response(JSON.stringify(report), { headers: outputHeaders });
}

if (process.argv.includes("--cleanup")) {
  await cleanup();
} else {
  const nonce = randomBytes(32).toString("hex");
  console.log(`::add-mask::${nonce}`);
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const module =
    publicProbeFetch
      .toString()
      .replace("__PROBE_EXPIRES_AT__", String(expiresAt)) +
    "\nexport default { fetch: publicProbeFetch };\n";
  const form = new FormData();
  form.set(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          main_module: "probe.mjs",
          compatibility_date: "2026-10-01",
          bindings: [{ type: "secret_text", name: "PROBE_NONCE", text: nonce }],
        }),
      ],
      { type: "application/json" },
    ),
  );
  form.set(
    "probe.mjs",
    new Blob([module], { type: "application/javascript+module" }),
    "probe.mjs",
  );
  let created = false,
    failure;
  try {
    await api(scriptPath, { method: "PUT", body: form });
    created = true;
    const accountSubdomain = await api("/workers/subdomain");
    const subdomain = accountSubdomain?.subdomain;
    if (typeof subdomain !== "string" || !/^[a-z0-9-]{1,63}$/i.test(subdomain))
      throw Error("PUBLIC_PROBE_ACCOUNT_SUBDOMAIN_INVALID");
    await api(scriptPath + "/subdomain", {
      method: "POST",
      body: { enabled: true, previews_enabled: false },
    });
    const probeOrigin = `https://${workerName}.${subdomain}.workers.dev`;
    console.log(
      JSON.stringify({
        kind: "CTI_EPHEMERAL_CLOUDFLARE_PUBLIC_PROBE",
        worker: workerName,
        startedAt: new Date().toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        fixedCases: 6,
        maxGetRequestsIncludingRedirects: 24,
        maxBytesPerCase: 1048576,
        productionModified: false,
        providerCredentialsForwarded: false,
        rawBodiesPrinted: false,
      }),
    );
    // Retry only deployment activation, before an upstream probe has run.
    let active = false;
    for (let index = 0; index < 12; index++) {
      try {
        const check = await fetch(probeOrigin + "/probe/" + nonce, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        const value = await boundedResponseText(check, 4096);
        if (
          check.status === 400 &&
          value === '{"error":"INVALID_FIXED_CASE"}'
        ) {
          active = true;
          break;
        }
      } catch {
        /* A deployment activation retry never initiates a publisher read. */
      }
      if (index < 11) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (!active) throw Error("PUBLIC_PROBE_ACTIVATION_FAILED");
    let failedCases = 0;
    for (const caseId of [
      "original-default",
      "canonical-default",
      "api-default",
      "original-honest-cti",
      "canonical-honest-cti",
      "api-honest-cti",
    ]) {
      try {
        const response = await fetch(probeOrigin + "/probe/" + nonce, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId }),
          signal: AbortSignal.timeout(30000),
        });
        const raw = await boundedResponseText(response, 16384);
        let result;
        try {
          result = JSON.parse(raw);
        } catch {
          throw Error(`PUBLIC_PROBE_RESULT_NON_JSON_HTTP_${response.status}`);
        }
        if (
          !response.ok ||
          result.caseId !== caseId ||
          result.rawBodyPrinted !== false ||
          result.bodyRetained !== false ||
          !Array.isArray(result.requests) ||
          result.requests.length > 4
        )
          throw Error(`PUBLIC_PROBE_RESULT_INVALID_HTTP_${response.status}`);
        console.log(JSON.stringify(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        console.log(
          JSON.stringify({
            caseId,
            probeFailure: /^PUBLIC_PROBE_[A-Z0-9_]{1,120}$/.test(message)
              ? message
              : "PUBLIC_PROBE_RESULT_UNAVAILABLE",
            rawBodyPrinted: false,
          }),
        );
        failedCases++;
      }
    }
    if (failedCases) throw Error("PUBLIC_PROBE_CASES_UNCONFIRMED");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    failure = Error(
      /^PUBLIC_PROBE_[A-Z0-9_]{1,120}$/.test(message)
        ? message
        : "PUBLIC_PROBE_CONTROL_FAILED",
    );
  } finally {
    // Also run after a failed upload: a successful control-plane write can
    // precede an interrupted response. The deterministic name is scoped here.
    try {
      await cleanup();
    } catch {
      console.log(
        JSON.stringify({
          cleanup: "UNCONFIRMED",
          worker: workerName,
          automaticExpiry: new Date(expiresAt).toISOString(),
          uploadConfirmed: created,
        }),
      );
      failure ||= Error("PUBLIC_PROBE_CLEANUP_UNCONFIRMED");
    }
  }
  if (failure) throw failure;
}
