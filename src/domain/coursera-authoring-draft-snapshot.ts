import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directCanonicalSourceTextV1 } from "../extractors/coursera/direct-data-canonical.js";
import {
  directReceiptSourceValidV1,
  directAssessmentQuestionProjectionV1,
} from "../extractors/coursera/direct-data-contracts.js";
import {
  bindDirectPublishedDraftSnapshotV1,
  directPublishedDraftSnapshotInventoryV1,
  directPublishedDraftSnapshotSourceV1,
  directPublishedDraftSnapshotStableV1,
  directPublishedDraftSnapshotQuestionIdsV1,
} from "../extractors/coursera/direct-data-authoring-snapshot.js";

type Obj = Record<string, any>;
const canonical = directCanonicalSourceTextV1;
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const hash = (v: unknown): string =>
  bytesToHex(sha256(new TextEncoder().encode(canonical(v))));
const MAX_PROOF_CHARACTERS = 2_000_000;
const MAX_DISPLAY_CHARACTERS = 300_000;
export const MAX_AUTHORING_DRAFT_SNAPSHOT_CHARACTERS = 8_000_000;
export const MAX_AUTHORING_DRAFT_SNAPSHOT_HISTORY_RECORDS = 32;
const RECEIPT_FIELDS = new Set([
  "resource",
  "id",
  "status",
  "bodyFormat",
  "requestPath",
  "requestQuery",
  "observedAt",
  "bytes",
  "originalResponseSha256",
  "sha256",
  "credentialFieldsRemoved",
  "credentialUrlsRedacted",
]);

/** Inspect descriptors before hashing or serializing untrusted saved data. */
function bounded(value: unknown, limit: number): boolean {
  const pending: { value: unknown; depth: number; leave?: boolean }[] = [
    { value, depth: 0 },
  ];
  const active = new WeakSet<object>();
  const nodeLimit = Math.max(
    100_000,
    Math.ceil(limit / MAX_PROOF_CHARACTERS) * 100_000,
  );
  let nodes = 0,
    characters = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (next.leave) {
      active.delete(next.value as object);
      continue;
    }
    if (++nodes > nodeLimit || next.depth > 64) return false;
    const v = next.value;
    if (typeof v === "string") characters += v.length;
    else if (typeof v === "number") {
      if (!Number.isFinite(v)) return false;
    } else if (v !== null && typeof v === "object") {
      const proto = Object.getPrototypeOf(v);
      if (
        (!Array.isArray(v) && proto !== Object.prototype && proto !== null) ||
        Object.getOwnPropertySymbols(v).length ||
        active.has(v)
      )
        return false;
      const keys = Object.keys(v);
      if (
        keys.length + pending.length > nodeLimit ||
        (Array.isArray(v) && keys.length !== v.length)
      )
        return false;
      active.add(v);
      pending.push({ value: v, depth: next.depth, leave: true });
      for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d || !("value" in d)) return false;
        characters += key.length;
        pending.push({ value: d.value, depth: next.depth + 1 });
      }
    } else if (typeof v !== "boolean" && v !== null) return false;
    if (characters > limit) return false;
  }
  return true;
}
function fields(
  value: unknown,
  allowed: string[],
  required = allowed,
): value is Obj {
  return (
    object(value) &&
    Object.keys(value).every((k) => allowed.includes(k)) &&
    required.every((k) => Object.prototype.hasOwnProperty.call(value, k))
  );
}
function date(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : null;
}
function receiptValid(
  receipt: unknown,
  resource: string,
  id: string,
): receipt is Obj {
  if (
    !object(receipt) ||
    Object.keys(receipt).some((k) => !RECEIPT_FIELDS.has(k)) ||
    !directReceiptSourceValidV1(receipt, resource, id) ||
    !/^[a-f0-9]{64}$/.test(text(receipt.originalResponseSha256)) ||
    receipt.sha256 !== receipt.originalResponseSha256 ||
    date(receipt.observedAt) === null ||
    !Number.isSafeInteger(receipt.bytes) ||
    receipt.bytes < 1 ||
    receipt.bytes > 32 * 1024 * 1024
  )
    return false;
  for (const k of ["credentialFieldsRemoved", "credentialUrlsRedacted"])
    if (k in receipt && (!Number.isSafeInteger(receipt[k]) || receipt[k] < 0))
      return false;
  return (
    !Object.prototype.hasOwnProperty.call(receipt, "requestQuery") ||
    (Array.isArray(receipt.requestQuery) &&
      receipt.requestQuery.length <= 20 &&
      receipt.requestQuery.every(
        (q: unknown) =>
          Array.isArray(q) &&
          q.length === 2 &&
          q.every((v) => typeof v === "string" && v.length <= 2_000),
      ))
  );
}
interface Observation {
  data: Obj;
  receipt: Obj;
  sourceSha256: string;
}
function observation(
  value: unknown,
  resource: string,
  id: string,
  withId = false,
): Observation | null {
  if (
    !fields(
      value,
      withId
        ? ["id", "data", "receipt", "sourceSha256"]
        : ["data", "receipt", "sourceSha256"],
    ) ||
    (withId && value.id !== id) ||
    !object(value.data) ||
    !Array.isArray(value.data.elements) ||
    value.data.elements.length !== 1 ||
    !object(value.data.elements[0]) ||
    value.data.elements[0].id !== id ||
    !receiptValid(value.receipt, resource, id) ||
    value.sourceSha256 !== hash(value.data)
  )
    return null;
  return value as unknown as Observation;
}

export interface DraftSnapshotObservation {
  observedAt: string;
  sanitizedModelSha256: string;
  sanitizedModelJson: string;
}
export interface DraftSnapshotAtomObservation extends DraftSnapshotObservation {
  draftSha256: string;
  publishedSha256: string;
}
export interface DraftSnapshotDefinition {
  id: string;
  nativeType: string;
  observedAt: string;
  originalModelSha256: string;
  originalModelJson: string;
  readableChoices: null | {
    prompt: string;
    options: {
      id: string;
      text: string;
      authoredCorrect: boolean;
      feedback: string;
    }[];
  };
}
export interface DraftSnapshotPart {
  ordinal: number;
  nativeType: string;
  nativeId: string;
  originalPartSha256: string;
  originalPartJson: string;
  group: null | {
    id: string;
    status: "STABLE" | "CHANGED" | "FINAL_READ_MISSING" | "NOT_READ";
    initial: DraftSnapshotObservation | null;
    final: DraftSnapshotObservation | null;
  };
  definition: DraftSnapshotDefinition | null;
}
export interface CourseraAuthoringDraftSnapshot {
  schemaVersion: 1;
  scope: "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM";
  courseId: string;
  itemId: string;
  atomId: string;
  contentId: string;
  publishedAssignmentId: string;
  sourceSha256: string;
  sourceStability: "STABLE" | "CHANGED" | "FINAL_READ_MISSING";
  initialAtom: DraftSnapshotAtomObservation;
  finalAtom: DraftSnapshotAtomObservation | null;
  relation: DraftSnapshotObservation;
  materialJson: string;
  draftConfiguration: {
    isGraded: boolean | null;
    isGradedStatus: "RECORDED" | "ABSENT" | "UNSUPPORTED";
    originalModelSha256: string;
    originalModelJson: string;
  };
  declaredDraftParts: number;
  parts: DraftSnapshotPart[];
  failures: {
    scope: "SOURCE" | "GROUP" | "DEFINITION";
    id: string;
    reason: string;
  }[];
  publishedContentVerified: false;
  contentCompletenessVerified: false;
  wholeItemVerified: false;
  /** Earlier immutable observations remain separate from this attempt. Entries
   * have their own proof and cannot contain a nested history projection. */
  earlierDraftObservations?: CourseraAuthoringDraftSnapshot[];
  proof: {
    item: { id: string; typeName: string; atomId: string; contentId: string };
    snapshot: Obj;
    history?: Obj[];
  };
}

function displayObservation(o: Observation): DraftSnapshotObservation {
  return {
    observedAt: o.receipt.observedAt,
    sanitizedModelSha256: o.sourceSha256,
    sanitizedModelJson: JSON.stringify(o.data, null, 2),
  };
}
function atomObservation(o: Observation): DraftSnapshotAtomObservation {
  const atom = o.data.elements[0];
  // A changed final atom may remove or change a source mode. Keep that exact
  // observation; an absent fragment has no hash and never becomes empty content.
  return {
    ...displayObservation(o),
    draftSha256: Object.prototype.hasOwnProperty.call(atom, "draft")
      ? hash(atom.draft)
      : "",
    publishedSha256: Object.prototype.hasOwnProperty.call(atom, "published")
      ? hash(atom.published)
      : "",
  };
}

function deriveRecord(
  proof: CourseraAuthoringDraftSnapshot["proof"],
  courseId: string,
): CourseraAuthoringDraftSnapshot | null {
  try {
    if (
      !bounded(proof, MAX_PROOF_CHARACTERS) ||
      canonical(proof).length > MAX_PROOF_CHARACTERS ||
      !fields(proof, ["item", "snapshot"]) ||
      !fields(proof.item, ["id", "typeName", "atomId", "contentId"])
    )
      return null;
    const p = proof.snapshot,
      item = proof.item;
    if (
      !fields(p, [
        "schemaVersion",
        "method",
        "sourceState",
        "courseId",
        "itemId",
        "courseSlug",
        "atomId",
        "contentId",
        "publishedAssignmentId",
        "sourceSha256",
        "sourceStable",
        "source",
        "inventory",
        "groups",
        "definitions",
        "failures",
        "publishedContentVerified",
        "contentCompletenessVerified",
        "wholeItemVerified",
      ]) ||
      p.schemaVersion !== 1 ||
      p.method !== "BOUND_PUBLISHED_ATOM_DRAFT_SNAPSHOT" ||
      p.sourceState !== "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM" ||
      p.courseId !== courseId ||
      !courseId ||
      p.itemId !== item.id ||
      p.atomId !== item.atomId ||
      p.contentId !== item.contentId ||
      !["staffGraded", "gradedAssignment", "ungradedAssignment"].includes(
        item.typeName,
      ) ||
      typeof p.sourceStable !== "boolean" ||
      p.publishedContentVerified !== false ||
      p.contentCompletenessVerified !== false ||
      p.wholeItemVerified !== false ||
      !fields(p.source, ["material", "initialAtom", "relation", "finalAtom"]) ||
      !Array.isArray(p.groups) ||
      p.groups.length > 100 ||
      !Array.isArray(p.definitions) ||
      p.definitions.length > 100 ||
      !Array.isArray(p.failures) ||
      p.failures.length > 301
    )
      return null;
    const initial = observation(
        p.source.initialAtom,
        "authoringAtoms.v2",
        item.atomId,
      ),
      relation = observation(
        p.source.relation,
        "authoringItemContentRelations.v1",
        item.atomId,
      );
    if (!initial || !relation) return null;
    const bound = bindDirectPublishedDraftSnapshotV1(
      item,
      courseId,
      p.courseSlug,
      p.source.material,
      initial.data,
      relation.data,
    );
    const inventory = directPublishedDraftSnapshotInventoryV1(bound);
    if (
      p.publishedAssignmentId !== bound.publishedAssignmentId ||
      p.sourceSha256 !== hash(directPublishedDraftSnapshotSourceV1(bound)) ||
      canonical(p.inventory) !== canonical(inventory)
    )
      return null;
    const initialAtom = atomObservation(initial);
    let final: Observation | null = null,
      finalAtom: DraftSnapshotAtomObservation | null = null,
      stable = false;
    if (p.source.finalAtom !== null) {
      final = observation(p.source.finalAtom, "authoringAtoms.v2", item.atomId);
      if (
        !final ||
        final.data.elements[0].contentId !== item.contentId ||
        date(final.receipt.observedAt)! <
          Math.max(
            date(initial.receipt.observedAt)!,
            date(relation.receipt.observedAt)!,
          )
      )
        return null;
      finalAtom = atomObservation(final);
      try {
        const finalBound = bindDirectPublishedDraftSnapshotV1(
          item,
          courseId,
          p.courseSlug,
          p.source.material,
          final.data,
          relation.data,
        );
        stable = directPublishedDraftSnapshotStableV1(bound, finalBound);
      } catch {
        stable = false;
      }
    }
    if (p.sourceStable !== stable) return null;
    const failures = p.failures as CourseraAuthoringDraftSnapshot["failures"],
      failure = (scope: string, id: string) =>
        failures.some((f) => f.scope === scope && f.id === id),
      sourceFailure = () =>
        failure("SOURCE", item.atomId) || failure("SOURCE", item.id);
    if (!stable && !sourceFailure()) return null;
    const candidates = new Map<string, Obj>(
        inventory.candidates.map((c: Obj) => [c.id, c]),
      ),
      groups = new Map<
        string,
        {
          initial: Observation;
          final: Observation | null;
          ids: string[] | null;
          stable: boolean;
        }
      >(),
      declaredDefinitionIds = new Set<string>();
    const firstTime = Math.max(
      date(initial.receipt.observedAt)!,
      date(relation.receipt.observedAt)!,
    );
    const lastTime = final ? date(final.receipt.observedAt)! : Infinity;
    for (const g of p.groups) {
      if (
        !fields(g, ["id", "initial", "final"]) ||
        !candidates.has(g.id) ||
        groups.has(g.id)
      )
        return null;
      const gi = observation(
        g.initial,
        "authoringAssignmentQuestionGroups.v1",
        g.id,
      );
      const gf =
        g.final === null
          ? null
          : observation(g.final, "authoringAssignmentQuestionGroups.v1", g.id);
      if (
        !gi ||
        (g.final !== null && !gf) ||
        date(gi.receipt.observedAt)! < firstTime ||
        date(gi.receipt.observedAt)! > lastTime ||
        (gf &&
          (date(gf.receipt.observedAt)! < date(gi.receipt.observedAt)! ||
            date(gf.receipt.observedAt)! > lastTime))
      )
        return null;
      const ids = directPublishedDraftSnapshotQuestionIdsV1(
        gi.data,
        g.id,
        item.atomId,
      ) as string[] | null;
      const groupStable = !!gf && canonical(gi.data) === canonical(gf.data);
      if ((!groupStable || ids === null) && !failure("GROUP", g.id))
        return null;
      for (const id of ids || []) declaredDefinitionIds.add(id);
      groups.set(g.id, { initial: gi, final: gf, ids, stable: groupStable });
    }
    const definitions = new Map<string, Observation>();
    for (const d of p.definitions) {
      if (
        !object(d) ||
        !declaredDefinitionIds.has(d.id) ||
        definitions.has(d.id)
      )
        return null;
      const observed = observation(
        d,
        "authoringAssignmentMachineEvaluableQuestions.v1",
        d.id,
        true,
      );
      if (!observed) return null;
      const t = date(observed.receipt.observedAt)!;
      // One immutable exact-version definition may be shared by groups whose
      // reads do not overlap. Its actual GET needs one owning interval witness;
      // requiring every interval would discard a legitimate deduplicated read.
      const witnessed = [...groups.values()].some(
        (group) =>
          group.ids?.includes(d.id) &&
          t >= date(group.initial.receipt.observedAt)! &&
          (!group.final || t <= date(group.final.receipt.observedAt)!),
      );
      if (t < firstTime || t > lastTime || !witnessed) return null;
      definitions.set(d.id, observed);
    }
    for (const [id] of candidates)
      if (!groups.has(id) && !failure("GROUP", id)) return null;
    for (const id of declaredDefinitionIds)
      if (!definitions.has(id) && !failure("DEFINITION", id)) return null;
    const seenFailures = new Set<string>();
    for (const f of failures) {
      if (
        !fields(f, ["scope", "id", "reason"]) ||
        !["SOURCE", "GROUP", "DEFINITION"].includes(f.scope) ||
        typeof f.reason !== "string" ||
        !f.reason ||
        f.reason.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(f.reason) ||
        (f.scope === "SOURCE"
          ? f.id !== item.atomId && f.id !== item.id
          : f.scope === "GROUP"
            ? !candidates.has(f.id)
            : !declaredDefinitionIds.has(f.id))
      )
        return null;
      const key = `${f.scope}:${f.id}:${f.reason}`;
      if (seenFailures.has(key)) return null;
      seenFailures.add(key);
    }
    const candidateOrdinals = new Map<number, string>(
      inventory.candidates.map((c: Obj) => [c.ordinal, c.id]),
    );
    const parts: DraftSnapshotPart[] = inventory.rawParts.map(
      (part: Obj, index: number) => {
        const id = candidateOrdinals.get(index + 1),
          g = id ? groups.get(id) : undefined,
          d = g?.ids?.length === 1 ? definitions.get(g.ids[0]) : undefined,
          model = d?.data.elements[0],
          choices = d ? directAssessmentQuestionProjectionV1(model) : null;
        return {
          ordinal: index + 1,
          nativeType: text(part?.typeName) || "UNKNOWN_PART_TYPE",
          nativeId: text(part?.definition?.id),
          originalPartSha256: hash(part),
          originalPartJson: JSON.stringify(part, null, 2),
          group: id
            ? {
                id,
                status: !g
                  ? "NOT_READ"
                  : !g.final
                    ? "FINAL_READ_MISSING"
                    : g.stable
                      ? "STABLE"
                      : "CHANGED",
                initial: g ? displayObservation(g.initial) : null,
                final: g?.final ? displayObservation(g.final) : null,
              }
            : null,
          definition: d
            ? {
                id: model.id,
                nativeType:
                  text(model.definition?.typeName) || "UNKNOWN_DEFINITION_TYPE",
                observedAt: d.receipt.observedAt,
                originalModelSha256: hash(model),
                originalModelJson: JSON.stringify(model, null, 2),
                readableChoices: choices
                  ? {
                      prompt: choices.prompt,
                      options: choices.options.map((o: Obj) => ({
                        id: o.id,
                        text: o.text,
                        authoredCorrect: o.correct,
                        feedback: o.feedback,
                      })),
                    }
                  : null,
              }
            : null,
        };
      },
    );
    const configuration = bound.draft.content.definition.configuration,
      isGraded = object(configuration) ? configuration.isGraded : undefined,
      projection: Omit<CourseraAuthoringDraftSnapshot, "proof"> = {
        schemaVersion: 1,
        scope: "AUTHORING_DRAFT_SNAPSHOT_ON_PUBLISHED_ATOM",
        courseId,
        itemId: item.id,
        atomId: item.atomId,
        contentId: item.contentId,
        publishedAssignmentId: p.publishedAssignmentId,
        sourceSha256: p.sourceSha256,
        sourceStability: !final
          ? "FINAL_READ_MISSING"
          : stable
            ? "STABLE"
            : "CHANGED",
        initialAtom,
        finalAtom,
        relation: displayObservation(relation),
        materialJson: JSON.stringify(p.source.material, null, 2),
        draftConfiguration: {
          isGraded: typeof isGraded === "boolean" ? isGraded : null,
          isGradedStatus:
            typeof isGraded === "boolean"
              ? "RECORDED"
              : isGraded === undefined
                ? "ABSENT"
                : "UNSUPPORTED",
          originalModelSha256:
            configuration === undefined ? "" : hash(configuration),
          originalModelJson:
            configuration === undefined
              ? ""
              : JSON.stringify(configuration, null, 2),
        },
        declaredDraftParts: inventory.declared,
        parts,
        failures,
        publishedContentVerified: false,
        contentCompletenessVerified: false,
        wholeItemVerified: false,
      };
    if (JSON.stringify(projection).length > MAX_DISPLAY_CHARACTERS) return null;
    return { ...projection, proof };
  } catch {
    return null;
  }
}

function derive(
  proof: CourseraAuthoringDraftSnapshot["proof"],
  courseId: string,
): CourseraAuthoringDraftSnapshot | null {
  try {
    if (
      !bounded(proof, MAX_AUTHORING_DRAFT_SNAPSHOT_CHARACTERS) ||
      !fields(proof, ["item", "snapshot", "history"], ["item", "snapshot"])
    )
      return null;
    const current = deriveRecord(
      { item: proof.item, snapshot: proof.snapshot },
      courseId,
    );
    if (!current) return null;
    if (!Object.prototype.hasOwnProperty.call(proof, "history")) return current;
    if (
      !Array.isArray(proof.history) ||
      proof.history.length > MAX_AUTHORING_DRAFT_SNAPSHOT_HISTORY_RECORDS
    )
      return null;
    const earlierDraftObservations: CourseraAuthoringDraftSnapshot[] = [];
    for (const raw of proof.history) {
      // Each old material leaf proves its own native type and published pointer.
      // Course/item/atom identity stays bound to the current fingerprint.
      const historicalItem = {
        ...proof.item,
        typeName: text(raw?.source?.material?.content?.typeName),
      };
      const earlier = deriveRecord(
        { item: historicalItem, snapshot: raw },
        courseId,
      );
      if (
        !earlier ||
        earlier.courseId !== current.courseId ||
        earlier.itemId !== current.itemId ||
        earlier.atomId !== current.atomId ||
        earlier.contentId !== current.contentId
      )
        return null;
      earlierDraftObservations.push(earlier);
    }
    const result = { ...current, earlierDraftObservations, proof };
    if (JSON.stringify(result).length > MAX_AUTHORING_DRAFT_SNAPSHOT_CHARACTERS)
      return null;
    return result;
  } catch {
    return null;
  }
}

/** Supplemental authoring evidence only. This never supplies primary questions,
 * current published bodies, empty verification, or a completion assertion. */
export function courseraAuthoringDraftSnapshot(
  item: unknown,
  courseId: string,
): CourseraAuthoringDraftSnapshot | null {
  if (!object(item) || !object(item.payload)) return null;
  return derive(
    {
      item: {
        id: item.id,
        typeName: item.typeName,
        atomId: item.atomId,
        contentId: item.contentId,
      },
      snapshot: item.payload.directAuthoringDraftSnapshot,
      ...(item.payload.directAuthoringDraftSnapshotHistory === undefined
        ? {}
        : {
            history: item.payload.directAuthoringDraftSnapshotHistory,
          }),
    },
    courseId,
  );
}
export function courseraAuthoringDraftSnapshotSize(value: unknown): number {
  if (!bounded(value, MAX_AUTHORING_DRAFT_SNAPSHOT_CHARACTERS))
    throw Error("Coursera draft snapshot exceeds the review limit.");
  const serialized = JSON.stringify(value);
  if (
    typeof serialized !== "string" ||
    serialized.length > MAX_AUTHORING_DRAFT_SNAPSHOT_CHARACTERS
  )
    throw Error("Coursera draft snapshot exceeds the review limit.");
  return serialized.length;
}
export function validateCourseraAuthoringDraftSnapshot(
  value: unknown,
  itemId: string,
  expectedCourseId: string,
): asserts value is CourseraAuthoringDraftSnapshot {
  courseraAuthoringDraftSnapshotSize(value);
  const result = object(value) && derive(value.proof, expectedCourseId);
  if (
    !result ||
    result.itemId !== itemId ||
    result.courseId !== expectedCourseId ||
    canonical(value) !== canonical(result)
  )
    throw Error(
      "Coursera draft snapshot does not match its bound native source observations.",
    );
}
function recordText(
  snapshot: CourseraAuthoringDraftSnapshot,
  earlier = false,
): string {
  return [
    earlier
      ? "EARLIER DRAFT OBSERVATION; CURRENT PUBLISHED BODY UNVERIFIED"
      : "DRAFT SNAPSHOT ON PUBLISHED ITEM; CURRENT PUBLISHED BODY UNVERIFIED",
    earlier
      ? "This historical draft observation does not establish the current authoring draft, current published questions, complete coverage, answer-key validity or learner behavior."
      : "This separate authoring draft does not establish current published questions, complete coverage, answer-key validity or learner behavior.",
    `Initial atom observed ${snapshot.initialAtom.observedAt} | final atom observed ${snapshot.finalAtom?.observedAt || "not acquired"}`,
    `Course ${snapshot.courseId} | item ${snapshot.itemId} | atom ${snapshot.atomId} | published assignment pointer ${snapshot.publishedAssignmentId}`,
    `Atom source stability: ${snapshot.sourceStability} | source SHA-256 ${snapshot.sourceSha256}`,
    `Initial draft SHA-256 ${snapshot.initialAtom.draftSha256} | retained published-model SHA-256 ${snapshot.initialAtom.publishedSha256}`,
    `Draft isGraded: ${snapshot.draftConfiguration.isGradedStatus === "RECORDED" ? String(snapshot.draftConfiguration.isGraded) : snapshot.draftConfiguration.isGradedStatus.toLowerCase()}`,
    ...snapshot.parts.flatMap((part) => [
      `Draft part ${part.ordinal} | ${part.nativeType} | ${part.nativeId}`,
      ...(part.group
        ? [
            `Draft group ${part.group.id} | ${part.group.status}`,
            ...(part.group.initial
              ? [
                  "Literal initial sanitized group model:",
                  part.group.initial.sanitizedModelJson,
                ]
              : []),
            ...(part.group.final
              ? [
                  "Literal final sanitized group model:",
                  part.group.final.sanitizedModelJson,
                ]
              : []),
          ]
        : []),
      ...(part.definition
        ? [
            `Retained draft definition ${part.definition.id} | ${part.definition.nativeType} | canonical model SHA-256 ${part.definition.originalModelSha256}`,
            "Literal retained draft definition:",
            part.definition.originalModelJson,
          ]
        : [
            "No acquired, owned machine-evaluable definition for this draft part.",
          ]),
      "Literal retained draft part:",
      part.originalPartJson,
    ]),
    ...snapshot.failures.map(
      (f) => `Unresolved ${f.scope.toLowerCase()} ${f.id}: ${f.reason}`,
    ),
    "Literal retained draft configuration:",
    snapshot.draftConfiguration.originalModelJson || "[not recorded]",
    "Literal initial sanitized atom model:",
    snapshot.initialAtom.sanitizedModelJson,
    ...(snapshot.finalAtom
      ? [
          "Literal final sanitized atom model:",
          snapshot.finalAtom.sanitizedModelJson,
        ]
      : []),
    "Literal native material item:",
    snapshot.materialJson,
    "Literal sanitized native relation:",
    snapshot.relation.sanitizedModelJson,
  ].join("\n");
}

export function courseraAuthoringDraftSnapshotText(
  snapshot: CourseraAuthoringDraftSnapshot,
): string {
  return [
    recordText(snapshot),
    ...(snapshot.earlierDraftObservations || []).map((earlier) =>
      recordText(earlier, true),
    ),
  ].join("\n\n");
}
