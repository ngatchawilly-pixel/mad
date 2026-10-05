\set ON_ERROR_STOP off
create temp table res(n serial, label text, ok boolean, detail text);
grant all on res to authenticated; grant usage on sequence res_n_seq to authenticated;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','chef@baf'),('00000000-0000-0000-0000-000000000002','rm@baf'),
 ('00000000-0000-0000-0000-000000000003','dml'),('00000000-0000-0000-0000-000000000004','cg'),
 ('00000000-0000-0000-0000-000000000005','dg'),('00000000-0000-0000-0000-000000000006','tres'),
 ('00000000-0000-0000-0000-000000000007','chef@kri');
insert into profiles(id,nom,role,agence_code) values
 ('00000000-0000-0000-0000-000000000001','Chef BAF','CHEF','BAF'),
 ('00000000-0000-0000-0000-000000000002','RM BAF','RM','BAF'),
 ('00000000-0000-0000-0000-000000000003','DML','DML',null),
 ('00000000-0000-0000-0000-000000000004','CG','CG',null),
 ('00000000-0000-0000-0000-000000000005','DG','DG',null),
 ('00000000-0000-0000-0000-000000000006','TRES','TRES',null),
 ('00000000-0000-0000-0000-000000000007','Chef KRI','CHEF','KRI');
insert into parc(code,agence_code,famille,etat) values ('BAF-B01','BAF','Camion','Immobilisé'),('BAF-B02','BAF','Camion','Immobilisé');
insert into grille_prix values ('REF-1', 100000);

create function t(p_label text, p_uid int, p_sql text, p_expect_error boolean) returns void language plpgsql as $f$
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

-- création
select t('chef crée un besoin', 1, $$insert into besoins(id,agence_code,cycle_id) values ('aaaaaaaa-0000-0000-0000-000000000001','BAF','2610')$$, false);
select t('chef autre agence ne peut pas écrire sur BAF', 7, $$insert into besoins(agence_code,cycle_id) values ('BAF','2610')$$, true);
select t('ligne brouillon (id auto)', 1, $$insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,etat_vehicule,type_intervention,ot_panne,reference,designation,quantite,prix_unitaire,priorite,justification)
  values ('aaaaaaaa-0000-0000-0000-000000000001','BAF','2610','BAF-B01','Immobilisé','Remise en service','PA00000001','REF-1','Plaquettes',2,100000,'P1','Benne immobilisée')$$, false);
select t('R1 : id au format AGENCE-AAMM-NNNN', 1, $o$do $x$ begin if not exists (select 1 from lignes_besoin where id_besoin='BAF-2610-0001') then raise exception 'id absent'; end if; end $x$$o$, false);
select t('soumission incomplète refusée (sans justification)', 1, $$update lignes_besoin set justification='', statut='EXPRIMEE' where id_besoin='BAF-2610-0001'$$, true);
select t('R6 : > 250 000 sans devis refusé', 1, $$update lignes_besoin set justification='Benne immobilisée', quantite=3, statut='EXPRIMEE' where id_besoin='BAF-2610-0001'$$, true);
select t('prix > 15% grille sans explication refusé', 1, $$update lignes_besoin set quantite=2, prix_unitaire=130000, ref_devis='PF-1', statut='EXPRIMEE' where id_besoin='BAF-2610-0001'$$, true);
select t('soumission valide', 1, $$update lignes_besoin set prix_unitaire=130000, justification_prix='Pièce importée', ref_devis='PF-1', statut='EXPRIMEE' where id_besoin='BAF-2610-0001'$$, false);
select t('doublon véhicule+référence refusé', 2, $$insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,etat_vehicule,type_intervention,ot_panne,reference,designation,quantite,prix_unitaire,priorite,justification,ref_devis,justification_prix,statut)
  values ('aaaaaaaa-0000-0000-0000-000000000001','BAF','2610','BAF-B01','Immobilisé','Remise en service','PA00000001','REF-1','Doublon',1,130000,'P1','x','PF','x','EXPRIMEE')$$, true);

-- arbitrage
select t('chef ne peut pas valider sa ligne', 1, $$update lignes_besoin set statut='VALIDEE', mode='MDD', montant_retenu=260000 where id_besoin='BAF-2610-0001'$$, true);
select t('DML calcule les scores', 3, $$select calculer_scores('2610')$$, false);
select t('score attendu 85 (30+20+20+0+10+5)', 3, $o$do $x$ begin if (select score from lignes_besoin where id_besoin='BAF-2610-0001') <> 85 then raise exception 'score=%',(select score from lignes_besoin where id_besoin='BAF-2610-0001'); end if; end $x$$o$, false);
select t('validation sans mode/montant refusée', 3, $$update lignes_besoin set statut='VALIDEE' where id_besoin='BAF-2610-0001'$$, true);
select t('non-validation sans motif refusée', 3, $$update lignes_besoin set statut='NON_VALIDEE' where id_besoin='BAF-2610-0001'$$, true);
select t('DML valide (MDD, 260 000)', 3, $$update lignes_besoin set statut='VALIDEE', mode='MDD', montant_retenu=260000 where id_besoin='BAF-2610-0001'$$, false);

-- décision
select t('MAD refusée sans décision verrouillée (R4/R5)', 3, $$select generer_mad('BAF','2610','MDD')$$, true);
select t('DML fige la décision V1', 3, $$select figer_decision('2610')$$, false);
select t('chef ne peut pas figer', 1, $$select figer_decision('2610')$$, true);
select t('signature DML', 3, $$select signer_decision('DEC-DML-2610-V1')$$, false);
select t('MAD refusée : décision pas encore verrouillée', 3, $$select generer_mad('BAF','2610','MDD')$$, true);
select t('signature CG', 4, $$select signer_decision('DEC-DML-2610-V1')$$, false);
select t('trésorerie ne peut pas signer', 6, $$select signer_decision('DEC-DML-2610-V1')$$, true);
select t('signature DG -> verrouillée', 5, $$select signer_decision('DEC-DML-2610-V1')$$, false);
select t('décision verrouillée : contenu non modifiable', 3, $$update decisions set contenu='[]' where numero='DEC-DML-2610-V1'$$, true);

-- MAD
select t('DML génère la MAD (260 000 + 10% = 286 000)', 3, $$select generer_mad('BAF','2610','MDD')$$, false);
select t('R2 : montant = lignes + provision', 3, $o$do $x$ begin if (select montant from mad where numero='MAD-DML-2610-BAF') <> 286000 then raise exception 'montant incorrect'; end if; end $x$$o$, false);
select t('dépense refusée avant virement', 2, $$insert into depenses(id_besoin,agence_code,mad_numero,montant) values ('BAF-2610-0001','BAF','MAD-DML-2610-BAF',100000)$$, true);
select t('chef ne peut pas virer', 1, $$select virer_mad('MAD-DML-2610-BAF')$$, true);
select t('trésorerie vire', 6, $$select virer_mad('MAD-DML-2610-BAF')$$, false);
select t('chef accuse réception', 1, $$select accuser_mad('MAD-DML-2610-BAF')$$, false);
select t('chef KRI ne peut pas accuser une MAD BAF', 7, $$select accuser_mad('MAD-DML-2610-BAF')$$, true);

-- dépenses (séparation des tâches, R5)
select t('RM saisit une dépense sur la liste', 2, $$insert into depenses(id_besoin,agence_code,mad_numero,montant) values ('BAF-2610-0001','BAF','MAD-DML-2610-BAF',200000)$$, false);
select t('dépense au-delà du montant retenu refusée', 2, $$insert into depenses(id_besoin,agence_code,mad_numero,montant) values ('BAF-2610-0001','BAF','MAD-DML-2610-BAF',100000)$$, true);
select t('dépense hors liste refusée (R5)', 2, $$insert into depenses(id_besoin,agence_code,mad_numero,montant) values ('BAF-2610-9999','BAF','MAD-DML-2610-BAF',1000)$$, true);
select t('dépense sur provision acceptée', 2, $$insert into depenses(agence_code,mad_numero,montant,sur_provision) values ('BAF','MAD-DML-2610-BAF',20000,true)$$, false);
select t('provision dépassée refusée', 2, $$insert into depenses(agence_code,mad_numero,montant,sur_provision) values ('BAF','MAD-DML-2610-BAF',10000,true)$$, true);
select t('CG ne peut pas engager de dépense', 4, $$insert into depenses(id_besoin,agence_code,mad_numero,montant) values ('BAF-2610-0001','BAF','MAD-DML-2610-BAF',1000)$$, true);
select t('DML ne peut pas engager de dépense', 3, $$insert into depenses(agence_code,mad_numero,montant,sur_provision) values ('BAF','MAD-DML-2610-BAF',1000,true)$$, true);

-- suppressions, historique, isolation
select t('suppression d une ligne interdite', 3, $$delete from lignes_besoin where id_besoin='BAF-2610-0001'$$, true);
select t('suppression d une dépense interdite', 2, $$delete from depenses$$, true);
select t('historique non modifiable (même propriétaire)', null, $$update historique set motif='x'$$, true);
select t('chef KRI ne voit pas les lignes BAF', 7, $o$do $x$ begin if exists (select 1 from lignes_besoin) then raise exception 'visible'; end if; end $x$$o$, false);
select t('anon sans accès', 1, $$set role anon; select * from lignes_besoin$$, true);
select t('CG clôture une ligne EN_TRAITEMENT', 4, $$update lignes_besoin set statut='CLOTUREE' where id_besoin='BAF-2610-0001'$$, false);
select t('transition interdite CLOTUREE -> VALIDEE', 3, $$update lignes_besoin set statut='VALIDEE' where id_besoin='BAF-2610-0001'$$, true);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
