import type { LlmProviderConfig } from "./providers";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  extra_content?: Record<string, unknown>;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type ChatCompletion = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
        extra_content?: Record<string, unknown>;
      }>;
    };
  }>;
};

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
    readonly modelNotFound = false
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 15 * 60_000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - Date.now(), 0), 15 * 60_000);
}

function headers(provider: LlmProviderConfig, key: string) {
  const result: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (provider.id === "gemini-flash") result["x-goog-api-client"] = "datebook-router/1.0";
  return result;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderRequestError(message || "Provider request timed out", 0);
  }
}

export async function listProviderModels(provider: LlmProviderConfig, key: string): Promise<Set<string>> {
  const response = await fetchWithTimeout(
    `${provider.baseURL.replace(/\/$/, "")}/models`,
    { method: "GET", headers: headers(provider, key) },
    10_000
  );
  const text = await response.text();
  if (!response.ok) {
    throw new ProviderRequestError(
      text.slice(0, 300),
      response.status,
      retryAfterMs(response.headers.get("retry-after")),
      response.status === 404
    );
  }
  let parsed: { data?: Array<{ id?: string }> };
  try {
    parsed = JSON.parse(text) as { data?: Array<{ id?: string }> };
  } catch {
    throw new ProviderRequestError("Provider returned invalid model-list JSON", response.status);
  }
  return new Set(
    (parsed.data ?? [])
      .map((model) => model.id?.replace(/^models\//, ""))
      .filter((id): id is string => Boolean(id))
  );
}

export async function createChatCompletion(opts: {
  provider: LlmProviderConfig;
  key: string;
  messages: ChatMessage[];
  tools: OpenAiTool[];
  timeoutMs?: number;
  forceTool?: string;
}): Promise<{ message: ChatMessage; latencyMs: number }> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: opts.provider.model,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: opts.forceTool
      ? { type: "function", function: { name: opts.forceTool } }
      : "auto",
    parallel_tool_calls: false,
    temperature: 0.2,
    max_tokens: 1_200,
  };
  const response = await fetchWithTimeout(
    `${opts.provider.baseURL.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: headers(opts.provider, opts.key),
      body: JSON.stringify(body),
    },
    opts.timeoutMs ?? 18_000
  );
  const text = await response.text();
  if (!response.ok) {
    const notFound =
      response.status === 404 ||
      (response.status === 400 && /model.{0,40}(not found|does not exist|unknown)/i.test(text));
    throw new ProviderRequestError(
      text.slice(0, 500),
      response.status,
      retryAfterMs(response.headers.get("retry-after")),
      notFound
    );
  }
  let data: ChatCompletion;
  try {
    data = JSON.parse(text) as ChatCompletion;
  } catch {
    throw new ProviderRequestError("Provider returned invalid completion JSON", response.status);
  }
  const raw = data.choices?.[0]?.message;
  if (!raw) throw new ProviderRequestError("Provider returned no assistant message", response.status);
  const toolCalls: ToolCall[] | undefined = raw.tool_calls
    ?.map((call, index) => ({
      id: call.id || `call-${index}`,
      type: "function" as const,
      function: {
        name: call.function?.name || "",
        arguments: call.function?.arguments || "{}",
      },
      ...(call.extra_content ? { extra_content: call.extra_content } : {}),
    }))
    .filter((call) => Boolean(call.function.name));
  return {
    latencyMs: Date.now() - started,
    message: {
      role: "assistant",
      content: typeof raw.content === "string" ? raw.content : null,
      tool_calls: toolCalls?.length ? toolCalls : undefined,
    },
  };
}
