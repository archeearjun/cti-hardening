// Maintained source: explicit dependencies; no ordered concatenation.


export function normalizePartnerName_(partnerName) { return String(partnerName || "").trim().replace(/\s+/g, " ").toLowerCase(); }
