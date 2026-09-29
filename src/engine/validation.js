export function validateUuid_(value) {
  var uuid = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new Error("Invalid package UUID.");
  }
  return uuid;
}

export function nonNegativeInteger_(value) {
  var number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

export function sheetSafeText_(value) {
  var text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
