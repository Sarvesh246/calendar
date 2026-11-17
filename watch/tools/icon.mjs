import sharp from "sharp";
import { fileURLToPath } from "node:url";
const svg = `<svg width="54" height="54" xmlns="http://www.w3.org/2000/svg"><rect width="54" height="54" rx="16" fill="#b5f5c3"/><path d="M16 14h13c15 0 15 26 0 26H16z" fill="none" stroke="#112719" stroke-width="5"/><path d="m22 27 5 5 10-12" fill="none" stroke="#112719" stroke-width="3"/></svg>`;
await sharp(Buffer.from(svg))
  .png()
  .toFile(fileURLToPath(new URL("../resources/drawables/launcher_icon.png", import.meta.url)));
