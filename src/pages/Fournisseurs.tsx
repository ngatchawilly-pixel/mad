import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, FileSpreadsheet, Plus, Search } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, erreur, type Row } from '../lib/supabase'
import { useRefresh, useRows } from '../lib/data'
import { fcfa, pct } from '../lib/format'
import ImportCatalogue from '../components/ImportCatalogue'
import { Badge, Button, Card, Empty, Field, Modal, Table, inputCls, useToast, useAction } from '../components/ui'

export const REGIMES = ['Réel', 'Simplifié', 'Libératoire', 'Exonéré', 'Autre']

export default function Fournisseurs() {
  const { profile } = useAuth()
  const refresh = useRefresh()
  const navigate = useNavigate()
  const agir = useAction()
  const [onglet, setOnglet] = useState<'liste' | 'prix'>('liste')
  const [recherche, setRecherche] = useState('')
  const [nouveau, setNouveau] = useState(false)
  const [importer, setImporter] = useState(false)
  const estDML = profile!.role === 'DML'

  const fournisseurs = useRows(['fournisseurs-liste'], () => supabase.from('fournisseurs').select('*').order('raison_sociale'))
  const articles = useRows(['articles-compte'], () => supabase.from('articles_fournisseur').select('fournisseur_id, actif'))
  const prix = useRows(['prix-reference'], () => supabase.from('v_prix_reference').select('*').order('ecart_max', { ascending: false, nullsFirst: false }))

  const nbArticles = useMemo(() => {
    const m = new Map<number, number>()
    ;(articles.data ?? []).filter(a => a.actif).forEach(a => m.set(a.fournisseur_id, (m.get(a.fournisseur_id) ?? 0) + 1))
    return m
  }, [articles.data])

  const q = recherche.trim().toLowerCase()
  const visibles = (fournisseurs.data ?? []).filter(f =>
    !q || [f.raison_sociale, f.niu, f.ville, f.contact_nom].some(x => String(x ?? '').toLowerCase().includes(q)))
  const comparables = (prix.data ?? []).filter(p => p.nb_fournisseurs >= 2)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Fournisseurs et prix</h1>
          <p className="text-sm text-slate-500">Identité et informations fiscales, articles et prix de référence.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/modeles/Modele_fournisseurs_articles.xlsx" download
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download size={16} /> Modèle Excel
          </a>
          {estDML && <Button variant="secondary" onClick={() => setImporter(true)}><FileSpreadsheet size={16} /> Importer Excel</Button>}
          {estDML && <Button onClick={() => setNouveau(true)}><Plus size={16} /> Nouveau fournisseur</Button>}
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-slate-200">
        {([['liste', `Fournisseurs (${fournisseurs.data?.length ?? 0})`], ['prix', `Comparaison des prix (${comparables.length})`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={onglet === k} onClick={() => setOnglet(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${onglet === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>
        ))}
      </div>

      {onglet === 'liste' && (
        <Card>
          <div className="relative mb-3 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={inputCls + ' pl-9'} placeholder="Rechercher (nom, NIU, ville…)" value={recherche} onChange={e => setRecherche(e.target.value)} aria-label="Rechercher un fournisseur" />
          </div>
          {visibles.length === 0 ? <Empty>Aucun fournisseur.</Empty> : (
            <Table head={['Raison sociale', 'NIU', 'Régime', 'Ville', 'Contact', 'Articles', '']}>
              {visibles.map(f => (
                <tr key={f.id} onClick={() => navigate(`/fournisseurs/${f.id}`)} tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate(`/fournisseurs/${f.id}`)}
                  className="cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
                  <td className="px-3 py-2.5 font-medium text-slate-900">{f.raison_sociale}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{f.niu ?? <Badge tone="orange">NIU manquant</Badge>}</td>
                  <td className="px-3 py-2.5">{f.regime_fiscal ?? '–'}</td>
                  <td className="px-3 py-2.5">{f.ville ?? '–'}</td>
                  <td className="px-3 py-2.5 text-slate-600">{f.contact_nom ?? '–'}</td>
                  <td className="px-3 py-2.5 num">{nbArticles.get(f.id) ?? 0}</td>
                  <td className="px-3 py-2.5">{!f.actif && <Badge tone="gris">Inactif</Badge>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {onglet === 'prix' && (
        <Card>
          <p className="text-sm text-slate-600 mb-3">
            Références proposées par au moins deux fournisseurs. Un écart au-delà de 15 % mérite une explication (constat C3).
          </p>
          {estDML && comparables.length > 0 && (
            <div className="mb-3">
              <Button variant="secondary" onClick={() => {
                if (window.confirm('Remplacer le plafond de la grille de prix par le prix médian du catalogue pour chaque référence ?'))
                  agir(() => supabase.rpc('alimenter_grille_prix'), 'Grille de prix mise à jour', refresh)
              }}>Alimenter la grille de prix (prix médian)</Button>
            </div>
          )}
          {comparables.length === 0 ? <Empty>Aucune référence n'est proposée par plusieurs fournisseurs pour l'instant.</Empty> : (
            <Table head={['Référence', 'Désignation', 'Fournisseurs', 'Prix min', 'Médiane', 'Prix max', 'Écart']}>
              {comparables.map(p => (
                <tr key={p.cle}>
                  <td className="px-3 py-2 font-mono text-xs">{p.reference}</td>
                  <td className="px-3 py-2">{p.designation}</td>
                  <td className="px-3 py-2 num">{p.nb_fournisseurs}</td>
                  <td className="px-3 py-2 num whitespace-nowrap">{fcfa(p.prix_min)}</td>
                  <td className="px-3 py-2 num whitespace-nowrap">{fcfa(p.prix_median)}</td>
                  <td className="px-3 py-2 num whitespace-nowrap">{fcfa(p.prix_max)}</td>
                  <td className="px-3 py-2"><Badge tone={p.ecart_max > 0.15 ? 'orange' : 'vert'}>+{pct(p.ecart_max)}</Badge></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {nouveau && <FournisseurForm onClose={() => setNouveau(false)} onSaved={id => { setNouveau(false); refresh(); navigate(`/fournisseurs/${id}`) }} />}
      {importer && <ImportCatalogue onClose={() => setImporter(false)} onDone={() => { setImporter(false); refresh() }} />}
    </div>
  )
}

// Formulaire de création ou de modification d'une fiche fournisseur
export function FournisseurForm({ fournisseur, onClose, onSaved }:
  { fournisseur?: Row; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast()
  const [f, setF] = useState<Row>(fournisseur ?? { national: true, actif: true })
  const set = (k: string, v: unknown) => setF(s => ({ ...s, [k]: v }))
  const t = (k: string) => (f[k] ?? '') as string

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    const champs = ['raison_sociale', 'niu', 'rccm', 'regime_fiscal', 'assujetti_tva', 'centre_impots', 'adresse', 'ville', 'telephone',
      'email', 'contact_nom', 'banque', 'numero_compte', 'national', 'actif', 'remarque']
    const donnees: Row = {}
    champs.forEach(c => { const v = f[c]; donnees[c] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null })
    const req = fournisseur
      ? supabase.from('fournisseurs').update(donnees).eq('id', fournisseur.id).select('id').single()
      : supabase.from('fournisseurs').insert(donnees).select('id').single()
    const { data, error } = await req
    if (error) {
      const m = erreur(error)
      return toast('err', /fournisseurs_niu_uq/.test(m) ? 'Ce NIU appartient déjà à un autre fournisseur.'
        : /fournisseurs_nom_uq/.test(m) ? 'Un fournisseur porte déjà cette raison sociale.' : m)
    }
    toast('ok', fournisseur ? 'Fiche mise à jour' : 'Fournisseur créé')
    onSaved(data.id)
  }

  const niu = t('niu').replace(/\s/g, '').toUpperCase()
  return (
    <Modal title={fournisseur ? `Modifier ${fournisseur.raison_sociale}` : 'Nouveau fournisseur'} onClose={onClose}>
      <form onSubmit={enregistrer} className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Field label="Raison sociale *">
          <input required autoFocus className={inputCls} value={t('raison_sociale')} onChange={e => set('raison_sociale', e.target.value)} />
        </Field></div>

        <p className="sm:col-span-2 text-xs uppercase tracking-wide text-slate-500 border-b pb-1">Informations fiscales</p>
        <Field label="NIU" hint={niu && !/^[MP]\d{12}[A-Z]$/.test(niu) ? 'Format inhabituel : une lettre (M ou P), 12 chiffres, une lettre.' : 'Ex. M071612345678A. Unique par fournisseur.'}>
          <input className={inputCls + ' font-mono'} value={t('niu')} onChange={e => set('niu', e.target.value)} />
        </Field>
        <Field label="RCCM"><input className={inputCls} value={t('rccm')} onChange={e => set('rccm', e.target.value)} /></Field>
        <Field label="Régime fiscal">
          <select className={inputCls} value={t('regime_fiscal')} onChange={e => set('regime_fiscal', e.target.value)}>
            <option value="">—</option>{REGIMES.map(r => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Assujetti à la TVA">
          <select className={inputCls} value={f.assujetti_tva === true ? 'oui' : f.assujetti_tva === false ? 'non' : ''}
            onChange={e => set('assujetti_tva', e.target.value === '' ? null : e.target.value === 'oui')}>
            <option value="">—</option><option value="oui">Oui</option><option value="non">Non</option>
          </select>
        </Field>
        <Field label="Centre des impôts"><input className={inputCls} value={t('centre_impots')} onChange={e => set('centre_impots', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm self-end pb-2">
          <input type="checkbox" checked={f.national !== false} onChange={e => set('national', e.target.checked)} /> Prestataire national
        </label>

        <p className="sm:col-span-2 text-xs uppercase tracking-wide text-slate-500 border-b pb-1 mt-2">Coordonnées</p>
        <Field label="Adresse"><input className={inputCls} value={t('adresse')} onChange={e => set('adresse', e.target.value)} /></Field>
        <Field label="Ville"><input className={inputCls} value={t('ville')} onChange={e => set('ville', e.target.value)} /></Field>
        <Field label="Contact"><input className={inputCls} value={t('contact_nom')} onChange={e => set('contact_nom', e.target.value)} /></Field>
        <Field label="Téléphone"><input className={inputCls} inputMode="tel" value={t('telephone')} onChange={e => set('telephone', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="E-mail"><input type="email" className={inputCls} value={t('email')} onChange={e => set('email', e.target.value)} /></Field></div>

        <p className="sm:col-span-2 text-xs uppercase tracking-wide text-slate-500 border-b pb-1 mt-2">Paiement</p>
        <Field label="Banque"><input className={inputCls} value={t('banque')} onChange={e => set('banque', e.target.value)} /></Field>
        <Field label="Numéro de compte"><input className={inputCls} value={t('numero_compte')} onChange={e => set('numero_compte', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Remarque"><textarea rows={2} className={inputCls} value={t('remarque')} onChange={e => set('remarque', e.target.value)} /></Field></div>
        {fournisseur && (
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.actif !== false} onChange={e => set('actif', e.target.checked)} /> Fournisseur actif (décocher pour ne plus le proposer)
          </label>
        )}
        <div className="sm:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit">{fournisseur ? 'Enregistrer' : 'Créer'}</Button>
        </div>
      </form>
    </Modal>
  )
}
