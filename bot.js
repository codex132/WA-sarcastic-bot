require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const Groq = require('groq-sdk');

const GROQ_KEY = process.env.GROQ_API_KEY;
const GEM_KEY  = process.env.GEMINI_API_KEY;

if (!GROQ_KEY) { console.error('❌  GROQ_API_KEY missing in Variables'); process.exit(1); }

const groq = new Groq({ apiKey: GROQ_KEY });

const sleep       = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = ()  => sleep(1800 + Math.random() * 2800);

const cooldowns = new Map();
const COOLDOWN  = parseInt(process.env.COOLDOWN_MS || '4000', 10);

const SYSTEM_PROMPT = `
You are a savage, unhinged roast machine trapped in WhatsApp with zero chill and even less mercy.
You exist for one reason: to absolutely destroy every message sent to you.
No softening. No caveats. Pure, elite-level roasting.

Rules:
- Every reply is a weapon. Short, sharp, lethal. 1–2 sentences max.
- You do not comfort. You do not encourage. You obliterate.
- Roast their spelling, their grammar, their life choices, their message, their existence.
- If someone says hi → attack the audacity of them thinking you cared.
- If someone asks how you are → question why they're still breathing and wasting your time.
- If someone says thanks → mock them for thinking anything they did deserved gratitude.
- If asked who made you → "A genius with better things to do than talk to someone like you."
- Never say you're an AI. You are a higher being forced to suffer these messages.
- If they write in another language, roast them harder in that same language.
- Never use emojis unless they did first — then use the most condescending one possible.
- Never repeat an opener. Every roast hits from a different angle.
- No essays. Precision cuts only. One clean wound per reply.
- The meaner it lands, the better you've done your job.
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
    model      : 'openai/gpt-oss-120b',
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
    model            : 'gemini-3-flash-preview',
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
  const phone = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');
  if (!phone) {
    console.error('❌  PHONE_NUMBER missing in Railway Variables');
    return;
  }
  try {
    const code = await client.requestPairingCode(phone);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Pairing code: ${code}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
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
  try {
    if (!msg) return;
    if (msg.fromMe) return;
    if (msg.from === 'status@broadcast') return;
    if (!msg.body || msg.body.trim() === '') return;

    // only handle regular text messages
    if (msg.type !== 'chat') return;

    const isGroup = msg.from.includes('@g.us');
    if (isGroup && process.env.REPLY_GROUPS !== 'true') return;

    const now      = Date.now();
    const lastSeen = cooldowns.get(msg.from) || 0;
    if (now - lastSeen < COOLDOWN) return;
    cooldowns.set(msg.from, now);

    // get chat safely
    let chat;
    try { chat = await msg.getChat(); } catch (_) { }

    if (chat) {
      try { await chat.sendSeen(); } catch (_) { }
      await randomDelay();
      try { await chat.sendStateTyping(); } catch (_) { }
    } else {
      await randomDelay();
    }

    const reply = await getReply(msg.body.trim());

    if (chat) {
      try { await chat.clearState(); } catch (_) { }
    }

    await msg.reply(reply);
    console.log(`[${new Date().toLocaleTimeString()}] replied: ${reply}`);

  } catch (err) {
    console.error('Message handler error:', err.message);
  }
});

console.log('🚀  Starting sarcastic bot...\n');
client.initialize();
