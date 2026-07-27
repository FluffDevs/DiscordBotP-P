/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Helpers partagés par les commandes de modération (ban/kick/timeout/warn/...) :
 * résolution des droits staff, parsing de durée, et petit store JSON pour les
 * avertissements (même schéma que data/verifications.json).
 */

import path from 'path';
import { PermissionsBitField } from 'discord.js';
import { writeJsonAtomic, readJsonSafe } from './jsonStore.js';

function resolveRoleRef(guild, ref) {
  if (!ref || !guild) return null;
  const m = String(ref).match(/^<@&(\d+)>$/);
  if (m) return guild.roles.cache.get(m[1]);
  if (/^\d+$/.test(String(ref))) return guild.roles.cache.get(String(ref));
  return guild.roles.cache.find(r => r.name === ref);
}

// Autorisé si le membre a la permission Discord requise, est Administrateur,
// ou possède le rôle VERIFIER_ROLE (même rôle staff que le flux de vérification).
export function isStaff(guild, member, requiredFlag) {
  if (!member || !member.permissions) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (requiredFlag && member.permissions.has(requiredFlag)) return true;
  const verifierRoleRaw = process.env.VERIFIER_ROLE;
  const verifierRole = typeof verifierRoleRaw === 'string' ? verifierRoleRaw.trim() : verifierRoleRaw;
  if (verifierRole && guild) {
    const r = resolveRoleRef(guild, verifierRole);
    if (r && member.roles && member.roles.cache.has(r.id)) return true;
  }
  return false;
}

// Parse des durées courtes type "10m", "2h", "1d", "30s", "1w" -> millisecondes.
export function parseDuration(input) {
  if (!input) return null;
  const m = String(input).trim().match(/^(\d+)\s*([smhdw])$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, w: 7 * 24 * 60 * 60 * 1000 }[m[2].toLowerCase()];
  return n * mult;
}

export function formatDuration(ms) {
  const units = [['j', 24 * 60 * 60 * 1000], ['h', 60 * 60 * 1000], ['min', 60 * 1000], ['s', 1000]];
  let remaining = ms;
  const parts = [];
  for (const [label, unitMs] of units) {
    const val = Math.floor(remaining / unitMs);
    if (val > 0) { parts.push(`${val}${label}`); remaining -= val * unitMs; }
  }
  return parts.length ? parts.join(' ') : '0s';
}

// --------------------------------------------------------------------------
// Casier de modération : historique persistant (data/sanctions.json) de
// toutes les actions (ban/kick/timeout/untimeout/unban/warn) par membre, avec
// qui l'a effectuée. Réservé au staff (jamais montré au membre sanctionné),
// consultable via /historique.
// --------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), 'data');
const SANCTIONS_FILE = path.join(DATA_DIR, 'sanctions.json');

export function loadSanctions() {
  const parsed = readJsonSafe(SANCTIONS_FILE, { sanctions: {} });
  if (!parsed.sanctions) parsed.sanctions = {};
  return parsed;
}

export function saveSanctions(store) {
  try {
    writeJsonAtomic(SANCTIONS_FILE, store);
  } catch (e) { /* ignore erreurs d'écriture */ }
}

// type: 'ban' | 'kick' | 'timeout' | 'untimeout' | 'unban' | 'warn'
export function addSanction(userId, entry) {
  const store = loadSanctions();
  const list = store.sanctions[userId] || [];
  list.push(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now() }, entry));
  store.sanctions[userId] = list;
  saveSanctions(store);
  return store.sanctions[userId];
}

export function getSanctions(userId) {
  const store = loadSanctions();
  return store.sanctions[userId] || [];
}

// Recherche à plat dans tout le casier, filtrable par membre sanctionné,
// modérateur et/ou type de sanction — utilisé par /historique.
export function queryHistory({ userId, moderatorId, type, limit } = {}) {
  const store = loadSanctions();
  let all = [];
  for (const [uid, list] of Object.entries(store.sanctions)) {
    for (const entry of list) all.push(Object.assign({ userId: uid }, entry));
  }
  if (userId) all = all.filter(e => e.userId === userId);
  if (moderatorId) all = all.filter(e => e.moderatorId === moderatorId);
  if (type) all = all.filter(e => e.type === type);
  all.sort((a, b) => b.createdAt - a.createdAt);
  if (limit) all = all.slice(0, limit);
  return all;
}
