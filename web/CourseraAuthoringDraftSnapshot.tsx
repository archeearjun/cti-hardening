import type {
  CourseraAuthoringDraftSnapshot,
  DraftSnapshotObservation,
} from "../src/domain/coursera-authoring-draft-snapshot.js";
import { retainedRawAuthoringFields } from "../src/domain/coursera-retained-authoring-fields.js";
import { RetainedAuthoringFields } from "./RetainedAuthoringFields.js";

function OriginalObservation({
  label,
  observation,
}: {
  label: string;
  observation: DraftSnapshotObservation;
}) {
  return (
    <details>
      <summary>{label}</summary>
      <p className="hint">
        Observed: {observation.observedAt}
        <br />
        Sanitized model SHA-256: {observation.sanitizedModelSha256}
      </p>
      <pre className="captured-text">{observation.sanitizedModelJson}</pre>
    </details>
  );
}

/** Receives a domain-validated supplemental snapshot. All native strings remain
 * inert React text; this component does not add primary questions or counts. */
function DraftSnapshotRecordView({
  snapshot,
  earlier = false,
}: {
  snapshot: CourseraAuthoringDraftSnapshot;
  earlier?: boolean;
}) {
  const config = snapshot.draftConfiguration;
  return (
    <section
      className="scope"
      aria-label={
        earlier
          ? "Earlier draft observation"
          : "Draft snapshot on published item"
      }
    >
      <h6>
        {earlier
          ? "Earlier draft observation; current published body unverified"
          : "Draft snapshot on published item; current published body unverified"}
      </h6>
      <p className="hint">
        {earlier
          ? "This historical observation does not establish the current authoring draft. Its retained definitions stay separate from "
          : "This is the attached authoring draft. Its definitions stay separate from "}
        the current published assignment and the main question count. Complete
        coverage, answer-key validity and learner behavior remain unverified.
      </p>
      {earlier && (
        <p className="hint">
          Earlier initial atom observation: {snapshot.initialAtom.observedAt}.
          Earlier final atom observation:{" "}
          {snapshot.finalAtom?.observedAt || "not acquired"}.
        </p>
      )}
      <p className="hint">
        Draft source check:{" "}
        {snapshot.sourceStability === "STABLE"
          ? "unchanged between the initial and final atom reads"
          : snapshot.sourceStability === "CHANGED"
            ? "changed during capture; inspect both retained observations"
            : "final atom read missing; retained observations are partial"}
        . This check does not establish published content or stable question
        groups.
      </p>
      <p>
        <strong>Draft isGraded:</strong>{" "}
        {config.isGradedStatus === "RECORDED"
          ? String(config.isGraded)
          : config.isGradedStatus === "ABSENT"
            ? "not recorded"
            : "unsupported native value"}
      </p>
      <details>
        <summary>Literal draft configuration</summary>
        <pre className="captured-text">
          {config.originalModelJson || "Not recorded in this native draft."}
        </pre>
      </details>
      {!snapshot.parts.length && (
        <p className="hint">
          The retained draft parts array is explicitly empty. The current
          published assignment has not been verified empty.
        </p>
      )}
      {snapshot.parts.map((part) => {
        const d = part.definition;
        const typed = d
          ? retainedRawAuthoringFields(d.originalModelJson, {
              kind: "QUESTION_DEFINITION",
              nativeType: d.nativeType,
              nativeId: d.id,
              ordinal: part.ordinal,
              originalModelSha256: d.originalModelSha256,
            })
          : part.nativeType === "storedTextBlockPart"
            ? retainedRawAuthoringFields(part.originalPartJson, {
                kind: "TEXT_BLOCK",
                nativeType: part.nativeType,
                nativeId: part.nativeId,
                ordinal: part.ordinal,
                originalModelSha256: part.originalPartSha256,
              })
            : null;
        return (
          <details key={part.ordinal}>
            <summary>
              Draft part {part.ordinal} · {d?.nativeType || part.nativeType}
            </summary>
            {part.group && (
              <p className="hint">
                Draft group: {part.group.id}
                <br />
                Group observation:{" "}
                {part.group.status === "STABLE"
                  ? "unchanged between its two reads"
                  : part.group.status === "CHANGED"
                    ? "changed; the initial definition is retained as a separate observation"
                    : part.group.status === "FINAL_READ_MISSING"
                      ? "final read missing"
                      : "not acquired"}
                .
              </p>
            )}
            {typed && <RetainedAuthoringFields view={typed} />}
            {d?.readableChoices && (
              <section
                aria-label={`Retained draft choice fields for part ${part.ordinal}`}
              >
                <p className="hint">
                  These are authored draft choices and literal draft correctness
                  references. They do not establish the current published
                  question or validate the answer key.
                </p>
                <pre className="captured-text">{d.readableChoices.prompt}</pre>
                <ul>
                  {d.readableChoices.options.map((option) => (
                    <li key={option.id}>
                      <strong>{option.id}: </strong>
                      <span className="captured-text">{option.text}</span>
                      <p className="hint">
                        Referenced as correct in this draft:{" "}
                        {String(option.authoredCorrect)}
                      </p>
                      {option.feedback && (
                        <pre className="captured-text">{option.feedback}</pre>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!d && part.group && (
              <p className="hint">
                No acquired, owned machine-evaluable definition for this draft
                part. Inspect the retained observations and unresolved records.
              </p>
            )}
            {d && (
              <details>
                <summary>Literal retained draft definition</summary>
                <p className="hint">
                  Native definition: {d.id}
                  <br />
                  Observed: {d.observedAt}
                  <br />
                  Canonical model SHA-256: {d.originalModelSha256}
                </p>
                <pre className="captured-text">{d.originalModelJson}</pre>
              </details>
            )}
            <details>
              <summary>Literal retained draft part</summary>
              <pre className="captured-text">{part.originalPartJson}</pre>
            </details>
            {part.group?.initial && (
              <OriginalObservation
                label="Initial sanitized draft group model"
                observation={part.group.initial}
              />
            )}
            {part.group?.final && (
              <OriginalObservation
                label="Final sanitized draft group model"
                observation={part.group.final}
              />
            )}
          </details>
        );
      })}
      {!!snapshot.failures.length && (
        <details>
          <summary>
            Unresolved draft snapshot observations ({snapshot.failures.length})
          </summary>
          <ul>
            {snapshot.failures.map((failure, index) => (
              <li key={index}>
                {failure.scope.toLowerCase()} {failure.id}: {failure.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Native snapshot identity and source observations</summary>
        <p className="hint">
          Course: {snapshot.courseId}
          <br />
          Item: {snapshot.itemId}
          <br />
          Authoring atom: {snapshot.atomId}
          <br />
          Published assignment pointer: {snapshot.publishedAssignmentId}
          <br />
          Bound source SHA-256: {snapshot.sourceSha256}
          <br />
          Initial full draft SHA-256: {snapshot.initialAtom.draftSha256}
          <br />
          Initial retained published model SHA-256:{" "}
          {snapshot.initialAtom.publishedSha256}
        </p>
        <OriginalObservation
          label="Initial sanitized atom model"
          observation={snapshot.initialAtom}
        />
        {snapshot.finalAtom && (
          <OriginalObservation
            label="Final sanitized atom model"
            observation={snapshot.finalAtom}
          />
        )}
        <OriginalObservation
          label="Sanitized native item relation"
          observation={snapshot.relation}
        />
        <details>
          <summary>Literal native material item</summary>
          <pre className="captured-text">{snapshot.materialJson}</pre>
        </details>
      </details>
    </section>
  );
}

export function CourseraAuthoringDraftSnapshotView({
  snapshot,
}: {
  snapshot: CourseraAuthoringDraftSnapshot;
}) {
  return (
    <>
      <DraftSnapshotRecordView snapshot={snapshot} />
      {!!snapshot.earlierDraftObservations?.length && (
        <details>
          <summary>
            Earlier draft observations (
            {snapshot.earlierDraftObservations.length})
          </summary>
          <p className="hint">
            These immutable earlier observations retain their own native source
            proof and acquisition times. They do not replace this attempt or
            establish current content.
          </p>
          {snapshot.earlierDraftObservations.map((earlier, index) => (
            <DraftSnapshotRecordView key={index} snapshot={earlier} earlier />
          ))}
        </details>
      )}
    </>
  );
}
