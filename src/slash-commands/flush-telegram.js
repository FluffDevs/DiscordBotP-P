import { SlashCommandBuilder, PermissionsBitField } from 'discord.js';
import logger from '../logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('flush-telegram')
    .setDescription('Force l\'envoi immédiat des messages en file vers Telegram (Administrateur uniquement)'),
  async execute(interaction) {
    try {
      const member = interaction.member;
      const isAdmin = member && member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator);
      if (!isAdmin) {
        await interaction.reply({ content: 'Vous devez être administrateur pour utiliser cette commande.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
  const { default: telegram } = await import('../telegram.js');
      if (!telegram || typeof telegram._flush !== 'function') {
        await interaction.editReply({ content: 'Le module Telegram n\'est pas disponible sur ce serveur.' });
        return;
      }

      try {
        await telegram._flush();
        await interaction.editReply({ content: 'Flush Telegram exécuté (tentative d\'envoi immédiat).' });
      } catch (e) {
        await interaction.editReply({ content: 'Erreur lors du flush Telegram: ' + (e && e.message ? e.message : String(e)) });
      }
    } catch (err) {
      try { logger.error(['Erreur /flush-telegram:', err]); } catch (e) {}
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }); else await interaction.reply({ content: 'Erreur interne.', ephemeral: true });
    }
  }
};
