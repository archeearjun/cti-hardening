import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bindDirectAuthoringDraftV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";
import { directInlineWidgetProviderSourceV1, directInlineWidgetProviderTargetsV1 } from "../src/extractors/coursera/direct-data-widget.js";
import { directInlineWidgetBindingsV1, directInlineWidgetEvidenceV1,
  directWidgetProviderReceiptValidV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { widgetFixture, WIDGET_COURSE as COURSE, WIDGET_SLUG as SLUG,
  WIDGET_PROVIDER as BASE } from "./coursera-direct-widget-fixtures.mjs";

const selector = BASE + "@1",
  modelHash = value => createHash("sha256").update(directCanonicalSourceTextV1(value)).digest("hex");

function fixture({ cml = '<co-content><widget id="' + selector + '"/></co-content>', discussion = false } = {}) {
  const f = widgetFixture(),
    nativeCml = { typeName: "cml", definition: { dtdId: discussion ? "discussion/1" : "assess/1", value: cml } };
  f.fp.type = discussion ? "Discussion" : "Reading";
  f.fp.typeName = discussion ? "discussionPrompt" : "supplement";
  f.atom.draft.content = discussion
    ? { typeName: "discussionPromptDraft", definition: { promptType: { typeName: "questionPerSession", definition: {
      title: "Synthetic discussion", promptPermissions: { viewAnswersBeforeReplying: false }, prompt: nativeCml,
    } } } }
    : { typeName: "supplementDraft", definition: { assetId: "c".repeat(22) + "@3", content: nativeCml } };
  const sources = f.fp.payload.directDataSources;
  sources.receipts.stability.atom.elements[0] = structuredClone(f.atom);
  sources.receipts.stability.draftHash = modelHash(f.atom.draft);
  f.bound = bindDirectAuthoringDraftV1(f.fp, COURSE, SLUG, sources.atom, sources.relation);
  f.model.elements[0].owners = ["COURSE~" + COURSE];
  f.providerReceipt.id = selector;
  f.providerReceipt.requestQuery.find(pair => pair[0] === "widgetSessionProviderId")[1] = selector;
  delete f.fp.payload.directWidgetProviderEvidence;
  const bindings = directInlineWidgetBindingsV1(f.fp, f.bound),
    providers = bindings.map(binding => {
      const model = structuredClone(f.model), receipt = structuredClone(f.providerReceipt);
      model.elements[0].id = binding.providerBaseId;
      receipt.id = binding.providerId;
      receipt.requestQuery.find(pair => pair[0] === "widgetSessionProviderId")[1] = binding.providerId;
      const source = directInlineWidgetProviderSourceV1(binding, model),
        observation = { model, receipt, modelHash: modelHash(model), sourceHash: modelHash(source) };
      return { ...binding, initial: observation, final: structuredClone(observation),
        stableSource: true, targets: directInlineWidgetProviderTargetsV1(binding, model), failures: [],
        bodyVerified: false, playbackVerified: false, launchVerified: false, wholeWidgetVerified: false };
    });
  f.fp.payload.directInlineWidgetProviderEvidence = {
    method: "BOUND_INLINE_CML_WIDGET_PROVIDERS", courseId: COURSE, itemId: f.fp.id, atomId: f.atom.id,
    sourceState: "AUTHORING_DRAFT", providers, failures: [],
    bodyVerified: false, playbackVerified: false, launchVerified: false, wholeWidgetVerified: false,
  };
  return { ...f, bindings, raw: f.fp.payload.directInlineWidgetProviderEvidence };
}

test("current reading and discussion CML select exact versioned instances while linked templates and duplicate placements cannot select another provider", () => {
  for (const discussion of [false, true]) {
    const f = fixture({ discussion, cml: '<co-content><text>Authored text</text><widget id="' + selector +
      '"/><widget id="' + selector + '"/><!-- <widget id="' + "x".repeat(22) + '@2"/> -->' +
      '<text>&lt;widget id="' + "x".repeat(22) + '@2"/&gt;</text></co-content>' });
    assert.equal(f.bindings.length, 1);
    assert.equal(f.bindings[0].providerId, selector);
    assert.equal(f.bindings[0].providerBaseId, BASE);
    assert.equal(f.bindings[0].requestedVersion, "1");
    assert.equal(f.bindings[0].occurrences, 2);
    const checked = directInlineWidgetEvidenceV1(f.fp, f.bound, modelHash);
    assert(checked);
    assert.equal(checked.providers.length, 1);
    assert.equal(checked.providers[0].sourceInitial.versionBinding, "REQUEST_SELECTOR_ONLY");
    assert.equal(checked.providers[0].sourceInitial.id, BASE);
    assert.equal(checked.providers[0].sourceInitial.requestedProviderId, selector);
    assert(checked.providers[0].targets.every(target => target.providerId === selector && target.url === f.url));
    assert(!checked.providers[0].targets.some(target => target.url.includes("examples.example.test")));
    assert.equal(f.raw.bodyVerified, false);
    assert.equal(f.raw.wholeWidgetVerified, false);
  }
});

test("missing, malformed and unknown version selectors are not downgraded to a base ID or fetched", () => {
  for (const invalid of [BASE, BASE + "@0", BASE + "@01", BASE + "@-1", BASE + "@latest", BASE + "@1/other", BASE + "@1000000000000"]) {
    const f = fixture({ cml: '<co-content><widget id="' + invalid + '"/></co-content>' });
    assert.deepEqual(f.bindings, []);
    assert.equal(directInlineWidgetEvidenceV1(f.fp, f.bound, modelHash), null);
  }
  const f = fixture();
  f.atom.draft.content.definition.content.definition.value = "<co-content><widget></co-content>";
  assert.throws(() => directInlineWidgetBindingsV1(f.fp, f.bound));
  f.atom.draft.content.definition.content.definition.value = '<co-content><widget id="' + selector + '"/></co-content>';
  f.atom.draft.content.definition.content.definition.dtdId = "unknown/1";
  assert.throws(() => directInlineWidgetBindingsV1(f.fp, f.bound));
});

test("the observed finder keeps the full version selector while accepting only its exact base response identity", async () => {
  const f = fixture(), calls = [];
  const reader = createDirectDataReaderV1({ sanitize: sanitizeCourseraCourseDataModel,
    fetchImpl: async (url, options) => { calls.push({ url: new URL(url), options });
      return new Response(JSON.stringify(f.model), { headers: { "content-type": "application/json" } }); },
  });
  const read = await reader.readWidgetProvider(selector, COURSE);
  assert.equal(read.ok, true, read.reason);
  assert.equal(calls[0].url.searchParams.get("widgetSessionProviderId"), selector);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(read.data.elements[0].id, BASE);
  assert.equal(directWidgetProviderReceiptValidV1({ ...read.receipt, id: selector,
    sha256: read.receipt.originalResponseSha256 }, f.bindings[0]), true);
  for (const invalid of [BASE + "@0", BASE + "@01", BASE + "@1/other", BASE + "@1&courseId=foreign"])
    assert.equal((await reader.readWidgetProvider(invalid, COURSE)).ok, false);
  assert.equal(calls.length, 1);
  const wrong = createDirectDataReaderV1({ sanitize: sanitizeCourseraCourseDataModel,
    fetchImpl: async () => new Response(JSON.stringify({ ...f.model, elements: [{ ...f.model.elements[0], id: selector }] }),
      { headers: { "content-type": "application/json" } }),
  });
  assert.equal((await wrong.readWidgetProvider(selector, COURSE)).reason, "UNEXPECTED_API_IDENTITY");
});

test("import recomputes model, source and owning atom hashes and rejects wrong selectors, owners, target fabrication and stale drafts", () => {
  const mutations = [
    f => { f.raw.providers[0].providerId = BASE + "@2"; },
    f => { f.raw.providers[0].providerBaseId = "q".repeat(22); },
    f => { f.raw.providers[0].requestedVersion = "2"; },
    f => { f.raw.providers[0].initial.model.elements[0].owners = ["COURSE~ForeignCourse"]; },
    f => { f.raw.providers[0].final.model.elements[0].draft.configuration.url += "?changed=1"; },
    f => { f.raw.providers[0].final.model.elements[0].draft.pageSrc += "?changed=1"; },
    f => { f.raw.providers[0].initial.receipt.requestQuery.find(pair => pair[0] === "widgetSessionProviderId")[1] = BASE; },
    f => { f.raw.providers[0].final.receipt.requestQuery.push(["widgetSessionProviderId", selector]); },
    f => { f.raw.providers[0].final.receipt.requestQuery.find(pair => pair[0] === "courseId")[1] = "ForeignCourse"; },
    f => { f.raw.providers[0].initial.receipt.id = BASE; },
    f => { f.raw.providers[0].initial.receipt.requestPath += BASE; },
    f => { f.raw.providers[0].final.receipt.observedAt = "2027-01-15T08:00:01.000Z"; },
    f => { f.raw.providers[0].final.receipt.observedAt = "January 15, 2027"; },
    f => { delete f.fp.payload.directDataSources.receipts.stability.receipt.observedAt; },
    f => { f.raw.providers[0].final.modelHash = f.raw.providers[0].initial.modelHash = "e".repeat(64); },
    f => { f.raw.providers[0].final.sourceHash = f.raw.providers[0].initial.sourceHash = "e".repeat(64); },
    f => { f.raw.providers[0].targets[0].url = "https://examples.example.test/invented"; },
    f => { f.raw.providers[0].bodyVerified = true; },
    f => { f.raw.wholeWidgetVerified = true; },
    f => { f.fp.payload.directDataSources.receipts.stability.stable = false; },
    f => { f.fp.payload.directDataSources.receipts.stability.draftHash = "e".repeat(64); },
    f => { f.fp.payload.directDataSources.receipts.stability.atom.elements[0].draft.content.definition.content.definition.value = "<co-content/>"; },
    f => { f.bound = structuredClone(f.bound); f.bound.draft.content.definition.content.definition.value = '<co-content><widget id="' + BASE + '@2"/></co-content>'; },
    f => { f.raw.providers.push(structuredClone(f.raw.providers[0])); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture(); mutate(f);
    assert.equal(directInlineWidgetEvidenceV1(f.fp, f.bound, modelHash), null, "mutation " + index);
  }
  const f = fixture();
  assert.equal(directInlineWidgetEvidenceV1(f.fp, f.bound), null, "Hash declarations alone never verify imported configurations");
});

test("unavailable provider configuration remains separate and never suppresses a validated different instance", () => {
  const secondSelector = "q".repeat(22) + "@2",
    f = fixture({ cml: '<co-content><widget id="' + selector + '"/><widget id="' + secondSelector + '"/></co-content>' });
  f.raw.providers[0].stableSource = false;
  f.raw.providers[0].failures.push({ reason: "HTTP_403" });
  const checked = directInlineWidgetEvidenceV1(f.fp, f.bound, modelHash);
  assert(checked);
  assert.equal(checked.providers.length, 1);
  assert.equal(checked.providers[0].binding.providerId, secondSelector);
  assert.equal(checked.failures[0].providerId, selector);
  assert.equal(f.raw.bodyVerified, false);
});

test("provider selection is bounded before network reads and does not require a final atom receipt during collection", () => {
  const f = fixture();
  delete f.fp.payload.directDataSources.receipts.stability;
  assert.equal(directInlineWidgetBindingsV1(f.fp, f.bound).length, 1);
  assert.equal(directInlineWidgetEvidenceV1(f.fp, f.bound, modelHash), null);
  f.atom.draft.content.definition.content.definition.value = '<co-content>' +
    Array.from({ length: 33 }, () => '<widget id="' + selector + '"/>').join("") + '</co-content>';
  assert.throws(() => directInlineWidgetBindingsV1(f.fp, f.bound), /REFERENCE_LIMIT/);
});
