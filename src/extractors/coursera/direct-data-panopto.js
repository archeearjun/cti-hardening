import { sanitizeCourseraCourseDataModel } from "./direct-data-privacy.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";

export const CTI_DIRECT_PANOPTO_MAX_MODEL_BYTES_V1 = 512 * 1024;
export const CTI_DIRECT_PANOPTO_MAX_PODCAST_BYTES_V1 = 128 * 1024 * 1024;
export const CTI_DIRECT_PANOPTO_GUID_V1 = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";

/** Automatic requests use only the observed hosted Panopto tenant family. */
export function directPanoptoAutomaticTargetV1(targetUrl) {
    const identity = directPanoptoTargetV1(targetUrl);
    if (!identity) return null;
    const url = new URL(targetUrl);
    return /^[a-z0-9-]+\.hosted\.panopto\.com$/.test(url.hostname) &&
        (!url.port || url.port === "443") ? identity : null;
}

/** Retain sanitized native JSON; only independently joined content GUIDs are restored. */
export function sanitizeDirectPanoptoModelV1(raw, targetUrl) {
    const prepared = panoptoPrepareModelV1(raw, targetUrl);
    panoptoProjectV1(prepared.model);
    return { data: prepared.model, ...prepared.sanitization, limitReached: false };
}

/** Known content fields are stable independently of viewing progress, user
 * permissions, invocation IDs and ratings. The full native model is retained. */
export function directPanoptoSourceV1(targetUrl, model) {
    const clean = sanitizeDirectPanoptoModelV1(model, targetUrl).data;
    if (directCanonicalSourceTextV1(clean) !== directCanonicalSourceTextV1(model))
        throw Error("Panopto retained source is not sanitized.");
    const delivery = clean.Delivery, content = {};
    for (const key of ["PublicID", "SessionPublicID", "SessionFileId", "IsReferenceCopy",
        "SessionName", "SessionAbstract", "Duration", "Streams", "PodcastStreams",
        "HasCaptions", "AvailableCaptions", "AvailableLanguages", "Timestamps",
        "HasAudioDescriptions", "AvailableAudioDescriptions", "AvailableAudioDescriptionLanguages",
        "HasQuiz", "HasSplices", "HasAnyLinks", "EventTargets", "AIChapters", "AIKeyPoints", "AISummary"])
        if (Object.prototype.hasOwnProperty.call(delivery, key)) content[key] = delivery[key];
    return { targetUrl, SessionId: clean.SessionId, ViewerFileId: clean.ViewerFileId ?? null,
        DownloadUrl: clean.DownloadUrl ?? null, SessionInteractivityType: clean.SessionInteractivityType ?? null,
        Delivery: content };
}

export function directPanoptoProjectionV1(targetUrl, model) {
    return panoptoProjectV1(sanitizeDirectPanoptoModelV1(model, targetUrl).data);
}

/** Only the observed native MP4 podcast schema can identify a downloadable
 * rendition. Viewer HLS streams and linked examples never provide its body. */
export function directPanoptoPodcastBindingsV1(model, targetUrl) {
    const clean = sanitizeDirectPanoptoModelV1(model, targetUrl).data, result = [], seen = new Set();
    for (const stream of panoptoListV1(clean.Delivery.PodcastStreams, "podcast inventory")) {
        panoptoObjectV1(stream);
        if (stream.ViewerMediaFileType !== 3 || stream.ViewerMediaFileTypeName !== "mp4") continue;
        const streamPublicId = panoptoGuidV1(stream.PublicID), streamFileId = panoptoGuidV1(stream.StreamFileId),
            url = panoptoReferenceV1(stream.StreamUrl);
        if (seen.has(streamFileId)) throw Error("Ambiguous Panopto podcast file identity.");
        seen.add(streamFileId);
        if (!url) continue;
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.hash || !/\.mp4$/i.test(parsed.pathname)) continue;
        result.push({ role: "PODCAST_STREAM_RENDITION", streamPublicId, streamFileId,
            canonicalUrl: url, url, mime: "video/mp4" });
    }
    return result;
}

export function panoptoObjectV1(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Unsupported Panopto response structure.");
    return value;
}
export function panoptoGuidV1(value) {
    if (typeof value !== "string" || !new RegExp(CTI_DIRECT_PANOPTO_GUID_V1, "i").test(value))
        throw Error("Panopto content identities are missing or unsupported.");
    return value;
}
export function panoptoListV1(value, label) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value) || value.length > 10000)
        throw Error(`Unsupported or oversized Panopto ${label}.`);
    return value;
}
export function panoptoLiteralV1(value) {
    return typeof value === "string" ? value : null;
}
export function panoptoNumberV1(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw Error("Unsupported Panopto duration, offset or rendition value.");
    return value;
}
export function panoptoReferenceV1(value) {
    if (typeof value !== "string" || !value || value.length > 8192 || value.trim() !== value)
        return null;
    try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) && !url.username && !url.password ? value : null;
    }
    catch {
        return null;
    }
}
export function directPanoptoTargetV1(targetUrl) {
    if (typeof targetUrl !== "string" || targetUrl.length > 8192 || targetUrl.trim() !== targetUrl)
        return null;
    try {
        const url = new URL(targetUrl), id = url.searchParams.get("id");
        const protectedUrl = sanitizeCourseraCourseDataModel({ url: targetUrl });
        if (url.protocol !== "https:" || url.username || url.password || url.hash ||
            !/^\/Panopto\/Pages\/(?:Embed|Viewer)\.aspx$/.test(url.pathname) ||
            url.searchParams.getAll("id").length !== 1 || !id || !new RegExp(CTI_DIRECT_PANOPTO_GUID_V1, "i").test(id) ||
            protectedUrl.limitReached || protectedUrl.removedFields || protectedUrl.redactedUrls)
            return null;
        return { origin: url.origin, deliveryPublicId: id };
    }
    catch {
        return null;
    }
}
/** Recognize the observed single-iframe HTML representation without mounting it. */
export function panoptoEmbedIdentityV1(value) {
    if (typeof value !== "string" || value.length > 8192)
        throw Error("Unsupported native Panopto embed representation.");
    const frame = value.match(/^\s*<iframe\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>\s*<\/iframe\s*>\s*$/i);
    if (!frame)
        throw Error("Unsupported native Panopto embed representation.");
    let attributes = frame[1], src;
    const seen = new Set();
    while (attributes.trim()) {
        const attribute = attributes.match(/^\s+([A-Za-z][A-Za-z0-9:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/);
        if (!attribute)
            throw Error("Unsupported native Panopto embed attributes.");
        const name = attribute[1].toLowerCase();
        if (seen.has(name))
            throw Error("Ambiguous native Panopto embed attributes.");
        seen.add(name);
        if (name === "src")
            src = attribute[2] ?? attribute[3] ?? attribute[4];
        attributes = attributes.slice(attribute[0].length);
    }
    const decoded = src?.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f0-9]+);/gi, entity => {
        const named = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
        const key = entity.toLowerCase();
        if (named[key])
            return named[key];
        const code = key.startsWith("&#x") ? parseInt(key.slice(3, -1), 16) : Number(key.slice(2, -1));
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
            ? String.fromCodePoint(code) : "\uFFFD";
    });
    const identity = decoded ? directPanoptoTargetV1(decoded) : null;
    if (!identity)
        throw Error("Native Panopto embed target is missing or unsupported.");
    return identity;
}
/** Restore only content GUIDs whose exact native identity joins were checked.
 * The shared credential sanitizer remains unchanged for other source models. */
export function panoptoPrepareModelV1(value, targetUrl) {
    const target = directPanoptoTargetV1(targetUrl), raw = panoptoObjectV1(value), delivery = panoptoObjectV1(raw.Delivery);
    if (!target || panoptoGuidV1(delivery.PublicID) !== target.deliveryPublicId ||
        panoptoGuidV1(raw.SessionId) !== panoptoGuidV1(delivery.SessionPublicID))
        throw Error("The response does not identify the selected Panopto recording.");
    if (raw.EmbedUrl != null) {
        const embedded = panoptoEmbedIdentityV1(raw.EmbedUrl);
        if (embedded?.origin !== target.origin || embedded.deliveryPublicId !== target.deliveryPublicId)
            throw Error("The native Panopto embed belongs to another recording or origin.");
    }
    const sessionFileId = panoptoGuidV1(delivery.SessionFileId), timestamps = panoptoListV1(delivery.Timestamps, "navigation inventory");
    for (const entry of timestamps)
        if (panoptoGuidV1(panoptoObjectV1(entry).SessionID) !== sessionFileId)
            throw Error("Panopto navigation belongs to another session file.");
    if (raw.ViewerFileId != null)
        panoptoGuidV1(raw.ViewerFileId);
    const sanitized = sanitizeCourseraCourseDataModel(raw);
    if (sanitized.limitReached)
        throw Error("Panopto response exceeds sanitization limits.");
    const model = panoptoObjectV1(sanitized.data), cleanDelivery = panoptoObjectV1(model.Delivery);
    model.SessionId = raw.SessionId;
    const cleanTimestamps = panoptoListV1(cleanDelivery.Timestamps, "navigation inventory");
    if (cleanTimestamps.length !== timestamps.length)
        throw Error("Panopto navigation was not retained completely.");
    cleanTimestamps.forEach((entry, index) => { panoptoObjectV1(entry).SessionID = timestamps[index].SessionID; });
    if (new TextEncoder().encode(JSON.stringify(model)).length > CTI_DIRECT_PANOPTO_MAX_MODEL_BYTES_V1)
        throw Error("Panopto response exceeds 512 KiB.");
    return { model, sanitization: {
            removedFields: sanitized.removedFields, redactedUrls: sanitized.redactedUrls,
            protectedContentIdFieldsRestored: 1 + timestamps.length,
            coverage: "KNOWN_CREDENTIAL_FIELDS_AND_URL_PARAMETERS_ONLY_NOT_EXHAUSTIVE",
        } };
}
export function panoptoProjectV1(model) {
    const d = panoptoObjectV1(model.Delivery), limitations = [
        "Native response metadata does not establish media bytes or complete widget content.",
        "Media references are retained. Video bytes, original uploads, caption bodies, playback and course launch remain unverified.",
        "OCR/navigation labels are not speech captions or a transcript.",
    ];
    if (model.EmbedUrl == null)
        limitations.push("Native embed markup was not supplied; its origin could not be compared with the selected target.");
    const streams = [];
    for (const [key, role] of [["Streams", "VIEWER_STREAM"], ["PodcastStreams", "PODCAST_STREAM"]]) {
        if (!Array.isArray(d[key]))
            limitations.push(`${key} inventory was not supplied.`);
        for (const value of panoptoListV1(d[key], "stream inventory")) {
            const s = panoptoObjectV1(value), variants = panoptoListV1(s.Variants, "rendition inventory").map(value => {
                const variant = panoptoObjectV1(value);
                return { bandwidth: panoptoNumberV1(variant.Bandwidth), url: panoptoReferenceV1(variant.Url) };
            });
            streams.push({ role, publicId: s.PublicID == null ? null : panoptoGuidV1(s.PublicID),
                streamFileId: s.StreamFileId == null ? null : panoptoGuidV1(s.StreamFileId),
                name: panoptoLiteralV1(s.Name), streamTypeName: panoptoLiteralV1(s.StreamTypeName),
                sourceMediaFileType: panoptoNumberV1(s.SourceMediaFileType), viewerMediaFileType: panoptoNumberV1(s.ViewerMediaFileType),
                viewerMediaFileTypeName: panoptoLiteralV1(s.ViewerMediaFileTypeName),
                relativeStart: panoptoNumberV1(s.RelativeStart), relativeEnd: panoptoNumberV1(s.RelativeEnd),
                url: panoptoReferenceV1(s.StreamUrl), httpUrl: panoptoReferenceV1(s.StreamHttpUrl), variants });
            if ((s.StreamUrl != null && !panoptoReferenceV1(s.StreamUrl)) ||
                (s.StreamHttpUrl != null && !panoptoReferenceV1(s.StreamHttpUrl)) ||
                variants.some(value => value.url === null))
                limitations.push("Some native media references use an unsupported URL representation.");
        }
    }
    const hasCaptions = typeof d.HasCaptions === "boolean" ? d.HasCaptions : null, availableCaptionsCount = Array.isArray(d.AvailableCaptions) ? d.AvailableCaptions.length : null, availableLanguagesCount = Array.isArray(d.AvailableLanguages) ? d.AvailableLanguages.length : null, hasInventory = (availableCaptionsCount ?? 0) > 0 || (availableLanguagesCount ?? 0) > 0;
    const captionStatus = hasCaptions === false && hasInventory ? "CONTRADICTORY" :
        hasCaptions === false && availableCaptionsCount === 0 && availableLanguagesCount === 0 ? "REPORTED_NONE" :
            hasCaptions === true || hasInventory ? "REPORTED_PRESENT_UNSUPPORTED" : "UNKNOWN";
    if (captionStatus !== "REPORTED_NONE")
        limitations.push("Caption inventory is incomplete, contradictory or uses an unsupported schema; no caption text or URL is inferred.");
    const navigation = panoptoListV1(d.Timestamps, "navigation inventory").map(value => {
        const entry = panoptoObjectV1(value);
        return { eventType: panoptoLiteralV1(entry.EventTargetType), text: panoptoLiteralV1(entry.Caption),
            timeSeconds: panoptoNumberV1(entry.Time), sessionFileId: panoptoGuidV1(entry.SessionID),
            showInTableOfContents: typeof entry.ShowInTableOfContents === "boolean" ? entry.ShowInTableOfContents : null };
    });
    if (!Array.isArray(d.Timestamps))
        limitations.push("Navigation inventory was not supplied.");
    if (navigation.some(entry => entry.eventType !== "SmartOcrToc"))
        limitations.push("Unknown native timestamp events are retained without interpreting them as captions or verified navigation.");
    return { identity: { deliveryPublicId: panoptoGuidV1(d.PublicID), sessionPublicId: panoptoGuidV1(d.SessionPublicID),
            sessionFileId: panoptoGuidV1(d.SessionFileId), viewerFileId: model.ViewerFileId == null ? null : panoptoGuidV1(model.ViewerFileId),
            isReferenceCopy: typeof d.IsReferenceCopy === "boolean" ? d.IsReferenceCopy : null },
        title: panoptoLiteralV1(d.SessionName) ?? "", durationSeconds: panoptoNumberV1(d.Duration), streams,
        captions: { status: captionStatus, hasCaptions, availableCaptionsCount, availableLanguagesCount },
        navigation, limitations: [...new Set(limitations)] };
}
