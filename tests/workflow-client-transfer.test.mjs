import test from "node:test";
import assert from "node:assert/strict";
import { runWorkflow } from "../web/workflow-client.ts";
import { comparisonFixture } from "./workflow-fixtures.mjs";

test("comparison transfers capture metadata and original-file buffers once, without detaching XLSX or history", async () => {
  const nativeWorker = globalThis.Worker;
  const input = comparisonFixture(),
    historyBytes = new Uint8Array([7, 8]),
    fileBytes = new Uint8Array([1, 2, 3, 4]);
  input.history = [{ data: { retainedBytes: historyBytes } }];
  input.json.archiveFiles = [
    { path: "files/first", bytes: fileBytes.subarray(0, 2), size: 2 },
    { path: "files/second", bytes: fileBytes.subarray(2, 4), size: 2 },
  ];
  const metadata = Buffer.from(input.json.bytes),
    workbook = Buffer.from(input.excel.bytes);
  let received,
    transferred,
    terminated = 0;
  try {
    globalThis.Worker = class {
      postMessage(value, transfers) {
        transferred = transfers;
        received = structuredClone(value, { transfer: transfers });
        queueMicrotask(() =>
          this.onmessage({
            data: { kind: "result", result: { success: true } },
          }),
        );
      }
      terminate() {
        terminated++;
      }
    };
    assert.deepEqual(
      await runWorkflow(
        { kind: "compare", input },
        new AbortController().signal,
      ),
      { success: true },
    );
    assert.equal(
      transferred.length,
      2,
      "Aliased original-file buffers are transferred only once",
    );
    assert.equal(input.json.bytes.byteLength, 0);
    assert.equal(fileBytes.byteLength, 0);
    assert.deepEqual(Buffer.from(received.input.json.bytes), metadata);
    assert.deepEqual([...received.input.json.archiveFiles[0].bytes], [1, 2]);
    assert.deepEqual([...received.input.json.archiveFiles[1].bytes], [3, 4]);
    assert.deepEqual(Buffer.from(input.excel.bytes), workbook);
    assert.deepEqual([...historyBytes], [7, 8]);
    assert.equal(terminated, 1);
  } finally {
    globalThis.Worker = nativeWorker;
  }
});

test("other workflow jobs keep their input buffers and dispatch failures terminate the worker", async () => {
  const nativeWorker = globalThis.Worker,
    bytes = new Uint8Array([1, 2]);
  let transferred,
    terminated = 0;
  try {
    globalThis.Worker = class {
      postMessage(value, transfers) {
        transferred = transfers;
        const received = structuredClone(value, { transfer: transfers });
        queueMicrotask(() =>
          this.onmessage({
            data: { kind: "result", result: { size: received.bytes.length } },
          }),
        );
      }
      terminate() {
        terminated++;
      }
    };
    assert.deepEqual(
      await runWorkflow(
        { kind: "macmillan-scan", bytes, name: "book.xlsx" },
        new AbortController().signal,
      ),
      { size: 2 },
    );
    assert.deepEqual(transferred, []);
    assert.equal(bytes.byteLength, 2);
    globalThis.Worker = class {
      postMessage() {
        throw Error("Dispatch failed");
      }
      terminate() {
        terminated++;
      }
    };
    await assert.rejects(
      runWorkflow(
        { kind: "compare", input: comparisonFixture() },
        new AbortController().signal,
      ),
      /Dispatch failed/,
    );
    assert.equal(terminated, 2);
  } finally {
    globalThis.Worker = nativeWorker;
  }
});
