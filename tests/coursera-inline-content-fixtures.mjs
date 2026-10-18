import { createHash } from "node:crypto";
import { bindDirectAuthoringDraftV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { directCmlMediaInventoryV1 } from "../src/extractors/coursera/direct-data-media-contracts.js";
import { directInlineWidgetBindingsV1, directSourceBindingEvidenceV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { directInlineWidgetProviderSourceV1, directInlineWidgetProviderTargetsV1 } from "../src/extractors/coursera/direct-data-widget.js";
import { widgetFixture, WIDGET_COURSE, WIDGET_SLUG, WIDGET_PROVIDER } from "./coursera-direct-widget-fixtures.mjs";

const hashBytes = bytes => createHash("sha256").update(bytes).digest("hex"),
  hash = value => hashBytes(new TextEncoder().encode(directCanonicalSourceTextV1(value)));

/** Synthetic evidence only. The script remains literal source and must never
 * execute in the content view, saved report reload or readable exports. */
export function createInlinePublicContentFixture({ itemId = "InlineReading", atomId = "z".repeat(22) } = {}) {
  const targetUrl = "https://opentextbc.ca/synthetic-book/?p=179/#main",
    finalUrl = "https://opentextbc.ca/synthetic-book/chapter/area/",
    providerId = WIDGET_PROVIDER + "@1", courseId = WIDGET_COURSE,
    f = widgetFixture({ itemId, atomId, url: targetUrl }),
    cml = '<co-content><widget id="' + providerId + '"/></co-content>';
  f.fp.type = "Reading";
  f.fp.typeName = "supplement";
  f.atom.draft.content = { typeName: "supplementDraft", definition: { assetId: "y".repeat(22) + "@1",
    content: { typeName: "cml", definition: { dtdId: "assess/1", value: cml } } } };
  f.fp.name = f.atom.draft.name = "Synthetic embedded lesson";
  f.fp.path = "Synthetic module > Lesson";
  const sources = f.fp.payload.directDataSources;
  sources.receipts.stability.atom.elements[0] = structuredClone(f.atom);
  sources.receipts.stability.draftHash = hash(f.atom.draft);
  sources.receipts.stability.receipt.observedAt = "2027-01-15T08:00:00.010Z";
  const bound = bindDirectAuthoringDraftV1(f.fp, courseId, WIDGET_SLUG, sources.atom, sources.relation),
    binding = directInlineWidgetBindingsV1(f.fp, bound)[0];
  f.model.elements[0].owners = ["COURSE~" + courseId];
  f.providerReceipt.id = providerId;
  f.providerReceipt.requestQuery.find(pair => pair[0] === "widgetSessionProviderId")[1] = providerId;
  const nativeSource = directInlineWidgetProviderSourceV1(binding, f.model),
    initial = { model: structuredClone(f.model), receipt: structuredClone(f.providerReceipt),
      modelHash: hash(f.model), sourceHash: hash(nativeSource) },
    final = structuredClone(initial);
  final.receipt.observedAt = "2027-01-15T08:00:00.005Z";
  const html = '<!doctype html><html><head><title>Synthetic area lesson</title>' +
    '<script>window.__CTI_INLINE_HTML_EXECUTED__ = true;</script></head><body>' +
    '<main><h1>Area of a rectangle</h1><p>Authored example: area = length × width.</p>' +
    '<p>Preserve the literal &lt;drawing&gt; label &amp; original wording.</p>' +
    '<img src="https://images.example.test/not-fetched.png" onerror="window.__CTI_INLINE_IMAGE_EXECUTED__=true">' +
    '<iframe src="https://activities.example.test/not-fetched"></iframe></main></body></html>',
    bytes = new TextEncoder().encode(html),
    model = { kind: "CTI_PUBLIC_STATIC_HTML", schemaVersion: 1, statusCoverage: "PARTIAL_PUBLIC_HTML_ONLY",
      requestedUrl: targetUrl, normalizedUrl: "https://opentextbc.ca/synthetic-book/?p=179",
      finalUrl, redirects: [{ from: "https://opentextbc.ca/synthetic-book/?p=179", to: finalUrl, status: 302 }],
      status: 200, mime: "text/html", contentType: "text/html; charset=utf-8", encoding: "UTF8",
      observedAt: "2027-01-15T08:00:00.006Z", bytes: bytes.length, sha256: hashBytes(bytes), html },
    envelopeBytes = new TextEncoder().encode(directCanonicalSourceTextV1(model)),
    observation = { model, receipt: { transport: "CTI_PUBLIC_BACKEND", serviceOrigin: "https://cti-hardening.pages.dev",
      serviceStatus: 200, resource: "PublicStaticHtml", id: targetUrl, requestedUrl: targetUrl,
      normalizedUrl: model.normalizedUrl, origin: "https://opentextbc.ca", requestPath: "/synthetic-book/",
      requestQuery: [["p", "179"]], bodyFormat: "PARSED_PUBLIC_HTML_ENVELOPE", method: "GET",
      status: 200, observedAtBasis: "UPSTREAM", observedAt: model.observedAt, upstreamRequests: 2,
      upstreamBytes: bytes.length, bytes: envelopeBytes.length, declaredEnvelopeBytes: envelopeBytes.length,
      originalResponseSha256: hashBytes(envelopeBytes),
      receivedAt: "2027-01-15T08:00:00.007Z" } };
  f.fp.payload.directDraftCml = f.atom.draft.content.definition.content;
  f.fp.payload.directDataEvidence = { ...directSourceBindingEvidenceV1(f.fp, bound), rawCmlLength: cml.length,
    rawCmlSha256: hashBytes(new TextEncoder().encode(cml)), plainTextLength: 0, textProjectionVersion: 2,
    assetReferenceCount: 1, assetsBodyVerified: false, unresolvedAssetReferences: directCmlMediaInventoryV1(cml).references };
  f.fp.payload.textSample = "";
  f.fp.payload.textScopeKind = "bound-authoring-draft-cml";
  f.fp.payload.textConfidence = "high";
  f.fp.payload.textCaptureTruncated = false;
  f.fp.payload.textLength = 0;
  f.fp.payload.textSha256 = hashBytes(new Uint8Array());
  f.fp.payload.directAssetEvidence = { method: "BOUND_CML_ASSET_METADATA_AND_BODY", assets: [], missingPointers: [], failures: [] };
  const targets = directInlineWidgetProviderTargetsV1(binding, f.model);
  f.fp.payload.directInlineWidgetProviderEvidence = { method: "BOUND_INLINE_CML_WIDGET_PROVIDERS",
    courseId, itemId, atomId, sourceState: "AUTHORING_DRAFT", providers: [{ ...binding, initial, final,
      stableSource: true, targets, failures: [], bodyVerified: false, playbackVerified: false,
      launchVerified: false, wholeWidgetVerified: false,
      publicPages: [{ targetUrl, sourceFields: targets.map(target => target.sourceField), observation, failures: [] }] }],
    failures: [], bodyVerified: false, playbackVerified: false, launchVerified: false, wholeWidgetVerified: false };
  const contract = { itemId, type: "Reading", attempts: 1, maxAttempts: 1, complete: false, accounted: true,
    needsEditor: false, retryable: false, status: "UNRESOLVED_DIRECT_READING",
    reasons: ["DIRECT_CML_MEDIA_REFERENCE_UNSUPPORTED"], externalBodyVerified: null };
  f.fp.captureContract = contract;
  f.fp.payload.captureContract = contract;
  delete f.fp.payload.directWidgetProviderEvidence;
  const raw = { schemaVersion: 35, extractedAt: "2027-01-15T08:00:00.020Z",
    page: { courseId, url: "https://www.coursera.org/teach/" + WIDGET_SLUG + "/" + courseId + "/content/edit" },
    meta: {}, fingerprints: [f.fp] };
  return { fp: f.fp, courseId, raw, providerId, targetUrl, finalUrl, observation, bound };
}
