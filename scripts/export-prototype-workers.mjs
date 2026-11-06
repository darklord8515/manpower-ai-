// Snapshot of the prototype's demo workers, used by apps/api/tests/test_seed_matches_prototype.py.
// Run after changing the worker generator in prototype/index.html:
//   node scripts/export-prototype-workers.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { chromium } = require("playwright");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(root, "prototype/index.html")).href);
const workers = await page.evaluate(() =>
  // eslint-disable-next-line no-undef
  WORKERS.map((w) => ({
    code: w.code,
    name: w.name,
    trade: w.trade,
    level: w.level,
    status: w.status,
    project: w.project ?? null,
    reason: w.reason ?? null,
    phone: w.phone,
    docs: w.docs.map((d) => ({ type: d.type, until: d.until, number: d.number })),
  })),
);
await browser.close();

const target = resolve(root, "apps/api/tests/fixtures/prototype_workers.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(workers, null, 1) + "\n");
console.log(`Wrote ${workers.length} workers to ${target}`);
