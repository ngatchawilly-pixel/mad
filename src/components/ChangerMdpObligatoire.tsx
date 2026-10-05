import { useAuth } from '../auth'
import FormulaireMdp from './FormulaireMdp'
import { useToast } from './ui'

// Écran plein page affiché tant que le mot de passe temporaire n'a pas été remplacé.
export default function ChangerMdpObligatoire() {
  const { session, profile, refresh, signOut } = useAuth()
  const toast = useToast()
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Choisissez votre mot de passe</h1>
          <p className="text-sm text-slate-600 mt-1">
            Bonjour {profile?.nom}. Votre mot de passe a été réinitialisé : celui que vous venez de saisir est <strong>temporaire</strong>.
            Choisissez-en un nouveau, que vous seul connaîtrez, pour accéder à l'application.
          </p>
        </div>
        <FormulaireMdp email={session!.user.email ?? ''} avecActuel={false}
          onDone={async () => { toast('ok', 'Mot de passe modifié'); await refresh() }} />
        <button onClick={signOut} className="text-sm text-slate-500 underline">Se déconnecter</button>
      </div>
    </div>
  )
}
