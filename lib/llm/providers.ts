export type ProviderTier = 1 | 2;

export type LlmProviderConfig = {
  id: string;
  label: string;
  baseURL: string;
  keyEnv: string;
  model: string;
  supportsTools: boolean;
  tier: ProviderTier;
};

/**
 * Server-side provider registry. Model IDs and base URLs were checked against
 * each provider's official docs on 2026-09-23; runtime discovery still treats
 * `/models` plus a real tool call as the authority before enabling an entry.
 */
export const LLM_PROVIDERS: readonly LlmProviderConfig[] = [
  {
    id: "groq-gpt-oss-120b",
    label: "Groq · GPT-OSS 120B",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    model: "openai/gpt-oss-120b",
    supportsTools: true,
    tier: 1,
  },
  // Flash-Lite has the highest free-tier RPM and daily caps of the Gemini models,
  // so it is the first fallback behind Groq.
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    model: "gemini-3.5-flash-lite",
    supportsTools: true,
    tier: 1,
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    model: "gemini-3.1-flash-lite",
    supportsTools: true,
    tier: 1,
  },
  {
    id: "mistral-small",
    label: "Mistral Small",
    baseURL: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    model: "mistral-small-latest",
    supportsTools: true,
    tier: 1,
  },
  {
    id: "cerebras-gpt-oss-120b",
    label: "Cerebras · GPT-OSS 120B",
    baseURL: "https://api.cerebras.ai/v1",
    keyEnv: "CEREBRAS_API_KEY",
    model: "gpt-oss-120b",
    supportsTools: true,
    tier: 2,
  },
  {
    id: "nvidia-nemotron-3-super-120b",
    label: "NVIDIA NIM · Nemotron 3 Super 120B",
    baseURL: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    model: "nvidia/nemotron-3-super-120b-a12b",
    supportsTools: true,
    tier: 2,
  },
  {
    id: "groq-gpt-oss-20b",
    label: "Groq · GPT-OSS 20B",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    model: "openai/gpt-oss-20b",
    supportsTools: true,
    tier: 2,
  },
] as const;

export type PublicLlmModel = Pick<LlmProviderConfig, "id" | "label" | "model" | "tier">;

export function publicProvider(provider: LlmProviderConfig): PublicLlmModel {
  return {
    id: provider.id,
    label: provider.label,
    model: provider.model,
    tier: provider.tier,
  };
}
