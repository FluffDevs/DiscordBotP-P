"""Fonction utilitaire pour envoyer de longs messages (split ou attachment).
Import dynamique de `discord` pour permettre l'exécution des tests sans dépendance.
"""
import os
import io
import time

DISCORD_MAX = 2000
DEFAULT_LOGICAL_MAX = int(os.getenv('MAX_RESPONSE_LENGTH', '50000'))


async def send_long(channel, content, **options):
    """Envoie `content` sur `channel` en découpant ou en pièce jointe.

    Si le package `discord` n'est pas installé (p.ex. durant un test local),
    la fonction effectue un no-op et retourne None.
    """
    if not channel or not content:
        return None
    logical_max = DEFAULT_LOGICAL_MAX
    if len(content) > logical_max:
        # try to import File dynamically
        try:
            from discord import File
            b = io.BytesIO(content.encode('utf8'))
            return await channel.send(file=File(b, filename='message.txt'))
        except Exception:
            # fallback: write a temp file for inspection and return None
            try:
                import tempfile
                p = tempfile.gettempdir()
                fname = os.path.join(p, f'sendLong-{int(time.time())}.txt')
                with open(fname, 'w', encoding='utf8') as fh:
                    fh.write(content)
            except Exception:
                pass
            return None

    # Send in chunks
    chunks = [content[i:i+DISCORD_MAX] for i in range(0, len(content), DISCORD_MAX)]
    last = None
    for chunk in chunks:
        try:
            last = await channel.send(chunk)
        except Exception:
            # if sending fails (or discord not available), ignore in skeleton
            last = None
    return last


__all__ = ['send_long']
