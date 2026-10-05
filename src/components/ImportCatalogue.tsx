import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { supabase, erreur } from '../lib/supabase'
import { fcfa, nombre as nb } from '../lib/format'
import { cle, lireCatalogue, type Cell, type ResultatCatalogue } from '../lib/importCatalogue'
import { Button, Modal, useToast } from './ui'

export default function ImportCatalogue({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [nomFichier, setNomFichier] = useState('')
  const [res, setRes] = useState<ResultatCatalogue | null>(null)
  const [occupe, setOccupe] = useState(false)

  async function choisir(f: File) {
    setOccupe(true); setRes(null); setNomFichier(f.name)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true })
      const feuille = (nom: string) => {
        const n = wb.SheetNames.find(x => cle(x) === cle(nom))
        return n ? XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[n], { header: 1, raw: true, defval: null }) : null
      }
      const fe = feuille('Fournisseurs'), ar = feuille('Articles')
      if (!fe && !ar) throw new Error('Aucune feuille « Fournisseurs » ou « Articles » : utilisez le modèle fourni.')

      // ce que la base connaît déjà : noms et prix actuels
      const [fo, art] = await Promise.all([
        supabase.from('fournisseurs').select('id, raison_sociale'),
        supabase.from('articles_fournisseur').select('fournisseur_id, reference, prix_unitaire')
      ])
      if (fo.error) throw fo.error
      if (art.error) throw art.error
      const parId = new Map((fo.data ?? []).map(x => [x.id as number, x.raison_sociale as string]))
      const fournisseursExistants = new Map((fo.data ?? []).map(x => [cle(x.raison_sociale), x.raison_sociale as string]))
      const prixExistants = new Map((art.data ?? []).map(a => [`${cle(parId.get(a.fournisseur_id))}|${String(a.reference).toLowerCase()}`, Number(a.prix_unitaire)]))

      setRes(lireCatalogue(fe, ar, { fournisseursExistants, prixExistants }))
    } catch (e) {
      toast('err', `Lecture impossible : ${erreur(e)}`)
      setNomFichier('')
    } finally { setOccupe(false) }
  }

  async function importer() {
    if (!res) return
    setOccupe(true)
    const { data, error } = await supabase.rpc('importer_catalogue', { p_fournisseurs: res.fournisseurs, p_articles: res.articles })
    setOccupe(false)
    if (error) return toast('err', erreur(error))
    toast('ok', `${data.fournisseurs_crees} fournisseur(s) créé(s), ${data.fournisseurs_completes} complété(s), ${data.articles_crees} article(s) créé(s), ${data.articles_mis_a_jour} mis à jour (${data.prix_modifies} prix modifiés)`)
    onDone()
  }

  const bloque = !res || res.erreurs.length > 0
  return (
    <Modal title="Importer fournisseurs et articles" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Utilisez le <a className="text-brand-700 underline" href="/modeles/Modele_fournisseurs_articles.xlsx" download>modèle Excel</a> (feuilles Fournisseurs et Articles).
          Un fournisseur déjà connu est <strong>complété</strong>, jamais effacé ; un article déjà connu voit son prix mis à jour, l'ancien prix reste dans l'historique.
        </p>

        <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-4 cursor-pointer hover:border-brand-600">
          <FileSpreadsheet className="text-brand-600" />
          <span className="text-sm">{nomFichier || 'Choisir un fichier Excel (.xlsx)'}</span>
          <input type="file" accept=".xlsx,.xlsm,.xls" className="sr-only" onChange={e => e.target.files?.[0] && choisir(e.target.files[0])} />
        </label>
        {occupe && !res && <p className="text-sm text-slate-500">Lecture du fichier…</p>}

        {res && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Mini label="Fournisseurs" valeur={`${res.fournisseurs.length}`} sous={`${res.resume.fournisseursNouveaux} nouveau(x), ${res.resume.fournisseursConnus} complété(s)`} />
              <Mini label="Articles" valeur={`${res.articles.length}`} sous={`${res.resume.articlesNouveaux} nouveau(x), ${res.resume.articlesConnus} mis à jour`} />
              <Mini label="Prix modifiés" valeur={`${res.resume.prixModifies.length}`} />
              <Mini label="Erreurs" valeur={`${res.erreurs.length}`} sous={res.erreurs.length ? 'à corriger' : 'aucune'} />
            </div>

            {res.erreurs.length > 0 && (
              <Bloc ton="rouge" titre={`${res.erreurs.length} erreur(s) : corrigez le fichier puis réimportez`} lignes={res.erreurs} />
            )}
            {res.avertissements.length > 0 && (
              <Bloc ton="orange" titre={`${res.avertissements.length} avertissement(s) (n'empêchent pas l'import)`} lignes={res.avertissements} />
            )}
            {res.resume.prixModifies.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-medium mb-1">Prix qui vont changer</p>
                <ul className="space-y-0.5 text-slate-700 max-h-40 overflow-y-auto">
                  {res.resume.prixModifies.slice(0, 50).map((p, i) => (
                    <li key={i}>{p.fournisseur} · {p.reference} : {fcfa(p.ancien)} → <strong>{fcfa(p.nouveau)}</strong>
                      <span className={p.nouveau > p.ancien ? 'text-red-700' : 'text-brand-700'}> ({p.nouveau > p.ancien ? '+' : ''}{p.ancien ? Math.round((p.nouveau / p.ancien - 1) * 100) : 0} %)</span></li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2 sticky bottom-0 bg-white pt-3">
              <Button variant="ghost" onClick={onClose}>Annuler</Button>
              <Button onClick={importer} disabled={occupe || bloque}>
                {occupe ? 'Import en cours…' : bloque ? 'Corrigez les erreurs' : `Importer ${res.fournisseurs.length} fournisseur(s) et ${res.articles.length} article(s)`}
              </Button>
            </div>
            <p className="text-xs text-slate-500">L'import est atomique : si la base refuse une ligne, rien n'est écrit.</p>
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
      <p className="text-lg font-semibold num">{nb(Number(valeur))}</p>
      {sous && <p className="text-xs text-slate-500">{sous}</p>}
    </div>
  )
}

function Bloc({ ton, titre, lignes }: { ton: 'rouge' | 'orange'; titre: string; lignes: string[] }) {
  const c = ton === 'rouge' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-amber-50 border-amber-200 text-amber-900'
  return (
    <div role="alert" className={`rounded-lg border p-3 text-sm ${c}`}>
      <p className="font-medium">{titre}</p>
      <ul className="list-disc ml-5 mt-1 max-h-40 overflow-y-auto">
        {lignes.slice(0, 100).map((l, i) => <li key={i}>{l}</li>)}
        {lignes.length > 100 && <li>… et {lignes.length - 100} autres</li>}
      </ul>
    </div>
  )
}
