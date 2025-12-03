"""Commande prefix `testtg` traduite depuis JS."""
import os
from logger import Logger
from telegram_bridge import get_bridge
logger = Logger()

name = 'testtg'
description = 'Envoie un message de test vers le groupe Telegram configuré (best-effort)'


async def execute(message, args):
    try:
        if not message.guild:
            await message.reply('Cette commande doit être exécutée depuis un serveur Discord.')
            return
        member = message.member
        try:
            is_admin = getattr(member.guild_permissions, 'administrator', False)
        except Exception:
            is_admin = False
        if not is_admin:
            await message.reply('Vous devez être administrateur pour utiliser cette commande.')
            return

        text = ' '.join(args) if args and len(args) else f'Test Telegram depuis Discord par {getattr(message.author, "name", message.author)} ({getattr(message.author, "id", "unknown")})'
        tg = get_bridge()
        ok = False
        try:
            ok = tg.enqueue_verification(text)
        except Exception:
            ok = False
        if ok:
            await message.reply('Message de test envoyé vers Telegram (mis en file).')
        else:
            await message.reply("Échec: Telegram non configuré ou impossible d'enregistrer le message. Vérifiez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID.")
    except Exception as err:
        logger.error(['Erreur testtg:', err])
        try:
            await message.reply('Erreur lors de l\'envoi du test vers Telegram.')
        except Exception:
            pass
