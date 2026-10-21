/** Resolve references against a supplied inventory; never fetch or mutate originals. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
export function assessmentMediaResolution(reference, assets = [], inventoryComplete = false) {
  const path = (value) => {
    let s = String(value || '').split(/[?#]/)[0];
    try { s = decodeURIComponent(s); } catch { /* Preserve undecodable references. */ }
    return s.replace(/\\/g, '/').replace(/^\.\//, '');
  };
  const expected = path(reference.expectedPath || reference.ref);
  const hash = /^[a-f0-9]{64}$/i.test(reference.sha256 || '') ? reference.sha256.toLowerCase() : null;
  const exact = assets.filter(a => path(a.path) === expected);
  const verified = assets.filter(a => a.integrity === 'VERIFIED_RETAINED_ORIGINAL' && /^[a-f0-9]{64}$/i.test(a.sha256 || '') && a.originalBytes instanceof Uint8Array && bytesToHex(sha256(a.originalBytes)) === a.sha256.toLowerCase());
  const identical = hash ? verified.filter(a => a.sha256.toLowerCase() === hash) : [];
  const names = assets.filter(a => path(a.path).split('/').pop() === expected.split('/').pop());
  const matches = exact.length ? exact : identical;
  const conflicting = hash && exact.some(a => verified.includes(a) && a.sha256.toLowerCase() !== hash);
  const proven = !conflicting && matches.length > 0 && matches.every(a => verified.includes(a)) && new Set(matches.map(a => a.sha256.toLowerCase())).size === 1;
  return {
    originalRef: reference.ref, expectedPath: reference.expectedPath || reference.ref,
    status: conflicting ? 'CONTENT_IDENTITY_CONFLICT' : proven ? (exact.length ? 'EXACT_PATH_ORIGINAL' : 'CONTENT_HASH_RELOCATION') : matches.length ? 'ORIGINAL_INTEGRITY_UNVERIFIED' : names.length ? 'FILENAME_CANDIDATES_ONLY' : inventoryComplete ? 'NOT_IN_SUPPLIED_PACKAGE' : 'ASSET_INVENTORY_UNVERIFIED',
    resolved: proven ? matches.map(a => ({path:a.path,sha256:a.sha256,originalRef:a.originalRef})) : [],
    candidates: (matches.length ? matches : names).map(a => ({path:a.path,sha256:a.sha256 || null})),
    learnerRenderingVerified: false,
  };
}

/** HTML reference discovery only. Exact original HTML remains in sourceTypeEvidence. */
export function questionHtmlMediaReferences(value) {
  const html = typeof value === 'string' ? value : value?.Html ?? value?.html ?? value?.Text ?? value?.text ?? '';
  const refs = [];
  for (const tag of String(html).matchAll(/<(?:img|audio|video|source|iframe|embed)\b[^>]*>/gi)) {
    const attr = tag[0].match(/\s(?:src|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (attr) {
      const ref = (attr[1] ?? attr[2] ?? attr[3] ?? '').replace(/&amp;/g, '&');
      if (ref && !refs.includes(ref)) refs.push(ref);
    }
  }
  return refs;
}
