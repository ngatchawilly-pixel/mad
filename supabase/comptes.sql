-- Création des comptes (à lancer dans l'éditeur SQL de Supabase, une seule fois).
-- Crée : chef et responsable maintenance pour chaque entité de la table agences, + DML, CG, DG, Trésorerie.
-- Les comptes déjà existants (même e-mail) sont ignorés. Mots de passe aléatoires, affichés à la fin.
-- À NOTER IMMÉDIATEMENT : ils ne sont pas relisibles ensuite (seul le hachage est conservé).
-- Chaque compte créé devra changer son mot de passe à la première connexion (migration 10 requise).
-- Mot de passe perdu : la direction (DML, DG) le réinitialise depuis la page Utilisateurs de l'application.

create temp table _comptes_crees(email text, mot_de_passe text, role text, agence text);

do $$
declare
  v_domaine constant text := 'hysacam-proprete.com';
  r record;
  v_uid uuid; v_email text; v_mdp text;
begin
  for r in
    select 'chef.' || lower(code) as local, 'Chef ' || nom as nom, 'CHEF'::role_t as role, code as agence from agences
    union all
    select 'rm.' || lower(code), 'Resp. maintenance ' || nom, 'RM'::role_t, code from agences
    union all select 'dml', 'DML', 'DML'::role_t, null
    union all select 'cg', 'Contrôle de gestion', 'CG'::role_t, null
    union all select 'dg', 'Direction Générale', 'DG'::role_t, null
    union all select 'tresorerie', 'Trésorerie', 'TRES'::role_t, null
  loop
    v_email := r.local || '@' || v_domaine;
    if exists (select 1 from auth.users where email = v_email) then continue; end if;

    v_uid := gen_random_uuid();
    v_mdp := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || 'Aa1!';

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
            crypt(v_mdp, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());

    insert into profiles(id, nom, role, agence_code) values (v_uid, r.nom, r.role, r.agence)
    on conflict (id) do nothing;

    -- changement obligatoire à la première connexion, vérifié par la base
    update profiles set doit_changer_mdp = true where id = v_uid;
    insert into mdp_reinitialisations(user_id, hash)
    select id, encrypted_password from auth.users where id = v_uid;

    insert into _comptes_crees values (v_email, v_mdp, r.role::text, r.agence);
  end loop;
end $$;

select email, mot_de_passe, role, agence from _comptes_crees order by role, agence;

-- Pour imposer aussi le changement aux comptes DÉJÀ créés (sauf l'administrateur), lancer une fois :
--   insert into mdp_reinitialisations(user_id, hash)
--   select u.id, u.encrypted_password from auth.users u join profiles p on p.id = u.id where p.role <> 'ADMIN'
--   on conflict (user_id) do update set hash = excluded.hash, reinitialise_le = now();
--   update profiles set doit_changer_mdp = true where role <> 'ADMIN';
