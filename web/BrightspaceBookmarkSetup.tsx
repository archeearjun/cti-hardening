import { useMemo, useState } from "react";
import { getExtractor } from "../src/domain/capture-review";
import {
  BRIGHTSPACE_BOOKMARK_NAME,
  createBrightspaceCaptureBookmark,
} from "../src/domain/brightspace-bookmark";

export default function BrightspaceBookmarkSetup({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const delivery = useMemo(() => {
    try {
      const current = getExtractor("brightspace");
      return {
        version: current.version,
        address: createBrightspaceCaptureBookmark(current.script),
        error: "",
      };
    } catch (error) {
      return {
        version: "",
        address: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);
  const [notice, setNotice] = useState("");

  async function copyAddress() {
    if (disabled || !delivery.address) return;
    try {
      await navigator.clipboard.writeText(delivery.address);
      setNotice(
        "Brightspace bookmark address copied. Create or edit a Chrome bookmark named CTI Brightspace capture, paste the complete address into its URL field, and save. Click that bookmark on the matching Brightspace course Home or Content page.",
      );
    } catch {
      setNotice(
        "Clipboard access is unavailable. Open the complete Brightspace bookmark address copy fallback below, select all, and copy the whole address into a Chrome bookmark’s URL field.",
      );
    }
  }

  return (
    <section
      className="section-divider brightspace-bookmark-setup"
      aria-label="Brightspace bookmark setup"
    >
      <h3>
        Capture Brightspace with one saved bookmark
        {delivery.version && ` · ${delivery.version}`}
      </h3>
      <p>
        Save this bookmark once, then use it in the matching Brightspace course
        in your usual signed-in Chrome profile. DevTools can stay closed. No
        extension or installation is needed.
      </p>
      <ol className="local-extraction-steps">
        <li>
          <strong>Save or update {BRIGHTSPACE_BOOKMARK_NAME}.</strong>
          <span>
            Show Chrome’s bookmarks bar with Command+Shift+B on Mac or
            Ctrl+Shift+B on Windows. Drag the link below onto the bar, or copy
            its complete address into a new bookmark’s URL field. Replace an
            older bookmark’s URL with this version.
          </span>
        </li>
        <li>
          <strong>
            Open the course Home or Content page and click the bookmark.
          </strong>
          <span>
            Confirm the course before starting. Keep that Brightspace tab open
            while the capture card runs. The bookmark uses your existing access;
            unavailable or unsupported sources remain recorded gaps.
          </span>
        </li>
        <li>
          <strong>
            Bring the downloaded .cti.zip source capture back to CTI.
          </strong>
          <span>
            Inspect the course identity and recorded gaps before using the
            capture in comparison. A finished download alone does not establish
            complete source coverage.
          </span>
        </li>
      </ol>
      <div className="action-links">
        {!disabled && delivery.address && (
          <a
            ref={(element) => {
              // React sanitizes javascript href props. Assign only this locally
              // generated drag target, and prevent execution in the CTI page.
              if (element) element.href = delivery.address;
            }}
            draggable
            onClick={(event) => {
              event.preventDefault();
              setNotice(
                "Drag this link to Chrome’s bookmarks bar, then click the saved bookmark on the matching Brightspace course Home or Content page. Clicking it here does not run capture.",
              );
            }}
          >
            {BRIGHTSPACE_BOOKMARK_NAME}
          </a>
        )}
        <button
          className="primary"
          disabled={disabled || !delivery.address}
          onClick={() => void copyAddress()}
        >
          Copy Brightspace bookmark address
        </button>
      </div>
      {disabled && (
        <p className="hint">
          Finish the active CTI step before setting up capture.
        </p>
      )}
      {delivery.error && <p role="alert">{delivery.error}</p>}
      {notice && (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {delivery.address && (
        <details className="scope">
          <summary>Complete Brightspace bookmark address copy fallback</summary>
          <p className="hint">
            Select all and copy the entire address into a bookmark’s URL field.
            Save the bookmark, then use it in Brightspace.
          </p>
          <textarea
            className="extractor-source"
            aria-label="CTI Brightspace capture bookmark address"
            readOnly
            disabled={disabled}
            value={delivery.address}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      )}
    </section>
  );
}
