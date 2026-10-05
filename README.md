# MAD HYSACAM – base de données (phase 1)

Projet Supabase : `mnsgffisxhydhmolvfak`

## Appliquer sur le projet en ligne
```
npx supabase login
npx supabase link --project-ref mnsgffisxhydhmolvfak   # demande le mot de passe de la base
npx supabase db push                                    # applique supabase/migrations
```
Données de départ (agences, paramètres, cycle 2610) : coller `supabase/seed.sql` dans l'éditeur SQL du tableau de bord.

## Premier administrateur
1. Authentication > Users > Add user (e-mail + mot de passe).
2. Éditeur SQL : `insert into profiles(id, nom, role) values ('<uuid de l''utilisateur>', 'Votre nom', 'ADMIN');`
Les autres comptes se créent ensuite avec leur rôle (CHEF, RM, DML, CG, DG, TRES) ; CHEF et RM exigent une agence.

## Tests des règles
`supabase/tests/test_regles.sql` joue 45 scénarios (un par rôle) sur un Postgres vide avec un schéma `auth` factice.
`supabase/tests/test_cloture.sql` (à jouer après) couvre compte d'emploi, contrôle et clôture.
`supabase/tests/test_import.sql` couvre l'import Excel.
`supabase/tests/test_besoins.sql` couvre les fiches de besoin.
`supabase/tests/test_referentiels.sql` (après `seed_referentiels.sql`) couvre les référentiels.
`supabase/tests/test_catalogue.sql` couvre le catalogue fournisseurs.
`supabase/tests/test_comptes.sql` couvre les mots de passe. Toute la suite : `bash supabase/tests/lancer_tests.sh` (Docker).
`supabase/tests/test_workflow.sql` couvre le circuit au niveau du besoin.
Dernier résultat : 217 scénarios réussis (45 + 28 + 9 + 18 + 12 + 23 + 31 + 51), 0 échec.

## Règles à valider (voir l'analyse du cahier des charges)
- `seuil_reaf_dg` (2 000 000 FCFA) est **provisoire** : le cahier des charges ne le chiffre pas.
- Au-delà du plafond MDD, la MAD est refusée : il faut basculer des lignes en MDI.

## Frontend (React + Vite + Tailwind)
```
npm install
npm run dev      # http://localhost:5173 (lit .env.local)
npm run build
```
Écrans : tableau de bord, besoins (on crée ou on choisit d'abord un besoin, puis on y ajoute ses lignes), arbitrage DML, décisions figées et signatures,
MAD (génération, virement, accusé), dépenses, réaffectations. Menus et boutons dépendent du rôle ;
les vrais contrôles restent dans la base (RLS et triggers).

Écrans ajoutés : pièces justificatives (Storage), dépôt du compte d'emploi, contrôle de conformité (CG), clôture et PV.

Import Excel (DML) : bouton « Importer Excel » dans Besoins, aperçu puis écriture atomique en brouillon.

Reste à faire : relances automatiques (pg_cron), Edge Functions et API d'interconnexion.

## Référentiels (dossier 00_REFERENTIELS)
`node scripts/generer_referentiels.mjs` lit `agences.xlsx`, `vehicules.xlsx` et `seuils.xlsx` et génère
`supabase/seed_referentiels.sql` (à lancer après la migration 8, sans danger si relancé).
Rapport affiché par le script : sites inconnus, codes écartés, quasi-doublons signalés dans `parc.remarque`.

## Catalogue fournisseurs
Page « Fournisseurs » : fiche fiscale (NIU, RCCM, régime, TVA…), articles et prix, historique des prix,
comparaison entre fournisseurs. Modèle Excel : `public/modeles/Modele_fournisseurs_articles.xlsx`
(régénérable avec `python scripts/generer_modele_fournisseurs.py`). Import atomique par la DML.

## Mots de passe
- Chacun change le sien depuis « Mon compte » (le mot de passe actuel est redemandé).
- DML et DG réinitialisent les comptes des agences (page « Utilisateurs ») ; l'administrateur réinitialise tous les comptes.
  Mot de passe temporaire affiché une seule fois, changement obligatoire à la reconnexion (vérifié par la base),
  sessions coupées, opération tracée à l'historique. Le contrôle de gestion n'a pas ce droit (séparation des tâches).

## Circuit d'un besoin
1. **Agence** : le responsable maintenance saisit les lignes (brouillon) ; le **chef d'agence soumet le besoin** en une fois
   (tout ou rien : une ligne incomplète bloque la soumission et est nommée). Il peut le **rappeler** tant que la DML n'a pas décidé.
2. **DML** : ouvre le besoin, **coche les lignes à retenir** (mode MDD/MDI et montant), motive les autres, puis **valide le besoin**
   (tout ou rien). Chaque ligne en attente doit recevoir une décision.
3. L'agence peut **réexprimer** les lignes non retenues (hors « reporté » et « sacrifié », qui reviennent au cycle suivant).
Les anciennes voies ligne par ligne (soumission, validation) sont verrouillées côté base.
