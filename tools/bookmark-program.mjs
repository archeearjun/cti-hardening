import vm from "node:vm";
import { minifySync } from "rolldown/experimental";

/** Format a second, build-time delivery copy of a standalone classic script.
 * Compression, dead-code removal and all name mangling remain disabled. The
 * parser/code generator handles comments, literals and ASI without evaluating
 * the program. Source-preserving console output never passes through here. */
export function formatJavaScriptBookmarkProgram(source, filename = "bookmark.js") {
  if (typeof source !== "string" || !source.trim())
    throw Error("The bookmark program must be a non-empty standalone script.");
  new vm.Script(source, { filename });
  const result = minifySync(filename, source, {
    module: false,
    compress: false,
    mangle: false,
    codegen: {
      removeWhitespace: true,
      asciiOnly: false,
      legalComments: "inline",
    },
    sourcemap: false,
  });
  if (result.errors.length || !result.code.trim())
    throw Error(`The bookmark program could not be formatted: ${filename}`);
  new vm.Script(result.code, { filename });
  return result.code;
}
