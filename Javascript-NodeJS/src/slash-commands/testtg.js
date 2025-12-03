import { SlashCommandBuilder, PermissionsBitField } from 'discord.js';
import logger from '../logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('testtg')
    .setDescription('Envoie un message de test vers le groupe Telegram configuré (Administrateur seulement)'),
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
      const text = `Test Telegram depuis Discord par ${interaction.user.tag} (${interaction.user.id})`;
      const ok = telegram && (typeof telegram.enqueueVerification === 'function' ? telegram.enqueueVerification(text) : (typeof telegram.enqueueLog === 'function' ? telegram.enqueueLog(text) : false));
      if (ok) {
        await interaction.editReply({ content: 'Message de test envoyé vers Telegram (mis en file).' });
      } else {
        await interaction.editReply({ content: 'Échec: Telegram non configuré ou impossible d\'enregistrer le message. Vérifiez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID.' });
      }
    } catch (err) {
      try { logger.error(['Erreur /testtg:', err]); } catch (e) {}
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur lors de l\'envoi du test vers Telegram.', ephemeral: true }); else await interaction.reply({ content: 'Erreur lors de l\'envoi du test vers Telegram.', ephemeral: true });
    }
  }
};
