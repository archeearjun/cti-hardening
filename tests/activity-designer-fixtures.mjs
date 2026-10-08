export function captureFixture() {
  return {
    format: "coursera-activity-capture",
    schema_version: 1,
    created_at: "2026-10-08T16:00:00.000Z",
    extractor_version: "1.2.1",
    capture_scope: "course",
    status: "finished",
    issues: [],
    course: {
      id: "b1",
      title: "Synthetic course",
      url: "https://www.coursera.org/teach/test/b1/content/edit",
    },
    items: [
      {
        id: "i1",
        title: "Teaching",
        type: "supplement",
        position: 1,
        ancestors: [
          { id: "m1", title: "First module", key: "m1" },
          { id: "l1", title: "Lesson", key: "m1/l1" },
        ],
        blocks: [
          {
            field: "Content",
            kind: "teaching",
            text: "Measured dimensions must include their units. Explain the choice before applying a formula.",
          },
        ],
        coverage: "partial",
        notes: [],
        route:
          "https://www.coursera.org/teach/test/b1/content/item/supplement/i1",
      },
      {
        id: "i2",
        title: "Quiz",
        type: "ungradedAssignment",
        position: 2,
        ancestors: [
          { id: "m1", title: "First module", key: "m1" },
          { id: "l1", title: "Lesson", key: "m1/l1" },
        ],
        blocks: [
          {
            field: "Question 1 / Prompt",
            kind: "assessment",
            text: "What units measure volume?",
          },
          {
            field: "Question 1 / Option 1",
            kind: "assessment",
            text: "Cubic metres",
          },
        ],
        coverage: "partial",
        notes: [],
        assessment_capture: {
          visible_question_headers: 2,
          prompts_captured: 1,
          options_captured: 1,
          choice_controls_seen: 4,
          completeness: "partial_unverified",
        },
      },
      {
        id: "i3",
        title: "Later teaching",
        type: "supplement",
        position: 3,
        ancestors: [
          { id: "m2", title: "Second module", key: "m2" },
          { id: "l2", title: "Lesson", key: "m2/l2" },
        ],
        blocks: [],
        coverage: "unread",
        notes: ["Not captured."],
      },
    ],
  };
}

export function pdfFixture() {
  const stream =
    "BT /F1 12 Tf 50 700 Td (Assignment instructions: submit a written response and follow the grading rubric carefully.) Tj ET";
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n",
    offsets = [0];
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${bodies[i]}\nendobj\n`;
  }
  const xref = out.length;
  out +=
    `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
