# Utilisation du système de vérification — guide rapide (dans Discord)

Ce fichier est une fiche pratique destinée aux validateurs et modérateurs pour savoir comment traiter les vérifications directement depuis Discord.

---

## Où trouver les demandes

- Les demandes de vérification sont postées sous forme de *threads* dans le forum configuré par `FORUM_CHANNEL_ID`.
- Ouvrez le forum et repérez le fil correspondant (le nom du thread est le nom d'utilisateur du candidat).
- Le message initial contient les réponses du candidat et une ligne `Meta: verification_member_id:<ID>` qui identifie le membre.

---

## Qui peut valider

Vous pouvez valider si :
- Vous avez la permission "Manage Guild" (Manage Server), ou
- Vous avez le rôle défini dans `VERIFIER_ROLE`.

---

## Actions rapides (accept / reject)

Dans le fil de vérification :

- Accepter :
  - Tapez dans le fil :
    - `oui` / `o` / `accept` / `valide` (les variantes sont acceptées)

  Après acceptation, le bot :
  - retire le rôle non-vérifié (si configuré),
  - ajoute le rôle principal (PELUCHER_ROLE) si configuré,
  - demande au validateur si le membre est **majeur** ou **mineur** (répondez `majeur` / `mineur`),
  - propose ensuite d'appliquer le rôle **artiste** (répondez `oui` / `non`),
  - envoie une confirmation dans le fil et tente d'envoyer un DM au membre.

- Refuser :
  - Réagissez avec ❌, ou
  - Tapez dans le fil :
    - `non` / `n` / `reject` / `refuse`

  Le bot demandera alors au validateur de fournir une **justification** (répondez dans le fil). Vous avez 30 minutes pour répondre ; la justification sera envoyée en DM au membre si possible.

- Annuler / Révoquer :
  - Tapez : `annuler` / `cancel` / `revoquer` dans le fil ; le bot demandera une raison puis retirera tous les rôles du membre et ré-appliquera le rôle non-vérifié si configuré.

---

## Annulation globale (hors fil)

Si le thread est inaccessible ou archivé, un validateur peut annuler une vérification depuis n'importe quel channel du serveur :

- Tapez `annuler` et mentionnez le membre ou incluez son ID.

Exemples :
- `annuler @Pseudo`  
- `annuler verification_member_id:123456789012345678`  
- `annuler 123456789012345678`

Le bot vérifiera que vous êtes autorisé et lancera la procédure d'annulation (demande de justification, suppression des rôles, DM au membre).

---

## Identifier le membre ciblé (si nécessaire)

Le bot cherche l'ID du membre de ces façons (ordre) :
1. Topic du thread : `verification:<memberId>`
2. Contenu du message initial : `verification_member_id:<memberId>`
3. Mention directe dans le message
4. Une suite de chiffres (ID) présente dans le message

Si l'ID n'est pas trouvée, le bot renverra une erreur dans le fil — fournissez alors manuellement l'ID ou une mention.

---

## Exemples prêts à copier-coller

- Accepter rapidement : `oui`  
- Refuser rapidement : `non`  
- Justification (après avoir tapé `non`) : écrivez la raison dans le fil (ex: `Le compte est très récent et les réponses sont incomplètes.`)
- Annuler global : `annuler @Pseudo` ou `annuler verification_member_id:123...`

---

## Bouton "Demander vérification" (pour les membres)

- Si un membre clique sur le bouton `request_verif`, le bot lui renverra le message de vérification en DM.
- Les validateurs peuvent aussi déclencher la vérification manuellement si une commande interne ou un utilitaire l'appelle (fonction exposée `client.runVerificationForMember(member)`).

---

## Astuces & bonnes pratiques

- Avant d'accepter, lisez bien les réponses du candidat et vérifiez les éléments demandés (règles, présentation, âge si pertinent).
- En cas de doute, demandez un éclaircissement dans le fil ou attendez un autre validateur.
- Rédigez une justification courte et claire lors d'un refus (utile en cas de contestation).
- Si une opération sur les rôles échoue, avertissez la team technique : vérifiez que le bot a la permission "Manage Roles" et que son rôle est au-dessus des rôles ciblés.

---

## Checklist rapide (pour les validateurs)

1. Ouvrir le thread de vérification
2. Lire les réponses (+ vérifier `verification_member_id`)
3. Accepter (✅ ou `oui`) ou Refuser (❌ ou `non`)
4. Si accepté : répondre aux prompts (majeur/mineur, artiste)
5. Si refusé : fournir une justification dans le fil
6. Vérifier que le bot a appliqué/retiré les rôles ; rapporter si erreur

---

Si tu veux, je peux :
- ajouter une version ultra-courte (1/2 page) à imprimer,
- ajouter des captures d'écran simulées montrant où cliquer (si tu veux fournir des images),
- ou intégrer un petit message épinglé à poster dans le forum contenant la checklist.

Fichier créé : `docs/VERIFICATION_DISCORD.md`.
