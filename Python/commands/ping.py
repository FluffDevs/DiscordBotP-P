"""Commande `ping` de démonstration."""
class PingCommand:
    name = 'ping'

    @staticmethod
    async def execute(message, args):
        await message.channel.send('Pong!')
