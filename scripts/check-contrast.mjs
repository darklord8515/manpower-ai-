// Fails if a text/background token pair in apps/web/styles/tokens.css drops below WCAG AA.
// Usage: node scripts/check-contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../apps/web/styles/tokens.css", import.meta.url), "utf8");

function block(selectorStart) {
  const i = css.indexOf(selectorStart);
  if (i < 0) throw new Error(`block not found: ${selectorStart}`);
  const open = css.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === "{") depth++;
    if (css[j] === "}" && --depth === 0) return css.slice(open + 1, j);
  }
  throw new Error("unbalanced block");
}

function vars(body) {
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = vars(block(":root {"));
const dark = { ...light, ...vars(block(':root[data-theme="dark"]')) };

function parse(value, backdrop) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((k) => parseInt(hex[1].slice(k, k + 2), 16));
  const rgb = value.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ (\d+)%)?\)$/);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / 100;
    return [r, g, b].map((c, k) => Math.round(c * a + backdrop[k] * (1 - a)));
  }
  throw new Error(`unsupported colour: ${value}`);
}

const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground token, background token, minimum ratio]
const PAIRS = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["text-muted", "surface", 4.5], ["text-muted", "bg", 4.5],
  ["text-subtle", "surface", 4.5], ["text-subtle", "bg", 4.5],
  ["accent-on", "accent", 4.5], ["accent-text", "surface", 4.5], ["accent-text", "accent-soft", 4.5],
  ["success-text", "success-soft", 4.5], ["warning-text", "warning-soft", 4.5],
  ["danger-text", "danger-soft", 4.5], ["info-text", "info-soft", 4.5],
  ["success-text", "surface", 4.5], ["danger-text", "surface", 4.5], ["warning-text", "surface", 4.5],
  ["sb-text", "sb-bg", 4.5], ["sb-muted", "sb-bg", 4.5], ["sb-accent", "sb-bg", 3],
  ["focus", "surface", 3], ["focus", "bg", 3],
];

let failures = 0;
for (const [name, tokens] of [["light", light], ["dark", dark]]) {
  const surface = parse(tokens.surface, [255, 255, 255]);
  for (const [fg, bg, min] of PAIRS) {
    const back = parse(tokens[bg], surface);
    // soft tints on dark are translucent over the surface; the foreground sits on the blended result
    const r = ratio(parse(tokens[fg], back), back);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
  }
}
if (failures) {
  console.error(`\n${failures} pair(s) below the minimum.`);
  process.exit(1);
}
console.log("\nAll token pairs pass.");
