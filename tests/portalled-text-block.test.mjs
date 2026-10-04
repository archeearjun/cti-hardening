import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { evaluateCourseraCapture } from "../src/domain/coursera-background-extraction.ts";
import {
  captureContractV6150,
  finalCaptureAccountingV6150,
} from "../src/extractors/coursera/completion.js";
const { fixture, El } = createRequire(import.meta.url)(
  "../tools/assessment-fixture.cjs",
);

function portalled() {
  const f = fixture({ count: 1 });
  f.c.URL = URL;
  f.c.location = new URL(
    "https://www.coursera.org/teach/example/fixture-course-123/content/item/ungradedAssignment/assessment-under-test",
  );
  const part = new El(
    "section",
    {
      id: "assessment~textBlock!~instructions",
      "data-testid": "assignment-part-0",
    },
    "1 Text block Instructions Title Instructions Content Submit your response through the associated dropbox.",
  );
  f.content.replaceChildren(part);
  f.sidebar.replaceChildren(
    new El("p", {}, "Assignment outline Content (1)"),
    new El("a", { href: "#" + encodeURIComponent(part.id) }, "Instructions"),
  );
  // The only common ancestor is body: neither side can be found by walking
  // the other side's bounded editor ancestors.
  f.sidebar.remove();
  const portal = new El("aside");
  portal.append(f.sidebar);
  f.c.document.body.append(portal);
  return {
    ...f,
    part,
    collect: () => f.c.collectAssignmentTextBlocksV61321(f.content, f.fp),
  };
}

test("production collector binds a portalled outline to exact part fragments and passes the site gate", () => {
  const f = portalled(),
    evidence = f.collect();
  assert.equal(evidence.completeTextBlockOnly, true);
  assert.equal(
    evidence.blocks[0].text,
    "Submit your response through the associated dropbox.",
  );
  f.fp.payload = { nativeAssignment: { contentBlockEvidence: evidence } };
  f.fp.captureContract = captureContractV6150(f.fp);
  const captureAccounting = finalCaptureAccountingV6150([f.fp], {
    unvisitedTargetIds: [],
  });
  const result = evaluateCourseraCapture(
    {
      page: { courseId: "fixture-course-123" },
      meta: { captureAccounting },
      fingerprints: [f.fp],
    },
    "fixture-course-123",
  );
  assert.deepEqual(result.reasons, []);
  assert.equal(result.complete, true);
});

test("portalled collector refuses another route, unrelated fragments and ambiguous outlines", () => {
  for (const mutate of [
    (f) =>
      (f.c.location.pathname = f.c.location.pathname.replace(
        "assessment-under-test",
        "another-item",
      )),
    (f) => f.sidebar.querySelector("a").setAttribute("href", "#unrelated-part"),
    (f) => f.c.document.body.append(f.sidebar.cloneNode(true)),
  ]) {
    const f = portalled();
    mutate(f);
    assert.equal(f.collect(), null);
  }
});

test("mixed or truncated portalled content cannot become a complete text-only assignment", () => {
  const mixed = portalled();
  mixed.content.append(
    new El(
      "section",
      { id: "assessment~question!~one", "data-testid": "assignment-part-1" },
      "Question",
    ),
  );
  assert.equal(mixed.collect().completeTextBlockOnly, false);
  const truncated = portalled();
  truncated.part.textContent += "x".repeat(25000);
  assert.equal(truncated.collect().completeTextBlockOnly, false);
});
