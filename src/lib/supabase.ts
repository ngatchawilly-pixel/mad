import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export type Row = Record<string, any>
export type Role = 'CHEF' | 'RM' | 'DML' | 'CG' | 'DG' | 'TRES' | 'ADMIN'

export const ROLE_LABEL: Record<Role, string> = {
  CHEF: "Chef d'agence",
  RM: 'Responsable maintenance',
  DML: 'DML',
  CG: 'Contrôle de gestion',
  DG: 'Direction Générale',
  TRES: 'Trésorerie',
  ADMIN: 'Administrateur'
}

export const STATUT_LABEL: Record<string, string> = {
  BROUILLON: 'Brouillon',
  EXPRIMEE: 'Exprimée',
  VALIDEE: 'Validée',
  NON_VALIDEE: 'Non validée',
  REEXPRIMEE: 'Réexprimée',
  MAD_ETABLIE: 'MAD établie',
  EN_TRAITEMENT: 'En traitement',
  CLOTUREE: 'Clôturée',
  ABANDONNEE: 'Abandonnée'
}

export const MOTIFS_NON_VALIDATION = [
  ['BUDGET', 'Enveloppe insuffisante'],
  ['HORS_PRIORITE', 'Hors priorité'],
  ['DOSSIER_INCOMPLET', 'Dossier incomplet'],
  ['PRIX', 'Prix non justifié'],
  ['REPORTE', 'Reporté au cycle suivant'],
  ['SACRIFIE', 'Sacrifié par une réaffectation'],
  ['AUTRE', 'Autre']
]

// Les messages des règles de gestion viennent de la base, déjà en français.
export function erreur(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  return m.replace(/^.*?(ERROR:\s*)/, '')
}
