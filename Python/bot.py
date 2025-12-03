"""Entrypoint minimal pour la version Python OOP du bot.
Ce fichier expose la classe Bot et permet de démarrer le client.
"""
from dotenv import load_dotenv
import os
import asyncio

load_dotenv()

from discord import Intents, app_commands
from logger import Logger, command_invocation
from verification import VerificationManager
from telegram_bridge import get_bridge
import importlib.util
import pathlib
import sys


class Bot:
    """Classe principale du bot.

    Contrat minimal:
    - initialise discord Client
    - initialise Logger, TelegramBridge, VerificationManager
    - charge les commandes depuis le package commands
    """
    def __init__(self):
        self.token = os.getenv('DISCORD_TOKEN')
        intents = Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.members = True
        # lazy import to avoid heavy imports at module load
        import discord
        self.client = discord.Client(intents=intents)
        self.logger = Logger()
        self.telegram = get_bridge()
        self.verification = VerificationManager(self.client, self.logger, self.telegram)
        # containers for commands
        self.prefix_commands = {}
        self.slash_commands = {}

        # prepare paths
        self.base_dir = pathlib.Path(__file__).resolve().parent
        self.commands_dir = self.base_dir / 'commands'
        self.slash_dir = self.base_dir / 'slash_commands'
        # load commands at init (best-effort)
        try:
            self._load_prefix_commands()
            self._load_slash_commands()
        except Exception:
            pass

    def run(self):
        if not self.token:
            self.logger.warn('Aucun token Discord dans .env (DISCORD_TOKEN)')
            return

        @self.client.event
        async def on_ready():
            self.logger.info(f'Connected as {self.client.user}')
            # register slash-commands to the client's tree
            try:
                for name, mod in self.slash_commands.items():
                    # build a wrapper command that calls the module's execute
                    async def _wrap(interaction, *, _mod=mod):
                        try:
                            await _mod.execute(interaction)
                        except Exception as e:
                            self.logger.error(f'Erreur slash {getattr(_mod, "name", name)}: {e}')
                    cmd = app_commands.Command(name=getattr(mod, 'name', name), description=getattr(mod, 'description', '') or 'Slash command', callback=_wrap)
                    try:
                        self.client.tree.add_command(cmd)
                    except Exception:
                        # ignore duplicates
                        pass
                # sync commands (global or guild-specific handled by env later)
                try:
                    self.client.loop.create_task(self.client.tree.sync())
                except Exception:
                    pass
            except Exception:
                pass

        # delegate events to verification manager
        self.verification.attach_handlers()

        # message handler for prefix commands
        @self.client.event
        async def on_message(message):
            if message.author.bot:
                return
            prefix = os.getenv('PREFIX', '!')
            if not message.content or not message.content.startswith(prefix):
                return
            parts = message.content[len(prefix):].strip().split()
            if not parts:
                return
            cmd = parts[0].lower()
            args = parts[1:]
            command = self.prefix_commands.get(cmd)
            try:
                command_invocation({
                    'command': cmd,
                    'userTag': message.author.tag,
                    'userId': message.author.id,
                    'guildId': message.guild.id if message.guild else None,
                    'channelId': message.channel.id,
                    'args': args
                })
            except Exception:
                pass
            if not command:
                return
            try:
                await command.execute(message, args)
            except Exception as e:
                self.logger.error(f'Erreur lors de l\'exécution de la commande {cmd}: {e}')
                try:
                    await message.reply('Une erreur est survenue lors de l\'exécution de la commande.')
                except Exception:
                    pass

        # interactionCreate for chat input commands is handled by added app_commands callbacks

        self.client.run(self.token)

    def _load_prefix_commands(self):
        if not self.commands_dir.exists():
            self.logger.warn('Aucun dossier `Python/commands` — pas de commandes prefix')
            return
        sys.path.insert(0, str(self.base_dir))
        for p in self.commands_dir.iterdir():
            if p.suffix != '.py' or p.stem.startswith('_'):
                continue
            try:
                spec = importlib.util.spec_from_file_location(f'commands.{p.stem}', str(p))
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                # expected: class with .name and .execute
                cmdobj = None
                for attr in dir(mod):
                    v = getattr(mod, attr)
                    if hasattr(v, 'name') and hasattr(v, 'execute'):
                        cmdobj = v
                        break
                if cmdobj and getattr(cmdobj, 'name', None):
                    self.prefix_commands[cmdobj.name] = cmdobj
                    self.logger.info(f'Chargée commande préfixe: {cmdobj.name}')
            except Exception as e:
                self.logger.warn(f'Erreur en important commande {p.name}: {e}')

    def _load_slash_commands(self):
        if not self.slash_dir.exists():
            self.logger.warn('Aucun dossier `Python/slash_commands` — pas de slash-commands')
            return
        sys.path.insert(0, str(self.base_dir))
        for p in self.slash_dir.iterdir():
            if p.suffix != '.py' or p.stem.startswith('_'):
                continue
            try:
                spec = importlib.util.spec_from_file_location(f'slash_commands.{p.stem}', str(p))
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                if getattr(mod, 'name', None) and getattr(mod, 'execute', None):
                    self.slash_commands[mod.name] = mod
                    self.logger.info(f'Chargée slash-command: {mod.name}')
            except Exception as e:
                self.logger.warn(f'Erreur en important slash-command {p.name}: {e}')


def main():
    bot = Bot()
    bot.run()


if __name__ == '__main__':
    main()
