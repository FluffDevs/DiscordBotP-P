import { SlashCommandBuilder, PermissionsBitField, ChannelType } from 'discord.js';
import logger from '../logger.js';
import { getManager } from '../artistForum.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * /artistes-forum config|status|sync — pilote le forum des artistes FluffRadio
 * (voir src/artistForum.js).
 */

const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
}

export default {
  data: new SlashCommandBuilder()
    .setName('artistes-forum')
    .setDescription('Configurer et synchroniser le forum des artistes FluffRadio')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((s) =>
      s
        .setName('config')
        .setDescription("Configurer le salon forum, l'heure de MAJ et l'activation")
        .addChannelOption((o) =>
          o
            .setName('forum')
            .setDescription('Salon forum où poster les artistes')
            .addChannelTypes(ChannelType.GuildForum)
        )
        .addStringOption((o) => o.setName('heure').setDescription('Heure de la MAJ quotidienne (HH:MM, 24h)'))
        .addBooleanOption((o) => o.setName('actif').setDescription('Activer/désactiver la synchro quotidienne'))
    )
    .addSubcommand((s) => s.setName('status').setDescription('État de la configuration et de la dernière synchro'))
    .addSubcommand((s) => s.setName('sync').setDescription('Lancer une synchronisation immédiate')),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Commande utilisable uniquement sur un serveur.', ephemeral: true });
      return;
    }
    if (!isAdmin(interaction)) {
      await interaction.reply({ content: 'Réservé aux administrateurs.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    let mgr;
    try {
      mgr = getManager();
    } catch {
      await interaction.reply({ content: 'Module forum artistes non initialisé (redémarrage nécessaire).', ephemeral: true });
      return;
    }

    if (sub === 'status') {
      await interaction.reply({ content: mgr.statusText(), ephemeral: true });
      return;
    }

    if (sub === 'config') {
      const forum = interaction.options.getChannel('forum');
      const heure = interaction.options.getString('heure');
      const actif = interaction.options.getBoolean('actif');
      if (heure && !HHMM_RE.test(heure.trim())) {
        await interaction.reply({ content: "Format d'heure invalide. Utilise HH:MM (ex : 04:00).", ephemeral: true });
        return;
      }
      mgr.updateConfig({
        forumChannelId: forum ? forum.id : undefined,
        updateHour: heure ? heure.trim() : undefined,
        enabled: actif === null ? undefined : actif
      });
      await interaction.reply({ content: 'Configuration mise à jour.\n\n' + mgr.statusText(), ephemeral: true });
      return;
    }

    if (sub === 'sync') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const r = await mgr.sync();
        await interaction.followUp({
          content:
            `Synchro terminée : ${r.created} créé(s), ${r.updated} mis à jour, ` +
            `${r.deleted} supprimé(s), ${r.unchanged} inchangé(s), ${r.errors} erreur(s).`,
          ephemeral: true
        });
      } catch (err) {
        logger.error('Erreur /artistes-forum sync: ' + (err?.message ?? String(err)));
        await interaction.followUp({ content: 'Erreur : ' + (err?.message ?? String(err)), ephemeral: true });
      }
    }
  }
};
