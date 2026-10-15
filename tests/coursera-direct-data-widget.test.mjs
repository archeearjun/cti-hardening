import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { createDirectDataReaderV1 } from "../src/extractors/coursera/direct-data-network.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";
import {
  directDraftWidgetProviderV1,
  directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1,
} from "../src/extractors/coursera/direct-data-widget.js";
import { directWidgetEvidenceValidV1, directWidgetContractV1,
  directWidgetProviderReceiptValidV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { widgetFixture as fixture, WIDGET_COURSE as COURSE,
  WIDGET_PROVIDER as PROVIDER } from "./coursera-direct-widget-fixtures.mjs";

globalThis.crypto ??= webcrypto;
const clone = (value) => structuredClone(value);

test("same-title native widgets retain their own provider identities and configured targets", () => {
  const first = fixture(), second = fixture({
    itemId: "WidgetB", providerId: "q".repeat(22), atomId: "b".repeat(22),
    url: "https://video.example.test/embed?id=other-video&autoplay=false&captions=true",
  });
  assert.equal(first.fp.name, second.fp.name);
  for (const f of [first, second]) {
    const binding = directDraftWidgetProviderV1(f.bound);
    assert.equal(binding.itemId, f.fp.id);
    assert.equal(binding.atomId, f.fp.atomId);
    assert.equal(binding.providerId, f.model.elements[0].id);
    assert.equal(binding.courseId, COURSE);
    assert.equal(binding.sourceState, "AUTHORING_DRAFT");
    assert.deepEqual(directWidgetProviderSourceV1(f.bound, f.model), {
      id: binding.providerId, draft: f.model.elements[0].draft,
      updatedAt: f.model.elements[0].metadata.updatedAt,
    });
    const targets = directWidgetProviderTargetsV1(f.bound, f.model);
    assert(targets.length > 0);
    assert.deepEqual([...new Set(targets.map((target) => target.url))], [f.url]);
    for (const target of targets) {
      assert.equal(target.itemId, f.fp.id);
      assert.equal(target.atomId, f.fp.atomId);
      assert.equal(target.providerId, binding.providerId);
      assert.equal(target.courseId, COURSE);
      assert(["draft.configuration.url", "draft.pageSrc"].includes(target.sourceField));
      assert.equal(target.bodyVerified, false);
      assert.equal(target.playbackVerified, false);
      assert.equal(target.launchVerified, false);
    }
  }
  assert.notDeepEqual(directWidgetProviderTargetsV1(first.bound, first.model),
    directWidgetProviderTargetsV1(second.bound, second.model));
  assert.throws(() => directWidgetProviderSourceV1(first.bound, second.model));
});

test("unsupported drafts and invalid native provider references cannot select a provider", () => {
  for (const mutate of [
    (f) => { f.bound.sourceState = "PUBLISHED"; },
    (f) => { f.bound.draft.content.typeName = "supplementDraft"; },
    (f) => { delete f.bound.draft.content.definition.providerId; },
    (f) => { f.bound.draft.content.definition.providerId = "short"; },
    (f) => { f.bound.draft.content.definition.providerId += "/other"; },
    (f) => { f.bound.draft.content.definition.providerId = [PROVIDER]; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => directDraftWidgetProviderV1(f.bound));
  }
});

test("foreign, ambiguous, incomplete and non-draft provider models fail closed", () => {
  for (const mutate of [
    (f) => { f.model.elements = []; },
    (f) => { f.model.elements[0].id = "q".repeat(22); },
    (f) => { f.model.elements.push(clone(f.model.elements[0])); },
    (f) => { f.model.paging.next = "unread-page"; },
    (f) => { f.model.paging = "unverified-page"; },
    (f) => { f.model.paging = []; },
    (f) => { f.model.paging = { total: 1 }; },
    (f) => { f.model.elements[0].courseId = "Foreign_course"; },
    (f) => { delete f.model.elements[0].draft; },
    (f) => { delete f.model.elements[0].metadata.updatedAt; },
    (f) => { f.model.elements[0].metadata.updatedAt = "unobserved"; },
    (f) => { f.model.elements[0].draft.configuration.accessToken = "synthetic-secret"; },
    (f) => { f.model.elements[0].draft.pageSrc += "&Signature=synthetic-signature"; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => directWidgetProviderSourceV1(f.bound, f.model));
    assert.throws(() => directWidgetProviderTargetsV1(f.bound, f.model));
  }
});

test("linked configuration examples never supply the configured URL or fill a missing target", () => {
  const f = fixture();
  const example = f.model.linked["authoringWidgetSummaries.v1"][0].configurationExamples[0].configuration.url;
  assert(!directWidgetProviderTargetsV1(f.bound, f.model).some((target) => target.url === example));
  delete f.model.elements[0].draft.configuration.url;
  delete f.model.elements[0].draft.pageSrc;
  assert.deepEqual(directWidgetProviderTargetsV1(f.bound, f.model), []);
});

test("configuration and page source keep their independently authored selectors", () => {
  const f = fixture();
  f.model.elements[0].draft.pageSrc = "https://video.example.test/embed?id=page-source&autoplay=false#chapter=2";
  const targets = directWidgetProviderTargetsV1(f.bound, f.model);
  assert.deepEqual(targets.map((target) => [target.sourceField, target.url]), [
    ["draft.configuration.url", f.url],
    ["draft.pageSrc", f.model.elements[0].draft.pageSrc],
  ]);
  for (const invalid of ["javascript:alert(1)", "/relative-target"]) {
    f.model.elements[0].draft.configuration.url = invalid;
    assert(!directWidgetProviderTargetsV1(f.bound, f.model).some((target) => target.sourceField === "draft.configuration.url"));
  }
  f.model.elements[0].draft.configuration.url = "https://user:password@example.test/body";
  assert.throws(() => directWidgetProviderTargetsV1(f.bound, f.model),
    "an unsanitized credential URL cannot be retained as trusted configuration");
});

test("stable bound configuration proof verifies only source configuration, never the external widget", () => {
  const f = fixture();
  assert.equal(directWidgetProviderReceiptValidV1(f.providerReceipt, directDraftWidgetProviderV1(f.bound)), true);
  assert.equal(directWidgetEvidenceValidV1(f.fp, f.bound), true);
  const contract = directWidgetContractV1(f.fp, f.bound);
  assert.equal(contract.sourceConfigurationVerified, true);
  assert.equal(contract.status, "ACCOUNTED_EXTERNAL_TARGET_ONLY");
  assert.equal(contract.complete, false);
  assert.equal(contract.externalBodyVerified, false);
  assert.deepEqual(contract.reasons, ["DIRECT_WIDGET_EXTERNAL_BODY_NOT_OBSERVED"]);
  assert.equal(f.fp.payload.pluginEvidence, undefined);
  assert.equal(f.fp.payload.nativeAssignment, undefined);
});

test("foreign selectors, unstable sources and invented verification cannot pass independent widget proof checks", () => {
  const mutations = [
    (f) => { delete f.fp.payload.directWidgetProviderEvidence; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.courseId = "Foreign_course"; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.itemId = "Another_widget"; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.providerId = "q".repeat(22); },
    (f) => { f.fp.payload.directWidgetProviderEvidence.initial.model.elements[0].id = "q".repeat(22); },
    (f) => { f.fp.payload.directWidgetProviderEvidence.initial.model.elements.push(clone(f.model.elements[0])); },
    (f) => { f.fp.payload.directWidgetProviderEvidence.final.model.elements = []; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.final.model.elements[0].draft.pageSrc += "&changed=true"; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.final.model.elements[0].metadata.updatedAt++; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.stableSource = false; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.final.sourceHash = "e".repeat(64); },
    (f) => { f.fp.payload.directWidgetProviderEvidence.initial.receipt.requestQuery[0][1] = "otherFinder"; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.final.receipt.requestQuery[2][1] = "Foreign_course"; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.final.receipt.requestQuery.push(["courseId", COURSE]); },
    (f) => { f.fp.payload.directWidgetProviderEvidence.final.receipt.requestPath += PROVIDER; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.targets[0].url = "https://examples.example.test/invented"; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.bodyVerified = true; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.launchVerified = true; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.playbackVerified = true; },
    (f) => { f.fp.payload.directWidgetProviderEvidence.wholeWidgetVerified = true; },
    (f) => { f.fp.payload.directDataSources.receipts.stability.stable = false; },
    (f) => { f.fp.payload.directDataSources.relation.elements[0].branchRelationMap[COURSE + "~" + f.fp.id].itemId = "Another_widget"; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture(); mutate(f);
    assert.equal(directWidgetEvidenceValidV1(f.fp, f.bound), false, "Invalid widget proof mutation " + index);
    const contract = directWidgetContractV1(f.fp, f.bound);
    assert.equal(contract.sourceConfigurationVerified, false);
    assert.equal(contract.complete, false);
    assert.equal(contract.externalBodyVerified, false);
    assert.deepEqual(contract.reasons, ["DIRECT_WIDGET_PROVIDER_SOURCE_INVALID"]);
  }
});

test("the fixed same-origin provider finder retains sanitized raw configuration and ordinary URL selectors", async () => {
  const f = fixture(), calls = [];
  f.model.elements[0].draft.configuration.writeAccessToken = "synthetic-secret";
  f.model.elements[0].draft.pageSrc += "&Signature=synthetic-signature&expires=100";
  const raw = JSON.stringify(f.model);
  const reader = createDirectDataReaderV1({
    sanitize: sanitizeCourseraCourseDataModel,
    fetchImpl: async (url, options) => {
      const address = new URL(url); calls.push({ address, options });
      assert.equal(address.origin, "https://www.coursera.org", "configured external URLs must never be fetched");
      return new Response(raw, { headers: { "content-type": "application/json" } });
    },
  });
  const result = await reader.readWidgetProvider(PROVIDER, COURSE);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const { address, options } = calls[0];
  assert.equal(address.pathname, "/api/authoringWidgetSessionProviders.v1/");
  assert.equal(address.searchParams.get("q"), "getWithCourseId");
  assert.equal(address.searchParams.get("widgetSessionProviderId"), PROVIDER);
  assert.equal(address.searchParams.get("courseId"), COURSE);
  assert.equal(address.searchParams.get("includes"), "widgetSummary");
  assert.equal(options.method, "GET");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.redirect, "error");
  assert.equal(result.receipt.resource, "authoringWidgetSessionProviders.v1");
  assert.equal(result.receipt.originalResponseSha256, createHash("sha256").update(raw).digest("hex"));
  assert.equal(result.receipt.bodyFormat, "PARSED_SANITIZED_JSON_MODEL");
  assert(!JSON.stringify(result).includes("synthetic-secret"));
  assert(!JSON.stringify(result).includes("synthetic-signature"));
  assert.equal(result.data.elements[0].draft.configuration.customSetting, "retained setting");
  assert.equal(result.data.elements[0].draft.configuration.autoplay, false);
  assert.equal(result.data.elements[0].draft.pageSrc, f.url);
  const targets = directWidgetProviderTargetsV1(f.bound, result.data);
  assert(targets.every((target) => target.url === f.url));
  assert.equal(calls.length, 1, "projection must not launch a plugin or fetch its body");
});

test("invalid provider/course finder identities make no network request", async () => {
  let calls = 0;
  const reader = createDirectDataReaderV1({ sanitize: sanitizeCourseraCourseDataModel,
    fetchImpl: async () => { calls++; throw Error("Unexpected invalid finder read"); } });
  for (const [providerId, courseId] of [
    ["short", COURSE], [PROVIDER + "/other", COURSE], [PROVIDER + ",other", COURSE],
    [PROVIDER, "../foreign"], [PROVIDER, ""], [PROVIDER, COURSE + "&q=other"],
  ]) assert.equal((await reader.readWidgetProvider(providerId, courseId)).ok, false);
  assert.equal(calls, 0);
});
