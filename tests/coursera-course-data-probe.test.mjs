import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import {
  createCourseraCourseDataProbeBookmark,
  createCourseraCourseDataProbeScript,
  sanitizeCourseraCourseDataModel,
} from "../src/domain/coursera-course-data-probe.ts";

const shell =
  "https://www.coursera.org/teach/synthetic/Data_probe_course_123/content/edit";
const courseId = "Data_probe_course_123";
const nativeUrl = URL;
function setup(url = shell) {
  const elements = [],
    calls = [],
    downloads = [],
    alerts = [],
    events = new Map(),
    blobs = [],
    watchdogs = new Map();
  let nextTimer = 100000;
  class FixtureUrl extends nativeUrl {
    static createObjectURL(blob) {
      blobs.push(blob);
      return "blob:synthetic-" + blobs.length;
    }
    static revokeObjectURL() {}
  }
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.style = {};
      this.children = [];
      this.attrs = {};
      this.disabled = false;
      elements.push(this);
    }
    setAttribute(key, value) {
      this.attrs[key] = value;
    }
    append(...nodes) {
      this.children.push(...nodes);
      for (const node of nodes) node.parent = this;
    }
    attachShadow() {
      this.shadow = new Element("shadow");
      return this.shadow;
    }
    remove() {
      this.removed = true;
    }
    focus() {
      this.focused = true;
    }
    select() {
      this.selected = true;
    }
    click() {
      if (this.tagName === "A")
        downloads.push({ href: this.href, name: this.download });
    }
  }
  const timer = (callback, ms) => {
    if (ms >= 20000) {
      const id = nextTimer++;
      watchdogs.set(id, { callback, ms });
      return id;
    }
    return setTimeout(callback, ms);
  };
  const clear = (id) => {
    if (watchdogs.has(id)) watchdogs.delete(id);
    else clearTimeout(id);
  };
  const window = {
    alert: (message) => alerts.push(message),
    addEventListener: (type, callback) => events.set(type, callback),
    removeEventListener: (type, callback) => {
      if (events.get(type) === callback) events.delete(type);
    },
    setTimeout: timer,
  };
  window.top = window;
  const location = new FixtureUrl(url),
    document = {
      createElement: (tag) => new Element(tag),
      getElementById: (id) =>
        elements.find((element) => element.id === id && !element.removed) ||
        null,
      documentElement: new Element("html"),
    };
  const context = vm.createContext({
    window,
    location,
    document,
    performance: { getEntriesByType: () => [] },
    crypto: webcrypto,
    navigator: {
      clipboard: {
        writeText: async (text) => {
          context.copied = text;
        },
      },
    },
    URL: FixtureUrl,
    Blob,
    Response,
    TextDecoder,
    TextEncoder,
    AbortController,
    Uint8Array,
    setTimeout: timer,
    clearTimeout: clear,
  });
  const material = {
    elements: [
      {
        id: courseId,
        material: {
          elements: [
            {
              id: "module-1",
              name: "Module",
              elements: [
                {
                  id: "item-1",
                  name: "Private quiz",
                  content: {
                    typeName: "staffGraded",
                    definition: {
                      assignmentId: "assignment-1",
                      unknownRelation: {
                        orderedGroupIds: [
                          "assignment-1~group-2",
                          "assignment-1~group-1",
                        ],
                        revision: 7,
                      },
                      prompt: "PRIVATE_QUESTION_TEXT",
                      writeAccessToken: "PRIVATE_WRITE_TOKEN",
                    },
                  },
                  elements: [],
                },
                {
                  id: "item-2",
                  name: "Private reading",
                  content: {
                    typeName: "supplement",
                    definition: { atomId: "atom-2" },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
    paging: {},
    linked: {
      "unknownRelation.v1": [
        {
          id: "relation-1",
          referencedBy: "item-1",
          Credentials: { password: "PRIVATE_PASSWORD" },
          futureField: { retained: true },
        },
      ],
    },
  };
  const respond = (body, requested, options = {}) => {
    const response = new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      {
        status: options.status || 200,
        headers: {
          "content-type": options.type || "application/json",
          ...options.headers,
        },
      },
    );
    Object.defineProperty(response, "url", {
      value: options.responseUrl || String(requested),
    });
    return response;
  };
  window.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return respond(
      String(input).includes("authoringCourseMaterials")
        ? material
        : {
            elements: [
              {
                id: location.pathname.split("/")[3],
                name: "PRIVATE_COURSE_TITLE",
              },
            ],
          },
      input,
    );
  };
  return {
    context,
    window,
    elements,
    calls,
    downloads,
    alerts,
    events,
    blobs,
    watchdogs,
    material,
    respond,
  };
}
async function run(f, script = createCourseraCourseDataProbeScript()) {
  vm.runInContext(script, f.context);
  const deadline = Date.now() + 5000;
  while (
    f.window.__CTI_COURSERA_COURSE_DATA_PROBE?.running &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(
    f.window.__CTI_COURSERA_COURSE_DATA_PROBE?.running,
    true,
    "probe did not finish",
  );
  return JSON.parse(
    JSON.stringify(f.window.__CTI_COURSERA_COURSE_DATA_PROBE?.result || null),
  );
}
const button = (f, label) =>
  f.elements.find(
    (element) => element.tagName === "BUTTON" && element.textContent === label,
  );

test("one universal bookmark derives each current course without capturing module imports or a fixed course", async () => {
  const bookmark = createCourseraCourseDataProbeBookmark(),
    script = decodeURIComponent(bookmark.slice("javascript:".length));
  assert.equal(script, createCourseraCourseDataProbeScript());
  assert(!script.includes(courseId));
  assert(script.startsWith("void (async function"));
  assert.doesNotThrow(() => new vm.Script(script));
  assert(!script.includes("parseCourseraShellUrl"));
  assert(!script.includes("Page.addScriptToEvaluateOnNewDocument"));
  for (const id of [courseId, "Different_fixture_course_789"]) {
    const f = setup(shell.replace(courseId, id)),
      result = await run(f, script);
    assert.equal(result.courseId, id);
    assert.equal(result.status, "COURSE_SCHEMA_SAMPLED");
    assert.equal(result.requests, 2);
    assert.equal(result.capturedResponses, 2);
    assert.equal(result.automaticDownloadAttempts, 1);
    assert.equal(f.downloads.length, 1);
    assert.equal(result.wholeCourseVerified, false);
    assert.equal(result.notForCourseAudit, true);
    assert.equal(result.scope, "COURSE_RELATION_SCHEMA_DISCOVERY");
    assert.match(result.captureId, /^[a-f0-9-]{36}$/);
    assert.equal(f.calls.length, 2);
    for (const call of f.calls) {
      const address = new URL(call.url);
      assert(address.pathname.includes(id));
      assert.equal(address.origin, "https://www.coursera.org");
      assert.equal(call.options.method, "GET");
      assert.equal(call.options.credentials, "include");
      assert.equal(call.options.redirect, "error");
      assert(call.options.signal instanceof AbortSignal);
      assert.deepEqual(Object.keys(call.options.headers), ["Accept"]);
    }
  }
});

test("the local model retains unknown original relation structure but the copied summary contains no course content or IDs", async () => {
  const f = setup(),
    result = await run(f);
  assert.equal(result.inventoryLeafCount, 2);
  assert.equal(result.bodyFormat, "PARSED_SANITIZED_JSON_MODEL");
  assert.equal(result.originalResponseBytesRetained, false);
  assert.equal(result.credentialFieldsRemoved, 2);
  const record = result.records.find(
    (record) => record.resource === "authoringCourseMaterials.v1",
  );
  assert.match(record.originalResponseSha256, /^[a-f0-9]{64}$/);
  const leaf = record.data.elements[0].material.elements[0].elements[0];
  assert.deepEqual(leaf.content.definition.unknownRelation, {
    orderedGroupIds: ["assignment-1~group-2", "assignment-1~group-1"],
    revision: 7,
  });
  assert.equal(leaf.content.definition.prompt, "PRIVATE_QUESTION_TEXT");
  assert.equal(leaf.content.definition.writeAccessToken, undefined);
  assert.deepEqual(record.data.linked["unknownRelation.v1"][0].futureField, {
    retained: true,
  });
  assert(!JSON.stringify(result).includes("PRIVATE_WRITE_TOKEN"));
  assert(!JSON.stringify(result).includes("PRIVATE_PASSWORD"));
  await button(f, "Copy check summary").onclick();
  const summary = JSON.parse(f.context.copied);
  for (const value of [
    "PRIVATE_QUESTION_TEXT",
    "PRIVATE_COURSE_TITLE",
    "assignment-1",
    courseId,
    "item-1",
    "coursera.org",
  ])
    assert(!f.context.copied.includes(value), "summary leaked " + value);
  assert.equal(summary.capturedResponses, 2);
  assert.equal(summary.wholeCourseVerified, false);
  button(f, "Download course data check").onclick();
  assert.equal(f.downloads.length, 2);
  assert.equal(f.blobs.length, 2);
  assert.equal(result.automaticDownloadAttempts, 1);
  assert.match(f.downloads[0].name, /^CTI_Coursera_Course_Data_Check_/);
  assert.deepEqual(JSON.parse(await f.blobs[0].text()), result);
});

test("credential sanitation reaches nested fields, serialized JSON configurations and authenticated URL parameters", () => {
  const input = {
    content: {
      assignmentId: "stable-observed-id",
      access_token: "secret-access",
      nested: [
        {
          writeAccessToken: "secret-write",
          correctOption: "actual-option",
          definition: { answer: "Retained course answer" },
        },
      ],
      config: JSON.stringify({
        futureRelation: { id: "future-id" },
        api_key: "secret-api",
      }),
      html: '<a href="https://user:password@example.test/path?itemId=stable&X-Amz-Signature=secret-signature&accessToken=secret-url">Link</a>',
    },
    linked: { Password: "secret-password", unknown: "Retained unknown field" },
  };
  const result = sanitizeCourseraCourseDataModel(input),
    serialized = JSON.stringify(result.data);
  assert.equal(result.limitReached, false);
  assert.equal(result.removedFields, 4);
  assert.equal(result.redactedUrls, 1);
  for (const secret of [
    "secret-access",
    "secret-write",
    "secret-api",
    "secret-signature",
    "secret-url",
    "secret-password",
    "user:password",
  ])
    assert(!serialized.includes(secret));
  assert.equal(result.data.content.assignmentId, "stable-observed-id");
  assert.equal(
    result.data.content.nested[0].definition.answer,
    "Retained course answer",
  );
  assert.equal(
    JSON.parse(result.data.content.config).futureRelation.id,
    "future-id",
  );
  assert(result.data.content.html.includes("itemId=stable"));
});

test("unsupported deeply nested models are declined rather than retained as a complete relation sample", async () => {
  const f = setup();
  let deep = { assignmentId: "assignment-1" };
  for (let i = 0; i < 55; i++) deep = { child: deep };
  f.material.elements[0].material.tooDeep = deep;
  const result = await run(f);
  assert.equal(result.status, "COURSE_SCHEMA_NOT_CAPTURED");
  assert.equal(result.capturedResponses, 1);
  assert(
    result.failures.some(
      (failure) => failure.code === "MODEL_SANITIZATION_LIMIT",
    ),
  );
  assert.equal(result.wholeCourseVerified, false);
});

test("wrong pages and frames show a visible instruction and make zero requests; an active extractor blocks the check", async () => {
  for (const mode of [
    "origin",
    "http",
    "learner",
    "frame",
    "otherCourse",
    "active",
  ]) {
    const f = setup(
      mode === "origin"
        ? shell.replace("www.coursera.org", "untrusted.test")
        : mode === "http"
          ? shell.replace("https:", "http:")
          : mode === "learner"
            ? "https://www.coursera.org/learn/synthetic"
            : shell,
    );
    if (mode === "frame") f.window.top = {};
    if (mode === "active")
      f.window.__CTI_ITEM_FIDELITY_RUN_LOCK = { running: true };
    const result = await run(
      f,
      mode === "otherCourse"
        ? createCourseraCourseDataProbeScript(
            shell.replace(courseId, "Other_course_456"),
          )
        : undefined,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.downloads.length, 0);
    assert.equal(result, null);
    assert.equal(f.alerts.length, 1);
    assert.match(
      f.alerts[0],
      mode === "active" ? /Stop the running CTI extractor/ : /authoring course/,
    );
    assert.equal(
      f.elements.filter(
        (element) => element.id === "__cti_coursera_course_data_probe",
      ).length,
      0,
    );
  }
  for (const invalid of [
    shell.replace("https:", "http:"),
    shell.replace("www.coursera.org", "coursera.org"),
    shell.replace("www.coursera.org", "user:password@www.coursera.org"),
    "https://www.coursera.org/learn/synthetic",
  ])
    assert.throws(() => createCourseraCourseDataProbeScript(invalid));
});

test("historical relation routes stay explicitly unbound and cannot cause extra API reads", async () => {
  const f = setup();
  f.context.performance.getEntriesByType = () => [
    {
      name: "https://www.coursera.org/api/authoringAtoms.v2/unknown-atom?accessToken=PRIVATE_QUERY_TOKEN",
    },
    {
      name: "https://www.coursera.org/api/authoringItemContentRelations.v1/unknown-relation?branchId=Other_course_456",
    },
    {
      name: "https://www.coursera.org/api/authoringAtoms.v2/unknown-atom?other=duplicate",
    },
    { name: "https://other.test/api/authoringAtoms.v2/foreign" },
    { name: "https://www.coursera.org/api/users.v1/private" },
    {
      name: "https://user:password@www.coursera.org/api/authoringAtoms.v2/credentials",
    },
  ];
  const result = await run(f);
  assert.equal(f.calls.length, 2);
  assert.equal(result.observedRelationPathCount, 2);
  assert.equal(result.relationRequests, 0);
  assert(
    result.observedRelationPaths.every(
      (route) =>
        route.fetched === false &&
        route.courseBinding === "NOT_ESTABLISHED_FROM_PERFORMANCE_ENTRY",
    ),
  );
  assert(!JSON.stringify(result).includes("PRIVATE_QUERY_TOKEN"));
  assert(!JSON.stringify(result).includes("Other_course_456"));
});

test("API authentication, non-JSON replies and redirects fail without a completeness claim", async () => {
  for (const mode of ["denied", "html", "route"]) {
    const f = setup(),
      fetch = f.window.fetch;
    f.window.fetch = async (input, options) => {
      if (!String(input).includes("authoringCourseMaterials"))
        return fetch(input, options);
      f.calls.push({ url: String(input), options });
      return mode === "denied"
        ? f.respond({ private: "SECRET_ERROR" }, input, { status: 403 })
        : mode === "html"
          ? f.respond("<html>PRIVATE_LOGIN_PAGE</html>", input, {
              type: "text/html",
            })
          : f.respond(f.material, input, {
              responseUrl: String(input).replace(
                "www.coursera.org",
                "untrusted.test",
              ),
            });
    };
    const result = await run(f);
    assert.equal(result.status, "COURSE_SCHEMA_NOT_CAPTURED");
    assert.equal(result.wholeCourseVerified, false);
    assert.equal(result.capturedResponses, 1);
    assert.equal(result.requests, 2);
    const summary = JSON.stringify(
      f.window.__CTI_COURSERA_COURSE_DATA_PROBE.summary,
    );
    for (const secret of [
      "SECRET_ERROR",
      "PRIVATE_LOGIN_PAGE",
      "Other_course_456",
    ])
      assert(!summary.includes(secret));
    assert(
      result.failures.some(
        (failure) => failure.resource === "authoringCourseMaterials.v1",
      ),
    );
  }
});

test("different course-versus-branch identity fields are retained for schema discovery without certifying their meaning", async () => {
  const f = setup();
  f.material.courseId = "Different_canonical_course_456";
  f.material.branchId = courseId;
  const result = await run(f),
    record = result.records.find(
      (record) => record.resource === "authoringCourseMaterials.v1",
    );
  assert.equal(result.status, "COURSE_SCHEMA_SAMPLED");
  assert.equal(result.wholeCourseVerified, false);
  assert.equal(record.data.courseId, "Different_canonical_course_456");
  assert.equal(record.declaredIdentityFields.routeValueAgreement, false);
  assert.equal(
    record.declaredIdentityFields.identitySemantics,
    "COURSE_VERSUS_BRANCH_MEANING_NOT_CERTIFIED",
  );
});

test("source hashes cover actual streamed bytes including a UTF-8 BOM, rather than reencoded decoded text", async () => {
  const f = setup(),
    fetch = f.window.fetch;
  const original = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(f.material)),
  ]);
  f.window.fetch = async (input, options) => {
    if (!String(input).includes("authoringCourseMaterials"))
      return fetch(input, options);
    f.calls.push({ url: String(input), options });
    const response = new Response(original, {
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  };
  const result = await run(f),
    record = result.records.find(
      (record) => record.resource === "authoringCourseMaterials.v1",
    );
  assert.equal(record.responseBytes, original.byteLength);
  assert.equal(
    record.originalResponseSha256,
    createHash("sha256").update(original).digest("hex"),
  );
});

test("relative and protocol-relative credential URL parameters and separator variants are removed without changing relation IDs", () => {
  const result = sanitizeCourseraCourseDataModel({
    session_token: "secret-session",
    "x-csrf-token": "secret-csrf",
    relative: "/path?access_token=secret-relative&id=keep",
    protocolRelative: "//host.test/path?access_token=secret-protocol&order=2",
    uppercase: "HTTPS://user:password@example.test/a?item=good",
    nested: JSON.stringify({
      href: "../atom?itemId=keep&amp;accessToken=secret-nested",
    }),
    content: {
      assignmentId: "keep-assignment",
      orderedGroupIds: ["keep~second", "keep~first"],
    },
  });
  assert.equal(result.removedFields, 2);
  assert.equal(result.redactedUrls, 4);
  assert.equal(result.data.relative, "/path?id=keep");
  assert.equal(result.data.protocolRelative, "//host.test/path?order=2");
  assert.equal(result.data.uppercase, "https://example.test/a?item=good");
  assert.equal(JSON.parse(result.data.nested).href, "../atom?itemId=keep");
  assert.deepEqual(result.data.content.orderedGroupIds, [
    "keep~second",
    "keep~first",
  ]);
  assert(!JSON.stringify(result.data).includes("secret-"));
});

test("a stream exceeding the body byte limit is cancelled and never parsed or retained", async () => {
  const f = setup(),
    fetch = f.window.fetch;
  let cancelled = false;
  f.window.fetch = async (input, options) => {
    if (!String(input).includes("authoringCourseMaterials"))
      return fetch(input, options);
    f.calls.push({ url: String(input), options });
    return {
      ok: true,
      status: 200,
      url: String(input),
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader: () => ({
          read: async () => ({
            done: false,
            value: new Uint8Array(2 * 1024 * 1024 + 1),
          }),
          cancel: async () => {
            cancelled = true;
          },
        }),
      },
    };
  };
  const result = await run(f);
  assert(cancelled);
  assert.equal(result.status, "COURSE_SCHEMA_NOT_CAPTURED");
  assert(result.failures.some((failure) => failure.code === "BODY_BYTE_LIMIT"));
  assert.equal(result.capturedResponses, 1);
  assert.equal(result.wholeCourseVerified, false);
});

test("the 60-second watchdog aborts both in-flight reads and repeating the bookmark does not launch more work", async () => {
  const f = setup();
  let aborted = 0;
  f.window.fetch = (input, options) => {
    f.calls.push({ url: String(input), options });
    return new Promise((resolve, reject) =>
      options.signal.addEventListener(
        "abort",
        () => {
          aborted++;
          reject(new Error("PRIVATE_ERROR"));
        },
        { once: true },
      ),
    );
  };
  const script = createCourseraCourseDataProbeScript();
  vm.runInContext(script, f.context);
  while (f.calls.length !== 2)
    await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext(script, f.context);
  assert.equal(f.calls.length, 2);
  const watchdog = [...f.watchdogs.values()].find((item) => item.ms === 60000);
  assert(watchdog);
  watchdog.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborted, 2);
  const state = f.window.__CTI_COURSERA_COURSE_DATA_PROBE;
  assert.equal(state.running, false);
  assert.equal(state.summary.stopReason, "COURSE_DATA_CHECK_DEADLINE");
  assert.equal(state.result.capturedResponses, 0);
  assert.equal(state.result.automaticDownloadAttempts, 0);
  assert.equal(f.downloads.length, 0);
  assert(!JSON.stringify(state.summary).includes("PRIVATE_ERROR"));
  assert.equal(
    f.elements.filter(
      (element) => element.id === "__cti_coursera_course_data_probe",
    ).length,
    1,
  );
});

test("stopping before any response saves no empty file and aborts both reads", async () => {
  const f = setup();
  let aborted = 0;
  f.window.fetch = (input, options) => {
    f.calls.push({ url: String(input), options });
    return new Promise((resolve, reject) =>
      options.signal.addEventListener(
        "abort",
        () => {
          aborted++;
          reject(new Error("PRIVATE_ERROR"));
        },
        { once: true },
      ),
    );
  };
  vm.runInContext(createCourseraCourseDataProbeScript(), f.context);
  while (f.calls.length !== 2)
    await new Promise((resolve) => setImmediate(resolve));
  f.window.__CTI_COURSERA_COURSE_DATA_PROBE.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborted, 2);
  assert.equal(
    f.window.__CTI_COURSERA_COURSE_DATA_PROBE.summary.stopReason,
    "OPERATOR_STOPPED",
  );
  assert.equal(
    f.window.__CTI_COURSERA_COURSE_DATA_PROBE.result.automaticDownloadAttempts,
    0,
  );
  assert.equal(f.downloads.length, 0);
});
