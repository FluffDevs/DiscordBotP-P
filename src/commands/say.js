import { PermissionFlagsBits } from 'discord.js';
import logger from '../logger.js';
/*
 * Peluche Bot — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 */

export default {
  name: 'say',
  description: 'Faire dire un message au bot (prefix). Usage: !say [--webhook] message',
  async execute(message, args) {
    if (message.author.bot) return;

    const ownerId = process.env.OWNER_ID;
    const isOwner = ownerId && message.author.id === ownerId;
    const hasAdmin = message.member?.permissions?.has(PermissionFlagsBits.Administrator);
    if (!isOwner && !hasAdmin) {
      return message.reply('Vous n\'êtes pas autorisé à utiliser cette commande.');
    }

    let useWebhook = false;
    if (args[0] === '--webhook') {
      useWebhook = true;
      args.shift();
    }

    const content = args.join(' ').trim();
    if (!content) return message.reply('Veuillez fournir un message à envoyer.');

    try {
      if (useWebhook) {
        // Try to create a temporary webhook to better imitate an user
        const avatar = message.author.displayAvatarURL && message.author.displayAvatarURL();
        const webhook = await message.channel.createWebhook({ name: message.author.username, avatar });
        await webhook.send({ content });
        try { await webhook.delete('cleanup after say command'); } catch (e) { logger.debug(`webhook cleanup failed: ${e && e.message ? e.message : e}`); }
        logger.info(`say (prefix) sent via webhook by ${message.author.tag} in ${message.guild ? message.guild.id : 'DM'}`);
      } else {
        await message.channel.send(content);
        logger.info(`say (prefix) sent as bot message by ${message.author.tag} in ${message.guild ? message.guild.id : 'DM'}`);
      }

      // Try to delete the invoking message to avoid leaving a trace
      try { await message.delete(); } catch (e) { logger.debug(`invoking message delete failed: ${e && e.message ? e.message : e}`); }

      // Confirmation to the channel that the message was sent
      try {
        await message.channel.send("Ok, c'est envoyé.");
      } catch (e) { logger.debug(`confirmation send failed: ${e && e.message ? e.message : e}`); }
    } catch (err) {
      logger.error(['Erreur dans la commande say prefix:', err]);
      return message.reply(`Erreur lors de l'envoi: ${err.message || String(err)}`);
    }
  }
};
