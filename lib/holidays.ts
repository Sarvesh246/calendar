/**
 * US holidays the on-device engine can count down to, so "how many days until
 * thanksgiving" is answered locally instead of going to the model. Dates are
 * computed (nth weekday of a month, Easter) rather than listed, so they are
 * right in any year.
 */

type Rule = { label: string; names: string[]; on: (year: number) => Date };

const day = (y: number, m: number, d: number) => new Date(y, m, d);

/** The `n`th (1-based) given weekday of a month; `n = -1` is the last. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = day(year, month, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return day(year, month, 1 + offset + (n - 1) * 7);
  }
  const last = day(year, month + 1, 0);
  const back = (last.getDay() - weekday + 7) % 7;
  return day(year, month, last.getDate() - back);
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return day(year, month, dayOfMonth);
}

const RULES: Rule[] = [
  {
    label: "New Year's Day",
    names: ["new years day", "new year", "new years"],
    on: (y) => day(y, 0, 1),
  },
  {
    label: "Martin Luther King Jr. Day",
    names: ["mlk day", "mlk", "martin luther king day"],
    on: (y) => nthWeekday(y, 0, 1, 3),
  },
  { label: "Valentine's Day", names: ["valentines day", "valentines"], on: (y) => day(y, 1, 14) },
  { label: "Presidents' Day", names: ["presidents day"], on: (y) => nthWeekday(y, 1, 1, 3) },
  {
    label: "St. Patrick's Day",
    names: ["st patricks day", "saint patricks day", "st pattys day"],
    on: (y) => day(y, 2, 17),
  },
  { label: "Easter", names: ["easter", "easter sunday"], on: easter },
  { label: "Mother's Day", names: ["mothers day"], on: (y) => nthWeekday(y, 4, 0, 2) },
  { label: "Memorial Day", names: ["memorial day"], on: (y) => nthWeekday(y, 4, 1, -1) },
  { label: "Juneteenth", names: ["juneteenth"], on: (y) => day(y, 5, 19) },
  { label: "Father's Day", names: ["fathers day"], on: (y) => nthWeekday(y, 5, 0, 3) },
  {
    label: "Independence Day",
    names: ["independence day", "july 4th", "july fourth", "fourth of july", "4th of july"],
    on: (y) => day(y, 6, 4),
  },
  { label: "Labor Day", names: ["labor day"], on: (y) => nthWeekday(y, 8, 1, 1) },
  {
    label: "Indigenous Peoples' Day",
    names: ["columbus day", "indigenous peoples day"],
    on: (y) => nthWeekday(y, 9, 1, 2),
  },
  { label: "Halloween", names: ["halloween"], on: (y) => day(y, 9, 31) },
  { label: "Veterans Day", names: ["veterans day"], on: (y) => day(y, 10, 11) },
  {
    label: "Thanksgiving",
    names: ["thanksgiving", "thanksgiving day"],
    on: (y) => nthWeekday(y, 10, 4, 4),
  },
  {
    label: "Black Friday",
    names: ["black friday"],
    on: (y) =>
      day(nthWeekday(y, 10, 4, 4).getFullYear(), 10, nthWeekday(y, 10, 4, 4).getDate() + 1),
  },
  { label: "Christmas Eve", names: ["christmas eve"], on: (y) => day(y, 11, 24) },
  { label: "Christmas", names: ["christmas", "christmas day", "xmas"], on: (y) => day(y, 11, 25) },
  { label: "New Year's Eve", names: ["new years eve"], on: (y) => day(y, 11, 31) },
];

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:the|my)\s+/, "")
    .trim();

/** The next occurrence of a named US holiday on or after `from`, or null. */
export function nextUsHoliday(name: string, from: Date): { label: string; date: Date } | null {
  const key = clean(name);
  if (!key) return null;
  const rule = RULES.find((r) => r.names.includes(key));
  if (!rule) return null;
  const today = day(from.getFullYear(), from.getMonth(), from.getDate());
  for (const year of [from.getFullYear(), from.getFullYear() + 1]) {
    const date = rule.on(year);
    if (+date >= +today) return { label: rule.label, date };
  }
  return null;
}
