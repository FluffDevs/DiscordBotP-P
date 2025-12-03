import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } from 'discord.js';
/*
 * Peluche Bot — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */
export default {
  data: new SlashCommandBuilder()
    .setName('msgverif')
    .setDescription('Publie un message avec un bouton pour renvoyer le message de vérification'),
  async execute(interaction) {
  // Permission: ManageGuild or VERIFIER_ROLE env
  const verifierRoleRaw = process.env.VERIFIER_ROLE;
  const verifierRole = (typeof verifierRoleRaw === 'string' ? verifierRoleRaw.trim() : verifierRoleRaw);
    const member = interaction.member;
    let allowed = false;
    if (member.permissions && member.permissions.has(PermissionsBitField.Flags.ManageGuild)) allowed = true;
    if (!allowed && verifierRole) {
      const r = interaction.guild.roles.cache.get(verifierRole) || interaction.guild.roles.cache.find(x => x.name === verifierRole);
      if (r && member.roles.cache.has(r.id)) allowed = true;
    }
    if (!allowed) {
      await interaction.reply({ content: "Vous n'êtes pas autorisé à utiliser cette commande.", ephemeral: true });
      return;
    }

    const button = new ButtonBuilder()
      .setCustomId('request_verif')
      .setLabel('Recevoir le message de vérification')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    // Send the visible button message to the channel but avoid leaving a reply to the user
    try {
      // Acknowledge the interaction silently (ephemeral) then post the actual message to the channel
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      if (interaction.channel) {
        await interaction.channel.send({ content: 'Cliquez sur le bouton ci-dessous pour recevoir le message de vérification en DM.', components: [row] });
      } else {
        await interaction.followUp({ content: 'Impossible d\'envoyer le message de vérification ici (canal introuvable).', ephemeral: true }).catch(() => {});
      }
    } catch (err) {
      await interaction.followUp({ content: 'Erreur lors de l\'envoi du message de vérification.', ephemeral: true }).catch(() => {});
    }
    // Remove the ephemeral acknowledgement so the user doesn't see any reply
    try { await interaction.deleteReply().catch(() => {}); } catch (e) { /* ignore */ }
  }
};
