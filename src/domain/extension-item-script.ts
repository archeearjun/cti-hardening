import { buildItemCheckScript } from "./item-check.ts";
import type { EvidenceObject } from "./workspace-types.ts";

/** Build time only: package the maintained item extractor as a local extension
 * file. Runtime messages contain data, never executable strings. */
export function buildExtensionItemScript(delivery: EvidenceObject): string {
  const placeholder = {
    auditId: "extension-build",
    courseId: "course",
    itemId: "item",
    name: "Item",
    url: "https://www.coursera.org/teach/example/course/content/item/reading/item",
    checks: [],
  };
  let source = buildItemCheckScript(delivery, placeholder);
  function replace(from: string, to: string) {
    if (source.split(from).length !== 2)
      throw Error(
        "Extension extractor transport is incompatible with this build.",
      );
    source = source.replace(from, to);
  }
  replace(
    `const expected=${JSON.stringify(placeholder)};`,
    "const extensionJob=window.__CTI_EXTENSION_JOB; if(!extensionJob || extensionJob.state!=='RUNNING')throw Error('No active CTI extension request.'); const expected=extensionJob.spec;",
  );
  replace(
    "function ctiProgressUpdateV1(patch) {",
    "function ctiProgressUpdateV1(patch) { if(extensionJob){extensionJob.phase=String(patch.phase || extensionJob.phase || '').slice(0,200);extensionJob.detail=String(patch.detail || extensionJob.detail || '').slice(0,600);}",
  );
  replace(
    "  console.table(check.evaluation.findings);",
    "  extensionJob.result=JSON.stringify(check); if(new TextEncoder().encode(extensionJob.result).length>16*1024*1024){delete extensionJob.result;throw Error('Capture exceeds the 16 MiB item limit. Use the manual export workflow.');}",
  );
  replace(
    "  console.log('CTI item check — observed references are not a publication sign-off',check);",
    "  extensionJob.state='READY';",
  );
  replace(
    "  downloadJson('CTI_ITEM_CHECK_'+fp.id+'_'+Date.now()+'.json',check);",
    "  // Result remains in this temporary tab until CTI acknowledges a successful save.",
  );
  replace(
    "'Item check downloaded. Upload it to the same action card in CTI.'",
    "'Item captured. Return to CTI to review the refreshed evidence.'",
  );
  source = source.replace(/^javascript:/, "");
  return `// Packaged CTI extractor; generated from maintained first-party modules.\nvoid (async () => {\ntry { await ${source.trim().replace(/;$/, "")};\nif(window.__CTI_EXTENSION_JOB?.state==='RUNNING')throw Error('Another extractor is already running; no fresh result was produced.');\n} catch(error) { const job=window.__CTI_EXTENSION_JOB;if(job){job.state='FAILED';job.error=String(error?.message || 'Item capture failed.').slice(0,600);delete job.result;}\n} finally { const job=window.__CTI_EXTENSION_JOB;if(job)window.postMessage({channel:'CTI_CAPTURE_FINISHED',id:job.id},location.origin); }\n})();\n`;
}
