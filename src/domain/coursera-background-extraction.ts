import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parseCourseraCourseMaterialsRelations } from "./coursera-course-relations.ts";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import {
  directCmlMediaInventoryV1,
  directMediaEvidenceStructureV1,
} from "../extractors/coursera/direct-data-media-contracts.js";
import {
  CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1,
  CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1,
  directDraftWidgetProviderV1,
  directWidgetProviderSourceV1,
  directWidgetProviderTargetsV1,
} from "../extractors/coursera/direct-data-widget.js";
import { directPanoptoEvidenceStructureV1 } from "../extractors/coursera/direct-data-panopto-contracts.js";
import { directPanoptoSourceV1 } from "../extractors/coursera/direct-data-panopto.js";

export interface CourseraShellTarget {
  inputUrl: string;
  shellUrl: string;
  slug: string;
  courseId: string;
}

export type CourseraExtractionState =
  | "QUEUED"
  | "AWAITING_LOGIN"
  | "CONNECTED"
  | "RUNNING"
  | "VERIFYING"
  | "COMPLETE"
  | "INCOMPLETE"
  | "FAILED";

export interface CourseraCaptureVerdict {
  complete: boolean;
  noSilentMisses: boolean;
  inventoryCount: number;
  fingerprintCount: number;
  completeCount: number;
  unresolvedCount: number;
  unknownCount: number;
  unvisitedCount: number;
  externalContentUnverifiedCount: number;
  reasons: string[];
}

export interface CourseraExtractionStatus {
  id: string;
  kind: "connection" | "extraction";
  state: CourseraExtractionState;
  shellUrl: string;
  courseId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  phase?: string;
  ownerHash?: string;
  liveViewUrl?: string;
  artifactAvailable?: boolean;
  artifactName?: string;
  capture?: CourseraCaptureVerdict;
  error?: string;
}

const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
const number = (value: unknown, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/** Direct provenance remains direct when a malformed file loses its mode. */
export function hasCourseraDirectDataCaptureMarker(value: unknown): boolean {
  const capture = record(value),
    meta = record(capture?.meta);
  const directMode = record(meta?.directDataCapture);
  return Boolean(
    (directMode && Object.hasOwn(directMode, "mode")) ||
      array(capture?.fingerprints).some((fp) => {
        const item = record(fp),
          payload = record(item?.payload);
        const outer = record(item?.captureContract),
          inner = record(payload?.captureContract);
        return (
          [outer, inner].some(
            (contract) =>
              typeof contract?.status === "string" &&
              contract.status.startsWith("COMPLETE_BOUND_DRAFT"),
          ) ||
          (!!payload && Object.hasOwn(payload, "directDataSources")) ||
          record(payload?.directDataEvidence)?.method ===
            "BOUND_AUTHORING_DRAFT_API" ||
          record(payload?.assessmentApiEvidence)?.method ===
            "BOUND_AUTHORING_DRAFT_API"
        );
      }),
  );
}

export function parseCourseraShellUrl(value: string): CourseraShellTarget {
  let url: URL;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid Coursera authoring-shell URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.coursera.org" ||
    url.username ||
    url.password
  )
    throw new Error(
      "Only https://www.coursera.org/teach/... authoring-shell URLs are allowed.",
    );
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length < 4 ||
    parts[0] !== "teach" ||
    !/^[a-z0-9][a-z0-9-]{1,199}$/i.test(parts[1] || "") ||
    !/^[a-z0-9_-]{8,160}$/i.test(parts[2] || "") ||
    parts[3] !== "content"
  )
    throw new Error(
      "Paste a Coursera authoring URL containing /teach/<course>/<course-id>/content.",
    );
  const slug = parts[1],
    courseId = parts[2];
  return {
    inputUrl: url.toString(),
    shellUrl: `https://www.coursera.org/teach/${slug}/${courseId}/content/edit`,
    slug,
    courseId,
  };
}

function textBlockEvidenceValid(
  item: Record<string, unknown>,
  payload: Record<string, unknown>,
  courseId: string,
): boolean {
  const evidence = record(
    record(payload.nativeAssignment)?.contentBlockEvidence,
  );
  const blocks = array(evidence?.blocks);
  const assessment = record(payload.structuredAssessment);
  return (
    !!evidence &&
    evidence.completeTextBlockOnly === true &&
    evidence.itemId === item.id &&
    evidence.courseId === courseId &&
    Number.isInteger(evidence.declaredContentParts) &&
    evidence.declaredContentParts > 0 &&
    evidence.declaredContentParts === blocks.length &&
    evidence.observedPartCount === blocks.length &&
    evidence.observedTextBlockCount === blocks.length &&
    evidence.otherPartCount === 0 &&
    new Set(blocks.map((b) => record(b)?.id)).size === blocks.length &&
    blocks.every(
      (b) =>
        record(b) &&
        typeof b.id === "string" &&
        b.id &&
        typeof b.text === "string" &&
        b.text.trim() &&
        b.truncated === false,
    ) &&
    !array(assessment?.questions).length &&
    !number(assessment?.declaredQuestionCount) &&
    !number(record(assessment?.captureCompleteness)?.declared)
  );
}

function itemContractReasons(fingerprints: unknown[]): string[] {
  const reasons: string[] = [];
  for (const fp of fingerprints) {
    const item = record(fp),
      payload = record(item?.payload);
    const outer = record(item?.captureContract),
      inner = record(payload?.captureContract);
    const contract = outer || inner,
      id = String(item?.id || "unknown");
    if (
      !contract ||
      typeof contract.complete !== "boolean" ||
      typeof contract.status !== "string" ||
      !contract.status
    )
      reasons.push(`ITEM_CONTRACT_MISSING:${id}`);
    else if (contract.complete !== true)
      reasons.push(`ITEM_INCOMPLETE:${id}:${contract.status}`);
    if (
      outer &&
      inner &&
      (outer.complete !== inner.complete || outer.status !== inner.status)
    )
      reasons.push(`ITEM_CONTRACT_CONFLICT:${id}`);
    if (contract?.itemId != null && contract.itemId !== item?.id)
      reasons.push(`ITEM_CONTRACT_ID_MISMATCH:${id}`);
  }
  return reasons;
}

function assessmentReasons(fingerprints: any[], courseId: string): string[] {
  const reasons: string[] = [];
  for (const fp of fingerprints) {
    const item = record(fp);
    if (!item) continue;
    const type = String(item.type || item.typeName || "").toLowerCase();
    if (!/assignment|quiz|exam|assessment/.test(type)) continue;
    const payload = record(item.payload) || {};
    const assessment = record(payload.structuredAssessment);
    const contract = record(item.captureContract || payload.captureContract);
    if (contract && contract.complete === false) {
      reasons.push(
        `ITEM_INCOMPLETE:${String(item.id || "unknown")}:${String(contract.status || "UNRESOLVED")}`,
      );
      continue;
    }
    if (contract?.status === "COMPLETE_ASSIGNMENT_TEXT_BLOCKS") {
      if (!textBlockEvidenceValid(item, payload, courseId))
        reasons.push(
          `ASSIGNMENT_TEXT_BLOCK_EVIDENCE_INCOMPLETE:${String(item.id || "unknown")}`,
        );
      continue;
    }
    // A captured ingestion failure describes an observed defect, not a claim
    // that assessment payload exists. Preserve that separate capture outcome.
    if (
      contract?.status === "INGESTION_FAILURE_CAPTURED" &&
      record(payload.ingestionFailure)?.detected === true
    )
      continue;
    if (!assessment) {
      if (
        contract &&
        !["COMPLETE_NATIVE_ASSIGNMENT", "COMPLETE_EMPTY_ASSIGNMENT"].includes(
          String(contract.status || ""),
        )
      )
        reasons.push(
          `ASSESSMENT_EVIDENCE_MISSING:${String(item.id || "unknown")}`,
        );
      continue;
    }
    const completeness = record(assessment.captureCompleteness);
    const declared = number(
      completeness?.declared ??
        assessment.declaredQuestionCount ??
        assessment.questionCount,
      0,
    );
    if (declared > 0) {
      const captured = number(
        completeness?.captured ?? array(assessment.questions).length,
        0,
      );
      if (
        !completeness ||
        completeness.questionCoverageComplete !== true ||
        completeness.requiredAnswerCoverageComplete !== true ||
        captured < declared ||
        array(assessment.questions).length !== declared ||
        array(completeness.missingQuestionOrdinals).length > 0 ||
        array(completeness.missingRequiredAnswerOrdinals).length > 0
      )
        reasons.push(
          `ASSESSMENT_COVERAGE_INCOMPLETE:${String(item.id || "unknown")}:${captured}/${declared}`,
        );
    }
  }
  return reasons;
}

function pluginReasons(fingerprints: any[]): string[] {
  const reasons: string[] = [];
  for (const fp of fingerprints) {
    const item = record(fp);
    if (!item) continue;
    const type = String(item.type || item.typeName || "").toLowerCase();
    if (!/plugin|lti|widget/.test(type)) continue;
    const payload = record(item.payload) || {};
    const contract = record(item.captureContract || payload.captureContract);
    const status = String(contract?.status || "");
    if (
      contract?.externalBodyVerified === false ||
      status === "ACCOUNTED_EXTERNAL_TARGET_ONLY" ||
      status === "COMPLETE_EXTERNAL_TARGET_ONLY"
    )
      reasons.push(`PLUGIN_BODY_UNVERIFIED:${String(item.id || "unknown")}`);
    else if (contract && contract.complete !== true)
      reasons.push(
        `PLUGIN_INCOMPLETE:${String(item.id || "unknown")}:${status || "UNRESOLVED"}`,
      );
  }
  return reasons;
}

const directHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function directModelHash(value: unknown): string | null {
  try {
    return bytesToHex(
      sha256(new TextEncoder().encode(directCanonicalSourceTextV1(value))),
    );
  } catch {
    return null;
  }
}

function directReceiptValid(
  value: unknown,
  resource: string,
  id: string,
): boolean {
  const receipt = record(value);
  return (
    !!receipt &&
    receipt.resource === resource &&
    receipt.id === id &&
    receipt.status === 200 &&
    directHash(receipt.sha256) &&
    directHash(receipt.originalResponseSha256) &&
    receipt.sha256 === receipt.originalResponseSha256 &&
    (receipt.requestPath ===
      "/api/" + resource + "/" + encodeURIComponent(id).replace(/%40/gi, "@") ||
      (resource === "authoringCourseMaterials.v1" &&
        receipt.requestPath ===
          "/api/" + resource + "/" + encodeURIComponent(id) + "/")) &&
    receipt.bodyFormat === "PARSED_SANITIZED_JSON_MODEL"
  );
}

function directSingleSource(
  value: unknown,
  id: string,
): Record<string, any> | null {
  const envelope = record(value);
  if (
    !envelope ||
    !Array.isArray(envelope.elements) ||
    envelope.elements.length !== 1 ||
    (envelope.paging !== undefined &&
      (!record(envelope.paging) || Object.keys(envelope.paging).length))
  )
    return null;
  const root = record(envelope.elements[0]);
  return root?.id === id ? root : null;
}

function directWidgetFinderReceiptValid(
  value: unknown,
  courseId: string,
  providerId: string,
): boolean {
  const receipt = record(value);
  if (
    !receipt || receipt.resource !== "authoringWidgetSessionProviders.v1" ||
    receipt.id !== providerId || receipt.status !== 200 ||
    receipt.requestPath !== "/api/authoringWidgetSessionProviders.v1/" ||
    receipt.bodyFormat !== "PARSED_SANITIZED_JSON_MODEL" ||
    !directHash(receipt.originalResponseSha256) ||
    receipt.sha256 !== receipt.originalResponseSha256 ||
    !Array.isArray(receipt.requestQuery) || receipt.requestQuery.length !== 5
  )
    return false;
  const expected: Record<string, string> = {
    q: "getWithCourseId",
    widgetSessionProviderId: providerId,
    courseId,
    fields: CTI_DIRECT_WIDGET_PROVIDER_FIELDS_V1,
    includes: CTI_DIRECT_WIDGET_PROVIDER_INCLUDES_V1,
  };
  const seen = new Set<string>();
  for (const pair of receipt.requestQuery) {
    if (
      !Array.isArray(pair) || pair.length !== 2 ||
      typeof pair[0] !== "string" || typeof pair[1] !== "string" ||
      !Object.hasOwn(expected, pair[0]) || seen.has(pair[0]) ||
      expected[pair[0]] !== pair[1]
    )
      return false;
    seen.add(pair[0]);
  }
  return seen.size === 5;
}

function directWidgetSourcesValid(
  payload: Record<string, any>,
  bound: Record<string, any>,
): boolean {
  const raw = record(payload.directWidgetProviderEvidence);
  try {
    const binding = directDraftWidgetProviderV1(bound);
    if (
      !raw || raw.method !== "BOUND_AUTHORING_WIDGET_PROVIDER" ||
      raw.providerId !== binding.providerId || raw.courseId !== binding.courseId ||
      raw.itemId !== binding.itemId || raw.atomId !== binding.atomId ||
      raw.sourceState !== "AUTHORING_DRAFT" || raw.stableSource !== true ||
      raw.bodyVerified !== false || raw.playbackVerified !== false ||
      raw.launchVerified !== false || raw.wholeWidgetVerified !== false ||
      raw.binaryContentVerified === true || raw.externalBodyVerified === true ||
      !directHash(raw.initial?.sourceHash) ||
      !directHash(raw.final?.sourceHash) ||
      !directWidgetFinderReceiptValid(raw.initial.receipt, binding.courseId, binding.providerId) ||
      !directWidgetFinderReceiptValid(raw.final.receipt, binding.courseId, binding.providerId)
    )
      return false;
    const initial = directWidgetProviderSourceV1(bound, raw.initial.model),
      final = directWidgetProviderSourceV1(bound, raw.final.model),
      sourceHash = directModelHash(initial);
    return (
      sourceHash !== null && sourceHash === raw.initial.sourceHash &&
      sourceHash === raw.final.sourceHash && sourceHash === directModelHash(final) &&
      directCanonicalSourceTextV1(raw.targets) ===
        directCanonicalSourceTextV1(directWidgetProviderTargetsV1(bound, raw.initial.model))
    );
  } catch {
    return false;
  }
}

function directPanoptoSourcesValid(payload: Record<string, any>): boolean {
  try {
    const raw = payload.directPanoptoEvidence,
      targets = payload.directWidgetProviderEvidence?.targets,
      checked = directPanoptoEvidenceStructureV1(raw, targets);
    if (!checked.valid) return false;
    for (const delivery of raw.deliveries) {
      for (const observation of [delivery.initial, delivery.final]) {
        if (observation && (directModelHash(observation.model) !== observation.modelHash ||
            directModelHash(directPanoptoSourceV1(delivery.targetUrl, observation.model)) !== observation.sourceHash))
          return false;
      }
    }
    for (const retained of checked.historical) {
      for (const observation of [retained.initial, retained.final])
        if (directModelHash(observation.model) !== observation.modelHash || directModelHash(retained.source) !== observation.sourceHash) return false;
    }
    for (const decoded of [...checked.decoded, ...checked.historical])
      if (decoded.bytes && bytesToHex(sha256(decoded.bytes)) !== decoded.body.sha256) return false;
    return true;
  } catch { return false; }
}

function directTextOnlyCmlSource(value: string): boolean {
  const parsed = directCmlMediaInventoryV1(value);
  return parsed.valid && parsed.references.length === 0;
}

function directCmlMediaSourcesValid(
  payload: Record<string, any>,
  evidence: Record<string, any>,
  value: string,
): boolean {
  const inventory = directCmlMediaInventoryV1(value);
  if (!inventory.valid || payload.textSample !== inventory.text) return false;
  const media = directMediaEvidenceStructureV1(
    payload.directAssetEvidence,
    inventory.references,
  );
  if (
    !media.complete ||
    evidence.assetReferenceCount !== inventory.references.length ||
    evidence.assetsBodyVerified !== true ||
    !Array.isArray(evidence.unresolvedAssetReferences) ||
    evidence.unresolvedAssetReferences.length
  )
    return false;
  for (const captured of media.decoded) {
    if (bytesToHex(sha256(captured.bytes)) !== captured.asset.body.sha256)
      return false;
  }
  if (!inventory.references.length) return true;
  const details = payload.assetDetails;
  if (!Array.isArray(details) || details.length !== inventory.references.length)
    return false;
  return media.resolved.every((resolved: any) => {
    const position = inventory.references.indexOf(resolved.reference),
      detail = record(details[position]),
      body = resolved.asset.body;
    return Boolean(
      detail &&
        detail.assetId === resolved.reference.id &&
        detail.tag === resolved.reference.tag &&
        detail.url === resolved.binding.canonicalUrl &&
        detail.bodyVerified === true &&
        detail.hashStatus === "HASHED_ORIGINAL_BINARY_BYTES" &&
        detail.evidenceSource === "bound-native-cml-asset-body" &&
        detail.sha256 === body.sha256 &&
        detail.size === body.size &&
        detail.mime === body.mime,
    );
  });
}

function directAssessmentSourcesValid(
  item: Record<string, any>,
  payload: Record<string, any>,
  evidence: Record<string, any>,
  definition: Record<string, any> | null,
  atomId: string,
  courseId: string,
): boolean {
  const parts = definition?.parts,
    raw = record(payload.assessmentApiEvidence),
    assessment = record(payload.structuredAssessment),
    inventory = record(payload.directAssessmentInventory);
  const coverage = record(assessment?.captureCompleteness),
    questions = assessment?.questions;
  if (
    !Array.isArray(parts) ||
    parts.length < 1 ||
    parts.length > 20000 ||
    raw?.method !== "BOUND_AUTHORING_DRAFT_API" ||
    raw.courseId !== courseId ||
    raw.itemId !== item.id ||
    raw.assignmentId !== atomId ||
    !Array.isArray(raw.rawParts) ||
    directModelHash(raw.rawParts) !== directModelHash(parts) ||
    !Array.isArray(raw.unsupportedParts) ||
    raw.unsupportedParts.length !== 0 ||
    !Array.isArray(raw.failures) ||
    raw.failures.length !== 0 ||
    !inventory ||
    !Array.isArray(raw.groups) ||
    raw.groups.length !== parts.length ||
    !Array.isArray(raw.groupStability) ||
    raw.groupStability.length !== parts.length ||
    !Array.isArray(raw.questionDefinitions) ||
    raw.questionDefinitions.length !== parts.length ||
    !Array.isArray(raw.inventory) ||
    raw.inventory.length !== parts.length ||
    !Array.isArray(raw.receipts) ||
    !Array.isArray(questions) ||
    questions.length !== parts.length ||
    assessment?.declaredQuestionCount !== parts.length ||
    assessment.questionCount !== parts.length ||
    coverage?.declared !== parts.length ||
    coverage.captured !== parts.length ||
    coverage.questionCoverageComplete !== true ||
    coverage.requiredAnswerCoverageComplete !== true ||
    !Array.isArray(coverage.missingQuestionOrdinals) ||
    coverage.missingQuestionOrdinals.length !== 0 ||
    !Array.isArray(coverage.missingRequiredAnswerOrdinals) ||
    coverage.missingRequiredAnswerOrdinals.length !== 0 ||
    evidence.declaredContentParts !== parts.length ||
    !Array.isArray(evidence.orderedGroupIds) ||
    evidence.orderedGroupIds.length !== parts.length
  )
    return false;
  const groups = new Map<string, any>(),
    definitions = new Map<string, any>(),
    stableGroups = new Map<string, any>(),
    seen = new Set<string>();
  const sourceReceipts = new Set<string>();
  for (const value of raw.receipts) {
    const receipt = record(value),
      resource = receipt?.resource,
      id = receipt?.id;
    if (
      (resource === "authoringAssignmentQuestionGroups.v1" ||
        resource === "authoringAssignmentMachineEvaluableQuestions.v1") &&
      typeof id === "string" &&
      directReceiptValid(receipt, resource, id)
    )
      sourceReceipts.add(resource + "/" + id);
  }
  for (const group of raw.groups) {
    if (!record(group) || typeof group.id !== "string" || groups.has(group.id))
      return false;
    groups.set(group.id, group);
  }
  for (const source of raw.questionDefinitions) {
    if (
      !record(source) ||
      typeof source.id !== "string" ||
      definitions.has(source.id)
    )
      return false;
    definitions.set(source.id, source);
  }
  for (const stability of raw.groupStability) {
    if (
      !record(stability) ||
      typeof stability.id !== "string" ||
      stableGroups.has(stability.id)
    )
      return false;
    stableGroups.set(stability.id, stability);
  }
  const cml = (value: unknown, requireText = true) => {
    const source = record(value),
      body = record(source?.definition);
    if (
      source?.typeName !== "cml" ||
      typeof body?.value !== "string" ||
      (requireText && !body.value.trim())
    )
      return null;
    const parsed = directCmlMediaInventoryV1(body.value);
    return parsed.valid &&
      !parsed.references.length &&
      (!requireText || parsed.text)
      ? parsed
      : null;
  };
  if (
    (definition?.configuration !== undefined &&
      !record(definition.configuration)) ||
    (definition?.passingFraction !== undefined &&
      (typeof definition.passingFraction !== "number" ||
        !Number.isFinite(definition.passingFraction) ||
        definition.passingFraction < 0 ||
        definition.passingFraction > 1)) ||
    (definition?.assignmentLevelRubrics !== undefined &&
      (!Array.isArray(definition.assignmentLevelRubrics) ||
        definition.assignmentLevelRubrics.length !== 0))
  )
    return false;
  for (const field of ["introduction", "reviewCriteria"]) {
    const value = definition?.[field];
    if (
      value !== undefined &&
      !(Array.isArray(value) && !value.length) &&
      !cml(value, false)
    )
      return false;
  }
  for (const field of [
    "configuration",
    "introduction",
    "reviewCriteria",
    "passingFraction",
    "assignmentLevelRubrics",
  ]) {
    const value = definition?.[field];
    if (value === undefined) {
      if (assessment[field] !== undefined || inventory[field] !== undefined)
        return false;
    } else {
      const expected = directModelHash(value);
      if (
        !expected ||
        expected !== directModelHash(assessment[field]) ||
        expected !== directModelHash(inventory[field])
      )
        return false;
    }
  }
  for (let index = 0; index < parts.length; index++) {
    const part = record(parts[index]),
      localId = record(part?.definition)?.id;
    if (
      part?.typeName !== "storedQuestionGroupPart" ||
      !/^[A-Za-z0-9_-]{22}$/.test(String(localId || ""))
    )
      return false;
    const groupId = atomId + "~" + localId,
      group = groups.get(groupId),
      candidate = record(raw.inventory[index]);
    const question = record(questions[index]);
    const stability = stableGroups.get(groupId),
      freshGroup = record(stability?.group),
      groupHash = directModelHash(group);
    if (
      seen.has(groupId) ||
      candidate?.id !== groupId ||
      candidate.ordinal !== index + 1 ||
      evidence.orderedGroupIds[index] !== groupId ||
      !Array.isArray(group?.questions) ||
      group.questions.length !== 1 ||
      stability?.stable !== true ||
      freshGroup?.id !== groupId ||
      !directHash(groupHash) ||
      groupHash !== directModelHash(freshGroup) ||
      !directReceiptValid(
        stability?.receipt,
        "authoringAssignmentQuestionGroups.v1",
        groupId,
      )
    )
      return false;
    const sourceId = group.questions[0],
      source = definitions.get(sourceId),
      wrapper = record(source?.definition);
    const native = record(wrapper?.definition),
      kind = wrapper?.typeName;
    const prompt = cml(native?.prompt);
    const correct =
      kind === "mcq"
        ? [native?.correctOption]
        : kind === "checkbox"
          ? native?.correctOptions
          : null;
    if (
      typeof sourceId !== "string" ||
      !new RegExp("^" + atomId + "~[A-Za-z0-9_-]+@\\d+$").test(sourceId) ||
      source?.id !== sourceId ||
      !sourceReceipts.has("authoringAssignmentQuestionGroups.v1/" + groupId) ||
      !sourceReceipts.has(
        "authoringAssignmentMachineEvaluableQuestions.v1/" + sourceId,
      ) ||
      !prompt ||
      !Array.isArray(native?.options) ||
      native.options.length < 2 ||
      native.options.length > 100 ||
      !Array.isArray(correct) ||
      !correct.length ||
      new Set(correct).size !== correct.length ||
      correct.some((id) => typeof id !== "string" || !id) ||
      question?.id !== String(index + 1) ||
      question.courseraQuestionId !== groupId ||
      question.sourceDefinitionId !== sourceId ||
      question.questionOrdinalObserved !== true ||
      question.rawType !== kind ||
      question.observationMethod !==
        "AUTHORING_DRAFT_PARTS_AND_EXACT_DEFINITION" ||
      question.type !==
        (kind === "mcq" ? "single-select" : "multiple-select") ||
      question.answerTextReliable !== true ||
      question.optionTextReliable !== true ||
      question.textFormat !== "PLAIN_TEXT" ||
      question.prompt !== prompt.text ||
      question.feedback !== "" ||
      question.shuffleOptions !==
        (typeof native.shuffleOptions === "boolean"
          ? native.shuffleOptions
          : null) ||
      (kind === "checkbox" &&
        question.allowPartialScoring !==
          (typeof native.allowPartialScoring === "boolean"
            ? native.allowPartialScoring
            : null)) ||
      !Array.isArray(question.options) ||
      question.options.length !== native.options.length ||
      !Array.isArray(question.correctAnswers)
    )
      return false;
    const sourceIds = new Set<string>();
    for (let position = 0; position < native.options.length; position++) {
      const sourceOption = record(native.options[position]),
        option = record(question.options[position]);
      const display = cml(sourceOption?.display),
        feedback =
          sourceOption?.feedback == null
            ? { text: "" }
            : cml(sourceOption.feedback, false);
      if (
        typeof sourceOption?.id !== "string" ||
        !sourceOption.id ||
        sourceIds.has(sourceOption.id) ||
        !display ||
        !feedback ||
        !option ||
        option.id !== sourceOption.id ||
        option.sourceOptionId !== sourceOption.id ||
        option.correct !== correct.includes(sourceOption.id) ||
        option.text !== display.text ||
        option.label !== display.text ||
        option.feedback !== feedback.text
      )
        return false;
      sourceIds.add(sourceOption.id);
    }
    if (correct.some((id) => !sourceIds.has(id))) return false;
    const key = record(question.answerKeyEvidence),
      answers = question.options
        .filter((option: any) => option.correct)
        .map((option: any) => option.text);
    if (
      JSON.stringify(question.correctAnswers) !== JSON.stringify(answers) ||
      (kind === "mcq" &&
        (key?.method !== "EXACT_CORRECT_OPTION_ID" ||
          key.correctOption !== correct[0])) ||
      (kind === "checkbox" &&
        (key?.method !== "EXACT_CORRECT_OPTION_ID_SET" ||
          JSON.stringify(key.correctOptions) !== JSON.stringify(correct)))
    )
      return false;
    seen.add(groupId);
  }
  return true;
}

function directEmptyAssessmentSourcesValid(
  item: Record<string, any>,
  payload: Record<string, any>,
  evidence: Record<string, any>,
  definition: Record<string, any> | null,
  atomId: string,
  courseId: string,
): boolean {
  const raw = record(payload.assessmentApiEvidence),
    inventory = record(payload.directAssessmentInventory),
    assessment = record(payload.structuredAssessment),
    coverage = record(assessment?.captureCompleteness),
    emptySource = record(payload.explicitEmptyAssessmentEvidence);
  const empty = (value: unknown) => Array.isArray(value) && value.length === 0;
  const same = (left: unknown, right: unknown) => {
    try {
      return (
        directCanonicalSourceTextV1(left) === directCanonicalSourceTextV1(right)
      );
    } catch {
      return false;
    }
  };
  const cml = (value: unknown) => {
    const source = record(value),
      body = record(source?.definition);
    return (
      source?.typeName === "cml" &&
      /^(?:assess|staffGraded)\/1$/.test(String(body?.dtdId || "")) &&
      typeof body?.value === "string" &&
      directTextOnlyCmlSource(body.value)
    );
  };
  return Boolean(
    empty(definition?.parts) &&
      record(definition?.configuration) &&
      cml(definition?.introduction) &&
      cml(definition?.reviewCriteria) &&
      empty(definition?.assignmentLevelRubrics) &&
      typeof definition?.passingFraction === "number" &&
      Number.isFinite(definition.passingFraction) &&
      definition.passingFraction >= 0 &&
      definition.passingFraction <= 1 &&
      raw?.method === "BOUND_AUTHORING_DRAFT_API" &&
      raw.courseId === courseId &&
      raw.itemId === item.id &&
      raw.assignmentId === atomId &&
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
      inventory?.complete === true &&
      inventory.reason === "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS" &&
      inventory.assignmentId === atomId &&
      inventory.declared === 0 &&
      inventory.declaredContentParts === 0 &&
      empty(inventory.candidates) &&
      empty(inventory.rawParts) &&
      empty(inventory.unsupportedParts) &&
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
      ) &&
      coverage?.declared === 0 &&
      coverage.declaredContentParts === 0 &&
      coverage.captured === 0 &&
      coverage.questionCoverageComplete === true &&
      coverage.requiredAnswerCoverageComplete === true &&
      empty(coverage.missingQuestionOrdinals) &&
      empty(coverage.missingRequiredAnswerOrdinals) &&
      coverage.sourceEmpty === true &&
      coverage.answerKeyApplicability === "NOT_APPLICABLE_NO_QUESTIONS" &&
      emptySource?.method === "EXPLICIT_EMPTY_AUTHORING_DRAFT_PARTS" &&
      emptySource.courseId === courseId &&
      emptySource.itemId === item.id &&
      emptySource.atomId === atomId &&
      emptySource.sourceEmpty === true &&
      emptySource.declaredContentParts === 0 &&
      emptySource.answerKeyApplicable === false &&
      evidence.sourceEmpty === true &&
      evidence.declaredContentParts === 0 &&
      empty(evidence.orderedGroupIds),
  );
}

function directDiscussionSourcesValid(
  payload: Record<string, any>,
  evidence: Record<string, any>,
  definition: Record<string, any> | null,
): boolean {
  const promptType = record(definition?.promptType),
    raw = record(promptType?.definition),
    cml = record(raw?.prompt),
    body = record(cml?.definition);
  const parsed = directCmlMediaInventoryV1(body?.value);
  let retained = false;
  try {
    retained =
      directCanonicalSourceTextV1(payload.directDraftDiscussion) ===
        directCanonicalSourceTextV1(raw) &&
      directCanonicalSourceTextV1(payload.discussionPromptPermissions) ===
        directCanonicalSourceTextV1(raw?.promptPermissions) &&
      directCanonicalSourceTextV1(payload.directDraftCml) ===
        directCanonicalSourceTextV1(cml);
  } catch {
    /* Missing original models fail closed. */
  }
  return Boolean(
    promptType?.typeName === "questionPerSession" &&
      typeof raw?.title === "string" &&
      typeof record(raw.promptPermissions)?.viewAnswersBeforeReplying ===
        "boolean" &&
      cml?.typeName === "cml" &&
      body?.dtdId === "discussion/1" &&
      typeof body.value === "string" &&
      parsed.valid &&
      directCmlMediaSourcesValid(payload, evidence, body.value) &&
      retained &&
      payload.discussionTitle === raw.title &&
      evidence.discussionPromptType === "questionPerSession" &&
      evidence.dtdId === "discussion/1" &&
      evidence.rawCmlLength === body.value.length &&
      directHash(evidence.rawCmlSha256) &&
      evidence.rawCmlSha256 ===
        bytesToHex(sha256(new TextEncoder().encode(body.value))) &&
      typeof payload.textSample === "string" &&
      payload.textSample === parsed.text &&
      evidence.plainTextLength === payload.textSample.length &&
      payload.textLength === payload.textSample.length &&
      payload.textScopeKind === "bound-authoring-draft-discussion-cml" &&
      directHash(payload.textSha256) &&
      payload.textSha256 ===
        bytesToHex(sha256(new TextEncoder().encode(payload.textSample))) &&
      payload.textCaptureTruncated === false &&
      payload.textCaptureEvidence == null,
  );
}

/** Independently verify the ordered material inventory without requiring every
 * content body to be complete. This narrower proof cannot certify the course. */
export function verifiedCourseraCaptureInventory(value: unknown) {
  const capture = record(value), mode = record(capture?.meta?.directDataCapture);
  if (!capture || !mode || mode.mode !== "BOUND_AUTHORING_DRAFT_API" || mode.version !== 1 || mode.sourceStable !== true)
    throw Error("A stable native authoring-material inventory is required when XLSX is absent.");
  const courseId = String(capture.page?.courseId || "");
  const initial = parseCourseraCourseMaterialsRelations(mode.materials, courseId);
  const final = parseCourseraCourseMaterialsRelations(mode.finalMaterials, courseId);
  const fingerprints = array(capture.fingerprints);
  if (!directHash(mode.initialMaterialHash) || mode.initialMaterialHash !== mode.finalMaterialHash ||
      mode.initialMaterialHash !== directModelHash(mode.materials.elements[0]) ||
      mode.finalMaterialHash !== directModelHash(mode.finalMaterials.elements[0]) ||
      !Number.isSafeInteger(mode.materialVersion) || mode.materialVersion < 0 ||
      !Number.isSafeInteger(mode.courseBranchVersion) || mode.courseBranchVersion < 0 ||
      initial.materialVersion !== mode.materialVersion || initial.courseBranchVersion !== mode.courseBranchVersion ||
      final.materialVersion !== initial.materialVersion || final.courseBranchVersion !== initial.courseBranchVersion ||
      JSON.stringify(initial.inventory) !== JSON.stringify(final.inventory) ||
      initial.inventoryCount !== fingerprints.length || capture.meta?.baseFingerprintCount !== initial.inventoryCount ||
      !directReceiptValid(mode.materialsReceipt, "authoringCourseMaterials.v1", courseId) ||
      !directReceiptValid(mode.finalMaterialsReceipt, "authoringCourseMaterials.v1", courseId) ||
      initial.inventory.some((leaf, i) => {
        const item = record(fingerprints[i]);
        return item?.id !== leaf.itemId || (leaf.contentBearing ? item.atomId !== leaf.atomId ||
          item.contentId !== leaf.sourceContentId || !leaf.atomReferenceBound : !!item.atomId || !!item.contentId);
      })) throw Error("The retained native material inventory is incomplete, unstable or contradictory.");
  return { courseId, material: mode.materials.elements[0].material, inventory: initial.inventory,
    materialHash: mode.initialMaterialHash as string, completeContent: false as const };
}

function directDraftCaptureReasons(capture: Record<string, any>): string[] {
  const meta = record(capture.meta) || {},
    mode = record(meta.directDataCapture) || {};
  const courseId = String(record(capture.page)?.courseId || ""),
    reasons: string[] = [];
  if (mode.mode !== "BOUND_AUTHORING_DRAFT_API")
    reasons.push("DIRECT_DRAFT_CAPTURE_MODE_INVALID");
  if (mode.acquisitionComplete !== true)
    reasons.push("DIRECT_DRAFT_ACQUISITION_NOT_COMPLETE");
  if (mode.wholeCourseVerified !== true)
    reasons.push("DIRECT_DRAFT_WHOLE_COURSE_NOT_VERIFIED");
  if (
    mode.version !== 1 ||
    mode.sourceStable !== true ||
    !directHash(mode.initialMaterialHash) ||
    mode.initialMaterialHash !== mode.finalMaterialHash ||
    !Number.isSafeInteger(mode.materialVersion) ||
    mode.materialVersion < 0 ||
    !Number.isSafeInteger(mode.courseBranchVersion) ||
    mode.courseBranchVersion < 0
  )
    reasons.push("DIRECT_DRAFT_SOURCE_STABILITY_NOT_PROVEN");
  const sourceItems = new Map<string, any>(),
    rawLeaves = new Map<string, any>();
  try {
    const initial = parseCourseraCourseMaterialsRelations(
      mode.materials,
      courseId,
    );
    const final = parseCourseraCourseMaterialsRelations(
      mode.finalMaterials,
      courseId,
    );
    const fingerprints = array(capture.fingerprints);
    if (
      mode.initialMaterialHash !==
        directModelHash(mode.materials.elements[0]) ||
      mode.finalMaterialHash !==
        directModelHash(mode.finalMaterials.elements[0]) ||
      initial.materialVersion !== mode.materialVersion ||
      initial.courseBranchVersion !== mode.courseBranchVersion ||
      final.materialVersion !== initial.materialVersion ||
      final.courseBranchVersion !== initial.courseBranchVersion ||
      JSON.stringify(initial.inventory) !== JSON.stringify(final.inventory) ||
      initial.inventoryCount !== fingerprints.length ||
      meta.baseFingerprintCount !== initial.inventoryCount ||
      !directReceiptValid(
        mode.materialsReceipt,
        "authoringCourseMaterials.v1",
        courseId,
      ) ||
      !directReceiptValid(
        mode.finalMaterialsReceipt,
        "authoringCourseMaterials.v1",
        courseId,
      ) ||
      initial.inventory.some((leaf, index) => {
        const item = record(fingerprints[index]);
        return (
          item?.id !== leaf.itemId ||
          (leaf.contentBearing
            ? item.atomId !== leaf.atomId ||
              item.contentId !== leaf.sourceContentId ||
              !leaf.atomReferenceBound
            : !!item.atomId || !!item.contentId)
        );
      })
    )
      throw new Error("DIRECT_MATERIAL_INVENTORY_MISMATCH");
    for (const leaf of initial.inventory) sourceItems.set(leaf.itemId, leaf);
    const walk = (nodes: any[]): void => {
      for (const node of nodes) {
        if (array(node.elements).length) walk(node.elements);
        else rawLeaves.set(node.id, node);
      }
    };
    walk(mode.materials.elements[0].material.elements);
  } catch {
    reasons.push("DIRECT_DRAFT_MATERIAL_INVENTORY_INVALID");
  }
  let slug = "";
  try {
    const target = parseCourseraShellUrl(
      String(record(capture.page)?.url || ""),
    );
    if (target.courseId === courseId) slug = target.slug;
  } catch {
    /* Source binding below rejects a missing authoring target. */
  }
  for (const fp of array(capture.fingerprints)) {
    const item = record(fp);
    if (!item) continue;
    const id = String(item.id || "unknown"),
      payload = record(item.payload) || {};
    const contract = record(item.captureContract || payload.captureContract);
    // Incomplete widgets can still claim verified configuration coverage. Check
    // that narrower proof independently before retaining its derived targets.
    const widgetConfigurationClaim =
      payload.directWidgetProviderEvidence !== undefined ||
      payload.directPanoptoEvidence !== undefined ||
      contract?.sourceConfigurationVerified === true;
    if (contract?.complete !== true && !widgetConfigurationClaim) continue;
    if (!contract) {
      reasons.push(`DIRECT_WIDGET_PROVIDER_SOURCE_INVALID:${id}`);
      continue;
    }
    if (
      widgetConfigurationClaim &&
      !/widget|plugin|lti/i.test(String(sourceItems.get(item.id)?.sourceContentType || ""))
    )
      reasons.push(`DIRECT_WIDGET_PROVIDER_SOURCE_INVALID:${id}`);
    const evidence = record(payload.directDataEvidence),
      sources = record(payload.directDataSources);
    const receipts = record(sources?.receipts),
      stability = record(receipts?.stability);
    const commonValid =
      !!slug &&
      record(payload.directResumeRevalidation)?.verified !== false &&
      evidence?.method === "BOUND_AUTHORING_DRAFT_API" &&
      evidence.courseId === courseId &&
      evidence.itemId === item.id &&
      evidence.sourceState === "AUTHORING_DRAFT" &&
      evidence.stableSource === true &&
      evidence.publishedBodyVerified !== true &&
      stability?.stable === true;
    if (!commonValid) {
      reasons.push(`DIRECT_DRAFT_SOURCE_BINDING_INVALID:${id}`);
      if (widgetConfigurationClaim)
        reasons.push(`DIRECT_WIDGET_PROVIDER_SOURCE_INVALID:${id}`);
      continue;
    }
    if (contract.status === "COMPLETE_EMPTY_STRUCTURE") {
      const material = record(sources?.materials),
        leaf = record(material?.leaf);
      const ancestors = array(material?.ancestorIds);
      const moduleShape =
        ancestors.length === 0 &&
        leaf &&
        typeof leaf.description === "string" &&
        Array.isArray(leaf.learningObjectives) &&
        Object.hasOwn(leaf, "timeCommitment");
      const lessonShape =
        ancestors.length === 1 &&
        typeof leaf?.trackId === "string" &&
        !!leaf.trackId;
      const original = rawLeaves.get(item.id),
        source = sourceItems.get(item.id);
      if (
        evidence.structural !== true ||
        evidence.noContent !== true ||
        evidence.childCount !== 0 ||
        material?.rootCourseId !== courseId ||
        source?.contentBearing !== false ||
        JSON.stringify(ancestors) !== JSON.stringify(source?.ancestorIds) ||
        JSON.stringify(leaf) !== JSON.stringify(original) ||
        !leaf ||
        leaf.id !== item.id ||
        Object.hasOwn(leaf, "content") ||
        !Array.isArray(leaf.elements) ||
        leaf.elements.length !== 0 ||
        !ancestors.every(
          (ancestor) => typeof ancestor === "string" && ancestor,
        ) ||
        !(moduleShape || lessonShape) ||
        !directReceiptValid(
          receipts?.materials,
          "authoringCourseMaterials.v1",
          courseId,
        )
      )
        reasons.push(`DIRECT_EMPTY_STRUCTURE_SOURCE_INVALID:${id}`);
      continue;
    }
    const atomId = String(item.atomId || ""),
      contentId = String(item.contentId || "");
    const atom = directSingleSource(sources?.atom, atomId),
      relation = directSingleSource(sources?.relation, atomId);
    const refreshedAtom = directSingleSource(stability?.atom, atomId);
    const branch = record(
      record(relation?.branchRelationMap)?.[courseId + "~" + item.id],
    );
    const atomValid =
      /^[A-Za-z0-9_-]{22}$/.test(atomId) &&
      contentId === "atom~" + atomId &&
      atom?.contentId === contentId &&
      relation?.atomId === atomId &&
      branch?.courseId === courseId &&
      branch.itemId === item.id &&
      branch.courseSlug === slug &&
      record(atom?.status)?.typeName === "draftAtomStatus" &&
      !!record(record(atom?.draft)?.content) &&
      evidence.atomId === atomId &&
      evidence.contentId === contentId &&
      directReceiptValid(receipts?.atom, "authoringAtoms.v2", atomId) &&
      directReceiptValid(
        receipts?.relation,
        "authoringItemContentRelations.v1",
        atomId,
      ) &&
      directHash(stability?.draftHash) &&
      Number.isSafeInteger(atom?.storedAtomVersion) &&
      atom.storedAtomVersion >= 0 &&
      stability.draftHash === directModelHash(atom.draft) &&
      evidence.draftHash === stability.draftHash &&
      refreshedAtom?.contentId === contentId &&
      record(refreshedAtom?.status)?.typeName === "draftAtomStatus" &&
      stability.draftHash === directModelHash(refreshedAtom?.draft) &&
      directReceiptValid(stability?.receipt, "authoringAtoms.v2", atomId) &&
      stability?.storedAtomVersion === atom?.storedAtomVersion &&
      evidence.storedAtomVersion === atom.storedAtomVersion &&
      refreshedAtom?.storedAtomVersion === atom.storedAtomVersion &&
      typeof record(atom?.metadata)?.updatedAt === "number" &&
      Number.isFinite(record(atom?.metadata)?.updatedAt) &&
      stability?.updatedAt === record(atom?.metadata)?.updatedAt &&
      evidence.updatedAt === stability.updatedAt &&
      record(refreshedAtom?.metadata)?.updatedAt === stability.updatedAt;
    if (!atomValid) {
      reasons.push(`DIRECT_DRAFT_SOURCE_BINDING_INVALID:${id}`);
      if (widgetConfigurationClaim)
        reasons.push(`DIRECT_WIDGET_PROVIDER_SOURCE_INVALID:${id}`);
      continue;
    }
    if (widgetConfigurationClaim) {
      if (
        contract?.sourceConfigurationVerified !== true || contract.complete !== false ||
        contract.externalBodyVerified !== false ||
        !directWidgetSourcesValid(payload, {
          courseId, itemId: item.id, atomId,
          sourceState: "AUTHORING_DRAFT", draft: atom.draft,
        })
      )
        reasons.push(`DIRECT_WIDGET_PROVIDER_SOURCE_INVALID:${id}`);
      if (payload.directPanoptoEvidence !== undefined && !directPanoptoSourcesValid(payload))
        reasons.push(`DIRECT_PANOPTO_SOURCE_INVALID:${id}`);
      if (contract?.complete !== true) continue;
    }
    const content = record(record(atom?.draft)?.content),
      definition = record(content?.definition);
    if (contract.status === "COMPLETE_BOUND_DRAFT_READING") {
      const cml = record(definition?.content),
        cmlDefinition = record(cml?.definition);
      if (
        sourceItems.get(item.id)?.sourceContentType !== "supplement" ||
        content?.typeName !== "supplementDraft" ||
        cml?.typeName !== "cml" ||
        cmlDefinition?.dtdId !== "supplement/1" ||
        typeof cmlDefinition?.value !== "string" ||
        !directCmlMediaSourcesValid(payload, evidence, cmlDefinition.value) ||
        JSON.stringify(payload.directDraftCml) !== JSON.stringify(cml) ||
        evidence.dtdId !== cmlDefinition.dtdId ||
        evidence.assetId !== definition?.assetId ||
        !/^[A-Za-z0-9_-]{22}@\d+$/.test(String(definition?.assetId || "")) ||
        evidence.rawCmlLength !== cmlDefinition.value.length ||
        !directHash(evidence.rawCmlSha256) ||
        evidence.rawCmlSha256 !==
          bytesToHex(sha256(new TextEncoder().encode(cmlDefinition.value))) ||
        typeof payload.textSample !== "string" ||
        evidence.plainTextLength !== payload.textSample.length ||
        payload.textLength !== payload.textSample.length ||
        payload.textScopeKind !== "bound-authoring-draft-cml" ||
        !directHash(payload.textSha256) ||
        payload.textSha256 !==
          bytesToHex(sha256(new TextEncoder().encode(payload.textSample))) ||
        payload.textCaptureTruncated !== false ||
        payload.textCaptureEvidence != null ||
        payload.emptyReadingEvidence != null
      )
        reasons.push(`DIRECT_DRAFT_READING_SOURCE_INVALID:${id}`);
      continue;
    }
    if (contract.status === "COMPLETE_BOUND_DRAFT_ASSESSMENT") {
      if (
        sourceItems.get(item.id)?.sourceContentType !== "staffGraded" ||
        content?.typeName !== "staffGradedDraft" ||
        !directAssessmentSourcesValid(
          item,
          payload,
          evidence,
          definition,
          atomId,
          courseId,
        )
      )
        reasons.push(`DIRECT_DRAFT_ASSESSMENT_SOURCE_INVALID:${id}`);
      continue;
    }
    if (contract.status === "COMPLETE_BOUND_DRAFT_EMPTY_ASSESSMENT") {
      if (
        sourceItems.get(item.id)?.sourceContentType !== "staffGraded" ||
        content?.typeName !== "staffGradedDraft" ||
        !directEmptyAssessmentSourcesValid(
          item,
          payload,
          evidence,
          definition,
          atomId,
          courseId,
        )
      )
        reasons.push(`DIRECT_DRAFT_EMPTY_ASSESSMENT_SOURCE_INVALID:${id}`);
      continue;
    }
    if (contract.status === "COMPLETE_BOUND_DRAFT_DISCUSSION") {
      if (
        sourceItems.get(item.id)?.sourceContentType !== "discussionPrompt" ||
        content?.typeName !== "discussionPromptDraft" ||
        !directDiscussionSourcesValid(payload, evidence, definition)
      )
        reasons.push(`DIRECT_DRAFT_DISCUSSION_SOURCE_INVALID:${id}`);
      continue;
    }
    // A direct capture cannot use the legacy status to substitute a target URL,
    // an unsupported draft model, or a published snapshot for draft content.
    reasons.push(
      `DIRECT_DRAFT_CONTENT_CONTRACT_UNSUPPORTED:${id}:${String(contract.status || "")}`,
    );
  }
  return reasons;
}

export function evaluateCourseraCapture(
  value: unknown,
  expectedCourseId = "",
): CourseraCaptureVerdict {
  const capture = record(value);
  if (!capture)
    return {
      complete: false,
      noSilentMisses: false,
      inventoryCount: 0,
      fingerprintCount: 0,
      completeCount: 0,
      unresolvedCount: 1,
      unknownCount: 0,
      unvisitedCount: 0,
      externalContentUnverifiedCount: 0,
      reasons: ["CAPTURE_NOT_AN_OBJECT"],
    };

  const meta = record(capture.meta) || {};
  const fingerprints = array(capture.fingerprints);
  const accounting = record(meta.captureAccounting);
  const reasons: string[] = [];
  const page = record(capture.page) || {};
  const actualCourseId = String(page.courseId || "");

  if (expectedCourseId && actualCourseId !== expectedCourseId)
    reasons.push(
      `COURSE_ID_MISMATCH:${actualCourseId || "missing"}:${expectedCourseId}`,
    );
  if (!fingerprints.length) reasons.push("NO_ITEM_FINGERPRINTS");
  const ids = fingerprints.map((fp) => record(fp)?.id);
  const identitiesValid =
    ids.every((id) => typeof id === "string" && id.trim()) &&
    new Set(ids).size === ids.length;
  if (!identitiesValid) reasons.push("ITEM_IDENTITIES_MISSING_OR_DUPLICATED");

  let inventoryCount = number(meta.baseFingerprintCount, fingerprints.length),
    completeCount = 0,
    unresolvedCount = 0,
    unknownCount = 0,
    unvisitedCount = 0,
    externalContentUnverifiedCount = 0,
    noSilentMisses = false;

  if (accounting) {
    const requiredCounts = [
      "inventoryCount",
      "completeCount",
      "unresolvedCount",
      "unknownCount",
      "unvisitedCount",
    ];
    const optionalCounts = [
      "externalContentUnverifiedCount",
      "terminalAccountedIncompleteCount",
    ];
    const countersValid = [
      ...requiredCounts,
      ...optionalCounts.filter((k) => accounting[k] !== undefined),
    ].every(
      (k) =>
        typeof accounting[k] === "number" &&
        Number.isSafeInteger(accounting[k]) &&
        accounting[k] >= 0,
    );
    if (!countersValid) reasons.push("CAPTURE_ACCOUNTING_COUNTERS_INVALID");
    const totalsValid =
      accounting.completeCount + accounting.unresolvedCount ===
      accounting.inventoryCount;
    if (!totalsValid) reasons.push("CAPTURE_ACCOUNTING_TOTALS_INCONSISTENT");
    const itemCompleteCount = fingerprints.filter((fp) => {
      const item = record(fp);
      return (
        record(item?.captureContract || record(item?.payload)?.captureContract)
          ?.complete === true
      );
    }).length;
    if (itemCompleteCount !== accounting.completeCount)
      reasons.push("CAPTURE_ACCOUNTING_ITEM_COUNT_MISMATCH");
    inventoryCount = number(accounting.inventoryCount, inventoryCount);
    completeCount = number(accounting.completeCount);
    unresolvedCount = number(accounting.unresolvedCount);
    unknownCount = number(accounting.unknownCount);
    unvisitedCount = number(accounting.unvisitedCount);
    externalContentUnverifiedCount = number(
      accounting.externalContentUnverifiedCount,
    );
    noSilentMisses =
      accounting.noSilentMisses === true &&
      accounting.allInventoryAccounted === true &&
      unknownCount === 0 &&
      unvisitedCount === 0 &&
      identitiesValid &&
      countersValid &&
      totalsValid &&
      inventoryCount === fingerprints.length;

    if (inventoryCount !== fingerprints.length)
      reasons.push(
        `INVENTORY_FINGERPRINT_MISMATCH:${inventoryCount}:${fingerprints.length}`,
      );
    if (accounting.allInventoryAccounted !== true)
      reasons.push("INVENTORY_NOT_FULLY_ACCOUNTED");
    if (accounting.noSilentMisses !== true)
      reasons.push("SILENT_MISS_GUARD_NOT_PROVEN");
    if (unknownCount) reasons.push(`UNKNOWN_ITEMS:${unknownCount}`);
    if (unvisitedCount) reasons.push(`UNVISITED_ITEMS:${unvisitedCount}`);
    if (unresolvedCount) reasons.push(`UNRESOLVED_ITEMS:${unresolvedCount}`);
    if (number(accounting.terminalAccountedIncompleteCount))
      reasons.push(
        `TERMINAL_INCOMPLETE_ITEMS:${number(accounting.terminalAccountedIncompleteCount)}`,
      );
    if (externalContentUnverifiedCount)
      reasons.push(
        `EXTERNAL_CONTENT_UNVERIFIED:${externalContentUnverifiedCount}`,
      );
    if (accounting.complete !== true)
      reasons.push("CAPTURE_ACCOUNTING_NOT_COMPLETE");
  } else {
    // Older extractor releases can provide useful evidence, but they cannot
    // certify the strict background-completion contract. Never upgrade that
    // uncertainty to COMPLETE.
    reasons.push("EXPLICIT_COMPLETENESS_CONTRACT_MISSING");
    unresolvedCount = Math.max(1, number(meta.unresolvedEvidenceCount));
  }

  const crawl = record(meta.activeSpaCrawl);
  if (crawl) {
    if (crawl.timeBudgetExhausted === true)
      reasons.push("ACTIVE_CRAWL_TIME_BUDGET_EXHAUSTED");
    const unvisited = array(crawl.unvisitedTargetIds);
    if (unvisited.length)
      reasons.push(`ACTIVE_CRAWL_UNVISITED:${unvisited.length}`);
    if (number(crawl.unvisitedDueToBudget))
      reasons.push(
        `ACTIVE_CRAWL_UNVISITED_DUE_TO_BUDGET:${number(crawl.unvisitedDueToBudget)}`,
      );
  }
  if (meta.wholeRunDeadlineReached === true)
    reasons.push("WHOLE_RUN_DEADLINE_REACHED");

  reasons.push(...itemContractReasons(fingerprints));
  reasons.push(...assessmentReasons(fingerprints, actualCourseId));
  reasons.push(...pluginReasons(fingerprints));
  if (hasCourseraDirectDataCaptureMarker(capture)) {
    const directReasons = directDraftCaptureReasons(capture);
    reasons.push(...directReasons);
    if (directReasons.includes("DIRECT_DRAFT_MATERIAL_INVENTORY_INVALID"))
      noSilentMisses = false;
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    complete: uniqueReasons.length === 0 && noSilentMisses,
    noSilentMisses,
    inventoryCount,
    fingerprintCount: fingerprints.length,
    completeCount,
    unresolvedCount,
    unknownCount,
    unvisitedCount,
    externalContentUnverifiedCount,
    reasons: uniqueReasons,
  };
}
