import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client, GatewayIntentBits, Partials } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const prefix = process.env.PREFIX ?? '!';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
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
        console.log(`Chargée commande: ${command.name}`);
      } else {
        console.warn(`Fichier de commande ${file} n'exporte pas un objet { name, execute }`);
      }
    } catch (err) {
      console.error(`Erreur en important la commande ${file}:`, err && err.message ? err.message : err);
    }
  }
} else {
  console.log('Aucun dossier commands/ trouvé — créez `src/commands` pour y placer des commandes.');
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
        console.log(`Chargée slash-commande: ${command.data.name}`);
      } else {
        console.warn(`Fichier de slash-command ${file} n'exporte pas { data, execute }`);
      }
    } catch (err) {
      console.error(`Erreur en important la slash-command ${file}:`, err && err.message ? err.message : err);
    }
  }
} else {
  console.log('Aucun dossier slash-commands/ trouvé — créez `src/slash-commands` pour y placer des commandes slash.');
}

client.once('ready', () => {
  console.log(`${client.user.tag} connecté`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();
  const command = commands.get(cmd);
  if (!command) return;
  try {
    await command.execute(message, args);
  } catch (err) {
    console.error('Erreur lors de l\'exécution de la commande', cmd, err);
    message.reply('Une erreur est survenue lors de l\'exécution de la commande.');
  }
});

// Gérer les interactions (slash commands)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = slashCommands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error('Erreur lors de l\'exécution de la slash-command', interaction.commandName, err);
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: 'Une erreur est survenue lors de l\'exécution de la commande.', ephemeral: true });
    } else {
      interaction.reply({ content: 'Une erreur est survenue lors de l\'exécution de la commande.', ephemeral: true });
    }
  }
});

if (!token) {
  console.warn('Aucun token détecté dans .env (DISCORD_TOKEN). Remplissez .env avant de démarrer le bot.');
} else {
  client.login(token).catch(err => {
    console.error('Échec login :', err && err.message ? err.message : err);
  });
}
