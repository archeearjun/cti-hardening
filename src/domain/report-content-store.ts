import {
  buildContentSnapshot,
  validateContentSnapshot,
  type ContentSnapshot,
} from "./content-evidence.ts";
import { digest, newRecord, type WorkspaceStore } from "./workspace-store.ts";
import type { EvidenceObject, WorkspaceRecord } from "./workspace-types.ts";

/** Original audits are immutable. Content recovered from the exact input bytes
 * is a separate, versioned, report-bound supplement, never a rewritten audit. */
export async function saveOriginalContent(
  bytes: Uint8Array,
  report: EvidenceObject,
  auditId: string,
  store: WorkspaceStore,
) {
  if (bytes.length > 40 * 1024 * 1024)
    throw Error("Extraction exceeds the 40 MiB content-import limit.");
  const hash = await digest(bytes),
    platform =
      hash === report.hashes?.json
        ? "coursera"
        : hash === report.hashes?.brightspace
          ? "brightspace"
          : null;
  if (!platform)
    throw Error(
      "This file does not match either original extraction hash. Use the original file or create a new comparison.",
    );
  const saved = await store.get(auditId);
  if (
    saved.kind !== "audit" ||
    saved.packageId !== report.packageId ||
    saved.data.hashes?.[platform === "coursera" ? "json" : "brightspace"] !==
      hash
  )
    throw Error("The saved report changed or does not match this extraction.");
  const contentEvidence = buildContentSnapshot(
    platform === "coursera" ? bytes : undefined,
    platform === "brightspace" ? bytes : undefined,
  );
  validateContentSnapshot(contentEvidence);
  const id =
    "report-content-" +
    (await digest(
      new TextEncoder().encode(JSON.stringify([auditId, platform])),
    ));
  const summary = (await store.list()).find((r) => r.id === id);
  const previous = summary
    ? await store.get(id)
    : newRecord(
        "operations",
        `Original ${platform} content`,
        {},
        saved.packageId,
      );
  if (
    summary &&
    (previous.kind !== "operations" ||
      previous.packageId !== saved.packageId ||
      previous.data.type !== "report-content" ||
      previous.data.runId !== auditId ||
      previous.data.platform !== platform)
  )
    throw Error("Existing content supplement does not match this report.");
  await store.save({
    ...previous,
    id,
    data: {
      type: "report-content",
      runId: auditId,
      platform,
      sourceHash: hash,
      contentEvidence,
    },
  });
  return platform;
}
export async function loadReportContent(
  report: EvidenceObject,
  auditId: string,
  packageId: string,
  store: Pick<WorkspaceStore, "list" | "get">,
  records?: WorkspaceRecord[],
): Promise<ContentSnapshot> {
  const base = report.contentEvidence || {
    schemaVersion: 1,
    coursera: [],
    brightspace: [],
  };
  validateContentSnapshot(base);
  const output = { ...base },
    seen = new Set<string>();
  const summaries = (records || (await store.list())).filter(
    (r) =>
      r.kind === "operations" &&
      r.packageId === packageId &&
      r.data.type === "report-content" &&
      r.data.runId === auditId,
  );
  if (summaries.length > 2)
    throw Error(
      "Duplicate report content supplements. Resolve their source identity before using them.",
    );
  for (const summary of summaries) {
    const r = await store.get(summary.id),
      p = r.data.platform;
    if (
      r.id !== summary.id ||
      r.version !== summary.version ||
      r.kind !== "operations" ||
      r.packageId !== packageId ||
      r.data.type !== "report-content" ||
      r.data.runId !== auditId ||
      !["coursera", "brightspace"].includes(p) ||
      seen.has(p) ||
      !/^[a-f0-9]{64}$/.test(String(r.data.sourceHash || "")) ||
      r.data.sourceHash !==
        report.hashes?.[p === "coursera" ? "json" : "brightspace"]
    )
      throw Error(
        "Saved content changed or does not match this report's original extraction. Retry after refreshing.",
      );
    validateContentSnapshot(r.data.contentEvidence);
    seen.add(p);
    if (p === "coursera") output.coursera = r.data.contentEvidence.coursera;
    else output.brightspace = r.data.contentEvidence.brightspace;
  }
  return output;
}
