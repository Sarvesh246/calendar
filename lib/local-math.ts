/**
 * Arithmetic the assistant can do exactly on this device: "what's 23 × 17",
 * "15% of 80", "42 out of 50 as a percent", "3.5 hours in minutes". Anything
 * that isn't plainly numbers and operators returns `undefined` so the model
 * (or another local intent — dates, times) gets it. Never `eval`.
 */

const bold = (s: string) => `**${s}**`;

/** Round to at most 4 places and group thousands: 1234.5 → "1,234.5". */
export function formatNumber(n: number): string {
  const r = Math.round(n * 10_000) / 10_000;
  return r.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

const WORD_OPS: Array<[RegExp, string]> = [
  [/\bmultiplied by\b|\btimes\b/g, "*"],
  [/\bdivided by\b|\bover\b/g, "/"],
  [/\bplus\b|\badded to\b/g, "+"],
  [/\bminus\b|\bsubtract(?:ed)?\b/g, "-"],
  [/\bto the power of\b|\braised to\b/g, "^"],
  [/\bsquared\b/g, "^2"],
  [/\bcubed\b/g, "^3"],
  [/\bpercent\b/g, "%"],
];

/** An "x" that means times: between a number (or ")") and a number (or "("). */
const TIMES_X = /([\d)])\s*x\s*(?=[\d(])/g;

type Tok ={ k: "n"; v: number } | { k: "op"; v: string };

function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") {
      i += 1;
      continue;
    }
    const num = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?/.exec(src.slice(i))?.[0];
    if (num && num !== ".") {
      out.push({ k: "n", v: Number(num.replace(/,/g, "")) });
      i += num.length;
      continue;
    }
    if ("+-*/^()%".includes(c)) {
      out.push({ k: "op", v: c });
      i += 1;
      continue;
    }
    return null;
  }
  return out;
}

/** Recursive descent: + - (left), * / (left), unary -, ^ (right), postfix %. */
function parse(toks: Tok[]): number | null {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === "op" && peek()!.v === v;

  function primary(): number | null {
    const t = peek();
    if (!t) return null;
    if (t.k === "n") {
      p += 1;
      return t.v;
    }
    if (t.v === "(") {
      p += 1;
      const v = expr();
      if (v === null || !isOp(")")) return null;
      p += 1;
      return v;
    }
    return null;
  }
  function postfix(): number | null {
    let v = primary();
    while (v !== null && isOp("%")) {
      p += 1;
      v /= 100;
    }
    return v;
  }
  function power(): number | null {
    const base = postfix();
    if (base === null) return null;
    if (isOp("^")) {
      p += 1;
      const exp = unary();
      if (exp === null) return null;
      return base ** exp;
    }
    return base;
  }
  function unary(): number | null {
    if (isOp("-")) {
      p += 1;
      const v = unary();
      return v === null ? null : -v;
    }
    if (isOp("+")) {
      p += 1;
      return unary();
    }
    return power();
  }
  function term(): number | null {
    let v = unary();
    while (v !== null && (isOp("*") || isOp("/"))) {
      const op = peek()!.v;
      p += 1;
      const r = unary();
      if (r === null) return null;
      if (op === "/" && r === 0) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function expr(): number | null {
    let v = term();
    while (v !== null && (isOp("+") || isOp("-"))) {
      const op = peek()!.v;
      p += 1;
      const r = term();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = expr();
  return v !== null && p === toks.length && Number.isFinite(v) ? v : null;
}

/** Evaluate plain arithmetic. `null` for anything that isn't. */
export function evaluate(exprIn: string): number | null {
  let e = exprIn.toLowerCase().trim();
  for (const [re, op] of WORD_OPS) e = e.replace(re, ` ${op} `);
  e = e.replace(TIMES_X, "$1*").replace(/[×✕·]/g, "*").replace(/[÷]/g, "/").replace(/[−–]/g, "-").replace(/\s+/g, " ").trim();
  const toks = tokenize(e);
  if (!toks || !toks.length) return null;
  // At least one real operator: a bare number isn't a calculation.
  if (!toks.some((t) => t.k === "op" && t.v !== "(" && t.v !== ")")) return null;
  return parse(toks);
}

/** How an expression reads back: "23*17" → "23 × 17". */
function pretty(expr: string): string {
  return expr
    .replace(/\bmultiplied by\b|\btimes\b/g, "*")
    .replace(/\bdivided by\b/g, "/")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(TIMES_X, "$1*")
    .replace(/\s*\*\s*/g, " × ")
    .replace(/\s*\/\s*/g, " ÷ ")
    .replace(/\s*\+\s*/g, " + ")
    .replace(/(\d|\))\s*-\s*/g, "$1 − ")
    .replace(/\s+/g, " ")
    .trim();
}

const UNIT_MIN: Record<string, number> = {
  second: 1 / 60, sec: 1 / 60, minute: 1, min: 1, hour: 60, hr: 60, day: 1440, week: 10080,
};
const UNIT_RE = "(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)";

function unitKey(u: string): string {
  return u.replace(/s$/, "");
}

function unitLabel(u: string, n: number): string {
  const full: Record<string, string> = { sec: "second", min: "minute", hr: "hour" };
  const base = full[unitKey(u)] ?? unitKey(u);
  return n === 1 ? base : `${base}s`;
}

/**
 * Answer a plain math ask, or `undefined` when it isn't one. `q` is already
 * lowercased with fillers stripped ("what is 15% of 80", "calculate 3*(4+5)").
 */
export function answerMath(q: string): string | undefined {
  const body = q.replace(/^(?:what is|what are|what does|calculate|compute|work out|figure out|how much is|quick math:?|math:?)\s+/, "").replace(/\s+(?:equal|equals|come to|make)$/, "").trim();

  // Dates ("9/25"), times ("3:30") and clock math ("2 hours from now") belong elsewhere.
  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(body) || /\d:\d{2}/.test(body)) return undefined;
  if (/\b(?:from now|ago|until|till|since|after|before|am|pm|today|tomorrow)\b/.test(body)) return undefined;

  // "15% of 80", "15 percent of $80"
  let m = /^(-?[\d.,]+)\s*(?:%|percent) of \$?(-?[\d.,]+)$/.exec(body);
  if (m) {
    const pct = Number(m[1].replace(/,/g, ""));
    const of = Number(m[2].replace(/,/g, ""));
    if (Number.isFinite(pct) && Number.isFinite(of)) return `${m[1]}% of ${m[2]} is ${bold(formatNumber((pct / 100) * of))}.`;
  }

  // "42 out of 50 as a percent", "what percent is 42 of 50", "42/50 as a percentage"
  m = /^(?:what (?:percent(?:age)?) (?:is|of) )?([\d.,]+)\s*(?:out of|of|\/)\s*([\d.,]+)(?: (?:as|in|to) (?:an? )?percent(?:age)?| (?:is )?what percent(?:age)?| percent(?:age)?)?$/.exec(body);
  if (m && (/percent/.test(body) || /\bout of\b/.test(body))) {
    const a = Number(m[1].replace(/,/g, ""));
    const b = Number(m[2].replace(/,/g, ""));
    if (b > 0) return `${m[1]} out of ${m[2]} is ${bold(`${formatNumber((a / b) * 100)}%`)}.`;
  }

  // "3.5 hours in minutes", "convert 90 minutes to hours", "how many minutes in 2 hours"
  m = new RegExp(`^(?:convert )?([\\d.,]+) ${UNIT_RE} (?:in|to|into|as) ${UNIT_RE}$`).exec(body) ??
    (() => {
      const r = new RegExp(`^how many ${UNIT_RE} (?:are )?in (?:an? |one )?([\\d.,]*)\\s*${UNIT_RE}$`).exec(q);
      return r ? ([r[0], r[2] || "1", r[3], r[1]] as unknown as RegExpExecArray) : null;
    })();
  if (m) {
    const n = Number((m[1] || "1").replace(/,/g, ""));
    const from = UNIT_MIN[unitKey(m[2])];
    const to = UNIT_MIN[unitKey(m[3])];
    if (Number.isFinite(n) && from && to) {
      const v = (n * from) / to;
      return `${formatNumber(n)} ${unitLabel(m[2], n)} is ${bold(`${formatNumber(v)} ${unitLabel(m[3], v)}`)}.`;
    }
  }

  // Plain arithmetic. Only digits, operators and operator words may appear.
  if (!/\d/.test(body)) return undefined;
  const scrub = body.replace(/\b(?:multiplied by|divided by|to the power of|raised to|added to|times|over|plus|minus|squared|cubed|percent|subtract(?:ed)?)\b/g, " ");
  // "x" counts only between numbers ("12 x 3"); "2x + 3" is algebra, not ours.
  if (/[a-z]/i.test(scrub.replace(TIMES_X, "$1 "))) return undefined;
  const v = evaluate(body);
  if (v === null) return undefined;
  return `${pretty(body)} = ${bold(formatNumber(v))}.`;
}
