import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } from 'discord.js';
import logger from '../logger.js';
import { isStaff, addSanction } from '../moderation.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

export default {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Lever le mute (timeout) d\'un membre')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à unmute').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison (optionnel)')),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) { await interaction.reply({ content: 'Cette commande doit être utilisée sur un serveur.', ephemeral: true }); return; }
      if (!isStaff(guild, interaction.member, PermissionsBitField.Flags.ModerateMembers)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à unmute des membres.", ephemeral: true });
        return;
      }

      const user = interaction.options.getUser('membre', true);
      const reason = (interaction.options.getString('raison') || '').trim();

      // Toujours défer avant le moindre appel réseau (fetch de membre, etc.) :
      // Discord invalide l'interaction si elle n'est pas accusée réception
      // sous 3s, et un fetch peut prendre plus longtemps que ça.
      await interaction.deferReply({ ephemeral: true });

      const targetMember = await guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) { await interaction.editReply({ content: 'Ce membre n\'est pas sur le serveur.' }); return; }
      if (!targetMember.communicationDisabledUntil || targetMember.communicationDisabledUntilTimestamp < Date.now()) {
        await interaction.editReply({ content: 'Ce membre n\'est pas en sourdine actuellement.' });
        return;
      }

      try {
        await targetMember.timeout(null, reason || undefined);
      } catch (err) {
        await interaction.editReply({ content: `Échec de la levée de sourdine: ${err && err.message ? err.message : String(err)}` });
        return;
      }

      try {
        const dm = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('🔊 Sourdine levée')
          .setDescription(`Ta mise en sourdine sur **${guild.name}** a été levée.`)
          .setTimestamp();
        await user.send({ embeds: [dm] });
      } catch (e) { /* DMs fermés, on continue */ }

      const resultEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔊 Sourdine levée')
        .addFields(
          { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
          { name: '📝 Raison', value: reason || 'Aucune raison fournie' }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      if (interaction.channel) await interaction.channel.send({ embeds: [resultEmbed] }).catch(() => {});

      addSanction(user.id, {
        type: 'untimeout',
        targetTag: user.tag,
        reason: reason || null,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        guildId: guild.id
      });

      await interaction.editReply({ content: `✅ Sourdine levée pour ${user.tag}.` });
    } catch (err) {
      logger.error(['Erreur /untimeout:', err]);
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
    }
  }
};
