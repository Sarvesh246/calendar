import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKey, getRequestUser, rateLimit, sameOrigin, tooMany } from "@/lib/api-guard";
import { confirmPendingAction } from "@/lib/llm/tools";

export const runtime = "nodejs";

const bodySchema = z.object({ confirmationId: z.string().uuid() });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "authentication-required" }, { status: 401 });
  if (!rateLimit(`assistant:confirm:${user.id}:${clientKey(request)}`, 30, 60_000)) return tooMany();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad-request" }, { status: 400 });
  try {
    return NextResponse.json(await confirmPendingAction(user.id, parsed.data.confirmationId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "confirmation-failed" },
      { status: 409 }
    );
  }
}
