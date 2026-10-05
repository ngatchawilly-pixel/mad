-- MAD HYSACAM : schéma de base (phase 1)
-- Grain unique : la ligne de besoin (id_besoin). Aucune suppression physique.

create type role_t as enum ('CHEF','RM','DML','CG','DG','TRES','ADMIN');
create type statut_ligne_t as enum (
  'BROUILLON','EXPRIMEE','VALIDEE','NON_VALIDEE','REEXPRIMEE',
  'MAD_ETABLIE','EN_TRAITEMENT','CLOTUREE','ABANDONNEE');
create type mode_t as enum ('MDD','MDI');
create type priorite_t as enum ('P1','P2','P3');

-- ---------- Référentiels ----------
create table agences (
  code text primary key,
  nom text not null,
  grande boolean not null default false,
  pilote boolean not null default false
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nom text not null,
  role role_t not null,
  agence_code text references agences(code),
  actif boolean not null default true,
  check (role not in ('CHEF','RM') or agence_code is not null)
);

create table parametres (
  cle text primary key,
  valeur numeric not null,
  libelle text not null
);

create table cycles (
  id text primary key check (id ~ '^[0-9]{4}$'),         -- AAMM, ex. 2610
  statut text not null default 'OUVERT' check (statut in ('OUVERT','CLOTURE')),
  ouvert_le timestamptz not null default now(),
  cloture_le timestamptz
);

create table parc (
  code text primary key,                                   -- code parc (AFFECTATION)
  agence_code text not null references agences(code),
  famille text,
  chassis text,
  etat text not null default 'Disponible'
    check (etat in ('Immobilisé','Disponible à risque','Disponible','Sans objet')),
  remise_en_service_le date
);
create index on parc(agence_code);
create index on parc(chassis);

create table fournisseurs (
  id bigint generated always as identity primary key,
  raison_sociale text not null unique,
  niu text
);

create table grille_prix (
  reference text primary key,
  prix_plafond numeric not null check (prix_plafond >= 0)
);

-- ---------- Besoins ----------
create table id_sequences (
  agence_code text not null,
  cycle_id text not null,
  n int not null default 0,
  primary key (agence_code, cycle_id)
);

create table besoins (
  id uuid primary key default gen_random_uuid(),
  agence_code text not null references agences(code),
  cycle_id text not null references cycles(id),
  auteur uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table lignes_besoin (
  id_besoin text primary key,                              -- AGENCE-AAMM-NNNN
  besoin_id uuid not null references besoins(id),
  agence_code text not null references agences(code),
  cycle_id text not null references cycles(id),
  rang int not null default 1,                             -- rang d'expression
  code_parc text references parc(code),
  etat_vehicule text check (etat_vehicule in ('Immobilisé','Disponible à risque','Disponible','Sans objet')),
  type_intervention text,
  nature text,
  ot_panne text,
  reference text,
  designation text not null,
  quantite numeric not null check (quantite > 0),
  prix_unitaire numeric not null check (prix_unitaire >= 0),
  montant numeric generated always as (quantite * prix_unitaire) stored,
  fournisseur_id bigint references fournisseurs(id),
  ref_devis text,
  priorite priorite_t,
  securite_legale boolean not null default false,
  justification text,
  ecart_prix numeric,                                      -- prix payé / grille - 1
  justification_prix text,
  statut statut_ligne_t not null default 'BROUILLON',
  motif_code text,                                         -- motif non-validation / abandon
  score int,
  score_ecart_motif text,                                  -- motif d'écart au score
  bonus_report int not null default 0,
  mode mode_t,
  montant_retenu numeric check (montant_retenu >= 0),
  taux_avance numeric not null default 0.8 check (taux_avance between 0 and 1),
  decision_numero text,
  mad_numero text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on lignes_besoin(agence_code, cycle_id);
create index on lignes_besoin(statut);
create index on lignes_besoin(code_parc);

-- ---------- Décision figée ----------
create table decisions (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,                             -- DEC-DML-2610-V1
  cycle_id text not null references cycles(id),
  version int not null default 1,
  contenu jsonb not null,                                  -- une ligne par agence et fournisseur
  sig_dml timestamptz, sig_dml_par uuid,
  sig_cg timestamptz,  sig_cg_par uuid,
  sig_dg timestamptz,  sig_dg_par uuid,
  verrouillee boolean not null default false,
  motif_version text,
  created_at timestamptz not null default now(),
  unique (cycle_id, version)
);

-- ---------- MAD ----------
create table mad (
  numero text primary key,                                 -- MAD-DML-2610-BAF
  cycle_id text not null references cycles(id),
  agence_code text not null references agences(code),
  mode mode_t not null,
  montant_lignes numeric not null,
  provision numeric not null default 0,
  montant numeric generated always as (montant_lignes + provision) stored,
  decision_numero text not null references decisions(numero),
  date_limite date,
  virement_le timestamptz,
  virement_par uuid,
  accuse_le timestamptz,
  accuse_par uuid,
  created_at timestamptz not null default now(),
  unique (cycle_id, agence_code, mode)
);

-- ---------- Dépenses et pièces ----------
create table depenses (
  id uuid primary key default gen_random_uuid(),
  id_besoin text references lignes_besoin(id_besoin),      -- null = sur provision (voir règle)
  agence_code text not null references agences(code),
  mad_numero text not null references mad(numero),
  montant numeric not null check (montant > 0),
  fournisseur_id bigint references fournisseurs(id),
  nature_depense text,
  date_depense date not null default current_date,
  sur_provision boolean not null default false,
  commentaire text,
  saisi_par uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (sur_provision or id_besoin is not null)
);
create index on depenses(mad_numero);
create index on depenses(id_besoin);

create table pieces (
  id uuid primary key default gen_random_uuid(),
  depense_id uuid not null references depenses(id),
  type text not null,                                      -- facture, reception, sortie, ot, devis...
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- ---------- Réaffectations ----------
create table reaffectations (
  id_reaf text primary key,                                -- REAF-AGENCE-AAMM-NNN
  agence_code text not null references agences(code),
  cycle_id text not null references cycles(id),
  ligne_origine text not null references lignes_besoin(id_besoin),
  nouvelle_affectation text not null,
  code_parc text references parc(code),
  motif text not null,
  panne_ot text not null,
  montant numeric not null check (montant > 0),
  sort_besoin_origine text not null check (sort_besoin_origine in ('REPORTE','ANNULE','REFINANCE')),
  sur_provision boolean not null default false,
  statut text not null default 'SOUMISE' check (statut in ('SOUMISE','VALIDEE','VALIDEE_TACITE','REFUSEE')),
  soumis_le timestamptz not null default now(),
  soumis_par uuid default auth.uid(),
  repondu_le timestamptz,
  repondu_par uuid,
  validee_dg boolean not null default false
);

-- ---------- Compte d'emploi ----------
create table comptes_emploi (
  id uuid primary key default gen_random_uuid(),
  mad_numero text not null unique references mad(numero),
  agence_code text not null references agences(code),
  depose_le timestamptz,
  solde_bancaire numeric,
  statut text not null default 'A_DEPOSER'
    check (statut in ('A_DEPOSER','DEPOSE','CONTROLE','A_REGULARISER')),
  controle_par uuid
);

create table classements (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes_emploi(id),
  depense_id uuid not null references depenses(id),
  categorie text not null check (categorie in ('CONFORME','REAFFECTATION_JUSTIFIEE','NON_CONFORME')),
  id_reaf text references reaffectations(id_reaf),
  motif text,
  propose_auto boolean not null default true,
  confirme_par uuid,
  confirme_le timestamptz,
  unique (depense_id)
);

-- ---------- Historique (ajout seul) ----------
create table historique (
  id bigint generated always as identity primary key,
  entite text not null,
  entite_id text not null,
  agence_code text,
  ancien text,
  nouveau text,
  motif text,
  acteur uuid,
  at timestamptz not null default now()
);
create index on historique(entite, entite_id);
create index on historique(agence_code);

-- ---------- Accès par d'autres systèmes (phase 4) ----------
create table api_clients (
  id uuid primary key default gen_random_uuid(),
  systeme text not null unique,                            -- ex. GMAO_HYSAGESTION
  cle_hash text not null,                                  -- sha256 de la clé, jamais la clé
  scopes text[] not null default '{}',
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

create table api_journal (
  id bigint generated always as identity primary key,
  client_id uuid references api_clients(id),
  methode text, chemin text, statut_http int,
  at timestamptz not null default now()
);
