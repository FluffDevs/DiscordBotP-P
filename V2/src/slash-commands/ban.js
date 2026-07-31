import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } from 'discord.js';
import logger from '../logger.js';
import { isStaff, addSanction } from '../moderation.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Le membre reçoit un DM avant d'être banni (le nom du modérateur n'y
 * apparaît jamais) puis un embed de confirmation est posté dans le salon.
 */

export default {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir un membre du serveur')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison du bannissement (optionnel)'))
    .addIntegerOption(o => o.setName('supprimer_messages').setDescription('Supprimer les messages des X derniers jours (0-7)').setMinValue(0).setMaxValue(7)),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) { await interaction.reply({ content: 'Cette commande doit être utilisée sur un serveur.', ephemeral: true }); return; }
      if (!isStaff(guild, interaction.member, PermissionsBitField.Flags.BanMembers)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à bannir des membres.", ephemeral: true });
        return;
      }

      const user = interaction.options.getUser('membre', true);
      const reason = (interaction.options.getString('raison') || '').trim();
      const deleteDays = interaction.options.getInteger('supprimer_messages') ?? 0;

      if (user.id === interaction.user.id) { await interaction.reply({ content: 'Tu ne peux pas te bannir toi-même.', ephemeral: true }); return; }
      if (user.id === interaction.client.user.id) { await interaction.reply({ content: 'Je ne vais pas me bannir moi-même 🙃', ephemeral: true }); return; }

      // Toujours défer avant le moindre appel réseau (fetch de membre, etc.) :
      // Discord invalide l'interaction si elle n'est pas accusée réception
      // sous 3s, et un fetch peut prendre plus longtemps que ça.
      await interaction.deferReply({ ephemeral: true });

      const targetMember = await guild.members.fetch(user.id).catch(() => null);
      if (targetMember && !targetMember.bannable) {
        await interaction.editReply({ content: 'Je ne peux pas bannir ce membre (rôle trop haut ou permissions insuffisantes).' });
        return;
      }

      try {
        const dm = new EmbedBuilder()
          .setColor(0xC0392B)
          .setTitle('🔨 Tu as été banni·e')
          .setDescription(`Tu as été banni·e de **${guild.name}**.`)
          .addFields({ name: '📝 Raison', value: reason || 'Aucune raison fournie' })
          .setTimestamp();
        await user.send({ embeds: [dm] });
      } catch (e) { /* DMs fermés, on continue */ }

      try {
        await guild.members.ban(user.id, { reason: reason || undefined, deleteMessageSeconds: deleteDays * 86400 });
      } catch (err) {
        await interaction.editReply({ content: `Échec du bannissement: ${err && err.message ? err.message : String(err)}` });
        return;
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(0xC0392B)
        .setTitle('🔨 Membre banni')
        .addFields(
          { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
          { name: '📝 Raison', value: reason || 'Aucune raison fournie' }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      if (interaction.channel) await interaction.channel.send({ embeds: [resultEmbed] }).catch(() => {});

      addSanction(user.id, {
        type: 'ban',
        targetTag: user.tag,
        reason: reason || null,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        guildId: guild.id
      });

      await interaction.editReply({ content: `✅ ${user.tag} a été banni·e.` });
    } catch (err) {
      logger.error(['Erreur /ban:', err]);
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
    }
  }
};
