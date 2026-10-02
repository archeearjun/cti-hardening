import path from "node:path";
import {
  digest,
  extractorParts,
  inventory,
  parse,
  tokens,
} from "./code-gs-inventory.mjs";
import { bundleConsole } from "./console-bundle.mjs";
import { createRequire } from "node:module";
import fs from "node:fs";

const require=createRequire(import.meta.url);
const legacy=require("./legacy-reference.cjs");
const archiveInventory=inventory();
const releaseAst=parse(
  fs.readFileSync("src/engine/release.js","utf8"),
  "src/engine/release.js",
);
const releaseStatement=releaseAst.statements.find((statement)=>
  statement.declarationList?.declarations?.some(
    (declaration)=>declaration.name?.getText()==="CTI_RELEASE_REGISTRY_",
  ),
);
const releaseDeclaration=releaseStatement?.declarationList.declarations.find(
  (declaration)=>declaration.name.getText()==="CTI_RELEASE_REGISTRY_",
);
const archivedRelease=archiveInventory.constants.get("CTI_RELEASE_REGISTRY_");
if(!releaseDeclaration?.initializer || !archivedRelease?.initializer)
  throw new Error("Could not resolve release-registry constants for review.");
const moved=parse(
  fs.readFileSync("src/extractors/coursera/config.js","utf8"),
).statements.map((n)=>n.declarationList?.declarations?.[0]?.name?.text).filter(Boolean);
const archived=extractorParts(
  legacy.ctiCanonicalCourseraExtractorSource_(),
  moved,
);
const current=extractorParts(
  bundleConsole(path.resolve("src/extractors/coursera/entry.js")),
  moved,
);
const names=[...new Set([...archived.functions.keys(),...current.functions.keys()])].sort();
const changed=[],added=[],removed=[];
for(const name of names){
  const before=archived.functions.get(name),after=current.functions.get(name);
  if(before===undefined)added.push({name,reviewedCurrentHash:digest(after)});
  else if(after===undefined)removed.push({name,archivedHash:digest(before)});
  else if(before!==after)changed.push({
    name,
    archivedHash:digest(before),
    reviewedCurrentHash:digest(after),
  });
}
const constants=[];
for(const name of [...new Set([...archived.constants.keys(),...current.constants.keys()])].sort()){
  const before=archived.constants.get(name),after=current.constants.get(name);
  if(before!==after)constants.push({
    name,
    status:before===undefined?"added":after===undefined?"removed":"changed",
    archivedHash:before===undefined?null:digest(before),
    reviewedCurrentHash:after===undefined?null:digest(after),
  });
}
console.log(JSON.stringify({
  schemaVersion:1,
  baseline:"v6.14.7/schema34",
  current:"v6.15.7/schema35",
  changed,
  added,
  removed,
  constants,
  entry:{
    changed:archived.entry!==current.entry,
    archivedHash:digest(archived.entry),
    reviewedCurrentHash:digest(current.entry),
  },
  releaseRegistry:{
    archivedHash:digest(tokens(archivedRelease.initializer)),
    reviewedCurrentHash:digest(tokens(releaseDeclaration.initializer)),
  },
},null,2));
