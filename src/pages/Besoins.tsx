import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, erreur } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa } from '../lib/format'
import ImportBesoins from '../components/ImportBesoins'
import { Badge, Button, Card, Empty, Field, Modal, Table, inputCls, useToast } from '../components/ui'

export const BESOIN_STATUT: Record<string, [string, 'gris' | 'bleu' | 'vert' | 'orange' | 'rouge']> = {
  VIDE: ['Vide', 'gris'],
  EN_SAISIE: ['En saisie', 'orange'],
  SOUMIS: ['Soumis', 'bleu'],
  PARTIELLEMENT_VALIDE: ['Partiellement validé', 'bleu'],
  ENTIEREMENT_VALIDE: ['Entièrement validé', 'vert'],
  NON_VALIDE: ['Non validé', 'rouge'],
  CLOTURE: ['Clôturé', 'vert']
}

export default function Besoins() {
  const { profile } = useAuth()
  const { cycle } = useCycle()
  const refresh = useRefresh()
  const navigate = useNavigate()
  const [nouveau, setNouveau] = useState(false)
  const [importer, setImporter] = useState(false)
  const role = profile!.role
  const peutCreer = ['CHEF', 'RM', 'DML'].includes(role)

  const besoins = useRows(['besoins', cycle], () =>
    supabase.from('v_besoins').select('*').eq('cycle_id', cycle).order('numero'), !!cycle)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Besoins — cycle {cycle}</h1>
          <p className="text-sm text-slate-500">Un besoin regroupe une ou plusieurs lignes. Créez ou ouvrez un besoin pour y ajouter ses lignes.</p>
        </div>
        <div className="flex gap-2">
          {role === 'DML' && <Button variant="secondary" onClick={() => setImporter(true)}><FileSpreadsheet size={16} /> Importer Excel</Button>}
          {peutCreer && <Button onClick={() => setNouveau(true)}><Plus size={16} /> Nouveau besoin</Button>}
        </div>
      </div>

      <Card>
        {(besoins.data ?? []).length === 0 ? <Empty>Aucun besoin dans ce cycle. Créez-en un pour commencer.</Empty> : (
          <Table head={['Besoin', 'Agence', 'Libellé', 'Service', 'Lignes', 'Montant', 'Statut', 'Créé le']}>
            {besoins.data!.map(b => {
              const [libelle, ton] = BESOIN_STATUT[b.statut] ?? [b.statut, 'gris']
              return (
                <tr key={b.id} onClick={() => navigate(`/besoins/${b.id}`)} tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate(`/besoins/${b.id}`)}
                  className="cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
                  <td className="px-3 py-2.5 font-mono text-xs">{b.numero}</td>
                  <td className="px-3 py-2.5">{b.agence_code}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-900">{b.libelle || <span className="text-slate-400 font-normal">Sans libellé</span>}</td>
                  <td className="px-3 py-2.5 text-slate-600">{b.service}</td>
                  <td className="px-3 py-2.5 num">{b.nb_lignes}</td>
                  <td className="px-3 py-2.5 num whitespace-nowrap">{fcfa(b.montant)}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={ton}>{libelle}</Badge>
                    {b.nb_brouillons > 0 && <span className="ml-1 text-xs text-slate-500">{b.nb_brouillons} brouillon(s)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{date(b.created_at)}</td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      {nouveau && <NouveauBesoin cycle={cycle} onClose={() => setNouveau(false)} onCreated={id => { setNouveau(false); refresh(); navigate(`/besoins/${id}`) }} />}
      {importer && <ImportBesoins cycle={cycle} onClose={() => setImporter(false)} onDone={() => { setImporter(false); refresh() }} />}
    </div>
  )
}

function NouveauBesoin({ cycle, onClose, onCreated }: { cycle: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [agence, setAgence] = useState(profile!.agence_code ?? '')
  const [libelle, setLibelle] = useState('')
  const [service, setService] = useState('')
  const [busy, setBusy] = useState(false)
  const agences = useRows(['agences'], () => supabase.from('agences').select('*').order('nom'))

  async function creer(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await supabase.from('besoins')
      .insert({ agence_code: agence, cycle_id: cycle, libelle, service: service || null }).select('id, numero').single()
    setBusy(false)
    if (error) return toast('err', erreur(error))
    toast('ok', `Besoin ${data.numero} créé : ajoutez maintenant ses lignes`)
    onCreated(data.id)
  }

  return (
    <Modal title="Nouveau besoin" onClose={onClose}>
      <form onSubmit={creer} className="space-y-4">
        {!profile!.agence_code ? (
          <Field label="Agence">
            <select required className={inputCls} value={agence} onChange={e => setAgence(e.target.value)}>
              <option value="">Choisir…</option>
              {agences.data?.map(a => <option key={a.code} value={a.code}>{a.nom}</option>)}
            </select>
          </Field>
        ) : (
          <p className="text-sm text-slate-600">Agence : <strong>{profile!.agence_code}</strong> · Cycle : <strong>{cycle}</strong></p>
        )}
        <Field label="Libellé du besoin" hint="Ce que regroupe ce besoin, par exemple « Pièces pour les bennes immobilisées ».">
          <input required autoFocus className={inputCls} value={libelle} onChange={e => setLibelle(e.target.value)} />
        </Field>
        <Field label="Service (facultatif)">
          <input className={inputCls} value={service} onChange={e => setService(e.target.value)} placeholder="Atelier, magasin, collecte…" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={busy || !agence || !libelle.trim()}>{busy ? 'Création…' : 'Créer et ajouter des lignes'}</Button>
        </div>
      </form>
    </Modal>
  )
}
