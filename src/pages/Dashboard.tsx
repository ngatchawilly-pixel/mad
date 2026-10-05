import { useMemo } from 'react'
import { supabase, STATUT_LABEL, type Row } from '../lib/supabase'
import { useCycle, useRows } from '../lib/data'
import { fcfa, pct, somme } from '../lib/format'
import { Badge, Card, Empty, Stat, Table, statutTone } from '../components/ui'

export default function Dashboard() {
  const { cycle } = useCycle()
  const on = !!cycle
  const lignes = useRows(['lignes', cycle], () => supabase.from('lignes_besoin').select('*').eq('cycle_id', cycle), on)
  const mads = useRows(['mad', cycle], () => supabase.from('mad').select('*').eq('cycle_id', cycle), on)
  const depenses = useRows(['depenses', cycle], () => supabase.from('depenses').select('*, mad!inner(cycle_id)').eq('mad.cycle_id', cycle), on)
  const p1 = useRows(['p1', cycle], () => supabase.from('v_controle_p1').select('*').eq('cycle_id', cycle), on)

  const k = useMemo(() => {
    const L = lignes.data ?? [], M = mads.data ?? [], D = depenses.data ?? []
    const actives = L.filter(l => !['BROUILLON', 'ABANDONNEE'].includes(l.statut))
    const retenues = L.filter(l => ['VALIDEE', 'MAD_ETABLIE', 'EN_TRAITEMENT', 'CLOTUREE'].includes(l.statut))
    const demande = somme(actives, l => l.montant)
    const retenu = somme(retenues, l => l.montant_retenu)
    const mis = somme(M, m => m.montant)
    const depense = somme(D, d => d.montant)
    const parAgence = new Map<string, { demande: number; retenu: number; mad: number; depense: number; lignes: number }>()
    const ag = (c: string) => {
      if (!parAgence.has(c)) parAgence.set(c, { demande: 0, retenu: 0, mad: 0, depense: 0, lignes: 0 })
      return parAgence.get(c)!
    }
    actives.forEach(l => { const a = ag(l.agence_code); a.demande += l.montant; a.lignes++ })
    retenues.forEach(l => { ag(l.agence_code).retenu += l.montant_retenu || 0 })
    M.forEach(m => { ag(m.agence_code).mad += m.montant })
    D.forEach(d => { ag(d.agence_code).depense += d.montant })
    const statuts = new Map<string, number>()
    L.forEach(l => statuts.set(l.statut, (statuts.get(l.statut) ?? 0) + 1))
    return { demande, retenu, mis, depense, parAgence: [...parAgence.entries()].sort(), statuts: [...statuts.entries()], total: L.length }
  }, [lignes.data, mads.data, depenses.data])

  const alertes = (p1.data ?? []).filter(r => r.alerte)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Tableau de bord — cycle {cycle}</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Demandé" value={fcfa(k.demande)} sub={`${k.total} lignes`} />
        <Stat label="Retenu" value={fcfa(k.retenu)} sub={`Couverture ${pct(k.demande ? k.retenu / k.demande : null)}`} />
        <Stat label="Mis à disposition" value={fcfa(k.mis)} sub={`${(mads.data ?? []).length} MAD`} />
        <Stat label="Dépensé" value={fcfa(k.depense)} sub={`Taux de justification ${pct(k.mis ? k.depense / k.mis : null)}`} />
      </div>

      {alertes.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium mb-1">Part de P1 au-dessus de 40 % de la demande</p>
          {alertes.map(a => <p key={a.agence_code}>{a.agence_code} : {pct(a.part_p1)}</p>)}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Lignes par statut" className="lg:col-span-1">
          {k.statuts.length === 0 ? <Empty>Aucune ligne dans ce cycle.</Empty> : (
            <ul className="space-y-2">
              {k.statuts.map(([s, n]) => (
                <li key={s} className="flex items-center justify-between">
                  <Badge tone={statutTone(s)}>{STATUT_LABEL[s] ?? s}</Badge>
                  <span className="num font-medium">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Par agence" className="lg:col-span-2">
          {k.parAgence.length === 0 ? <Empty>Aucune donnée.</Empty> : (
            <Table head={['Agence', 'Lignes', 'Demandé', 'Retenu', 'MAD', 'Dépensé']}>
              {k.parAgence.map(([code, a]) => (
                <tr key={code}>
                  <td className="px-3 py-2 font-medium">{code}</td>
                  <td className="px-3 py-2 num">{a.lignes}</td>
                  <td className="px-3 py-2 num">{fcfa(a.demande)}</td>
                  <td className="px-3 py-2 num">{fcfa(a.retenu)}</td>
                  <td className="px-3 py-2 num">{fcfa(a.mad)}</td>
                  <td className="px-3 py-2 num">{fcfa(a.depense)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  )
}

export type { Row }
