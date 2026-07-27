import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import logger from '../logger.js';

/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Faire dire un message au bot ou exécuter une commande interne')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Le texte que le bot doit envoyer / la commande à exécuter')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('execute')
        .setDescription('Si vrai, interprète le texte comme une commande interne et l\'exécute')),

  async execute(interaction) {
    const text = interaction.options.getString('message', true);
    const executeFlag = interaction.options.getBoolean('execute') ?? false;

    // Security: only allow owner (OWNER_ID in .env) or members with Administrator permission
    const ownerId = process.env.OWNER_ID;
    const isOwner = ownerId && interaction.user.id === ownerId;
    const hasAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    if (!isOwner && !hasAdmin) {
      return interaction.reply({ content: 'Vous n\'êtes pas autorisé à utiliser cette commande.', ephemeral: true });
    }

    // Le message doit venir du bot sans aucun lien visible avec l'auteur de la
    // commande : on ne répond jamais à l'interaction avec le texte (Discord
    // afficherait "a utilisé /say [auteur]") ni via un webhook qui imiterait
    // l'auteur. On envoie un message normal du bot, puis on referme la
    // confirmation éphémère (visible seulement par l'auteur) sans laisser de trace.
    if (!executeFlag) {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      try {
        await interaction.channel.send(text);
        logger.info(`/say message envoyé par ${interaction.user.tag} dans ${interaction.guild ? interaction.guild.id : 'DM'}`, { noTelegram: true });
        await interaction.deleteReply().catch(() => {});
      } catch (err) {
        logger.error(['Erreur lors de l\'envoi du message /say:', err]);
        await interaction.editReply({ content: `Erreur lors de l'envoi: ${err && err.message ? err.message : String(err)}` }).catch(() => {});
      }
      return;
    }

    // Otherwise, interpret text as a prefix command and execute the matching command module
    try {
      const prefix = process.env.PREFIX ?? '!';
      const raw = text.startsWith(prefix) ? text.slice(prefix.length) : text;
      const parts = raw.trim().split(/\s+/);
      const name = parts.shift().toLowerCase();
      const args = parts;

      if (!name) return interaction.reply({ content: 'Aucune commande fournie.', ephemeral: true });

      // Try to load command module from src/commands/<name>.js
  const commandFile = path.join(__dirname, '..', 'commands', `${name}.js`);
      if (!fs.existsSync(commandFile)) {
        return interaction.reply({ content: `Commande introuvable: ${name}`, ephemeral: true });
      }

  const mod = await import(pathToFileURL(commandFile).href);
      const command = mod.default ?? mod;
      if (!command || typeof command.execute !== 'function') {
        return interaction.reply({ content: `Le fichier de commande ${name} n'expose pas une fonction execute.`, ephemeral: true });
      }

      // Create a fake message-like object minimalement compatible avec les commands existantes
      const fakeMessage = {
        content: text,
        author: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        channel: interaction.channel,
        reply: async (replyContent) => {
          // Si l'interaction n'a pas encore répondu, utilise reply; sinon followUp
          if (!interaction.replied && !interaction.deferred) {
            return interaction.reply(typeof replyContent === 'string' ? { content: replyContent } : replyContent);
          }
          return interaction.followUp(typeof replyContent === 'string' ? { content: replyContent } : replyContent);
        }
      };

      // Execute the command and return a confirmation if nothing is replied by the command
      const res = await command.execute(fakeMessage, args);
      // If the command didn't send a reply through fakeMessage.reply, send a confirmation
      if (!interaction.replied && !interaction.deferred) {
        logger.info(`/say executed internal command ${name} by ${interaction.user.tag}`);
        return interaction.reply({ content: `Commande \`${name}\` exécutée.` });
      }
      return null;
    } catch (err) {
      logger.error(['Erreur dans /say execute:', err]);
      logger.debug(err && err.stack ? err.stack : String(err));
      return interaction.reply({ content: `Erreur lors de l'exécution: ${err.message || String(err)}`, ephemeral: true });
    }
  }
};
