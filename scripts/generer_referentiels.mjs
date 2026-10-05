// Génère supabase/seed_referentiels.sql à partir des fichiers Excel du dossier 00_REFERENTIELS
// (agences.xlsx, vehicules.xlsx, seuils.xlsx).
//
// Usage : node scripts/generer_referentiels.mjs [dossier]      (défaut : ../00_REFERENTIELS)
//
// Choix de nettoyage (visibles dans le SQL généré et dans le rapport) :
//  - les codes véhicules sont repris tels quels (majuscules, espaces simples) : on ne fusionne rien en silence ;
//  - les codes « INCONNUE » ne sont pas importés ;
//  - les quasi-doublons (même code aux espaces près) sont importés avec une remarque pour que la DML tranche ;
//  - les seuils du suivi des opérations sont rangés avec le préfixe « exploit_ » : ce ne sont pas des règles MAD.
import * as XLSX from 'xlsx'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
const dossier = process.argv[2] ?? join(racine, '..', '00_REFERENTIELS')
const lire = f => {
  const wb = XLSX.read(readFileSync(join(dossier, f)), { type: 'buffer' })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true })
}
const q = v => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

// Agences : nom du fichier -> code et libellé. Les 13 premières existent déjà dans le seed.
const CODES = {
  DOUALA: ['DLA', 'Douala'], YAOUNDE: ['YAO', 'Yaoundé'], KUMBA: ['KUM', 'Kumba'], KRIBI: ['KRI', 'Kribi'],
  BUEA: ['BUE', 'Buea'], LIMBE: ['LIM', 'Limbé'], BAFOUSSAM: ['BAF', 'Bafoussam'], BERTOUA: ['BER', 'Bertoua'],
  MAROUA: ['MAR', 'Maroua'], NGAOUNDERE: ['NGA', 'Ngaoundéré'], EDEA: ['EDE', 'Edéa'], EBOLOWA: ['EBO', 'Ebolowa'],
  SANGMELIMA: ['SAN', 'Sangmélima'],
  // sites absents du seed MAD (14 agences + DG) : à confirmer par la DG
  GAROUA: ['GAR', 'Garoua'], BANGANGTE: ['BGT', 'Bangangté'], BANGOU: ['BGU', 'Bangou'], MEYOMESSALA: ['MEY', 'Meyomessala']
}

const agences = lire('agences.xlsx')
const vehicules = lire('vehicules.xlsx')
const seuils = lire('seuils.xlsx')
const rapport = { agencesInconnues: [], ignores: [], quasiDoublons: [] }
const sql = []
const out = s => sql.push(s)

out('-- Généré par scripts/generer_referentiels.mjs à partir de 00_REFERENTIELS. À lancer après la migration 8.')
out('-- Relancer ce script est sans danger : les lignes existantes sont mises à jour, rien n\'est supprimé.\n')

// ---------- Agences ----------
out('-- Agences (pont bascule). Les 4 sites marqués « nouveau » n\'étaient pas dans le seed MAD.')
out('insert into agences(code, nom, pont_bascule) values')
const lignesAg = []
for (const a of agences) {
  const c = CODES[strip(a.agence)]
  if (!c) { rapport.agencesInconnues.push(a.agence); continue }
  lignesAg.push(`  (${q(c[0])}, ${q(c[1])}, ${q(a.pont_bascule)})`)
}
out(lignesAg.join(',\n'))
out('on conflict (code) do update set pont_bascule = excluded.pont_bascule;\n')

// ---------- Parc ----------
const compact = s => String(s).toUpperCase().replace(/\s+/g, '')
const parCompact = {}
for (const v of vehicules) (parCompact[compact(v.num_parking)] ??= []).push(v)

const lignesParc = []
for (const v of vehicules) {
  const code = strip(v.num_parking)
  if (!code || code === 'INCONNUE') { rapport.ignores.push(`${v.num_parking} (${v.agence})`); continue }
  const ag = CODES[strip(v.agence)]
  if (!ag) { rapport.agencesInconnues.push(v.agence); continue }
  const famille = strip(v.categorie) === 'ENGIN' ? 'Engin' : 'Camion'
  const memes = parCompact[compact(v.num_parking)].filter(x => x !== v)
  let remarque = null
  if (memes.length) {
    remarque = 'Doublon possible : ' + memes.map(x => `« ${x.num_parking} » (${x.agence})`).join(', ')
    rapport.quasiDoublons.push(`${code} (${v.agence}) ~ ${memes.map(x => `${x.num_parking} (${x.agence})`).join(', ')}`)
  }
  lignesParc.push(`  (${q(code)}, ${q(ag[0])}, ${q(famille)}, ${q(strip(v.type))}, ${q(remarque)})`)
}
out('-- Parc : camions et engins. L\'état est « Disponible » par défaut ; il passe à « Immobilisé » à l\'import des besoins.')
out('insert into parc(code, agence_code, famille, type_vehicule, remarque) values')
out(lignesParc.join(',\n'))
out('on conflict (code) do update set agence_code = excluded.agence_code, famille = excluded.famille,')
out('  type_vehicule = excluded.type_vehicule, remarque = excluded.remarque;\n')

// ---------- Seuils du suivi des opérations ----------
out('-- Seuils du suivi des opérations (préfixe exploit_) : conservés pour référence, sans effet sur les règles MAD.')
out('insert into parametres(cle, valeur, libelle) values')
out(seuils.map(s => `  (${q('exploit_' + s.parametre)}, ${Number(s.valeur)}, ${q('[Suivi des opérations] ' + s.description)})`).join(',\n'))
out('on conflict (cle) do nothing;')

writeFileSync(join(racine, 'supabase', 'seed_referentiels.sql'), sql.join('\n') + '\n', 'utf8')

console.log(`Agences : ${lignesAg.length} · Véhicules : ${lignesParc.length} · Seuils : ${seuils.length}`)
console.log('Agences inconnues :', rapport.agencesInconnues.length ? rapport.agencesInconnues.join(', ') : 'aucune')
console.log('Non importés :', rapport.ignores.join(', ') || 'aucun')
console.log(`Quasi-doublons signalés (${rapport.quasiDoublons.length}) :`)
rapport.quasiDoublons.forEach(x => console.log('  -', x))
