"""Slash /testtg"""
import os
from logger import Logger
from telegram_bridge import get_bridge
logger = Logger()

name = 'testtg'
description = 'Envoie un message de test vers le groupe Telegram configuré (Administrateur seulement)'


async def execute(interaction, **kwargs):
    try:
        member = interaction.user
        # permission check: try to resolve member permissions if available
        is_admin = False
        try:
            m = interaction.guild.get_member(interaction.user.id)
            is_admin = getattr(m.guild_permissions, 'administrator', False)
        except Exception:
            # fallback: allow only in guild context
            is_admin = False
        if not is_admin:
            await interaction.response.send_message('Vous devez être administrateur pour utiliser cette commande.', ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        text = f'Test Telegram depuis Discord par {interaction.user}'
        ok = get_bridge().enqueue_verification(text)
        if ok:
            await interaction.followup.send('Message de test envoyé vers Telegram (mis en file).', ephemeral=True)
        else:
            await interaction.followup.send("Échec: Telegram non configuré ou impossible d'enregistrer le message. Vérifiez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID.", ephemeral=True)
    except Exception as err:
        logger.error(['Erreur /testtg:', err])
        try:
            await interaction.followup.send('Erreur lors de l\'envoi du test vers Telegram.', ephemeral=True)
        except Exception:
            pass
