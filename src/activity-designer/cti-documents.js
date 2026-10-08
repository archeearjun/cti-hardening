(function (root) {
  "use strict";
  const LIMIT = 8 * 1024 * 1024;
  const hashPattern = /^[a-f0-9]{64}$/;
  function bytes(asset) {
    if (
      !asset ||
      !hashPattern.test(asset.sha256) ||
      asset.mime !== "application/pdf" ||
      !Number.isInteger(asset.size) ||
      asset.size < 5 ||
      asset.size > LIMIT ||
      typeof asset.base64 !== "string" ||
      asset.base64.length !== 4 * Math.ceil(asset.size / 3) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)
    )
      throw Error("Invalid captured PDF archive.");
    const data = Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0));
    if (
      data.length !== asset.size ||
      new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-"
    )
      throw Error("Captured PDF bytes do not match their descriptor.");
    return data;
  }
  function validate(assets = [], requirePaths = false) {
    if (!Array.isArray(assets) || assets.length > 256)
      throw Error("Too many captured PDF assets.");
    let total = 0;
    const seen = new Set();
    for (const a of assets) {
      if (seen.has(a.sha256)) throw Error("Duplicate captured PDF hash.");
      seen.add(a.sha256);
      total += a.size;
      if (total > LIMIT)
        throw Error("Captured PDFs exceed the 8 MiB saved-work limit.");
      bytes(a);
      if (requirePaths && !a.source_paths?.length)
        throw Error("Saved PDF is missing its exact source paths.");
      if (
        a.source_paths !== undefined &&
        (!Array.isArray(a.source_paths) ||
          a.source_paths.length > 5000 ||
          a.source_paths.some(
            (p) =>
              typeof p !== "string" ||
              !/^coursera\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(p),
          ))
      )
        throw Error("Captured PDF has an invalid source identity.");
    }
    return assets;
  }
  async function verify(assets = []) {
    validate(assets);
    for (const a of assets) {
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(a))),
      ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== a.sha256)
        throw Error(
          "Captured PDF checksum failed; re-import the original capture.",
        );
    }
    return assets;
  }
  function merge(assets) {
    const map = new Map();
    for (const a of assets) {
      const old = map.get(a.sha256);
      map.set(a.sha256, {
        ...a,
        source_paths: [
          ...new Set([...(old?.source_paths || []), ...(a.source_paths || [])]),
        ],
      });
    }
    return validate([...map.values()], true);
  }
  function files(assets = [], paths = null) {
    validate(assets, true);
    return Object.fromEntries(
      assets
        .filter((a) => !paths || a.source_paths.some((p) => paths.has(p)))
        .map((a) => ["Teaching_PDFs/" + a.sha256 + ".pdf", bytes(a)]),
    );
  }
  async function hydrate(raw, capture, options = {}) {
    const originals = await verify(raw.documentAssets || []),
      retained = new Map(),
      parsed = new Map();
    const byHash = new Map(originals.map((a) => [a.sha256, a]));
    const byItem = new Map(raw.fingerprints.map((f) => [f.id, f]));
    for (const item of capture.items) {
      if (options.signal?.aborted)
        throw new DOMException("Processing cancelled", "AbortError");
      const fp = byItem.get(item.id);
      const refs = new Set();
      for (const detail of fp?.payload?.assetDetails || []) {
        if (!detail.documentRef || refs.has(detail.documentRef)) continue;
        refs.add(detail.documentRef);
        const asset = byHash.get(detail.documentRef);
        if (!asset || asset.sha256 !== detail.sha256) {
          item.notes.push(
            "PDF reference has no matching verified bytes; complete document is not captured.",
          );
          continue;
        }
        if (
          /quiz|exam|assessment|assignment|project|discussion/i.test(
            item.type,
          ) ||
          /answer[ _-]*key|solutions?|rubric|instructor/i.test(
            String(detail.name || "") + " " + item.title,
          )
        ) {
          item.notes.push(
            "Assessment/instructor PDF retained only in the original CTI capture; not copied into the teaching attachment packet.",
          );
          continue;
        }
        const path = `coursera/${capture.course.id}/${item.id}`;
        const old = retained.get(asset.sha256);
        retained.set(asset.sha256, {
          ...asset,
          source_paths: [...new Set([...(old?.source_paths || []), path])],
        });
        if (!options.pdf) {
          item.notes.push(
            "Original PDF is attached for review; its text layer was not parsed.",
          );
          continue;
        }
        options.progress?.({
          file: item.title,
          path: "Reading complete captured PDF",
          done: 0,
          total: 1,
        });
        try {
          if (parsed.get(asset.sha256)?.failed)
            throw Error("PDF parsing previously failed.");
          if (!parsed.has(asset.sha256))
            parsed.set(asset.sha256, await options.pdf(bytes(asset)));
          const doc = parsed.get(asset.sha256);
          if (root.CourseShell.textQuality(doc?.text).readable)
            item.blocks.push({
              field: "Captured PDF " + asset.sha256 + " (text layer)",
              text: doc.text,
              kind: "teaching",
            });
          item.notes.push(
            "Original PDF: Teaching_PDFs/" +
              asset.sha256 +
              ".pdf. " +
              (doc.note ||
                "Text layer only; review original diagrams and formulas."),
          );
          item.coverage = item.blocks.some((b) => b.kind !== "gap")
            ? "partial"
            : "unread";
        } catch (e) {
          if (e.name === "AbortError") throw e;
          parsed.set(asset.sha256, { failed: true });
          item.notes.push(
            "Captured PDF could not be parsed. Review the attached original; its text has not been verified.",
          );
        }
      }
    }
    root.CourseShell.validate(capture);
    return [...retained.values()];
  }
  root.CourseCtiDocuments = { bytes, validate, verify, merge, files, hydrate };
})(globalThis);
