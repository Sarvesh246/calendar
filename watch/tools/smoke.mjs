import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const { token } = JSON.parse(
  readFileSync(root + "secrets.local.json", "utf8").replace(/^\uFEFF/, ""),
);
const url = "https://datebookcalendar.vercel.app/api/watch/sync";
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
async function request(path = "", init = {}) {
  const response = await fetch(url + path, {
    headers,
    signal: AbortSignal.timeout(20000),
    ...init,
  });
  return { status: response.status, body: await response.json() };
}
const unauth = await request("", { headers: {} });
assert(unauth.status === 401, "Missing-key request must fail closed");
const bad = await request("", { method: "POST", body: "{" });
assert(bad.status === 400, "Invalid JSON must be rejected");
const first = await request();
assert(first.status === 200 && first.body.pages >= 1, "Snapshot failed");
const snapshot = { ...first.body, items: [...first.body.items] };
for (let page = 1; page < first.body.pages; page++) {
  const ids = first.body.ids.slice(page * 5, page * 5 + 5).join(",");
  const next = await request("?ids=" + ids);
  assert(next.status === 200, "Page download failed");
  assert(
    next.body.items.every((i) => ids.includes(i.id)),
    "Page membership changed",
  );
  snapshot.items.push(...next.body.items);
}
assert(
  new Set(snapshot.items.map((i) => i.id)).size === snapshot.items.length,
  "Duplicate cache IDs",
);
mkdirSync(root + "bin", { recursive: true });
writeFileSync(root + "bin/snapshot.json", JSON.stringify(snapshot));
console.log(
  `Snapshot: ${snapshot.items.length} unique items, ${snapshot.classes.length} classes; ${first.body.pages} pages; no unauthenticated access.`,
);

if (process.argv.includes("--write-check")) {
  const itemId = randomUUID();
  const created = [];
  const operation = (action, value) => ({
    id: randomUUID(),
    itemId,
    action,
    value,
    changedAt: Math.floor(Date.now() / 1000),
    base: 0,
  });
  async function post(op) {
    const result = await request("", { method: "POST", body: JSON.stringify({ changes: [op] }) });
    assert(
      result.status === 200 && result.body.results[0].state === "applied",
      `Operation ${op.action} failed: ${JSON.stringify(result.body)}`,
    );
    return result.body;
  }
  // Record exact disposable IDs before creating anything, for cleanup even after failure.
  created.push(itemId);
  writeFileSync(root + "bin/test-items.json", JSON.stringify(created));
  const create = operation("create", "Datebook watch verification (temporary)");
  const receipt = await post(create);
  assert(
    JSON.stringify(await post(create)) === JSON.stringify(receipt),
    "Lost-response retry was not idempotent",
  );
  for (const status of ["doing", "done", "todo", "done"]) {
    await post(operation("status", status));
    const read = await request("?ids=" + itemId);
    assert(read.body.items[0].status === status, `Status ${status} did not persist`);
  }
  await post(operation("rename", "Datebook watch verification (temporary, edited)"));
  await post(operation("priority", "high"));
  await post(operation("reminder", "30"));
  if (snapshot.classes.length) await post(operation("class", snapshot.classes[0].id));
  const before = (await request("?ids=" + itemId)).body.items[0];
  const plan = operation("plan", "25");
  created.push(plan.id);
  writeFileSync(root + "bin/test-items.json", JSON.stringify(created));
  await post(plan);
  const after = (await request("?ids=" + itemId)).body.items[0];
  const session = (await request("?ids=" + plan.id)).body.items[0];
  assert(
    after.at === before.at && session.type === "event" && session.end - session.at === 1500,
    "Planning must add time without moving the deadline",
  );
  console.log(
    "Live writes: create, idempotent retry, all statuses, rename, priority, class, reminder and separate work session passed.",
  );
  console.log("Disposable IDs for cleanup: " + created.join(","));
}
