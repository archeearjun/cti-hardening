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
    alerts = [],
    downloads = [],
    blobs = [];
  const quizAtom = "q".repeat(22),
    readingAtom = "r".repeat(22);
  let inFlight = 0,
    maximumInFlight = 0,
    honorAllProjection = true;
  class FixtureUrl extends URL {
    static createObjectURL(blob) {
      blobs.push(blob);
      return "blob:production-fixture-" + blobs.length;
    }
    static revokeObjectURL() {}
  }
  class Element {
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase();
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
    click() {
      if (this.tagName === "A")
        downloads.push({ url: this.href, name: this.download });
    }
  }
  const document = {
    createElement: (tag) => new Element(tag),
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
    inFlight++;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    calls.push({
      url: String(input),
      method: options.method,
      credentials: options.credentials,
      headers: Object.fromEntries(new Headers(options.headers)),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 3));
      const requested = new URL(input),
        resource = requested.pathname.split("/")[2],
        key = requested.pathname.split("/")[3];
      const model =
        resource === "authoringCourseMaterials.v1"
          ? {
              elements: [
                {
                  id: courseId,
                  conflictMetadata: { version: 7, courseBranchVersion: 9 },
                  material: {
                    elements: [
                      {
                        id: "module1",
                        name: "Synthetic module",
                        elements: [
                          {
                            id: "lesson1",
                            name: "Synthetic lesson",
                            elements: [
                              {
                                id: "quiz1",
                                name: "Synthetic quiz",
                                atomId: quizAtom,
                                contentId: "atom~" + quizAtom,
                                content: {
                                  typeName: "staffGraded",
                                  definition: {
                                    assignmentId: "s".repeat(22) + "@1",
                                    futureRelation: {
                                      assignmentId: "observed-assignment",
                                    },
                                    accessToken: "PRIVATE_DELIVERY_TOKEN",
                                    url: "/content?access_token=PRIVATE_URL_TOKEN&itemId=stable",
                                  },
                                },
                              },
                              {
                                id: "reading1",
                                name: "Synthetic reading",
                                atomId: readingAtom,
                                contentId: "atom~" + readingAtom,
                                content: {
                                  typeName: "supplement",
                                  definition: {
                                    assetId: "synthetic-cml-asset",
                                    assetTypeName: "cml",
                                  },
                                },
                              },
                            ],
                          },
                        ],
                      },
                      {
                        id: "empty1",
                        name: "Empty synthetic module",
                        elements: [],
                      },
                    ],
                  },
                },
              ],
              paging: {},
              linked: {},
            }
          : resource === "authoringCourses.v2"
            ? { elements: [{ id: courseId }], paging: {}, linked: {} }
            : honorAllProjection &&
                new Headers(options.headers).get(
                  "X-Coursera-Naptime-Fields",
                ) === "ALL"
              ? {
                  elements: [
                    {
                      id: key,
                      opaqueFutureRelation: {
                        observedAtom: key,
                        sourceResource: resource,
                      },
                      session_token: "PRIVATE_RELATION_TOKEN",
                    },
                  ],
                  paging: {},
                  linked: {},
                  links: {
                    elements: {
                      opaqueFutureRelation: "syntheticFutureRelations.v1",
                    },
                  },
                }
              : {
                  elements: [{ id: key }],
                  paging: {},
                  linked: { "syntheticFutureRelations.v1": [] },
                  links: { elements: {} },
                };
      const response = new Response(JSON.stringify(model), {
        headers: { "content-type": "application/json" },
      });
      Object.defineProperty(response, "url", { value: String(input) });
      return response;
    } finally {
      inFlight--;
    }
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
    URL: FixtureUrl,
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
      "The compiled program must finish the bounded six-read sample",
    );
    assert.deepEqual(alerts, []);
    assert.equal(calls.length, 6);
    assert.equal(maximumInFlight, 2);
    for (const call of calls) {
      const isAtom =
        /\/api\/(?:authoringAtoms\.v2|authoringItemContentRelations\.v1)\//.test(
          call.url,
        );
      assert.equal(
        call.headers["x-coursera-naptime-fields"],
        isAtom ? "ALL" : undefined,
      );
      assert.deepEqual(
        Object.keys(call.headers).sort(),
        isAtom ? ["accept", "x-coursera-naptime-fields"] : ["accept"],
      );
      if (isAtom)
        assert.equal(new URL(call.url).searchParams.get("includes"), "_links");
    }
    assert(
      calls.every(
        (call) => call.method === "GET" && call.credentials === "include",
      ),
    );
    const result = JSON.parse(JSON.stringify(state.result));
    assert.equal(result.status, "COURSE_SCHEMA_SAMPLED");
    assert.equal(result.capturedResponses, 6);
    assert.equal(result.requests, 6);
    assert.equal(result.relationRequests, 4);
    assert.equal(result.relationProjectionStatus, "SCHEMA_FIELDS_RETURNED");
    assert.equal(result.relationSchemaResponseCount, 4);
    assert.equal(result.identifierOnlyRelationResponses, 0);
    assert.equal(result.structuralLeafCount, 3);
    assert.equal(result.inventoryLeafCount, 2);
    assert.equal(result.emptyStructuralLeafCount, 1);
    assert.deepEqual(result.contentTypeCounts, {
      staffGraded: 1,
      supplement: 1,
    });
    assert.equal(
      result.relationSampleReason,
      "BOUNDED_DECLARED_ATOM_SCHEMA_SAMPLE",
    );
    assert.equal(result.notForCourseAudit, true);
    assert.equal(result.wholeCourseVerified, false);
    const item = result.records.find(
      (record) => record.resource === "authoringCourseMaterials.v1",
    ).data.elements[0].material.elements[0].elements[0].elements[0];
    assert.deepEqual(item.content.definition.futureRelation, {
      assignmentId: "observed-assignment",
    });
    assert.equal(item.content.definition.url, "/content?itemId=stable");
    const relations = result.records.filter((record) => record.sourceBinding);
    assert.equal(relations.length, 4);
    for (const record of relations) {
      assert.equal(record.sourceBinding.courseId, courseId);
      assert.equal(record.sourceBinding.materialVersion, 7);
      assert.equal(
        record.sourceBinding.requestScope,
        "EXPLICIT_MATERIAL_ATOM_REFERENCE_SCHEMA_SAMPLE",
      );
      assert.equal(record.sourceBinding.assessmentRootCertified, false);
      assert(record.requestPath.endsWith("/" + record.sourceBinding.atomId));
      assert.equal(record.requestProjection, "NAPTIME_ALL_FIELDS_HEADER");
      assert.equal(record.requestQuery.includes, "_links");
      assert.equal(record.projection.status, "SCHEMA_FIELDS_RETURNED");
      assert(record.projection.schemaFieldCount > 0);
      assert.equal(record.projection.expectedIdObserved, true);
      assert.equal(record.projection.hasRelationMetadata, true);
      assert.equal(
        record.data.elements[0].opaqueFutureRelation.observedAtom,
        record.sourceBinding.atomId,
      );
    }
    assert.equal(downloads.length, 1);
    assert.equal(blobs.length, 1);
    assert.equal(result.automaticDownloadAttempts, 1);
    assert.deepEqual(JSON.parse(await blobs[0].text()), result);
    assert(!JSON.stringify(result).includes("PRIVATE_DELIVERY_TOKEN"));
    assert(!JSON.stringify(result).includes("PRIVATE_URL_TOKEN"));
    assert(!JSON.stringify(result).includes("PRIVATE_RELATION_TOKEN"));

    // A live authoring resource may ignore the framework's projection header.
    // The emitted program must report that outcome and never upgrade id-only
    // records into a body/schema/completeness success.
    honorAllProjection = false;
    const beforeCalls = calls.length,
      beforeDownloads = downloads.length;
    vm.runInContext(program, runtime);
    const ignoredDeadline = Date.now() + 5000;
    while (
      window.__CTI_COURSERA_COURSE_DATA_PROBE?.running &&
      Date.now() < ignoredDeadline
    )
      await new Promise((resolve) => setImmediate(resolve));
    const ignored = window.__CTI_COURSERA_COURSE_DATA_PROBE;
    try {
      assert.equal(ignored.running, false);
      assert.equal(calls.length - beforeCalls, 6);
      assert.equal(downloads.length - beforeDownloads, 1);
      assert.equal(maximumInFlight, 2);
      const ignoredResult = JSON.parse(JSON.stringify(ignored.result));
      assert.equal(
        ignoredResult.relationProjectionStatus,
        "IDENTIFIER_ONLY_RESPONSES",
      );
      assert.equal(ignoredResult.identifierOnlyRelationResponses, 4);
      assert.equal(ignoredResult.relationSchemaResponseCount, 0);
      assert.equal(ignoredResult.wholeCourseVerified, false);
      for (const record of ignoredResult.records.filter(
        (record) => record.sourceBinding,
      )) {
        assert.equal(record.requestProjection, "NAPTIME_ALL_FIELDS_HEADER");
        assert.equal(record.projection.status, "IDENTIFIER_ONLY");
        assert.equal(record.projection.schemaFieldCount, 0);
        assert.equal(record.projection.expectedIdObserved, true);
        assert.equal(record.projection.hasRelationMetadata, false);
      }
    } finally {
      if (ignored?.running) ignored.stop("TEST_CLEANUP");
    }
  } finally {
    if (state?.running) state.stop("TEST_CLEANUP");
  }
});
