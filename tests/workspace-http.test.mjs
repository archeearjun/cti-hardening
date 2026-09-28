import test from "node:test";
import assert from "node:assert/strict";
import { workspaceRequest } from "../src/domain/workspace-http.ts";

const path = "uploads/synthetic/chunks/0";
function mockFetch(t, fn) {
  const prior = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = prior;
  });
}

test("non-JSON failures preserve status and Ray ID without exposing page contents or retrying permission/conflict errors", async (t) => {
  let calls = 0,
    status = 403;
  mockFetch(t, async () => {
    calls++;
    return new Response("<html>private login page</html>", {
      status,
      headers: { "cf-ray": "1234-test" },
    });
  });
  for (status of [403, 409, 413]) {
    await assert.rejects(
      workspaceRequest(path, { method: "PUT" }),
      (e) =>
        e.status === status &&
        e.message.includes(`HTTP ${status}`) &&
        e.message.includes("1234-test") &&
        !e.message.includes("private login page"),
    );
  }
  assert.equal(calls, 3);
});

test("creation and commit POSTs are never automatically repeated after a network or gateway failure", async (t) => {
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    workspaceRequest("uploads", { method: "POST", body: "{}" }),
    /not automatically repeated/,
  );
  globalThis.fetch = async () => {
    calls++;
    return new Response("gateway", { status: 502 });
  };
  await assert.rejects(
    workspaceRequest("uploads/id/commit", { method: "POST", body: "{}" }),
    /HTTP 502.*not automatically repeated/,
  );
  assert.equal(calls, 2);
});

test("a long Retry-After stops instead of retrying early", async (t) => {
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    return new Response("rate limit", {
      status: 429,
      headers: { "Retry-After": "120" },
    });
  });
  await assert.rejects(
    workspaceRequest(path, { method: "PUT" }),
    /HTTP 429.*wait 120 seconds/,
  );
  assert.equal(calls, 1);
});

test("temporary gateway errors stop after three attempts", async (t) => {
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    return new Response("gateway", { status: 502 });
  });
  await assert.rejects(workspaceRequest(path, { method: "PUT" }), /HTTP 502/);
  assert.equal(calls, 3);
});

test("Stop interrupts retry backoff without another request", async (t) => {
  let calls = 0;
  const controller = new AbortController();
  mockFetch(t, async () => {
    calls++;
    throw new TypeError("offline");
  });
  await assert.rejects(
    workspaceRequest(
      path,
      { method: "PUT" },
      {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      },
    ),
    /stopped by you/,
  );
  assert.equal(calls, 1);
});

test("HTML success pages and authentication redirects are not accepted as saved evidence", async (t) => {
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    const response = new Response("<html>Sign in</html>");
    if (calls === 2)
      Object.defineProperty(response, "redirected", { value: true });
    return response;
  });
  await assert.rejects(
    workspaceRequest(path, { method: "PUT" }),
    /HTTP 200.*non-JSON/,
  );
  await assert.rejects(
    workspaceRequest(path, { method: "PUT" }),
    /redirected.*sign in/,
  );
  assert.equal(calls, 2);
});
