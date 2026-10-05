-- Mots de passe : réinitialisation par la direction (DML, DG) et changement obligatoire à la reconnexion.
--
-- Principe de sécurité : celui qui réinitialise connaît le mot de passe temporaire. Pour que cela ne permette pas
-- d'agir à la place d'un agent : mot de passe aléatoire affiché une seule fois, changement obligatoire vérifié par la base
-- (le hachage doit avoir changé), sessions du compte coupées, réinitialisation tracée dans l'historique.
-- Seules les agences (CHEF, RM) sont réinitialisables par la direction ; l'administrateur peut tout réinitialiser.

alter table profiles add column doit_changer_mdp boolean not null default false;

-- Empreinte du mot de passe temporaire : sert uniquement à vérifier que l'utilisateur l'a bien remplacé.
-- Aucune politique RLS et aucun droit : inaccessible hors des fonctions ci-dessous.
create table mdp_reinitialisations (
  user_id uuid primary key references profiles(id) on delete cascade,
  hash text not null,
  reinitialise_par uuid,
  reinitialise_le timestamptz not null default now()
);
alter table mdp_reinitialisations enable row level security;
revoke all on mdp_reinitialisations from anon, authenticated;

-- ---------- Réinitialisation (direction) ----------
create or replace function reinitialiser_mot_de_passe(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role role_t := auth_role();
  t profiles%rowtype;
  v_mdp text;
  v_email text;
begin
  if v_role is null or v_role not in ('DML','DG','ADMIN') then
    raise exception 'Réservé à la direction (DML, DG) ou à l''administrateur';
  end if;
  select * into t from profiles where id = p_user;
  if not found then raise exception 'Compte introuvable'; end if;
  if p_user = auth.uid() then
    raise exception 'Pour votre propre mot de passe, utilisez « Mon compte »';
  end if;
  if not t.actif then raise exception 'Ce compte est désactivé'; end if;
  if v_role in ('DML','DG') and t.role not in ('CHEF','RM') then
    raise exception 'La direction ne réinitialise que les comptes des agences';
  end if;

  v_mdp := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) || 'Aa1!';

  update auth.users set encrypted_password = crypt(v_mdp, gen_salt('bf')), updated_at = now()
   where id = p_user returning email into v_email;
  if v_email is null then raise exception 'Compte d''authentification introuvable'; end if;

  -- on coupe les sessions ouvertes : l'ancien mot de passe ne sert plus à rien
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;

  update profiles set doit_changer_mdp = true where id = p_user;
  insert into mdp_reinitialisations(user_id, hash, reinitialise_par)
  select id, encrypted_password, auth.uid() from auth.users where id = p_user
  on conflict (user_id) do update
    set hash = excluded.hash, reinitialise_par = excluded.reinitialise_par, reinitialise_le = now();

  insert into historique(entite, entite_id, agence_code, nouveau, acteur)
  values ('COMPTE', v_email, t.agence_code, 'MDP_REINITIALISE', auth.uid());

  return jsonb_build_object('email', v_email, 'nom', t.nom, 'mot_de_passe', v_mdp);
end $$;

-- ---------- L'utilisateur confirme qu'il a changé son mot de passe ----------
create or replace function mot_de_passe_change() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r mdp_reinitialisations%rowtype; h text;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  select * into r from mdp_reinitialisations where user_id = auth.uid();
  select encrypted_password into h from auth.users where id = auth.uid();
  if found and r.hash = h then
    raise exception 'Le mot de passe n''a pas encore été modifié';
  end if;
  update profiles set doit_changer_mdp = false where id = auth.uid();
  delete from mdp_reinitialisations where user_id = auth.uid();
  insert into historique(entite, entite_id, nouveau, acteur)
  select 'COMPTE', email, 'MDP_CHANGE', auth.uid() from auth.users where id = auth.uid();
end $$;

-- ---------- Liste des comptes pour la direction ----------
create or replace function liste_comptes()
returns table (id uuid, nom text, role role_t, agence_code text, email text, actif boolean,
               doit_changer_mdp boolean, derniere_connexion timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_role role_t := auth_role();
begin
  if v_role is null or v_role not in ('DML','DG','ADMIN') then
    raise exception 'Réservé à la direction (DML, DG) ou à l''administrateur';
  end if;
  return query
    select p.id, p.nom, p.role, p.agence_code, u.email::text, p.actif, p.doit_changer_mdp, u.last_sign_in_at
      from profiles p join auth.users u on u.id = p.id
     where v_role = 'ADMIN' or p.role in ('CHEF','RM')
     order by p.agence_code nulls first, p.role, p.nom;
end $$;

grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema public from anon, public;
