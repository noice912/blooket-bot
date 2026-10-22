# blooket-bot

A Playwright-based bot that joins a Blooket game and plays it for you. It
joins with a PIN and nickname, picks a blook, learns the question set
(including correct answers) by sniffing the game's network traffic, and then
answers questions automatically with human-like timing and configurable
accuracy.

> **Heads up:** automating gameplay is against Blooket's Terms of Service and
> can get a game or account banned. Use at your own risk, on your own games.

## Setup

```bash
npm install
npx playwright install chromium   # once, to download the browser
```

## Usage

```bash
node bot.js --pin 123456 --name "MyBot"
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--pin <pin>` | *(required)* | Game PIN from the host screen |
| `--name <name>` | random | Player nickname (bots get numbered suffixes with `--bots`) |
| `--accuracy <0-1>` | `1.0` | Fraction of questions answered correctly, e.g. `0.8` misses ~20% on purpose |
| `--min-delay <ms>` | `1200` | Minimum "think time" before answering |
| `--max-delay <ms>` | `3500` | Maximum "think time" before answering |
| `--headless` | off | Run without a visible browser window |
| `--bots <n>` | `1` | Join with up to 10 bots at once |

### Examples

```bash
# Play convincingly: 85% accuracy, 2-6s thinking time
node bot.js --pin 123456 --name "Josh" --accuracy 0.85 --min-delay 2000 --max-delay 6000

# Headless, instant answers, perfect score
node bot.js --pin 123456 --headless --min-delay 300 --max-delay 800
```

## How it works

1. **Join** – opens `blooket.com/play`, types the PIN and nickname, and picks
   a blook, with small random pauses like a human.
2. **Learn** – watches every JSON HTTP response and WebSocket frame (Blooket
   games run over Firebase realtime sockets) for objects shaped like
   `{ question, answers, correctAnswers }` and builds an answer bank.
3. **Play** – polls the page for a question screen, looks up the correct
   answer in the bank (falling back to a random guess if it hasn't seen the
   question), waits a randomized delay, and clicks.

If Blooket changes its page markup, the CSS selectors in `bot.js` (question
text and answer buttons) are the first thing to update.
