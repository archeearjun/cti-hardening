import test from "node:test";
import assert from "node:assert/strict";
import { createApiHandler } from "../server/api.ts";
import { CTI_OWNER_EMAIL } from "../server/access.ts";
import {
  forwardWorkspaceApi,
  workspaceRuntimeCaller,
  workspaceRuntimeApiRequest,
  WORKSPACE_SERVICE_ORIGIN,
  WORKSPACE_RUNTIME_ORIGIN,
  isDelegatedApiPath,
  isPanoptoApiPath,
} from "../server/workspace-runtime.ts";

const origin = "https://cti.example.test";
const owner = { email: CTI_OWNER_EMAIL, role: "editor" };

test("Pages forwards workspace bytes through the private runtime after identity and origin checks", async () => {
  const bytes = new TextEncoder().encode("original evidence\r\n<literal>"),
    calls = [];
  const service = {
    async fetch(request) {
      calls.push(request);
      assert.deepEqual(workspaceRuntimeCaller(request), owner);
      assert.equal(request.headers.get("Cookie"), null);
      assert.equal(request.headers.get("Authorization"), null);
      assert.equal(request.headers.get("Cf-Access-Jwt-Assertion"), null);
      const api = workspaceRuntimeApiRequest(request);
      assert.equal(
        api.url,
        `${WORKSPACE_RUNTIME_ORIGIN}/api/uploads/exact/chunks/0?revision=original`,
      );
      assert.equal(api.headers.get("Origin"), WORKSPACE_RUNTIME_ORIGIN);
      assert.deepEqual(new Uint8Array(await api.arrayBuffer()), bytes);
      return Response.json({ success: true });
    },
  };
  const request = () =>
    new Request(`${origin}/api/uploads/exact/chunks/0?revision=original`, {
      method: "PUT",
      body: bytes,
      headers: {
        Origin: origin,
        Cookie: "not-forwarded",
        Authorization: "not-forwarded",
        "Cf-Access-Jwt-Assertion": "not-forwarded",
        "x-cti-user": "forged@example.test",
        "x-cti-role": "admin",
        "Content-Type": "application/octet-stream",
      },
    });
  assert.equal(
    (await forwardWorkspaceApi(request(), owner, service)).status,
    200,
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    forwardWorkspaceApi(request(), { ...owner, role: "viewer" }, service),
    { status: 403 },
  );
  await assert.rejects(
    forwardWorkspaceApi(
      request(),
      { ...owner, email: "other@example.test" },
      service,
    ),
    { status: 403 },
  );
  const crossOrigin = request();
  crossOrigin.headers.set("Origin", "https://other.example.test");
  await assert.rejects(forwardWorkspaceApi(crossOrigin, owner, service), {
    status: 403,
  });
  assert.equal(
    calls.length,
    1,
    "rejected requests never reach private runtime",
  );
});

test("private runtime rejects public URLs, missing delegation, foreign owners, invalid roles and write origins", () => {
  const valid = () =>
    new Request(`${WORKSPACE_SERVICE_ORIGIN}/workspace/api/uploads`, {
      method: "POST",
      body: "{}",
      headers: {
        Origin: WORKSPACE_SERVICE_ORIGIN,
        "x-cti-workspace-runtime": "v1",
        "x-cti-user": CTI_OWNER_EMAIL,
        "x-cti-role": "editor",
      },
    });
  assert.deepEqual(workspaceRuntimeCaller(valid()), owner);
  for (const [field, value, status] of [
    ["x-cti-workspace-runtime", "", 401],
    ["x-cti-user", "other@example.test", 403],
    ["x-cti-role", "untrusted", 401],
    ["x-cti-role", "viewer", 403],
    ["Origin", origin, 403],
  ]) {
    const changed = valid();
    changed.headers.set(field, value);
    assert.throws(() => workspaceRuntimeCaller(changed), { status });
  }
  assert.throws(
    () =>
      workspaceRuntimeCaller(
        new Request(`${origin}/workspace/api/records`, {
          headers: {
            "x-cti-workspace-runtime": "v1",
            "x-cti-user": CTI_OWNER_EMAIL,
            "x-cti-role": "editor",
          },
        }),
      ),
    { status: 404 },
  );
});

test("only exact provider routes delegate and their public receipt origin is derived by Pages", async () => {
  const path="/api/provider/panopto/podcast",body='{"targetUrl":"native","streamFileId":"exact","sourceHash":"bound"}';
  for (const invalid of [path+"/",path+"/extra","/api/provider/panopto/other","/api/provider/other/podcast"])
    assert.equal(isDelegatedApiPath(invalid),false);
  assert.equal(isPanoptoApiPath(path),true);
  let calls=0;
  const service={fetch:async delegated=>{
    calls++;
    assert.deepEqual(workspaceRuntimeCaller(delegated),owner);
    assert.equal(delegated.headers.get("x-cti-public-origin"),origin);
    assert.equal(delegated.headers.get("Cookie"),null);
    const api=workspaceRuntimeApiRequest(delegated);
    assert.equal(api.url,origin+path);assert.equal(api.headers.get("Origin"),origin);
    assert.equal(api.headers.get("x-cti-public-origin"),null);
    assert.equal(await api.text(),body);
    return new Response("synthetic-original-body",{headers:{"X-CTI-Provider-Origin":new URL(api.url).origin}});
  }};
  const request=()=>new Request(origin+path,{method:"POST",headers:{Origin:origin,Cookie:"never-forward",
    "x-cti-public-origin":"https://forged.example.test"},body});
  const result=await forwardWorkspaceApi(request(),owner,service);
  assert.equal(result.headers.get("X-CTI-Provider-Origin"),origin);
  assert.equal(await result.text(),"synthetic-original-body");
  await assert.rejects(forwardWorkspaceApi(new Request(origin+path),owner,service),{status:405});
  await assert.rejects(forwardWorkspaceApi(request(),{...owner,role:"viewer"},service),{status:403});
  assert.equal(calls,1);
});

test("private provider reconstruction rejects missing or non-origin public values",()=>{
  const make=value=>new Request(WORKSPACE_SERVICE_ORIGIN+"/workspace/api/provider/panopto/metadata",{
    method:"POST",body:"{}",headers:{Origin:WORKSPACE_SERVICE_ORIGIN,"x-cti-workspace-runtime":"v1",
      "x-cti-user":owner.email,"x-cti-role":owner.role,...(value===null?{}:{"x-cti-public-origin":value})}});
  assert.equal(workspaceRuntimeApiRequest(make(origin)).url,origin+"/api/provider/panopto/metadata");
  for(const invalid of [null,"",origin+"/",origin+"/path",origin+"?query=1",origin+"#fragment",
    "https://user:password@cti.example.test","javascript:alert(1)","file:///tmp/source"])
    assert.throws(()=>workspaceRuntimeApiRequest(make(invalid)),{status:403});
});

test("Pages delegates provider bodies without parsing them or reading D1",async()=>{
  let delegated=0,providerFetch=0;
  const api=createApiHandler(async()=>({email:owner.email}),async()=>{providerFetch++;throw Error("Provider computation must not execute in Pages");});
  const env={CTI_EDITORS:owner.email,CTI_EXTRACTOR:{fetch:async request=>{
    delegated++;assert.equal(workspaceRuntimeApiRequest(request).url,origin+"/api/provider/panopto/metadata");
    assert.equal(await request.text(),"intentionally-not-json");return Response.json({delegated:true});
  }}};
  const request=()=>new Request(origin+"/api/provider/panopto/metadata",{method:"POST",headers:{Origin:origin},body:"intentionally-not-json"});
  assert.equal((await api(request(),env)).status,200);assert.equal(delegated,1);assert.equal(providerFetch,0);
  const unavailable=await api(request(),{...env,CTI_EXTRACTOR:undefined});
  assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).error,"PANOPTO_PROVIDER_RUNTIME_UNAVAILABLE");
  assert.equal(providerFetch,0,'Missing private binding never falls back to CPU-heavy Pages reads');
});

test("authenticated Pages record routes never execute heavy D1 validation in the 10 ms frontdoor", async () => {
  const forwarded = [];
  const api = createApiHandler(async () => ({ email: CTI_OWNER_EMAIL }));
  const env = {
    CTI_ADMINS: CTI_OWNER_EMAIL,
    CTI_DB: {
      prepare() {
        throw Error("Pages must not read complete workspace evidence");
      },
    },
    CTI_EXTRACTOR: {
      async fetch(request) {
        forwarded.push(request.url);
        assert.equal(workspaceRuntimeCaller(request).role, "admin");
        return Response.json({ delegated: true });
      },
    },
  };
  for (const [path, method] of [
    ["records", "GET"],
    ["records/report/chunks/0?revision=exact", "GET"],
    ["uploads", "POST"],
    ["uploads/id/chunks/0", "PUT"],
    ["uploads/id/commit", "POST"],
  ]) {
    const response = await api(
      new Request(`${origin}/api/${path}`, {
        method,
        headers: { Origin: origin },
        ...(["GET", "HEAD"].includes(method) ? {} : { body: "{}" }),
      }),
      env,
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { delegated: true });
  }
  assert.equal(forwarded.length, 5);
  const missing = await api(new Request(`${origin}/api/records`), {
    ...env,
    CTI_EXTRACTOR: undefined,
  });
  assert.equal(missing.status, 503);
  assert.match(
    await missing.text(),
    /durable shared workspace runtime is not configured/,
  );
  assert.equal(
    (await api(new Request(`${origin}/api/session`), env)).status,
    200,
  );
  assert.equal(
    forwarded.length,
    5,
    "the lightweight session path stays in Pages",
  );
});
