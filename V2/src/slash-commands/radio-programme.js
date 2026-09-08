import { SlashCommandBuilder, PermissionsBitField, ChannelType } from 'discord.js';
import logger from '../logger.js';
import { getManager } from '../radioSchedule.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * /radio-programme config|publish|refresh|status — pilote le message d'ancrage
 * du programme radio dans un salon dédié (voir src/radioSchedule.js).
 */

const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
}

export default {
  data: new SlashCommandBuilder()
    .setName('radio-programme')
    .setDescription('Configurer le message du programme radio dans un salon dédié')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((s) =>
      s
        .setName('config')
        .setDescription("Configurer le salon, l'heure de ré-édition et l'activation")
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription('Salon où publier le message du programme')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addStringOption((o) => o.setName('heure').setDescription('Heure de ré-édition quotidienne (HH:MM, 24h)'))
        .addBooleanOption((o) => o.setName('actif').setDescription('Activer/désactiver la ré-édition quotidienne'))
    )
    .addSubcommand((s) => s.setName('publish').setDescription('Publier (ou republier) le message d\'ancrage dans le salon'))
    .addSubcommand((s) => s.setName('refresh').setDescription('Ré-éditer maintenant le message d\'ancrage depuis l\'API'))
    .addSubcommand((s) => s.setName('status').setDescription('État de la configuration et de la dernière publication')),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'Commande utilisable uniquement sur un serveur.', ephemeral: true });
      return;
    }
    if (!isAdmin(interaction)) {
      await interaction.reply({ content: 'Réservé aux administrateurs.', ephemeral: true });
      return;
    }

    let mgr;
    try {
      mgr = getManager();
    } catch {
      await interaction.reply({ content: 'Module programme radio non initialisé (redémarrage nécessaire).', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      await interaction.reply({ content: mgr.statusText(), ephemeral: true });
      return;
    }

    if (sub === 'config') {
      const salon = interaction.options.getChannel('salon');
      const heure = interaction.options.getString('heure');
      const actif = interaction.options.getBoolean('actif');
      if (heure && !HHMM_RE.test(heure.trim())) {
        await interaction.reply({ content: "Format d'heure invalide. Utilise HH:MM (ex : 06:00).", ephemeral: true });
        return;
      }
      mgr.updateConfig({
        channelId: salon ? salon.id : undefined,
        updateHour: heure ? heure.trim() : undefined,
        enabled: actif === null ? undefined : actif
      });
      await interaction.reply({ content: 'Configuration mise à jour.\n\n' + mgr.statusText(), ephemeral: true });
      return;
    }

    // publish / refresh
    await interaction.deferReply({ ephemeral: true });
    try {
      const msg = sub === 'publish' ? await mgr.publishAnchor() : await mgr.refreshAnchor();
      await interaction.followUp({
        content: sub === 'publish' ? `Message d'ancrage publié : ${msg.url}` : `Message d'ancrage mis à jour : ${msg.url}`,
        ephemeral: true
      });
    } catch (err) {
      logger.error(`Erreur /radio-programme ${sub}: ` + (err?.message ?? String(err)));
      await interaction.followUp({ content: 'Erreur : ' + (err?.message ?? String(err)), ephemeral: true });
    }
  }
};
