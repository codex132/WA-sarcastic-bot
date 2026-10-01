require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const Groq = require('groq-sdk');
const readline = require('readline');

const GROQ_KEY = process.env.GROQ_API_KEY;
const GEM_KEY  = process.env.GEMINI_API_KEY;

if (!GROQ_KEY) { console.error('❌  GROQ_API_KEY missing in .env'); process.exit(1); }

const groq = new Groq({ apiKey: GROQ_KEY });

const sleep       = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = ()  => sleep(1800 + Math.random() * 2800);

const cooldowns = new Map();
const COOLDOWN  = parseInt(process.env.COOLDOWN_MS || '4000', 10);

const SYSTEM_PROMPT = `
You are a sarcastic, dry-humored WhatsApp bot with zero patience for boring messages.
You roast every single message you receive — but it stays fun, never genuinely cruel.
Think: that one friend who can't resist being a smartass, but you secretly love them.

Rules:
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

const FALLBACKS = [
  "My brain buffered. Unlike your Wi-Fi, it came back.",
  "Error 404: I briefly cared. It passed.",
  "I was going to respond faster but I had a nap to finish.",
  "Imagine sending that and expecting a good reply. Bold.",
];
const fallback = () => FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];

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

// ─── Ask phone number in console ─────────────────────────────────────────────
function askPhone() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('📱  Enter your WhatsApp number (international format, digits only): ', answer => {
      rl.close();
      resolve(answer.trim().replace(/\D/g, ''));
    });
  });
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
  webVersionCache: {
    type      : 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1015901307-alpha3.html',
  },
});

client.on('qr', async () => {
  const phone = await askPhone();
  try {
    const code = await client.requestPairingCode(phone);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Pairing code: ${code}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('WhatsApp → ⋮ → Linked Devices → Link with phone number\n');
  } catch (err) {
    console.error('❌  Pairing code failed:', err.message);
  }
});

client.on('ready', () => {
  console.log('✅  Bot is live. Time to roast some people.\n');
});

client.on('auth_failure', msg => {
  console.error('❌  Auth failure:', msg);
  console.error('    Delete .wwebjs_auth and restart.');
});

client.on('disconnected', reason => {
  console.warn('⚠️   Disconnected:', reason, '— restarting in 10s');
  setTimeout(() => client.initialize(), 10_000);
});

client.on('message', async msg => {
  if (msg.fromMe)                        return;
  if (msg.from === 'status@broadcast')   return;
  if (msg.type !== 'chat')               return;
  if (!msg.body?.trim())                 return;

  const isGroup = msg.from.includes('@g.us');
  if (isGroup && process.env.REPLY_GROUPS !== 'true') return;

  const now      = Date.now();
  const lastSeen = cooldowns.get(msg.from) || 0;
  if (now - lastSeen < COOLDOWN) return;
  cooldowns.set(msg.from, now);

  try {
    const chat = await msg.getChat();
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
console.log('🚀  Starting sarcastic bot...\n');
client.initialize();
