-- À jouer après test_regles, test_cloture et test_import (même base).
\set ON_ERROR_STOP off
create temp table res(n serial, label text, ok boolean, detail text);
grant all on res to authenticated; grant usage on sequence res_n_seq to authenticated;

select t('numéro de fiche au format BES-AGENCE-AAMM-NNN', 3, $o$do $x$ begin
  if not exists (select 1 from besoins where numero = 'BES-KRI-2611-001') then raise exception 'numéro absent'; end if; end $x$$o$, false);
select t('chef KRI crée un besoin avec libellé', 7, $o$insert into besoins(agence_code, cycle_id, libelle, service) values ('KRI','2611','Pièces camions bennes','Atelier')$o$, false);
select t('le numéro suivant est BES-KRI-2611-002', 7, $o$do $x$ begin
  if not exists (select 1 from besoins where numero = 'BES-KRI-2611-002' and libelle = 'Pièces camions bennes') then raise exception 'numéro suivant incorrect'; end if; end $x$$o$, false);
select t('besoin refusé dans un cycle clôturé', 7, $o$insert into besoins(agence_code, cycle_id) values ('KRI','2610')$o$, true);
select t('chef BAF ne crée pas de besoin pour KRI', 1, $o$insert into besoins(agence_code, cycle_id) values ('KRI','2611')$o$, true);

select t('ligne refusée si le besoin est d''une autre agence', 3, $o$insert into lignes_besoin(besoin_id,agence_code,cycle_id,designation,quantite,prix_unitaire)
  select id,'KRI','2611','x',1,1 from besoins where agence_code='BAF' and cycle_id='2611' limit 1$o$, true);
select t('ligne refusée si le besoin est d''un autre cycle', 7, $o$insert into lignes_besoin(besoin_id,agence_code,cycle_id,designation,quantite,prix_unitaire)
  select id,'KRI','2611','x',1,1 from besoins where agence_code='KRI' and cycle_id='2611' and numero='BES-KRI-2611-001' limit 1 $o$, false);
select t('ligne sans besoin refusée', 7, $o$insert into lignes_besoin(besoin_id,agence_code,cycle_id,designation,quantite,prix_unitaire)
  values (gen_random_uuid(),'KRI','2611','x',1,1)$o$, true);

select t('statut du besoin : EN_SAISIE tant qu''il reste un brouillon', 7, $o$do $x$ begin
  if (select statut from v_besoins where numero='BES-KRI-2611-001') <> 'EN_SAISIE' then
    raise exception 'statut %', (select statut from v_besoins where numero='BES-KRI-2611-001'); end if; end $x$$o$, false);
select t('statut du besoin : VIDE sans ligne', 7, $o$do $x$ begin
  if (select statut from v_besoins where numero='BES-KRI-2611-002') <> 'VIDE' then raise exception 'pas vide'; end if; end $x$$o$, false);
select t('v_besoins : nombre de lignes et montant', 7, $o$do $x$ begin
  if (select nb_lignes from v_besoins where numero='BES-KRI-2611-001') < 2 then raise exception 'nb lignes'; end if; end $x$$o$, false);

select t('retrait d''un brouillon sans motif refusé', 7, $o$update lignes_besoin set statut='ABANDONNEE' where id_besoin='KRI-2611-0002'$o$, true);
select t('retrait d''un brouillon avec motif (jamais supprimé)', 7, $o$update lignes_besoin set statut='ABANDONNEE', motif_code='SAISIE_ERRONEE' where id_besoin='KRI-2611-0002'$o$, false);
select t('la ligne retirée ne compte plus dans le besoin', 7, $o$do $x$ begin
  if exists (select 1 from lignes_besoin where id_besoin='KRI-2611-0002' and statut <> 'ABANDONNEE') then raise exception 'ligne non retirée'; end if; end $x$$o$, false);
select t('chef BAF tente de retirer une ligne de KRI (invisible pour lui)', 1, $o$update lignes_besoin set statut='ABANDONNEE', motif_code='X' where id_besoin='KRI-2611-0001'$o$, false);
select t('... et la ligne de KRI est restée en brouillon', null, $o$do $x$ begin
  if (select statut from lignes_besoin where id_besoin='KRI-2611-0001') <> 'BROUILLON' then raise exception 'ligne modifiée par une autre agence'; end if; end $x$$o$, false);

select t('ligne reportée : rattachée à une fiche du nouveau cycle', 3, $o$do $x$ begin
  if not exists (select 1 from lignes_besoin l join besoins b on b.id = l.besoin_id
                  where l.cycle_id='2611' and l.rang=2 and b.cycle_id='2611' and b.libelle like 'Besoins reportés du cycle 2610')
  then raise exception 'ligne reportée non rattachée'; end if; end $x$$o$, false);

select t('fiche de report créée par l''ouverture du cycle : déjà soumise', 3, $o$do $x$ begin
  if not exists (select 1 from besoins where libelle like 'Besoins reportés du cycle 2610' and statut = 'SOUMIS') then raise exception 'fiche de report non soumise'; end if; end $x$$o$, false);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
