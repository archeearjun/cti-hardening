/** Decode only this fully specified symbolic formula. Unknown TeX/MathML keeps
 * the notation warning; no markup is executed and no operators are discarded. */
export function supportedMathText(text: string): string {
  return text.replace(
    /\\\(\s*\\text\{efficiency\}\s*=\s*\\frac\{\\text\{output\}\}\{\\text\{input\}\}\s*\\\)/g,
    "efficiency = output / input",
  );
}
