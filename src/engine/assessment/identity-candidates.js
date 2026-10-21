// Exact observed instructional text nominates question pairs, never full parity.
// IDs remain in their original platform namespaces; no quiz/bank total inferred.
import { questionEvidenceDimensions } from "./question-dimensions.js";
export function questionIdentityCandidates(snapshot = {}) {
  const normalize = (v) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  function rows(items, platform) {
    return (items || []).flatMap((item) =>
      (item.content?.questions || []).flatMap((q) => {
        const prompt = normalize(q.prompt);
        if (
          !item.id ||
          !q.id ||
          prompt.length < 40 ||
          !Array.isArray(q.options) ||
          !q.options.every(
            (o) => typeof o === "string" || typeof o?.text === "string",
          )
        )
          return [];
        const options = q.options.map((o) =>
          normalize(typeof o === "string" ? o : o.text),
        );
        return [
          {
            platform,
            itemId: item.id,
            questionId: q.id,
            itemName: item.name,
            path: item.path,
            key: JSON.stringify([prompt, options]),
            question: q,
          },
        ];
      }),
    );
  }
  const source = rows(snapshot.brightspace, "BRIGHTSPACE"),
    destination = rows(snapshot.coursera, "COURSERA");
  const sourceByKey = new Map(),
    destByKey = new Map();
  for (const [list, index] of [
    [source, sourceByKey],
    [destination, destByKey],
  ])
    for (const row of list)
      index.set(row.key, [...(index.get(row.key) || []), row]);
  const result = [];
  for (const [key, from] of sourceByKey) {
    const to = destByKey.get(key) || [];
    for (const s of from)
      for (const d of to) {
        const { key: ignoredSource, question: sourceQuestion, ...src } = s,
          { key: ignoredDestination, question: destinationQuestion, ...dst } = d;
        result.push({
          source: src,
          destination: dst,
          status:
            from.length === 1 && to.length === 1
              ? "EXACT_TEXT_CANDIDATE"
              : "AMBIGUOUS_TEXT_CANDIDATE",
          scope: "PROMPT_AND_ORDERED_OPTION_TEXT_ONLY",
          completeContent: false,
          parity: questionEvidenceDimensions(sourceQuestion, destinationQuestion),
          reason:
            "Exact retained prompt/options only. Verify media, answers, rubrics, scoring, source inventory and draft/published state independently.",
        });
        if (result.length >= 2000) return result;
      }
  }
  return result;
}
