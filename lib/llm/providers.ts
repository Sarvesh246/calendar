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
  {
    id: "groq-llama-3.3-70b",
    label: "Groq · Llama 3.3 70B",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    supportsTools: true,
    tier: 1,
  },
  {
    id: "gemini-flash",
    label: "Gemini 3 Flash Preview",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    model: "gemini-3-flash-preview",
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
    id: "nvidia-llama-3.3-70b",
    label: "NVIDIA NIM · Llama 3.3 70B",
    baseURL: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    model: "meta/llama-3.3-70b-instruct",
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
