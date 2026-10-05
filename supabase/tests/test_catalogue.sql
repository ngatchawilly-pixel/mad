-- À jouer après les autres tests (même base : utilisateurs de test présents).
\set ON_ERROR_STOP off
create temp table res(n serial, label text, ok boolean, detail text);
grant all on res to authenticated; grant usage on sequence res_n_seq to authenticated;

select t('chef ne peut pas importer le catalogue', 1, $o$select importer_catalogue('[{"raison_sociale":"X"}]','[]')$o$, true);

select t('DML importe 2 fournisseurs et 3 articles', 3, $o$do $x$ declare r jsonb; begin
  r := importer_catalogue(
    '[{"raison_sociale":"Planète Auto Test","niu":"m 071612345678 a","rccm":"RC/DLA/2015/B/1234","regime_fiscal":"Réel","assujetti_tva":true,"ville":"Douala","telephone":"699000000","banque":"AFRILAND"},
      {"raison_sociale":"ETS KENFACK","niu":"P098712345678B","regime_fiscal":"Simplifié","ville":"Bafoussam"}]',
    '[{"fournisseur":"PLANÈTE AUTO TEST","reference":"FIL-100","designation":"Filtre à huile","unite":"U","prix_unitaire":10000,"source":"DEVIS"},
      {"fournisseur":"Planète Auto Test","reference":"PLQ-200","designation":"Plaquettes","unite":"JEU","prix_unitaire":50000},
      {"fournisseur":"ETS KENFACK","reference":"fil-100","designation":"Filtre à huile","unite":"U","prix_unitaire":14000}]');
  if r->>'fournisseurs_crees' <> '2' or r->>'articles_crees' <> '3' then raise exception '%', r; end if;
end $x$$o$, false);
select t('NIU normalisé (majuscules, sans espace)', null, $o$do $x$ begin
  if (select niu from fournisseurs where raison_sociale = 'Planète Auto Test') <> 'M071612345678A' then raise exception 'NIU non normalisé'; end if; end $x$$o$, false);
select t('un NIU ne peut appartenir qu''à un fournisseur', 3, $o$insert into fournisseurs(raison_sociale, niu) values ('AUTRE SOCIETE', 'M071612345678A')$o$, true);
select t('une référence ne peut exister deux fois chez un fournisseur (casse ignorée)', 3, $o$insert into articles_fournisseur(fournisseur_id, reference, designation, prix_unitaire)
  select id, 'FIL-100', 'doublon', 1 from fournisseurs where raison_sociale = 'Planète Auto Test'$o$, true);
select t('une raison sociale ne peut exister deux fois (casse ignorée)', 3, $o$insert into fournisseurs(raison_sociale) values ('ets kenfack')$o$, true);

select t('réimport : fournisseur existant complété sans doublon, prix mis à jour', 3, $o$do $x$ declare r jsonb; begin
  r := importer_catalogue('[{"raison_sociale":"ets kenfack","telephone":"677111111"}]',
    '[{"fournisseur":"ETS KENFACK","reference":"FIL-100","designation":"Filtre à huile","prix_unitaire":15000}]');
  if r->>'fournisseurs_crees' <> '0' or r->>'fournisseurs_completes' <> '1' or r->>'articles_mis_a_jour' <> '1' or r->>'prix_modifies' <> '1' then raise exception '%', r; end if;
  if (select telephone from fournisseurs where raison_sociale='ETS KENFACK') <> '677111111' then raise exception 'téléphone non complété'; end if;
  if (select regime_fiscal from fournisseurs where raison_sociale='ETS KENFACK') <> 'Simplifié' then raise exception 'info existante effacée'; end if;
end $x$$o$, false);
select t('historique des prix : 2 entrées pour FIL-100 chez KENFACK (14 000 puis 15 000)', null, $o$do $x$ begin
  if (select count(*) from articles_prix_historique h join articles_fournisseur a on a.id = h.article_id join fournisseurs f on f.id = a.fournisseur_id
       where f.raison_sociale = 'ETS KENFACK' and lower(a.reference) = 'fil-100') <> 2 then raise exception 'historique'; end if; end $x$$o$, false);
select t('un prix inchangé ne crée pas d''entrée d''historique', 3, $o$do $x$ declare n0 int; begin
  select count(*) into n0 from articles_prix_historique;
  perform importer_catalogue('[]','[{"fournisseur":"ETS KENFACK","reference":"FIL-100","designation":"Filtre à huile","prix_unitaire":15000}]');
  if (select count(*) from articles_prix_historique) <> n0 then raise exception 'entrée inutile'; end if; end $x$$o$, false);

select t('import atomique : article d''un fournisseur inconnu annule tout', 3, $o$select importer_catalogue(
  '[{"raison_sociale":"NOUVEAU FOURNISSEUR"}]', '[{"fournisseur":"INCONNU","reference":"R","designation":"d","prix_unitaire":1}]')$o$, true);
select t('... et le fournisseur du lot n''a pas été créé', null, $o$do $x$ begin
  if exists (select 1 from fournisseurs where raison_sociale = 'NOUVEAU FOURNISSEUR') then raise exception 'import partiel'; end if; end $x$$o$, false);
select t('prix négatif refusé', 3, $o$select importer_catalogue('[]','[{"fournisseur":"ETS KENFACK","reference":"NEG","designation":"d","prix_unitaire":-5}]')$o$, true);

-- comparaison des prix
select t('comparaison : FIL-100 chez 2 fournisseurs, médiane 12 500, écart 50 %', null, $o$do $x$ declare v record; begin
  select * into v from v_prix_reference where cle = 'fil-100';
  if v.nb_fournisseurs <> 2 or v.prix_median <> 12500 or round(v.ecart_max, 2) <> 0.50 then raise exception '%', v; end if; end $x$$o$, false);
select t('grille de prix alimentée par la DML (médiane)', 3, $o$do $x$ begin
  perform alimenter_grille_prix();
  if (select prix_plafond from grille_prix where reference = 'FIL-100') <> 12500 then raise exception 'grille %', (select prix_plafond from grille_prix where reference = 'FIL-100'); end if; end $x$$o$, false);
select t('chef ne peut pas alimenter la grille', 1, $o$select alimenter_grille_prix()$o$, true);

-- droits et traçabilité
select t('chef peut consulter les prix du catalogue', 1, $o$do $x$ begin
  if (select count(*) from articles_fournisseur) < 3 then raise exception 'invisible'; end if; end $x$$o$, false);
select t('chef ne peut pas modifier un prix', 1, $o$update articles_fournisseur set prix_unitaire = 1$o$, false);
select t('... et aucun prix n''a changé', null, $o$do $x$ begin
  if exists (select 1 from articles_fournisseur where prix_unitaire = 1) then raise exception 'prix modifié par un chef'; end if; end $x$$o$, false);
select t('chef ne peut pas créer un article', 1, $o$insert into articles_fournisseur(fournisseur_id, reference, designation, prix_unitaire) select id,'Z','z',1 from fournisseurs limit 1$o$, true);
select t('suppression d''un article interdite', 3, $o$delete from articles_fournisseur$o$, true);
select t('suppression d''un fournisseur interdite', 3, $o$delete from fournisseurs where raison_sociale='ETS KENFACK'$o$, true);
select t('historique des prix non modifiable', null, $o$update articles_prix_historique set prix = 0$o$, true);
select t('anon sans accès au catalogue', 1, $o$set role anon; select * from articles_fournisseur$o$, true);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
