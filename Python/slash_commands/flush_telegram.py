"""/flush-telegram - force flush of Telegram queue (admin only)."""
from logger import Logger
from telegram_bridge import get_bridge
logger = Logger()
name = 'flush-telegram'
description = "Force l'envoi immédiat des messages en file vers Telegram (Administrateur uniquement)"

async def execute(interaction, **kwargs):
    try:
        # basic admin check
        member = getattr(interaction, 'member', None)
        is_admin = False
        try:
            is_admin = getattr(member.guild_permissions, 'administrator', False)
        except Exception:
            is_admin = False
        if not is_admin:
            await interaction.response.send_message('Vous devez être administrateur pour utiliser cette commande.', ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        tg = get_bridge()
        try:
            # call internal flush implementation if available
            if hasattr(tg, '_flush'):
                tg._flush()
                await interaction.followup.send("Flush Telegram exécuté (tentative d'envoi immédiat).", ephemeral=True)
            else:
                await interaction.followup.send("Le module Telegram n'est pas disponible sur ce serveur.", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f'Erreur lors du flush Telegram: {e}', ephemeral=True)
    except Exception as err:
        logger.error(['Erreur /flush-telegram:', err])
        try:
            await interaction.followup.send('Erreur interne.', ephemeral=True)
        except Exception:
            pass
