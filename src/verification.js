/*
 * Peluche Bot — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

import { PermissionsBitField, ChannelType } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import telegram from './telegram.js';

const DEFAULT_QUESTIONS = [
  "Bonjour ! Peux-tu te présenter en quelques lignes ?",
  "Quel âge as-tu ?",
  "D'où viens-tu (pays / région) ?",
  "As-tu lu et accepté les règles du serveur ?"
];

function getEnv(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

export function initVerification(client) {
  // --- persistence simple (fichier JSON) pour garder le mapping memberId -> threadId
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
        logger.warn(`Tentative ${attempt} échouée pour ${contextMsg}: ${msg}`);
        if (attempt < maxAttempts && isTransient) {
          const wait = delays[attempt - 1] || 1000;
          logger.info(`Réessayer ${contextMsg} dans ${wait}ms (attempt ${attempt + 1}/${maxAttempts})`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        // Non-transient or last attempt: log and notify channel if provided
        logger.error(`Echec définitif de ${contextMsg}: ${msg}`);
        if (channel) {
          // Try to provide additional diagnostic info: bot's highest role and target role position (if role id present in contextMsg)
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
  const nonVerifiedRoleRaw = getEnv('NON_VERIFIED_ROLE'); // name or id
  const nonVerifiedRole = (typeof nonVerifiedRoleRaw === 'string' ? nonVerifiedRoleRaw.trim() : nonVerifiedRoleRaw);
  const pelucheRoleRaw = getEnv('PELUCHER_ROLE') ?? getEnv('PELUCHES_ROLE') ?? getEnv('PELUCHER');
  const pelucheRole = (typeof pelucheRoleRaw === 'string' ? pelucheRoleRaw.trim() : pelucheRoleRaw);
  const verifierRoleRaw = getEnv('VERIFIER_ROLE'); // optional role allowed to validate
  const verifierRole = (typeof verifierRoleRaw === 'string' ? verifierRoleRaw.trim() : verifierRoleRaw);
  // Role optionnel "artiste": peut être un ID, un nom, ou une mention <@&ID>
  const artistRoleRaw = getEnv('ARTIST_ROLE') ?? getEnv('ARTIST_ROLE_ID') ?? getEnv('ARTIST_ROLE_TAG');
  const artistRole = (typeof artistRoleRaw === 'string' ? artistRoleRaw.trim() : artistRoleRaw);
  // Roles pour majeur / mineur (fonctions) — acceptez ID, nom ou mention <@&ID>
  const majorRoleRaw = getEnv('MAJOR_ROLE') ?? getEnv('MAJEUR_ROLE') ?? getEnv('MAJOR_ROLE_ID');
  const majorRole = (typeof majorRoleRaw === 'string' ? majorRoleRaw.trim() : majorRoleRaw);
  const minorRoleRaw = getEnv('MINOR_ROLE') ?? getEnv('MINEUR_ROLE') ?? getEnv('MINOR_ROLE_ID');
  const minorRole = (typeof minorRoleRaw === 'string' ? minorRoleRaw.trim() : minorRoleRaw);
  // Role ID to ping when a verification post is created (will notify staff)
  // Remplacez par l'ID souhaité ou mettez en variable d'environnement si nécessaire.
  const notifyRoleId = '1440249794965541014';
  const questionsEnv = getEnv('QUESTIONS');
  // VERIF_MESSAGE_MD can be used to define a full markdown message sent to the user.
  // For convenience, QUESTIONS can now be used as an alias for VERIF_MESSAGE_MD (markdown string),
  // or as a JSON array of questions (backwards compatibility).
  let verifMessageMd = getEnv('VERIF_MESSAGE_MD');
  let questions = DEFAULT_QUESTIONS;
  if (questionsEnv) {
    // Try to parse as JSON array first
    try {
      const parsed = JSON.parse(questionsEnv);
      if (Array.isArray(parsed) && parsed.length > 0) {
        questions = parsed;
      }
    } catch (err) {
      // Not JSON — treat QUESTIONS as markdown message (alias)
      verifMessageMd = questionsEnv;
      // In that mode we won't use the per-question flow
      questions = [];
    }
  }

  // fonction réutilisable qui effectue la logique de vérification (DM + publication forum)
  async function runVerificationForMember(member) {
    try {
      logger.info(`Lancement vérification pour: ${member.user?.tag ?? member.id}`);

      // Optionnel: ajouter le rôle non vérifié si fourni
      if (nonVerifiedRole && member.roles) {
        const role = member.guild.roles.cache.get(nonVerifiedRole) || member.guild.roles.cache.find(r => r.name === nonVerifiedRole);
        if (role) await member.roles.add(role).catch((err) => { logger.error('Échec ajout nonVerifiedRole: ' + (err && err.message ? err.message : String(err))); });
      }

      // Ouvrir DM
      let dm;
      try {
        dm = await member.createDM();
      } catch (err) {
        logger.warn(`Impossible d'ouvrir un DM à ${member.user?.tag ?? member.id}`);
      }

      const answers = [];
      if (dm) {
        // Si un message markdown complet est défini dans .env, on l'envoie et on collecte les réponses libres
        if (verifMessageMd) {
          // Envoyer le message markdown configuré
          await dm.send({ content: verifMessageMd }).catch(() => {});
          await dm.send("Merci : réponds à ces questions dans ce DM. Tape `done` quand tu as fini (ou attends 5 minutes).\nRéponds en un ou plusieurs messages.").catch(() => {});

          // Collecter les messages jusqu'à `done` ou timeout
          const collectedMsgs = [];
          const collector = dm.createMessageCollector({ filter: m => m.author.id === member.id, time: 5 * 60 * 1000 });
          collector.on('collect', m => {
            if (m.content && m.content.toLowerCase().trim() === 'done') {
              collector.stop('done');
            } else {
              collectedMsgs.push(m.content);
            }
          });
          // attendre la fin et récupérer la raison (ex: 'time' ou 'done')
          const endInfo = await new Promise(resolve => collector.on('end', (collected, reason) => resolve({ collected, reason })));
          const reason = endInfo && endInfo.reason ? endInfo.reason : undefined;

          const combined = collectedMsgs.length ? collectedMsgs.join('\n\n') : 'Aucune réponse';
          answers.push({ question: 'Réponses', answer: combined });

          // Si l'utilisateur a explicitement envoyé 'done', envoyer une confirmation en DM
          // et tenter de retirer les réactions existantes (✅ / ❌) sur un thread de verification déjà enregistré.
          if (reason === 'done') {
            try {
              await dm.send("Votre vérification a bien été reçue et sera bientôt traitée.").catch(() => {});
            } catch (e) { /* ignore */ }

            // Si une vérification précédente existe dans le store pour ce membre, retirer les réactions sur le starter message
            try {
              const existing = store.verifications[member.id];
              if (existing && existing.threadId && existing.channelId) {
                let forumChan = null;
                if (/^\d+$/.test(existing.channelId)) {
                  forumChan = await client.channels.fetch(existing.channelId).catch(() => null);
                }
                if (!forumChan) {
                  for (const [gid, g] of client.guilds.cache) {
                    try {
                      const ch = g.channels.cache.get(existing.channelId) || g.channels.cache.find(c => c.name === existing.channelId && c.type === ChannelType.GuildForum);
                      if (ch) { forumChan = ch; break; }
                    } catch (err) { /* ignore */ }
                  }
                }
                if (forumChan && forumChan.threads) {
                  const thread = await forumChan.threads.fetch(existing.threadId).catch(() => null);
                  if (thread) {
                    const starter = await thread.fetchStarterMessage().catch(() => null);
                    if (starter && starter.reactions) {
                      // Retirer toutes les réactions pour éviter un double-traitement visuel
                      await starter.reactions.removeAll().catch(() => {});
                    }
                  }
                }
              }
            } catch (err) {
              logger.warn('Impossible de retirer les réactions existantes: ' + (err && err.message ? err.message : String(err)));
            }
          }
        } else {
          // Mode ancien : poser une question par question
          await dm.send(`Bonjour ${member.user.username} ! Voici le message de vérification — merci d'y répondre.`).catch(() => {});
          for (const q of questions) {
            await dm.send(q).catch(() => {});
            try {
              const collected = await dm.awaitMessages({ filter: m => m.author.id === member.id, max: 1, time: 5 * 60 * 1000, errors: ['time'] });
              const reply = collected.first();
              answers.push({ question: q, answer: reply ? reply.content : 'Aucune réponse' });
            } catch (err) {
              answers.push({ question: q, answer: 'Pas de réponse (temps écoulé)' });
            }
          }
        }
      } else {
        for (const q of questions) answers.push({ question: q, answer: 'Pas de réponse (DM fermé)' });
      }

      // Publier dans le forum
      if (!forumChannelId) {
        logger.warn('FORUM_CHANNEL_ID non défini, impossible de poster les réponses de vérification.');
        return;
      }

      // Résoudre le channel : on accepte soit un ID soit un nom de channel (recherche dans les guilds)
      let forum = null;
      // si forumChannelId ressemble à un ID (chiffres), tenter fetch direct
      if (/^\d+$/.test(forumChannelId)) {
        forum = await client.channels.fetch(forumChannelId).catch(() => null);
      }
      // si pas trouvé par ID, chercher par nom parmi les guilds du bot
      if (!forum) {
        for (const [gid, g] of client.guilds.cache) {
          try {
            const ch = g.channels.cache.find(c => c.name === forumChannelId && c.type === ChannelType.GuildForum);
            if (ch) { forum = ch; break; }
          } catch (err) { /* ignore */ }
        }
      }

      if (!forum) {
        logger.warn('Impossible de récupérer le forum (FORUM_CHANNEL_ID incorrect ou le bot n\'est pas dans le serveur contenant ce channel)');
        return;
      }
  const title = `${member.user.username}`;
  const contentLines = [];
  // Ping the notify role so staff are alerted to the new verification
  const notifyMention = notifyRoleId ? `<@&${notifyRoleId}>` : '';
  contentLines.push(`Nouvelle demande de vérification pour: **${member.user.tag}** (<@${member.id}>) Accepter : oui/non ${notifyMention}`);
      contentLines.push('---');
      for (const a of answers) contentLines.push(`**${a.question}**\n${a.answer}`);
      contentLines.push('\n\n*Meta: verification_member_id:' + member.id + '*');
      const postContent = contentLines.join('\n\n');

      let thread;
      try {
        thread = await forum.threads.create({ name: title, autoArchiveDuration: 10080, message: { content: postContent } });
      } catch (err) {
        logger.error('Erreur en créant le thread/forum post: ' + (err && err.message ? err.message : String(err)));
        return;
      }

      // Send verification content to Telegram (best-effort)
      try {
        const tgText = `Nouvelle vérification pour ${member.user.tag} (${member.id})\n\n` + contentLines.join('\n\n');
        setImmediate(() => { try { telegram.enqueueVerification(tgText); } catch (e) { /* ignore */ } });
      } catch (e) { /* ignore */ }

      try { await thread.setTopic(`verification:${member.id}`); } catch (err) {}
      try {
        // Envoyer un message dans le fil pour solliciter la validation du staff (pas de réactions automatiques)
        const question = `${notifyMention} Gardiens de la porte — validez-vous cette vérification ? (oui / non)`;
        // Utiliser thread.send pour poster dans le thread et conserver l'ID du message de validation
        var validationMsg = null;
        try {
          validationMsg = await thread.send({ content: question });
        } catch (e) { /* ignore send errors */ }
      } catch (err) {}

      // Persister la relation membre -> thread pour retrouver après redémarrage
      try {
        store.verifications[member.id] = { threadId: thread.id, channelId: forumChannelId, createdAt: Date.now(), awaitingValidation: true, validationMessageId: validationMsg ? validationMsg.id : undefined };
        saveStore();
      } catch (err) {
        logger.warn('Impossible de persister la vérification: ' + (err && err.message ? err.message : String(err)));
      }

    } catch (err) {
      logger.error('Erreur dans runVerificationForMember: ' + (err && err.message ? err.message : String(err)));
    }
  }

  // Helper: accepter une vérification (utilisé par réactions et messages 'oui')
  async function handleAccept(guild, channel, moderatorUser, targetId) {
    try {
      // Prevent double-processing: check persisted store for status
      try {
        const existing = store.verifications[targetId] || {};
        if (existing.status === 'processing' || existing.status === 'accepted') {
          await channel.send(`Cette vérification est déjà en cours ou a déjà été traitée.`).catch(() => {});
          return;
        }
        // mark as processing early to avoid race between reaction and message handlers
        // also clear awaitingValidation so subsequent messages in the thread (age/artiste prompts)
        // are not interpreted as a fresh global accept/reject
        store.verifications[targetId] = Object.assign({}, existing, { status: 'processing', updatedAt: Date.now(), awaitingValidation: false });
        saveStore();
      } catch (e) { /* ignore store errors */ }

      const target = await guild.members.fetch(targetId).catch(() => null);
      if (!target) { await channel.send(`Membre visé introuvable sur le serveur.`).catch(() => {}); return; }

      // Retirer NON_VERIFIED_ROLE si configuré
      if (nonVerifiedRole) {
        const r = guild.roles.cache.get(nonVerifiedRole) || guild.roles.cache.find(x => x.name === nonVerifiedRole);
        if (r) {
          logger.debug(`Tentative suppression du rôle non-vérifié (${r.id || r.name}) pour membre ${target.id} sur guild ${guild.id} (par ${moderatorUser.id})`);
          const ok = await tryRoleOperation(() => target.roles.remove(r), `retirer le rôle ${r.id || r.name} à ${target.id}`, channel);
          if (ok) logger.info(`Rôle non-vérifié retiré: role=${r.id || r.name} target=${target.id} guild=${guild.id} by=${moderatorUser.id}`);
        } else {
          logger.warn(`nonVerifiedRole configuré mais introuvable sur la guild: ${nonVerifiedRole} (guild=${guild.id})`);
        }
      }

      // Ajouter PELUCHER_ROLE si configuré
      if (pelucheRole) {
        const r2 = guild.roles.cache.get(pelucheRole) || guild.roles.cache.find(x => x.name === pelucheRole);
        if (r2) {
          logger.debug(`Tentative ajout du rôle peluche (${r2.id || r2.name}) pour membre ${target.id} sur guild ${guild.id} (par ${moderatorUser.id})`);
          const ok2 = await tryRoleOperation(() => target.roles.add(r2), `ajouter le rôle ${r2.id || r2.name} à ${target.id}`, channel);
          if (ok2) logger.info(`Rôle peluche appliqué: role=${r2.id || r2.name} target=${target.id} guild=${guild.id} by=${moderatorUser.id}`);
        } else {
          logger.warn(`pelucheRole configuré mais introuvable sur la guild: ${pelucheRole} (guild=${guild.id})`);
        }
      }

      // artist prompt removed from here; it will be asked after confirmation and age-role flow

      try { await target.send(`Félicitations — votre vérification a été acceptée sur ${guild.name}. Vous avez reçu le rôle.`).catch(() => {}); } catch (err) {}
      await channel.send(`✅ Vérification acceptée par <@${moderatorUser.id}> — rôle appliqué à <@${target.id}>.`).catch(() => {});

      // Après confirmation: demander majeur/mineur puis proposer le rôle artiste
      try {
        const moderatorId = moderatorUser && moderatorUser.id ? moderatorUser.id : moderatorUser;
        const appliedRoles = [];
        // If peluche role was applied earlier, record it for summary
        try {
          const pRole = guild.roles.cache.get(pelucheRole) || guild.roles.cache.find(x => x.name === pelucheRole);
          if (pRole && target.roles.cache.has(pRole.id)) appliedRoles.push(pRole.name || pRole.id);
        } catch (e) { /* ignore */ }

        // 1) question majeur / mineur
        if (majorRole || minorRole) {
          try {
            await channel.send(`<@${moderatorId}> Le membre est-il **majeur** ou **mineur** ? (majeur / mineur)`).catch(() => {});
            const filterAge = m => m.author.id === moderatorId && /^(?:majeur|mineur|major|minor)$/i.test((m.content || '').trim());
            const collectedAge = await channel.awaitMessages({ filter: filterAge, max: 1, time: 5 * 60 * 1000 }).catch(() => null);
            if (collectedAge && collectedAge.size > 0) {
              const ans = collectedAge.first().content.trim().toLowerCase();
              if (/^majeur|^major/i.test(ans)) {
                // give majorRole if configured
                if (majorRole) {
                  let rMajor = null;
                  const mm = majorRole.match(/^<@&(\d+)>$/);
                  if (mm) rMajor = guild.roles.cache.get(mm[1]);
                  if (!rMajor && /^\d+$/.test(majorRole)) rMajor = guild.roles.cache.get(majorRole);
                  if (!rMajor) rMajor = guild.roles.cache.find(x => x.name === majorRole);
                  if (rMajor) {
                    const okM = await tryRoleOperation(() => target.roles.add(rMajor), `ajouter le rôle ${rMajor.id || rMajor.name} à ${target.id}`, channel);
                    if (okM) {
                      appliedRoles.push(rMajor.name || rMajor.id);
                      setImmediate(() => { try { telegram.enqueueVerification(`✅ Rôle majeur appliqué à ${target.user ? target.user.tag : target.id} (${target.id}) par ${moderatorUser.tag ? moderatorUser.tag : moderatorUser.id}`); } catch (e) {} });
                      logger.info(`Rôle majeur appliqué: role=${rMajor.id || rMajor.name} target=${target.id} guild=${guild.id} by=${moderatorId}`);
                    }
                  } else {
                    await channel.send('Rôle majeur introuvable sur la guild (vérifiez MAJOR_ROLE dans .env).').catch(() => {});
                  }
                }
              } else if (/^mineur|^minor/i.test(ans)) {
                if (minorRole) {
                  let rMinor = null;
                  const mm2 = minorRole.match(/^<@&(\d+)>$/);
                  if (mm2) rMinor = guild.roles.cache.get(mm2[1]);
                  if (!rMinor && /^\d+$/.test(minorRole)) rMinor = guild.roles.cache.get(minorRole);
                  if (!rMinor) rMinor = guild.roles.cache.find(x => x.name === minorRole);
                  if (rMinor) {
                    const okm = await tryRoleOperation(() => target.roles.add(rMinor), `ajouter le rôle ${rMinor.id || rMinor.name} à ${target.id}`, channel);
                    if (okm) {
                      appliedRoles.push(rMinor.name || rMinor.id);
                      setImmediate(() => { try { telegram.enqueueVerification(`✅ Rôle mineur appliqué à ${target.user ? target.user.tag : target.id} (${target.id}) par ${moderatorUser.tag ? moderatorUser.tag : moderatorUser.id}`); } catch (e) {} });
                      logger.info(`Rôle mineur appliqué: role=${rMinor.id || rMinor.name} target=${target.id} guild=${guild.id} by=${moderatorId}`);
                    }
                  } else {
                    await channel.send('Rôle mineur introuvable sur la guild (vérifiez MINOR_ROLE dans .env).').catch(() => {});
                  }
                }
              }
            } else {
              await channel.send('Pas de réponse — rôle d\'âge non attribué.').catch(() => {});
            }
          } catch (e) { logger.warn('Erreur lors de la question majeur/mineur: ' + (e && e.message ? e.message : String(e))); }
        }

        // 2) question artiste (après avoir donné le rôle peluche)
        if (artistRole) {
          try {
            await channel.send(`<@${moderatorId}> Voulez-vous attribuer le rôle \"artiste\" à <@${target.id}> ? (oui / non)`).catch(() => {});
            const filter = m => m.author.id === moderatorId && /^(?:oui|o|yes|y|non|n|no)$/i.test((m.content || '').trim());
            const collected = await channel.awaitMessages({ filter, max: 1, time: 5 * 60 * 1000 }).catch(() => null);
            if (!collected || collected.size === 0) {
              await channel.send('Pas de réponse — pas d\'attribution du rôle "artiste".').catch(() => {});
            } else {
              const reply = collected.first().content.trim().toLowerCase();
              const giveArtist = /^(?:oui|o|yes|y)/i.test(reply);
              if (!giveArtist) {
                await channel.send('OK — pas de rôle artiste.').catch(() => {});
              } else {
                // Résoudre le rôle artiste: accepter ID, mention <@&ID> ou nom
                let r3 = null;
                const m = artistRole.match(/^<@&(\d+)>$/);
                if (m) r3 = guild.roles.cache.get(m[1]);
                if (!r3 && /^\d+$/.test(artistRole)) r3 = guild.roles.cache.get(artistRole);
                if (!r3) r3 = guild.roles.cache.find(x => x.name === artistRole);
                if (!r3) {
                  await channel.send('Rôle "artiste" introuvable sur la guild (vérifiez ARTIST_ROLE dans .env).').catch(() => {});
                } else {
                  const ok3 = await tryRoleOperation(() => target.roles.add(r3), `ajouter le rôle ${r3.id || r3.name} à ${target.id}`, channel);
                  if (ok3) {
                    appliedRoles.push(r3.name || r3.id);
                    await channel.send(`Rôle "${r3.name}" attribué à <@${target.id}>.`).catch(() => {});
                    logger.info(`Rôle artiste appliqué: role=${r3.id || r3.name} target=${target.id} guild=${guild.id} by=${moderatorId}`);
                    setImmediate(() => { try { telegram.enqueueVerification(`✅ Rôle artiste appliqué à ${target.user ? target.user.tag : target.id} (${target.id}) par ${moderatorUser.tag ? moderatorUser.tag : moderatorUser.id}`); } catch (e) {} });
                  }
                }
              }
            }
          } catch (err) { logger.warn('Erreur lors de la question d\'attribution du rôle artiste: ' + (err && err.message ? err.message : String(err))); }
        }

        // Final summary
        try {
          const summary = appliedRoles.length ? appliedRoles.join(', ') : 'aucun rôle supplémentaire';
          await channel.send(`Vérification terminée — rôles appliqués pour <@${target.id}> : ${summary}`).catch(() => {});
          setImmediate(() => { try { telegram.enqueueVerification(`✅ Vérification terminée pour ${target.user ? target.user.tag : target.id} (${target.id}). Rôles appliqués: ${summary}`); } catch (e) {} });
        } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
      // Mark as accepted in store
      try {
        const existing2 = store.verifications[targetId] || {};
        store.verifications[targetId] = Object.assign({}, existing2, { status: 'accepted', acceptedAt: Date.now() });
        saveStore();
      } catch (e) { /* ignore */ }
      // Notify Telegram about acceptance
      try {
        const tg = `✅ Vérification ACCEPTÉE\nMembre: ${target.user ? target.user.tag : target.id} (${target.id})\nPar: ${moderatorUser.tag ? moderatorUser.tag : moderatorUser.id} (${moderatorUser.id})\nGuild: ${guild.id}`;
        setImmediate(() => { try { telegram.enqueueVerification(tg); } catch (e) { /* ignore */ } });
      } catch (e) { /* ignore */ }
    } catch (err) {
      logger.error('Erreur dans handleAccept: ' + (err && err.message ? err.message : String(err)));
      logger.debug(err && err.stack ? err.stack : String(err));
      await channel.send(`Erreur lors de l'application des rôles.`).catch(() => {});
    }
  }

  // Helper: refuser une vérification (utilisé par réactions et messages 'non')
  async function handleReject(guild, channel, moderatorUser, targetId) {
    try {
      // Ensure we don't re-trigger validation handlers for subsequent messages
      try {
        const existing = store.verifications[targetId] || {};
        store.verifications[targetId] = Object.assign({}, existing, { awaitingValidation: false });
        saveStore();
      } catch (e) { /* ignore store errors */ }

      const target = await guild.members.fetch(targetId).catch(() => null);
      if (!target) { await channel.send(`Membre visé introuvable sur le serveur.`).catch(() => {}); return; }

      await channel.send(`<@${moderatorUser.id}> Merci de fournir une justification du refus en répondant dans ce fil. Vous avez 30 minutes.`).catch(() => {});
      const filter = m => m.author.id === moderatorUser.id;
      const collector = channel.createMessageCollector({ filter, max: 1, time: 30 * 60 * 1000 });
      collector.on('collect', async (m) => {
        const justification = m.content;
        try {
          await target.send(`Votre vérification a été refusée sur ${guild.name}. Raison donnée par l'équipe :\n\n${justification}`).catch(() => {});
          await channel.send(`Refus enregistré par <@${moderatorUser.id}> et transmis au membre.`).catch(() => {});
          // Notify Telegram about rejection and justification
          try {
            const tg = `❌ Vérification REFUSÉE\nMembre: ${target.user ? target.user.tag : target.id} (${target.id})\nPar: ${moderatorUser.tag ? moderatorUser.tag : moderatorUser.id} (${moderatorUser.id})\nRaison: ${justification}`;
            setImmediate(() => { try { telegram.enqueueVerification(tg); } catch (e) { /* ignore */ } });
          } catch (e) { /* ignore */ }
        } catch (err) { await channel.send(`Impossible d'envoyer la justification au membre (DM peut être fermé).`).catch(() => {}); }
      });
    } catch (err) {
      logger.error('Erreur dans handleReject: ' + (err && err.message ? err.message : String(err)));
    }
  }

  // Lorsqu'un membre arrive
  client.on('guildMemberAdd', async (member) => {
    await runVerificationForMember(member);
  });

  // Gestion des réactions (accepter/refuser)
  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch().catch(() => {});
      const message = reaction.message;
      const channel = message.channel;
      const guild = message.guild;
      if (!guild) return;

      const emoji = reaction.emoji.name;
      if (emoji !== '✅' && emoji !== '❌') return;

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      let allowed = false;
      if (member.permissions && member.permissions.has(PermissionsBitField.Flags.ManageGuild)) allowed = true;
      if (verifierRole) {
        const r = guild.roles.cache.get(verifierRole) || guild.roles.cache.find(x => x.name === verifierRole);
        if (r && member.roles.cache.has(r.id)) allowed = true;
      }
      if (!allowed) return;

      let targetId = null;
      if (channel?.isThread()) {
        const topic = channel.topic ?? '';
        const m = topic.match(/verification:(\d+)/);
        if (m) targetId = m[1];
      }
      if (!targetId) {
        const m = message.content.match(/verification_member_id:(\d+)/);
        if (m) targetId = m[1];
      }
      if (!targetId) {
        const mention = message.mentions.users.first();
        if (mention) targetId = mention.id;
      }
      if (!targetId) { await channel.send(`Impossible de retrouver l'identité du membre à vérifier.`).catch(() => {}); return; }

      const target = await guild.members.fetch(targetId).catch(() => null);
      if (!target) { await channel.send(`Membre visé introuvable sur le serveur.`).catch(() => {}); return; }

      // Only consider reactions for initial validation if this thread is still awaiting validation
      try {
        const ver = store.verifications[targetId] || {};
        if (!ver.awaitingValidation) return; // ignore reactions once initial validation window is closed
      } catch (e) { /* ignore store access errors */ }

      if (emoji === '✅') {
        await handleAccept(guild, channel, user, targetId);
      } else if (emoji === '❌') {
        await handleReject(guild, channel, user, targetId);
      }

    } catch (err) { logger.error('Erreur dans messageReactionAdd: ' + (err && err.message ? err.message : String(err))); }
  });

  // Permettre au staff de valider/refuser en tapant "oui" / "non" dans le fil
  client.on('messageCreate', async (msg) => {
    try {
      if (msg.author.bot) return;
      const channel = msg.channel;
      const guild = msg.guild;
      if (!guild) return;
      if (!channel?.isThread || !channel.isThread()) return; // only handle thread messages

      // vérifier que l'auteur est autorisé (manageGuild ou role verifier)
      const member = await guild.members.fetch(msg.author.id).catch(() => null);
      if (!member) return;
      let allowed = false;
      if (member.permissions && member.permissions.has(PermissionsBitField.Flags.ManageGuild)) allowed = true;
      if (verifierRole) {
        const r = guild.roles.cache.get(verifierRole) || guild.roles.cache.find(x => x.name === verifierRole);
        if (r && member.roles.cache.has(r.id)) allowed = true;
      }
      if (!allowed) return;

      // trouver le targetId (par topic ou contenu du message initial)
      let targetId = null;
      const topic = channel.topic ?? '';
      const mtopic = topic.match(/verification:(\d+)/);
      if (mtopic) targetId = mtopic[1];
      if (!targetId) {
        const starter = await channel.fetchStarterMessage().catch(() => null);
        if (starter && starter.content) {
          const mm = starter.content.match(/verification_member_id:(\d+)/);
          if (mm) targetId = mm[1];
        }
      }
      if (!targetId) {
        const mm2 = msg.content.match(/verification_member_id:(\d+)/);
        if (mm2) targetId = mm2[1];
      }
      if (!targetId) {
        const mention = msg.mentions.users.first();
        if (mention) targetId = mention.id;
      }
      if (!targetId) return; // nothing to do

      // Only handle quick accept/reject messages if the verification is still awaiting initial validation
      try {
        const ver = store.verifications[targetId] || {};
        if (!ver.awaitingValidation) return;
      } catch (e) { /* ignore store access errors */ }

      const text = (msg.content || '').toLowerCase().trim();
      const acceptRe = /^\s*(?:oui|o|yes|y|accept|ok|valide|valider|approve|approved)\b/;
      const rejectRe = /^\s*(?:non|n|no|reject|refuse|refuser|deny|denied)\b/;
      if (acceptRe.test(text)) {
        await handleAccept(guild, channel, msg.author, targetId);
      } else if (rejectRe.test(text)) {
        await handleReject(guild, channel, msg.author, targetId);
      }
    } catch (err) { logger.error('Erreur dans messageCreate (thread quick-validate): ' + (err && err.message ? err.message : String(err))); }
  });

  // Gestion du bouton request_verif : renvoie le message de vérification au membre qui clique
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      if (interaction.customId !== 'request_verif') return;

      // récupérer le membre (dans le guild si possible)
      let member = interaction.member;
      if (!member && interaction.guildId) {
        const guild = await client.guilds.fetch(interaction.guildId).catch(() => null);
        if (guild) member = await guild.members.fetch(interaction.user.id).catch(() => null);
      }
      if (!member) {
        await interaction.reply({ content: `Impossible de lancer la vérification (membre introuvable).`, ephemeral: true }).catch(() => {});
        return;
      }

      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      await runVerificationForMember(member);
      await interaction.followUp({ content: `Le message de vérification t'a été envoyé en DM (si tes DMs sont ouverts).`, ephemeral: true }).catch(() => {});
    } catch (err) { logger.error('Erreur interactionCreate (button): ' + (err && err.message ? err.message : String(err))); }
  });

  // Fournir une fonction exportée pour déclencher la vérification depuis d'autres modules si besoin
  // Attacher la fonction au client pour y accéder depuis des commandes externes (ex: !msgverif)
  try {
    client.runVerificationForMember = runVerificationForMember;
  } catch (e) { /* ignore */ }
  return { runVerificationForMember };
}
