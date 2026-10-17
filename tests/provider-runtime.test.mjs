import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as bridge from "../server/workspace-runtime.ts";
import { panoptoProviderErrorResponse } from "../server/panopto-provider.ts";
import { CTI_OWNER_EMAIL } from "../server/access.ts";

const origin="https://cti-hardening.pages.dev";
const compiled=ts.transpileModule(fs.readFileSync("workers/coursera-extractor/workspace-runtime.ts","utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;

// Exercise the production class and its stream callbacks. The base-class shim
// supplies only env; native Durable Object/D1 and provider fetch behavior have
// separate no-network workerd regressions, not an emulated CPU certification.
function fixture(handler,env={}) {
  const exports={};
  const bindings={
    "cloudflare:workers":{DurableObject:class{constructor(context,environment){this.env=environment;}}},
    "../../server/api.ts":{handleAuthorized:handler},
    "../../server/panopto-provider.ts":{panoptoProviderErrorResponse},
    "../../server/workspace-runtime.ts":bridge,
  };
  vm.runInNewContext(compiled,{exports,require:name=>{
    assert(Object.hasOwn(bindings,name),"Unexpected runtime import: "+name);return bindings[name];
  },Request,Response,ReadableStream,URL,Error,Promise},{filename:"workspace-runtime.compiled.cjs"});
  return {...exports,object:new exports.WorkspaceRuntime({},env)};
}
function request(path="/api/provider/panopto/podcast",signal) {
  const provider=bridge.isPanoptoApiPath(path);
  return new Request(bridge.WORKSPACE_SERVICE_ORIGIN+bridge.WORKSPACE_RUNTIME_PREFIX+path,{
    method:provider?"POST":"GET",...(provider?{body:"{}"}:{}),signal,
    headers:{...(provider?{Origin:bridge.WORKSPACE_SERVICE_ORIGIN,"x-cti-public-origin":origin}:{}),
      "x-cti-workspace-runtime":"v1","x-cti-user":CTI_OWNER_EMAIL,"x-cti-role":"editor"},
  });
}

test("private frontdoor selects distinct provider and record object identities",async()=>{
  const names=[];
  const f=fixture(()=>{throw Error("The frontdoor must not execute providers");});
  const env={WORKSPACE_RUNTIME:{idFromName(name){names.push(name);return name;},get(name){return{
    fetch:async delegated=>{bridge.workspaceRuntimeCaller(delegated);return Response.json({name});},
  };}}};
  assert.equal((await f.forwardWorkspaceRuntime(request(),env)).status,200);
  assert.equal((await f.forwardWorkspaceRuntime(request("/api/records"),env)).status,200);
  assert.deepEqual(names,[f.PANOPTO_RUNTIME_OBJECT_NAME,f.WORKSPACE_RUNTIME_OBJECT_NAME]);
  assert.notEqual(names[0],names[1]);
});

test("provider computation runs without D1 and retains the original public receipt origin",async()=>{
  let calls=0;
  const f=fixture(async(api,db,user)=>{
    calls++;assert.equal(db,undefined);assert.equal(api.url,origin+"/api/provider/panopto/metadata");
    assert.equal(api.headers.get("Origin"),origin);assert.equal(user.email,CTI_OWNER_EMAIL);
    return new Response("literal native metadata",{headers:{"X-CTI-Provider-Origin":new URL(api.url).origin}});
  });
  const result=await f.object.fetch(request("/api/provider/panopto/metadata"));
  assert.equal(result.headers.get("X-CTI-Provider-Origin"),origin);
  assert.equal(await result.text(),"literal native metadata");assert.equal(calls,1);
  const missingDb=await f.object.fetch(request("/api/records"));
  assert.equal(missingDb.status,503);assert.equal(calls,1);
});

test("provider permits remain held after headers and release at EOF, cancellation and stream failure",async()=>{
  const controllers=[];
  const f=fixture(async()=>new Response(new ReadableStream({start(c){controllers.push(c);}}),{
    headers:{"Content-Type":"video/mp4","X-CTI-Upstream-Content-Length":"12"},
  }));
  const active=[];
  for(let i=0;i<f.PANOPTO_RUNTIME_MAX_STREAMS;i++) {
    const result=await f.object.fetch(request());assert.equal(result.status,200);active.push(result);
  }
  const busy=await f.object.fetch(request());
  assert.equal(busy.status,503);assert.equal((await busy.json()).error,"PANOPTO_PROVIDER_BUSY");
  await active.shift().body.cancel();
  const replacement=await f.object.fetch(request());assert.equal(replacement.status,200);active.push(replacement);

  controllers[1].close();assert.equal(await active.shift().text(),"");
  const afterEof=await f.object.fetch(request());assert.equal(afterEof.status,200);active.push(afterEof);

  controllers[2].error(Error("synthetic source failure"));
  await assert.rejects(active.shift().arrayBuffer(),/Provider transfer interrupted/);
  const afterError=await f.object.fetch(request());assert.equal(afterError.status,200);active.push(afterError);
  for(const result of active)await result.body.cancel();
});

test("request cancellation releases a streaming permit and providers bypass the workspace mutation queue",async()=>{
  let cancelled=0,workspaceCalls=0;
  const f=fixture(async api=>{
    if(new URL(api.url).pathname==="/api/records"){workspaceCalls++;return Response.json({records:[]});}
    return new Response(new ReadableStream({cancel(){cancelled++;}}));
  },{CTI_DB:{prepare(){throw Error("The unit handler should not access D1");}}});
  const controller=new AbortController();
  const aborted=await f.object.fetch(request(undefined,controller.signal));
  controller.abort();
  await assert.rejects(aborted.arrayBuffer(),/Provider transfer cancelled/);
  assert.equal(cancelled,1);
  const active=[];
  for(let i=0;i<f.PANOPTO_RUNTIME_MAX_STREAMS;i++)active.push(await f.object.fetch(request()));
  assert.equal((await f.object.fetch(request())).status,503);
  const records=await f.object.fetch(request("/api/records"));
  assert.equal(records.status,200);assert.equal(workspaceCalls,1);
  for(const result of active)await result.body.cancel();
});

test("upstream failure releases a provider permit while the consumer has not pulled",async()=>{
  const controllers=[];
  const f=fixture(async()=>new Response(new ReadableStream({start(controller){controllers.push(controller);}})));
  const active=[];
  for(let i=0;i<f.PANOPTO_RUNTIME_MAX_STREAMS;i++)active.push(await f.object.fetch(request()));
  assert.equal((await f.object.fetch(request())).status,503);
  controllers[0].error(Error("synthetic upstream timeout"));
  await new Promise(resolve=>setImmediate(resolve));
  const replacement=await f.object.fetch(request());
  assert.equal(replacement.status,200,'An already-failed paused response cannot keep its stream permit');
  await assert.rejects(active.shift().arrayBuffer(),/Provider transfer interrupted/);
  active.push(replacement);
  for(const response of active)await response.body.cancel();
});
