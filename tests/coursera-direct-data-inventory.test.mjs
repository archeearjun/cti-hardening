import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { directCourseInventoryV1 } from "../src/extractors/coursera/direct-data-inventory.js";
import { sanitizeCourseraCourseDataModel } from "../src/extractors/coursera/direct-data-privacy.js";
globalThis.crypto ??= webcrypto;
globalThis.location = {
  origin: "https://www.coursera.org",
  href: "https://www.coursera.org/teach/example/branch123/content/edit",
};
const id = "branch123",
  atom = "a".repeat(22);
function fixture() {
  return {
    elements: [
      {
        id,
        conflictMetadata: { version: 2, courseBranchVersion: 2 },
        material: {
          elements: [
            {
              id: "module1",
              name: "Module",
              description: "",
              learningObjectives: [],
              timeCommitment: 0,
              elements: [
                {
                  id: "lesson1",
                  name: "Lesson",
                  trackId: "track1",
                  elements: [
                    {
                      id: "reading1",
                      name: "Current title",
                      originalName: "Untitled",
                      atomId: atom,
                      contentId: "atom~" + atom,
                      content: { typeName: "supplement", definition: {} },
                    },
                  ],
                },
                {
                  id: "emptyLesson",
                  name: "Empty lesson",
                  trackId: "track2",
                  elements: [],
                },
              ],
            },
            {
              id: "emptyModule",
              name: "Empty module",
              description: "",
              learningObjectives: [],
              timeCommitment: 0,
              elements: [],
            },
          ],
        },
      },
    ],
    paging: {},
    linked: {},
  };
}
test("complete ordered native inventory preserves empty structures and current display titles", async () => {
  const result = await directCourseInventoryV1(fixture(), id);
  assert.deepEqual(
    result.fingerprints.map((fp) => fp.id),
    ["reading1", "emptyLesson", "emptyModule"],
  );
  assert.equal(result.fingerprints[0].name, "Current title");
  assert.equal(result.fingerprints[0].sourceIdentity.originalName, "Untitled");
  assert.equal(result.fingerprints[0].payload.textSample, "");
  assert.deepEqual(result.leaves.get("emptyLesson").ancestorIds, ["module1"]);
  assert.equal(result.leaves.get("emptyModule").structural, true);
});
test("sanitized null-prototype nested content stays inventory data rather than an asset filename", async () => {
  const data = fixture();
  data.elements[0].material.elements[0].elements[0].elements[0].content.definition =
    {
      assetId: { nested: "not a filename" },
      writeAccessToken: "fixture-secret",
    };
  const sanitized = sanitizeCourseraCourseDataModel(data);
  assert.equal(sanitized.removedFields, 1);
  const result = await directCourseInventoryV1(sanitized.data, id);
  assert.equal(result.fingerprints.length, 3);
  assert.deepEqual(result.fingerprints[0].payload.assetDetails, []);
});
test("wrong root, pagination, duplicate identity, ambiguous children and mismatched atom references fail closed", async () => {
  const mutations = [
    (d) => (d.elements[0].id = "other"),
    (d) => (d.paging.next = "next"),
    (d) =>
      d.elements[0].material.elements.push(d.elements[0].material.elements[0]),
    (d) => delete d.elements[0].material.elements[0].elements[1].elements,
    (d) =>
      (d.elements[0].material.elements[0].elements[0].elements[0].contentId =
        "atom~wrong"),
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    await assert.rejects(directCourseInventoryV1(data, id), /DIRECT_/);
  }
});
test(
  "actual private material replay has exactly 185 ordered leaves and no fabricated content bodies",
  { skip: !process.env.CTI_COURSERA_REAL_DRAFT_FIXTURE },
  async () => {
    const data = JSON.parse(
      readFileSync(process.env.CTI_COURSERA_REAL_DRAFT_FIXTURE, "utf8"),
    );
    const record = data.records.find(
      (row) => row.resource === "authoringCourseMaterials.v1",
    );
    const result = await directCourseInventoryV1(record.data, data.courseId);
    assert.equal(result.fingerprints.length, 185);
    assert.equal(
      [...result.leaves.values()].filter((row) => row.structural).length,
      20,
    );
    assert.equal(result.materialVersion, 262);
    assert.ok(result.fingerprints.every((fp) => fp.payload.textSample === ""));
  },
);
