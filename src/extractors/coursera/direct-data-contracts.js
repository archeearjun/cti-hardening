import { sha256 } from "./text-and-dom.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import {
  directDraftReadingDtdSupportedV1,
  directDraftReadingSourceV1,
  directDraftDiscussionSourceV1,
  bindDirectAuthoringDraftV1,
} from "./direct-data-models.js";
import {
  directCmlMediaInventoryV1,
  directMediaEvidenceStructureV1,
} from "./direct-data-media-contracts.js";
import { directAssetMetadataBindingV1, directRetainedAssetBodyV1 } from "./direct-data-media.js";
import {
  CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1,
  CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1,
  directDraftWidgetProviderV1,
  directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1,
  directInlineWidgetProviderSourceV1,
  directInlineWidgetProviderTargetsV1,
} from "./direct-data-widget.js";

export function directReceiptSourceValidV1(receipt, resource, id) {
  const hash = receipt?.originalResponseSha256 || receipt?.sha256;
  const path =
    "/api/" + resource + "/" + encodeURIComponent(id).replace(/%40/gi, "@");
  return Boolean(
    receipt?.resource === resource &&
      receipt.id === id &&
      receipt.status === 200 &&
      receipt.bodyFormat === "PARSED_SANITIZED_JSON_MODEL" &&
      /^[a-f0-9]{64}$/.test(hash || "") &&
      (!receipt.sha256 || receipt.sha256 === hash) &&
      (receipt.requestPath === path ||
        (resource === "authoringCourseMaterials.v1" &&
          receipt.requestPath === path + "/")),
  );
}

export function applyDirectContractV1(
  fp,
  status,
  complete,
  reasons = [],
  externalBodyVerified = null,
) {
  const contract = {
    itemId: String((fp && fp.id) || ""),
    type: String((fp && (fp.type || fp.typeName)) || "Unknown"),
    attempts: 1,
    maxAttempts: 1,
    complete: complete === true,
    accounted: true,
    needsEditor: false,
    retryable: false,
    status,
    reasons: [...reasons],
    externalBodyVerified,
  };
  const payload = fp.payload || (fp.payload = {});
  fp.captureContract = contract;
  payload.captureContract = contract;
  return contract;
}

/** A stability flag alone cannot bind an author's draft to this course item. */
export function directSourceBindingEvidenceV1(fp, bound) {
  const sources = fp && fp.payload && fp.payload.directDataSources;
  const atom = sources && sources.atom && sources.atom.elements;
  const relations = sources && sources.relation && sources.relation.elements;
  const receipts = sources && sources.receipts,
    stable = receipts && receipts.stability;
  if (
    !bound ||
    fp?.payload?.directResumeRevalidation?.verified === false ||
    bound.sourceState !== "AUTHORING_DRAFT" ||
    !sources ||
    !Array.isArray(atom) ||
    atom.length !== 1 ||
    !Array.isArray(relations) ||
    relations.length !== 1 ||
    typeof bound.courseId !== "string" ||
    !bound.courseId ||
    bound.itemId !== String(fp.id) ||
    bound.atomId !== fp.atomId ||
    bound.contentId !== fp.contentId ||
    !/^[A-Za-z0-9_-]{22}$/.test(bound.atomId || "") ||
    bound.contentId !== "atom~" + bound.atomId
  )
    return null;
  const a = atom[0],
    r = relations[0],
    branch =
      r &&
      r.branchRelationMap &&
      r.branchRelationMap[bound.courseId + "~" + fp.id];
  if (
    !a ||
    a.id !== bound.atomId ||
    a.contentId !== bound.contentId ||
    a.status?.typeName !== "draftAtomStatus" ||
    !a.draft ||
    !Number.isSafeInteger(a.storedAtomVersion) ||
    a.storedAtomVersion < 0 ||
    typeof a.metadata?.updatedAt !== "number" ||
    !Number.isFinite(a.metadata.updatedAt) ||
    !r ||
    r.id !== bound.atomId ||
    r.atomId !== bound.atomId ||
    !branch ||
    branch.courseId !== bound.courseId ||
    branch.itemId !== fp.id ||
    branch.courseSlug !== bound.courseSlug ||
    !stable ||
    stable.stable !== true ||
    !/^[a-f0-9]{64}$/.test(stable.draftHash || "") ||
    stable.storedAtomVersion !== a.storedAtomVersion ||
    stable.updatedAt !== a.metadata?.updatedAt ||
    bound.storedAtomVersion !== a.storedAtomVersion ||
    bound.updatedAt !== a.metadata?.updatedAt
  )
    return null;
  const fresh = stable.atom?.elements,
    freshReceipt = stable.receipt;
  if (
    !Array.isArray(fresh) ||
    fresh.length !== 1 ||
    fresh[0]?.id !== bound.atomId ||
    fresh[0].contentId !== bound.contentId ||
    fresh[0].status?.typeName !== "draftAtomStatus" ||
    fresh[0].storedAtomVersion !== a.storedAtomVersion ||
    fresh[0].metadata?.updatedAt !== a.metadata.updatedAt ||
    !directReceiptSourceValidV1(freshReceipt, "authoringAtoms.v2", bound.atomId)
  )
    return null;
  try {
    if (
      directCanonicalSourceTextV1(a.draft) !==
      directCanonicalSourceTextV1(fresh[0].draft)
    )
      return null;
  } catch (_) {
    return null;
  }
  for (const [key, resource] of [
    ["atom", "authoringAtoms.v2"],
    ["relation", "authoringItemContentRelations.v1"],
  ]) {
    if (!directReceiptSourceValidV1(receipts[key], resource, bound.atomId))
      return null;
  }
  return {
    method: "BOUND_AUTHORING_DRAFT_API",
    courseId: bound.courseId,
    itemId: String(fp.id),
    atomId: bound.atomId,
    contentId: bound.contentId,
    draftHash: stable.draftHash,
    storedAtomVersion: a.storedAtomVersion,
    updatedAt: a.metadata?.updatedAt,
    sourceState: "AUTHORING_DRAFT",
    stableSource: true,
  };
}

/** XML is parsed into an inert detached document; no source node is mounted. */
export function directCmlTextV1(cml, textProjectionVersion = 1) {
  if (
    typeof cml !== "string" ||
    cml.length > 4000000 ||
    /<!DOCTYPE|<!ENTITY/i.test(cml) ||
    typeof DOMParser === "undefined"
  )
    return null;
  const mediaInventory = directCmlMediaInventoryV1(cml, textProjectionVersion);
  if (!mediaInventory.valid) return null;
  // Bound markup before the XML parser allocates a document. Body-byte limits
  // alone do not bound the number of tiny XML nodes in a supplied source.
  let markup = 0;
  for (
    let index = cml.indexOf("<");
    index !== -1;
    index = cml.indexOf("<", index + 1)
  )
    if (++markup > 100000) return null;
  try {
    const document = new DOMParser().parseFromString(cml, "application/xml");
    const root = document.documentElement;
    if (
      !root ||
      root.localName !== "co-content" ||
      document.getElementsByTagName("parsererror").length ||
      document.getElementsByTagName("script").length ||
      document.getElementsByTagName("style").length
    )
      return null;
    const text = mediaInventory.text;
    if (root.getElementsByTagName("*").length > 50000) return null;
    const references = [],
      links = [];
    const nodes = [root, ...Array.from(root.getElementsByTagName("*"))];
    for (const node of nodes) {
      const tag = String(node.localName || "").toLowerCase();
      if (tag === "script" || tag === "style") return null;
      const attribute = (name) => String(node.getAttribute(name) || "");
      const href = attribute("href");
      if (tag === "a" && /^https?:\/\//i.test(href)) links.push(href);
      const attachment =
        tag === "a" &&
        (node.hasAttribute("download") ||
          /\.(?:pdf|docx?|pptx?|xlsx?|zip|csv|png|jpe?g|gif|webp)(?:[?#]|$)/i.test(
            href,
          ));
      if (
        !attachment &&
        !/^(?:asset|img|image|iframe|frame|video|audio|source|embed|object)$/.test(
          tag,
        )
      )
        continue;
      const url =
        href || attribute("src") || attribute("url") || attribute("data");
      const id =
        attribute("assetId") || attribute("assetid") || attribute("id");
      references.push({
        tag,
        id,
        url,
        name: attribute("filename") || attribute("name") || attribute("title"),
        locationResolved:
          /^https?:\/\//i.test(url) &&
          !/^(?:iframe|frame|embed|object)$/.test(tag),
        bodyVerified: false,
      });
    }
    return {
      text,
      textProjectionVersion,
      references: mediaInventory.references,
      links: [...new Set(links)],
    };
  } catch (_) {
    return null;
  }
}

/** Shared binary proof for native CML readings and discussion prompts. */
export async function directCmlMediaPayloadV1(
  payload,
  parsed,
  source,
  evidence,
  textScopeKind,
) {
  const media = directMediaEvidenceStructureV1(
    payload.directAssetEvidence,
    parsed.references,
  );
  let mediaVerified = media.complete,
    mediaReason = media.reason;
  if (mediaVerified) {
    for (const captured of media.decoded) {
      try {
        if (typeof crypto === "undefined" || !crypto.subtle)
          throw new Error("hash unavailable");
        const digest = await crypto.subtle.digest("SHA-256", captured.bytes);
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== captured.asset.body.sha256)
          throw new Error("hash mismatch");
      } catch (_) {
        mediaVerified = false;
        mediaReason = "DIRECT_ASSET_BODY_HASH_INVALID";
        break;
      }
    }
  }
  const verifiedReferences = new Set();
  if (!mediaVerified && payload.directAssetEvidence?.method === "BOUND_CML_ASSET_METADATA_AND_BODY") {
    for (const reference of parsed.references) {
      if (!/^(asset|img|image|a)$/.test(reference.tag) || !/^[\w-]{22}$/.test(reference.id) || verifiedReferences.has(reference)) continue;
      const assets = payload.directAssetEvidence.assets?.filter(asset => asset.assetId === reference.id) || [];
      if (assets.length === 1 && await directRetainedAssetBodyV1(assets[0], reference.id)) verifiedReferences.add(reference);
    }
  }
  const unresolved = mediaVerified ? [] : parsed.references.filter(reference => !verifiedReferences.has(reference));
  const textHash = await sha256(parsed.text),
    rawHash = await sha256(source.cml);
  payload.textSample = parsed.text;
  payload.textLength = parsed.text.length;
  payload.textSha256 = textHash;
  payload.textConfidence = "high";
  payload.textEvidencePriority = 98;
  payload.textEvidenceCompleteness = 1;
  payload.textScopeKind = textScopeKind;
  payload.textCaptureTruncated = false;
  payload.links = parsed.links;
  // Keep missing-location references visible: a native ID or label is useful
  // retained evidence even when its binary body cannot yet be acquired.
  payload.assetDetails = parsed.references.map((reference) => {
    const asset = payload.directAssetEvidence?.assets?.find(
      (candidate) => candidate.assetId === reference.id,
    );
    const binding =
      asset && directAssetMetadataBindingV1(asset.metadata, reference.id);
    const bodyVerified = mediaVerified || verifiedReferences.has(reference);
    return {
      url: binding?.canonicalUrl || reference.url,
      assetId: reference.id,
      name: binding?.name || reference.name || "",
      referenceName: reference.name || "",
      tag: reference.tag,
      evidenceSource: bodyVerified
        ? "bound-native-cml-asset-body"
        : "bound-authoring-draft-cml",
      hashStatus: bodyVerified
        ? "HASHED_ORIGINAL_BINARY_BYTES"
        : "NOT_FETCHED_DIRECT_DATA",
      bodyVerified,
      ...(bodyVerified && asset
        ? {
            sha256: asset.body.sha256,
            size: asset.body.size,
            mime: asset.body.mime,
          }
        : {}),
    };
  });
  payload.files = payload.assetDetails
    .filter((asset) => /^https?:\/\//i.test(asset.url))
    .map((asset) => asset.url);
  payload.images = payload.assetDetails
    .filter(
      (asset) =>
        /^(?:img|image)$/.test(asset.tag) && /^https?:\/\//i.test(asset.url),
    )
    .map((asset) => asset.url);
  payload.directDataEvidence = {
    ...evidence,
    rawCmlLength: source.cml.length,
    rawCmlSha256: rawHash,
    plainTextLength: parsed.text.length,
    textProjectionVersion: parsed.textProjectionVersion,
    assetReferenceCount: parsed.references.length,
    assetsBodyVerified: mediaVerified,
    unresolvedAssetReferences: unresolved,
  };
  return { mediaVerified, mediaReason, textHash, rawHash };
}

export async function directReadingPayloadV1(fp, bound, source) {
  const payload = fp.payload || (fp.payload = {}),
    evidence = directSourceBindingEvidenceV1(fp, bound);
  const actual = payload.directDataSources?.atom?.elements?.[0]?.draft?.content;
  const raw =
    actual &&
    actual.typeName === "supplementDraft" &&
    actual.definition?.content;
  if (
    !evidence ||
    fp.typeName !== "supplement" ||
    !source ||
    source.sourceState !== "AUTHORING_DRAFT" ||
    raw?.typeName !== "cml" ||
    !directDraftReadingDtdSupportedV1(raw.definition?.dtdId) ||
    source.dtdId !== raw.definition.dtdId ||
    typeof raw.definition?.value !== "string" ||
    raw.definition.value !== source.cml ||
    source.assetId !== actual.definition.assetId ||
    !/^[A-Za-z0-9_-]{22}@\d+$/.test(source.assetId || "")
  )
    return applyDirectContractV1(fp, "UNRESOLVED_DIRECT_READING", false, [
      "DIRECT_READING_SOURCE_NOT_BOUND",
    ]);
  const parsed = directCmlTextV1(source.cml, 2);
  payload.directDraftCml = raw;
  if (!parsed)
    return applyDirectContractV1(fp, "UNRESOLVED_DIRECT_READING", false, [
      "DIRECT_CML_NOT_SUPPORTED",
    ]);
  const { mediaVerified, mediaReason, textHash, rawHash } =
    await directCmlMediaPayloadV1(
      payload,
      parsed,
      source,
      { ...evidence, dtdId: source.dtdId, assetId: source.assetId },
      "bound-authoring-draft-cml",
    );
  if (!textHash || !rawHash)
    return applyDirectContractV1(fp, "UNRESOLVED_DIRECT_READING", false, [
      "DIRECT_READING_HASH_UNAVAILABLE",
    ]);
  if (!mediaVerified)
    return applyDirectContractV1(fp, "UNRESOLVED_DIRECT_READING", false, [
      "DIRECT_READING_ASSETS_UNRESOLVED",
      ...(mediaReason && mediaReason !== "DIRECT_READING_ASSETS_UNRESOLVED"
        ? [mediaReason]
        : []),
    ]);
  return applyDirectContractV1(fp, "COMPLETE_BOUND_DRAFT_READING", true);
}

export async function directDiscussionPayloadV1(fp, bound, source) {
  const payload = fp.payload || (fp.payload = {}),
    evidence = directSourceBindingEvidenceV1(fp, bound);
  const content =
      payload.directDataSources?.atom?.elements?.[0]?.draft?.content,
    promptType = content?.definition?.promptType,
    definition = promptType?.definition,
    raw = definition?.prompt;
  let sameDefinition = false;
  try {
    sameDefinition =
      directCanonicalSourceTextV1(definition) ===
      directCanonicalSourceTextV1(source?.rawDefinition);
  } catch (_) {
    /* Missing or non-JSON source evidence remains incomplete. */
  }
  if (
    !evidence ||
    fp.typeName !== "discussionPrompt" ||
    source?.sourceState !== "AUTHORING_DRAFT" ||
    content?.typeName !== "discussionPromptDraft" ||
    promptType?.typeName !== "questionPerSession" ||
    source.promptType !== promptType.typeName ||
    !sameDefinition ||
    typeof definition?.title !== "string" ||
    source.title !== definition.title ||
    typeof definition.promptPermissions?.viewAnswersBeforeReplying !==
      "boolean" ||
    raw?.typeName !== "cml" ||
    raw.definition?.dtdId !== "discussion/1" ||
    source.dtdId !== "discussion/1" ||
    typeof raw.definition?.value !== "string" ||
    source.cml !== raw.definition.value
  )
    return applyDirectContractV1(fp, "UNRESOLVED_DIRECT_DISCUSSION", false, [
      "DIRECT_DISCUSSION_SOURCE_NOT_BOUND",
    ]);
  payload.directDraftDiscussion = definition;
  payload.directDraftCml = raw;
  payload.discussionTitle = definition.title;
  payload.discussionPromptPermissions = definition.promptPermissions;
  const parsed = directCmlTextV1(source.cml, 2);
  if (!parsed)
    return applyDirectContractV1(fp, "UNRESOLVED_DIRECT_DISCUSSION", false, [
      "DIRECT_CML_NOT_SUPPORTED",
    ]);
  const { mediaVerified, mediaReason, textHash, rawHash } =
    await directCmlMediaPayloadV1(
      payload,
      parsed,
      source,
      {
        ...evidence,
        discussionPromptType: "questionPerSession",
        dtdId: "discussion/1",
      },
      "bound-authoring-draft-discussion-cml",
    );
  if (!textHash || !rawHash)
    return applyDirectContractV1(fp, "UNRESOLVED_DIRECT_DISCUSSION", false, [
      "DIRECT_DISCUSSION_HASH_UNAVAILABLE",
    ]);
  if (!mediaVerified)
    return applyDirectContractV1(fp, "UNRESOLVED_DIRECT_DISCUSSION", false, [
      "DIRECT_DISCUSSION_ASSETS_UNRESOLVED",
      ...(mediaReason && mediaReason !== "DIRECT_READING_ASSETS_UNRESOLVED"
        ? [mediaReason]
        : []),
    ]);
  return applyDirectContractV1(fp, "COMPLETE_BOUND_DRAFT_DISCUSSION", true);
}

/** Explicit zero-part drafts are source emptiness, not evidence of missing
 * questions or a claim that an assessment is instructionally complete. */
export function directEmptyAssessmentContractV1(
  fp,
  assessment,
  inventory,
  bound,
) {
  const payload = fp.payload || (fp.payload = {}),
    evidence = directSourceBindingEvidenceV1(fp, bound),
    content = payload.directDataSources?.atom?.elements?.[0]?.draft?.content,
    definition = content?.definition,
    raw = payload.assessmentApiEvidence;
  const empty = (value) => Array.isArray(value) && value.length === 0;
  const cml = (value) =>
    value === undefined || (value?.typeName === "cml" &&
    /^(?:assess|staffGraded)\/1$/.test(value.definition?.dtdId || "") &&
    typeof value.definition?.value === "string" &&
    directCmlTextV1(value.definition.value)?.references.length === 0);
  const same = (left, right) => {
    if (left === undefined || right === undefined) return left === right;
    try {
      return (
        directCanonicalSourceTextV1(left) === directCanonicalSourceTextV1(right)
      );
    } catch (_) {
      return false;
    }
  };
  const valid = Boolean(
    evidence &&
      ["staffGraded", "gradedAssignment", "ungradedAssignment"].includes(fp.typeName) &&
      content?.typeName === "staffGradedDraft" &&
      empty(definition?.parts) &&
      Object.keys(definition).every(key => ["parts", "configuration", "introduction", "reviewCriteria", "passingFraction", "assignmentLevelRubrics"].includes(key)) &&
      definition.configuration &&
      typeof definition.configuration === "object" &&
      !Array.isArray(definition.configuration) &&
      cml(definition.introduction) &&
      cml(definition.reviewCriteria) &&
      empty(definition.assignmentLevelRubrics) &&
      typeof definition.passingFraction === "number" &&
      Number.isFinite(definition.passingFraction) &&
      definition.passingFraction >= 0 &&
      definition.passingFraction <= 1 &&
      inventory?.complete === true &&
      inventory.reason === "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS" &&
      inventory.assignmentId === bound.atomId &&
      inventory.declared === 0 &&
      inventory.declaredContentParts === 0 &&
      empty(inventory.candidates) &&
      empty(inventory.rawParts) &&
      empty(inventory.unsupportedParts) &&
      raw?.method === "BOUND_AUTHORING_DRAFT_API" &&
      raw.courseId === bound.courseId &&
      raw.itemId === fp.id &&
      raw.assignmentId === bound.atomId &&
      [
        "inventory",
        "rawParts",
        "unsupportedParts",
        "groups",
        "questionDefinitions",
        "receipts",
        "groupStability",
        "failures",
      ].every((key) => empty(raw[key])) &&
      assessment?.declaredQuestionCount === 0 &&
      assessment.questionCount === 0 &&
      assessment.answerEvidenceQuestionCount === 0 &&
      empty(assessment.questions) &&
      [
        "configuration",
        "introduction",
        "reviewCriteria",
        "passingFraction",
        "assignmentLevelRubrics",
      ].every(
        (key) =>
          same(assessment[key], definition[key]) &&
          same(inventory[key], definition[key]),
      ),
  );
  if (evidence)
    payload.directDataEvidence = {
      ...evidence,
      declaredContentParts: 0,
      orderedGroupIds: [],
      sourceEmpty: valid,
    };
  if (assessment) payload.structuredAssessment = assessment;
  if (valid) {
    payload.explicitEmptyAssessmentEvidence = {
      method: "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS",
      courseId: bound.courseId,
      itemId: fp.id,
      atomId: bound.atomId,
      sourceEmpty: true,
      declaredContentParts: 0,
      answerKeyApplicable: false,
    };
    assessment.captureCompleteness = {
      declared: 0,
      declaredContentParts: 0,
      captured: 0,
      questionCoverageComplete: true,
      answerCoverageComplete: true,
      requiredAnswerCoverageComplete: true,
      missingQuestionOrdinals: [],
      missingRequiredAnswerOrdinals: [],
      sourceEmpty: true,
      answerKeyApplicability: "NOT_APPLICABLE_NO_QUESTIONS",
      stopReason: "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS",
    };
  }
  return applyDirectContractV1(
    fp,
    valid
      ? "COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT"
      : "UNRESOLVED_DIRECT_ASSESSMENT",
    valid,
    valid ? [] : ["DIRECT_EMPTY_ASSESSMENT_SOURCE_NOT_ESTABLISHED"],
  );
}

export function directAssessmentContractV1(fp, assessment, inventory, bound) {
  const payload = fp.payload || (fp.payload = {}),
    evidence = directSourceBindingEvidenceV1(fp, bound);
  const candidates = inventory && inventory.candidates,
    parts =
      payload.directDataSources?.atom?.elements?.[0]?.draft?.content?.definition
        ?.parts;
  const raw = payload.assessmentApiEvidence,
    coverage = assessment && assessment.captureCompleteness;
  if (Array.isArray(parts) && parts.length === 0)
    return directEmptyAssessmentContractV1(fp, assessment, inventory, bound);
  if (Array.isArray(parts) && parts.length > 0 && parts.every(part => part?.typeName === "storedTextBlockPart"))
    return directInstructionAssessmentContractV1(fp, assessment, inventory, bound);
  if (Array.isArray(raw?.questionDefinitions) && raw.questionDefinitions.some(value => /^(?:mcqReflect|checkboxReflect)$/.test(value?.definition?.typeName || "")))
    return directReflectionAssessmentContractV1(fp, assessment, inventory, bound);
  const metadata = directAssessmentMetadataCoverageV1(
    bound?.draft?.content?.definition,
    assessment,
    inventory,
  );
  let valid = Boolean(
    evidence &&
      metadata.valid &&
      inventory?.complete === true &&
      Array.isArray(parts) &&
      parts.length > 0 &&
      Array.isArray(candidates) &&
      candidates.length === parts.length &&
      !inventory.unsupportedParts?.length &&
      raw &&
      raw.method === "BOUND_AUTHORING_DRAFT_API" &&
      raw.courseId === bound.courseId &&
      raw.itemId === fp.id &&
      raw.assignmentId === bound.atomId &&
      Array.isArray(raw.rawParts) &&
      directCanonicalSourceTextV1(raw.rawParts) ===
        directCanonicalSourceTextV1(parts) &&
      Array.isArray(raw.unsupportedParts) &&
      raw.unsupportedParts.length === 0 &&
      Array.isArray(raw.failures) &&
      raw.failures.length === 0 &&
      Array.isArray(raw.groups) &&
      raw.groups.length === parts.length &&
      Array.isArray(raw.questionDefinitions) &&
      raw.questionDefinitions.length === parts.length &&
      Array.isArray(raw.groupStability) &&
      raw.groupStability.length === parts.length &&
      Array.isArray(assessment?.questions) &&
      assessment.questions.length === parts.length &&
      assessment.declaredQuestionCount === parts.length &&
      assessment.questionCount === parts.length &&
      coverage?.declared === parts.length &&
      coverage?.captured === parts.length &&
      coverage.questionCoverageComplete === true &&
      coverage.requiredAnswerCoverageComplete === true &&
      Array.isArray(coverage.missingQuestionOrdinals) &&
      coverage.missingQuestionOrdinals.length === 0 &&
      Array.isArray(coverage.missingRequiredAnswerOrdinals) &&
      coverage.missingRequiredAnswerOrdinals.length === 0 &&
      Array.isArray(raw.inventory) &&
      raw.inventory.length === parts.length &&
      Array.isArray(raw.receipts),
  );
  const groups = new Map(),
    definitions = new Map(),
    groupStability = new Map(),
    sourceReceipts = new Set(),
    seen = new Set();
  if (valid) {
    for (const receipt of raw.receipts) {
      if (
        (receipt?.resource === "authoringAssignmentQuestionGroups.v1" ||
          receipt?.resource ===
            "authoringAssignmentMachineEvaluableQuestions.v1") &&
        typeof receipt.id === "string" &&
        directReceiptSourceValidV1(receipt, receipt.resource, receipt.id)
      )
        sourceReceipts.add(receipt.resource + "/" + receipt.id);
    }
    for (const group of raw.groups) {
      if (!group || typeof group.id !== "string" || groups.has(group.id)) {
        valid = false;
        break;
      }
      groups.set(group.id, group);
    }
    for (const definition of raw.questionDefinitions) {
      if (
        !definition ||
        typeof definition.id !== "string" ||
        definitions.has(definition.id)
      ) {
        valid = false;
        break;
      }
      definitions.set(definition.id, definition);
    }
    for (const fresh of raw.groupStability) {
      if (
        !fresh ||
        typeof fresh.id !== "string" ||
        groupStability.has(fresh.id) ||
        fresh.stable !== true ||
        fresh.group?.id !== fresh.id ||
        !directReceiptSourceValidV1(
          fresh.receipt,
          "authoringAssignmentQuestionGroups.v1",
          fresh.id,
        )
      ) {
        valid = false;
        break;
      }
      groupStability.set(fresh.id, fresh);
    }
    for (let index = 0; valid && index < parts.length; index++) {
      const part = parts[index],
        candidate = candidates[index],
        question = assessment.questions[index];
      const groupId = bound.atomId + "~" + part?.definition?.id,
        group = groups.get(groupId),
        fresh = groupStability.get(groupId),
        definitionId = group?.questions?.[0];
      const definition = definitions.get(definitionId),
        native = definition?.definition?.definition,
        kind = definition?.definition?.typeName;
      const projection = directAssessmentQuestionProjectionV1(definition);
      const correct =
        kind === "mcq"
          ? [native?.correctOption]
          : kind === "checkbox"
            ? native?.correctOptions
            : kind === "textExactMatch" && Array.isArray(native?.options)
              ? native.options.filter(option => option?.isCorrect === true).map(option => option.id)
              : null;
      if (
        part?.typeName !== "storedQuestionGroupPart" ||
        !/^[A-Za-z0-9_-]{22}$/.test(part.definition?.id || "") ||
        seen.has(groupId) ||
        candidate?.id !== groupId ||
        candidate.ordinal !== index + 1 ||
        raw.inventory[index]?.id !== groupId ||
        raw.inventory[index]?.ordinal !== index + 1 ||
        !group ||
        !fresh ||
        !Array.isArray(group.questions) ||
        group.questions.length !== 1 ||
        typeof definitionId !== "string" ||
        !new RegExp("^" + bound.atomId + "~[A-Za-z0-9_-]+@\\d+$").test(
          definitionId,
        ) ||
        !definition ||
        !projection ||
        !sourceReceipts.has(
          "authoringAssignmentQuestionGroups.v1/" + groupId,
        ) ||
        !sourceReceipts.has(
          "authoringAssignmentMachineEvaluableQuestions.v1/" + definitionId,
        ) ||
        question?.id !== String(index + 1) ||
        question.courseraQuestionId !== groupId ||
        question.sourceDefinitionId !== definitionId ||
        question.questionOrdinalObserved !== true ||
        question.textFormat !== projection.textFormat ||
        question.prompt !== projection.prompt ||
        question.feedback !== projection.feedback ||
        question.shuffleOptions !== projection.shuffleOptions ||
        (kind === "checkbox" &&
          question.allowPartialScoring !== projection.allowPartialScoring) ||
        question.answerTextReliable !== true ||
        question.optionTextReliable !== true ||
        question.observationMethod !==
          "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION" ||
        !Array.isArray(correct) ||
        !correct.length ||
        new Set(correct).size !== correct.length ||
        !Array.isArray(native.options) ||
        native.options.length < (kind === "textExactMatch" ? 1 : 2) ||
        native.options.length > 100 ||
        native.options.some(
          (option) => typeof option?.id !== "string" || !option.id,
        ) ||
        !Array.isArray(question.options) ||
        question.options.length !== native.options.length ||
        correct.some(
          (id) => !native.options.some((option) => option?.id === id),
        ) ||
        new Set(native.options.map((option) => option?.id)).size !==
          native.options.length ||
        question.options.some(
          (option, position) =>
            option?.sourceOptionId !== native.options[position]?.id ||
            option?.id !== native.options[position]?.id ||
            option.text !== projection.options[position].text ||
            option.label !== projection.options[position].label ||
            option.feedback !== projection.options[position].feedback ||
            option.correct !== correct.includes(option.sourceOptionId),
        ) ||
        !Array.isArray(question.correctAnswers) ||
        JSON.stringify(question.correctAnswers) !==
          JSON.stringify(
            question.options
              .filter((option) => option.correct)
              .map((option) => option.text),
          ) ||
        (kind === "mcq" &&
          (question.type !== "single-select" ||
            question.rawType !== "mcq" ||
            question.answerKeyEvidence?.method !== "EXACT_CORRECT_OPTION_ID" ||
            question.answerKeyEvidence.correctOption !==
              native.correctOption)) ||
        (kind === "checkbox" &&
          (question.type !== "multiple-select" ||
            question.rawType !== "checkbox" ||
            question.answerKeyEvidence?.method !==
              "EXACT_CORRECT_OPTION_ID_SET" ||
            JSON.stringify(question.answerKeyEvidence.correctOptions) !==
              JSON.stringify(native.correctOptions))) ||
        (kind === "textExactMatch" &&
          (question.type !== "text-entry" ||
            question.rawType !== "textExactMatch" ||
            question.defaultIncorrectFeedback !== projection.defaultIncorrectFeedback ||
            question.options.some(option => option.description !== "" || !Array.isArray(option.aliases) || option.aliases.length !== 0) ||
            question.answerKeyEvidence?.method !== "EXPLICIT_TEXT_EXACT_MATCH_OPTIONS" ||
            JSON.stringify(question.answerKeyEvidence.correctOptionIds) !== JSON.stringify(correct)))
      ) {
        valid = false;
        break;
      }
      try {
        if (
          directCanonicalSourceTextV1(group) !==
          directCanonicalSourceTextV1(fresh.group)
        ) {
          valid = false;
          break;
        }
      } catch (_) {
        valid = false;
        break;
      }
      seen.add(groupId);
    }
  }
  if (evidence)
    payload.directDataEvidence = {
      ...evidence,
      declaredContentParts: Array.isArray(parts) ? parts.length : 0,
      orderedGroupIds: Array.isArray(candidates)
        ? candidates.map((candidate) => candidate.id)
        : [],
      unresolvedAssessmentMediaReferences: metadata.references,
    };
  if (assessment) payload.structuredAssessment = assessment;
  return applyDirectContractV1(
    fp,
    valid ? "COMPLETE_BOUND_DRAFT_ASSESSMENT" : "UNRESOLVED_DIRECT_ASSESSMENT",
    valid,
    valid
      ? []
      : [
          "DIRECT_ASSESSMENT_SOURCE_OR_COVERAGE_INCOMPLETE",
          ...(metadata.reason ? [metadata.reason] : []),
        ],
  );
}

/** Retain settings and source text exactly. Unobserved rubric models and media
 * bodies remain explicit gaps, even when every supported question has a key. */
export function directAssessmentMetadataCoverageV1(
  definition,
  assessment,
  inventory,
) {
  const references = [],
    fail = (reason) => ({ valid: false, reason, references });
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  if (
    !object(definition) ||
    (definition.configuration !== undefined &&
      !object(definition.configuration))
  )
    return fail("DIRECT_ASSESSMENT_METADATA_INCOMPLETE");
  for (const field of ["introduction", "reviewCriteria"]) {
    const source = definition[field];
    if (source === undefined || (Array.isArray(source) && !source.length))
      continue;
    const cml =
      source?.typeName === "cml"
        ? directCmlMediaInventoryV1(source.definition?.value)
        : null;
    if (!cml?.valid) return fail("DIRECT_ASSESSMENT_METADATA_INCOMPLETE");
    references.push(
      ...cml.references.map((reference) => ({ ...reference, field })),
    );
  }
  if (references.length) return fail("DIRECT_ASSESSMENT_MEDIA_UNRESOLVED");
  if (
    definition.assignmentLevelRubrics !== undefined &&
    !Array.isArray(definition.assignmentLevelRubrics)
  )
    return fail("DIRECT_ASSESSMENT_METADATA_INCOMPLETE");
  if (definition.assignmentLevelRubrics?.length)
    return fail("DIRECT_ASSESSMENT_RUBRIC_MODEL_UNSUPPORTED");
  if (
    definition.passingFraction !== undefined &&
    (typeof definition.passingFraction !== "number" ||
      !Number.isFinite(definition.passingFraction) ||
      definition.passingFraction < 0 ||
      definition.passingFraction > 1)
  )
    return fail("DIRECT_ASSESSMENT_METADATA_INCOMPLETE");
  try {
    for (const field of [
      "configuration",
      "introduction",
      "reviewCriteria",
      "passingFraction",
      "assignmentLevelRubrics",
    ]) {
      if (definition[field] === undefined) {
        if (
          assessment?.[field] !== undefined ||
          inventory?.[field] !== undefined
        )
          return fail("DIRECT_ASSESSMENT_METADATA_NOT_RETAINED");
        continue;
      }
      const original = directCanonicalSourceTextV1(definition[field]);
      if (
        original !== directCanonicalSourceTextV1(assessment?.[field]) ||
        original !== directCanonicalSourceTextV1(inventory?.[field])
      )
        return fail("DIRECT_ASSESSMENT_METADATA_NOT_RETAINED");
    }
  } catch (_) {
    return fail("DIRECT_ASSESSMENT_METADATA_NOT_RETAINED");
  }
  return { valid: true, reason: "", references };
}

/** The observed exact-text model declares literal accepted/rejected answers.
 * Preserve every string and correctness flag; do not simulate case folding,
 * trimming, regular expressions, numeric tolerance or learner grading. */
export function directTextExactMatchProjectionV1(element) {
  const native = element?.definition?.definition;
  if (element?.definition?.typeName !== "textExactMatch" || !native ||
      Object.keys(native).some(key => !["prompt", "options", "defaultIncorrectFeedback"].includes(key)) ||
      !Array.isArray(native.options) || native.options.length < 1 || native.options.length > 100)
    return null;
  const read = source => {
    if (source?.typeName !== "cml" || !/^(?:assess|staffGraded)\/1$/.test(source.definition?.dtdId || "")) return null;
    const parsed = directCmlMediaInventoryV1(source.definition?.value);
    return parsed.valid && !parsed.references.length ? parsed.text : null;
  };
  const prompt = read(native.prompt), defaultIncorrectFeedback = read(native.defaultIncorrectFeedback);
  if (!prompt || defaultIncorrectFeedback == null) return null;
  const ids = new Set(), answers = new Set(), options = [];
  for (const source of native.options) {
    const feedback = read(source?.feedback);
    if (!source || Object.keys(source).some(key => !["id", "answer", "isCorrect", "feedback"].includes(key)) ||
        typeof source.id !== "string" || !source.id || ids.has(source.id) ||
        typeof source.answer !== "string" || !source.answer || source.answer.length > 100000 ||
        answers.has(source.answer) || typeof source.isCorrect !== "boolean" || feedback == null)
      return null;
    ids.add(source.id); answers.add(source.answer);
    options.push({id: source.id, sourceOptionId: source.id, text: source.answer, label: source.answer,
      description: "", aliases: [], correct: source.isCorrect, feedback});
  }
  const correctAnswers = options.filter(option => option.correct).map(option => option.text);
  if (!correctAnswers.length) return null;
  return {textFormat: "PLAIN_TEXT", prompt, options, correctAnswers, feedback: "",
    defaultIncorrectFeedback, shuffleOptions: null};
}

/** Derive learner text from the native definition without HTML interpretation.
 * No media URL can substitute for the body of an assessment image/attachment. */
export function directAssessmentQuestionProjectionV1(element) {
  const kind = element?.definition?.typeName,
    native = element?.definition?.definition;
  if (kind === "textExactMatch") return directTextExactMatchProjectionV1(element);
  if (/^(?:mcqReflect|checkboxReflect)$/.test(kind || "")) return directReflectionQuestionProjectionV1(element);
  if (
    !/^(?:mcq|checkbox)$/.test(kind || "") ||
    !Array.isArray(native?.options) ||
    native.options.length < 2 ||
    native.options.length > 100
  )
    return null;
  const read = (source, required = true) => {
    const cml =
      source?.typeName === "cml"
        ? directCmlMediaInventoryV1(source.definition?.value)
        : null;
    return cml?.valid && !cml.references.length && (!required || cml.text)
      ? cml.text
      : null;
  };
  const prompt = read(native.prompt),
    correct = kind === "mcq" ? [native.correctOption] : native.correctOptions;
  if (
    prompt == null ||
    !Array.isArray(correct) ||
    !correct.length ||
    correct.some((id) => typeof id !== "string" || !id) ||
    new Set(correct).size !== correct.length
  )
    return null;
  const ids = new Set(),
    options = [];
  for (const option of native.options) {
    const text = read(option?.display),
      feedback = option?.feedback == null ? "" : read(option.feedback, false);
    if (
      typeof option?.id !== "string" ||
      !option.id ||
      ids.has(option.id) ||
      text == null ||
      feedback == null
    )
      return null;
    ids.add(option.id);
    options.push({
      id: option.id,
      sourceOptionId: option.id,
      text,
      label: text,
      description: "",
      aliases: [],
      correct: correct.includes(option.id),
      feedback,
    });
  }
  if (correct.some((id) => !ids.has(id))) return null;
  return {
    textFormat: "PLAIN_TEXT",
    prompt,
    options,
    correctAnswers: options
      .filter((option) => option.correct)
      .map((option) => option.text),
    feedback: "",
    shuffleOptions:
      typeof native.shuffleOptions === "boolean" ? native.shuffleOptions : null,
    ...(kind === "checkbox"
      ? {
          allowPartialScoring:
            typeof native.allowPartialScoring === "boolean"
              ? native.allowPartialScoring
              : null,
        }
      : {}),
  };
}

export function directEmptyStructureContractV1(fp, bound, rawNode) {
  const sources = fp.payload?.directDataSources,
    receipt = sources?.receipts?.materials,
    stable = sources?.receipts?.stability;
  const materials = sources?.materials,
    ancestors = materials?.ancestorIds;
  const module =
    Array.isArray(ancestors) &&
    ancestors.length === 0 &&
    typeof rawNode?.description === "string" &&
    Array.isArray(rawNode?.learningObjectives) &&
    Object.prototype.hasOwnProperty.call(rawNode, "timeCommitment");
  const lesson =
    Array.isArray(ancestors) &&
    ancestors.length === 1 &&
    typeof rawNode?.trackId === "string" &&
    rawNode.trackId;
  const valid = Boolean(
    bound?.courseId &&
      bound.stableSource === true &&
      materials?.rootCourseId === bound.courseId &&
      rawNode?.id === fp.id &&
      materials.leaf?.id === fp.id &&
      JSON.stringify(materials.leaf) === JSON.stringify(rawNode) &&
      Array.isArray(rawNode.elements) &&
      rawNode.elements.length === 0 &&
      !Object.prototype.hasOwnProperty.call(rawNode, "content") &&
      (module || lesson) &&
      directReceiptSourceValidV1(
        receipt,
        "authoringCourseMaterials.v1",
        bound.courseId,
      ) &&
      stable?.stable === true,
  );
  if (valid)
    fp.payload.directDataEvidence = {
      method: "BOUND_AUTHORING_DRAFT_API",
      courseId: bound.courseId,
      itemId: fp.id,
      sourceState: "AUTHORING_DRAFT",
      stableSource: true,
      structural: true,
      noContent: true,
      childCount: 0,
    };
  return applyDirectContractV1(
    fp,
    valid ? "COMPLETE_EMPTY_STRUCTURE" : "UNRESOLVED_DIRECT_STRUCTURE",
    valid,
    valid ? [] : ["DIRECT_EMPTY_STRUCTURE_NOT_ESTABLISHED"],
  );
}

/** A finder receipt binds its exact selectors; it is not an ID-path resource. */
export function directWidgetProviderReceiptValidV1(receipt, binding) {
  if (
    !binding || typeof binding.providerId !== "string" ||
    typeof binding.courseId !== "string" ||
    receipt?.resource !== "authoringWidgetSessionProviders.v1" ||
    receipt.id !== binding.providerId ||
    receipt.status !== 200 ||
    receipt.requestPath !== "/api/authoringWidgetSessionProviders.v1/" ||
    receipt.bodyFormat !== "PARSED_SANITIZED_JSON_MODEL" ||
    !/^[a-f0-9]{64}$/.test(receipt.originalResponseSha256 || "") ||
    receipt.sha256 !== receipt.originalResponseSha256 ||
    !Array.isArray(receipt.requestQuery) ||
    receipt.requestQuery.length !== 5
  )
    return false;
  const expected = {
    q: "getWithCourseId",
    widgetSessionProviderId: binding.providerId,
    courseId: binding.courseId,
    fields: CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1,
    includes: CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1,
  };
  const seen = new Set();
  for (const pair of receipt.requestQuery) {
    if (
      !Array.isArray(pair) || pair.length !== 2 ||
      typeof pair[0] !== "string" || typeof pair[1] !== "string" ||
      !Object.prototype.hasOwnProperty.call(expected, pair[0]) ||
      seen.has(pair[0]) || expected[pair[0]] !== pair[1]
    )
      return false;
    seen.add(pair[0]);
  }
  return seen.size === 5;
}

/** Configuration source coverage is separate from the external widget body. */
export function directWidgetEvidenceValidV1(fp, bound) {
  if (!directSourceBindingEvidenceV1(fp, bound)) return false;
  const raw = fp?.payload?.directWidgetProviderEvidence;
  try {
    const binding = directDraftWidgetProviderV1(bound);
    if (
      raw?.method !== "BOUND_AUTHORING_WIDGET_PROVIDER" ||
      raw.providerId !== binding.providerId || raw.courseId !== binding.courseId ||
      raw.itemId !== binding.itemId || raw.atomId !== binding.atomId ||
      raw.sourceState !== "AUTHORING_DRAFT" || raw.stableSource !== true ||
      raw.bodyVerified !== false || raw.playbackVerified !== false ||
      raw.launchVerified !== false || raw.wholeWidgetVerified !== false ||
      raw.binaryContentVerified === true || raw.externalBodyVerified === true ||
      !/^[a-f0-9]{64}$/.test(raw.initial?.sourceHash || "") ||
      raw.initial.sourceHash !== raw.final?.sourceHash ||
      !directWidgetProviderReceiptValidV1(raw.initial.receipt, binding) ||
      !directWidgetProviderReceiptValidV1(raw.final.receipt, binding)
    )
      return false;
    const initial = directWidgetProviderSourceV1(bound, raw.initial.model),
      final = directWidgetProviderSourceV1(bound, raw.final.model);
    return (
      directCanonicalSourceTextV1(initial) === directCanonicalSourceTextV1(final) &&
      directCanonicalSourceTextV1(raw.targets) ===
        directCanonicalSourceTextV1(directWidgetProviderTargetsV1(bound, raw.initial.model))
    );
  } catch (_) {
    return false;
  }
}

/** Read only the current, identity-bound CML. Native widget instances are not
 * linked-summary templates; their exact positive version selector is retained. */
export function directInlineWidgetBindingsV1(fp, bound) {
  const sources = fp?.payload?.directDataSources,
    current = bindDirectAuthoringDraftV1(fp, bound?.courseId, bound?.courseSlug,
      sources?.atom, sources?.relation),
    contentType = current.draft.content.typeName;
  if (bound.sourceState !== "AUTHORING_DRAFT" ||
      directCanonicalSourceTextV1(current.draft) !== directCanonicalSourceTextV1(bound.draft) ||
      current.storedAtomVersion !== bound.storedAtomVersion || current.updatedAt !== bound.updatedAt ||
      !(contentType === "supplementDraft" && fp.typeName === "supplement" ||
        contentType === "discussionPromptDraft" && fp.typeName === "discussionPrompt"))
    throw Error("DIRECT_INLINE_WIDGET_SOURCE_BINDING_FAILED");
  const source = contentType === "supplementDraft"
      ? directDraftReadingSourceV1(current) : directDraftDiscussionSourceV1(current),
    inventory = directCmlMediaInventoryV1(source.cml),
    bindings = new Map();
  if (!inventory.valid) throw Error("DIRECT_INLINE_WIDGET_CML_UNSUPPORTED");
  const references = inventory.references.filter(reference => reference.tag === "widget");
  if (references.length > 32) throw Error("DIRECT_INLINE_WIDGET_REFERENCE_LIMIT");
  for (const reference of references) {
    const match = /^([A-Za-z0-9_-]{22})@([1-9]\d{0,11})$/.exec(reference.id || "");
    // Unknown or missing selectors remain native CML gaps, never guessed IDs.
    if (!match) continue;
    const prior = bindings.get(reference.id);
    if (prior) { prior.occurrences++; continue; }
    bindings.set(reference.id, {providerId: reference.id, providerBaseId: match[1],
      requestedVersion: match[2], courseId: current.courseId, itemId: current.itemId,
      atomId: current.atomId, sourceState: "AUTHORING_DRAFT", occurrences: 1});
  }
  return [...bindings.values()];
}

/** Independent configuration proof uses a caller-supplied synchronous model
 * hash so browser/import consumers recompute, rather than trust, saved hashes.
 * Incomplete providers remain separate; no page/runtime completeness is inferred. */
export function directInlineWidgetEvidenceV1(fp, bound, hashValue) {
  try {
    const observedDate = value => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    if (typeof hashValue !== "function" || !directSourceBindingEvidenceV1(fp, bound)) return null;
    const bindings = directInlineWidgetBindingsV1(fp, bound),
      raw = fp.payload.directInlineWidgetProviderEvidence,
      stable = fp.payload.directDataSources.receipts.stability;
    if (!bindings.length || raw?.method !== "BOUND_INLINE_CML_WIDGET_PROVIDERS" ||
        raw.courseId !== bound.courseId || raw.itemId !== bound.itemId || raw.atomId !== bound.atomId ||
        raw.sourceState !== "AUTHORING_DRAFT" ||
        raw.bodyVerified !== false || raw.playbackVerified !== false ||
        raw.launchVerified !== false || raw.wholeWidgetVerified !== false ||
        raw.binaryContentVerified === true || raw.externalBodyVerified === true ||
        !Array.isArray(raw.providers) || raw.providers.length !== bindings.length ||
        !Array.isArray(raw.failures) || raw.failures.length > 64 ||
        hashValue(bound.draft) !== stable.draftHash ||
        !observedDate(stable.receipt?.observedAt))
      return null;
    const providers = [], failures = [], seen = new Set();
    for (const proof of raw.providers) {
      const binding = bindings.find(value => value.providerId === proof?.providerId);
      if (!binding || seen.has(binding.providerId)) return null;
      seen.add(binding.providerId);
      if (Object.keys(binding).some(key => proof[key] !== binding[key]) ||
          proof.bodyVerified !== false || proof.playbackVerified !== false ||
          proof.launchVerified !== false || proof.wholeWidgetVerified !== false ||
          proof.binaryContentVerified === true || proof.externalBodyVerified === true ||
          !Array.isArray(proof.failures) || proof.failures.length > 32)
        return null;
      if (proof.stableSource !== true || proof.failures.length || !proof.initial || !proof.final) {
        failures.push({providerId: binding.providerId, reason: "DIRECT_INLINE_WIDGET_PROVIDER_INCOMPLETE"});
        continue;
      }
      const initial = proof.initial, final = proof.final;
      if (![initial, final].every(observation =>
          directWidgetProviderReceiptValidV1(observation.receipt, binding) &&
          observedDate(observation.receipt.observedAt) &&
          /^[a-f0-9]{64}$/.test(observation.modelHash || "") &&
          /^[a-f0-9]{64}$/.test(observation.sourceHash || "")) ||
          Date.parse(final.receipt.observedAt) < Date.parse(initial.receipt.observedAt) ||
          Date.parse(final.receipt.observedAt) > Date.parse(stable.receipt.observedAt))
        return null;
      const sourceInitial = directInlineWidgetProviderSourceV1(binding, initial.model),
        sourceFinal = directInlineWidgetProviderSourceV1(binding, final.model),
        targets = directInlineWidgetProviderTargetsV1(binding, initial.model);
      if (initial.modelHash !== hashValue(initial.model) || final.modelHash !== hashValue(final.model) ||
          initial.modelHash !== final.modelHash || initial.sourceHash !== hashValue(sourceInitial) ||
          final.sourceHash !== hashValue(sourceFinal) || initial.sourceHash !== final.sourceHash ||
          directCanonicalSourceTextV1(initial.model) !== directCanonicalSourceTextV1(final.model) ||
          directCanonicalSourceTextV1(sourceInitial) !== directCanonicalSourceTextV1(sourceFinal) ||
          directCanonicalSourceTextV1(proof.targets) !== directCanonicalSourceTextV1(targets))
        return null;
      providers.push({binding, initial, final, targets, sourceInitial, sourceFinal});
    }
    return {bindings, providers, failures};
  } catch (_) { return null; }
}

export function directWidgetContractV1(fp, bound) {
  const evidence = directSourceBindingEvidenceV1(fp, bound);
  if (evidence) fp.payload.directDataEvidence = evidence;
  const valid = directWidgetEvidenceValidV1(fp, bound),
    contract = applyDirectContractV1(
      fp, "ACCOUNTED_EXTERNAL_TARGET_ONLY", false,
      [valid ? "DIRECT_WIDGET_EXTERNAL_BODY_NOT_OBSERVED" : "DIRECT_WIDGET_PROVIDER_SOURCE_INVALID"],
      false,
    );
  contract.sourceConfigurationVerified = valid;
  return contract;
}

export function directUnsupportedContractV1(fp, reason, bound) {
  const evidence = directSourceBindingEvidenceV1(fp, bound);
  if (evidence) fp.payload.directDataEvidence = evidence;
  const widget = /widget|plugin|lti/i.test(
    String(fp.typeName || fp.type || ""),
  );
  return applyDirectContractV1(
    fp,
    widget ? "ACCOUNTED_EXTERNAL_TARGET_ONLY" : "UNRESOLVED_DIRECT_TYPE",
    false,
    [String(reason || "DIRECT_DRAFT_TYPE_UNSUPPORTED")],
    widget ? false : null,
  );
}

export function parseCourseraCheckboxDefinitionDirectV1(element, candidate) {
  const wrapper = element && element.definition,
    definition = wrapper && wrapper.definition;
  if (
    !element ||
    !/^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+@\d+$/.test(element.id || "") ||
    !candidate ||
    !Number.isSafeInteger(candidate.ordinal) ||
    candidate.ordinal < 1 ||
    wrapper?.typeName !== "checkbox" ||
    !Array.isArray(definition?.options) ||
    definition.options.length < 2 ||
    definition.options.length > 100 ||
    !Array.isArray(definition.correctOptions) ||
    !definition.correctOptions.length ||
    new Set(definition.correctOptions).size !== definition.correctOptions.length
  )
    return null;
  const read = (value) =>
    value?.typeName === "cml" && typeof value.definition?.value === "string"
      ? directCmlTextV1(value.definition.value)
      : null;
  const prompt = read(definition.prompt);
  if (!prompt?.text || prompt.references.length) return null;
  const options = [],
    ids = new Set();
  for (const option of definition.options) {
    const display = read(option?.display),
      feedback =
        option?.feedback == null
          ? { text: "", references: [] }
          : read(option.feedback);
    if (
      typeof option?.id !== "string" ||
      !option.id ||
      ids.has(option.id) ||
      !display?.text ||
      !feedback ||
      display.references.length ||
      feedback.references.length
    )
      return null;
    ids.add(option.id);
    options.push({
      id: option.id,
      sourceOptionId: option.id,
      text: display.text,
      label: display.text,
      description: "",
      aliases: [],
      correct: definition.correctOptions.includes(option.id),
      feedback: feedback.text,
    });
  }
  if (definition.correctOptions.some((id) => !ids.has(id))) return null;
  return {
    textFormat: "PLAIN_TEXT",
    id: String(candidate.ordinal),
    courseraQuestionId: candidate.id,
    sourceDefinitionId: element.id,
    questionOrdinalObserved: true,
    type: "multiple-select",
    rawType: "checkbox",
    prompt: prompt.text,
    options,
    correctAnswers: options
      .filter((option) => option.correct)
      .map((option) => option.text),
    feedback: "",
    points: null,
    optionTextReliable: true,
    answerTextReliable: true,
    answerKeyEvidence: {
      method: "EXACT_CORRECT_OPTION_ID_SET",
      correctOptions: [...definition.correctOptions],
    },
    shuffleOptions:
      typeof definition.shuffleOptions === "boolean"
        ? definition.shuffleOptions
        : null,
    allowPartialScoring:
      typeof definition.allowPartialScoring === "boolean"
        ? definition.allowPartialScoring
        : null,
    observationMethod: "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION",
    observedAtMs: Date.now(),
    parserConfidence: 0.98,
  };
}

/** Exact native IDs and literal source keys establish this projection. The
 * independent draft/group/source stability contracts still decide coverage. */
export function directQuestionIdentityV1(element, candidate) {
  return /^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+@\d+$/.test(element?.id || "") &&
    /^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+$/.test(candidate?.id || "") &&
    element.id.split("~")[0] === candidate.id.split("~")[0] &&
    Number.isSafeInteger(candidate.ordinal) && candidate.ordinal >= 1;
}

export function parseCourseraTextExactMatchDefinitionDirectV1(element, candidate) {
  const projection = directTextExactMatchProjectionV1(element);
  if (!projection || !directQuestionIdentityV1(element, candidate)) return null;
  return {...projection, id: String(candidate.ordinal), courseraQuestionId: candidate.id,
    sourceDefinitionId: element.id, questionOrdinalObserved: true, type: "text-entry", rawType: "textExactMatch",
    points: null, optionTextReliable: true, answerTextReliable: true,
    answerKeyEvidence: {method: "EXPLICIT_TEXT_EXACT_MATCH_OPTIONS",
      correctOptionIds: projection.options.filter(option => option.correct).map(option => option.sourceOptionId)},
    observationMethod: "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION", observedAtMs: Date.now(), parserConfidence: 0.98};
}

/** Original authored instruction blocks are content parts, not questions or an
 * empty assessment. Their source order and original CML remain explicit. */
export function directInstructionBlocksProjectionV1(parts) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 100) return null;
  const blocks = [], ids = new Set(); let characters = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index], source = part?.definition, body = source?.body;
    if (part?.typeName !== "storedTextBlockPart" ||
        Object.keys(part).some(key => !["typeName", "definition"].includes(key)) ||
        !source || Object.keys(source).some(key => !["id", "title", "body"].includes(key)) ||
        typeof source.id !== "string" || !/^textBlock~[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(source.id) ||
        ids.has(source.id) || typeof source.title !== "string" || body?.typeName !== "cml" ||
        !/^(?:assess|staffGraded)\/1$/.test(body.definition?.dtdId || "") || typeof body.definition.value !== "string") return null;
    characters += source.title.length + body.definition.value.length;
    if (characters > 4000000) return null;
    const parsed = directCmlMediaInventoryV1(body.definition.value, 2);
    if (!parsed.valid || parsed.references.length) return null;
    ids.add(source.id);
    blocks.push({ordinal: index + 1, nativeId: source.id, nativeType: part.typeName,
      title: source.title, rawCML: body, text: parsed.text, textProjectionVersion: 2,
      rawCmlLength: body.definition.value.length});
  }
  return blocks;
}

export async function directInstructionAssessmentModelV1(inventory) {
  const blocks = inventory?.instructionOnly === true && inventory.complete === true &&
    directInstructionBlocksProjectionV1(inventory.rawParts);
  if (!blocks) throw Error("DIRECT_INSTRUCTION_SOURCE_UNSUPPORTED");
  for (const block of blocks) {
    block.sourcePartSha256 = await sha256(directCanonicalSourceTextV1(inventory.rawParts[block.ordinal - 1]));
    block.originalCmlSha256 = await sha256(block.rawCML.definition.value);
    block.textSha256 = await sha256(block.text);
    if (![block.sourcePartSha256, block.originalCmlSha256, block.textSha256].every(value => /^[a-f0-9]{64}$/.test(value || "")))
      throw Error("DIRECT_INSTRUCTION_HASH_UNAVAILABLE");
  }
  const text = blocks.map(block => [block.title, block.text].filter(Boolean).join("\n\n")).join("\n\n");
  return {schemaVersion: 6, parser: "coursera-bound-authoring-draft-instruction-api-v1", origin: "coursera-authoring-api",
    declaredQuestionCount: 0, questionCount: 0, answerEvidenceQuestionCount: 0, questions: [], contentBlocks: blocks,
    instructionTextSha256: await sha256(text), captureCompleteness: {declared: 0, declaredContentParts: blocks.length,
      nonQuestionPartOrdinals: blocks.map(block => block.ordinal), captured: 0, capturedContentParts: blocks.length,
      questionCoverageComplete: true, answerCoverageComplete: true, requiredAnswerCoverageComplete: true,
      missingQuestionOrdinals: [], missingRequiredAnswerOrdinals: [], sourceEmpty: false,
      answerKeyApplicability: "NOT_APPLICABLE_NON_QUESTION_CONTENT", stopReason: "EXACT_AUTHORING_DRAFT_INSTRUCTION_PARTS"},
    configuration: inventory.configuration, introduction: inventory.introduction, reviewCriteria: inventory.reviewCriteria,
    passingFraction: inventory.passingFraction, assignmentLevelRubrics: inventory.assignmentLevelRubrics, warnings: []};
}

export function directInstructionAssessmentContractV1(fp, assessment, inventory, bound) {
  const payload = fp.payload || (fp.payload = {}), evidence = directSourceBindingEvidenceV1(fp, bound),
    definition = bound?.draft?.content?.definition, parts = definition?.parts,
    projected = directInstructionBlocksProjectionV1(parts), blocks = assessment?.contentBlocks,
    raw = payload.assessmentApiEvidence, coverage = assessment?.captureCompleteness,
    metadata = directAssessmentMetadataCoverageV1(definition, assessment, inventory),
    empty = value => Array.isArray(value) && value.length === 0,
    same = (left, right) => { try { return directCanonicalSourceTextV1(left) === directCanonicalSourceTextV1(right); } catch (_) { return false; } };
  const valid = Boolean(evidence && fp.typeName === "ungradedAssignment" && definition?.configuration?.isGraded === false &&
    Object.keys(definition).every(key => ["parts", "configuration", "introduction", "reviewCriteria", "passingFraction", "assignmentLevelRubrics"].includes(key)) &&
    projected && metadata.valid && inventory?.complete === true && inventory.instructionOnly === true &&
    inventory.reason === "EXACT_AUTHORING_DRAFT_INSTRUCTION_PARTS" && inventory.assignmentId === bound.atomId &&
    inventory.declared === 0 && inventory.declaredContentParts === parts.length &&
    same(inventory.rawParts, parts) && same(inventory.nonQuestionPartOrdinals, projected.map(block => block.ordinal)) &&
    empty(inventory.candidates) && empty(inventory.unsupportedParts) &&
    raw?.method === "BOUND_AUTHORING_DRAFT_API" && raw.courseId === bound.courseId && raw.itemId === fp.id && raw.assignmentId === bound.atomId &&
    same(raw.rawParts, parts) && ["inventory", "unsupportedParts", "groups", "questionDefinitions", "receipts", "groupStability", "failures"].every(key => empty(raw[key])) &&
    assessment?.declaredQuestionCount === 0 && assessment.questionCount === 0 && assessment.answerEvidenceQuestionCount === 0 && empty(assessment.questions) &&
    Array.isArray(blocks) && blocks.length === parts.length && blocks.every((block, index) =>
      ["ordinal", "nativeId", "nativeType", "title", "rawCML", "text", "textProjectionVersion", "rawCmlLength"].every(key => same(block[key], projected[index][key])) &&
      [block.sourcePartSha256, block.originalCmlSha256, block.textSha256].every(value => /^[a-f0-9]{64}$/.test(value || ""))) &&
    /^[a-f0-9]{64}$/.test(assessment.instructionTextSha256 || "") && coverage?.declared === 0 &&
    coverage.declaredContentParts === parts.length && coverage.captured === 0 && coverage.capturedContentParts === parts.length &&
    same(coverage.nonQuestionPartOrdinals, projected.map(block => block.ordinal)) && coverage.questionCoverageComplete === true &&
    coverage.requiredAnswerCoverageComplete === true && coverage.answerCoverageComplete === true &&
    coverage.sourceEmpty === false && coverage.answerKeyApplicability === "NOT_APPLICABLE_NON_QUESTION_CONTENT" &&
    empty(coverage.missingQuestionOrdinals) && empty(coverage.missingRequiredAnswerOrdinals));
  if (evidence) payload.directDataEvidence = {...evidence, declaredContentParts: Array.isArray(parts) ? parts.length : 0,
    orderedGroupIds: [], sourceEmpty: false, instructionOnly: valid, nonQuestionPartOrdinals: projected?.map(block => block.ordinal) || []};
  if (assessment) payload.structuredAssessment = assessment;
  if (valid) {
    payload.textSample = blocks.map(block => [block.title, block.text].filter(Boolean).join("\n\n")).join("\n\n");
    payload.textLength = payload.textSample.length; payload.textSha256 = assessment.instructionTextSha256;
    payload.textScopeKind = "bound-authoring-draft-instruction-parts"; payload.textCaptureTruncated = false;
    payload.directInstructionAssessmentEvidence = {method: "BOUND_AUTHORING_DRAFT_INSTRUCTION_PARTS", courseId: bound.courseId,
      itemId: fp.id, atomId: bound.atomId, sourceDraftSha256: evidence.draftHash, sourceEmpty: false,
      contentParts: blocks.length, questionCount: 0, answerKeyApplicable: false};
  }
  return applyDirectContractV1(fp, valid ? "COMPLETE_BOUND_DRAFT_INSTRUCTION_ASSESSMENT" : "UNRESOLVED_DIRECT_ASSESSMENT", valid,
    valid ? [] : ["DIRECT_INSTRUCTION_ASSESSMENT_SOURCE_OR_COVERAGE_INCOMPLETE", ...(metadata.reason ? [metadata.reason] : [])]);
}

/** A native reflection offers choices without declaring any answer key. Null
 * correctness means not applicable; it must never become false or an answer. */
export function directReflectionQuestionProjectionV1(element) {
  const kind = element?.definition?.typeName, native = element?.definition?.definition;
  if (!/^(?:mcqReflect|checkboxReflect)$/.test(kind || "") || !native ||
      Object.keys(native).some(key => !["prompt", "options", "shuffleOptions", "noChosenFeedback"].includes(key)) ||
      typeof native.shuffleOptions !== "boolean" || !Array.isArray(native.options) || native.options.length < 2 || native.options.length > 100) return null;
  const read = source => {
    if (source?.typeName !== "cml" || !/^(?:assess|staffGraded)\/1$/.test(source.definition?.dtdId || "")) return null;
    const parsed = directCmlMediaInventoryV1(source.definition?.value);
    return parsed.valid && !parsed.references.length ? parsed.text : null;
  };
  const prompt = read(native.prompt), noChosenFeedback = native.noChosenFeedback === undefined ? null : read(native.noChosenFeedback);
  if (!prompt || (native.noChosenFeedback !== undefined && noChosenFeedback == null)) return null;
  const ids = new Set(), options = [];
  for (const source of native.options) {
    const text = read(source?.display), feedback = read(source?.feedback);
    if (!source || Object.keys(source).some(key => !["id", "display", "feedback"].includes(key)) ||
        typeof source.id !== "string" || !source.id || ids.has(source.id) || !text || feedback == null) return null;
    ids.add(source.id); options.push({id: source.id, sourceOptionId: source.id, text, label: text,
      description: "", aliases: [], correct: null, feedback});
  }
  return {textFormat: "PLAIN_TEXT", prompt, options, correctAnswers: [], feedback: "", shuffleOptions: native.shuffleOptions,
    noChosenFeedback, noChosenFeedbackStatus: native.noChosenFeedback === undefined ? "ABSENT" : noChosenFeedback === "" ? "EXPLICIT_EMPTY" : "PRESENT"};
}

export function parseCourseraReflectionDefinitionDirectV1(element, candidate) {
  const projection = directReflectionQuestionProjectionV1(element), kind = element?.definition?.typeName;
  if (!projection || !directQuestionIdentityV1(element, candidate)) return null;
  return {...projection, id: String(candidate.ordinal), courseraQuestionId: candidate.id, sourceDefinitionId: element.id,
    questionOrdinalObserved: true, type: kind === "mcqReflect" ? "reflection-single-select" : "reflection-multiple-select", rawType: kind,
    points: null, optionTextReliable: true, answerTextReliable: false, answerKeyApplicable: false,
    answerKeyEvidence: {method: "NATIVE_REFLECTION_NO_KEY", applicable: false, nativeType: kind},
    observationMethod: "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION", observedAtMs: Date.now(), parserConfidence: 0.98};
}

export function directReflectionAssessmentContractV1(fp, assessment, inventory, bound) {
  const payload = fp.payload || (fp.payload = {}), evidence = directSourceBindingEvidenceV1(fp, bound),
    definition = bound?.draft?.content?.definition, parts = definition?.parts, raw = payload.assessmentApiEvidence,
    metadata = directAssessmentMetadataCoverageV1(definition, assessment, inventory),
    empty = value => Array.isArray(value) && value.length === 0,
    same = (left, right) => { try { return directCanonicalSourceTextV1(left) === directCanonicalSourceTextV1(right); } catch (_) { return false; } };
  let valid = Boolean(evidence && fp.typeName === "ungradedAssignment" && definition?.configuration?.isGraded === false && metadata.valid &&
    Array.isArray(parts) && parts.length > 0 && inventory?.complete === true && inventory.assignmentId === bound.atomId &&
    inventory.declared === parts.length && inventory.declaredContentParts === parts.length && empty(inventory.unsupportedParts) &&
    same(inventory.rawParts, parts) && Array.isArray(inventory.candidates) && inventory.candidates.length === parts.length &&
    raw?.method === "BOUND_AUTHORING_DRAFT_API" && raw.courseId === bound.courseId && raw.itemId === fp.id && raw.assignmentId === bound.atomId &&
    same(raw.rawParts, parts) && empty(raw.unsupportedParts) && empty(raw.failures) && Array.isArray(raw.receipts) &&
    [raw.groups, raw.groupStability, raw.questionDefinitions, raw.inventory, assessment?.questions].every(values => Array.isArray(values) && values.length === parts.length) &&
    assessment.declaredQuestionCount === parts.length && assessment.questionCount === parts.length && assessment.answerEvidenceQuestionCount === 0);
  const index = values => {
    if (!Array.isArray(values)) return null;
    const map = new Map(); for (const value of values) {
      if (typeof value?.id !== "string" || map.has(value.id)) return null; map.set(value.id, value);
    } return map;
  }, groups = index(raw?.groups), stable = index(raw?.groupStability), definitions = index(raw?.questionDefinitions), seen = new Set();
  valid &&= Boolean(groups && stable && definitions);
  for (let position = 0; valid && position < parts.length; position++) {
    const part = parts[position], groupId = bound.atomId + "~" + part?.definition?.id,
      group = groups.get(groupId), fresh = stable.get(groupId), sourceId = group?.questions?.[0], original = definitions.get(sourceId),
      projection = directReflectionQuestionProjectionV1(original), q = assessment.questions[position], kind = original?.definition?.typeName;
    const receipt = (resource, id) => raw.receipts.some(value => directReceiptSourceValidV1(value, resource, id));
    valid = Boolean(part?.typeName === "storedQuestionGroupPart" && /^[A-Za-z0-9_-]{22}$/.test(part.definition?.id || "") && !seen.has(groupId) &&
      inventory.candidates[position]?.id === groupId && inventory.candidates[position]?.ordinal === position + 1 &&
      raw.inventory[position]?.id === groupId && raw.inventory[position]?.ordinal === position + 1 &&
      group?.id === groupId && Array.isArray(group.questions) && group.questions.length === 1 &&
      typeof sourceId === "string" && new RegExp("^" + bound.atomId + "~[A-Za-z0-9_-]+@\\d+$").test(sourceId) &&
      original?.id === sourceId && projection && fresh?.stable === true && same(group, fresh.group) &&
      directReceiptSourceValidV1(fresh.receipt, "authoringAssignmentQuestionGroups.v1", groupId) &&
      receipt("authoringAssignmentQuestionGroups.v1", groupId) && receipt("authoringAssignmentMachineEvaluableQuestions.v1", sourceId) &&
      q?.id === String(position + 1) && q.courseraQuestionId === groupId && q.sourceDefinitionId === sourceId && q.questionOrdinalObserved === true &&
      q.rawType === kind && q.type === (kind === "mcqReflect" ? "reflection-single-select" : "reflection-multiple-select") &&
      q.observationMethod === "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION" && q.optionTextReliable === true && q.answerTextReliable === false &&
      q.answerKeyApplicable === false && q.answerKeyEvidence?.method === "NATIVE_REFLECTION_NO_KEY" &&
      q.answerKeyEvidence.applicable === false && q.answerKeyEvidence.nativeType === kind &&
      ["textFormat", "prompt", "options", "correctAnswers", "feedback", "shuffleOptions", "noChosenFeedback", "noChosenFeedbackStatus"].every(key => same(q[key], projection[key])));
    seen.add(groupId);
  }
  if (evidence) payload.directDataEvidence = {...evidence, declaredContentParts: Array.isArray(parts) ? parts.length : 0,
    orderedGroupIds: inventory?.candidates?.map(candidate => candidate.id) || [],
    answerKeyApplicability: valid ? "NOT_APPLICABLE_UNKEYED_NATIVE_REFLECTION" : "UNVERIFIED"};
  if (assessment) payload.structuredAssessment = assessment;
  if (valid) {
    assessment.captureCompleteness = {declared: parts.length, declaredContentParts: parts.length, captured: parts.length,
      questionCoverageComplete: true, answerCoverageComplete: false, requiredAnswerCoverageComplete: true,
      missingQuestionOrdinals: [], missingRequiredAnswerOrdinals: [], answerKeyNotApplicableQuestionOrdinals: parts.map((_, index) => index + 1),
      answerKeyApplicability: "NOT_APPLICABLE_UNKEYED_NATIVE_REFLECTION", stopReason: "BOUND_NATIVE_UNGRADED_REFLECTION_DEFINITIONS"};
    payload.directReflectionAssessmentEvidence = {method: "BOUND_NATIVE_UNGRADED_REFLECTION_DEFINITIONS", courseId: bound.courseId,
      itemId: fp.id, atomId: bound.atomId, sourceDraftSha256: evidence.draftHash, questionCount: parts.length, answerKeyApplicable: false};
  }
  return applyDirectContractV1(fp, valid ? "COMPLETE_BOUND_DRAFT_REFLECTION_ASSESSMENT" : "UNRESOLVED_DIRECT_ASSESSMENT", valid,
    valid ? [] : ["DIRECT_REFLECTION_ASSESSMENT_SOURCE_OR_COVERAGE_INCOMPLETE", ...(metadata.reason ? [metadata.reason] : [])]);
}
