#!/usr/bin/env node
/*
  start-and-monitor.js
  - Exécute un `git fetch --all` au démarrage
  - Lance le bot Node (`src/index.js`) trouvé dans le projet détecté
  - Surveille les erreurs/exit du processus du bot
  - En cas de problème, envoie un message Telegram via `src/telegram.js`

  Ce script est résilient aux emplacements : si `startup/` est placé au-dessus
  du dossier projet (ex: parent folder contenant le dossier du projet), il
  détectera automatiquement le répertoire du projet en cherchant un
  `package.json`.
*/

import dotenv from 'dotenv';
dotenv.config();

import { exec } from 'child_process';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

// Détection du répertoire du projet (racine contenant package.json)
function findProjectRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), path.join(scriptDir, '..'), scriptDir];

  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'package.json'))) return path.resolve(c);
    } catch (e) { /* ignore */ }
  }

  // Scanne le parent du dossier `startup` pour trouver un sous-dossier qui contient package.json
  try {
    const parent = path.join(scriptDir, '..');
    const entries = fs.readdirSync(parent, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const possible = path.join(parent, e.name);
        if (fs.existsSync(path.join(possible, 'package.json'))) return path.resolve(possible);
      }
    }
  } catch (e) { /* ignore */ }

  // fallback: process.cwd()
  return process.cwd();
}

const ROOT = findProjectRoot();
const LOGS_DIR = path.join(ROOT, 'logs');
if (!fs.existsSync(LOGS_DIR)) try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (e) {}

function nowIso() { return new Date().toISOString(); }

// imports dynamiques après détection de la racine projet
let telegram = null;
let logger = console;
async function loadHelpers() {
  try {
    const tPath = path.join(ROOT, 'src', 'telegram.js');
    const lPath = path.join(ROOT, 'src', 'logger.js');
    if (fs.existsSync(tPath)) {
      const mod = await import(pathToFileURL(tPath).href);
      telegram = mod.default || mod;
    }
    if (fs.existsSync(lPath)) {
      const modL = await import(pathToFileURL(lPath).href);
      logger = modL.default || modL || console;
    }
  } catch (e) {
    // keep console as fallback
    try { console.warn('startup: impossible d\'importer telegram/logger dynamiquement: ' + (e && e.message ? e.message : String(e))); } catch (ex) {}
  }
}

async function runGitFetch() {
  return new Promise((resolve) => {
    try {
      exec('git fetch --all', { cwd: ROOT, timeout: 60_000 }, (err, stdout, stderr) => {
        if (err) {
          try { logger.warn && logger.warn(`startup: git fetch failed: ${err.message}`, { noTelegram: true }); } catch (e) {}
          resolve(false);
        } else {
          try { logger.info && logger.info('startup: git fetch --all done', { noTelegram: true }); } catch (e) {}
          resolve(true);
        }
      });
    } catch (e) {
      try { logger.warn && logger.warn('startup: git fetch threw: ' + (e && e.message ? e.message : String(e)), { noTelegram: true }); } catch (ex) {}
      resolve(false);
    }
  });
}

// restart/backoff configuration (via env)
const MAX_RETRIES = Number(process.env.STARTUP_MAX_RETRIES ?? process.env.MAX_RETRIES ?? '5');
const INITIAL_BACKOFF_MS = Number(process.env.STARTUP_INITIAL_BACKOFF_MS ?? process.env.INITIAL_BACKOFF_MS ?? '2000');
const BACKOFF_MULTIPLIER = Number(process.env.STARTUP_BACKOFF_MULTIPLIER ?? process.env.BACKOFF_MULTIPLIER ?? '2');
const RESTART_ENABLED = !!process.env.STARTUP_RESTART_ENABLED || MAX_RETRIES > 0;

// spawn the bot process and return a controller for it
function spawnBot() {
  const indexPath = path.join(ROOT, 'src', 'index.js');
  if (!fs.existsSync(indexPath)) {
    const msg = `startup: fichier ${indexPath} introuvable, impossible de démarrer le bot.`;
    try { logger.error && logger.error(msg, { noTelegram: true }); } catch (e) {}
    if (telegram && telegram.enqueueLog) telegram.enqueueLog(msg);
    return null;
  }

  const child = spawn(process.execPath, [indexPath], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const timeTag = nowIso().replace(/[:.]/g, '-');
  const outLog = path.join(LOGS_DIR, `bot-out-${timeTag}.log`);
  const errLog = path.join(LOGS_DIR, `bot-err-${timeTag}.log`);
  const outStream = fs.createWriteStream(outLog, { flags: 'a' });
  const errStream = fs.createWriteStream(errLog, { flags: 'a' });

  child.stdout.on('data', (d) => {
    const s = d.toString();
    try { logger.info && logger.info(s.trim(), { noTelegram: true }); } catch (e) {}
    outStream.write(s);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    try { logger.warn && logger.warn(s.trim(), { noTelegram: true }); } catch (e) {}
    errStream.write(s);
  });

  // on error we just forward
  child.on('error', (err) => {
    const msg = `startup: erreur process bot: ${err && err.message ? err.message : String(err)}`;
    try { logger.error && logger.error(msg, { noTelegram: true }); } catch (e) {}
    if (telegram && telegram.sendImmediate) telegram.sendImmediate(msg);
  });

  // cleanup streams when the child terminates
  child._outStream = outStream; // attach for later cleanup
  child._errStream = errStream;

  return child;
}

// supervise and optionally restart with backoff
async function superviseBot() {
  let attempts = 0;
  let backoff = INITIAL_BACKOFF_MS;

  while (true) {
    const child = spawnBot();
    if (!child) {
      const msg = 'startup: le bot n\'a pas pu être démarré.';
      if (telegram && telegram.sendImmediate) await telegram.sendImmediate(msg);
      // if cannot spawn, nothing to do
      process.exit(1);
    }

    // wait for exit
    const exitInfo = await new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    // close attached streams
    try { child._outStream && child._outStream.end(); } catch (e) {}
    try { child._errStream && child._errStream.end(); } catch (e) {}

    const msg = `startup: process bot exited with code=${exitInfo.code}, signal=${exitInfo.signal}`;
    try { logger.warn && logger.warn(msg, { noTelegram: true }); } catch (e) {}
    if (telegram && telegram.sendImmediate) await telegram.sendImmediate(msg);

    // if restart disabled, break and exit
    if (!RESTART_ENABLED) {
      break;
    }

    attempts += 1;
    if (MAX_RETRIES > 0 && attempts > MAX_RETRIES) {
      const finalMsg = `startup: atteints ${MAX_RETRIES} tentatives de redémarrage sans succès — arrêt.`;
      try { logger.error && logger.error(finalMsg, { noTelegram: true }); } catch (e) {}
      if (telegram && telegram.sendImmediate) await telegram.sendImmediate(finalMsg);
      process.exit(1);
    }

    // wait backoff ms before next attempt
    try { logger.info && logger.info(`startup: tentative de redémarrage #${attempts} dans ${backoff}ms`, { noTelegram: true }); } catch (e) {}
    await new Promise(r => setTimeout(r, backoff));
    backoff = Math.min(backoff * BACKOFF_MULTIPLIER, 60 * 1000); // cap at 60s
  }
}

(async () => {
  try {
    await loadHelpers();
    try { logger.info && logger.info('startup: script de démarrage lancé', { noTelegram: true }); } catch (e) {}

    await runGitFetch();

    const child = startBot();
    if (!child) {
      const msg = 'startup: le bot n\'a pas pu être démarré.';
      if (telegram && telegram.sendImmediate) telegram.sendImmediate(msg);
      process.exit(1);
    }

    // On garde le process parent vivant ; si le child meurt, on le signale (mais on ne restart pas ici)
    // Le service Windows (ou supervisord/nssm) pourra redémarrer le process si souhaité.

  } catch (e) {
    const msg = 'startup: erreur fatale dans start-and-monitor: ' + (e && e.message ? e.message : String(e));
    try { logger.error && logger.error(msg, { noTelegram: true }); } catch (ex) {}
    if (telegram && telegram.sendImmediate) try { await telegram.sendImmediate(msg); } catch (ex) {}
    process.exit(1);
  }
})();
