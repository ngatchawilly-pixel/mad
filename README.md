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
Dernier résultat : 82 scénarios réussis (45 + 28 + 9), 0 échec.

## Règles à valider (voir l'analyse du cahier des charges)
- `seuil_reaf_dg` (2 000 000 FCFA) est **provisoire** : le cahier des charges ne le chiffre pas.
- Au-delà du plafond MDD, la MAD est refusée : il faut basculer des lignes en MDI.

## Frontend (React + Vite + Tailwind)
```
npm install
npm run dev      # http://localhost:5173 (lit .env.local)
npm run build
```
Écrans : tableau de bord, besoins (saisie et soumission), arbitrage DML, décisions figées et signatures,
MAD (génération, virement, accusé), dépenses, réaffectations. Menus et boutons dépendent du rôle ;
les vrais contrôles restent dans la base (RLS et triggers).

Écrans ajoutés : pièces justificatives (Storage), dépôt du compte d'emploi, contrôle de conformité (CG), clôture et PV.

Import Excel (DML) : bouton « Importer Excel » dans Besoins, aperçu puis écriture atomique en brouillon.

Reste à faire : relances automatiques (pg_cron), Edge Functions et API d'interconnexion.
