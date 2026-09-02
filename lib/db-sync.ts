import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Category,
  ImportSource,
  Item,
  ReminderPreset,
  UserSettings,
} from "./types";

/* ------------------------------------------------------------------ */
/* Row <-> client-model mappers                                        */
/* Client models omit absent optional fields; DB columns use NULL.     */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
function iso(v: unknown): string {
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`Invalid timestamp: ${String(v)}`);
  }
  return d.toISOString();
}

/** Every category row must carry a name and a colour — both columns are NOT
 *  NULL. A model that lost either (a half-written realtime payload, a
 *  hand-edited backup, an older build) used to be pushed as-is and wedged the
 *  whole write queue on `null value in column "color"`. Repair instead. */
export const FALLBACK_CATEGORY_COLOR = "#8E8E93";
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function safeCategoryName(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "Uncategorized";
}
export function safeCategoryColor(v: unknown): string {
  if (typeof v !== "string") return FALLBACK_CATEGORY_COLOR;
  const t = v.trim();
  return HEX_RE.test(t) ? t : FALLBACK_CATEGORY_COLOR;
}

// Columns a project may not have yet because its SQL migrations are behind.
// PostgREST rejects the whole write with PGRST204 when one is present; we drop
// it, retry, and keep syncing everything else rather than wedging the queue.
// The column starts flowing again on its own once the migration is run.
const STRIPPABLE_COLS: Record<string, readonly string[]> = {
  items: ["url", "completed_at", "source_snapshot", "repeat", "repeat_id"],
  import_sources: ["last_error"],
  user_settings: ["hide_completed", "onboarding_dismissed", "mobile_day_details"],
};
const stripped: Record<string, Set<string>> = {
  items: new Set(),
  import_sources: new Set(),
  user_settings: new Set(),
};

function missingColumn(table: string, error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code !== "PGRST204") return null;
  const msg = e.message ?? "";
  return (STRIPPABLE_COLS[table] ?? []).find((col) => msg.includes(`'${col}'`)) ?? null;
}

function stripCols(table: string, rows: Row[]): Row[] {
  const drop = stripped[table];
  if (!drop || drop.size === 0) return rows;
  for (const r of rows) {
    for (const col of drop) delete r[col];
  }
  return rows;
}

/** Turn any thrown value (Error, Supabase PostgrestError object, string) into readable text. */
export function describeError(e: unknown): string {
  if (e == null) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter(
      (x): x is string => typeof x === "string" && x.length > 0
    );
    if (parts.length) return parts.join(" — ");
    try {
      return JSON.stringify(o);
    } catch {
      return String(o);
    }
  }
  return String(e);
}

export function toCategoryRow(c: Category, userId: string): Row {
  return {
    id: c.id,
    user_id: userId,
    name: safeCategoryName(c.name),
    color: safeCategoryColor(c.color),
    archived: c.archived ?? false,
    source_id: c.sourceId ?? null,
  };
}
export function rowToCategory(r: Row): Category {
  return {
    id: r.id as string,
    name: safeCategoryName(r.name),
    color: safeCategoryColor(r.color),
    ...(r.archived ? { archived: true } : {}),
    ...(r.source_id ? { sourceId: r.source_id as string } : {}),
  };
}

/**
 * Every item row carries the same key set, always.
 *
 * Two things depended on that and were broken while optional columns were
 * omitted: PostgREST rejects a bulk upsert whose objects have differing keys
 * ("All object keys must match"), so one item with a link poisoned the batch
 * it travelled in; and an omitted key is left untouched by the upsert, so
 * clearing a link or a repeat rule locally never cleared it in the cloud.
 * A project whose schema predates a column is handled by the strip-and-retry
 * path above instead.
 */
export function toItemRow(i: Item, userId: string): Row {
  return {
    id: i.id,
    user_id: userId,
    category_id: i.categoryId || null,
    type: i.type,
    title: i.title,
    description: i.description ?? null,
    location: i.location ?? null,
    url: i.url ?? null,
    at: iso(i.at),
    end_at: i.endAt ? iso(i.endAt) : null,
    all_day: i.allDay ?? false,
    status: i.status ?? null,
    reminders: i.reminders ?? [],
    completed_at: i.completedAt ? iso(i.completedAt) : null,
    source_snapshot: i.sourceSnapshot ?? null,
    created_at: iso(i.createdAt),
    source_id: i.sourceId ?? null,
    source_uid: i.sourceUid ?? null,
    repeat: i.repeat ?? null,
    repeat_id: i.repeatId ?? null,
  };
}
export function rowToItem(r: Row): Item {
  const reminders = r.reminders as Item["reminders"] | null;
  return {
    id: r.id as string,
    categoryId: (r.category_id as string) ?? "",
    type: r.type as Item["type"],
    title: r.title as string,
    ...(r.description ? { description: r.description as string } : {}),
    ...(r.location ? { location: r.location as string } : {}),
    ...(r.url ? { url: r.url as string } : {}),
    at: iso(r.at),
    ...(r.end_at ? { endAt: iso(r.end_at) } : {}),
    ...(r.all_day ? { allDay: true } : {}),
    ...(r.status ? { status: r.status as Item["status"] } : {}),
    ...(reminders && reminders.length ? { reminders } : {}),
    ...(r.completed_at ? { completedAt: iso(r.completed_at) } : {}),
    createdAt: iso(r.created_at),
    ...(r.source_id ? { sourceId: r.source_id as string } : {}),
    ...(r.source_uid ? { sourceUid: r.source_uid as string } : {}),
    ...(r.source_snapshot && typeof r.source_snapshot === "object"
      ? { sourceSnapshot: r.source_snapshot as Item["sourceSnapshot"] }
      : {}),
    ...(r.repeat && typeof r.repeat === "object" ? { repeat: r.repeat as Item["repeat"] } : {}),
    ...(r.repeat_id ? { repeatId: r.repeat_id as string } : {}),
  };
}

export function toPresetRow(p: ReminderPreset, userId: string): Row {
  return { id: p.id, user_id: userId, label: p.label, offset_minutes: p.offsetMinutes };
}
export function rowToPreset(r: Row): ReminderPreset {
  return { id: r.id as string, label: r.label as string, offsetMinutes: r.offset_minutes as number };
}

export function toImportSourceRow(s: ImportSource, userId: string): Row {
  return {
    id: s.id,
    user_id: userId,
    url: s.url,
    name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : "Calendar feed",
    added_at: iso(s.addedAt),
    last_synced_at: iso(s.lastSyncedAt),
    item_count: s.itemCount ?? 0,
    last_error: s.lastError ?? null,
  };
}
export function rowToImportSource(r: Row): ImportSource {
  return {
    id: r.id as string,
    url: r.url as string,
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Calendar feed",
    addedAt: iso(r.added_at),
    lastSyncedAt: iso(r.last_synced_at),
    itemCount: (r.item_count as number) ?? 0,
    ...(r.last_error ? { lastError: r.last_error as string } : {}),
  };
}

export function toSettingsRow(s: UserSettings, userId: string): Row {
  return {
    user_id: userId,
    preset: s.preset,
    landing_view: s.landingView,
    density: s.density,
    week_starts_on: s.weekStartsOn,
    clock_24h: s.clock24h,
    show_location: s.showLocation,
    show_category_dot: s.showCategoryDot,
    hide_completed: s.hideCompleted,
    default_reminder_preset_ids: s.defaultReminderPresetIds,
    onboarding_dismissed: s.onboardingDismissed ?? false,
    mobile_day_details: s.mobileDayDetails,
  };
}
export function rowToSettings(r: Row): UserSettings {
  return {
    preset: r.preset as UserSettings["preset"],
    landingView: r.landing_view as UserSettings["landingView"],
    density: r.density as UserSettings["density"],
    weekStartsOn: r.week_starts_on as UserSettings["weekStartsOn"],
    clock24h: Boolean(r.clock_24h),
    showLocation: Boolean(r.show_location),
    showCategoryDot: Boolean(r.show_category_dot),
    hideCompleted: Boolean(r.hide_completed),
    defaultReminderPresetIds: (r.default_reminder_preset_ids as string[]) ?? [],
    mobileDayDetails:
      r.mobile_day_details === "inline" ? "inline" : "sheet",
    ...(r.onboarding_dismissed ? { onboardingDismissed: true } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Bulk read / write                                                   */
/* ------------------------------------------------------------------ */

export interface CloudSnapshot {
  categories: Category[];
  items: Item[];
  reminderPresets: ReminderPreset[];
  importSources: ImportSource[];
  settings: UserSettings | null;
}

// PostgREST caps a single response (1000 rows by default) and a single request
// URL; both are easy to hit with a few years of imported calendar feeds.
const PAGE_SIZE = 1000;
const WRITE_CHUNK = 400;
const DELETE_CHUNK = 150;

/** Map models to rows, dropping (and reporting) any that can't be serialised —
 *  one corrupt row must not block every other edit in the batch behind it, and
 *  the batch is retried forever otherwise. */
function mapRows<T>(models: T[], map: (m: T) => Row, label: string): Row[] {
  const out: Row[] = [];
  for (const m of models) {
    try {
      out.push(map(m));
    } catch (err) {
      console.warn(`[datebook] skipping unsyncable ${label}`, m, err);
    }
  }
  return out;
}

function chunk<T>(rows: T[], size: number): T[][] {
  if (rows.length <= size) return rows.length ? [rows] : [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Read every row of a table for a user, paging past PostgREST's row cap. */
async function selectAllRows(
  supabase: SupabaseClient,
  table: string,
  userId: string
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Row[];
    out.push(...page);
    if (page.length < PAGE_SIZE) return out;
  }
}

export async function fetchAllForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<CloudSnapshot> {
  const [c, i, rp, is, us] = await Promise.all([
    selectAllRows(supabase, "categories", userId),
    selectAllRows(supabase, "items", userId),
    selectAllRows(supabase, "reminder_presets", userId),
    selectAllRows(supabase, "import_sources", userId),
    supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  if (us.error) throw us.error;

  const safeMap = <T>(rows: Row[], map: (r: Row) => T, label: string): T[] => {
    const out: T[] = [];
    for (const row of rows) {
      try {
        out.push(map(row));
      } catch (err) {
        console.warn(`[datebook] skipping corrupt ${label} row`, row.id, err);
      }
    }
    return out;
  };

  return {
    categories: safeMap(c, rowToCategory, "category"),
    items: safeMap(i, rowToItem, "item"),
    reminderPresets: safeMap(rp, rowToPreset, "reminder preset"),
    importSources: safeMap(is, rowToImportSource, "import source"),
    settings: us.data ? rowToSettings(us.data as Row) : null,
  };
}

/** Upsert rows in chunks, tolerating a schema that predates an optional column:
 *  on the first PGRST204 we drop that column and retry, then omit it for the
 *  rest of the session so the sync engine doesn't get stuck on it. */
async function upsertRows(
  supabase: SupabaseClient,
  table: string,
  rows: Row[],
  onConflict?: string
) {
  if (rows.length === 0) return;
  stripCols(table, rows);
  const opts = onConflict ? { onConflict } : undefined;
  for (const batch of chunk(rows, WRITE_CHUNK)) {
    let { error } = await supabase.from(table).upsert(batch, opts);
    // A batch can name several missing columns, one error at a time.
    for (let attempt = 0; error && attempt < 4; attempt += 1) {
      const col = missingColumn(table, error);
      if (!col) break;
      stripped[table].add(col);
      console.warn(
        `[datebook] ${table}.${col} column not found — run supabase/migrations. Syncing without it until then.`
      );
      ({ error } = await supabase.from(table).upsert(stripCols(table, batch), opts));
    }
    if (error) throw error;
  }
}

async function deleteRows(supabase: SupabaseClient, table: string, ids: string[], userId: string) {
  if (ids.length === 0) return;
  for (const batch of chunk(ids, DELETE_CHUNK)) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId).in("id", batch);
    if (error) throw error;
  }
}

/** Drop category_id references that point at a category we aren't storing, so a
 *  stray ref can't fail the whole write with a foreign-key error. */
function sanitizeItemRows(rows: Row[], knownCategoryIds: Set<string>): Row[] {
  for (const r of rows) {
    if (r.category_id && !knownCategoryIds.has(r.category_id as string)) r.category_id = null;
  }
  return rows;
}

async function upsertSettings(supabase: SupabaseClient, userId: string, s: UserSettings) {
  await upsertRows(supabase, "user_settings", [toSettingsRow(s, userId)], "user_id");
}

/** Push the whole local store into an empty account (first sign-in migration). */
export async function pushAllToCloud(
  supabase: SupabaseClient,
  userId: string,
  s: CloudSnapshot
) {
  const knownCategoryIds = new Set(s.categories.map((c) => c.id));
  await upsertRows(supabase, "categories", mapRows(s.categories, (x) => toCategoryRow(x, userId), "category"));
  await upsertRows(
    supabase,
    "reminder_presets",
    mapRows(s.reminderPresets, (x) => toPresetRow(x, userId), "reminder preset"),
    "user_id,id"
  );
  await upsertRows(
    supabase,
    "import_sources",
    mapRows(s.importSources, (x) => toImportSourceRow(x, userId), "import source")
  );
  await upsertRows(
    supabase,
    "items",
    sanitizeItemRows(mapRows(s.items, (x) => toItemRow(x, userId), "item"), knownCategoryIds)
  );
  if (s.settings) await upsertSettings(supabase, userId, s.settings);
}

export interface CollectionDelta<T> {
  upserts: T[];
  deletes: string[];
}
export interface PendingChanges {
  categories: CollectionDelta<Category>;
  reminderPresets: CollectionDelta<ReminderPreset>;
  importSources: CollectionDelta<ImportSource>;
  items: CollectionDelta<Item>;
  settings: UserSettings | null;
}

/** Apply one debounced batch of local edits to the cloud, respecting FK order.
 *  `knownCategoryIds` is the full set of the user's category ids (for ref sanitising). */
export async function pushChanges(
  supabase: SupabaseClient,
  userId: string,
  c: PendingChanges,
  knownCategoryIds: Set<string>
) {
  await upsertRows(
    supabase,
    "categories",
    mapRows(c.categories.upserts, (x) => toCategoryRow(x, userId), "category")
  );
  await upsertRows(
    supabase,
    "reminder_presets",
    mapRows(c.reminderPresets.upserts, (x) => toPresetRow(x, userId), "reminder preset"),
    "user_id,id"
  );
  await upsertRows(
    supabase,
    "import_sources",
    mapRows(c.importSources.upserts, (x) => toImportSourceRow(x, userId), "import source")
  );
  await upsertRows(
    supabase,
    "items",
    sanitizeItemRows(mapRows(c.items.upserts, (x) => toItemRow(x, userId), "item"), knownCategoryIds)
  );

  await deleteRows(supabase, "items", c.items.deletes, userId);
  await deleteRows(supabase, "import_sources", c.importSources.deletes, userId);
  await deleteRows(supabase, "reminder_presets", c.reminderPresets.deletes, userId);
  await deleteRows(supabase, "categories", c.categories.deletes, userId);

  if (c.settings) await upsertSettings(supabase, userId, c.settings);
}

/** Shallow diff two id-keyed collections. Equality via JSON string (models are small & flat-ish). */
export function diffCollection<T extends { id: string }>(
  prev: T[],
  next: T[]
): CollectionDelta<T> {
  const prevById = new Map(prev.map((x) => [x.id, x]));
  const nextIds = new Set(next.map((x) => x.id));
  const upserts = next.filter((x) => {
    const before = prevById.get(x.id);
    if (before === x) return false; // same object reference — untouched by the last set()
    return !before || JSON.stringify(before) !== JSON.stringify(x);
  });
  const deletes = prev.filter((x) => !nextIds.has(x.id)).map((x) => x.id);
  return { upserts, deletes };
}
