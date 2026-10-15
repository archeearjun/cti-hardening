import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import {
  directProviderAccessDiagnosticStructureV1,
  directProviderAccessDiagnosticTextV1,
} from "../extractors/coursera/direct-data-provider-diagnostic.js";

export interface ProviderAccessDiagnostic {
  kind: "CTI_PROVIDER_ACCESS_DIAGNOSTIC";
  schemaVersion: 1;
  courseId: string;
  courseSlug: string;
  pageUrl: string;
  checkedAt: string;
  stopReason: string;
  items: Array<{
    itemId: string; atomId: string; providerId: string; targetUrl: string;
    sources: { atom: unknown; relation: unknown; provider: unknown;
      hashes: { atom: string; relation: string; provider: string };
      receipts: Record<string, unknown> };
    request: { reason: string; receipt: Record<string, unknown> | null };
  }>;
  nativeFailures: Array<{ itemId: string; atomId: string; reason: string }>;
  notForCourseAudit: true;
  contentCompletionVerified: false;
  sourceStabilityVerified: false;
  bodyVerified: false;
  playbackVerified: false;
  launchVerified: false;
  wholeWidgetVerified: false;
}

/** Recheck full retained native models as well as the exact native source joins.
 * Diagnostic receipts are observations, not authenticated server attestations. */
export function validateProviderAccessDiagnostic(value: unknown): ProviderAccessDiagnostic {
  const checked = directProviderAccessDiagnosticStructureV1(value);
  if (!checked.valid) throw Error(checked.reason);
  const result = value as ProviderAccessDiagnostic;
  for (const item of result.items)
    for (const key of ["atom", "relation", "provider"] as const) {
      const actual = bytesToHex(sha256(new TextEncoder().encode(directCanonicalSourceTextV1(item.sources[key]))));
      if (actual !== item.sources.hashes[key])
        throw Error("PROVIDER_ACCESS_DIAGNOSTIC_SOURCE_HASH_INVALID");
    }
  return result;
}

export function providerAccessDiagnosticText(value: unknown): string {
  return directProviderAccessDiagnosticTextV1(validateProviderAccessDiagnostic(value));
}
