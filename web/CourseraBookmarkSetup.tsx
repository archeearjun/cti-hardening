import { useMemo, useState } from "react";
import { createCourseraCourseDataProbeBookmark } from "../src/domain/coursera-course-data-probe.ts";

export default function CourseraBookmarkSetup({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const address = useMemo(() => createCourseraCourseDataProbeBookmark(), []);
  const [notice, setNotice] = useState("");

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setNotice(
        "Bookmark address copied. Add a Chrome bookmark named CTI course data check and paste this into its URL field. Then click it on the Coursera course Content page.",
      );
    } catch {
      setNotice(
        "Use the bookmark address below: select it, copy it, and paste it into a Chrome bookmark’s URL field.",
      );
    }
  }

  return (
    <div className="section-divider coursera-bookmark-setup">
      <h3>Bookmark course data check</h3>
      <p>
        Full-course bookmark extraction is still being verified. This short
        check reads the current course structure without opening quizzes or
        reloading Coursera. It produces a diagnostic JSON to establish the data
        path; it is not a complete course capture.
      </p>
      <ol className="local-extraction-steps">
        <li>
          <strong>Save the bookmark once.</strong>
          <span>
            Show Chrome’s bookmarks bar with Command+Shift+B on Mac or
            Ctrl+Shift+B on Windows. Drag the link below onto that bar, or copy
            its address into a new bookmark’s URL field.
          </span>
        </li>
        <li>
          <strong>Click it on the signed-in Coursera Content page.</strong>
          <span>
            Use a normal tab with the extractor stopped. The same bookmark works
            on any authoring course. DevTools can stay closed. The check runs
            for up to one minute.
          </span>
        </li>
        <li>
          <strong>Send the diagnostic JSON from Coursera.</strong>
          <span>
            The check attempts one JSON download when it stops. If Chrome blocks
            it, use Download course data check in its card. The file stays
            local; it contains course data and should be shared only with the
            person investigating capture.
          </span>
        </li>
      </ol>
      <div className="action-links">
        {!disabled && (
          <a
            ref={(element) => {
              // A trusted, locally generated bookmark program. React sanitizes
              // javascript hrefs; assign this dedicated drag target on each mount.
              // The click handler prevents execution in CTI's own document.
              if (element) element.href = address;
            }}
            draggable
            onClick={(event) => {
              event.preventDefault();
              setNotice(
                "Drag this link to Chrome’s bookmarks bar, then click the saved bookmark on Coursera. Clicking the link here cannot read Coursera.",
              );
            }}
          >
            CTI course data check
          </a>
        )}
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => void copyAddress()}
        >
          Copy bookmark address
        </button>
      </div>
      {disabled && (
        <p className="hint">
          Stop the managed run before using the course data check.
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      )}
      <details className="scope">
        <summary>Bookmark address copy fallback</summary>
        <p className="hint">
          Paste the whole address into the bookmark’s URL field. Do not paste it
          into the address bar.
        </p>
        <textarea
          className="extractor-source"
          aria-label="CTI course data check bookmark address"
          readOnly
          disabled={disabled}
          value={address}
          onFocus={(event) => event.currentTarget.select()}
        />
      </details>
    </div>
  );
}
