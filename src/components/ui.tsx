import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { erreur } from '../lib/supabase'

// ---------- Notifications ----------
type Toast = { id: number; type: 'ok' | 'err'; text: string }
const ToastCtx = createContext<(type: 'ok' | 'err', text: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((type: 'ok' | 'err', text: string) => {
    const id = Date.now() + Math.random()
    setItems(t => [...t, { id, type, text }])
    setTimeout(() => setItems(t => t.filter(x => x.id !== id)), type === 'err' ? 8000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-50 space-y-2" role="status">
        {items.map(t => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-sm shadow-lg border ${
            t.type === 'ok' ? 'bg-brand-50 border-brand-100 text-brand-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// Exécute une action, affiche le message de succès ou l'erreur de la base.
export function useAction() {
  const toast = useToast()
  return async (fn: () => PromiseLike<{ error: unknown }>, ok: string, after?: () => void) => {
    const { error } = await fn()
    if (error) toast('err', erreur(error))
    else { toast('ok', ok); after?.() }
    return !error
  }
}

// ---------- Éléments de base ----------
export function Button({ variant = 'primary', className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100'
  }[variant]
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium
    transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${v} ${className}`} />
}

export function Card({ title, actions, children, className = '' }:
  { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

const TONES: Record<string, string> = {
  gris: 'bg-slate-100 text-slate-700', vert: 'bg-brand-100 text-brand-900',
  orange: 'bg-amber-100 text-amber-800', rouge: 'bg-red-100 text-red-800', bleu: 'bg-sky-100 text-sky-800'
}
export function Badge({ tone = 'gris', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>{children}</span>
}

export const statutTone = (s: string) =>
  ({ BROUILLON: 'gris', EXPRIMEE: 'bleu', REEXPRIMEE: 'bleu', VALIDEE: 'vert', MAD_ETABLIE: 'vert',
     EN_TRAITEMENT: 'orange', CLOTUREE: 'vert', NON_VALIDEE: 'rouge', ABANDONNEE: 'rouge' } as Record<string, keyof typeof TONES>)[s] ?? 'gris'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block mb-1 font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-xs text-slate-500">{hint}</span>}
    </label>
  )
}
export const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl">
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Fermer" className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500 text-center py-8">{children}</p>
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 num">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            {head.map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}
