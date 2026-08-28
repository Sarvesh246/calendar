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
const iso = (v: unknown) => new Date(v as string).toISOString();

// Set once if the account's `items` table predates migration 0002 (no `url`
// column). PostgREST then rejects any write that carries `url` with PGRST204;
// we strip the column and keep syncing everything else rather than wedging.
// Links come back automatically once the migration is run.
let itemUrlColumnMissing = false;

function isMissingUrlColumn(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "PGRST204" && (e?.message ?? "").includes("'url'");
}

function stripUrl(rows: Row[]): Row[] {
  for (const r of rows) delete r.url;
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
    name: c.name,
    color: c.color,
    archived: c.archived ?? false,
    source_id: c.sourceId ?? null,
  };
}
export function rowToCategory(r: Row): Category {
  return {
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
    ...(r.archived ? { archived: true } : {}),
    ...(r.source_id ? { sourceId: r.source_id as string } : {}),
  };
}

export function toItemRow(i: Item, userId: string): Row {
  return {
    id: i.id,
    user_id: userId,
    category_id: i.categoryId || null,
    type: i.type,
    title: i.title,
    description: i.description ?? null,
    location: i.location ?? null,
    // Only sent when set, so a DB that hasn't run the 0002 migration (no `url`
    // column) still round-trips every item that doesn't carry a link.
    ...(i.url ? { url: i.url } : {}),
    at: iso(i.at),
    end_at: i.endAt ? iso(i.endAt) : null,
    all_day: i.allDay ?? false,
    status: i.status ?? null,
    reminders: i.reminders ?? [],
    created_at: iso(i.createdAt),
    source_id: i.sourceId ?? null,
    source_uid: i.sourceUid ?? null,
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
    createdAt: iso(r.created_at),
    ...(r.source_id ? { sourceId: r.source_id as string } : {}),
    ...(r.source_uid ? { sourceUid: r.source_uid as string } : {}),
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
    name: s.name,
    added_at: iso(s.addedAt),
    last_synced_at: iso(s.lastSyncedAt),
    item_count: s.itemCount,
  };
}
export function rowToImportSource(r: Row): ImportSource {
  return {
    id: r.id as string,
    url: r.url as string,
    name: r.name as string,
    addedAt: iso(r.added_at),
    lastSyncedAt: iso(r.last_synced_at),
    itemCount: r.item_count as number,
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
    default_reminder_preset_ids: s.defaultReminderPresetIds,
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
    defaultReminderPresetIds: (r.default_reminder_preset_ids as string[]) ?? [],
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

export async function fetchAllForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<CloudSnapshot> {
  const [c, i, rp, is, us] = await Promise.all([
    supabase.from("categories").select("*").eq("user_id", userId),
    supabase.from("items").select("*").eq("user_id", userId),
    supabase.from("reminder_presets").select("*").eq("user_id", userId),
    supabase.from("import_sources").select("*").eq("user_id", userId),
    supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  for (const res of [c, i, rp, is, us]) {
    if (res.error) throw res.error;
  }
  return {
    categories: (c.data ?? []).map(rowToCategory),
    items: (i.data ?? []).map(rowToItem),
    reminderPresets: (rp.data ?? []).map(rowToPreset),
    importSources: (is.data ?? []).map(rowToImportSource),
    settings: us.data ? rowToSettings(us.data) : null,
  };
}

async function upsertRows(supabase: SupabaseClient, table: string, rows: Row[], onConflict?: string) {
  if (rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
  if (error) throw error;
}

/** Upsert into `items`, tolerating an account whose schema is missing the 0002
 *  `url` column: on the first PGRST204 we drop `url` and retry, then omit it for
 *  the rest of the session so the sync engine doesn't get stuck on it. */
async function upsertItemRows(supabase: SupabaseClient, rows: Row[]) {
  if (rows.length === 0) return;
  if (itemUrlColumnMissing) stripUrl(rows);
  const { error } = await supabase.from("items").upsert(rows);
  if (!error) return;
  if (!itemUrlColumnMissing && isMissingUrlColumn(error)) {
    itemUrlColumnMissing = true;
    console.warn(
      "[datebook] items.url column not found — run supabase/migrations/0002_item_url.sql. " +
        "Syncing without item links until then."
    );
    const { error: retryError } = await supabase.from("items").upsert(stripUrl(rows));
    if (retryError) throw retryError;
    return;
  }
  throw error;
}

async function deleteRows(supabase: SupabaseClient, table: string, ids: string[], userId: string) {
  if (ids.length === 0) return;
  const { error } = await supabase.from(table).delete().eq("user_id", userId).in("id", ids);
  if (error) throw error;
}

/** Drop category_id references that point at a category we aren't storing, so a
 *  stray ref can't fail the whole write with a foreign-key error. */
function sanitizeItemRows(rows: Row[], knownCategoryIds: Set<string>): Row[] {
  for (const r of rows) {
    if (r.category_id && !knownCategoryIds.has(r.category_id as string)) r.category_id = null;
  }
  return rows;
}

/** Push the whole local store into an empty account (first sign-in migration). */
export async function pushAllToCloud(
  supabase: SupabaseClient,
  userId: string,
  s: CloudSnapshot
) {
  const knownCategoryIds = new Set(s.categories.map((c) => c.id));
  await upsertRows(supabase, "categories", s.categories.map((x) => toCategoryRow(x, userId)));
  await upsertRows(
    supabase,
    "reminder_presets",
    s.reminderPresets.map((x) => toPresetRow(x, userId)),
    "user_id,id"
  );
  await upsertRows(supabase, "import_sources", s.importSources.map((x) => toImportSourceRow(x, userId)));
  await upsertItemRows(
    supabase,
    sanitizeItemRows(s.items.map((x) => toItemRow(x, userId)), knownCategoryIds)
  );
  if (s.settings) {
    const { error } = await supabase
      .from("user_settings")
      .upsert(toSettingsRow(s.settings, userId), { onConflict: "user_id" });
    if (error) throw error;
  }
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
  await upsertRows(supabase, "categories", c.categories.upserts.map((x) => toCategoryRow(x, userId)));
  await upsertRows(
    supabase,
    "reminder_presets",
    c.reminderPresets.upserts.map((x) => toPresetRow(x, userId)),
    "user_id,id"
  );
  await upsertRows(
    supabase,
    "import_sources",
    c.importSources.upserts.map((x) => toImportSourceRow(x, userId))
  );
  await upsertItemRows(
    supabase,
    sanitizeItemRows(c.items.upserts.map((x) => toItemRow(x, userId)), knownCategoryIds)
  );

  await deleteRows(supabase, "items", c.items.deletes, userId);
  await deleteRows(supabase, "import_sources", c.importSources.deletes, userId);
  await deleteRows(supabase, "reminder_presets", c.reminderPresets.deletes, userId);
  await deleteRows(supabase, "categories", c.categories.deletes, userId);

  if (c.settings) {
    const { error } = await supabase
      .from("user_settings")
      .upsert(toSettingsRow(c.settings, userId), { onConflict: "user_id" });
    if (error) throw error;
  }
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
