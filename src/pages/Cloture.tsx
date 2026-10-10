import { Link } from 'react-router-dom'
import { Check, Lock, PenLine, Printer, RefreshCw, Unlock, X } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, STATUT_LABEL } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa, pct, somme } from '../lib/format'
import { Badge, Button, Card, Stat, statutTone, useAction } from '../components/ui'

export default function Cloture() {
  const { profile } = useAuth()
  const { cycle, cycles, setCycle } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const role = profile!.role
  const info = cycles.find(x => x.id === cycle)
  const clos = info?.statut === 'CLOTURE'

  const lignes = useRows(['lignes', cycle], () => supabase.from('lignes_besoin').select('*').eq('cycle_id', cycle), !!cycle)
  const besoins = useRows(['besoins', cycle], () => supabase.from('v_besoins').select('*').eq('cycle_id', cycle), !!cycle)
  const mads = useRows(['mad', cycle], () => supabase.from('mad').select('*').eq('cycle_id', cycle), !!cycle)
  const cl = useRows(['cloture', cycle], () => supabase.from('clotures').select('*').eq('cycle_id', cycle), !!cycle)

  const L = lignes.data ?? []
  const enAttente = L.filter(l => ['EXPRIMEE', 'REEXPRIMEE'].includes(l.statut)).length
  const sansMad = L.filter(l => l.statut === 'VALIDEE').length
  const nonValidees = L.filter(l => l.statut === 'NON_VALIDEE').length
  const enSaisie = (besoins.data ?? []).filter(b => ['VIDE', 'EN_SAISIE'].includes(b.statut)).length
  const nbMad = (mads.data ?? []).length
  const montantMad = somme(mads.data ?? [], m => m.montant)
  const peutCloturer = enAttente === 0 && sansMad === 0

  const c = cl.data?.[0]
  const pv = c?.pv ?? {}
  const signe: Record<string, string | null> = c ? { DML: c.sig_dml, CG: c.sig_cg, DG: c.sig_dg } : {}

  const Controle = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <Check size={16} className="mt-0.5 text-brand-600 shrink-0" /> : <X size={16} className="mt-0.5 text-red-600 shrink-0" />}
      <span className={ok ? 'text-slate-700' : 'text-red-800'}>{children}</span>
    </li>
  )

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Clôture du cycle {cycle}</h1>

      {/* ---------- 1. Cycle de besoins ---------- */}
      <Card title="Cycle de besoins et MAD"
        actions={clos ? <Badge tone="vert"><Lock size={11} className="inline -mt-0.5" /> Cycle clôturé</Badge>
          : <Badge tone="orange"><Unlock size={11} className="inline -mt-0.5" /> Cycle ouvert</Badge>}>
        {clos ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              Ce cycle est clôturé{info?.cloture_le ? ` depuis le ${date(info.cloture_le)}` : ''}. Ses besoins validés et ses <strong>{nbMad} MAD</strong> ({fcfa(montantMad)})
              y restent rattachés : le suivi financier (virement, dépenses, compte d'emploi) continue ci-dessous et dans la page MAD.
            </p>
            <p>Les besoins non validés et les besoins encore en saisie sont passés dans le cycle suivant, ouvert automatiquement.</p>
            {info?.cycle_suivant && <Button variant="secondary" onClick={() => setCycle(info.cycle_suivant)}>Aller au cycle {info.cycle_suivant}</Button>}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Quand les besoins sont validés et les MAD faites, la DML clôture le cycle : le cycle suivant s'ouvre automatiquement
              avec <strong>tous les besoins non validés</strong>.
            </p>
            <ul className="space-y-2">
              <Controle ok={enAttente === 0}>
                {enAttente === 0 ? 'Tous les besoins soumis ont été décidés.' : `${enAttente} ligne(s) attendent encore la décision de la DML (page Arbitrage).`}
              </Controle>
              <Controle ok={sansMad === 0}>
                {sansMad === 0 ? 'Toutes les lignes validées ont leur MAD.'
                  : <>{sansMad} ligne(s) validée(s) n'ont pas encore de MAD : <Link className="underline" to="/decisions">figez la décision</Link>, puis <Link className="underline" to="/mad">générez les MAD</Link>.</>}
              </Controle>
            </ul>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">MAD établies</dt><dd className="num font-semibold">{nbMad} · {fcfa(montantMad)}</dd></div>
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Passeront au cycle suivant</dt><dd className="num font-semibold">{nonValidees} ligne(s) non validée(s)</dd></div>
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Suivront, toujours modifiables</dt><dd className="num font-semibold">{enSaisie} besoin(s) en saisie</dd></div>
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">Lignes validées</dt><dd className="num font-semibold">{L.filter(l => ['MAD_ETABLIE', 'EN_TRAITEMENT', 'CLOTUREE'].includes(l.statut)).length}</dd></div>
            </dl>
            {role === 'DML' ? (
              <Button disabled={!peutCloturer} onClick={async () => {
                if (!window.confirm(`Clôturer le cycle ${cycle} ? Les ${nbMad} MAD y restent. ${nonValidees} ligne(s) non validée(s) et ${enSaisie} besoin(s) en saisie passeront dans le nouveau cycle, ouvert automatiquement.`)) return
                let suivant = ''
                const ok = await agir(async () => {
                  const r = await supabase.rpc('cloturer_cycle', { p_cycle: cycle })
                  suivant = (r.data as { cycle_suivant?: string } | null)?.cycle_suivant ?? ''
                  return r
                }, `Cycle ${cycle} clôturé : le cycle suivant est ouvert`, refresh)
                if (ok && suivant) setCycle(suivant)
              }}>Clôturer le cycle et ouvrir le suivant</Button>
            ) : <p className="text-xs text-slate-500">Seule la DML clôture le cycle.</p>}
          </div>
        )}
      </Card>

      {/* ---------- 2. Clôture financière (procès-verbal) ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Clôture financière (procès-verbal)</h2>
        <div className="flex gap-2">
          {c && <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Imprimer le PV</Button>}
          {role === 'DML' && clos && !pv.verrouille && (
            <Button onClick={() => agir(() => supabase.rpc('preparer_cloture', { p_cycle: cycle }), 'Procès-verbal préparé', refresh)}>
              <RefreshCw size={16} /> {c ? 'Recalculer le PV' : 'Préparer le PV'}
            </Button>
          )}
        </div>
      </div>

      {!clos ? (
        <Card><p className="text-sm text-slate-500 text-center py-6">
          La clôture financière (comptes d'emploi contrôlés, procès-verbal signé) se fait une fois le cycle de besoins clôturé, à J+45 après les MAD.</p></Card>
      ) : !c ? (
        <Card><p className="text-sm text-slate-500 text-center py-6">
          Le procès-verbal n'est pas encore préparé. Il est établi quand les comptes d'emploi des MAD de ce cycle sont contrôlés (réunion DML, Contrôle de gestion et DG).</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Stat label="Mis à disposition" value={fcfa(pv.montant_mad)} />
            <Stat label="Dépensé" value={fcfa(pv.depenses)} sub={`Taux de justification ${pct(pv.taux_justification)}`} />
            <Stat label="Remise en service" value={pct(pv.taux_remise_en_service)}
              sub={`${pv.vehicules_remis_en_service ?? 0} sur ${pv.vehicules_immobilises_finances ?? 0} véhicules immobilisés financés`} />
            <Stat label="Lignes financées à solder" value={pv.lignes_a_reporter ?? 0} sub={`Comptes non contrôlés : ${pv.comptes_non_controles ?? 0}`} />
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

          <Card title="Signatures" actions={pv.verrouille ? <Badge tone="vert"><Lock size={11} className="inline -mt-0.5" /> PV verrouillé</Badge> : undefined}>
            <div className="flex flex-wrap gap-2 text-sm">
              {([['DML', 'DML'], ['CG', 'Contrôle de gestion'], ['DG', 'DG']] as [string, string][]).map(([k, n]) => (
                <Badge key={k} tone={signe[k] ? 'vert' : 'gris'}>{n} : {signe[k] ? `signé ${date(signe[k])}` : 'en attente'}</Badge>
              ))}
            </div>
            {!pv.verrouille && ['DML', 'CG', 'DG'].includes(role) && !signe[role] && (
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-sm text-slate-600 flex-1">
                  À la dernière signature, chaque ligne financée reçoit son statut final : réalisée, ou reportée dans le cycle ouvert avec son identifiant.
                </p>
                <Button onClick={() => agir(() => supabase.rpc('signer_cloture', { p_cycle: cycle }), 'Procès-verbal signé', refresh)}>
                  <PenLine size={16} /> Signer
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
