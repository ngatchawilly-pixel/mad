-- Cycle de besoins : le cycle regroupe les besoins ET les MAD. Il se ferme une fois les besoins validés et les MAD faites ;
-- le cycle suivant s'ouvre automatiquement avec tous les besoins non validés. Le suivi financier des MAD continue dans le cycle clos.

-- Contrôles de soumission : adaptation pour la reprise des lignes non validées par la clôture.
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
  -- Une ligne non validée reprise par une clôture (opération système) n'est pas recontrôlée : elle l'a déjà été à sa soumission.
  if new.statut in ('EXPRIMEE','REEXPRIMEE') and
     (tg_op = 'INSERT' or old.statut not in ('EXPRIMEE','REEXPRIMEE'))
     and not (tg_op = 'UPDATE' and auth_role() is null and old.statut = 'NON_VALIDEE') then
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

-- ---------- Cycle suivant : prochain identifiant libre (AAMM) ----------
create or replace function cycle_suivant_libre(p_cycle text) returns text
language plpgsql stable set search_path = public as $$
declare a int := substr(p_cycle, 1, 2)::int; m int := substr(p_cycle, 3, 2)::int; v text; i int := 0;
begin
  loop
    m := m + 1;
    if m > 12 then m := 1; a := a + 1; end if;
    v := lpad(a::text, 2, '0') || lpad(m::text, 2, '0');
    exit when not exists (select 1 from cycles where id = v);
    i := i + 1;
    if i > 24 then raise exception 'Impossible de déterminer le cycle suivant de %', p_cycle; end if;
  end loop;
  return v;
end $$;

alter table cycles add column cycle_suivant text references cycles(id);
alter table cycles add column cloture_par uuid;

-- ---------- Report de lignes vers un autre cycle (appelé par les clôtures) ----------
-- Les lignes reviennent « réexprimées » (même identifiant, rang incrémenté) dans une fiche de besoin du cycle cible.
-- L'appelant a déjà levé les contrôles de rôle (app.systeme).
create or replace function reporter_lignes(p_depuis text, p_vers text, p_libelle text, p_ids text[]) returns int
language plpgsql security definer set search_path = public as $$
declare l record; v_besoin uuid; n int := 0;
begin
  for l in select id_besoin, agence_code from lignes_besoin where id_besoin = any(p_ids) order by id_besoin loop
    select id into v_besoin from besoins
     where agence_code = l.agence_code and cycle_id = p_vers and libelle = p_libelle;
    if v_besoin is null then
      insert into besoins(agence_code, cycle_id, libelle, statut, soumis_le)
      values (l.agence_code, p_vers, p_libelle, 'SOUMIS', now()) returning id into v_besoin;
    end if;
    update lignes_besoin set statut = 'REEXPRIMEE', cycle_id = p_vers, besoin_id = v_besoin where id_besoin = l.id_besoin;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Clôture du cycle de besoins ----------
-- Les besoins sont validés et les MAD correspondantes sont faites : le cycle se ferme (besoins et MAD y restent rattachés)
-- et le cycle suivant s'ouvre automatiquement avec tout ce qui n'a pas été validé.
-- Le suivi financier des MAD (virement, dépenses, compte d'emploi, procès-verbal) continue dans le cycle clos.
create or replace function cloturer_cycle(p_cycle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suivant text; n_attente int; n_sans_mad int; n_mad int; v_montant numeric;
  v_ids text[]; n_reportees int := 0; n_saisie int := 0;
begin
  if auth_role() is distinct from 'DML' then raise exception 'Réservé à la DML'; end if;
  if not exists (select 1 from cycles where id = p_cycle and statut = 'OUVERT') then
    raise exception 'Cycle % introuvable ou déjà clôturé', p_cycle;
  end if;

  select count(*) into n_attente from lignes_besoin where cycle_id = p_cycle and statut in ('EXPRIMEE','REEXPRIMEE');
  if n_attente > 0 or exists (select 1 from besoins where cycle_id = p_cycle and statut = 'SOUMIS') then
    raise exception 'Il reste % ligne(s) en attente de décision : validez d''abord les besoins soumis', n_attente;
  end if;
  select count(*) into n_sans_mad from lignes_besoin where cycle_id = p_cycle and statut = 'VALIDEE';
  if n_sans_mad > 0 then
    raise exception 'Générez d''abord les MAD : % ligne(s) validée(s) n''ont pas encore de MAD', n_sans_mad;
  end if;

  v_suivant := cycle_suivant_libre(p_cycle);
  perform set_config('app.systeme', '1', true);

  insert into cycles(id) values (v_suivant);
  update cycles set statut = 'CLOTURE', cloture_le = now(), cloture_par = auth.uid(), cycle_suivant = v_suivant where id = p_cycle;

  -- les besoins encore en saisie suivent, tels quels, dans le nouveau cycle
  update lignes_besoin set cycle_id = v_suivant
   where besoin_id in (select id from besoins where cycle_id = p_cycle and statut = 'EN_SAISIE');
  update besoins set cycle_id = v_suivant where cycle_id = p_cycle and statut = 'EN_SAISIE';
  get diagnostics n_saisie = row_count;

  -- toutes les lignes non validées passent au nouveau cycle (réexprimées)
  select array_agg(id_besoin) into v_ids from lignes_besoin where cycle_id = p_cycle and statut = 'NON_VALIDEE';
  if v_ids is not null then
    n_reportees := reporter_lignes(p_cycle, v_suivant, 'Besoins non validés du cycle ' || p_cycle, v_ids);
  end if;
  perform set_config('app.systeme', '', true);

  select count(*), coalesce(sum(montant), 0) into n_mad, v_montant from mad where cycle_id = p_cycle;
  insert into historique(entite, entite_id, ancien, nouveau, motif, acteur)
  values ('CYCLE', p_cycle, 'OUVERT', 'CLOTURE', 'cycle suivant ' || v_suivant || ' : ' || n_reportees || ' ligne(s) non validée(s), '
          || n_saisie || ' besoin(s) en saisie reportés', auth.uid());

  return jsonb_build_object('cycle_clos', p_cycle, 'cycle_suivant', v_suivant, 'mad', n_mad, 'montant_mad', v_montant,
                            'lignes_non_validees_reportees', n_reportees, 'besoins_en_saisie_reportes', n_saisie);
end $$;

-- la création manuelle d'un cycle disparaît : le cycle suivant s'ouvre à la clôture
drop function if exists ouvrir_cycle(text);

-- ---------- Clôture financière (procès-verbal) : après la clôture du cycle de besoins ----------
create or replace function preparer_cloture(p_cycle text) returns clotures
language plpgsql security definer set search_path = public as $$
declare c clotures%rowtype;
begin
  if auth_role() is distinct from 'DML' then raise exception 'Réservé à la DML'; end if;
  if not exists (select 1 from cycles where id = p_cycle and statut = 'CLOTURE') then
    raise exception 'La clôture financière se fait après la clôture du cycle de besoins %', p_cycle;
  end if;
  if exists (select 1 from clotures where cycle_id = p_cycle and (sig_dml is not null or sig_cg is not null or sig_dg is not null)) then
    raise exception 'Procès-verbal déjà en cours de signature';
  end if;
  insert into clotures(cycle_id, pv) values (p_cycle, calculer_pv(p_cycle))
  on conflict (cycle_id) do update set pv = excluded.pv, cree_le = now()
  returning * into c;
  return c;
end $$;

-- À la 3e signature : chaque ligne financée reçoit son statut final. Réalisée : clôturée. Non réalisée : reportée
-- (R10) dans le cycle ouvert, avec son identifiant.
create or replace function signer_cloture(p_cycle text) returns clotures
language plpgsql security definer set search_path = public as $$
declare
  c clotures%rowtype; v_role role_t := auth_role(); l record; v_dep numeric;
  v_ouvert text; v_ids text[] := '{}';
begin
  if v_role not in ('DML','CG','DG') then raise exception 'Seuls DML, CG et DG signent la clôture'; end if;
  select * into c from clotures where cycle_id = p_cycle for update;
  if not found then raise exception 'Procès-verbal non préparé'; end if;
  if c.sig_dml is not null and c.sig_cg is not null and c.sig_dg is not null then
    raise exception 'Clôture financière déjà signée';
  end if;
  update clotures set
    sig_dml = case when v_role = 'DML' then now() else sig_dml end,
    sig_dml_par = case when v_role = 'DML' then auth.uid() else sig_dml_par end,
    sig_cg = case when v_role = 'CG' then now() else sig_cg end,
    sig_cg_par = case when v_role = 'CG' then auth.uid() else sig_cg_par end,
    sig_dg = case when v_role = 'DG' then now() else sig_dg end,
    sig_dg_par = case when v_role = 'DG' then auth.uid() else sig_dg_par end
  where cycle_id = p_cycle returning * into c;

  if c.sig_dml is not null and c.sig_cg is not null and c.sig_dg is not null then
    select id into v_ouvert from cycles where statut = 'OUVERT' order by id desc limit 1;
    perform set_config('app.systeme', '1', true);
    for l in select * from lignes_besoin where cycle_id = p_cycle and statut in ('MAD_ETABLIE','EN_TRAITEMENT') loop
      select coalesce(sum(montant), 0) into v_dep from depenses where id_besoin = l.id_besoin;
      if l.statut = 'EN_TRAITEMENT' and l.montant_retenu > 0 and v_dep >= l.montant_retenu then
        update lignes_besoin set statut = 'CLOTUREE' where id_besoin = l.id_besoin;
      else
        update lignes_besoin set statut = 'NON_VALIDEE', motif_code = 'REPORTE' where id_besoin = l.id_besoin;
        v_ids := v_ids || l.id_besoin;
      end if;
    end loop;
    if array_length(v_ids, 1) > 0 then
      if v_ouvert is null then raise exception 'Aucun cycle ouvert pour recevoir les lignes reportées'; end if;
      perform reporter_lignes(p_cycle, v_ouvert, 'Besoins reportés du cycle ' || p_cycle, v_ids);
    end if;
    update clotures set pv = calculer_pv(p_cycle) || jsonb_build_object('verrouille', true) where cycle_id = p_cycle
      returning * into c;
    perform set_config('app.systeme', '', true);
    insert into historique(entite, entite_id, nouveau, acteur) values ('CYCLE', p_cycle, 'CLOTURE_FINANCIERE', auth.uid());
  end if;
  return c;
end $$;

grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema public from anon, public;
