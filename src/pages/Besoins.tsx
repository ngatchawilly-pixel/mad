import { useMemo, useState, type FormEvent } from 'react'
import { FileSpreadsheet, Plus, Send } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, STATUT_LABEL, type Row } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { fcfa } from '../lib/format'
import ImportBesoins from '../components/ImportBesoins'
import { Badge, Button, Card, Empty, Field, Modal, Table, inputCls, statutTone, useAction, useToast } from '../components/ui'

const TYPES = ['Remise en service', 'Entretien préventif', 'Mise à niveau', 'Stock', 'Réglementaire', 'Fonctionnement']

export default function Besoins() {
  const { profile } = useAuth()
  const { cycle } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const [filtre, setFiltre] = useState('')
  const [nouveau, setNouveau] = useState(false)
  const [importer, setImporter] = useState(false)

  const lignes = useRows(['lignes', cycle], () =>
    supabase.from('lignes_besoin').select('*').eq('cycle_id', cycle).order('id_besoin'), !!cycle)
  const peutSaisir = ['CHEF', 'RM', 'DML'].includes(profile!.role)

  const visibles = (lignes.data ?? []).filter(l => !filtre || l.statut === filtre)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Besoins — cycle {cycle}</h1>
        <div className="flex gap-2">
          <select className={inputCls + ' !w-auto'} value={filtre} onChange={e => setFiltre(e.target.value)} aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            {Object.entries(STATUT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {profile!.role === 'DML' && <Button variant="secondary" onClick={() => setImporter(true)}><FileSpreadsheet size={16} /> Importer Excel</Button>}
          {peutSaisir && <Button onClick={() => setNouveau(true)}><Plus size={16} /> Nouvelle ligne</Button>}
        </div>
      </div>

      <Card>
        {visibles.length === 0 ? <Empty>Aucune ligne de besoin.</Empty> : (
          <Table head={['Identifiant', 'Agence', 'Véhicule', 'Désignation', 'Montant', 'Priorité', 'Score', 'Statut', '']}>
            {visibles.map(l => (
              <tr key={l.id_besoin} className="align-top">
                <td className="px-3 py-2 font-mono text-xs">{l.id_besoin}{l.rang > 1 && <span className="ml-1 text-slate-400">r{l.rang}</span>}</td>
                <td className="px-3 py-2">{l.agence_code}</td>
                <td className="px-3 py-2">{l.code_parc}</td>
                <td className="px-3 py-2 max-w-[260px]">
                  {l.designation}
                  {l.ecart_prix > 0.15 && <div className="mt-1"><Badge tone="orange">Prix +{Math.round(l.ecart_prix * 100)} % / grille</Badge></div>}
                </td>
                <td className="px-3 py-2 num whitespace-nowrap">{fcfa(l.montant)}</td>
                <td className="px-3 py-2">{l.priorite}</td>
                <td className="px-3 py-2 num">{l.score ?? '–'}</td>
                <td className="px-3 py-2"><Badge tone={statutTone(l.statut)}>{STATUT_LABEL[l.statut]}</Badge></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {l.statut === 'BROUILLON' && peutSaisir && (
                    <Button variant="secondary" onClick={() => agir(
                      () => supabase.from('lignes_besoin').update({ statut: 'EXPRIMEE' }).eq('id_besoin', l.id_besoin),
                      `${l.id_besoin} soumise`, refresh)}>
                      <Send size={14} /> Soumettre
                    </Button>
                  )}
                  {l.statut === 'NON_VALIDEE' && peutSaisir && (
                    <Button variant="secondary" onClick={() => agir(
                      () => supabase.from('lignes_besoin').update({ statut: 'REEXPRIMEE' }).eq('id_besoin', l.id_besoin),
                      `${l.id_besoin} réexprimée`, refresh)}>Réexprimer</Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {importer && <ImportBesoins cycle={cycle} onClose={() => setImporter(false)} onDone={() => { setImporter(false); refresh() }} />}
      {nouveau && <NouvelleLigne cycle={cycle} onClose={() => setNouveau(false)} onSaved={() => { setNouveau(false); refresh() }} />}
    </div>
  )
}

function NouvelleLigne({ cycle, onClose, onSaved }: { cycle: string; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [agence, setAgence] = useState(profile!.agence_code ?? '')
  const [f, setF] = useState<Row>({ quantite: 1, prix_unitaire: 0, priorite: 'P2', type_intervention: 'Remise en service', securite_legale: false })
  const set = (k: string, v: unknown) => setF(s => ({ ...s, [k]: v }))

  const agences = useRows(['agences'], () => supabase.from('agences').select('*').order('code'))
  const parc = useRows(['parc', agence], () => supabase.from('parc').select('*').eq('agence_code', agence).order('code'), !!agence)
  const fournisseurs = useRows(['fournisseurs'], () => supabase.from('fournisseurs').select('*').order('raison_sociale'))
  const grille = useRows(['grille'], () => supabase.from('grille_prix').select('*'))

  const vehicule = parc.data?.find(p => p.code === f.code_parc)
  const montant = (Number(f.quantite) || 0) * (Number(f.prix_unitaire) || 0)
  const plafond = grille.data?.find(g => g.reference === f.reference)?.prix_plafond
  const ecart = useMemo(() => (plafond ? Number(f.prix_unitaire) / plafond - 1 : null), [plafond, f.prix_unitaire])

  async function enregistrer(e: FormEvent, soumettre: boolean) {
    e.preventDefault()
    const { data: b, error: e1 } = await supabase.from('besoins').insert({ agence_code: agence, cycle_id: cycle }).select().single()
    if (e1) return toast('err', e1.message)
    const ligne = {
      besoin_id: b.id, agence_code: agence, cycle_id: cycle, code_parc: f.code_parc || null,
      etat_vehicule: vehicule?.etat ?? null, type_intervention: f.type_intervention,
      ot_panne: f.ot_panne || null, reference: f.reference || null, designation: f.designation,
      quantite: Number(f.quantite), prix_unitaire: Number(f.prix_unitaire),
      fournisseur_id: f.fournisseur_id ? Number(f.fournisseur_id) : null, ref_devis: f.ref_devis || null,
      priorite: f.priorite, securite_legale: !!f.securite_legale, justification: f.justification || null,
      justification_prix: f.justification_prix || null, statut: soumettre ? 'EXPRIMEE' : 'BROUILLON'
    }
    const { data, error } = await supabase.from('lignes_besoin').insert(ligne).select('id_besoin').single()
    if (error) return toast('err', error.message.replace(/^.*ERROR:\s*/, ''))
    toast('ok', `Ligne ${data.id_besoin} ${soumettre ? 'soumise' : 'enregistrée en brouillon'}`)
    onSaved()
  }

  return (
    <Modal title="Nouvelle ligne de besoin" onClose={onClose}>
      <form onSubmit={e => enregistrer(e, false)} className="grid sm:grid-cols-2 gap-4">
        {!profile!.agence_code && (
          <Field label="Agence">
            <select required className={inputCls} value={agence} onChange={e => setAgence(e.target.value)}>
              <option value="">Choisir…</option>
              {agences.data?.map(a => <option key={a.code} value={a.code}>{a.nom}</option>)}
            </select>
          </Field>
        )}
        <Field label="Véhicule (code parc)" hint={vehicule ? `État : ${vehicule.etat}` : undefined}>
          <select required className={inputCls} value={f.code_parc ?? ''} onChange={e => set('code_parc', e.target.value)}>
            <option value="">Choisir…</option>
            {parc.data?.map(p => <option key={p.code} value={p.code}>{p.code} — {p.famille}</option>)}
          </select>
        </Field>
        <Field label="Type d'intervention">
          <select className={inputCls} value={f.type_intervention} onChange={e => set('type_intervention', e.target.value)}>
            {TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="N° d'OT ou de panne" hint={f.type_intervention === 'Remise en service' ? 'Obligatoire pour une remise en service' : undefined}>
          <input className={inputCls} value={f.ot_panne ?? ''} onChange={e => set('ot_panne', e.target.value)} />
        </Field>
        <Field label="Référence constructeur">
          <input className={inputCls} value={f.reference ?? ''} onChange={e => set('reference', e.target.value)} />
        </Field>
        <Field label="Désignation">
          <input required className={inputCls} value={f.designation ?? ''} onChange={e => set('designation', e.target.value)} />
        </Field>
        <Field label="Quantité">
          <input required type="number" min="0.01" step="any" className={inputCls} value={f.quantite} onChange={e => set('quantite', e.target.value)} />
        </Field>
        <Field label="Prix unitaire (FCFA)" hint={plafond ? `Grille : ${fcfa(plafond)}` : undefined}>
          <input required type="number" min="0" step="any" className={inputCls} value={f.prix_unitaire} onChange={e => set('prix_unitaire', e.target.value)} />
        </Field>
        <div className="sm:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-sm flex justify-between">
          <span>Montant de la ligne</span><strong className="num">{fcfa(montant)}</strong>
        </div>
        {ecart !== null && ecart > 0.15 && (
          <div className="sm:col-span-2">
            <Field label={`Prix ${Math.round(ecart * 100)} % au-dessus de la grille : explication obligatoire`}>
              <input className={inputCls} value={f.justification_prix ?? ''} onChange={e => set('justification_prix', e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Fournisseur">
          <select className={inputCls} value={f.fournisseur_id ?? ''} onChange={e => set('fournisseur_id', e.target.value)}>
            <option value="">—</option>
            {fournisseurs.data?.map(x => <option key={x.id} value={x.id}>{x.raison_sociale}</option>)}
          </select>
        </Field>
        <Field label="Référence du devis ou pro forma" hint="Obligatoire au-delà de 250 000 FCFA">
          <input className={inputCls} value={f.ref_devis ?? ''} onChange={e => set('ref_devis', e.target.value)} />
        </Field>
        <Field label="Priorité">
          <select className={inputCls} value={f.priorite} onChange={e => set('priorite', e.target.value)}>
            <option value="P1">P1 — critique</option><option value="P2">P2 — importante</option><option value="P3">P3 — planifiable</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm self-end pb-2">
          <input type="checkbox" checked={!!f.securite_legale} onChange={e => set('securite_legale', e.target.checked)} />
          Sécurité ou obligation légale
        </label>
        <div className="sm:col-span-2">
          <Field label="Justification">
            <textarea rows={2} className={inputCls} value={f.justification ?? ''} onChange={e => set('justification', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="secondary">Enregistrer en brouillon</Button>
          <Button type="button" onClick={e => enregistrer(e as unknown as FormEvent, true)}>Enregistrer et soumettre</Button>
        </div>
      </form>
    </Modal>
  )
}
