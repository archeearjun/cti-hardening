import { createHash } from "node:crypto";
import { bindDirectAuthoringDraftV1 } from "../src/extractors/coursera/direct-data-models.js";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { directCmlMediaInventoryV1 } from "../src/extractors/coursera/direct-data-media-contracts.js";
import { directInlineWidgetBindingsV1, directSourceBindingEvidenceV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { directInlineWidgetProviderSourceV1, directInlineWidgetProviderTargetsV1 } from "../src/extractors/coursera/direct-data-widget.js";
import { directPublisherMediaInventoryV1 } from "../src/extractors/coursera/direct-data-publisher-media.js";
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

/** Exact synthetic browser-CORS JSON response. Its spacing is intentionally
 * noncanonical: the captured publisher response must not be rewritten. */
export function createInlinePublisherContentFixture({ keepHistoricalHtml = false, ...options } = {}) {
  const f = createInlinePublicContentFixture(options),
    chapter = { id: 179, type: "chapter", status: "publish", link: f.finalUrl,
      title: { raw: "Synthetic publisher area", rendered: "Synthetic publisher area" },
      content: { raw: "Publisher authored raw field: [latex]A = L \\times W[/latex]",
        rendered: '<p>Publisher-authored example: area = length × width.</p>' +
          '<p>Keep the literal &lt;drawing&gt; label &amp; original publisher wording.</p>' +
          '<script>window.__CTI_PUBLISHER_HTML_EXECUTED__ = true;</script>' +
          '<img src="https://images.example.test/not-fetched.png" onerror="window.__CTI_PUBLISHER_IMAGE_EXECUTED__=true">' +
          '<iframe src="https://activities.example.test/not-fetched"></iframe>', protected: false },
      excerpt: { rendered: "<p>Publisher-provided excerpt.</p>", protected: false } },
    rawJson = JSON.stringify(chapter, null, 2) + "\n", bytes = new TextEncoder().encode(rawJson),
    endpointUrl = "https://opentextbc.ca/synthetic-book/wp-json/pressbooks/v2/chapters/179",
    model = { kind: "CTI_BROWSER_PUBLISHER_CHAPTER", schemaVersion: 1, statusCoverage: "PARTIAL_PUBLISHER_API_ONLY",
      requestedUrl: f.targetUrl, endpointUrl, observedAt: "2027-01-15T08:00:00.006Z", status: 200,
      mime: "application/json", contentType: "application/json; charset=UTF-8", encoding: "UTF8",
      bytes: bytes.length, sha256: hashBytes(bytes), rawJson },
    publisherObservation = { model, receipt: { transport: "BROWSER_PUBLISHER_API", resource: "PublisherChapter",
      id: f.targetUrl, requestedUrl: f.targetUrl, endpointUrl, origin: "https://opentextbc.ca",
      requestPath: "/synthetic-book/wp-json/pressbooks/v2/chapters/179", requestQuery: [], method: "GET",
      bodyFormat: "ORIGINAL_PUBLISHER_JSON", responseType: "cors", credentials: "omit",
      observedAtBasis: "BROWSER_RESPONSE", observedAt: model.observedAt, receivedAt: "2027-01-15T08:00:00.007Z",
      status: 200, bytes: bytes.length, originalResponseSha256: model.sha256,
      attempts: [{ credentials: "omit", observedAt: model.observedAt, status: 200, responseType: "cors", bytes: bytes.length, reason: "" }] } },
    provider = f.fp.payload.directInlineWidgetProviderEvidence.providers[0];
  provider.publicPages = keepHistoricalHtml ? [{ targetUrl: f.targetUrl,
    sourceFields: provider.targets.map(target => target.sourceField), observation: null,
    retainedObservation: f.observation, failures: [{ reason: "PUBLIC_HTML_NOT_READ_PUBLISHER_API_SELECTED" }] }] : [];
  provider.publisherPages = [{ targetUrl: f.targetUrl, sourceFields: provider.targets.map(target => target.sourceField),
    observation: publisherObservation, failures: [] }];
  return { ...f, publisherObservation, publisherChapter: chapter, publisherRawJson: rawJson };
}

/** Synthetic part contract fixture. This does not establish the response shape
 * of any live publisher; release acceptance requires the separate live probe. */
export function createInlinePublisherPartContentFixture(options = {}) {
  const f = createInlinePublisherContentFixture(options), observation = f.publisherObservation,
    chapterReceipt = structuredClone(observation.receipt),
    part = { ...structuredClone(f.publisherChapter), type: "part", link: f.finalUrl.replace("/chapter/", "/part/") },
    rawJson = JSON.stringify(part, null, 2) + "\n", bytes = new TextEncoder().encode(rawJson),
    endpointUrl = observation.model.endpointUrl.replace("/chapters/", "/parts/");
  Object.assign(chapterReceipt, { observedAt: "2027-01-15T08:00:00.004Z", receivedAt: "", status: 404,
    bytes: 0, originalResponseSha256: "", attempts: [{ credentials: "omit", observedAt: "2027-01-15T08:00:00.004Z",
      status: 404, responseType: "cors", bytes: 0, reason: "PUBLISHER_BROWSER_HTTP_404" }] });
  Object.assign(observation.model, { kind: "CTI_BROWSER_PUBLISHER_PART", endpointUrl,
    bytes: bytes.length, sha256: hashBytes(bytes), rawJson });
  Object.assign(observation.receipt, { resource: "PublisherPart", endpointUrl,
    requestPath: new URL(endpointUrl).pathname, bytes: bytes.length, originalResponseSha256: observation.model.sha256,
    resolution: { method: "CHAPTER_404_TO_PART", chapterReceipt } });
  observation.receipt.attempts[0].bytes = bytes.length;
  return { ...f, publisherPart: part, publisherRawJson: rawJson, publisherPartObservation: observation };
}

/** Synthetic owned images with archive descriptors. The non-enumerable bytes
 * model archive hydration and deliberately disappear from report JSON. */
export function createInlinePublisherMediaContentFixture({ part = false, outcomes = ["CAPTURED", "PUBLISHER_IMAGE_BLOCKED_OR_FAILED"], ...options } = {}) {
  const f = part ? createInlinePublisherPartContentFixture(options) : createInlinePublisherContentFixture(options),
    resource = structuredClone(part ? f.publisherPart : f.publisherChapter), observation = f.publisherObservation,
    urls = outcomes.map((_, index) => "https://opentextbc.ca/synthetic-book/wp-content/uploads/2027/01/drawing-" + index + ".png"),
    html = "<p>Original publisher drawing references.</p>" + urls.map(url => '<img src="' + url + '">').join("");
  resource.content = { raw: html, rendered: html, protected: false };
  const rawJson = JSON.stringify(resource, null, 2) + "\n", jsonBytes = new TextEncoder().encode(rawJson);
  Object.assign(observation.model, { rawJson, bytes: jsonBytes.length, sha256: hashBytes(jsonBytes) });
  observation.receipt.bytes = observation.receipt.attempts[0].bytes = jsonBytes.length;
  observation.receipt.originalResponseSha256 = observation.model.sha256;
  const inventory = directPublisherMediaInventoryV1(observation, f.targetUrl),
    png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")),
    resources = inventory.resources.map((entry, index) => {
      if (outcomes[index] !== "CAPTURED") return { ...entry, reason: outcomes[index] };
      const sha256 = hashBytes(png), body = { archivePath: "files/" + sha256, sha256, size: png.length,
        mime: "image/png", canonicalUrl: entry.url, receipt: { resource: "PublisherImage", transport: "BROWSER_PUBLISHER_IMAGE",
          sourceSha256: observation.model.sha256, requestedUrl: entry.url, finalUrl: entry.url, method: "GET", credentials: "omit",
          responseType: "cors", status: 200, bytes: png.length, mime: "image/png", sha256,
          observedAt: "2027-01-15T08:00:00.008Z", originalContentType: "image/png", bodyFormat: "ORIGINAL_BINARY_BYTES_ARCHIVE" } };
      Object.defineProperty(body, "bytes", { value: png, configurable: true });
      return { ...entry, body };
    }), media = { ...inventory, resources };
  f.fp.payload.directInlineWidgetProviderEvidence.providers[0].publisherPages[0].media = media;
  return { ...f, publisherResource: resource, publisherRawJson: rawJson, publisherMedia: media, publisherMediaBytes: png, publisherImageUrls: urls };
}
