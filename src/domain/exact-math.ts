/** Bounded rational arithmetic. No eval, floating-point equality or implicit
 * multiplication. Unsupported notation fails closed. */
export interface Rational {
  n: bigint;
  d: bigint;
}
const abs = (n: bigint) => (n < 0n ? -n : n);
export function rational(n: bigint, d = 1n): Rational {
  if (!d || n.toString().length > 500 || d.toString().length > 500)
    throw Error("Arithmetic limit or division by zero.");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = abs(n),
    b = d;
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return { n: n / a, d: d / a };
}
export const equal = (a: Rational, b: Rational) => a.n === b.n && a.d === b.d;
export function operate(a: Rational, op: string, b: Rational): Rational {
  if (op === "+") return rational(a.n * b.d + b.n * a.d, a.d * b.d);
  if (op === "-") return rational(a.n * b.d - b.n * a.d, a.d * b.d);
  if (op === "*") return rational(a.n * b.n, a.d * b.d);
  if (op === "/") return rational(a.n * b.d, a.d * b.n);
  if (op === "^" && b.d === 1n && abs(b.n) <= 12n) {
    if (!a.n && !b.n) throw Error("Undefined power.");
    return b.n < 0n
      ? rational(a.d ** -b.n, a.n ** -b.n)
      : rational(a.n ** b.n, a.d ** b.n);
  }
  throw Error("Unsupported operation.");
}
export function normalizeMath(s: string): string {
  return s
    .replace(/[−–]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\u00a0/g, " ")
    .trim();
}
export function exactMath(input: string): Rational {
  const s = normalizeMath(input);
  if (!s || s.length > 600 || /[^\d.\s()+*/^%-]/.test(s))
    throw Error("Unsupported notation.");
  const tokens = s.match(/\d+(?:\.\d+)?|\.\d+|[^\s]/g) || [];
  if (tokens.length > 120) throw Error("Expression limit.");
  let at = 0,
    depth = 0;
  function primary(): Rational {
    if (++depth > 20) throw Error("Expression depth limit.");
    let v: Rational;
    const t = tokens[at++];
    if (t === "(") {
      v = sum();
      if (tokens[at++] !== ")") throw Error("Unbalanced expression.");
    } else {
      if (!t || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t) || t.length > 30)
        throw Error("Unsupported number.");
      v = rational(
        BigInt(t.replace(".", "")),
        10n ** BigInt(t.includes(".") ? t.split(".")[1].length : 0),
      );
    }
    if (tokens[at] === "%") {
      at++;
      v = operate(v, "/", rational(100n));
    }
    depth--;
    return v;
  }
  function unary(): Rational {
    if (++depth > 20) throw Error("Expression depth limit.");
    let v: Rational;
    if (tokens[at] === "+" || tokens[at] === "-") {
      const op = tokens[at++];
      v = unary();
      if (op === "-") v = rational(-v.n, v.d);
    } else {
      v = primary();
      if (tokens[at] === "^") {
        at++;
        v = operate(v, "^", unary());
      }
    }
    depth--;
    return v;
  }
  function product(): Rational {
    let v = unary();
    while (tokens[at] === "*" || tokens[at] === "/") {
      const op = tokens[at++];
      v = operate(v, op, unary());
    }
    return v;
  }
  function sum(): Rational {
    let v = product();
    while (tokens[at] === "+" || tokens[at] === "-") {
      const op = tokens[at++];
      v = operate(v, op, product());
    }
    return v;
  }
  const v = sum();
  if (at !== tokens.length) throw Error("Unconsumed notation.");
  return v;
}
export function roundExact(
  v: Rational,
  places: number,
): { value: Rational; text: string } {
  if (!Number.isInteger(places) || Math.abs(places) > 6)
    throw Error("Rounding precision limit.");
  const scale = rational(
    places >= 0 ? 10n ** BigInt(places) : 1n,
    places < 0 ? 10n ** BigInt(-places) : 1n,
  );
  const scaled = operate(v, "*", scale),
    remainder = abs(scaled.n) % scaled.d;
  // Half-up/half-even conventions differ; do not silently choose one.
  if (remainder * 2n === scaled.d)
    throw Error("Halfway rounding requires a stated convention.");
  const rounded = rational(
    (abs(scaled.n) / scaled.d + (remainder * 2n >= scaled.d ? 1n : 0n)) *
      (scaled.n < 0n ? -1n : 1n),
  );
  const value = operate(rounded, "/", scale);
  if (places < 0) return { value, text: formatExact(value) };
  const digits = abs(rounded.n)
    .toString()
    .padStart(places + 1, "0");
  return {
    value,
    text:
      (rounded.n < 0n ? "-" : "") +
      (places
        ? digits.slice(0, -places) + "." + digits.slice(-places)
        : digits),
  };
}
export function formatExact(v: Rational): string {
  let remaining = abs(v.n) % v.d,
    decimals = "";
  for (let i = 0; remaining && i < 12; i++) {
    remaining *= 10n;
    decimals += String(remaining / v.d);
    remaining %= v.d;
  }
  const decimal =
    (v.n < 0n ? "-" : "") +
    String(abs(v.n) / v.d) +
    (decimals ? "." + decimals : "");
  return remaining ? `${v.n}/${v.d} (approximately ${decimal}…)` : decimal;
}
