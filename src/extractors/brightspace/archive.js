/** Store the retained originals beside one compressed manifest without joining
 * the whole course into a JavaScript byte array. ZIP headers and CRCs are
 * standard ZIP_STORE; the format deliberately excludes encryption and ZIP64.
 */
export async function createBrightspaceArchiveV120(entries, options = {}) {
  const maximums = {
    artifactBytes: 640 * 1024 * 1024,
    metadataBytes: 128 * 1024 * 1024,
    totalBodyBytes: 512 * 1024 * 1024,
    bodyBytes: 64 * 1024 * 1024,
    entries: 20000,
    streamChunkBytes: 1024 * 1024,
  };
  const limits = {};
  for (const [name, maximum] of Object.entries(maximums)) {
    const requested = options?.[name];
    limits[name] = Number.isSafeInteger(requested) && requested >= 0
      ? Math.min(requested, maximum)
      : maximum;
  }
  if (typeof Blob !== "function") throw Error("BRIGHTSPACE_ARCHIVE_BLOB_UNAVAILABLE");
  if (limits.streamChunkBytes < 1) throw Error("BRIGHTSPACE_ARCHIVE_STREAM_CHUNK_LIMIT");
  if (!Array.isArray(entries) || !entries.length || entries.length > limits.entries)
    throw Error("BRIGHTSPACE_ARCHIVE_ENTRY_LIMIT");

  const encoder = new TextEncoder(), seen = new Set(), jobs = [];
  let manifestCount = 0, totalBodies = 0, estimatedSize = 22;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw Error("BRIGHTSPACE_ARCHIVE_ENTRY_INVALID");
    const pathProperty = Object.getOwnPropertyDescriptor(entry, "path"),
      blobProperty = Object.getOwnPropertyDescriptor(entry, "blob");
    if (!pathProperty || !("value" in pathProperty) ||
        !blobProperty || !("value" in blobProperty))
      throw Error("BRIGHTSPACE_ARCHIVE_ENTRY_INVALID");
    const path = pathProperty.value, blob = blobProperty.value;
    if (typeof path !== "string" ||
        !(path === "capture.json.gz" || /^files\/[a-f0-9]{64}$/.test(path)))
      throw Error("BRIGHTSPACE_ARCHIVE_PATH_INVALID");
    if (seen.has(path)) throw Error("BRIGHTSPACE_ARCHIVE_DUPLICATE_PATH");
    seen.add(path);
    if (!(blob instanceof Blob))
      throw Error("BRIGHTSPACE_ARCHIVE_ENTRY_INVALID");
    const size = blob.size, name = encoder.encode(path);
    if (!Number.isSafeInteger(size) || size < 0 || typeof blob.stream !== "function")
      throw Error("BRIGHTSPACE_ARCHIVE_ENTRY_INVALID");
    if (path === "capture.json.gz") {
      manifestCount++;
      if (!size || size > limits.metadataBytes) throw Error("BRIGHTSPACE_ARCHIVE_METADATA_BYTE_LIMIT");
    } else {
      if (size > limits.bodyBytes) throw Error("BRIGHTSPACE_ARCHIVE_BODY_BYTE_LIMIT");
      totalBodies += size;
      if (totalBodies > limits.totalBodyBytes) throw Error("BRIGHTSPACE_ARCHIVE_TOTAL_BODY_BYTE_LIMIT");
    }
    estimatedSize += 30 + 46 + 2 * name.byteLength + size;
    if (estimatedSize > limits.artifactBytes || estimatedSize > 0xffffffff)
      throw Error("BRIGHTSPACE_ARCHIVE_ARTIFACT_BYTE_LIMIT");
    jobs.push({ path, blob, size, name });
  }
  if (manifestCount !== 1) throw Error("BRIGHTSPACE_ARCHIVE_MANIFEST_MISSING");

  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  async function crcFor(job) {
    let reader = null, count = 0, crc = 0xffffffff, emptyChunks = 0;
    try {
      // Blob.stream() chunk size differs across Chromium backing stores. Slice
      // first so even a stream returning its entire Blob remains bounded.
      for (let start = 0; start < job.size; start += limits.streamChunkBytes) {
        const expected = Math.min(limits.streamChunkBytes, job.size - start),
          part = job.blob.slice(start, start + expected);
        if (!(part instanceof Blob) || part.size !== expected)
          throw Error("BRIGHTSPACE_ARCHIVE_SOURCE_SIZE_MISMATCH");
        const stream = part.stream();
        if (!stream || typeof stream.getReader !== "function")
          throw Error("BRIGHTSPACE_ARCHIVE_SOURCE_READ_FAILED");
        reader = stream.getReader();
        let partBytes = 0;
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          const bytes = next.value;
          if (!(bytes instanceof Uint8Array)) throw Error("BRIGHTSPACE_ARCHIVE_SOURCE_CHUNK_INVALID");
          if (bytes.byteLength > limits.streamChunkBytes) throw Error("BRIGHTSPACE_ARCHIVE_STREAM_CHUNK_LIMIT");
          if (!bytes.byteLength && ++emptyChunks > 8) throw Error("BRIGHTSPACE_ARCHIVE_SOURCE_CHUNK_INVALID");
          if (bytes.byteLength) emptyChunks = 0;
          count += bytes.byteLength;partBytes += bytes.byteLength;
          if (partBytes > expected || count > job.size) throw Error("BRIGHTSPACE_ARCHIVE_SOURCE_SIZE_MISMATCH");
          for (let index = 0; index < bytes.byteLength; index++)
            crc = (crc >>> 8) ^ table[(crc ^ bytes[index]) & 0xff];
        }
        if (partBytes !== expected) throw Error("BRIGHTSPACE_ARCHIVE_SOURCE_SIZE_MISMATCH");
        reader.releaseLock();reader = null;
        // Only the current range is read. Originals, rather than copies of all
        // their chunks, are appended to the completed ZIP Blob below.
      }
      if (count !== job.size) throw Error("BRIGHTSPACE_ARCHIVE_SOURCE_SIZE_MISMATCH");
      return (crc ^ 0xffffffff) >>> 0;
    } catch (error) {
      try { await reader?.cancel(); } catch (_) {}
      const code = String(error?.message || "");
      if (/^BRIGHTSPACE_ARCHIVE_(?:SOURCE_READ_FAILED|SOURCE_CHUNK_INVALID|STREAM_CHUNK_LIMIT|SOURCE_SIZE_MISMATCH)$/.test(code))
        throw Error(code);
      throw Error("BRIGHTSPACE_ARCHIVE_SOURCE_READ_FAILED");
    } finally {
      try { reader?.releaseLock(); } catch (_) {}
    }
  }
  function localHeader(job, crc) {
    const bytes = new Uint8Array(30 + job.name.byteLength), view = new DataView(bytes.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0x0021, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, job.size, true);
    view.setUint32(22, job.size, true);
    view.setUint16(26, job.name.byteLength, true);
    bytes.set(job.name, 30);
    return bytes;
  }
  function centralHeader(job, crc, offset) {
    const bytes = new Uint8Array(46 + job.name.byteLength), view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0x0021, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, job.size, true);
    view.setUint32(24, job.size, true);
    view.setUint16(28, job.name.byteLength, true);
    view.setUint32(42, offset, true);
    bytes.set(job.name, 46);
    return bytes;
  }

  const parts = [], central = [];
  let offset = 0, centralSize = 0;
  for (const job of jobs) {
    const crc = await crcFor(job), local = localHeader(job, crc), directory = centralHeader(job, crc, offset);
    parts.push(local, job.blob);
    central.push(directory);
    offset += local.byteLength + job.size;
    centralSize += directory.byteLength;
  }
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, jobs.length, true);
  endView.setUint16(10, jobs.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const archive = new Blob([...parts, ...central, end], { type: "application/zip" });
  if (archive.size !== estimatedSize || archive.size > limits.artifactBytes)
    throw Error("BRIGHTSPACE_ARCHIVE_ARTIFACT_BYTE_LIMIT");
  return archive;
}
