// Isolated world. Only the CTI origin can reach this narrow data-only protocol.
(() => {
  if (
    window !== window.top ||
    location.origin !== "https://cti-hardening.pages.dev"
  )
    return;
  const active = new Set();
  window.addEventListener("message", async (event) => {
    const m = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      m?.channel !== "CTI_EXTENSION_REQUEST" ||
      typeof m.requestId !== "string" ||
      m.requestId.length > 80 ||
      active.has(m.requestId)
    )
      return;
    if (active.size >= 6) return;
    active.add(m.requestId);
    try {
      const response = await chrome.runtime.sendMessage(m.body);
      window.postMessage(
        { channel: "CTI_EXTENSION_RESPONSE", requestId: m.requestId, response },
        location.origin,
      );
    } catch {
      window.postMessage(
        {
          channel: "CTI_EXTENSION_RESPONSE",
          requestId: m.requestId,
          response: {
            ok: false,
            error:
              "Extension connection lost. Reload the extension and CTI, then retry.",
          },
        },
        location.origin,
      );
    } finally {
      active.delete(m.requestId);
    }
  });
})();
