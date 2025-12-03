"""Script qui vérifie la présence des variables d'environnement puis lance
le déploiement des slash-commands (équivalent de `scripts/deploy-if-ready.js`).
"""
import os
import sys
import subprocess
from dotenv import load_dotenv

load_dotenv()

required = ['DISCORD_TOKEN', 'CLIENT_ID']
missing = [k for k in required if not os.getenv(k)]
if missing:
    print('Variables manquantes dans .env:', ', '.join(missing))
    print('Copiez `.env.example` vers `.env` et remplissez les valeurs, puis relancez ce script.')
    sys.exit(1)

print('Variables requises présentes — démarrage du déploiement des slash-commands...')
res = subprocess.run([sys.executable, str((__file__).replace('deploy_if_ready.py', '..\\deploy_commands.py'))], shell=False)
sys.exit(res.returncode)
