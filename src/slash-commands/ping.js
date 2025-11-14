import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Répond pong (slash) 🏓'),
  async execute(interaction) {
    await interaction.reply('Pong 🏓 (slash)');
  }
};
