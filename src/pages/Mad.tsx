import { useState } from 'react'
import { Banknote, CheckCheck, Plus } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, type Row } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa } from '../lib/format'
import { Badge, Button, Card, Empty, Field, Table, inputCls, useAction } from '../components/ui'

export default function Mad() {
  const { profile } = useAuth()
  const { cycle } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const role = profile!.role

  const mads = useRows(['mad', cycle], () =>
    supabase.from('mad').select('*').eq('cycle_id', cycle).order('numero'), !!cycle)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Mises à disposition — cycle {cycle}</h1>

      {role === 'DML' && <Generer cycle={cycle} onDone={refresh} />}

      <Card title={`MAD établies (${mads.data?.length ?? 0})`}>
        {(mads.data ?? []).length === 0 ? <Empty>Aucune MAD pour ce cycle.</Empty> : (
          <Table head={['Numéro', 'Agence', 'Mode', 'Lignes', 'Provision', 'Total', 'Virement', 'Accusé', '']}>
            {mads.data!.map((m: Row) => (
              <tr key={m.numero}>
                <td className="px-3 py-2 font-mono text-xs">{m.numero}</td>
                <td className="px-3 py-2">{m.agence_code}</td>
                <td className="px-3 py-2"><Badge tone="bleu">{m.mode}</Badge></td>
                <td className="px-3 py-2 num">{fcfa(m.montant_lignes)}</td>
                <td className="px-3 py-2 num">{fcfa(m.provision)}</td>
                <td className="px-3 py-2 num font-medium">{fcfa(m.montant)}</td>
                <td className="px-3 py-2">{m.virement_le ? <Badge tone="vert">{date(m.virement_le)}</Badge> : <Badge>À virer</Badge>}</td>
                <td className="px-3 py-2">{m.accuse_le ? <Badge tone="vert">{date(m.accuse_le)}</Badge> : <Badge tone="orange">En attente</Badge>}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {role === 'TRES' && !m.virement_le && (
                    <Button onClick={() => agir(() => supabase.rpc('virer_mad', { p_numero: m.numero }), `${m.numero} virée`, refresh)}>
                      <Banknote size={14} /> Virer
                    </Button>
                  )}
                  {role === 'CHEF' && !m.accuse_le && (
                    <Button variant="secondary" onClick={() => agir(() => supabase.rpc('accuser_mad', { p_numero: m.numero }), 'Accusé de réception enregistré', refresh)}>
                      <CheckCheck size={14} /> Accuser réception
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}

function Generer({ cycle, onDone }: { cycle: string; onDone: () => void }) {
  const agir = useAction()
  const [agence, setAgence] = useState('')
  const [mode, setMode] = useState('MDD')
  const agences = useRows(['agences'], () => supabase.from('agences').select('*').order('code'))
  const calcul = useRows(['calc', cycle, agence, mode], () =>
    supabase.rpc('calculer_mad', { p_agence: agence, p_cycle: cycle, p_mode: mode }), !!agence && !!cycle)
  const c = calcul.data?.[0]

  return (
    <Card title="Générer une MAD">
      <div className="grid sm:grid-cols-3 gap-4 items-end">
        <Field label="Agence">
          <select className={inputCls} value={agence} onChange={e => setAgence(e.target.value)}>
            <option value="">Choisir…</option>
            {agences.data?.map(a => <option key={a.code} value={a.code}>{a.nom}</option>)}
          </select>
        </Field>
        <Field label="Mode">
          <select className={inputCls} value={mode} onChange={e => setMode(e.target.value)}>
            <option value="MDD">MDD — virement à l'agence</option>
            <option value="MDI">MDI — paiement direct DG</option>
          </select>
        </Field>
        <Button disabled={!agence || !c || c.montant_lignes === 0}
          onClick={() => agir(() => supabase.rpc('generer_mad', { p_agence: agence, p_cycle: cycle, p_mode: mode }), 'MAD générée', onDone)}>
          <Plus size={16} /> Générer
        </Button>
      </div>
      {c && (
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-slate-500">Lignes retenues</dt><dd className="num font-medium">{fcfa(c.montant_lignes)}</dd></div>
          <div><dt className="text-slate-500">Provision imprévus</dt><dd className="num font-medium">{fcfa(c.provision)}</dd></div>
          <div><dt className="text-slate-500">Total</dt><dd className="num font-medium">{fcfa(c.total)}</dd></div>
          <div><dt className="text-slate-500">Plafond</dt><dd className="num font-medium">{c.plafond ? fcfa(c.plafond) : '—'}</dd></div>
          {c.depasse && <p role="alert" className="col-span-full text-red-700 bg-red-50 rounded-lg px-3 py-2">
            Plafond MDD dépassé : basculer des lignes en MDI avant de générer.</p>}
        </dl>
      )}
    </Card>
  )
}
