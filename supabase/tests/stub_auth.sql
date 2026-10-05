-- Faux schéma auth pour jouer les tests SQL sur un Postgres vierge (hors Supabase).
-- Usage : voir supabase/tests/lancer_tests.sh
create extension if not exists pgcrypto;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users(
  id uuid primary key default gen_random_uuid(), email text,
  encrypted_password text, updated_at timestamptz default now(), last_sign_in_at timestamptz);
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated; grant usage on schema public to authenticated, anon;
