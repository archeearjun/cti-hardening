import test from "node:test";
import assert from "node:assert/strict";
import {
  queueCourseraFinalDownload,
  requestCourseraFinalDownload,
} from "../src/domain/coursera-final-download.ts";

const makeStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
const job = { id: "job-a", state: "COMPLETE", artifactAvailable: true };

test("automatic download waits for the terminal artifact and happens once across reopened views", async () => {
  const storage = makeStorage(),
    saved = [];
  queueCourseraFinalDownload(storage, job.id);
  const fetchFile = async () =>
    new File(['{"course":"synthetic"}'], "final.json");
  for (const state of ["QUEUED", "AWAITING_LOGIN", "RUNNING", "VERIFYING"])
    assert.equal(
      await requestCourseraFinalDownload(
        { ...job, state },
        storage,
        fetchFile,
        (file) => saved.push(file),
      ),
      false,
    );
  assert.equal(
    await requestCourseraFinalDownload(
      { ...job, artifactAvailable: false },
      storage,
      fetchFile,
      (file) => saved.push(file),
    ),
    false,
  );
  assert.equal(saved.length, 0);
  assert.equal(
    await requestCourseraFinalDownload(job, storage, fetchFile, (file) =>
      saved.push(file),
    ),
    true,
  );
  assert.equal(
    await requestCourseraFinalDownload(job, storage, fetchFile, (file) =>
      saved.push(file),
    ),
    false,
  );
  assert.equal(saved.length, 1);
  assert.equal(await saved[0].text(), '{"course":"synthetic"}');
});

test("download failures remain retryable and unrelated historical jobs never auto-download", async () => {
  const storage = makeStorage();
  queueCourseraFinalDownload(storage, job.id);
  let fetches = 0,
    saves = 0;
  const fetchFile = async () => {
    fetches++;
    return new File(["{}"], "final.json");
  };
  assert.equal(
    await requestCourseraFinalDownload(
      { ...job, id: "historical" },
      storage,
      fetchFile,
      () => saves++,
    ),
    false,
  );
  assert.equal(fetches, 0);
  await assert.rejects(
    requestCourseraFinalDownload(
      job,
      storage,
      async () => {
        throw new Error("session expired");
      },
      () => saves++,
    ),
    /session expired/,
  );
  await assert.rejects(
    requestCourseraFinalDownload(job, storage, fetchFile, () => {
      throw new Error("save blocked");
    }),
    /save blocked/,
  );
  assert.equal(
    await requestCourseraFinalDownload(job, storage, fetchFile, () => saves++),
    true,
  );
  assert.equal(saves, 1);
});

test("a finished incomplete or failed capture can download with its evidence gaps retained", async () => {
  for (const state of ["INCOMPLETE", "FAILED"]) {
    const storage = makeStorage();
    queueCourseraFinalDownload(storage, job.id);
    let result;
    const raw =
      '{"meta":{"captureAccounting":{"complete":false,"unvisitedCount":3}}}';
    assert.equal(
      await requestCourseraFinalDownload(
        { ...job, state },
        storage,
        async () => new File([raw], "incomplete.json"),
        (file) => {
          result = file;
        },
      ),
      true,
    );
    assert.equal(await result.text(), raw);
  }
});
