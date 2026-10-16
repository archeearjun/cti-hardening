import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const MAX_SOURCE_PACKAGE_BYTES = 640 * 1024 * 1024;
export const MAX_SOURCE_MANIFEST_BYTES = 12_000_000;
export const SOURCE_PACKAGE_HASH_CHUNK_BYTES = 2 * 1024 * 1024;

export function formatSourcePackageSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MiB (${bytes.toLocaleString()} bytes)`;
}

export function validateSourcePackageFile(
  file: Pick<File, "name" | "size">,
): void {
  if (/\.cti\.zip$/i.test(file.name))
    throw Error(
      "This is a Coursera capture archive. Add it through Evidence inbox or Review a capture; source package inspection expects an IMSCC, source ZIP or imsmanifest.xml.",
    );
  if (!/\.(imscc|zip|xml)$/i.test(file.name))
    throw Error("Choose an IMSCC package, source ZIP or imsmanifest.xml.");
  if (!Number.isSafeInteger(file.size) || file.size < 0)
    throw Error(
      "The selected file size could not be read. Choose the downloaded package again.",
    );
  if (file.size === 0)
    throw Error(
      `${file.name} is empty (0 bytes). Download the complete source package to this computer, then select it again.`,
    );
  if (file.size > MAX_SOURCE_PACKAGE_BYTES)
    throw Error(
      `${file.name} is ${formatSourcePackageSize(file.size)}. Source package inspection supports files up to 640 MiB.`,
    );
  if (/\.xml$/i.test(file.name) && file.size > MAX_SOURCE_MANIFEST_BYTES)
    throw Error(
      "The manifest exceeds the 12 MB limit. Select its original IMSCC or source ZIP instead.",
    );
}

/** Fingerprint the exact selected archive without allocating an archive-sized buffer. */
export async function hashSourcePackageFile(
  file: Blob,
  progress: (completed: number, total: number) => void = () => {},
): Promise<string> {
  const hash = sha256.create();
  progress(0, file.size);
  for (
    let start = 0;
    start < file.size;
    start += SOURCE_PACKAGE_HASH_CHUNK_BYTES
  ) {
    const end = Math.min(file.size, start + SOURCE_PACKAGE_HASH_CHUNK_BYTES);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    } catch (error) {
      throw Error(
        "The selected package could not be read. Make sure it is fully downloaded on this computer, then select it again.",
        { cause: error },
      );
    }
    if (bytes.byteLength !== end - start)
      throw Error(
        "The selected package was not read completely. Download the complete file locally and try again.",
      );
    hash.update(bytes);
    if (end === file.size || end % (8 * 1024 * 1024) === 0)
      progress(end, file.size);
    if (end % (16 * 1024 * 1024) === 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return bytesToHex(hash.digest());
}
