import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, Scale, FileSignature, Banknote, Receipt, ArrowLeftRight, ShieldCheck, Lock, Truck, LogOut, Menu, X } from 'lucide-react'
import { useAuth } from '../auth'
import { useCycle, useRealtime } from '../lib/data'
import { ROLE_LABEL, type Role } from '../lib/supabase'

const NAV: { to: string; label: string; icon: typeof Menu; roles: Role[] }[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, roles: ['CHEF', 'RM', 'DML', 'CG', 'DG', 'TRES', 'ADMIN'] },
  { to: '/besoins', label: 'Besoins', icon: ClipboardList, roles: ['CHEF', 'RM', 'DML', 'CG', 'DG', 'ADMIN'] },
  { to: '/arbitrage', label: 'Arbitrage', icon: Scale, roles: ['DML', 'ADMIN'] },
  { to: '/decisions', label: 'Décisions', icon: FileSignature, roles: ['DML', 'CG', 'DG', 'ADMIN'] },
  { to: '/mad', label: 'MAD', icon: Banknote, roles: ['CHEF', 'RM', 'DML', 'CG', 'DG', 'TRES', 'ADMIN'] },
  { to: '/depenses', label: 'Dépenses', icon: Receipt, roles: ['CHEF', 'RM', 'CG', 'DML', 'ADMIN'] },
  { to: '/comptes', label: "Comptes d'emploi", icon: ShieldCheck, roles: ['CHEF', 'RM', 'DML', 'CG', 'DG', 'ADMIN'] },
  { to: '/cloture', label: 'Clôture', icon: Lock, roles: ['DML', 'CG', 'DG', 'ADMIN'] },
  { to: '/fournisseurs', label: 'Fournisseurs', icon: Truck, roles: ['CHEF', 'RM', 'DML', 'CG', 'DG', 'TRES', 'ADMIN'] },
  { to: '/reaffectations', label: 'Réaffectations', icon: ArrowLeftRight, roles: ['CHEF', 'RM', 'DML', 'DG', 'ADMIN'] }
]

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { cycle, setCycle, cycles } = useCycle()
  const [open, setOpen] = useState(false)
  useRealtime()
  if (!profile) return null
  const items = NAV.filter(n => n.roles.includes(profile.role))

  const menu = (
    <nav className="flex-1 px-3 space-y-1" aria-label="Navigation principale">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
            isActive ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10'}`}>
          <Icon size={18} /> {label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Menu latéral (grand écran) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-brand-900 py-5 sticky top-0 h-screen">
        <Brand />
        {menu}
        <Profil />
      </aside>

      {/* Menu mobile */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/50" onClick={() => setOpen(false)}>
          <aside className="w-72 h-full flex flex-col bg-brand-900 py-5" onClick={e => e.stopPropagation()}>
            <Brand />
            {menu}
            <Profil />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center gap-3">
          <button className="lg:hidden p-2 -ml-2 rounded hover:bg-slate-100" onClick={() => setOpen(o => !o)} aria-label="Menu">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Cycle
            <select value={cycle} onChange={e => setCycle(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
              {cycles.map(c => <option key={c.id} value={c.id}>{c.id}{c.statut === 'CLOTURE' ? ' (clôturé)' : ''}</option>)}
            </select>
          </label>
        </header>
        <main className="p-4 sm:p-6 max-w-7xl mx-auto"><Outlet /></main>
      </div>
    </div>
  )

  function Brand() {
    return (
      <div className="px-5 pb-6">
        <p className="text-white font-bold text-lg leading-tight">MAD HYSACAM</p>
        <p className="text-brand-100 text-xs">Suivi des mises à disposition</p>
      </div>
    )
  }
  function Profil() {
    return (
      <div className="px-4 pt-4 mt-4 border-t border-white/10">
        <p className="text-white text-sm font-medium truncate">{profile!.nom}</p>
        <p className="text-brand-100 text-xs mb-3">{ROLE_LABEL[profile!.role]}{profile!.agence_code ? ` · ${profile!.agence_code}` : ''}</p>
        <button onClick={signOut} className="flex items-center gap-2 text-sm text-brand-100 hover:text-white">
          <LogOut size={16} /> Se déconnecter
        </button>
      </div>
    )
  }
}
