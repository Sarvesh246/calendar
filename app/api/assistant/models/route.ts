import { NextResponse } from "next/server";
import { clientKey, rateLimit, sameOrigin, tooMany } from "@/lib/api-guard";
import { availableLlmModels } from "@/lib/llm/router";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!rateLimit(`assistant:models:${clientKey(request)}`, 20, 60_000)) return tooMany();
  const models = await availableLlmModels();
  return NextResponse.json({ models, checkedAt: new Date().toISOString() });
}
