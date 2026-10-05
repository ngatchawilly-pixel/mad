import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth'
import { CycleProvider } from './lib/data'
import { ToastProvider } from './components/ui'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Besoins from './pages/Besoins'
import Arbitrage from './pages/Arbitrage'
import Decisions from './pages/Decisions'
import Mad from './pages/Mad'
import Depenses from './pages/Depenses'
import Reaffectations from './pages/Reaffectations'
import Comptes from './pages/Comptes'
import Cloture from './pages/Cloture'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } })

function Gate() {
  const { session, profile, loading, signOut } = useAuth()
  if (loading) return <p className="p-8 text-slate-500">Chargement…</p>
  if (!session) return <Login />
  if (!profile) return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="max-w-md bg-white rounded-xl border p-6 space-y-3">
        <h1 className="font-semibold">Compte non activé</h1>
        <p className="text-sm text-slate-600">Votre connexion fonctionne mais aucun rôle ne vous est attribué. Demandez à l'administrateur de créer votre profil.</p>
        <button className="text-sm text-brand-700 underline" onClick={signOut}>Se déconnecter</button>
      </div>
    </div>
  )
  return (
    <CycleProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="besoins" element={<Besoins />} />
          <Route path="arbitrage" element={<Arbitrage />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="mad" element={<Mad />} />
          <Route path="depenses" element={<Depenses />} />
          <Route path="comptes" element={<Comptes />} />
          <Route path="cloture" element={<Cloture />} />
          <Route path="reaffectations" element={<Reaffectations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CycleProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter><Gate /></BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
