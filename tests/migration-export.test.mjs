import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { importLegacyWorkspace } from "../src/domain/legacy-import.ts";

const source = fs.readFileSync(
  new URL("../src/legacy/server/042-migration-export.js", import.meta.url),
  "utf8",
);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function harness(sheets, allowed = true) {
  const files = [], logs = [];
  let reads = 0;
  const context = vm.createContext({
    authorize_(role) {
      assert.equal(role, "editor");
      if (!allowed) throw new Error("Not authorized");
    },
    getDatabaseSheet_() {
      reads++;
      return { getParent: () => ({ getSheets: () => Object.entries(sheets).map(([name, values]) => ({
        getName: () => name,
        getDataRange: () => ({ getValues: () => values }),
      })) }) };
    },
    PACKAGES_SHEET_NAME: "Packages",
    qaExternalRuntimeEvidenceForPackage_: () => ({ links: ["https://example.test/resource#section"] }),
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => ({ AUTHORIZED_DOMAIN: "example.test", API_KEY: "must-not-export" })[key] || "" }),
      getUserProperties: () => ({ getProperty: () => "[]" }),
    },
    MimeType: { PLAIN_TEXT: "text/plain" },
    Utilities: { newBlob: (text, mime, name) => ({ text, mime, name }) },
    DriveApp: {
      createFile(...args) {
        // Model the documented 10 MB limit on the three-argument overload.
        if (args.length === 3 && Buffer.byteLength(args[1]) > 10_000_000)
          throw new Error("File exceeds the maximum file size");
        const blob = args.length === 1 ? args[0] : { name: args[0], text: args[1], mime: args[2] };
        files.push(blob);
        return { getUrl: () => "https://drive.google.com/file/d/test/view" };
      },
    },
    Logger: { log: (value) => logs.push(value) },
  });
  vm.runInContext(source, context);
  return { context, files, logs, reads: () => reads };
}

test("migration export over 10 MB imports with source evidence and unknown sheets intact", () => {
  const tree = [{ name: "Unicode evidence — 你好 🧬", payload: { textSample: "x".repeat(8 * 1024 * 1024) } }];
  const encoded = Buffer.from(JSON.stringify(tree)).toString("base64");
  const chunks = [["id", "part", "value"]];
  for (let i = 0; i < encoded.length; i += 40000)
    chunks.push(["tree1", i / 40000, encoded.slice(i, i + 40000)]);
  const row = Array(20).fill("");
  row[1] = "Fixture";
  row[2] = "Large evidence";
  row[12] = "TREE:tree1";
  row[18] = "package1";
  const sheets = { Packages: [[], row], Package_Trees: chunks, Unknown: [["retain", "⚗️"]] };
  const before = hash(sheets);
  const h = harness(sheets);
  const result = h.context.exportCtiWorkspaceForMigration();
  assert.equal(result.success, true);
  assert.equal(result.packageCount, 1);
  assert.equal(h.files.length, 1);
  const file = h.files[0];
  assert.ok(Buffer.byteLength(file.text) > 10_000_000);
  assert.equal(file.mime, "application/json");
  assert.match(file.name, /^CTI_workspace_migration_\d+\.json$/);
  assert.equal(h.logs.at(-1), result.url);
  const value = JSON.parse(file.text);
  assert.equal(hash(value.sheets), before);
  assert.equal(hash(sheets), before);
  assert.equal(value.accessPolicy.API_KEY, undefined);
  const imported = importLegacyWorkspace(value);
  assert.equal(hash(imported.records[0].data.scan.courseTree), hash(tree));
  assert.equal(hash(imported.records.at(-1).data), hash(value));
  assert.deepEqual(imported.records[0].data.externalRuntimeEvidence.links, ["https://example.test/resource#section"]);
});

test("migration export checks authorization before reading or creating files", () => {
  const h = harness({}, false);
  assert.throws(() => h.context.exportCtiWorkspaceForMigration(), /Not authorized/);
  assert.equal(h.reads(), 0);
  assert.equal(h.files.length, 0);
});
