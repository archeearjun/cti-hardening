import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const MIGRATION_PART_CHARS = 1_000_000;
const encoder = new TextEncoder();
export function* migrationTextParts(text: string): Generator<string> {
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + MIGRATION_PART_CHARS, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield text.slice(start, end);
    start = end;
  }
}
export function migrationTextInfo(text: string): {
  sha256: string;
  utf8Bytes: number;
} {
  const digest = sha256.create();
  let utf8Bytes = 0;
  for (const fragment of migrationTextParts(text)) {
    const bytes = encoder.encode(fragment);
    utf8Bytes += bytes.length;
    digest.update(bytes);
  }
  return { sha256: bytesToHex(digest.digest()), utf8Bytes };
}
interface MigrationFile {
  name: string;
  text(): Promise<string>;
}

/** Fully verify a single export set before returning any importable records. */
export async function readMigrationFiles(
  files: MigrationFile[],
  progress: (message: string) => void = () => {},
  signal?: AbortSignal,
): Promise<any> {
  const check = () => {
    if (signal?.aborted)
      throw new Error("Migration check stopped. No records were saved.");
  };
  const read = async (file: MigrationFile) => {
    check();
    let value;
    try {
      value = JSON.parse(await file.text());
    } catch {
      throw new Error(
        `Cannot read ${file.name} as JSON. Download that file again.`,
      );
    }
    check();
    return value;
  };
  if (!files.length)
    throw new Error(
      "Select a migration JSON or the manifest and all its part files.",
    );
  if (files.length === 1) {
    const value = await read(files[0]);
    if (
      ["CTI_WORKSPACE_MIGRATION", "CTI_BROWSER_WORKSPACE"].includes(value?.kind)
    )
      return value;
    if (value?.kind !== "CTI_WORKSPACE_MIGRATION_MANIFEST")
      throw new Error(
        "Select 00_manifest.json and ALL part files from the same export folder together.",
      );
  }
  const byName = new Map(files.map((f) => [f.name, f]));
  if (byName.size !== files.length)
    throw new Error(
      "Duplicate file names. Select files from only one export folder.",
    );
  const manifestFile = byName.get("00_manifest.json");
  if (!manifestFile)
    throw new Error(
      "Select 00_manifest.json and ALL part files from the same export folder together.",
    );
  const manifest = await read(manifestFile);
  if (
    manifest?.kind !== "CTI_WORKSPACE_MIGRATION_MANIFEST" ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.exportId !== "string" ||
    !manifest.exportId ||
    !Number.isSafeInteger(manifest.partCount) ||
    manifest.partCount < 1 ||
    !Array.isArray(manifest.parts) ||
    manifest.parts.length !== manifest.partCount ||
    !Number.isSafeInteger(manifest.charCount) ||
    manifest.charCount < 1 ||
    !Number.isSafeInteger(manifest.utf8Bytes) ||
    manifest.utf8Bytes < 1
  )
    throw new Error("Invalid migration manifest. Download a completed export.");
  const expected = new Set<string>(["00_manifest.json"]);
  for (const [index, part] of manifest.parts.entries()) {
    if (
      !part ||
      part.index !== index ||
      typeof part.fileName !== "string" ||
      !/^part_[0-9]+_[A-Za-z0-9-]+\.json$/.test(part.fileName) ||
      expected.has(part.fileName) ||
      !/^[a-f0-9]{64}$/.test(part.sha256) ||
      !Number.isSafeInteger(part.charCount) ||
      part.charCount < 1 ||
      part.charCount > MIGRATION_PART_CHARS ||
      !Number.isSafeInteger(part.utf8Bytes) ||
      part.utf8Bytes < 1
    )
      throw new Error("Invalid part list in migration manifest.");
    expected.add(part.fileName);
    if (!byName.has(part.fileName))
      throw new Error(
        `Missing ${part.fileName}. Select the manifest and ALL ${manifest.partCount} parts together.`,
      );
  }
  if (files.some((f) => !expected.has(f.name)))
    throw new Error(
      "Extra or mixed export files selected. Use only one complete export folder.",
    );
  const fragments: string[] = [];
  let chars = 0,
    bytes = 0;
  for (const part of manifest.parts) {
    progress(`Verifying part ${part.index + 1} of ${manifest.partCount}`);
    const value = await read(byName.get(part.fileName)!);
    if (
      value?.kind !== "CTI_WORKSPACE_MIGRATION_PART" ||
      value.schemaVersion !== 1 ||
      value.exportId !== manifest.exportId ||
      value.index !== part.index ||
      typeof value.data !== "string" ||
      value.data.length !== part.charCount
    )
      throw new Error(`Wrong or incomplete migration part: ${part.fileName}.`);
    const info = migrationTextInfo(value.data);
    if (info.sha256 !== part.sha256 || info.utf8Bytes !== part.utf8Bytes)
      throw new Error(
        `Checksum mismatch: ${part.fileName}. Download that file again.`,
      );
    fragments.push(value.data);
    chars += value.data.length;
    bytes += info.utf8Bytes;
  }
  check();
  if (chars !== manifest.charCount || bytes !== manifest.utf8Bytes)
    throw new Error("Migration totals do not match the manifest.");
  progress("All parts verified. Preparing records");
  const value = JSON.parse(fragments.join(""));
  if (value?.kind !== "CTI_WORKSPACE_MIGRATION" || value.schemaVersion !== 1)
    throw new Error(
      "The verified files do not contain a supported CTI migration.",
    );
  return value;
}
