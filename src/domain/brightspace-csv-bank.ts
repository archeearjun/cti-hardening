import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ContentQuestion } from "./content-evidence.ts";

export interface BrightspaceCsvSource {
  topicId: string;
  url: string;
  originalRef: string;
  bytes: number;
}
export interface BrightspaceCsvBank {
  schemaVersion: 1;
  format: "BRIGHTSPACE_NEWQUESTION_MC_LINES_V1";
  scope: "SOURCE_FILE_BANK";
  nativeQuizMembership: "UNVERIFIED";
  source: BrightspaceCsvSource & { rawText: string };
  status: "COMPLETE" | "PARTIAL" | "UNVERIFIED";
  encounteredQuestions: number;
  gaps: { line: number; ordinal: number; reason: string }[];
  omittedGaps: number;
}
export const BRIGHTSPACE_CSV_BANK_BASIS =
  "Original Brightspace CSV bank; deployed quiz membership unverified";
const MAX_TEXT = 300000;
const MAX_QUESTIONS = 5000;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function validSource(source: BrightspaceCsvSource, rawText: string) {
  if (rawText.length > MAX_TEXT) return false;
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return false;
  }
  const bytes = new TextEncoder().encode(rawText);
  return (
    /^[0-9]{1,30}$/.test(source.topicId) &&
    ["https:", "http:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    /\.csv$/i.test(url.pathname) &&
    !url.hash &&
    /^[a-f0-9]{64}$/.test(source.originalRef) &&
    Number.isSafeInteger(source.bytes) &&
    source.bytes >= 0 &&
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) ===
      rawText &&
    bytes.length === source.bytes &&
    bytesToHex(sha256(bytes)) === source.originalRef
  );
}

/** This is a bounded observed line dialect, not a general CSV repairer. Only
 * complete MC blocks are projected. Interior quotes and markup stay literal;
 * quoted-column boundaries, multiline fields and unsupported records are gaps. */
export function deriveBrightspaceCsvBank(
  rawText: string,
  source: BrightspaceCsvSource,
): { bank: BrightspaceCsvBank; questions: ContentQuestion[] } | undefined {
  if (typeof rawText !== "string" || !validSource(source, rawText))
    throw Error(
      "Brightspace CSV bank requires exact retained UTF-8 original identity.",
    );
  const lines = rawText.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!lines.some((line) => /^NewQuestion,/.test(line))) return undefined;
  const questions: ContentQuestion[] = [],
    gaps: BrightspaceCsvBank["gaps"] = [];
  let encounteredQuestions = 0;
  let omittedGaps = 0;
  let block:
    | {
        ordinal: number;
        line: number;
        prompt?: string;
        options: { text: string; weight: number }[];
        invalid: boolean;
      }
    | undefined;
  const gap = (line: number, reason: string) => {
    if (gaps.length < MAX_QUESTIONS)
      gaps.push({ line, ordinal: block?.ordinal || 0, reason });
    else omittedGaps++;
    if (block) block.invalid = true;
  };
  const finish = () => {
    if (!block) return;
    if (
      !block.invalid &&
      (block.prompt === undefined ||
        block.options.length !== 4 ||
        block.options.filter((option) => option.weight === 100).length !== 1)
    )
      gap(block.line, "Incomplete MC block or unsupported answer weights.");
    if (!block.invalid) {
      const identity = `cti-brightspace-csv:${source.topicId}:${source.originalRef}:${block.ordinal}`;
      questions.push({
        id: identity,
        ordinal: String(block.ordinal),
        type: "single-select",
        prompt: block.prompt!,
        options: block.options.map((option, index) => ({
          id: `${identity}:option:${index + 1}`,
          text: option.text,
        })),
        answers: block.options
          .filter((option) => option.weight === 100)
          .map((option) => option.text),
        feedback: "",
        media: [],
        limitations: [
          "Source-file question and choice IDs derive from the retained file and record ordinal; they are not native quiz question IDs.",
          "Source-marked answer weights are retained evidence, not independent confirmation that the answer is correct.",
          "Deployed quiz membership, random pools, learner behavior and source-library completeness remain unverified.",
        ],
        answerCoverage: "CAPTURED",
        feedbackCoverage: "NONE_AUTHORED",
        answerKeyReliable: true,
        sourceFile: {
          ...source,
          ordinal: block.ordinal,
          identityBasis: "SOURCE_FILE_ORDINAL",
        },
      });
    }
    block = undefined;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^NewQuestion,/.test(line)) {
      finish();
      encounteredQuestions++;
      block = {
        ordinal: encounteredQuestions,
        line: index + 1,
        options: [],
        invalid: false,
      };
      if (encounteredQuestions > MAX_QUESTIONS) {
        gap(index + 1, "Source-file question limit reached.");
        break;
      }
      if (line !== "NewQuestion,MC,")
        gap(index + 1, "Unsupported NewQuestion record.");
      continue;
    }
    if (line === "") {
      finish();
      continue;
    }
    if (!block) {
      gap(index + 1, "Record outside a supported question block.");
      continue;
    }
    const prompt = /^QuestionText,"(.*)",?$/.exec(line),
      option = /^Option,(0|100),"(.*)",?$/.exec(line),
      payload = prompt?.[1] ?? option?.[2];
    if (
      payload === undefined ||
      payload === "" ||
      payload.length > 100000 ||
      payload.includes("\r") ||
      payload.includes('""') ||
      (payload.match(/"/g) || []).length % 2 !== 0 ||
      /"\s*,[^"]*"/.test(payload)
    ) {
      gap(index + 1, "Unsupported or ambiguous physical-line record.");
    } else if (prompt) {
      if (block.prompt !== undefined || block.options.length)
        gap(index + 1, "QuestionText record is repeated or out of order.");
      else block.prompt = payload;
    } else if (option) {
      if (block.prompt === undefined || block.options.length >= 4)
        gap(
          index + 1,
          "Option record is out of order or exceeds the supported four choices.",
        );
      else block.options.push({ text: payload, weight: Number(option[1]) });
    }
  }
  finish();
  return {
    bank: {
      schemaVersion: 1,
      format: "BRIGHTSPACE_NEWQUESTION_MC_LINES_V1",
      scope: "SOURCE_FILE_BANK",
      nativeQuizMembership: "UNVERIFIED",
      source: { ...source, rawText },
      status: gaps.length
        ? questions.length
          ? "PARTIAL"
          : "UNVERIFIED"
        : "COMPLETE",
      encounteredQuestions,
      gaps,
      omittedGaps,
    },
    questions,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object(value)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

/** Rehash the exact original text and independently recompute every projected
 * question, source key, gap and derived identity when loading a saved view. */
export function validateBrightspaceCsvBank(
  value: unknown,
  source: BrightspaceCsvSource,
  questions: unknown,
): asserts value is BrightspaceCsvBank {
  const input = object(value),
    retained = object(input.source);
  if (typeof retained.rawText !== "string")
    throw Error("Invalid saved Brightspace CSV bank original.");
  const expected = deriveBrightspaceCsvBank(retained.rawText, source);
  if (
    !expected ||
    canonical(input) !== canonical(expected.bank) ||
    canonical(questions) !== canonical(expected.questions)
  )
    throw Error(
      "Saved Brightspace CSV bank differs from its retained original records.",
    );
}
