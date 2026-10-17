import { createHash } from "node:crypto";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";
import { directSourceBindingEvidenceV1 } from "../src/extractors/coursera/direct-data-contracts.js";
import { bindDirectAuthoringDraftV1 } from "../src/extractors/coursera/direct-data-models.js";

export const gradingCourseId = "Synthetic_grading_course_123";
export const gradingCourseSlug = "synthetic-grading-course";

export function gradingFixture(graded = true) {
  const atomId = "g".repeat(22),
    configuration = {
      ...(graded !== undefined ? { isGraded: graded } : {}),
      submissionLimitForEachAttempt: 2,
    };
  const atom = {
      id: atomId,
      contentId: "atom~" + atomId,
      storedAtomVersion: 3,
      metadata: { updatedAt: 1792224000000 },
      status: { typeName: "draftAtomStatus", definition: {} },
      draft: {
        name: "Practice [Ungraded]",
        content: {
          typeName: "staffGradedDraft",
          definition: { configuration, parts: [], passingFraction: 0.8 },
        },
      },
      published: {
        content: {
          typeName: "staffGradedDraft",
          definition: { configuration: { isGraded: !graded } },
        },
      },
    },
    relation = {
      id: atomId,
      atomId,
      branchRelationMap: {
        [gradingCourseId + "~gradingItem"]: {
          courseId: gradingCourseId,
          courseSlug: gradingCourseSlug,
          itemId: "gradingItem",
        },
      },
    };
  const receipt = (resource) => ({
    resource,
    id: atomId,
    status: 200,
    bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
    originalResponseSha256: "b".repeat(64),
    sha256: "b".repeat(64),
    requestPath: "/api/" + resource + "/" + atomId,
    observedAt: "2026-10-17T10:00:00.000Z",
  });
  const sources = {
      atom: { elements: [atom] },
      relation: { elements: [relation] },
      receipts: {
        atom: receipt("authoringAtoms.v2"),
        relation: receipt("authoringItemContentRelations.v1"),
        stability: {
          stable: true,
          draftHash: createHash("sha256")
            .update(directCanonicalSourceTextV1(atom.draft))
            .digest("hex"),
          storedAtomVersion: 3,
          updatedAt: atom.metadata.updatedAt,
          atom: { elements: [structuredClone(atom)] },
          receipt: receipt("authoringAtoms.v2"),
        },
      },
    },
    item = {
      id: "gradingItem",
      name: "Practice [Ungraded]",
      type: "Assignment",
      typeName: "staffGraded",
      atomId,
      contentId: "atom~" + atomId,
      payload: {
        directDataSources: sources,
        structuredAssessment: {
          configuration: structuredClone(configuration),
          questions: [],
        },
      },
    },
    bound = bindDirectAuthoringDraftV1(
      item,
      gradingCourseId,
      gradingCourseSlug,
      sources.atom,
      sources.relation,
    );
  item.payload.directDataEvidence = directSourceBindingEvidenceV1(item, bound);
  return { item, atom, relation, sources };
}
