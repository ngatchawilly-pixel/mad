import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { supabase, erreur, type Row } from '../lib/supabase'
import { fcfa, nombre } from '../lib/format'
import { lireDetail, preparer, strip, type Cell, type Resultat } from '../lib/importDetail'
import { Button, Modal, Table, useToast } from './ui'

export default function ImportBesoins({ cycle, onClose, onDone }: { cycle: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [nomFichier, setNomFichier] = useState('')
  const [res, setRes] = useState<Resultat | null>(null)
  const [grille, setGrille] = useState(true)
  const [occupe, setOccupe] = useState(false)
  const [rows, setRows] = useState<ReturnType<typeof lireDetail> | null>(null)
  const [ctx, setCtx] = useState<Parameters<typeof preparer>[1] | null>(null)

  async function choisir(f: File) {
    setOccupe(true); setRes(null); setNomFichier(f.name)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      const feuille = wb.SheetNames.find(n => strip(n) === 'DETAIL') ?? wb.SheetNames[0]
      const aoa = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[feuille], { header: 1, raw: true, defval: null })
      const lues = lireDetail(aoa)

      // contexte : ce que la base connaît déjà (pour ne pas dupliquer)
      const [ag, parc, gr, ex] = await Promise.all([
        supabase.from('agences').select('code, nom'),
        supabase.from('parc').select('code, chassis'),
        supabase.from('grille_prix').select('reference'),
        supabase.from('lignes_besoin').select('agence_code, code_parc, designation, reference, quantite, prix_unitaire').eq('cycle_id', cycle)
      ])
      const erreurLecture = ag.error ?? parc.error ?? gr.error ?? ex.error
      if (erreurLecture) throw erreurLecture
      const c = {
        agences: (ag.data ?? []) as { code: string; nom: string }[],
        parcExistant: new Map((parc.data ?? []).map((p: Row) => [p.code as string, (p.chassis as string | null) ?? null] as [string, string | null])),
        grilleExistante: new Set((gr.data ?? []).map((g: Row) => String(g.reference).toLowerCase())),
        cleExistantes: new Set((ex.data ?? []).map((l: Row) =>
          [l.agence_code, l.code_parc ?? '', strip(l.designation), l.reference ?? '', Number(l.quantite), Number(l.prix_unitaire)].join('|')))
      }
      setRows(lues); setCtx(c)
      setRes(preparer(lues, c, { grille }))
    } catch (e) {
      toast('err', `Import impossible : ${erreur(e)}`)
      setNomFichier('')
    } finally { setOccupe(false) }
  }

  function changerGrille(v: boolean) {
    setGrille(v)
    if (rows && ctx) setRes(preparer(rows, ctx, { grille: v }))
  }

  async function importer() {
    if (!res) return
    setOccupe(true)
    const { data, error } = await supabase.rpc('importer_besoins', {
      p_cycle: cycle, p_vehicules: res.vehicules, p_grille: res.grille, p_lignes: res.lignes
    })
    setOccupe(false)
    if (error) return toast('err', erreur(error))
    toast('ok', `${data.lignes} lignes importées en brouillon (${data.vehicules} véhicules créés, ${data.fournisseurs} fournisseurs créés)`)
    onDone()
  }

  const r = res?.rapport
  return (
    <Modal title="Importer les besoins (feuille « Detail »)" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Importe le fichier au format « Urgence DML » ou le modèle V3, pour le cycle <strong>{cycle}</strong>. Les lignes arrivent en
          <strong> brouillon</strong> : priorité, OT et devis se complètent ensuite, et chaque règle de gestion joue à la soumission.
        </p>

        <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-4 cursor-pointer hover:border-brand-600">
          <FileSpreadsheet className="text-brand-600" />
          <span className="text-sm">{nomFichier || 'Choisir un fichier Excel (.xlsx)'}</span>
          <input type="file" accept=".xlsx,.xlsm,.xls" className="sr-only" onChange={e => e.target.files?.[0] && choisir(e.target.files[0])} />
        </label>

        {occupe && !res && <p className="text-sm text-slate-500">Lecture du fichier…</p>}

        {r && res && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Mini label="Lignes à importer" valeur={String(r.importees)} sous={fcfa(r.montant)} />
              <Mini label="Nouveaux véhicules" valeur={String(r.nouveauxVehicules)} sous={r.chassisCompletes ? `+ ${r.chassisCompletes} châssis complétés` : 'créés au parc'} />
              <Mini label="Doublons ignorés" valeur={String(r.doublons)} />
              <Mini label="Fournisseurs unifiés" valeur={String(Object.keys(r.fournisseursUnifies).length)} sous={`${res.fournisseurs.length} distincts`} />
            </div>

            {Object.keys(r.agencesInconnues).length > 0 && (
              <Alerte ton="rouge">Agences inconnues, lignes ignorées : {Object.entries(r.agencesInconnues).map(([k, n]) => `${k} (${n})`).join(', ')}</Alerte>
            )}
            {r.conflitsChassis.length > 0 && (
              <Alerte ton="rouge">
                <strong>{r.conflitsChassis.length} véhicule(s) avec plusieurs n° de châssis</strong> : le premier est retenu, à corriger dans le parc.
                <ul className="mt-1 font-mono text-xs">{r.conflitsChassis.map(c => <li key={c.code}>{c.code} : {c.chassis.join(' / ')}</li>)}</ul>
              </Alerte>
            )}
            <Alerte ton="orange">
              <strong>À compléter après l'import</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>{r.remisesSansOT} ligne(s) « remise en service » sans n° d'OT ou de panne (obligatoire à la soumission)</li>
                <li>{r.typeInfere} type(s) d'intervention déduits de l'état du véhicule ; priorité proposée (immobilisé = P1)</li>
                <li>{r.sansFournisseur} sans fournisseur · {r.plusieursFournisseurs} avec plusieurs fournisseurs sur la même ligne</li>
                <li>{r.prixManquants} sans prix unitaire · {r.sansCodeParc} sans code parc · {r.ecartsTotal} dont le total ne vaut pas quantité × prix (total recalculé)</li>
              </ul>
            </Alerte>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={grille} onChange={e => changerGrille(e.target.checked)} />
              <span>Alimenter la grille de prix avec le prix médian par référence présente au moins 2 fois ({res.grille.length} références) : active l'alerte « +15 % ».</span>
            </label>

            <Table head={['Agence', 'Lignes']}>
              {Object.entries(r.parAgence).sort().map(([a, n]) => (
                <tr key={a}><td className="px-3 py-1.5">{a}</td><td className="px-3 py-1.5 num">{nombre(n)}</td></tr>
              ))}
            </Table>

            <div className="flex justify-end gap-2 sticky bottom-0 bg-white pt-3">
              <Button variant="ghost" onClick={onClose}>Annuler</Button>
              <Button onClick={importer} disabled={occupe || r.importees === 0}>
                {occupe ? 'Import en cours…' : `Importer ${r.importees} lignes`}
              </Button>
            </div>
            <p className="text-xs text-slate-500">L'import est atomique : si une ligne est refusée par la base, rien n'est écrit.</p>
          </>
        )}
      </div>
    </Modal>
  )
}

function Mini({ label, valeur, sous }: { label: string; valeur: string; sous?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold num">{valeur}</p>
      {sous && <p className="text-xs text-slate-500">{sous}</p>}
    </div>
  )
}

function Alerte({ ton, children }: { ton: 'rouge' | 'orange'; children: React.ReactNode }) {
  const c = ton === 'rouge' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-amber-50 border-amber-200 text-amber-900'
  return <div role="alert" className={`rounded-lg border p-3 text-sm ${c}`}>{children}</div>
}

