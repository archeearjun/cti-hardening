import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "src/legacy/manifest.json"), "utf8"),
);
const code = manifest.parts
  .map((p) => fs.readFileSync(path.join(root, p.file), "utf8"))
  .join("");
const hash = crypto.createHash("sha256").update(code).digest("hex");
if (code !== fs.readFileSync(path.join(root, "Code.gs"), "utf8")) {
  throw new Error(
    "Legacy source and Code.gs differ. Review the intended change and regenerate the Apps Script artifact before building.",
  );
}
const exports = manifest.browserExports.join(",\n");
const generated = `// Generated from src/legacy/manifest.json. Edit the ordered source parts, not this file.\nexport function createLegacyEngine(services) {\nconst {Utilities, Logger, DriveApp, SpreadsheetApp, PropertiesService, CacheService, LockService, UrlFetchApp, HtmlService, XmlService, Session, ScriptApp, Drive}=services;\n${code}\nreturn {${exports}};\n}\n`;
fs.mkdirSync(path.join(root, "src/generated"), { recursive: true });
fs.writeFileSync(path.join(root, "src/generated/legacy-engine.js"), generated);
fs.writeFileSync(
  path.join(root, "src/generated/build.json"),
  JSON.stringify(
    {
      baseline: manifest.baseline,
      qaBuild: manifest.qaBuild,
      legacySha256: hash,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Generated compatibility engine from ${manifest.parts.length} source parts; Apps Script bytes unchanged.`,
);
