import { useState } from "react";
import type { EvidenceObject } from "../src/domain/workspace-types";
import { safeWebUrl, resolveSourceTopic } from "../src/domain/owner-actions";
import { digest } from "../src/domain/workspace-store";
import { download } from "./workspace-ui";
import EvidenceDetails from "./EvidenceDetails";
import CtiAnswerPanel from "./CtiAnswerPanel";
import {
  contentQuestion,
  contentQuestionText,
} from "../src/domain/content-evidence";
import { choiceLabel } from "../src/domain/cti-answer-check";

export default function SourceRepairEvidence({
  sources,
  context,
  packageHash,
}: {
  sources: EvidenceObject[];
  context: EvidenceObject;
  packageHash: string;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [archive, setArchive] = useState<File | null>(null);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(
        "Source text copied. Paste only the part required by this finding into the intended Coursera item.",
      );
    } catch {
      setMessage(
        "Clipboard unavailable. Select the source text or use Download source text.",
      );
    }
  }
  async function restoreFile(file: EvidenceObject) {
    if (!archive) {
      setMessage(
        "Choose the original IMSCC below first. It will be read locally to retrieve this file.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (!/^[a-f0-9]{64}$/i.test(packageHash))
        throw new Error(
          "This saved source has no package hash. Retrieve the listed file from the original package manually; automatic file selection is unavailable.",
        );
      if (archive.size > 256 * 1024 * 1024)
        throw new Error(
          "This package is over the 256 MiB retrieval limit. Extract the listed file on your computer.",
        );
      const bytes = new Uint8Array(await archive.arrayBuffer());
      if ((await digest(bytes)) !== packageHash.toLowerCase())
        throw new Error(
          "That package does not match this saved source scan. Select the original IMSCC used for this report.",
        );
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(bytes);
      const paths = [file.path, file.href, file.name]
        .filter((x): x is string => typeof x === "string")
        .map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""));
      const matches = Object.values(zip.files).filter(
        (entry) => !entry.dir && paths.includes(entry.name),
      );
      if (matches.length !== 1)
        throw new Error(
          "An exact, unique package path was not found. Use the recorded source path to retrieve it manually; a filename guess was not used.",
        );
      const entry = matches[0];
      const expanded = (
        entry as unknown as { _data?: { uncompressedSize?: number } }
      )._data?.uncompressedSize;
      if (!Number.isFinite(expanded) || expanded! > 64 * 1024 * 1024)
        throw new Error(
          "This entry cannot be safely retrieved within the 64 MiB file limit. Extract it locally.",
        );
      const content = await entry.async("uint8array");
      if (
        file.sha256 &&
        (await digest(content)) !== String(file.sha256).toLowerCase()
      )
        throw new Error(
          "The source file checksum did not match. No file was downloaded.",
        );
      download(
        entry.name.split("/").pop() || "source-file",
        content,
        "application/octet-stream",
      );
      setMessage(
        "Source file downloaded from the matching package. Add it to the intended Coursera item, then verify its placement and learner access.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const sourceFiles = sources.flatMap((s) => s.sourcePayload?.files || []);
  return (
    <>
      {sources.map((source, i) => {
        const payload = source.sourcePayload || {},
          text = String(payload.textSample || "");
        const match = resolveSourceTopic(source, context);
        const sourceUrl = safeWebUrl(match?.url);
        const documentUrl = safeWebUrl(match?.documentUrl);
        return (
          <div className="source-repair" key={i}>
            <h4>{source.title}</h4>
            <small>{source.path}</small>
            <div className="action-links">
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                  Open source material ↗
                </a>
              )}
              {documentUrl && documentUrl !== sourceUrl && (
                <a href={documentUrl} target="_blank" rel="noopener noreferrer">
                  Open captured file or external target ↗
                </a>
              )}
            </div>
            {!sourceUrl && (
              <p className="hint">
                No unique source link was captured for this item. Use its source
                title and path in the source course.
              </p>
            )}
            {text && (
              <>
                <details>
                  <summary>Source text to compare or copy</summary>
                  <blockquote>{text}</blockquote>
                  <p className="hint">
                    {payload.evidenceTruncated
                      ? "Partial source text: this excerpt was truncated."
                      : "Captured source text. Inspect formatting, links and any embedded content before replacing a whole item."}
                  </p>
                </details>
                <div className="action-links">
                  <button className="secondary" onClick={() => void copy(text)}>
                    Copy source text
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      download("CTI_source_text.txt", text, "text/plain")
                    }
                  >
                    Download source text
                  </button>
                </div>
              </>
            )}
            {!!payload.structuredAssessment?.questions?.length && (
              <details>
                <summary>
                  Source questions and answer evidence (
                  {payload.structuredAssessment.questions.length})
                </summary>
                {payload.structuredAssessment.questions.map(
                  (q: EvidenceObject, n: number) => (
                    <div className="source-question" key={n}>
                      <strong>Source question {n + 1}</strong>
                      <p>
                        {String(q.prompt || q.text || "Prompt not captured")}
                      </p>
                      {!!q.options?.length && (
                        <ul>
                          {q.options.map(
                            (o: EvidenceObject | string, k: number) => (
                              <li key={k}>
                                <strong>{choiceLabel(k)}: </strong>
                                {typeof o === "string"
                                  ? o
                                  : String(
                                      o.text ||
                                        o.label ||
                                        "Option text unavailable",
                                    )}
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                      <p>
                        <strong>Recorded answer evidence:</strong>{" "}
                        {q.correctAnswers?.length
                          ? q.correctAnswers.map(String).join("; ")
                          : "Not captured or not applicable — do not infer an answer."}
                      </p>
                      <CtiAnswerPanel question={contentQuestion(q, n)} />
                      <button
                        className="secondary"
                        onClick={() =>
                          void copy(contentQuestionText(contentQuestion(q, n)))
                        }
                      >
                        Copy question {n + 1} and answers
                      </button>
                    </div>
                  ),
                )}
              </details>
            )}
            {!!payload.files?.length && (
              <details>
                <summary>
                  Source file locations ({payload.files.length})
                </summary>
                <ul className="file-evidence">
                  {payload.files.map((f: EvidenceObject, n: number) => (
                    <li key={n}>
                      <strong>
                        {f.name || f.path || f.href || "Source file"}
                      </strong>
                      <small>{f.path || f.href}</small>
                      {f.presentInPackage === true ? (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void restoreFile(f)}
                        >
                          Get source file
                        </button>
                      ) : (
                        <small>
                          File presence in the package is not confirmed.
                        </small>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <EvidenceDetails title="Complete source entry" value={source} />
          </div>
        );
      })}
      {!!sourceFiles.length && (
        <details>
          <summary>Retrieve files from the original IMSCC</summary>
          <p className="hint">
            Choose the package once for this card. CTI checks that it matches
            the saved source scan and downloads only the exact file you select.
            It is not rescanned or uploaded.
          </p>
          <label>
            Original IMSCC for source files
            <input
              type="file"
              accept=".imscc,.zip"
              disabled={busy}
              onChange={(e) => setArchive(e.target.files?.[0] || null)}
            />
          </label>
        </details>
      )}
      {busy && (
        <p role="status">
          Checking the source package and retrieving the file…
        </p>
      )}
      {message && (
        <p role="status" className="hint">
          {message}
        </p>
      )}
    </>
  );
}
