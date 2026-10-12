import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const stagedOnly = process.argv.includes("--staged");
const skippedFiles = new Set(["package-lock.json"]);
const skippedDirs = new Set([
  ".git",
  ".next",
  ".vercel",
  "node_modules",
  "coverage",
  "graphify-out",
]);
const skippedExts = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
]);

function trackedFiles() {
  try {
    const args = stagedOnly
      ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
      : ["ls-files", "-z"];
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (skippedDirs.has(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(relative(root, path));
      }
    };
    walk(root);
    return files;
  }
}

// Pattern strings are split so this scanner never flags its own source.
const patterns = [
  ["Google API key", new RegExp("AI" + "za[0-9A-Za-z_-]{30,}", "g")],
  ["Google authorization key", new RegExp("AQ\\." + "[0-9A-Za-z_-]{35,}", "g")],
  ["OpenAI API key", new RegExp("sk-" + "(?:proj-)?[0-9A-Za-z_-]{30,}", "g")],
  ["Groq API key", new RegExp("gsk_" + "[0-9A-Za-z_-]{30,}", "g")],
  ["GitHub token", new RegExp("(?:ghp_|github_pat_)" + "[0-9A-Za-z_]{30,}", "g")],
  ["AWS access key", new RegExp("AKIA" + "[0-9A-Z]{16}", "g")],
  ["private key", new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----", "g")],
  ["Anthropic API key", new RegExp("sk-ant-" + "[0-9A-Za-z_-]{30,}", "g")],
  ["Slack token", new RegExp("xox[abprs]-" + "[0-9A-Za-z-]{20,}", "g")],
  ["Stripe secret key", new RegExp("sk_(?:live|test)_" + "[0-9A-Za-z]{20,}", "g")],
];

// Files that should never be committed, whatever they contain.
const forbiddenNames = [
  [/(^|\/)\.env(\.(?!example$).+)?$/, "environment file"],
  [/\.(pem|p12|p8|key|jks|mobileprovision)$/i, "key or signing material"],
  [/token.*\.txt$/i, "token dump"],
];

const findings = [];
for (const file of trackedFiles()) {
  for (const [nameRe, label] of forbiddenNames) {
    if (nameRe.test(file)) findings.push(`${file} (${label})`);
  }
  if (skippedExts.has(extname(file).toLowerCase()) || skippedFiles.has(file)) continue;
  let text;
  try {
    text = stagedOnly
      ? execFileSync("git", ["show", `:${file}`], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        })
      : readFileSync(join(root, file), "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line} (${label})`);
    }
  }
}

if (findings.length) {
  console.error("Potential committed secrets found (values suppressed):");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Secret scan passed.");
