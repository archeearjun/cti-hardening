import { panoptoTargetIdentity } from "./panopto-delivery-info.ts";
import { sanitizeCourseraCourseDataModel } from "../extractors/coursera/direct-data-privacy.js";

/** Self-contained reader for the observed, read-only DeliveryInfo POST.
 * No player actions, source navigation, cookie refresh or media-body reads.
 */
export async function readPanoptoDeliveryInfo(
  spec: { origin: string; deliveryPublicId: string },
  sanitize: typeof sanitizeCourseraCourseDataModel,
) {
  let stage = "ROUTE_GUARD", initial = "", timedOut = false, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController(), limit = 512 * 1024;
  const guard = () => {
    if (controller.signal.aborted) throw Error("METADATA_READ_TIMEOUT");
    const url = new URL(location.href);
    if (window !== window.top || location.href !== initial || url.protocol !== "https:" || url.origin !== spec.origin ||
        url.username || url.password || !/^\/Panopto\/Pages\/(?:Embed|Viewer)\.aspx$/.test(url.pathname) ||
        url.searchParams.getAll("id").length !== 1 || url.searchParams.get("id") !== spec.deliveryPublicId)
      throw Error("EXACT_PANOPTO_ROUTE_REQUIRED_OR_CHANGED");
  };
  const object = (value: any) => value && typeof value === "object" && !Array.isArray(value);
  const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  try {
    initial = location.href; guard();
    const body = new URLSearchParams({ deliveryId: spec.deliveryPublicId, isLiveNotes: "false", refreshAuthCookie: "false",
      isActiveBroadcast: "false", isEditing: "false", isKollectiveAgentInstalled: "false", isEmbed: "true", responseType: "json" }).toString();
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(Error("METADATA_READ_TIMEOUT")); }, 20000); });
    const collect = async () => {
      stage = "READ_METADATA"; guard();
      const target = spec.origin + "/Panopto/Pages/Viewer/DeliveryInfo.aspx";
      response = await fetch(target, { method: "POST", credentials: "same-origin", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" }, body });
      if (controller.signal.aborted) {
        try { void response.body?.cancel().catch(() => {}); } catch {}
        throw Error("METADATA_READ_TIMEOUT");
      }
      guard();
      if (response.status !== 200 || response.redirected || (response.url && response.url !== target)) throw Error("METADATA_RESPONSE_REJECTED");
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw Error("METADATA_JSON_REQUIRED");
      if (Number(response.headers.get("content-length") || 0) > limit || !response.body?.getReader) throw Error("METADATA_BODY_UNAVAILABLE_OR_OVERSIZED");
      stage = "READ_RESPONSE_BODY"; reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) {
        guard(); const chunk = await reader.read(); guard(); if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw Error("METADATA_STREAM_INVALID");
        bytes += chunk.value.byteLength; if (bytes > limit) throw Error("METADATA_BODY_UNAVAILABLE_OR_OVERSIZED"); chunks.push(chunk.value);
      }
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      stage = "VALIDATE_METADATA";
      const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)), delivery = raw?.Delivery;
      if (!object(raw) || !object(delivery) || !uuid(delivery.PublicID) || delivery.PublicID !== spec.deliveryPublicId ||
          !uuid(delivery.SessionPublicID) || raw.SessionId !== delivery.SessionPublicID || !uuid(delivery.SessionFileId))
        throw Error("METADATA_IDENTITY_MISMATCH");
      const timestamps = delivery.Timestamps == null ? [] : delivery.Timestamps;
      if (!Array.isArray(timestamps) || timestamps.length > 10000 || timestamps.some(entry => !object(entry) || entry.SessionID !== delivery.SessionFileId))
        throw Error("METADATA_IDENTITY_MISMATCH");
      stage = "SANITIZE_METADATA";
      const cleaned = sanitize(raw), model: any = cleaned.data;
      if (cleaned.limitReached || !object(model) || !object(model.Delivery)) throw Error("METADATA_SANITIZATION_INCOMPLETE");
      const cleanTimestamps = model.Delivery.Timestamps == null ? [] : model.Delivery.Timestamps;
      if (!Array.isArray(cleanTimestamps) || cleanTimestamps.length !== timestamps.length || cleanTimestamps.some(entry => !object(entry)))
        throw Error("METADATA_SANITIZATION_INCOMPLETE");
      // These are validated content GUIDs, not authentication session fields.
      model.SessionId = raw.SessionId;
      cleanTimestamps.forEach((entry, index) => { entry.SessionID = timestamps[index].SessionID; });
      const text = JSON.stringify(model, null, 2);
      if (new TextEncoder().encode(text).length > limit) throw Error("METADATA_BODY_UNAVAILABLE_OR_OVERSIZED");
      guard(); return text;
    };
    const text = await Promise.race([collect(), timeout]);
    stage = "DOWNLOAD_METADATA"; guard();
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" })), anchor = document.createElement("a");
    try { anchor.href = url; anchor.download = "CTI_PANOPTO_DELIVERY_INFO.json"; anchor.click(); }
    finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    const result = { ok: true, stage: "METADATA_DOWNLOAD_TRIGGERED", notForCourseAudit: true };
    try { console.info("Panopto metadata download triggered. Video and caption files remain unverified.", result); } catch {}
    return result;
  } catch (error) {
    const allowed = ["EXACT_PANOPTO_ROUTE_REQUIRED_OR_CHANGED", "METADATA_READ_TIMEOUT", "METADATA_RESPONSE_REJECTED", "METADATA_JSON_REQUIRED",
      "METADATA_BODY_UNAVAILABLE_OR_OVERSIZED", "METADATA_STREAM_INVALID", "METADATA_IDENTITY_MISMATCH", "METADATA_SANITIZATION_INCOMPLETE"];
    let code = timedOut ? "METADATA_READ_TIMEOUT" : "METADATA_READ_OR_DOWNLOAD_FAILED";
    try { const message = error instanceof Error ? error.message : ""; if (!timedOut && allowed.includes(message)) code = message; } catch {}
    const result = { ok: false, stage, code, notForCourseAudit: true };
    try { console.error("Panopto metadata check stopped. No video or caption files were read.", result); } catch {}
    return result;
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
    else if (response?.body) { try { void response.body.cancel().catch(() => {}); } catch {} }
  }
}

export function buildPanoptoDeliveryInfoScript(targetUrl: string): string {
  const identity = panoptoTargetIdentity(targetUrl);
  if (!identity) throw Error("Choose a captured Panopto recording target.");
  return `(${readPanoptoDeliveryInfo.toString()})(${JSON.stringify(identity)},(${sanitizeCourseraCourseDataModel.toString()}))`;
}
