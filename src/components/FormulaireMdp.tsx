import { useState, type FormEvent } from 'react'
import { supabase, erreur } from '../lib/supabase'
import { controleMdp } from '../lib/motdepasse'
import { Button, Field, inputCls } from './ui'

// Changement de mot de passe de l'utilisateur connecté.
// - avecActuel : redemande le mot de passe actuel (page « Mon compte »)
// - sinon (changement obligatoire) : l'utilisateur vient de s'authentifier avec le mot de passe temporaire
export default function FormulaireMdp({ email, avecActuel, onDone }:
  { email: string; avecActuel: boolean; onDone: () => void | Promise<void> }) {
  const [actuel, setActuel] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirme, setConfirme] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const manques = nouveau ? controleMdp(nouveau) : []
  const identique = confirme !== '' && confirme === nouveau

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    setErr('')
    if (controleMdp(nouveau).length) return setErr(`Le mot de passe doit contenir ${controleMdp(nouveau).join(', ')}.`)
    if (nouveau !== confirme) return setErr('Les deux mots de passe ne correspondent pas.')
    if (avecActuel && nouveau === actuel) return setErr('Le nouveau mot de passe doit être différent de l\'actuel.')
    setBusy(true)
    try {
      if (avecActuel) {
        const { error } = await supabase.auth.signInWithPassword({ email, password: actuel })
        if (error) return setErr('Mot de passe actuel incorrect.')
      }
      const { error } = await supabase.auth.updateUser({ password: nouveau })
      if (error) return setErr(/same|different/i.test(error.message) ? 'Le nouveau mot de passe doit être différent de l\'actuel.' : erreur(error))
      // lève l'obligation de changement (sans effet si elle n'était pas demandée)
      const r = await supabase.rpc('mot_de_passe_change')
      if (r.error && !/n'a pas encore été modifié/.test(r.error.message)) return setErr(erreur(r.error))
      setActuel(''); setNouveau(''); setConfirme('')
      await onDone()
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={envoyer} className="space-y-4">
      {avecActuel && (
        <Field label="Mot de passe actuel">
          <input className={inputCls} type="password" autoComplete="current-password" required value={actuel} onChange={e => setActuel(e.target.value)} />
        </Field>
      )}
      <Field label="Nouveau mot de passe" hint={manques.length ? `Il manque : ${manques.join(', ')}.` : 'Au moins 10 caractères, avec minuscule, majuscule et chiffre.'}>
        <input className={inputCls} type="password" autoComplete="new-password" required value={nouveau} onChange={e => setNouveau(e.target.value)} />
      </Field>
      <Field label="Confirmer le nouveau mot de passe" hint={confirme && !identique ? 'Les deux mots de passe ne correspondent pas.' : undefined}>
        <input className={inputCls} type="password" autoComplete="new-password" required value={confirme} onChange={e => setConfirme(e.target.value)} />
      </Field>
      {err && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      <Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy ? 'Enregistrement…' : 'Changer le mot de passe'}</Button>
    </form>
  )
}
