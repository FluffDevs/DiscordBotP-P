"""Commande prefix `say` traduite depuis JS.
Usage: executed as `await execute(message, args)`
"""
import os
from logger import Logger
logger = Logger()


name = 'say'
description = "Faire dire un message au bot (prefix). Usage: !say [--webhook] message"


async def execute(message, args):
    try:
        if message.author.bot:
            return

        owner_id = os.getenv('OWNER_ID')
        is_owner = owner_id and str(message.author.id) == str(owner_id)
        has_admin = False
        try:
            has_admin = getattr(message.member.guild_permissions, 'administrator', False)
        except Exception:
            has_admin = False
        if not is_owner and not has_admin:
            return await message.reply("Vous n'êtes pas autorisé à utiliser cette commande.")

        use_webhook = False
        if args and len(args) > 0 and args[0] == '--webhook':
            use_webhook = True
            args = args[1:]

        content = ' '.join(args).strip()
        if not content:
            return await message.reply('Veuillez fournir un message à envoyer.')

        if use_webhook:
            try:
                # dynamic import of discord types
                webhook = None
                try:
                    webhook = await message.channel.create_webhook(name=str(message.author))
                except Exception:
                    webhook = None
                if webhook:
                    await webhook.send(content)
                    try:
                        await webhook.delete(reason='cleanup after say command')
                    except Exception:
                        logger.debug('webhook cleanup failed')
                    logger.info(f"say (prefix) sent via webhook by {getattr(message.author, 'name', message.author)}")
                else:
                    await message.channel.send(content)
                    logger.info('say sent as fallback message')
            except Exception as e:
                logger.error(f'Erreur say webhooks: {e}')
                return await message.reply(f"Erreur lors de l'envoi: {e}")
        else:
            try:
                await message.channel.send(content)
                logger.info('say (prefix) sent as bot message')
            except Exception as e:
                logger.error(f'Erreur say send: {e}')
                return await message.reply(f"Erreur lors de l'envoi: {e}")

        try:
            await message.delete()
        except Exception:
            logger.debug('invoking message delete failed')
        try:
            await message.channel.send("Ok, c'est envoyé.")
        except Exception:
            logger.debug('confirmation send failed')
    except Exception as err:
        logger.error(['Erreur dans la commande say prefix:', err])
        try:
            await message.reply(f"Erreur lors de l'envoi: {err}")
        except Exception:
            pass
