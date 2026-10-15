import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import { sanitizeCourseraCourseDataModel } from "../extractors/coursera/direct-data-privacy.js";
import type { ItemCheckSpec } from "./item-check.ts";

const MAX_BYTES = 512 * 1024;
const GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Native = Record<string, any>;

export interface PanoptoStream {
  role: "VIEWER_STREAM" | "PODCAST_STREAM";
  publicId: string | null;
  streamFileId: string | null;
  name: string | null;
  streamTypeName: string | null;
  sourceMediaFileType: number | null;
  viewerMediaFileType: number | null;
  viewerMediaFileTypeName: string | null;
  relativeStart: number | null;
  relativeEnd: number | null;
  url: string | null;
  httpUrl: string | null;
  variants: { bandwidth: number | null; url: string | null }[];
}

export interface PanoptoDeliveryInfoCapture {
  kind: "CTI_PANOPTO_DELIVERY_INFO";
  schemaVersion: 1;
  notForCourseAudit: true;
  provenance: "USER_PROVIDED_DELIVERY_RESPONSE";
  auditId: string;
  courseId: string;
  itemId: string;
  targetUrl: string;
  importedAt: string;
  responseTextSha256: string;
  responseTextBytes: number;
  nativeModel: Native;
  nativeModelSha256: string;
  identity: {
    deliveryPublicId: string;
    sessionPublicId: string;
    sessionFileId: string;
    viewerFileId: string | null;
    isReferenceCopy: boolean | null;
  };
  title: string;
  durationSeconds: number | null;
  streams: PanoptoStream[];
  captions: {
    status: "REPORTED_NONE" | "REPORTED_PRESENT_UNSUPPORTED" | "CONTRADICTORY" | "UNKNOWN";
    hasCaptions: boolean | null;
    availableCaptionsCount: number | null;
    availableLanguagesCount: number | null;
  };
  navigation: {
    eventType: string | null;
    text: string | null;
    timeSeconds: number | null;
    sessionFileId: string;
    showInTableOfContents: boolean | null;
  }[];
  sanitization: {
    removedFields: number;
    redactedUrls: number;
    protectedContentIdFieldsRestored: number;
    coverage: "KNOWN_CREDENTIAL_FIELDS_AND_URL_PARAMETERS_ONLY_NOT_EXHAUSTIVE";
  };
  limitations: string[];
  bodyVerified: false;
  binaryContentVerified: false;
  captionsVerified: false;
  playbackVerified: false;
  launchVerified: false;
  courseLaunchVerified: false;
  captureSourceVerified: false;
  wholeWidgetVerified: false;
  wholePluginVerified: false;
  automatedResolution: false;
}

function object(value: unknown): Native {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Unsupported Panopto response structure.");
  return value as Native;
}
function hash(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}
function guid(value: unknown): string {
  if (typeof value !== "string" || !GUID.test(value))
    throw Error("Panopto content identities are missing or unsupported.");
  return value;
}
function list(value: unknown, label: string): any[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10000)
    throw Error(`Unsupported or oversized Panopto ${label}.`);
  return value;
}
function literal(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function number(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw Error("Unsupported Panopto duration, offset or rendition value.");
  return value;
}
function reference(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 8192 || value.trim() !== value)
    return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export function panoptoTargetIdentity(targetUrl: string): { origin: string; deliveryPublicId: string } | null {
  if (typeof targetUrl !== "string" || targetUrl.length > 8192 || targetUrl.trim() !== targetUrl)
    return null;
  try {
    const url = new URL(targetUrl), id = url.searchParams.get("id");
    const protectedUrl = sanitizeCourseraCourseDataModel({ url: targetUrl });
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        !/^\/Panopto\/Pages\/(?:Embed|Viewer)\.aspx$/.test(url.pathname) ||
        url.searchParams.getAll("id").length !== 1 || !id || !GUID.test(id) ||
        protectedUrl.limitReached || protectedUrl.removedFields || protectedUrl.redactedUrls) return null;
    return { origin: url.origin, deliveryPublicId: id };
  } catch { return null; }
}

/** Recognize the observed single-iframe HTML representation without mounting it. */
function embedIdentity(value: unknown): ReturnType<typeof panoptoTargetIdentity> {
  if (typeof value !== "string" || value.length > 8192)
    throw Error("Unsupported native Panopto embed representation.");
  const frame = value.match(/^\s*<iframe\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>\s*<\/iframe\s*>\s*$/i);
  if (!frame) throw Error("Unsupported native Panopto embed representation.");
  let attributes = frame[1], src: string | undefined;
  const seen = new Set<string>();
  while (attributes.trim()) {
    const attribute = attributes.match(/^\s+([A-Za-z][A-Za-z0-9:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/);
    if (!attribute) throw Error("Unsupported native Panopto embed attributes.");
    const name = attribute[1].toLowerCase();
    if (seen.has(name)) throw Error("Ambiguous native Panopto embed attributes.");
    seen.add(name);
    if (name === "src") src = attribute[2] ?? attribute[3] ?? attribute[4];
    attributes = attributes.slice(attribute[0].length);
  }
  const decoded = src?.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f0-9]+);/gi, entity => {
    const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    const code = key.startsWith("&#x") ? parseInt(key.slice(3, -1), 16) : Number(key.slice(2, -1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : "\uFFFD";
  });
  const identity = decoded ? panoptoTargetIdentity(decoded) : null;
  if (!identity) throw Error("Native Panopto embed target is missing or unsupported.");
  return identity;
}

/** Restore only content GUIDs whose exact native identity joins were checked.
 * The shared credential sanitizer remains unchanged for other source models. */
function prepareModel(value: unknown, targetUrl: string) {
  const target = panoptoTargetIdentity(targetUrl), raw = object(value), delivery = object(raw.Delivery);
  if (!target || guid(delivery.PublicID) !== target.deliveryPublicId ||
      guid(raw.SessionId) !== guid(delivery.SessionPublicID))
    throw Error("The response does not identify the selected Panopto recording.");
  if (raw.EmbedUrl != null) {
    const embedded = embedIdentity(raw.EmbedUrl);
    if (embedded?.origin !== target.origin || embedded.deliveryPublicId !== target.deliveryPublicId)
      throw Error("The native Panopto embed belongs to another recording or origin.");
  }
  const sessionFileId = guid(delivery.SessionFileId), timestamps = list(delivery.Timestamps, "navigation inventory");
  for (const entry of timestamps)
    if (guid(object(entry).SessionID) !== sessionFileId)
      throw Error("Panopto navigation belongs to another session file.");
  if (raw.ViewerFileId != null) guid(raw.ViewerFileId);
  const sanitized = sanitizeCourseraCourseDataModel(raw);
  if (sanitized.limitReached) throw Error("Panopto response exceeds sanitization limits.");
  const model = object(sanitized.data), cleanDelivery = object(model.Delivery);
  model.SessionId = raw.SessionId;
  const cleanTimestamps = list(cleanDelivery.Timestamps, "navigation inventory");
  if (cleanTimestamps.length !== timestamps.length)
    throw Error("Panopto navigation was not retained completely.");
  cleanTimestamps.forEach((entry, index) => { object(entry).SessionID = timestamps[index].SessionID; });
  if (new TextEncoder().encode(JSON.stringify(model)).length > MAX_BYTES)
    throw Error("Panopto response exceeds 512 KiB.");
  return { model, sanitization: {
    removedFields: sanitized.removedFields, redactedUrls: sanitized.redactedUrls,
    protectedContentIdFieldsRestored: 1 + timestamps.length,
    coverage: "KNOWN_CREDENTIAL_FIELDS_AND_URL_PARAMETERS_ONLY_NOT_EXHAUSTIVE" as const,
  } };
}

function project(model: Native) {
  const d = object(model.Delivery), limitations = [
    "User-provided response metadata; import time is not source observation time or a verified HTTP receipt.",
    "Media references are retained. Video bytes, original uploads, caption bodies, playback and course launch remain unverified.",
    "OCR/navigation labels are not speech captions or a transcript.",
  ];
  if (model.EmbedUrl == null)
    limitations.push("Native embed markup was not supplied; its origin could not be compared with the selected target.");
  const streams: PanoptoStream[] = [];
  for (const [key, role] of [["Streams", "VIEWER_STREAM"], ["PodcastStreams", "PODCAST_STREAM"]] as const) {
    if (!Array.isArray(d[key])) limitations.push(`${key} inventory was not supplied.`);
    for (const value of list(d[key], "stream inventory")) {
      const s = object(value), variants = list(s.Variants, "rendition inventory").map(value => {
        const variant = object(value);
        return { bandwidth: number(variant.Bandwidth), url: reference(variant.Url) };
      });
      streams.push({ role, publicId: s.PublicID == null ? null : guid(s.PublicID),
        streamFileId: s.StreamFileId == null ? null : guid(s.StreamFileId),
        name: literal(s.Name), streamTypeName: literal(s.StreamTypeName),
        sourceMediaFileType: number(s.SourceMediaFileType), viewerMediaFileType: number(s.ViewerMediaFileType),
        viewerMediaFileTypeName: literal(s.ViewerMediaFileTypeName),
        relativeStart: number(s.RelativeStart), relativeEnd: number(s.RelativeEnd),
        url: reference(s.StreamUrl), httpUrl: reference(s.StreamHttpUrl), variants });
      if ((s.StreamUrl != null && !reference(s.StreamUrl)) ||
          (s.StreamHttpUrl != null && !reference(s.StreamHttpUrl)) ||
          variants.some(value => value.url === null))
        limitations.push("Some native media references use an unsupported URL representation.");
    }
  }
  const hasCaptions = typeof d.HasCaptions === "boolean" ? d.HasCaptions : null,
    availableCaptionsCount = Array.isArray(d.AvailableCaptions) ? d.AvailableCaptions.length : null,
    availableLanguagesCount = Array.isArray(d.AvailableLanguages) ? d.AvailableLanguages.length : null,
    hasInventory = (availableCaptionsCount ?? 0) > 0 || (availableLanguagesCount ?? 0) > 0;
  const captionStatus: PanoptoDeliveryInfoCapture["captions"]["status"] =
    hasCaptions === false && hasInventory ? "CONTRADICTORY" :
    hasCaptions === false && availableCaptionsCount === 0 && availableLanguagesCount === 0 ? "REPORTED_NONE" :
    hasCaptions === true || hasInventory ? "REPORTED_PRESENT_UNSUPPORTED" : "UNKNOWN";
  if (captionStatus !== "REPORTED_NONE")
    limitations.push("Caption inventory is incomplete, contradictory or uses an unsupported schema; no caption text or URL is inferred.");
  const navigation = list(d.Timestamps, "navigation inventory").map(value => {
    const entry = object(value);
    return { eventType: literal(entry.EventTargetType), text: literal(entry.Caption),
      timeSeconds: number(entry.Time), sessionFileId: guid(entry.SessionID),
      showInTableOfContents: typeof entry.ShowInTableOfContents === "boolean" ? entry.ShowInTableOfContents : null };
  });
  if (!Array.isArray(d.Timestamps)) limitations.push("Navigation inventory was not supplied.");
  if (navigation.some(entry => entry.eventType !== "SmartOcrToc"))
    limitations.push("Unknown native timestamp events are retained without interpreting them as captions or verified navigation.");
  return { identity: { deliveryPublicId: guid(d.PublicID), sessionPublicId: guid(d.SessionPublicID),
    sessionFileId: guid(d.SessionFileId), viewerFileId: model.ViewerFileId == null ? null : guid(model.ViewerFileId),
    isReferenceCopy: typeof d.IsReferenceCopy === "boolean" ? d.IsReferenceCopy : null },
    title: literal(d.SessionName) ?? "", durationSeconds: number(d.Duration), streams,
    captions: { status: captionStatus, hasCaptions, availableCaptionsCount, availableLanguagesCount },
    navigation, limitations: [...new Set(limitations)] };
}

function binding(value: Native, spec?: ItemCheckSpec) {
  for (const key of ["auditId", "courseId", "itemId"] as const)
    if (typeof value[key] !== "string" || !value[key] || value[key].length > 256 ||
        (spec && value[key] !== spec[key]))
      throw Error("This Panopto metadata belongs to another report, course or item.");
}

export async function importPanoptoDeliveryInfo(
  responseText: string, spec: ItemCheckSpec, targetUrl: string,
): Promise<PanoptoDeliveryInfoCapture> {
  if (typeof responseText !== "string" || !responseText.trim() ||
      new TextEncoder().encode(responseText).length > MAX_BYTES)
    throw Error("Choose a plain JSON Panopto response no larger than 512 KiB.");
  if (!panoptoTargetIdentity(targetUrl)) throw Error("Choose an exact Panopto recording target.");
  binding(spec);
  let parsed: unknown;
  try { parsed = JSON.parse(responseText.replace(/^\uFEFF/, "")); }
  catch { throw Error("Choose plain JSON response text; rich-text/RTF files are unsupported."); }
  const prepared = prepareModel(parsed, targetUrl);
  return validatePanoptoDeliveryInfoCapture({
    kind: "CTI_PANOPTO_DELIVERY_INFO", schemaVersion: 1, notForCourseAudit: true,
    provenance: "USER_PROVIDED_DELIVERY_RESPONSE",
    auditId: spec.auditId, courseId: spec.courseId, itemId: spec.itemId, targetUrl,
    importedAt: new Date().toISOString(), responseTextSha256: hash(responseText),
    responseTextBytes: new TextEncoder().encode(responseText).length,
    nativeModel: prepared.model, nativeModelSha256: hash(directCanonicalSourceTextV1(prepared.model)),
    sanitization: prepared.sanitization,
  }, spec, [targetUrl]);
}

/** Recompute every displayed field from the retained sanitized native model.
 * The copied-text hash identifies the input; it is not a server response proof. */
export function validatePanoptoDeliveryInfoCapture(
  value: unknown, spec?: ItemCheckSpec, allowedTargets?: string[],
): PanoptoDeliveryInfoCapture {
  const raw = object(value);
  if (raw.kind !== "CTI_PANOPTO_DELIVERY_INFO" || raw.schemaVersion !== 1 ||
      raw.notForCourseAudit !== true || raw.provenance !== "USER_PROVIDED_DELIVERY_RESPONSE")
    throw Error("Unsupported Panopto metadata capture.");
  binding(raw, spec);
  if (!panoptoTargetIdentity(raw.targetUrl) ||
      (allowedTargets && !allowedTargets.includes(raw.targetUrl)))
    throw Error("This Panopto target is not recorded for the selected item.");
  if (typeof raw.importedAt !== "string" || !Number.isFinite(Date.parse(raw.importedAt)) ||
      Date.parse(raw.importedAt) > Date.now() + 60000 ||
      !/^[a-f0-9]{64}$/.test(raw.responseTextSha256 || "") ||
      !Number.isSafeInteger(raw.responseTextBytes) || raw.responseTextBytes < 1 || raw.responseTextBytes > MAX_BYTES)
    throw Error("Invalid Panopto import metadata.");
  const prepared = prepareModel(raw.nativeModel, raw.targetUrl), canonical = directCanonicalSourceTextV1(prepared.model);
  if (canonical !== directCanonicalSourceTextV1(raw.nativeModel) || hash(canonical) !== raw.nativeModelSha256)
    throw Error("Panopto native metadata changed or contains unsanitized credentials.");
  const sanitization = object(raw.sanitization);
  for (const key of ["removedFields", "redactedUrls", "protectedContentIdFieldsRestored"])
    if (!Number.isSafeInteger(sanitization[key]) || sanitization[key] < 0 || sanitization[key] > 100000)
      throw Error("Invalid Panopto sanitization receipt.");
  const projection = project(prepared.model);
  return { kind: "CTI_PANOPTO_DELIVERY_INFO", schemaVersion: 1, notForCourseAudit: true,
    provenance: "USER_PROVIDED_DELIVERY_RESPONSE", auditId: raw.auditId, courseId: raw.courseId,
    itemId: raw.itemId, targetUrl: raw.targetUrl, importedAt: raw.importedAt,
    responseTextSha256: raw.responseTextSha256, responseTextBytes: raw.responseTextBytes,
    nativeModel: prepared.model, nativeModelSha256: raw.nativeModelSha256,
    ...projection, sanitization: {
      removedFields: sanitization.removedFields, redactedUrls: sanitization.redactedUrls,
      protectedContentIdFieldsRestored: prepared.sanitization.protectedContentIdFieldsRestored,
      coverage: "KNOWN_CREDENTIAL_FIELDS_AND_URL_PARAMETERS_ONLY_NOT_EXHAUSTIVE",
    }, bodyVerified: false, binaryContentVerified: false, captionsVerified: false,
    playbackVerified: false, launchVerified: false, courseLaunchVerified: false,
    captureSourceVerified: false, wholeWidgetVerified: false, wholePluginVerified: false,
    automatedResolution: false,
    limitations: [...projection.limitations,
      ...(sanitization.redactedUrls ? ["Credential parameters were removed from native URLs; recorded references may not be usable download addresses."] : [])],
  };
}

export function panoptoDeliveryInfoText(capture: PanoptoDeliveryInfoCapture): string {
  const value = validatePanoptoDeliveryInfoCapture(capture), lines = [
    "User-provided Panopto delivery metadata", `Imported: ${value.importedAt} (not source observation time)`,
    `Title: ${value.title}`, `Duration: ${value.durationSeconds ?? "not supplied"} seconds`,
    `Delivery public ID: ${value.identity.deliveryPublicId}`,
    `Underlying session public ID: ${value.identity.sessionPublicId}`,
    `Session file ID: ${value.identity.sessionFileId}`,
    `Reference copy: ${value.identity.isReferenceCopy === null ? "not supplied" : value.identity.isReferenceCopy}`,
    `Caption inventory: ${value.captions.status}`,
  ];
  for (const stream of value.streams) {
    lines.push(`${stream.role}: ${stream.name ?? "unnamed"}; format: ${stream.viewerMediaFileTypeName ?? "not supplied"}`);
    if (stream.url) lines.push(`Recorded media reference: ${stream.url}`);
    if (stream.httpUrl && stream.httpUrl !== stream.url) lines.push(`Recorded HTTP reference: ${stream.httpUrl}`);
    for (const variant of stream.variants)
      if (variant.url) lines.push(`Recorded rendition reference (${variant.bandwidth ?? "unknown"} bps): ${variant.url}`);
  }
  for (const entry of value.navigation)
    lines.push(`Native timestamp ${entry.timeSeconds ?? "unknown"}s [${entry.eventType ?? "unclassified"}]: ${entry.text ?? ""}`);
  return lines.concat(value.limitations).join("\n");
}
