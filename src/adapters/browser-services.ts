import { sha256 } from "@noble/hashes/sha2.js";

type Bytes = string | number[] | Uint8Array;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function bytes(value: Bytes): Uint8Array {
  return typeof value === "string"
    ? encoder.encode(value)
    : Uint8Array.from(value);
}
function unsupported(name: string): object {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(
          `${name} requires the existing Google application. This preview does not provide shared storage or Google permissions.`,
        );
      },
    },
  );
}
// This adapter provides pure byte operations only. It never impersonates a
// Google user or substitutes browser storage for the shared course database.
export function createBrowserServices() {
  const Utilities = {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    getUuid: () => crypto.randomUUID(),
    base64Decode: (value: string) =>
      Array.from(atob(value), (c) => c.charCodeAt(0)),
    base64Encode: (value: Bytes) => {
      const b = bytes(value);
      let binary = "";
      for (let i = 0; i < b.length; i += 8192)
        binary += String.fromCharCode(...b.subarray(i, i + 8192));
      return btoa(binary);
    },
    newBlob: (value: Bytes) => ({
      getBytes: () => Array.from(bytes(value), (n) => (n > 127 ? n - 256 : n)),
      getDataAsString: () => decoder.decode(bytes(value)),
    }),
    computeDigest: (algorithm: string, value: Bytes) => {
      if (algorithm !== "SHA_256")
        throw new Error(`Unsupported digest: ${algorithm}`);
      return Array.from(sha256(bytes(value)), (n) => (n > 127 ? n - 256 : n));
    },
  };
  return {
    Utilities,
    Logger: { log: () => undefined },
    DriveApp: unsupported("Drive"),
    SpreadsheetApp: unsupported("Sheets"),
    PropertiesService: unsupported("Properties"),
    CacheService: unsupported("Cache"),
    LockService: unsupported("Shared locks"),
    UrlFetchApp: unsupported("Remote fetching"),
    HtmlService: unsupported("Google HTML"),
    XmlService: unsupported("Google XML parsing"),
    Session: unsupported("Google sign-in"),
    ScriptApp: unsupported("Google Apps Script"),
    Drive: unsupported("Drive API"),
  };
}
