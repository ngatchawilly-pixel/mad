-- Le besoin (fiche d'expression) devient un objet à part entière : on le crée ou on le choisit,
-- puis on y ajoute ses lignes. Numéro de fiche, libellé, statut déduit des lignes.

alter table besoins add column numero text unique;
alter table besoins add column libelle text;
alter table besoins add column service text;

-- numéro de fiche : BES-AGENCE-AAMM-NNN (compteur propre, distinct de celui des lignes)
create or replace function trg_besoins_numero() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not exists (select 1 from cycles where id = new.cycle_id and statut = 'OUVERT') then
    raise exception 'Le cycle % est clôturé : impossible d''y créer un besoin', new.cycle_id;
  end if;
  if new.numero is null or new.numero = '' then
    insert into id_sequences(agence_code, cycle_id, n) values ('BES:' || new.agence_code, new.cycle_id, 1)
    on conflict (agence_code, cycle_id) do update set n = id_sequences.n + 1
    returning n into v_n;
    new.numero := 'BES-' || new.agence_code || '-' || new.cycle_id || '-' || lpad(v_n::text, 3, '0');
  end if;
  return new;
end $$;
create trigger besoins_numero before insert on besoins for each row execute function trg_besoins_numero();

-- reprise des fiches existantes
with n as (
  select id, agence_code, cycle_id, row_number() over (partition by agence_code, cycle_id order by created_at, id) rn from besoins)
update besoins b set numero = 'BES-' || n.agence_code || '-' || n.cycle_id || '-' || lpad(n.rn::text, 3, '0')
  from n where n.id = b.id and b.numero is null;
insert into id_sequences(agence_code, cycle_id, n)
  select 'BES:' || agence_code, cycle_id, count(*) from besoins group by agence_code, cycle_id
on conflict (agence_code, cycle_id) do update set n = excluded.n;
alter table besoins alter column numero set not null;

-- Une ligne appartient à un besoin de la même agence et du même cycle (au moment de la création).
create or replace function trg_ligne_besoin_coherence() returns trigger
language plpgsql as $$
declare b besoins%rowtype;
begin
  select * into b from besoins where id = new.besoin_id;
  if not found then raise exception 'Besoin introuvable : une ligne doit appartenir à un besoin'; end if;
  if b.agence_code <> new.agence_code or b.cycle_id <> new.cycle_id then
    raise exception 'La ligne doit appartenir à un besoin de la même agence (%) et du même cycle (%)', new.agence_code, new.cycle_id;
  end if;
  return new;
end $$;
create trigger lignes_besoin_coherence before insert on lignes_besoin
  for each row execute function trg_ligne_besoin_coherence();

-- modification du libellé par l'agence ou la DML
create policy modification on besoins for update to authenticated
  using (est_agence(agence_code) or auth_role() = 'DML')
  with check (est_agence(agence_code) or auth_role() = 'DML');

-- retirer une ligne saisie par erreur (jamais de suppression physique)
insert into transitions values ('BROUILLON','ABANDONNEE','{CHEF,RM,DML}',true) on conflict do nothing;

-- Statut du besoin, déduit de ses lignes
create or replace view v_besoins with (security_invoker = true) as
select b.id, b.numero, b.agence_code, b.cycle_id, b.libelle, b.service, b.created_at, b.auteur,
       count(l.id_besoin) filter (where l.statut <> 'ABANDONNEE') as nb_lignes,
       coalesce(sum(l.montant) filter (where l.statut <> 'ABANDONNEE'), 0) as montant,
       count(*) filter (where l.statut = 'BROUILLON') as nb_brouillons,
       case
         when count(l.id_besoin) filter (where l.statut <> 'ABANDONNEE') = 0 then 'VIDE'
         when count(*) filter (where l.statut = 'BROUILLON') > 0 then 'EN_SAISIE'
         when count(*) filter (where l.statut not in ('CLOTUREE','ABANDONNEE')) = 0 then 'CLOTURE'
         when count(*) filter (where l.statut not in ('VALIDEE','MAD_ETABLIE','EN_TRAITEMENT','CLOTUREE','ABANDONNEE')) = 0 then 'ENTIEREMENT_VALIDE'
         when count(*) filter (where l.statut in ('VALIDEE','MAD_ETABLIE','EN_TRAITEMENT','CLOTUREE')) > 0 then 'PARTIELLEMENT_VALIDE'
         when count(*) filter (where l.statut not in ('NON_VALIDEE','ABANDONNEE')) = 0 then 'NON_VALIDE'
         else 'SOUMIS'
       end as statut
  from besoins b left join lignes_besoin l on l.besoin_id = b.id
 group by b.id;
grant select on v_besoins to authenticated;
revoke all on v_besoins from anon;

-- Import : une fiche par agence, avec un libellé
create or replace function importer_besoins(p_cycle text, p_vehicules jsonb, p_grille jsonb, p_lignes jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a text; b uuid;
  v_lignes int := 0; v_vehicules int := 0; v_fourn int := 0; v_grille int := 0; n int;
begin
  if auth_role() is distinct from 'DML' then raise exception 'Import réservé à la DML'; end if;
  if not exists (select 1 from cycles where id = p_cycle and statut = 'OUVERT') then
    raise exception 'Cycle % introuvable ou clôturé', p_cycle;
  end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne à importer';
  end if;

  -- fournisseurs (raison sociale unique)
  insert into fournisseurs(raison_sociale)
  select distinct x.fournisseur from jsonb_to_recordset(p_lignes) as x(fournisseur text)
   where coalesce(x.fournisseur, '') <> ''
  on conflict (raison_sociale) do nothing;
  get diagnostics v_fourn = row_count;

  -- véhicules inconnus du parc
  insert into parc(code, agence_code, famille, chassis, etat)
  select v.code, v.agence_code, v.famille, v.chassis, v.etat
    from jsonb_to_recordset(coalesce(p_vehicules, '[]'::jsonb)) as v(code text, agence_code text, famille text, chassis text, etat text)
  on conflict (code) do nothing;
  get diagnostics v_vehicules = row_count;

  -- grille de prix (prix médian par référence)
  insert into grille_prix(reference, prix_plafond)
  select g.reference, g.prix_plafond
    from jsonb_to_recordset(coalesce(p_grille, '[]'::jsonb)) as g(reference text, prix_plafond numeric)
  on conflict (reference) do nothing;
  get diagnostics v_grille = row_count;

  -- une fiche de besoin par agence, puis ses lignes (identifiants générés par la base)
  for a in select distinct x.agence_code from jsonb_to_recordset(p_lignes) as x(agence_code text) order by 1 loop
    insert into besoins(agence_code, cycle_id, libelle) values (a, p_cycle, 'Import Excel du ' || to_char(now(), 'DD/MM/YYYY')) returning id into b;

    insert into lignes_besoin(besoin_id, agence_code, cycle_id, code_parc, etat_vehicule, type_intervention, nature,
                              ot_panne, reference, designation, quantite, prix_unitaire, fournisseur_id,
                              ref_devis, priorite, justification, statut)
    select b, a, p_cycle, x.code_parc, x.etat_vehicule, x.type_intervention, x.nature,
           x.ot_panne, x.reference, x.designation, x.quantite, x.prix_unitaire, f.id,
           x.ref_devis, x.priorite::priorite_t, x.justification, 'BROUILLON'
      from jsonb_to_recordset(p_lignes) as x(
             ligne_excel int, agence_code text, code_parc text, etat_vehicule text, type_intervention text, nature text,
             ot_panne text, reference text, designation text, quantite numeric, prix_unitaire numeric,
             fournisseur text, ref_devis text, priorite text, justification text)
      left join fournisseurs f on f.raison_sociale = nullif(x.fournisseur, '')
     where x.agence_code = a
     order by x.ligne_excel;
    get diagnostics n = row_count;
    v_lignes := v_lignes + n;
  end loop;

  insert into historique(entite, entite_id, nouveau, motif, acteur)
  values ('IMPORT', p_cycle, 'IMPORTE', v_lignes || ' lignes', auth.uid());

  return jsonb_build_object('lignes', v_lignes, 'vehicules', v_vehicules, 'fournisseurs', v_fourn, 'grille', v_grille);
end $$;


-- Ouverture du cycle suivant : les lignes reportées sont rattachées à une fiche du nouveau cycle
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
  for l in select id_besoin, agence_code from lignes_besoin
            where cycle_id = v_prec and statut = 'NON_VALIDEE' and motif_code = 'REPORTE' order by id_besoin loop
    begin
      select id into v_besoin from besoins
       where agence_code = l.agence_code and cycle_id = p_id and libelle = 'Besoins reportés du cycle ' || v_prec;
      if v_besoin is null then
        insert into besoins(agence_code, cycle_id, libelle) values (l.agence_code, p_id, 'Besoins reportés du cycle ' || v_prec)
        returning id into v_besoin;
      end if;
      update lignes_besoin set statut = 'REEXPRIMEE', cycle_id = p_id, besoin_id = v_besoin where id_besoin = l.id_besoin;
      v_ok := v_ok + 1;
    exception when others then v_ko := v_ko + 1;
    end;
  end loop;
  return jsonb_build_object('cycle', p_id, 'lignes_reportees', v_ok, 'lignes_non_reportees', v_ko);
end $$;

grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema public from anon, public;
