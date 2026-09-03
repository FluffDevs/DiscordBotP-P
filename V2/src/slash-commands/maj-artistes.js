import { SlashCommandBuilder, PermissionsBitField } from 'discord.js';
import logger from '../logger.js';
import { getManager } from '../artistForum.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Raccourci de /artistes-forum sync : force une mise à jour immédiate du
 * forum des artistes depuis l'API FluffRadio (voir src/artistForum.js).
 */

export default {
  data: new SlashCommandBuilder()
    .setName('maj-artistes')
    .setDescription('Met à jour immédiatement le forum des artistes depuis l\'API FluffRadio')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Commande utilisable uniquement sur un serveur.', ephemeral: true });
      return;
    }
    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      await interaction.reply({ content: 'Réservé aux administrateurs.', ephemeral: true });
      return;
    }

    let mgr;
    try {
      mgr = getManager();
    } catch {
      await interaction.reply({ content: 'Module forum artistes non initialisé (redémarrage nécessaire).', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const r = await mgr.sync();
      await interaction.followUp({
        content:
          `Mise à jour terminée : ${r.created} créé(s), ${r.updated} mis à jour, ` +
          `${r.deleted} supprimé(s), ${r.unchanged} inchangé(s), ${r.errors} erreur(s).`,
        ephemeral: true
      });
    } catch (err) {
      logger.error('Erreur /maj-artistes: ' + (err?.message ?? String(err)));
      await interaction.followUp({ content: 'Erreur : ' + (err?.message ?? String(err)), ephemeral: true });
    }
  }
};
