import { SlashCommandBuilder, PermissionsBitField } from 'discord.js';
import logger from '../logger.js';
import { isStaff } from '../moderation.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

const SNOWFLAKE_RE = /^\d{15,25}$/;

export default {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Supprime plusieurs messages du salon, avec filtres optionnels')
    .addIntegerOption(o => o.setName('nombre').setDescription('Nombre de messages à supprimer (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre'))
    .addStringOption(o => o.setName('avant_id').setDescription('Ne supprimer que les messages envoyés avant ce message (ID)'))
    .addStringOption(o => o.setName('contient').setDescription('Ne supprimer que les messages contenant ce texte'))
    .addBooleanOption(o => o.setName('bots_uniquement').setDescription('Ne supprimer que les messages envoyés par des bots')),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      const channel = interaction.channel;
      if (!guild || !channel) { await interaction.reply({ content: 'Cette commande doit être utilisée sur un serveur.', ephemeral: true }); return; }
      if (!isStaff(guild, interaction.member, PermissionsBitField.Flags.ManageMessages)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à supprimer des messages.", ephemeral: true });
        return;
      }

      const count = interaction.options.getInteger('nombre', true);
      const filterUser = interaction.options.getUser('membre');
      const beforeId = interaction.options.getString('avant_id');
      const contains = interaction.options.getString('contient');
      const botsOnly = interaction.options.getBoolean('bots_uniquement') ?? false;

      if (beforeId && !SNOWFLAKE_RE.test(beforeId)) {
        await interaction.reply({ content: 'ID de message invalide pour `avant_id`.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      // On sur-fetch (jusqu'à 100, la limite Discord par requête) puis on filtre
      // en mémoire, car l'API ne permet pas de filtrer par auteur/contenu côté serveur.
      const fetchOptions = { limit: 100 };
      if (beforeId) fetchOptions.before = beforeId;
      const fetched = await channel.messages.fetch(fetchOptions).catch(() => null);
      if (!fetched) {
        await interaction.editReply({ content: 'Impossible de récupérer les messages du salon.' });
        return;
      }

      let candidates = fetched;
      if (filterUser) candidates = candidates.filter(m => m.author.id === filterUser.id);
      if (botsOnly) candidates = candidates.filter(m => m.author.bot);
      if (contains) {
        const needle = contains.toLowerCase();
        candidates = candidates.filter(m => m.content && m.content.toLowerCase().includes(needle));
      }

      const toDelete = candidates.first(count);
      if (!toDelete.length) {
        await interaction.editReply({ content: 'Aucun message ne correspond à ces filtres parmi les 100 derniers messages.' });
        return;
      }

      const deleted = await channel.bulkDelete(toDelete, true).catch(() => null);
      if (!deleted) {
        await interaction.editReply({ content: 'Impossible de supprimer ces messages (plus vieux de 14 jours, ou erreur).' });
        return;
      }

      const filterLabels = [];
      if (filterUser) filterLabels.push(`membre: ${filterUser.tag}`);
      if (beforeId) filterLabels.push(`avant: ${beforeId}`);
      if (contains) filterLabels.push(`contient: "${contains}"`);
      if (botsOnly) filterLabels.push('bots uniquement');
      const filterSummary = filterLabels.length ? ` (${filterLabels.join(', ')})` : '';

      logger.info(`Clear: ${deleted.size} message(s) supprimés dans #${channel.name} par ${interaction.user.tag}${filterSummary}`, { noTelegram: true });
      await interaction.editReply({ content: `✅ ${deleted.size} message(s) supprimé(s)${filterSummary}.` });
    } catch (err) {
      logger.error(['Erreur /clear:', err]);
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
    }
  }
};
