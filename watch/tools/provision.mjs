import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const snapshot = JSON.parse(readFileSync(root + "bin/snapshot.json", "utf8"));
const mc = (v) =>
  v === null
    ? "null"
    : Array.isArray(v)
      ? "[" + v.map(mc).join(",") + "]"
      : typeof v === "object"
        ? "{" +
          Object.entries(v)
            .map(([key, value]) => JSON.stringify(key) + " => " + mc(value))
            .join(",") +
          "}"
        : JSON.stringify(v);
writeFileSync(
  root + "source/Seed.mc",
  `module Seed {\n function items() { return ${mc(snapshot.items)}; }\n function classes() { return ${mc(snapshot.classes)}; }\n function syncedAt() { return ${snapshot.syncedAt}; }\n function limited() { return ${Boolean(snapshot.limited)}; }\n}\n`,
);
console.log(
  `Provisioned private offline snapshot: ${snapshot.items.length} items, ${snapshot.classes.length} classes. The generated file is excluded from Git.`,
);
