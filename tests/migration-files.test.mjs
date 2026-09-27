import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationTextInfo,
  migrationTextParts,
  readMigrationFiles,
} from "../src/domain/migration-files.ts";
import {
  migrationBackupRecords,
  restoreMigrationBackup,
} from "../src/domain/migration-backup.ts";
import { validateImportRecordSizes } from "../src/domain/workspace-validation.ts";
import { newRecord } from "../src/domain/workspace-store.ts";
export function migrationFixtureFiles(
  value = {
    kind: "CTI_WORKSPACE_MIGRATION",
    schemaVersion: 1,
    sheets: { Packages: [[]], Unknown: [["🧬" + "x".repeat(1_000_100)]] },
  },
) {
  const text = JSON.stringify(value),
    exportId = "test-export";
  const parts = [...migrationTextParts(text)].map((data, index) => ({
    name: `part_${index}_${exportId}.json`,
    value: {
      kind: "CTI_WORKSPACE_MIGRATION_PART",
      schemaVersion: 1,
      exportId,
      index,
      data,
    },
  }));
  return [
    {
      name: "00_manifest.json",
      value: {
        kind: "CTI_WORKSPACE_MIGRATION_MANIFEST",
        schemaVersion: 1,
        exportId,
        partCount: parts.length,
        charCount: text.length,
        utf8Bytes: migrationTextInfo(text).utf8Bytes,
        parts: parts.map((p) => ({
          index: p.value.index,
          fileName: p.name,
          charCount: p.value.data.length,
          ...migrationTextInfo(p.value.data),
        })),
      },
    },
    ...parts,
  ];
}
const files = (values) =>
  values.map((v) => ({
    name: v.name,
    text: async () => JSON.stringify(v.value),
  }));

test("multipart accepts shuffled files and rejects missing, duplicate, extra, mixed, corrupt and invalid metadata", async () => {
  const f = migrationFixtureFiles();
  assert.equal(
    (await readMigrationFiles(files([...f].reverse()))).kind,
    "CTI_WORKSPACE_MIGRATION",
  );
  await assert.rejects(readMigrationFiles(files(f.slice(0, -1))), /Missing/);
  await assert.rejects(readMigrationFiles(files([f[0]])), /Missing/);
  await assert.rejects(readMigrationFiles(files([f[1]])), /manifest/);
  await assert.rejects(readMigrationFiles(files([...f, f[1]])), /Duplicate/);
  await assert.rejects(
    readMigrationFiles(files([...f, { name: "unrelated.json", value: {} }])),
    /Extra/,
  );
  for (const mutate of [
    (a) => (a[1].value.exportId = "another-export"),
    (a) => (a[1].value.index = 99),
    (a) => (a[1].value.schemaVersion = 2),
    (a) =>
      (a[1].value.data = a[1].value.data.replace(
        "CTI_WORKSPACE",
        "CTI_XORKSPACE",
      )),
    (a) => a[0].value.utf8Bytes++,
    (a) => (a[0].value.parts[1].index = 0),
    (a) => (a[0].value.parts[1].fileName = a[0].value.parts[0].fileName),
  ]) {
    const bad = structuredClone(f);
    mutate(bad);
    await assert.rejects(readMigrationFiles(files(bad)));
  }
  const controller = new AbortController();
  await assert.rejects(
    readMigrationFiles(files(f), () => controller.abort(), controller.signal),
    /stopped/,
  );
});

test("single-file migrations and workspace backups remain supported", async () => {
  for (const kind of ["CTI_WORKSPACE_MIGRATION", "CTI_BROWSER_WORKSPACE"]) {
    const value = {
      kind,
      schemaVersion: 1,
      records: [],
      sheets: { Packages: [[]] },
    };
    assert.deepEqual(
      await readMigrationFiles(files([{ name: "old.json", value }])),
      value,
    );
  }
  await assert.rejects(
    readMigrationFiles([{ name: "broken.json", text: async () => "{oops" }]),
    /Cannot read/,
  );
});

test("small original backups retain their compatible shape and stable IDs", () => {
  const value = {
    kind: "CTI_WORKSPACE_MIGRATION",
    schemaVersion: 1,
    sheets: { Packages: [[]], Unknown: [["retain"]] },
  };
  const a = migrationBackupRecords(value),
    b = migrationBackupRecords(value);
  assert.equal(a.length, 1);
  assert.equal(a[0].id, b[0].id);
  assert.deepEqual(restoreMigrationBackup(a[0], a), value);
});

test("preflight rejects oversized individual records and duplicate IDs before save", () => {
  const r = newRecord("legacy-backup", "Oversized", {
    text: "x".repeat(32 * 1024 * 1024),
  });
  assert.throws(
    () => validateImportRecordSizes([r]),
    /before saving.*Oversized.*32 MiB/,
  );
  r.data = {};
  assert.throws(() => validateImportRecordSizes([r, r]), /Duplicate/);
});

test("transport fragments preserve split-point emoji and bound worst-case escaping", () => {
  const text = '"'.repeat(999_999) + "🧬" + "\u0000".repeat(1_000_001);
  const parts = [...migrationTextParts(text)];
  assert.equal(parts.join(""), text);
  assert.equal(parts[0].length, 999_999);
  assert.equal(migrationTextInfo(text).utf8Bytes, Buffer.byteLength(text));
  assert.ok(
    parts.every(
      (p) => Buffer.byteLength(JSON.stringify({ data: p })) < 6_100_000,
    ),
  );
});
