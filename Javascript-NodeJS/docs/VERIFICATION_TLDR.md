# TL;DR — Vérification (hyper simple)

Pour les validateurs :

1) Ouvre le thread de vérification dans le forum.
2) Lis vite les réponses du candidat.

Accepter (rapide) :
- Tape "oui" dans le fil.

Le bot : retire le rôle non-vérifié (si configuré), donne le rôle principal, puis te demandera si le candidat est *majeur* ou *mineur* et si on doit lui donner le rôle *artiste*.

Refuser (rapide) :
- Tape "non" dans le fil.

Après, écris une courte justification dans le fil (tu as 30 minutes). Le bot enverra la raison en DM au candidat si possible.

Annuler / révoquer :
- Tape "annuler @Pseudo" ou "annuler verification_member_id:ID" (depuis n'importe quel channel) pour lancer l'annulation. (juste annuler dans le fil fonctionne)

Qui peut faire ça ?
- Les validateurs ont la permission Manage Guild, ou
- Les utilisateurs ayant le rôle assigné à `VERIFIER_ROLE`.

Remarque rapide :
- Si une action sur les rôles échoue, vérifie que le bot a la permission "Manage Roles" et que son rôle est au-dessus des rôles à gérer.

Fichier : `docs/VERIFICATION_TLDR.md`