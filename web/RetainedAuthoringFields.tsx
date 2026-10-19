import {
  retainedAuthoringFields,
  type AuthoredField,
  type RetainedAuthoringFieldsView,
} from "../src/domain/coursera-retained-authoring-fields.ts";
import type { RetainedAuthoringBlock } from "../src/domain/coursera-retained-authoring-content.ts";

function Field({ label, field }: { label: string; field: AuthoredField }) {
  return (
    <div>
      <strong>{label}</strong>
      {field.status === "PRESENT" ? (
        <pre className="captured-text">
          {typeof field.value === "boolean" ? String(field.value) : field.value}
        </pre>
      ) : field.status === "EXPLICIT_EMPTY_SOURCE" ? (
        <p className="hint">Explicitly empty in captured source.</p>
      ) : field.status === "EXPLICIT_EMPTY" ? (
        <p className="hint">
          {field.kind === "CML"
            ? "Explicitly empty supported CML text."
            : "Explicitly empty string."}
        </p>
      ) : field.status === "NOT_RECORDED" ? (
        <p className="hint">Not recorded in this native model.</p>
      ) : (
        <>
          <p className="hint">
            {field.status === "UNSUPPORTED_CML"
              ? "Unsupported CML; no readable text has been invented."
              : "Unsupported native field type."}
          </p>
          <details>
            <summary>Literal source field</summary>
            {field.dtdId !== undefined && (
              <p className="hint">
                Recorded DTD: {JSON.stringify(field.dtdId)}
              </p>
            )}
            <pre className="captured-text">{field.literal}</pre>
          </details>
        </>
      )}
    </div>
  );
}

/** Caller supplies a validated source block or a view derived from separately
 * validated source proof. Source strings are rendered as inert React text. */
export function RetainedAuthoringFields({
  block,
  view,
  showSourceDetails = false,
}: {
  block?: RetainedAuthoringBlock;
  view?: RetainedAuthoringFieldsView;
  showSourceDetails?: boolean;
}) {
  const fields = view ?? (block ? retainedAuthoringFields(block) : null);
  if (!fields) return null;
  return (
    <section
      className="scope"
      aria-label={"Authored source fields for retained part " + fields.ordinal}
    >
      <h6>
        {fields.kind === "TEXT_BLOCK"
          ? "Authored instruction fields"
          : fields.nativeType === "textExactMatch"
            ? "Authored text-answer fields"
            : fields.sourceDefect ? "Captured source defect" : "Authored reflection fields"}
      </h6>
      <p className="hint">{fields.applicabilityReason}</p>
      {fields.sourceDefect && <>
        <p className="hint">Explicitly empty option displays: {fields.sourceDefect.emptyOptionOrdinals.join(", ")}. This is an observed source field, not a missing download.</p>
        <Field label="Native correct-option ID · SOURCE_REFERENCE" field={fields.sourceDefect.nativeCorrectOption} />
        <p className="hint">The reference identifies a native option only. Usable answer text remains unverified; inspect and correct the source if required.</p>
      </>}
      {fields.kind === "TEXT_BLOCK" ? (
        <>
          <Field label="Authored title" field={fields.title} />
          <Field label="Instruction body" field={fields.prompt} />
        </>
      ) : (
        <Field label="Authored prompt" field={fields.prompt} />
      )}
      {fields.nativeType === "textExactMatch" && (
        <>
          {!fields.answerRecords.length && (
            <p className="hint">
              Authored answer records:{" "}
              {fields.answerRecordsStatus === "EXPLICIT_EMPTY"
                ? "explicitly empty array"
                : fields.answerRecordsStatus === "NOT_RECORDED"
                  ? "not recorded"
                  : "unsupported native value"}
              .
            </p>
          )}
          {fields.answerRecords.map((record) => (
            <div key={record.ordinal}>
              <h6>Authored answer record {record.ordinal}</h6>
              <Field label="Native record ID" field={record.id} />
              <Field label="Literal authored answer" field={record.answer} />
              <Field label="Native isCorrect field" field={record.isCorrect} />
              <Field label="Authored feedback" field={record.feedback} />
            </div>
          ))}
          <Field
            label="Default incorrect feedback"
            field={fields.defaultIncorrectFeedback}
          />
        </>
      )}
      {fields.kind !== "TEXT_BLOCK" &&
        fields.nativeType !== "textExactMatch" && (
          <>
            {!fields.options.length && (
              <p className="hint">
                {fields.sourceDefect ? "Captured source options:" : "Authored reflection options:"}{" "}
                {fields.optionsStatus === "EXPLICIT_EMPTY"
                  ? "explicitly empty array"
                  : fields.optionsStatus === "NOT_RECORDED"
                    ? "not recorded"
                    : "unsupported native value"}
                .
              </p>
            )}
            {fields.options.map((option) => (
              <div key={option.ordinal}>
                <h6>{fields.sourceDefect ? "Captured source option" : "Authored reflection option"} {option.ordinal}</h6>
                <Field label="Native option ID" field={option.id} />
                <Field label="Authored display" field={option.display} />
                <Field label="Authored feedback" field={option.feedback} />
              </div>
            ))}
            <Field
              label="No-selection feedback"
              field={fields.noChosenFeedback}
            />
            <Field
              label="Native shuffleOptions field"
              field={fields.shuffleOptions}
            />
          </>
        )}
      {showSourceDetails && (
        <details>
          <summary>Literal original native model</summary>
          <p className="hint">
            Native identity: {fields.nativeId}
            <br />
            Original model SHA-256: {fields.originalModelSha256}
          </p>
          <pre className="captured-text">{fields.originalModelJson}</pre>
        </details>
      )}
    </section>
  );
}
