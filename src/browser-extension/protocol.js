export const CTI_ORIGIN = "https://cti-hardening.pages.dev";
export const PROTOCOL = 1;
export const MAX_JOB_MS = 21 * 60 * 1000;
export const MAX_RESULT_BYTES = 16 * 1024 * 1024;
export const JOB_KEY = "ctiItemRefresh";
export function itemLocation(value) {
  try {
    const u = new URL(value);
    if (
      u.origin !== "https://www.coursera.org" ||
      u.username ||
      u.password ||
      u.hash
    )
      return null;
    const m = u.pathname.match(
      /^\/teach\/([a-z0-9-]+)\/([\w-]+)\/content(?:\/edit|\/item\/[\w-]+\/[\w-]+)\/?$/i,
    );
    if (!m) return null;
    const itemId =
      u.pathname.match(/\/item\/[\w-]+\/([\w-]+)\/?$/)?.[1] ||
      u.searchParams.get("itemId");
    if (!itemId || !/^[\w-]{1,160}$/.test(itemId)) return null;
    return { courseId: m[2], itemId, url: u.href };
  } catch {
    return null;
  }
}
export function trustedCtiSender(sender) {
  try {
    return (
      sender.frameId === 0 &&
      Number.isInteger(sender.tab?.id) &&
      new URL(sender.url).origin === CTI_ORIGIN &&
      !!sender.documentId
    );
  } catch {
    return false;
  }
}
export function validateRequest(message) {
  if (
    !message ||
    message.protocol !== PROTOCOL ||
    !["PING", "START", "STATUS", "RESULT", "ACK", "CANCEL"].includes(
      message.type,
    )
  )
    throw Error("Unsupported CTI extension request. Update the extension.");
  if (
    message.type !== "PING" &&
    (typeof message.id !== "string" || !/^[a-f0-9-]{36}$/.test(message.id))
  )
    throw Error("Invalid refresh identifier.");
  if (message.type !== "START") return message;
  const s = message.spec,
    route = itemLocation(s?.url);
  if (
    !s ||
    !route ||
    route.courseId !== s.courseId ||
    route.itemId !== s.itemId ||
    typeof s.auditId !== "string" ||
    !s.auditId ||
    s.auditId.length > 200 ||
    typeof s.name !== "string" ||
    s.name.length > 2000 ||
    !Array.isArray(s.checks) ||
    s.checks.length > 1000 ||
    JSON.stringify(s).length > 256000
  )
    throw Error("The refresh must identify one item in a saved CTI report.");
  for (const c of s.checks)
    if (
      !c ||
      !["url", "file", "prompt"].includes(c.kind) ||
      typeof c.value !== "string" ||
      typeof c.label !== "string"
    )
      throw Error("Invalid expected item evidence.");
  return message;
}
export function ownsJob(job, sender, id) {
  return (
    !!job &&
    job.id === id &&
    job.ctiTabId === sender.tab?.id &&
    job.ctiDocumentId === sender.documentId &&
    trustedCtiSender(sender)
  );
}
