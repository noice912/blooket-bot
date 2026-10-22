# blooket-bot

Two ways to have a bot play Blooket for you:

1. **Bookmarklet** (recommended — nothing to install): a bookmark you click
   while on the Blooket game page. It reads the game's React state to find
   each question's correct answer and clicks it for you, with a small control
   panel for accuracy and timing.
2. **Playwright bot** (`bot.js`): a standalone script that opens its own
   browser, joins by PIN, and plays.

> **Heads up:** automating gameplay is against Blooket's Terms of Service and
> can get a game or account banned. Use at your own risk, on your own games.

## Bookmarklet (no install)

**Setup (once):**
1. Open `bookmarklet.txt` and copy the entire line (it starts with `javascript:`).
2. In your browser, right-click the bookmarks bar → **Add page** (Chrome) or
   **New bookmark** (Firefox/Edge).
3. Name it anything (e.g. "Blooket Bot") and paste the copied line as the URL.

**Use:**
1. Join a Blooket game normally at blooket.com (PIN + nickname + blook).
2. Once you're in the game, click the bookmark.
3. A "Blooket Bot" panel appears in the bottom-right corner:
   - **Auto-answer** — toggle the bot on/off
   - **Accuracy** — e.g. 85% misses ~15% on purpose so you don't score a
     suspicious perfect game
   - **Delay** — randomized "think time" range before each answer (seconds)

Click the bookmark again if you closed the panel. The readable source is in
`autoplay.js`; regenerate `bookmarklet.txt` after editing it with:

```bash
node -e "const fs=require('fs');fs.writeFileSync('bookmarklet.txt','javascript:'+encodeURIComponent('void '+fs.readFileSync('autoplay.js','utf8').trim())+'\n')"
```

**Note:** some school-managed Chrome profiles block `javascript:` bookmarks.
If clicking the bookmark does nothing, paste the script from `autoplay.js`
into the browser DevTools console (F12 → Console) instead.

### How it works

Blooket is a React app, and the live game component keeps the current
question — including its `correctAnswers` array — in React state. The
bookmarklet walks the React fiber tree to read that state, matches the
correct answer text against the answer tiles on screen, waits a randomized
delay, and fires a click on the right tile.

## Playwright bot (standalone)

```bash
npm install
npx playwright install chromium
node bot.js --pin 123456 --name "Josh" --accuracy 0.85
```

Options: `--pin` (required), `--name`, `--accuracy 0-1`, `--min-delay` /
`--max-delay` (ms), `--headless`, `--bots <n>` (up to 10 at once). See the
comments at the top of `bot.js`.
