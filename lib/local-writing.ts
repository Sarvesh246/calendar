/**
 * Short, polite emails to an instructor or TA for the few things students
 * write every week: asking for an extension, saying they'll miss class, and
 * asking to meet. The details (who, which assignment, when it's due, what the
 * syllabus says about it) come from the calendar and syllabus, so the draft is
 * specific without a model. Anything more open-ended stays with the model.
 */
import type { SyllabusInfo, SyllabusPerson } from "./syllabus-info";

export type EmailKind = "extension" | "absence" | "meeting";

export interface EmailDraftInput {
  kind: EmailKind;
  className: string;
  /** The course code or name as the instructor would know it ("ECON 101"). */
  courseLabel: string;
  person?: SyllabusPerson;
  /** Extension: the assignment and when it's due ("Friday, Sep 25 at 11:59 PM"). */
  itemTitle?: string;
  dueText?: string;
  /** Absence: the day ("tomorrow, Thursday Sep 24"). Meeting: an optional day. */
  dayText?: string;
  /** The same day for the subject line ("Thursday, Sep 24"). */
  subjectDay?: string;
  /** Extension: how long, as typed ("two days", "until monday"). */
  extra?: string;
  /** The user's reason, already in first person ("I have been sick"). */
  reason?: string;
  /** A syllabus policy worth knowing before sending. */
  policy?: { topic: string; text: string };
}

const bold = (s: string) => `**${s}**`;

/** "Dr. Maria Lopez" → "Dr. Lopez"; "Maria Lopez" → "Professor Lopez"; TA "Sam Chen" → "Sam". */
export function salutationName(person: SyllabusPerson | undefined): string {
  if (!person?.name?.trim()) return "Professor";
  const name = person.name.trim().replace(/,.*$/, "");
  const parts = name.split(/\s+/);
  const title = /^(?:dr|prof|professor|mr|ms|mrs|mx)\.?$/i.exec(parts[0])?.[0];
  if (person.role === "ta") return title ? `${title} ${parts[parts.length - 1]}` : parts[0];
  const last = parts[parts.length - 1];
  if (title) return `${/^prof\.?$/i.test(title) ? "Professor" : title} ${last}`;
  return parts.length > 1 ? `Professor ${last}` : name;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Tidy a reason the user typed so it reads as their sentence. */
export function tidyReason(reason: string): string {
  return reason
    .trim()
    .replace(/[.!\s]+$/, "")
    .replace(/\bi\b/g, "I")
    .replace(/\bim\b/gi, "I'm")
    .replace(/\bive\b/gi, "I've");
}

function reasonSentence(reason: string | undefined): string {
  if (!reason) return "";
  const r = tidyReason(reason);
  if (/^of\b/i.test(r)) return ` because ${r}`;
  return "";
}

function reasonStandalone(reason: string | undefined): string {
  if (!reason) return "";
  const r = tidyReason(reason);
  if (/^of\b/i.test(r)) return "";
  return ` ${cap(r)}.`;
}

export function draftEmail(o: EmailDraftInput): string {
  const who = salutationName(o.person);
  const greet = o.person?.role === "ta" && !/^(?:Dr|Professor|Mr|Ms|Mrs|Mx)\b/.test(who) ? `Hi ${who},` : `Dear ${who},`;
  let subject: string;
  let body: string;
  if (o.kind === "extension") {
    const item = o.itemTitle ?? "the upcoming assignment";
    subject = `Extension request — ${item} (${o.courseLabel})`;
    const due = o.dueText ? `, which is due ${o.dueText}` : "";
    const howLong = o.extra ? ` of ${o.extra.replace(/^(?:an? )?extension (?:of )?/i, "")}` : "";
    body =
      `I'm writing to ask whether I could have a short extension${howLong} on ${item}${due}${reasonSentence(o.reason)}.${reasonStandalone(o.reason)} ` +
      `I want to make sure I turn in work that reflects what I've learned, and I'm happy to follow whatever arrangement works best for you.\n\n` +
      `Thank you for considering this.`;
  } else if (o.kind === "absence") {
    subject = `Missing class${o.subjectDay ? ` — ${o.subjectDay}` : ""} (${o.courseLabel})`;
    body =
      `I wanted to let you know that I won't be able to attend ${o.courseLabel}${o.dayText ? ` ${o.dayText}` : ""}${reasonSentence(o.reason)}.${reasonStandalone(o.reason)} ` +
      `I'll review the material I miss and catch up on anything that was covered. Please let me know if there's anything I should turn in or prepare.\n\n` +
      `Thank you for understanding.`;
  } else {
    subject = `Meeting request (${o.courseLabel})`;
    const hours = o.person?.officeHours ? ` I saw your office hours are ${o.person.officeHours} — I can come then, or` : " Would";
    const when = o.dayText ? ` ${o.dayText}` : "";
    body =
      `I'd like to meet with you${when} to talk about ${o.extra ? o.extra : `how I'm doing in ${o.courseLabel}`}${reasonSentence(o.reason)}.${reasonStandalone(o.reason)}` +
      `${hours}${o.person?.officeHours ? " at another time that suits you" : " there be a time that works for you"}?\n\n` +
      `Thank you for your time.`;
  }
  const to = o.person ? `${bold(o.person.name)}${o.person.email ? ` (${o.person.email})` : ""}` : `your ${o.className} instructor`;
  const note = o.policy ? `\n\nWorth knowing before you send it — the ${o.className} syllabus says: *${o.policy.text}*` : "";
  return `Here's a draft for ${to}:\n\n${bold("Subject:")} ${subject}\n\n${greet}\n\n${body}\n\nBest,\n[Your name]${note}`;
}

/** The person to write to: the instructor unless the TA was named. */
export function recipient(info: SyllabusInfo | undefined, wantTa: boolean): SyllabusPerson | undefined {
  if (!info) return undefined;
  const role = wantTa ? "ta" : "instructor";
  const matches = info.people.filter((p) => p.role === role);
  return matches.length === 1 ? matches[0] : undefined;
}
