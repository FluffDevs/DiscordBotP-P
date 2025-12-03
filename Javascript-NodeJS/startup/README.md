# startup/

Contenu:
- `start-and-monitor.js` : script Node (ESM) qui fait un `git fetch --all`, lance `src/index.js` et envoie un message Telegram en cas de plantage.
- `start-service.ps1` : script PowerShell pour lancer `start-and-monitor.js` en arrière-plan et rediriger les logs vers `logs/`.

Variables d'environnement requises (fichier `.env` à la racine) :
- `TELEGRAM_BOT_TOKEN` : token du bot Telegram
- `TELEGRAM_CHAT_ID` : chat id (groupe ou utilisateur) pour recevoir les messages
- Les autres variables déjà utilisées par votre bot (DISCORD token, etc.)

Usage rapide (manuellement) :
PowerShell (depuis la racine du projet) :

```powershell
# Démarrer en arrière-plan (via le script powershell fourni)
.\startup\start-service.ps1

# Pour lancer directement et garder la console :
node .\startup\start-and-monitor.js
```

Intégration comme service Windows :
- Option 1 (nssm, recommandé pour simplicité) :
  1. Installer nssm (https://nssm.cc/)
  2. Créer un service :
     nssm install MyDiscordBot "C:\\Program Files\\nodejs\\node.exe" "C:\\path\\to\\project\\startup\\start-and-monitor.js"
  3. Configurer "Start Directory" sur le répertoire racine du projet.
  4. Configurer les Environment -> add TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID si nécessaire.

- Option 2 (sc.exe) : sc.exe ne gère pas bien la redirection. Préférez `nssm` ou un wrapper qui exécute `cmd /c node startup\start-and-monitor.js > logs\...`.

Notes :
- Le script `start-and-monitor.js` signale les erreurs via `src/telegram.js` (méthode `sendImmediate`) et écrit aussi dans `logs/`.
- Le script ne fait pas de restart automatique du bot en cas d'échec ; utilisez le gestionnaire de service (nssm / service) pour redémarrer automatiquement.
- Testez localement avec `node startup/start-and-monitor.js` et vérifiez `logs/` pour la sortie.
Notes :
- Le script `start-and-monitor.js` signale les erreurs via `src/telegram.js` (méthode `sendImmediate`) et écrit aussi dans `logs/`.
- Le script peut maintenant gérer des redémarrages automatiques avec backoff exponentiel (configurable via variables d'environnement, voir ci-dessous).
- Testez localement avec `node startup/start-and-monitor.js` et vérifiez `logs/` pour la sortie.

Redémarrage / backoff (variables d'environnement)
- `STARTUP_RESTART_ENABLED` : si défini (n'importe quelle valeur), active la logique de restart (par défaut activée si `MAX_RETRIES` > 0).
- `STARTUP_MAX_RETRIES` (par défaut 5) : nombre maximum de tentatives de redémarrage avant d'abandonner et d'envoyer une notification Telegram.
- `STARTUP_INITIAL_BACKOFF_MS` (par défaut 2000) : délai initial entre crash et tentative de redémarrage (ms).
- `STARTUP_BACKOFF_MULTIPLIER` (par défaut 2) : multiplicateur exponentiel appliqué à chaque tentative.

Par défaut, le superviseur effectue jusqu'à 5 tentatives avec un backoff 2s -> 4s -> 8s ... jusqu'à un maximum de 60s entre tentatives.

Exemple `.env` minimal :

```
# Telegram
TELEGRAM_BOT_TOKEN=xxxx
TELEGRAM_CHAT_ID=yyyy

# Redémarrage automatique
STARTUP_MAX_RETRIES=5
STARTUP_INITIAL_BACKOFF_MS=2000
STARTUP_BACKOFF_MULTIPLIER=2
```

Si vous préférez que le service extérieur (nssm/systemd/sc) gère le restart, mettez `STARTUP_MAX_RETRIES=0`.

Si vous voulez que j'ajoute une métrique ou un log plus détaillé (timestamps, compteur d'échecs persistent), je peux l'ajouter.
