import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import sharp from "sharp";

const PUBLIC = path.join(process.cwd(), "public");

const OPAQUE_ICONS = [
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-192-maskable.png",
  "icon-512-maskable.png",
];

describe("PWA icon PNGs", () => {
  for (const name of OPAQUE_ICONS) {
    it(`${name} is fully opaque (no transparent pixels)`, async () => {
      const file = path.join(PUBLIC, name);
      expect(fs.existsSync(file)).toBe(true);
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let transparent = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) transparent++;
      }
      expect(transparent, `${name} has ${transparent} non-opaque pixels in ${info.width}x${info.height}`).toBe(0);
    });
  }
});
