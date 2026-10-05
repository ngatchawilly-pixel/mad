-- Tests des mots de passe. Base vierge + stub auth étendu (encrypted_password, sessions) ; à jouer APRÈS test_regles.sql
-- (réutilise les utilisateurs 1 à 7 : 1 chef BAF, 2 RM BAF, 3 DML, 4 CG, 5 DG, 6 TRES, 7 chef KRI).
\set ON_ERROR_STOP off
create temp table res(n serial, label text, ok boolean, detail text);
grant all on res to authenticated; grant usage on sequence res_n_seq to authenticated;

-- un administrateur de test et des sessions ouvertes
insert into auth.users(id, email, encrypted_password) values ('00000000-0000-0000-0000-000000000008', 'admin@test', 'x')
  on conflict do nothing;
insert into profiles(id, nom, role) values ('00000000-0000-0000-0000-000000000008', 'Admin', 'ADMIN') on conflict do nothing;
update auth.users set encrypted_password = crypt('AncienMdp!1', gen_salt('bf')), email = coalesce(email, 'u@test');
insert into auth.sessions(user_id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000001');

-- droits
select t('chef ne peut pas réinitialiser', 1, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000007')$o$, true);
select t('responsable maintenance ne peut pas réinitialiser', 2, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000001')$o$, true);
select t('contrôle de gestion ne peut pas réinitialiser (séparation des tâches)', 4, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000001')$o$, true);
select t('trésorerie ne peut pas réinitialiser', 6, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000001')$o$, true);
select t('la DML ne réinitialise pas un compte de direction (DG)', 3, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000005')$o$, true);
select t('la DML ne réinitialise pas le contrôle de gestion', 3, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000004')$o$, true);
select t('la DG ne réinitialise pas la DML', 5, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000003')$o$, true);
select t('on ne réinitialise pas son propre compte par ce biais', 8, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000008')$o$, true);
select t('compte inconnu refusé', 3, $o$select reinitialiser_mot_de_passe(gen_random_uuid())$o$, true);

-- réinitialisation par la DML d'un chef d'agence
select t('DML réinitialise le chef de BAF', 3, $o$do $x$ declare r jsonb; begin
  r := reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000001');
  if r->>'mot_de_passe' is null or length(r->>'mot_de_passe') < 16 then raise exception 'mot de passe trop court : %', r; end if;
  if r->>'mot_de_passe' !~ '[a-z]' or r->>'mot_de_passe' !~ '[A-Z]' or r->>'mot_de_passe' !~ '[0-9]' then raise exception 'complexité'; end if;
  create temp table if not exists _mdp(v text); delete from _mdp; insert into _mdp values (r->>'mot_de_passe');
  grant all on _mdp to authenticated;
end $x$$o$, false);
select t('le mot de passe stocké correspond au mot de passe affiché', null, $o$do $x$ begin
  if (select encrypted_password from auth.users where id = '00000000-0000-0000-0000-000000000001') <> crypt((select v from _mdp), (select encrypted_password from auth.users where id = '00000000-0000-0000-0000-000000000001'))
  then raise exception 'hachage incohérent'; end if; end $x$$o$, false);
select t('l''ancien mot de passe ne fonctionne plus', null, $o$do $x$ begin
  if (select encrypted_password from auth.users where id = '00000000-0000-0000-0000-000000000001') = crypt('AncienMdp!1', (select encrypted_password from auth.users where id = '00000000-0000-0000-0000-000000000001'))
  then raise exception 'ancien mot de passe encore valide'; end if; end $x$$o$, false);
select t('le compte doit changer son mot de passe', null, $o$do $x$ begin
  if not (select doit_changer_mdp from profiles where id = '00000000-0000-0000-0000-000000000001') then raise exception 'drapeau absent'; end if; end $x$$o$, false);
select t('les sessions ouvertes sont coupées', null, $o$do $x$ begin
  if exists (select 1 from auth.sessions where user_id = '00000000-0000-0000-0000-000000000001') then raise exception 'session encore ouverte'; end if; end $x$$o$, false);
select t('la réinitialisation est tracée dans l''historique avec son auteur', null, $o$do $x$ begin
  if not exists (select 1 from historique where entite = 'COMPTE' and nouveau = 'MDP_REINITIALISE' and acteur = '00000000-0000-0000-0000-000000000003') then raise exception 'trace absente'; end if; end $x$$o$, false);
select t('le mot de passe n''apparaît dans aucune trace', null, $o$do $x$ begin
  if exists (select 1 from historique h where h::text like '%' || (select v from _mdp) || '%') then raise exception 'mot de passe en clair dans l''historique'; end if; end $x$$o$, false);
select t('le chef n''a aucun accès à la table des empreintes', 1, $o$select * from mdp_reinitialisations$o$, true);

-- changement obligatoire
select t('passer l''écran sans avoir changé le mot de passe est refusé', 1, $o$select mot_de_passe_change()$o$, true);
select t('... et le drapeau reste levé', null, $o$do $x$ begin
  if not (select doit_changer_mdp from profiles where id = '00000000-0000-0000-0000-000000000001') then raise exception 'drapeau levé à tort'; end if; end $x$$o$, false);
update auth.users set encrypted_password = crypt('NouveauMdpPerso!7', gen_salt('bf')) where id = '00000000-0000-0000-0000-000000000001';
select t('après un vrai changement de mot de passe, l''écran est levé', 1, $o$select mot_de_passe_change()$o$, false);
select t('le drapeau est baissé', null, $o$do $x$ begin
  if (select doit_changer_mdp from profiles where id = '00000000-0000-0000-0000-000000000001') then raise exception 'drapeau encore levé'; end if; end $x$$o$, false);
select t('le changement est tracé', null, $o$do $x$ begin
  if not exists (select 1 from historique where entite = 'COMPTE' and nouveau = 'MDP_CHANGE' and acteur = '00000000-0000-0000-0000-000000000001') then raise exception 'trace absente'; end if; end $x$$o$, false);
select t('appel sans connexion refusé', null, $o$select mot_de_passe_change()$o$, true);

-- autres rôles de direction
select t('la DG réinitialise un responsable maintenance', 5, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000002')$o$, false);
select t('l''administrateur réinitialise un compte de direction', 8, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000004')$o$, false);
update profiles set actif = false where id = '00000000-0000-0000-0000-000000000007';
select t('compte désactivé non réinitialisable', 3, $o$select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000007')$o$, true);
update profiles set actif = true where id = '00000000-0000-0000-0000-000000000007';

-- liste des comptes
select t('la DML voit uniquement les comptes d''agence', 3, $o$do $x$ begin
  if exists (select 1 from liste_comptes() where role not in ('CHEF','RM')) then raise exception 'comptes de direction visibles'; end if;
  if (select count(*) from liste_comptes()) <> 3 then raise exception 'nombre %', (select count(*) from liste_comptes()); end if; end $x$$o$, false);
select t('la liste fournit l''e-mail et l''état du changement', 3, $o$do $x$ begin
  if exists (select 1 from liste_comptes() where email is null) then raise exception 'e-mail absent'; end if; end $x$$o$, false);
select t('l''administrateur voit tous les comptes', 8, $o$do $x$ begin
  if (select count(*) from liste_comptes()) < 8 then raise exception 'liste incomplète'; end if; end $x$$o$, false);
select t('le chef ne peut pas lister les comptes', 1, $o$select * from liste_comptes()$o$, true);
select t('anon ne peut rien appeler', 1, $o$set role anon; select reinitialiser_mot_de_passe('00000000-0000-0000-0000-000000000002')$o$, true);

select n, case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
