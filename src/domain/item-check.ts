import { courseraLocation, type ItemExpectation } from "./owner-actions.ts";
import type { EvidenceObject } from "./workspace-types.ts";

export interface ItemCheckSpec {
  auditId: string;
  itemId: string;
  courseId: string;
  url: string;
  name: string;
  checks: ItemExpectation[];
}
export const ITEM_CHECK_VERSION = 1;

// Self-contained: also embedded into the console script. Results describe only
// observed references/prompts, never infer deletion or launch from absence.
export function evaluateItemEvidence(
  spec: ItemCheckSpec,
  capture: EvidenceObject,
) {
  const p = capture.payload || {};
  const urls: string[] = [];
  for (const values of [p.links, p.files, p.images, p.embeddedRefs])
    for (const x of Array.isArray(values) ? values : [])
      if (typeof x === "string") urls.push(x);
  for (const x of p.assetDetails || [])
    if (typeof x.url === "string") urls.push(x.url);
  for (const x of p.plugin?.targets || p.pluginEvidence?.targets || [])
    if (typeof x.url === "string") urls.push(x.url);
  const norm = (v: unknown) =>
    String(v || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const filename = (v: unknown) => {
    let s =
      String(v || "")
        .split(/[?#]/)[0]
        .split(/[\\/]/)
        .pop() || "";
    try {
      s = decodeURIComponent(s);
    } catch {
      /* Keep the observed spelling. */
    }
    return s.toLowerCase();
  };
  const questions: EvidenceObject[] = p.structuredAssessment?.questions || [];
  const names = [
    ...urls,
    ...(p.assetDetails || []).map((a: EvidenceObject) => a.name),
  ]
    .filter(Boolean)
    .map(filename);
  const findings = spec.checks.map((expected) => {
    const found =
      capture.editorObserved === true &&
      (expected.kind === "url"
        ? urls.includes(expected.value)
        : expected.kind === "file"
          ? names.includes(filename(expected.value))
          : questions.some((q) => norm(q.prompt) === norm(expected.value)));
    return {
      ...expected,
      status: found ? "OBSERVED" : "NOT_OBSERVED",
      meaning: found
        ? expected.kind === "prompt"
          ? "This prompt was observed in the captured assignment. Answers and behavior need their own checks."
          : "This reference was observed. File identity, correct question placement and learner access still need checking."
        : "Not observed in this item capture. This does not establish that it is missing; inspect the item or its embedded content.",
    };
  });
  return {
    findings,
    questionCount: questions.length,
    questionCoverageComplete:
      p.structuredAssessment?.captureCompleteness?.questionCoverageComplete ===
      true,
    answerCoverageComplete:
      p.structuredAssessment?.captureCompleteness
        ?.requiredAnswerCoverageComplete === true,
    assetReferences: new Set(urls).size,
    textLength: String(p.textSample || "").length,
    editorObserved: capture.editorObserved === true,
    pluginReadiness: p.pluginEvidence?.readiness || null,
    automatedResolution: false,
  };
}

export function validateItemCheck(value: EvidenceObject, spec: ItemCheckSpec) {
  if (
    value?.kind !== "CTI_COURSERA_ITEM_CHECK" ||
    value.schemaVersion !== ITEM_CHECK_VERSION ||
    value.notForCourseAudit !== true
  )
    throw new Error(
      "Choose the item-check JSON downloaded by this action card. Keep full course captures in Compare.",
    );
  if (
    value.auditId !== spec.auditId ||
    value.courseId !== spec.courseId ||
    value.itemId !== spec.itemId
  )
    throw new Error(
      "This check belongs to another report, course, or item. Copy this card’s script and use its Coursera link.",
    );
  if (JSON.stringify(value.expectations) !== JSON.stringify(spec.checks))
    throw new Error(
      "The check was generated for different findings. Copy the current card’s script.",
    );
  if (
    courseraLocation(value.openedUrl)?.courseId !== spec.courseId ||
    courseraLocation(value.openedUrl)?.itemId !== spec.itemId
  )
    throw new Error(
      "The capture does not identify the expected Coursera editor.",
    );
  if (
    !value.payload ||
    typeof value.payload !== "object" ||
    Array.isArray(value.payload) ||
    !Number.isFinite(Date.parse(value.finishedAt))
  )
    throw new Error("The item check is incomplete or invalid.");
  if (
    value.payload.structuredAssessment?.questions &&
    !Array.isArray(value.payload.structuredAssessment.questions)
  )
    throw new Error("Invalid captured questions.");
  for (const k of ["links", "files", "images", "embeddedRefs", "assetDetails"])
    if (value.payload[k] != null && !Array.isArray(value.payload[k]))
      throw new Error("Invalid captured item evidence.");
  return { ...value, evaluation: evaluateItemEvidence(spec, value) };
}

/** Reuses the full extractor's parsers, waits, question cycle and scoping. Only
 * the selected item is visited; no past payload is seeded into the new check. */
export function buildItemCheckScript(
  delivery: EvidenceObject,
  spec: ItemCheckSpec,
) {
  const source = String(delivery.script || ""),
    marker = "  const id = courseId();",
    offset = source.indexOf(marker);
  const route = courseraLocation(spec.url);
  if (
    !route ||
    route.courseId !== spec.courseId ||
    route.itemId !== spec.itemId ||
    !spec.auditId
  )
    throw new Error(
      "A saved report and a valid course/item link are required for a targeted check.",
    );
  if (
    offset < 0 ||
    source.indexOf(marker, offset + marker.length) !== -1 ||
    delivery.version !== "v6.15.8" ||
    delivery.buildId !== "v6.15.8-visible-survey-choices-20261004"
  )
    throw new Error(
      "The targeted check needs a compatible extractor build. Reload the app; no script was generated.",
    );
  const guard = `const expected=${JSON.stringify(spec)};const u=new URL(location.href);const m=u.pathname.match(/^\\/teach\\/[^/]+\\/([A-Za-z0-9_-]+)\\/content(?:\\/|$)/);const i=u.pathname.match(/\\/content\\/item\\/[A-Za-z0-9_-]+\\/([A-Za-z0-9_-]+)\\/?$/);if(u.protocol!=='https:'||!/^(www\\.)?coursera\\.org$/.test(u.hostname)||!m||m[1]!==expected.courseId||String(i?i[1]:u.searchParams.get('itemId')||'')!==expected.itemId)throw Error('Open the exact Coursera item linked on this action card before running its script.');`;
  // Guard before the extractor acquires its lock or installs a recorder.
  const prefix = source
    .slice(0, offset)
    .replace('  "use strict";', `  "use strict";\n  ${guard}`);
  return (
    prefix +
    `
  const id = courseId(), openedUrl = location.href;
  ctiProgressUpdateV1({phase:'Check one item',detail:expected.name});
  const material = await getJson('/api/authoringCourseMaterials.v1/'+encodeURIComponent(id)+'/?fields=material,conflictMetadata,authoringAtomRelations.v1(embeddedContentSourceCourseId)&includes=embeddedContentMapping');
  if(!material.ok || !material.data) throw Error('Current course structure could not be read. No item check was completed.');
  const fresh = await fingerprintsFromMaterial(material.data);
  const candidates = fresh.filter(fp => String(fp.id) === expected.itemId);
  if(candidates.length !== 1) throw Error('The exact item could not be uniquely identified in the current course. No substitute item was used.');
  const fp = candidates[0];
  const crawl = await activeSpaCrawl([fp],id,{onlyIds:[expected.itemId],maxItems:1,budgetMs:960000,readingRouteTemplate:readingRouteTemplateV61312(id)});
  finalizeCapturedTextV61318(fp.payload);
  attachQuestionFailureEvidenceV61318(fp.payload);
  const diag = (crawl.targetDiagnostics || []).find(d => String(d.id) === expected.itemId);
  const check = {kind:'CTI_COURSERA_ITEM_CHECK',schemaVersion:1,notForCourseAudit:true,scope:'ONE_ITEM_FRESH_EVIDENCE',
    auditId:expected.auditId,courseId:id,itemId:fp.id,openedUrl,expectations:expected.checks,
    extractorVersion:${JSON.stringify(delivery.version)},extractorBuild:${JSON.stringify(delivery.buildId)},
    startedAt:new Date(nowForLock).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-nowForLock,
    editorObserved:Boolean(diag && diag.editorSurfaceCaptured),payload:fp.payload,crawl,
    wholeCourseRecaptured:false,binaryContentVerified:false,launchVerified:false};
  check.evaluation = (${evaluateItemEvidence.toString()})(expected,check);
  window.__CTI_ITEM_CHECK_RESULT = check;
  console.table(check.evaluation.findings);
  console.log('CTI item check — observed references are not a publication sign-off',check);
  downloadJson('CTI_ITEM_CHECK_'+fp.id+'_'+Date.now()+'.json',check);
  ctiProgress.finish('review','Item check downloaded. Upload it to the same action card in CTI.',check.evaluation.questionCount+' question records; '+check.evaluation.findings.filter(x=>x.status==='OBSERVED').length+'/'+expected.checks.length+' expected references/prompts observed');
  } finally {
    if(ctiProgress && ctiProgress.snapshot().outcome==='running')ctiProgress.finish('error','Item check interrupted. See the console error; no completed check is implied.');
    releaseCtiRunLock();
  }
})();\n`
  );
}
