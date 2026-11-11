import type { ChatMessage, ToolCall } from "./openai-compatible";

/**
 * Reads an OpenAI-compatible `stream: true` completion: text deltas are handed
 * to `onText` as they arrive, tool-call fragments are stitched back together by
 * index, and the result has the same shape as a non-streaming reply.
 */
export async function readChatStream(
  stream: ReadableStream<Uint8Array>,
  onText: (delta: string) => void,
): Promise<ChatMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const calls: ToolCall[] = [];

  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let json: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
            extra_content?: Record<string, unknown>;
          }>;
        };
      }>;
    };
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    for (const fragment of delta.tool_calls ?? []) {
      const i = fragment.index ?? calls.length;
      const call = (calls[i] ??= {
        id: fragment.id || `call-${i}`,
        type: "function",
        function: { name: "", arguments: "" },
      });
      if (fragment.id) call.id = fragment.id;
      if (fragment.function?.name) call.function.name += fragment.function.name;
      if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
      if (fragment.extra_content) call.extra_content = fragment.extra_content;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, nl).replace(/\r$/, ""));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer) handle(buffer.replace(/\r$/, ""));

  const tool_calls = calls
    .filter((c) => c?.function.name)
    .map((c) => ({ ...c, function: { ...c.function, arguments: c.function.arguments || "{}" } }));
  return {
    role: "assistant",
    content: content || null,
    tool_calls: tool_calls.length ? tool_calls : undefined,
  };
}
