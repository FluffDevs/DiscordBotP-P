import { SlashCommandBuilder, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import fs from 'fs';
import path from 'path';
import logger from '../logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('flushforum')
    .setDescription('Supprime tous les posts de vérification présents dans le forum et vide le store (Administrateur uniquement).'),
  async execute(interaction) {
    try {
      const member = interaction.member;
      // Permission: allow if member has the VERIFIER_ROLE (env) or is Administrator as a fallback
      const verifierRoleRaw = process.env.VERIFIER_ROLE;
      let allowed = false;
      try {
        if (member && member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) allowed = true;
        if (!allowed && verifierRoleRaw && member && member.roles) {
          // accept forms: plain ID, mention <@&ID>, or role name
          const m = String(verifierRoleRaw).match(/^<@&(\d+)>$/);
          const rid = m ? m[1] : (/^\d+$/.test(verifierRoleRaw) ? verifierRoleRaw : null);
          if (rid && member.roles.cache.has(rid)) allowed = true;
          if (!allowed) {
            // try by name
            if (member.roles.cache.some(r => r.name === verifierRoleRaw)) allowed = true;
          }
        }
      } catch (e) { /* ignore */ }
      if (!allowed) {
        await interaction.reply({ content: 'Vous devez avoir le rôle autorisé (VERIFIER_ROLE) ou être administrateur pour utiliser cette commande.', ephemeral: true });
        return;
      }

      // Reply publicly in the same channel so confirmation and result are visible to all
      const prompt = 'Confirmer la suppression de TOUS les posts de vérification listés dans le forum ? Cette action est irréversible.';
      await interaction.reply({ content: prompt, components: [], ephemeral: false });

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`flushforum_confirm:${interaction.user.id}`).setLabel('Confirmer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`flushforum_cancel:${interaction.user.id}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      );

      // Edit the public reply to add the confirmation buttons
      const replyMsg = await interaction.editReply({ content: prompt, components: [confirmRow] });

      // Wait for the button click (only from the command invoker)
      let comp;
      try {
        comp = await replyMsg.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 60_000 });
      } catch (e) {
        // timeout
        try { await interaction.editReply({ content: 'Temps écoulé — opération annulée.', components: [] }); } catch (e) {}
        return;
      }

      if (!comp) return;
      if (comp.customId && comp.customId.startsWith('flushforum_cancel')) {
        await comp.update({ content: 'Opération annulée par l\'utilisateur.', components: [] });
        return;
      }

      // User confirmed — update the public prompt to indicate progress
      await comp.update({ content: 'Exécution du flush — suppression en cours...', components: [] });

      const client = interaction.client;
  const results = { total: 0, deleted: 0, notFound: 0, errors: [] };

      // Resolve forum channel from env FORUM_CHANNEL_ID (same logic as verification flow)
      const forumChannelId = process.env.FORUM_CHANNEL_ID;
      if (!forumChannelId) {
        await interaction.followUp({ content: 'FORUM_CHANNEL_ID non configuré; impossible de localiser le forum de vérification.' });
        return;
      }

      let forum = null;
      if (/^\d+$/.test(forumChannelId)) {
        forum = await client.channels.fetch(forumChannelId).catch(() => null);
      }
      if (!forum) {
        for (const [gid, g] of client.guilds.cache) {
          try {
            const ch = g.channels.cache.find(c => c.name === forumChannelId && c.type === ChannelType.GuildForum);
            if (ch) { forum = ch; break; }
          } catch (err) { /* ignore per-guild errors */ }
        }
      }

      if (!forum) {
        await interaction.followUp({ content: 'Impossible de récupérer le forum de vérification (FORUM_CHANNEL_ID incorrect ou bot non présent dans le serveur).', ephemeral: true });
        return;
      }

      // Collect threads (active + archived) into a Map to avoid duplicates
      const threadsMap = new Map();
      try {
        const fetched = await forum.threads.fetch().catch(() => null);
        if (fetched && fetched.threads) {
          for (const [id, t] of fetched.threads) threadsMap.set(id, t);
        }
      } catch (e) { /* ignore */ }

      // Fetch archived threads with pagination (limit 100 per request)
      try {
        let before = undefined;
        while (true) {
          const opts = { limit: 100 };
          if (before) opts.before = before;
          const archived = await forum.threads.fetchArchived(opts).catch(() => null);
          if (!archived || !archived.threads || archived.threads.size === 0) break;
          for (const [id, t] of archived.threads) threadsMap.set(id, t);
          if (archived.threads.size < 100) break;
          // set before to the last thread id fetched to page older threads
          before = Array.from(archived.threads.keys()).pop();
        }
      } catch (e) { /* ignore */ }

      results.total = threadsMap.size;
      if (results.total === 0) {
        await interaction.followUp({ content: 'Aucun post trouvé dans le forum de vérification.' });
        // Still clear the store
        try {
          const DATA_DIR = path.join(process.cwd(), 'data');
          const DATA_FILE = path.join(DATA_DIR, 'verifications.json');
          if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const store = JSON.parse(raw || '{}');
            store.verifications = {};
            fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
          }
        } catch (e) { logger.warn('Erreur en vidant le store après flush vide: ' + (e && e.message ? e.message : String(e))); }
        return;
      }

      // Find the first thread whose starter message is pinned (keep it). Fallback: keep the oldest thread.
      let keepThreadId = null;
      try {
        for (const thread of threadsMap.values()) {
          try {
            const starter = await thread.fetchStarterMessage().catch(() => null);
            if (starter && starter.pinned) { keepThreadId = thread.id; break; }
          } catch (e) { /* ignore per-thread */ }
        }
      } catch (e) { /* ignore */ }

      if (!keepThreadId) {
        // fallback: keep the oldest thread by creation timestamp
        let oldest = null;
        for (const thread of threadsMap.values()) {
          if (!oldest || (thread.createdTimestamp || 0) < (oldest.createdTimestamp || 0)) oldest = thread;
        }
        if (oldest) keepThreadId = oldest.id;
      }

      // Backup the verifications store before deleting — fail if backup cannot be created
      const DATA_DIR = path.join(process.cwd(), 'data');
      const DATA_FILE = path.join(DATA_DIR, 'verifications.json');
      if (fs.existsSync(DATA_FILE)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const bak = path.join(DATA_DIR, `verifications.json.bak.${stamp}`);
        try {
          fs.copyFileSync(DATA_FILE, bak);
        } catch (e) {
          // Backup failed — abort the operation for safety
          try { await interaction.followUp({ content: 'Erreur: impossible de créer la sauvegarde du store de vérifications. Opération annulée pour sécurité.' }); } catch (e2) {}
          return;
        }
      }

      // Delete all threads except keepThreadId
      for (const [id, thread] of threadsMap) {
        if (String(id) === String(keepThreadId)) continue;
        try {
          await thread.delete();
          results.deleted++;
        } catch (err) {
          results.errors.push({ threadId: id, message: err && err.message ? err.message : String(err) });
        }
      }

      // Clear the persisted verifications store
      try {
        const DATA_DIR = path.join(process.cwd(), 'data');
        const DATA_FILE = path.join(DATA_DIR, 'verifications.json');
        if (fs.existsSync(DATA_FILE)) {
          const raw = fs.readFileSync(DATA_FILE, 'utf8');
          const store = JSON.parse(raw || '{}');
          store.verifications = {};
          fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
        }
      } catch (e) {
        results.errors.push({ message: 'Impossible d\'écrire le store: ' + (e && e.message ? e.message : String(e)) });
      }

      const summary = `Flush forum: total=${results.total} supprimés=${results.deleted} gardé=${keepThreadId ? keepThreadId : 'aucun'} erreurs=${results.errors.length}`;
      // Public confirmation in the same channel
      await interaction.followUp({ content: summary });
      if (results.errors.length > 0) {
        try { logger.warn(['/flushforum erreurs:', results.errors]); } catch (e) {}
      }

    } catch (err) {
      try { logger.error(['Erreur /flushforum:', err]); } catch (e) {}
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }); else await interaction.reply({ content: 'Erreur interne.', ephemeral: true });
    }
  }
};
