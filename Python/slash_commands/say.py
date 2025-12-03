"""Slash /say - simplified translation from JS.
This module exposes `name`, `description` and async `execute(interaction)`.
"""
import os
import asyncio
from logger import Logger
logger = Logger()

name = 'say'
description = "Faire dire un message au bot ou exécuter une commande interne"


async def execute(interaction, **kwargs):
    try:
        data = interaction.data if hasattr(interaction, 'data') else None
        # Try to obtain options compatible with discord.py's Interaction
        try:
            options = interaction.data.get('options', {}) if interaction.data else {}
        except Exception:
            options = {}
        # For simplicity, try to read 'message' from kwargs
        text = kwargs.get('message') or options.get('message') or ''
        execute_flag = kwargs.get('execute', False)
        as_message = kwargs.get('as_message', False)
        use_webhook = kwargs.get('webhook', False)

        owner_id = os.getenv('OWNER_ID')
        is_owner = owner_id and str(interaction.user.id) == str(owner_id)
        has_admin = False
        try:
            m = interaction.guild.get_member(interaction.user.id)
            has_admin = getattr(m.guild_permissions, 'administrator', False)
        except Exception:
            has_admin = False
        if not is_owner and not has_admin:
            await interaction.response.send_message("Vous n'êtes pas autorisé à utiliser cette commande.", ephemeral=True)
            return

        if not execute_flag:
            if as_message:
                await interaction.response.defer(ephemeral=True)
                try:
                    await interaction.channel.send(text)
                    await interaction.followup.send('Message envoyé.', ephemeral=True)
                except Exception as e:
                    logger.error(['Erreur lors de l\'envoi du message:', e])
                    await interaction.followup.send(f"Erreur lors de l'envoi: {e}", ephemeral=True)
                return
            else:
                await interaction.response.send_message(text)
                return

        # executeFlag: interpret as a prefix command; very simplified: only supports ping
        raw = text
        prefix = os.getenv('PREFIX', '!')
        if raw.startswith(prefix):
            raw = raw[len(prefix):]
        parts = raw.strip().split()
        if not parts:
            await interaction.response.send_message('Aucune commande fournie.', ephemeral=True)
            return
        name_cmd = parts[0].lower()
        args = parts[1:]
        # Try to dynamically import command module from Python.commands
        try:
            mod = __import__(f'commands.{name_cmd}', fromlist=['*'])
            cmd = getattr(mod, 'execute', None)
            if cmd:
                # create a fake message object
                class FakeMessage:
                    def __init__(self, interaction, text):
                        self.content = text
                        self.author = interaction.user
                        self.member = getattr(interaction, 'member', None)
                        self.guild = getattr(interaction, 'guild', None)
                        self.channel = getattr(interaction, 'channel', None)
                    async def reply(self, content):
                        if not interaction.response.is_done():
                            await interaction.response.send_message(content)
                        else:
                            await interaction.followup.send(content)

                fake = FakeMessage(interaction, text)
                await cmd(fake, args)
                if not interaction.response.is_done():
                    await interaction.response.send_message(f"Commande `{name_cmd}` exécutée.")
                return
        except Exception as e:
            logger.error(['Erreur dans /say execute:', e])
            await interaction.response.send_message(f"Erreur lors de l'exécution: {e}", ephemeral=True)
            return

    except Exception as err:
        logger.error(['Erreur /say:', err])
        try:
            await interaction.response.send_message('Erreur lors de l\'exécution.', ephemeral=True)
        except Exception:
            pass
