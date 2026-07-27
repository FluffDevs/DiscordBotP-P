import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } from 'discord.js';
import logger from '../logger.js';
import { isStaff, addSanction } from '../moderation.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

export default {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulser un membre du serveur')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à expulser').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison de l\'expulsion (optionnel)')),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) { await interaction.reply({ content: 'Cette commande doit être utilisée sur un serveur.', ephemeral: true }); return; }
      if (!isStaff(guild, interaction.member, PermissionsBitField.Flags.KickMembers)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à expulser des membres.", ephemeral: true });
        return;
      }

      const user = interaction.options.getUser('membre', true);
      const reason = (interaction.options.getString('raison') || '').trim();

      if (user.id === interaction.user.id) { await interaction.reply({ content: 'Tu ne peux pas t\'expulser toi-même.', ephemeral: true }); return; }
      if (user.id === interaction.client.user.id) { await interaction.reply({ content: 'Je ne vais pas m\'expulser moi-même 🙃', ephemeral: true }); return; }

      const targetMember = await guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) { await interaction.reply({ content: 'Ce membre n\'est pas sur le serveur.', ephemeral: true }); return; }
      if (!targetMember.kickable) {
        await interaction.reply({ content: 'Je ne peux pas expulser ce membre (rôle trop haut ou permissions insuffisantes).', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const dm = new EmbedBuilder()
          .setColor(0xE67E22)
          .setTitle('👢 Tu as été expulsé·e')
          .setDescription(`Tu as été expulsé·e de **${guild.name}**.`)
          .addFields({ name: '📝 Raison', value: reason || 'Aucune raison fournie' })
          .setTimestamp();
        await user.send({ embeds: [dm] });
      } catch (e) { /* DMs fermés, on continue */ }

      try {
        await targetMember.kick(reason || undefined);
      } catch (err) {
        await interaction.editReply({ content: `Échec de l'expulsion: ${err && err.message ? err.message : String(err)}` });
        return;
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('👢 Membre expulsé')
        .addFields(
          { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
          { name: '📝 Raison', value: reason || 'Aucune raison fournie' }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      if (interaction.channel) await interaction.channel.send({ embeds: [resultEmbed] }).catch(() => {});

      addSanction(user.id, {
        type: 'kick',
        targetTag: user.tag,
        reason: reason || null,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        guildId: guild.id
      });

      await interaction.editReply({ content: `✅ ${user.tag} a été expulsé·e.` });
    } catch (err) {
      logger.error(['Erreur /kick:', err]);
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
    }
  }
};
