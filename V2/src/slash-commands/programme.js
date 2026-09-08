import { SlashCommandBuilder } from 'discord.js';
import logger from '../logger.js';
import { getManager } from '../radioSchedule.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * /programme [jour] — affiche le programme radio (réponse éphémère).
 * jour : 0 = aujourd'hui, 1 = demain, … jusqu'à 6.
 */

export default {
  data: new SlashCommandBuilder()
    .setName('programme')
    .setDescription('Affiche le programme de Fluff Radio')
    .addIntegerOption((o) =>
      o
        .setName('jour')
        .setDescription("0 = aujourd'hui, 1 = demain, … (jusqu'à 6)")
        .setMinValue(0)
        .setMaxValue(6)
    ),

  async execute(interaction) {
    let mgr;
    try {
      mgr = getManager();
    } catch {
      await interaction.reply({ content: 'Module programme radio non initialisé (redémarrage nécessaire).', ephemeral: true });
      return;
    }
    const offset = interaction.options.getInteger('jour') ?? 0;
    await interaction.deferReply({ ephemeral: true });
    try {
      const embed = await mgr.dayEmbedByOffset(offset);
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } catch (err) {
      logger.error('Erreur /programme: ' + (err?.message ?? String(err)));
      await interaction.followUp({ content: 'Erreur en récupérant le programme.', ephemeral: true });
    }
  }
};
