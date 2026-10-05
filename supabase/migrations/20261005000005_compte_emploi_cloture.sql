-- Compte d'emploi, classement en 3 catégories, clôture du cycle, pièces justificatives

-- ---------- Opérations système (clôture, report) ----------
-- Une fonction interne peut lever les contrôles de rôle le temps d'une transaction
-- (app.systeme = '1'). Les règles métier (transitions, motifs) restent actives.
create or replace function auth_role() returns role_t
language sql stable security definer set search_path = public as
$$ select case when current_setting('app.systeme', true) = '1' then null
               else (select role from profiles where id = auth.uid() and actif) end $$;

-- ---------- Réaffectation : dépense sur un ID_RÉAF validé ----------
alter table depenses add column id_reaf text references reaffectations(id_reaf);
alter table depenses drop constraint depenses_check;
alter table depenses add constraint depenses_imputation_check
  check (sur_provision or id_besoin is not null or id_reaf is not null);

create or replace function trg_depenses_controle() returns trigger
language plpgsql as $$
declare
  m mad%rowtype; l lignes_besoin%rowtype; r reaffectations%rowtype; ce comptes_emploi%rowtype;
  v_deja numeric; v_budget numeric;
begin
  select * into m from mad where numero = new.mad_numero;
  if not found then raise exception 'MAD % inconnue', new.mad_numero; end if;
  if m.virement_le is null then raise exception 'La MAD % n''a pas encore été virée', m.numero; end if;
  if new.agence_code <> m.agence_code then raise exception 'Agence incohérente avec la MAD'; end if;

  select * into ce from comptes_emploi where mad_numero = new.mad_numero;
  if found and ce.statut in ('DEPOSE','CONTROLE') then
    raise exception 'Compte d''emploi déposé : les dépenses de % sont figées', m.numero;
  end if;

  if new.sur_provision then
    select coalesce(sum(montant),0) into v_deja from depenses
     where mad_numero = new.mad_numero and sur_provision and id <> coalesce(new.id, gen_random_uuid());
    if v_deja + new.montant > m.provision then
      raise exception 'Provision insuffisante (reste % FCFA)', round(m.provision - v_deja);
    end if;
  elsif new.id_reaf is not null then
    select * into r from reaffectations where id_reaf = new.id_reaf;
    if not found or r.agence_code <> m.agence_code or r.statut not in ('VALIDEE','VALIDEE_TACITE') then
      raise exception 'Réaffectation % non validée pour cette agence', new.id_reaf;
    end if;
    select coalesce(sum(montant),0) into v_deja from depenses
     where id_reaf = new.id_reaf and id <> coalesce(new.id, gen_random_uuid());
    if v_deja + new.montant > r.montant then
      raise exception 'Au-delà du montant de la réaffectation % (reste % FCFA)', r.id_reaf, round(r.montant - v_deja);
    end if;
  else
    select * into l from lignes_besoin where id_besoin = new.id_besoin;
    if not found or l.mad_numero is distinct from new.mad_numero then
      raise exception 'Dépense hors liste : la ligne % n''est pas couverte par la MAD % (R5)', new.id_besoin, new.mad_numero;
    end if;
    select coalesce(sum(montant),0) into v_deja from depenses
     where id_besoin = new.id_besoin and id <> coalesce(new.id, gen_random_uuid());
    v_budget := l.montant_retenu;
    if v_deja + new.montant > v_budget then
      raise exception 'Dépense au-delà du montant retenu pour % (reste % FCFA)', l.id_besoin, round(v_budget - v_deja);
    end if;
  end if;
  return new;
end $$;

-- ---------- Dépôt du compte d'emploi ----------
create or replace function deposer_compte(p_mad text, p_solde numeric) returns comptes_emploi
language plpgsql security definer set search_path = public as $$
declare m mad%rowtype; ce comptes_emploi%rowtype; v_dep numeric;
begin
  select * into m from mad where numero = p_mad;
  if not found then raise exception 'MAD introuvable'; end if;
  if auth_role() is distinct from 'CHEF' or auth_agence() <> m.agence_code then
    raise exception 'Seul le chef de l''agence concernée dépose le compte d''emploi';
  end if;
  if m.virement_le is null then raise exception 'MAD non virée'; end if;
  select coalesce(sum(montant),0) into v_dep from depenses where mad_numero = p_mad;
  if p_solde < 0 then raise exception 'Solde bancaire négatif'; end if;
  if v_dep + p_solde <> m.montant then
    raise exception 'Dépenses (%) + solde bancaire (%) = % : différent du montant reçu (%)',
      round(v_dep), round(p_solde), round(v_dep + p_solde), round(m.montant);
  end if;
  select * into ce from comptes_emploi where mad_numero = p_mad for update;
  if ce.statut not in ('A_DEPOSER','A_REGULARISER') then raise exception 'Compte déjà déposé'; end if;
  update comptes_emploi set depose_le = now(), solde_bancaire = p_solde, statut = 'DEPOSE'
   where id = ce.id returning * into ce;
  insert into historique(entite, entite_id, agence_code, ancien, nouveau, acteur)
  values ('COMPTE_EMPLOI', p_mad, m.agence_code, 'A_DEPOSER', 'DEPOSE', auth.uid());
  return ce;
end $$;

-- ---------- Contrôle de conformité par le Contrôle de gestion ----------
create or replace function classer_compte(p_compte uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int; ce comptes_emploi%rowtype;
begin
  if auth_role() is distinct from 'CG' then raise exception 'Réservé au Contrôle de gestion'; end if;
  select * into ce from comptes_emploi where id = p_compte;
  if not found or ce.statut <> 'DEPOSE' then raise exception 'Le compte doit être déposé pour être contrôlé'; end if;

  insert into classements(compte_id, depense_id, categorie, id_reaf, motif)
  select ce.id, d.id,
    case when not exists (select 1 from pieces p where p.depense_id = d.id) then 'NON_CONFORME'
         when d.sur_provision or d.id_reaf is not null then 'REAFFECTATION_JUSTIFIEE'
         else 'CONFORME' end,
    d.id_reaf,
    case when not exists (select 1 from pieces p where p.depense_id = d.id) then 'Pièces justificatives manquantes'
         when d.sur_provision then 'Couverte par la provision'
         when d.id_reaf is not null then 'Réaffectation validée ' || d.id_reaf end
  from depenses d
  where d.mad_numero = ce.mad_numero
    and not exists (select 1 from classements c where c.depense_id = d.id);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function confirmer_classement(p_id uuid, p_categorie text, p_motif text default null) returns classements
language plpgsql security definer set search_path = public as $$
declare c classements%rowtype;
begin
  if auth_role() is distinct from 'CG' then raise exception 'Réservé au Contrôle de gestion'; end if;
  if p_categorie not in ('CONFORME','REAFFECTATION_JUSTIFIEE','NON_CONFORME') then raise exception 'Catégorie inconnue'; end if;
  if p_categorie = 'NON_CONFORME' and coalesce(p_motif,'') = '' then raise exception 'Motif obligatoire pour une dépense non conforme'; end if;
  update classements set categorie = p_categorie, motif = coalesce(p_motif, motif),
         confirme_par = auth.uid(), confirme_le = now(), propose_auto = false
   where id = p_id returning * into c;
  if not found then raise exception 'Classement introuvable'; end if;
  return c;
end $$;

create or replace function controler_compte(p_compte uuid) returns comptes_emploi
language plpgsql security definer set search_path = public as $$
declare ce comptes_emploi%rowtype; v_non_conf int;
begin
  if auth_role() is distinct from 'CG' then raise exception 'Réservé au Contrôle de gestion'; end if;
  select * into ce from comptes_emploi where id = p_compte for update;
  if not found or ce.statut <> 'DEPOSE' then raise exception 'Compte non déposé'; end if;
  if exists (select 1 from depenses d where d.mad_numero = ce.mad_numero
              and not exists (select 1 from classements c where c.depense_id = d.id and c.confirme_par is not null)) then
    raise exception 'Toutes les dépenses doivent être classées et confirmées';
  end if;
  select count(*) into v_non_conf from classements c join depenses d on d.id = c.depense_id
   where d.mad_numero = ce.mad_numero and c.categorie = 'NON_CONFORME';
  update comptes_emploi set controle_par = auth.uid(),
         statut = case when v_non_conf > 0 then 'A_REGULARISER' else 'CONTROLE' end
   where id = p_compte returning * into ce;
  insert into historique(entite, entite_id, agence_code, ancien, nouveau, acteur)
  values ('COMPTE_EMPLOI', ce.mad_numero, ce.agence_code, 'DEPOSE', ce.statut, auth.uid());
  return ce;
end $$;

-- ---------- Clôture du cycle ----------
insert into transitions values ('VALIDEE','NON_VALIDEE','{DML}',true) on conflict do nothing;

create table clotures (
  cycle_id text primary key references cycles(id),
  pv jsonb not null,
  sig_dml timestamptz, sig_dml_par uuid,
  sig_cg timestamptz,  sig_cg_par uuid,
  sig_dg timestamptz,  sig_dg_par uuid,
  cree_le timestamptz not null default now()
);
alter table clotures enable row level security;
create policy lecture on clotures for select to authenticated using (est_central());
revoke all on clotures from anon;
grant select on clotures to authenticated;
revoke insert, update, delete on clotures from authenticated;

create or replace function calculer_pv(p_cycle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_mad numeric; v_dep numeric; v_imm int; v_rem int;
begin
  select coalesce(sum(montant),0) into v_mad from mad where cycle_id = p_cycle;
  select coalesce(sum(d.montant),0) into v_dep from depenses d join mad m on m.numero = d.mad_numero where m.cycle_id = p_cycle;
  select count(distinct l.code_parc), count(distinct l.code_parc) filter (where p.etat <> 'Immobilisé')
    into v_imm, v_rem
    from lignes_besoin l join parc p on p.code = l.code_parc
   where l.cycle_id = p_cycle and l.etat_vehicule = 'Immobilisé'
     and l.statut in ('MAD_ETABLIE','EN_TRAITEMENT','CLOTUREE');

  v := jsonb_build_object(
    'cycle', p_cycle,
    'montant_mad', v_mad,
    'depenses', v_dep,
    'taux_justification', case when v_mad > 0 then round(v_dep / v_mad, 4) end,
    'categories', coalesce((select jsonb_object_agg(categorie, jsonb_build_object('nb', nb, 'montant', montant)) from (
        select c.categorie, count(*) nb, sum(d.montant) montant
          from classements c join depenses d on d.id = c.depense_id join mad m on m.numero = d.mad_numero
         where m.cycle_id = p_cycle group by c.categorie) q), '{}'::jsonb),
    'comptes_non_controles', (select count(*) from comptes_emploi ce join mad m on m.numero = ce.mad_numero
                              where m.cycle_id = p_cycle and ce.statut <> 'CONTROLE'),
    'soldes_bancaires', (select coalesce(sum(ce.solde_bancaire),0) from comptes_emploi ce join mad m on m.numero = ce.mad_numero where m.cycle_id = p_cycle),
    'lignes_par_statut', coalesce((select jsonb_object_agg(statut, n) from (
        select statut, count(*) n from lignes_besoin where cycle_id = p_cycle group by statut) q), '{}'::jsonb),
    'lignes_a_reporter', (select count(*) from lignes_besoin where cycle_id = p_cycle
                          and statut in ('EXPRIMEE','REEXPRIMEE','VALIDEE','MAD_ETABLIE','EN_TRAITEMENT')),
    'vehicules_immobilises_finances', v_imm,
    'vehicules_remis_en_service', v_rem,
    'taux_remise_en_service', case when v_imm > 0 then round(v_rem::numeric / v_imm, 4) end
  );
  return v;
end $$;

create or replace function preparer_cloture(p_cycle text) returns clotures
language plpgsql security definer set search_path = public as $$
declare c clotures%rowtype;
begin
  if auth_role() is distinct from 'DML' then raise exception 'Réservé à la DML'; end if;
  if not exists (select 1 from cycles where id = p_cycle and statut = 'OUVERT') then
    raise exception 'Cycle % introuvable ou déjà clôturé', p_cycle;
  end if;
  if exists (select 1 from clotures where cycle_id = p_cycle and (sig_dml is not null or sig_cg is not null or sig_dg is not null)) then
    raise exception 'Procès-verbal déjà en cours de signature';
  end if;
  insert into clotures(cycle_id, pv) values (p_cycle, calculer_pv(p_cycle))
  on conflict (cycle_id) do update set pv = excluded.pv, cree_le = now()
  returning * into c;
  return c;
end $$;

create or replace function signer_cloture(p_cycle text) returns clotures
language plpgsql security definer set search_path = public as $$
declare c clotures%rowtype; v_role role_t := auth_role(); l record; v_dep numeric;
begin
  if v_role not in ('DML','CG','DG') then raise exception 'Seuls DML, CG et DG signent la clôture'; end if;
  select * into c from clotures where cycle_id = p_cycle for update;
  if not found then raise exception 'Procès-verbal non préparé'; end if;
  if exists (select 1 from cycles where id = p_cycle and statut = 'CLOTURE') then raise exception 'Cycle déjà clôturé'; end if;
  update clotures set
    sig_dml = case when v_role = 'DML' then now() else sig_dml end,
    sig_dml_par = case when v_role = 'DML' then auth.uid() else sig_dml_par end,
    sig_cg = case when v_role = 'CG' then now() else sig_cg end,
    sig_cg_par = case when v_role = 'CG' then auth.uid() else sig_cg_par end,
    sig_dg = case when v_role = 'DG' then now() else sig_dg end,
    sig_dg_par = case when v_role = 'DG' then auth.uid() else sig_dg_par end
  where cycle_id = p_cycle returning * into c;

  if c.sig_dml is not null and c.sig_cg is not null and c.sig_dg is not null then
    perform set_config('app.systeme', '1', true);
    -- statut final par ligne : réalisée (clôturée) ou reportée avec son identifiant
    for l in select * from lignes_besoin where cycle_id = p_cycle
              and statut in ('EXPRIMEE','REEXPRIMEE','VALIDEE','MAD_ETABLIE','EN_TRAITEMENT') loop
      select coalesce(sum(montant),0) into v_dep from depenses where id_besoin = l.id_besoin;
      if l.statut = 'EN_TRAITEMENT' and l.montant_retenu > 0 and v_dep >= l.montant_retenu then
        update lignes_besoin set statut = 'CLOTUREE' where id_besoin = l.id_besoin;
      else
        update lignes_besoin set statut = 'NON_VALIDEE', motif_code = 'REPORTE' where id_besoin = l.id_besoin;
      end if;
    end loop;
    update cycles set statut = 'CLOTURE', cloture_le = now() where id = p_cycle;
    update clotures set pv = calculer_pv(p_cycle) || jsonb_build_object('verrouille', true) where cycle_id = p_cycle
      returning * into c;
    perform set_config('app.systeme', '', true);
    insert into historique(entite, entite_id, nouveau, acteur) values ('CYCLE', p_cycle, 'CLOTURE', auth.uid());
  end if;
  return c;
end $$;

-- ---------- Ouverture du cycle suivant : report des besoins avec +10 points ----------
create or replace function ouvrir_cycle(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prec text; l record; v_ok int := 0; v_ko int := 0;
begin
  if auth_role() is distinct from 'DML' then raise exception 'Réservé à la DML'; end if;
  select id into v_prec from cycles where id < p_id order by id desc limit 1;
  if v_prec is null then raise exception 'Aucun cycle précédent'; end if;
  if not exists (select 1 from cycles where id = v_prec and statut = 'CLOTURE') then
    raise exception 'Le cycle précédent (%) doit être clôturé avant d''ouvrir %', v_prec, p_id;
  end if;
  insert into cycles(id) values (p_id);
  for l in select id_besoin from lignes_besoin where cycle_id = v_prec and statut = 'NON_VALIDEE' and motif_code = 'REPORTE' loop
    begin
      update lignes_besoin set statut = 'REEXPRIMEE', cycle_id = p_id where id_besoin = l.id_besoin;
      v_ok := v_ok + 1;
    exception when others then v_ko := v_ko + 1;
    end;
  end loop;
  return jsonb_build_object('cycle', p_id, 'lignes_reportees', v_ok, 'lignes_non_reportees', v_ko);
end $$;

-- ---------- Pièces justificatives : stockage ----------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('pieces', 'pieces', false) on conflict do nothing;
    -- chemin : <agence>/<id dépense>/<fichier>
    create policy "pieces lecture" on storage.objects for select to authenticated
      using (bucket_id = 'pieces' and (est_central() or est_agence((storage.foldername(name))[1])));
    create policy "pieces envoi" on storage.objects for insert to authenticated
      with check (bucket_id = 'pieces' and est_agence((storage.foldername(name))[1]));
  end if;
end $$;

grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema public from anon, public;
