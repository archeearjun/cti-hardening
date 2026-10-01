export interface ExternalRuntimeEvidence {
  checked: boolean;
  required: boolean;
  riseCount: number;
  storylineCount: number;
  source: string;
  warning: string;
  titleKey: string;
  courseCode?: string;
  title?: string;
  linkLabel?: string;
  capturedAt: string;
}

const count = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new Error("Runtime counts must be non-negative numbers.");
  return Math.floor(number);
};

export function validateExternalRuntimeEvidence(
  value: unknown,
): ExternalRuntimeEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Runtime inventory must be a JSON object.");
  const input = value as Record<string, unknown>;
  const riseCount = count(input.riseCount ?? 0);
  const storylineCount = count(input.storylineCount ?? 0);
  const checked = input.checked !== false;
  const required =
    input.required === true || (checked && riseCount + storylineCount > 0);
  const capturedAt = String(input.capturedAt || new Date().toISOString());
  if (!Number.isFinite(Date.parse(capturedAt)))
    throw new Error("Runtime inventory capturedAt must be a valid date.");
  return {
    checked,
    required,
    riseCount,
    storylineCount,
    source: String(input.source || "Imported runtime inventory").slice(0, 300),
    warning: String(input.warning || "").slice(0, 2000),
    titleKey: String(input.titleKey || "").slice(0, 300),
    courseCode: String(input.courseCode || "").slice(0, 120),
    title: String(input.title || "").slice(0, 500),
    linkLabel: String(input.linkLabel || "").slice(0, 500),
    capturedAt: new Date(capturedAt).toISOString(),
  };
}

export async function readExternalRuntimeEvidenceFile(
  file: File,
): Promise<ExternalRuntimeEvidence> {
  if (!file.size || file.size > 1024 * 1024)
    throw new Error("Choose a non-empty runtime inventory JSON up to 1 MiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Runtime inventory is not valid JSON.");
  }
  return validateExternalRuntimeEvidence(parsed);
}
