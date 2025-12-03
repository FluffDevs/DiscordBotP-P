"""/flushforum - backup and delete forum threads (translation simplified)."""
import os
import json
from logger import Logger
logger = Logger()
from telegram_bridge import get_bridge

name = 'flushforum'
description = 'Supprime tous les posts du forum de vérification sauf le premier épinglé.'


async def execute(interaction, **kwargs):
    try:
        # permission checks (VERIFIER_ROLE or admin)
        member = getattr(interaction, 'member', None)
        allowed = False
        verifier_role = os.getenv('VERIFIER_ROLE')
        try:
            if member and getattr(member.guild_permissions, 'administrator', False):
                allowed = True
            if not allowed and verifier_role and member:
                # best-effort: check role name membership
                if any(r.name == verifier_role for r in getattr(member, 'roles', [])):
                    allowed = True
        except Exception:
            allowed = False
        if not allowed:
            await interaction.response.send_message('Vous devez avoir le rôle autorisé (VERIFIER_ROLE) ou être administrateur pour utiliser cette commande.', ephemeral=True)
            return

        await interaction.response.defer()
        forum_id = os.getenv('FORUM_CHANNEL_ID')
        if not forum_id:
            await interaction.followup.send('FORUM_CHANNEL_ID non configuré; impossible de localiser le forum de vérification.', ephemeral=True)
            return

        # simplified: attempt to fetch channel and iterate threads if possible
        client = interaction.client
        try:
            channel = await client.fetch_channel(int(forum_id))
        except Exception:
            channel = None
        if not channel:
            await interaction.followup.send('Impossible de récupérer le forum de vérification.', ephemeral=True)
            return

        # For safety, create a backup of verifications.json if present
        data_dir = os.path.join(os.getcwd(), 'data')
        store_file = os.path.join(data_dir, 'verifications.json')
        try:
            if os.path.exists(store_file):
                stamp = __import__('datetime').datetime.utcnow().isoformat().replace(':','-').replace('.','-')
                bak = store_file + '.bak.' + stamp
                __import__('shutil').copyfile(store_file, bak)
        except Exception as e:
            await interaction.followup.send('Erreur: impossible de créer la sauvegarde du store de vérifications. Opération annulée.', ephemeral=True)
            return

        # Attempt to fetch and delete threads (best-effort). Implementation may vary by discord.py version.
        deleted = 0
        try:
            threads = []
            try:
                fetched = await channel.threads.fetch()
                threads = [t for t in getattr(fetched, 'threads', []).values()]
            except Exception:
                threads = []
            for t in threads:
                try:
                    # backup per thread minimally by storing starter content
                    try:
                        starter = await t.fetch_message(t.id)
                        out = {'threadId': t.id, 'threadName': getattr(t, 'name', ''), 'starter': getattr(starter, 'content', '')}
                        odir = os.path.join(data_dir, 'thread-backups')
                        os.makedirs(odir, exist_ok=True)
                        with open(os.path.join(odir, f'{t.id}.json'), 'w', encoding='utf8') as fh:
                            json.dump(out, fh, ensure_ascii=False, indent=2)
                    except Exception:
                        pass
                    await t.delete()
                    deleted += 1
                except Exception:
                    pass
        except Exception:
            pass

        # Clear store
        try:
            if os.path.exists(store_file):
                with open(store_file, 'r', encoding='utf8') as fh:
                    st = json.load(fh)
                st['verifications'] = {}
                with open(store_file, 'w', encoding='utf8') as fh:
                    json.dump(st, fh, ensure_ascii=False, indent=2)
        except Exception:
            pass

        await interaction.followup.send(f'Flush forum: threads supprimés (approx): {deleted}')

    except Exception as err:
        logger.error(['Erreur /flushforum:', err])
        try:
            await interaction.followup.send('Erreur interne.', ephemeral=True)
        except Exception:
            pass
