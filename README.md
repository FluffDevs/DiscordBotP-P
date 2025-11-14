## DiscordBotP-P — Squelette de bot Discord (fr)

Ceci est un petit squelette pour démarrer un bot Discord en Node.js avec `discord.js` et `dotenv`, enrichi d'un module de vérification des nouveaux membres.

## Table des matières
- Installation
- Variables d'environnement (`.env`)
- Démarrage et développement
- Module de vérification (détail complet)
	- Flux (arrivée, bouton, modération)
	- Format des messages & collecte des réponses
	- Persistance
	- Permissions et validation
- Déploiement des slash-commands
- Dépannage / FAQ
- Suggestions d'amélioration

## Installation

Pré-requis : Node.js >= 16.9 (Node 18+ recommandé). Un bot Discord et son token.

1. Installer les dépendances :

```powershell
cd 'C:\Users\Matheo\Documents\Projets\pelucheetpaix\DiscordBotP-P'
npm install
```

2. Copier l'exemple d'environnement et remplir les valeurs :

```powershell
Copy-Item .env.example .env
# Ensuite, éditez .env et renseignez DISCORD_TOKEN et autres variables nécessaires
```

## Variables d'environnement (`.env`)

Les variables importantes pour le fonctionnement général :

- `DISCORD_TOKEN` (obligatoire) — token du bot.
- `PREFIX` (optionnel) — préfixe pour les commandes texte (ex: `!`).
- `CLIENT_ID` (optionnel) — ID de l'application (utile pour déployer slash-commands).
- `GUILD_ID` (optionnel) — ID du serveur de développement pour déploiement rapide des slash-commands.

Variables spécifiques au module de vérification (voir `src/verification.js`) :

- `FORUM_CHANNEL_ID` (obligatoire pour la vérification) — ID du Forum Channel où seront créés les posts/threads de vérification. Peut être l'ID (recommandé) ou le nom exact du channel. Si le bot est dans plusieurs guilds et que vous indiquez un nom, le premier channel correspondant trouvé sera utilisé.
- `NON_VERIFIED_ROLE` (optionnel) — nom ou ID du rôle appliqué aux nouveaux membres (sera retiré si la vérification est acceptée).
- `PELUCHER_ROLE` (optionnel) — nom ou ID du rôle à attribuer aux membres acceptés.
- `VERIFIER_ROLE` (optionnel) — nom ou ID du rôle autorisé à valider via réactions ou à utiliser la commande `/msgverif`. Si non fourni, la permission `Manage Guild` est requise pour valider.
- `QUESTIONS` (optionnel) — deux usages possibles :
	- JSON encodé en string (ancien comportement) : une liste de questions, ex :
		`QUESTIONS='["Quel est ton âge ?","As-tu lu les règles ?"]'` — le bot posera chaque question séparément en DM.
	- texte Markdown (nouveau comportement) : si la valeur n'est pas un JSON valide, elle est interprétée comme un message Markdown entier (alias de `VERIF_MESSAGE_MD`). Le texte sera envoyé tel quel au nouveau membre et ses réponses seront collectées en mode libre (voir ci-dessous).
- `VERIF_MESSAGE_MD` (optionnel) — équivalent à `QUESTIONS` en mode Markdown ; permet de définir directement le message Markdown envoyé au nouveau.
- `QUESTIONS_TIMEOUT_MS` (optionnel) — timeout en millisecondes pour la collecte des réponses (par défaut 300000 = 5 minutes). Si vous en avez besoin, ajoutez par ex. `QUESTIONS_TIMEOUT_MS=600000` pour 10 minutes.

Exemple minimal `.env` pour tester la vérification :

```
DISCORD_TOKEN=your-token
FORUM_CHANNEL_ID=123456789012345678
NON_VERIFIED_ROLE=Non vérifié
PELUCHER_ROLE=Peluche
VERIFIER_ROLE=Modérateur
QUESTIONS='**Bienvenue !**\n\nMerci de répondre à ce message en DM et tape `done` quand tu as fini.'
```

## Démarrage / développement

- En production :

```powershell
npm start
```

- En développement (rechargement automatique) :

```powershell
npm run dev
```

## Module de vérification — documentation complète

Fichier principal : `src/verification.js`.

But : envoyer un message de vérification aux nouveaux membres (ou à la demande via bouton), collecter leurs réponses, créer un thread dans un Forum Channel où les modos valident ou refusent la vérification.

### Flux principal

1. Arrivée d'un membre (`guildMemberAdd`) :
	 - Le bot peut appliquer le rôle `NON_VERIFIED_ROLE` si configuré.
	 - Le bot ouvre un DM et envoie soit :
		 - un message Markdown complet (si `QUESTIONS` ou `VERIF_MESSAGE_MD` est défini en Markdown), ou
		 - une série de questions (si `QUESTIONS` est un JSON array).
	 - Dans le cas Markdown : le membre peut répondre librement dans le DM et tape `done` lorsqu'il a fini (ou attend le timeout).
	 - Les réponses sont regroupées et postées dans un nouveau thread du Forum Channel configuré (`FORUM_CHANNEL_ID`). Le message initial du thread est réagi par ✅ et ❌.

2. Si un modérateur exécute `/msgverif` :
	 - La slash-command publie un message contenant un bouton `Recevoir le message de vérification`.
	 - Tout utilisateur (bouton public) peut cliquer ; lors du clic, le bot envoie le message de vérification en DM au cliqueur et, à la fin de la collecte, crée un thread dans le forum pour lui.

3. Validation par réactions :
	 - Un modérateur (permission `Manage Guild` ou rôle `VERIFIER_ROLE`) réagit avec ✅ ou ❌ sur le message initial du thread.
	 - ✅ : le bot retire le rôle `NON_VERIFIED_ROLE` et ajoute `PELUCHER_ROLE` (si configurés), et notifie le membre par DM.
	 - ❌ : le bot demande au modérateur de fournir une justification dans le thread (30 minutes). Cette justification est ensuite envoyée au membre par DM. Si les DMs sont fermés, le bot le mentionne dans le thread.

### Persistance

Le module utilise une persistance simple sur disque : `data/verifications.json` qui mappe `memberId -> threadId, channelId, createdAt`.

- Objectif : permettre de retrouver l'association membre ↔ thread après un redémarrage du bot, et éviter la perte d'information.
- Format simple JSON, pas de DB externe. Le fichier est automatiquement créé et mis à jour.

Remarque : actuellement chaque requête de vérification crée un nouveau thread et la mapping pointe vers le thread le plus récent pour ce membre. Si tu veux réutiliser un thread existant au lieu d'en créer un nouveau, c'est possible à modifier.

### Permissions nécessaires

- Le bot doit avoir la permission de créer des threads et d'envoyer des messages dans le Forum Channel.
- Pour appliquer/retirer des rôles, il doit avoir Manage Roles et un rôle supérieur aux rôles ciblés.

### Timeout et collecte

- Par défaut la collecte attend 5 minutes (300000 ms). Tu peux personnaliser avec `QUESTIONS_TIMEOUT_MS`.
- En mode Markdown, les messages du membre sont collectés jusqu'à ce qu'il envoie `done` (case-insensitive) ou jusqu'au timeout.

### Sécurité et limites

- Si le membre a les DMs fermés, le bot ne pourra pas lui envoyer le message ; dans ce cas le thread est quand même créé et contient une note indiquant l'absence de réponses par DM.
- Si `FORUM_CHANNEL_ID` est un nom et que le bot est dans plusieurs serveurs contenant un channel du même nom, la recherche retournera le premier trouvé dans la cache. Pour plus de précision tu peux définir `FORUM_CHANNEL_ID` comme un ID ou ajouter `FORUM_GUILD_ID` (optionnel) pour forcer la recherche dans un guild spécifique.

## Slash-commands

Le dossier `src/slash-commands` contient les commandes slash (ex : `ping`, `say`, `msgverif`). Utilisez `npm run deploy-commands` pour déployer les commandes auprès de l'API Discord. Si vous voulez déployer uniquement dans un serveur de test (plus rapide), renseignez `GUILD_ID`.

## Déploiement des slash-commands

```powershell
npm run deploy-commands
# ou
npm run deploy-if-ready
```

`deploy-if-ready` vérifie que `DISCORD_TOKEN` et `CLIENT_ID` (et éventuellement `GUILD_ID`) sont présents avant d'appeler le déploiement.

## Dépannage / FAQ

- Le bot ne poste pas dans le forum : vérifie `FORUM_CHANNEL_ID`, que le bot est dans le serveur adéquat, et les permissions (Send Messages, Create Public Threads, Create Private Threads selon la configuration du forum).
- Le bot ne peut pas gérer les rôles : vérifie que le bot a `Manage Roles` et qu'il a un rôle hiérarchiquement supérieur aux rôles ciblés.
- Les réactions n'ont pas d'effet : vérifie les permissions des modérateurs (Manage Guild ou rôle `VERIFIER_ROLE`) et que le bot a accès aux messages (Read Message History + Add Reactions si besoin).

## Tests rapides

- Le projet contient un petit test `test/test.js` qui vérifie la forme de certaines commandes. Lance :

```powershell
npm test
```

## Suggestions d'améliorations possibles

- Persistance plus robuste (SQLite, MongoDB) pour audit et historique.
- Option pour réutiliser un thread existant au lieu d'en créer un nouveau.
- Exiger plusieurs validateurs (quorum) avant d'accepter une vérification.
- Transformer le message Markdown en Embed pour un rendu plus propre dans le forum.

---

Si tu veux, j'ajoute l'option `FORUM_GUILD_ID` pour restreindre la recherche du channel à un serveur précis, ou je peux convertir automatiquement le Markdown envoyé en `embed` lors de la publication dans le forum — dis-moi ta préférence.

## Module de vérification des nouveaux membres (verification.js)

Le projet inclut maintenant un module de vérification `src/verification.js` qui gère l'accueil des nouveaux membres et leur envoie un ensemble de questions en DM, puis publie les réponses dans un fil d'un Forum Channel pour modération.

Comportement principal :
- À l'arrivée d'un membre (`guildMemberAdd`) : le bot lui envoie les questions en DM, collecte les réponses (timeout 5 minutes par question), puis crée un fil dans le channel configuré (Forum) contenant les réponses et ajoute les réactions ✅ / ❌ sur le message initial.
- Les modérateurs peuvent réagir : ✅ retire le rôle non vérifié (si configuré) et ajoute le rôle "peluche" (si configuré). ❌ demande au modérateur de fournir une justification dans le fil, justification qui est ensuite envoyée au membre par DM.
- Les modérateurs peuvent aussi exécuter la slash-command `/msgverif` pour publier un message avec un bouton "Recevoir le message de vérification" — lorsque quelqu'un clique, il reçoit le message de vérification en DM (même logique que l'arrivée).

Variables `.env` attendues pour le module de vérification :

- `FORUM_CHANNEL_ID` (obligatoire) : ID du Forum Channel où les demandes de vérification seront créées.
- `NON_VERIFIED_ROLE` (optionnel) : nom ou ID du rôle appliqué aux nouveaux (sera retiré si la vérification est acceptée).
- `PELUCHER_ROLE` ou `PELUCHER_ROLE` (optionnel) : nom ou ID du rôle à attribuer aux membres acceptés.
- `VERIFIER_ROLE` (optionnel) : nom ou ID du rôle qui permet d'utiliser `/msgverif` et de valider via réactions. Sinon, la permission `Manage Guild` est requise pour valider.
- `QUESTIONS` (optionnel) : JSON array encodé en string, exemple : `QUESTIONS='["Question 1","Question 2"]'`. Si non fourni, un jeu de questions par défaut est utilisé.

Notes et limites :
- Le channel renseigné doit être de type Forum pour que la création de threads fonctionne correctement.
- Si un utilisateur a les DMs fermés, le bot ne pourra pas lui envoyer les messages mais publiera quand même la demande dans le forum (avec des marqueurs indiquant l'absence de réponses).
- Le mapping thread↔membre est stocké dans le topic du thread et dans le contenu du message (meta), il n'y a pas de stockage persistant autre qu'un post dans le forum.

Utilisation rapide :

1. Remplir `.env` avec `FORUM_CHANNEL_ID` et éventuellement les autres variables listées.
2. Déployer les slash-commands si nécessaire : `npm run deploy-commands`.
3. Les modérateurs peuvent lancer `/msgverif` puis les utilisateurs cliquent sur le bouton pour recevoir le message de vérification en DM.

Si tu veux, je peux ajouter une persistance (fichier JSON ou DB) pour garder la traçabilité des vérifications entre redémarrages, ou exiger plusieurs validateurs avant acceptation.