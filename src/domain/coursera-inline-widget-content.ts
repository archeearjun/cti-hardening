import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { bindDirectAuthoringDraftV1 } from "../extractors/coursera/direct-data-models.js";
import { directInlineWidgetEvidenceV1, directSourceBindingEvidenceV1 } from "../extractors/coursera/direct-data-contracts.js";
import { directPublicHtmlEvidenceV1 } from "../extractors/coursera/direct-data-public-page.js";
import { directPublisherEvidenceV1, directPublisherChapterV1 } from "../extractors/coursera/direct-data-publisher.js";

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
export interface InlineWidgetPublisherPage {
  targetUrl: string;
  sourceFields: string[];
  status: "CAPTURED_PUBLISHER_API_CHAPTER" | "HISTORICAL_RETAINED_PUBLISHER_API_CHAPTER" | "UNRESOLVED";
  endpointUrl: string;
  chapterId: number | null;
  chapterLink: string;
  observedAt: string;
  bytes: number;
  sha256: string;
  responseType: "cors" | "";
  credentials: "omit" | "include" | "";
  failures: string[];
}
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
        if (hasRetained && (!retained || observation || !entry.failures.length)) return null;
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
          const observation = entry.observation === null ? null : directPublisherEvidenceV1(entry.observation, targetUrl, hashBytes),
            hasRetained = entry.retainedObservation !== undefined,
            retained = hasRetained ? directPublisherEvidenceV1(entry.retainedObservation, targetUrl, hashBytes) : null;
          if (entry.observation !== null && !observation || observation && entry.failures.length ||
              hasRetained && (!retained || observation || !entry.failures.length)) return null;
          const selected = observation || retained, model = object(selected?.model),
            chapter = selected ? directPublisherChapterV1(model.rawJson, targetUrl) : null;
          if (selected && (!chapter || (retainedPublicBytes += model.bytes) > 8 * 1024 * 1024)) return null;
          if (selected) {
            const finalAtomAt = Date.parse(proof.sources.receipts.stability.receipt.observedAt);
            // These clocks belong to the same collecting browser. Server HTML
            // observations deliberately do not take part in this comparison.
            if (Date.parse(selected.receipt.observedAt) > finalAtomAt ||
                Date.parse(selected.receipt.receivedAt) > finalAtomAt) return null;
          }
          publisherPages.push({ targetUrl, sourceFields: fields,
            status: observation ? "CAPTURED_PUBLISHER_API_CHAPTER" : retained ? "HISTORICAL_RETAINED_PUBLISHER_API_CHAPTER" : "UNRESOLVED",
            endpointUrl: selected ? model.endpointUrl : "", chapterId: chapter?.id ?? null,
            chapterLink: chapter?.link ?? "", observedAt: selected ? model.observedAt : "",
            bytes: selected ? model.bytes : 0, sha256: selected ? model.sha256 : "",
            responseType: selected ? "cors" : "", credentials: selected ? selected.receipt.credentials : "",
            failures: entry.failures.map((failure: unknown) => text(object(failure).reason))
              .filter(reason => /^[A-Z0-9_]{1,96}$/.test(reason)) });
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
    page = provider?.publisherPages?.find(value => value.targetUrl === targetUrl && value.status !== "UNRESOLVED"),
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
      out.push(`Publisher API chapter content: ${page.targetUrl} | ${page.status}`);
      if (page.status !== "UNRESOLVED") {
        out.push(`API endpoint: ${page.endpointUrl}`, `Publisher chapter ID: ${page.chapterId} | published chapter link: ${page.chapterLink}`,
          `Observed: ${page.observedAt} | ${page.bytes} original JSON UTF-8 bytes | SHA-256 ${page.sha256}`,
          `Browser response: ${page.responseType}; credentials mode: ${page.credentials}.`);
        const original = courseraInlinePublisherPage(content, provider.providerId, page.targetUrl);
        if (original) {
          out.push(original.historical ? "Earlier publisher API observation retained; no current chapter response is established." : "Publisher-provided chapter fields; partial content only.");
          for (const field of ["title", "content", "excerpt"]) {
            for (const format of ["raw", "rendered"]) {
              const value = original.chapter[field]?.[format];
              if (typeof value === "string") out.push(`Publisher ${field}.${format} ${format === "rendered" ? "(inert plain-text approximation; inspect original JSON for exact markup)" : "(literal authored field)"}:`,
                format === "rendered" ? inlineWidgetStaticHtmlText(value) : value);
            }
          }
        }
      }
      out.push(...page.failures.map(reason => `Current publisher read outcome: ${reason}`));
    }
  }
  out.push(...content.failures.map(failure => `Provider ${failure.providerId}: ${failure.reason}`));
  return out.join("\n");
}
