import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } from 'discord.js';

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

    await interaction.reply({ content: 'Cliquez sur le bouton ci-dessous pour recevoir le message de vérification en DM.', components: [row] });
  }
};
