-- À jouer APRÈS test_regles.sql (même base : réutilise la fonction t() et les utilisateurs de test).
\set ON_ERROR_STOP off
create temp table res(n serial, label text, ok boolean, detail text);
grant all on res to authenticated; grant usage on sequence res_n_seq to authenticated;
-- t() écrit dans la table res de la session précédente : on la redéfinit ici
create or replace function t(p_label text, p_uid int, p_sql text, p_expect_error boolean) returns void language plpgsql as $f$
declare ok boolean; d text;
begin
  perform set_config('request.jwt.claim.sub', case when p_uid is null then '' else '00000000-0000-0000-0000-00000000000'||p_uid end, false);
  if p_uid is not null then execute 'set role authenticated'; end if;
  begin
    execute p_sql;
    ok := not p_expect_error; d := case when ok then 'ok' else 'AUCUNE ERREUR (attendue)' end;
  exception when others then
    ok := p_expect_error; d := sqlerrm;
  end;
  reset role;
  insert into res(label, ok, detail) values (p_label, ok, left(d,110));
end $f$;

-- Préparation (propriétaire) : une dépense sur ligne (200 000) et une sur provision (20 000) existent déjà.
-- On ajoute une seconde ligne non traitée qui devra être reportée, et une pièce pour la dépense sur ligne.
insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,etat_vehicule,type_intervention,ot_panne,reference,designation,quantite,prix_unitaire,priorite,justification,statut)
 values ('aaaaaaaa-0000-0000-0000-000000000001','BAF','2610','BAF-B02','Immobilisé','Remise en service','PA00000002','REF-2','Filtre',1,50000,'P2','Panne','EXPRIMEE');
insert into pieces(depense_id, type, storage_path)
 select id, 'facture', 'BAF/x/facture.pdf' from depenses where id_besoin = 'BAF-2610-0001';

-- Dépôt du compte d'emploi
select t('dépôt refusé si dépenses + solde <> montant reçu', 1, $$select deposer_compte('MAD-DML-2610-BAF', 1000)$$, true);
select t('RM ne dépose pas le compte', 2, $$select deposer_compte('MAD-DML-2610-BAF', 66000)$$, true);
select t('chef d''une autre agence ne dépose pas', 7, $$select deposer_compte('MAD-DML-2610-BAF', 66000)$$, true);
select t('chef dépose (220 000 + 66 000 = 286 000)', 1, $$select deposer_compte('MAD-DML-2610-BAF', 66000)$$, false);
select t('dépense refusée après dépôt (figée)', 2, $$insert into depenses(agence_code,mad_numero,montant,sur_provision) values ('BAF','MAD-DML-2610-BAF',1000,true)$$, true);

-- Contrôle de conformité
select t('chef ne peut pas classer', 1, $o$do $x$ begin perform classer_compte((select id from comptes_emploi limit 1)); end $x$$o$, true);
select t('CG classe automatiquement 2 dépenses', 4, $o$do $x$ begin
  if classer_compte((select id from comptes_emploi limit 1)) <> 2 then raise exception 'attendu 2'; end if; end $x$$o$, false);
select t('proposition : avec pièces = CONFORME, sans pièces = NON_CONFORME', 4, $o$do $x$ begin
  if (select count(*) from classements where categorie='CONFORME') <> 1 or (select count(*) from classements where categorie='NON_CONFORME') <> 1
  then raise exception 'classement inattendu'; end if; end $x$$o$, false);
select t('contrôle refusé tant que non confirmé', 4, $$select controler_compte((select id from comptes_emploi limit 1))$$, true);
select t('non conforme sans motif refusé', 4, $$select confirmer_classement((select id from classements where categorie='NON_CONFORME'), 'NON_CONFORME', null)$$, true);
select t('CG confirme le conforme', 4, $$select confirmer_classement((select id from classements where categorie='CONFORME'), 'CONFORME')$$, false);
select t('CG confirme le non conforme avec motif', 4, $$select confirmer_classement((select id from classements where categorie='NON_CONFORME'), 'NON_CONFORME', 'Facture manquante')$$, false);
select t('contrôle : compte à régulariser (1 non conforme)', 4, $o$do $x$ begin
  perform controler_compte((select id from comptes_emploi limit 1));
  if (select statut from comptes_emploi limit 1) <> 'A_REGULARISER' then raise exception 'statut %', (select statut from comptes_emploi limit 1); end if; end $x$$o$, false);
select t('régularisation : l''agence peut compléter les pièces', 2, $$insert into pieces(depense_id,type,storage_path) select id,'recu','BAF/y/recu.pdf' from depenses where sur_provision$$, false);

-- Clôture
select t('chef ne prépare pas la clôture', 1, $$select preparer_cloture('2610')$$, true);
select t('DML prépare le PV', 3, $$select preparer_cloture('2610')$$, false);
select t('PV : taux de justification 220/286', 3, $o$do $x$ begin
  if (select (pv->>'taux_justification')::numeric from clotures where cycle_id='2610') <> 0.7692 then
    raise exception 'taux %', (select pv->>'taux_justification' from clotures where cycle_id='2610'); end if; end $x$$o$, false);
select t('ouverture du cycle suivant refusée avant clôture', 3, $$select ouvrir_cycle('2611')$$, true);
select t('signature DML', 3, $$select signer_cloture('2610')$$, false);
select t('trésorerie ne signe pas la clôture', 6, $$select signer_cloture('2610')$$, true);
select t('signature CG', 4, $$select signer_cloture('2610')$$, false);
select t('cycle encore ouvert avant la 3e signature', 4, $o$do $x$ begin if (select statut from cycles where id='2610') <> 'OUVERT' then raise exception 'clos trop tôt'; end if; end $x$$o$, false);
select t('signature DG -> cycle clôturé', 5, $$select signer_cloture('2610')$$, false);
select t('cycle 2610 clôturé', 5, $o$do $x$ begin if (select statut from cycles where id='2610') <> 'CLOTURE' then raise exception 'pas clôturé'; end if; end $x$$o$, false);
select t('ligne non traitée reportée avec motif REPORTE', 5, $o$do $x$ begin
  if (select count(*) from lignes_besoin where cycle_id='2610' and statut='NON_VALIDEE' and motif_code='REPORTE') <> 1 then raise exception 'report absent'; end if; end $x$$o$, false);

-- Cycle suivant
select t('DML ouvre le cycle 2611 : 1 ligne reportée', 3, $o$do $x$ declare r jsonb; begin
  r := ouvrir_cycle('2611'); if (r->>'lignes_reportees')::int <> 1 then raise exception '%', r; end if; end $x$$o$, false);
select t('ligne reportée : même identifiant, rang 2, +10 points', 3, $o$do $x$ begin
  if not exists (select 1 from lignes_besoin where cycle_id='2611' and statut='REEXPRIMEE' and rang=2 and bonus_report=10 and id_besoin like 'BAF-2610-%')
  then raise exception 'report incorrect'; end if; end $x$$o$, false);
select t('ligne reportée : revérifier, le score inclut le bonus', 3, $o$do $x$ begin
  perform calculer_scores('2611');
  if (select score from lignes_besoin where cycle_id='2611') is null then raise exception 'score nul'; end if; end $x$$o$, false);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
