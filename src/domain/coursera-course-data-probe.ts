import { parseCourseraShellUrl } from "./coursera-background-extraction.ts";

export const COURSERA_COURSE_DATA_PROBE_VERSION = 1;

/** A diagnostic prerequisite for an editor-free reader, not a course capture.
 * The universal bookmark derives its course from the already-open authoring tab.
 * An expected URL can bind a copied Console check to a particular course. */
export function createCourseraCourseDataProbeScript(
  expectedShellUrl?: string,
): string {
  let expected: { courseId: string; slug: string } | null = null;
  if (expectedShellUrl !== undefined) {
    const target = parseCourseraShellUrl(expectedShellUrl);
    if (new URL(expectedShellUrl.trim()).origin !== "https://www.coursera.org")
      throw new Error(
        "Use the exact https://www.coursera.org authoring origin.",
      );
    expected = { courseId: target.courseId, slug: target.slug };
  }
  return (
    "void (" +
    runCourseraCourseDataProbe.toString() +
    ")(" +
    JSON.stringify({ version: COURSERA_COURSE_DATA_PROBE_VERSION, expected }) +
    ",(" +
    sanitizeCourseraCourseDataModel.toString() +
    "));"
  );
}

export function createCourseraCourseDataProbeBookmark(): string {
  return (
    "javascript:" + encodeURIComponent(createCourseraCourseDataProbeScript())
  );
}

/** Preserve unknown relation fields without exporting known credential fields.
 * This produces a parsed, sanitized JSON model; it is not byte-exact raw JSON. */
export function sanitizeCourseraCourseDataModel(value: unknown) {
  const denied = new Set(
    [
      "token",
      "writeaccesstoken",
      "write_access_token",
      "accesstoken",
      "access_token",
      "refreshtoken",
      "refresh_token",
      "idtoken",
      "id_token",
      "authtoken",
      "auth_token",
      "bearertoken",
      "bearer_token",
      "bearer",
      "jwt",
      "jwttoken",
      "jwt_token",
      "csrftoken",
      "csrf_token",
      "xsrftoken",
      "xsrf_token",
      "x-csrf-token",
      "x-xsrf-token",
      "x-auth-token",
      "x-access-token",
      "x-authorization",
      "csrf",
      "xsrf",
      "authorization",
      "auth",
      "authentication",
      "cookie",
      "cookies",
      "set-cookie",
      "sessionid",
      "session_id",
      "sessiontoken",
      "session_token",
      "password",
      "passwd",
      "secret",
      "clientsecret",
      "client_secret",
      "credential",
      "credentials",
      "apikey",
      "api_key",
      "privatekey",
      "private_key",
      "accesskeyid",
      "awsaccesskeyid",
      "signature",
      "x-amz-credential",
      "x-amz-security-token",
      "x-amz-signature",
      "x-goog-credential",
      "x-goog-signature",
      "x-api-key",
    ].map((key) => key.replace(/[^a-z0-9]/g, "")),
  );
  const credentialKey = (key: string) =>
    key.toLowerCase().replace(/[^a-z0-9]/g, "");
  let nodes = 0,
    removedFields = 0,
    redactedUrls = 0,
    limitReached = false;
  function cleanUrl(text: string): string {
    return text.replace(
      /(?:https?:\/\/|\/\/)[^\s"'<>]+|[^\s"'<>]*[?#][^\s"'<>]+/gi,
      (original) => {
        try {
          const absolute = /^https?:\/\//i.test(original),
            protocolRelative = original.startsWith("//");
          const address = new URL(original, "https://cti-redaction.invalid/");
          let changed = Boolean(address.username || address.password);
          address.username = "";
          address.password = "";
          for (const key of [...address.searchParams.keys()])
            if (denied.has(credentialKey(key.replace(/^(?:amp;)+/g, "")))) {
              address.searchParams.delete(key);
              changed = true;
            }
          if (
            address.hash &&
            /(?:token|credential|authorization|password|secret)/i.test(
              address.hash,
            )
          ) {
            address.hash = "";
            changed = true;
          }
          if (changed) {
            redactedUrls++;
            return absolute
              ? address.href
              : protocolRelative
                ? address.href.replace(/^https:/, "")
                : original.split(/[?#]/)[0] + address.search + address.hash;
          }
        } catch {
          /* A non-URL content fragment is retained as observed. */
        }
        return original;
      },
    );
  }
  function walk(entry: unknown, depth: number): any {
    if (++nodes > 100000 || depth > 48) {
      limitReached = true;
      return null;
    }
    if (typeof entry === "string") {
      if (entry.length > 2 * 1024 * 1024) {
        limitReached = true;
        return null;
      }
      // Some plugin/atom models contain a serialized JSON configuration string.
      // Strip known credentials there as well, while retaining the string type.
      if (/^\s*[\[{]/.test(entry)) {
        try {
          return JSON.stringify(walk(JSON.parse(entry), depth + 1));
        } catch {
          /* Ordinary text. */
        }
      }
      return cleanUrl(entry);
    }
    if (entry === null || typeof entry !== "object") return entry;
    if (Array.isArray(entry))
      return entry.map((child) => walk(child, depth + 1));
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(entry)) {
      if (denied.has(credentialKey(key))) {
        removedFields++;
        continue;
      }
      out[key] = walk(child, depth + 1);
    }
    return out;
  }
  const data = walk(value, 0);
  return { data, removedFields, redactedUrls, limitReached };
}

interface CourseProbeConfig {
  version: number;
  expected: { courseId: string; slug: string } | null;
}

// Printed into the browser program. All runtime helpers live inside this
// function or are supplied explicitly; it captures no module/bundler variables.
async function runCourseraCourseDataProbe(
  config: CourseProbeConfig,
  sanitize: typeof sanitizeCourseraCourseDataModel,
) {
  const host = window as Window & {
    __CTI_COURSERA_COURSE_DATA_PROBE?: any;
    __CTI_ITEM_FIDELITY_RUN_LOCK?: { running?: boolean };
  };
  const address = new URL(location.href);
  const match = address.pathname.match(
    /^\/teach\/([^/]+)\/([A-Za-z0-9_-]{8,})\/content(?:\/|$)/,
  );
  if (
    window !== window.top ||
    address.origin !== "https://www.coursera.org" ||
    address.username ||
    address.password ||
    !match ||
    (config.expected &&
      (match[2] !== config.expected.courseId ||
        match[1] !== config.expected.slug))
  ) {
    window.alert(
      "Open the Coursera authoring course in the main tab before using this bookmark.",
    );
    return;
  }
  if (host.__CTI_ITEM_FIDELITY_RUN_LOCK?.running) {
    window.alert(
      "Stop the running CTI extractor before using the course data check bookmark.",
    );
    return;
  }
  if (host.__CTI_COURSERA_COURSE_DATA_PROBE?.running) return;
  const courseId = match[2],
    coursePath = "/teach/" + match[1] + "/" + courseId + "/content";
  const inCourse = () =>
    location.origin === address.origin &&
    (location.pathname === coursePath ||
      location.pathname.startsWith(coursePath + "/"));
  const limits = {
    durationMs: 60000,
    requests: 2,
    concurrentRequests: 2,
    bodyBytes: 2 * 1024 * 1024,
    totalBytes: 6 * 1024 * 1024,
    requestMs: 20000,
  };
  const began = Date.now(),
    deadline = began + limits.durationMs;
  const captureId = crypto.randomUUID();
  const records: any[] = [],
    failures: any[] = [],
    controllers = new Set<AbortController>();
  const state = {
    running: true,
    result: null as any,
    summary: null as any,
    stop: (_reason?: string) => {},
  };
  host.__CTI_COURSERA_COURSE_DATA_PROBE = state;
  document.getElementById("__cti_coursera_course_data_probe")?.remove();
  const root = document.createElement("section");
  root.id = "__cti_coursera_course_data_probe";
  root.setAttribute("aria-label", "CTI course data check");
  Object.assign(root.style, {
    position: "fixed",
    bottom: "12px",
    right: "12px",
    zIndex: "2147483647",
    width: "350px",
    maxWidth: "calc(100vw - 24px)",
  });
  const shadow = root.attachShadow({ mode: "closed" }),
    panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "white",
    color: "#172238",
    border: "1px solid #9ba5b6",
    borderRadius: "8px",
    padding: "14px",
    font: "13px/1.5 system-ui",
    boxShadow: "0 2px 12px #0003",
  });
  const title = document.createElement("strong");
  title.textContent = "CTI · Course data check";
  const help = document.createElement("p");
  help.textContent =
    "Checks the course's data structure without opening quizzes or reloading. This diagnostic will help build a faster extractor; it is not a full course capture.";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const output = document.createElement("textarea");
  output.readOnly = true;
  output.hidden = true;
  output.setAttribute("aria-label", "Course data diagnostic summary");
  Object.assign(output.style, {
    width: "100%",
    height: "130px",
    boxSizing: "border-box",
  });
  const copyButton = document.createElement("button");
  copyButton.textContent = "Copy check summary";
  copyButton.disabled = true;
  const downloadButton = document.createElement("button");
  downloadButton.textContent = "Download course data check";
  downloadButton.disabled = true;
  downloadButton.style.marginLeft = "8px";
  const stopButton = document.createElement("button");
  stopButton.textContent = "Stop check";
  stopButton.style.marginTop = "8px";
  panel.append(
    title,
    help,
    status,
    output,
    copyButton,
    downloadButton,
    stopButton,
  );
  shadow.append(panel);
  document.documentElement.append(root);
  let finished = false,
    requests = 0,
    bytes = 0,
    inventoryLeafCount = 0,
    automaticDownloadAttempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observedPaths: {
    resource: string;
    pathname: string;
    courseBinding: string;
    fetched: false;
  }[] = [];
  const seenPaths = new Set<string>();
  for (const entry of performance.getEntriesByType("resource")) {
    if (observedPaths.length >= 40) break;
    try {
      const url = new URL(entry.name);
      const resource = url.pathname.match(
        /^\/api\/(authoringItemContentRelations\.v1|authoringAtoms\.v2)\/[A-Za-z0-9_~!.-]{1,256}\/?$/,
      );
      if (
        url.origin !== address.origin ||
        url.username ||
        url.password ||
        !resource ||
        seenPaths.has(url.pathname)
      )
        continue;
      // Historical SPA performance entries alone cannot certify course ownership.
      // Retain only route metadata and never reread those unbound resources.
      seenPaths.add(url.pathname);
      observedPaths.push({
        resource: resource[1],
        pathname: url.pathname,
        courseBinding: "NOT_ESTABLISHED_FROM_PERFORMANCE_ENTRY",
        fetched: false,
      });
    } catch {
      /* Ignore unrecognized routes without retaining their values. */
    }
  }
  function render() {
    if (!finished)
      status.textContent =
        "Reading course data · " +
        requests +
        " / 2 requests · " +
        records.length +
        " responses saved · " +
        Math.floor((Date.now() - began) / 1000) +
        "s";
  }
  function finish(code: string) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const controller of controllers) controller.abort();
    controllers.clear();
    window.removeEventListener("pagehide", leaving);
    state.running = false;
    const material = records.find(
      (record) => record.resource === "authoringCourseMaterials.v1",
    );
    const summary = {
      kind: "CTI_COURSERA_COURSE_DATA_CHECK_V1",
      notForCourseAudit: true,
      scope: "COURSE_RELATION_SCHEMA_DISCOVERY",
      probeVersion: config.version,
      captureId,
      status: material ? "COURSE_SCHEMA_SAMPLED" : "COURSE_SCHEMA_NOT_CAPTURED",
      stopReason: code,
      requests,
      responseBytes: bytes,
      capturedResponses: records.length,
      inventoryLeafCount,
      observedRelationPathCount: observedPaths.length,
      relationRequests: 0,
      credentialFieldsRemoved: records.reduce(
        (count, record) => count + record.credentialFieldsRemoved,
        0,
      ),
      credentialUrlsRedacted: records.reduce(
        (count, record) => count + record.credentialUrlsRedacted,
        0,
      ),
      elapsedMs: Math.max(0, Date.now() - began),
      failures: [...failures],
      automaticDownloadAttempts: records.length > 0 ? 1 : 0,
      wholeCourseVerified: false,
    };
    state.summary = summary;
    state.result = {
      ...summary,
      courseId,
      capturedAt: new Date(began).toISOString(),
      limits,
      bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
      originalResponseBytesRetained: false,
      credentialSanitization:
        "NORMALIZED_EXACT_CREDENTIAL_FIELD_AND_URL_PARAMETER_DENYLIST",
      records: [...records],
      observedRelationPaths: observedPaths,
    };
    output.value = JSON.stringify(summary, null, 2);
    output.hidden = false;
    copyButton.disabled = false;
    downloadButton.disabled = records.length === 0;
    stopButton.textContent = "Close check";
    status.textContent = material
      ? "Course data saved. Your diagnostic download was requested. Use Download course data check if it did not appear. No quizzes were opened."
      : "Check stopped: " +
        code +
        ". Copy the summary; no full-course rerun is needed.";
    if (records.length > 0 && automaticDownloadAttempts === 0) {
      automaticDownloadAttempts++;
      downloadDiagnostic();
    }
  }
  function leaving() {
    finish("PAGE_CLOSED_OR_RELOADED");
  }
  state.stop = (reason = "OPERATOR_STOPPED") =>
    finish(/^[A-Z_]{1,80}$/.test(reason) ? reason : "OPERATOR_STOPPED");
  stopButton.onclick = () => {
    if (finished) root.remove();
    else finish("OPERATOR_STOPPED");
  };
  copyButton.onclick = async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      copyButton.textContent = "Copied";
    } catch {
      output.focus();
      output.select();
      copyButton.textContent = "Select and copy the summary below";
    }
  };
  function downloadDiagnostic() {
    if (!finished || !records.length) return;
    try {
      const blob = new Blob([JSON.stringify(state.result, null, 2)], {
        type: "application/json",
      });
      const objectUrl = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = objectUrl;
      link.download =
        "CTI_Coursera_Course_Data_Check_" +
        courseId +
        "_" +
        captureId +
        ".json";
      link.style.display = "none";
      panel.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch {
      status.textContent =
        "Course data is saved locally. Use Download course data check to try the diagnostic download again.";
    }
  }
  downloadButton.onclick = () => downloadDiagnostic();
  function current() {
    if (finished) return false;
    if (!inCourse()) {
      finish("LEFT_EXPECTED_COURSE");
      return false;
    }
    if (Date.now() >= deadline) {
      finish("COURSE_DATA_CHECK_DEADLINE");
      return false;
    }
    return true;
  }
  async function read(resource: string, path: string) {
    if (!current() || requests >= limits.requests) return;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(limits.requestMs, deadline - Date.now()),
    );
    requests++;
    render();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
      requestBytes = 0;
    const failure = (code: string, statusCode = 0) =>
      failures.push({ resource, status: statusCode, code });
    try {
      const requested = new URL(path, address.origin);
      const response = await window.fetch(requested.href, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json, text/plain, */*" },
        signal: controller.signal,
        redirect: "error",
      });
      if (!current()) return;
      if (
        response.url &&
        (new URL(response.url).origin !== requested.origin ||
          new URL(response.url).pathname !== requested.pathname)
      ) {
        failure("UNEXPECTED_RESPONSE_ROUTE");
        return;
      }
      if (!response.ok) {
        failure("HTTP_" + response.status, response.status);
        return;
      }
      if (
        !/^application\/(?:[A-Za-z0-9.+-]*\+)?json\b/i.test(
          response.headers.get("content-type") || "",
        )
      ) {
        failure("NON_JSON_RESPONSE", response.status);
        return;
      }
      if (Number(response.headers.get("content-length")) > limits.bodyBytes) {
        failure("BODY_BYTE_LIMIT");
        return;
      }
      if (!response.body) {
        failure("BODY_UNAVAILABLE");
        return;
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder(),
        pieces: string[] = [],
        originalChunks: Uint8Array[] = [];
      while (true) {
        const chunk = await reader.read();
        if (!current()) return;
        if (chunk.done) break;
        const length = chunk.value.byteLength;
        if (requestBytes + length > limits.bodyBytes) {
          failure("BODY_BYTE_LIMIT");
          return;
        }
        if (bytes + length > limits.totalBytes) {
          failure("TOTAL_BYTE_LIMIT");
          finish("TOTAL_BYTE_LIMIT");
          return;
        }
        requestBytes += length;
        bytes += length;
        originalChunks.push(chunk.value);
        pieces.push(decoder.decode(chunk.value, { stream: true }));
      }
      pieces.push(decoder.decode());
      const originalText = pieces.join("");
      let model: any;
      try {
        model = JSON.parse(originalText);
      } catch {
        failure("INVALID_JSON");
        return;
      }
      const declared = [
        model?.courseId,
        model?.branchId,
        ...(Array.isArray(model?.elements)
          ? model.elements
              .slice(0, 20)
              .flatMap((element: any) => [element?.courseId, element?.branchId])
          : []),
      ].filter((value) => typeof value === "string" && value);
      const cleaned = sanitize(model);
      if (cleaned.limitReached) {
        failure("MODEL_SANITIZATION_LIMIT");
        return;
      }
      const originalBytes = new Uint8Array(requestBytes);
      let byteOffset = 0;
      for (const chunk of originalChunks) {
        originalBytes.set(chunk, byteOffset);
        byteOffset += chunk.byteLength;
      }
      const digest = await crypto.subtle.digest("SHA-256", originalBytes);
      if (!current()) return;
      records.push({
        resource,
        requestPath: requested.pathname,
        requestScope: "EXACT_COURSE_RESOURCE_GET",
        status: response.status,
        observedAt: new Date().toISOString(),
        responseBytes: requestBytes,
        declaredIdentityFields: {
          present: declared.length > 0,
          routeValueAgreement:
            declared.length > 0
              ? declared.every((value) => value === courseId)
              : null,
          identitySemantics: "COURSE_VERSUS_BRANCH_MEANING_NOT_CERTIFIED",
        },
        originalResponseSha256: [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(""),
        credentialFieldsRemoved: cleaned.removedFields,
        credentialUrlsRedacted: cleaned.redactedUrls,
        bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
        data: cleaned.data,
      });
      if (resource === "authoringCourseMaterials.v1") {
        const ids = new Set<string>();
        let count = 0;
        function leaves(entry: any) {
          if (!entry || ++count > 100000) return;
          if (Array.isArray(entry)) {
            entry.forEach(leaves);
            return;
          }
          if (typeof entry !== "object") return;
          if (
            (entry.originalName || entry.name || entry.title) &&
            typeof entry.id === "string" &&
            (!Array.isArray(entry.elements) || entry.elements.length === 0) &&
            (entry.content || entry.typeName || entry.itemTypeLabel)
          )
            ids.add(entry.id);
          for (const [key, child] of Object.entries(entry))
            if (
              key === "elements" ||
              /^(?:material|modules?|lessons?|tracks?|sections?|weeks?)$/i.test(
                key,
              )
            )
              leaves(child);
        }
        leaves(cleaned.data);
        inventoryLeafCount = ids.size;
      }
      render();
    } catch {
      if (!finished)
        failure(
          controller.signal.aborted
            ? "REQUEST_TIMEOUT_OR_ABORTED"
            : "REQUEST_FAILED",
        );
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
      controller.abort();
      // Do not await cancellation: a custom/tee stream may keep it pending.
      void reader?.cancel().catch(() => {});
    }
  }
  window.addEventListener("pagehide", leaving);
  timer = setTimeout(
    () => finish("COURSE_DATA_CHECK_DEADLINE"),
    limits.durationMs,
  );
  render();
  try {
    await Promise.allSettled([
      read(
        "authoringCourseMaterials.v1",
        "/api/authoringCourseMaterials.v1/" +
          encodeURIComponent(courseId) +
          "/?fields=material,conflictMetadata,authoringAtomRelations.v1(embeddedContentSourceCourseId)&includes=embeddedContentMapping",
      ),
      read(
        "authoringCourses.v2",
        "/api/authoringCourses.v2/" + encodeURIComponent(courseId),
      ),
    ]);
    if (current()) finish("COURSE_DATA_CHECK_FINISHED");
  } catch {
    finish("COURSE_DATA_CHECK_FAILED");
  }
}
