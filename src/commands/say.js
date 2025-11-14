import { PermissionFlagsBits } from 'discord.js';

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
        try { await webhook.delete('cleanup after say command'); } catch (e) { /* ignore */ }
      } else {
        await message.channel.send(content);
      }

      // Try to delete the invoking message to avoid leaving a trace
      try { await message.delete(); } catch (e) { /* ignore */ }
    } catch (err) {
      console.error('Erreur dans la commande say prefix:', err);
      return message.reply(`Erreur lors de l'envoi: ${err.message || String(err)}`);
    }
  }
};
