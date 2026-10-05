import { useState } from 'react'
import { ListChecks, ShieldCheck, Wand2 } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, type Row } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa } from '../lib/format'
import { Badge, Button, Card, Empty, Table, inputCls, useAction } from '../components/ui'

const CATEGORIES: [string, string][] = [
  ['CONFORME', 'Conforme'], ['REAFFECTATION_JUSTIFIEE', 'Réaffectation justifiée'], ['NON_CONFORME', 'Non conforme']
]
const tonCat = (c: string) => (c === 'CONFORME' ? 'vert' : c === 'NON_CONFORME' ? 'rouge' : 'orange') as 'vert' | 'rouge' | 'orange'

export default function Comptes() {
  const { cycle } = useCycle()
  const { profile } = useAuth()
  const refresh = useRefresh()
  const agir = useAction()
  const estCG = profile!.role === 'CG'

  const comptes = useRows(['comptes', cycle], () =>
    supabase.from('comptes_emploi').select('*, mad!inner(cycle_id, montant)').eq('mad.cycle_id', cycle).order('mad_numero'), !!cycle)
  const classements = useRows(['classements', cycle], () =>
    supabase.from('classements').select('*, depenses!inner(montant, id_besoin, sur_provision, id_reaf, commentaire, mad_numero, mad!inner(cycle_id))')
      .eq('depenses.mad.cycle_id', cycle), !!cycle)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Comptes d'emploi et conformité — cycle {cycle}</h1>
      <p className="text-sm text-slate-500">
        Le contrôle de gestion confirme le classement proposé : conforme, réaffectation justifiée ou non conforme (régularisation sous 15 jours).
      </p>

      {(comptes.data ?? []).length === 0 && <Card><Empty>Aucun compte d'emploi : ils apparaissent après le virement d'une MAD.</Empty></Card>}

      {comptes.data?.map(c => {
        const cl = (classements.data ?? []).filter(x => x.depenses.mad_numero === c.mad_numero)
        const tousConfirmes = cl.length > 0 && cl.every(x => x.confirme_par)
        return (
          <Card key={c.id} title={c.mad_numero}
            actions={<Badge tone={c.statut === 'CONTROLE' ? 'vert' : c.statut === 'A_REGULARISER' ? 'rouge' : c.statut === 'DEPOSE' ? 'bleu' : 'gris'}>
              {c.statut.replace('_', ' ').toLowerCase()}</Badge>}>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600 mb-3">
              <span>Montant reçu : <strong className="num">{fcfa(c.mad.montant)}</strong></span>
              <span>Déposé le : {date(c.depose_le)}</span>
              <span>Solde bancaire : <strong className="num">{fcfa(c.solde_bancaire)}</strong></span>
            </div>

            {c.statut === 'A_DEPOSER' && <p className="text-sm text-slate-500">En attente du dépôt par le chef d'agence.</p>}

            {estCG && c.statut === 'DEPOSE' && cl.length === 0 && (
              <Button onClick={() => agir(() => supabase.rpc('classer_compte', { p_compte: c.id }), 'Classement proposé', refresh)}>
                <Wand2 size={16} /> Proposer le classement automatique
              </Button>
            )}

            {cl.length > 0 && (
              <Table head={['Dépense', 'Montant', 'Catégorie', 'Motif', '']}>
                {cl.map(x => <LigneClassement key={x.id} x={x} editable={estCG && c.statut === 'DEPOSE'} onDone={refresh} />)}
              </Table>
            )}

            {estCG && c.statut === 'DEPOSE' && cl.length > 0 && (
              <div className="mt-4 flex justify-end">
                <Button disabled={!tousConfirmes}
                  onClick={() => agir(() => supabase.rpc('controler_compte', { p_compte: c.id }), 'Contrôle enregistré', refresh)}>
                  <ShieldCheck size={16} /> Valider le contrôle
                </Button>
              </div>
            )}
            {estCG && c.statut === 'DEPOSE' && cl.length > 0 && !tousConfirmes && (
              <p className="mt-2 text-xs text-slate-500 text-right"><ListChecks size={12} className="inline" /> Confirmez chaque ligne pour valider le contrôle.</p>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function LigneClassement({ x, editable, onDone }: { x: Row; editable: boolean; onDone: () => void }) {
  const agir = useAction()
  const [cat, setCat] = useState<string>(x.categorie)
  const [motif, setMotif] = useState<string>(x.motif ?? '')
  const d = x.depenses
  return (
    <tr className="align-top">
      <td className="px-3 py-2 font-mono text-xs">{d.sur_provision ? 'Provision' : d.id_reaf ?? d.id_besoin}<div className="font-sans text-slate-500">{d.commentaire}</div></td>
      <td className="px-3 py-2 num whitespace-nowrap">{fcfa(d.montant)}</td>
      <td className="px-3 py-2">
        {editable ? (
          <select className={inputCls + ' !w-52'} value={cat} onChange={e => setCat(e.target.value)} aria-label="Catégorie">
            {CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        ) : <Badge tone={tonCat(x.categorie)}>{CATEGORIES.find(c => c[0] === x.categorie)?.[1]}</Badge>}
      </td>
      <td className="px-3 py-2">
        {editable ? <input className={inputCls} value={motif} onChange={e => setMotif(e.target.value)} aria-label="Motif" /> : x.motif}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {editable && (x.confirme_par
          ? <Badge tone="vert">Confirmé</Badge>
          : <Button variant="secondary" onClick={() => agir(() => supabase.rpc('confirmer_classement', { p_id: x.id, p_categorie: cat, p_motif: motif || null }), 'Classement confirmé', onDone)}>Confirmer</Button>)}
      </td>
    </tr>
  )
}
