import { useState } from 'react'
import { FileSignature, Lock, PenLine } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, type Row } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa, somme } from '../lib/format'
import { Badge, Button, Card, Empty, Field, Table, inputCls, useAction } from '../components/ui'

export default function Decisions() {
  const { profile } = useAuth()
  const { cycle } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const [motif, setMotif] = useState('')
  const decisions = useRows(['decisions', cycle], () =>
    supabase.from('decisions').select('*').eq('cycle_id', cycle).order('version', { ascending: false }), !!cycle)

  const role = profile!.role
  const signe = (d: Row) => ({ DML: d.sig_dml, CG: d.sig_cg, DG: d.sig_dg } as Record<string, string | null>)[role]
  const peutSigner = ['DML', 'CG', 'DG'].includes(role)
  const derniere = decisions.data?.[0]

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Décisions figées — cycle {cycle}</h1>

      {role === 'DML' && (
        <Card title="Figer une décision">
          <p className="text-sm text-slate-600 mb-3">
            Reprend toutes les lignes validées non encore figées : une ligne par agence, fournisseur et mode. Une fois signée par la DML,
            le Contrôle de gestion et la DG, la décision est verrouillée ; toute modification crée une version tracée.
          </p>
          {derniere && (
            <Field label="Motif de la nouvelle version (obligatoire à partir de la V2)">
              <input className={inputCls + ' mb-3'} value={motif} onChange={e => setMotif(e.target.value)} />
            </Field>
          )}
          <Button onClick={() => agir(() => supabase.rpc('figer_decision', { p_cycle: cycle, p_motif: motif || null }), 'Décision créée', refresh)}>
            <FileSignature size={16} /> Figer la décision
          </Button>
        </Card>
      )}

      {(decisions.data ?? []).length === 0 && <Card><Empty>Aucune décision pour ce cycle.</Empty></Card>}

      {decisions.data?.map(d => {
        const blocs = (d.contenu as Row[]) ?? []
        return (
          <Card key={d.id} title={d.numero}
            actions={d.verrouillee ? <Badge tone="vert"><Lock size={11} className="inline -mt-0.5" /> Verrouillée</Badge> : <Badge tone="orange">En signature</Badge>}>
            <div className="flex flex-wrap gap-2 mb-4 text-sm">
              {([['DML', d.sig_dml], ['Contrôle de gestion', d.sig_cg], ['DG', d.sig_dg]] as [string, string | null][]).map(([n, s]) => (
                <Badge key={n} tone={s ? 'vert' : 'gris'}>{n} : {s ? `signée ${date(s)}` : 'en attente'}</Badge>
              ))}
              <span className="text-slate-500 ml-auto">Total {fcfa(somme(blocs, b => b.montant))}</span>
            </div>
            <Table head={['Agence', 'Fournisseur', 'Mode', 'Lignes', 'Montant']}>
              {blocs.map((b, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-medium">{b.agence}</td>
                  <td className="px-3 py-2">{b.fournisseur}</td>
                  <td className="px-3 py-2"><Badge tone="bleu">{b.mode}</Badge></td>
                  <td className="px-3 py-2 num">{b.lignes?.length}</td>
                  <td className="px-3 py-2 num">{fcfa(b.montant)}</td>
                </tr>
              ))}
            </Table>
            {d.motif_version && <p className="mt-3 text-sm text-slate-500">Motif : {d.motif_version}</p>}
            {peutSigner && !d.verrouillee && !signe(d) && (
              <div className="mt-4 flex justify-end">
                <Button onClick={() => agir(() => supabase.rpc('signer_decision', { p_numero: d.numero }), 'Décision signée', refresh)}>
                  <PenLine size={16} /> Signer
                </Button>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
