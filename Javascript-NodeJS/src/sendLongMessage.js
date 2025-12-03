// Helper to send long messages by splitting them for Discord's 2000-char limit,
// or by attaching a file when the content exceeds a configured logical limit.
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const DISCORD_MAX = 2000;
const DEFAULT_LOGICAL_MAX = 50000; // logical maximum requested by user

// Environment toggles:
// - MAX_RESPONSE_LENGTH: logical max before switching to attachment (default 50000)
// - DEBUG_LONG_SEND: 'true' to enable verbose debug logs for sends
// - DUMP_LONG_SENDS: 'true' to write the long content to data/debug_long_sends/<timestamp>.txt for inspection

function isTrueEnv(name) {
  return (process.env[name] || '').toLowerCase() === 'true';
}

async function dumpToFile(prefix, content) {
  try {
    const dir = path.join(process.cwd(), 'data', 'debug_long_sends');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
    const file = path.join(dir, `${prefix}-${Date.now()}.txt`);
    fs.writeFileSync(file, content, 'utf8');
    return file;
  } catch (e) {
    logger.warn('Impossible d\'écrire le dump long send: ' + (e && e.message ? e.message : String(e)));
    return null;
  }
}

export async function sendLong(channel, content, options = {}) {
  if (!channel || !content) return;
  const logicalMax = Number(process.env.MAX_RESPONSE_LENGTH ?? DEFAULT_LOGICAL_MAX);
  const debug = isTrueEnv('DEBUG_LONG_SEND') || (process.env.LOG_LEVEL && process.env.LOG_LEVEL.toLowerCase() === 'debug');
  const doDump = isTrueEnv('DUMP_LONG_SENDS');

  try {
    if (debug) logger.debug(`sendLong: target=${channel.id || channel.name || 'unknown'} contentLength=${content.length} logicalMax=${logicalMax}`);

    if (doDump) {
      const f = await dumpToFile('sendLong-before', content);
      if (f) logger.debug(`sendLong: dumped original content to ${f}`);
    }

    // If content is longer than the logical maximum, send as an attached file to preserve all data
    if (content.length > logicalMax) {
      if (debug) logger.debug('sendLong: content exceeds logical max, attempting to send as attachment');
      try {
        const buffer = Buffer.from(content, 'utf8');
        const sendOpts = Object.assign({}, options, { files: [{ attachment: buffer, name: 'message.txt' }] });
        const res = await channel.send(sendOpts);
        if (debug) logger.debug(`sendLong: attachment send succeeded, messageId=${res && res.id ? res.id : 'unknown'}`);
        return res;
      } catch (err) {
        logger.warn('sendLong: échec de l\'envoi en tant que fichier (fallback en envoi chunk): ' + (err && err.message ? err.message : String(err)));
        // fallback to chunked sending
      }
    }

    // Send in 2000-char chunks (Discord limit)
    const chunks = [];
    for (let i = 0; i < content.length; i += DISCORD_MAX) chunks.push(content.slice(i, i + DISCORD_MAX));

    if (debug) logger.debug(`sendLong: will send ${chunks.length} chunk(s)`);

    let lastMessage = null;
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      try {
        const sendOpts = Object.assign({}, options, { content: chunk });
        const res = await channel.send(sendOpts);
        lastMessage = res;
        if (debug) logger.debug(`sendLong: sent chunk ${idx + 1}/${chunks.length} length=${chunk.length} messageId=${res && res.id ? res.id : 'unknown'}`);
      } catch (err) {
        logger.error(`sendLong: erreur en envoyant le chunk ${idx + 1}/${chunks.length}: ` + (err && err.message ? err.message : String(err)));
      }
      // small delay to reduce risk of hitting rate limits
      await new Promise(r => setTimeout(r, Number(process.env.SEND_CHUNK_DELAY_MS ?? 150)));
    }

    if (doDump && lastMessage && lastMessage.id) {
      const f2 = await dumpToFile(`sendLong-after-${lastMessage.id}`, content);
      if (f2) logger.debug(`sendLong: dumped sent content to ${f2}`);
    }

    return lastMessage;
  } catch (err) {
    logger.error('sendLong: erreur inattendue: ' + (err && err.message ? err.message : String(err)));
    throw err;
  }
}

export default sendLong;
