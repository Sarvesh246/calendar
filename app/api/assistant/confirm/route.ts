import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticationRequired,
  clientKey,
  getRequestUser,
  isJsonRequest,
  rateLimit,
  sameOrigin,
  tooMany,
} from "@/lib/api-guard";
import { confirmPendingAction } from "@/lib/llm/tools";

export const runtime = "nodejs";

const bodySchema = z.object({ confirmationId: z.string().uuid() });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "bad-request" }, { status: 400 });
  const user = await getRequestUser(request);
  if (!user) return authenticationRequired();
  if (!rateLimit(`assistant:confirm:${user.id}:${clientKey(request)}`, 30, 60_000)) return tooMany();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad-request" }, { status: 400 });
  try {
    return NextResponse.json(await confirmPendingAction(user.id, parsed.data.confirmationId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const publicMessage = /missing, expired, or already used|already used/i.test(message)
      ? message
      : "confirmation-failed";
    if (publicMessage === "confirmation-failed") {
      console.error("[assistant] confirmation failed", error instanceof Error ? error.name : "unknown");
    }
    return NextResponse.json(
      { error: publicMessage },
      { status: 409 }
    );
  }
}
