import { buildSourceEvidenceFromZip_ } from './scan.js';
import { parseXmlCompat_ } from './xml.js';

/** A scanner instance owns its PDF adapter; evidence helpers are ordinary ESM. */
export function createSourceScanner(pdfServices) {
  return {
    buildSourceEvidenceFromZip_: (...args) => buildSourceEvidenceFromZip_(pdfServices, ...args),
    parseXmlCompat_,
  };
}
