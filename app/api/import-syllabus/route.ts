import { NextResponse } from "next/server";
import {
  MAX_SYLLABUS_BODY,
  MAX_SYLLABUS_PDF_BYTES,
  SYLLABUS_BURST,
  SYLLABUS_HOURLY_ANON,
  SYLLABUS_HOURLY_AUTH,
  clientKey,
  durableHourlyLimit,
  getRequestUser,
  rateLimit,
  sameOrigin,
  tooMany,
} from "@/lib/api-guard";
import {
  isPdfMagic,
  normalizeSyllabusExtraction,
  parseCategoryHints,
  type SyllabusCategoryHint,
} from "@/lib/syllabus-extract";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const KEY = process.env.GEMINI_API_KEY;
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** PDF parse is slow; stay under maxDuration even with one retry on a fast 503. */
const GEMINI_TIMEOUT_MS = 45_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Gemini response schema                                              */
/* ------------------------------------------------------------------ */

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    courseName: { type: "STRING" },
    courseCode: { type: "STRING" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          dueDate: { type: "STRING" },
          dueTime: { type: "STRING" },
          type: { type: "STRING", enum: ["event", "assignment", "task"] },
          kind: {
            type: "STRING",
            enum: ["homework", "quiz", "exam", "paper", "lab", "project", "discussion", "other"],
          },
          notes: { type: "STRING" },
        },
        required: ["title", "dueDate", "type", "kind"],
        propertyOrdering: ["title", "dueDate", "dueTime", "type", "kind", "notes"],
      },
    },
  },
  required: ["courseName", "courseCode", "items"],
  propertyOrdering: ["courseName", "courseCode", "items"],
} as const;

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

function systemPrompt(opts: {
  now: string;
  timeZone: string;
  categoryId?: string;
  categories: SyllabusCategoryHint[];
}): string {
  const now = new Date(opts.now);
  const tz = opts.timeZone;
  const human = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(now);

  const attached = opts.categoryId
    ? opts.categories.find((c) => c.id === opts.categoryId)
    : undefined;
  const classHint = attached
    ? `The user attached this PDF to the existing class "${attached.name}" (id ${attached.id}). Use that as the course unless the PDF clearly names a different one.`
    : opts.categories.length
      ? `The user's existing class names (for matching courseName / courseCode only — this is not a calendar dump): ${JSON.stringify(opts.categories.map((c) => c.name))}.`
      : `The user did not name a class; read courseName and courseCode from the PDF.`;

  return `You extract dated graded work from a course syllabus PDF for "Datebook", a personal calendar and assignment app.

Right now it is ${human} (timezone ${tz}). Current instant: ${opts.now}.
${classHint}

WHAT TO EXTRACT — graded or due work only:
- homework / problem sets, quizzes, exams (midterm, final), papers / essays, labs, projects / milestones, graded discussions, presentations that have a due date or exam date
- Prefer an extra row over a miss. A human will review before anything is saved.

WHAT TO SKIP:
- lectures, recitations, class meeting times
- office hours, tutoring hours
- policies, grading weights, academic integrity, attendance rules
- undated repeating rules ("homework every Friday", "labs weekly") unless a specific calendar date is listed
- reading lists with no due date
- holidays / no-class days that are not themselves a due date

DATES:
- dueDate MUST be YYYY-MM-DD (no other format)
- Infer the year from the term header (Fall 2026, Spring 2027, AY 2026–27). If none, use the academic year around "now" (Fall starts in August: Aug–Dec dates belong to that fall; Jan–Jul dates belong to the following spring)
- Do not emit dates more than 18 months before today or more than 2 years after today

TIMES:
- dueTime is optional 24-hour HH:mm when the syllabus gives a clock time (exam at 10:00, due 11:59 PM → 23:59)
- Date-only due dates: omit dueTime

TYPE:
- "event" only for timed sittings with a clock time (exams, in-class presentations)
- everything else "assignment" (not "task")

KIND: homework | quiz | exam | paper | lab | project | discussion | other

courseName: the full course title. courseCode: department + number (e.g. ENGL 101) if present, else "".
title: the short assignment name, not the whole course name.
notes: optional one-line extra (chapter, room) — omit if nothing useful.

Reply ONLY with JSON matching the schema.`;
}

function validTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  if (!KEY) {
    return NextResponse.json({ error: "assistant-not-configured" }, { status: 200 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const user = await getRequestUser(request);
  const ip = clientKey(request);
  const limitKey = user ? `syllabus:user:${user.id}` : `syllabus:ip:${ip}`;
  const hourly = user ? SYLLABUS_HOURLY_AUTH : SYLLABUS_HOURLY_ANON;
  if (
    !rateLimit(limitKey, hourly, 60 * 60 * 1000) ||
    !rateLimit(`${limitKey}:burst`, SYLLABUS_BURST, 60_000) ||
    !(await durableHourlyLimit(limitKey, hourly))
  ) {
    return tooMany();
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_SYLLABUS_BODY) {
    return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const pdfField = form.get("pdf") ?? form.get("file");
  if (pdfField == null || typeof pdfField === "string") {
    return NextResponse.json({ error: "missing-pdf" }, { status: 400 });
  }

  const mime = (pdfField.type || "").toLowerCase();
  if (mime && mime !== "application/pdf" && mime !== "application/octet-stream") {
    return NextResponse.json({ error: "invalid-pdf" }, { status: 400 });
  }

  const bytes = new Uint8Array(await pdfField.arrayBuffer());
  if (bytes.byteLength > MAX_SYLLABUS_PDF_BYTES) {
    return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  }
  if (bytes.byteLength === 0 || !isPdfMagic(bytes)) {
    return NextResponse.json({ error: "invalid-pdf" }, { status: 400 });
  }

  const timeZone = strField(form, "timeZone") || "UTC";
  if (!validTimeZone(timeZone)) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  const nowRaw = strField(form, "now");
  const nowDate = nowRaw ? new Date(nowRaw) : new Date();
  if (Number.isNaN(nowDate.getTime())) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  const now = nowDate.toISOString();
  const categoryId = strField(form, "categoryId") || undefined;
  const categories = parseCategoryHints(form.get("categories"));

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt({ now, timeZone, categoryId, categories }) }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
          { text: "Extract the graded due work from this syllabus PDF." },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: "low" },
    },
  });

  const TRANSIENT = new Set([429, 500, 503]);
  let data: unknown;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(400 * attempt + Math.random() * 300);
    let r: Response;
    try {
      r = await fetch(`${ENDPOINT(MODEL)}?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
    } catch (err) {
      lastStatus = 0;
      console.error("[import-syllabus] request failed (attempt", attempt + 1 + ")", err);
      // Timeouts already ate most of maxDuration — don't retry those.
      if (isAbort(err)) break;
      continue;
    }
    if (r.ok) {
      data = await r.json();
      break;
    }
    lastStatus = r.status;
    const detail = await r.text().catch(() => "");
    console.error("[import-syllabus] Gemini error", r.status, detail.slice(0, 300));
    if (!TRANSIENT.has(r.status)) break;
  }
  if (data === undefined) {
    return NextResponse.json(
      { error: lastStatus === 429 || lastStatus === 503 ? "assistant-busy" : "assistant-unreachable" },
      { status: 200 }
    );
  }

  const textOut: string =
    (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
      ?.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? "").join("") ?? "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    const m = textOut.match(/\{[\s\S]*\}/);
    try {
      parsed = m ? JSON.parse(m[0]) : {};
    } catch {
      parsed = {};
    }
  }

  return NextResponse.json(normalizeSyllabusExtraction(parsed, now, timeZone));
}

function strField(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}
