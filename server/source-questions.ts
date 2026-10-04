import {
  publicSourceUrl,
  samePublicBook,
  readH5PQuestionSets,
  h5pFrames,
  type SourceQuestionCapture,
  type SourceQuestionBank,
} from "../src/domain/external-source-questions.ts";

/** Public source definitions only: closed provider scope, no cookies or inbound
 * credentials, manual scoped redirects, bounded GETs/body/time. No JS execution. */
export async function fetchSourceQuestions(
  sourceKey: string,
  targetUrl: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SourceQuestionCapture> {
  const initial = publicSourceUrl(targetUrl);
  if (!initial || !sourceKey || sourceKey.length > 4000)
    throw Object.assign(
      Error(
        "This source URL is not supported for automatic public question capture.",
      ),
      { status: 400 },
    );
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const documents: SourceQuestionCapture["documents"] = [],
    banks: SourceQuestionBank[] = [],
    visited = new Set<string>();
  const queue = [initial];
  let unresolved = false,
    requests = 0,
    totalBytes = 0;
  try {
    while (queue.length && requests < 6) {
      let url = queue.shift()!;
      while (!visited.has(url)) {
        visited.add(url);
        if (++requests > 6) {
          unresolved = true;
          break;
        }
        controller.signal.throwIfAborted();
        const response = await fetcher(url, {
          method: "GET",
          credentials: "omit",
          redirect: "manual",
          signal: controller.signal,
          headers: { Accept: "text/html, application/xhtml+xml" },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("Location");
          await response.body?.cancel();
          const next = location
            ? samePublicBook(new URL(location, url).href, initial)
            : "";
          if (!next || visited.has(next)) {
            unresolved = true;
            break;
          }
          url = next;
          continue;
        }
        if (
          !response.ok ||
          !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(
            response.headers.get("Content-Type") || "",
          )
        ) {
          await response.body?.cancel();
          throw Error(
            `Source returned HTTP ${response.status} or non-HTML content.`,
          );
        }
        const reader = response.body?.getReader();
        if (!reader) throw Error("Source returned no content.");
        const parts: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            controller.signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            totalBytes += value.byteLength;
            if (size > 3_000_000 || totalBytes > 6_000_000)
              throw Error("Source content exceeds the capture limit.");
            parts.push(value);
          }
        } catch (e) {
          await reader.cancel();
          throw e;
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        const hash = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
        documents.push({ url, sha256: hash, bytes: size });
        const html = new TextDecoder().decode(bytes),
          parsed = readH5PQuestionSets(html);
        banks.push(...parsed.banks);
        unresolved ||= parsed.unresolved;
        // Skip only a frame for the exact inline activity already captured.
        // A different embedded bank must be fetched; never assume it is a duplicate.
        const frames = h5pFrames(html, url, initial);
        unresolved ||= frames.unresolved;
        for (const frame of frames.urls) {
          const frameUrl = new URL(frame),
            id =
              frameUrl.searchParams.get("h5p-embed") ||
              frameUrl.searchParams.get("id");
          if (parsed.banks.some((bank) => bank.id === "cid-" + id)) continue;
          if (!visited.has(frame) && !queue.includes(frame)) queue.push(frame);
        }
        break;
      }
    }
    const unique = banks.filter(
      (b, i) =>
        banks.findIndex(
          (other) => JSON.stringify(other) === JSON.stringify(b),
        ) === i,
    );
    const complete = unique.length === 1 && !unresolved && !queue.length;
    return {
      kind: "CTI_PUBLIC_SOURCE_QUESTIONS",
      schemaVersion: 1,
      sourceKey,
      targetUrl,
      capturedAt: new Date().toISOString(),
      status: complete ? "CAPTURED" : "UNVERIFIED",
      reason: complete
        ? "Read complete H5P QuestionSet definition data from the recorded public source link. Learner launch, answer fidelity and interactions remain unverified."
        : "Could not establish one complete supported H5P question bank. The page may require login, runtime loading, a different provider, or selection among multiple activities.",
      bank: complete ? unique[0] : null,
      documents,
      sourceLinkBasis: "RECORDED_SOURCE_LINK",
      automatedResolution: false,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
