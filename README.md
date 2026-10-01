# Sarcastic WhatsApp Bot

Roasts everyone who messages it. Powered by Groq (Llama 3 70B) with Gemini as fallback.

---

## Requirements

- Node.js 18 or higher → https://nodejs.org
- A WhatsApp account (the number the bot runs on)
- Free Groq API key → https://console.groq.com

---

## Setup (5 minutes)

### 1 — Install dependencies
```bash
npm install
```

### 2 — Create your .env file
```bash
cp .env.example .env
```
Open `.env` and fill in:
- `PHONE_NUMBER` — your WhatsApp number, international format, digits only
  - Nigerian example: `2348012345678` (not `+234...`, not `08012345678`)
  - UK example: `447911123456`
- `GROQ_API_KEY` — from https://console.groq.com (free, no card needed)
- `GEMINI_API_KEY` — optional, acts as fallback

### 3 — Run the bot
```bash
npm start
```

### 4 — Link your WhatsApp (no QR code)
When the bot starts it prints a pairing code like:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Pairing code: ABC-12345
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
On your phone:
1. Open WhatsApp
2. Tap ⋮ (three dots) → Linked Devices
3. Tap "Link with phone number"
4. Enter the code — you have ~60 seconds

Done. The bot is live. Session saves locally so you won't need to re-link.

---

## Anti-ban measures built in

| Measure | What it does |
|---|---|
| Humanized delay | Waits 1.8–4.6 seconds before replying (looks human) |
| Typing indicator | Shows "typing..." before the reply lands |
| Mark as read | Opens the message before replying |
| Per-user cooldown | Won't spam-reply the same person |
| Text only | Skips stickers, images, voice notes |
| Skip status | Never processes status updates |
| Skip self | Never replies to its own messages |

> **Note:** No library fully prevents bans — WhatsApp can ban unofficial clients.  
> Using this on a **secondary number** (not your main) is the safest call.

---

## Customise the personality

Edit the `SYSTEM_PROMPT` in `bot.js`. The bot follows it hard — rewrite the tone,  
add a backstory, give it a name, whatever.

## Enable group chat roasting

In `.env` set:
```
REPLY_GROUPS=true
```

---

## Run 24/7 (free hosting)

**Railway** (easiest):
1. Push the folder to a GitHub repo (`.env` stays local — never commit it)
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add your env variables in Railway's dashboard
4. Deploy — it stays online

**PM2 (on a VPS or your own machine):**
```bash
npm install -g pm2
pm2 start bot.js --name sarcastic-bot
pm2 save
pm2 startup
```
