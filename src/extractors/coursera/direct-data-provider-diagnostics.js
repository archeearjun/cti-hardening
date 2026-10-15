/** Diagnostic only: a missing event cannot distinguish CORS from network failure.
 * Retain no policy strings, browser errors, document URLs or blocked URL queries. */
export function createDirectProviderDiagnosticsV1(requestUrl, policyDocument = globalThis.document) {
  let request;
  try {request = new URL(requestUrl);} catch (_) {}
  const began = typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : null;
  let closed = false, available = false, outcome = "UNKNOWN", httpStatus = 0, enforcedCsp = null, relatedEnforcedCsp = null;
  function snapshot() {
    return {schemaVersion: 1, outcome, policyEventsAvailable: available,
      enforcedCsp: enforcedCsp ? {...enforcedCsp} : null,
      relatedEnforcedCsp: relatedEnforcedCsp ? {...relatedEnforcedCsp} : null, httpStatus};
  }
  function finish(value) {
    if (closed) return snapshot();
    if (["TIMEOUT", "ABORTED"].includes(value)) outcome = value;
    else if (!["TIMEOUT", "ABORTED"].includes(outcome))
      outcome = httpStatus ? "HTTP_OBSERVED" : enforcedCsp ? "ENFORCED_CSP"
        : relatedEnforcedCsp ? "CSP_REPORTED_FOR_ORIGIN"
        : value === "CORS_OR_NETWORK" ? value : "UNKNOWN";
    return snapshot();
  }
  function recordHttp(status) {
    if (!closed && Number.isSafeInteger(status) && status >= 100 && status <= 599) {
      httpStatus = status;finish("HTTP_OBSERVED");
    }
  }
  function policyViolation(event) {
    if (closed || !request || event?.disposition !== "enforce" ||
        !["connect-src", "default-src"].includes(event.effectiveDirective) ||
        typeof event.blockedURI !== "string" || event.blockedURI.length > 16384 ||
        (began !== null && Number.isFinite(event.timeStamp) && event.timeStamp < began)) return;
    try {
      const blocked = new URL(event.blockedURI);
      if (blocked.origin !== request.origin || blocked.username || blocked.password) return;
      if (blocked.pathname === request.pathname)
        enforcedCsp = {effectiveDirective: event.effectiveDirective, disposition: "enforce"};
      else if (blocked.pathname === "/" && !blocked.search && !blocked.hash)
        relatedEnforcedCsp = {effectiveDirective: event.effectiveDirective, disposition: "enforce", requestMatch: "ORIGIN_ONLY"};
      else return;
      finish(outcome);
    } catch (_) {}
  }
  if (request && typeof policyDocument?.addEventListener === "function" &&
      typeof policyDocument?.removeEventListener === "function") {
    try {policyDocument.addEventListener("securitypolicyviolation", policyViolation);available = true;}
    catch (_) {}
  }
  function close() {
    if (closed) return;
    closed = true;
    if (available) {
      try {policyDocument.removeEventListener("securitypolicyviolation", policyViolation);} catch (_) {}
    }
  }
  return {snapshot, recordHttp, finish, close};
}
