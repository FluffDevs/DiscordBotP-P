"""/liste - list telegram queue (admin only)."""
from logger import Logger
from telegram_bridge import get_bridge
logger = Logger()
name = 'liste'
description = "Affiche la liste des messages en attente d'envoi sur Telegram (Administrateur seulement)"

async def execute(interaction, **kwargs):
    try:
        member = getattr(interaction, 'member', None)
        is_admin = False
        try:
            is_admin = getattr(member.guild_permissions, 'administrator', False)
        except Exception:
            is_admin = False
        if not is_admin:
            await interaction.response.send_message('Vous devez être administrateur pour utiliser cette commande.', ephemeral=True)
            return

        tg = get_bridge()
        queue = tg.get_queue() if hasattr(tg, 'get_queue') else []
        if not queue:
            await interaction.response.send_message('✅ Aucune message en attente dans la file Telegram.', ephemeral=True)
            return

        # build printable chunks
        MAX_CHUNK = 1800
        items = [f"{i+1}. {str(q)[:1000].replace('\n',' ')}" for i, q in enumerate(queue)]
        await interaction.response.defer(ephemeral=True)
        first = True
        current = ''
        for line in items:
            if (len(current) + 1 + len(line)) > MAX_CHUNK:
                if first:
                    await interaction.followup.send(current, ephemeral=True)
                    first = False
                else:
                    await interaction.followup.send(current, ephemeral=True)
                current = line + '\n'
            else:
                current = (current + '\n' + line) if current else line
        if current:
            await interaction.followup.send(current, ephemeral=True)

    except Exception as err:
        logger.error(['Erreur /liste:', err])
        try:
            await interaction.followup.send('Erreur lors de la récupération de la file Telegram.', ephemeral=True)
        except Exception:
            pass
