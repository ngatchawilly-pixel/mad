import { useState } from 'react'
import { Copy, KeyRound, Search } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, erreur, ROLE_LABEL, type Row } from '../lib/supabase'
import { useRefresh, useRows } from '../lib/data'
import { date } from '../lib/format'
import { Badge, Button, Card, Empty, Modal, Table, inputCls, useToast } from '../components/ui'

export default function Utilisateurs() {
  const { profile } = useAuth()
  const refresh = useRefresh()
  const toast = useToast()
  const [recherche, setRecherche] = useState('')
  const [cible, setCible] = useState<Row | null>(null)
  const [resultat, setResultat] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)

  const autorise = ['DML', 'DG', 'ADMIN'].includes(profile!.role)
  const comptes = useRows(['comptes-utilisateurs'], async () => await supabase.rpc('liste_comptes'), autorise)
  const q = recherche.trim().toLowerCase()
  const visibles = (comptes.data ?? []).filter(c => !q || [c.nom, c.email, c.agence_code, ROLE_LABEL[c.role as keyof typeof ROLE_LABEL]].some(x => String(x ?? '').toLowerCase().includes(q)))

  async function reinitialiser() {
    if (!cible) return
    setBusy(true)
    const { data, error } = await supabase.rpc('reinitialiser_mot_de_passe', { p_user: cible.id })
    setBusy(false)
    if (error) { toast('err', erreur(error)); return }
    setCible(null); setResultat(data as Row); refresh()
  }

  if (!autorise) return <Card><Empty>Cette page est réservée à la direction (DML, DG) et à l'administrateur.</Empty></Card>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Utilisateurs</h1>
        <p className="text-sm text-slate-500">
          {profile!.role === 'ADMIN' ? 'Tous les comptes.' : 'Comptes des agences.'} Réinitialisez un mot de passe oublié : un mot de passe temporaire est généré,
          à remettre à l'utilisateur, qui devra le remplacer à sa première connexion.
        </p>
      </div>

      <Card>
        <div className="relative mb-3 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={inputCls + ' pl-9'} placeholder="Rechercher (nom, e-mail, agence…)" value={recherche}
            onChange={e => setRecherche(e.target.value)} aria-label="Rechercher un utilisateur" />
        </div>
        {comptes.error ? <p role="alert" className="text-sm text-red-700">{erreur(comptes.error)}</p>
          : visibles.length === 0 ? <Empty>Aucun compte.</Empty> : (
          <Table head={['Nom', 'Rôle', 'Agence', 'Identifiant', 'Dernière connexion', 'État', '']}>
            {visibles.map(c => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-medium text-slate-900">{c.nom}</td>
                <td className="px-3 py-2">{ROLE_LABEL[c.role as keyof typeof ROLE_LABEL]}</td>
                <td className="px-3 py-2">{c.agence_code ?? '–'}</td>
                <td className="px-3 py-2 text-slate-600 break-all">{c.email}</td>
                <td className="px-3 py-2">{c.derniere_connexion ? date(c.derniere_connexion) : <span className="text-slate-400">jamais</span>}</td>
                <td className="px-3 py-2">
                  {!c.actif ? <Badge tone="gris">Désactivé</Badge> : c.doit_changer_mdp ? <Badge tone="orange">Doit changer son mot de passe</Badge> : <Badge tone="vert">Actif</Badge>}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.actif && c.id !== profile!.id && (
                    <Button variant="secondary" onClick={() => setCible(c)}><KeyRound size={14} /> Réinitialiser</Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {cible && (
        <Modal title="Réinitialiser le mot de passe" onClose={() => setCible(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Vous allez réinitialiser le mot de passe de <strong>{cible.nom}</strong> ({cible.email}).
            </p>
            <ul className="list-disc ml-5 text-sm text-slate-600 space-y-1">
              <li>Un mot de passe temporaire est généré et <strong>affiché une seule fois</strong>.</li>
              <li>Ses sessions ouvertes sont fermées ; l'ancien mot de passe ne fonctionne plus.</li>
              <li>Il devra choisir son propre mot de passe à la première connexion.</li>
              <li>Cette opération est <strong>enregistrée à votre nom</strong> dans l'historique.</li>
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCible(null)}>Annuler</Button>
              <Button variant="danger" onClick={reinitialiser} disabled={busy}>{busy ? 'Réinitialisation…' : 'Réinitialiser'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {resultat && <MotDePasseTemporaire r={resultat} onClose={() => setResultat(null)} />}
    </div>
  )
}

function MotDePasseTemporaire({ r, onClose }: { r: Row; onClose: () => void }) {
  const toast = useToast()
  const copier = async (texte: string) => {
    try { await navigator.clipboard.writeText(texte); toast('ok', 'Copié') } catch { toast('err', 'Copie impossible : sélectionnez le texte à la main') }
  }
  return (
    <Modal title="Mot de passe temporaire" onClose={onClose}>
      <div className="space-y-4">
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Ce mot de passe <strong>ne sera plus affiché</strong>. Transmettez-le à {r.nom} par un canal sûr, puis fermez cette fenêtre.
          Si vous le perdez, il suffira de réinitialiser à nouveau.
        </div>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Identifiant</dt>
            <dd className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 font-mono break-all">
              {r.email}<Button variant="ghost" aria-label="Copier l'identifiant" onClick={() => copier(r.email)}><Copy size={14} /></Button>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Mot de passe temporaire</dt>
            <dd className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 font-mono text-base break-all select-all">
              {r.mot_de_passe}<Button variant="ghost" aria-label="Copier le mot de passe" onClick={() => copier(r.mot_de_passe)}><Copy size={14} /></Button>
            </dd>
          </div>
        </dl>
        <div className="flex justify-end"><Button onClick={onClose}>J'ai transmis le mot de passe</Button></div>
      </div>
    </Modal>
  )
}
