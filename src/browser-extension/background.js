import {
  CTI_ORIGIN,
  PROTOCOL,
  MAX_JOB_MS,
  MAX_RESULT_BYTES,
  JOB_KEY,
  itemLocation,
  trustedCtiSender,
  validateRequest,
  ownsJob,
} from "./protocol.js";
// Session storage contains request metadata only. Capture bodies stay in the
// temporary Coursera tab and are erased by closing it after ACK/cancel/expiry.
let queue = Promise.resolve();
const serialize = (fn) => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
};
const load = async () => (await chrome.storage.session.get(JOB_KEY))[JOB_KEY];
const save = async (job) => chrome.storage.session.set({ [JOB_KEY]: job });
async function readPage(job, includeResult = false) {
  const tab = await chrome.tabs.get(job.captureTabId);
  const u = new URL(tab.url || "https://invalid.test");
  const course = u.pathname.match(
    /^\/teach\/[^/]+\/([\w-]+)\/content(?:\/|$)/,
  )?.[1];
  if (u.origin !== "https://www.coursera.org" || course !== job.spec.courseId)
    throw Error(
      "The capture tab left the expected Coursera editor. Sign in to Coursera, save your item, and retry.",
    );
  const [r] = await chrome.scripting.executeScript({
    target: { tabId: job.captureTabId },
    world: "MAIN",
    func: (id, include) => {
      const j = window.__CTI_EXTENSION_JOB;
      if (!j || j.id !== id) return null;
      return {
        state: j.state,
        phase: j.phase,
        detail: j.detail,
        error: j.error,
        ...(include ? { result: j.result } : {}),
      };
    },
    args: [job.id, includeResult],
  });
  if (job.captureDocumentId && r.documentId !== job.captureDocumentId)
    throw Error(
      "The capture page reloaded. Previous CTI evidence was preserved; retry the refresh.",
    );
  if (!r.result)
    throw Error(
      "The capture was interrupted. Previous CTI evidence was preserved.",
    );
  return r.result;
}
async function cleanup(job) {
  if (job.captureTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(job.captureTabId);
      const u = new URL(tab.url || "");
      // Never close an unrelated page the user opened in this temporary tab.
      if (
        u.origin === "https://www.coursera.org" &&
        u.pathname.match(/^\/teach\/[^/]+\/([\w-]+)\/content(?:\/|$)/)?.[1] ===
          job.spec.courseId
      )
        await chrome.tabs.remove(job.captureTabId);
    } catch {
      /* Tab may already be closed. */
    }
  }
  await chrome.alarms.clear(JOB_KEY);
  await chrome.storage.session.remove(JOB_KEY);
}
async function fail(job, message) {
  job.state = "FAILED";
  job.error = message;
  await save(job);
  await returnToCti(job);
}
async function returnToCti(job) {
  try {
    const [active] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const cti = await chrome.tabs.get(job.ctiTabId);
    if (
      active?.id === job.captureTabId &&
      new URL(cti.url).origin === CTI_ORIGIN
    )
      await chrome.tabs.update(job.ctiTabId, { active: true });
  } catch {
    /* The owner can return to CTI manually. */
  }
}
async function launch(job) {
  const tab = await chrome.tabs.get(job.captureTabId);
  const route = itemLocation(tab.url);
  if (
    !route ||
    route.courseId !== job.spec.courseId ||
    route.itemId !== job.spec.itemId
  )
    throw Error(
      "Open and sign in to the exact Coursera item first, save your changes, then retry from CTI.",
    );
  const [setup] = await chrome.scripting.executeScript({
    target: { tabId: job.captureTabId },
    world: "MAIN",
    func: (id, spec) => {
      if (
        window.__CTI_EXTENSION_JOB ||
        window.__CTI_ITEM_FIDELITY_RUN_LOCK?.running
      )
        throw Error("A capture is already running in this tab.");
      window.__CTI_EXTENSION_JOB = {
        id,
        spec,
        state: "RUNNING",
        phase: "Read course structure",
        detail: "Preparing this item.",
      };
    },
    args: [job.id, job.spec],
  });
  job.captureDocumentId = setup.documentId;
  job.state = "RUNNING";
  await save(job);
  await chrome.scripting.executeScript({
    target: { tabId: job.captureTabId, documentIds: [setup.documentId] },
    files: ["coursera-relay.js"],
  });
  await chrome.scripting.executeScript({
    target: { tabId: job.captureTabId, documentIds: [setup.documentId] },
    world: "MAIN",
    files: ["coursera-item.js"],
  });
}
async function status(job) {
  if (Date.now() > job.expiresAt) {
    await cleanup(job);
    throw Error("Refresh timed out. Previous CTI evidence was preserved.");
  }
  if (job.state === "STARTING" && Date.now() - job.startedAt > 90000) {
    await fail(
      job,
      "Coursera did not finish opening. Sign in in your normal tab, then retry.",
    );
  }
  if (job.state === "RUNNING" || job.state === "READY") {
    try {
      const page = await readPage(job);
      if (page.state === "FAILED")
        await fail(job, String(page.error || "Capture failed.").slice(0, 600));
      else if (page.state === "READY") {
        job.state = "READY";
        await save(job);
        await returnToCti(job);
      }
      return {
        state: job.state,
        error: job.error,
        phase: page.phase,
        detail: page.detail,
      };
    } catch (e) {
      await fail(job, e.message);
    }
  }
  return {
    state: job.state,
    error: job.error,
    phase: job.state === "STARTING" ? "Opening Coursera" : job.state,
  };
}
async function handle(message, sender) {
  if (!trustedCtiSender(sender))
    throw Error("Only the CTI production page can request an item refresh.");
  validateRequest(message);
  if (message.type === "PING")
    return {
      protocol: PROTOCOL,
      version: chrome.runtime.getManifest().version,
    };
  let job = await load();
  if (message.type === "START") {
    if (job && Date.now() > job.expiresAt) {
      await cleanup(job);
      job = null;
    }
    if (job) {
      if (ownsJob(job, sender, message.id)) return { state: job.state };
      throw Error(
        "Another CTI item refresh is active. Return to that CTI tab and cancel or finish it first.",
      );
    }
    job = {
      id: message.id,
      spec: message.spec,
      ctiTabId: sender.tab.id,
      ctiDocumentId: sender.documentId,
      startedAt: Date.now(),
      expiresAt: Date.now() + MAX_JOB_MS,
      state: "STARTING",
    };
    await save(job); // Reserve before creating the temporary tab.
    try {
      const tab = await chrome.tabs.create({
        url: message.spec.url,
        active: true,
        openerTabId: sender.tab.id,
      });
      job.captureTabId = tab.id;
      await save(job);
      await chrome.alarms.create(JOB_KEY, { when: job.expiresAt });
      if (tab.status === "complete") await launch(job);
      return { state: job.state };
    } catch (e) {
      await cleanup(job);
      throw e;
    }
  }
  if (!ownsJob(job, sender, message.id))
    throw Error(
      "Refresh session is no longer available in this CTI tab. Retry; previous evidence is unchanged.",
    );
  if (message.type === "CANCEL" || message.type === "ACK") {
    await cleanup(job);
    return { state: message.type === "ACK" ? "SAVED" : "CANCELLED" };
  }
  const current = await status(job);
  if (message.type === "RESULT") {
    if (current.state !== "READY")
      throw Error("A finished item capture is not available.");
    const page = await readPage(job, true);
    if (
      typeof page.result !== "string" ||
      new TextEncoder().encode(page.result).length > MAX_RESULT_BYTES
    )
      throw Error(
        "Invalid or oversized capture. Previous evidence is unchanged.",
      );
    return { state: "READY", result: page.result };
  }
  return current;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "CAPTURE_FINISHED") {
    serialize(async () => {
      const job = await load();
      if (
        job &&
        sender.frameId === 0 &&
        sender.tab?.id === job.captureTabId &&
        sender.documentId === job.captureDocumentId &&
        message.id === job.id
      )
        await status(job);
    }).then(
      () => respond({ ok: true }),
      () => respond({ ok: false }),
    );
  } else
    serialize(() => handle(message, sender)).then(
      (data) => respond({ ok: true, ...data }),
      (e) =>
        respond({
          ok: false,
          error: String(e.message || "Refresh failed.").slice(0, 600),
        }),
    );
  return true;
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.status !== "complete" && change.status !== "loading") return;
  void serialize(async () => {
    const job = await load();
    if (!job) return;
    if (id === job.ctiTabId && change.status === "loading") {
      await cleanup(job);
      return;
    }
    if (
      id === job.captureTabId &&
      change.status === "complete" &&
      job.state === "STARTING"
    ) {
      try {
        await launch(job);
      } catch (e) {
        await fail(job, e.message);
      }
    }
  }).catch(() =>
    console.warn(
      "CTI could not process a tab update; retry the refresh if it stops responding.",
    ),
  );
});
chrome.tabs.onRemoved.addListener((id) => {
  void serialize(async () => {
    const job = await load();
    if (!job) return;
    if (id === job.ctiTabId) await cleanup(job);
    else if (id === job.captureTabId)
      await fail(
        job,
        "The capture tab was closed. Previous evidence was preserved; retry when ready.",
      );
  }).catch(() => console.warn("CTI could not finish capture-tab cleanup."));
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === JOB_KEY)
    void serialize(async () => {
      const job = await load();
      if (job) {
        await returnToCti(job);
        await cleanup(job);
      }
    }).catch(() =>
      console.warn(
        "CTI could not expire the refresh session; close the capture tab manually.",
      ),
    );
});
