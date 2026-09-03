/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Forum "Artistes" : un post de forum par artiste de l'API FluffRadio
 * (https://fluffradio.com/api/artistes), tenu à jour une fois par jour.
 *
 * - configuration via la slash-command /artistes-forum (salon forum, heure de
 *   MAJ, activation) — persistée dans data/artist-forum.json
 * - l'API renvoie un JSON légèrement malformé (sauts de ligne bruts et
 *   backslashes non échappés dans les chaînes) -> nettoyage avant JSON.parse
 * - contenu bilingue FR + EN en embeds ; un thread n'est réécrit que si son
 *   contenu a changé (hash)
 * - artiste retiré de l'API -> thread supprimé
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { ChannelType } from 'discord.js';
import logger from './logger.js';
import { readJsonSafe, writeJsonAtomic } from './jsonStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data', 'artist-forum.json');

const API_URL = process.env.ARTIST_API_URL ?? 'https://fluffradio.com/api/artistes';
const MEDIA_BASE = process.env.ARTIST_MEDIA_BASE ?? 'https://fluffradio.com';

// Limites Discord
const EMBED_TITLE_MAX = 256;
const EMBED_DESC_MAX = 4096;
const FIELD_VALUE_MAX = 1024;
const MAX_FIELDS = 25;
const MAX_EMBEDS_PER_MSG = 10;
const MAX_CHARS_PER_MSG = 5500; // marge sous la limite dure de 6000
const THREAD_NAME_MAX = 100;
const EMBED_COLOR = 0x9b59b6;

const DEFAULT_CONFIG = { forumChannelId: null, updateHour: '04:00', enabled: false };

// --------------------------------------------------------------------------- //
// Persistance
// --------------------------------------------------------------------------- //
function loadData() {
  const raw = readJsonSafe(DATA_FILE, {});
  return {
    config: { ...DEFAULT_CONFIG, ...(raw.config ?? {}) },
    state: raw.state ?? {}, // slug -> { threadId, hash, name, extraIds:[], photoMsgId }
    lastSync: raw.lastSync ?? null,
    lastSyncDate: raw.lastSyncDate ?? null
  };
}

function saveData(data) {
  try {
    writeJsonAtomic(DATA_FILE, data);
  } catch (err) {
    logger.warn('[artist-forum] échec sauvegarde: ' + (err?.message ?? String(err)));
  }
}

// --------------------------------------------------------------------------- //
// Fetch + parse tolérant
// --------------------------------------------------------------------------- //
export function looseJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    let fixed = raw.replace(/\r/g, '');
    // backslash non suivi d'un échappement JSON valide -> on le double
    fixed = fixed.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
    // saut de ligne brut (pas déjà échappé) -> \n littéral
    fixed = fixed.replace(/(?<!\\)\n/g, '\\n');
    return JSON.parse(fixed);
  }
}

export async function fetchArtists() {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${API_URL}`);
  const raw = await res.text();
  let data = looseJsonParse(raw);
  if (data && !Array.isArray(data) && typeof data === 'object') data = Object.values(data);
  return (Array.isArray(data) ? data : []).filter((a) => a && typeof a === 'object' && a.slug);
}

// --------------------------------------------------------------------------- //
// Rendu
// --------------------------------------------------------------------------- //
function loc(value, lang = 'fr') {
  if (value && typeof value === 'object') return String(value[lang] ?? value.fr ?? value.en ?? '').trim();
  return String(value ?? '').trim();
}

function mediaUrl(p) {
  if (!p) return null;
  const s = String(p);
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return MEDIA_BASE.replace(/\/$/, '') + '/' + s.replace(/^\//, '');
}

function bilingual(fr, en) {
  fr = (fr ?? '').trim();
  en = (en ?? '').trim();
  if (fr && en && fr !== en) return `🇫🇷 ${fr}\n\n🇬🇧 ${en}`;
  return fr || en;
}

function clamp(text, limit) {
  if (!text) return text;
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…';
}

export function renderArtist(artist) {
  const nomFr = loc(artist.nom, 'fr');
  const nomEn = loc(artist.nom, 'en');
  const name = clamp(nomFr || nomEn || artist.slug || 'artiste', THREAD_NAME_MAX);

  const photos = (artist.photos ?? []).map(mediaUrl).filter(Boolean);
  const icone = mediaUrl(artist.icone);

  const embeds = [];

  // --- Embed carte ---
  let title = nomFr || nomEn || artist.slug || '';
  if (nomFr && nomEn && nomFr !== nomEn) title = `${nomFr} / ${nomEn}`;
  const card = { title: clamp(title, EMBED_TITLE_MAX), color: EMBED_COLOR };
  const desc = bilingual(loc(artist.desc_card, 'fr'), loc(artist.desc_card, 'en'));
  if (desc) card.description = clamp(desc, EMBED_DESC_MAX);
  if (icone) card.thumbnail = { url: icone };
  if (photos[0]) card.image = { url: photos[0] };

  const links = artist.links && typeof artist.links === 'object' ? artist.links : {};
  const fields = [];
  for (const [platform, url] of Object.entries(links).slice(0, MAX_FIELDS)) {
    if (!url) continue;
    fields.push({ name: clamp(String(platform), EMBED_TITLE_MAX), value: clamp(String(url), FIELD_VALUE_MAX), inline: true });
  }
  if (fields.length) card.fields = fields;
  embeds.push(card);

  // --- Embeds sections (titre1..N / paragraphe1..N) ---
  for (let i = 1; i <= 20; i++) {
    const tkey = `titre${i}`;
    const pkey = `paragraphe${i}`;
    if (!(tkey in artist) && !(pkey in artist)) break;
    const sectionTitle = loc(artist[tkey], 'fr') || loc(artist[tkey], 'en');
    const body = bilingual(loc(artist[pkey], 'fr'), loc(artist[pkey], 'en'));
    if (!sectionTitle && !body) continue;
    const e = { color: EMBED_COLOR };
    if (sectionTitle) e.title = clamp(sectionTitle, EMBED_TITLE_MAX);
    if (body) e.description = clamp(body, EMBED_DESC_MAX);
    embeds.push(e);
  }

  return { name, embeds, photos };
}

function embedLen(e) {
  let total = (e.title?.length ?? 0) + (e.description?.length ?? 0);
  for (const f of e.fields ?? []) total += (f.name?.length ?? 0) + (f.value?.length ?? 0);
  return total;
}

export function batchEmbeds(embeds) {
  const batches = [];
  let cur = [];
  let curLen = 0;
  for (const e of embeds) {
    const el = embedLen(e);
    if (cur.length && (cur.length >= MAX_EMBEDS_PER_MSG || curLen + el > MAX_CHARS_PER_MSG)) {
      batches.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(e);
    curLen += el;
  }
  if (cur.length) batches.push(cur);
  return batches.length ? batches : [[]];
}

export function contentHash(rendered) {
  return createHash('sha1').update(JSON.stringify(rendered)).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------- //
// Manager
// --------------------------------------------------------------------------- //
class ArtistForumManager {
  constructor(client) {
    this.client = client;
    this._syncing = false;
    this._timer = null;
  }

  getConfig() {
    return loadData().config;
  }

  updateConfig(patch) {
    const data = loadData();
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && v !== null && k in DEFAULT_CONFIG) data.config[k] = v;
    }
    saveData(data);
    return data.config;
  }

  statusText() {
    const data = loadData();
    const c = data.config;
    const n = Object.keys(data.state ?? {}).length;
    return [
      '**Forum artistes**',
      `- Actif : ${c.enabled ? 'oui' : 'non'}`,
      `- Salon forum : ${c.forumChannelId ? `<#${c.forumChannelId}>` : 'non configuré'}`,
      `- Heure de MAJ quotidienne : ${c.updateHour}`,
      `- Artistes suivis : ${n}`,
      `- Dernière synchro : ${data.lastSync ?? 'jamais'}`
    ].join('\n');
  }

  startDailyLoop() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick().catch((e) => logger.error('[artist-forum] tick: ' + (e?.message ?? String(e)))), 60_000);
    logger.info('[artist-forum] boucle quotidienne démarrée', { noTelegram: true });
  }

  async _tick() {
    const data = loadData();
    const c = data.config;
    if (!c.enabled || !c.forumChannelId) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    if (hhmm !== (c.updateHour || '04:00') || data.lastSyncDate === today) return;
    logger.info('[artist-forum] déclenchement de la synchro quotidienne');
    await this.sync();
  }

  async resolveForum(forumId) {
    const ch = await this.client.channels.fetch(String(forumId)).catch(() => null);
    if (ch && ch.type === ChannelType.GuildForum) return ch;
    return null;
  }

  async sync() {
    if (this._syncing) throw new Error('Une synchronisation est déjà en cours.');
    this._syncing = true;
    try {
      return await this._syncInner();
    } finally {
      this._syncing = false;
    }
  }

  async _syncInner() {
    const data = loadData();
    const state = data.state ?? {};
    const summary = { created: 0, updated: 0, deleted: 0, unchanged: 0, errors: 0 };

    if (!data.config.forumChannelId) throw new Error('Salon forum non configuré (/artistes-forum config).');
    const forum = await this.resolveForum(data.config.forumChannelId);
    if (!forum) throw new Error("Salon forum introuvable ou ce n'est pas un forum.");

    const artists = await fetchArtists();
    logger.info(`[artist-forum] ${artists.length} artiste(s) récupéré(s) depuis l'API`);
    const seen = new Set();

    for (const artist of artists) {
      const slug = String(artist.slug);
      seen.add(slug);
      try {
        const rendered = renderArtist(artist);
        const hash = contentHash(rendered);
        const batches = batchEmbeds(rendered.embeds);
        const entry = state[slug];

        if (!entry) {
          const thread = await forum.threads.create({
            name: rendered.name,
            autoArchiveDuration: 10080,
            message: { embeds: batches[0] }
          });
          const extraIds = [];
          for (const b of batches.slice(1)) {
            const m = await thread.send({ embeds: b });
            extraIds.push(m.id);
          }
          const photoMsgId = await this._sendPhotos(thread, rendered.photos.slice(1));
          state[slug] = { threadId: thread.id, hash, name: rendered.name, extraIds, photoMsgId };
          summary.created++;
        } else if (entry.hash === hash) {
          summary.unchanged++;
        } else {
          const ok = await this._updateThread(entry, rendered, batches);
          if (ok) {
            entry.hash = hash;
            entry.name = rendered.name;
            state[slug] = entry;
            summary.updated++;
          } else {
            delete state[slug]; // thread disparu -> recréé au prochain passage
            summary.errors++;
          }
        }
        await sleep(1500);
      } catch (err) {
        summary.errors++;
        logger.error(`[artist-forum] erreur sur '${slug}': ${err?.message ?? String(err)}`);
      }
    }

    // artistes retirés de l'API -> suppression du thread
    for (const slug of Object.keys(state)) {
      if (seen.has(slug)) continue;
      try {
        const thread = await this.client.channels.fetch(String(state[slug].threadId));
        if (thread) await thread.delete('Artiste retiré de l\'API FluffRadio');
        summary.deleted++;
      } catch (err) {
        logger.warn(`[artist-forum] suppression thread '${slug}' impossible: ${err?.message ?? String(err)}`);
      }
      delete state[slug];
      await sleep(1000);
    }

    data.state = state;
    data.lastSync = new Date().toISOString();
    data.lastSyncDate = new Date().toISOString().slice(0, 10);
    saveData(data);
    logger.info(`[artist-forum] synchro terminée: ${JSON.stringify(summary)}`);
    return summary;
  }

  async _updateThread(entry, rendered, batches) {
    let thread;
    try {
      thread = await this.client.channels.fetch(String(entry.threadId));
    } catch {
      return false;
    }
    if (!thread) return false;
    try {
      if (entry.name !== rendered.name) await thread.setName(rendered.name).catch(() => {});

      const starter = await thread.fetchStarterMessage().catch(() => null);
      if (starter) await starter.edit({ embeds: batches[0] }).catch((e) => logger.warn('[artist-forum] edit starter: ' + (e?.message ?? String(e))));

      for (const mid of entry.extraIds ?? []) {
        const old = await thread.messages.fetch(String(mid)).catch(() => null);
        if (old) await old.delete().catch(() => {});
      }
      const newIds = [];
      for (const b of batches.slice(1)) {
        const m = await thread.send({ embeds: b });
        newIds.push(m.id);
      }
      entry.extraIds = newIds;

      if (entry.photoMsgId) {
        const old = await thread.messages.fetch(String(entry.photoMsgId)).catch(() => null);
        if (old) await old.delete().catch(() => {});
      }
      entry.photoMsgId = await this._sendPhotos(thread, rendered.photos.slice(1));
      return true;
    } catch (err) {
      logger.error('[artist-forum] update thread échec: ' + (err?.message ?? String(err)));
      return false;
    }
  }

  async _sendPhotos(thread, urls) {
    const list = (urls ?? []).filter(Boolean).slice(0, 10);
    if (!list.length) return null;
    const m = await thread.send({ content: list.join('\n') }).catch(() => null);
    return m ? m.id : null;
  }
}

let _manager = null;

export function initArtistForum(client) {
  if (_manager) return _manager;
  _manager = new ArtistForumManager(client);
  if (client.isReady()) _manager.startDailyLoop();
  else client.once('clientReady', () => _manager.startDailyLoop());
  return _manager;
}

export function getManager() {
  if (!_manager) throw new Error('artistForum non initialisé');
  return _manager;
}

export default { initArtistForum, getManager };
