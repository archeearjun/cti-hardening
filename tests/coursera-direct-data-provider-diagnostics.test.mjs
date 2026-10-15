import test from "node:test";
import assert from "node:assert/strict";
import { createDirectProviderDiagnosticsV1 } from "../src/extractors/coursera/direct-data-provider-diagnostics.js";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";

const origin = "https://fixture.hosted.panopto.com";
const endpoint = origin + "/Panopto/Pages/Viewer/DeliveryInfo.aspx";
const secret = "SYNTHETIC_PRIVATE_DIAGNOSTIC_DETAIL";

class PolicyDocument extends EventTarget {
  listeners = new Set();
  addEventListener(type, listener, options) {
    assert.equal(type, "securitypolicyviolation");
    this.listeners.add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  emit(changes = {}) {
    const event = new Event("securitypolicyviolation");
    const fields = {
      effectiveDirective: "connect-src",
      violatedDirective: "connect-src " + secret,
      disposition: "enforce",
      blockedURI: endpoint + "?token=" + secret,
      originalPolicy: "connect-src 'self' " + secret,
      documentURI: "https://www.coursera.org/private/" + secret,
      sourceFile: "https://www.coursera.org/private-script/" + secret,
      sample: secret,
      ...changes,
    };
    for (const [key, value] of Object.entries(fields))
      Object.defineProperty(event, key, { value });
    this.dispatchEvent(event);
  }
}

function expected(outcome, changes = {}) {
  return {
    schemaVersion: 1,
    outcome,
    policyEventsAvailable: true,
    enforcedCsp: null,
    relatedEnforcedCsp: null,
    httpStatus: 0,
    ...changes,
  };
}
function assertPrivate(value) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes(secret));
  assert(!serialized.includes(endpoint));
  assert(!serialized.includes("originalPolicy"));
  assert(!serialized.includes("blockedURI"));
  assert(!serialized.includes("documentURI"));
}
function nativeFixture() {
  const f = panoptoDeliveryFixture();
  f.targetUrl = f.targetUrl.replace(
    "video.example.test",
    "fixture.hosted.panopto.com",
  );
  f.model.EmbedUrl = f.model.EmbedUrl.replace(
    "video.example.test",
    "fixture.hosted.panopto.com",
  );
  return f;
}
function reader(policyDocument, fetchImpl, options = {}) {
  return createDirectDataReaderV1({
    policyDocument,
    fetchImpl,
    sanitize: sanitizeCourseraCourseDataModel,
    ...options,
  });
}

test("exact enforced connect/default policy events classify only the active endpoint without retaining source details", () => {
  for (const effectiveDirective of ["connect-src", "default-src"]) {
    const document = new PolicyDocument();
    const diagnostics = createDirectProviderDiagnosticsV1(
      endpoint + "?request=" + secret,
      document,
    );
    assert.deepEqual(diagnostics.snapshot(), expected("UNKNOWN"));
    assert.equal(document.listeners.size, 1);
    document.emit({ effectiveDirective });
    diagnostics.finish("CORS_OR_NETWORK");
    assert.deepEqual(
      diagnostics.snapshot(),
      expected("ENFORCED_CSP", {
        enforcedCsp: { effectiveDirective, disposition: "enforce" },
      }),
    );
    assertPrivate(diagnostics.snapshot());
    diagnostics.close();
    assert.equal(document.listeners.size, 0);
  }
});

test("report-only, unrelated paths, origins, old events and directives cannot identify a request block", () => {
  for (const changes of [
    { disposition: "report" },
    { blockedURI: origin, disposition: "report" },
    { blockedURI: origin + "?token=" + secret },
    { blockedURI: origin + "/another-endpoint?token=" + secret },
    {
      blockedURI: endpoint.replace(
        "fixture.hosted.panopto.com",
        "other.hosted.panopto.com",
      ),
    },
    { effectiveDirective: "img-src" },
    { effectiveDirective: "script-src" },
    { blockedURI: "inline" },
    { blockedURI: "" },
    { timeStamp: 0 },
  ]) {
    const document = new PolicyDocument();
    const diagnostics = createDirectProviderDiagnosticsV1(endpoint, document);
    document.emit(changes);
    diagnostics.finish("CORS_OR_NETWORK");
    assert.deepEqual(diagnostics.snapshot(), expected("CORS_OR_NETWORK"));
    assertPrivate(diagnostics.snapshot());
    diagnostics.close();
    assert.equal(document.listeners.size, 0);
  }
});

test("origin-only enforced policy reports remain distinct from exact endpoint attribution", () => {
  const document = new PolicyDocument();
  const diagnostics = createDirectProviderDiagnosticsV1(endpoint, document);
  document.emit({ blockedURI: origin });
  diagnostics.finish("CORS_OR_NETWORK");
  assert.deepEqual(
    diagnostics.snapshot(),
    expected("CSP_REPORTED_FOR_ORIGIN", {
      relatedEnforcedCsp: {
        effectiveDirective: "connect-src",
        disposition: "enforce",
        requestMatch: "ORIGIN_ONLY",
      },
    }),
  );
  assert.equal(diagnostics.snapshot().enforcedCsp, null);
  assertPrivate(diagnostics.snapshot());
  document.emit();
  assert.equal(diagnostics.snapshot().outcome, "ENFORCED_CSP");
  assert.equal(
    diagnostics.snapshot().enforcedCsp.effectiveDirective,
    "connect-src",
  );
  diagnostics.close();
  assert.equal(document.listeners.size, 0);
});

test("HTTP observations and unavailable browser events retain bounded diagnostic facts", () => {
  const document = new PolicyDocument();
  const diagnostics = createDirectProviderDiagnosticsV1(endpoint, document);
  diagnostics.recordHttp(401);
  diagnostics.finish("HTTP_OBSERVED");
  assert.deepEqual(
    diagnostics.snapshot(),
    expected("HTTP_OBSERVED", { httpStatus: 401 }),
  );
  diagnostics.close();
  assert.equal(document.listeners.size, 0);
  for (const unavailable of [
    null,
    {},
    {
      addEventListener() {
        throw Error(secret);
      },
      removeEventListener() {},
    },
  ]) {
    const absent = createDirectProviderDiagnosticsV1(endpoint, unavailable);
    absent.finish("CORS_OR_NETWORK");
    assert.deepEqual(
      absent.snapshot(),
      expected("CORS_OR_NETWORK", { policyEventsAvailable: false }),
    );
    assertPrivate(absent.snapshot());
    absent.close();
  }
});

test("snapshots are detached and closing the observer prevents late policy attribution", () => {
  const document = new PolicyDocument();
  const diagnostics = createDirectProviderDiagnosticsV1(endpoint, document);
  document.emit();
  const saved = diagnostics.snapshot();
  saved.outcome = "TAMPERED";
  saved.enforcedCsp.effectiveDirective = "img-src";
  assert.equal(
    diagnostics.snapshot().enforcedCsp.effectiveDirective,
    "connect-src",
  );
  diagnostics.close();
  diagnostics.close();
  assert.equal(document.listeners.size, 0);
  const closed = createDirectProviderDiagnosticsV1(endpoint, document);
  closed.finish("CORS_OR_NETWORK");
  closed.close();
  document.emit();
  assert.deepEqual(closed.snapshot(), expected("CORS_OR_NETWORK"));
  assert.equal(document.listeners.size, 0);
});

test("reader receipts distinguish observed HTTP, enforced CSP and ambiguous network failures without changing reasons", async () => {
  const f = nativeFixture();
  for (const mode of ["HTTP", "CSP", "CSP_ASYNC", "ORIGIN", "NETWORK"]) {
    const document = new PolicyDocument();
    const api = reader(document, async () => {
      assert.equal(document.listeners.size, 1);
      if (mode === "HTTP") return new Response(null, { status: 401 });
      if (mode === "CSP") document.emit();
      if (mode === "CSP_ASYNC") setTimeout(() => document.emit(), 0);
      if (mode === "ORIGIN") document.emit({ blockedURI: origin });
      throw new TypeError(secret);
    });
    const result = await api.readPanoptoDeliveryInfo(f.targetUrl);
    assert.equal(result.ok, false);
    assert.equal(
      result.reason,
      mode === "HTTP" ? "PANOPTO_HTTP_401" : "PANOPTO_ACCESS_BLOCKED_OR_FAILED",
    );
    const diagnostic = result.receipt.diagnostics;
    assert.deepEqual(
      diagnostic,
      mode === "HTTP"
        ? expected("HTTP_OBSERVED", { httpStatus: 401 })
        : mode.startsWith("CSP")
          ? expected("ENFORCED_CSP", {
              enforcedCsp: {
                effectiveDirective: "connect-src",
                disposition: "enforce",
              },
            })
          : mode === "ORIGIN"
            ? expected("CSP_REPORTED_FOR_ORIGIN", {
                relatedEnforcedCsp: {
                  effectiveDirective: "connect-src",
                  disposition: "enforce",
                  requestMatch: "ORIGIN_ONLY",
                },
              })
            : expected("CORS_OR_NETWORK"),
    );
    assertPrivate(diagnostic);
    assert.equal(document.listeners.size, 0);
    const before = structuredClone(diagnostic);
    document.emit();
    assert.deepEqual(result.receipt.diagnostics, before);
    assert.equal(api.snapshot().stopped, false);
  }
});

test("successful metadata closes its observer and records HTTP without treating a late event as a block", async () => {
  const f = nativeFixture(),
    document = new PolicyDocument();
  const api = reader(
    document,
    async () =>
      new Response(JSON.stringify(f.model), {
        headers: { "content-type": "application/json" },
      }),
  );
  const result = await api.readPanoptoDeliveryInfo(f.targetUrl);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.receipt.diagnostics,
    expected("HTTP_OBSERVED", { httpStatus: 200 }),
  );
  assert.equal(document.listeners.size, 0);
  document.emit();
  assert.deepEqual(
    result.receipt.diagnostics,
    expected("HTTP_OBSERVED", { httpStatus: 200 }),
  );
  assertPrivate(result.receipt.diagnostics);
});

test(
  "timeout and operator abort close observers even when the underlying fetch ignores its signal",
  { timeout: 2000 },
  async () => {
    const f = nativeFixture();
    for (const mode of ["FETCH_TIMEOUT", "BODY_TIMEOUT", "ABORTED"]) {
      const document = new PolicyDocument();
      let started;
      const ready = new Promise((resolve) => {
        started = resolve;
      });
      const api = reader(
        document,
        () => {
          started();
          if (mode === "BODY_TIMEOUT")
            return Promise.resolve(
              new Response(new ReadableStream(), {
                headers: { "content-type": "application/json" },
              }),
            );
          return new Promise(() => {});
        },
        { limits: { requestMs: 20 } },
      );
      const pending = api.readPanoptoDeliveryInfo(f.targetUrl);
      await ready;
      if (mode === "ABORTED") api.abort("OPERATOR_STOPPED");
      const result = await pending;
      assert.equal(
        result.reason,
        mode === "ABORTED" ? "OPERATOR_STOPPED" : "PANOPTO_REQUEST_TIMEOUT",
      );
      assert.deepEqual(
        result.receipt.diagnostics,
        expected(mode === "ABORTED" ? "ABORTED" : "TIMEOUT", {
          httpStatus: mode === "BODY_TIMEOUT" ? 200 : 0,
        }),
      );
      assert.equal(document.listeners.size, 0);
      assertPrivate(result.receipt.diagnostics);
      const before = structuredClone(result.receipt.diagnostics);
      document.emit();
      assert.deepEqual(result.receipt.diagnostics, before);
    }
  },
);
