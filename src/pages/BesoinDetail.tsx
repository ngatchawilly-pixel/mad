import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Calculator, Pencil, Plus, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react'
import { useAuth } from '../auth'
import { supabase, erreur, STATUT_LABEL, MOTIFS_NON_VALIDATION, type Row } from '../lib/supabase'
import { useCycle, useRefresh, useRows } from '../lib/data'
import { date, fcfa } from '../lib/format'
import { Badge, Button, Card, Empty, Field, Modal, Table, inputCls, statutTone, useAction, useToast } from '../components/ui'
import { BESOIN_STATUT } from './Besoins'

const TYPES = ['Remise en service', 'Entretien préventif', 'Mise à niveau', 'Stock', 'Réglementaire', 'Fonctionnement']

export default function BesoinDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { cycles } = useCycle()
  const refresh = useRefresh()
  const agir = useAction()
  const [ajout, setAjout] = useState(false)
  const [edition, setEdition] = useState<Row | null>(null)
  const role = profile!.role

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
  const enAttente = toutes.filter(l => ['EXPRIMEE', 'REEXPRIMEE'].includes(l.statut))
  const enSaisie = ['VIDE', 'EN_SAISIE'].includes(b.statut)
  const soumis = b.statut === 'SOUMIS'
  const decide = !enSaisie && !soumis
  const cycleOuvert = cycles.find(c => c.id === b.cycle_id)?.statut === 'OUVERT'

  const estChef = role === 'CHEF'
  const peutSaisir = ['CHEF', 'RM', 'DML'].includes(role) && enSaisie
  const reexprimables = toutes.filter(l => l.statut === 'NON_VALIDEE' && !['REPORTE', 'SACRIFIE'].includes(l.motif_code ?? ''))

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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone={ton}>{libStatut}</Badge>
          {peutSaisir && <Button variant="secondary" onClick={() => setAjout(true)}><Plus size={16} /> Ajouter une ligne</Button>}
          {estChef && enSaisie && brouillons.length > 0 && (
            <Button onClick={() => {
              if (window.confirm(`Soumettre le besoin ${b.numero} avec ses ${brouillons.length} ligne(s) à la DML ? Vous ne pourrez plus le modifier (sauf à le rappeler avant la décision).`))
                agir(() => supabase.rpc('soumettre_besoin', { p_besoin: b.id }), 'Besoin soumis à la DML', refresh)
            }}><Send size={16} /> Soumettre le besoin</Button>
          )}
          {estChef && soumis && enAttente.length === toutes.filter(l => l.statut !== 'ABANDONNEE').length && (
            <Button variant="secondary" onClick={() => agir(() => supabase.rpc('rappeler_besoin', { p_besoin: b.id }), 'Besoin rappelé : vous pouvez le modifier', refresh)}>
              <Undo2 size={16} /> Rappeler le besoin
            </Button>
          )}
          {estChef && decide && cycleOuvert && reexprimables.length > 0 && (
            <Button variant="secondary" onClick={() => agir(() => supabase.rpc('reexprimer_besoin', { p_besoin: b.id }),
              `${reexprimables.length} ligne(s) réexprimée(s), besoin soumis à nouveau`, refresh)}>
              <RotateCcw size={16} /> Réexprimer les lignes non retenues ({reexprimables.length})
            </Button>
          )}
        </div>
      </div>

      {enSaisie && (role === 'CHEF' || role === 'RM') && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          {role === 'CHEF'
            ? 'Ce besoin est en cours de saisie. Quand toutes ses lignes sont prêtes, soumettez le besoin : la DML le recevra en entier.'
            : "Ce besoin est en cours de saisie. Quand toutes les lignes sont prêtes, le chef d'agence soumet le besoin à la DML."}
        </div>
      )}
      {soumis && (role === 'CHEF' || role === 'RM') && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">Ce besoin est soumis : il est en attente de la décision de la DML.</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Mini label="Lignes" valeur={String(b.nb_lignes)} />
        <Mini label="Montant demandé" valeur={fcfa(b.montant)} />
        <Mini label="Brouillons" valeur={String(b.nb_brouillons)} />
        <Mini label="En attente de décision" valeur={String(enAttente.length)} />
      </div>

      {role === 'DML' && soumis && enAttente.length > 0 && (
        <DecisionDML besoin={b} lignes={enAttente} onDone={refresh} />
      )}

      <Card title="Lignes de ce besoin">
        {toutes.length === 0 ? (
          <Empty>Ce besoin n'a pas encore de ligne. Utilisez « Ajouter une ligne ».</Empty>
        ) : (
          <Table head={['Identifiant', 'Véhicule', 'Désignation', 'Demandé', 'Priorité', 'Score', 'Statut', 'Décision', '']}>
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
                <td className="px-3 py-2 text-xs text-slate-600">
                  {l.montant_retenu != null && <div><Badge tone="vert">{l.mode}</Badge> <span className="num">{fcfa(l.montant_retenu)}</span></div>}
                  {l.statut === 'NON_VALIDEE' && l.motif_code && <div>{MOTIFS_NON_VALIDATION.find(m => m[0] === l.motif_code)?.[1] ?? l.motif_code}</div>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {l.statut === 'BROUILLON' && peutSaisir && (<>
                    <Button variant="ghost" aria-label={`Modifier ${l.id_besoin}`} onClick={() => setEdition(l)}><Pencil size={14} /></Button>
                    <Button variant="ghost" aria-label={`Retirer ${l.id_besoin}`} onClick={() => {
                      if (window.confirm(`Retirer la ligne ${l.id_besoin} ? Elle reste tracée mais ne compte plus.`))
                        agir(() => supabase.from('lignes_besoin').update({ statut: 'ABANDONNEE', motif_code: 'SAISIE_ERRONEE' }).eq('id_besoin', l.id_besoin),
                          `${l.id_besoin} retirée`, refresh)
                    }}><Trash2 size={14} /></Button>
                  </>)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {ajout && <LigneForm besoin={b} onClose={() => setAjout(false)} onSaved={refresh} />}
      {edition && <LigneForm besoin={b} ligne={edition} onClose={() => setEdition(null)} onSaved={refresh} />}
    </div>
  )
}

type Choix = { retenue: boolean; mode: 'MDD' | 'MDI'; montant: string; motif: string }

// La DML sélectionne les lignes à retenir, précise mode et montant, motive les autres, puis valide le besoin.
function DecisionDML({ besoin, lignes, onDone }: { besoin: Row; lignes: Row[]; onDone: () => void }) {
  const agir = useAction()
  const [choix, setChoix] = useState<Record<string, Choix>>(() =>
    Object.fromEntries(lignes.map(l => [l.id_besoin, { retenue: false, mode: l.montant > 2_000_000 ? 'MDI' : 'MDD', montant: String(l.montant), motif: '' } as Choix])))
  const [motifCommun, setMotifCommun] = useState('')
  const maj = (id: string, p: Partial<Choix>) => setChoix(c => ({ ...c, [id]: { ...c[id], ...p } }))

  const retenues = lignes.filter(l => choix[l.id_besoin]?.retenue)
  const ecartees = lignes.filter(l => !choix[l.id_besoin]?.retenue)
  const totalRetenu = retenues.reduce((s, l) => s + (Number(choix[l.id_besoin].montant) || 0), 0)

  // problèmes qui empêchent de valider
  const problemes: string[] = []
  retenues.forEach(l => {
    const c = choix[l.id_besoin], m = Number(c.montant)
    if (!(m > 0)) problemes.push(`${l.id_besoin} : montant retenu à saisir`)
    else if (m > l.montant) problemes.push(`${l.id_besoin} : le montant retenu dépasse le demandé`)
  })
  ecartees.forEach(l => { if (!(choix[l.id_besoin].motif || motifCommun)) problemes.push(`${l.id_besoin} : motif de non-retenue à choisir`) })

  const calculer = () => agir(() => supabase.rpc('calculer_scores', { p_cycle: besoin.cycle_id }), 'Scores calculés', onDone)
  const valider = () => {
    const decisions = lignes.map(l => {
      const c = choix[l.id_besoin]
      return c.retenue
        ? { id_besoin: l.id_besoin, decision: 'VALIDEE', mode: c.mode, montant_retenu: Number(c.montant) }
        : { id_besoin: l.id_besoin, decision: 'NON_VALIDEE', motif_code: c.motif || motifCommun }
    })
    if (window.confirm(`Valider le besoin ${besoin.numero} : ${retenues.length} ligne(s) retenue(s) pour ${fcfa(totalRetenu)}, ${ecartees.length} non retenue(s) ?`))
      agir(() => supabase.rpc('decider_besoin', { p_besoin: besoin.id, p_decisions: decisions }), `Besoin ${besoin.numero} validé`, onDone)
  }

  return (
    <Card title="Décision de la DML : sélectionnez les lignes à retenir"
      actions={<Button variant="secondary" onClick={calculer}><Calculator size={14} /> Calculer les scores</Button>}>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
        <Button variant="secondary" onClick={() => setChoix(c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, retenue: true }])))}>Tout retenir</Button>
        <Button variant="secondary" onClick={() => setChoix(c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, retenue: false }])))}>Tout écarter</Button>
        <label className="flex items-center gap-2 ml-auto">
          <span className="text-slate-600">Motif des lignes non retenues</span>
          <select className={inputCls + ' !w-56'} value={motifCommun} onChange={e => setMotifCommun(e.target.value)}>
            <option value="">À choisir…</option>
            {MOTIFS_NON_VALIDATION.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>

      <Table head={['Retenir', 'Ligne', 'Désignation', 'Demandé', 'Score', 'Mode', 'Montant retenu', 'Motif si non retenue']}>
        {lignes.map(l => {
          const c = choix[l.id_besoin]
          return (
            <tr key={l.id_besoin} className={`align-top ${c.retenue ? 'bg-brand-50/50' : ''}`}>
              <td className="px-3 py-2">
                <input type="checkbox" className="h-5 w-5 accent-[#039855]" checked={c.retenue} onChange={e => maj(l.id_besoin, { retenue: e.target.checked })}
                  aria-label={`Retenir ${l.id_besoin}`} />
              </td>
              <td className="px-3 py-2 font-mono text-xs">{l.id_besoin}<div className="font-sans text-slate-500">{l.code_parc} · {l.priorite}</div></td>
              <td className="px-3 py-2 max-w-[240px]">{l.designation}
                {l.ecart_prix > 0.15 && <div className="mt-1"><Badge tone="orange">Prix +{Math.round(l.ecart_prix * 100)} % / grille</Badge></div>}</td>
              <td className="px-3 py-2 num whitespace-nowrap">{fcfa(l.montant)}</td>
              <td className="px-3 py-2 num font-semibold">{l.score ?? '–'}</td>
              <td className="px-3 py-2">
                <select disabled={!c.retenue} className={inputCls + ' !w-24'} value={c.mode} onChange={e => maj(l.id_besoin, { mode: e.target.value as 'MDD' | 'MDI' })} aria-label="Mode">
                  <option>MDD</option><option>MDI</option>
                </select>
                {c.retenue && c.mode === 'MDD' && Number(c.montant) > 2_000_000 && <div className="mt-1 text-xs text-amber-700">MDI conseillé &gt; 2 M</div>}
              </td>
              <td className="px-3 py-2">
                <input disabled={!c.retenue} type="number" min="0" className={inputCls + ' !w-32 num'} value={c.montant}
                  onChange={e => maj(l.id_besoin, { montant: e.target.value })} aria-label="Montant retenu" />
              </td>
              <td className="px-3 py-2">
                <select disabled={c.retenue} className={inputCls + ' !w-52'} value={c.motif} onChange={e => maj(l.id_besoin, { motif: e.target.value })} aria-label="Motif">
                  <option value="">{motifCommun ? 'Motif commun' : 'À choisir…'}</option>
                  {MOTIFS_NON_VALIDATION.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
            </tr>
          )
        })}
      </Table>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div className="text-sm">
          <p><strong>{retenues.length}</strong> retenue(s) pour <strong className="num">{fcfa(totalRetenu)}</strong> · <strong>{ecartees.length}</strong> non retenue(s)</p>
          {problemes.length > 0 && (
            <p className="text-amber-800 mt-1">À compléter : {problemes.slice(0, 2).join(' ; ')}{problemes.length > 2 ? ` (+${problemes.length - 2})` : ''}</p>
          )}
        </div>
        <Button onClick={valider} disabled={problemes.length > 0}>Valider le besoin</Button>
      </div>
    </Card>
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

// Création d'une ligne, ou modification d'une ligne encore en brouillon (prop `ligne`)
function LigneForm({ besoin, ligne, onClose, onSaved }: { besoin: Row; ligne?: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState<Row>(ligne ?? VIDE)
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
    const champs = {
      code_parc: f.code_parc || null, etat_vehicule: vehicule?.etat ?? ligne?.etat_vehicule ?? null, type_intervention: f.type_intervention,
      ot_panne: f.ot_panne || null, reference: f.reference || null, designation: f.designation,
      quantite: Number(f.quantite), prix_unitaire: Number(f.prix_unitaire),
      fournisseur_id: f.fournisseur_id ? Number(f.fournisseur_id) : null, ref_devis: f.ref_devis || null,
      priorite: f.priorite, securite_legale: !!f.securite_legale, justification: f.justification || null,
      justification_prix: f.justification_prix || null
    }
    if (ligne) {
      // modification d'un brouillon : l'identifiant, l'agence et le besoin ne changent pas
      const { error } = await supabase.from('lignes_besoin').update(champs).eq('id_besoin', ligne.id_besoin)
      if (error) return toast('err', erreur(error))
      toast('ok', `Ligne ${ligne.id_besoin} modifiée`)
      onSaved(); onClose()
      return
    }
    const { data, error } = await supabase.from('lignes_besoin').insert({
      besoin_id: besoin.id, agence_code: besoin.agence_code, cycle_id: besoin.cycle_id, ...champs, statut: 'BROUILLON'
    }).select('id_besoin').single()
    if (error) return toast('err', erreur(error))
    toast('ok', `Ligne ${data.id_besoin} ajoutée au besoin ${besoin.numero}`)
    onSaved()
    if (continuer) setF({ ...VIDE, code_parc: f.code_parc, type_intervention: f.type_intervention, priorite: f.priorite })
    else onClose()
  }

  return (
    <Modal title={ligne ? `Modifier la ligne ${ligne.id_besoin}` : `Nouvelle ligne — ${besoin.numero}`} onClose={onClose}>
      <form onSubmit={e => enregistrer(e, false)} className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          {ligne
            ? <>Cette ligne est encore en brouillon : vous pouvez la modifier tant que le besoin <strong>{besoin.libelle || besoin.numero}</strong> n'est pas soumis.</>
            : <>Cette ligne sera rattachée au besoin <strong>{besoin.libelle || besoin.numero}</strong> (agence {besoin.agence_code}, cycle {besoin.cycle_id}).</>}
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
          {!ligne && <Button type="button" variant="secondary" onClick={e => enregistrer(e as unknown as FormEvent, true)}>Enregistrer et ajouter une autre</Button>}
          <Button type="submit">{ligne ? 'Enregistrer les modifications' : 'Enregistrer'}</Button>
        </div>
      </form>
    </Modal>
  )
}
