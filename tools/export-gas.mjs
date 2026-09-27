import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "src/legacy/manifest.json"), "utf8"),
);
const code = manifest.parts
  .map((p) => fs.readFileSync(path.join(root, p.file), "utf8"))
  .join("");
fs.writeFileSync(path.join(root, "Code.gs"), code);
console.log(
  "Exported Code.gs from the ordered legacy modules. Review the diff and run npm test.",
);
