/**
 * Reads the assistant's event stream: `text` deltas build the reply as it is
 * written, `reset` throws away text from a turn that went on to call tools (or
 * from a provider that failed over), and `done` / `error` end it.
 */
export async function readAssistantStream<T = Record<string, unknown>>(
  stream: ReadableStream<Uint8Array>,
  onPartial: (text: string) => void,
): Promise<T | { error: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let result: T | { error: string } | null = null;

  const handle = (block: string) => {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (event === "text") {
      text += String((json as { delta?: unknown }).delta ?? "");
      onPartial(text);
    } else if (event === "reset") {
      text = "";
      onPartial("");
    } else if (event === "done") {
      result = json as T;
    } else if (event === "error") {
      result = { error: String((json as { error?: unknown }).error ?? "assistant-unreachable") };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      handle(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  if (buffer.trim()) handle(buffer);
  return result ?? { error: "assistant-unreachable" };
}
