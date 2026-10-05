import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, erreur, STATUT_LABEL, type Row } from '../lib/supabase'
import { useRefresh, useRows } from '../lib/data'
import { date, fcfa } from '../lib/format'
import { Badge, Button, Card, Empty, Field, Modal, Table, inputCls, statutTone, useAction, useToast } from '../components/ui'
import { BESOIN_STATUT } from './Besoins'

const TYPES = ['Remise en service', 'Entretien préventif', 'Mise à niveau', 'Stock', 'Réglementaire', 'Fonctionnement']

export default function BesoinDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const refresh = useRefresh()
  const agir = useAction()
  const toast = useToast()
  const [ajout, setAjout] = useState(false)
  const role = profile!.role
  const peutSaisir = ['CHEF', 'RM', 'DML'].includes(role)

  const fiche = useRows(['besoin', id], () => supabase.from('v_besoins').select('*').eq('id', id!), !!id)
  const lignes = useRows(['besoin-lignes', id], () =>
    supabase.from('lignes_besoin').select('*').eq('besoin_id', id!).order('id_besoin'), !!id)

  const b = fiche.data?.[0]
  if (fiche.isLoading) return <p className="text-slate-500">Chargement…</p>
  if (!b) return (
    <div className="space-y-3">
      <Link to="/besoins" className="inline-flex items-center gap-1 text-sm text-brand-700"><ArrowLeft size={14} /> Retour aux besoins</Link>
      <Card><Empty>Besoin introuvable ou non accessible.</Empty></Card>
    </div>
  )

  const [libStatut, ton] = BESOIN_STATUT[b.statut] ?? [b.statut, 'gris']
  const toutes = lignes.data ?? []
  const brouillons = toutes.filter(l => l.statut === 'BROUILLON')

  async function soumettreTout() {
    let ok = 0
    const erreurs: string[] = []
    for (const l of brouillons) {
      const { error } = await supabase.from('lignes_besoin').update({ statut: 'EXPRIMEE' }).eq('id_besoin', l.id_besoin)
      if (error) erreurs.push(`${l.id_besoin} : ${erreur(error)}`)
      else ok++
    }
    if (ok) toast('ok', `${ok} ligne(s) soumise(s)`)
    if (erreurs.length) toast('err', erreurs.slice(0, 3).join(' — ') + (erreurs.length > 3 ? ` (+${erreurs.length - 3} autres)` : ''))
    refresh()
  }

  return (
    <div className="space-y-4">
      <Link to="/besoins" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ArrowLeft size={14} /> Retour aux besoins</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-slate-500">{b.numero}</p>
          <h1 className="text-xl font-semibold text-slate-900">{b.libelle || 'Besoin sans libellé'}</h1>
          <p className="text-sm text-slate-500 mt-1">
            Agence {b.agence_code} · cycle {b.cycle_id}{b.service ? ` · ${b.service}` : ''} · créé le {date(b.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={ton}>{libStatut}</Badge>
          {peutSaisir && brouillons.length > 0 && (
            <Button variant="secondary" onClick={soumettreTout}><Send size={14} /> Soumettre {brouillons.length} ligne(s)</Button>
          )}
          {peutSaisir && <Button onClick={() => setAjout(true)}><Plus size={16} /> Ajouter une ligne</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Mini label="Lignes" valeur={String(b.nb_lignes)} />
        <Mini label="Montant" valeur={fcfa(b.montant)} />
        <Mini label="Brouillons" valeur={String(b.nb_brouillons)} />
      </div>

      <Card title="Lignes de ce besoin">
        {toutes.length === 0 ? (
          <Empty>Ce besoin n'a pas encore de ligne. Utilisez « Ajouter une ligne ».</Empty>
        ) : (
          <Table head={['Identifiant', 'Véhicule', 'Désignation', 'Montant', 'Priorité', 'Score', 'Statut', '']}>
            {toutes.map(l => (
              <tr key={l.id_besoin} className="align-top">
                <td className="px-3 py-2 font-mono text-xs">{l.id_besoin}{l.rang > 1 && <span className="ml-1 text-slate-400">r{l.rang}</span>}</td>
                <td className="px-3 py-2">{l.code_parc}</td>
                <td className="px-3 py-2 max-w-[260px]">
                  {l.designation}
                  {l.ecart_prix > 0.15 && <div className="mt-1"><Badge tone="orange">Prix +{Math.round(l.ecart_prix * 100)} % / grille</Badge></div>}
                </td>
                <td className="px-3 py-2 num whitespace-nowrap">{fcfa(l.montant)}</td>
                <td className="px-3 py-2">{l.priorite}</td>
                <td className="px-3 py-2 num">{l.score ?? '–'}</td>
                <td className="px-3 py-2"><Badge tone={statutTone(l.statut)}>{STATUT_LABEL[l.statut]}</Badge></td>
                <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                  {l.statut === 'BROUILLON' && peutSaisir && (<>
                    <Button variant="secondary" onClick={() => agir(
                      () => supabase.from('lignes_besoin').update({ statut: 'EXPRIMEE' }).eq('id_besoin', l.id_besoin),
                      `${l.id_besoin} soumise`, refresh)}><Send size={14} /> Soumettre</Button>
                    <Button variant="ghost" aria-label={`Retirer ${l.id_besoin}`} onClick={() => {
                      if (window.confirm(`Retirer la ligne ${l.id_besoin} ? Elle reste tracée mais ne compte plus.`))
                        agir(() => supabase.from('lignes_besoin').update({ statut: 'ABANDONNEE', motif_code: 'SAISIE_ERRONEE' }).eq('id_besoin', l.id_besoin),
                          `${l.id_besoin} retirée`, refresh)
                    }}><Trash2 size={14} /></Button>
                  </>)}
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

      {ajout && <LigneForm besoin={b} onClose={() => setAjout(false)} onSaved={refresh} />}
    </div>
  )
}

function Mini({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold num">{valeur}</p>
    </div>
  )
}

const VIDE = { quantite: 1, prix_unitaire: 0, priorite: 'P2', type_intervention: 'Remise en service', securite_legale: false } as Row

function LigneForm({ besoin, onClose, onSaved }: { besoin: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState<Row>(VIDE)
  const set = (k: string, v: unknown) => setF(s => ({ ...s, [k]: v }))

  const parc = useRows(['parc', besoin.agence_code], () => supabase.from('parc').select('*').eq('agence_code', besoin.agence_code).order('code'))
  const fournisseurs = useRows(['fournisseurs'], () => supabase.from('fournisseurs').select('*').order('raison_sociale'))
  const grille = useRows(['grille'], () => supabase.from('grille_prix').select('*'))
  const catalogue = useRows(['catalogue-fournisseur', f.fournisseur_id], () =>
    supabase.from('articles_fournisseur').select('id, reference, designation, prix_unitaire').eq('fournisseur_id', f.fournisseur_id).eq('actif', true).order('reference'),
    !!f.fournisseur_id)

  const vehicule = parc.data?.find(p => p.code === f.code_parc)
  const montant = (Number(f.quantite) || 0) * (Number(f.prix_unitaire) || 0)
  const plafond = grille.data?.find(g => g.reference === f.reference)?.prix_plafond
  const ecart = useMemo(() => (plafond ? Number(f.prix_unitaire) / plafond - 1 : null), [plafond, f.prix_unitaire])

  async function enregistrer(e: FormEvent, continuer: boolean) {
    e.preventDefault()
    const { data, error } = await supabase.from('lignes_besoin').insert({
      besoin_id: besoin.id, agence_code: besoin.agence_code, cycle_id: besoin.cycle_id,
      code_parc: f.code_parc || null, etat_vehicule: vehicule?.etat ?? null, type_intervention: f.type_intervention,
      ot_panne: f.ot_panne || null, reference: f.reference || null, designation: f.designation,
      quantite: Number(f.quantite), prix_unitaire: Number(f.prix_unitaire),
      fournisseur_id: f.fournisseur_id ? Number(f.fournisseur_id) : null, ref_devis: f.ref_devis || null,
      priorite: f.priorite, securite_legale: !!f.securite_legale, justification: f.justification || null,
      justification_prix: f.justification_prix || null, statut: 'BROUILLON'
    }).select('id_besoin').single()
    if (error) return toast('err', erreur(error))
    toast('ok', `Ligne ${data.id_besoin} ajoutée au besoin ${besoin.numero}`)
    onSaved()
    if (continuer) setF({ ...VIDE, code_parc: f.code_parc, type_intervention: f.type_intervention, priorite: f.priorite })
    else onClose()
  }

  return (
    <Modal title={`Nouvelle ligne — ${besoin.numero}`} onClose={onClose}>
      <form onSubmit={e => enregistrer(e, false)} className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          Cette ligne sera rattachée au besoin <strong>{besoin.libelle || besoin.numero}</strong> (agence {besoin.agence_code}, cycle {besoin.cycle_id}).
        </div>
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
        {(catalogue.data ?? []).length > 0 && (
          <div className="sm:col-span-2">
            <Field label="Article du catalogue de ce fournisseur" hint="Remplit la référence, la désignation et le prix.">
              <select className={inputCls} value="" onChange={e => {
                const art = catalogue.data?.find(x => x.id === e.target.value)
                if (art) setF(s => ({ ...s, reference: art.reference, designation: art.designation, prix_unitaire: art.prix_unitaire }))
              }}>
                <option value="">Choisir un article…</option>
                {catalogue.data!.map(x => <option key={x.id} value={x.id}>{x.reference} — {x.designation} ({fcfa(x.prix_unitaire)})</option>)}
              </select>
            </Field>
          </div>
        )}
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
          <Button type="button" variant="ghost" onClick={onClose}>Fermer</Button>
          <Button type="button" variant="secondary" onClick={e => enregistrer(e as unknown as FormEvent, true)}>Enregistrer et ajouter une autre</Button>
          <Button type="submit">Enregistrer</Button>
        </div>
      </form>
    </Modal>
  )
}
