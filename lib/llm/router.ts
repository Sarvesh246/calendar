import {
  createChatCompletion,
  listProviderModels,
  ProviderRequestError,
  type ChatMessage,
  type OpenAiTool,
} from "./openai-compatible";
import { LLM_PROVIDERS, publicProvider, type LlmProviderConfig, type PublicLlmModel } from "./providers";

type ProviderHealth = {
  provider: LlmProviderConfig;
  enabled: boolean;
  checkedAt: number;
  error?: string;
};

const healthCache = new Map<string, ProviderHealth>();
const healthInFlight = new Map<string, Promise<ProviderHealth>>();
const cooldownUntil = new Map<string, number>();
const HEALTHY_TTL = 6 * 60 * 60_000;
const FAILED_TTL = 60_000;

const PROBE_TOOL: OpenAiTool = {
  type: "function",
  function: {
    name: "datebook_probe",
    description: "Required startup capability probe. Always call this function.",
    parameters: {
      type: "object",
      properties: { value: { type: "string", enum: ["ready"] } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};

function keyFor(provider: LlmProviderConfig) {
  return process.env[provider.keyEnv]?.trim();
}

async function checkProvider(provider: LlmProviderConfig, force = false): Promise<ProviderHealth> {
  const key = keyFor(provider);
  if (!key) return { provider, enabled: false, checkedAt: Date.now() };
  const cached = healthCache.get(provider.id);
  const ttl = cached?.enabled ? HEALTHY_TTL : FAILED_TTL;
  if (!force && cached && Date.now() - cached.checkedAt < ttl) return cached;
  const existing = healthInFlight.get(provider.id);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const models = await listProviderModels(provider, key);
      if (!models.has(provider.model)) {
        return {
          provider,
          enabled: false,
          checkedAt: Date.now(),
          error: `Model ${provider.model} was not returned by /models`,
        };
      }
      if (!provider.supportsTools) {
        return { provider, enabled: false, checkedAt: Date.now(), error: "Tool calling disabled" };
      }
      const probe = await createChatCompletion({
        provider,
        key,
        messages: [
          { role: "system", content: "This is a capability check. Call the required tool exactly once." },
          { role: "user", content: "Call datebook_probe with value ready." },
        ],
        tools: [PROBE_TOOL],
        forceTool: "datebook_probe",
        timeoutMs: 12_000,
      });
      const call = probe.message.tool_calls?.[0];
      let args: unknown;
      try {
        args = JSON.parse(call?.function.arguments || "{}");
      } catch {
        args = null;
      }
      const enabled = call?.function.name === "datebook_probe" && (args as { value?: unknown } | null)?.value === "ready";
      return {
        provider,
        enabled,
        checkedAt: Date.now(),
        error: enabled ? undefined : "Tool-call smoke test did not return the required call",
      };
    } catch (error) {
      return {
        provider,
        enabled: false,
        checkedAt: Date.now(),
        error: error instanceof Error ? error.message.slice(0, 180) : "Provider check failed",
      };
    }
  })();
  healthInFlight.set(provider.id, promise);
  try {
    const result = await promise;
    healthCache.set(provider.id, result);
    return result;
  } finally {
    healthInFlight.delete(provider.id);
  }
}

export async function availableLlmModels(force = false): Promise<PublicLlmModel[]> {
  const checks = await Promise.all(LLM_PROVIDERS.map((provider) => checkProvider(provider, force)));
  return checks.filter((result) => result.enabled).map((result) => publicProvider(result.provider));
}

export async function providerCandidates(selectedId?: string): Promise<{
  providers: LlmProviderConfig[];
  requestedUnavailable: boolean;
}> {
  const checks = await Promise.all(LLM_PROVIDERS.map((provider) => checkProvider(provider)));
  const enabled = checks
    .filter((result) => result.enabled && (cooldownUntil.get(result.provider.id) ?? 0) <= Date.now())
    .map((result) => result.provider)
    .sort((a, b) => a.tier - b.tier);
  if (!selectedId || selectedId === "auto") return { providers: enabled, requestedUnavailable: false };
  const selected = enabled.find((provider) => provider.id === selectedId);
  return {
    providers: selected ? [selected, ...enabled.filter((provider) => provider.id !== selected.id)] : enabled,
    requestedUnavailable: !selected,
  };
}

export function putProviderOnCooldown(provider: LlmProviderConfig, error: unknown) {
  const retryAfter = error instanceof ProviderRequestError ? error.retryAfterMs : undefined;
  cooldownUntil.set(provider.id, Date.now() + Math.max(retryAfter ?? 30_000, 5_000));
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
      error: error instanceof Error ? error.message.slice(0, 180) : undefined,
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
        fellBack: requestedUnavailable || (Boolean(opts.selectedId) && opts.selectedId !== "auto" && provider.id !== opts.selectedId),
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

// A server process validates configured providers as soon as this module is
// loaded. Requests share the same in-flight probes, so cold starts do not send
// duplicate /models or tool-smoke calls.
void availableLlmModels().catch((error) => console.error("[assistant] provider startup check failed", error));
