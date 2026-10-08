import fs from "node:fs";
import vm from "node:vm";
import { CTI_RELEASE_REGISTRY_ } from "../src/engine/release.js";
import { fileURLToPath } from "node:url";
import { bundleConsole } from "./console-bundle.mjs";

// Console scripts remain standalone programs. Only their delivery strings are
// generated; editing happens in src/extractors/<platform> feature modules.
const sources = {};
for (const platform of ["coursera", "brightspace"]) {
  const source = bundleConsole(
    fileURLToPath(
      new URL(`../src/extractors/${platform}/entry.js`, import.meta.url),
    ),
  );
  const release = CTI_RELEASE_REGISTRY_[`${platform}Extractor`];
  new vm.Script(source, { filename: `${platform}.js` });
  if (!source.includes(release.version) || !source.includes(release.build))
    throw new Error(`${platform} source and release registry disagree.`);
  sources[`${platform}Source`] = source;
  fs.mkdirSync(new URL("../src/generated/", import.meta.url), {
    recursive: true,
  });
  fs.writeFileSync(
    new URL(`../src/generated/${platform}-console.js`, import.meta.url),
    source,
  );
}
fs.mkdirSync(new URL("../src/generated/", import.meta.url), {
  recursive: true,
});
const output =
  "// Generated delivery strings. Edit src/extractors, not this file.\n" +
  Object.entries(sources)
    .map(
      ([name, source]) => `export const ${name} = ${JSON.stringify(source)};`,
    )
    .join("\n") +
  "\n";
const target = new URL(
  "../src/generated/extractor-sources.js",
  import.meta.url,
);
if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output)
  fs.writeFileSync(target, output);
console.log("Validated and prepared the two standalone extractor scripts.");
const { buildBrowserExtension } = await import("./build-browser-extension.mjs");
await buildBrowserExtension(sources.courseraSource);
console.log("Prepared the packaged CTI browser extension and install ZIP.");
const { buildActivityDesigner } = await import("./build-activity-designer.mjs");
buildActivityDesigner();
console.log("Prepared the isolated activity designer and read-only capture scripts.");
