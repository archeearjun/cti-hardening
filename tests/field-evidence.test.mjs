import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { buildPostQaText_ } from "../src/reporting/owner-report.js";
import { DOMParser as SourceDOMParser } from "@xmldom/xmldom";
import { createBrightspaceContentReader } from "../src/extractors/brightspace/content-reader.js";
const require = createRequire(import.meta.url),
  qa = require("../tools/check.cjs");
const {
  fixture,
  El,
  functionCode,
} = require("../tools/assessment-fixture.cjs");
const plain = (x) => JSON.parse(JSON.stringify(x));
const duplicate =
  "1516′′ 1\\frac{5}{16}'' 1165\u200b′′1, start fraction, 5, divided by, 16, end fraction, start superscript, prime, prime, end superscript";
test("Math representation equivalence preserves the value, unit, exponent and fraction", () => {
  for (const [a, b] of [
    ["512 cm3", "512 cm^3"],
    ["27 m³", "27 m^3"],
    ["\\( 1\\frac{5}{16}'' \\)", duplicate],
  ]) {
    assert.equal(qa.qaAssessmentFieldSimilarity_(a, b), 1, `${a} -> ${b}`);
    assert.equal(
      qa.qaOptionSemanticSimilarity_({ text: a }, { text: b }).score,
      1,
    );
  }
  for (const [a, b] of [
    ["512 cm^3", "512 cm^2"],
    ["27 m3", "27 cm3"],
    ["27 m3", "28 m3"],
    ["-1", "1"],
    ["0.25", "0.025"],
    ["1\\frac{5}{16}''", "\\frac{15}{16}''"],
    ["1\\frac{5}{16}''", "1\\frac{3}{16}''"],
  ]) {
    assert.equal(qa.qaAssessmentFieldSimilarity_(a, b), 0, `${a} != ${b}`);
    assert.equal(
      qa.qaOptionSemanticSimilarity_({ text: a }, { text: b }).score,
      0,
    );
  }
  assert.equal(
    qa.qaAssessmentMathKey_(duplicate.replace("1165", "1163")),
    null,
  );
  assert.equal(
    qa.qaAssessmentMathKey_(
      duplicate.replace("divided by, 16", "divided by, 18"),
    ),
    null,
  );
  assert.equal(qa.qaAssessmentMathKey_("Choose " + duplicate), null);
  assert.equal(qa.qaAssessmentMathKey_("x2"), null);
});
test("Math comparison repairs representation only, without overwriting capture bytes or correctness", () => {
  const q = (text) => ({
    id: "1",
    type: "single-select",
    prompt: "What is the volume?",
    options: [
      { text, correct: true },
      { text: "22 cm3", correct: false },
    ],
    correctAnswers: [text],
    answerTextReliable: true,
  });
  const assessment = (question) => ({
    declaredQuestionCount: 1,
    parserConfidence: 1,
    questions: [question],
  });
  const source = {
    isStructuredAssessment: true,
    structuredAssessment: assessment(q("512 cm3")),
  };
  const destination = { structuredAssessment: assessment(q("512 cm^3")) },
    before = JSON.stringify(destination);
  assert.equal(
    qa.qaStructuredAssessmentComparison_(source, destination).status,
    "VERIFIED",
  );
  assert.equal(JSON.stringify(destination), before);
  destination.structuredAssessment.questions[0] = q("512 cm^2");
  assert.equal(
    qa.qaStructuredAssessmentComparison_(source, destination)
      .answerMismatchCount,
    1,
  );
});
test("Option DOM reads TeX once and retains superscript meaning", () => {
  const f = fixture({ count: 1 }),
    row = new El("div"),
    math = new El("span", { class: "katex" });
  const annotation = new El(
    "annotation",
    { encoding: "application/x-tex" },
    "1\\frac{5}{16}''",
  );
  math.append(
    new El("span", {}, "1516"),
    annotation,
    new El("span", {}, "1165 start fraction"),
  );
  row.append(math);
  assert.equal(f.c.optionDomTextV6136(row), "1\\frac{5}{16}''");
  row.replaceChildren(new El("span", {}, "512 cm"), new El("sup", {}, "3"));
  assert.equal(f.c.optionDomTextV6136(row), "512 cm^3");
  const prose = new El("span", { "aria-label": "512 cm^3" }, "512 cm^2");
  row.replaceChildren(prose);
  assert.equal(f.c.optionDomTextV6136(row), "512 cm^2");
});
test("Production discussion field accepts a short prompt and retains authored Prompt text", () => {
  const f = fixture({ count: 1 });
  for (const name of [
    "isDiscussionFingerprintV6612",
    "cleanDiscussionPromptTextV6612",
    "normalizeDiscussionBodyEvidenceV6612",
    "collectSurfaceBodyText",
  ])
    vm.runInContext(functionCode(name), f.c);
  const wrapper = new El("div", { class: "rc-DiscussionPromptBodyEditor" }),
    field = new El("textarea");
  f.content.append(wrapper);
  wrapper.append(field);
  const fp = { typeName: "discussionPrompt", name: "Introduction" };
  for (const text of [
    "Take a moment to introduce yourself and why you chose this course or program.",
    "Why?",
    "Prompt a discussion about your goal.",
    "",
  ]) {
    field.value = text;
    const result = f.c.normalizeDiscussionBodyEvidenceV6612(
      fp,
      f.c.collectSurfaceBodyText(field, fp),
    );
    assert.equal(result.text, text);
    assert.equal(result.scopeKind, "discussion-prompt-field");
    assert.equal(result.completeness, text ? 1 : 0);
  }
  field.value = "a".repeat(25000);
  const truncated = f.c.collectSurfaceBodyText(field, fp);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.completeness, 0);
  assert.equal(truncated.text.length, 24000);
});
const bs = qa.ctiCanonicalBrightspaceExtractorSource_();
function bsFunction(name) {
  const re = /^  (?:async )?function (\w+)\(/gm,
    all = [...bs.matchAll(re)],
    i = all.findIndex((x) => x[1] === name);
  assert(i >= 0, name);
  return bs.slice(all[i].index, all[i + 1].index);
}
test("Brightspace and QA recognize described question types without inferring pool sizes", () => {
  const c = {};
  vm.createContext(c);
  vm.runInContext(bsFunction("ctiDeclaredQuizCountFromText_"), c);
  for (const [text, expected] of [
    ["This assessment consists of 24 short answer questions.", 24],
    ["A 15-question exam", 15],
    ["This quiz has 33 short answer questions.", 33],
    ["There are 10 true/false, short answer, and matching questions.", 10],
    ["25 questions", 25],
    ["Answer 5 of 20 questions", null],
    ["Draw from a bank of 60 questions", null],
    ["10 multiple-choice questions and 5 essay questions", null],
    ["This quiz has 10 questions. You have 30 minutes.", 10],
  ]) {
    assert.equal(qa.ctiDeclaredQuizCountFromText_(text), expected, text);
    assert.equal(c.ctiDeclaredQuizCountFromText_(text), expected, text);
  }
  const q = {
    description: { text: "This quiz has 2 short answer questions." },
    questionsStatus: "CAPTURED",
    questionCoverage: {
      completenessVerified: false,
      status: "TOTAL_UNVERIFIED",
    },
    questionPageEvidence: { complete: true },
    questions: [
      { QuestionId: 1, QuestionText: { Text: "One?" } },
      { QuestionId: 2, QuestionText: { Text: "Two?" } },
    ],
  };
  assert.equal(
    qa.qaBrightspaceQuizCaptureSummary_([q]).items[0].descriptionQuestionCount,
    2,
  );
  assert.equal(
    qa.qaBrightspaceQuizCaptureSummary_([q]).items[0].status,
    "TOTAL_UNVERIFIED",
  );
});
test("Brightspace content references resolve against fetched document and declared base, retaining raw attributes", async () => {
  for (const declaredBase of [
    "",
    "../assets/",
    "https://media.example.test/library/",
  ]) {
    const origin = "https://lms.example.test",
      finalUrl = origin + "/content/course/Content/book.html",
      calls = [];
    const html =
      "<html><head>" +
      (declaredBase ? '<base href="' + declaredBase + '" />' : "") +
      '</head><body><a href="Worksheet.pdf">Worksheet</a><img src="diagram.png" alt="Diagram" /><iframe src="activity/index.html"></iframe></body></html>';
    const reader = createBrightspaceContentReader({
      origin,
      DOMParser: SourceDOMParser,
      request: async (url) => {
        calls.push(url);
        const response = new Response(
          url === finalUrl
            ? html
            : url.endsWith(".html")
              ? "<html><body>Original child asset</body></html>"
              : "Original binary asset",
          {
            headers: {
              "content-type": url.endsWith(".html")
                ? "text/html; charset=utf-8"
                : "application/octet-stream",
            },
          },
        );
        Object.defineProperty(response, "url", { value: url });
        return response;
      },
    });
    const result = await reader.readTopic({
        id: "123",
        url: finalUrl,
        activityType: 1,
        path: ["Module"],
      }),
      base = declaredBase ? new URL(declaredBase, finalUrl).href : finalUrl;
    assert.equal(result.status, "CAPTURED");
    assert.equal(result.documentUrl, finalUrl);
    assert.equal(result.documentBase, base);
    assert.equal(result.links[0].href, new URL("Worksheet.pdf", base).href);
    assert.equal(result.links[0].rawHref, "Worksheet.pdf");
    assert.equal(result.images[0].url, new URL("diagram.png", base).href);
    assert.equal(result.images[0].rawUrl, "diagram.png");
    assert.equal(
      result.embeds[0].url,
      new URL("activity/index.html", base).href,
    );
    assert.equal(result.embeds[0].rawUrl, "activity/index.html");
    const expected = [
      finalUrl,
      ...["Worksheet.pdf", "diagram.png", "activity/index.html"]
        .map((path) => new URL(path, base).href)
        .filter((url) => new URL(url).origin === origin),
    ];
    assert.deepEqual(
      calls,
      expected,
      "Only the parent and explicitly referenced same-origin assets may be fetched; external declared bases remain references",
    );
  }
});
test("Report distinguishes incomplete intermediate cycle from complete final payload", () => {
  const result = {
    success: true,
    summary: { headlineStatus: "REVIEW" },
    itemResults: [
      {
        courseraId: "quiz",
        courseraName: "Test",
        checks: {
          structuredAssessment: {
            status: "VERIFIED",
            courseraQuestionCount: 24,
            courseraDeclaredQuestionCount: 24,
            courseraCaptureCompleteness: { questionCoverageComplete: true },
          },
        },
      },
    ],
    missing: [],
    injected: [],
    stats: {
      extractorMeta: {
        activeSpaCrawl: {
          targetDiagnostics: [
            {
              id: "quiz",
              questionCycleCaptureCompleteness: {
                captured: 23,
                declared: 24,
                questionCoverageComplete: false,
                missingQuestionOrdinals: [15],
              },
            },
          ],
        },
      },
    },
  };
  const before = JSON.stringify(result),
    report = buildPostQaText_(result);
  assert.match(
    report,
    /Final assessment payload: question records=24\/24 \| explicit question coverage=YES/,
  );
  assert.match(
    report,
    /Question-cycle observation \(intermediate; later recovery may supersede\): question records=23\/24/,
  );
  assert.match(
    report,
    /Question positions absent at this intermediate stage: 15/,
  );
  assert.equal(JSON.stringify(result), before);
});
test("Quoted question scopes media warning to assessment instead of another carrier of the filename", () => {
  const claim = {
    type: "UNRESOLVED_SOURCE_ASSET",
    subject: "Shared.jpg",
    pathHint: "Module 7",
    excerpt:
      "Question 'Which sling wears more evenly?' could not embed the image 'Shared.jpg'.",
  };
  const source = {
    id: "quiz",
    name: "Module 7 Self-Check",
    path: "Module 7",
    structuredAssessment: {
      questions: [{ prompt: "Which sling wears more evenly?" }],
    },
    assetDetails: [{ name: "Shared.jpg" }],
  };
  const reading = {
      id: "reading",
      name: "Reading",
      path: "Module 7",
      assetDetails: [{ name: "Shared.jpg" }],
    },
    intelligence = { claims: [claim] },
    before = JSON.stringify(intelligence);
  assert.equal(
    qa.qaSmartIngestionClaimsForSource_(reading, intelligence).length,
    0,
  );
  const matched = qa.qaSmartIngestionClaimsForSource_(source, intelligence);
  assert.equal(matched.length, 1);
  assert.deepEqual(plain(matched[0].questionScopeEvidence.questionNumbers), [
    1,
  ]);
  assert.equal(
    qa.qaSmartIngestionClaimsForSource_(
      { ...source, path: "Module 9" },
      intelligence,
    ).length,
    0,
  );
  assert.equal(
    qa.qaSmartIngestionClaimsForSource_(
      {
        ...source,
        structuredAssessment: {
          questions: [{ prompt: "Which sling wears less evenly?" }],
        },
      },
      intelligence,
    ).length,
    0,
  );
  assert.equal(JSON.stringify(intelligence), before);
  const unnamed = {
    type: "UNSUPPORTED_CONTENT_FALLBACK",
    subject: "",
    excerpt:
      "Question 'Which sling wears more evenly?' could not embed the image.",
  };
  const resolved = qa.qaResolveHistoricalClaimCurrentState_(
    unnamed,
    source,
    { id: "dest", name: "Self-Check" },
    [],
    {},
    {},
  );
  assert.equal(resolved.status, "QUESTION_MEDIA_REVIEW");
  assert.equal(resolved.currentItemId, "dest");
  assert.equal(
    qa.qaResolveHistoricalClaimCurrentState_(unnamed, null, null, [], {}, {})
      .status,
    "UNLOCALIZED_PROVENANCE",
  );
});
