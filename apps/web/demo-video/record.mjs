// Records the HR story: a real browser drives the running app (seeded demo data, real API) while
// each scene waits as long as its narration. Cursor, captions and title cards are drawn inside the
// page, so they are in the video. Run from apps/web (web on :3000, API on :8000, Docker up):
//
//   node demo-video/record.mjs
//
// It sends ONE real email: the RAK-01 people list, with its Excel, to MAIL_TO (the user's own).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE ?? "http://localhost:3000";
const MAIL_TO = "mohamedfayez181743@gmail.com";
const MAIL_ORIGINAL = "imran.qureshi@example.test"; // Imran Qureshi, lead of RAK-01 (seeded)
// The Al Hamra mark (all-white artwork), read from the brand folder and never changed.
const LOGO = readFileSync(join(HERE, "../../../assets/brand/ALHAMRA-FAVICON-LOGO.svg"), "utf8");
// ONLY=intro,outro records just those scenes and sends nothing (a rehearsal).
const only = process.env.ONLY?.split(",");
const story = JSON.parse(readFileSync(join(HERE, "story.json"), "utf8"));
const durations = JSON.parse(readFileSync(join(OUT, "durations.json"), "utf8"));
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drawn inside every page: a cursor with a tap ripple, a caption pill and full-screen title cards. */
const OVERLAY = (logoSvg) => {
  const start = () => {
    if (document.getElementById("demo-layer")) return;
    const layer = document.createElement("div");
    layer.id = "demo-layer";
    layer.innerHTML = `
      <style>
        #demo-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
          font-family: "Segoe UI", system-ui, sans-serif; }
        #demo-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; margin: -4px 0 0 -4px;
          transition: transform 40ms linear; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 45%)); }
        .demo-ripple { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
          border: 3px solid #e11d48; animation: demo-ripple 600ms ease-out forwards; }
        @keyframes demo-ripple { to { transform: scale(4.2); opacity: 0; } }
        #demo-caption { position: fixed; left: 50%; bottom: 44px; transform: translate(-50%, 12px);
          max-width: 78%; padding: 14px 28px; border-radius: 999px; background: rgb(12 10 9 / 90%);
          color: #fff; font-size: 26px; font-weight: 600; letter-spacing: .1px; text-align: center;
          opacity: 0; transition: opacity 350ms ease, transform 350ms ease; }
        #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
        #demo-card { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
          text-align: center; background: #0c0a09; color: #fff; opacity: 0; transition: opacity 600ms ease; }
        #demo-card.on { opacity: 1; }
        #demo-card h1 { margin: 0; line-height: 1.1; font-size: 92px; letter-spacing: 6px; font-weight: 700; }
        #demo-card p { margin: 0; line-height: 1.3; max-width: 80%; font-size: 28px; color: #d6d3d1; }
        #demo-card i { display: block; width: 90px; height: 5px; margin: 0 auto; background: #e11d48; border-radius: 3px; }
        #demo-card ul { list-style: none; margin: 14px 0 0; padding: 0; text-align: left; }
        #demo-card li { position: relative; margin: 0 0 18px; padding-left: 34px; font-size: 32px;
          font-weight: 600; opacity: 0; transform: translateY(12px); animation: demo-in 600ms ease forwards; }
        #demo-card li::before { content: ""; position: absolute; left: 0; top: 14px; width: 14px; height: 14px;
          border-radius: 50%; background: #e11d48; }
        #demo-card small { margin: 0 auto; padding: 5px 14px; border: 1px solid #e11d48; border-radius: 999px;
          font-size: 18px; letter-spacing: 3px; text-transform: uppercase; color: #fda4af; }
        @keyframes demo-in { to { opacity: 1; transform: none; } }
        #demo-card .mark { display: none; width: 168px; height: 168px; border-radius: 38px;
          background: #1c1917; border: 1px solid #44403c; place-items: center; opacity: 0; transform: scale(.78); }
        #demo-card .mark svg { width: 92px; height: auto; clip-path: inset(100% 0 0 0); }
        #demo-card.brand .mark { display: grid; }
        #demo-card.on.brand .mark { animation: mark-in 900ms cubic-bezier(.2,.8,.2,1) 250ms forwards; }
        #demo-card.on.brand .mark svg { animation: mark-wipe 1100ms cubic-bezier(.3,.7,.2,1) 500ms forwards; }
        #demo-card.brand h1 { opacity: 0; letter-spacing: 26px; }
        #demo-card.on.brand h1 { animation: title-in 1100ms ease-out 1300ms forwards; }
        #demo-card.brand i { width: 0; }
        #demo-card.on.brand i { animation: bar-in 700ms ease-out 2100ms forwards; }
        #demo-card.brand p { opacity: 0; }
        #demo-card.on.brand p { animation: demo-fade 700ms ease-out 2500ms forwards; }
        @keyframes mark-in { to { opacity: 1; transform: none; } }
        @keyframes mark-wipe { to { clip-path: inset(0 0 0 0); } }
        @keyframes title-in { to { opacity: 1; letter-spacing: 7px; } }
        @keyframes bar-in { to { width: 90px; } }
        @keyframes demo-fade { to { opacity: 1; } }
      </style>
      <svg id="demo-cursor" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.6L21 10.8z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>
      <div id="demo-caption"></div>
      <div id="demo-card"><div class="mark">${logoSvg}</div><small></small><h1></h1><i></i><p></p><ul></ul></div>`;
    document.body.appendChild(layer);
    const cursor = layer.querySelector("#demo-cursor");
    addEventListener("mousemove", (e) => {
      cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });
    addEventListener(
      "mousedown",
      (e) => {
        const ring = document.createElement("div");
        ring.className = "demo-ripple";
        ring.style.left = `${e.clientX}px`;
        ring.style.top = `${e.clientY}px`;
        layer.appendChild(ring);
        setTimeout(() => ring.remove(), 700);
      },
      true,
    );
    window.__demo = {
      caption(text) {
        const el = layer.querySelector("#demo-caption");
        if (!text) return el.classList.remove("on");
        el.textContent = text;
        el.classList.add("on");
      },
      // A title card. `items` appear one by one, `stepMs` apart; `tag` is a small label above.
      card(title, sub, items = [], stepMs = 3000, tag = "") {
        const el = layer.querySelector("#demo-card");
        if (!title) return el.classList.remove("on");
        el.classList.toggle("brand", title === "HAMRA AI");
        el.querySelector("small").textContent = tag;
        el.querySelector("small").style.display = tag ? "block" : "none";
        el.querySelector("h1").textContent = title;
        el.querySelector("p").textContent = sub ?? "";
        const list = el.querySelector("ul");
        list.replaceChildren(
          ...items.map((text, i) => {
            const li = document.createElement("li");
            li.textContent = text;
            li.style.animationDelay = `${900 + i * stepMs}ms`;
            return li;
          }),
        );
        el.classList.add("on");
      },
    };
  };
  if (document.body) start();
  else addEventListener("DOMContentLoaded", start);
};

async function login(context, role) {
  const r = await context.request.post(`${BASE}/api/auth/demo-login`, {
    data: { role },
    headers: { Origin: BASE },
  });
  if (!r.ok()) throw new Error(`sign-in as ${role} failed: ${r.status()}`);
}

async function setLeadEmail(context, email) {
  const r = await context.request.patch(`${BASE}/api/workers/EMP-0701`, {
    data: { email },
    headers: { Origin: BASE },
  });
  if (!r.ok()) throw new Error(`could not set the lead's email: ${r.status()} ${await r.text()}`);
}

const browser = await chromium.launch();

// 1. Warm up every page once (the dev server compiles a page the first time), not recorded.
{
  const warm = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await login(warm, "hr_manager");
  const page = await warm.newPage();
  for (const path of [
    "/",
    "/projects/RAK-01",
    "/projects/RAK-06",
    "/workers?worker=EMP-0701",
    "/applicants",
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  }
  await warm.close();
}

// 2. The recording.
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  recordVideo: { dir: join(OUT, "video"), size: { width: 1280, height: 720 } },
});
await context.addInitScript(OVERLAY, LOGO);
await login(context, "hr_manager");
if (!only) await setLeadEmail(context, MAIL_TO);
const page = await context.newPage();
const T0 = Date.now();
const timeline = {};

const caption = (text) => page.evaluate((t) => window.__demo?.caption(t), text);
const card = (title, sub, items, stepMs, tag) =>
  page.evaluate(
    ([a, b, c, d, e]) => window.__demo?.card(a, b, c, d, e),
    [title, sub, items, stepMs, tag],
  );

async function go(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__demo));
}

/** Move the cursor to an element like a hand would, then click it. */
async function tap(locator, pause = 350) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
  await sleep(pause);
  await page.mouse.down();
  await page.mouse.up();
}

async function hover(locator, pause = 450) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
  await sleep(pause);
}

async function scrollBy(pixels, steps = 12) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, pixels / steps);
    await sleep(45);
  }
}

async function scene(id, run) {
  if (only && !only.includes(id)) return;
  const spec = story.scenes.find((s) => s.id === id);
  const begin = Date.now();
  timeline[id] = { start: (begin - T0) / 1000 };
  if (spec.caption) await caption(spec.caption).catch(() => {});
  await run();
  const target = (durations[id] + 0.8) * 1000;
  const spent = Date.now() - begin;
  if (spent < target) await sleep(target - spent);
  await caption(null).catch(() => {});
  timeline[id].end = (Date.now() - T0) / 1000;
  console.log(id.padEnd(11), timeline[id].start.toFixed(1), "->", timeline[id].end.toFixed(1));
}

let failed = null;
try {
  await go("/");
  await scene("intro", async () => {
    await card("HAMRA AI", "The AI workforce platform for Alhamra Construction & Development");
  });
  await card(null);
  await sleep(700);

  await scene("home", async () => {
    await go("/");
    await caption(story.scenes[1].caption);
    const tiles = page.locator("section[aria-label]").filter({ has: page.locator("b") });
    const n = Math.min(await tiles.count(), 4);
    for (let i = 0; i < n; i++) await hover(tiles.nth(i), 500);
    await scrollBy(420);
    await sleep(900);
    await scrollBy(-420);
  });

  await scene("staff", async () => {
    await go("/projects/RAK-01");
    await caption(story.scenes[2].caption);
    await sleep(800);
    await hover(page.getByRole("heading", { name: "Staff on this project" }), 300);
    await tap(
      page.getByRole("group", { name: "Filter by trade" }).getByRole("button", { name: /^Mason/ }),
    );
    await sleep(1500);
    await tap(
      page.getByRole("group", { name: "Filter by trade" }).getByRole("button", { name: /^All/ }),
    );
  });

  await scene("lead", async () => {
    await go("/projects/RAK-06");
    await caption(story.scenes[3].caption);
    await sleep(600);
    await tap(page.getByRole("button", { name: "Assign lead" }));
    await page
      .getByRole("dialog")
      .getByText(/No project manager is free/)
      .waitFor();
    await sleep(2800);
  });
  await page.keyboard.press("Escape");

  await scene("roles", async () => {
    await go("/projects/RAK-01");
    await caption(story.scenes[4].caption);
    await sleep(500);
    const table = page.getByRole("table").filter({ hasText: "Site engineer" }).first();
    await hover(table, 400);
    const rows = table.locator("tbody tr");
    for (let i = 0; i < Math.min(await rows.count(), 4); i++) await hover(rows.nth(i), 650);
  });

  await scene("email", async () => {
    await caption(story.scenes[5].caption);
    await tap(page.getByRole("button", { name: "Email people list to the lead" }));
    const dialog = page.getByRole("dialog");
    await dialog.getByText(MAIL_TO).waitFor();
    await sleep(2200);
    await tap(dialog.getByRole("button", { name: "Send email" }));
  });

  await scene("sent", async () => {
    await caption(story.scenes[6].caption);
    const done = page.getByRole("status").filter({ hasText: "Email sent to" });
    await done.waitFor({ timeout: 40000 });
    await hover(done, 800);
  });

  await scene("profile", async () => {
    await caption(story.scenes[7].caption);
    const first = page
      .getByRole("table")
      .filter({ hasText: "Trade" })
      .last()
      .getByRole("link")
      .first();
    await tap(first);
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: /^Documents/ }).waitFor();
    await sleep(1500);
    await tap(sheet.getByRole("button", { name: /^Documents/ }));
    await sleep(1800);
  });
  await page.keyboard.press("Escape");

  await scene("applicants", async () => {
    await go("/applicants");
    await caption(story.scenes[8].caption);
    await sleep(900);
    await tap(page.getByRole("button", { name: /Arjun Pillai/ }));
    const sheet = page.getByRole("dialog");
    await sheet.getByText("Invite to an interview").waitFor();
    await sleep(1600);
    await sheet.getByLabel("Date").fill("2026-11-12");
    await sheet.getByLabel("Meeting link").fill("https://meet.example.com/hamra-interview");
    await tap(sheet.getByRole("button", { name: "Preview message" }));
    await sheet.getByText("Send invitation").waitFor();
    await sleep(1400);
  });
  await page.keyboard.press("Escape");

  await scene("chat", async () => {
    await go("/");
    await caption(story.scenes[9].caption);
    await sleep(600);
    await tap(page.getByRole("button", { name: "Chat with Virtual HR" }));
    const box = page.getByRole("textbox", { name: "Your question" });
    await box.waitFor();
    await box.pressSequentially("Who is stuck in mobilization?", { delay: 55 });
    await sleep(350);
    await box.press("Enter");
    await page
      .getByRole("article", { name: /^Answer from the/ })
      .first()
      .waitFor({ timeout: 40000 });
    await sleep(1800);
  });

  // Future plans: said and shown as a roadmap, never as something already built.
  await scene("future", async () => {
    await page.keyboard.press("Escape");
    await card(
      "Coming next",
      "",
      [
        "Projects managed even more easily",
        "One-click processes that email and WhatsApp the right people",
        "On mobiles and laptops",
        "AI attendance monitoring and reports",
        "ERP and HRM systems, connected with AI",
      ],
      3300,
      "Roadmap",
    );
  });
  await card(null);
  await sleep(700);

  await scene("outro", async () => {
    await card("HAMRA AI", "Your workforce, under control.");
  });
  await sleep(600);
} catch (error) {
  failed = error;
  console.error("The recording stopped:", error.message);
}

// 3. Put the lead's email back, close the browser so the video is saved, keep a copy.
if (!only) await setLeadEmail(context, MAIL_ORIGINAL).catch((e) =>
  console.error("could not revert:", e.message),
);
const video = page.video();
await context.close();
await browser.close();
const saved = await video.path();
copyFileSync(saved, join(OUT, "hr-story.webm"));
writeFileSync(join(OUT, "timeline.json"), JSON.stringify(timeline, null, 2));
console.log(failed ? "PARTIAL video saved:" : "Video saved:", join(OUT, "hr-story.webm"));
process.exit(failed ? 1 : 0);
