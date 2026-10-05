-- Sécurité par rôle et par agence (RLS) + séparation des tâches

alter table agences enable row level security;
alter table profiles enable row level security;
alter table parametres enable row level security;
alter table cycles enable row level security;
alter table parc enable row level security;
alter table fournisseurs enable row level security;
alter table grille_prix enable row level security;
alter table id_sequences enable row level security;
alter table besoins enable row level security;
alter table lignes_besoin enable row level security;
alter table decisions enable row level security;
alter table mad enable row level security;
alter table depenses enable row level security;
alter table pieces enable row level security;
alter table reaffectations enable row level security;
alter table comptes_emploi enable row level security;
alter table classements enable row level security;
alter table historique enable row level security;
alter table transitions enable row level security;
alter table api_clients enable row level security;
alter table api_journal enable row level security;

-- vrai pour DML, CG, DG, Trésorerie, Admin : vision globale
create or replace function est_central() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(auth_role() in ('DML','CG','DG','TRES','ADMIN'), false) $$;

create or replace function est_agence(p_agence text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(auth_role() in ('CHEF','RM') and auth_agence() = p_agence, false) $$;

-- ---------- Référentiels : lecture pour tout utilisateur connecté ----------
create policy lecture on agences for select to authenticated using (true);
create policy lecture on cycles for select to authenticated using (true);
create policy lecture on fournisseurs for select to authenticated using (true);
create policy lecture on grille_prix for select to authenticated using (true);
create policy lecture on parametres for select to authenticated using (true);
create policy lecture on transitions for select to authenticated using (true);
create policy lecture on parc for select to authenticated using (est_central() or est_agence(agence_code));

create policy ecriture on cycles for all to authenticated
  using (auth_role() in ('DML','ADMIN')) with check (auth_role() in ('DML','ADMIN'));
create policy ecriture on fournisseurs for all to authenticated
  using (auth_role() in ('DML','ADMIN')) with check (auth_role() in ('DML','ADMIN'));
create policy ecriture on grille_prix for all to authenticated
  using (auth_role() in ('DML','ADMIN')) with check (auth_role() in ('DML','ADMIN'));
create policy ecriture on parc for all to authenticated
  using (auth_role() in ('DML','ADMIN')) with check (auth_role() in ('DML','ADMIN'));
create policy ecriture on agences for all to authenticated
  using (auth_role() = 'ADMIN') with check (auth_role() = 'ADMIN');
create policy ecriture on parametres for all to authenticated
  using (auth_role() in ('DG','ADMIN')) with check (auth_role() in ('DG','ADMIN'));

-- ---------- Profils : chacun lit le sien, l'admin gère ----------
create policy lecture on profiles for select to authenticated
  using (id = auth.uid() or auth_role() in ('ADMIN','DML','DG','CG'));
create policy gestion on profiles for all to authenticated
  using (auth_role() = 'ADMIN') with check (auth_role() = 'ADMIN');

-- ---------- Besoins et lignes ----------
create policy lecture on besoins for select to authenticated using (est_central() or est_agence(agence_code));
create policy creation on besoins for insert to authenticated
  with check (est_agence(agence_code) or auth_role() = 'DML');

create policy lecture on lignes_besoin for select to authenticated using (est_central() or est_agence(agence_code));
create policy creation on lignes_besoin for insert to authenticated
  with check (est_agence(agence_code) or auth_role() = 'DML');
-- les transitions et champs autorisés sont contrôlés par trigger selon le rôle
create policy modification on lignes_besoin for update to authenticated
  using (est_agence(agence_code) or auth_role() in ('DML','CG'))
  with check (est_agence(agence_code) or auth_role() in ('DML','CG'));

-- ---------- Décisions et MAD (écriture uniquement via les fonctions) ----------
create policy lecture on decisions for select to authenticated using (est_central());
create policy lecture on mad for select to authenticated using (est_central() or est_agence(agence_code));

-- ---------- Dépenses : séparation des tâches ----------
-- Saisie réservée aux agences. DML, CG, DG et Trésorerie ne peuvent pas engager de dépense.
create policy lecture on depenses for select to authenticated using (est_central() or est_agence(agence_code));
create policy saisie on depenses for insert to authenticated with check (est_agence(agence_code));
create policy correction on depenses for update to authenticated
  using (est_agence(agence_code)) with check (est_agence(agence_code));

create policy lecture on pieces for select to authenticated using (
  exists (select 1 from depenses d where d.id = depense_id and (est_central() or est_agence(d.agence_code))));
create policy saisie on pieces for insert to authenticated with check (
  exists (select 1 from depenses d where d.id = depense_id and est_agence(d.agence_code)));

-- ---------- Réaffectations ----------
create policy lecture on reaffectations for select to authenticated using (est_central() or est_agence(agence_code));
create policy soumission on reaffectations for insert to authenticated
  with check (est_agence(agence_code) and statut = 'SOUMISE');

-- ---------- Compte d'emploi et classement : contrôle par la CG, pas par l'agence ----------
create policy lecture on comptes_emploi for select to authenticated using (est_central() or est_agence(agence_code));
create policy depot on comptes_emploi for update to authenticated
  using (est_agence(agence_code) and auth_role() = 'CHEF' or auth_role() = 'CG')
  with check (est_agence(agence_code) and auth_role() = 'CHEF' or auth_role() = 'CG');

create policy lecture on classements for select to authenticated using (
  exists (select 1 from comptes_emploi c where c.id = compte_id and (est_central() or est_agence(c.agence_code))));
create policy controle on classements for all to authenticated
  using (auth_role() = 'CG') with check (auth_role() = 'CG');

-- ---------- Historique : lecture seule ----------
create policy lecture on historique for select to authenticated using (
  est_central() or (agence_code is not null and est_agence(agence_code)));

-- id_sequences, api_clients, api_journal : aucune politique = accès service_role uniquement

-- ---------- Droits SQL : on retire tout à anon ----------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
revoke insert, update on decisions, mad, id_sequences, transitions, api_clients, api_journal from authenticated;
revoke all on id_sequences, api_clients, api_journal from authenticated;
