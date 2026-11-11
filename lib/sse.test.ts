import { describe, expect, it, vi } from "vitest";
import { readAssistantStream } from "./sse";

vi.mock("server-only", () => ({}));
const { readChatStream } = await import("./llm/stream");

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe("readAssistantStream (what the client reads)", () => {
  it("builds the text up, then returns the final payload", async () => {
    const seen: string[] = [];
    const out = await readAssistantStream(
      streamOf([
        'event: text\ndata: {"delta":"You have "}\n\nevent: text\ndata: {"del',
        'ta":"2 things."}\n\nevent: done\ndata: {"text":"You have 2 things.","actions":[]}\n\n',
      ]),
      (t) => seen.push(t),
    );
    expect(seen).toEqual(["You have ", "You have 2 things."]);
    expect(out).toMatchObject({ text: "You have 2 things." });
  });

  it("reset throws away text from a turn that went on to call tools", async () => {
    const seen: string[] = [];
    await readAssistantStream(
      streamOf([
        'event: text\ndata: {"delta":"Let me check"}\n\n',
        "event: reset\ndata: {}\n\n",
        'event: text\ndata: {"delta":"Done."}\n\nevent: done\ndata: {"text":"Done."}\n\n',
      ]),
      (t) => seen.push(t),
    );
    expect(seen).toEqual(["Let me check", "", "Done."]);
  });

  it("an error event, or a stream that just stops, is a typed error", async () => {
    expect(
      await readAssistantStream(
        streamOf(['event: error\ndata: {"error":"assistant-unreachable"}\n\n']),
        () => {},
      ),
    ).toEqual({ error: "assistant-unreachable" });
    expect(await readAssistantStream(streamOf([]), () => {})).toEqual({
      error: "assistant-unreachable",
    });
  });
});

describe("readChatStream (what the provider sends)", () => {
  const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

  it("streams text deltas and returns the whole message", async () => {
    const deltas: string[] = [];
    const message = await readChatStream(
      streamOf([
        sse({ choices: [{ delta: { content: "No, " } }] }),
        sse({ choices: [{ delta: { content: "you have a conflict." } }] }),
        "data: [DONE]\n\n",
      ]),
      (d) => deltas.push(d),
    );
    expect(deltas).toEqual(["No, ", "you have a conflict."]);
    expect(message).toEqual({
      role: "assistant",
      content: "No, you have a conflict.",
      tool_calls: undefined,
    });
  });

  it("stitches a tool call back together from fragments", async () => {
    const message = await readChatStream(
      streamOf([
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "c1",
                    function: { name: "add_event", arguments: '{"title":"Gy' },
                  },
                ],
              },
            },
          ],
        }),
        sse({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'm"}' } }] } }],
        }),
      ]),
      () => {},
    );
    expect(message.content).toBeNull();
    expect(message.tool_calls).toEqual([
      { id: "c1", type: "function", function: { name: "add_event", arguments: '{"title":"Gym"}' } },
    ]);
  });
});
