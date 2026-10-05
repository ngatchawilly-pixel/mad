-- Circuit au niveau du BESOIN (et non plus ligne par ligne) :
--   agence : prépare les lignes (brouillon) puis SOUMET LE BESOIN ;
--   DML    : sélectionne les lignes à retenir dans le besoin puis VALIDE LE BESOIN.
-- Les anciennes voies ligne par ligne (soumission, validation) sont verrouillées : elles ne passent plus que par ces fonctions.

-- ---------- Statut de circuit du besoin ----------
alter table besoins
  add column statut text not null default 'EN_SAISIE' check (statut in ('EN_SAISIE','SOUMIS','DECIDE')),
  add column soumis_le timestamptz, add column soumis_par uuid,
  add column decide_le timestamptz, add column decide_par uuid;

-- reprise de l'existant : un besoin avec des lignes en attente est « soumis », avec des lignes tranchées « décidé »
update besoins b set statut = case
  when exists (select 1 from lignes_besoin l where l.besoin_id = b.id and l.statut in ('EXPRIMEE','REEXPRIMEE')) then 'SOUMIS'
  when exists (select 1 from lignes_besoin l where l.besoin_id = b.id and l.statut not in ('BROUILLON','ABANDONNEE')) then 'DECIDE'
  else 'EN_SAISIE' end;

-- le statut ne change que par les actions dédiées ci-dessous
create or replace function trg_besoins_workflow() returns trigger
language plpgsql as $$
begin
  if auth_role() is not null and (
       new.statut is distinct from old.statut or new.soumis_le is distinct from old.soumis_le
       or new.soumis_par is distinct from old.soumis_par or new.decide_le is distinct from old.decide_le
       or new.decide_par is distinct from old.decide_par or new.agence_code <> old.agence_code or new.cycle_id <> old.cycle_id) then
    raise exception 'Le statut d''un besoin ne change que par les actions Soumettre, Rappeler, Valider et Réexprimer';
  end if;
  return new;
end $$;
create trigger besoins_workflow before update on besoins for each row execute function trg_besoins_workflow();

-- ---------- Verrouillage des voies ligne par ligne ----------
update transitions set roles = '{}'::role_t[]
 where (de, vers) in (('BROUILLON','EXPRIMEE'),('EXPRIMEE','VALIDEE'),('EXPRIMEE','NON_VALIDEE'),
                      ('REEXPRIMEE','VALIDEE'),('REEXPRIMEE','NON_VALIDEE'),('NON_VALIDEE','REEXPRIMEE'));
insert into transitions values ('EXPRIMEE','BROUILLON','{}'::role_t[],false) on conflict do nothing;

-- une ligne est toujours créée en brouillon, dans un besoin encore en saisie
create or replace function trg_ligne_besoin_coherence() returns trigger
language plpgsql as $$
declare b besoins%rowtype;
begin
  select * into b from besoins where id = new.besoin_id;
  if not found then raise exception 'Besoin introuvable : une ligne doit appartenir à un besoin'; end if;
  if b.agence_code <> new.agence_code or b.cycle_id <> new.cycle_id then
    raise exception 'La ligne doit appartenir à un besoin de la même agence (%) et du même cycle (%)', new.agence_code, new.cycle_id;
  end if;
  if auth_role() is not null then
    if new.statut <> 'BROUILLON' then
      raise exception 'Une ligne est créée en brouillon : elle est soumise avec son besoin';
    end if;
    if b.statut <> 'EN_SAISIE' then
      raise exception 'Le besoin % est déjà soumis : on ne peut plus y ajouter de ligne (créez un nouveau besoin)', b.numero;
    end if;
  end if;
  return new;
end $$;

-- ---------- Soumission du besoin par l'agence ----------
create or replace function soumettre_besoin(p_besoin uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role role_t := auth_role(); v_agence text := auth_agence();
  b besoins%rowtype; l record; n int := 0;
begin
  select * into b from besoins where id = p_besoin for update;
  if not found then raise exception 'Besoin introuvable'; end if;
  if v_role is distinct from 'CHEF' or v_agence is distinct from b.agence_code then
    raise exception 'Seul le chef de l''agence concernée soumet le besoin';
  end if;
  if b.statut <> 'EN_SAISIE' then raise exception 'Le besoin % est déjà soumis', b.numero; end if;
  if not exists (select 1 from cycles where id = b.cycle_id and statut = 'OUVERT') then
    raise exception 'Le cycle % est clôturé', b.cycle_id;
  end if;
  if not exists (select 1 from lignes_besoin where besoin_id = p_besoin and statut = 'BROUILLON') then
    raise exception 'Ce besoin ne contient aucune ligne à soumettre';
  end if;

  perform set_config('app.systeme', '1', true);
  for l in select id_besoin from lignes_besoin where besoin_id = p_besoin and statut = 'BROUILLON' order by id_besoin loop
    begin
      update lignes_besoin set statut = 'EXPRIMEE' where id_besoin = l.id_besoin;
      n := n + 1;
    exception when others then
      raise exception 'Ligne % : %', l.id_besoin, sqlerrm;     -- tout est annulé : le besoin n'est pas soumis
    end;
  end loop;
  update besoins set statut = 'SOUMIS', soumis_le = now(), soumis_par = auth.uid(), decide_le = null, decide_par = null
   where id = p_besoin;
  perform set_config('app.systeme', '', true);

  insert into historique(entite, entite_id, agence_code, ancien, nouveau, acteur)
  values ('BESOIN', b.numero, b.agence_code, 'EN_SAISIE', 'SOUMIS', auth.uid());
  return jsonb_build_object('besoin', b.numero, 'lignes_soumises', n);
end $$;

-- ---------- Rappel d'un besoin soumis, tant que la DML n'a pas décidé ----------
create or replace function rappeler_besoin(p_besoin uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role role_t := auth_role(); v_agence text := auth_agence(); b besoins%rowtype;
begin
  select * into b from besoins where id = p_besoin for update;
  if not found then raise exception 'Besoin introuvable'; end if;
  if v_role is distinct from 'CHEF' or v_agence is distinct from b.agence_code then
    raise exception 'Seul le chef de l''agence concernée rappelle le besoin';
  end if;
  if b.statut <> 'SOUMIS' then raise exception 'Seul un besoin soumis peut être rappelé'; end if;
  if exists (select 1 from lignes_besoin where besoin_id = p_besoin and statut not in ('EXPRIMEE','ABANDONNEE')) then
    raise exception 'Ce besoin contient des lignes déjà tranchées ou réexprimées : il ne peut plus être rappelé';
  end if;
  perform set_config('app.systeme', '1', true);
  update lignes_besoin set statut = 'BROUILLON' where besoin_id = p_besoin and statut = 'EXPRIMEE';
  update besoins set statut = 'EN_SAISIE', soumis_le = null, soumis_par = null where id = p_besoin;
  perform set_config('app.systeme', '', true);
  insert into historique(entite, entite_id, agence_code, ancien, nouveau, acteur)
  values ('BESOIN', b.numero, b.agence_code, 'SOUMIS', 'EN_SAISIE', auth.uid());
end $$;

-- ---------- Décision de la DML : sélection des lignes puis validation du besoin ----------
-- p_decisions : une entrée par ligne en attente :
--   {id_besoin, decision: 'VALIDEE' | 'NON_VALIDEE', mode: 'MDD' | 'MDI', montant_retenu, motif_code}
create or replace function decider_besoin(p_besoin uuid, p_decisions jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role role_t := auth_role();
  b besoins%rowtype; d record; l lignes_besoin%rowtype;
  v_attendues text[]; v_recues text[]; n_ok int := 0; n_ko int := 0;
begin
  if v_role is distinct from 'DML' then raise exception 'Réservé à la DML'; end if;
  select * into b from besoins where id = p_besoin for update;
  if not found then raise exception 'Besoin introuvable'; end if;
  if b.statut <> 'SOUMIS' then raise exception 'Le besoin % n''est pas en attente de décision', b.numero; end if;

  select array_agg(id_besoin order by id_besoin) into v_attendues
    from lignes_besoin where besoin_id = p_besoin and statut in ('EXPRIMEE','REEXPRIMEE');
  if v_attendues is null then raise exception 'Aucune ligne à décider dans ce besoin'; end if;
  select array_agg(x.id_besoin order by x.id_besoin) into v_recues
    from jsonb_to_recordset(coalesce(p_decisions, '[]'::jsonb)) as x(id_besoin text);
  if v_recues is distinct from v_attendues then
    raise exception 'Chaque ligne en attente doit être soit retenue, soit non retenue (avec motif) : % ligne(s) attendue(s)',
      array_length(v_attendues, 1);
  end if;

  perform set_config('app.systeme', '1', true);
  for d in select * from jsonb_to_recordset(p_decisions) as x(id_besoin text, decision text, mode text, montant_retenu numeric, motif_code text) loop
    select * into l from lignes_besoin where id_besoin = d.id_besoin;
    begin
      if d.decision = 'VALIDEE' then
        if d.mode is null or d.montant_retenu is null then raise exception 'mode (MDD ou MDI) et montant retenu obligatoires'; end if;
        if d.montant_retenu <= 0 then raise exception 'le montant retenu doit être positif'; end if;
        if d.montant_retenu > l.montant then raise exception 'le montant retenu (%) dépasse le montant demandé (%)', round(d.montant_retenu), round(l.montant); end if;
        update lignes_besoin set statut = 'VALIDEE', mode = d.mode::mode_t, montant_retenu = d.montant_retenu, motif_code = null
         where id_besoin = d.id_besoin;
        n_ok := n_ok + 1;
      elsif d.decision = 'NON_VALIDEE' then
        if coalesce(d.motif_code, '') = '' then raise exception 'motif obligatoire pour une ligne non retenue'; end if;
        update lignes_besoin set statut = 'NON_VALIDEE', motif_code = d.motif_code, mode = null, montant_retenu = null
         where id_besoin = d.id_besoin;
        n_ko := n_ko + 1;
      else
        raise exception 'décision inconnue « % »', d.decision;
      end if;
    exception when others then
      raise exception 'Ligne % : %', d.id_besoin, sqlerrm;
    end;
  end loop;
  update besoins set statut = 'DECIDE', decide_le = now(), decide_par = auth.uid() where id = p_besoin;
  perform set_config('app.systeme', '', true);

  insert into historique(entite, entite_id, agence_code, ancien, nouveau, motif, acteur)
  values ('BESOIN', b.numero, b.agence_code, 'SOUMIS', 'DECIDE', n_ok || ' retenue(s), ' || n_ko || ' non retenue(s)', auth.uid());
  return jsonb_build_object('besoin', b.numero, 'retenues', n_ok, 'non_retenues', n_ko);
end $$;

-- ---------- Réexpression par l'agence des lignes non retenues (cycle encore ouvert) ----------
create or replace function reexprimer_besoin(p_besoin uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role role_t := auth_role(); v_agence text := auth_agence();
  b besoins%rowtype; l record; n int := 0;
begin
  select * into b from besoins where id = p_besoin for update;
  if not found then raise exception 'Besoin introuvable'; end if;
  if v_role is distinct from 'CHEF' or v_agence is distinct from b.agence_code then
    raise exception 'Seul le chef de l''agence concernée réexprime les lignes';
  end if;
  if b.statut <> 'DECIDE' then raise exception 'Seul un besoin déjà décidé peut être réexprimé'; end if;
  if not exists (select 1 from cycles where id = b.cycle_id and statut = 'OUVERT') then
    raise exception 'Le cycle % est clôturé : les lignes reportées reviennent avec le cycle suivant', b.cycle_id;
  end if;

  perform set_config('app.systeme', '1', true);
  -- « reporté » et « sacrifié » reviennent d'eux-mêmes au cycle suivant
  for l in select id_besoin from lignes_besoin
            where besoin_id = p_besoin and statut = 'NON_VALIDEE' and coalesce(motif_code, '') not in ('REPORTE','SACRIFIE')
            order by id_besoin loop
    begin
      update lignes_besoin set statut = 'REEXPRIMEE' where id_besoin = l.id_besoin;
      n := n + 1;
    exception when others then
      raise exception 'Ligne % : %', l.id_besoin, sqlerrm;
    end;
  end loop;
  if n = 0 then raise exception 'Aucune ligne non retenue à réexprimer dans ce besoin'; end if;
  update besoins set statut = 'SOUMIS', soumis_le = now(), soumis_par = auth.uid(), decide_le = null, decide_par = null
   where id = p_besoin;
  perform set_config('app.systeme', '', true);

  insert into historique(entite, entite_id, agence_code, ancien, nouveau, motif, acteur)
  values ('BESOIN', b.numero, b.agence_code, 'DECIDE', 'SOUMIS', n || ' ligne(s) réexprimée(s)', auth.uid());
  return jsonb_build_object('besoin', b.numero, 'lignes_reexprimees', n);
end $$;

-- ---------- Vue : statut affiché ----------
-- en saisie / soumis : fixé par le circuit ; une fois décidé : déduit des lignes
create or replace view v_besoins with (security_invoker = true) as
select b.id, b.numero, b.agence_code, b.cycle_id, b.libelle, b.service, b.created_at, b.auteur,
       count(l.id_besoin) filter (where l.statut <> 'ABANDONNEE') as nb_lignes,
       coalesce(sum(l.montant) filter (where l.statut <> 'ABANDONNEE'), 0) as montant,
       count(*) filter (where l.statut = 'BROUILLON') as nb_brouillons,
       case
         when b.statut = 'EN_SAISIE' then
           case when count(l.id_besoin) filter (where l.statut <> 'ABANDONNEE') = 0 then 'VIDE' else 'EN_SAISIE' end
         when b.statut = 'SOUMIS' then 'SOUMIS'
         when count(*) filter (where l.statut not in ('CLOTUREE','ABANDONNEE')) = 0 then 'CLOTURE'
         when count(*) filter (where l.statut not in ('VALIDEE','MAD_ETABLIE','EN_TRAITEMENT','CLOTUREE','ABANDONNEE')) = 0 then 'ENTIEREMENT_VALIDE'
         when count(*) filter (where l.statut in ('VALIDEE','MAD_ETABLIE','EN_TRAITEMENT','CLOTUREE')) > 0 then 'PARTIELLEMENT_VALIDE'
         else 'NON_VALIDE'
       end as statut
  from besoins b left join lignes_besoin l on l.besoin_id = b.id
 group by b.id;

-- ---------- Ouverture du cycle suivant : fiche de report déjà « soumise » ----------
create or replace function ouvrir_cycle(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prec text; l record; v_ok int := 0; v_ko int := 0; v_besoin uuid;
begin
  if auth_role() is distinct from 'DML' then raise exception 'Réservé à la DML'; end if;
  select id into v_prec from cycles where id < p_id order by id desc limit 1;
  if v_prec is null then raise exception 'Aucun cycle précédent'; end if;
  if not exists (select 1 from cycles where id = v_prec and statut = 'CLOTURE') then
    raise exception 'Le cycle précédent (%) doit être clôturé avant d''ouvrir %', v_prec, p_id;
  end if;
  insert into cycles(id) values (p_id);
  perform set_config('app.systeme', '1', true);
  for l in select id_besoin, agence_code from lignes_besoin
            where cycle_id = v_prec and statut = 'NON_VALIDEE' and motif_code = 'REPORTE' order by id_besoin loop
    begin
      select id into v_besoin from besoins
       where agence_code = l.agence_code and cycle_id = p_id and libelle = 'Besoins reportés du cycle ' || v_prec;
      if v_besoin is null then
        insert into besoins(agence_code, cycle_id, libelle, statut, soumis_le)
        values (l.agence_code, p_id, 'Besoins reportés du cycle ' || v_prec, 'SOUMIS', now())
        returning id into v_besoin;
      end if;
      update lignes_besoin set statut = 'REEXPRIMEE', cycle_id = p_id, besoin_id = v_besoin where id_besoin = l.id_besoin;
      v_ok := v_ok + 1;
    exception when others then v_ko := v_ko + 1;
    end;
  end loop;
  perform set_config('app.systeme', '', true);
  return jsonb_build_object('cycle', p_id, 'lignes_reportees', v_ok, 'lignes_non_reportees', v_ko);
end $$;

grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema public from anon, public;
