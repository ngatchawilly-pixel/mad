-- Référentiels du suivi des opérations (agences, parc, seuils) : colonnes d'accueil.
-- Et correction de l'import des besoins pour un parc déjà chargé (état immobilisé, châssis).

alter table agences add column pont_bascule text;
alter table parc add column type_vehicule text;
alter table parc add column remarque text;     -- anomalie à trancher par la DML (doublon possible...)

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
  select count(*) into v_vehicules
    from jsonb_to_recordset(coalesce(p_vehicules, '[]'::jsonb)) as v(code text)
   where not exists (select 1 from parc p where p.code = v.code);

  -- nouveaux véhicules ; pour un véhicule déjà au parc, on complète seulement le châssis s'il manque
  insert into parc(code, agence_code, famille, chassis, etat)
  select v.code, v.agence_code, v.famille, v.chassis, v.etat
    from jsonb_to_recordset(coalesce(p_vehicules, '[]'::jsonb)) as v(code text, agence_code text, famille text, chassis text, etat text)
  on conflict (code) do update set chassis = coalesce(parc.chassis, excluded.chassis);

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

  -- un véhicule financé « immobilisé » l'est au parc : la remise en service se mesure à partir de là
  update parc p set etat = 'Immobilisé'
   where p.etat <> 'Immobilisé'
     and p.code in (select x.code_parc from jsonb_to_recordset(p_lignes) as x(code_parc text, etat_vehicule text)
                     where x.etat_vehicule = 'Immobilisé' and x.code_parc is not null);

  insert into historique(entite, entite_id, nouveau, motif, acteur)
  values ('IMPORT', p_cycle, 'IMPORTE', v_lignes || ' lignes', auth.uid());

  return jsonb_build_object('lignes', v_lignes, 'vehicules', v_vehicules, 'fournisseurs', v_fourn, 'grille', v_grille);
end $$;



grant execute on function importer_besoins(text, jsonb, jsonb, jsonb) to authenticated;
revoke all on function importer_besoins(text, jsonb, jsonb, jsonb) from anon, public;
