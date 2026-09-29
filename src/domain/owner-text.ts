export const cleanOwnerText = (v: unknown) =>
  String(v || "")
    .replace(/\s+/g, " ")
    .trim();
