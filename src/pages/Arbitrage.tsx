import { useNavigate } from 'react-router-dom'
import { Calculator } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa, pct } from '../lib/format'
import { Badge, Button, Card, Empty, Table, useAction } from '../components/ui'
import { BESOIN_STATUT } from './Besoins'

// Vue d'ensemble de la DML : les besoins soumis par les agences, à ouvrir un par un pour sélectionner les lignes à retenir.
export default function Arbitrage() {
  const { cycle } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const navigate = useNavigate()

  const besoins = useRows(['besoins', cycle], () =>
    supabase.from('v_besoins').select('*').eq('cycle_id', cycle).order('numero'), !!cycle)
  const p1 = useRows(['p1', cycle], () => supabase.from('v_controle_p1').select('*').eq('cycle_id', cycle), !!cycle)

  const alerteP1 = new Map((p1.data ?? []).filter(r => r.alerte).map(r => [r.agence_code as string, r.part_p1 as number]))
  const aDecider = (besoins.data ?? []).filter(b => b.statut === 'SOUMIS')
  const decides = (besoins.data ?? []).filter(b => !['VIDE', 'EN_SAISIE', 'SOUMIS'].includes(b.statut))
  const enSaisie = (besoins.data ?? []).filter(b => ['VIDE', 'EN_SAISIE'].includes(b.statut))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Arbitrage — cycle {cycle}</h1>
          <p className="text-sm text-slate-500">
            Ouvrez un besoin soumis, cochez les lignes à retenir (mode et montant), motivez les autres, puis validez le besoin.
          </p>
        </div>
        <Button variant="secondary" onClick={() => agir(() => supabase.rpc('calculer_scores', { p_cycle: cycle }), 'Scores calculés', refresh)}>
          <Calculator size={16} /> Calculer les scores
        </Button>
      </div>

      {alerteP1.size > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Part de P1 supérieure à 40 % de la demande :{' '}
          {[...alerteP1.entries()].map(([a, p]) => `${a} (${pct(p)})`).join(', ')}
        </div>
      )}

      <Card title={`Besoins à décider (${aDecider.length})`}>
        {aDecider.length === 0 ? <Empty>Aucun besoin n'attend votre décision.</Empty> : (
          <Table head={['Besoin', 'Agence', 'Libellé', 'Lignes', 'Montant demandé', 'P1', '']}>
            {aDecider.map(b => (
              <tr key={b.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/besoins/${b.id}`)}>
                <td className="px-3 py-2.5 font-mono text-xs">{b.numero}</td>
                <td className="px-3 py-2.5">{b.agence_code}</td>
                <td className="px-3 py-2.5 font-medium text-slate-900">{b.libelle || '–'}</td>
                <td className="px-3 py-2.5 num">{b.nb_lignes}</td>
                <td className="px-3 py-2.5 num whitespace-nowrap">{fcfa(b.montant)}</td>
                <td className="px-3 py-2.5">{alerteP1.has(b.agence_code) ? <Badge tone="orange">{pct(alerteP1.get(b.agence_code))}</Badge> : <span className="text-slate-400">–</span>}</td>
                <td className="px-3 py-2.5 text-right"><Button onClick={e => { e.stopPropagation(); navigate(`/besoins/${b.id}`) }}>Ouvrir et décider</Button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {decides.length > 0 && (
        <Card title={`Besoins décidés (${decides.length})`}>
          <Table head={['Besoin', 'Agence', 'Libellé', 'Lignes', 'Montant demandé', 'Statut']}>
            {decides.map(b => {
              const [lib, ton] = BESOIN_STATUT[b.statut] ?? [b.statut, 'gris']
              return (
                <tr key={b.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/besoins/${b.id}`)}>
                  <td className="px-3 py-2 font-mono text-xs">{b.numero}</td>
                  <td className="px-3 py-2">{b.agence_code}</td>
                  <td className="px-3 py-2">{b.libelle || '–'}</td>
                  <td className="px-3 py-2 num">{b.nb_lignes}</td>
                  <td className="px-3 py-2 num whitespace-nowrap">{fcfa(b.montant)}</td>
                  <td className="px-3 py-2"><Badge tone={ton}>{lib}</Badge></td>
                </tr>
              )
            })}
          </Table>
        </Card>
      )}

      {enSaisie.length > 0 && (
        <p className="text-sm text-slate-500">
          {enSaisie.length} besoin(s) encore en saisie dans les agences ({[...new Set(enSaisie.map(b => b.agence_code))].join(', ')}) :
          ils n'arrivent à la DML qu'une fois soumis par le chef d'agence. Dernière création : {date(enSaisie[enSaisie.length - 1].created_at)}.
        </p>
      )}
    </div>
  )
}
