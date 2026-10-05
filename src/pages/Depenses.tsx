import { useState, type FormEvent } from 'react'
import { FileText, Paperclip, Plus, Send } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, type Row } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa, somme } from '../lib/format'
import { Badge, Button, Card, Empty, Field, Modal, Table, inputCls, useAction, useToast } from '../components/ui'

const TYPES_PIECE = [
  ['facture', 'Facture normalisée (NIU)'], ['reception', 'Bon de réception'], ['sortie', 'Bon de sortie magasin'],
  ['ot', 'OT'], ['devis', 'Devis'], ['recu', 'Reçu visé (achat local < 50 000)'], ['autre', 'Autre']
]

export default function Depenses() {
  const { profile } = useAuth()
  const { cycle } = useCycle()
  const refresh = useRefresh()
  const [saisie, setSaisie] = useState(false)
  const [piece, setPiece] = useState<Row | null>(null)
  const [depot, setDepot] = useState<Row | null>(null)
  const role = profile!.role
  const agenceRole = ['CHEF', 'RM'].includes(role)

  const mads = useRows(['mad', cycle], () => supabase.from('mad').select('*').eq('cycle_id', cycle), !!cycle)
  const comptes = useRows(['comptes', cycle], () =>
    supabase.from('comptes_emploi').select('*, mad!inner(cycle_id)').eq('mad.cycle_id', cycle), !!cycle)
  const depenses = useRows(['depenses-liste', cycle], () =>
    supabase.from('depenses').select('*, mad!inner(cycle_id)').eq('mad.cycle_id', cycle).order('created_at', { ascending: false }), !!cycle)
  const pieces = useRows(['pieces', cycle], () =>
    supabase.from('pieces').select('*, depenses!inner(mad!inner(cycle_id))').eq('depenses.mad.cycle_id', cycle), !!cycle)

  const virees = (mads.data ?? []).filter(m => m.virement_le)
  const compteDe = (num: string) => comptes.data?.find(c => c.mad_numero === num)

  async function ouvrirPiece(p: Row) {
    const { data, error } = await supabase.storage.from('pieces').createSignedUrl(p.storage_path, 120)
    if (!error && data) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Dépenses et compte d'emploi — cycle {cycle}</h1>
        {agenceRole && <Button onClick={() => setSaisie(true)} disabled={virees.length === 0}><Plus size={16} /> Saisir une dépense</Button>}
      </div>
      {agenceRole && virees.length === 0 && (
        <p className="text-sm text-slate-500">Aucune MAD virée : la saisie s'ouvre après le virement de la Trésorerie.</p>
      )}

      {virees.map(m => {
        const d = (depenses.data ?? []).filter(x => x.mad_numero === m.numero)
        const total = somme(d, x => x.montant)
        const ce = compteDe(m.numero)
        const fige = ce && ['DEPOSE', 'CONTROLE'].includes(ce.statut)
        return (
          <Card key={m.numero} title={m.numero}
            actions={<>
              {ce && <Badge tone={ce.statut === 'CONTROLE' ? 'vert' : ce.statut === 'A_REGULARISER' ? 'rouge' : ce.statut === 'DEPOSE' ? 'bleu' : 'gris'}>
                Compte : {ce.statut.replace('_', ' ').toLowerCase()}</Badge>}
              <Badge tone={total === m.montant ? 'vert' : 'gris'}>{fcfa(total)} sur {fcfa(m.montant)}</Badge>
            </>}>
            {d.length === 0 ? <Empty>Aucune dépense saisie.</Empty> : (
              <Table head={['Date', 'Imputation', 'Montant', 'Commentaire', 'Pièces']}>
                {d.map(x => {
                  const ps = (pieces.data ?? []).filter(p => p.depense_id === x.id)
                  return (
                    <tr key={x.id} className="align-top">
                      <td className="px-3 py-2">{date(x.date_depense)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {x.sur_provision ? <Badge tone="orange">Provision</Badge> : x.id_reaf ? <Badge tone="orange">{x.id_reaf}</Badge> : x.id_besoin}
                      </td>
                      <td className="px-3 py-2 num">{fcfa(x.montant)}</td>
                      <td className="px-3 py-2 text-slate-600">{x.commentaire}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {ps.map(p => (
                            <button key={p.id} onClick={() => ouvrirPiece(p)} className="inline-flex items-center gap-1 text-xs text-brand-700 underline">
                              <FileText size={12} />{p.type}
                            </button>
                          ))}
                          {ps.length === 0 && <Badge tone="rouge">Aucune pièce</Badge>}
                          {agenceRole && !fige && (
                            <button onClick={() => setPiece(x)} aria-label="Ajouter une pièce" className="p-1 rounded hover:bg-slate-100 text-slate-600">
                              <Paperclip size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </Table>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-500">Solde à justifier ou à reverser : <strong className="num">{fcfa(m.montant - total)}</strong></p>
              {role === 'CHEF' && ce && ['A_DEPOSER', 'A_REGULARISER'].includes(ce.statut) && (
                <Button onClick={() => setDepot(m)}><Send size={14} /> Déposer le compte d'emploi</Button>
              )}
            </div>
          </Card>
        )
      })}

      {saisie && <Saisie mads={virees.filter(m => !['DEPOSE', 'CONTROLE'].includes(compteDe(m.numero)?.statut ?? ''))}
        onClose={() => setSaisie(false)} onSaved={() => { setSaisie(false); refresh() }} />}
      {piece && <AjoutPiece depense={piece} onClose={() => setPiece(null)} onSaved={() => { setPiece(null); refresh() }} />}
      {depot && <Depot mad={depot} depense={somme((depenses.data ?? []).filter(x => x.mad_numero === depot.numero), x => x.montant)}
        onClose={() => setDepot(null)} onSaved={() => { setDepot(null); refresh() }} />}
    </div>
  )
}

function Saisie({ mads, onClose, onSaved }: { mads: Row[]; onClose: () => void; onSaved: () => void }) {
  const agir = useAction()
  const [madNum, setMadNum] = useState(mads[0]?.numero ?? '')
  const [cible, setCible] = useState('') // id_besoin, "PROVISION" ou "REAF:<id>"
  const [montant, setMontant] = useState('')
  const [jour, setJour] = useState(new Date().toISOString().slice(0, 10))
  const [commentaire, setCommentaire] = useState('')
  const mad = mads.find(m => m.numero === madNum)

  const lignes = useRows(['lignes-mad', madNum], () =>
    supabase.from('lignes_besoin').select('id_besoin, designation, montant_retenu').eq('mad_numero', madNum), !!madNum)
  const reafs = useRows(['reaf-valides', mad?.agence_code], () =>
    supabase.from('reaffectations').select('id_reaf, nouvelle_affectation, montant').eq('agence_code', mad!.agence_code)
      .in('statut', ['VALIDEE', 'VALIDEE_TACITE']), !!mad)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const prov = cible === 'PROVISION'
    const reaf = cible.startsWith('REAF:') ? cible.slice(5) : null
    const ok = await agir(() => supabase.from('depenses').insert({
      agence_code: mad!.agence_code, mad_numero: madNum, montant: Number(montant),
      id_besoin: prov || reaf ? null : cible, id_reaf: reaf, sur_provision: prov,
      date_depense: jour, commentaire: commentaire || null
    }), 'Dépense enregistrée')
    if (ok) onSaved()
  }

  return (
    <Modal title="Saisir une dépense" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="MAD">
          <select className={inputCls} value={madNum} onChange={e => { setMadNum(e.target.value); setCible('') }}>
            {mads.map(m => <option key={m.numero} value={m.numero}>{m.numero}</option>)}
          </select>
        </Field>
        <Field label="Imputation" hint="Autorisée uniquement sur une ligne de la liste, la provision ou une réaffectation validée.">
          <select required className={inputCls} value={cible} onChange={e => setCible(e.target.value)}>
            <option value="">Choisir…</option>
            <optgroup label="Lignes de la liste">
              {lignes.data?.map(l => <option key={l.id_besoin} value={l.id_besoin}>{l.id_besoin} — {l.designation} ({fcfa(l.montant_retenu)})</option>)}
            </optgroup>
            <optgroup label="Autres">
              <option value="PROVISION">Provision pour imprévus</option>
              {reafs.data?.map(r => <option key={r.id_reaf} value={`REAF:${r.id_reaf}`}>{r.id_reaf} — {r.nouvelle_affectation}</option>)}
            </optgroup>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Montant (FCFA)"><input required type="number" min="1" className={inputCls} value={montant} onChange={e => setMontant(e.target.value)} /></Field>
          <Field label="Date"><input required type="date" className={inputCls} value={jour} onChange={e => setJour(e.target.value)} /></Field>
        </div>
        <Field label="Commentaire (fournisseur, n° de facture…)">
          <input className={inputCls} value={commentaire} onChange={e => setCommentaire(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit">Enregistrer</Button>
        </div>
      </form>
    </Modal>
  )
}

function AjoutPiece({ depense, onClose, onSaved }: { depense: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [type, setType] = useState('facture')
  const [fichier, setFichier] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    if (!fichier) return
    setBusy(true)
    const nom = fichier.name.replace(/[^\w.\-]+/g, '_')
    const chemin = `${depense.agence_code}/${depense.id}/${Date.now()}-${nom}`
    const up = await supabase.storage.from('pieces').upload(chemin, fichier, { contentType: fichier.type })
    if (up.error) { toast('err', `Envoi impossible : ${up.error.message}`); setBusy(false); return }
    const { error } = await supabase.from('pieces').insert({ depense_id: depense.id, type, storage_path: chemin })
    setBusy(false)
    if (error) return toast('err', error.message)
    toast('ok', 'Pièce rattachée à la dépense')
    onSaved()
  }

  return (
    <Modal title="Ajouter une pièce justificative" onClose={onClose}>
      <form onSubmit={envoyer} className="space-y-4">
        <Field label="Type de pièce">
          <select className={inputCls} value={type} onChange={e => setType(e.target.value)}>
            {TYPES_PIECE.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Fichier ou photo" hint="Sur mobile, l'appareil photo s'ouvre directement.">
          <input required type="file" accept="image/*,application/pdf" capture="environment"
            className={inputCls} onChange={e => setFichier(e.target.files?.[0] ?? null)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={busy || !fichier}>{busy ? 'Envoi…' : 'Envoyer'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function Depot({ mad, depense, onClose, onSaved }: { mad: Row; depense: number; onClose: () => void; onSaved: () => void }) {
  const agir = useAction()
  const [solde, setSolde] = useState(String(Math.max(0, mad.montant - depense)))
  return (
    <Modal title={`Déposer le compte d'emploi — ${mad.numero}`} onClose={onClose}>
      <div className="space-y-4">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-slate-500">Reçu</dt><dd className="num font-medium">{fcfa(mad.montant)}</dd></div>
          <div><dt className="text-slate-500">Dépensé</dt><dd className="num font-medium">{fcfa(depense)}</dd></div>
          <div><dt className="text-slate-500">À reverser</dt><dd className="num font-medium">{fcfa(mad.montant - depense)}</dd></div>
        </dl>
        <Field label="Solde bancaire constaté (FCFA)" hint="Dépenses + solde bancaire doivent être égaux au montant reçu. Après dépôt, les dépenses sont figées.">
          <input type="number" min="0" className={inputCls} value={solde} onChange={e => setSolde(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={async () => {
            if (await agir(() => supabase.rpc('deposer_compte', { p_mad: mad.numero, p_solde: Number(solde) }), 'Compte d\'emploi déposé')) onSaved()
          }}>Déposer</Button>
        </div>
      </div>
    </Modal>
  )
}
