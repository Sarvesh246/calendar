import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `confirmPendingAction` is a validation step: it must never write to `items`.
 * A fake Supabase client records every write so that stays true.
 */
type Row = Record<string, unknown> | null;
const state: {
  tables: Record<string, Row>;
  writes: { table: string; op: string; patch?: unknown }[];
  claimable: boolean;
} = { tables: {}, writes: [], claimable: true };

function builder(table: string) {
  let op = "select";
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    update: (patch: unknown) => {
      op = "update";
      state.writes.push({ table, op, patch });
      return b;
    },
    insert: (patch: unknown) => {
      state.writes.push({ table, op: "insert", patch });
      return b;
    },
    delete: () => {
      state.writes.push({ table, op: "delete" });
      return b;
    },
    maybeSingle: async () => {
      if (op === "update") return { data: state.claimable ? { id: "claimed" } : null, error: null };
      return { data: state.tables[table] ?? null, error: null };
    },
  };
  return b;
}

vi.mock("./database", () => ({ assistantDatabase: () => ({ from: builder }) }));

const { confirmPendingAction } = await import("./tools");

const ID = "11111111-1111-4111-8111-111111111111";
const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();

function stage(tool: string, args: Record<string, unknown>, over: Record<string, unknown> = {}) {
  state.tables.assistant_pending_actions = {
    id: ID,
    tool_name: tool,
    arguments: args,
    status: "pending",
    expires_at: soon(),
    ...over,
  };
}

const itemWrites = () => state.writes.filter((w) => w.table === "items");

beforeEach(() => {
  state.tables = { items: { id: "gym" }, categories: { id: "chem" } };
  state.writes = [];
  state.claimable = true;
});

describe("confirmPendingAction", () => {
  it("returns the validated arguments and writes nothing to items", async () => {
    stage("add_event", {
      title: "Study group",
      start: "2026-11-13T00:00:00.000Z",
      categoryId: "chem",
    });
    const out = await confirmPendingAction("u1", ID);
    expect(out.tool).toBe("add_event");
    expect(out.arguments).toMatchObject({ title: "Study group", categoryId: "chem" });
    expect(itemWrites()).toEqual([]);
  });

  it("a delete is not a hard delete: nothing is removed server-side", async () => {
    stage("delete_event", { id: "gym" });
    const out = await confirmPendingAction("u1", ID);
    expect(out).toEqual({ tool: "delete_event", arguments: { id: "gym" } });
    expect(state.writes.some((w) => w.op === "delete")).toBe(false);
  });

  it("claims the confirmation so it cannot be used twice", async () => {
    stage("delete_event", { id: "gym" });
    await confirmPendingAction("u1", ID);
    expect(state.writes).toContainEqual({
      table: "assistant_pending_actions",
      op: "update",
      patch: expect.objectContaining({ status: "applied" }),
    });
    state.claimable = false;
    stage("delete_event", { id: "gym" });
    await expect(confirmPendingAction("u1", ID)).rejects.toThrow(/already used/);
  });

  it("refuses an expired or already-applied confirmation", async () => {
    stage("delete_event", { id: "gym" }, { expires_at: new Date(Date.now() - 1000).toISOString() });
    await expect(confirmPendingAction("u1", ID)).rejects.toThrow(
      /missing, expired, or already used/,
    );
    stage("delete_event", { id: "gym" }, { status: "applied" });
    await expect(confirmPendingAction("u1", ID)).rejects.toThrow(
      /missing, expired, or already used/,
    );
  });

  it("refuses to confirm a change to an item that is gone, and does not claim it", async () => {
    state.tables.items = null;
    stage("update_event", { id: "gym", title: "Gym time" });
    await expect(confirmPendingAction("u1", ID)).rejects.toThrow(/no longer exists/);
    expect(state.writes).toEqual([]);
  });

  it("drops a class that is not the user's instead of applying it", async () => {
    state.tables.categories = null;
    stage("add_task", {
      title: "Essay",
      due: "2026-11-13T04:59:00.000Z",
      categoryId: "someone-elses",
    });
    const out = await confirmPendingAction("u1", ID);
    expect(out.arguments).not.toHaveProperty("categoryId");
  });

  it("re-validates stored arguments rather than trusting the row", async () => {
    stage("add_event", { title: "No start" });
    await expect(confirmPendingAction("u1", ID)).rejects.toThrow(
      /missing, expired, or already used/,
    );
  });
});
