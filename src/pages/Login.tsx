import { useState, type FormEvent } from 'react'
import { supabase, erreur } from '../lib/supabase'
import { Button, Field, inputCls } from '../components/ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr(error.message === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect.' : erreur(error))
    setBusy(false)
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 sm:p-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">MAD HYSACAM</h1>
          <p className="text-sm text-slate-500">Suivi des mises à disposition de fonds</p>
        </div>
        <Field label="Adresse e-mail">
          <input className={inputCls} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field label="Mot de passe">
          <input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
        {err && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Connexion…' : 'Se connecter'}</Button>
      </form>
    </div>
  )
}
