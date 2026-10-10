-- À jouer APRÈS test_regles.sql (même base : réutilise les utilisateurs de test).
-- Cycle de besoins : clôture, cycle suivant automatique, puis suivi financier (compte d'emploi, procès-verbal) sur le cycle clos.
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

-- ---------- Préparation (propriétaire) ----------
-- Déjà là (test_regles) : la ligne BAF-2610-0001 financée par la MAD-DML-2610-BAF, une dépense sur ligne (200 000), une sur provision (20 000).
-- 1. une ligne qui attend encore la décision de la DML
insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,etat_vehicule,type_intervention,ot_panne,reference,designation,quantite,prix_unitaire,priorite,justification,statut)
 values ('aaaaaaaa-0000-0000-0000-000000000001','BAF','2610','BAF-B02','Immobilisé','Remise en service','PA00000002','REF-2','Filtre en attente',1,50000,'P2','Panne','EXPRIMEE');
-- 2. une ligne financée mais jamais dépensée (sera reportée à la clôture financière)
insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,etat_vehicule,type_intervention,reference,designation,quantite,prix_unitaire,priorite,justification,statut)
 values ('aaaaaaaa-0000-0000-0000-000000000001','BAF','2610','BAF-B01','Immobilisé','Entretien préventif','REF-4','Courroie financée',1,30000,'P3','Entretien','EXPRIMEE');
update lignes_besoin set statut='VALIDEE', mode='MDD', montant_retenu=30000 where designation='Courroie financée';
update lignes_besoin set statut='MAD_ETABLIE', mad_numero='MAD-DML-2610-BAF' where designation='Courroie financée';
update lignes_besoin set statut='EN_TRAITEMENT' where designation='Courroie financée';
-- 3. un besoin que l'agence n'a pas encore soumis
insert into besoins(agence_code, cycle_id, libelle) values ('BAF','2610','Brouillon en cours');
insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,designation,quantite,prix_unitaire,priorite,justification)
 select id,'BAF','2610','BAF-B02','Ligne en brouillon',1,10000,'P3','à finir' from besoins where libelle = 'Brouillon en cours';
insert into pieces(depense_id, type, storage_path)
 select id, 'facture', 'BAF/x/facture.pdf' from depenses where id_besoin = 'BAF-2610-0001';

-- ---------- Clôture du cycle de besoins ----------
select t('le chef d''agence ne clôture pas le cycle', 1, $o$select cloturer_cycle('2610')$o$, true);
select t('clôture refusée : une ligne attend encore la décision de la DML', 3, $o$select cloturer_cycle('2610')$o$, true);
select set_config('request.jwt.claim.sub', '', false);   -- retour en propriétaire (t() laisse l'identité de l'utilisateur simulé)
update lignes_besoin set statut='VALIDEE', mode='MDD', montant_retenu=50000 where designation='Filtre en attente';
select t('clôture refusée : une ligne validée n''a pas encore de MAD', 3, $o$select cloturer_cycle('2610')$o$, true);
select set_config('request.jwt.claim.sub', '', false);
update lignes_besoin set statut='NON_VALIDEE', motif_code='BUDGET', mode=null, montant_retenu=null where designation='Filtre en attente';
-- une seconde ligne non validée, avec le motif « reporté »
insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,etat_vehicule,type_intervention,reference,designation,quantite,prix_unitaire,priorite,justification,statut)
 values ('aaaaaaaa-0000-0000-0000-000000000001','BAF','2610','BAF-B02','Disponible','Entretien préventif','REF-3','Pompe reportée',1,20000,'P3','Entretien','EXPRIMEE');
update lignes_besoin set statut='NON_VALIDEE', motif_code='REPORTE' where designation='Pompe reportée';

select t('prochain identifiant libre : 2612 donne 2701', null, $o$do $x$ begin
  if cycle_suivant_libre('2612') <> '2701' then raise exception '%', cycle_suivant_libre('2612'); end if; end $x$$o$, false);
select t('la DML clôture le cycle : cycle suivant 2611, 1 MAD, 2 lignes non validées reportées, 1 besoin en saisie suivi', 3, $o$do $x$ declare r jsonb; begin
  r := cloturer_cycle('2610');
  if r->>'cycle_suivant' <> '2611' or (r->>'mad')::int <> 1 or (r->>'lignes_non_validees_reportees')::int <> 2 or (r->>'besoins_en_saisie_reportes')::int <> 1
  then raise exception '%', r; end if; end $x$$o$, false);
select t('cycle 2610 clos, relié à 2611 ; cycle 2611 ouvert', null, $o$do $x$ begin
  if (select statut from cycles where id = '2610') <> 'CLOTURE' or (select cycle_suivant from cycles where id = '2610') <> '2611'
     or (select statut from cycles where id = '2611') <> 'OUVERT' then raise exception 'cycles'; end if; end $x$$o$, false);
select t('lignes non validées reprises : même identifiant, rang 2, cycle 2611, +10 points seulement pour « reporté »', null, $o$do $x$ begin
  if (select count(*) from lignes_besoin where cycle_id = '2611' and statut = 'REEXPRIMEE' and rang = 2 and id_besoin like 'BAF-2610-%') <> 2
     or (select bonus_report from lignes_besoin where designation = 'Pompe reportée') <> 10
     or (select bonus_report from lignes_besoin where designation = 'Filtre en attente') <> 0 then raise exception 'reprise incorrecte'; end if; end $x$$o$, false);
select t('elles sont rangées dans une fiche « Besoins non validés du cycle 2610 », déjà soumise', null, $o$do $x$ begin
  if not exists (select 1 from besoins b join lignes_besoin l on l.besoin_id = b.id
                  where b.cycle_id = '2611' and b.libelle = 'Besoins non validés du cycle 2610' and b.statut = 'SOUMIS' and l.designation = 'Pompe reportée')
  then raise exception 'fiche de report absente'; end if; end $x$$o$, false);
select t('le besoin en saisie et sa ligne suivent dans le cycle 2611, toujours modifiables', null, $o$do $x$ begin
  if not exists (select 1 from besoins b join lignes_besoin l on l.besoin_id = b.id
                  where b.libelle = 'Brouillon en cours' and b.cycle_id = '2611' and b.statut = 'EN_SAISIE' and l.cycle_id = '2611' and l.statut = 'BROUILLON')
  then raise exception 'besoin en saisie non reporté'; end if; end $x$$o$, false);
select t('la MAD et la ligne financée restent dans le cycle clos', null, $o$do $x$ begin
  if (select cycle_id from mad where numero = 'MAD-DML-2610-BAF') <> '2610' or (select cycle_id from lignes_besoin where id_besoin = 'BAF-2610-0001') <> '2610'
  then raise exception 'rattachement modifié'; end if; end $x$$o$, false);
select t('la clôture est tracée avec le cycle suivant', null, $o$do $x$ begin
  if not exists (select 1 from historique where entite = 'CYCLE' and entite_id = '2610' and nouveau = 'CLOTURE' and motif like 'cycle suivant 2611%') then raise exception 'trace'; end if; end $x$$o$, false);
select t('plus de nouveau besoin dans le cycle clos', 1, $o$insert into besoins(agence_code, cycle_id) values ('BAF','2610')$o$, true);
select t('on ne clôture pas deux fois le même cycle', 3, $o$select cloturer_cycle('2610')$o$, true);
select t('l''ancienne ouverture manuelle de cycle n''existe plus', 3, $o$select ouvrir_cycle('2699')$o$, true);

-- ---------- Suivi financier de la MAD, sur le cycle déjà clos ----------
-- Dépôt du compte d'emploi
select t('dépôt refusé si dépenses + solde <> montant reçu', 1, $$select deposer_compte('MAD-DML-2610-BAF', 1000)$$, true);
select t('RM ne dépose pas le compte', 2, $$select deposer_compte('MAD-DML-2610-BAF', 66000)$$, true);
select t('chef d''une autre agence ne dépose pas', 7, $$select deposer_compte('MAD-DML-2610-BAF', 66000)$$, true);
select t('chef dépose, malgré le cycle clos (220 000 + 66 000 = 286 000)', 1, $$select deposer_compte('MAD-DML-2610-BAF', 66000)$$, false);
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

-- ---------- Clôture financière (procès-verbal) ----------
select t('chef ne prépare pas la clôture financière', 1, $$select preparer_cloture('2610')$$, true);
select t('clôture financière refusée pour un cycle encore ouvert (2611)', 3, $$select preparer_cloture('2611')$$, true);
select t('DML prépare le PV du cycle clos', 3, $$select preparer_cloture('2610')$$, false);
select t('PV : taux de justification 220/286', 3, $o$do $x$ begin
  if (select (pv->>'taux_justification')::numeric from clotures where cycle_id='2610') <> 0.7692 then
    raise exception 'taux %', (select pv->>'taux_justification' from clotures where cycle_id='2610'); end if; end $x$$o$, false);
select t('signature DML', 3, $$select signer_cloture('2610')$$, false);
select t('trésorerie ne signe pas la clôture', 6, $$select signer_cloture('2610')$$, true);
select t('signature CG', 4, $$select signer_cloture('2610')$$, false);
select t('avant la 3e signature : rien n''est finalisé', 4, $o$do $x$ begin
  if (select statut from lignes_besoin where designation = 'Courroie financée') <> 'EN_TRAITEMENT' then raise exception 'finalisé trop tôt'; end if;
  if (select pv->>'verrouille' from clotures where cycle_id = '2610') is not null then raise exception 'PV verrouillé trop tôt'; end if; end $x$$o$, false);
select t('signature DG : PV verrouillé', 5, $$select signer_cloture('2610')$$, false);
select t('ligne financée et non dépensée : reportée dans le cycle ouvert 2611 avec +10 points', null, $o$do $x$ begin
  if not exists (select 1 from lignes_besoin where designation = 'Courroie financée' and statut = 'REEXPRIMEE' and cycle_id = '2611' and rang = 2 and bonus_report = 10)
  then raise exception 'report absent'; end if; end $x$$o$, false);
select t('ligne réalisée : reste clôturée dans son cycle', null, $o$do $x$ begin
  if (select statut from lignes_besoin where id_besoin = 'BAF-2610-0001') <> 'CLOTUREE' then raise exception 'statut'; end if; end $x$$o$, false);
select t('la clôture financière ne se signe qu''une fois', 3, $$select signer_cloture('2610')$$, true);
select t('les lignes reportées reçoivent un score', 3, $o$do $x$ begin
  perform calculer_scores('2611');
  if exists (select 1 from lignes_besoin where cycle_id = '2611' and statut = 'REEXPRIMEE' and score is null) then raise exception 'score nul'; end if; end $x$$o$, false);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
