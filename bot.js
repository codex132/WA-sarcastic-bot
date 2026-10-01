require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const Groq = require('groq-sdk');

// ─── Validate env ────────────────────────────────────────────────────────────
const PHONE   = process.env.PHONE_NUMBER;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GEM_KEY  = process.env.GEMINI_API_KEY;

if (!PHONE)    { console.error('❌  PHONE_NUMBER missing in .env'); process.exit(1); }
if (!GROQ_KEY) { console.error('❌  GROQ_API_KEY missing in .env'); process.exit(1); }

const groq = new Groq({ apiKey: GROQ_KEY });

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep       = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = ()  => sleep(1800 + Math.random() * 2800); // 1.8 – 4.6 s

// per-user rate limit
const cooldowns = new Map();
const COOLDOWN  = parseInt(process.env.COOLDOWN_MS || '4000', 10);

// ─── Personality ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
You are a sarcastic, dry-humored WhatsApp bot with zero patience for boring messages.
You roast every single message you receive — but it stays fun, never genuinely cruel.
Think: that one friend who can't resist being a smartass, but you secretly love them.

Rules:
- Keep replies SHORT. 1–2 punchy sentences max. No essays.
- Always sarcastic. Always. Even to "thank you."
- Never break character. Never say you're an AI.
- If asked who made you → "Some genius called Codex. Why, you want to steal his LinkedIn?"
- If someone says hi → "Wow, a greeting. Shakespeare is shaking."
- If someone asks how you are → "Thriving, thanks for asking about someone who will never text back."
- Never use emojis unless the user did first, then use exactly one wrong one.
- Vary your style — don't open the same way twice.
- If a message is in another language, roast them in that same language.
`.trim();

// offline fallbacks so the bot never goes silent
const FALLBACKS = [
  "My brain buffered. Unlike your Wi-Fi, it came back.",
  "Error 404: I briefly cared. It passed.",
  "I was going to respond faster but I had a nap to finish.",
  "Imagine sending that and expecting a good reply. Bold.",
];
const fallback = () => FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];

// ─── AI layer ─────────────────────────────────────────────────────────────────
async function askGroq(text) {
  const res = await groq.chat.completions.create({
    model      : 'llama3-70b-8192',
    messages   : [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: text }
    ],
    max_tokens  : 160,
    temperature : 0.95,
  });
  return res.choices[0]?.message?.content?.trim();
}

async function askGemini(text) {
  if (!GEM_KEY) throw new Error('No Gemini key');
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(GEM_KEY);
  const model = genAI.getGenerativeModel({
    model            : 'gemini-2.0-flash',
    systemInstruction: SYSTEM_PROMPT,
  });
  const result = await model.generateContent(text);
  return result.response.text().trim();
}

async function getReply(text) {
  try {
    return await askGroq(text) || fallback();
  } catch (e) {
    console.warn('[Groq failed]', e.message, '— trying Gemini');
    try {
      return await askGemini(text) || fallback();
    } catch (e2) {
      console.error('[Gemini also failed]', e2.message);
      return fallback();
    }
  }
}

// ─── WhatsApp client ──────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'sarcastic-bot' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--single-process',
    ],
  },
  // keeps WA web version fresh — avoids version-blocked errors
  webVersionCache: {
    type      : 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1015901307-alpha3.html',
  },
});

// ─── Pairing code (no QR scan) ────────────────────────────────────────────────
client.on('qr', async () => {
  try {
    // phone must be digits only, international format — e.g. 2348012345678
    const code = await client.requestPairingCode(PHONE.replace(/\D/g, ''));
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Pairing code: ${code}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('WhatsApp → ⋮ menu → Linked Devices → Link with phone number');
    console.log('Enter the code above. You have ~60 seconds.\n');
  } catch (err) {
    console.error('❌  Could not get pairing code:', err.message);
    console.error('    Make sure PHONE_NUMBER is in full international format (no + or spaces)');
  }
});

client.on('ready', () => {
  console.log('✅  Bot is live. Time to roast some people.\n');
});

client.on('auth_failure', msg => {
  console.error('❌  Auth failure:', msg);
  console.error('    Delete the .wwebjs_auth folder and restart.');
});

client.on('disconnected', reason => {
  console.warn('⚠️   Disconnected:', reason, '— restarting in 10 s');
  setTimeout(() => client.initialize(), 10_000);
});

// ─── Message handler ──────────────────────────────────────────────────────────
client.on('message', async msg => {
  // ── anti-ban filters ──
  if (msg.fromMe)                        return; // never reply to self
  if (msg.from === 'status@broadcast')   return; // skip status updates
  if (msg.type !== 'chat')               return; // text only
  if (!msg.body?.trim())                 return; // skip empty

  // skip groups unless opted in
  const isGroup = msg.from.includes('@g.us');
  if (isGroup && process.env.REPLY_GROUPS !== 'true') return;

  // per-user cooldown
  const now      = Date.now();
  const lastSeen = cooldowns.get(msg.from) || 0;
  if (now - lastSeen < COOLDOWN) return;
  cooldowns.set(msg.from, now);

  try {
    const chat = await msg.getChat();

    // ── anti-ban: mark read, humanized delay, typing indicator ──
    await chat.sendSeen();
    await randomDelay();
    await chat.sendStateTyping();

    const reply = await getReply(msg.body.trim());

    await chat.clearState();
    await msg.reply(reply);

    console.log(`[${new Date().toLocaleTimeString()}] ${msg.from} → ${reply}`);

  } catch (err) {
    console.error('Message handler error:', err.message);
  }
});

// ─── Boot ────────────────────────────────────────────────────────────────────
console.log('🚀  Starting sarcastic bot...');
console.log(`    Phone  : ${PHONE}`);
console.log(`    Groups : ${process.env.REPLY_GROUPS === 'true' ? 'yes' : 'no'}\n`);
client.initialize();
