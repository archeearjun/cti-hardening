// Packaged isolated-world relay: no capture body or credentials in messages.
(() => {
  if (
    window !== window.top ||
    location.origin !== "https://www.coursera.org" ||
    window.__ctiRelayInstalled
  )
    return;
  window.__ctiRelayInstalled = true;
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== "CTI_CAPTURE_FINISHED" ||
      !/^[a-f0-9-]{36}$/.test(event.data.id || "")
    )
      return;
    chrome.runtime
      .sendMessage({ type: "CAPTURE_FINISHED", id: event.data.id })
      .catch(() => {});
  });
})();
