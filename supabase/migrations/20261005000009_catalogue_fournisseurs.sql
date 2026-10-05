-- Catalogue fournisseurs : fiche fiscale, articles et prix, historique des prix, comparaison.
-- Sert à vérifier les prix (constat C3 : écarts jusqu'à +40 % sur une même référence) et à alimenter la grille.

-- ---------- Fiche fournisseur ----------
alter table fournisseurs
  add column rccm text,
  add column regime_fiscal text check (regime_fiscal in ('Réel','Simplifié','Libératoire','Exonéré','Autre')),
  add column assujetti_tva boolean,
  add column centre_impots text,
  add column adresse text,
  add column ville text,
  add column telephone text,
  add column email text,
  add column contact_nom text,
  add column banque text,
  add column numero_compte text,
  add column national boolean not null default true,
  add column actif boolean not null default true,
  add column remarque text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

-- NIU : majuscules, sans espace ; un NIU ne peut appartenir qu'à un seul fournisseur
create or replace function trg_fournisseurs_normalise() returns trigger
language plpgsql as $$
begin
  new.raison_sociale := regexp_replace(trim(new.raison_sociale), '\s+', ' ', 'g');
  new.niu := nullif(upper(regexp_replace(coalesce(new.niu, ''), '\s', '', 'g')), '');
  new.updated_at := now();
  return new;
end $$;
create trigger fournisseurs_normalise before insert or update on fournisseurs
  for each row execute function trg_fournisseurs_normalise();
update fournisseurs set niu = niu;          -- normalise l'existant
create unique index fournisseurs_niu_uq on fournisseurs (niu) where niu is not null;
create unique index fournisseurs_nom_uq on fournisseurs (upper(raison_sociale));

create trigger no_delete_fournisseurs before delete on fournisseurs for each row execute function trg_no_delete();

-- ---------- Articles et prix ----------
create table articles_fournisseur (
  id uuid primary key default gen_random_uuid(),
  fournisseur_id bigint not null references fournisseurs(id),
  reference text not null,                              -- référence ou code article chez le fournisseur
  designation text not null,
  unite text not null default 'U',
  prix_unitaire numeric not null check (prix_unitaire >= 0),   -- FCFA hors taxes
  date_prix date not null default current_date,
  source text not null default 'CATALOGUE' check (source in ('CATALOGUE','DEVIS','PRO_FORMA','FACTURE')),
  actif boolean not null default true,
  remarque text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- une référence n'existe qu'une fois par fournisseur, majuscules ou minuscules (« fil-100 » = « FIL-100 »)
create unique index articles_fournisseur_ref_uq on articles_fournisseur (fournisseur_id, lower(reference));
create index on articles_fournisseur (lower(reference));

create or replace function trg_articles_normalise() returns trigger
language plpgsql as $$
begin
  new.reference := regexp_replace(trim(new.reference), '\s+', ' ', 'g');
  new.designation := trim(new.designation);
  new.updated_at := now();
  return new;
end $$;
create trigger articles_normalise before insert or update on articles_fournisseur
  for each row execute function trg_articles_normalise();
create trigger no_delete_articles before delete on articles_fournisseur for each row execute function trg_no_delete();

-- Historique des prix : chaque changement de prix est conservé
create table articles_prix_historique (
  id bigint generated always as identity primary key,
  article_id uuid not null references articles_fournisseur(id),
  prix numeric not null,
  date_prix date not null,
  source text,
  modifie_par uuid,
  at timestamptz not null default now()
);
create index on articles_prix_historique (article_id, at desc);
create trigger no_change_prix_historique before update or delete on articles_prix_historique
  for each row execute function trg_no_delete();

create or replace function trg_articles_historique() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.prix_unitaire is distinct from old.prix_unitaire then
    insert into articles_prix_historique(article_id, prix, date_prix, source, modifie_par)
    values (new.id, new.prix_unitaire, new.date_prix, new.source, auth.uid());
  end if;
  return new;
end $$;
create trigger articles_historique after insert or update on articles_fournisseur
  for each row execute function trg_articles_historique();

-- ---------- Comparaison des prix entre fournisseurs ----------
create or replace view v_prix_reference with (security_invoker = true) as
select lower(a.reference) as cle,
       min(a.reference) as reference,
       min(a.designation) as designation,
       count(distinct a.fournisseur_id) as nb_fournisseurs,
       min(a.prix_unitaire) as prix_min,
       max(a.prix_unitaire) as prix_max,
       percentile_cont(0.5) within group (order by a.prix_unitaire) as prix_median,
       case when min(a.prix_unitaire) > 0 then max(a.prix_unitaire) / min(a.prix_unitaire) - 1 end as ecart_max
  from articles_fournisseur a join fournisseurs f on f.id = a.fournisseur_id
 where a.actif and f.actif
 group by lower(a.reference);

-- La grille de prix (plafond d'alerte des lignes de besoin) peut être alimentée par le catalogue : prix médian.
create or replace function alimenter_grille_prix() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth_role() is distinct from 'DML' then raise exception 'Réservé à la DML'; end if;
  insert into grille_prix(reference, prix_plafond)
  select reference, round(prix_median) from v_prix_reference
  on conflict (reference) do update set prix_plafond = excluded.prix_plafond;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Import en bloc (atomique) ----------
-- p_fournisseurs : [{raison_sociale, niu, rccm, regime_fiscal, assujetti_tva, centre_impots, adresse, ville,
--                    telephone, email, contact_nom, banque, numero_compte, national, remarque}]
-- p_articles     : [{fournisseur, reference, designation, unite, prix_unitaire, date_prix, source, remarque}]
-- Un fournisseur existant (même NIU, sinon même raison sociale) est complété sans effacer ses informations.
create or replace function importer_catalogue(p_fournisseurs jsonb, p_articles jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f record; a record; v_id bigint; v_niu text; v_ex fournisseurs%rowtype; v_art articles_fournisseur%rowtype;
  n_fc int := 0; n_fm int := 0; n_ac int := 0; n_am int := 0; n_prix int := 0;
begin
  if auth_role() is distinct from 'DML' then raise exception 'Import réservé à la DML'; end if;

  for f in select * from jsonb_to_recordset(coalesce(p_fournisseurs, '[]'::jsonb)) as x(
      raison_sociale text, niu text, rccm text, regime_fiscal text, assujetti_tva boolean, centre_impots text,
      adresse text, ville text, telephone text, email text, contact_nom text, banque text, numero_compte text,
      national boolean, remarque text) loop
    if coalesce(trim(f.raison_sociale), '') = '' then raise exception 'Fournisseur sans raison sociale'; end if;
    v_niu := nullif(upper(regexp_replace(coalesce(f.niu, ''), '\s', '', 'g')), '');

    select * into v_ex from fournisseurs
     where (v_niu is not null and niu = v_niu) or upper(raison_sociale) = upper(regexp_replace(trim(f.raison_sociale), '\s+', ' ', 'g'))
     order by (niu = v_niu) desc nulls last limit 1;

    if found then
      update fournisseurs set
        niu = coalesce(v_niu, niu), rccm = coalesce(nullif(f.rccm, ''), rccm),
        regime_fiscal = coalesce(nullif(f.regime_fiscal, ''), regime_fiscal),
        assujetti_tva = coalesce(f.assujetti_tva, assujetti_tva),
        centre_impots = coalesce(nullif(f.centre_impots, ''), centre_impots),
        adresse = coalesce(nullif(f.adresse, ''), adresse), ville = coalesce(nullif(f.ville, ''), ville),
        telephone = coalesce(nullif(f.telephone, ''), telephone), email = coalesce(nullif(f.email, ''), email),
        contact_nom = coalesce(nullif(f.contact_nom, ''), contact_nom), banque = coalesce(nullif(f.banque, ''), banque),
        numero_compte = coalesce(nullif(f.numero_compte, ''), numero_compte),
        national = coalesce(f.national, national), remarque = coalesce(nullif(f.remarque, ''), remarque)
       where id = v_ex.id;
      n_fm := n_fm + 1;
    else
      insert into fournisseurs(raison_sociale, niu, rccm, regime_fiscal, assujetti_tva, centre_impots, adresse, ville,
                               telephone, email, contact_nom, banque, numero_compte, national, remarque)
      values (f.raison_sociale, v_niu, nullif(f.rccm, ''), nullif(f.regime_fiscal, ''), f.assujetti_tva, nullif(f.centre_impots, ''),
              nullif(f.adresse, ''), nullif(f.ville, ''), nullif(f.telephone, ''), nullif(f.email, ''),
              nullif(f.contact_nom, ''), nullif(f.banque, ''), nullif(f.numero_compte, ''), coalesce(f.national, true),
              nullif(f.remarque, ''));
      n_fc := n_fc + 1;
    end if;
  end loop;

  for a in select * from jsonb_to_recordset(coalesce(p_articles, '[]'::jsonb)) as x(
      fournisseur text, reference text, designation text, unite text, prix_unitaire numeric,
      date_prix date, source text, remarque text) loop
    select id into v_id from fournisseurs where upper(raison_sociale) = upper(regexp_replace(trim(a.fournisseur), '\s+', ' ', 'g'));
    if v_id is null then raise exception 'Article « % » : fournisseur « % » inconnu', a.reference, a.fournisseur; end if;
    if coalesce(trim(a.reference), '') = '' or coalesce(trim(a.designation), '') = '' then
      raise exception 'Article du fournisseur « % » sans référence ou sans désignation', a.fournisseur;
    end if;

    select * into v_art from articles_fournisseur
     where fournisseur_id = v_id and lower(reference) = lower(regexp_replace(trim(a.reference), '\s+', ' ', 'g'));
    if found then
      if v_art.prix_unitaire is distinct from a.prix_unitaire then n_prix := n_prix + 1; end if;
      update articles_fournisseur set designation = a.designation, unite = coalesce(nullif(a.unite, ''), unite),
             prix_unitaire = a.prix_unitaire, date_prix = coalesce(a.date_prix, current_date),
             source = coalesce(nullif(a.source, ''), source), remarque = coalesce(nullif(a.remarque, ''), remarque), actif = true
       where id = v_art.id;
      n_am := n_am + 1;
    else
      insert into articles_fournisseur(fournisseur_id, reference, designation, unite, prix_unitaire, date_prix, source, remarque)
      values (v_id, a.reference, a.designation, coalesce(nullif(a.unite, ''), 'U'), a.prix_unitaire,
              coalesce(a.date_prix, current_date), coalesce(nullif(a.source, ''), 'CATALOGUE'), nullif(a.remarque, ''));
      n_ac := n_ac + 1;
    end if;
  end loop;

  insert into historique(entite, entite_id, nouveau, motif, acteur)
  values ('CATALOGUE', 'import', 'IMPORTE', n_fc || ' fournisseurs créés, ' || n_ac || ' articles créés', auth.uid());

  return jsonb_build_object('fournisseurs_crees', n_fc, 'fournisseurs_completes', n_fm,
                            'articles_crees', n_ac, 'articles_mis_a_jour', n_am, 'prix_modifies', n_prix);
end $$;

-- ---------- Droits ----------
alter table articles_fournisseur enable row level security;
alter table articles_prix_historique enable row level security;

-- lecture pour tous les utilisateurs connectés (les agences voient les prix de référence) ; écriture DML
create policy lecture on articles_fournisseur for select to authenticated using (true);
create policy ecriture on articles_fournisseur for all to authenticated
  using (auth_role() in ('DML','ADMIN')) with check (auth_role() in ('DML','ADMIN'));
create policy lecture on articles_prix_historique for select to authenticated using (true);

grant select, insert, update on articles_fournisseur to authenticated;
grant select on articles_prix_historique to authenticated;
grant select on v_prix_reference to authenticated;
revoke all on articles_fournisseur, articles_prix_historique, v_prix_reference from anon;

grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema public from anon, public;
