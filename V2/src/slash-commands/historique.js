import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } from 'discord.js';
import logger from '../logger.js';
import { isStaff, queryHistory } from '../moderation.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Consultation du casier de modération (ban/kick/timeout/warn/...), réservée
 * au staff, filtrable par membre sanctionné, par modérateur et/ou par type.
 * C'est la seule commande qui affiche le nom du modérateur — elle n'est
 * jamais visible du membre concerné (réponse éphémère).
 */

const TYPE_LABEL = {
  ban: '🔨 Ban',
  unban: '🕊️ Débannissement',
  kick: '👢 Kick',
  timeout: '🔇 Mute',
  untimeout: '🔊 Fin de mute',
  warn: '⚠️ Avertissement'
};

export default {
  data: new SlashCommandBuilder()
    .setName('historique')
    .setDescription('Consulte le casier de modération (filtrable par membre, modérateur, type)')
    .addUserOption(o => o.setName('membre').setDescription('Filtrer par membre sanctionné'))
    .addUserOption(o => o.setName('moderateur').setDescription('Filtrer par modérateur'))
    .addStringOption(o => o.setName('type').setDescription('Filtrer par type de sanction').addChoices(
      { name: 'Ban', value: 'ban' },
      { name: 'Débannissement', value: 'unban' },
      { name: 'Kick', value: 'kick' },
      { name: 'Mute (timeout)', value: 'timeout' },
      { name: 'Fin de mute', value: 'untimeout' },
      { name: 'Avertissement', value: 'warn' }
    ))
    .addIntegerOption(o => o.setName('limite').setDescription('Nombre max de résultats (défaut 20, max 50)').setMinValue(1).setMaxValue(50)),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) { await interaction.reply({ content: 'Cette commande doit être utilisée sur un serveur.', ephemeral: true }); return; }
      if (!isStaff(guild, interaction.member, PermissionsBitField.Flags.ModerateMembers)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à consulter le casier de modération.", ephemeral: true });
        return;
      }

      const membre = interaction.options.getUser('membre');
      const moderateur = interaction.options.getUser('moderateur');
      const type = interaction.options.getString('type');
      const limite = interaction.options.getInteger('limite') ?? 20;

      const entries = queryHistory({ userId: membre?.id, moderatorId: moderateur?.id, type, limit: limite });

      const filterLabels = [];
      if (membre) filterLabels.push(`membre: ${membre.tag}`);
      if (moderateur) filterLabels.push(`modérateur: ${moderateur.tag}`);
      if (type) filterLabels.push(`type: ${TYPE_LABEL[type] || type}`);
      const filterSummary = filterLabels.length ? ` (${filterLabels.join(', ')})` : '';

      if (entries.length === 0) {
        await interaction.reply({ content: `📋 Aucune sanction trouvée${filterSummary}.`, ephemeral: true });
        return;
      }

      // Discord limite les embeds à 25 champs — la commande accepte jusqu'à 50
      // résultats mais n'en affiche que 25 au maximum dans l'embed.
      const shown = entries.slice(0, 25);

      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`📋 Casier de modération${filterSummary}`)
        .setFooter({ text: entries.length > shown.length ? `${shown.length}/${entries.length} entrée(s) affichée(s)` : `${entries.length} entrée(s)` });
      if (membre) embed.setThumbnail(membre.displayAvatarURL());

      for (const e of shown) {
        const label = TYPE_LABEL[e.type] || e.type;
        const date = `<t:${Math.floor(e.createdAt / 1000)}:f>`;
        const lines = [];
        if (!membre) lines.push(`**Membre :** ${e.targetTag || e.userId}`);
        lines.push(`**Par :** ${e.moderatorTag || e.moderatorId || 'inconnu'}`);
        lines.push(`**Date :** ${date}`);
        if (e.durationMs) lines.push(`**Durée :** ${Math.round(e.durationMs / 60000)} min`);
        lines.push(`**Raison :** ${e.reason || 'Aucune raison fournie'}`);
        embed.addFields({ name: label, value: lines.join('\n') });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      logger.error(['Erreur /historique:', err]);
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
    }
  }
};
