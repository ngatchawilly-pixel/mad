-- À jouer après test_regles.sql et test_cloture.sql (cycle 2611 ouvert, utilisateurs de test présents).
\set ON_ERROR_STOP off
create temp table res(n serial, label text, ok boolean, detail text);
grant all on res to authenticated; grant usage on sequence res_n_seq to authenticated;

select t('chef ne peut pas importer', 1, $o$select importer_besoins('2611','[]','[]','[{"agence_code":"BAF"}]')$o$, true);
select t('cycle clôturé refusé', 3, $o$select importer_besoins('2610','[]','[]','[{"agence_code":"BAF","designation":"x","quantite":1,"prix_unitaire":1}]')$o$, true);
select t('import vide refusé', 3, $o$select importer_besoins('2611','[]','[]','[]')$o$, true);

select t('DML importe 3 lignes (2 agences, 1 nouveau véhicule, 1 fournisseur, 1 prix de grille)', 3, $o$do $x$ declare r jsonb; begin
  r := importer_besoins('2611',
    '[{"code":"KRI-T01","agence_code":"KRI","famille":"Camion","chassis":"VF1","etat":"Immobilisé"}]',
    '[{"reference":"REF-9","prix_plafond":10000}]',
    '[{"ligne_excel":2,"agence_code":"KRI","code_parc":"KRI-T01","etat_vehicule":"Immobilisé","type_intervention":"Remise en service","nature":"Pièce","ot_panne":null,"reference":"REF-9","designation":"Filtre","quantite":2,"prix_unitaire":10000,"fournisseur":"PLANETE AUTO PLUS","ref_devis":null,"priorite":"P1","justification":null},
      {"ligne_excel":3,"agence_code":"KRI","code_parc":"KRI-T01","etat_vehicule":"Immobilisé","type_intervention":"Remise en service","nature":"Pièce","ot_panne":null,"reference":"REF-10","designation":"Courroie","quantite":1,"prix_unitaire":5000,"fournisseur":"PLANETE AUTO PLUS","ref_devis":null,"priorite":"P1","justification":null},
      {"ligne_excel":4,"agence_code":"BER","code_parc":null,"etat_vehicule":"Sans objet","type_intervention":"Stock","nature":"Autre","ot_panne":null,"reference":null,"designation":"Stock outillage","quantite":1,"prix_unitaire":20000,"fournisseur":"","ref_devis":null,"priorite":"P3","justification":null}]');
  if (r->>'lignes' <> '3' or r->>'vehicules' <> '1' or r->>'fournisseurs' <> '1' or r->>'grille' <> '1') then raise exception '%', r; end if;
end $x$$o$, false);
select t('identifiants générés dans l''ordre (KRI-2611-0001, 0002, BER-2611-0001)', 3, $o$do $x$ begin
  if (select array_agg(id_besoin order by id_besoin) from lignes_besoin where cycle_id='2611' and agence_code in ('KRI','BER') and statut='BROUILLON')
     <> array['BER-2611-0001','KRI-2611-0001','KRI-2611-0002'] then raise exception 'ids inattendus'; end if; end $x$$o$, false);
select t('lignes importées en BROUILLON, fournisseur rattaché', 3, $o$do $x$ begin
  if (select count(*) from lignes_besoin l join fournisseurs f on f.id=l.fournisseur_id where l.cycle_id='2611' and l.statut='BROUILLON' and f.raison_sociale='PLANETE AUTO PLUS') <> 2
  then raise exception 'rattachement incorrect'; end if; end $x$$o$, false);
select t('une ligne invalide annule tout l''import (atomique)', 3, $o$select importer_besoins('2611','[]','[]',
  '[{"ligne_excel":2,"agence_code":"KRI","code_parc":"KRI-T01","etat_vehicule":"Immobilisé","designation":"Bon","quantite":1,"prix_unitaire":1,"priorite":"P1"},
    {"ligne_excel":3,"agence_code":"KRI","code_parc":"INCONNU","etat_vehicule":"Immobilisé","designation":"Mauvais","quantite":1,"prix_unitaire":1,"priorite":"P1"}]')$o$, true);
select t('rien n''a été écrit après l''échec', 3, $o$do $x$ begin
  if (select count(*) from lignes_besoin where cycle_id='2611' and designation in ('Bon','Mauvais')) <> 0 then raise exception 'import partiel'; end if; end $x$$o$, false);
select t('soumission du besoin importé sans justification refusée (règles actives)', 7, $o$select soumettre_besoin(id) from besoins where agence_code='KRI' and cycle_id='2611' order by created_at limit 1$o$, true);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
