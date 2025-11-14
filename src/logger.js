import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
const LOG_FILE = path.join(LOG_DIR, 'app.log');

function timestamp() {
  return new Date().toISOString();
}

function write(level, msg) {
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch (e) { /* ignore file write errors */ }
  // echo to console with simple coloring
  if (level === 'error') console.error(line.trim());
  else if (level === 'warn') console.warn(line.trim());
  else console.log(line.trim());
}

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = process.env.LOG_LEVEL ? (process.env.LOG_LEVEL.toLowerCase()) : 'debug';

export default {
  debug: (msg) => { if (LEVELS[CURRENT_LEVEL] <= LEVELS.debug) write('debug', msg); },
  info: (msg) => { if (LEVELS[CURRENT_LEVEL] <= LEVELS.info) write('info', msg); },
  warn: (msg) => { if (LEVELS[CURRENT_LEVEL] <= LEVELS.warn) write('warn', msg); },
  error: (msg) => { if (LEVELS[CURRENT_LEVEL] <= LEVELS.error) write('error', msg); }
};
