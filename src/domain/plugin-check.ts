import { safeWebUrl } from "./owner-actions.ts";
import type { ItemCheckSpec } from "./item-check.ts";
import type { EvidenceObject } from "./workspace-types.ts";

export interface PluginCheckSpec extends ItemCheckSpec {
  targetUrl: string;
  requestId: string;
  requestedAt: string;
}

// Self-contained so the exact same code runs in the external page's console.
// No requests, clicks, form values, storage, or cross-origin access attempts.
export async function capturePluginPage(spec: PluginCheckSpec) {
  const expected = new URL(spec.targetUrl);
  const start = location.href;
  if (new URL(start).href !== expected.href)
    throw Error(
      "Open the exact external-page link from this card before running its check.",
    );
  const began = Date.now();
  let previous = "",
    stable = 0,
    samples = 0,
    observedLength = 0,
    text = "";
  // This captures the visible screen only. Rise branches and hidden screens are
  // not traversed or inferred from a DOM snapshot.
  while (Date.now() - began < 20000) {
    if (location.href !== start)
      throw Error(
        "The page changed during capture. No completed check was produced.",
      );
    text = String(document.body?.innerText || "").trim();
    observedLength = text.length;
    text = text.slice(0, 48000);
    const loading =
      document.readyState !== "complete" ||
      Array.from(document.querySelectorAll('[aria-busy="true"]')).some(
        (el) => (el as HTMLElement).getClientRects().length > 0,
      );
    stable = text === previous && !loading ? stable + 1 : 0;
    previous = text;
    samples++;
    if (Date.now() - began >= 10000 && stable >= 3 && text.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (location.href !== start) throw Error("The page changed during capture.");
  const references: { kind: string; url: string }[] = [];
  let referenceCount = 0;
  for (const el of Array.from(
    document.querySelectorAll(
      "a[href],img[src],iframe[src],video[src],audio[src]",
    ),
  )) {
    const raw = el.getAttribute(el.tagName === "A" ? "href" : "src");
    try {
      const url = new URL(raw || "", document.baseURI);
      if (
        !raw ||
        !/^https?:$/.test(url.protocol) ||
        url.username ||
        url.password
      )
        continue;
      referenceCount++;
      if (references.length < 200)
        references.push({ kind: el.tagName.toLowerCase(), url: url.href });
    } catch {
      /* Unusable reference. */
    }
  }
  const frames = Array.from(document.querySelectorAll("iframe"))
    .slice(0, 12)
    .map((frame) => ({
      url: frame.getAttribute("src") || "",
      contentRead: false,
    }));
  return {
    kind: "CTI_PLUGIN_PAGE_CHECK",
    schemaVersion: 1,
    notForCourseAudit: true,
    auditId: spec.auditId,
    courseId: spec.courseId,
    itemId: spec.itemId,
    targetUrl: spec.targetUrl,
    requestId: spec.requestId,
    requestedAt: spec.requestedAt,
    openedUrl: start,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - began,
    captureContext: window === window.top ? "DIRECT_PAGE" : "SELECTED_FRAME",
    title: String(document.title || "").slice(0, 500),
    text,
    observedLength,
    textTruncated: observedLength > text.length,
    references,
    referenceCount,
    referencesTruncated: referenceCount > references.length,
    frames,
    frameCount: document.querySelectorAll("iframe").length,
    status:
      text.length && stable >= 3
        ? "VISIBLE_SCREEN_OBSERVED"
        : "PARTIAL_OR_LOADING",
    samples,
    wholePluginVerified: false,
    courseLaunchVerified: false,
    interactionVerified: false,
    binaryContentVerified: false,
  };
}

export function buildPluginCheckScript(spec: PluginCheckSpec) {
  if (
    !safeWebUrl(spec.targetUrl) ||
    !spec.auditId ||
    !spec.itemId ||
    !spec.courseId ||
    !spec.requestId ||
    !Number.isFinite(Date.parse(spec.requestedAt))
  )
    throw Error(
      "A captured plugin target and this report's item identity are required.",
    );
  return `(async()=>{const spec=${JSON.stringify(spec)};console.info('CTI: capturing this visible page for up to 20 seconds.');const result=await (${capturePluginPage.toString()})(spec);window.__CTI_PLUGIN_PAGE_CHECK=result;const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='CTI_PLUGIN_CHECK_'+spec.itemId+'_'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);console.info('Plugin page evidence downloaded. It does not verify course launch, hidden screens, or interaction.',result);})().catch(console.error);`;
}

export function validatePluginCheck(
  value: EvidenceObject,
  spec: PluginCheckSpec,
) {
  if (
    value?.kind !== "CTI_PLUGIN_PAGE_CHECK" ||
    value.schemaVersion !== 1 ||
    value.notForCourseAudit !== true
  )
    throw Error("Choose the plugin-page JSON generated by this card.");
  for (const key of [
    "auditId",
    "courseId",
    "itemId",
    "targetUrl",
    "requestId",
    "requestedAt",
  ] as const)
    if (value[key] !== spec[key])
      throw Error(
        "This plugin check belongs to another item, target, or request. Copy this card's script again.",
      );
  const finished = Date.parse(value.finishedAt),
    requested = Date.parse(spec.requestedAt);
  if (
    !Number.isFinite(finished) ||
    finished < requested ||
    finished > Date.now() + 60000 ||
    Date.now() - requested > 86400000 ||
    safeWebUrl(value.openedUrl) !== safeWebUrl(spec.targetUrl) ||
    !safeWebUrl(spec.targetUrl)
  )
    throw Error(
      "The plugin capture is stale or does not identify the expected page.",
    );
  if (
    typeof value.text !== "string" ||
    value.text.length > 48000 ||
    !Array.isArray(value.references) ||
    value.references.length > 200 ||
    !value.references.every(
      (r: EvidenceObject) => typeof r.kind === "string" && !!safeWebUrl(r.url),
    ) ||
    !Array.isArray(value.frames) ||
    value.frames.length > 12 ||
    !["DIRECT_PAGE", "SELECTED_FRAME"].includes(value.captureContext) ||
    !["VISIBLE_SCREEN_OBSERVED", "PARTIAL_OR_LOADING"].includes(value.status)
  )
    throw Error("Invalid or oversized plugin-page evidence.");
  // Never trust imported claims that this diagnostic cleared the course audit.
  return {
    ...value,
    wholePluginVerified: false,
    courseLaunchVerified: false,
    interactionVerified: false,
    binaryContentVerified: false,
    automatedResolution: false,
  };
}
