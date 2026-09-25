/**
 * Syllabus questions answered from what the import saved on each class
 * (`Category.syllabus`) — instructor and TA contacts, office hours, grading,
 * the letter-grade scale, materials, policies, and key dates. Same contract as
 * the rest of the local assistant: `undefined` = not a syllabus question,
 * `null` = it is, but hand it to the model, a response = confident answer.
 */
import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import type { AssistantResponse } from "./ai-assistant";
import type { SyllabusInfo, SyllabusKeyDate, SyllabusPerson, SyllabusPolicy } from "./syllabus-info";
import type { Category } from "./types";

export type SyllabusEnv = {
  /** Lowercased, contractions expanded. */
  q: string;
  /** The original message, lowercased — "tell me …" before politeness was stripped. */
  raw?: string;
  now: Date;
  categories: Category[];
  /** The class the sentence names outright, if any. */
  named?: Category;
  /**
   * Classes whose due dates came from a syllabus import. Imports from before
   * course details were kept have dates but no `syllabus` — those deserve a
   * different answer than a class that never had one.
   */
  importedFromSyllabus?: ReadonlySet<string>;
};

/** A reply that only says "I don't have that" — the caller may prefer a calendar answer. */
export type SyllabusResponse = AssistantResponse & { missing?: true };

const bold = (s: string) => `**${s}**`;

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

const STOP = new Set([
  "important", "the", "and", "for", "what", "whats", "when", "where", "who", "how", "does", "did", "can", "are", "is", "about",
  "say", "says", "syllabus", "class", "course", "this", "that", "with", "there", "any", "have", "my", "our", "your",
  "policy", "policies", "rule", "rules", "tell", "me", "do", "i", "it", "on", "in", "of", "to", "a", "an", "be", "we",
]);

function displayName(c: Category): string {
  return c.name;
}

function withInfo(cats: Category[]): Array<{ c: Category; info: SyllabusInfo }> {
  return cats.filter((c) => !c.archived && c.syllabus).map((c) => ({ c, info: c.syllabus! }));
}

/* ------------------------------------------------------------------ */
/* Topics                                                              */
/* ------------------------------------------------------------------ */

type Topic =
  | "instructor"
  | "ta"
  | "contact"
  | "officeHours"
  | "office"
  | "grading"
  | "scale"
  | "materials"
  | "description"
  | "prereq"
  | "website"
  | "meetings"
  | "policy"
  | "keyDate"
  | "general";

/** Policy topics a student asks about, with the words that point at each. */
const POLICY_SYNONYMS: Array<{ key: string; re: RegExp; label: string }> = [
  { key: "late", re: /\blate (?:work|policy|penalty|penalties|submissions?|assignments?|homework|days?|problem sets?)\b|\b(?:turn|hand|submit)(?:ting|ing)? (?:\S+ ){0,3}(?:in )?late\b|\bextensions?\b|\bgrace period\b|\bif (?:i(?:'m| am)?|it(?:'s| is)) late\b|\bsomething late\b/, label: "late work" },
  { key: "attendance", re: /\b(?:attendance|absen(?:ce|ces|t)|miss(?:ing)? (?:a )?class|skip(?:ping)? class|excused)\b/, label: "attendance" },
  { key: "makeup", re: /\b(?:make-?ups?|missed (?:exam|quiz|test)|miss (?:an?|the) (?:exam|quiz|test|midterm))\b/, label: "makeup work" },
  { key: "regrade", re: /\b(?:re-?grades?|grade disputes?|dispute (?:a|my) grade)\b/, label: "regrades" },
  { key: "extra", re: /\bextra credit\b/, label: "extra credit" },
  { key: "integrity", re: /\b(?:cheat(?:ing)?|plagiari[sz]\w*|academic (?:integrity|honesty|dishonesty|misconduct)|honor code)\b/, label: "academic integrity" },
  { key: "ai", re: /\b(?:ai|a\.i\.|chat ?gpt|gpt|claude|gemini|copilot|generative|llms?|artificial intelligence)\b/, label: "AI use" },
  { key: "collab", re: /\b(?:collaborat\w*|work (?:together|with (?:others|friends|classmates))|group work|study groups?|partners?)\b/, label: "collaboration" },
  { key: "devices", re: /\b(?:laptops?|phones?|devices?|electronics|tablets?)\b/, label: "devices" },
  { key: "access", re: /\b(?:accommodations?|disabilit\w*|accessibility|ods|drc|ssd)\b/, label: "accommodations" },
  { key: "participation", re: /\bparticipat\w*\b/, label: "participation" },
  { key: "drop", re: /\b(?:drop(?:ped|s)? (?:the )?lowest|lowest (?:score|grade|quiz|homework) (?:is |are )?dropped)\b/, label: "dropped scores" },
  { key: "exam", re: /\b(?:cheat ?sheets?|notes? (?:allowed|sheet)|open[- ]book|closed[- ]book|exam format|calculators? (?:allowed|on (?:the )?exam))\b/, label: "exams" },
  { key: "curve", re: /\b(?:curve[ds]?|curving|scaled? (?:grades?|scores?))\b/, label: "a curve" },
  { key: "comm", re: /\b(?:email policy|respond(?:s)? to emails?|response time|piazza|ed (?:discussion|stem)|slack|discord|announcements?)\b/, label: "communication" },
];

const TOPIC_RE: Array<[Topic, RegExp]> = [
  ["officeHours", /\b(?:office|student|drop-?in) hours?\b|\bwhen (?:can i|should i|do i) (?:meet|see|talk to|visit)\b/],
  ["office", /\bwhere(?: is|'s)? (?:the |my |[a-z]+'s )?(?:prof(?:essor)?'?s? |instructor'?s? |ta'?s? )?office\b|\b(?:prof(?:essor)?|instructor|teacher|ta)(?:'s|s') office\b(?!\s*hours?)/],
  ["contact", /\b(?:e-?mails?|e-?mail address|contact|reach (?:out|the|my|him|her|them)|get in touch|phone number)\b/],
  ["ta", /\b(?:tas?|t\.a\.?s?|teaching assistants?|teaching fellows?|graders?|section leaders?)\b/],
  ["instructor", /\b(?:professors?|profs?|instructors?|teachers?|lecturers?|who (?:is )?teach(?:es|ing)?|taught by|who runs)\b/],
  ["scale", /\b(?:grad(?:e|ing) scale|letter grades?|cut-?offs?|grade boundaries|what (?:is|counts as) an? [abcdf][+-]?\b|how (?:many|much) (?:points|percent) (?:for|is) an? [abcdf]|what percent(?:age)? (?:is|for) an? [abcdf])/],
  ["grading", /\b(?:grad(?:e|ing|ed) (?:breakdown|weights?|distribution|split|composition)|how (?:is|am i|are we|will i be) (?:it |this |the class |the course |[a-z0-9 ]+ )?graded|worth|weight(?:ed|ing)?|how much (?:is|does|do|are)\b(?=.*\b(?:worth|count|weigh|percent|grade)\b)|percent(?:age)? of (?:the|my|your) (?:final |overall |class |course )?grade|what percent(?:age)?|how (?:many|much) percent|counts? for|what (?:makes up|goes into) (?:the|my) grade)\b/],
  ["materials", /\b(?:text ?books?|books?|materials|required (?:reading|texts?)|course packs?|readers?|calculators?|software|supplies|what do i need to buy)\b/],
  ["prereq", /\bpre-?req(?:uisite)?s?\b/],
  ["website", /\b(?:website|web site|course (?:page|site)|canvas (?:page|site|link)|class (?:page|site))\b/],
  ["description", /\b(?:what is (?:[a-z0-9 ]+ )?about|what(?:'s| is) (?:the |this )?(?:class|course) about|course description|what does (?:[a-z0-9 ]+ )?cover|what (?:topics|will we (?:learn|cover)))\b/],
  ["keyDate", /\b(?:spring break|fall break|winter break|thanksgiving|reading (?:week|day|period)|holidays?|no class(?:es)?|class(?:es)? (?:is |are )?cancel+ed|(?:add|drop|add\/drop|withdraw(?:al)?) (?:deadline|date|period)|last day (?:of|to) (?:class(?:es)?|drop|withdraw|add)|first day of class(?:es)?|finals? (?:week|period)|semester (?:start|end)s?|when does (?:the )?(?:semester|term|class(?:es)?) (?:start|end|begin|finish))\b/],
];

function topicsOf(qIn: string): Topic[] {
  // "what % is the final" — the % sign is gone once words are tokenized.
  const q = qIn.replace(/(\d+\s*)?%/g, (m, n) => (n ? m : " percent ")).replace(/\s+/g, " ");
  const out: Topic[] = [];
  for (const [t, re] of TOPIC_RE) if (re.test(q)) out.push(t);
  if (POLICY_SYNONYMS.some((p) => p.re.test(q)) || /\b(?:polic(?:y|ies)|rules?)\b/.test(q)) out.push("policy");
  if (/\bsyllabus\b/.test(q) && !out.length) out.push("general");
  return out;
}

/** Only questions — "book a meeting" and "add a quiz" are not syllabus lookups. */
function isQuestion(q: string): boolean {
  return (
    /^(?:what|whats|when|where|who|whom|which|how|is|are|am|do|does|did|can|could|will|would|should|may|tell|show|list|give|any|anything)\b/.test(q) ||
    /\bsyllabus\b/.test(q) ||
    /\?$/.test(q)
  );
}

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

function personLine(p: SyllabusPerson, fields: Array<"email" | "office" | "officeHours">): string {
  const bits: string[] = [];
  if (fields.includes("email") && p.email) bits.push(p.email);
  if (fields.includes("office") && p.office) bits.push(`office ${p.office}`);
  if (fields.includes("officeHours") && p.officeHours) bits.push(`office hours ${p.officeHours}`);
  return `${bold(p.name)}${bits.length ? ` (${bits.join(" · ")})` : ""}`;
}

function peopleAnswer(c: Category, info: SyllabusInfo, topic: Topic, q: string): string | null {
  const wantsTa = topic === "ta" || /\b(?:tas?|teaching assistants?)\b/.test(q);
  const pool = info.people.filter((p) => (wantsTa ? p.role === "ta" : p.role !== "ta"));
  const people = pool.length ? pool : topic === "contact" || topic === "officeHours" ? info.people : [];
  const name = bold(displayName(c));
  if (!people.length) return null;

  if (topic === "officeHours") {
    const withHours = people.filter((p) => p.officeHours);
    if (!withHours.length) return null;
    if (withHours.length === 1) {
      const p = withHours[0];
      return `${bold(p.name)}'s office hours for ${name} are ${bold(p.officeHours!)}${p.office ? ` in ${p.office}` : ""}.`;
    }
    return `Office hours for ${name}:\n${withHours.map((p) => `- ${bold(p.name)} — ${p.officeHours}${p.office ? ` · ${p.office}` : ""}`).join("\n")}`;
  }
  if (topic === "office") {
    const withOffice = people.filter((p) => p.office);
    if (!withOffice.length) return null;
    return withOffice.length === 1
      ? `${bold(withOffice[0].name)}'s office is ${bold(withOffice[0].office!)}.`
      : `Offices for ${name}: ${joinNatural(withOffice.map((p) => `${bold(p.name)} — ${p.office}`))}.`;
  }
  if (topic === "contact") {
    const reachable = people.filter((p) => p.email || p.phone);
    if (!reachable.length) return null;
    if (reachable.length === 1) {
      const p = reachable[0];
      return `You can reach ${bold(p.name)} at ${bold(p.email ?? p.phone!)}${p.email && p.phone ? ` or ${p.phone}` : ""}.`;
    }
    return `Contacts for ${name}:\n${reachable.map((p) => `- ${bold(p.name)}${p.role === "ta" ? " (TA)" : ""} — ${[p.email, p.phone].filter(Boolean).join(" · ")}`).join("\n")}`;
  }
  const role = wantsTa ? (people.length === 1 ? "TA" : "TAs") : people.length === 1 ? "instructor" : "instructors";
  if (people.length === 1) {
    const p = people[0];
    return `Your ${role} for ${name} is ${personLine(p, ["email"])}.${p.officeHours ? ` Office hours: ${p.officeHours}.` : ""}`;
  }
  return `Your ${role} for ${name} are ${joinNatural(people.map((p) => personLine(p, ["email"])))}.`;
}

function gradingAnswer(c: Category, info: SyllabusInfo, q: string): string | null {
  if (!info.grading.length) return null;
  const name = bold(displayName(c));
  // "how much is the final worth" — one component.
  const asked = words(q.replace(/\b(?:worth|weight(?:ed)?|much|percent(?:age)?|grade|graded|counts?|how)\b/g, " "));
  if (asked.length) {
    const hits = info.grading.filter((g) => {
      const w = words(g.component);
      return asked.some((a) => w.some((x) => x === a || (a.length >= 4 && x.startsWith(a)) || (x.length >= 4 && a.startsWith(x))));
    });
    if (hits.length === 1) return `${bold(hits[0].component)} is worth ${bold(hits[0].weight)} of your ${name} grade.`;
    if (hits.length > 1 && hits.length <= 4) return `In ${name}: ${joinNatural(hits.map((g) => `${bold(g.component)} ${g.weight}`))}.`;
  }
  return `Here's how ${name} is graded:\n${info.grading.map((g) => `- ${bold(g.component)} — ${g.weight}`).join("\n")}`;
}

function scaleAnswer(c: Category, info: SyllabusInfo, q: string): string | null {
  if (!info.gradeScale.length) return null;
  const name = bold(displayName(c));
  const m = /\ban? ([abcdf][+-]?)(?![a-z])/.exec(q);
  if (m) {
    const hit = info.gradeScale.find((g) => g.grade.toLowerCase() === m[1]);
    if (hit) return `In ${name}, an ${bold(hit.grade)} is ${bold(hit.range)}.`.replace(/\ban (\*\*[BCD])/, "a $1");
  }
  return `The grading scale for ${name}: ${info.gradeScale.map((g) => `${bold(g.grade)} ${g.range}`).join(", ")}.`;
}

function policyMatches(info: SyllabusInfo, q: string): SyllabusPolicy[] {
  const syn = POLICY_SYNONYMS.filter((p) => p.re.test(q));
  const hits = new Set<SyllabusPolicy>();
  for (const p of info.policies) {
    const hay = `${p.topic} ${p.text}`.toLowerCase();
    if (syn.some((s) => s.re.test(hay))) hits.add(p);
  }
  if (!hits.size && !syn.length) {
    const asked = words(q);
    if (asked.length) {
      for (const p of info.policies) {
        const hay = words(`${p.topic} ${p.text}`);
        const overlap = asked.filter((a) => hay.includes(a)).length;
        if (overlap >= Math.min(2, asked.length)) hits.add(p);
      }
    }
  }
  // Prefer policies whose *topic* names the thing asked about.
  const list = [...hits];
  const topical = list.filter((p) => syn.some((s) => s.re.test(p.topic.toLowerCase())));
  return (topical.length ? topical : list).slice(0, 3);
}

function policyAnswer(c: Category, info: SyllabusInfo, q: string): string | null {
  const name = bold(displayName(c));
  const hits = policyMatches(info, q);
  if (!hits.length) {
    if (/\b(?:polic(?:y|ies)|rules?)\b/.test(q) && !POLICY_SYNONYMS.some((p) => p.re.test(q)) && info.policies.length) {
      return `The ${name} syllabus covers: ${joinNatural(info.policies.map((p) => p.topic))}. Which one do you want?`;
    }
    return null;
  }
  if (hits.length === 1) return `${bold(hits[0].topic)} (${displayName(c)}): ${hits[0].text}`;
  return `From the ${name} syllabus:\n${hits.map((p) => `- ${bold(p.topic)}: ${p.text}`).join("\n")}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateText(k: SyllabusKeyDate, now: Date): string {
  const start = parseYmd(k.date);
  const fmt = (d: Date) => format(d, "EEE, MMM d");
  const span = k.endDate ? `${fmt(start)}–${fmt(parseYmd(k.endDate))}` : fmt(start);
  const days = differenceInCalendarDays(start, startOfDay(now));
  const rel = days === 0 ? "today" : days === 1 ? "tomorrow" : days > 1 ? `in ${days} days` : k.endDate && differenceInCalendarDays(parseYmd(k.endDate), startOfDay(now)) >= 0 ? "happening now" : `${-days} days ago`;
  return `${bold(span)} (${rel})`;
}

const DATE_GENERIC = new Set(["when", "date", "dates", "day", "days", "deadline", "until", "many", "long", "much", "week", "happen", "start", "begin", "end", "over"]);

function keyDateMatches(info: SyllabusInfo, qIn: string): SyllabusKeyDate[] {
  const q = qIn
    .replace(/\b(?:semester|term|quarter|class(?:es)?|instruction) (?:start|starts|begin|begins)\b|\b(?:start|beginning) of (?:the )?(?:semester|term|classes)\b/, "first")
    .replace(/\b(?:semester|term|quarter|class(?:es)?|instruction) (?:end|ends|finish|finishes)\b|\b(?:end) of (?:the )?(?:semester|term|classes)\b/, "last");
  const asked = words(q).filter((w) => !DATE_GENERIC.has(w));
  if (!asked.length) return [];
  return info.keyDates.filter((k) => {
    const hay = words(k.label).map((h) => (h === "withdrawal" ? "withdraw" : h));
    return asked.every((a) => hay.some((h) => h === a || (a.length >= 4 && (h.startsWith(a) || a.startsWith(h)))));
  });
}

function keyDateAnswer(c: Category, info: SyllabusInfo, q: string, now: Date): string | null {
  const hits = keyDateMatches(info, q);
  if (!hits.length) return null;
  const upcoming = hits.filter((k) => (k.endDate ?? k.date) >= format(startOfDay(now), "yyyy-MM-dd"));
  const list = (upcoming.length ? upcoming : hits).slice(0, 4);
  const past = (k: SyllabusKeyDate) => (k.endDate ?? k.date) < format(startOfDay(now), "yyyy-MM-dd");
  if (list.length === 1) return `${bold(list[0].label)} ${past(list[0]) ? "was" : "is"} ${dateText(list[0], now)}, per the ${displayName(c)} syllabus.`;
  return `From the ${bold(displayName(c))} syllabus:\n${list.map((k) => `- ${bold(k.label)} — ${dateText(k, now).replace(/^\*\*|\*\*(?= \()/g, "")}`).join("\n")}`;
}

function simpleField(c: Category, info: SyllabusInfo, topic: Topic): string | null {
  const name = bold(displayName(c));
  if (topic === "materials") {
    if (!info.materials.length) return null;
    return info.materials.length === 1
      ? `For ${name} you need ${bold(info.materials[0].replace(/\.$/, ""))}.`
      : `Materials for ${name}:\n${info.materials.map((m) => `- ${m}`).join("\n")}`;
  }
  if (topic === "prereq") return info.prerequisites ? `Prerequisites for ${name}: ${info.prerequisites}.`.replace(/\.\.$/, ".") : null;
  if (topic === "website") return info.website ? `The ${name} course site is ${info.website}` : null;
  if (topic === "description") return info.description ? `${name}: ${info.description}` : null;
  if (topic === "meetings") return info.meetings || info.location ? `${name} meets ${[info.meetings, info.location].filter(Boolean).join(", ")}.` : null;
  return null;
}

/** Free-form "what does the syllabus say about X" — search every field. */
function generalAnswer(c: Category, info: SyllabusInfo, q: string, now: Date): string | null {
  const asked = words(q);
  if (!asked.length) {
    const parts = [
      info.people.length ? "who teaches it" : "",
      info.grading.length ? "grading" : "",
      info.policies.length ? `${info.policies.length} policies` : "",
      info.keyDates.length ? "key dates" : "",
      info.materials.length ? "materials" : "",
    ].filter(Boolean);
    return `I have the ${bold(displayName(c))} syllabus saved — ${joinNatural(parts)}. What do you want to know?`;
  }
  // A bare section name: "grading", "office hours", "key dates", "textbooks".
  const section: Topic | undefined = asked.some((w) => /^grad/.test(w))
    ? /\bscale|cutoff|letter\b/.test(q) ? "scale" : "grading"
    : asked.some((w) => /^(?:instructor|professor|prof|teacher|staff|people)$/.test(w))
      ? "instructor"
      : asked.includes("ta")
        ? "ta"
        : asked.some((w) => /^(?:contact|email)$/.test(w))
          ? "contact"
          : /\boffice hours?\b/.test(q)
            ? "officeHours"
            : asked.some((w) => /^(?:material|textbook|book|reading)$/.test(w))
              ? "materials"
              : asked.some((w) => /^(?:prerequisite|prereq)$/.test(w))
                ? "prereq"
                : asked.some((w) => /^(?:website|site|link)$/.test(w))
                  ? "website"
                  : undefined;
  if (section) return answerFor(c, info, section, { q, now, categories: [] });
  if (asked.some((w) => /^(?:date|important|key|calendar|holiday|break)$/.test(w)) && info.keyDates.length) {
    return `Key dates from the ${bold(displayName(c))} syllabus:\n${info.keyDates.slice(0, 8).map((k) => `- ${bold(k.label)} — ${dateText(k, now).replace(/^\*\*|\*\*(?= \()/g, "")}`).join("\n")}`;
  }
  return policyAnswer(c, info, q) ?? keyDateAnswer(c, info, q, now) ?? gradingAnswerIfMentioned(c, info, asked);
}

function gradingAnswerIfMentioned(c: Category, info: SyllabusInfo, asked: string[]): string | null {
  const hits = info.grading.filter((g) => words(g.component).some((w) => asked.includes(w)));
  return hits.length ? `In ${bold(displayName(c))}: ${joinNatural(hits.map((g) => `${bold(g.component)} ${g.weight}`))}.` : null;
}

function answerFor(c: Category, info: SyllabusInfo, topic: Topic, env: SyllabusEnv): string | null {
  switch (topic) {
    case "instructor":
    case "ta":
    case "contact":
    case "officeHours":
    case "office":
      return peopleAnswer(c, info, topic, env.q);
    case "grading":
      return gradingAnswer(c, info, env.q);
    case "scale":
      return scaleAnswer(c, info, env.q);
    case "policy":
      return policyAnswer(c, info, env.q);
    case "keyDate":
      return keyDateAnswer(c, info, env.q, env.now);
    case "general":
      return generalAnswer(c, info, env.q, env.now);
    default:
      return simpleField(c, info, topic);
  }
}

const TOPIC_NOUN: Partial<Record<Topic, string>> = {
  instructor: "who teaches it",
  ta: "the TAs",
  contact: "contact info",
  officeHours: "office hours",
  office: "office locations",
  grading: "the grade breakdown",
  scale: "the grading scale",
  materials: "the materials",
  prereq: "prerequisites",
  website: "a course website",
  description: "a course description",
  policy: "that policy",
  keyDate: "that date",
};

function nounFor(topic: Topic, q: string): string {
  if (topic === "policy") {
    const syn = POLICY_SYNONYMS.find((p) => p.re.test(q));
    if (syn) return syn.label;
  }
  return TOPIC_NOUN[topic] ?? "that";
}

/**
 * Answer a syllabus question, or step aside. Plural or class-less questions
 * ("who are my professors") are answered across every class that has details.
 */
function missingFor(c: Category, env: SyllabusEnv, topic: Topic, q: string): SyllabusResponse {
  const name = bold(displayName(c));
  if (env.importedFromSyllabus?.has(c.id)) {
    return {
      missing: true,
      text: `I have ${name}'s due dates from its syllabus, but not ${nounFor(topic, q)} — that part wasn't saved when it was imported. If you want me to know it, re-add the same PDF under Settings → Classes; your assignments and progress stay as they are.`,
    };
  }
  return { missing: true, text: `I don't have the ${name} syllabus saved. Import it under Settings → Classes and I can answer questions like that.` };
}

export function answerSyllabusQuestion(envIn: SyllabusEnv): SyllabusResponse | null | undefined {
  const env = envIn.named
    ? { ...envIn, q: envIn.q.replace(new RegExp(`\\b${envIn.named.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ").replace(/\s+/g, " ").trim() }
    : envIn;
  const q = envIn.q;
  if (!isQuestion(q) && !(env.raw && isQuestion(env.raw))) return undefined;
  const topics = topicsOf(q);
  if (!topics.length) return undefined;
  // "what grade do I need on the final" needs current scores we don't have.
  // "what percentage of my grade is quizzes" is a weight question and stays here.
  if (/\bwhat (?:grade|score) do i need\b|\bwhat is my (?:current |overall |final )?grade\b|(?<!of )\bmy (?:current |overall )?grade (?:is|in|right now|so far)\b|\bam i (?:passing|failing)\b|\bcalculate my grade\b/.test(q)) return null;
  const topic = topics[0];
  const all = withInfo(env.categories);

  if (env.named) {
    const info = env.named.syllabus;
    if (!info) {
      // Only claim ignorance for topics a calendar can't answer either.
      if (topic === "keyDate" || topic === "meetings") return undefined;
      return missingFor(env.named, env, topic, q);
    }
    for (const t of topics) {
      const text = answerFor(env.named, info, t, env);
      if (text) return { text };
    }
    if (topic === "keyDate") return undefined;
    return { text: `The ${bold(displayName(env.named))} syllabus doesn't mention ${nounFor(topic, q)}.` };
  }

  if (!all.length) {
    if (topic === "keyDate" || topic === "meetings" || topic === "description") return undefined;
    if (topic === "general" || /\bsyllabus\b/.test(q) || ["instructor", "ta", "officeHours", "grading", "scale", "policy", "materials"].includes(topic)) {
      const imported = env.categories.filter((c) => !c.archived && env.importedFromSyllabus?.has(c.id));
      if (imported.length === 1) return missingFor(imported[0], env, topic, q);
      if (imported.length > 1) {
        return {
          missing: true,
          text: `I have the due dates from your ${joinNatural(imported.map((c) => bold(displayName(c))))} syllabi, but not ${nounFor(topic, q)} — that part wasn't saved when they were imported. Re-adding a PDF under Settings → Classes fills it in without touching your assignments.`,
        };
      }
      return { missing: true, text: "I don't have any syllabus details saved yet. Import a syllabus under Settings → Classes — along with due dates it reads the instructor, office hours, grading, and policies — and I can answer that." };
    }
    return undefined;
  }

  const answers: Array<{ c: Category; text: string }> = [];
  for (const { c, info } of all) {
    for (const t of topics) {
      const text = answerFor(c, info, t, env);
      if (text) {
        answers.push({ c, text });
        break;
      }
    }
  }
  if (!answers.length) {
    if (topic === "keyDate") return undefined;
    return all.length === 1
      ? { text: `The ${bold(displayName(all[0].c))} syllabus doesn't mention ${nounFor(topic, q)}.` }
      : null;
  }
  if (answers.length === 1) return { text: answers[0].text };
  if (answers.length > 4) {
    return { text: `Which class — ${joinNatural(answers.slice(0, 5).map((a) => bold(displayName(a.c))))}?`.replace(/, and /, ", or ").replace(/ and (\*\*[^*]+\*\*)\?$/, " or $1?") };
  }
  return { text: answers.map((a) => a.text).join("\n\n") };
}
