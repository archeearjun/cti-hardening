import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "vite";

// The app prints function.toString() into a saved bookmark. A development
// transform can pass while a production minifier introduces an enclosing
// binding, so generate the actual maintained creator through the Vite build.
// This tests delivery independence in an isolated VM, not Chrome's policy or
// native bookmark execution and not Coursera's private full-course schema.
test("production-minified bookmark is independent of its Vite module closure", async () => {
  const entry = "cti-bookmark-delivery-fixture",
    virtual = "\0" + entry;
  const source = fileURLToPath(
    new URL("../src/domain/coursera-course-data-probe.ts", import.meta.url),
  );
  const bundled = await build({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    logLevel: "silent",
    plugins: [
      {
        name: entry,
        resolveId(id) {
          if (id === entry) return virtual;
        },
        load(id) {
          if (id === virtual)
            return (
              "import {createCourseraCourseDataProbeBookmark} from " +
              JSON.stringify(source) +
              ";globalThis.__compiledBookmarkAddress=createCourseraCourseDataProbeBookmark();"
            );
        },
      },
    ],
    build: {
      write: false,
      minify: true,
      rollupOptions: { input: entry, output: { format: "iife" } },
    },
  });
  const outputs = (Array.isArray(bundled) ? bundled : [bundled]).flatMap(
    (result) => result.output,
  );
  const chunks = outputs.filter((output) => output.type === "chunk");
  assert.equal(
    chunks.length,
    1,
    "The delivery fixture must be one production bundle",
  );
  const creatorContext = vm.createContext({});
  vm.runInContext(chunks[0].code, creatorContext);
  const address = creatorContext.__compiledBookmarkAddress;
  assert.equal(typeof address, "string");
  assert(address.startsWith("javascript:"));
  const program = decodeURIComponent(address.slice("javascript:".length));
  assert.doesNotThrow(() => new vm.Script(program));

  const courseId = "Minified_delivery_course_123",
    calls = [],
    alerts = [];
  class Element {
    constructor() {
      this.style = {};
      this.children = [];
    }
    setAttribute() {}
    append(...nodes) {
      this.children.push(...nodes);
    }
    attachShadow() {
      return new Element();
    }
    remove() {}
  }
  const document = {
    createElement: () => new Element(),
    getElementById: () => null,
    documentElement: new Element(),
  };
  const window = {
    alert: (message) => alerts.push(message),
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
  };
  window.top = window;
  window.fetch = async (input, options) => {
    calls.push({
      url: String(input),
      method: options.method,
      credentials: options.credentials,
    });
    const material = String(input).includes("authoringCourseMaterials");
    const model = {
      elements: [
        {
          id: courseId,
          material: material
            ? {
                elements: [
                  {
                    id: "observed-item",
                    name: "Synthetic item",
                    content: {
                      futureRelation: { assignmentId: "observed-assignment" },
                      accessToken: "PRIVATE_DELIVERY_TOKEN",
                      url: "/content?access_token=PRIVATE_URL_TOKEN&itemId=stable",
                    },
                  },
                ],
              }
            : undefined,
        },
      ],
    };
    const response = new Response(JSON.stringify(model), {
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  };
  const runtime = vm.createContext({
    window,
    document,
    location: new URL(
      "https://www.coursera.org/teach/synthetic/" + courseId + "/content/edit",
    ),
    performance: { getEntriesByType: () => [] },
    crypto: webcrypto,
    navigator: { clipboard: { writeText: async () => {} } },
    URL,
    Blob,
    Response,
    TextDecoder,
    TextEncoder,
    AbortController,
    Uint8Array,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(program, runtime);
  const deadline = Date.now() + 5000;
  while (
    window.__CTI_COURSERA_COURSE_DATA_PROBE?.running &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setImmediate(resolve));
  const state = window.__CTI_COURSERA_COURSE_DATA_PROBE;
  try {
    assert(
      state,
      "The standalone compiled program must create its diagnostic state",
    );
    assert.equal(
      state.running,
      false,
      "The compiled program must finish both reads",
    );
    assert.deepEqual(alerts, []);
    assert.equal(calls.length, 2);
    assert(
      calls.every(
        (call) =>
          call.method === "GET" &&
          call.credentials === "include" &&
          call.url.includes(courseId),
      ),
    );
    const result = JSON.parse(JSON.stringify(state.result));
    assert.equal(result.status, "COURSE_SCHEMA_SAMPLED");
    assert.equal(result.capturedResponses, 2);
    assert.equal(result.notForCourseAudit, true);
    assert.equal(result.wholeCourseVerified, false);
    const item = result.records.find(
      (record) => record.resource === "authoringCourseMaterials.v1",
    ).data.elements[0].material.elements[0];
    assert.deepEqual(item.content.futureRelation, {
      assignmentId: "observed-assignment",
    });
    assert.equal(item.content.url, "/content?itemId=stable");
    assert(!JSON.stringify(result).includes("PRIVATE_DELIVERY_TOKEN"));
    assert(!JSON.stringify(result).includes("PRIVATE_URL_TOKEN"));
  } finally {
    if (state?.running) state.stop("TEST_CLEANUP");
  }
});
