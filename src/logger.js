/*
 * Peluche Bot — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

import fs from 'fs';
import path from 'path';
// IMPORTANT: do not import telegram here at top-level. Some short-running scripts
// (like scripts/deploy-if-ready.js) import the logger to show progress and must
// exit quickly. Importing the telegram helper would start timers and keep the
// process alive (causing deploy scripts to hang). We dynamically import Telegram
// only when TELEGRAM_ENABLED=true in the environment.

const LOG_DIR = path.join(process.cwd(), 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }

// Header that must appear at the top of every log file
const LOG_HEADER = `/*\n * Peluche Bot — programme personnel de Electro / MathéoCASSY\n * https://github.com/MatheoCASSY/\n */\n\n`;

function pad(n) { return String(n).padStart(2, '0'); }
function currentLogFile() {
  const d = new Date();
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  // File per hour: app-YYYY-MM-DD-HH.log
  return path.join(LOG_DIR, `app-${year}-${month}-${day}-${hour}.log`);
}

function timestamp() {
  return new Date().toISOString();
}

function write(level, msg, opts = {}) {
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`;
  const file = currentLogFile();
  try {
    // If the file doesn't exist or is empty, ensure the header is written first
    try {
      const stat = fs.existsSync(file) ? fs.statSync(file) : null;
      if (!stat || stat.size === 0) fs.appendFileSync(file, LOG_HEADER, 'utf8');
    } catch (e) { /* ignore stat errors */ }
    fs.appendFileSync(file, line, 'utf8');
  } catch (e) { /* ignore file write errors */ }
  // Enqueue logs to Telegram batch (non-blocking, best-effort)
  try {
    // If caller explicitly set noTelegram=true, do not forward this log.
    if (!opts || !opts.noTelegram) {
      const text = `[${level.toUpperCase()}] ${timestamp()}\n${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
      // Only forward to Telegram when explicitly enabled. Use dynamic import to
      // avoid starting the Telegram module for short-lived scripts.
      if ((process.env.TELEGRAM_ENABLED || '').toLowerCase() === 'true') {
        setImmediate(() => {
          import('./telegram.js').then(mod => {
            try { mod.default.enqueueLog(text); } catch (e) { /* ignore */ }
          }).catch(() => { /* ignore import errors */ });
        });
      }
    }
  } catch (e) { /* ignore */ }
  // echo to console with simple coloring
  if (level === 'error') console.error(line.trim());
  else if (level === 'warn') console.warn(line.trim());
  else console.log(line.trim());
}

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = process.env.LOG_LEVEL ? (process.env.LOG_LEVEL.toLowerCase()) : 'debug';

export default {
  debug: (msg, opts) => { if (LEVELS[CURRENT_LEVEL] <= LEVELS.debug) write('debug', msg, opts); },
  info: (msg, opts) => { if (LEVELS[CURRENT_LEVEL] <= LEVELS.info) write('info', msg, opts); },
  warn: (msg, opts) => { if (LEVELS[CURRENT_LEVEL] <= LEVELS.warn) write('warn', msg, opts); },
  error: (msg, opts) => { if (LEVELS[CURRENT_LEVEL] <= LEVELS.error) write('error', msg, opts); }
};

// Helper to log a command invocation in a structured way and forward to Telegram once.
export function commandInvocation(details) {
  try {
    // details can be a string or an object with fields
    let text;
    if (typeof details === 'string') {
      text = details;
    } else {
      // build a multi-line summary
      const time = timestamp();
      const user = details.userTag ? `${details.userTag} (${details.userId || 'unknown'})` : (details.userId || 'unknown');
      const guild = details.guildId ? `${details.guildName ?? ''} (${details.guildId})` : 'DM';
      const channel = details.channelId ? `${details.channelName ?? ''} (${details.channelId})` : 'unknown';
      const cmd = details.commandName || details.command || 'unknown';
      // Friendly format for options/args: prefer a name=value list when possible
      let opts = '';
      if (details.options) {
        try {
          if (Array.isArray(details.options)) {
            const parts = details.options.map(o => {
              // option objects from discord can be { name, type, value } or nested
              if (o && typeof o === 'object') {
                const v = Object.prototype.hasOwnProperty.call(o, 'value') ? o.value : (o.options ? JSON.stringify(o.options) : '');
                return `${o.name}:${String(v)}`;
              }
              return String(o);
            });
            opts = parts.join(', ');
          } else if (typeof details.options === 'object') {
            opts = JSON.stringify(details.options);
          } else {
            opts = String(details.options);
          }
        } catch (e) { opts = JSON.stringify(details.options); }
      } else if (details.args) {
        try { opts = Array.isArray(details.args) ? details.args.join(' ') : String(details.args); } catch (e) { opts = JSON.stringify(details.args); }
      }
      text = `CMD ${time}\nCommand: ${cmd}\nUser: ${user}\nGuild: ${guild}\nChannel: ${channel}\nOptions: ${opts}`;
    }
    // Write to local logs but prevent the write() from forwarding to Telegram again
    write('info', text, { noTelegram: true });
    // Forward to Telegram explicitly if enabled
    if ((process.env.TELEGRAM_ENABLED || '').toLowerCase() === 'true') {
      setImmediate(() => {
        import('./telegram.js').then(mod => { try { mod.default.enqueueLog(text); } catch (e) { /* ignore */ } }).catch(() => {});
      });
    }
  } catch (e) { /* ignore */ }
}

// Note: commandInvocation is exported as a named export. Import with:
// import logger, { commandInvocation } from './logger.js';
