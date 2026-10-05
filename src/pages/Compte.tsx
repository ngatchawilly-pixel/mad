import { useAuth } from '../auth'
import { ROLE_LABEL } from '../lib/supabase'
import FormulaireMdp from '../components/FormulaireMdp'
import { Card, useToast } from '../components/ui'

export default function Compte() {
  const { session, profile, refresh } = useAuth()
  const toast = useToast()
  if (!profile || !session) return null
  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-xl font-semibold text-slate-900">Mon compte</h1>

      <Card title="Identité">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs text-slate-500">Nom</dt><dd>{profile.nom}</dd></div>
          <div><dt className="text-xs text-slate-500">Rôle</dt><dd>{ROLE_LABEL[profile.role]}</dd></div>
          <div><dt className="text-xs text-slate-500">Agence</dt><dd>{profile.agence_code ?? '–'}</dd></div>
          <div><dt className="text-xs text-slate-500">Identifiant de connexion</dt><dd className="break-all">{session.user.email}</dd></div>
        </dl>
      </Card>

      <Card title="Changer mon mot de passe">
        <FormulaireMdp email={session.user.email ?? ''} avecActuel onDone={async () => { toast('ok', 'Mot de passe modifié'); await refresh() }} />
        <p className="mt-4 text-xs text-slate-500">
          Mot de passe oublié ? Demandez une réinitialisation à la direction (DML ou DG) : un mot de passe temporaire vous sera remis,
          que vous devrez remplacer dès la première connexion.
        </p>
      </Card>
    </div>
  )
}
