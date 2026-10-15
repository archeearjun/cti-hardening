import { createHash } from "node:crypto";
import { directCanonicalSourceTextV1 } from "../src/extractors/coursera/direct-data-canonical.js";

export function directTextFixture({
  discussion = false,
  empty = false,
  itemId = "direct-item",
  courseId = "Direct_content_course_123",
  courseSlug = "fixture-course",
  cmlValue,
  textSample,
} = {}) {
  const atomId = "a".repeat(22),
    contentId = "atom~" + atomId,
    text = textSample ?? (empty ? "" : "Draft <div> &amp; text"),
    cml = {
      typeName: "cml",
      definition: {
        dtdId: discussion ? "discussion/1" : "supplement/1",
        value:
          cmlValue ??
          (empty
            ? "<co-content><p></p></co-content>"
            : "<co-content><p>Draft &lt;div&gt; &amp;amp; text</p></co-content>"),
      },
    },
    content = discussion
      ? {
          typeName: "discussionPromptDraft",
          definition: {
            promptType: {
              typeName: "questionPerSession",
              definition: {
                title: "Discussion",
                prompt: cml,
                promptPermissions: { viewAnswersBeforeReplying: false },
              },
            },
          },
        }
      : {
          typeName: "supplementDraft",
          definition: { assetId: "r".repeat(22) + "@1", content: cml },
        },
    atom = {
      id: atomId,
      contentId,
      storedAtomVersion: 1,
      metadata: { updatedAt: 123 },
      status: { typeName: "draftAtomStatus" },
      draft: { content },
    },
    hash = (value) => createHash("sha256").update(value).digest("hex"),
    draftHash = hash(directCanonicalSourceTextV1(atom.draft)),
    receipt = (resource) => ({
      resource,
      id: atomId,
      status: 200,
      bodyFormat: "PARSED_SANITIZED_JSON_MODEL",
      sha256: "b".repeat(64),
      originalResponseSha256: "b".repeat(64),
      requestPath: "/api/" + resource + "/" + atomId,
    });
  return {
    itemId,
    payload: {
      textSample: text,
      textLength: text.length,
      textSha256: hash(text),
      textCaptureTruncated: false,
      textScopeKind: discussion
        ? "bound-authoring-draft-discussion-cml"
        : "bound-authoring-draft-cml",
      directDraftCml: structuredClone(cml),
      directDataEvidence: {
        method: "BOUND_AUTHORING_DRAFT_API",
        courseId,
        itemId,
        atomId,
        contentId,
        sourceState: "AUTHORING_DRAFT",
        stableSource: true,
        draftHash,
        storedAtomVersion: 1,
        updatedAt: 123,
        dtdId: cml.definition.dtdId,
        rawCmlLength: cml.definition.value.length,
        rawCmlSha256: hash(cml.definition.value),
        plainTextLength: text.length,
        ...(discussion
          ? { discussionPromptType: "questionPerSession" }
          : { assetId: content.definition.assetId }),
      },
      directDataSources: {
        atom: { elements: [atom] },
        relation: {
          elements: [
            {
              id: atomId,
              atomId,
              branchRelationMap: {
                [courseId + "~" + itemId]: {
                  courseId,
                  itemId,
                  courseSlug,
                },
              },
            },
          ],
        },
        receipts: {
          atom: receipt("authoringAtoms.v2"),
          relation: receipt("authoringItemContentRelations.v1"),
          stability: {
            stable: true,
            draftHash,
            storedAtomVersion: 1,
            updatedAt: 123,
            atom: { elements: [structuredClone(atom)] },
            receipt: receipt("authoringAtoms.v2"),
          },
        },
      },
    },
  };
}
