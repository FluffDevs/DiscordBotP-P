"""Script de déploiement des slash-commands (version Python).

Il parcourt le dossier `Python/slash_commands` et construit des définitions
simples (name + description). Ensuite il appelle l'API REST Discord pour
déployer en guild ou global selon les variables d'environnement.

Ne nécessite pas discord.py pour fonctionner (utilise urllib pour REST).
"""
from dotenv import load_dotenv
load_dotenv()

import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path
import importlib.util

from logger import Logger

LOG = Logger()

TOKEN = os.getenv('DISCORD_TOKEN')
CLIENT_ID = os.getenv('CLIENT_ID')
GUILD_ID = os.getenv('GUILD_ID')
DEPLOY_ALL = os.getenv('DEPLOY_ALL_GUILDS', '').lower() == 'true'

BASE_DIR = Path(__file__).resolve().parent
SLASH_DIR = BASE_DIR / 'slash_commands'

if not TOKEN or not CLIENT_ID:
    LOG.error('DISCORD_TOKEN et CLIENT_ID sont requis pour déployer les commandes.')
    sys.exit(1)


def _http_request(method: str, url: str, data=None):
    headers = {
        'Authorization': f'Bot {TOKEN}',
        'Content-Type': 'application/json'
    }
    body = None
    if data is not None:
        body = json.dumps(data).encode('utf8')
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            try:
                return json.loads(raw.decode('utf8'))
            except Exception:
                return raw.decode('utf8')
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode('utf8')
            LOG.error(f'HTTP {e.code} {e.reason}: {body}')
        except Exception:
            LOG.error(f'HTTP {e.code} {e.reason}')
        raise
    except Exception as e:
        LOG.error(f'Erreur HTTP: {e}')
        raise


def collect_commands():
    commands = []
    if not SLASH_DIR.exists():
        LOG.warn('Aucun dossier `Python/slash_commands` — rien à déployer.')
        return commands
    for p in SLASH_DIR.iterdir():
        if not p.is_file() or p.suffix != '.py' or p.stem.startswith('_'):
            continue
        try:
            spec = importlib.util.spec_from_file_location(f'slash_commands.{p.stem}', str(p))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            name = getattr(mod, 'name', None)
            desc = getattr(mod, 'description', '')
            data = getattr(mod, 'data', None)
            if data and isinstance(data, dict):
                commands.append(data)
            elif name:
                commands.append({
                    'name': name,
                    'type': 1,  # CHAT_INPUT
                    'description': desc or 'Commande',
                    'options': []
                })
            else:
                LOG.warn(f'Fichier {p.name} ignoré: pas de `name` exporté')
        except Exception as e:
            LOG.error(f'Erreur en important {p.name}: {e}')
    return commands


def deploy_to_guilds(commands):
    rest_base = 'https://discord.com/api/v10'
    if GUILD_ID and GUILD_ID != 'ALL' and not DEPLOY_ALL:
        url = f"{rest_base}/applications/{CLIENT_ID}/guilds/{GUILD_ID}/commands"
        LOG.info(f'Déploiement de {len(commands)} commandes au guild {GUILD_ID}...')
        data = _http_request('PUT', url, commands)
        LOG.info(f'Commandes déployées (guild): {len(data) if isinstance(data, list) else 1}')
        return

    if GUILD_ID == 'ALL' or DEPLOY_ALL:
        LOG.info('Récupération des guilds du bot pour déploiement sur chacune...')
        guilds = _http_request('GET', f'https://discord.com/api/v10/users/@me/guilds')
        if not isinstance(guilds, list) or not guilds:
            LOG.warn('Aucune guild trouvée pour le bot.')
            return
        for g in guilds:
            gid = g.get('id')
            try:
                LOG.info(f'Déploiement pour guild {gid}...')
                url = f"{rest_base}/applications/{CLIENT_ID}/guilds/{gid}/commands"
                data = _http_request('PUT', url, commands)
                LOG.info(f'  OK — {len(data) if isinstance(data, list) else 1} commandes déployées')
            except Exception as e:
                LOG.error(f'Erreur pour guild {gid}: {e}')
        return

    # global deploy
    url = f'https://discord.com/api/v10/applications/{CLIENT_ID}/commands'
    LOG.info(f'Déploiement global de {len(commands)} commandes (peut prendre ~1h)...')
    data = _http_request('PUT', url, commands)
    LOG.info(f'Commandes déployées (global): {len(data) if isinstance(data, list) else 1}')


def main():
    cmds = collect_commands()
    LOG.info(f'Prêt à déployer {len(cmds)} slash-commands')
    if not cmds:
        LOG.warn('Aucune commande collectée — rien à faire.')
        return
    deploy_to_guilds(cmds)


if __name__ == '__main__':
    main()
