import { useState } from 'react'
import { Calculator, Check, X } from 'lucide-react'
import { supabase, MOTIFS_NON_VALIDATION, type Row } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { fcfa, pct } from '../lib/format'
import { Badge, Button, Card, Empty, Modal, Table, Field, inputCls, useAction } from '../components/ui'

export default function Arbitrage() {
  const { cycle } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const [rejet, setRejet] = useState<Row | null>(null)

  const lignes = useRows(['arbitrage', cycle], () =>
    supabase.from('lignes_besoin').select('*').eq('cycle_id', cycle)
      .in('statut', ['EXPRIMEE', 'REEXPRIMEE', 'VALIDEE']).is('decision_numero', null)
      .order('score', { ascending: false, nullsFirst: false }), !!cycle)
  const p1 = useRows(['p1', cycle], () => supabase.from('v_controle_p1').select('*').eq('cycle_id', cycle), !!cycle)

  const aArbitrer = (lignes.data ?? []).filter(l => l.statut !== 'VALIDEE')
  const validees = (lignes.data ?? []).filter(l => l.statut === 'VALIDEE')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Arbitrage — cycle {cycle}</h1>
        <Button onClick={() => agir(() => supabase.rpc('calculer_scores', { p_cycle: cycle }), 'Scores calculés', refresh)}>
          <Calculator size={16} /> Calculer les scores
        </Button>
      </div>

      {(p1.data ?? []).some(r => r.alerte) && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Part de P1 supérieure à 40 % de la demande :{' '}
          {(p1.data ?? []).filter(r => r.alerte).map(r => `${r.agence_code} (${pct(r.part_p1)})`).join(', ')}
        </div>
      )}

      <Card title={`À arbitrer (${aArbitrer.length})`}>
        {aArbitrer.length === 0 ? <Empty>Aucune ligne en attente d'arbitrage.</Empty> : (
          <Table head={['Score', 'Identifiant', 'Véhicule / désignation', 'Priorité', 'Demandé', 'Mode', 'Montant retenu', '']}>
            {aArbitrer.map(l => <Ligne key={l.id_besoin} l={l} onRejet={() => setRejet(l)} />)}
          </Table>
        )}
      </Card>

      {validees.length > 0 && (
        <Card title={`Validées, en attente de décision figée (${validees.length})`}>
          <Table head={['Identifiant', 'Désignation', 'Mode', 'Montant retenu']}>
            {validees.map(l => (
              <tr key={l.id_besoin}>
                <td className="px-3 py-2 font-mono text-xs">{l.id_besoin}</td>
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2"><Badge tone="vert">{l.mode}</Badge></td>
                <td className="px-3 py-2 num">{fcfa(l.montant_retenu)}</td>
              </tr>
            ))}
          </Table>
          <p className="text-sm text-slate-500 mt-3">Rendez-vous dans « Décisions » pour figer et faire signer.</p>
        </Card>
      )}

      {rejet && <Rejet ligne={rejet} onClose={() => setRejet(null)} onDone={() => { setRejet(null); refresh() }} />}
    </div>
  )

  function Ligne({ l, onRejet }: { l: Row; onRejet: () => void }) {
    const [mode, setMode] = useState(l.montant > 2_000_000 ? 'MDI' : 'MDD')
    const [montant, setMontant] = useState(String(l.montant))
    return (
      <tr className="align-top">
        <td className="px-3 py-2 num font-semibold">{l.score ?? '–'}</td>
        <td className="px-3 py-2 font-mono text-xs">{l.id_besoin}</td>
        <td className="px-3 py-2 max-w-[260px]">{l.code_parc}<div className="text-slate-500">{l.designation}</div></td>
        <td className="px-3 py-2">{l.priorite}</td>
        <td className="px-3 py-2 num whitespace-nowrap">{fcfa(l.montant)}</td>
        <td className="px-3 py-2">
          <select className={inputCls + ' !w-24'} value={mode} onChange={e => setMode(e.target.value)} aria-label="Mode">
            <option>MDD</option><option>MDI</option>
          </select>
        </td>
        <td className="px-3 py-2">
          <input type="number" min="0" className={inputCls + ' !w-32 num'} value={montant} onChange={e => setMontant(e.target.value)} aria-label="Montant retenu" />
        </td>
        <td className="px-3 py-2 whitespace-nowrap space-x-1 text-right">
          <Button onClick={() => agir(() => supabase.from('lignes_besoin')
            .update({ statut: 'VALIDEE', mode, montant_retenu: Number(montant) }).eq('id_besoin', l.id_besoin),
            `${l.id_besoin} validée`, refresh)}><Check size={14} /> Valider</Button>
          <Button variant="secondary" onClick={onRejet}><X size={14} /> Non validée</Button>
        </td>
      </tr>
    )
  }
}

function Rejet({ ligne, onClose, onDone }: { ligne: Row; onClose: () => void; onDone: () => void }) {
  const agir = useAction()
  const [motif, setMotif] = useState('')
  return (
    <Modal title={`Non validation — ${ligne.id_besoin}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Motif codifié" hint="Choisir « Reporté » pour que la ligne revienne au cycle suivant avec +10 points.">
          <select className={inputCls} value={motif} onChange={e => setMotif(e.target.value)}>
            <option value="">Choisir…</option>
            {MOTIFS_NON_VALIDATION.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="danger" disabled={!motif} onClick={async () => {
            if (await agir(() => supabase.from('lignes_besoin').update({ statut: 'NON_VALIDEE', motif_code: motif }).eq('id_besoin', ligne.id_besoin), 'Ligne non validée')) onDone()
          }}>Confirmer</Button>
        </div>
      </div>
    </Modal>
  )
}
