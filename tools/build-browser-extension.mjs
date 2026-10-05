import fs from "node:fs";
import vm from "node:vm";
import JSZip from "jszip";
import { buildExtensionItemScript } from "../src/domain/extension-item-script.ts";
import { CTI_RELEASE_REGISTRY_ } from "../src/engine/release.js";

export async function buildBrowserExtension(script) {
  const root = new URL("../src/browser-extension/", import.meta.url);
  const target = new URL(
    "../src/generated/browser-extension/",
    import.meta.url,
  );
  fs.mkdirSync(target, { recursive: true });
  const release = CTI_RELEASE_REGISTRY_.courseraExtractor;
  const runner = buildExtensionItemScript({
    script,
    version: release.version,
    buildId: release.build,
  });
  new vm.Script(runner, { filename: "coursera-item.js" });
  const files = [
    "manifest.json",
    "background.js",
    "protocol.js",
    "cti-bridge.js",
    "coursera-relay.js",
    "INSTALL.txt",
  ];
  const zip = new JSZip();
  const add = (name, text) => {
    fs.writeFileSync(new URL(name, target), text);
    zip.file("CTI-browser-extension/" + name, text, {
      date: new Date("2026-01-01T00:00:00Z"),
    });
  };
  for (const file of files)
    add(file, fs.readFileSync(new URL(file, root), "utf8"));
  add("coursera-item.js", runner);
  const download = new URL("../public/downloads/", import.meta.url);
  fs.mkdirSync(download, { recursive: true });
  fs.writeFileSync(
    new URL("cti-browser-extension.zip", download),
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}
