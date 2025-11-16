import { SlashCommandBuilder, PermissionsBitField } from 'discord.js';
import logger from '../logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('liste')
    .setDescription('Affiche la liste des messages en attente d\'envoi sur Telegram (Administrateur seulement)'),
  async execute(interaction) {
    try {
      // Permission: Administrateur uniquement
      const member = interaction.member;
      const isAdmin = member && member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator);
      if (!isAdmin) {
        await interaction.reply({ content: 'Vous devez être administrateur pour utiliser cette commande.', ephemeral: true });
        return;
      }

  const { default: telegram } = await import('../telegram.js');
      const queue = (telegram && typeof telegram.getQueue === 'function') ? telegram.getQueue() : [];
      if (!queue || queue.length === 0) {
        await interaction.reply({ content: '✅ Aucune message en attente dans la file Telegram.', ephemeral: true });
        return;
      }

      // Build printable chunks to avoid exceeding Discord limits
      const MAX_CHUNK = 1800;
      const items = queue.map((q, i) => `${i + 1}. ${String(q).slice(0, 1000).replace(/\n/g, ' ' )}`);
      let current = '';
      // Reply initially with first chunk
      await interaction.deferReply({ ephemeral: true });
      let first = true;
      for (const line of items) {
        if ((current + '\n' + line).length > MAX_CHUNK) {
          if (first) {
            await interaction.editReply({ content: current || '...' });
            first = false;
          } else {
            await interaction.followUp({ content: current, ephemeral: true });
          }
          current = line + '\n';
        } else {
          current += (current ? '\n' : '') + line;
        }
      }
      if (current) {
        if (first) await interaction.editReply({ content: current }); else await interaction.followUp({ content: current, ephemeral: true });
      }
    } catch (err) {
      try { logger.error(['Erreur /liste:', err]); } catch (e) {}
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Erreur lors de la récupération de la file Telegram.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Erreur lors de la récupération de la file Telegram.', ephemeral: true });
      }
    }
  }
};
