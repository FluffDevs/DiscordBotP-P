import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } from 'discord.js';
import logger from '../logger.js';
import { isStaff, parseDuration, formatDuration, addSanction } from '../moderation.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // limite Discord

export default {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Mettre un membre en sourdine (timeout) temporairement')
    .addUserOption(o => o.setName('membre').setDescription('Le membre à mute').setRequired(true))
    .addStringOption(o => o.setName('duree').setDescription('Durée (ex: 10m, 2h, 1d, max 28j)').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison du mute (optionnel)')),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) { await interaction.reply({ content: 'Cette commande doit être utilisée sur un serveur.', ephemeral: true }); return; }
      if (!isStaff(guild, interaction.member, PermissionsBitField.Flags.ModerateMembers)) {
        await interaction.reply({ content: "Vous n'êtes pas autorisé·e à mute des membres.", ephemeral: true });
        return;
      }

      const user = interaction.options.getUser('membre', true);
      const durationRaw = interaction.options.getString('duree', true);
      const reason = (interaction.options.getString('raison') || '').trim();

      const ms = parseDuration(durationRaw);
      if (!ms || ms <= 0) {
        await interaction.reply({ content: 'Durée invalide. Utilise un format comme `10m`, `2h`, `1d`, `1w`.', ephemeral: true });
        return;
      }
      if (ms > MAX_TIMEOUT_MS) {
        await interaction.reply({ content: 'La durée maximum autorisée par Discord pour un timeout est de 28 jours.', ephemeral: true });
        return;
      }

      if (user.id === interaction.user.id) { await interaction.reply({ content: 'Tu ne peux pas te mute toi-même.', ephemeral: true }); return; }
      if (user.id === interaction.client.user.id) { await interaction.reply({ content: 'Je ne vais pas me mute moi-même 🙃', ephemeral: true }); return; }

      // Toujours défer avant le moindre appel réseau (fetch de membre, etc.) :
      // Discord invalide l'interaction si elle n'est pas accusée réception
      // sous 3s, et un fetch peut prendre plus longtemps que ça.
      await interaction.deferReply({ ephemeral: true });

      const targetMember = await guild.members.fetch(user.id).catch(() => null);
      if (!targetMember) { await interaction.editReply({ content: 'Ce membre n\'est pas sur le serveur.' }); return; }
      if (!targetMember.moderatable) {
        await interaction.editReply({ content: 'Je ne peux pas mute ce membre (rôle trop haut ou permissions insuffisantes).' });
        return;
      }

      const durationLabel = formatDuration(ms);

      try {
        const dm = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle('🔇 Tu as été mis·e en sourdine')
          .setDescription(`Tu ne peux plus envoyer de messages sur **${guild.name}** pendant ${durationLabel}.`)
          .addFields({ name: '📝 Raison', value: reason || 'Aucune raison fournie' })
          .setTimestamp();
        await user.send({ embeds: [dm] });
      } catch (e) { /* DMs fermés, on continue */ }

      try {
        await targetMember.timeout(ms, reason || undefined);
      } catch (err) {
        await interaction.editReply({ content: `Échec du timeout: ${err && err.message ? err.message : String(err)}` });
        return;
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🔇 Membre mis en sourdine')
        .addFields(
          { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
          { name: '⏱️ Durée', value: durationLabel, inline: true },
          { name: '📝 Raison', value: reason || 'Aucune raison fournie' }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      if (interaction.channel) await interaction.channel.send({ embeds: [resultEmbed] }).catch(() => {});

      addSanction(user.id, {
        type: 'timeout',
        targetTag: user.tag,
        durationMs: ms,
        reason: reason || null,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        guildId: guild.id
      });

      await interaction.editReply({ content: `✅ ${user.tag} est en sourdine pendant ${durationLabel}.` });
    } catch (err) {
      logger.error(['Erreur /timeout:', err]);
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: 'Erreur interne.', ephemeral: true }).catch(() => {});
    }
  }
};
