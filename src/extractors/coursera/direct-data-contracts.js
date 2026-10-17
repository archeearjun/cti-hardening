import { sha256 } from "./text-and-dom.js";
import { directCanonicalSourceTextV1 } from "./direct-data-canonical.js";
import {
  directCmlMediaInventoryV1,
  directMediaEvidenceStructureV1,
} from "./direct-data-media-contracts.js";
import { directAssetMetadataBindingV1 } from "./direct-data-media.js";
import {
  CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1,
  CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1,
  directDraftWidgetProviderV1,
  directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1,
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
  const unresolved = mediaVerified ? [] : parsed.references;
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
    return {
      url: binding?.canonicalUrl || reference.url,
      assetId: reference.id,
      name: binding?.name || reference.name || "",
      referenceName: reference.name || "",
      tag: reference.tag,
      evidenceSource: mediaVerified
        ? "bound-native-cml-asset-body"
        : "bound-authoring-draft-cml",
      hashStatus: mediaVerified
        ? "HASHED_ORIGINAL_BINARY_BYTES"
        : "NOT_FETCHED_DIRECT_DATA",
      bodyVerified: mediaVerified,
      ...(mediaVerified && asset
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
    !source ||
    source.sourceState !== "AUTHORING_DRAFT" ||
    raw?.typeName !== "cml" ||
    raw.definition?.dtdId !== "supplement/1" ||
    source.dtdId !== "supplement/1" ||
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
    value?.typeName === "cml" &&
    /^(?:assess|staffGraded)\/1$/.test(value.definition?.dtdId || "") &&
    typeof value.definition?.value === "string" &&
    directCmlTextV1(value.definition.value)?.references.length === 0;
  const same = (left, right) => {
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
      fp.typeName === "staffGraded" &&
      content?.typeName === "staffGradedDraft" &&
      empty(definition?.parts) &&
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
        native.options.length < 2 ||
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
              JSON.stringify(native.correctOptions)))
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

/** Derive learner text from the native definition without HTML interpretation.
 * No media URL can substitute for the body of an assessment image/attachment. */
export function directAssessmentQuestionProjectionV1(element) {
  const kind = element?.definition?.typeName,
    native = element?.definition?.definition;
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
