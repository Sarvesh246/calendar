import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(root + "source", { recursive: true });
mkdirSync(root + "bin", { recursive: true });
if (!existsSync(root + "developer_key.der")) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096 });
  writeFileSync(root + "developer_key.der", privateKey.export({ type: "pkcs8", format: "der" }));
}
if (!existsSync(root + "source/Secrets.mc")) {
  const local = JSON.parse(
    readFileSync(root + "secrets.local.json", "utf8").replace(/^\uFEFF/, ""),
  );
  if (!/^dbw_[a-f0-9]{64}$/.test(local.token))
    throw new Error(
      'Create a watch key in Datebook Settings and put it in watch/secrets.local.json as {"token":"..."}.',
    );
  writeFileSync(
    root + "source/Secrets.mc",
    `(:background)\nmodule Secrets {\n const API = "https://datebookcalendar.vercel.app/api/watch/sync";\n const TOKEN = "${local.token}";\n}\n`,
  );
}
if (!existsSync(root + "source/Seed.mc")) {
  writeFileSync(
    root + "source/Seed.mc",
    "module Seed { function items() { return []; } function classes() { return []; } function syncedAt() { return 0; } function limited() { return false; } }\n",
  );
}
console.log("Local signing key and watch configuration ready (secrets excluded from Git).");
