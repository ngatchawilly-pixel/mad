-- Règles de gestion R1 à R10 : appliquées par la base, pas par l'interface.

-- ---------- Aides ----------
create or replace function auth_role() returns role_t
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and actif $$;

create or replace function auth_agence() returns text
language sql stable security definer set search_path = public as
$$ select agence_code from profiles where id = auth.uid() and actif $$;

create or replace function param(p_cle text) returns numeric
language sql stable set search_path = public as
$$ select valeur from parametres where cle = p_cle $$;

-- Appels sans utilisateur (service_role, cron, migrations) : auth_role() est null,
-- les contrôles de rôle sont ignorés, les contrôles métier restent actifs.

-- ---------- R1 : identifiant unique AGENCE-AAMM-NNNN ----------
create or replace function trg_lignes_id() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if new.id_besoin is null or new.id_besoin = '' then
    insert into id_sequences(agence_code, cycle_id, n) values (new.agence_code, new.cycle_id, 1)
    on conflict (agence_code, cycle_id) do update set n = id_sequences.n + 1
    returning n into v_n;
    new.id_besoin := new.agence_code || '-' || new.cycle_id || '-' || lpad(v_n::text, 4, '0');
  end if;
  return new;
end $$;
create trigger lignes_id before insert on lignes_besoin
  for each row execute function trg_lignes_id();

-- ---------- Aucune suppression physique ----------
create or replace function trg_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Suppression interdite sur % : utiliser un statut (abandonnée, annulée...)', tg_table_name;
end $$;
create trigger no_delete_lignes before delete on lignes_besoin for each row execute function trg_no_delete();
create trigger no_delete_decisions before delete on decisions for each row execute function trg_no_delete();
create trigger no_delete_mad before delete on mad for each row execute function trg_no_delete();
create trigger no_delete_depenses before delete on depenses for each row execute function trg_no_delete();
create trigger no_delete_reaf before delete on reaffectations for each row execute function trg_no_delete();
create trigger no_change_historique before update or delete on historique for each row execute function trg_no_delete();

-- ---------- Table des transitions de statut ----------
create table transitions (
  de statut_ligne_t not null,
  vers statut_ligne_t not null,
  roles role_t[] not null,
  motif_obligatoire boolean not null default false,
  primary key (de, vers)
);
insert into transitions values
  ('BROUILLON','EXPRIMEE','{CHEF,RM}',false),
  ('EXPRIMEE','VALIDEE','{DML}',false),
  ('EXPRIMEE','NON_VALIDEE','{DML}',true),
  ('REEXPRIMEE','VALIDEE','{DML}',false),
  ('REEXPRIMEE','NON_VALIDEE','{DML}',true),
  ('NON_VALIDEE','REEXPRIMEE','{CHEF,RM,DML}',false),
  ('NON_VALIDEE','ABANDONNEE','{CHEF,DML}',true),
  ('VALIDEE','MAD_ETABLIE','{DML}',false),
  ('MAD_ETABLIE','EN_TRAITEMENT','{CHEF,RM}',false),
  ('MAD_ETABLIE','NON_VALIDEE','{DML}',true),             -- besoin sacrifié par une réaffectation (R10)
  ('EN_TRAITEMENT','NON_VALIDEE','{DML}',true),
  ('EN_TRAITEMENT','CLOTUREE','{CG}',false);

-- ---------- Contrôle des modifications de ligne ----------
create or replace function trg_lignes_controle() returns trigger
language plpgsql as $$
declare
  v_role role_t := auth_role();
  v_t transitions%rowtype;
  v_seuil numeric := param('seuil_devis');
  v_grille numeric;
  v_dup int;
begin
  new.updated_at := now();

  if tg_op = 'UPDATE' then
    -- identifiant et rattachement immuables
    if new.id_besoin <> old.id_besoin or new.agence_code <> old.agence_code then
      raise exception 'Identifiant et agence d''une ligne non modifiables';
    end if;
    -- champs d'arbitrage réservés à la DML
    if v_role is not null and v_role not in ('DML')
       and (new.decision_numero is distinct from old.decision_numero
         or new.mad_numero is distinct from old.mad_numero
         or new.score is distinct from old.score
         or new.mode is distinct from old.mode
         or new.montant_retenu is distinct from old.montant_retenu
         or new.taux_avance is distinct from old.taux_avance) then
      raise exception 'Champs d''arbitrage réservés à la DML';
    end if;
    -- les champs de saisie sont figés une fois la ligne soumise
    if old.statut <> 'BROUILLON' and v_role in ('CHEF','RM')
       and (new.quantite, new.prix_unitaire, new.reference, new.designation, new.code_parc, new.fournisseur_id)
           is distinct from (old.quantite, old.prix_unitaire, old.reference, old.designation, old.code_parc, old.fournisseur_id)
       and not (old.statut = 'NON_VALIDEE' and new.statut = 'REEXPRIMEE') then
      raise exception 'Ligne soumise : modification impossible (créer une réexpression)';
    end if;
  end if;

  -- changement de statut
  if tg_op = 'INSERT' and new.statut not in ('BROUILLON','EXPRIMEE') then
    raise exception 'Une ligne est créée en brouillon ou exprimée';
  end if;

  if tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    select * into v_t from transitions where de = old.statut and vers = new.statut;
    if not found then
      raise exception 'Transition % -> % interdite', old.statut, new.statut;
    end if;
    if v_role is not null and not (v_role = any(v_t.roles)) then
      raise exception 'Le rôle % ne peut pas passer une ligne de % à %', v_role, old.statut, new.statut;
    end if;
    if v_t.motif_obligatoire and coalesce(new.motif_code, '') = '' then
      raise exception 'Motif codifié obligatoire pour % -> %', old.statut, new.statut;
    end if;
    if new.statut = 'VALIDEE' and (new.mode is null or new.montant_retenu is null) then
      raise exception 'Mode (MDD/MDI) et montant retenu obligatoires pour valider';
    end if;
    -- écart au score : motif obligatoire (arbitrage hors score)
  end if;

  -- contrôles à la soumission (R6, prix, doublons, champs obligatoires)
  if new.statut in ('EXPRIMEE','REEXPRIMEE') and
     (tg_op = 'INSERT' or old.statut not in ('EXPRIMEE','REEXPRIMEE')) then
    if new.code_parc is null or new.priorite is null or coalesce(new.justification,'') = '' then
      raise exception 'Ligne incomplète : véhicule, priorité et justification obligatoires';
    end if;
    if new.type_intervention = 'Remise en service' and coalesce(new.ot_panne,'') = '' then
      raise exception 'N° d''OT ou de panne obligatoire pour une remise en service';
    end if;
    if new.quantite * new.prix_unitaire > v_seuil and coalesce(new.ref_devis,'') = '' then
      raise exception 'Devis ou pro forma obligatoire au-delà de % FCFA (R6)', v_seuil;
    end if;
    -- écart de prix par rapport à la grille
    if new.reference is not null then
      select prix_plafond into v_grille from grille_prix where reference = new.reference;
      if v_grille is not null and v_grille > 0 then
        new.ecart_prix := new.prix_unitaire / v_grille - 1;
        if new.ecart_prix > param('ecart_prix_alerte') and coalesce(new.justification_prix,'') = '' then
          raise exception 'Prix % %% au-dessus de la grille : explication obligatoire',
            round(new.ecart_prix * 100);
        end if;
      end if;
    end if;
    -- doublon : même véhicule, même référence, même cycle
    select count(*) into v_dup from lignes_besoin l
     where l.code_parc = new.code_parc and l.reference is not distinct from new.reference
       and l.cycle_id = new.cycle_id and l.id_besoin <> coalesce(new.id_besoin,'')
       and l.statut not in ('BROUILLON','ABANDONNEE','NON_VALIDEE');
    if v_dup > 0 and new.reference is not null then
      raise exception 'Doublon : véhicule % / référence % déjà exprimés dans le cycle %',
        new.code_parc, new.reference, new.cycle_id;
    end if;
  end if;

  -- réexpression : même identifiant, rang incrémenté, +10 points de report (R10)
  if tg_op = 'UPDATE' and new.statut = 'REEXPRIMEE' and old.statut = 'NON_VALIDEE' then
    new.rang := old.rang + 1;
    new.bonus_report := case when old.motif_code = 'REPORTE' then 10 else old.bonus_report end;
    new.decision_numero := null; new.mad_numero := null;
    new.mode := null; new.montant_retenu := null; new.motif_code := null;
  end if;

  return new;
end $$;
create trigger lignes_controle before insert or update on lignes_besoin
  for each row execute function trg_lignes_controle();

-- ---------- Historique des statuts ----------
create or replace function trg_lignes_historique() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.statut is distinct from old.statut then
    insert into historique(entite, entite_id, agence_code, ancien, nouveau, motif, acteur)
    values ('LIGNE', new.id_besoin, new.agence_code,
            case when tg_op = 'UPDATE' then old.statut::text end, new.statut::text,
            new.motif_code, auth.uid());
  end if;
  return new;
end $$;
create trigger lignes_historique after insert or update on lignes_besoin
  for each row execute function trg_lignes_historique();

-- ---------- Score d'arbitrage sur 100 ----------
create or replace function score_ligne(p_id text) returns int
language plpgsql stable set search_path = public as $$
declare
  l lignes_besoin%rowtype;
  v_famille text;
  v_cout numeric;
  s int := 0;
begin
  select * into l from lignes_besoin where id_besoin = p_id;
  if not found then return null; end if;
  select famille into v_famille from parc where code = l.code_parc;
  select coalesce(sum(montant),0) into v_cout from lignes_besoin
   where code_parc = l.code_parc and cycle_id = l.cycle_id
     and statut not in ('BROUILLON','ABANDONNEE','NON_VALIDEE');

  s := s + case l.etat_vehicule when 'Immobilisé' then 30 when 'Disponible à risque' then 15 else 5 end;
  s := s + case l.priorite when 'P1' then 20 when 'P2' then 10 else 0 end;
  s := s + case when v_famille ilike 'camion%' or v_famille ilike 'benne%' then 20
                when v_famille ilike 'engin%' then 15 else 5 end;
  s := s + case when l.securite_legale then 15 else 0 end;
  s := s + case when v_cout < 2000000 then 10 when v_cout <= 5000000 then 5 else 0 end;
  s := s + case when coalesce(l.ot_panne,'') <> ''
                 and (l.montant <= param('seuil_devis') or coalesce(l.ref_devis,'') <> '') then 5 else 0 end;
  return least(100, s + l.bonus_report);
end $$;

create or replace function calculer_scores(p_cycle text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth_role() is not null and auth_role() <> 'DML' then
    raise exception 'Réservé à la DML';
  end if;
  update lignes_besoin set score = score_ligne(id_besoin)
   where cycle_id = p_cycle and statut in ('EXPRIMEE','REEXPRIMEE');
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Contrôle de la part P1 (40 % max) ----------
create or replace view v_controle_p1 with (security_invoker = true) as
select agence_code, cycle_id,
       sum(montant) as demande,
       sum(montant) filter (where priorite = 'P1') as demande_p1,
       round(coalesce(sum(montant) filter (where priorite = 'P1'),0) / nullif(sum(montant),0), 4) as part_p1,
       coalesce(sum(montant) filter (where priorite = 'P1'),0) / nullif(sum(montant),0) > param('part_max_p1') as alerte
  from lignes_besoin
 where statut in ('EXPRIMEE','REEXPRIMEE','VALIDEE')
 group by agence_code, cycle_id;

-- ---------- Décision figée (R4) ----------
create or replace function figer_decision(p_cycle text, p_motif text default null) returns decisions
language plpgsql security definer set search_path = public as $$
declare
  v_ver int;
  v_num text;
  v_contenu jsonb;
  d decisions%rowtype;
begin
  if auth_role() is not null and auth_role() <> 'DML' then raise exception 'Réservé à la DML'; end if;
  select coalesce(max(version),0) + 1 into v_ver from decisions where cycle_id = p_cycle;
  if v_ver > 1 then
    if exists (select 1 from decisions where cycle_id = p_cycle and version = v_ver - 1 and not verrouillee) then
      raise exception 'La version précédente n''est pas encore verrouillée';
    end if;
    if coalesce(p_motif,'') = '' then raise exception 'Motif obligatoire pour une nouvelle version'; end if;
  end if;
  v_num := 'DEC-DML-' || p_cycle || '-V' || v_ver;

  select jsonb_agg(x order by x->>'agence', x->>'fournisseur') into v_contenu from (
    select jsonb_build_object(
      'agence', l.agence_code,
      'fournisseur', coalesce(f.raison_sociale, 'SANS FOURNISSEUR'),
      'mode', l.mode,
      'montant', sum(l.montant_retenu),
      'lignes', jsonb_agg(jsonb_build_object('id_besoin', l.id_besoin, 'montant', l.montant_retenu) order by l.id_besoin)
    ) as x
    from lignes_besoin l left join fournisseurs f on f.id = l.fournisseur_id
    where l.cycle_id = p_cycle and l.statut = 'VALIDEE' and l.decision_numero is null
    group by l.agence_code, f.raison_sociale, l.mode
  ) q;
  if v_contenu is null then raise exception 'Aucune ligne validée à figer'; end if;

  insert into decisions(numero, cycle_id, version, contenu, motif_version)
  values (v_num, p_cycle, v_ver, v_contenu, p_motif) returning * into d;
  update lignes_besoin set decision_numero = v_num
   where cycle_id = p_cycle and statut = 'VALIDEE' and decision_numero is null;
  insert into historique(entite, entite_id, nouveau, motif, acteur) values ('DECISION', v_num, 'CREEE', p_motif, auth.uid());
  return d;
end $$;

create or replace function signer_decision(p_numero text) returns decisions
language plpgsql security definer set search_path = public as $$
declare d decisions%rowtype; v_role role_t := auth_role();
begin
  if v_role not in ('DML','CG','DG') then raise exception 'Seuls DML, CG et DG signent la décision'; end if;
  select * into d from decisions where numero = p_numero for update;
  if not found then raise exception 'Décision introuvable'; end if;
  if d.verrouillee then raise exception 'Décision déjà verrouillée'; end if;
  update decisions set
    sig_dml = case when v_role = 'DML' then now() else sig_dml end,
    sig_dml_par = case when v_role = 'DML' then auth.uid() else sig_dml_par end,
    sig_cg = case when v_role = 'CG' then now() else sig_cg end,
    sig_cg_par = case when v_role = 'CG' then auth.uid() else sig_cg_par end,
    sig_dg = case when v_role = 'DG' then now() else sig_dg end,
    sig_dg_par = case when v_role = 'DG' then auth.uid() else sig_dg_par end
  where numero = p_numero returning * into d;
  if d.sig_dml is not null and d.sig_cg is not null and d.sig_dg is not null then
    update decisions set verrouillee = true where numero = p_numero returning * into d;
    insert into historique(entite, entite_id, nouveau, acteur) values ('DECISION', p_numero, 'VERROUILLEE', auth.uid());
  end if;
  return d;
end $$;

-- une décision verrouillée ne se modifie plus
create or replace function trg_decision_verrou() returns trigger
language plpgsql as $$
begin
  if old.verrouillee and (new.contenu is distinct from old.contenu or new.numero <> old.numero
      or new.verrouillee = false or new.sig_dml is distinct from old.sig_dml
      or new.sig_cg is distinct from old.sig_cg or new.sig_dg is distinct from old.sig_dg) then
    raise exception 'Décision % verrouillée : créer une nouvelle version (R4)', old.numero;
  end if;
  if not old.verrouillee and (new.contenu is distinct from old.contenu) and
     (old.sig_dml is not null or old.sig_cg is not null or old.sig_dg is not null) then
    raise exception 'Décision en cours de signature : contenu non modifiable';
  end if;
  return new;
end $$;
create trigger decision_verrou before update on decisions for each row execute function trg_decision_verrou();

-- ---------- MAD : calcul et génération (R2, R5) ----------
create or replace function calculer_mad(p_agence text, p_cycle text, p_mode mode_t default 'MDD')
returns table (montant_lignes numeric, provision numeric, plafond numeric, total numeric, depasse boolean)
language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce(sum(montant_retenu),0) as m
      from lignes_besoin
     where agence_code = p_agence and cycle_id = p_cycle
       and statut = 'VALIDEE' and mode = p_mode and decision_numero is not null
  ), a as (select grande from agences where code = p_agence)
  select s.m,
         case when p_mode = 'MDD' then s.m * param('provision_imprevus') else 0 end,
         case when p_mode = 'MDD' then case when a.grande then param('plafond_mdd_grande') else param('plafond_mdd_petite') end end,
         s.m + case when p_mode = 'MDD' then s.m * param('provision_imprevus') else 0 end,
         p_mode = 'MDD' and s.m + s.m * param('provision_imprevus') >
           case when a.grande then param('plafond_mdd_grande') else param('plafond_mdd_petite') end
    from s, a
$$;

create or replace function generer_mad(p_agence text, p_cycle text, p_mode mode_t) returns mad
language plpgsql security definer set search_path = public as $$
declare
  c record; v_dec decisions%rowtype; m mad%rowtype; v_num text;
begin
  if auth_role() is not null and auth_role() <> 'DML' then raise exception 'Réservé à la DML'; end if;
  select * into c from calculer_mad(p_agence, p_cycle, p_mode);
  if c.montant_lignes = 0 then raise exception 'Aucune ligne validée en % pour % : pas de fonds sans liste (R2)', p_mode, p_agence; end if;
  if c.depasse then
    raise exception 'Plafond MDD dépassé (% > %) : basculer des lignes en MDI ou arbitrer', round(c.total), round(c.plafond);
  end if;
  select d.* into v_dec from decisions d
   where d.cycle_id = p_cycle and d.verrouillee order by version desc limit 1;
  if not found then raise exception 'Aucune décision verrouillée pour le cycle % (R4/R5)', p_cycle; end if;

  v_num := 'MAD-DML-' || p_cycle || '-' || p_agence || case when p_mode = 'MDI' then '-MDI' else '' end;
  insert into mad(numero, cycle_id, agence_code, mode, montant_lignes, provision, decision_numero, date_limite)
  values (v_num, p_cycle, p_agence, p_mode, c.montant_lignes, c.provision, v_dec.numero,
          current_date + 21)
  returning * into m;

  update lignes_besoin set mad_numero = v_num, statut = 'MAD_ETABLIE'
   where agence_code = p_agence and cycle_id = p_cycle and statut = 'VALIDEE'
     and mode = p_mode and decision_numero is not null;
  insert into historique(entite, entite_id, agence_code, nouveau, acteur) values ('MAD', v_num, p_agence, 'ETABLIE', auth.uid());
  return m;
end $$;

-- accusé de réception (vaut engagement) et virement
create or replace function accuser_mad(p_numero text) returns mad
language plpgsql security definer set search_path = public as $$
declare m mad%rowtype;
begin
  select * into m from mad where numero = p_numero for update;
  if not found then raise exception 'MAD introuvable'; end if;
  if auth_role() <> 'CHEF' or auth_agence() <> m.agence_code then
    raise exception 'Seul le chef de l''agence concernée accuse réception';
  end if;
  update mad set accuse_le = now(), accuse_par = auth.uid() where numero = p_numero returning * into m;
  update lignes_besoin set statut = 'EN_TRAITEMENT' where mad_numero = p_numero and statut = 'MAD_ETABLIE';
  return m;
end $$;

create or replace function virer_mad(p_numero text) returns mad
language plpgsql security definer set search_path = public as $$
declare m mad%rowtype;
begin
  if auth_role() not in ('TRES') then raise exception 'Réservé à la Trésorerie'; end if;
  update mad set virement_le = now(), virement_par = auth.uid()
   where numero = p_numero and virement_le is null returning * into m;
  if not found then raise exception 'MAD introuvable ou déjà virée'; end if;
  insert into comptes_emploi(mad_numero, agence_code) values (m.numero, m.agence_code) on conflict do nothing;
  insert into historique(entite, entite_id, agence_code, nouveau, acteur) values ('MAD', p_numero, m.agence_code, 'VIREE', auth.uid());
  return m;
end $$;

-- ---------- Dépenses : seulement sur la liste ou la provision (R5), jamais au-delà ----------
create or replace function trg_depenses_controle() returns trigger
language plpgsql as $$
declare
  m mad%rowtype; l lignes_besoin%rowtype;
  v_deja numeric; v_budget numeric;
begin
  select * into m from mad where numero = new.mad_numero;
  if not found then raise exception 'MAD % inconnue', new.mad_numero; end if;
  if m.virement_le is null then raise exception 'La MAD % n''a pas encore été virée', m.numero; end if;
  if new.agence_code <> m.agence_code then raise exception 'Agence incohérente avec la MAD'; end if;

  if new.sur_provision then
    select coalesce(sum(montant),0) into v_deja from depenses
     where mad_numero = new.mad_numero and sur_provision and id <> coalesce(new.id, gen_random_uuid());
    if v_deja + new.montant > m.provision then
      raise exception 'Provision insuffisante (reste % FCFA)', round(m.provision - v_deja);
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
create trigger depenses_controle before insert or update on depenses
  for each row execute function trg_depenses_controle();

-- ---------- Réaffectation : identifiant et circuit d'autorisation (R8-R10) ----------
create or replace function trg_reaf_id() returns trigger
language plpgsql as $$
declare v_n int;
begin
  if new.id_reaf is null or new.id_reaf = '' then
    select count(*) + 1 into v_n from reaffectations where agence_code = new.agence_code and cycle_id = new.cycle_id;
    new.id_reaf := 'REAF-' || new.agence_code || '-' || new.cycle_id || '-' || lpad(v_n::text, 3, '0');
  end if;
  return new;
end $$;
create trigger reaf_id before insert on reaffectations for each row execute function trg_reaf_id();

create or replace function repondre_reaffectation(p_id text, p_accepte boolean) returns reaffectations
language plpgsql security definer set search_path = public as $$
declare r reaffectations%rowtype; v_role role_t := auth_role();
begin
  select * into r from reaffectations where id_reaf = p_id for update;
  if not found then raise exception 'Réaffectation introuvable'; end if;
  if r.statut <> 'SOUMISE' then raise exception 'Déjà traitée (%)', r.statut; end if;
  if v_role not in ('DML','DG') then raise exception 'Réservé à la DML ou à la DG'; end if;
  if p_accepte and r.montant > param('seuil_reaf_dg') and v_role <> 'DG' and not r.validee_dg then
    raise exception 'Au-delà de % FCFA : autorisation de la DG requise', param('seuil_reaf_dg');
  end if;
  update reaffectations set statut = case when p_accepte then 'VALIDEE' else 'REFUSEE' end,
         repondu_le = now(), repondu_par = auth.uid(),
         validee_dg = validee_dg or v_role = 'DG'
   where id_reaf = p_id returning * into r;
  insert into historique(entite, entite_id, agence_code, ancien, nouveau, acteur)
  values ('REAFFECTATION', p_id, r.agence_code, 'SOUMISE', r.statut, auth.uid());
  return r;
end $$;
