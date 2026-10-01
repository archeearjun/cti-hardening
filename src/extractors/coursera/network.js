import { CTI_API_FETCH_TIMEOUT_MS } from "./config.js";

export async function fetchWithTimeoutV6150(url, init, timeoutMs) {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(
        () => controller.abort(),
        Math.max(1000, Number(timeoutMs || CTI_API_FETCH_TIMEOUT_MS)),
      )
    : null;
  try {
    return await fetch(
      url,
      Object.assign({}, init || {}, controller ? { signal: controller.signal } : {}),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
