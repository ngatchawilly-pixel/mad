-- À jouer après les autres tests ET après seed_referentiels.sql (cycle 2611 ouvert, utilisateurs de test présents).
\set ON_ERROR_STOP off
create temp table res(n serial, label text, ok boolean, detail text);
grant all on res to authenticated; grant usage on sequence res_n_seq to authenticated;

select t('19 agences (15 du seed + 4 sites du référentiel)', null, $o$do $x$ begin
  if (select count(*) from agences) <> 19 then raise exception '%', (select count(*) from agences); end if; end $x$$o$, false);
select t('pont bascule renseigné', null, $o$do $x$ begin
  if (select count(*) from agences where pont_bascule is not null) <> 17 then raise exception 'pont bascule'; end if; end $x$$o$, false);
select t('577 véhicules du référentiel au parc', null, $o$do $x$ begin
  if (select count(*) from parc where type_vehicule is not null) <> 577 then raise exception '%', (select count(*) from parc where type_vehicule is not null); end if; end $x$$o$, false);
select t('camions et engins', null, $o$do $x$ begin
  if (select count(*) filter (where famille='Camion') from parc where type_vehicule is not null) <> 495
     or (select count(*) filter (where famille='Engin') from parc where type_vehicule is not null) <> 82 then raise exception 'familles'; end if; end $x$$o$, false);
select t('codes INCONNUE non importés', null, $o$do $x$ begin
  if exists (select 1 from parc where upper(code) = 'INCONNUE') then raise exception 'INCONNUE présent'; end if; end $x$$o$, false);
select t('quasi-doublons signalés par une remarque (16 lignes)', null, $o$do $x$ begin
  if (select count(*) from parc where remarque like 'Doublon possible%') <> 16 then raise exception '%', (select count(*) from parc where remarque like 'Doublon possible%'); end if; end $x$$o$, false);
select t('véhicules sans doublon : pas de remarque', null, $o$do $x$ begin
  if (select remarque from parc where code = 'AM053') is not null then raise exception 'remarque inattendue'; end if; end $x$$o$, false);
select t('24 seuils du suivi des opérations, préfixés exploit_', null, $o$do $x$ begin
  if (select count(*) from parametres where cle like 'exploit\_%') <> 24 then raise exception 'seuils'; end if; end $x$$o$, false);
select t('les règles MAD ne sont pas modifiées (seuil devis 250 000)', null, $o$do $x$ begin
  if (select valeur from parametres where cle='seuil_devis') <> 250000 then raise exception 'seuil modifié'; end if; end $x$$o$, false);

-- Import des besoins sur un parc déjà chargé
select t('import : véhicule existant sans châssis -> état immobilisé et châssis complété, 0 véhicule créé', 3, $o$do $x$ declare r jsonb; begin
  r := importer_besoins('2611',
    '[{"code":"AM053","agence_code":"BAF","famille":"Camion","chassis":"CHX1","etat":"Immobilisé"}]', '[]',
    '[{"ligne_excel":2,"agence_code":"BAF","code_parc":"AM053","etat_vehicule":"Immobilisé","type_intervention":"Remise en service","nature":"Pièce","reference":"R1","designation":"Alternateur","quantite":1,"prix_unitaire":50000,"fournisseur":"","priorite":"P1"}]');
  if r->>'vehicules' <> '0' then raise exception 'véhicules créés : %', r; end if;
  if (select etat from parc where code='AM053') <> 'Immobilisé' then raise exception 'état non mis à jour'; end if;
  if (select chassis from parc where code='AM053') <> 'CHX1' then raise exception 'châssis non complété'; end if;
end $x$$o$, false);
select t('import : un châssis existant n''est jamais remplacé', 3, $o$do $x$ begin
  perform importer_besoins('2611',
    '[{"code":"AM053","agence_code":"BAF","famille":"Camion","chassis":"AUTRE","etat":"Immobilisé"}]', '[]',
    '[{"ligne_excel":3,"agence_code":"BAF","code_parc":"AM053","etat_vehicule":"Immobilisé","type_intervention":"Remise en service","nature":"Pièce","reference":"R2","designation":"Démarreur","quantite":1,"prix_unitaire":40000,"fournisseur":"","priorite":"P1"}]');
  if (select chassis from parc where code='AM053') <> 'CHX1' then raise exception 'châssis remplacé'; end if;
end $x$$o$, false);
select t('import : un véhicule « disponible » ne passe pas en immobilisé', 3, $o$do $x$ begin
  perform importer_besoins('2611', '[]', '[]',
    '[{"ligne_excel":4,"agence_code":"BAF","code_parc":"AM067","etat_vehicule":"Disponible","type_intervention":"Entretien préventif","nature":"Pièce","reference":"R3","designation":"Filtre","quantite":1,"prix_unitaire":10000,"fournisseur":"","priorite":"P2"}]');
  if (select etat from parc where code='AM067') <> 'Disponible' then raise exception 'état modifié à tort'; end if;
end $x$$o$, false);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
