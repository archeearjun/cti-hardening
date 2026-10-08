import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// The standalone UI remains isolated: external scripts and the existing CSP,
// with pinned CTI parser dependencies. No partner data enters this build.
export function buildActivityDesigner() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = path.join(root, "src/activity-designer");
  const out = path.join(root, "public/activity-designer");
  fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
  fs.mkdirSync(path.join(out, "downloads"), { recursive: true });
  const read = (name) => fs.readFileSync(path.join(source, name), "utf8");
  const capture = `// Course Activity Capture v1.2.1 — independent read-only reader.
// Open your signed-in Coursera Course Outline. Use Download course capture, then import that JSON in Course Activity Designer.
// Text coverage is partial; no course save, publish, answer selection or AI call.
(async function(){ const captureScope='course'; const shellScope={}; const module=undefined;
${read("shell-capture.js").replace("})(globalThis);", "})(shellScope);")}
${read("shell-rendered.js")}
${read("shell-runner.js")}
})().catch(error=>console.error("Course Activity Capture:",error.message));\n`;
  new vm.Script(capture);
  fs.writeFileSync(
    path.join(out, "downloads/Coursera_Activity_Capture.js"),
    capture,
  );
  fs.writeFileSync(
    path.join(out, "downloads/Coursera_Activity_Test_One_Item.js"),
    capture.replace(
      "const captureScope='course';",
      "const captureScope='current_item';",
    ),
  );
  fs.writeFileSync(
    path.join(out, "configuration.js"),
    `globalThis.CourseActivitySetup=${JSON.stringify(JSON.parse(read("setup.json")))};\nglobalThis.CourseActivityCaptureScript=${JSON.stringify(capture)};\n`,
  );
  for (const name of fs.readdirSync(source)) {
    if (/\.(js|css|html)$/.test(name))
      fs.copyFileSync(path.join(source, name), path.join(out, name));
  }
  for (const [from, to] of [
    ["jszip/dist/jszip.min.js", "jszip.min.js"],
    ["jszip/LICENSE.markdown", "jszip-LICENSE.txt"],
    ["pdfjs-dist/legacy/build/pdf.min.mjs", "pdf.min.mjs"],
    ["pdfjs-dist/legacy/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
    ["pdfjs-dist/LICENSE", "pdfjs-LICENSE.txt"],
  ])
    fs.copyFileSync(
      path.join(root, "node_modules", from),
      path.join(out, "vendor", to),
    );
}
