import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa } from '../lib/format'
import { Badge, Button, Card, Empty, Field, Modal, Table, inputCls, useAction } from '../components/ui'

const MOTIFS = ['Véhicule de collecte immobilisé', 'Engin de CTD immobilisé', 'Risque de sécurité', 'Obligation légale', 'Rupture de service']

export default function Reaffectations() {
  const { profile } = useAuth()
  const { cycle } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const [ouvert, setOuvert] = useState(false)
  const role = profile!.role

  const liste = useRows(['reaf', cycle], () =>
    supabase.from('reaffectations').select('*').eq('cycle_id', cycle).order('soumis_le', { ascending: false }), !!cycle)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Réaffectations d'urgence — cycle {cycle}</h1>
        {['CHEF', 'RM'].includes(role) && <Button onClick={() => setOuvert(true)}><Plus size={16} /> Nouvelle demande</Button>}
      </div>
      <p className="text-sm text-slate-500">Une réaffectation signalée sous 48 h et validée par la DML est « justifiée ». Sans réponse sous 72 h, elle est validée automatiquement.</p>

      <Card>
        {(liste.data ?? []).length === 0 ? <Empty>Aucune réaffectation.</Empty> : (
          <Table head={['Identifiant', 'Agence', 'Ligne d\'origine', 'Nouvelle affectation', 'Montant', 'Statut', '']}>
            {liste.data!.map(r => (
              <tr key={r.id_reaf} className="align-top">
                <td className="px-3 py-2 font-mono text-xs">{r.id_reaf}<div className="text-slate-400">{date(r.soumis_le)}</div></td>
                <td className="px-3 py-2">{r.agence_code}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.ligne_origine}<div className="text-slate-500 font-sans">Sort : {r.sort_besoin_origine.toLowerCase()}</div></td>
                <td className="px-3 py-2 max-w-[240px]">{r.nouvelle_affectation}<div className="text-slate-500">{r.motif} · {r.panne_ot}</div></td>
                <td className="px-3 py-2 num whitespace-nowrap">{fcfa(r.montant)}</td>
                <td className="px-3 py-2"><Badge tone={r.statut === 'REFUSEE' ? 'rouge' : r.statut === 'SOUMISE' ? 'orange' : 'vert'}>{r.statut.replace('_', ' ').toLowerCase()}</Badge></td>
                <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                  {r.statut === 'SOUMISE' && ['DML', 'DG'].includes(role) && (<>
                    <Button onClick={() => agir(() => supabase.rpc('repondre_reaffectation', { p_id: r.id_reaf, p_accepte: true }), 'Réaffectation validée', refresh)}>Valider</Button>
                    <Button variant="secondary" onClick={() => agir(() => supabase.rpc('repondre_reaffectation', { p_id: r.id_reaf, p_accepte: false }), 'Réaffectation refusée', refresh)}>Refuser</Button>
                  </>)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {ouvert && <Nouvelle cycle={cycle} onClose={() => setOuvert(false)} onSaved={() => { setOuvert(false); refresh() }} />}
    </div>
  )
}

function Nouvelle({ cycle, onClose, onSaved }: { cycle: string; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const agir = useAction()
  const [f, setF] = useState({ ligne_origine: '', nouvelle_affectation: '', motif: MOTIFS[0], panne_ot: '', montant: '', sort: 'REPORTE', prov: false })
  const set = (k: string, v: unknown) => setF(s => ({ ...s, [k]: v }))
  const lignes = useRows(['lignes-agence', cycle], () =>
    supabase.from('lignes_besoin').select('id_besoin, designation').eq('agence_code', profile!.agence_code!).eq('cycle_id', cycle)
      .in('statut', ['MAD_ETABLIE', 'EN_TRAITEMENT']))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await agir(() => supabase.from('reaffectations').insert({
      agence_code: profile!.agence_code, cycle_id: cycle, ligne_origine: f.ligne_origine,
      nouvelle_affectation: f.nouvelle_affectation, motif: f.motif, panne_ot: f.panne_ot,
      montant: Number(f.montant), sort_besoin_origine: f.sort, sur_provision: f.prov
    }), 'Demande transmise à la DML')
    if (ok) onSaved()
  }

  return (
    <Modal title="Demande de réaffectation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Ligne d'origine" hint="La provision est à utiliser en premier.">
          <select required className={inputCls} value={f.ligne_origine} onChange={e => set('ligne_origine', e.target.value)}>
            <option value="">Choisir…</option>
            {lignes.data?.map(l => <option key={l.id_besoin} value={l.id_besoin}>{l.id_besoin} — {l.designation}</option>)}
          </select>
        </Field>
        <Field label="Nouvelle affectation"><input required className={inputCls} value={f.nouvelle_affectation} onChange={e => set('nouvelle_affectation', e.target.value)} /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Motif"><select className={inputCls} value={f.motif} onChange={e => set('motif', e.target.value)}>{MOTIFS.map(m => <option key={m}>{m}</option>)}</select></Field>
          <Field label="N° de panne ou d'OT"><input required className={inputCls} value={f.panne_ot} onChange={e => set('panne_ot', e.target.value)} /></Field>
          <Field label="Montant (FCFA)"><input required type="number" min="1" className={inputCls} value={f.montant} onChange={e => set('montant', e.target.value)} /></Field>
          <Field label="Sort du besoin d'origine">
            <select className={inputCls} value={f.sort} onChange={e => set('sort', e.target.value)}>
              <option value="REPORTE">Reporté au cycle suivant</option><option value="ANNULE">Annulé</option><option value="REFINANCE">Refinancé</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.prov} onChange={e => set('prov', e.target.checked)} /> Imputée sur la provision</label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit">Envoyer à la DML</Button>
        </div>
      </form>
    </Modal>
  )
}
