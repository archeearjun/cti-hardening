import type { WorkspaceRecord } from "./workspace-types.ts";

export function normalizeFileName(
  fileName: unknown,
  removeDownloadSuffix = false,
): string {
  const name = String(fileName || "").trim().replace(/\s+/g, " ");
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : "";
  let stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  if (removeDownloadSuffix) {
    let previous = "";
    while (previous !== stem) {
      previous = stem;
      stem = stem.replace(/\s*\(\d+\)\s*$/, "").trim();
    }
  }
  return (stem + extension).toLowerCase();
}

export function canonicalDisplayFileName(fileName: unknown): string {
  const name = String(fileName || "").trim().replace(/\s+/g, " ");
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  let stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  let previous = "";
  while (previous !== stem) {
    previous = stem;
    stem = stem.replace(/\s*\(\d+\)\s*$/, "").trim();
  }
  return stem + extension;
}

export function packageMatchKey(fileName: unknown): string {
  let name = String(fileName || "").trim().toLowerCase();
  name = name.replace(/\.(imscc|zip|xml|xlsx)$/, "").trim();
  let previous = "";
  while (previous !== name) {
    previous = name;
    name = name.replace(/\s*\(\d+\)\s*$/, "").trim();
  }
  name = name
    .replace(/\s*-?\s*(dev|development)\s*\(nce\)?\s*(-?\s*clxt)?/g, "")
    .trim();
  name = name.replace(/b0rl/g, "borl");
  return name.replace(/[\s-]/g, "");
}

export function packageSemanticKey(fileName: unknown): string {
  const key = packageMatchKey(fileName);
  return key && key.length >= 3 ? key : normalizeFileName(fileName, true);
}

export function partnerKey(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function packageIdentityKey(partner: unknown, fileName: unknown): string {
  return partnerKey(partner) + "|" + packageSemanticKey(fileName);
}

export function packageRecordIdentity(record: WorkspaceRecord): string {
  if (record.kind !== "package") return "";
  return packageIdentityKey(
    record.data.partner,
    record.data.scan?.fileName || record.title,
  );
}

export function findSemanticPackageDuplicates(
  records: WorkspaceRecord[],
  partner: string,
  fileName: string,
  excludeId = "",
): WorkspaceRecord[] {
  const key = packageIdentityKey(partner, fileName);
  if (!partnerKey(partner) || !packageSemanticKey(fileName)) return [];
  return records.filter(
    (record) =>
      record.kind === "package" &&
      record.id !== excludeId &&
      packageRecordIdentity(record) === key,
  );
}
