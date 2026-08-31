/**
 * Regenerate all PWA icon PNGs from public/icon.svg.
 *
 * iOS composites transparent pixels onto white — opaque exports prevent the
 * home-screen white border. Maskable variants keep artwork in the 80% safe zone.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const SVG = path.join(PUBLIC, "icon.svg");
const BG = "#07070a";

const svg = fs.readFileSync(SVG);

/** Flatten SVG onto an opaque square — no alpha anywhere. */
async function exportAny(size, outName) {
  const out = path.join(PUBLIC, outName);
  await sharp(svg).resize(size, size).flatten({ background: BG }).png().toFile(out);
  console.log(`  ${outName} (${size}x${size})`);
}

/** Maskable: logo scaled to 80% safe zone on full-bleed opaque background. */
async function exportMaskable(size, outName) {
  const inner = Math.round(size * 0.8);
  const offset = Math.round((size - inner) / 2);
  const icon = await sharp(svg).resize(inner, inner).flatten({ background: BG }).png().toBuffer();
  const out = path.join(PUBLIC, outName);
  await sharp({
    create: { width: size, height: size, channels: 3, background: BG },
  })
    .composite([{ input: icon, top: offset, left: offset }])
    .png()
    .toFile(out);
  console.log(`  ${outName} (${size}x${size}, maskable)`);
}

/** Branded launch splash: dark fill + centered icon. */
async function exportSplash(width, height, outName) {
  const iconSize = Math.round(Math.min(width, height) * 0.22);
  const icon = await sharp(svg).resize(iconSize, iconSize).flatten({ background: BG }).png().toBuffer();
  const out = path.join(PUBLIC, outName);
  await sharp({
    create: { width, height, channels: 3, background: BG },
  })
    .composite([{ input: icon, gravity: "center" }])
    .png()
    .toFile(out);
  console.log(`  ${outName} (${width}x${height}, splash)`);
}

async function assertOpaque(fileName) {
  const file = path.join(PUBLIC, fileName);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) transparent++;
  }
  if (transparent > 0) {
    throw new Error(`${fileName} has ${transparent} non-opaque pixels`);
  }
}

console.log("Generating icons from icon.svg…");

await exportAny(180, "apple-touch-icon.png");
await exportAny(152, "icon-152.png");
await exportAny(167, "icon-167.png");
await exportAny(192, "icon-192.png");
await exportAny(512, "icon-512.png");

await exportMaskable(192, "icon-192-maskable.png");
await exportMaskable(512, "icon-512-maskable.png");

// Common iPhone portrait splash sizes (launch screen while PWA boots).
await exportSplash(1284, 2778, "splash-1284x2778.png");
await exportSplash(1170, 2532, "splash-1170x2532.png");
await exportSplash(750, 1334, "splash-750x1334.png");

console.log("Verifying opaque exports…");
for (const name of [
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-192-maskable.png",
  "icon-512-maskable.png",
]) {
  await assertOpaque(name);
}

console.log("Done — all icons are fully opaque.");
