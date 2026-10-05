import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Role, type Row } from './lib/supabase'

type Profile = { id: string; nom: string; role: Role; agence_code: string | null; doit_changer_mdp: boolean }
type Ctx = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function charger(s: Session | null) {
    setSession(s)
    if (!s) { setProfile(null); setLoading(false); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile((data as Row | null) as Profile | null)
    setLoading(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => charger(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { charger(s) })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <AuthCtx.Provider value={{
      session, profile, loading,
      signOut: async () => { await supabase.auth.signOut() },
      refresh: async () => charger((await supabase.auth.getSession()).data.session)
    }}>
      {children}
    </AuthCtx.Provider>
  )
}
