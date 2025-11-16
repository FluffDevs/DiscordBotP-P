/*
 * Helper minimal pour envoyer des messages vers un groupe Telegram
 * Configurez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans votre .env
 */

import dotenv from 'dotenv';
dotenv.config();
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

// Configuration via env
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const batchIntervalSec = Number(process.env.TELEGRAM_BATCH_INTERVAL_SEC || '15');
const maxMessageSize = 3800; // leave margin from 4096 limit

const DATA_DIR = path.join(process.cwd(), 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'telegram-queue.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }

let bot = null;
if (token) {
  try {
    bot = new TelegramBot(token, { polling: false });
  } catch (e) {
    bot = null;
    try { logger.warn('Telegram bot init failed: ' + (e && e.message ? e.message : String(e)), { noTelegram: true }); } catch (ex) {}
  }
}

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
  queue.push(String(text));
  // persist the queue to disk immediately to avoid losses
  persistQueue();
  // ensure timer running
  ensureFlushTimer();
  return true;
}

async function flushQueue() {
  if (queue.length === 0) return;

  try { logger.info(`Telegram: démarrage du flush (${queue.length} messages en file)`, { noTelegram: true }); } catch (e) {}

  // If bot or chatId not configured, persist and reschedule flush
  if (!bot || !chatId) {
    try { logger.warn('Telegram: bot non initialisé ou TELEGRAM_CHAT_ID manquant — les messages ne seront pas envoyés.', { noTelegram: true }); } catch (e) {}
    if (!bot) try { logger.warn('Telegram: TELEGRAM_BOT_TOKEN non configuré ou invalide.', { noTelegram: true }); } catch (e) {}
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
    for (const c of chunks) {
      // Send as plain text to avoid Markdown formatting causing hidden/truncated
      // output in some clients. If you prefer formatted Markdown, we can switch
      // to MarkdownV2 and escape content.
      await bot.sendMessage(chatId, c).catch((e) => { throw e; });
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
// si aucune nouvelle enqueue n'est appelée (fix: previously flush only scheduled on enqueue)
try {
  periodicFlushHandle = setInterval(() => { try { flushQueue(); } catch (e) { /* ignore */ } }, Math.max(1000, batchIntervalSec * 1000));
  // If there are items loaded from disk at startup, attempt an immediate flush shortly after init
  if (queue.length > 0) {
    setTimeout(() => { try { flushQueue(); } catch (e) { /* ignore */ } }, 500);
  }
} catch (e) { /* ignore */ }

// Expose enqueue functions
export default {
  enqueueLog: (text) => enqueue(text),
  enqueueVerification: (text) => enqueue(text),
  // For tests or immediate send (avoid using in high-volume situations)
  sendImmediate: async (text, options = {}) => {
    if (!bot || !chatId) return false;
    try { await bot.sendMessage(chatId, text, options); return true; } catch (e) { return false; }
  },
  // allow manual flush (useful in tests)
  _flush: flushQueue
  ,
  // Return a copy of the queued messages (not removing them)
  getQueue: () => queue.slice()
};
