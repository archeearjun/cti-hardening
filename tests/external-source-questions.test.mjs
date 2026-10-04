import test from "node:test";
import assert from "node:assert/strict";
import {
  publicSourceUrl,
  readH5PQuestionSets,
  validateSourceQuestionCapture,
  h5pFrames,
} from "../src/domain/external-source-questions.ts";
import { fetchSourceQuestions } from "../server/source-questions.ts";
import {
  questionComparison,
  withQuestionFollowUp,
  questionDifference,
} from "../src/domain/question-counts.ts";
import { validateOwnerReview } from "../src/domain/owner-actions.ts";
import { handleApi, handleAuthorized } from "../server/api.ts";
const target = "https://opentextbc.ca/example/?p=225/#main";
const page = "https://opentextbc.ca/example/chapter/quiz/";
const key = JSON.stringify(["source", "Module", "Quiz"]);
function definition(n = 10, extra = {}) {
  return {
    library: "H5P.QuestionSet 1.17",
    jsonContent: JSON.stringify({
      questions: Array.from({ length: n }, (_, i) => ({
        library: i % 2 ? "H5P.Blanks 1.14" : "H5P.MultiChoice 1.16",
        subContentId: "q" + i,
        params: {
          question: "<p>Question " + (i + 1) + "</p>",
          text: "Fill *answer*",
        },
      })),
      ...extra,
    }),
  };
}
function html(content = definition(), id = "cid-4") {
  return `<script>H5PIntegration = ${JSON.stringify({ contents: { [id]: content } })};</script>`;
}
const res = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/html", ...headers },
  });
test("provider URL boundary allows only explicit public book or read-only H5P embed URLs", () => {
  assert.equal(publicSourceUrl(target), "https://opentextbc.ca/example/?p=225");
  assert(
    publicSourceUrl(
      "https://opentextbc.ca/example/wp-admin/admin-ajax.php?action=h5p_embed&id=4",
    ),
  );
  for (const url of [
    "http://opentextbc.ca/example/",
    "https://opentextbc.ca.evil.test/example/",
    "https://u:p@opentextbc.ca/example/",
    "https://127.0.0.1/example/",
    "https://opentextbc.ca:444/example/",
    "https://opentextbc.ca/example/wp-login.php",
    "https://opentextbc.ca/example/wp-admin/admin-ajax.php?action=delete&id=4",
    "https://opentextbc.ca/example/?url=https://evil.test",
    "https://opentextbc.ca/example/?p=1&p=2",
  ])
    assert.equal(publicSourceUrl(url), "");
});
test("H5P definition parsing reads every bank position, keeps pool size separate, never executes JavaScript", () => {
  const result = readH5PQuestionSets(
    html(definition(11, { poolSize: 5, randomQuestions: true })),
  );
  assert.equal(result.banks[0].count, 11);
  assert.equal(result.banks[0].selectedPerAttempt, 5);
  assert.equal(result.banks[0].questions[0].prompt, "Question 1");
  assert.equal(result.banks[0].randomOrder, true);
  assert.equal(readH5PQuestionSets(html() + html()).banks.length, 1);
  for (const payload of [
    '<script>H5PIntegration = (()=>{throw Error("executed")})()</script>',
    "<script>// H5PIntegration = " +
      JSON.stringify({ contents: { a: definition() } }) +
      "</script>",
    "<script>H5PIntegration = {broken}</script>",
  ])
    assert.equal(readH5PQuestionSets(payload).banks.length, 0);
  assert.equal(
    readH5PQuestionSets(
      html({ library: "H5P.InteractiveVideo", jsonContent: "{}" }),
    ).unresolved,
    true,
  );
  assert.equal(
    readH5PQuestionSets(html(definition(2, { poolSize: 3 }))).banks.length,
    0,
  );
  assert.equal(readH5PQuestionSets(html(definition(0))).banks[0].count, 0);
});
test("bounded public fetch follows recorded redirects and iframe resources, without credentials", async () => {
  const seen = [];
  const fetched = await fetchSourceQuestions(key, target, async (url, init) => {
    seen.push(url);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "manual");
    assert.deepEqual(Object.keys(init.headers), ["Accept"]);
    if (seen.length === 1) return res("", 301, { Location: page });
    if (seen.length === 2)
      return res('<iframe src="/example/?h5p-embed=4"></iframe>');
    return res(html());
  });
  assert.equal(fetched.bank.count, 10);
  assert.equal(fetched.status, "CAPTURED");
  assert.equal(seen.length, 3);
  assert.equal(fetched.documents.length, 2);
  assert.equal(fetched.targetUrl, target);
  validateSourceQuestionCapture(fetched);
});
test("inaccessible, unsupported, ambiguous and limited content cannot become a zero or success", async () => {
  for (const body of [
    "<p>Sign in to see questions</p>",
    html() + html(definition(9), "cid-9"),
    html({ library: "H5P.Essay", jsonContent: "{}" }),
  ]) {
    const c = await fetchSourceQuestions(key, target, async () => res(body));
    assert.notEqual(c.status, "CAPTURED");
    assert.equal(c.bank, null);
  }
  await assert.rejects(
    fetchSourceQuestions(key, target, async () => res("Forbidden", 403)),
    /HTTP 403/,
  );
  await assert.rejects(
    fetchSourceQuestions(key, target, async () => res("x".repeat(3_000_001))),
    /limit/,
  );
  for (const location of [
    "https://127.0.0.1/internal",
    "https://other.test/",
    "https://opentextbc.ca/another-book/",
  ]) {
    let calls = 0;
    const c = await fetchSourceQuestions(key, target, async () => {
      calls++;
      return res("", 302, { Location: location });
    });
    assert.equal(c.status, "UNVERIFIED");
    assert.equal(calls, 1);
  }
  let calls = 0;
  const c = await fetchSourceQuestions(key, target, async () => {
    calls++;
    return res("", 302, {
      Location: `https://opentextbc.ca/example/?p=${calls + 100}`,
    });
  });
  assert.equal(calls, 6);
  assert.equal(c.status, "UNVERIFIED");
});
test("automatic source evidence is scoped to the exact saved link and does not mutate previous results", async () => {
  const c = await fetchSourceQuestions(key, target, async () => res(html()));
  const finding = {
    sourceId: "source",
    sourcePath: "Module",
    sourceName: "Quiz",
    courseraId: "dest",
    checks: {
      links: { expected: [target] },
      destinationReadiness: [
        { code: "EMPTY_ASSESSMENT_EDITOR_OBSERVED", itemId: "dest" },
      ],
    },
  };
  const row = questionComparison(finding, null, {
      id: "dest",
      type: "Assignment",
    }),
    before = structuredClone(row);
  const updated = withQuestionFollowUp([row], undefined, [], [c])[0];
  assert.equal(updated.source.count, 10);
  assert.match(questionDifference(updated), /10 fewer/);
  assert.equal(updated.aligned, null);
  assert.deepEqual(row, before);
  assert.throws(
    () =>
      withQuestionFollowUp(
        [row],
        undefined,
        [],
        [{ ...c, targetUrl: "https://opentextbc.ca/example/?p=999" }],
      ),
    /does not match/,
  );
  assert.throws(() =>
    validateSourceQuestionCapture({ ...c, bank: { ...c.bank, count: 1 } }),
  );
  assert.throws(
    () =>
      validateOwnerReview({ status: "open", note: "", sourceCaptures: [c, c] }),
    /Duplicate/,
  );
});
test("cancellation stops work and authenticated API retains origin and role boundaries", async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  await assert.rejects(
    fetchSourceQuestions(
      key,
      target,
      async () => {
        calls++;
        return res(html());
      },
      abort.signal,
    ),
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await handleApi(
        new Request("https://cti.test/api/source-questions", {
          method: "POST",
        }),
        {},
      )
    ).status,
    503,
  );
  const request = (origin) =>
    new Request("https://cti.test/api/source-questions", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ sourceKey: key, targetUrl: target }),
    });
  await assert.rejects(
    handleAuthorized(
      request("https://evil.test"),
      {},
      { email: "editor@test", role: "editor" },
    ),
    /Cross-origin/,
  );
  await assert.rejects(
    handleAuthorized(
      request("https://cti.test"),
      {},
      { email: "viewer@test", role: "viewer" },
    ),
    /read-only/,
  );
});

test("an additional inaccessible H5P bank prevents a whole-source count claim", async () => {
  const c = await fetchSourceQuestions(key, target, async () =>
    res(
      html() + '<iframe src="https://another.test/book/?h5p-embed=9"></iframe>',
    ),
  );
  assert.equal(c.status, "PARTIAL");
  assert.equal(c.bank, null);
  assert.equal(c.observedBanks.length, 1);
  const requests = [];
  const second = await fetchSourceQuestions(key, target, async (url) => {
    requests.push(url);
    return res(
      requests.length === 1
        ? html() +
            '<iframe src="https://opentextbc.ca/example/?h5p-embed=9"></iframe>'
        : html(definition(3), "cid-9"),
    );
  });
  assert.equal(requests.length, 2);
  assert.equal(second.status, "PARTIAL");
  assert.equal(second.bank, null);
  assert.equal(second.observedBanks.length, 2);
});
