import { useMemo, useState } from "react";
import {
  COURSERA_DIRECT_DATA_CAPTURE_VERSION,
  createCourseraDirectDataCaptureBookmark,
  createCourseraDirectDataCaptureScript,
} from "../src/domain/coursera-direct-data-capture.ts";

export default function CourseraDirectCaptureSetup({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const delivery = useMemo(() => {
    try {
      const script = createCourseraDirectDataCaptureScript();
      try {
        return {
          script,
          address: createCourseraDirectDataCaptureBookmark(),
          error: "",
        };
      } catch (error) {
        return {
          script,
          address: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } catch (error) {
      return {
        script: "",
        address: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);
  const [notice, setNotice] = useState("");

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(delivery.address);
      setNotice(
        "Bookmark address copied. Create or edit the Chrome bookmark named CTI course capture and paste the whole address into its URL field. Save it once, then click it on Coursera’s Content page.",
      );
    } catch {
      setNotice(
        "Open the bookmark address fallback below, select all, and copy it into a Chrome bookmark’s URL field. The fallback contains the complete address.",
      );
    }
  }

  return (
    <div className="section-divider coursera-direct-capture-setup">
      <h3>
        Capture with one saved bookmark · v
        {COURSERA_DIRECT_DATA_CAPTURE_VERSION}
      </h3>
      <p>
        CTI reads the course outline and supported content directly in your
        signed-in Coursera tab. It saves each item and question group locally,
        then prepares one .cti.zip file containing the course data and downloaded
        original files. You can keep DevTools closed. No
        extension, installation, or paid browser service is required.
      </p>
      <p className="hint">
        This captures authoring drafts. Published versions, when returned by
        Coursera, are retained separately. Where Coursera supplies the original
        source, CTI includes referenced images and attachments in the same file.
        It identifies supported item types automatically, including Panopto
        plugins. Accessible Panopto metadata and supported MP4 renditions are
        read within this run and saved in the same archive. CTI opens one helper
        tab to request supported public Panopto sources through its own service.
        Keep that tab open and sign into CTI there if requested. Your Panopto
        login is not sent to the service. Unavailable access, missing sources, and unsupported content stay visible as
        evidence gaps. A saved video does not establish complete widget content.
      </p>
      <ol className="local-extraction-steps">
        <li>
          <strong>Save or update CTI course capture once.</strong>
          <span>
            Show Chrome’s bookmarks bar with Command+Shift+B on Mac or
            Ctrl+Shift+B on Windows. Drag the link below onto it, or copy its
            address into a new bookmark’s URL field. For an earlier bookmark,
            replace its URL with this version once.
          </span>
        </li>
        <li>
          <strong>Click the saved bookmark on Coursera’s Content page.</strong>
          <span>
            Open the authoring course in your usual signed-in Chrome profile.
            The same bookmark works for other courses and opens no item editors.
            Choose Capture/resume course on its card, then keep the tab open
            while it runs. Allow the CTI helper tab and keep it open. Choose Check Panopto access to test only the
            configured video sources without recapturing course content.
          </span>
        </li>
        <li>
          <strong>Return the final capture to CTI.</strong>
          <span>
            Select the .cti.zip file directly in CTI; no unzipping is needed.
            Earlier JSON and .json.gz captures still open directly.
            The progress card offers Download saved capture if Chrome blocks the
            download. Check the file below before using it in Compare. If
            capture is interrupted, reopen the same course’s Content page and
            click the same bookmark and choose Capture/resume course. CTI checks current sources before reusing
            matching saved reads. A finished capture with evidence gaps can
            refresh plugin sources and continue file downloads without
            collecting its saved questions again.
          </span>
        </li>
      </ol>
      <p className="hint">
        Saved progress stays in this Chrome profile. Use the same profile when
        resuming. This version can continue saved v1.2–v1.6 progress that reached
        its media limit or finished with evidence gaps. It rechecks the current
        course sources and preserves earlier assessment observations and their
        dates.
      </p>
      <p className="hint">
        If a previous Panopto error is no longer visible, use Check Panopto
        access. It keeps saved course progress unchanged and offers Copy access
        result and Download access report. It distinguishes CTI connection or
        sign-in failures from an observed Panopto response. Public source
        availability is checked on each attempt. This check does not download
        video bytes or verify captions.
      </p>
      <div className="action-links">
        {!disabled && delivery.address && (
          <a
            ref={(element) => {
              // React sanitizes javascript href props. This locally generated drag
              // target is assigned directly and cannot execute in CTI's document.
              if (element) element.href = delivery.address;
            }}
            draggable
            onClick={(event) => {
              event.preventDefault();
              setNotice(
                "Drag this link to Chrome’s bookmarks bar, then click the saved bookmark on Coursera’s Content page. Clicking it here does not run capture.",
              );
            }}
          >
            CTI course capture
          </a>
        )}
        <button
          className="secondary"
          disabled={disabled || !delivery.address}
          onClick={() => void copyAddress()}
        >
          Copy capture bookmark address
        </button>
      </div>
      {disabled && (
        <p className="hint">
          End the active CTI step or stop the managed run before starting
          bookmark capture.
        </p>
      )}
      {delivery.error && (
        <p role="alert" className="hint">
          {delivery.error}
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {delivery.address && (
        <details className="scope">
          <summary>Complete bookmark address copy fallback</summary>
          <p className="hint">
            Click inside, select all, and copy. Paste the whole address into a
            bookmark’s URL field.
          </p>
          <textarea
            className="extractor-source"
            aria-label="CTI course capture bookmark address"
            readOnly
            disabled={disabled}
            value={delivery.address}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      )}
      {!delivery.address && delivery.script && (
        <details className="scope">
          <summary>Complete capture script copy fallback</summary>
          <p className="hint">
            This fallback contains the full program. Select all and paste it
            into the normal Console on the Coursera Content page.
          </p>
          <textarea
            className="extractor-source"
            aria-label="CTI direct course capture script"
            readOnly
            disabled={disabled}
            value={delivery.script}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      )}
    </div>
  );
}
