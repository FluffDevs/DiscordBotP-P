# Forum Artistes

Génère un post de forum Discord par artiste de l'API `https://fluffradio.com/api/artistes`
et le tient à jour une fois par jour.

## Mise en place

1. Créer un salon de **type Forum** sur le serveur.
2. Déployer les commandes : `node src/deploy-commands.js`
3. En tant qu'administrateur, dans Discord :
   ```
   /artistes-forum config forum:#nom-du-forum heure:04:00 actif:true
   /artistes-forum sync
   ```
4. `/artistes-forum status` pour vérifier.

> Le salon forum des artistes est **indépendant** de `FORUM_CHANNEL_ID`
> (qui reste celui de la vérification).

## Fonctionnement

- Un thread de forum par artiste (clé = `slug`).
- Contenu bilingue **FR + EN** en embeds : carte (icône, description, liens en
  champs), puis une section par `titreN` / `paragrapheN`.
- MAJ quotidienne à l'heure configurée (heure locale du serveur). Un thread
  n'est réécrit que si son contenu a changé (hash SHA-1 du rendu).
- Artiste retiré de l'API → thread supprimé.
- Config + état persistés dans `V2/data/artist-forum.json`.

## Notes techniques

- L'API renvoie un JSON légèrement malformé (sauts de ligne bruts dans les
  chaînes) : `looseJsonParse` nettoie avant `JSON.parse`.
- Limites Discord respectées : 10 embeds / ~5500 caractères par message,
  25 champs, titre de thread 100 caractères. Le surplus part sur des messages
  supplémentaires dans le thread.
- Aucune dépendance ajoutée (`fetch` natif Node 20).
- Surcharges optionnelles : `ARTIST_API_URL`, `ARTIST_MEDIA_BASE`.
