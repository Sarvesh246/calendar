/** Transient Gemini / proxy statuses that are worth retrying. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

export type GeminiFailureCode = "assistant-busy" | "assistant-unreachable";

export type GeminiFetchResult =
  | { ok: true; data: unknown }
  | { ok: false; lastStatus: number; error: GeminiFailureCode };

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

export function classifyGeminiFailure(lastStatus: number): GeminiFailureCode {
  if (lastStatus === 429 || lastStatus === 503) return "assistant-busy";
  return "assistant-unreachable";
}

export function isGeminiTransientStatus(status: number): boolean {
  return TRANSIENT.has(status);
}

/** Cap waits so a Retry-After of minutes cannot eat the whole function budget. */
const RETRY_AFTER_CAP_MS = 15_000;

export function parseRetryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - now, 0), RETRY_AFTER_CAP_MS);
}

/** `retryIndex` is 0 after the first failure. */
export function geminiBackoffMs(
  retryIndex: number,
  opts?: { retryAfterMs?: number; random?: () => number }
): number {
  if (opts?.retryAfterMs && opts.retryAfterMs > 0) {
    return Math.min(Math.max(opts.retryAfterMs, 750), RETRY_AFTER_CAP_MS);
  }
  const rand = opts?.random ?? Math.random;
  const base = 1_000 * 2 ** retryIndex;
  return Math.min(base + rand() * 500, 12_000);
}

export async function fetchGeminiJson(opts: {
  url: string;
  body: string;
  timeoutMs: number;
  attempts?: number;
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  log?: (msg: string, extra?: unknown) => void;
}): Promise<GeminiFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const attempts = Math.max(1, opts.attempts ?? 5);
  const started = now();
  const deadline = opts.budgetMs != null ? started + opts.budgetMs : Number.POSITIVE_INFINITY;
  const minAttemptMs = 4_000;

  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const remaining = deadline - now();
    if (attempt > 0 && remaining < minAttemptMs) break;

    const timeoutMs = Number.isFinite(remaining)
      ? Math.max(1_000, Math.min(opts.timeoutMs, remaining - 500))
      : opts.timeoutMs;

    let retryAfterMs: number | undefined;
    try {
      const r = await fetchImpl(opts.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: opts.body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) {
        try {
          return { ok: true, data: await r.json() };
        } catch (err) {
          lastStatus = r.status;
          opts.log?.("Gemini JSON parse failed", err);
        }
      } else {
        lastStatus = r.status;
        retryAfterMs = parseRetryAfterMs(r.headers.get("retry-after"), now());
        const detail = await r.text().catch(() => "");
        opts.log?.(`Gemini error ${r.status}`, detail.slice(0, 300));
        if (!TRANSIENT.has(r.status)) {
          return { ok: false, lastStatus, error: classifyGeminiFailure(lastStatus) };
        }
      }
    } catch (err) {
      lastStatus = 0;
      opts.log?.("Gemini request failed", err);
    }

    if (attempt + 1 >= attempts) break;
    const wait = geminiBackoffMs(attempt, { retryAfterMs, random: opts.random });
    const room = deadline - now() - minAttemptMs;
    if (Number.isFinite(room) && room < 400) break;
    await sleep(Number.isFinite(room) ? Math.min(wait, Math.max(room, 400)) : wait);
  }

  return { ok: false, lastStatus, error: classifyGeminiFailure(lastStatus) };
}
