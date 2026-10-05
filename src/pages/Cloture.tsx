import { useState } from 'react'
import { Lock, PenLine, Printer, RefreshCw, Unlock } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa, pct } from '../lib/format'
import { Badge, Button, Card, Field, Stat, inputCls, statutTone, useAction } from '../components/ui'
import { STATUT_LABEL } from '../lib/supabase'

// AAMM suivant : 2610 -> 2611, 2612 -> 2701
function cycleSuivant(id: string) {
  let a = Number(id.slice(0, 2)), m = Number(id.slice(2))
  m += 1
  if (m > 12) { m = 1; a += 1 }
  return String(a).padStart(2, '0') + String(m).padStart(2, '0')
}

export default function Cloture() {
  const { profile } = useAuth()
  const { cycle, cycles, setCycle } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const role = profile!.role
  const [suivant, setSuivant] = useState('')

  const cl = useRows(['cloture', cycle], () => supabase.from('clotures').select('*').eq('cycle_id', cycle), !!cycle)
  const c = cl.data?.[0]
  const infoCycle = cycles.find(x => x.id === cycle)
  const clos = infoCycle?.statut === 'CLOTURE'
  const pv = c?.pv ?? {}
  const signe: Record<string, string | null> = c ? { DML: c.sig_dml, CG: c.sig_cg, DG: c.sig_dg } : {}
  const prochain = suivant || (cycle ? cycleSuivant(cycle) : '')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Clôture du cycle {cycle}</h1>
        <div className="flex gap-2">
          {c && <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Imprimer le PV</Button>}
          {role === 'DML' && !clos && (
            <Button onClick={() => agir(() => supabase.rpc('preparer_cloture', { p_cycle: cycle }), 'Procès-verbal préparé', refresh)}>
              <RefreshCw size={16} /> {c ? 'Recalculer le PV' : 'Préparer le PV'}
            </Button>
          )}
        </div>
      </div>

      {!c ? (
        <Card><p className="text-sm text-slate-500 text-center py-6">
          Le procès-verbal n'est pas encore préparé. La clôture a lieu à J+45, en réunion DML, Contrôle de gestion et DG.</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Stat label="Mis à disposition" value={fcfa(pv.montant_mad)} />
            <Stat label="Dépensé" value={fcfa(pv.depenses)} sub={`Taux de justification ${pct(pv.taux_justification)}`} />
            <Stat label="Remise en service" value={pct(pv.taux_remise_en_service)}
              sub={`${pv.vehicules_remis_en_service ?? 0} sur ${pv.vehicules_immobilises_finances ?? 0} véhicules immobilisés financés`} />
            <Stat label="Lignes à reporter" value={pv.lignes_a_reporter ?? 0} sub={`Comptes non contrôlés : ${pv.comptes_non_controles ?? 0}`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Répartition des dépenses">
              {Object.keys(pv.categories ?? {}).length === 0 ? <p className="text-sm text-slate-500">Aucun classement enregistré.</p> : (
                <ul className="space-y-2 text-sm">
                  {Object.entries<{ nb: number; montant: number }>(pv.categories).map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <Badge tone={k === 'CONFORME' ? 'vert' : k === 'NON_CONFORME' ? 'rouge' : 'orange'}>{k.replace('_', ' ').toLowerCase()}</Badge>
                      <span className="num">{v.nb} dépense(s) · {fcfa(v.montant)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Lignes par statut">
              <ul className="space-y-2 text-sm">
                {Object.entries<number>(pv.lignes_par_statut ?? {}).map(([k, n]) => (
                  <li key={k} className="flex justify-between"><Badge tone={statutTone(k)}>{STATUT_LABEL[k] ?? k}</Badge><span className="num">{n}</span></li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-slate-500">Soldes bancaires à déduire des MAD suivantes : <strong className="num">{fcfa(pv.soldes_bancaires)}</strong></p>
            </Card>
          </div>

          <Card title="Signatures"
            actions={clos ? <Badge tone="vert"><Lock size={11} className="inline -mt-0.5" /> Cycle clôturé</Badge> : <Badge tone="orange"><Unlock size={11} className="inline -mt-0.5" /> Cycle ouvert</Badge>}>
            <div className="flex flex-wrap gap-2 text-sm">
              {([['DML', 'DML'], ['CG', 'Contrôle de gestion'], ['DG', 'DG']] as [string, string][]).map(([k, n]) => (
                <Badge key={k} tone={signe[k] ? 'vert' : 'gris'}>{n} : {signe[k] ? `signé ${date(signe[k])}` : 'en attente'}</Badge>
              ))}
            </div>
            {!clos && ['DML', 'CG', 'DG'].includes(role) && !signe[role] && (
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-sm text-slate-600 flex-1">
                  À la dernière signature, chaque ligne reçoit son statut final : réalisée, ou reportée avec son identifiant.
                </p>
                <Button onClick={() => agir(() => supabase.rpc('signer_cloture', { p_cycle: cycle }), 'Procès-verbal signé', refresh)}>
                  <PenLine size={16} /> Signer
                </Button>
              </div>
            )}
          </Card>
        </>
      )}

      {clos && role === 'DML' && !cycles.some(x => x.id === prochain) && (
        <Card title="Ouvrir le cycle suivant">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Identifiant du cycle (AAMM)">
              <input className={inputCls + ' !w-32'} value={prochain} onChange={e => setSuivant(e.target.value)} maxLength={4} />
            </Field>
            <Button onClick={async () => {
              if (await agir(() => supabase.rpc('ouvrir_cycle', { p_id: prochain }), `Cycle ${prochain} ouvert`, refresh)) setCycle(prochain)
            }}>Ouvrir et reporter les besoins</Button>
          </div>
          <p className="mt-2 text-sm text-slate-500">Les lignes reportées reviennent avec leur identifiant, un rang incrémenté et +10 points.</p>
        </Card>
      )}
    </div>
  )
}
