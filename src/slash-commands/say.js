import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

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
        .setDescription('Si vrai, interprète le texte comme une commande interne et l\'exécute'))
    .addBooleanOption(option =>
      option.setName('as_message')
        .setDescription('Si vrai, envoie le texte directement dans le canal (peut déclencher d\'autres bots)'))
    .addBooleanOption(option =>
      option.setName('webhook')
        .setDescription('Si vrai, tente d\'envoyer via un webhook pour imiter un utilisateur (nécessite Manage Webhooks)')),

  async execute(interaction) {
    const text = interaction.options.getString('message', true);
  const executeFlag = interaction.options.getBoolean('execute') ?? false;
  const asMessage = interaction.options.getBoolean('as_message') ?? false;
  const useWebhook = interaction.options.getBoolean('webhook') ?? false;

    // Security: only allow owner (OWNER_ID in .env) or members with Administrator permission
    const ownerId = process.env.OWNER_ID;
    const isOwner = ownerId && interaction.user.id === ownerId;
    const hasAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    if (!isOwner && !hasAdmin) {
      return interaction.reply({ content: 'Vous n\'êtes pas autorisé à utiliser cette commande.', ephemeral: true });
    }

    // If not executing as a command, either send as a normal channel message (can trigger other bots)
    // or reply to the interaction depending on the asMessage flag.
    if (!executeFlag) {
      // By default, send the message into the channel so other bots can see it.
      if (asMessage) {
        // Try webhook first when sending as message, because many bots ignore messages sent by bot accounts.
        await interaction.deferReply({ ephemeral: true });
        const canManageWebhooks = !!(interaction.guild && interaction.guild.members && interaction.guild.members.me && interaction.guild.members.me.permissions && interaction.guild.members.me.permissions.has && interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageWebhooks));
        if (canManageWebhooks) {
          try {
            const webhookName = `${interaction.user.username}`;
            const avatar = typeof interaction.user.displayAvatarURL === 'function' ? interaction.user.displayAvatarURL() : undefined;
            const webhook = await interaction.channel.createWebhook({ name: webhookName, avatar });
            await webhook.send({ content: text });
            try { await webhook.delete('cleanup after /say'); } catch (e) { logger.debug(`webhook cleanup failed (/say): ${e && e.message ? e.message : e}`); }
            logger.info(`/say sent via webhook by ${interaction.user.tag} in ${interaction.guild ? interaction.guild.id : 'DM'}`);
            return interaction.editReply({ content: 'Message envoyé (via webhook).' });
          } catch (err) {
            logger.error(['Erreur lors de l\'envoi via webhook (fallback to normal send):', err]);
            // fallback to normal send below
          }
        }
        try {
          await interaction.channel.send(text);
          logger.info(`/say sent as channel message by ${interaction.user.tag} in ${interaction.guild ? interaction.guild.id : 'DM'}`);
          return interaction.editReply({ content: 'Message envoyé.' });
        } catch (err2) {
          logger.error(['Erreur lors de l\'envoi du message:', err2]);
          if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: `Erreur lors de l'envoi: ${err2.message || String(err2)}`, ephemeral: true });
          }
          return interaction.followUp({ content: `Erreur lors de l'envoi: ${err2.message || String(err2)}`, ephemeral: true });
        }
      }

      // Default: send as a reply to the interaction (visible as from the bot but acknowledges the interaction)
      return interaction.reply({ content: text });
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

  const mod = await import(pathToFileURL(commandFile));
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

function pathToFileURL(p) {
  // small helper to convert path to file URL for dynamic import
  const url = new URL(`file://${p.replace(/\\/g, '/')}`);
  return url.href;
}
