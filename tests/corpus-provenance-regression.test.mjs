import test from "node:test";
import assert from "node:assert/strict";
import {
  qaParseSmartIngestionIntelligence_,
  qaLocalizeNamedIngestionClaims_,
  qaSmartIngestionClaimsForSource_,
} from "../src/engine/provenance/claims.js";

function parse(text) {
  return qaParseSmartIngestionIntelligence_([
    {
      id: "aar",
      name: "Author Alignment Report",
      textSample:
        "Smart Ingestion Module: Module 1 Item: Percentage Quiz " + text,
    },
  ]);
}

test("a uniquely named assessment claim does not leak to its shorter sibling title", () => {
  const sources = [
    { id: "reading", name: "Decimals", path: "Module 1" },
    { id: "quiz", name: "Decimals Practice Assessment", path: "Module 1" },
  ];
  const input = {
    claims: [
      {
        type: "UNRESOLVED_SOURCE_ASSET",
        subject: sources[1].name,
        pathHint: "Module 1",
        excerpt: "The embedded asset could not be represented.",
      },
    ],
  };
  const before = JSON.stringify(input);
  const localized = qaLocalizeNamedIngestionClaims_(input, sources);
  assert.equal(
    qaSmartIngestionClaimsForSource_(sources[0], localized).length,
    0,
  );
  assert.equal(
    qaSmartIngestionClaimsForSource_(sources[1], localized).length,
    1,
  );
  assert.equal(JSON.stringify(input), before);
});

test("explicitly unspecified thresholds and timing estimates do not claim generated grading behavior", () => {
  for (const text of [
    "Generated an estimated time commitment of 3 minutes because no duration was present. Set the passing threshold to null because the source item did not indicate whether it is graded or specify a passing score.",
    "Set the estimated time commitment to 3 minutes and left the passing threshold unspecified (null) because the source assignment is optional, ungraded, and provides no duration or grading information.",
    "Generated an estimated time commitment of 3 minutes because the source practice quiz is ungraded.",
  ]) {
    const result = parse("AI-Generated Mandatory Field " + text);
    assert.equal(
      result.claims.filter((c) => c.type === "GENERATED_BEHAVIOR").length,
      0,
      text,
    );
  }
});

test("concrete generated thresholds, rubrics and graders remain reviewable, including mixed null events", () => {
  for (const text of [
    "Set the passing threshold to 80% because the source did not specify a passing score.",
    "Set the grader type to AI because the source system did not specify a grading mode.",
    "Left the passing threshold unspecified (null) and generated a rubric because the source did not specify one.",
    "Set the passing threshold to null because the source did not specify one. Generated a rubric for the assignment.",
    "Set the passing threshold to null because the source did not specify one; generated a rubric for the assignment.",
    "Set the passing threshold to null because the source did not specify one and generated a rubric for the assignment.",
  ])
    assert.ok(
      parse("AI-Generated Mandatory Field " + text).claims.some(
        (c) => c.type === "GENERATED_BEHAVIOR",
      ),
      text,
    );
});
