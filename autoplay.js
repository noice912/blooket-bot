/**
 * Blooket auto-play bookmarklet (readable source).
 *
 * Run this while you're IN a Blooket game (after PIN + nickname + blook).
 * It digs the current question and its correct answers out of the game's
 * React state, then clicks the right answer tile with human-like timing.
 *
 * The panel shows live diagnostics: whether it can see a question, how many
 * answer tiles it sees, and what it's doing.
 *
 * The one-line bookmark version lives in bookmarklet.txt.
 */
(() => {
  if (window.__blooketBot) {
    window.__blooketBot.panel.style.display = "block";
    return;
  }

  const bot = (window.__blooketBot = {
    enabled: true,
    accuracy: 1.0,
    minDelay: 1200,
    maxDelay: 3500,
    lastQuestion: "",
    answered: 0,
    source: null, // cached fiber that holds the question state
  });

  const norm = (s) =>
    String(s ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const isQ = (o) =>
    o &&
    typeof o === "object" &&
    typeof o.question === "string" &&
    o.question.length > 0 &&
    Array.isArray(o.correctAnswers) &&
    o.correctAnswers.length > 0;

  // Generic deep search for a question object inside any state/props blob.
  function deepFindQ(root, maxDepth = 7) {
    if (!root || typeof root !== "object") return null;
    const seen = new Set();
    const queue = [[root, 0]];
    let steps = 0;
    while (queue.length && steps++ < 3000) {
      const [obj, d] = queue.shift();
      if (!obj || typeof obj !== "object" || seen.has(obj)) continue;
      seen.add(obj);
      if (typeof Node !== "undefined" && obj instanceof Node) continue;
      if (obj.$$typeof) continue; // react element, skip
      if (isQ(obj)) return obj;
      if (d >= maxDepth) continue;
      if (Array.isArray(obj)) {
        for (const v of obj) queue.push([v, d + 1]);
      } else {
        for (const k in obj) {
          try {
            const v = obj[k];
            if (v && typeof v === "object") queue.push([v, d + 1]);
          } catch {}
        }
      }
    }
    return null;
  }

  // Pull every candidate state container off a fiber.
  function fiberSources(fiber) {
    const out = [];
    if (fiber.stateNode && fiber.stateNode.state) out.push(fiber.stateNode.state);
    if (fiber.stateNode && fiber.stateNode.props) out.push(fiber.stateNode.props);
    if (fiber.memoizedProps && typeof fiber.memoizedProps === "object") out.push(fiber.memoizedProps);
    let hook = fiber.memoizedState;
    if (hook && typeof hook === "object" && !("next" in hook)) out.push(hook);
    let guard = 0;
    while (hook && typeof hook === "object" && "next" in hook && guard++ < 150) {
      if (hook.memoizedState && typeof hook.memoizedState === "object") out.push(hook.memoizedState);
      hook = hook.next;
    }
    return out;
  }

  function findFiberRoots() {
    const roots = [];
    const scope = [document.getElementById("app") || document.body];
    for (const base of scope) {
      for (const node of [base, ...base.querySelectorAll("*")]) {
        for (const key of Object.keys(node)) {
          if (key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")) {
            roots.push(node[key]);
            if (roots.length >= 3) return roots;
          }
        }
        if (roots.length) break; // one hooked element is enough per base
      }
    }
    return roots;
  }

  let fibersScanned = 0;
  function scanForQuestion() {
    // Fast path: re-read the fiber we found the question on last time.
    if (bot.source) {
      for (const src of fiberSources(bot.source)) {
        const q = deepFindQ(src);
        if (q) return q;
      }
      // also try its alternate (React double-buffers fibers between renders)
      if (bot.source.alternate) {
        for (const src of fiberSources(bot.source.alternate)) {
          const q = deepFindQ(src);
          if (q) {
            bot.source = bot.source.alternate;
            return q;
          }
        }
      }
      bot.source = null; // stale, rescan
    }

    fibersScanned = 0;
    for (const root of findFiberRoots()) {
      const stack = [root];
      const seen = new Set();
      while (stack.length && fibersScanned < 20000) {
        const fiber = stack.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        fibersScanned++;
        for (const src of fiberSources(fiber)) {
          const q = deepFindQ(src, 5);
          if (q) {
            bot.source = fiber;
            return q;
          }
        }
        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
      }
    }
    return null;
  }

  // ---- DOM interaction ----
  function getAnswerElements() {
    let els = [...document.querySelectorAll('[class*="answer" i], [class*="option" i], [class*="choice" i]')].filter(
      (el) =>
        el.offsetParent !== null &&
        (el.textContent || "").trim().length > 0 &&
        !el.querySelector('[class*="answer" i], [class*="option" i], [class*="choice" i]')
    );
    // climb each leaf to the outermost matching container so clicks land on
    // the element React listens on
    els = els.map((el) => {
      let cur = el;
      while (
        cur.parentElement &&
        /answer|option|choice/i.test(cur.parentElement.className || "") &&
        cur.parentElement.children.length === 1
      ) {
        cur = cur.parentElement;
      }
      return cur;
    });
    return [...new Set(els)];
  }

  function clickAnswer(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    for (const t of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(t.startsWith("pointer") ? new PointerEvent(t, opts) : new MouseEvent(t, opts));
    }
    // touch events for mobile Safari
    try {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
      el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
    } catch {}
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  // ---- main loop ----
  let pending = false;
  setInterval(() => {
    if (!bot.enabled || pending) return;

    const q = scanForQuestion();
    const answerEls = getAnswerElements();

    if (!q) {
      setStatus(`No question in game state yet (tiles: ${answerEls.length}, fibers: ${fibersScanned}). Answered: ${bot.answered}`);
      return;
    }
    if (answerEls.length < 2) {
      setStatus(`See question "${q.question.slice(0, 30)}…" but only ${answerEls.length} answer tile(s). Answered: ${bot.answered}`);
      return;
    }

    const qKey = norm(q.question);
    if (qKey === bot.lastQuestion) {
      setStatus(`Waiting for next question… Answered: ${bot.answered}`);
      return;
    }
    bot.lastQuestion = qKey;

    const corrects = q.correctAnswers.map(norm);
    const texts = answerEls.map((el) => norm(el.textContent));
    const correctIdxs = texts.map((_, i) => i).filter((i) => corrects.includes(texts[i]));
    const wrongIdxs = texts.map((_, i) => i).filter((i) => !corrects.includes(texts[i]));

    const beCorrect = Math.random() < bot.accuracy;
    let pool = beCorrect && correctIdxs.length ? correctIdxs : wrongIdxs.length ? wrongIdxs : texts.map((_, i) => i);
    const pick = pool[Math.floor(Math.random() * pool.length)];

    pending = true;
    const delay = rand(bot.minDelay, bot.maxDelay);
    setStatus(`Q${bot.answered + 1}: answering in ${(delay / 1000).toFixed(1)}s ${correctIdxs.length ? (beCorrect ? "✓" : "✗ (deliberate)") : "? (guess)"}`);
    setTimeout(() => {
      const els = getAnswerElements(); // re-grab, DOM may have re-rendered
      const target = els.find((el) => norm(el.textContent) === texts[pick]) || els[pick] || answerEls[pick];
      if (target) clickAnswer(target);
      bot.answered++;
      pending = false;
    }, delay);
  }, 400);

  // ---- control panel ----
  const panel = document.createElement("div");
  bot.panel = panel;
  panel.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:999999;background:rgba(20,20,30,.92);color:#fff;" +
    "font:12px/1.5 sans-serif;padding:10px 12px;border-radius:10px;min-width:200px;max-width:260px;box-shadow:0 4px 16px rgba(0,0,0,.5)";
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<b>Blooket Bot</b><span data-x style="cursor:pointer;opacity:.7">✕</span></div>' +
    '<label style="display:block"><input data-on type="checkbox" checked> Auto-answer</label>' +
    '<label style="display:block">Accuracy <input data-acc type="number" min="0" max="100" value="100" style="width:48px"> %</label>' +
    '<label style="display:block">Delay <input data-min type="number" value="1.2" step="0.1" style="width:40px">–' +
    '<input data-max type="number" value="3.5" step="0.1" style="width:40px"> s</label>' +
    '<div data-status style="margin-top:6px;opacity:.8;word-wrap:break-word">Starting…</div>';
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const setStatus = (t) => ($("[data-status]").textContent = t);
  $("[data-x]").onclick = () => (panel.style.display = "none");
  $("[data-on]").onchange = (e) => (bot.enabled = e.target.checked);
  $("[data-acc]").onchange = (e) => (bot.accuracy = Math.min(100, Math.max(0, +e.target.value)) / 100);
  $("[data-min]").onchange = (e) => (bot.minDelay = Math.max(0, +e.target.value * 1000));
  $("[data-max]").onchange = (e) => (bot.maxDelay = Math.max(bot.minDelay, +e.target.value * 1000));

  setStatus("Running. Scanning game state…");
})();
