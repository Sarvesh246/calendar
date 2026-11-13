import "server-only";

import {
  createChatCompletion,
  ProviderRequestError,
  type OpenAiTool,
  type ChatMessage,
} from "./openai-compatible";
import {
  LLM_PROVIDERS,
  isLargeModel,
  publicProvider,
  type LlmProviderConfig,
  type PublicLlmModel,
} from "./providers";

import { loadDurableCooldowns, mergeCooldowns, persistDurableCooldown } from "./cooldown-store";

/** This instance's view of provider cooldowns; the durable store is the source
 *  of truth across cold starts and instances (see cooldown-store.ts). */
let cooldownUntil = new Map<string, number>();
let lastDurableRead = 0;
const DURABLE_REFRESH_MS = 5_000;

async function refreshCooldowns() {
  if (Date.now() - lastDurableRead < DURABLE_REFRESH_MS) return;
  lastDurableRead = Date.now();
  cooldownUntil = mergeCooldowns(cooldownUntil, await loadDurableCooldowns());
}
const COOLDOWN_429_MS = 15 * 60_000;
const COOLDOWN_413_MS = 5 * 60_000;
const COOLDOWN_5XX_MS = 60_000;
const COOLDOWN_DEFAULT_MS = 30_000;

function keyFor(provider: LlmProviderConfig) {
  return process.env[provider.keyEnv]?.trim();
}

function configuredProviders(): LlmProviderConfig[] {
  return LLM_PROVIDERS.filter(
    (provider) => provider.supportsTools && Boolean(keyFor(provider)),
  ).sort((a, b) => a.tier - b.tier);
}

/** Model discovery must never contact upstreams or spend quota. */
export async function availableLlmModels(): Promise<PublicLlmModel[]> {
  return configuredProviders().map(publicProvider);
}

const isAuto = (selectedId?: string) => !selectedId || selectedId === "auto";

export async function providerCandidates(
  selectedId?: string,
  mutation = false,
): Promise<{
  providers: LlmProviderConfig[];
  requestedUnavailable: boolean;
}> {
  await refreshCooldowns();
  const configured = configuredProviders();
  const enabled = configured.filter(
    (provider) => (cooldownUntil.get(provider.id) ?? 0) <= Date.now(),
  );
  // Auto keeps the registry order for every message, writes included, so the
  // provider with room for the full prompt answers. With an explicitly picked
  // model, writes still go to the larger models first; smaller ones stay in the
  // list as a fallback, since a card from a smaller model beats no answer.
  if (isAuto(selectedId)) return { providers: enabled, requestedUnavailable: false };
  const largeFirst = (list: LlmProviderConfig[]) =>
    mutation
      ? [
          ...list.filter((provider) => isLargeModel(provider.model)),
          ...list.filter((provider) => !isLargeModel(provider.model)),
        ]
      : list;
  const selected = enabled.find((provider) => provider.id === selectedId);
  return {
    providers: largeFirst(
      selected ? [selected, ...enabled.filter((provider) => provider.id !== selected.id)] : enabled,
    ),
    requestedUnavailable: !selected,
  };
}

export function putProviderOnCooldown(provider: LlmProviderConfig, error: unknown) {
  const status = error instanceof ProviderRequestError ? error.status : 0;
  const retryAfter = error instanceof ProviderRequestError ? error.retryAfterMs : undefined;
  const fallback =
    status === 429
      ? COOLDOWN_429_MS
      : status === 413
        ? COOLDOWN_413_MS
        : status >= 500
          ? COOLDOWN_5XX_MS
          : COOLDOWN_DEFAULT_MS;
  const until = Date.now() + Math.max(retryAfter ?? fallback, 5_000);
  cooldownUntil.set(provider.id, until);
  // Remembered beyond this instance, so the next cold start does not retry a
  // provider that just said 429.
  void persistDurableCooldown(provider.id, until);
}

export function shouldFallbackProvider(error: unknown) {
  if (!(error instanceof ProviderRequestError)) {
    return (
      error instanceof Error &&
      (error.name === "MalformedToolArgumentsError" ||
        error.message.includes("Mutation requires a 120B model") ||
        error.message.includes("maximum tool-call loop"))
    );
  }
  return (
    error.status === 0 ||
    error.status === 408 ||
    error.status === 413 ||
    error.status === 429 ||
    error.status >= 500 ||
    error.modelNotFound
  );
}

export function logLlmRequest(data: {
  provider: LlmProviderConfig;
  latencyMs: number;
  ok: boolean;
  error?: unknown;
}) {
  const error = data.error;
  console.info(
    JSON.stringify({
      event: "assistant.llm",
      provider: data.provider.id,
      model: data.provider.model,
      latencyMs: data.latencyMs,
      ok: data.ok,
      status: error instanceof ProviderRequestError ? error.status : undefined,
      errorType: error instanceof Error ? error.name : undefined,
    }),
  );
}

export async function callRoutedProvider(opts: {
  selectedId?: string;
  mutation?: boolean;
  messages: ChatMessage[];
  tools: OpenAiTool[];
  run: (
    provider: LlmProviderConfig,
    key: string,
    /** True while a larger model is still untried for this request. */
    route: { largerModelAvailable: boolean },
  ) => Promise<{
    text: string;
    actions: unknown[];
    latencyMs: number;
    /** Rows and choices the model asked the app to draw. */
    items?: { ids: string[]; heading?: string }[];
    choices?: string[];
  }>;
}) {
  const { providers, requestedUnavailable } = await providerCandidates(
    opts.selectedId,
    opts.mutation,
  );
  let lastError: unknown;
  // A smaller model that tried to stage a change is set aside while a larger
  // one is untried, then gets a second turn at the end of the queue.
  const queue = [...providers];
  const requeued = new Set<string>();
  for (let i = 0; i < queue.length; i += 1) {
    const provider = queue[i];
    const key = keyFor(provider);
    if (!key) continue;
    const started = Date.now();
    // Only an explicit model choice hands writes up to a larger model; in Auto
    // the first healthy provider stages them itself.
    const largerModelAvailable =
      !isAuto(opts.selectedId) &&
      queue.slice(i + 1).some((next) => isLargeModel(next.model) && Boolean(keyFor(next)));
    try {
      const result = await opts.run(provider, key, { largerModelAvailable });
      logLlmRequest({ provider, latencyMs: result.latencyMs || Date.now() - started, ok: true });
      return {
        ...result,
        provider: publicProvider(provider),
        fellBack:
          requestedUnavailable || (!isAuto(opts.selectedId) && provider.id !== opts.selectedId),
      };
    } catch (error) {
      lastError = error;
      logLlmRequest({ provider, latencyMs: Date.now() - started, ok: false, error });
      if (!shouldFallbackProvider(error)) throw error;
      if (error instanceof Error && error.message.includes("Mutation requires a 120B model")) {
        if (!requeued.has(provider.id)) {
          requeued.add(provider.id);
          queue.push(provider);
        }
      } else putProviderOnCooldown(provider, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No healthy LLM provider is available");
}

export { createChatCompletion };
