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
          try {
            await channel.send(`⚠️ Erreur: impossible de ${contextMsg}. Détails: ${msg}. Vérifiez que le bot a la permission Manage Roles, que son rôle est au-dessus du rôle ciblé et réessayez.`).catch(() => {});
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
  // Role ID to ping when a verification post is created (will notify staff)
  // Remplacez par l'ID souhaité ou mettez en variable d'environnement si nécessaire.
  const notifyRoleId = '1439047400193790152';
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
        const starter = await thread.fetchStarterMessage().catch(() => null);
        // Intentionally do NOT add reactions to the starter message.
        // Les réactions doivent être ajoutées manuellement par le staff pour éviter
        // tout marquage automatique par le bot qui pourrait prêter à confusion.
        // if (starter) { await starter.react('✅').catch(() => {}); await starter.react('❌').catch(() => {}); }
      } catch (err) {}

      // Persister la relation membre -> thread pour retrouver après redémarrage
      try {
        store.verifications[member.id] = { threadId: thread.id, channelId: forumChannelId, createdAt: Date.now() };
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

      try { await target.send(`Félicitations — votre vérification a été acceptée sur ${guild.name}. Vous avez reçu le rôle.`).catch(() => {}); } catch (err) {}
      await channel.send(`✅ Vérification acceptée par <@${moderatorUser.id}> — rôle appliqué à <@${target.id}>.`).catch(() => {});
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
