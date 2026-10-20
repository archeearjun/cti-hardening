/** Bind the current authoring draft to exact material and relation identities.
 * Titles are deliberately not identity: a draft may have a different name from
 * both the structural inventory and its retained published snapshot. */
export function bindDirectIdentityV1(
  fp,
  courseId,
  slug,
  atomData,
  relationData,
) {
  const badBinding = () => {
    throw new Error("DIRECT_AUTHORING_SOURCE_BINDING_FAILED");
  };
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  if (
    !object(fp) ||
    typeof fp.id !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(fp.id) ||
    typeof courseId !== "string" ||
    !/^[A-Za-z0-9_-]{8,}$/.test(courseId) ||
    typeof slug !== "string" ||
    !slug ||
    typeof fp.atomId !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(fp.atomId) ||
    fp.contentId !== "atom~" + fp.atomId ||
    !object(atomData) ||
    !object(relationData) ||
    !Array.isArray(atomData.elements) ||
    atomData.elements.length !== 1 ||
    !Array.isArray(relationData.elements) ||
    relationData.elements.length !== 1
  )
    badBinding();
  const atom = atomData.elements[0],
    relation = relationData.elements[0];
  if (
    !object(atom) ||
    !object(relation) ||
    atom.id !== fp.atomId ||
    atom.contentId !== fp.contentId ||
    relation.id !== fp.atomId ||
    relation.atomId !== fp.atomId ||
    !object(relation.branchRelationMap)
  )
    badBinding();
  const relationKey = courseId + "~" + fp.id;
  if (
    !Object.prototype.hasOwnProperty.call(
      relation.branchRelationMap,
      relationKey,
    )
  )
    badBinding();
  const branch = relation.branchRelationMap[relationKey];
  if (
    !object(branch) ||
    branch.courseId !== courseId ||
    branch.itemId !== fp.id ||
    branch.courseSlug !== slug
  )
    badBinding();
  return {atom,relation,atomId:fp.atomId,contentId:fp.contentId,courseId,itemId:fp.id,courseSlug:slug};
}

export function bindDirectAuthoringDraftV1(fp, courseId, slug, atomData, relationData) {
  const identity=bindDirectIdentityV1(fp,courseId,slug,atomData,relationData),
    {atom}=identity, object=value=>value && typeof value==="object" && !Array.isArray(value);
  if (
    !object(atom.status) ||
    atom.status.typeName !== "draftAtomStatus" ||
    !object(atom.draft) ||
    !object(atom.draft.content)
  )
    throw new Error("DIRECT_AUTHORING_ATOM_STATE_UNSUPPORTED");
  return {
    ...identity,
    draft: atom.draft,
    published: atom.published,
    sourceState: "AUTHORING_DRAFT",
    storedAtomVersion: atom.storedAtomVersion,
    updatedAt: object(atom.metadata) ? atom.metadata.updatedAt : undefined,
    draftTimeCommitment: atom.draft.timeCommitment,
    publishedTimeCommitment: object(atom.published)
      ? atom.published.timeCommitment
      : undefined,
  };
}

/** The parts array supplies source order; group IDs join the bound atom owner
 * with the exact observed local part ID. Unknown or conflicting parts remain
 * explicit and prevent a partial list from becoming a complete inventory. */
export function directDraftAssessmentInventoryV1(bound) {
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  const content = bound && bound.draft && bound.draft.content;
  if (
    !object(bound) ||
    bound.sourceState !== "AUTHORING_DRAFT" ||
    typeof bound.atomId !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(bound.atomId) ||
    !object(content) ||
    content.typeName !== "staffGradedDraft" ||
    !object(content.definition) ||
    !Array.isArray(content.definition.parts)
  )
    throw new Error("DIRECT_AUTHORING_ASSESSMENT_MODEL_UNSUPPORTED");
  const definition = content.definition,
    parts = definition.parts;
  const instructionOnly = parts.length > 0 && parts.every(part => part?.typeName === "storedTextBlockPart");
  const candidates = [],
    unsupportedParts = [],
    seen = new Set();
  if (instructionOnly) {
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index], id = part.definition?.id;
      if (Object.keys(part).some(key => !["typeName", "definition"].includes(key)) ||
          !object(part.definition) || Object.keys(part.definition).some(key => !["id", "title", "body"].includes(key)) ||
          typeof id !== "string" || !/^textBlock~[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
          seen.has(id) || typeof part.definition.title !== "string" || !object(part.definition.body))
        unsupportedParts.push({ordinal: index + 1, typeName: part.typeName, reason: "DIRECT_INSTRUCTION_PART_MODEL_UNSUPPORTED"});
      seen.add(id);
    }
    return {complete: unsupportedParts.length === 0 && parts.length <= 100,
      reason: unsupportedParts.length === 0 && parts.length <= 100 ? "EXACT_AUTHORING_DRAFT_INSTRUCTION_PARTS" : "AUTHORING_DRAFT_PARTS_INCOMPLETE",
      assignmentId: bound.atomId, candidates, declared: 0, declaredContentParts: parts.length,
      instructionOnly: true, nonQuestionPartOrdinals: parts.map((_, index) => index + 1),
      rawParts: parts, unsupportedParts, configuration: definition.configuration,
      introduction: definition.introduction, reviewCriteria: definition.reviewCriteria,
      passingFraction: definition.passingFraction, assignmentLevelRubrics: definition.assignmentLevelRubrics,
      draftTimeCommitment: bound.draftTimeCommitment, publishedTimeCommitment: bound.publishedTimeCommitment};
  }
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index],
      ordinal = index + 1;
    if (!object(part) || part.typeName !== "storedQuestionGroupPart") {
      unsupportedParts.push({
        ordinal,
        typeName:
          object(part) && typeof part.typeName === "string"
            ? part.typeName
            : "UNKNOWN_PART_TYPE",
        reason: "DIRECT_ASSESSMENT_PART_TYPE_UNSUPPORTED",
      });
      continue;
    }
    const id = object(part.definition) && part.definition.id;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
      unsupportedParts.push({
        ordinal,
        typeName: part.typeName,
        reason: "DIRECT_ASSESSMENT_PART_ID_INVALID",
      });
      continue;
    }
    if (seen.has(id)) {
      unsupportedParts.push({
        ordinal,
        typeName: part.typeName,
        reason: "DIRECT_ASSESSMENT_PART_ID_CONFLICT",
      });
      continue;
    }
    seen.add(id);
    candidates.push({ id: bound.atomId + "~" + id, ordinal, label: "" });
  }
  const complete =
    unsupportedParts.length === 0 && candidates.length === parts.length;
  return {
    complete,
    reason: complete
      ? parts.length
        ? "EXACT_AUTHORING_DRAFT_PARTS"
        : "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS"
      : "AUTHORING_DRAFT_PARTS_INCOMPLETE",
    assignmentId: bound.atomId,
    candidates,
    declared: parts.length,
    declaredContentParts: parts.length,
    rawParts: parts,
    unsupportedParts,
    configuration: definition.configuration,
    introduction: definition.introduction,
    reviewCriteria: definition.reviewCriteria,
    passingFraction: definition.passingFraction,
    assignmentLevelRubrics: definition.assignmentLevelRubrics,
    draftTimeCommitment: bound.draftTimeCommitment,
    publishedTimeCommitment: bound.publishedTimeCommitment,
  };
}

/** Observed CML dialects inside supplementDraft reading models. The DTD name
 * does not determine item type: assess/1 is also authored inside readings. */
export function directDraftReadingDtdSupportedV1(dtdId) {
  return dtdId === "supplement/1" || dtdId === "assess/1";
}

/** Original CML from the bound authoring draft. This is an API source model,
 * never a fabricated editor observation or a published learner-body receipt. */
export function directDraftReadingSourceV1(bound) {
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  const content = bound && bound.draft && bound.draft.content;
  if (
    !object(bound) ||
    bound.sourceState !== "AUTHORING_DRAFT" ||
    !object(content) ||
    content.typeName !== "supplementDraft" ||
    !object(content.definition)
  )
    throw new Error("DIRECT_AUTHORING_READING_MODEL_UNSUPPORTED");
  const definition = content.definition,
    cml = definition.content;
  if (
    !object(cml) ||
    cml.typeName !== "cml" ||
    !object(cml.definition) ||
    !directDraftReadingDtdSupportedV1(cml.definition.dtdId) ||
    typeof cml.definition.value !== "string" ||
    typeof definition.assetId !== "string" ||
    !/^[A-Za-z0-9_-]{22}@\d+$/.test(definition.assetId)
  )
    throw new Error("DIRECT_AUTHORING_READING_MODEL_UNSUPPORTED");
  const publishedDefinition =
    object(bound.published) &&
    object(bound.published.content) &&
    object(bound.published.content.definition)
      ? bound.published.content.definition
      : null;
  return {
    cml: cml.definition.value,
    rawCML: cml,
    dtdId: cml.definition.dtdId,
    assetId: definition.assetId,
    publishedAssetId:
      publishedDefinition && typeof publishedDefinition.assetId === "string"
        ? publishedDefinition.assetId
        : null,
    sourceState: "AUTHORING_DRAFT",
    draftTimeCommitment: bound.draftTimeCommitment,
    publishedTimeCommitment: bound.publishedTimeCommitment,
  };
}

/** Preserve the observed authoring discussion prompt and permissions, separate
 * from learner responses and the retained published discussion snapshot. */
export function directDraftDiscussionSourceV1(bound) {
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  const content = bound?.draft?.content,
    promptType = content?.definition?.promptType,
    definition = promptType?.definition,
    prompt = definition?.prompt;
  if (
    bound?.sourceState !== "AUTHORING_DRAFT" ||
    content?.typeName !== "discussionPromptDraft" ||
    promptType?.typeName !== "questionPerSession" ||
    !object(definition) ||
    typeof definition.title !== "string" ||
    !object(definition.promptPermissions) ||
    typeof definition.promptPermissions.viewAnswersBeforeReplying !==
      "boolean" ||
    prompt?.typeName !== "cml" ||
    prompt.definition?.dtdId !== "discussion/1" ||
    typeof prompt.definition.value !== "string"
  )
    throw new Error("DIRECT_AUTHORING_DISCUSSION_MODEL_UNSUPPORTED");
  return {
    promptType: "questionPerSession",
    rawDefinition: definition,
    rawCML: prompt,
    cml: prompt.definition.value,
    dtdId: prompt.definition.dtdId,
    title: definition.title,
    promptPermissions: definition.promptPermissions,
    sourceState: "AUTHORING_DRAFT",
  };
}
