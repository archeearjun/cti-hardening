import type { WorkspaceRecord } from "../src/domain/workspace-types.ts";

export interface UploadManifestBinding {
  actor: string;
  record: WorkspaceRecord;
  bytes: number;
  parts: number;
  sha256: string;
  allowSemanticDuplicate: boolean | null;
}

/** Metadata is bound byte-for-byte after JSON transport. Reordered or changed
 * envelopes are distinct requests; no client-supplied idempotency key can join
 * records, actors, versions, commit options or payloads. */
export async function workspaceUploadId(
  binding: UploadManifestBinding,
): Promise<string> {
  const prefix =
    binding.allowSemanticDuplicate === null
      ? "resumeL_"
      : binding.allowSemanticDuplicate
        ? "resume1_"
        : "resume0_";
  const bytes = new TextEncoder().encode(JSON.stringify(binding));
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  return prefix + digest;
}

export function workspaceUploadCommitOption(id: string): boolean | null {
  if (/^resume0_[a-f0-9]{64}$/.test(id)) return false;
  if (/^resume1_[a-f0-9]{64}$/.test(id)) return true;
  return null;
}

export function assertWorkspaceUploadBinding(
  upload: any,
  binding: UploadManifestBinding,
  id: string,
): void {
  if (
    !upload ||
    upload.id !== id ||
    upload.actor !== binding.actor ||
    upload.document_id !== binding.record.id ||
    upload.expected_version !== binding.record.version ||
    upload.bytes !== binding.bytes ||
    upload.parts !== binding.parts ||
    upload.sha256 !== binding.sha256 ||
    upload.metadata !== JSON.stringify(binding.record) ||
    ![0, 1].includes(upload.committed) ||
    workspaceUploadCommitOption(upload.id) !== binding.allowSemanticDuplicate
  )
    throw Object.assign(
      new Error(
        "The existing upload does not match this exact record, actor, version, options and payload.",
      ),
      { status: 409 },
    );
}
