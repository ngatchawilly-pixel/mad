import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Row } from './supabase'

// Lecture d'une requête Supabase ; l'invalidation par préfixe de clé rafraîchit les écrans concernés.
export function useRows<T = Row>(key: unknown[], fn: () => PromiseLike<{ data: unknown; error: unknown }>, enabled = true) {
  return useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const { data, error } = await fn()
      if (error) throw error
      return (data ?? []) as T[]
    }
  })
}

export function useRefresh() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}

// Mises à jour en temps réel : toute modification en base rafraîchit les écrans.
export function useRealtime() {
  const qc = useQueryClient()
  useEffect(() => {
    const ch = supabase.channel('mad-live')
    for (const table of ['lignes_besoin', 'decisions', 'mad', 'depenses', 'reaffectations'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => qc.invalidateQueries())
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])
}

// ---------- Cycle sélectionné ----------
type CycleCtx = { cycle: string; setCycle: (c: string) => void; cycles: Row[] }
const Ctx = createContext<CycleCtx>({ cycle: '', setCycle: () => {}, cycles: [] })
export const useCycle = () => useContext(Ctx)

export function CycleProvider({ children }: { children: ReactNode }) {
  const { data: cycles = [] } = useRows(['cycles'], () => supabase.from('cycles').select('*').order('id', { ascending: false }))
  const [cycle, setCycle] = useState('')
  useEffect(() => {
    if (!cycle && cycles.length) setCycle(cycles[0].id)
  }, [cycles, cycle])
  return <Ctx.Provider value={{ cycle, setCycle, cycles }}>{children}</Ctx.Provider>
}
