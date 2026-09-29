import "server-only";

import {
  createChatCompletion,
  ProviderRequestError,
  type OpenAiTool,
  type ChatMessage,
} from "./openai-compatible";
import { LLM_PROVIDERS, publicProvider, type LlmProviderConfig, type PublicLlmModel } from "./providers";

const cooldownUntil = new Map<string, number>();
const COOLDOWN_429_MS = 15 * 60_000;
const COOLDOWN_413_MS = 5 * 60_000;
const COOLDOWN_5XX_MS = 60_000;
const COOLDOWN_DEFAULT_MS = 30_000;

function keyFor(provider: LlmProviderConfig) {
  return process.env[provider.keyEnv]?.trim();
}

function configuredProviders(): LlmProviderConfig[] {
  return LLM_PROVIDERS
    .filter((provider) => provider.supportsTools && Boolean(keyFor(provider)))
    .sort((a, b) => a.tier - b.tier);
}

/** Model discovery must never contact upstreams or spend quota. */
export async function availableLlmModels(): Promise<PublicLlmModel[]> {
  return configuredProviders().map(publicProvider);
}

export async function providerCandidates(selectedId?: string): Promise<{
  providers: LlmProviderConfig[];
  requestedUnavailable: boolean;
}> {
  const configured = configuredProviders();
  const enabled = configured.filter((provider) => (cooldownUntil.get(provider.id) ?? 0) <= Date.now());
  if (!selectedId || selectedId === "auto") return { providers: enabled, requestedUnavailable: false };
  const selected = enabled.find((provider) => provider.id === selectedId);
  return {
    providers: selected ? [selected, ...enabled.filter((provider) => provider.id !== selected.id)] : enabled,
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
  cooldownUntil.set(provider.id, Date.now() + Math.max(retryAfter ?? fallback, 5_000));
}

export function shouldFallbackProvider(error: unknown) {
  if (!(error instanceof ProviderRequestError)) {
    return error instanceof Error && (
      error.name === "MalformedToolArgumentsError" ||
      error.message.includes("maximum tool-call loop")
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
    })
  );
}

export async function callRoutedProvider(opts: {
  selectedId?: string;
  messages: ChatMessage[];
  tools: OpenAiTool[];
  run: (provider: LlmProviderConfig, key: string) => Promise<{
    text: string;
    actions: unknown[];
    latencyMs: number;
  }>;
}) {
  const { providers, requestedUnavailable } = await providerCandidates(opts.selectedId);
  let lastError: unknown;
  for (const provider of providers) {
    const key = keyFor(provider);
    if (!key) continue;
    const started = Date.now();
    try {
      const result = await opts.run(provider, key);
      logLlmRequest({ provider, latencyMs: result.latencyMs || Date.now() - started, ok: true });
      return {
        ...result,
        provider: publicProvider(provider),
        fellBack:
          requestedUnavailable ||
          (Boolean(opts.selectedId) && opts.selectedId !== "auto" && provider.id !== opts.selectedId),
      };
    } catch (error) {
      lastError = error;
      logLlmRequest({ provider, latencyMs: Date.now() - started, ok: false, error });
      if (!shouldFallbackProvider(error)) throw error;
      putProviderOnCooldown(provider, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No healthy LLM provider is available");
}

export { createChatCompletion };
