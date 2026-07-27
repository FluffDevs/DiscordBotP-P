import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } from 'discord.js';
import logger from '../logger.js';
import { isStaff, addSanction, getSanctions } from '../moderation.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

export default {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Donner un avertissement à un membre')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à avertir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison de l\'avertissement').setRequired(true)),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) { await interaction.reply({ content: 'Cette commande doit être utilisée sur un serveur.', ephemeral: true }); return; }
      if (!isStaff(guild, interaction.member, PermissionsBitField.Flags.ModerateMembers)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à avertir des membres.", ephemeral: true });
        return;
      }

      const user = interaction.options.getUser('membre', true);
      const reason = interaction.options.getString('raison', true).trim();

      if (user.id === interaction.user.id) { await interaction.reply({ content: 'Tu ne peux pas t\'avertir toi-même.', ephemeral: true }); return; }
      if (user.bot) { await interaction.reply({ content: 'Impossible d\'avertir un bot.', ephemeral: true }); return; }

      await interaction.deferReply({ ephemeral: true });

      addSanction(user.id, {
        type: 'warn',
        targetTag: user.tag,
        reason,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        guildId: guild.id
      });
      const total = getSanctions(user.id).filter(s => s.type === 'warn').length;

      try {
        const dm = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle('⚠️ Avertissement')
          .setDescription(`Tu as reçu un avertissement sur **${guild.name}**.`)
          .addFields(
            { name: '📝 Raison', value: reason },
            { name: '🔢 Total d\'avertissements', value: String(total) }
          )
          .setTimestamp();
        await user.send({ embeds: [dm] });
      } catch (e) { /* DMs fermés, on continue */ }

      const resultEmbed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('⚠️ Membre averti')
        .addFields(
          { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
          { name: '🔢 Total', value: String(total), inline: true },
          { name: '📝 Raison', value: reason }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      if (interaction.channel) await interaction.channel.send({ embeds: [resultEmbed] }).catch(() => {});

      await interaction.editReply({ content: `✅ ${user.tag} a été averti·e (total: ${total}).` });
    } catch (err) {
      logger.error(['Erreur /warn:', err]);
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
    }
  }
};
