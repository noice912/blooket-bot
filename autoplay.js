/**
 * Blooket auto-play bookmarklet (readable source).
 *
 * BEST RESULTS: run this in the game LOBBY (right after picking your blook,
 * before the host starts) so it can capture the question set as the game
 * downloads it. Running mid-game works too if the question data is readable
 * from the page's React state.
 *
 * Two independent ways it learns answers:
 *   1. Network capture: hooks fetch/XHR/WebSocket and harvests any question
 *      objects ({question, answers, correctAnswers}) into an answer bank.
 *   2. React state scan: walks the page's React fiber tree for the current
 *      question object.
 * Then it reads the question on screen, picks the right tile, waits a
 * randomized delay, and clicks (mouse + touch events, works on mobile).
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
    source: null,
    bank: new Map(), // normalized question -> [normalized correct answers]
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

  // ---------- 1. network capture ----------
  function harvest(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 8) return;
    if (isQ(obj)) {
      bot.bank.set(norm(obj.question), obj.correctAnswers.map(norm));
      return;
    }
    if (Array.isArray(obj)) {
      for (const v of obj) harvest(v, depth + 1);
    } else {
      for (const k in obj) {
        try {
          if (obj[k] && typeof obj[k] === "object") harvest(obj[k], depth + 1);
        } catch {}
      }
    }
  }

  function harvestText(text) {
    if (!text || text.indexOf("correctAnswers") === -1) return;
    try {
      harvest(JSON.parse(text));
      return;
    } catch {}
    // Not a clean JSON document (e.g. framed socket payload): pull out each
    // balanced {...} around every "correctAnswers" occurrence.
    let idx = 0;
    while ((idx = text.indexOf('"correctAnswers"', idx)) !== -1) {
      let start = idx;
      let depth = 0;
      while (start > 0) {
        const c = text[start];
        if (c === "}") depth++;
        if (c === "{") {
          if (depth === 0) break;
          depth--;
        }
        start--;
      }
      let end = start;
      depth = 0;
      let inStr = false;
      for (; end < text.length; end++) {
        const c = text[end];
        if (inStr) {
          if (c === "\\") end++;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      try {
        harvest(JSON.parse(text.slice(start, end + 1)));
      } catch {}
      idx += 16;
    }
  }

  // fetch
  const origFetch = window.fetch;
  window.fetch = function (...a) {
    const p = origFetch.apply(this, a);
    p.then((res) => {
      try {
        res.clone().text().then(harvestText).catch(() => {});
      } catch {}
    }).catch(() => {});
    return p;
  };

  // XHR
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...a) {
    this.addEventListener("load", function () {
      try {
        if (typeof this.responseText === "string") harvestText(this.responseText);
      } catch {}
    });
    return origOpen.apply(this, a);
  };

  // WebSocket (Blooket games run over Firebase realtime sockets; long
  // messages arrive split across frames, with a leading digits-only frame)
  const OrigWS = window.WebSocket;
  window.WebSocket = function (...a) {
    const ws = new OrigWS(...a);
    let buffer = "";
    let expecting = 0;
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return;
      const d = ev.data;
      if (/^\d+$/.test(d) && d.length < 7) {
        expecting = parseInt(d, 10);
        buffer = "";
        return;
      }
      if (expecting > 0) {
        buffer += d;
        expecting--;
        if (expecting === 0) {
          harvestText(buffer);
          buffer = "";
        }
      } else {
        harvestText(d);
      }
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  Object.setPrototypeOf(window.WebSocket, OrigWS);

  // ---------- 2. React fiber scan ----------
  function deepFindQ(root, maxDepth = 6) {
    if (!root || typeof root !== "object") return null;
    const seen = new Set();
    const queue = [[root, 0]];
    let steps = 0;
    while (queue.length && steps++ < 3000) {
      const [obj, d] = queue.shift();
      if (!obj || typeof obj !== "object" || seen.has(obj)) continue;
      seen.add(obj);
      if (typeof Node !== "undefined" && obj instanceof Node) continue;
      if (obj.$$typeof) continue;
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
      if (hook.baseState && typeof hook.baseState === "object") out.push(hook.baseState);
      hook = hook.next;
    }
    return out;
  }

  function findFiberRoots() {
    const roots = [];
    const base = document.getElementById("app") || document.body;
    for (const node of [base, ...base.querySelectorAll("*")]) {
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")) {
          roots.push(node[key]);
        }
      }
      if (roots.length) break;
    }
    return roots;
  }

  let fibersScanned = 0;
  function scanFibers() {
    if (bot.source) {
      for (const f of [bot.source, bot.source.alternate]) {
        if (!f) continue;
        for (const src of fiberSources(f)) {
          const q = deepFindQ(src);
          if (q) {
            bot.source = f;
            return q;
          }
        }
      }
      bot.source = null;
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
        if (fiber.alternate && !seen.has(fiber.alternate)) stack.push(fiber.alternate);
      }
    }
    return null;
  }

  // ---------- DOM ----------
  function getQuestionText() {
    const els = [...document.querySelectorAll('[class*="question" i]')].filter(
      (el) => el.offsetParent !== null && (el.textContent || "").trim().length > 0
    );
    if (!els.length) return "";
    // innermost question element has the cleanest text
    els.sort((a, b) => a.textContent.length - b.textContent.length);
    return els[0].textContent;
  }

  function getAnswerElements() {
    let els = [...document.querySelectorAll('[class*="answer" i], [class*="option" i], [class*="choice" i]')].filter(
      (el) =>
        el.offsetParent !== null &&
        (el.textContent || "").trim().length > 0 &&
        !el.querySelector('[class*="answer" i], [class*="option" i], [class*="choice" i]')
    );
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
    try {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
      el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
    } catch {}
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- main loop ----------
  let pending = false;
  setInterval(() => {
    if (!bot.enabled || pending) return;

    const answerEls = getAnswerElements();

    // Current question: prefer React state, fall back to on-screen text + bank
    let question = "";
    let corrects = [];
    const qObj = scanFibers();
    if (qObj) {
      question = norm(qObj.question);
      corrects = qObj.correctAnswers.map(norm);
    } else {
      question = norm(getQuestionText());
      if (question && bot.bank.has(question)) corrects = bot.bank.get(question);
    }

    if (!question) {
      setStatus(`No question on screen. Bank: ${bot.bank.size} · tiles: ${answerEls.length} · answered: ${bot.answered}`);
      return;
    }
    if (answerEls.length < 2) {
      setStatus(`Question visible but only ${answerEls.length} tile(s). Bank: ${bot.bank.size}`);
      return;
    }
    if (question === bot.lastQuestion) {
      setStatus(`Waiting for next question… Bank: ${bot.bank.size} · answered: ${bot.answered}`);
      return;
    }
    if (!corrects.length && !bot.bank.size && !qObj) {
      // Nothing to go on at all — don't burn the question with a guess yet;
      // wait a bit in case the bank fills, then guess anyway.
      if (!bot._graceStart || bot._graceQ !== question) {
        bot._graceStart = Date.now();
        bot._graceQ = question;
      }
      if (Date.now() - bot._graceStart < 4000) {
        setStatus(`Answer unknown (bank empty) — waiting… Run me in the lobby next game!`);
        return;
      }
    }
    bot.lastQuestion = question;

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
      const els = getAnswerElements();
      const target = els.find((el) => norm(el.textContent) === texts[pick]) || els[pick] || answerEls[pick];
      if (target) clickAnswer(target);
      bot.answered++;
      pending = false;
    }, delay);
  }, 400);

  // ---------- control panel ----------
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

  setStatus("Running. Best run from the game lobby so I can capture the question set.");
})();
