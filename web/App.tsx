import { lazy, Suspense, useEffect, useState } from "react";

const OwnerWorkspace = lazy(() => import("./OwnerWorkspace"));

// Fail closed even if an old tab or a static fallback bypasses Pages middleware.
// No local data store or full-workspace module is opened until the server agrees.
export default function App() {
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      current: AbortController | undefined;
    async function check() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetch("/api/access", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!r.ok) throw Error("Access could not be verified.");
        const result: unknown = await r.json();
        if (active && current === controller) {
          setOwner(
            typeof result === "object" &&
              result !== null &&
              "fullCti" in result &&
              result.fullCti === true,
          );
          setError("");
        }
      } catch {
        if (active && current === controller) {
          setOwner(false);
          setError(
            "Workspace access could not be verified. Retry after signing in.",
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    void check();
    const interval = setInterval(() => void check(), 60000);
    const focus = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      active = false;
      current?.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [retry]);
  if (owner)
    return (
      <Suspense fallback={<p role="status">Loading your CTI workspace…</p>}>
        <OwnerWorkspace />
      </Suspense>
    );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="topbar">
        <a className="brand" href="/">
          CTI
        </a>
        <span>Course activities</span>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="card" aria-labelledby="gateway-title">
          <span className="badge">Activity designer · Preview</span>
          <h1 id="gateway-title">Role Play &amp; Dialogue</h1>
          <p>
            Bring course evidence, review useful activity ideas, and get exact
            placements and copyable Coursera fields through your approved AI
            chat.
          </p>
          <a className="primary" href="/activity-designer/index.html">
            Open Role Play &amp; Dialogue
          </a>
          <p>The complete workflow will be operational very soon.</p>
          {error && (
            <p role="alert">
              {error}{" "}
              <button className="secondary" onClick={() => setRetry(retry + 1)}>
                Retry access check
              </button>
            </p>
          )}
        </section>
      </main>
    </>
  );
}
