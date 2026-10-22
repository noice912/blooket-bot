#!/usr/bin/env node
/**
 * Blooket auto-play bot.
 *
 * Joins a Blooket game by PIN, picks a name and a random blook, then plays
 * the game for you. It sniffs the question set (including correct answers)
 * out of the game's network traffic, and clicks answers with a configurable
 * delay and accuracy so it can look more or less human.
 *
 * Usage:
 *   node bot.js --pin 123456 --name "MyBot"
 *
 * Options:
 *   --pin <pin>         Game PIN (required)
 *   --name <name>       Player name (default: random)
 *   --accuracy <0-1>    Fraction of questions answered correctly (default 1.0)
 *   --min-delay <ms>    Minimum think time before answering (default 1200)
 *   --max-delay <ms>    Maximum think time before answering (default 3500)
 *   --headless          Run without a visible browser window
 *   --bots <n>          Number of bots to join with (default 1)
 */

import { chromium } from "playwright";

// ---------- CLI parsing ----------
const args = process.argv.slice(2);
function getArg(flag, fallback = undefined) {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const PIN = getArg("--pin");
const NAME = getArg("--name", null);
const ACCURACY = Math.min(1, Math.max(0, parseFloat(getArg("--accuracy", "1"))));
const MIN_DELAY = parseInt(getArg("--min-delay", "1200"), 10);
const MAX_DELAY = parseInt(getArg("--max-delay", "3500"), 10);
const HEADLESS = args.includes("--headless");
const BOT_COUNT = Math.min(10, Math.max(1, parseInt(getArg("--bots", "1"), 10)));

if (!PIN) {
  console.error("Usage: node bot.js --pin <game pin> [--name <name>] [--accuracy 0.8] [--headless] [--bots 3]");
  process.exit(1);
}

const randomName = () => {
  const adjectives = ["Swift", "Clever", "Lucky", "Mighty", "Sneaky", "Turbo", "Cosmic", "Shadow"];
  const animals = ["Fox", "Owl", "Wolf", "Panda", "Hawk", "Tiger", "Otter", "Lynx"];
  return (
    adjectives[Math.floor(Math.random() * adjectives.length)] +
    animals[Math.floor(Math.random() * animals.length)] +
    Math.floor(Math.random() * 90 + 10)
  );
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

// ---------- question bank sniffing ----------
/**
 * Walks any JSON blob looking for Blooket question objects:
 * { question: "...", answers: [...], correctAnswers: [...] }
 * and records them keyed by normalized question text.
 */
function harvestQuestions(obj, bank) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) harvestQuestions(item, bank);
    return;
  }
  if (
    typeof obj.question === "string" &&
    Array.isArray(obj.answers) &&
    Array.isArray(obj.correctAnswers)
  ) {
    bank.set(normalize(obj.question), obj.correctAnswers.map((a) => normalize(String(a))));
  }
  for (const v of Object.values(obj)) harvestQuestions(v, bank);
}

const normalize = (s) =>
  String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// ---------- bot ----------
async function runBot(index) {
  const name = NAME ? (BOT_COUNT > 1 ? `${NAME}${index + 1}` : NAME) : randomName();
  const tag = `[${name}]`;
  const log = (...m) => console.log(tag, ...m);

  // CHROME_PATH lets you point at an existing Chrome/Chromium install
  // instead of running `npx playwright install`.
  const launchOpts = { headless: HEADLESS };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const bank = new Map(); // normalized question -> [normalized correct answers]

  // Sniff HTTP responses for the question set.
  page.on("response", async (res) => {
    const ct = res.headers()["content-type"] || "";
    if (!ct.includes("json")) return;
    try {
      const body = await res.json();
      const before = bank.size;
      harvestQuestions(body, bank);
      if (bank.size > before) log(`Learned ${bank.size - before} questions (total ${bank.size})`);
    } catch {
      /* non-JSON or stream, ignore */
    }
  });

  // Sniff WebSocket frames (Blooket games run over Firebase realtime websockets).
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      try {
        const data = typeof frame.payload === "string" ? frame.payload : frame.payload.toString();
        if (!data.includes("correctAnswers")) return;
        const body = JSON.parse(data);
        const before = bank.size;
        harvestQuestions(body, bank);
        if (bank.size > before) log(`Learned ${bank.size - before} questions from socket (total ${bank.size})`);
      } catch {
        /* partial frame, ignore */
      }
    });
  });

  // ----- join flow -----
  log("Opening blooket.com/play ...");
  await page.goto("https://www.blooket.com/play", { waitUntil: "domcontentloaded" });

  // Enter game PIN
  const pinInput = page.locator('input[placeholder*="Game ID" i], input[name="gameId"], input[type="tel"], input[type="text"]').first();
  await pinInput.waitFor({ timeout: 30000 });
  await pinInput.fill(String(PIN));
  await sleep(rand(300, 800));
  await page.keyboard.press("Enter");
  log(`Submitted PIN ${PIN}`);

  // Enter nickname
  const nameInput = page.locator('input[placeholder*="Nickname" i], input[placeholder*="Name" i]').first();
  await nameInput.waitFor({ timeout: 30000 });
  await nameInput.fill(name);
  await sleep(rand(300, 800));
  await page.keyboard.press("Enter");
  log("Submitted nickname, waiting for lobby/blook select ...");

  // Pick a blook if a selection screen appears, then confirm.
  try {
    const blook = page.locator('[class*="blookContainer"] [class*="blook"], [class*="blookBox"]').first();
    await blook.waitFor({ timeout: 15000 });
    await blook.click();
    await sleep(rand(300, 700));
    const lockBtn = page.getByRole("button", { name: /lock|select|choose/i }).first();
    if (await lockBtn.isVisible().catch(() => false)) await lockBtn.click();
    log("Picked a blook. Waiting for the game to start ...");
  } catch {
    log("No blook select screen detected, continuing ...");
  }

  // ----- play loop -----
  let answered = 0;
  let lastQuestion = "";

  while (true) {
    if (page.isClosed()) break;

    // Find a question + answer buttons on screen.
    const state = await page
      .evaluate(() => {
        const qEl = document.querySelector(
          '[class*="questionText"], [class*="question_text"], [id*="question"] , [class*="qText"]'
        );
        const answerEls = Array.from(
          document.querySelectorAll('[class*="answerContainer"] [class*="answer"], [class*="answersHolder"] > div, [class*="answerText"]')
        );
        // Fallback: typical Blooket layout = 2-4 large clickable answer divs
        let answers = answerEls
          .map((el, i) => ({ i, text: el.textContent || "" }))
          .filter((a) => a.text.trim().length > 0);
        return {
          question: qEl ? qEl.textContent || "" : "",
          answers: answers.slice(0, 4),
        };
      })
      .catch(() => null);

    if (state && state.question && state.answers.length >= 2 && normalize(state.question) !== lastQuestion) {
      lastQuestion = normalize(state.question);
      const corrects = bank.get(lastQuestion) || [];
      const answerNorms = state.answers.map((a) => normalize(a.text));

      let pickIdx = -1;
      const beCorrect = Math.random() < ACCURACY;
      if (beCorrect && corrects.length) {
        pickIdx = answerNorms.findIndex((a) => corrects.includes(a));
      }
      if (pickIdx === -1) {
        // Unknown answer or intentionally wrong: pick randomly
        // (if intentionally wrong, avoid the known correct one when possible)
        const wrongIdxs = answerNorms
          .map((a, i) => i)
          .filter((i) => !corrects.includes(answerNorms[i]));
        const pool = !beCorrect && wrongIdxs.length ? wrongIdxs : answerNorms.map((_, i) => i);
        pickIdx = pool[Math.floor(Math.random() * pool.length)];
      }

      const delay = rand(MIN_DELAY, MAX_DELAY);
      log(`Q${answered + 1}: "${state.question.slice(0, 60)}" -> answer #${pickIdx + 1}${corrects.length ? (beCorrect ? " (known correct)" : " (deliberate miss)") : " (guess)"} after ${delay}ms`);
      await sleep(delay);

      await page
        .evaluate((idx) => {
          const answerEls = Array.from(
            document.querySelectorAll('[class*="answerContainer"] [class*="answer"], [class*="answersHolder"] > div, [class*="answerText"]')
          ).filter((el) => (el.textContent || "").trim().length > 0);
          const el = answerEls[idx];
          if (el) (el.closest("div[class*='answer']") || el).dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true })
          );
        }, pickIdx)
        .catch(() => {});
      answered++;
    }

    await sleep(500);
  }

  await browser.close();
}

// ---------- main ----------
console.log(`Starting ${BOT_COUNT} bot(s) for game ${PIN} (accuracy ${ACCURACY * 100}%, delay ${MIN_DELAY}-${MAX_DELAY}ms, ${HEADLESS ? "headless" : "headed"})`);
const runners = [];
for (let i = 0; i < BOT_COUNT; i++) {
  runners.push(runBot(i).catch((e) => console.error(`[bot ${i + 1}] crashed:`, e.message)));
  await sleep(rand(1000, 2500)); // stagger joins
}
await Promise.all(runners);
