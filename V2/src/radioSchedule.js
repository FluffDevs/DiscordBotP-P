/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Programme radio : publie dans un salon dédié un message d'ancrage avec le
 * programme du jour + un menu déroulant pour consulter les jours suivants
 * (réponse éphémère, propre à chaque membre). Le message d'ancrage est
 * ré-édité une fois par jour depuis l'API FluffRadio.
 *
 * API : https://programmation.fluffradio.com/api/schedule
 *   { timezone, generated_at, from, to, slots: [
 *       { event_id, nom, description, type: "playlist"|"emission",
 *         en_direct, debut (ISO UTC), fin (ISO UTC), duree_minutes } ] }
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder
} from 'discord.js';
import logger from './logger.js';
import { readJsonSafe, writeJsonAtomic } from './jsonStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data', 'radio-schedule.json');

const API_URL = process.env.RADIO_SCHEDULE_API_URL ?? 'https://programmation.fluffradio.com/api/schedule';
const FALLBACK_TZ = 'Europe/Paris';
const HORIZON_DAYS = 7; // aujourd'hui + 6 jours
const EMBED_COLOR = 0x1abc9c;
const SELECT_ID = 'radiosched:day';
const EMBED_DESC_MAX = 4096;

const DEFAULT_CONFIG = { channelId: null, messageId: null, updateHour: '06:00', enabled: false };

// --------------------------------------------------------------------------- //
// Persistance
// --------------------------------------------------------------------------- //
function loadData() {
  const raw = readJsonSafe(DATA_FILE, {});
  return {
    config: { ...DEFAULT_CONFIG, ...(raw.config ?? {}) },
    lastPublish: raw.lastPublish ?? null,
    lastPublishDate: raw.lastPublishDate ?? null
  };
}

function saveData(data) {
  try {
    writeJsonAtomic(DATA_FILE, data);
  } catch (err) {
    logger.warn('[radio-schedule] échec sauvegarde: ' + (err?.message ?? String(err)));
  }
}

// --------------------------------------------------------------------------- //
// Dates / fuseau
// --------------------------------------------------------------------------- //
/** Clé de jour civil (YYYY-MM-DD) d'un instant, dans le fuseau donné. */
function dayKey(instant, tz) {
  // 'en-CA' -> "2026-09-08"
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(instant);
}

/** "lundi 8 septembre" pour une clé YYYY-MM-DD. */
function dayLabelLong(key, tz) {
  const d = new Date(key + 'T12:00:00Z');
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(d);
}

/** "lun. 8 sept." pour une clé YYYY-MM-DD. */
function dayLabelShort(key, tz) {
  const d = new Date(key + 'T12:00:00Z');
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  }).format(d);
}

function unix(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** Liste des HORIZON_DAYS clés de jour à partir d'aujourd'hui (fuseau tz). */
function horizonKeys(tz) {
  const today = dayKey(Date.now(), tz);
  const base = new Date(today + 'T12:00:00Z');
  const keys = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    keys.push(dayKey(new Date(base.getTime() + i * 86400_000), tz));
  }
  return keys;
}

// --------------------------------------------------------------------------- //
// Fetch
// --------------------------------------------------------------------------- //
export async function fetchSchedule() {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${API_URL}`);
  const data = await res.json();
  const timezone = typeof data.timezone === 'string' ? data.timezone : FALLBACK_TZ;
  const slots = Array.isArray(data.slots) ? data.slots.filter((s) => s && s.debut && s.fin && s.nom) : [];
  slots.sort((a, b) => String(a.debut).localeCompare(String(b.debut)));
  return { timezone, slots, generatedAt: data.generated_at ?? new Date().toISOString() };
}

// --------------------------------------------------------------------------- //
// Rendu
// --------------------------------------------------------------------------- //
function slotLine(slot) {
  const icon = slot.en_direct ? '🔴' : slot.type === 'emission' ? '🎙️' : '🎵';
  const tag = slot.en_direct ? ' _(direct)_' : '';
  let line = `${icon} <t:${unix(slot.debut)}:t> – <t:${unix(slot.fin)}:t> · **${slot.nom}**${tag}`;
  const desc = String(slot.description ?? '').trim();
  if (desc) line += `\n> ${desc.replace(/\n/g, '\n> ')}`;
  return line;
}

export function buildDayEmbed(schedule, key) {
  const { timezone, slots } = schedule;
  const daySlots = slots.filter((s) => dayKey(new Date(s.debut), timezone) === key);
  const lines = daySlots.length
    ? daySlots.map(slotLine).join('\n\n')
    : "_Aucun programme annoncé pour cette journée — playlist musicale en continu._";

  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`📻 Fluff Radio — ${dayLabelLong(key, timezone)}`)
    .setDescription(lines.slice(0, EMBED_DESC_MAX))
    .setFooter({ text: `Heures dans ton fuseau · programme fourni pour ${timezone}` })
    .toJSON();
}

export function buildDaySelect(schedule, selectedKey) {
  const { timezone } = schedule;
  const keys = horizonKeys(timezone);
  const options = keys.map((key, i) => {
    const label =
      i === 0 ? `Aujourd'hui — ${dayLabelShort(key, timezone)}`
        : i === 1 ? `Demain — ${dayLabelShort(key, timezone)}`
          : dayLabelLong(key, timezone).replace(/^\w/, (c) => c.toUpperCase());
    return {
      label: label.slice(0, 100),
      value: key,
      default: key === selectedKey
    };
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder('Voir le programme d\'un autre jour…')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(select);
}

// --------------------------------------------------------------------------- //
// Manager
// --------------------------------------------------------------------------- //
class RadioScheduleManager {
  constructor(client) {
    this.client = client;
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
    const d = loadData();
    const c = d.config;
    return [
      '**Programme radio**',
      `- Actif : ${c.enabled ? 'oui' : 'non'}`,
      `- Salon : ${c.channelId ? `<#${c.channelId}>` : 'non configuré'}`,
      `- Message d'ancrage : ${c.messageId ? 'publié' : 'non publié (/radio-programme publish)'}`,
      `- Ré-édition quotidienne : ${c.updateHour}`,
      `- Dernière publication : ${d.lastPublish ?? 'jamais'}`
    ].join('\n');
  }

  startDailyLoop() {
    if (this._timer) return;
    this._timer = setInterval(
      () => this._tick().catch((e) => logger.error('[radio-schedule] tick: ' + (e?.message ?? String(e)))),
      60_000
    );
    logger.info('[radio-schedule] boucle quotidienne démarrée', { noTelegram: true });
  }

  async _tick() {
    const d = loadData();
    const c = d.config;
    if (!c.enabled || !c.channelId || !c.messageId) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    if (hhmm !== (c.updateHour || '06:00') || d.lastPublishDate === today) return;
    logger.info('[radio-schedule] ré-édition quotidienne du message d\'ancrage');
    await this.refreshAnchor();
  }

  async resolveChannel(channelId) {
    const ch = await this.client.channels.fetch(String(channelId)).catch(() => null);
    if (ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)) return ch;
    return null;
  }

  /** (Re)poste le message d'ancrage dans le salon configuré. */
  async publishAnchor() {
    const data = loadData();
    const c = data.config;
    if (!c.channelId) throw new Error('Salon non configuré (/radio-programme config).');
    const channel = await this.resolveChannel(c.channelId);
    if (!channel) throw new Error("Salon introuvable ou n'est pas un salon texte.");

    const schedule = await fetchSchedule();
    const todayKey = dayKey(Date.now(), schedule.timezone);
    const payload = {
      embeds: [buildDayEmbed(schedule, todayKey)],
      components: [buildDaySelect(schedule, todayKey)]
    };

    // supprime l'ancien message d'ancrage s'il existe encore
    if (c.messageId) {
      const old = await channel.messages.fetch(String(c.messageId)).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }

    const msg = await channel.send(payload);
    data.config.messageId = msg.id;
    data.lastPublish = new Date().toISOString();
    data.lastPublishDate = new Date().toISOString().slice(0, 10);
    saveData(data);
    logger.info(`[radio-schedule] message d'ancrage publié: ${msg.id}`);
    return msg;
  }

  /** Ré-édite le message d'ancrage existant (ou le republie s'il a disparu). */
  async refreshAnchor() {
    const data = loadData();
    const c = data.config;
    if (!c.channelId || !c.messageId) return this.publishAnchor();
    const channel = await this.resolveChannel(c.channelId);
    if (!channel) throw new Error('Salon introuvable.');
    const msg = await channel.messages.fetch(String(c.messageId)).catch(() => null);
    if (!msg) return this.publishAnchor();

    const schedule = await fetchSchedule();
    const todayKey = dayKey(Date.now(), schedule.timezone);
    await msg.edit({
      embeds: [buildDayEmbed(schedule, todayKey)],
      components: [buildDaySelect(schedule, todayKey)]
    });
    data.lastPublish = new Date().toISOString();
    data.lastPublishDate = new Date().toISOString().slice(0, 10);
    saveData(data);
    logger.info('[radio-schedule] message d\'ancrage ré-édité');
    return msg;
  }

  /** Répond en éphémère avec le programme du jour choisi dans le menu. */
  async handleSelect(interaction) {
    const key = interaction.values?.[0];
    if (!key) return;
    const schedule = await fetchSchedule();
    await interaction.reply({ embeds: [buildDayEmbed(schedule, key)], ephemeral: true });
  }

  /** Embed d'un jour par offset (0 = aujourd'hui). Pour la commande /programme. */
  async dayEmbedByOffset(offset) {
    const schedule = await fetchSchedule();
    const keys = horizonKeys(schedule.timezone);
    const key = keys[Math.max(0, Math.min(HORIZON_DAYS - 1, offset || 0))];
    return buildDayEmbed(schedule, key);
  }
}

let _manager = null;

export function initRadioSchedule(client) {
  if (_manager) return _manager;
  _manager = new RadioScheduleManager(client);

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isStringSelectMenu?.()) return;
      if (interaction.customId !== SELECT_ID) return;
      await _manager.handleSelect(interaction);
    } catch (err) {
      logger.error('[radio-schedule] handleSelect: ' + (err?.message ?? String(err)));
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Erreur en récupérant le programme.', ephemeral: true }).catch(() => {});
      }
    }
  });

  const start = () => _manager.startDailyLoop();
  if (client.isReady()) start();
  else client.once('clientReady', start);
  return _manager;
}

export function getManager() {
  if (!_manager) throw new Error('radioSchedule non initialisé');
  return _manager;
}

export default { initRadioSchedule, getManager };
