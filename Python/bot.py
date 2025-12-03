"""Entrypoint minimal pour la version Python OOP du bot.
Ce fichier expose la classe Bot et permet de démarrer le client.
"""
from dotenv import load_dotenv
import os
import asyncio

load_dotenv()

from discord import Intents
from logger import Logger
from verification import VerificationManager
from telegram_bridge import TelegramBridge


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
        self.telegram = TelegramBridge()
        self.verification = VerificationManager(self.client, self.logger, self.telegram)

    def run(self):
        if not self.token:
            self.logger.warn('Aucun token Discord dans .env (DISCORD_TOKEN)')
            return

        @self.client.event
        async def on_ready():
            self.logger.info(f'Connected as {self.client.user}')

        # delegate events to verification manager
        self.verification.attach_handlers()

        self.client.run(self.token)


def main():
    bot = Bot()
    bot.run()


if __name__ == '__main__':
    main()
