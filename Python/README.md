# Version Python du bot Discord (POO)

Ce dossier contient une traduction orientée-objet (OOP) de la version Node.js
présente dans `Javascript-NodeJS/`.

Fichiers principaux:
- `bot.py` : point d'entrée et classe Bot
- `logger.py` : logger centré fichier + forward optionnel vers Telegram
- `telegram.py` : pont de batching pour Telegram
- `send_long.py` : utilitaire pour envoyer de longs messages
- `verification.py` : gestionnaire de vérifications (principal)
- `commands/` : commandes de démonstration (ping)

Installation rapide (Windows PowerShell):

```powershell
python -m pip install -r Python/requirements.txt
```

Exécution (configuration via `.env` similaire au répertoire JS):

```powershell
# créer un .env contenant DISCORD_TOKEN et autres variables
python -m Python.bot
```

Note: ceci est un squelette fonctionnel minimal qui reproduit la logique principale
en OOP. Il faudra compléter les adaptations et tests selon votre environnement.
