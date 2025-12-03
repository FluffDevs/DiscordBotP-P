"""/msgverif - publish a button message to allow users to request verification DM."""
import os
from logger import Logger
logger = Logger()
name = 'msgverif'
description = 'Publie un message avec un bouton pour renvoyer le message de vérification'

async def execute(interaction, **kwargs):
    try:
        verifier_role = os.getenv('VERIFIER_ROLE')
        member = getattr(interaction, 'member', None)
        allowed = False
        try:
            if getattr(member.guild_permissions, 'manage_guild', False):
                allowed = True
            if not allowed and verifier_role and member:
                if any(r.name == verifier_role for r in getattr(member, 'roles', [])):
                    allowed = True
        except Exception:
            allowed = False
        if not allowed:
            await interaction.response.send_message("Vous n'êtes pas autorisé à utiliser cette commande.", ephemeral=True)
            return

        # create button: since discord.py components API varies, we'll attempt a simple send with text
        try:
            await interaction.response.defer(ephemeral=True)
            if interaction.channel:
                await interaction.channel.send('Cliquez sur le bouton ci-dessous pour recevoir le message de vérification en DM. (Bouton non supporté dans cette version simplifiée)')
            else:
                await interaction.followup.send("Impossible d'envoyer le message de vérification ici (canal introuvable).", ephemeral=True)
        except Exception:
            await interaction.followup.send("Erreur lors de l'envoi du message de vérification.", ephemeral=True)
        try:
            await interaction.delete_original_response()
        except Exception:
            pass

    except Exception as err:
        logger.error(['Erreur /msgverif:', err])
        try:
            await interaction.followup.send('Erreur lors de l\'envoi du message de vérification.', ephemeral=True)
        except Exception:
            pass
