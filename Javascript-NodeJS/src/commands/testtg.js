import logger from '../logger.js';

export default {
  name: 'testtg',
  description: 'Envoie un message de test vers le groupe Telegram configuré (best-effort)',
  async execute(message, args) {
    try {
      // Restrict to Administrators only
      if (!message.guild) {
        await message.reply('Cette commande doit être exécutée depuis un serveur Discord.');
        return;
      }
      const member = message.member;
      if (!member || !(member.permissions && member.permissions.has && member.permissions.has(0x00000008))) { // Administrator flag
        await message.reply('Vous devez être administrateur pour utiliser cette commande.');
        return;
      }
      // Charger le module telegram
      const { default: telegram } = await import('../telegram.js');
      const text = args && args.length ? args.join(' ') : `Test Telegram depuis Discord par ${message.author.tag} (${message.author.id})`;
      // enqueue the message (will be batched and persisted)
      const ok = telegram.enqueueVerification ? telegram.enqueueVerification(text) : (telegram.enqueueLog ? telegram.enqueueLog(text) : false);
      if (ok) {
        await message.reply('Message de test envoyé vers Telegram (mis en file).');
      } else {
        await message.reply('Échec: Telegram non configuré ou impossible d\'enregistrer le message. Vérifiez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID.');
      }
    } catch (err) {
      try { logger.error(['Erreur testtg:', err]); } catch (e) {}
      await message.reply('Erreur lors de l\'envoi du test vers Telegram.');
    }
  }
};
