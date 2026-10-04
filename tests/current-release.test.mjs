import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CTI_RELEASE_REGISTRY_ } from "../src/engine/release.js";
import {
  CTI_GATEWAY_RELEASE_,
  CTI_QA_ENGINE_BUILD_ID_,
} from "../src/engine/matching/text.js";
const qa = createRequire(import.meta.url)("../tools/check.cjs");

test("current QA build and retained workflow identities have explicit provenance", () => {
  assert.equal(CTI_GATEWAY_RELEASE_, "v8.0.0");
  assert.equal(CTI_QA_ENGINE_BUILD_ID_, "v8.0.0-unknown-assessment-evidence-20261004");
  assert.equal(
    qa.CTI_MACMILLAN_BUILD_ID_,
    "v6.8.2-partner-ready-doc-projection-20260912",
  );
  assert.equal(qa.CTI_WORK_QUEUE_BUILD_ID_, "v1.6-evidence-checklist-20260919");
  assert.equal(qa.MACMILLAN_TIME_MODEL_VERSION_, "m2-leaf-evidence-20260911");
  assert.deepEqual(
    [
      CTI_RELEASE_REGISTRY_.courseraExtractor.version,
      CTI_RELEASE_REGISTRY_.courseraExtractor.schema,
    ],
    ["v6.15.8", 35],
  );
  assert.deepEqual(
    [
      CTI_RELEASE_REGISTRY_.brightspaceExtractor.version,
      CTI_RELEASE_REGISTRY_.brightspaceExtractor.schema,
    ],
    ["v1.0.8", 2],
  );
  assert.ok(
    qa
      .ctiCanonicalCourseraExtractorSource_()
      .includes(CTI_RELEASE_REGISTRY_.courseraExtractor.build),
  );
  assert.ok(
    qa
      .ctiCanonicalBrightspaceExtractorSource_()
      .includes(CTI_RELEASE_REGISTRY_.brightspaceExtractor.build),
  );
});
