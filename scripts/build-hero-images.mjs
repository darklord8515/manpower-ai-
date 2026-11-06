// Turns the three source pictures (repo root: morning.png, afternoon.png, evening.png) into the
// web-ready versions the app serves. Run again whenever a picture is replaced:
//   node scripts/build-hero-images.mjs
// The originals are never edited. Output: apps/web/public/hero/<name>.webp (full width) and
// <name>-sm.webp (half width, for phones).
import { createRequire } from "node:module";
import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const sharp = require("sharp");

const out = resolve(root, "apps/web/public/hero");
mkdirSync(out, { recursive: true });

for (const name of ["morning", "afternoon", "evening"]) {
  const source = resolve(root, `${name}.png`);
  const full = resolve(out, `${name}.webp`);
  const small = resolve(out, `${name}-sm.webp`);
  await sharp(source).webp({ quality: 74, effort: 6 }).toFile(full);
  await sharp(source).resize({ width: 1086 }).webp({ quality: 72, effort: 6 }).toFile(small);
  const kb = (file) => Math.round(statSync(file).size / 1024);
  console.log(`${name}: ${kb(full)} KB full, ${kb(small)} KB small`);
}
