## Guide — Vérification des candidatures (pour les validateurs)

Ce document explique comment fonctionne le système de vérification des nouveaux membres et ce que doivent faire les validateurs (staff) pour accepter, refuser ou annuler une vérification.

---

## Vue d'ensemble

- Lorsqu'un membre arrive ou clique sur le bouton de demande de vérification, le bot lui envoie un message privé (DM) pour collecter ses réponses.
- Les réponses sont publiées dans un channel forum (configuré par `FORUM_CHANNEL_ID`) sous forme de thread.
- Les validateurs peuvent accepter ou refuser la vérification soit en réagissant (✅ / ❌) au message de validation, soit en tapant "oui" / "non" dans le fil.
- Les actions (acceptation / refus / annulation) appliquent des rôles, peuvent poser des questions complémentaires (majeur/mineur, rôle artiste) et envoient des notifications Telegram si configuré.

---

## Fichiers et persistance

- Les vérifications en cours sont sauvegardées dans `data/verifications.json`.
- Cela permet de reprendre le traitement après un redémarrage du bot.

---

## Variables d'environnement importantes

- `FORUM_CHANNEL_ID` : ID ou nom du forum (channel) où poster les demandes de vérification.
- `NON_VERIFIED_ROLE` : rôle assigné aux membres en attente (optionnel : id ou nom).
- `PELUCHER_ROLE`, `PELUCHES_ROLE` ou `PELUCHER` : rôle à donner quand la vérification est acceptée.
- `VERIFIER_ROLE` : rôle optionnel permettant d'identifier qui peut valider (en complément des permissions Manage Guild).
- `ARTIST_ROLE` (ou variantes) : rôle "artiste" optionnel à proposer après acceptation.
- `MAJOR_ROLE`, `MINOR_ROLE` (ou variantes) : rôles optionnels pour majeur/mineur.
- `QUESTIONS` ou `VERIF_MESSAGE_MD` : définir le message de vérification envoyé en DM. `QUESTIONS` peut être une liste JSON de questions (mode question-par-question) ou un texte markdown complet (mode libre) — si c'est du markdown, le bot attend des réponses libres jusqu'au message `done`.

---

## Rôles & permissions requises pour les validateurs

Un utilisateur peut valider/refuser si au moins une des conditions suivantes est vraie :
- Il a la permission Manage Guild (ManageServer),
- Il possède le rôle correspondant à `VERIFIER_ROLE` (si défini).

Remarques importantes pour le bot :
- Le bot doit avoir la permission "Manage Roles" pour appliquer ou retirer des rôles.
- Le rôle du bot doit être placé au-dessus des rôles qu'il doit gérer dans la hiérarchie de rôles Discord.

Si les opérations sur les rôles échouent, le bot tente des réessais (transitoires) mais enverra un message d'erreur dans le fil ou le channel si le problème est définitif.

---

## Flux de validation (pas-à-pas pour les validateurs)

1. Ouvrir le thread de vérification dans le forum.
2. Vérifier le contenu du message initial (il contient les réponses du candidat et une ligne `Meta: verification_member_id:<ID>`).
3. Pour accepter :
   - Réagir avec ✅ au message de validation, ou
   - Taper `oui` / `o` / `accept` / etc. dans le fil.

   Après acceptation, le bot :
   - Retire le rôle non-vérifié si configuré,
   - Ajoute le rôle `PELUCHER_ROLE` si configuré,
   - Demande dans le fil si le membre est **majeur** ou **mineur** (réponse attendue du validateur), puis applique `MAJOR_ROLE` ou `MINOR_ROLE` si configurés,
   - Propose ensuite d'appliquer le rôle `ARTIST_ROLE` (oui / non) si configuré,
   - Envoie une confirmation dans le fil et, si possible, un DM au membre.

4. Pour refuser :
   - Réagir avec ❌, ou
   - Taper `non` / `n` / `reject` / etc. dans le fil.

   Le bot demande alors au validateur de fournir une justification (dans le fil) — le validateur a 30 minutes pour répondre. La justification est envoyée en DM au membre (si possible) et la décision est notifiée via Telegram si activé.

5. Pour annuler totalement la vérification (révoquer) :
   - Taper `annuler` / `cancel` dans le fil ou utiliser la commande globale (voir ci-dessous). Le bot demandera une justification puis retirera tous les rôles du membre (sauf @everyone) et ré-appliquera le rôle non-vérifié s'il est configuré.

---

## Comment identifier le membre ciblé (targetId)

Le bot identifie le membre à partir de :
- Le topic du thread : `verification:<memberId>`, ou
- Le contenu du message initial contenant `verification_member_id:<memberId>`, ou
- Une mention directe dans le message.

Si le bot ne trouve pas l'ID du membre, il enverra un message d'erreur dans le fil.

Remarque : les réactions ✅ / ❌ sont prises en compte seulement si la vérification est encore marquée `awaitingValidation` (c.-à-d. la fenêtre initiale de validation n'est pas fermée). Après la validation initiale, d'autres messages ne déclenchent pas l'acceptation/refus automatique.

---

## Traitement des DMs (pour les validateurs)

- Si `VERIF_MESSAGE_MD` est utilisé, le candidat peut répondre librement en DM et doit taper `done` pour marquer la fin ; le bot collectera les messages jusqu'à 10 minutes ou jusqu'à `done`.
- Si `QUESTIONS` est un tableau JSON, le bot envoie chaque question en DM et attend une réponse individuelle (timeout 10 minutes par question).
- Si le candidat n'ouvre pas ses DMs, le bot publie la vérification avec des réponses vides indiquant l'absence de DM.

---

## Actions globales hors thread

- Dans n'importe quel channel du serveur, un validateur autorisé peut taper `annuler` suivi d'une mention ou d'un ID pour annuler la vérification d'un membre (utile si le fil est archivé ou inaccessible).

Exemples de ciblage :
- Mention : `@Pseudo` dans le message.
- Meta dans le message : inclure `verification_member_id:123456789012345678`.
- Un ID numérique présent dans le message (capture d'une suite de chiffres).

---

## Commandes / interactions utiles

- Bouton `request_verif` : si le membre clique sur le bouton, le bot renvoie le message de vérification en DM.
- La fonction `client.runVerificationForMember(member)` est exposée si vous devez déclencher la vérification manuellement (par ex. via une commande interne).

---

## Notifications externes

- Le bot envoie des notifications vers Telegram (si le module `telegram` est configuré) pour : nouvelle vérification, acceptation, refus, rôles appliqués, etc.

---

## Bonnes pratiques pour les validateurs

- Assurez-vous d'être certain avant d'accepter — une fois acceptée, le membre reçoit des rôles et vous pourrez uniquement les retirer manuellement.
- Fournissez une justification claire en cas de refus — cela aide à la transparence et permet au membre de corriger ses erreurs.
- Si une opération sur les rôles échoue, vérifiez que le bot a la permission Manage Roles et que son rôle est au-dessus des rôles ciblés.
- En cas de doute, signalez dans le fil ou demandez l'avis d'un autre validateur.

---

## Dépannage rapide

- Impossible d'appliquer/retirer un rôle : vérifiez les permissions du bot et la position du rôle du bot dans la hiérarchie.
- Le forum ne reçoit pas les posts : vérifiez `FORUM_CHANNEL_ID` et que le bot est présent dans le serveur correspondant.
- Le DM du membre n'arrive pas : le membre a peut-être fermé les DMs — traiter la vérification avec les informations disponibles.
- Vérifications non reprises après redémarrage : vérifier `data/verifications.json` et les logs dans `logs/`.

---

## Où regarder le code

- Logique principale : `src/verification.js`
- Envoi de messages longs (chunking) : `src/sendLongMessage.js`
- Envoi Telegram : `src/telegram.js`
- Fichier de données persistantes : `data/verifications.json`

---

Si tu veux, je peux :
- ajouter des extraits de commandes à copier-coller pour les validateurs,
- créer une version courte (checklist) imprimable,
- ou intégrer ce guide dans le README principal.

