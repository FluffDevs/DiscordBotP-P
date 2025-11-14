import { SlashCommandBuilder } from 'discord.js';
/*
 * Peluche Bot — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */
export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Répond pong (slash) 🏓'),
  async execute(interaction) {
    await interaction.reply('Pong 🏓 (slash)');
  }
};
