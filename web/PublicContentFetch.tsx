import { useEffect, useRef, useState } from "react";
export default function PublicContentFetch({
  url,
  sourceKey,
  disabled,
  onFetch,
  label = "Fetch source text and questions",
  cancelLabel = "Cancel source fetch",
}: {
  url: string;
  sourceKey: string;
  disabled: boolean;
  onFetch: (key: string, url: string, signal: AbortSignal) => Promise<void>;
  label?: string;
  cancelLabel?: string;
}) {
  const control = useRef<AbortController | null>(null),
    [busy, setBusy] = useState(false),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState("");
  useEffect(() => () => control.current?.abort(), []);
  return (
    <div>
      <button
        className="primary"
        disabled={disabled || busy}
        onClick={async () => {
          if (control.current) return;
          const controller = new AbortController();
          control.current = controller;
          setBusy(true);
          setSeconds(0);
          setError("");
          const began = Date.now(),
            timer = setInterval(
              () => setSeconds(Math.floor((Date.now() - began) / 1000)),
              1000,
            );
          try {
            await onFetch(sourceKey, url, controller.signal);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            clearInterval(timer);
            control.current = null;
            setBusy(false);
          }
        }}
      >
        {label}
      </button>
      {busy && (
        <p role="status">
          Fetching… {seconds}s. Public page fetch limit: 20 seconds.{" "}
          <button
            className="secondary"
            onClick={() => control.current?.abort()}
          >
            {cancelLabel}
          </button>
        </p>
      )}
      {error && <p role="alert">{error} Previous evidence was preserved.</p>}
    </div>
  );
}
