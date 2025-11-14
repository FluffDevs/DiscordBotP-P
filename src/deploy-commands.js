import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // optional: if provided, registers to a guild for instant update

if (!token || !clientId) {
  console.error('Veuilllez définir DISCORD_TOKEN et CLIENT_ID dans .env avant de déployer les commandes.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commandsPath = path.join(__dirname, 'slash-commands');

const commands = [];
if (fs.existsSync(commandsPath)) {
  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(path.join(commandsPath, file)).href);
      const command = mod.default ?? mod;
      if (command && command.data) {
        commands.push(command.data.toJSON());
      } else {
        console.warn(`Le fichier ${file} n'exporte pas de 'data' (SlashCommandBuilder).`);
      }
    } catch (err) {
      console.error('Erreur en important', file, err.message || err);
    }
  }
}

const rest = new REST({ version: '10' }).setToken(token);

try {
  if (guildId) {
    console.log(`Déploiement des ${commands.length} commandes au guild ${guildId}...`);
    const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('Commandes déployées (guild):', data.length);
  } else {
    console.log(`Déploiement des ${commands.length} commandes en global (cela peut prendre jusqu'à 1 heure)...`);
    const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Commandes déployées (global):', data.length);
  }
} catch (err) {
  console.error('Erreur lors du déploiement des commandes:', err);
}
