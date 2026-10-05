import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, History, Pencil, Plus } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, erreur, type Row } from '../lib/supabase'
import { date, fcfa, pct } from '../lib/format'
import { useRefresh, useRows } from '../lib/data'
import { Badge, Button, Card, Empty, Field, Modal, Table, inputCls, useToast } from '../components/ui'
import { FournisseurForm } from './Fournisseurs'

const UNITES = ['U', 'JEU', 'KIT', 'LOT', 'L', 'KG', 'M', 'M2', 'M3', 'H', 'JOUR', 'FORFAIT']
const SOURCES: [string, string][] = [['CATALOGUE', 'Catalogue'], ['DEVIS', 'Devis'], ['PRO_FORMA', 'Pro forma'], ['FACTURE', 'Facture']]

export default function FournisseurDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const refresh = useRefresh()
  const estDML = profile!.role === 'DML'
  const [modifier, setModifier] = useState(false)
  const [article, setArticle] = useState<Row | 'nouveau' | null>(null)
  const [historique, setHistorique] = useState<Row | null>(null)
  const [recherche, setRecherche] = useState('')

  const fiche = useRows(['fournisseur', id], () => supabase.from('fournisseurs').select('*').eq('id', id!), !!id)
  const articles = useRows(['articles', id], () =>
    supabase.from('articles_fournisseur').select('*').eq('fournisseur_id', id!).order('reference'), !!id)
  const prix = useRows(['prix-reference'], () => supabase.from('v_prix_reference').select('*'))
  const parRef = useMemo(() => new Map((prix.data ?? []).map(p => [p.cle as string, p])), [prix.data])

  const f = fiche.data?.[0]
  if (fiche.isLoading) return <p className="text-slate-500">Chargement…</p>
  if (!f) return (
    <div className="space-y-3">
      <Link to="/fournisseurs" className="inline-flex items-center gap-1 text-sm text-brand-700"><ArrowLeft size={14} /> Retour aux fournisseurs</Link>
      <Card><Empty>Fournisseur introuvable.</Empty></Card>
    </div>
  )

  const q = recherche.trim().toLowerCase()
  const liste = (articles.data ?? []).filter(a => !q || `${a.reference} ${a.designation}`.toLowerCase().includes(q))
  const info = (l: string, v: unknown) => (
    <div><dt className="text-xs text-slate-500">{l}</dt><dd className="text-sm text-slate-900 break-words">{v === null || v === undefined || v === '' ? '–' : String(v)}</dd></div>
  )

  return (
    <div className="space-y-4">
      <Link to="/fournisseurs" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ArrowLeft size={14} /> Retour aux fournisseurs</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{f.raison_sociale}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            {!f.actif && <Badge tone="gris">Inactif</Badge>}
            {f.national ? <Badge tone="bleu">National</Badge> : <Badge tone="gris">International</Badge>}
            {!f.niu && <Badge tone="orange">NIU manquant</Badge>}
          </div>
        </div>
        {estDML && <Button variant="secondary" onClick={() => setModifier(true)}><Pencil size={14} /> Modifier la fiche</Button>}
      </div>

      <Card title="Informations fiscales et coordonnées">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {info('NIU', f.niu)}{info('RCCM', f.rccm)}{info('Régime fiscal', f.regime_fiscal)}
          {info('Assujetti TVA', f.assujetti_tva === null ? null : f.assujetti_tva ? 'Oui' : 'Non')}
          {info('Centre des impôts', f.centre_impots)}{info('Ville', f.ville)}{info('Adresse', f.adresse)}{info('Contact', f.contact_nom)}
          {info('Téléphone', f.telephone)}{info('E-mail', f.email)}{info('Banque', f.banque)}{info('Numéro de compte', f.numero_compte)}
        </dl>
        {f.remarque && <p className="mt-3 text-sm text-slate-600">{f.remarque}</p>}
      </Card>

      <Card title={`Articles et prix (${articles.data?.length ?? 0})`}
        actions={estDML && <Button onClick={() => setArticle('nouveau')}><Plus size={16} /> Ajouter un article</Button>}>
        <input className={inputCls + ' max-w-sm mb-3'} placeholder="Rechercher un article…" value={recherche}
          onChange={e => setRecherche(e.target.value)} aria-label="Rechercher un article" />
        {liste.length === 0 ? <Empty>Aucun article pour ce fournisseur.</Empty> : (
          <Table head={['Référence', 'Désignation', 'Unité', 'Prix HT', 'Date', 'Source', 'Vs médiane', '']}>
            {liste.map(a => {
              const comp = parRef.get(String(a.reference).toLowerCase())
              const ecart = comp && comp.nb_fournisseurs >= 2 && comp.prix_median > 0 ? a.prix_unitaire / comp.prix_median - 1 : null
              return (
                <tr key={a.id} className={a.actif ? '' : 'opacity-50'}>
                  <td className="px-3 py-2 font-mono text-xs">{a.reference}</td>
                  <td className="px-3 py-2">{a.designation}</td>
                  <td className="px-3 py-2">{a.unite}</td>
                  <td className="px-3 py-2 num whitespace-nowrap font-medium">{fcfa(a.prix_unitaire)}</td>
                  <td className="px-3 py-2">{date(a.date_prix)}</td>
                  <td className="px-3 py-2 text-slate-600">{SOURCES.find(s => s[0] === a.source)?.[1]}</td>
                  <td className="px-3 py-2">
                    {ecart === null ? <span className="text-slate-400">–</span>
                      : <Badge tone={ecart > 0.15 ? 'orange' : ecart < -0.05 ? 'vert' : 'gris'}>{ecart > 0 ? '+' : ''}{pct(ecart)}</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" aria-label={`Historique des prix de ${a.reference}`} onClick={() => setHistorique(a)}><History size={14} /></Button>
                    {estDML && <Button variant="ghost" aria-label={`Modifier ${a.reference}`} onClick={() => setArticle(a)}><Pencil size={14} /></Button>}
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      {modifier && <FournisseurForm fournisseur={f} onClose={() => setModifier(false)} onSaved={() => { setModifier(false); refresh() }} />}
      {article && <ArticleForm fournisseurId={f.id} article={article === 'nouveau' ? undefined : article} onClose={() => setArticle(null)} onSaved={() => { setArticle(null); refresh() }} />}
      {historique && <Historique article={historique} onClose={() => setHistorique(null)} />}
    </div>
  )
}

function ArticleForm({ fournisseurId, article, onClose, onSaved }:
  { fournisseurId: number; article?: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [a, setA] = useState<Row>(article ?? { unite: 'U', source: 'CATALOGUE', date_prix: new Date().toISOString().slice(0, 10), actif: true })
  const set = (k: string, v: unknown) => setA(s => ({ ...s, [k]: v }))

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    const donnees = {
      fournisseur_id: fournisseurId, reference: String(a.reference).trim(), designation: String(a.designation).trim(),
      unite: a.unite || 'U', prix_unitaire: Number(a.prix_unitaire), date_prix: a.date_prix, source: a.source,
      remarque: a.remarque || null, actif: a.actif !== false
    }
    const { error } = article
      ? await supabase.from('articles_fournisseur').update(donnees).eq('id', article.id)
      : await supabase.from('articles_fournisseur').insert(donnees)
    if (error) return toast('err', /articles_fournisseur_ref_uq/.test(error.message) ? 'Cette référence existe déjà chez ce fournisseur.' : erreur(error))
    toast('ok', article ? 'Article mis à jour (le changement de prix est conservé dans l\'historique)' : 'Article ajouté')
    onSaved()
  }

  return (
    <Modal title={article ? `Modifier ${article.reference}` : 'Nouvel article'} onClose={onClose}>
      <form onSubmit={enregistrer} className="grid sm:grid-cols-2 gap-4">
        <Field label="Référence *" hint="Majuscules et minuscules sont équivalentes.">
          <input required autoFocus className={inputCls + ' font-mono'} value={a.reference ?? ''} onChange={e => set('reference', e.target.value)} />
        </Field>
        <Field label="Unité"><select className={inputCls} value={a.unite} onChange={e => set('unite', e.target.value)}>{UNITES.map(u => <option key={u}>{u}</option>)}</select></Field>
        <div className="sm:col-span-2"><Field label="Désignation *"><input required className={inputCls} value={a.designation ?? ''} onChange={e => set('designation', e.target.value)} /></Field></div>
        <Field label="Prix unitaire HT (FCFA) *"><input required type="number" min="0" step="any" className={inputCls} value={a.prix_unitaire ?? ''} onChange={e => set('prix_unitaire', e.target.value)} /></Field>
        <Field label="Date du prix"><input required type="date" className={inputCls} value={a.date_prix ?? ''} onChange={e => set('date_prix', e.target.value)} /></Field>
        <Field label="Source du prix"><select className={inputCls} value={a.source} onChange={e => set('source', e.target.value)}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Remarque"><input className={inputCls} value={a.remarque ?? ''} onChange={e => set('remarque', e.target.value)} /></Field>
        {article && (
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={a.actif !== false} onChange={e => set('actif', e.target.checked)} /> Article actif (décocher pour le retirer des comparaisons)
          </label>
        )}
        <div className="sm:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit">{article ? 'Enregistrer' : 'Ajouter'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function Historique({ article, onClose }: { article: Row; onClose: () => void }) {
  const h = useRows(['historique-prix', article.id], () =>
    supabase.from('articles_prix_historique').select('*').eq('article_id', article.id).order('at', { ascending: false }))
  return (
    <Modal title={`Historique des prix — ${article.reference}`} onClose={onClose}>
      {(h.data ?? []).length === 0 ? <Empty>Aucun historique.</Empty> : (
        <Table head={['Date du prix', 'Prix HT', 'Source', 'Enregistré le']}>
          {h.data!.map((x, i, tab) => {
            const suivant = tab[i + 1]
            const v = suivant ? x.prix / suivant.prix - 1 : null
            return (
              <tr key={x.id}>
                <td className="px-3 py-2">{date(x.date_prix)}</td>
                <td className="px-3 py-2 num">{fcfa(x.prix)}{v !== null && Number.isFinite(v) && v !== 0 && (
                  <span className={`ml-2 text-xs ${v > 0 ? 'text-red-700' : 'text-brand-700'}`}>{v > 0 ? '+' : ''}{pct(v)}</span>)}</td>
                <td className="px-3 py-2">{SOURCES.find(s => s[0] === x.source)?.[1] ?? x.source}</td>
                <td className="px-3 py-2 text-slate-500">{date(x.at)}</td>
              </tr>
            )
          })}
        </Table>
      )}
    </Modal>
  )
}
