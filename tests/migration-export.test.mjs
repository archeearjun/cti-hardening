import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { importLegacyWorkspace } from "../src/domain/legacy-import.ts";
import { readMigrationFiles } from "../src/domain/migration-files.ts";
import { restoreMigrationBackup } from "../src/domain/migration-backup.ts";
import { validateImportRecordSizes } from "../src/domain/workspace-validation.ts";

const source = fs.readFileSync(
  new URL("../src/legacy/server/042-migration-export.js", import.meta.url),
  "utf8",
);
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function harness(sheets, { allowed = true, failAt = -1 } = {}) {
  const files = [],
    logs = [];
  let reads = 0,
    folders = 0;
  const context = vm.createContext({
    authorize_(role) {
      assert.equal(role, "editor");
      if (!allowed) throw new Error("Not authorized");
    },
    getDatabaseSheet_() {
      reads++;
      return {
        getParent: () => ({
          getSheets: () =>
            Object.entries(sheets).map(([name, values]) => ({
              getName: () => name,
              getDataRange: () => ({ getValues: () => values }),
            })),
        }),
      };
    },
    PACKAGES_SHEET_NAME: "Packages",
    qaExternalRuntimeEvidenceForPackage_: () => ({
      links: ["https://example.test/resource#section"],
    }),
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) =>
          ({ AUTHORIZED_DOMAIN: "example.test", API_KEY: "must-not-export" })[
            key
          ] || "",
      }),
      getUserProperties: () => ({ getProperty: () => '["workbook1"]' }),
    },
    SpreadsheetApp: {
      openById: () => ({
        getName: () => "Master",
        getSheets: () => [
          {
            getName: () => "export",
            getDataRange: () => ({
              getValues: () => [
                ["level", "name"],
                [1, "Chapter 1"],
              ],
              getDisplayValues: () => [
                ["level", "name"],
                ["1", "Chapter 1"],
              ],
            }),
          },
        ],
      }),
    },
    Utilities: {
      getUuid: () => "fixture-export",
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (algorithm, bytes) =>
        Array.from(
          createHash(algorithm).update(Buffer.from(bytes)).digest(),
          (b) => (b > 127 ? b - 256 : b),
        ),
      newBlob: (text, mime, name) => ({
        text,
        mime,
        name,
        getBytes: () => Buffer.from(text),
      }),
    },
    DriveApp: {
      createFolder() {
        folders++;
        return {
          getUrl: () => "https://drive.google.com/drive/folders/test",
          createFile(blob) {
            if (files.length === failAt)
              throw new Error("Simulated Drive failure");
            // Deliberately fail far below the user's whole-export size.
            assert.ok(
              Buffer.byteLength(blob.text) < 6_100_000,
              "Every file must be bounded",
            );
            files.push(blob);
          },
        };
      },
      createFile() {
        throw new Error("Whole export must never use DriveApp.createFile");
      },
    },
    Logger: { log: (value) => logs.push(value) },
  });
  vm.runInContext(source, context);
  return { context, files, logs, reads: () => reads, folders: () => folders };
}
const uploads = (h) =>
  h.files.map((f) => ({ name: f.name, text: async () => f.text }));

test("GAS export above 50 MB round-trips into bounded records with all original evidence", async () => {
  const tree = [
    {
      name: "Unicode evidence — 你好 🧬",
      payload: { textSample: "x".repeat(100_000) },
    },
  ];
  const encoded = Buffer.from(JSON.stringify(tree)).toString("base64");
  const chunks = [["id", "part", "value"]];
  for (let i = 0; i < encoded.length; i += 40000)
    chunks.push(["tree1", i / 40000, encoded.slice(i, i + 40000)]);
  const row = Array(20).fill("");
  row[1] = "Fixture";
  row[2] = "Large evidence";
  row[12] = "TREE:tree1";
  row[18] = "package1";
  // Unknown evidence tables must not be discarded to make the export fit.
  const sheets = {
    Packages: [[], row],
    Package_Trees: chunks,
    Unknown: Array.from({ length: 1400 }, () => [
      "retain",
      "⚗️🧬" + "x".repeat(40000),
    ]),
  };
  const before = hash(sheets),
    h = harness(sheets);
  const result = h.context.exportCtiWorkspaceForMigration();
  assert.equal(result.success, true);
  assert.equal(result.packageCount, 1);
  assert.equal(h.files.at(-1).name, "00_manifest.json");
  assert.equal(result.partCount, h.files.length - 1);
  const manifest = JSON.parse(h.files.at(-1).text);
  assert.ok(manifest.utf8Bytes > 50 * 1024 * 1024);
  assert.match(h.logs.at(-1), /COMPLETE/);
  const value = await readMigrationFiles(uploads(h).reverse());
  assert.equal(hash(value.sheets), before);
  assert.equal(hash(sheets), before);
  assert.equal(value.accessPolicy.API_KEY, undefined);
  const imported = importLegacyWorkspace(value);
  validateImportRecordSizes(imported.records);
  assert.equal(hash(imported.records[0].data.scan.courseTree), hash(tree));
  assert.deepEqual(imported.records[0].data.externalRuntimeEvidence.links, [
    "https://example.test/resource#section",
  ]);
  assert.equal(
    imported.records.find((r) => r.kind === "workbook").data.book.sheets.export
      .display[1][0],
    "1",
  );
  const backupIndex = imported.records.at(-1);
  assert.equal(backupIndex.data.kind, "CTI_MIGRATION_BACKUP_INDEX");
  assert.equal(
    hash(restoreMigrationBackup(backupIndex, imported.records)),
    hash(value),
  );
  assert.throws(
    () =>
      restoreMigrationBackup(
        backupIndex,
        imported.records.filter((r) => r.id !== backupIndex.data.parts[0].id),
      ),
    /Missing/,
  );
  assert.deepEqual(
    importLegacyWorkspace(value).records.map((r) => r.id),
    imported.records.map((r) => r.id),
  );
});

test("GAS export preserves a Unicode surrogate pair at a part boundary", async () => {
  const h = harness({
    Packages: [[]],
    Unknown: [["x".repeat(999_777) + "🧬".repeat(500)]],
  });
  h.context.exportCtiWorkspaceForMigration();
  const value = await readMigrationFiles(uploads(h));
  assert.equal(
    value.sheets.Unknown[0][0],
    "x".repeat(999_777) + "🧬".repeat(500),
  );
  for (const f of h.files.slice(0, -1)) {
    const data = JSON.parse(f.text).data;
    assert.ok(!/[\uD800-\uDBFF]$/.test(data));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(data));
  }
});

test("failed export has no completion manifest and cannot be imported", async () => {
  const h = harness(
    { Packages: [[]], Unknown: [["x".repeat(3_000_000)]] },
    { failAt: 2 },
  );
  assert.throws(
    () => h.context.exportCtiWorkspaceForMigration(),
    /Simulated Drive failure/,
  );
  assert.ok(h.files.length);
  assert.ok(h.files.every((f) => f.name !== "00_manifest.json"));
  await assert.rejects(readMigrationFiles(uploads(h)), /manifest/);
});

test("migration export checks authorization before reading or creating files", () => {
  const h = harness({}, { allowed: false });
  assert.throws(
    () => h.context.exportCtiWorkspaceForMigration(),
    /Not authorized/,
  );
  assert.equal(h.reads(), 0);
  assert.equal(h.folders(), 0);
});
