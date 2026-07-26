import { SlashCommandBuilder, PermissionsBitField } from 'discord.js';
import { buildVerificationStartMessage } from '../verification.js';
/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Poste un message public avec un select menu "Choisis ta langue". Choisir une
 * langue démarre directement la vérification (cooldown + rôle non-vérifié)
 * ET ouvre le formulaire (Modal) — un seul geste, aucun DM avant la fin.
 * Voir src/verification.js (customId 'verif_lang_select').
 */
export default {
  data: new SlashCommandBuilder()
    .setName('nvmenu')
    .setDescription('Publie le message de vérification (choix de langue + formulaire combinés)'),
  async execute(interaction) {
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

    const { content, components } = buildVerificationStartMessage();

    try {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      if (interaction.channel) {
        await interaction.channel.send({ content, components });
      } else {
        await interaction.followUp({ content: 'Impossible d\'envoyer le message de vérification ici (canal introuvable).', ephemeral: true }).catch(() => {});
      }
    } catch (err) {
      await interaction.followUp({ content: 'Erreur lors de l\'envoi du message de vérification.', ephemeral: true }).catch(() => {});
    }
    try { await interaction.deleteReply().catch(() => {}); } catch (e) { /* ignore */ }
  }
};
