import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } from 'discord.js';
import logger from '../logger.js';
import { isStaff, addSanction } from '../moderation.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Le membre n'étant plus sur le serveur, aucun DM n'est envoyé — la seule
 * trace est l'embed dans le salon (sans le nom du modérateur) et le casier interne.
 */

export default {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Lever le bannissement d\'un membre')
    .addStringOption(o => o.setName('id').setDescription('L\'ID Discord du membre à débannir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison du débannissement (optionnel)')),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) { await interaction.reply({ content: 'Cette commande doit être utilisée sur un serveur.', ephemeral: true }); return; }
      if (!isStaff(guild, interaction.member, PermissionsBitField.Flags.BanMembers)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à débannir des membres.", ephemeral: true });
        return;
      }

      const userId = interaction.options.getString('id', true).trim();
      const reason = (interaction.options.getString('raison') || '').trim();
      if (!/^\d{15,25}$/.test(userId)) {
        await interaction.reply({ content: 'ID invalide — fournis l\'ID numérique Discord du membre.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const ban = await guild.bans.fetch(userId).catch(() => null);
      if (!ban) {
        await interaction.editReply({ content: 'Ce membre n\'est pas banni sur ce serveur.' });
        return;
      }

      try {
        await guild.members.unban(userId, reason || undefined);
      } catch (err) {
        await interaction.editReply({ content: `Échec du débannissement: ${err && err.message ? err.message : String(err)}` });
        return;
      }

      const user = ban.user;
      const resultEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🕊️ Bannissement levé')
        .addFields(
          { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
          { name: '📝 Raison', value: reason || 'Aucune raison fournie' }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      if (interaction.channel) await interaction.channel.send({ embeds: [resultEmbed] }).catch(() => {});

      addSanction(userId, {
        type: 'unban',
        targetTag: user.tag,
        reason: reason || null,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        guildId: guild.id
      });

      await interaction.editReply({ content: `✅ ${user.tag} a été débanni·e.` });
    } catch (err) {
      logger.error(['Erreur /unban:', err]);
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
    }
  }
};
