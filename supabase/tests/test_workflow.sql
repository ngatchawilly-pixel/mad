-- Circuit au niveau du besoin. À jouer après test_regles (utilisateurs 1 chef BAF, 2 RM BAF, 3 DML, 4 CG, 5 DG, 7 chef KRI ;
-- véhicules BAF-B01 et BAF-B02 au parc).
\set ON_ERROR_STOP off
create temp table res(n serial, label text, ok boolean, detail text);
grant all on res to authenticated; grant usage on sequence res_n_seq to authenticated;

insert into cycles(id) values ('2612');
create function wf_besoin() returns uuid language sql stable as $f$ select id from besoins where numero = 'BES-BAF-2612-001' $f$;
grant execute on function wf_besoin() to authenticated;

-- ---------- Préparation par l'agence ----------
select t('le chef crée le besoin', 1, $o$insert into besoins(agence_code, cycle_id, libelle) values ('BAF','2612','Pièces des bennes immobilisées')$o$, false);
select t('le responsable maintenance saisit 3 lignes (L3 sans justification)', 2, $o$do $x$ begin
  insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,etat_vehicule,type_intervention,ot_panne,reference,designation,quantite,prix_unitaire,priorite,justification) values
   (wf_besoin(),'BAF','2612','BAF-B01','Immobilisé','Remise en service','PA1','REF-A','Courroie',1,100000,'P1','Benne à l''arrêt'),
   (wf_besoin(),'BAF','2612','BAF-B02','Immobilisé','Remise en service','PA2','REF-B','Alternateur',1,200000,'P2','Démarrage impossible'),
   (wf_besoin(),'BAF','2612','BAF-B01','Immobilisé','Entretien préventif',null,'REF-C','Filtre',1,50000,'P3',null);
end $x$$o$, false);
select t('les 3 lignes sont en brouillon (BAF-2612-0001 à 0003)', null, $o$do $x$ begin
  if (select count(*) from lignes_besoin where besoin_id = wf_besoin() and statut = 'BROUILLON') <> 3 then raise exception 'brouillons'; end if; end $x$$o$, false);
select t('une ligne ne peut pas être créée déjà soumise', 1, $o$insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,designation,quantite,prix_unitaire,priorite,justification,statut)
  values (wf_besoin(),'BAF','2612','BAF-B02','Triche',1,1,'P3','x','EXPRIMEE')$o$, true);

-- ---------- Plus de soumission ligne par ligne ----------
select t('soumission d''une seule ligne refusée (chef)', 1, $o$update lignes_besoin set statut='EXPRIMEE' where id_besoin='BAF-2612-0001'$o$, true);
select t('soumission d''une seule ligne refusée (DML)', 3, $o$update lignes_besoin set statut='EXPRIMEE' where id_besoin='BAF-2612-0001'$o$, true);

-- ---------- Soumission du besoin ----------
select t('le responsable maintenance ne soumet pas le besoin (c''est le chef)', 2, $o$select soumettre_besoin(wf_besoin())$o$, true);
select t('la DML ne soumet pas le besoin d''une agence', 3, $o$select soumettre_besoin(wf_besoin())$o$, true);
select t('le chef d''une autre agence ne soumet pas', 7, $o$select soumettre_besoin(wf_besoin())$o$, true);
select t('soumission refusée car L3 est incomplète, et le message nomme la ligne', 1, $o$do $x$ begin
  begin perform soumettre_besoin(wf_besoin()); raise exception 'AUCUNE ERREUR';
  exception when others then if sqlerrm not like '%BAF-2612-0003%' then raise exception 'message sans la ligne : %', sqlerrm; end if; end;
end $x$$o$, false);
select t('tout ou rien : les 3 lignes sont restées en brouillon et le besoin en saisie', null, $o$do $x$ begin
  if (select count(*) from lignes_besoin where besoin_id = wf_besoin() and statut = 'BROUILLON') <> 3 then raise exception 'lignes modifiées'; end if;
  if (select statut from v_besoins where id = wf_besoin()) <> 'EN_SAISIE' then raise exception 'statut %', (select statut from v_besoins where id = wf_besoin()); end if; end $x$$o$, false);
select t('le responsable maintenance complète L3', 2, $o$update lignes_besoin set justification = 'Entretien périodique' where id_besoin = 'BAF-2612-0003'$o$, false);
select t('le chef soumet le besoin d''un seul coup', 1, $o$do $x$ declare r jsonb; begin
  r := soumettre_besoin(wf_besoin());
  if r->>'lignes_soumises' <> '3' then raise exception '%', r; end if; end $x$$o$, false);
select t('les 3 lignes sont exprimées et le besoin est SOUMIS', null, $o$do $x$ begin
  if (select count(*) from lignes_besoin where besoin_id = wf_besoin() and statut = 'EXPRIMEE') <> 3 then raise exception 'lignes'; end if;
  if (select statut from v_besoins where id = wf_besoin()) <> 'SOUMIS' then raise exception 'statut besoin'; end if; end $x$$o$, false);
select t('la soumission est tracée', null, $o$do $x$ begin
  if not exists (select 1 from historique where entite='BESOIN' and entite_id='BES-BAF-2612-001' and nouveau='SOUMIS') then raise exception 'trace'; end if; end $x$$o$, false);
select t('besoin déjà soumis : pas de seconde soumission', 1, $o$select soumettre_besoin(wf_besoin())$o$, true);

-- ---------- Besoin soumis : verrouillé pour l'agence ----------
select t('le chef ne peut plus ajouter de ligne', 1, $o$insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,designation,quantite,prix_unitaire,priorite,justification)
  values (wf_besoin(),'BAF','2612','BAF-B02','Tardif',1,1,'P3','x')$o$, true);
select t('le responsable maintenance ne peut plus ajouter de ligne', 2, $o$insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,designation,quantite,prix_unitaire,priorite,justification)
  values (wf_besoin(),'BAF','2612','BAF-B02','Tardif',1,1,'P3','x')$o$, true);
select t('le chef ne peut pas modifier le prix d''une ligne soumise', 1, $o$update lignes_besoin set prix_unitaire = 1 where id_besoin = 'BAF-2612-0001'$o$, true);
select t('le chef ne peut pas changer le statut du besoin à la main', 1, $o$update besoins set statut = 'DECIDE' where numero = 'BES-BAF-2612-001'$o$, true);
select t('le chef peut encore corriger le libellé', 1, $o$update besoins set libelle = 'Pièces des bennes immobilisées (BAF)' where numero = 'BES-BAF-2612-001'$o$, false);
select t('la DML ne valide pas une ligne isolée', 3, $o$update lignes_besoin set statut='VALIDEE', mode='MDD', montant_retenu=100000 where id_besoin='BAF-2612-0001'$o$, true);

-- ---------- Rappel tant que la DML n'a pas décidé ----------
select t('un autre chef ne rappelle pas le besoin', 7, $o$select rappeler_besoin(wf_besoin())$o$, true);
select t('le chef rappelle son besoin', 1, $o$select rappeler_besoin(wf_besoin())$o$, false);
select t('besoin de nouveau en saisie, lignes en brouillon', null, $o$do $x$ begin
  if (select count(*) from lignes_besoin where besoin_id = wf_besoin() and statut = 'BROUILLON') <> 3 then raise exception 'lignes'; end if;
  if (select statut from v_besoins where id = wf_besoin()) <> 'EN_SAISIE' then raise exception 'statut'; end if; end $x$$o$, false);
select t('le chef ajoute à nouveau une ligne puis la retire (jamais supprimée)', 1, $o$do $x$ begin
  insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,designation,quantite,prix_unitaire,priorite,justification)
    values (wf_besoin(),'BAF','2612','BAF-B02','Ligne éphémère',1,1000,'P3','test');
  update lignes_besoin set statut='ABANDONNEE', motif_code='SAISIE_ERRONEE' where designation='Ligne éphémère' and cycle_id='2612'; end $x$$o$, false);
select t('le chef soumet à nouveau (la ligne retirée est ignorée)', 1, $o$do $x$ declare r jsonb; begin
  r := soumettre_besoin(wf_besoin()); if r->>'lignes_soumises' <> '3' then raise exception '%', r; end if; end $x$$o$, false);

-- ---------- Décision de la DML : sélection des lignes puis validation du besoin ----------
select t('le chef ne décide pas', 1, $o$select decider_besoin(wf_besoin(), '[]')$o$, true);
select t('le contrôle de gestion ne décide pas', 4, $o$select decider_besoin(wf_besoin(), '[]')$o$, true);
select t('décision refusée si une ligne manque', 3, $o$select decider_besoin(wf_besoin(),
  '[{"id_besoin":"BAF-2612-0001","decision":"VALIDEE","mode":"MDD","montant_retenu":100000},
    {"id_besoin":"BAF-2612-0002","decision":"VALIDEE","mode":"MDD","montant_retenu":150000}]')$o$, true);
select t('décision refusée si une ligne n''appartient pas au besoin', 3, $o$select decider_besoin(wf_besoin(),
  '[{"id_besoin":"BAF-2612-0001","decision":"VALIDEE","mode":"MDD","montant_retenu":100000},
    {"id_besoin":"BAF-2612-0002","decision":"VALIDEE","mode":"MDD","montant_retenu":150000},
    {"id_besoin":"KRI-2611-0001","decision":"NON_VALIDEE","motif_code":"BUDGET"}]')$o$, true);
select t('montant retenu supérieur au montant demandé refusé', 3, $o$select decider_besoin(wf_besoin(),
  '[{"id_besoin":"BAF-2612-0001","decision":"VALIDEE","mode":"MDD","montant_retenu":999999},
    {"id_besoin":"BAF-2612-0002","decision":"VALIDEE","mode":"MDD","montant_retenu":150000},
    {"id_besoin":"BAF-2612-0003","decision":"NON_VALIDEE","motif_code":"BUDGET"}]')$o$, true);
select t('ligne non retenue sans motif refusée', 3, $o$select decider_besoin(wf_besoin(),
  '[{"id_besoin":"BAF-2612-0001","decision":"VALIDEE","mode":"MDD","montant_retenu":100000},
    {"id_besoin":"BAF-2612-0002","decision":"VALIDEE","mode":"MDD","montant_retenu":150000},
    {"id_besoin":"BAF-2612-0003","decision":"NON_VALIDEE"}]')$o$, true);
select t('ligne retenue sans mode refusée', 3, $o$select decider_besoin(wf_besoin(),
  '[{"id_besoin":"BAF-2612-0001","decision":"VALIDEE","montant_retenu":100000},
    {"id_besoin":"BAF-2612-0002","decision":"VALIDEE","mode":"MDD","montant_retenu":150000},
    {"id_besoin":"BAF-2612-0003","decision":"NON_VALIDEE","motif_code":"BUDGET"}]')$o$, true);
select t('décision inconnue refusée', 3, $o$select decider_besoin(wf_besoin(),
  '[{"id_besoin":"BAF-2612-0001","decision":"PEUT-ETRE"},
    {"id_besoin":"BAF-2612-0002","decision":"VALIDEE","mode":"MDD","montant_retenu":150000},
    {"id_besoin":"BAF-2612-0003","decision":"NON_VALIDEE","motif_code":"BUDGET"}]')$o$, true);
select t('tout ou rien : après les refus, les 3 lignes sont toujours en attente', null, $o$do $x$ begin
  if (select count(*) from lignes_besoin where besoin_id = wf_besoin() and statut = 'EXPRIMEE') <> 3 then raise exception 'décision partielle'; end if;
  if (select statut from v_besoins where id = wf_besoin()) <> 'SOUMIS' then raise exception 'statut'; end if; end $x$$o$, false);

select t('la DML retient L1 (MDD) et L2 (MDI, montant réduit), écarte L3 avec motif', 3, $o$do $x$ declare r jsonb; begin
  r := decider_besoin(wf_besoin(),
  '[{"id_besoin":"BAF-2612-0001","decision":"VALIDEE","mode":"MDD","montant_retenu":100000},
    {"id_besoin":"BAF-2612-0002","decision":"VALIDEE","mode":"MDI","montant_retenu":150000},
    {"id_besoin":"BAF-2612-0003","decision":"NON_VALIDEE","motif_code":"BUDGET"}]');
  if r->>'retenues' <> '2' or r->>'non_retenues' <> '1' then raise exception '%', r; end if; end $x$$o$, false);
select t('statuts des lignes : 2 validées, 1 non validée avec motif', null, $o$do $x$ begin
  if (select count(*) from lignes_besoin where besoin_id = wf_besoin() and statut = 'VALIDEE') <> 2
     or (select motif_code from lignes_besoin where id_besoin = 'BAF-2612-0003') <> 'BUDGET'
     or (select montant_retenu from lignes_besoin where id_besoin = 'BAF-2612-0002') <> 150000
     or (select mode from lignes_besoin where id_besoin = 'BAF-2612-0002') <> 'MDI' then raise exception 'statuts'; end if; end $x$$o$, false);
select t('statut du besoin déduit : partiellement validé', null, $o$do $x$ begin
  if (select statut from v_besoins where id = wf_besoin()) <> 'PARTIELLEMENT_VALIDE' then raise exception '%', (select statut from v_besoins where id = wf_besoin()); end if; end $x$$o$, false);
select t('la décision est tracée avec le détail', null, $o$do $x$ begin
  if not exists (select 1 from historique where entite='BESOIN' and entite_id='BES-BAF-2612-001' and nouveau='DECIDE' and motif like '2 retenue(s), 1 non retenue(s)') then raise exception 'trace'; end if; end $x$$o$, false);
select t('pas de seconde décision', 3, $o$select decider_besoin(wf_besoin(), '[]')$o$, true);
select t('plus de rappel après décision', 1, $o$select rappeler_besoin(wf_besoin())$o$, true);

-- ---------- Réexpression des lignes non retenues ----------
select t('un autre chef ne réexprime pas', 7, $o$select reexprimer_besoin(wf_besoin())$o$, true);
select t('le chef réexprime les lignes non retenues', 1, $o$do $x$ declare r jsonb; begin
  r := reexprimer_besoin(wf_besoin()); if r->>'lignes_reexprimees' <> '1' then raise exception '%', r; end if; end $x$$o$, false);
select t('L3 est réexprimée (rang 2) et le besoin de nouveau soumis', null, $o$do $x$ begin
  if (select statut from lignes_besoin where id_besoin = 'BAF-2612-0003') <> 'REEXPRIMEE' or (select rang from lignes_besoin where id_besoin = 'BAF-2612-0003') <> 2
  then raise exception 'ligne'; end if;
  if (select statut from v_besoins where id = wf_besoin()) <> 'SOUMIS' then raise exception 'besoin'; end if; end $x$$o$, false);
select t('la DML tranche la seule ligne en attente (L1 et L2 restent validées)', 3, $o$do $x$ declare r jsonb; begin
  r := decider_besoin(wf_besoin(), '[{"id_besoin":"BAF-2612-0003","decision":"VALIDEE","mode":"MDD","montant_retenu":50000}]');
  if r->>'retenues' <> '1' then raise exception '%', r; end if; end $x$$o$, false);
select t('statut du besoin : entièrement validé', null, $o$do $x$ begin
  if (select statut from v_besoins where id = wf_besoin()) <> 'ENTIEREMENT_VALIDE' then raise exception '%', (select statut from v_besoins where id = wf_besoin()); end if; end $x$$o$, false);
select t('rien à réexprimer quand tout est validé', 1, $o$select reexprimer_besoin(wf_besoin())$o$, true);

-- ---------- Un besoin reporté ou sacrifié ne se réexprime pas dans le même cycle ----------
select t('le besoin suivant : une ligne non retenue « REPORTE »', 1, $o$do $x$ declare b uuid; begin
  insert into besoins(agence_code, cycle_id, libelle) values ('BAF','2612','Second besoin') returning id into b;
  insert into lignes_besoin(besoin_id,agence_code,cycle_id,code_parc,etat_vehicule,type_intervention,ot_panne,reference,designation,quantite,prix_unitaire,priorite,justification)
    values (b,'BAF','2612','BAF-B02','Immobilisé','Remise en service','PA9','REF-Z','Pompe',1,80000,'P2','Panne pompe');
  perform soumettre_besoin(b); end $x$$o$, false);
select t('la DML reporte la ligne', 3, $o$select decider_besoin((select id from besoins where numero='BES-BAF-2612-002'),
  jsonb_build_array(jsonb_build_object('id_besoin', (select id_besoin from lignes_besoin where designation = 'Pompe' and cycle_id = '2612'),
                                       'decision', 'NON_VALIDEE', 'motif_code', 'REPORTE')))$o$, false);
select t('une ligne « reportée » n''est pas réexprimable maintenant (elle revient au cycle suivant)', 1, $o$select reexprimer_besoin((select id from besoins where numero='BES-BAF-2612-002'))$o$, true);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
