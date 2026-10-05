import { useEffect, useRef, useState } from "react";
import {
  extensionRequest,
  EXTENSION_VERSION,
  validateRefreshCapture,
  refreshedItemSummary,
} from "../src/domain/browser-item-refresh";
import type { ItemCheckSpec } from "../src/domain/item-check";
import { download } from "./workspace-ui";

export default function CourseraItemRefresh({
  spec,
  disabled,
  previousCount,
  onImport,
  onBusy,
}: {
  spec: ItemCheckSpec;
  disabled: boolean;
  previousCount?: number;
  onImport: (text: string) => Promise<void>;
  onBusy: (value: string) => void;
}) {
  const [ready, setReady] = useState(false),
    [running, setRunning] = useState(false),
    [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("Checking for the CTI extension…"),
    [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0),
    [result, setResult] = useState("");
  const active = useRef<{ id: string; controller: AbortController } | null>(
      null,
    ),
    alive = useRef(true);
  const identity = `${spec.auditId}:${spec.courseId}:${spec.itemId}`;
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void extensionRequest({ type: "PING" }, controller.signal, 2000)
      .then((r) => {
        if (!alive.current) return;
        const compatible = r.protocol === 1 && r.version === EXTENSION_VERSION;
        setReady(compatible);
        setStatus(
          compatible
            ? "CTI extension connected."
            : "Update the CTI extension using the download below, then reload it and CTI.",
        );
      })
      .catch(() => {
        if (alive.current)
          setStatus(
            "Install the CTI extension once to enable one-click refresh.",
          );
      });
    return () => {
      alive.current = false;
      controller.abort();
      const run = active.current;
      if (run) {
        run.controller.abort();
        void extensionRequest({ type: "CANCEL", id: run.id }).catch(() => {});
      }
    };
  }, [identity]);
  async function refresh() {
    if (active.current || disabled) return;
    const controller = new AbortController(),
      id = crypto.randomUUID(),
      started = Date.now();
    active.current = { id, controller };
    setRunning(true);
    setStatus("Opening Coursera…");
    setError("");
    setResult("");
    setElapsed(0);
    onBusy("Refreshing Coursera item…");
    const timer = window.setInterval(() => {
      if (alive.current) setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    try {
      const ping = await extensionRequest({ type: "PING" }, controller.signal);
      if (ping.protocol !== 1 || ping.version !== EXTENSION_VERSION)
        throw Error("Update the CTI extension before refreshing.");
      await extensionRequest({ type: "START", id, spec }, controller.signal);
      while (Date.now() - started < 21 * 60 * 1000) {
        const s = await extensionRequest(
          { type: "STATUS", id },
          controller.signal,
        );
        if (s.state === "FAILED")
          throw Error(
            s.error || "Capture failed. Previous evidence was preserved.",
          );
        if (s.state === "READY") {
          const response = await extensionRequest(
            { type: "RESULT", id },
            controller.signal,
          );
          if (typeof response.result !== "string")
            throw Error("Capture result is missing.");
          const checked = validateRefreshCapture(
            response.result,
            spec,
            started,
            previousCount,
          );
          controller.signal.throwIfAborted();
          setResult(response.result);
          if (checked.problem)
            throw Error(
              `${checked.problem} Previous CTI evidence was preserved. You can download this partial observation for review.`,
            );
          setSaving(true);
          setStatus("Saving fresh item evidence…");
          // Cancellation is disabled during this atomic, version-checked save.
          await onImport(response.result);
          if (alive.current)
            setStatus(refreshedItemSummary(checked.capture, previousCount));
          await extensionRequest({ type: "ACK", id }).catch(() => {});
          return;
        }
        if (!["STARTING", "RUNNING"].includes(String(s.state)))
          throw Error("Refresh session ended without fresh evidence.");
        if (alive.current)
          setStatus(
            `${s.phase || "Capturing item"}${s.detail ? ` — ${s.detail}` : ""}. Keep the temporary Coursera tab visible.`,
          );
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(wait);
            reject(new DOMException("Refresh cancelled.", "AbortError"));
          };
          const wait = window.setTimeout(() => {
            controller.signal.removeEventListener("abort", abort);
            resolve();
          }, 1500);
          controller.signal.addEventListener("abort", abort, { once: true });
        });
      }
      throw Error("Refresh timed out. Previous evidence was preserved.");
    } catch (e) {
      if (alive.current) {
        setStatus("Refresh stopped. Review the message below.");
        setError(
          e instanceof Error
            ? e.message
            : "Refresh failed. Previous evidence was preserved.",
        );
      }
      await extensionRequest({ type: "CANCEL", id }).catch(() => {});
    } finally {
      clearInterval(timer);
      active.current = null;
      onBusy("");
      if (alive.current) {
        setRunning(false);
        setSaving(false);
      }
    }
  }
  return (
    <section className="scope item-refresh" aria-label="Refresh Coursera item">
      <h5>Refresh after editing Coursera</h5>
      <p>
        Save your Coursera changes first. CTI opens a temporary capture tab;
        keep it visible and do not edit there. Your normal editing tab stays
        open.
      </p>
      <button
        type="button"
        disabled={disabled || running || !ready}
        onClick={() => void refresh()}
      >
        Refresh this Coursera item
      </button>
      {running && (
        <button
          type="button"
          className="secondary"
          disabled={saving}
          onClick={() => active.current?.controller.abort()}
        >
          Cancel item refresh
        </button>
      )}
      <p role="status">
        {status}
        {running ? ` · ${elapsed}s elapsed` : ""}
      </p>
      {error && <p role="alert">{error}</p>}
      {result && !running && (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            download(
              `CTI_ITEM_CHECK_${spec.itemId}.json`,
              result,
              "application/json",
            )
          }
        >
          Download this refresh observation
        </button>
      )}
      <details open={!ready}>
        <summary>Install or update the CTI extension</summary>
        <ol>
          <li>
            <a href="/downloads/cti-browser-extension.zip" download>
              Download CTI extension {EXTENSION_VERSION}
            </a>{" "}
            and extract the ZIP into a folder you will keep.
          </li>
          <li>
            Open <code>chrome://extensions</code> in Chrome and turn on{" "}
            <strong>Developer mode</strong>.
          </li>
          <li>
            Click <strong>Load unpacked</strong> and select the extracted{" "}
            <strong>CTI-browser-extension</strong> folder containing{" "}
            <code>manifest.json</code>.
          </li>
          <li>
            Refresh this CTI tab. Use the same Chrome profile where you are
            signed in to Coursera.
          </li>
        </ol>
        <p>
          For updates, replace the files in that same folder, click Reload on
          the extension, then refresh CTI. If your work browser blocks
          installation, use the manual item-check workflow below or contact your
          browser administrator.
        </p>
        <p className="hint">
          Runs on your computer. No remote-browser quota or password export.
          Captured content follows your workspace's normal saving rules.
          Refreshing records evidence; it does not approve publication.
        </p>
      </details>
    </section>
  );
}
