import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import { decodeDirectAssetBodyV1, directAssetBodyKindV1 } from "./direct-data-media.js";
import { bindDirectAuthoringDraftV1 } from "./direct-data-models.js";
import { directWidgetProviderReceiptValidV1 } from "./direct-data-contracts.js";
import { directDraftWidgetProviderV1, directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1 } from "./direct-data-widget.js";
import {
  CTI_DIRECT_PANOPTO_MAX_MODEL_BYTES_V1,
  CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1,
  directPanoptoTargetV1,
  directPanoptoAutomaticTargetV1,
  directPanoptoSourceV1,
  directPanoptoProjectionV1,
  directPanoptoPodcastBindingsV1,
} from "./direct-data-panopto.js";

export function directPanoptoRequestFormV1(deliveryPublicId) {
  return [["deliveryId", deliveryPublicId], ["isLiveNotes", "false"],
    ["refreshAuthCookie", "false"], ["isActiveBroadcast", "false"],
    ["isEditing", "false"], ["isKollectiveAgentInstalled", "false"],
    ["isEmbed", "true"], ["responseType", "json"]];
}

export function directPanoptoReceiptValidV1(receipt, targetUrl) {
  const target = directPanoptoTargetV1(targetUrl);
  if (!target || receipt?.resource !== "PanoptoDeliveryInfo" ||
      receipt.origin !== target.origin || receipt.id !== target.deliveryPublicId ||
      receipt.targetUrl !== targetUrl || receipt.method !== "POST" ||
      receipt.requestPath !== "/Panopto/Pages/Viewer/DeliveryInfo.aspx" ||
      receipt.status !== 200 || receipt.bodyFormat !== "PARSED_SANITIZED_JSON_MODEL" ||
      !/^[a-f0-9]{64}$/.test(receipt.originalResponseSha256 || "") ||
      receipt.sha256 !== receipt.originalResponseSha256 ||
      !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1 ||
      receipt.bytes > CTI_DIRECT_PANOPTO_MAX_MODEL_BYTES_V1 ||
      !/^application\/(?:json|[^;\s]+\+json)(?:\s*;|$)/i.test(receipt.mime || "") ||
      !Number.isFinite(Date.parse(receipt.observedAt || ""))) return false;
  try {
    const expected = directPanoptoRequestFormV1(target.deliveryPublicId), seen = new Set();
    if (!Array.isArray(receipt.requestForm) || receipt.requestForm.length !== expected.length) return false;
    for (const pair of receipt.requestForm) {
      if (!Array.isArray(pair) || pair.length !== 2 || seen.has(pair[0]) ||
          !expected.some(value => value[0] === pair[0] && value[1] === pair[1])) return false;
      seen.add(pair[0]);
    }
    return true;
  } catch (_) { return false; }
}

/** Structural/body checks are shared; callers independently recompute SHA-256. */
export function directPanoptoPodcastStructureV1(podcast, candidate, options = {}) {
  const invalid = reason => ({ valid: false, bytes: null, reason });
  if (!podcast || !candidate || ["role", "streamPublicId", "streamFileId", "canonicalUrl", "url", "mime"]
      .some(key => podcast[key] !== candidate[key])) return invalid("DIRECT_PANOPTO_PODCAST_BINDING_INVALID");
  if (!podcast.body) return { valid: true, bytes: null, reason: "DIRECT_PANOPTO_PODCAST_BODY_MISSING" };
  const body = podcast.body, receipt = body.receipt,
    bytes = decodeDirectAssetBodyV1(body, CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1),
    awaitingArchive = options.allowMissingBodies === true && body.archivePath === "files/" + body.sha256 &&
      !Object.hasOwn(body, "bytes") && body.base64 === undefined;
  if ((!bytes && !awaitingArchive) || !Number.isSafeInteger(body.size) || body.size < 1 ||
      body.size > CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1 || body.kind !== "PANOPTO_PODCAST_RENDITION" ||
      body.mime !== "video/mp4" || body.canonicalUrl !== candidate.canonicalUrl ||
      !/^[a-f0-9]{64}$/.test(body.sha256 || "") ||
      (bytes && directAssetBodyKindV1(bytes, body.mime) !== "MP4") ||
      receipt?.role !== "PODCAST_STREAM_RENDITION" || receipt.status !== 200 || receipt.bytes !== body.size || receipt.mime !== body.mime ||
      receipt.sha256 !== body.sha256 || receipt.canonicalUrl !== candidate.canonicalUrl ||
      receipt.bodyFormat !== (body.archivePath ? "ORIGINAL_BINARY_BYTES_ARCHIVE" : "ORIGINAL_BINARY_BYTES_BASE64") ||
      !Number.isFinite(Date.parse(receipt.observedAt || "")) ||
      receipt.contentRange != null) return invalid("DIRECT_PANOPTO_PODCAST_BODY_INVALID");
  return { valid: true, bytes, reason: "" };
}

export function panoptoHistoricalPodcastV1(podcast, targetUrl, options) {
  const retained = podcast?.retainedEvidence;
  if (!retained) return null;
  const initial = retained.initial, final = retained.final;
  if (retained.targetUrl !== targetUrl || retained.stableSource !== true ||
      !initial || !final || !/^[a-f0-9]{64}$/.test(initial.sourceHash || "") ||
      !/^[a-f0-9]{64}$/.test(initial.modelHash || "") || !/^[a-f0-9]{64}$/.test(final.modelHash || "") ||
      initial.sourceHash !== final.sourceHash ||
      !directPanoptoReceiptValidV1(initial.receipt, targetUrl) ||
      !directPanoptoReceiptValidV1(final.receipt, targetUrl)) throw Error("Invalid historical Panopto source.");
  const source = directPanoptoSourceV1(targetUrl, initial.model);
  if (directCanonicalSourceTextV1(source) !==
      directCanonicalSourceTextV1(directPanoptoSourceV1(targetUrl, final.model))) throw Error("Changed historical Panopto source.");
  const candidate = directPanoptoPodcastBindingsV1(initial.model, targetUrl)
    .find(value => value.streamFileId === retained.podcast?.streamFileId);
  if (!candidate || podcast.role !== candidate.role || podcast.streamFileId !== candidate.streamFileId)
    throw Error("Foreign historical Panopto rendition.");
  const checked = directPanoptoPodcastStructureV1(retained.podcast, candidate, options);
  if (!checked.valid || !retained.podcast.body) throw Error("Invalid historical Panopto body.");
  return { body: retained.podcast.body, bytes: checked.bytes, source, initial, final, targetUrl, historical: true };
}

/** Expected targets must come from the separately verified native provider.
 * Incomplete/blocked reads are retained as gaps; malformed claimed proof fails. */
/** @returns {{valid:boolean, metadataVerified:boolean, podcastBodiesVerified:boolean, reason:string,
 * deliveries:Array<any>, decoded:Array<{body:any,bytes:Uint8Array}>, historical:Array<any>}} */
export function directPanoptoEvidenceStructureV1(evidence, expectedTargets, options = {}) {
  const result = { valid: false, metadataVerified: false, podcastBodiesVerified: false,
    reason: "DIRECT_PANOPTO_SOURCE_INVALID", deliveries: [], decoded: [], historical: [] };
  try {
    if (evidence?.method !== "BOUND_WIDGET_PANOPTO_DELIVERY" ||
        evidence.wholeWidgetVerified !== false || evidence.playbackVerified === true ||
        evidence.launchVerified === true || evidence.originalUploadVerified === true ||
        !Array.isArray(expectedTargets) || !Array.isArray(evidence.deliveries)) return result;
    const targets = new Set();
    for (const target of expectedTargets) {
      const url = typeof target === "string" ? target : target?.url;
      if (!directPanoptoAutomaticTargetV1(url)) continue;
      if (typeof target !== "string" && ["courseId", "itemId", "atomId", "providerId"]
          .some(key => target[key] !== evidence[key])) return result;
      targets.add(url);
    }
    if (!targets.size || evidence.deliveries.length !== targets.size) return result;
    const seen = new Set(); let allMetadata = true, allBodies = true;
    for (const delivery of evidence.deliveries) {
      if (!targets.has(delivery?.targetUrl) || seen.has(delivery.targetUrl)) return result;
      seen.add(delivery.targetUrl);
      for (const podcast of delivery.podcasts || []) {
        const historical = panoptoHistoricalPodcastV1(podcast, delivery.targetUrl, options);
        if (historical) result.historical.push(historical);
      }
      if (!delivery.initial && !delivery.final) {
        if (!Array.isArray(delivery.failures) || !delivery.failures.length ||
            !Array.isArray(delivery.podcasts || []) ||
            (delivery.podcasts || []).some(value => value.body || !value.retainedEvidence)) return result;
        allMetadata = false; allBodies = false;
        result.deliveries.push({ targetUrl: delivery.targetUrl, source: null, projection: null, podcasts: [] });
        continue;
      }
      const { initial, final, targetUrl } = delivery;
      if (!initial || !/^[a-f0-9]{64}$/.test(initial.sourceHash || "") ||
          !/^[a-f0-9]{64}$/.test(initial.modelHash || "") ||
          !directPanoptoReceiptValidV1(initial.receipt, targetUrl)) return result;
      const source = directPanoptoSourceV1(targetUrl, initial.model);
      let stable = false;
      if (final) {
        if (!/^[a-f0-9]{64}$/.test(final.sourceHash || "") || !/^[a-f0-9]{64}$/.test(final.modelHash || "") ||
            !directPanoptoReceiptValidV1(final.receipt, targetUrl)) return result;
        stable = directCanonicalSourceTextV1(source) ===
          directCanonicalSourceTextV1(directPanoptoSourceV1(targetUrl, final.model)) &&
          initial.sourceHash === final.sourceHash;
      }
      if (delivery.stableSource !== stable || (!stable &&
          (!Array.isArray(delivery.failures) || !delivery.failures.length))) return result;
      if (!stable) { allMetadata = false; allBodies = false; }
      const candidates = directPanoptoPodcastBindingsV1(initial.model, targetUrl),
        podcasts = delivery.podcasts || [], accepted = [], files = new Set();
      if (!Array.isArray(podcasts)) return result;
      if (!candidates.length) allBodies = false;
      for (const podcast of podcasts) {
        const binding = candidates.find(value => value.streamFileId === podcast?.streamFileId);
        if (!binding) {
          if (podcast?.body || !podcast?.retainedEvidence || typeof podcast.reason !== "string" || !podcast.reason) return result;
          continue;
        }
        if (files.has(binding.streamFileId)) return result;
        files.add(binding.streamFileId);
        const checked = directPanoptoPodcastStructureV1(podcast, binding, options);
        if (!checked.valid) return result;
        if (!checked.bytes) allBodies = false;
        else result.decoded.push({ body: podcast.body, bytes: checked.bytes });
        accepted.push({ binding, body: podcast.body || null, bytes: checked.bytes });
      }
      if (files.size !== candidates.length) return result;
      result.deliveries.push({ targetUrl, source, projection: directPanoptoProjectionV1(targetUrl, initial.model), podcasts: accepted });
    }
    return { ...result, valid: true, metadataVerified: allMetadata,
      podcastBodiesVerified: allBodies, reason: allMetadata ? "" : "DIRECT_PANOPTO_METADATA_NOT_OBSERVED" };
  } catch (_) { return result; }
}

/** Import-time ownership check before attaching archive bytes. Full independent
 * source/body SHA checks still run in the domain evaluator after hydration. */
export function directPanoptoArchiveBodiesV1(fp, courseId) {
  try {
    const p = fp.payload, sources = p.directDataSources,
      relation = sources.relation.elements[0],
      branch = relation.branchRelationMap[courseId + "~" + fp.id],
      bound = bindDirectAuthoringDraftV1(fp, courseId, branch.courseSlug, sources.atom, sources.relation);
    const binding = directDraftWidgetProviderV1(bound), proof = p.directWidgetProviderEvidence;
    if (proof?.method !== "BOUND_AUTHORING_WIDGET_PROVIDER" ||
        ["courseId", "itemId", "atomId", "providerId", "sourceState"].some(key => proof[key] !== binding[key]) ||
        !/^[a-f0-9]{64}$/.test(proof.initial?.sourceHash || "") ||
        !directWidgetProviderReceiptValidV1(proof.initial?.receipt, binding)) return [];
    directWidgetProviderSourceV1(bound, proof.initial.model);
    const targets = directWidgetProviderTargetsV1(bound, proof.initial.model);
    if (directCanonicalSourceTextV1(targets) !== directCanonicalSourceTextV1(proof.targets)) return [];
    const checked = directPanoptoEvidenceStructureV1(p.directPanoptoEvidence, targets, { allowMissingBodies: true });
    if (!checked.valid) return [];
    return [...checked.deliveries.flatMap(delivery => delivery.podcasts.map(podcast => podcast.body).filter(Boolean)),
      ...checked.historical.map(value => value.body)];
  } catch (_) { return []; }
}
