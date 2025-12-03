/*
 * Peluche Bot — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initVerification } from './verification.js';
import logger, { commandInvocation } from './logger.js';

const token = process.env.DISCORD_TOKEN;
const prefix = process.env.PREFIX ?? '!';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  // We need additional partials to correctly handle reactions and messages in DMs/threads
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

// Setup commands collection
const commands = new Map();
// Slash commands collection
const slashCommands = new Map();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commandsPath = path.join(__dirname, 'commands');
const slashCommandsPath = path.join(__dirname, 'slash-commands');

if (fs.existsSync(commandsPath)) {
  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const fileUrl = pathToFileURL(path.join(commandsPath, file)).href;
      const mod = await import(fileUrl);
      const command = mod.default ?? mod;
      if (command && command.name) {
        commands.set(command.name, command);
        logger.info(`Chargée commande: ${command.name}`);
      } else {
        logger.warn(`Fichier de commande ${file} n'exporte pas un objet { name, execute }`);
      }
    } catch (err) {
      logger.error(`Erreur en important la commande ${file}: ${err && err.message ? err.message : String(err)}`);
    }
  }
} else {
  logger.warn('Aucun dossier commands/ trouvé — créez `src/commands` pour y placer des commandes.');
}

// Charger les slash-commands
if (fs.existsSync(slashCommandsPath)) {
  const files = fs.readdirSync(slashCommandsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const fileUrl = pathToFileURL(path.join(slashCommandsPath, file)).href;
      const mod = await import(fileUrl);
      const command = mod.default ?? mod;
      if (command && command.data && command.data.name) {
        slashCommands.set(command.data.name, command);
        logger.info(`Chargée slash-commande: ${command.data.name}`);
      } else {
        logger.warn(`Fichier de slash-command ${file} n'exporte pas { data, execute }`);
      }
    } catch (err) {
      logger.error(`Erreur en important la slash-command ${file}: ${err && err.message ? err.message : String(err)}`);
    }
  }
} else {
  logger.warn('Aucun dossier slash-commands/ trouvé — créez `src/slash-commands` pour y placer des commandes slash.');
}

client.once('clientReady', () => {
  logger.info(`${client.user.tag} connecté`);
});

// Log non-chat interactions (buttons, select menus, modals) centrally so we
// capture any interaction even if handled elsewhere. Skip chat input commands
// because they are logged in the dedicated handler below.
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand && interaction.isChatInputCommand()) return; // handled later
    const kind = interaction.type ?? 'interaction';
    const name = interaction.customId ?? interaction.commandName ?? kind;
    commandInvocation({
      command: name,
      commandName: name,
      userTag: interaction.user ? interaction.user.tag : 'unknown',
      userId: interaction.user ? interaction.user.id : 'unknown',
      guildId: interaction.guild ? interaction.guild.id : null,
      channelId: interaction.channel ? interaction.channel.id : null,
      options: interaction.options?.data ? interaction.options.data : undefined
    });
  } catch (e) { /* ignore */ }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();
  const command = commands.get(cmd);
  if (!command) return;
  // Log who invoked the prefix command
  try {
    commandInvocation({
      command: cmd,
      userTag: message.author.tag,
      userId: message.author.id,
      guildId: message.guild ? message.guild.id : null,
      channelId: message.channel.id,
      args
    });
  } catch (e) { /* ignore logging failure */ }
  try {
    await command.execute(message, args);
  } catch (err) {
    logger.error(`Erreur lors de l'exécution de la commande ${cmd}: ${err && err.message ? err.message : String(err)}`);
    message.reply('Une erreur est survenue lors de l\'exécution de la commande.');
  }
});

// Gérer les interactions (slash commands)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = slashCommands.get(interaction.commandName);
  if (!cmd) return;
  // Log who invoked the slash command
  try {
    const opts = interaction.options?.data ? interaction.options.data : undefined;
    commandInvocation({
      commandName: interaction.commandName,
      command: interaction.commandName,
      userTag: interaction.user.tag,
      userId: interaction.user.id,
      guildId: interaction.guild ? interaction.guild.id : null,
      channelId: interaction.channel ? interaction.channel.id : null,
      options: opts
    });
  } catch (e) { /* ignore logging failure */ }
  try {
    await cmd.execute(interaction);
  } catch (err) {
    logger.error(`Erreur lors de l'exécution de la slash-command ${interaction.commandName}: ${err && err.message ? err.message : String(err)}`);
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: 'Une erreur est survenue lors de l\'exécution de la commande.', ephemeral: true });
    } else {
      interaction.reply({ content: 'Une erreur est survenue lors de l\'exécution de la commande.', ephemeral: true });
    }
  }
});

if (!token) {
  logger.warn('Aucun token détecté dans .env (DISCORD_TOKEN). Remplissez .env avant de démarrer le bot.');
} else {
  client.login(token).catch(err => {
    logger.error('Échec login : ' + (err && err.message ? err.message : String(err)));
  });
  // Initialiser la logique de vérification (gestion des nouveaux membres, réactions, etc.)
  initVerification(client);
}
