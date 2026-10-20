import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { bindDirectAuthoringDraftV1 } from "../extractors/coursera/direct-data-models.js";
import { directInlineWidgetEvidenceV1, directSourceBindingEvidenceV1 } from "../extractors/coursera/direct-data-contracts.js";
import { directPublicHtmlEvidenceV1 } from "../extractors/coursera/direct-data-public-page.js";
import { directPublisherEvidenceV1, directPublisherChapterV1,
  directPublisherResourceEvidenceV1, directPublisherResourceV1 } from "../extractors/coursera/direct-data-publisher.js";
import { directPublisherMediaStructureV1, directPublisherInlineAlternativesV1 } from "../extractors/coursera/direct-data-publisher-media.js";

type Obj = Record<string, any>;
const object = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const canonical = directCanonicalSourceTextV1;
const hashBytes = (value: Uint8Array): string => bytesToHex(sha256(value));
const hash = (value: unknown): string => hashBytes(new TextEncoder().encode(canonical(value)));
export const MAX_INLINE_WIDGET_ITEM_BYTES = 12 * 1024 * 1024;
export const MAX_INLINE_WIDGET_SNAPSHOT_BYTES = 24 * 1024 * 1024;

export interface InlineWidgetPublicPage {
  targetUrl: string;
  sourceFields: string[];
  status: "CAPTURED_PARTIAL_PUBLIC_HTML" | "HISTORICAL_RETAINED_PUBLIC_HTML" | "UNRESOLVED";
  finalUrl: string;
  observedAt: string;
  bytes: number;
  sha256: string;
  failures: string[];
}
export interface InlineWidgetProviderContent {
  providerId: string;
  providerBaseId: string;
  requestedVersion: string;
  occurrences: number;
  configurationObservedAt: string;
  configuredTargets: { url: string; sourceField: string }[];
  publicPages: InlineWidgetPublicPage[];
  publisherPages?: InlineWidgetPublisherPage[];
}
interface InlineWidgetPublisherPageBase {
  readScope?: "NOT_REFETCHED";
  priorFailures?: string[];
  targetUrl: string;
  sourceFields: string[];
  endpointUrl: string;
  observedAt: string;
  bytes: number;
  sha256: string;
  responseType: "cors" | "";
  credentials: "omit" | "include" | "";
  failures: string[];
  media?: InlineWidgetPublisherMedia;
  mediaFailures?: string[];
}
export interface InlineWidgetPublisherFileReference {
  url: string;
  references: { field: string; tag: string; attribute: string; ordinal: number; attributeValue: string }[];
  status: "CAPTURED_ORIGINAL_FILE_REFERENCE" | "UNRESOLVED";
  originalRef: string;
  observedAt: string;
  bytes: number | null;
  mime: string;
  sha256: string;
  reason: string;
  attempts?: [
    { transport: "BROWSER_PUBLISHER_IMAGE"; observedAt: string; status: 0; responseType: "unreadable"; reason: string },
    { transport: "CTI_SERVICE_PUBLIC_IMAGE"; observedAt: string; serviceOrigin: string; serviceStatus: number;
      upstreamStatus: number; upstreamObservedAt: string; upstreamRequests: number; upstreamBytes: number; reason: string;
      upstreamChallenge?: "cloudflare";
      notAttempted?: "ORIGIN_CHALLENGE";
      blockedBy?: { url: string; observedAt: string } },
  ];
  acquisition?: {
    transport: "CTI_SERVICE_PUBLIC_IMAGE";
    responseType: "service";
    observedAtBasis: "BROWSER_RESPONSE";
    serviceOrigin: string;
    serviceStatus: number;
    upstreamStatus: number;
    upstreamObservedAt: string;
    upstreamBytes: number;
    browserAttempt: { transport: "BROWSER_PUBLISHER_IMAGE"; observedAt: string; status: 0; responseType: "unreadable"; reason: string };
  };
  firstPartyAcquisition?: {
    transport: "FIRST_PARTY_BROWSER";
    responseType: "basic";
    credentials: "same-origin";
    collectorContext: "PROVIDER_PAGE_BROWSER";
    origin: string;
    responseObservedAt: string;
    planSha256: string;
    sessionId: string;
  };
  firstPartyAttempt?: InlineWidgetPublisherFirstPartyAttempt;
  priorFailures?: { reason: string; attempts?: InlineWidgetPublisherFileReference["attempts"]; firstPartyAttempt?: InlineWidgetPublisherFirstPartyAttempt }[];
}
export interface InlineWidgetPublisherFirstPartyAttempt {
  transport: "FIRST_PARTY_BROWSER";
  origin: string;
  requestedUrl: string;
  method: "GET";
  credentials: "same-origin";
  mode: "same-origin";
  collectorContext: "PROVIDER_PAGE_BROWSER";
  firstPartyBinding: { courseId: string; itemId: string; atomId: string; providerId: string; targetUrl: string; sourceSha256: string; planSha256: string; sessionId: string };
  attemptedAt: string;
  requestAttempted: boolean;
  reason: string;
  observedBytes: number;
  status: number;
  responseType: "basic" | "unreadable";
  observedAt?: string;
  challenge?: "cloudflare";
}
export interface InlineWidgetPublisherMedia {
  linkedInlineAlternatives?: {linkedUrl:string;inlineUrl:string;inlineSha256:string;relationship:string;replacesLinkedOriginal:boolean}[];
  scope: "ORIGINAL_FILE_REFERENCES_ONLY";
  sourceSha256: string;
  resources: InlineWidgetPublisherFileReference[];
  retainedSources: { sourceSha256: string; observedAt: string; resources: InlineWidgetPublisherFileReference[] }[];
  failures: string[];
}
export interface InlineWidgetPublisherChapterPage extends InlineWidgetPublisherPageBase {
  status: "CAPTURED_PUBLISHER_API_CHAPTER" | "HISTORICAL_RETAINED_PUBLISHER_API_CHAPTER" | "UNRESOLVED";
  chapterId: number | null;
  chapterLink: string;
}
export interface InlineWidgetPublisherPartPage extends InlineWidgetPublisherPageBase {
  status: "CAPTURED_PUBLISHER_API_PART" | "HISTORICAL_RETAINED_PUBLISHER_API_PART";
  resourceType: "part";
  resourceId: number;
  resourceLink: string;
}
export interface InlineWidgetPublisherBackMatterPage extends InlineWidgetPublisherPageBase {
  status: "CAPTURED_PUBLISHER_API_BACK_MATTER" | "HISTORICAL_RETAINED_PUBLISHER_API_BACK_MATTER";
  resourceType: "back-matter";
  resourceId: number;
  resourceLink: string;
}
export type InlineWidgetPublisherPage = InlineWidgetPublisherChapterPage | InlineWidgetPublisherPartPage | InlineWidgetPublisherBackMatterPage;
export interface CourseraInlineWidgetContent {
  schemaVersion: 1;
  scope: "INLINE_CONFIGURATION_AND_PARTIAL_PUBLIC_HTML" | "INLINE_CONFIGURATION_AND_PARTIAL_PUBLISHER_CONTENT";
  courseId: string;
  itemId: string;
  atomId: string;
  draftHash: string;
  providers: InlineWidgetProviderContent[];
  failures: { providerId: string; reason: string }[];
  proof: { item: Obj; courseId: string; evidence: Obj; sources: Obj; inlineProviderEvidence: Obj; resumeRevalidation?: unknown };
}

/** Bound untrusted structure and strings before JSON serialization or hashing. */
export function courseraInlineWidgetContentSize(value: unknown): number {
  const pending = [{ value, depth: 0 }];
  let nodes = 0, characters = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++nodes > 200000 || next.depth > 100) throw Error("Embedded-page evidence exceeds its review limit.");
    if (typeof next.value === "string") characters += next.value.length;
    else if (next.value !== null && typeof next.value === "object") {
      const keys = Object.keys(next.value);
      if (keys.length + pending.length > 200000) throw Error("Embedded-page evidence exceeds its review limit.");
      for (const key of keys) {
        characters += key.length;
        pending.push({ value: (next.value as Obj)[key], depth: next.depth + 1 });
      }
    }
    if (characters > MAX_INLINE_WIDGET_ITEM_BYTES) throw Error("Embedded-page evidence exceeds its review limit.");
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string" || serialized.length > MAX_INLINE_WIDGET_ITEM_BYTES)
    throw Error("Embedded-page evidence exceeds its review limit.");
  const size = new TextEncoder().encode(serialized).length;
  if (size > MAX_INLINE_WIDGET_ITEM_BYTES) throw Error("Embedded-page evidence exceeds its review limit.");
  return size;
}

function proofFor(item: unknown, courseId: string): CourseraInlineWidgetContent["proof"] {
  const f = object(item), p = object(f.payload);
  return { item: { id: f.id, typeName: f.typeName, atomId: f.atomId, contentId: f.contentId }, courseId,
    evidence: object(p.directDataEvidence), sources: object(p.directDataSources),
    inlineProviderEvidence: object(p.directInlineWidgetProviderEvidence),
    ...(p.directResumeRevalidation === undefined ? {} : { resumeRevalidation: p.directResumeRevalidation }) };
}

/** Snapshots retain owned archive descriptors, not image bytes or a persisted
 * import attestation. Actual byte validation belongs to archive acceptance. */
function publisherMediaContent(observation: Obj | null, targetUrl: string, media: unknown, finalAtomAt: number, nativeBinding: Obj): {
  content: InlineWidgetPublisherMedia; historicalJsonBytes: number;
} {
  const unavailable = (reason: string) => ({ content: { scope: "ORIGINAL_FILE_REFERENCES_ONLY" as const,
    sourceSha256: text(observation?.model?.sha256), resources: [], retainedSources: [], failures: [reason] }, historicalJsonBytes: 0 });
  try {
    const checked = observation && directPublisherMediaStructureV1(observation, targetUrl, media, nativeBinding);
    if (!checked) return unavailable("PUBLISHER_IMAGE_MEDIA_EVIDENCE_INVALID");
    const resources = (values: Obj[]): InlineWidgetPublisherFileReference[] => values.map(value => {
      const body = object(value.body);
      if (value.body && Date.parse(body.receipt?.observedAt) > finalAtomAt) throw Error("PUBLISHER_IMAGE_SOURCE_TIME_INVALID");
      return { url: value.url, references: value.references.map((reference: Obj) => ({ field: reference.field,
        tag: reference.tag, attribute: reference.attribute, ordinal: reference.ordinal, attributeValue: reference.attributeValue })),
      status: value.body ? "CAPTURED_ORIGINAL_FILE_REFERENCE" : "UNRESOLVED",
      originalRef: value.body ? body.archivePath : "", observedAt: value.body ? body.receipt.observedAt : "",
      bytes: value.body ? body.size : null, mime: value.body ? body.mime : "", sha256: value.body ? body.sha256 : "",
      reason: text(value.reason),
      ...(value.attempts === undefined ? {} : { attempts: value.attempts.map((attempt: Obj) => ({ ...attempt })) as InlineWidgetPublisherFileReference["attempts"] }),
      ...(value.priorFailures === undefined ? {} : { priorFailures: value.priorFailures.map((failure: Obj) => ({ reason: failure.reason,
        ...(failure.firstPartyAttempt === undefined ? {} : { firstPartyAttempt: {...failure.firstPartyAttempt,firstPartyBinding:{...failure.firstPartyAttempt.firstPartyBinding}} }),
        ...(failure.attempts === undefined ? {} : { attempts: failure.attempts.map((attempt: Obj) => ({ ...attempt })) }) })) }),
      ...(value.firstPartyAttempt === undefined ? {} : { firstPartyAttempt: {...value.firstPartyAttempt,firstPartyBinding:{...value.firstPartyAttempt.firstPartyBinding}} }),
      ...(body.receipt?.transport === "FIRST_PARTY_BROWSER" ? { firstPartyAcquisition: {
        transport: "FIRST_PARTY_BROWSER" as const, responseType: "basic" as const, credentials: "same-origin" as const,
        collectorContext: "PROVIDER_PAGE_BROWSER" as const, origin: body.receipt.origin,
        responseObservedAt: body.receipt.responseObservedAt,
        planSha256: body.receipt.firstPartyBinding.planSha256, sessionId: body.receipt.firstPartyBinding.sessionId,
      } } : {}),
      ...(body.receipt?.transport === "CTI_SERVICE_PUBLIC_IMAGE" ? { acquisition: {
        transport: "CTI_SERVICE_PUBLIC_IMAGE" as const, responseType: "service" as const,
        observedAtBasis: "BROWSER_RESPONSE" as const, serviceOrigin: body.receipt.serviceOrigin,
        serviceStatus: body.receipt.serviceStatus, upstreamStatus: body.receipt.upstreamStatus,
        upstreamObservedAt: body.receipt.upstreamObservedAt, upstreamBytes: body.receipt.upstreamBytes,
        browserAttempt: { transport: "BROWSER_PUBLISHER_IMAGE" as const, observedAt: body.receipt.browserAttempt.observedAt,
          status: 0 as const, responseType: "unreadable" as const, reason: body.receipt.browserAttempt.reason },
      } } : {}) };
    });
    let historicalJsonBytes = 0;
    const retainedSources: InlineWidgetPublisherMedia["retainedSources"] = [];
    for (const group of checked.retained || []) {
      const source = directPublisherResourceEvidenceV1(group.observation, targetUrl, hashBytes);
      if (!source || Date.parse(source.receipt.observedAt) > finalAtomAt || Date.parse(source.receipt.receivedAt) > finalAtomAt)
        return unavailable("PUBLISHER_IMAGE_HISTORICAL_SOURCE_INVALID");
      historicalJsonBytes += source.model.bytes;
      retainedSources.push({ sourceSha256: source.model.sha256, observedAt: source.model.observedAt, resources: resources(group.resources) });
    }
    const alternatives = directPublisherInlineAlternativesV1(observation,targetUrl,checked);
    return { content: { scope: "ORIGINAL_FILE_REFERENCES_ONLY", sourceSha256: checked.sourceSha256,
      resources: resources(checked.resources), retainedSources,
      ...(alternatives.length ? {linkedInlineAlternatives: alternatives} : {}),
      failures: checked.failures.map((failure: Obj) => text(failure.reason)).filter((reason: string) => /^[A-Z0-9_]{1,96}$/.test(reason)) }, historicalJsonBytes };
  } catch { return unavailable("PUBLISHER_IMAGE_MEDIA_EVIDENCE_INVALID"); }
}

/** Conservative reservation lets the snapshot apply an aggregate limit before
 * deriving another item's source or HTML hashes. HTML is retained only once. */
export function courseraInlineWidgetItemReservation(item: unknown, courseId: string): number {
  return 2 * courseraInlineWidgetContentSize(proofFor(item, courseId));
}

function derive(proof: CourseraInlineWidgetContent["proof"]): CourseraInlineWidgetContent | null {
  try {
    courseraInlineWidgetContentSize(proof);
    const fp = { ...proof.item, payload: { directDataSources: proof.sources,
      directDataEvidence: proof.evidence, directInlineWidgetProviderEvidence: proof.inlineProviderEvidence,
      ...(proof.resumeRevalidation === undefined ? {} : { directResumeRevalidation: proof.resumeRevalidation }) } },
      branch = proof.sources.relation?.elements?.[0]?.branchRelationMap?.[proof.courseId + "~" + proof.item.id],
      bound = bindDirectAuthoringDraftV1(fp, proof.courseId, branch?.courseSlug, proof.sources.atom, proof.sources.relation),
      source = directSourceBindingEvidenceV1(fp, bound),
      checked = directInlineWidgetEvidenceV1(fp, bound, hash);
    if (!source || !checked || Object.entries(source).some(([key, value]) => proof.evidence[key] !== value)) return null;
    let retainedPublicBytes = 0, hasPublisherPages = false;
    const providers: InlineWidgetProviderContent[] = [];
    for (const validated of checked.providers) {
      const binding = validated.binding, original = list(proof.inlineProviderEvidence.providers)
        .find(value => value?.providerId === binding.providerId),
        targets = validated.targets.map((value: Obj) => ({ url: text(value.url), sourceField: text(value.sourceField) })),
        pages = list(original?.publicPages), seen = new Set<string>(), publicPages: InlineWidgetPublicPage[] = [];
      if (pages.length > targets.length) return null;
      for (const rawPage of pages) {
        const entry = object(rawPage), targetUrl = text(entry.targetUrl),
          fields = targets.filter(value => value.url === targetUrl).map(value => value.sourceField);
        if (!fields.length || seen.has(targetUrl) || canonical(entry.sourceFields) !== canonical(fields) ||
            !Array.isArray(entry.failures) || entry.failures.length > 32) return null;
        seen.add(targetUrl);
        const observation = entry.observation === null ? null : directPublicHtmlEvidenceV1(entry.observation, targetUrl, hashBytes),
          hasRetained = entry.retainedObservation !== undefined,
          retained = hasRetained ? directPublicHtmlEvidenceV1(entry.retainedObservation, targetUrl, hashBytes) : null;
        if (entry.observation !== null && !observation) return null;
        if (observation && entry.failures.length) return null;
        if (hasRetained && (!retained || observation || !entry.failures.length && entry.readScope !== "NOT_REFETCHED")) return null;
        const selected = observation || retained, model = object(selected?.model);
        if (selected && (retainedPublicBytes += model.bytes) > 8 * 1024 * 1024) return null;
        publicPages.push({ targetUrl, sourceFields: fields,
          status: observation ? "CAPTURED_PARTIAL_PUBLIC_HTML" : retained ? "HISTORICAL_RETAINED_PUBLIC_HTML" : "UNRESOLVED",
          finalUrl: selected ? model.finalUrl : "", observedAt: selected ? model.observedAt : "",
          bytes: selected ? model.bytes : 0, sha256: selected ? model.sha256 : "",
          failures: entry.failures.map((failure: unknown) => text(object(failure).reason))
            .filter(reason => /^[A-Z0-9_]{1,96}$/.test(reason)) });
      }
      let publisherPages: InlineWidgetPublisherPage[] | undefined;
      if (original?.publisherPages !== undefined) {
        hasPublisherPages = true;
        if (!Array.isArray(original.publisherPages) || original.publisherPages.length > targets.length) return null;
        publisherPages = [];
        const seenPublisherTargets = new Set<string>();
        for (const rawPage of original.publisherPages) {
          const entry = object(rawPage), targetUrl = text(entry.targetUrl),
            fields = targets.filter(value => value.url === targetUrl).map(value => value.sourceField);
          if (!fields.length || seenPublisherTargets.has(targetUrl) || canonical(entry.sourceFields) !== canonical(fields) ||
              !Array.isArray(entry.failures) || entry.failures.length > 32) return null;
          seenPublisherTargets.add(targetUrl);
          const observation = entry.observation === null ? null : directPublisherResourceEvidenceV1(entry.observation, targetUrl, hashBytes),
            hasRetained = entry.retainedObservation !== undefined,
            retained = hasRetained ? directPublisherResourceEvidenceV1(entry.retainedObservation, targetUrl, hashBytes) : null;
          if (entry.observation !== null && !observation || observation && entry.failures.length ||
              hasRetained && (!retained || observation || !entry.failures.length && entry.readScope !== "NOT_REFETCHED")) return null;
          const selected = observation || retained, model = object(selected?.model),
            resourceType = model.kind === "CTI_BROWSER_PUBLISHER_BACK_MATTER" ? "back-matter" : model.kind === "CTI_BROWSER_PUBLISHER_PART" ? "part" : "chapter",
            resource = selected ? directPublisherResourceV1(model.rawJson, targetUrl, resourceType) : null;
          if (selected && (!resource || (retainedPublicBytes += model.bytes) > 8 * 1024 * 1024)) return null;
          if (selected) {
            const finalAtomAt = Date.parse(proof.sources.receipts.stability.receipt.observedAt);
            // These clocks belong to the same collecting browser. Server HTML
            // observations deliberately do not take part in this comparison.
            if (Date.parse(selected.receipt.observedAt) > finalAtomAt ||
                Date.parse(selected.receipt.receivedAt) > finalAtomAt) return null;
          }
          let media: InlineWidgetPublisherMedia | undefined;
          if (entry.media !== undefined) {
            const projected = publisherMediaContent(selected, targetUrl, entry.media, Date.parse(proof.sources.receipts.stability.receipt.observedAt),
              {courseId:proof.courseId,itemId:proof.item.id,atomId:proof.item.atomId,providerId:binding.providerId});
            if (retainedPublicBytes + projected.historicalJsonBytes > 8 * 1024 * 1024)
              media = { scope: "ORIGINAL_FILE_REFERENCES_ONLY", sourceSha256: text(model.sha256), resources: [], retainedSources: [], failures: ["PUBLISHER_IMAGE_HISTORICAL_SOURCE_BYTE_LIMIT"] };
            else { media = projected.content; retainedPublicBytes += projected.historicalJsonBytes; }
          }
          publisherPages.push({ targetUrl, sourceFields: fields,
            ...(entry.readScope === "NOT_REFETCHED" ? {readScope: "NOT_REFETCHED" as const} : {}),
            ...(Array.isArray(entry.priorFailures) ? {priorFailures: entry.priorFailures.slice(0,32).map((f: Obj)=>text(f.reason)).filter((r:string)=>/^[A-Z0-9_]{1,96}$/.test(r))} : {}),
            status: resourceType === "back-matter" && selected
              ? observation ? "CAPTURED_PUBLISHER_API_BACK_MATTER" : "HISTORICAL_RETAINED_PUBLISHER_API_BACK_MATTER"
              : resourceType === "part" && selected
              ? observation ? "CAPTURED_PUBLISHER_API_PART" : "HISTORICAL_RETAINED_PUBLISHER_API_PART"
              : observation ? "CAPTURED_PUBLISHER_API_CHAPTER" : retained ? "HISTORICAL_RETAINED_PUBLISHER_API_CHAPTER" : "UNRESOLVED",
            endpointUrl: selected ? model.endpointUrl : "",
            ...(resourceType === "back-matter" && resource ? { resourceType: "back-matter" as const, resourceId: resource.id, resourceLink: resource.link }
              : resourceType === "part" && resource ? { resourceType: "part" as const, resourceId: resource.id, resourceLink: resource.link }
              : { chapterId: resource?.id ?? null, chapterLink: resource?.link ?? "" }),
            observedAt: selected ? model.observedAt : "",
            bytes: selected ? model.bytes : 0, sha256: selected ? model.sha256 : "",
            responseType: selected ? "cors" : "", credentials: selected ? selected.receipt.credentials : "",
            failures: entry.failures.map((failure: unknown) => text(object(failure).reason))
              .filter(reason => /^[A-Z0-9_]{1,96}$/.test(reason)),
            ...(media === undefined ? {} : { media }),
            ...(entry.mediaFailures === undefined ? {} : { mediaFailures: Array.isArray(entry.mediaFailures) && entry.mediaFailures.length <= 32 &&
              entry.mediaFailures.every((failure: Obj) => /^[A-Z0-9_]{1,96}$/.test(text(failure?.reason)))
              ? entry.mediaFailures.map((failure: Obj) => failure.reason) : ["PUBLISHER_IMAGE_FAILURE_EVIDENCE_INVALID"] }) } as InlineWidgetPublisherPage);
        }
      }
      providers.push({ providerId: binding.providerId, providerBaseId: binding.providerBaseId,
        requestedVersion: binding.requestedVersion, occurrences: binding.occurrences,
        configurationObservedAt: validated.final.receipt.observedAt, configuredTargets: targets, publicPages,
        ...(publisherPages === undefined ? {} : { publisherPages }) });
    }
    return { schemaVersion: 1, scope: hasPublisherPages ? "INLINE_CONFIGURATION_AND_PARTIAL_PUBLISHER_CONTENT" : "INLINE_CONFIGURATION_AND_PARTIAL_PUBLIC_HTML",
      courseId: proof.courseId, itemId: proof.item.id, atomId: proof.item.atomId, draftHash: source.draftHash,
      providers, failures: checked.failures, proof };
  } catch { return null; }
}

export function courseraInlineWidgetContent(item: unknown, courseId: string): CourseraInlineWidgetContent | null {
  if (!object(object(item).payload).directInlineWidgetProviderEvidence || !courseId) return null;
  return derive(proofFor(item, courseId));
}

export function validateCourseraInlineWidgetContent(value: unknown, itemId: string, courseId: string): asserts value is CourseraInlineWidgetContent {
  courseraInlineWidgetContentSize(value);
  const derived = derive(object(object(value).proof) as CourseraInlineWidgetContent["proof"]);
  // Older immutable snapshots predate the optional relationship projection.
  // Missing enrichment is allowed; any supplied relationship must still equal
  // the independently derived authored link/image pair.
  if (derived) for (const [i, provider] of derived.providers.entries()) for (const [j, page] of (provider.publisherPages || []).entries()) {
    if (page.media && object(value).providers?.[i]?.publisherPages?.[j]?.media?.linkedInlineAlternatives === undefined)
      delete page.media.linkedInlineAlternatives;
  }
  if (!derived || !courseId || derived.courseId !== courseId || derived.itemId !== itemId || canonical(value) !== canonical(derived))
    throw Error("Captured embedded-page content differs from its native configuration or publisher source evidence.");
}

/** The preview is inert plain text. Original HTML remains literal in the proof;
 * this approximation does not establish rendered text, math, media or runtime. */
export function inlineWidgetStaticHtmlText(html: string): string {
  // A malformed opener must stop at the next '<'. Allowing attribute matches
  // to cross it repeatedly rescans an unclosed-tag run with quadratic cost.
  return html.replace(/<!--[^]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template|noscript)\b[^<>]*>[^]*?(?:<\/\1\s*>|$)/gi, "")
    .replace(/<\/?(?:p|div|br|li|h[1-6]|tr|section|article|main|header|footer)\b[^<>]*>/gi, "\n")
    .replace(/<\/?[A-Za-z][^<>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (all, entity: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? all;
      const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
    }).trim();
}

export function courseraInlineWidgetPage(content: CourseraInlineWidgetContent, providerId: string, targetUrl: string): { html: string; text: string; historical: boolean } | null {
  const provider = content.providers.find(value => value.providerId === providerId),
    page = provider?.publicPages.find(value => value.targetUrl === targetUrl && value.status !== "UNRESOLVED"),
    raw = list(content.proof.inlineProviderEvidence.providers).find(value => value?.providerId === providerId),
    entry = list(raw?.publicPages).find(value => value?.targetUrl === targetUrl),
    historical = page?.status === "HISTORICAL_RETAINED_PUBLIC_HTML",
    observation = historical ? entry?.retainedObservation : entry?.observation,
    checked = page && directPublicHtmlEvidenceV1(observation, targetUrl, hashBytes);
  if (!checked || checked.model.sha256 !== page!.sha256 || checked.model.bytes !== page!.bytes) return null;
  return { html: checked.model.html, text: inlineWidgetStaticHtmlText(checked.model.html), historical };
}

/** Parse only independently verified publisher JSON. Returned author fields
 * remain source strings; no HTML, notation or absent content is fabricated. */
export function courseraInlinePublisherPage(content: CourseraInlineWidgetContent, providerId: string, targetUrl: string): { rawJson: string; chapter: Obj; historical: boolean } | null {
  const provider = content.providers.find(value => value.providerId === providerId),
    page = provider?.publisherPages?.find((value): value is InlineWidgetPublisherChapterPage =>
      value.targetUrl === targetUrl && value.status !== "UNRESOLVED" && !("resourceType" in value)),
    raw = list(content.proof.inlineProviderEvidence.providers).find(value => value?.providerId === providerId),
    entry = list(raw?.publisherPages).find(value => value?.targetUrl === targetUrl),
    historical = page?.status === "HISTORICAL_RETAINED_PUBLISHER_API_CHAPTER",
    observation = historical ? entry?.retainedObservation : entry?.observation,
    checked = page && directPublisherEvidenceV1(observation, targetUrl, hashBytes),
    chapter = checked && directPublisherChapterV1(checked.model.rawJson, targetUrl);
  if (!checked || !chapter || checked.model.sha256 !== page!.sha256 || checked.model.bytes !== page!.bytes ||
      checked.model.endpointUrl !== page!.endpointUrl || chapter.id !== page!.chapterId || chapter.link !== page!.chapterLink) return null;
  return { rawJson: checked.model.rawJson, chapter, historical };
}

/** Book sections and back matter are distinct publisher resources. The legacy chapter accessor above
 * remains chapter-only and retains its original return shape. */
export function courseraInlinePublisherResource(content: CourseraInlineWidgetContent, providerId: string, targetUrl: string): {
  rawJson: string; resource: Obj; resourceType: "chapter" | "part" | "back-matter"; historical: boolean;
} | null {
  const provider = content.providers.find(value => value.providerId === providerId),
    page = provider?.publisherPages?.find(value => value.targetUrl === targetUrl && value.status !== "UNRESOLVED");
  if (!page) return null;
  if (!("resourceType" in page)) {
    const original = courseraInlinePublisherPage(content, providerId, targetUrl);
    return original ? { rawJson: original.rawJson, resource: original.chapter, resourceType: "chapter", historical: original.historical } : null;
  }
  const raw = list(content.proof.inlineProviderEvidence.providers).find(value => value?.providerId === providerId),
    entry = list(raw?.publisherPages).find(value => value?.targetUrl === targetUrl),
    historical = page.status === "HISTORICAL_RETAINED_PUBLISHER_API_PART" || page.status === "HISTORICAL_RETAINED_PUBLISHER_API_BACK_MATTER",
    checked = directPublisherResourceEvidenceV1(historical ? entry?.retainedObservation : entry?.observation, targetUrl, hashBytes),
    resource = checked && directPublisherResourceV1(checked.model.rawJson, targetUrl, page.resourceType);
  if (!checked || checked.model.kind !== (page.resourceType === "back-matter" ? "CTI_BROWSER_PUBLISHER_BACK_MATTER" : "CTI_BROWSER_PUBLISHER_PART") || !resource ||
      checked.model.sha256 !== page.sha256 || checked.model.bytes !== page.bytes || checked.model.endpointUrl !== page.endpointUrl ||
      resource.id !== page.resourceId || resource.link !== page.resourceLink) return null;
  return { rawJson: checked.model.rawJson, resource, resourceType: page.resourceType, historical };
}

export function courseraInlineWidgetContentText(content: CourseraInlineWidgetContent): string {
  const out = ["CAPTURED EMBEDDED PAGES", "Native configuration and separately retained publisher sources only. Dynamic interactions, images, media and whole-widget completeness remain unverified.",
    `Course ${content.courseId} | item ${content.itemId} | atom ${content.atomId} | draft SHA-256 ${content.draftHash}`];
  for (const provider of content.providers) {
    out.push(`Provider selector: ${provider.providerId} | response base ID: ${provider.providerBaseId} | requested version ${provider.requestedVersion} (selected by request; not echoed by response)`,
      `Configuration observed: ${provider.configurationObservedAt}`,
      ...provider.configuredTargets.map(target => `Configured ${target.sourceField}: ${target.url}`));
    for (const page of provider.publicPages) {
      out.push(`Public page: ${page.targetUrl} | ${page.status}`);
      if (page.status !== "UNRESOLVED") {
        out.push(`Final URL: ${page.finalUrl}`, `Observed: ${page.observedAt} | ${page.bytes} bytes | SHA-256 ${page.sha256}`);
        const original = courseraInlineWidgetPage(content, provider.providerId, page.targetUrl);
        if (original) out.push(original.historical
          ? "Earlier retained public HTML (no current HTML observation; content freshness unverified):"
          : "Inert static text preview (rendering and runtime unverified):", original.text);
      }
      out.push(...page.failures.map(reason => `Current read outcome: ${reason}`));
    }
    for (const page of provider.publisherPages || []) {
      const typed = "resourceType" in page, resourceLabel = typed ? page.resourceType === "back-matter" ? "back matter" : "book section" : "chapter";
      out.push(`Publisher API ${resourceLabel} content: ${page.targetUrl} | ${page.status}`);
      if (page.status !== "UNRESOLVED") {
        out.push(`API endpoint: ${page.endpointUrl}`, typed
          ? `Publisher ${resourceLabel} ID: ${page.resourceId} | published ${resourceLabel} link: ${page.resourceLink}`
          : `Publisher chapter ID: ${page.chapterId} | published chapter link: ${page.chapterLink}`,
          `Observed: ${page.observedAt} | ${page.bytes} original JSON UTF-8 bytes | SHA-256 ${page.sha256}`,
          `Browser response: ${page.responseType}; credentials mode: ${page.credentials}.`);
        const original = courseraInlinePublisherResource(content, provider.providerId, page.targetUrl);
        if (original) {
          out.push(original.historical ? `Earlier publisher API observation retained; no current ${resourceLabel} response is established.`
            : `Publisher-provided ${resourceLabel} fields; partial content only.`);
          for (const field of ["title", "content", "excerpt"]) {
            for (const format of ["raw", "rendered"]) {
              const value = original.resource[field]?.[format];
              if (typeof value === "string") out.push(`Publisher ${field}.${format} ${format === "rendered" ? "(inert plain-text approximation; inspect original JSON for exact markup)" : "(literal authored field)"}:`,
                format === "rendered" ? inlineWidgetStaticHtmlText(value) : value);
            }
          }
        }
      }
      if (page.media) {
        out.push("Publisher original-file references: original bytes are not embedded in this report snapshot.",
          `Parent publisher JSON SHA-256: ${page.media.sourceSha256}`);
        for (const group of [{ sourceSha256: page.media.sourceSha256, observedAt: "", resources: page.media.resources }, ...page.media.retainedSources]) {
          if (group.observedAt) out.push(`Earlier publisher source observed: ${group.observedAt} | SHA-256 ${group.sourceSha256}`);
          for (const resource of group.resources) {
            out.push(`Publisher image source: ${resource.url} | ${resource.status}`);
            if (resource.originalRef) out.push(`Captured original file reference: ${resource.originalRef} | ${resource.bytes} bytes | ${resource.mime} | SHA-256 ${resource.sha256}`,
              `Original file read observed: ${resource.observedAt}`);
            if (resource.acquisition) out.push(`Image acquisition: ${resource.acquisition.transport} | response: ${resource.acquisition.responseType} | collector-declared service context`,
              `Service: ${resource.acquisition.serviceOrigin} | HTTP ${resource.acquisition.serviceStatus}; upstream HTTP ${resource.acquisition.upstreamStatus}`,
              `Upstream observed (service clock): ${resource.acquisition.upstreamObservedAt} | ${resource.acquisition.upstreamBytes} bytes`,
              `Browser attempt: ${resource.acquisition.browserAttempt.reason}; response unreadable, HTTP status unavailable.`,
              "Transport records describe the collection route; authentication and independent attestation are unverified.");
            if (resource.firstPartyAcquisition) out.push(
              `Image acquisition: FIRST_PARTY_BROWSER | basic response | same-origin | provider page ${resource.firstPartyAcquisition.origin}`,
              `Provider response observed: ${resource.firstPartyAcquisition.responseObservedAt}; original bytes retained: ${resource.observedAt}`,
              `Frozen recovery plan SHA-256: ${resource.firstPartyAcquisition.planSha256}`,
              "Provider-page browser context is collector-declared; it is not independent HTTP attestation or proof of complete widget behavior.");
            for (const attempt of [resource.firstPartyAttempt,...(resource.priorFailures || []).map(earlier => earlier.firstPartyAttempt)].filter(Boolean) as InlineWidgetPublisherFirstPartyAttempt[]) out.push(
              `Provider-page image attempt: ${attempt.attemptedAt} | ${attempt.reason} | ${attempt.observedBytes} observed bytes`,
              attempt.status ? `Provider response: HTTP ${attempt.status} | ${attempt.observedAt}${attempt.challenge ? " | Cloudflare challenge" : ""}` : "No publisher HTTP response was exposed for this attempt.");
            for (const earlier of resource.priorFailures || []) out.push(`Earlier publisher image read outcome retained: ${earlier.reason}`,
              ...(earlier.attempts ? earlier.attempts.map(attempt => `Earlier image attempt: ${attempt.transport} | ${attempt.observedAt} | ${attempt.reason}`) : []));
            if (resource.attempts) {
              const [browser, service] = resource.attempts;
              out.push(`Browser image attempt: ${browser.observedAt} | response unreadable; HTTP status unavailable | ${browser.reason}`);
              if (service.notAttempted === "ORIGIN_CHALLENGE") out.push(
                "CTI image service not attempted: a publisher challenge stopped further service reads to this origin during this capture. No publisher HTTP result was observed for this skipped read.",
                `Earlier challenge: ${service.blockedBy?.url} | browser receipt ${service.blockedBy?.observedAt}`);
              else out.push(
                `CTI public image attempt: ${service.observedAt} | service ${service.serviceOrigin} | ${service.serviceStatus ? "HTTP " + service.serviceStatus : "HTTP status unavailable"} | ${service.reason}`,
                `Collector-declared upstream result: ${service.upstreamStatus ? "HTTP " + service.upstreamStatus : "HTTP status unavailable"}${service.upstreamObservedAt ? " | service clock " + service.upstreamObservedAt : ""}`);
              if (service.upstreamChallenge === "cloudflare") out.push(
                "Publisher returned a Cloudflare challenge. Image bytes were not captured; the challenge was not retried or solved.");
            }
            for (const reference of resource.references) out.push(`Authored ${reference.tag}.${reference.attribute} in ${reference.field}, reference ${reference.ordinal}: ${reference.attributeValue}`);
            if (resource.reason) out.push(`Publisher image read outcome: ${resource.reason}`);
          }
        }
        out.push(...page.media.failures.map(reason => reason === "PUBLISHER_IMAGE_SRCSET_ALTERNATIVES_NOT_SELECTED"
          ? `Responsive image alternatives remain unverified; observed src read outcomes are listed separately. ${reason}`
          : `Publisher image source outcome: ${reason}`));
      }
      out.push(...(page.mediaFailures || []).map(reason => `Publisher image collection outcome: ${reason}`));
      if (page.readScope === "NOT_REFETCHED") out.push("Publisher page not refetched during image recovery; original observation time preserved.");
      out.push(...(page.priorFailures || []).map(reason => `Earlier publisher read outcome: ${reason}`));
      for (const relation of page.media?.linkedInlineAlternatives || []) out.push(`Saved inline image ${relation.inlineUrl} (SHA-256 ${relation.inlineSha256}) is authored inside link ${relation.linkedUrl}; it does not replace that missing original.`);
      out.push(...page.failures.map(reason => `Current publisher read outcome: ${reason}`));
    }
  }
  out.push(...content.failures.map(failure => `Provider ${failure.providerId}: ${failure.reason}`));
  return out.join("\n");
}
