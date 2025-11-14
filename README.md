# DiscordBotP-P — Squelette de bot Discord (fr)

Ceci est un petit squelette pour démarrer un bot Discord en Node.js avec `discord.js` et `dotenv`.

## Ce que j'ai ajouté

- `package.json` (scripts `start` et `dev`)
- `src/index.js` — exemple minimal (commande `ping`)
- `.env.example` — variables d'environnement à copier
- `.env` — fichier local (vide) à remplir (ignoré par Git)
- `.gitignore`

## Prérequis

- Node.js >= 16.9 (préférer Node 18+)
- Un bot Discord enregistré et son token (portal Discord Developer)

## Installation (PowerShell)

1. Installer les dépendances:

```powershell
cd 'C:\Users\Matheo\Documents\Projets\pelucheetpaix\DiscordBotP-P'
npm install
```

2. Créer un fichier `.env` (ou copier `.env.example`):

```powershell
Copy-Item .env.example .env
# puis éditez .env et collez votre token en valeur de DISCORD_TOKEN
```

3. (Optionnel mais recommandé) Remplissez aussi `CLIENT_ID` (Application ID) et `GUILD_ID` (ID d'un serveur de développement) dans `.env` si vous voulez déployer des slash-commands rapidement pour un serveur.

## Déployer les slash-commands

Le projet contient un script de déploiement `src/deploy-commands.js` qui lit `src/slash-commands` et enregistre les commandes auprès de l'API Discord.

1. Copier/mettre à jour `.env` avec `DISCORD_TOKEN`, `CLIENT_ID` et (optionnel) `GUILD_ID`.
2. Lancer:

```powershell
npm run deploy-commands
```

Si `GUILD_ID` est renseigné, les commandes seront déployées seulement sur ce serveur (mise à jour instantanée). Sinon elles seront déployées globalement (peut prendre jusqu'à 1 heure pour apparaître).

### Option pratique : vérifier et déployer en une commande

Le projet contient un helper `deploy-if-ready` qui vérifie que les variables requises sont présentes dans votre `.env` (`DISCORD_TOKEN` et `CLIENT_ID`) puis lance automatiquement le déploiement. Utile si vous voulez éviter d'exécuter le déploiement avant d'avoir rempli `.env`.

```powershell
npm run deploy-if-ready
```

Si des variables manquent, le script affichera lesquelles et stoppera proprement.

## Exemple visuel

Les slash-commands apparaîtront dans le menu `/` de Discord comme sur la capture que vous avez fournie, une fois déployées et lorsque le bot est en ligne.


3. Démarrer le bot:

```powershell
npm start
```

4. En développement, pour rechargement automatique:

```powershell
npm run dev
```

## Sécurité

- Ne partagez jamais votre `DISCORD_TOKEN`. Gardez `.env` hors du contrôle de version (déjà dans `.gitignore`).

## Prochaines étapes suggestions

- Ajouter gestion des commandes (fichiers séparés)
- Ajouter logs/gestion d'erreurs plus robuste
- Ajouter tests unitaires minimaux