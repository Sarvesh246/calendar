import type { ChatMessage } from "./openai-compatible";
import { assistantDatabase } from "./database";

export async function ensureAssistantThread(userId: string, threadId: string) {
  const db = assistantDatabase();
  if (!db) return;
  const { data: existing, error: readError } = await db
    .from("assistant_threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(`Could not read assistant thread: ${readError.message}`);
  const query = existing
    ? db.from("assistant_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId).eq("user_id", userId)
    : db.from("assistant_threads").insert({ id: threadId, user_id: userId });
  const { error } = await query;
  if (error) throw new Error(`Could not store assistant thread: ${error.message}`);
}

export async function loadAssistantHistory(userId: string, threadId: string): Promise<ChatMessage[]> {
  const db = assistantDatabase();
  if (!db) return [];
  const { data, error } = await db
    .from("assistant_messages")
    .select("role, content")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) throw new Error(`Could not load assistant history: ${error.message}`);
  return (data ?? [])
    .reverse()
    .map((row) => {
      const content = row.content as { text?: unknown; toolCallId?: unknown; name?: unknown } | null;
      const role = row.role as ChatMessage["role"];
      return {
        role,
        content: typeof content?.text === "string" ? content.text : "",
        tool_call_id: typeof content?.toolCallId === "string" ? content.toolCallId : undefined,
        name: typeof content?.name === "string" ? content.name : undefined,
      };
    });
}

export async function storeAssistantMessage(opts: {
  userId: string;
  threadId: string;
  role: ChatMessage["role"];
  text: string;
  providerId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = assistantDatabase();
  if (!db) return;
  const { error } = await db.from("assistant_messages").insert({
    user_id: opts.userId,
    thread_id: opts.threadId,
    role: opts.role,
    content: { text: opts.text, ...opts.metadata },
    provider_id: opts.providerId ?? null,
    model_id: opts.model ?? null,
  });
  if (error) throw new Error(`Could not store assistant message: ${error.message}`);
  await db
    .from("assistant_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", opts.threadId)
    .eq("user_id", opts.userId);
}
