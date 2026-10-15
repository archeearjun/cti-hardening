import test from "node:test";
import assert from "node:assert/strict";
import { panoptoDeliveryFixture } from "./panopto-delivery-fixtures.mjs";
import { importPanoptoDeliveryInfo } from "../src/domain/panopto-delivery-info.ts";
import { capturedContent } from "../src/domain/content-evidence.ts";
import { itemContentView } from "../src/domain/owner-content.ts";
import { validateOwnerReview } from "../src/domain/owner-actions.ts";
import { validateRecord } from "../src/domain/workspace-validation.ts";
import { newRecord, recordSummary } from "../src/domain/workspace-store.ts";

async function fixture() {
  const f = panoptoDeliveryFixture();
  const capture = await importPanoptoDeliveryInfo(f.responseText, f.spec, f.targetUrl);
  const task = {
    key: "item:" + f.spec.itemId, id: f.spec.itemId, name: f.spec.name,
    path: "Module 0", type: "Plugin", status: "EVIDENCE_NEEDED", actions: [],
    findings: [], sources: [], excerpt: "", url: f.spec.url, questionSummary: [],
    questionComparisons: [], sourceTargets: [], checks: [], sourceOnly: false,
    pluginTargets: [f.targetUrl],
  };
  const content = capturedContent({ textSample: "Original course text", links: [f.targetUrl] }, {
    basis: "Original course capture", capturedAt: "2026-10-14T12:00:00.000Z", url: f.spec.url,
  });
  const snapshot = { schemaVersion: 1, coursera: [{ id: task.id, name: task.name, path: task.path, content }], brightspace: [] };
  const review = {
    status: "in_progress", note: "Video body still needs capture.", updatedAt: capture.importedAt,
    updatedBy: "owner@example.test", panoptoCaptures: [capture],
  };
  const record = newRecord("item-review", task.name, {
    auditId: f.spec.auditId, itemKey: task.key, review,
  }, "package-panopto");
  return { ...f, capture, task, snapshot, review, record };
}

test("Panopto supplements persist only against their report and exact item, with bounded summaries", async () => {
  const f = await fixture();
  validateRecord(f.record);
  const summary = recordSummary(f.record);
  assert.equal(summary.data.review.panoptoCaptureCount, 1);
  assert.equal(summary.data.review.panoptoCaptures, undefined, "list summaries do not copy response models");
  for (const change of [{ auditId: "another-audit" }, { itemKey: "item:another-placement" }]) {
    const changed = structuredClone(f.record);
    Object.assign(changed.data, change);
    assert.throws(() => validateRecord(changed), /different report or item/i);
  }
  assert.throws(() => validateOwnerReview({ ...f.review, panoptoCaptures: [f.capture, f.capture] }), /duplicate/i);
  assert.throws(() => validateOwnerReview({ ...f.review, panoptoCaptures: Array(13).fill(f.capture) }), /invalid/i);
  const changed = structuredClone(f.record);
  changed.data.review.panoptoCaptures[0].nativeModelSha256 = "0".repeat(64);
  assert.throws(() => validateRecord(changed), /hash|model|metadata/i);
});

test("metadata supplements preserve original content, import timing and media uncertainty", async () => {
  const f = await fixture(), original = structuredClone(f.snapshot);
  const view = itemContentView(f.task, f.snapshot, {}, undefined, [], [], [], [f.capture]);
  assert.deepEqual(f.snapshot, original);
  assert.deepEqual(view.coursera, original.coursera[0].content);
  assert.equal(view.observations.length, 1);
  const metadata = view.observations[0];
  assert.match(metadata.basis, /manually imported/i);
  assert.equal(metadata.capturedAt, "", "import time must not become a source observation timestamp");
  assert.equal(metadata.textCoverage, "PARTIAL");
  assert.match(metadata.text, /Synthetic section 1/);
  assert.match(metadata.textReason, /metadata/i);
  assert(metadata.references.includes(f.model.Delivery.PodcastStreams[0].StreamUrl));
  assert(metadata.references.includes(f.model.Delivery.Streams[0].Variants[2].Url));
  assert(metadata.limitations.some((line) => /unverified|not.*verified|not.*captured/i.test(line)));
});

test("changed links retain previous metadata and same-title placements never acquire another item's supplement", async () => {
  const f = await fixture();
  f.snapshot.coursera[0].content.references = [];
  const previous = itemContentView(f.task, f.snapshot, {}, undefined, [], [], [], [f.capture]);
  assert.match(previous.observations[0].basis, /previous.*current course reference unverified/i);
  assert.throws(() => itemContentView({ ...f.task, id: "same-title-other-id" }, f.snapshot, {}, undefined, [], [], [], [f.capture]), /another course item/i);
});
