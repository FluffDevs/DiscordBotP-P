/*
 * Minimal Telegram helper using direct HTTPS API calls instead of
 * `node-telegram-bot-api`. This avoids pulling legacy `request` /
 * `form-data` / `tough-cookie` dependencies.
 *
 * Configurez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans votre .env
 */

import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import https from 'node:https';
import logger from './logger.js';

// Configuration via env
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const batchIntervalSec = Number(process.env.TELEGRAM_BATCH_INTERVAL_SEC || '15');
const maxMessageSize = 3800; // leave margin from 4096 limit

const DATA_DIR = path.join(process.cwd(), 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'telegram-queue.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }

// Simple in-memory queue for batching messages
const queue = [];
let flushTimer = null;

// Periodic flush handle (ensures flush happens even sans nouvel enqueue)
let periodicFlushHandle = null;

// Load persisted queue if present
try {
  if (fs.existsSync(QUEUE_FILE)) {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed) && parsed.length > 0) {
      for (const it of parsed) queue.push(String(it));
    }
  }
} catch (e) { try { logger.warn('Failed to load telegram queue file: ' + (e && e.message ? e.message : String(e)), { noTelegram: true }); } catch (ex) {} }

function persistQueueSync() {
  try {
    fs.writeFileSync(QUEUE_FILE + '.tmp', JSON.stringify(queue, null, 2), 'utf8');
    fs.renameSync(QUEUE_FILE + '.tmp', QUEUE_FILE);
  } catch (e) {
    try { logger.warn('Failed to persist telegram queue: ' + (e && e.message ? e.message : String(e)), { noTelegram: true }); } catch (ex) {}
  }
}

function persistQueue() {
  try {
    fs.writeFile(QUEUE_FILE + '.tmp', JSON.stringify(queue, null, 2), 'utf8', (err) => {
      if (!err) {
        try { fs.rename(QUEUE_FILE + '.tmp', QUEUE_FILE, () => {}); } catch (e) {}
      }
    });
  } catch (e) { /* ignore */ }
}

function ensureFlushTimer() {
  if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; flushQueue(); }, batchIntervalSec * 1000);
  }
}

function enqueue(text) {
  if (!text) return false;
  const t = String(text);
  try { logger.info(`Telegram: enqueue message (len=${t.length})`, { noTelegram: true }); } catch (e) {}
  try { logger.debug && logger.debug(`Telegram: enqueue content:\n${t}`, { noTelegram: true }); } catch (e) {}
  queue.push(t);
  // persist the queue to disk immediately to avoid losses
  persistQueue();
  // ensure timer running
  ensureFlushTimer();
  return true;
}

function sendTelegram(method, body) {
  return new Promise((resolve, reject) => {
    if (!token) return reject(new Error('TELEGRAM_BOT_TOKEN not configured'));
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks || '{}');
          if (parsed && parsed.ok) return resolve(parsed.result);
          return reject(new Error(parsed && parsed.description ? parsed.description : `Telegram error, status ${res.statusCode}`));
        } catch (e) {
          return reject(e);
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

async function sendMessageToChat(chat, text, options = {}) {
  const payload = { chat_id: chat, text: String(text), disable_web_page_preview: true };
  // Allow passing parse_mode and other options if needed
  if (options.parse_mode) payload.parse_mode = options.parse_mode;
  if (options.disable_web_page_preview !== undefined) payload.disable_web_page_preview = options.disable_web_page_preview;
  return sendTelegram('sendMessage', payload);
}

async function flushQueue() {
  if (queue.length === 0) return;

  try { logger.info(`Telegram: démarrage du flush (${queue.length} messages en file)`, { noTelegram: true }); } catch (e) {}

  // If token or chatId not configured, persist and reschedule flush
  if (!token || !chatId) {
    try { logger.warn('Telegram: token ou TELEGRAM_CHAT_ID manquant — les messages ne seront pas envoyés.', { noTelegram: true }); } catch (e) {}
    if (!token) try { logger.warn('Telegram: TELEGRAM_BOT_TOKEN non configuré ou invalide.', { noTelegram: true }); } catch (e) {}
    if (!chatId) try { logger.warn('Telegram: TELEGRAM_CHAT_ID manquant.', { noTelegram: true }); } catch (e) {}
    persistQueue();
    // reschedule
    ensureFlushTimer();
    return;
  }

  // Join queued messages with separator
  const joined = queue.join('\n\n---\n\n');
  // we'll clear queue only after successful send
  // Split into chunks if too long
  const chunks = [];
  let remaining = joined;
  while (remaining.length > 0) {
    if (remaining.length <= maxMessageSize) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf('\n', maxMessageSize);
    if (cut < Math.floor(maxMessageSize * 0.6)) cut = maxMessageSize; // fallback
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  // attempt to send all chunks; if any send fails we keep remaining messages
  try {
    for (const [i, c] of chunks.entries()) {
      try {
        try { logger.info(`Telegram: sending chunk ${i + 1}/${chunks.length} (len=${c.length})`, { noTelegram: true }); } catch (e) {}
        try { logger.debug && logger.debug(`Telegram: chunk content:\n${c}`, { noTelegram: true }); } catch (e) {}
        await sendMessageToChat(chatId, c);
        try { logger.info(`Telegram: chunk ${i + 1}/${chunks.length} sent successfully`, { noTelegram: true }); } catch (e) {}
      } catch (e) {
        try { logger.warn(`Telegram: failed to send chunk ${i + 1}/${chunks.length}: ${e && e.message ? e.message : String(e)}`, { noTelegram: true }); } catch (ex) {}
        throw e;
      }
      // small delay between chunks to be polite
      await new Promise(r => setTimeout(r, 200));
    }
    // sent successfully: clear queue and persist
    const sentCount = chunks.length;
    queue.length = 0;
    persistQueue();
    try { logger.info(`Telegram: flush réussi, ${sentCount} chunk(s) envoyés, file vidée.`, { noTelegram: true }); } catch (e) {}
  } catch (e) {
    try { logger.warn('Telegram send failed during flush: ' + (e && e.message ? e.message : String(e)), { noTelegram: true }); } catch (ex) {}
    // keep queue as-is and persist
    persistQueue();
    try { logger.warn('Telegram: flush échoué, messages conservés pour tentative ultérieure.', { noTelegram: true }); } catch (e) {}
    // reschedule next flush
    ensureFlushTimer();
  }
}

// Ensure we persist queue on exit
try {
  process.on('exit', () => { persistQueueSync(); });
  process.on('SIGINT', () => { persistQueueSync(); process.exit(0); });
  process.on('SIGTERM', () => { persistQueueSync(); process.exit(0); });
} catch (e) { /* ignore */ }

// Start a periodic flush to ensure queued messages are sent even
// si aucune nouvelle enqueue n'est appelée
try {
  periodicFlushHandle = setInterval(() => { try { flushQueue(); } catch (e) { /* ignore */ } }, Math.max(1000, batchIntervalSec * 1000));
  // If there are items loaded from disk at startup, attempt an immediate flush shortly after init
  if (queue.length > 0) {
    setTimeout(() => { try { flushQueue(); } catch (e) { /* ignore */ } }, 500);
  }
} catch (e) { /* ignore */ }

// Expose enqueue functions compatible with previous API
export default {
  enqueueLog: (text) => enqueue(text),
  enqueueVerification: (text) => enqueue(text),
  // For tests or immediate send (avoid using in high-volume situations)
  sendImmediate: async (text, options = {}) => {
    if (!token || !chatId) return false;
    try { await sendMessageToChat(chatId, text, options); return true; } catch (e) { return false; }
  },
  // allow manual flush (useful in tests)
  _flush: flushQueue,
  // Return a copy of the queued messages (not removing them)
  getQueue: () => queue.slice()
};
