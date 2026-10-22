/**
 * Blooket auto-play bookmarklet (readable source).
 *
 * Run this on a blooket.com page while you're in a game (after joining with
 * your PIN and nickname). It finds the current question and its correct
 * answer by reading the game's React state, then clicks the right answer for
 * you with human-like timing.
 *
 * A small control panel appears in the corner: toggle auto-answer on/off,
 * set accuracy (so you don't score a suspicious 100%), and set think time.
 *
 * To use as a bookmark, use the one-line `javascript:` version in
 * bookmarklet.txt (generated from this file).
 */
(() => {
  if (window.__blooketBot) {
    window.__blooketBot.panel.style.display = "block";
    return;
  }

  const bot = (window.__blooketBot = {
    enabled: true,
    accuracy: 1.0, // 0..1 chance of answering correctly
    minDelay: 1200, // ms
    maxDelay: 3500, // ms
    lastQuestion: "",
    answered: 0,
  });

  const norm = (s) =>
    String(s ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  // ---- React state access ------------------------------------------------
  // Blooket is a React app; the live game component keeps the current
  // question (with correctAnswers) in its state. Walk the fiber tree from
  // the root and look for it.
  function findFiberRoot() {
    const el = document.querySelector("#app") || document.body;
    for (const node of [el, ...el.querySelectorAll("*")]) {
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")) {
          return node[key];
        }
      }
    }
    return null;
  }

  function findQuestionState() {
    const root = findFiberRoot();
    if (!root) return null;
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const state = fiber.memoizedState;
      // Class component state object
      if (state && typeof state === "object" && !("next" in state)) {
        const q = extractQuestion(state);
        if (q) return q;
      }
      // Hooks chain
      let hook = state && typeof state === "object" && "next" in state ? state : null;
      let guard = 0;
      while (hook && guard++ < 100) {
        const q = extractQuestion(hook.memoizedState);
        if (q) return q;
        hook = hook.next;
      }
      if (fiber.stateNode && fiber.stateNode.state) {
        const q = extractQuestion(fiber.stateNode.state);
        if (q) return q;
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return null;
  }

  // Accepts any object and digs out { question, answers, correctAnswers }.
  function extractQuestion(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 4) return null;
    if (
      typeof obj.question === "string" &&
      Array.isArray(obj.answers) &&
      Array.isArray(obj.correctAnswers)
    ) {
      return obj;
    }
    for (const k of ["question", "currentQuestion", "q", "state", "game"]) {
      if (obj[k] && typeof obj[k] === "object") {
        const r = extractQuestion(obj[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  // ---- DOM interaction ----------------------------------------------------
  function getAnswerElements() {
    // Blooket answer tiles have class names containing "answer"; keep only
    // visible, clickable ones with text.
    const els = [...document.querySelectorAll('[class*="answer"]')].filter(
      (el) =>
        el.offsetParent !== null &&
        (el.textContent || "").trim().length > 0 &&
        !el.querySelector('[class*="answer"]') // leaf containers only
    );
    return els;
  }

  function clickAnswer(el) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  // ---- main loop -----------------------------------------------------------
  let pending = false;
  setInterval(() => {
    if (!bot.enabled || pending) return;

    const q = findQuestionState();
    const answerEls = getAnswerElements();
    if (!q || answerEls.length < 2) return;

    const qKey = norm(q.question);
    if (qKey === bot.lastQuestion) return;
    bot.lastQuestion = qKey;

    const corrects = q.correctAnswers.map(norm);
    const texts = answerEls.map((el) => norm(el.textContent));
    const correctIdxs = texts.map((t, i) => i).filter((i) => corrects.includes(texts[i]));
    const wrongIdxs = texts.map((t, i) => i).filter((i) => !corrects.includes(texts[i]));

    const beCorrect = Math.random() < bot.accuracy;
    let pool = beCorrect && correctIdxs.length ? correctIdxs : wrongIdxs.length ? wrongIdxs : correctIdxs;
    if (!pool.length) pool = texts.map((_, i) => i);
    const pick = pool[Math.floor(Math.random() * pool.length)];

    pending = true;
    const delay = rand(bot.minDelay, bot.maxDelay);
    setStatus(`Q${bot.answered + 1}: answering in ${(delay / 1000).toFixed(1)}s ${beCorrect && correctIdxs.length ? "✓" : "✗"}`);
    setTimeout(() => {
      clickAnswer(answerEls[pick]);
      bot.answered++;
      pending = false;
      setStatus(`Answered ${bot.answered} question(s)`);
    }, delay);
  }, 400);

  // ---- control panel -------------------------------------------------------
  const panel = document.createElement("div");
  bot.panel = panel;
  panel.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:999999;background:rgba(20,20,30,.92);color:#fff;" +
    "font:12px/1.5 sans-serif;padding:10px 12px;border-radius:10px;min-width:190px;box-shadow:0 4px 16px rgba(0,0,0,.5)";
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<b>Blooket Bot</b><span data-x style="cursor:pointer;opacity:.7">✕</span></div>' +
    '<label style="display:block"><input data-on type="checkbox" checked> Auto-answer</label>' +
    '<label style="display:block">Accuracy <input data-acc type="number" min="0" max="100" value="100" style="width:48px"> %</label>' +
    '<label style="display:block">Delay <input data-min type="number" value="1.2" step="0.1" style="width:40px">–' +
    '<input data-max type="number" value="3.5" step="0.1" style="width:40px"> s</label>' +
    '<div data-status style="margin-top:6px;opacity:.8">Waiting for a question…</div>';
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const setStatus = (t) => ($("[data-status]").textContent = t);
  $("[data-x]").onclick = () => (panel.style.display = "none");
  $("[data-on]").onchange = (e) => (bot.enabled = e.target.checked);
  $("[data-acc]").onchange = (e) => (bot.accuracy = Math.min(100, Math.max(0, +e.target.value)) / 100);
  $("[data-min]").onchange = (e) => (bot.minDelay = Math.max(0, +e.target.value * 1000));
  $("[data-max]").onchange = (e) => (bot.maxDelay = Math.max(bot.minDelay, +e.target.value * 1000));

  setStatus("Running. Join a game and it answers for you.");
})();
