/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Flux de vérification basé sur les composants natifs Discord (aucun message
 * initial en DM) :
 *  1) Le select menu public "Choisis ta langue" (posté par /nvmenu ou /msgverif)
 *     démarre directement la vérification ET ouvre le Modal (formulaire) —
 *     un seul geste combine "commencer" et "choisir la langue".
 *  2) Soumission du modal -> DM de confirmation + récapitulatif des réponses,
 *     puis publication dans le forum + relais Telegram
 *  3) Validation staff dans le thread : select menu multi-choix des rôles à
 *     attribuer + boutons Valider / Refuser / Annuler (Refuser/Annuler ouvrent
 *     un Modal pour saisir la raison instantanément).
 */

import {
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import telegram from './telegram.js';
import { sendLong } from './sendLongMessage.js';
import i18n, { resolveLang } from './i18n.js';

function getEnv(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

// --- Horodatage lisible pour les messages Telegram ---
function tsNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// --- Construction de messages Telegram clairs et structurés ---
function tgHeader(emoji, title) {
  return `${emoji} ${title}\n🕒 ${tsNow()}`;
}

function buildTelegramSubmission(member, lang, answers, threadUrl) {
  const header = [
    tgHeader('🆕', 'NOUVELLE VÉRIFICATION'),
    `👤 Membre : ${member.user.tag} (${member.id})`,
    `🌐 Langue : ${lang.toUpperCase()}`,
    threadUrl ? `🧵 Thread : ${threadUrl}` : null
  ].filter(Boolean).join('\n');
  const qa = answers.map(a => `▫️ ${a.question}\n${a.answer}`).join('\n\n');
  return `${header}\n\n❓ Réponses :\n${qa}`;
}

function buildTelegramDecision(emoji, title, target, moderatorUser, extraFields) {
  const lines = [
    tgHeader(emoji, title),
    `👤 Membre : ${target ? target.user.tag : 'inconnu'} (${target ? target.id : '?'})`,
    `🛡️ Par : ${moderatorUser.tag} (${moderatorUser.id})`
  ];
  if (extraFields) {
    for (const [label, value] of Object.entries(extraFields)) {
      if (value) lines.push(`${label} : ${value}`);
    }
  }
  return lines.join('\n');
}

// --- Message public "démarrer la vérification" (posté par /nvmenu et /msgverif) ---
// Choisir une langue dans le select menu démarre directement la vérification
// (pas de bouton séparé) : un seul geste combine "commencer" et "choisir la langue".
export function buildVerificationStartMessage() {
  const content = [
    '## 🛂 Vérification du serveur',
    '',
    'Bienvenue ! Pour accéder au serveur, choisis ta langue ci-dessous 👇 — le formulaire s\'ouvrira directement après ton choix.',
    '',
    '🇫🇷 **Français** — répond au questionnaire pour finaliser ta vérification.',
    '🇬🇧 **English** — answer the questionnaire to complete your verification.'
  ].join('\n');

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('verif_lang_select')
      .setPlaceholder('🌐 Choisis ta langue / Choose your language')
      .addOptions(
        { label: i18n.fr.langLabel, description: 'Commencer la vérification en français', value: 'fr', emoji: '🇫🇷' },
        { label: i18n.en.langLabel, description: 'Start verification in English', value: 'en', emoji: '🇬🇧' }
      )
  );

  return { content, components: [row] };
}

export function initVerification(client) {
  // --- persistence simple (fichier JSON) pour garder le mapping memberId -> thread/statut/langue/réponses
  const DATA_DIR = path.join(process.cwd(), 'data');
  const DATA_FILE = path.join(DATA_DIR, 'verifications.json');
  if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (err) { /* ignore */ }
  }
  let store = { verifications: {} };
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      store = JSON.parse(raw || '{}');
      if (!store.verifications) store.verifications = {};
    }
  } catch (err) {
    logger.warn('Impossible de charger le store de vérifications, on repart vide.');
    store = { verifications: {} };
  }
  function saveStore() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
      logger.warn('Impossible de sauvegarder le store de vérifications: ' + (err && err.message ? err.message : String(err)));
    }
  }

  // Cooldown pour le bouton de demande de vérification (empêche le spam)
  const REQUEST_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
  const lastRequest = new Map(); // memberId -> timestamp

  // Sélections de rôles en attente de validation (memberId -> string[] de clés de rôle)
  const pendingRoleSelections = new Map();

  // Helper: try an async role operation with retries on transient errors (rate-limit/network)
  async function tryRoleOperation(opFn, contextMsg, channel) {
    const maxAttempts = 3;
    const delays = [500, 1500, 3500]; // ms
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await opFn();
        return true;
      } catch (err) {
        const msg = err && (err.message || err.code || String(err));
        const isTransient = (err && (err.status === 429)) || /rate/i.test(String(msg)) || /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(String(msg));
        logger.warn(`Tentative ${attempt} échouée pour ${contextMsg}: ${msg}`, { noTelegram: true });
        if (attempt < maxAttempts && isTransient) {
          const wait = delays[attempt - 1] || 1000;
          logger.info(`Réessayer ${contextMsg} dans ${wait}ms (attempt ${attempt + 1}/${maxAttempts})`, { noTelegram: true });
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        logger.error(`Echec définitif de ${contextMsg}: ${msg}`);
        if (channel) {
          let extra = '';
          try {
            const guild = channel.guild || (channel.thread ? channel.thread.guild : null) || null;
            if (guild && client && client.user) {
              const botMember = await guild.members.fetch(client.user.id).catch(() => null);
              if (botMember && botMember.roles && botMember.roles.highest) {
                extra += `\nBot highest role: ${botMember.roles.highest.name} (position ${botMember.roles.highest.position})`;
              }
              const idMatch = String(contextMsg).match(/(\d{16,})/);
              if (idMatch) {
                const roleId = idMatch[1];
                const targetRole = guild.roles.cache.get(roleId);
                if (targetRole) extra += `\nTarget role: ${targetRole.name} (position ${targetRole.position})`;
              }
            }
          } catch (e) { /* ignore diagnostic helpers */ }
          try {
            await channel.send(`⚠️ Erreur: impossible de ${contextMsg}. Détails: ${msg}. Vérifiez que le bot a la permission Manage Roles, que son rôle est au-dessus du rôle ciblé et réessayez.${extra}`).catch(() => {});
          } catch (e) { /* ignore */ }
        }
        return false;
      }
    }
    return false;
  }

  const forumChannelId = getEnv('FORUM_CHANNEL_ID');
  const nonVerifiedRoleRaw = getEnv('NON_VERIFIED_ROLE');
  const nonVerifiedRole = (typeof nonVerifiedRoleRaw === 'string' ? nonVerifiedRoleRaw.trim() : nonVerifiedRoleRaw);
  const pelucheRoleRaw = getEnv('PELUCHER_ROLE') ?? getEnv('PELUCHES_ROLE') ?? getEnv('PELUCHER');
  const pelucheRole = (typeof pelucheRoleRaw === 'string' ? pelucheRoleRaw.trim() : pelucheRoleRaw);
  const verifierRoleRaw = getEnv('VERIFIER_ROLE');
  const verifierRole = (typeof verifierRoleRaw === 'string' ? verifierRoleRaw.trim() : verifierRoleRaw);
  const artistRoleRaw = getEnv('ARTIST_ROLE') ?? getEnv('ARTIST_ROLE_ID') ?? getEnv('ARTIST_ROLE_TAG');
  const artistRole = (typeof artistRoleRaw === 'string' ? artistRoleRaw.trim() : artistRoleRaw);
  const majorRoleRaw = getEnv('MAJOR_ROLE') ?? getEnv('MAJEUR_ROLE') ?? getEnv('MAJOR_ROLE_ID');
  const majorRole = (typeof majorRoleRaw === 'string' ? majorRoleRaw.trim() : majorRoleRaw);
  const minorRoleRaw = getEnv('MINOR_ROLE') ?? getEnv('MINEUR_ROLE') ?? getEnv('MINOR_ROLE_ID');
  const minorRole = (typeof minorRoleRaw === 'string' ? minorRoleRaw.trim() : minorRoleRaw);
  // Rôle à ping quand une vérification est postée (notifie le staff). Remplace la
  // valeur codée en dur de la V1 par une variable d'env, avec le même fallback.
  const notifyRoleId = getEnv('NOTIFY_ROLE_ID', '1440249794965541014');

  // --- Résolution générique d'une référence de rôle (ID, mention <@&ID> ou nom) ---
  function resolveRoleRef(guild, ref) {
    if (!ref || !guild) return null;
    const m = String(ref).match(/^<@&(\d+)>$/);
    if (m) return guild.roles.cache.get(m[1]);
    if (/^\d+$/.test(String(ref))) return guild.roles.cache.get(String(ref));
    return guild.roles.cache.find(r => r.name === ref);
  }

  // --- Choix de rôles proposés dans le select menu de validation staff ---
  const roleChoiceKeyToRef = { peluche: pelucheRole, major: majorRole, minor: minorRole, artist: artistRole };
  function buildRoleChoices() {
    const raw = getEnv('VERIF_ROLE_CHOICES');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed; // [{label,value,description?}]
      } catch (e) { /* ignore, use defaults below */ }
    }
    const choices = [];
    if (pelucheRole) choices.push({ label: 'Vérifié', value: 'peluche', description: 'Rôle principal de vérification', default: true });
    if (majorRole) choices.push({ label: 'Majeur', value: 'major' });
    if (minorRole) choices.push({ label: 'Mineur', value: 'minor' });
    if (artistRole) choices.push({ label: 'Artiste', value: 'artist' });
    return choices;
  }

  // --- Résolution du channel forum par ID ou nom ---
  async function resolveForumChannel() {
    if (!forumChannelId) return null;
    let forum = null;
    if (/^\d+$/.test(forumChannelId)) {
      forum = await client.channels.fetch(forumChannelId).catch(() => null);
    }
    if (!forum) {
      for (const [gid, g] of client.guilds.cache) {
        try {
          const ch = g.channels.cache.find(c => c.name === forumChannelId && c.type === ChannelType.GuildForum);
          if (ch) { forum = ch; break; }
        } catch (err) { /* ignore */ }
      }
    }
    return forum;
  }

  function isAuthorizedValidator(guild, member) {
    if (!member) return false;
    if (member.permissions && member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true;
    if (verifierRole) {
      const r = resolveRoleRef(guild, verifierRole);
      if (r && member.roles && member.roles.cache.has(r.id)) return true;
    }
    return false;
  }

  // ==========================================================================
  // 1) + 2) combinés : le select menu public de langue démarre directement la
  //    vérification (cooldown + rôle non-vérifié) ET ouvre le Modal — un seul
  //    geste pour l'utilisateur, aucun message intermédiaire en DM.
  // ==========================================================================
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isStringSelectMenu()) return;
      if (interaction.customId !== 'verif_lang_select') return;

      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: '⚠️ Cette action doit être utilisée depuis un serveur.', ephemeral: true }).catch(() => {});
        return;
      }
      const member = interaction.member;
      if (!member) {
        await interaction.reply({ content: '⚠️ Impossible de lancer la vérification (membre introuvable).', ephemeral: true }).catch(() => {});
        return;
      }

      const now = Date.now();
      const last = lastRequest.get(member.id) || 0;
      if (now - last < REQUEST_COOLDOWN_MS) {
        const remaining = Math.ceil((REQUEST_COOLDOWN_MS - (now - last)) / 1000);
        await interaction.reply({ content: `🔁 Tu as récemment demandé une vérification. Merci d'attendre **${remaining}s** avant de réessayer.`, ephemeral: true }).catch(() => {});
        return;
      }

      const memberId = member.id;
      const existing = store.verifications[memberId] || {};
      if (existing.status === 'cancelled') {
        await interaction.reply({ content: '⚠️ Cette vérification a été annulée par l\'équipe de modération.', ephemeral: true }).catch(() => {});
        return;
      }

      lastRequest.set(memberId, now);
      setTimeout(() => { try { lastRequest.delete(memberId); } catch (e) { /* ignore */ } }, REQUEST_COOLDOWN_MS + 1000);

      if (nonVerifiedRole) {
        const role = resolveRoleRef(guild, nonVerifiedRole);
        if (role) await member.roles.add(role).catch((err) => { logger.warn('Échec ajout nonVerifiedRole: ' + (err && err.message ? err.message : String(err)), { noTelegram: true }); });
      }

      const lang = resolveLang(interaction.values[0]);
      const t = i18n[lang];

      store.verifications[memberId] = Object.assign({}, existing, {
        lang,
        status: 'awaiting_modal',
        createdAt: existing.createdAt ?? Date.now(),
        updatedAt: Date.now()
      });
      saveStore();

      const modal = new ModalBuilder()
        .setCustomId(`verif_modal:${memberId}:${lang}`)
        .setTitle(t.modalTitle);

      for (const q of t.questions) {
        const input = new TextInputBuilder()
          .setCustomId(q.id)
          .setLabel(q.label)
          .setStyle(q.style === 'Paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(q.required !== false);
        if (q.maxLength) input.setMaxLength(q.maxLength);
        if (q.placeholder) input.setPlaceholder(q.placeholder);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      }

      await interaction.showModal(modal);
    } catch (err) {
      logger.error('Erreur verif_lang_select: ' + (err && err.message ? err.message : String(err)));
    }
  });

  // ==========================================================================
  // 3) Soumission du Modal -> DM (confirmation + récap) puis publication forum + Telegram
  // ==========================================================================
  function buildRoleSelectRow(memberId) {
    const choices = buildRoleChoices();
    if (!choices.length) return null;
    const select = new StringSelectMenuBuilder()
      .setCustomId(`verif_roles:${memberId}`)
      .setPlaceholder('Sélectionner les rôles à attribuer...')
      .setMinValues(0)
      .setMaxValues(choices.length)
      .addOptions(choices.map(c => ({ label: c.label, value: c.value, description: c.description, default: c.default === true })));
    return new ActionRowBuilder().addComponents(select);
  }

  function buildValidationButtonsRow(memberId) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`verif_validate:${memberId}`).setLabel('Valider').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`verif_reject:${memberId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`verif_cancel:${memberId}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
    );
  }

  async function postValidationComponents(thread, memberId, notifyMention) {
    const rows = [];
    const selectRow = buildRoleSelectRow(memberId);
    if (selectRow) rows.push(selectRow);
    const defaultKeys = buildRoleChoices().filter(c => c.default === true).map(c => c.value);
    if (defaultKeys.length) pendingRoleSelections.set(memberId, defaultKeys);
    rows.push(buildValidationButtonsRow(memberId));
    const content = [
      '## 🛡️ Validation de la vérification',
      notifyMention || null,
      '',
      '1️⃣ Sélectionne les rôles à attribuer dans le menu ci-dessous',
      '2️⃣ Clique sur **✅ Valider**, **❌ Refuser** ou **🚫 Annuler**'
    ].filter(Boolean).join('\n');
    try {
      return await thread.send({ content, components: rows });
    } catch (e) {
      logger.warn('Impossible de poster le message de validation: ' + (e && e.message ? e.message : String(e)));
      return null;
    }
  }

  async function publishVerification(guild, member, answers, lang) {
    try {
      if (!forumChannelId) {
        logger.warn('FORUM_CHANNEL_ID non défini, impossible de poster les réponses de vérification.');
        return;
      }
      const forum = await resolveForumChannel();
      if (!forum) {
        logger.warn('Impossible de récupérer le forum (FORUM_CHANNEL_ID incorrect ou le bot n\'est pas dans le serveur contenant ce channel)');
        return;
      }

      const existingVerif = store.verifications[member.id] || {};
      if (existingVerif.status === 'cancelled') {
        logger.info(`Vérification pour ${member.id} annulée avant publication; interruption.`, { noTelegram: true });
        return;
      }

      const title = member.user.username;
      const contentLines = [];
      const notifyMention = notifyRoleId ? `<@&${notifyRoleId}>` : '';
      contentLines.push(`## 🆕 Nouvelle demande de vérification`);
      contentLines.push(`👤 **Membre :** ${member.user.tag} (<@${member.id}>)\n🌐 **Langue :** ${lang.toUpperCase()}${notifyMention ? `\n🔔 ${notifyMention}` : ''}`);
      contentLines.push('---');
      for (const a of answers) contentLines.push(`### ❓ ${a.question}\n> ${String(a.answer).replace(/\n/g, '\n> ')}`);
      contentLines.push('*Meta: verification_member_id:' + member.id + '*');
      const postContent = contentLines.join('\n\n');

      let thread;
      try {
        const FIRST_CHUNK_MAX = 1900;
        let firstChunk = postContent;
        let remaining = '';
        if (postContent.length > FIRST_CHUNK_MAX) {
          firstChunk = postContent.slice(0, FIRST_CHUNK_MAX) + '\n\n*(Message tronqué — le reste a été posté séparément)*';
          remaining = postContent.slice(FIRST_CHUNK_MAX);
        }

        thread = await forum.threads.create({ name: title, autoArchiveDuration: 10080, message: { content: firstChunk } });
        logger.info(`Thread créé: id=${thread.id} name=${thread.name}`, { noTelegram: true });

        if (remaining) {
          await sendLong(thread, remaining).catch((e) => { logger.warn('sendLong thread a échoué: ' + (e && e.message ? e.message : String(e)), { noTelegram: true }); });
        }
      } catch (err) {
        logger.error('Erreur en créant le thread/forum post: ' + (err && err.message ? err.message : String(err)));
        return;
      }

      try { await thread.setTopic(`verification:${member.id}`); } catch (err) { /* ignore */ }

      const threadUrl = `https://discord.com/channels/${guild.id}/${thread.id}`;
      setImmediate(() => {
        try { telegram.enqueueVerification(buildTelegramSubmission(member, lang, answers, threadUrl)); } catch (e) { /* ignore */ }
      });

      const validationMsg = await postValidationComponents(thread, member.id, notifyMention);

      store.verifications[member.id] = Object.assign({}, store.verifications[member.id], {
        threadId: thread.id,
        channelId: forumChannelId,
        awaitingValidation: true,
        validationMessageId: validationMsg ? validationMsg.id : undefined,
        status: 'awaiting_validation',
        updatedAt: Date.now()
      });
      saveStore();
    } catch (err) {
      logger.error('Erreur dans publishVerification: ' + (err && err.message ? err.message : String(err)));
    }
  }

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isModalSubmit()) return;
      if (!interaction.customId.startsWith('verif_modal:')) return;
      const parts = interaction.customId.split(':');
      const memberId = parts[1];
      const lang = resolveLang(parts[2]);
      const t = i18n[lang];
      const guild = interaction.guild;

      const answers = t.questions.map(q => ({
        question: q.label,
        answer: interaction.fields.getTextInputValue(q.id) || 'Aucune réponse'
      }));

      await interaction.reply({ content: t.ephemeralConfirm, ephemeral: true }).catch(() => {});

      // Le DM ne sert plus qu'à confirmer la réception et récapituler les réponses envoyées.
      try {
        const dm = await interaction.user.createDM();
        const recapLines = [
          '## ✅ Vérification reçue',
          '',
          t.confirmationMessage,
          '',
          '### 📋 Récapitulatif de tes réponses',
          ...answers.map(a => `**❓ ${a.question}**\n> ${String(a.answer).replace(/\n/g, '\n> ')}`)
        ];
        await sendLong(dm, recapLines.join('\n\n')).catch((e) => {
          logger.warn('Envoi du récapitulatif DM échoué: ' + (e && e.message ? e.message : String(e)), { noTelegram: true });
        });
      } catch (e) {
        logger.warn(`Impossible d'envoyer le récapitulatif en DM à ${interaction.user.tag}: ` + (e && e.message ? e.message : String(e)), { noTelegram: true });
      }

      const existingVerif = store.verifications[memberId] || {};
      if (existingVerif.status === 'cancelled') {
        logger.info(`Vérification pour ${memberId} annulée avant publication; interruption.`, { noTelegram: true });
        return;
      }
      store.verifications[memberId] = Object.assign({}, existingVerif, { lang, answers, status: 'processing_publish', updatedAt: Date.now() });
      saveStore();

      if (!guild) {
        logger.warn(`Pas de contexte de guild disponible pour publier la vérification de ${memberId}.`);
        return;
      }
      const member = await guild.members.fetch(memberId).catch(() => null);
      if (!member) {
        logger.warn(`Membre ${memberId} introuvable sur la guild ${guild.id} pour publier la vérification.`);
        return;
      }

      await publishVerification(guild, member, answers, lang);
    } catch (err) {
      logger.error('Erreur verif_modal submit: ' + (err && err.message ? err.message : String(err)));
    }
  });

  // ==========================================================================
  // 4) Validation staff : select menu de rôles + boutons Valider/Refuser/Annuler
  // ==========================================================================
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isStringSelectMenu()) return;
      if (!interaction.customId.startsWith('verif_roles:')) return;
      const memberId = interaction.customId.split(':')[1];
      const guild = interaction.guild;
      if (!guild) return;
      if (!isAuthorizedValidator(guild, interaction.member)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à valider une vérification.", ephemeral: true }).catch(() => {});
        return;
      }
      pendingRoleSelections.set(memberId, interaction.values);
      await interaction.deferUpdate().catch(() => {});
    } catch (err) {
      logger.error('Erreur verif_roles select: ' + (err && err.message ? err.message : String(err)));
    }
  });

  // Bouton Valider
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      if (!interaction.customId.startsWith('verif_validate:')) return;
      const memberId = interaction.customId.split(':')[1];
      const guild = interaction.guild;
      const channel = interaction.channel;
      if (!guild) return;
      if (!isAuthorizedValidator(guild, interaction.member)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à valider une vérification.", ephemeral: true }).catch(() => {});
        return;
      }

      const existing = store.verifications[memberId] || {};
      if (existing.status === 'cancelled') {
        await interaction.reply({ content: 'Cette vérification a été annulée et ne peut pas être acceptée.', ephemeral: true }).catch(() => {});
        return;
      }
      if (existing.status === 'accepted' || existing.status === 'processing_accept') {
        await interaction.reply({ content: 'Cette vérification est déjà en cours ou a déjà été traitée.', ephemeral: true }).catch(() => {});
        return;
      }
      store.verifications[memberId] = Object.assign({}, existing, { status: 'processing_accept', awaitingValidation: false, updatedAt: Date.now() });
      saveStore();

      await interaction.deferUpdate().catch(() => {});

      const target = await guild.members.fetch(memberId).catch(() => null);
      if (!target) { await channel.send('Membre visé introuvable sur le serveur.').catch(() => {}); return; }

      const selectedKeys = pendingRoleSelections.get(memberId) || [];
      pendingRoleSelections.delete(memberId);

      const appliedRoles = [];

      if (nonVerifiedRole) {
        const r = resolveRoleRef(guild, nonVerifiedRole);
        if (r) {
          const ok = await tryRoleOperation(() => target.roles.remove(r), `retirer le rôle ${r.id} à ${target.id}`, channel);
          if (ok) logger.info(`Rôle non-vérifié retiré: role=${r.id} target=${target.id} guild=${guild.id} by=${interaction.user.id}`, { noTelegram: true });
        }
      }

      for (const key of selectedKeys) {
        const roleRef = roleChoiceKeyToRef[key] ?? key; // supporte aussi les choix custom VERIF_ROLE_CHOICES dont value = ID/mention/nom direct
        const r = resolveRoleRef(guild, roleRef);
        if (!r) { logger.warn(`Rôle "${key}" introuvable sur la guild ${guild.id}.`, { noTelegram: true }); continue; }
        const ok = await tryRoleOperation(() => target.roles.add(r), `ajouter le rôle ${r.id} à ${target.id}`, channel);
        if (ok) {
          appliedRoles.push(r.name);
          logger.info(`Rôle appliqué: role=${r.id} target=${target.id} guild=${guild.id} by=${interaction.user.id}`, { noTelegram: true });
        }
      }

      const lang = resolveLang((store.verifications[memberId] || {}).lang);
      const t = i18n[lang];
      try { await target.send(t.acceptedDM(guild.name)); } catch (e) { /* ignore DM failure */ }

      const summary = appliedRoles.length ? appliedRoles.join(', ') : 'aucun rôle supplémentaire';
      await channel.send(`✅ Vérification acceptée par <@${interaction.user.id}> — rôles appliqués à <@${target.id}> : ${summary}`).catch(() => {});

      try { await interaction.message.edit({ components: [] }); } catch (e) { /* ignore */ }

      store.verifications[memberId] = Object.assign({}, store.verifications[memberId], { status: 'accepted', acceptedAt: Date.now(), appliedRoles, updatedAt: Date.now() });
      saveStore();

      setImmediate(() => {
        try { telegram.enqueueVerification(buildTelegramDecision('✅', 'VÉRIFICATION ACCEPTÉE', target, interaction.user, { '🏷️ Rôles appliqués': summary })); } catch (e) { /* ignore */ }
      });
    } catch (err) {
      logger.error('Erreur verif_validate: ' + (err && err.message ? err.message : String(err)));
    }
  });

  // Bouton Refuser -> Modal de raison
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      if (!interaction.customId.startsWith('verif_reject:')) return;
      const memberId = interaction.customId.split(':')[1];
      const guild = interaction.guild;
      if (!guild) return;
      if (!isAuthorizedValidator(guild, interaction.member)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à refuser une vérification.", ephemeral: true }).catch(() => {});
        return;
      }
      const existing = store.verifications[memberId] || {};
      if (existing.status === 'cancelled') {
        await interaction.reply({ content: 'Cette vérification a déjà été annulée.', ephemeral: true }).catch(() => {});
        return;
      }

      const t = i18n[resolveLang(existing.lang)];
      const modal = new ModalBuilder()
        .setCustomId(`verif_reject_modal:${memberId}`)
        .setTitle(t.rejectModalTitle)
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel(t.reasonLabel)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder(t.reasonPlaceholder)
            .setMaxLength(1000)
        ));
      await interaction.showModal(modal);
    } catch (err) {
      logger.error('Erreur verif_reject button: ' + (err && err.message ? err.message : String(err)));
    }
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isModalSubmit()) return;
      if (!interaction.customId.startsWith('verif_reject_modal:')) return;
      const memberId = interaction.customId.split(':')[1];
      const guild = interaction.guild;
      const reason = interaction.fields.getTextInputValue('reason');

      const existing = store.verifications[memberId] || {};
      store.verifications[memberId] = Object.assign({}, existing, { status: 'rejected', awaitingValidation: false, rejectedAt: Date.now(), rejectedBy: interaction.user.id, rejectReason: reason, updatedAt: Date.now() });
      saveStore();

      const target = guild ? await guild.members.fetch(memberId).catch(() => null) : null;
      const t = i18n[resolveLang(existing.lang)];
      if (target && guild) { try { await target.send(t.rejectedDM(guild.name, reason)); } catch (e) { /* ignore */ } }

      await interaction.reply({ content: `Refus enregistré par <@${interaction.user.id}> et transmis au membre.` }).catch(() => {});
      try { if (interaction.message) await interaction.message.edit({ components: [] }); } catch (e) { /* ignore */ }

      setImmediate(() => {
        try { telegram.enqueueVerification(buildTelegramDecision('❌', 'VÉRIFICATION REFUSÉE', target, interaction.user, { '📝 Raison': reason })); } catch (e) { /* ignore */ }
      });
    } catch (err) {
      logger.error('Erreur verif_reject_modal submit: ' + (err && err.message ? err.message : String(err)));
    }
  });

  // Bouton Annuler -> Modal de raison, retire tous les rôles
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      if (!interaction.customId.startsWith('verif_cancel:')) return;
      const memberId = interaction.customId.split(':')[1];
      const guild = interaction.guild;
      if (!guild) return;
      if (!isAuthorizedValidator(guild, interaction.member)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à annuler une vérification.", ephemeral: true }).catch(() => {});
        return;
      }
      const existing = store.verifications[memberId] || {};
      const t = i18n[resolveLang(existing.lang)];
      const modal = new ModalBuilder()
        .setCustomId(`verif_cancel_modal:${memberId}`)
        .setTitle(t.cancelModalTitle)
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel(t.reasonLabel)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder(t.reasonPlaceholder)
            .setMaxLength(1000)
        ));
      await interaction.showModal(modal);
    } catch (err) {
      logger.error('Erreur verif_cancel button: ' + (err && err.message ? err.message : String(err)));
    }
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isModalSubmit()) return;
      if (!interaction.customId.startsWith('verif_cancel_modal:')) return;
      const memberId = interaction.customId.split(':')[1];
      const guild = interaction.guild;
      const channel = interaction.channel;
      const reason = interaction.fields.getTextInputValue('reason');

      const target = guild ? await guild.members.fetch(memberId).catch(() => null) : null;

      if (target && guild) {
        const ok = await tryRoleOperation(() => target.roles.set([]), `retirer tous les rôles à ${target.id}`, channel);
        if (!ok) {
          try {
            const roleIds = target.roles.cache.map(r => r.id).filter(id => id && id !== guild.id);
            for (const rid of roleIds) {
              const rObj = guild.roles.cache.get(rid);
              if (rObj) await tryRoleOperation(() => target.roles.remove(rObj), `retirer le rôle ${rObj.id} à ${target.id}`, channel);
            }
          } catch (e) { /* ignore */ }
        }
        if (nonVerifiedRole) {
          const r = resolveRoleRef(guild, nonVerifiedRole);
          if (r) {
            const ok2 = await tryRoleOperation(() => target.roles.add(r), `ajouter le rôle non-vérifié ${r.id} à ${target.id}`, channel);
            if (ok2) logger.info(`Rôle non-vérifié ré-appliqué après annulation: ${r.id} target=${target.id} by=${interaction.user.id}`, { noTelegram: true });
          }
        }
      }

      const existing = store.verifications[memberId] || {};
      const t = i18n[resolveLang(existing.lang)];
      if (target && guild) { try { await target.send(t.cancelledDM(guild.name, reason)); } catch (e) { /* ignore */ } }

      store.verifications[memberId] = Object.assign({}, existing, { status: 'cancelled', awaitingValidation: false, cancelledAt: Date.now(), cancelledBy: interaction.user.id, cancelledReason: reason, updatedAt: Date.now() });
      saveStore();

      await interaction.reply({ content: `✅ Vérification annulée par <@${interaction.user.id}> et raison transmise au membre.` }).catch(() => {});
      try { if (interaction.message) await interaction.message.edit({ components: [] }); } catch (e) { /* ignore */ }

      setImmediate(() => {
        try { telegram.enqueueVerification(buildTelegramDecision('🚫', 'VÉRIFICATION ANNULÉE', target, interaction.user, { '📝 Raison': reason })); } catch (e) { /* ignore */ }
      });
    } catch (err) {
      logger.error('Erreur verif_cancel_modal submit: ' + (err && err.message ? err.message : String(err)));
    }
  });
}
