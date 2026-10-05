// Lecture et contrôle du modèle « Fournisseurs / Articles » avant import.
// Sans dépendance à l'interface : testable seul. Les en-têtes sont ceux de
// scripts/generer_modele_fournisseurs.py (l'étoile des colonnes obligatoires est ignorée).

export type Cell = string | number | boolean | Date | null | undefined

export type FournisseurImport = {
  raison_sociale: string; niu: string | null; rccm: string | null; regime_fiscal: string | null
  assujetti_tva: boolean | null; centre_impots: string | null; adresse: string | null; ville: string | null
  telephone: string | null; email: string | null; contact_nom: string | null; banque: string | null
  numero_compte: string | null; national: boolean | null; remarque: string | null
}
export type ArticleImport = {
  fournisseur: string; reference: string; designation: string; unite: string | null
  prix_unitaire: number; date_prix: string | null; source: string | null; remarque: string | null
}

export type ContexteCatalogue = {
  fournisseursExistants: Map<string, string>   // clé sans accent/casse -> raison sociale en base
  prixExistants: Map<string, number>           // `${clé fournisseur}|${référence en minuscules}` -> prix
}

export type ResultatCatalogue = {
  fournisseurs: FournisseurImport[]
  articles: ArticleImport[]
  erreurs: string[]            // bloquent l'import
  avertissements: string[]     // à lire, ne bloquent pas
  resume: {
    fournisseursNouveaux: number; fournisseursConnus: number
    articlesNouveaux: number; articlesConnus: number
    prixModifies: { fournisseur: string; reference: string; ancien: number; nouveau: number }[]
  }
}

export const cle = (s: Cell) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const cleEntete = (s: Cell) => cle(s).replace(/[^A-Z]/g, '')

const REGIMES: Record<string, string> = { REEL: 'Réel', SIMPLIFIE: 'Simplifié', LIBERATOIRE: 'Libératoire', EXONERE: 'Exonéré', AUTRE: 'Autre' }
const SOURCES: Record<string, string> = { CATALOGUE: 'CATALOGUE', DEVIS: 'DEVIS', PROFORMA: 'PRO_FORMA', FACTURE: 'FACTURE' }
const NIU = /^[MP]\d{12}[A-Z]$/

const texte = (v: Cell): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

const ouiNon = (v: Cell): boolean | null | 'invalide' => {
  const s = cle(v)
  if (s === '') return null
  if (['OUI', 'O', 'YES', 'VRAI', 'TRUE', '1'].includes(s)) return true
  if (['NON', 'N', 'NO', 'FAUX', 'FALSE', '0'].includes(s)) return false
  return 'invalide'
}

export const nombre = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v === null || v === undefined || v === '') return null
  const x = parseFloat(String(v).replace(/[\s ]/g, '').replace(',', '.'))
  return Number.isFinite(x) ? x : null
}

// Dates : numéro de série Excel, objet Date ou texte jj/mm/aaaa ou aaaa-mm-jj
export function dateIso(v: Cell): string | null | 'invalide' {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'invalide' : v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    if (v < 36526 || v > 80000) return 'invalide'
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return valider(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return valider(+m[1], +m[2], +m[3])
  return 'invalide'
}
function valider(a: number, m: number, j: number): string | 'invalide' {
  const d = new Date(Date.UTC(a, m - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j
    ? d.toISOString().slice(0, 10) : 'invalide'
}

// ---------- Lecture d'une feuille à en-têtes ----------
function lireFeuille(aoa: Cell[][], requis: string[], nomFeuille: string) {
  const h = aoa.findIndex(r => requis.every(k => r.some(c => cleEntete(c) === k)))
  if (h < 0) throw new Error(`Feuille « ${nomFeuille} » : en-têtes ${requis.join(' / ')} introuvables`)
  const col: Record<string, number> = {}
  aoa[h].forEach((c, i) => { const k = cleEntete(c); if (k && col[k] === undefined) col[k] = i })
  const lignes: { n: number; get: (k: string) => Cell }[] = []
  aoa.slice(h + 1).forEach((r, i) => {
    if (!r.some(c => c !== null && c !== undefined && String(c).trim() !== '')) return
    lignes.push({ n: h + 2 + i, get: k => (col[k] === undefined ? null : r[col[k]]) })
  })
  return lignes
}

// ---------- Contrôle ----------
export function lireCatalogue(
  feuilleFournisseurs: Cell[][] | null,
  feuilleArticles: Cell[][] | null,
  ctx: ContexteCatalogue
): ResultatCatalogue {
  const res: ResultatCatalogue = {
    fournisseurs: [], articles: [], erreurs: [], avertissements: [],
    resume: { fournisseursNouveaux: 0, fournisseursConnus: 0, articlesNouveaux: 0, articlesConnus: 0, prixModifies: [] }
  }
  const err = (m: string) => res.erreurs.push(m)
  const avert = (m: string) => res.avertissements.push(m)

  // Noms retenus pour rattacher les articles : ceux de la base d'abord, sinon ceux de la feuille
  const noms = new Map<string, string>(ctx.fournisseursExistants)
  const niuVus = new Map<string, string>()
  const nomsFeuille = new Set<string>()

  // ----- Fournisseurs -----
  if (feuilleFournisseurs) {
    for (const l of lireFeuille(feuilleFournisseurs, ['RAISONSOCIALE'], 'Fournisseurs')) {
      const nom = texte(l.get('RAISONSOCIALE'))
      const pos = `Fournisseurs, ligne ${l.n}`
      if (!nom) { err(`${pos} : raison sociale manquante`); continue }
      const k = cle(nom)
      if (nomsFeuille.has(k)) { err(`${pos} : « ${nom} » apparaît deux fois dans le fichier`); continue }
      nomsFeuille.add(k)

      let niu = texte(l.get('NIU'))
      if (niu) {
        niu = niu.replace(/\s/g, '').toUpperCase()
        if (!NIU.test(niu)) avert(`${pos} : NIU « ${niu} » au format inhabituel (attendu : M ou P, 12 chiffres, 1 lettre)`)
        const autre = niuVus.get(niu)
        if (autre) { err(`${pos} : le NIU ${niu} est déjà celui de « ${autre} » : un NIU n'appartient qu'à un fournisseur`); continue }
        niuVus.set(niu, nom)
      }

      let regime: string | null = null
      const rb = texte(l.get('REGIMEFISCAL'))
      if (rb) {
        regime = REGIMES[cle(rb).replace(/[^A-Z]/g, '')] ?? null
        if (!regime) avert(`${pos} : régime fiscal « ${rb} » inconnu, ignoré (valeurs : ${Object.values(REGIMES).join(', ')})`)
      }
      const tva = ouiNon(l.get('ASSUJETTITVA'))
      const nat = ouiNon(l.get('NATIONAL'))
      if (tva === 'invalide') avert(`${pos} : « assujetti TVA » doit valoir Oui ou Non`)
      if (nat === 'invalide') avert(`${pos} : « national » doit valoir Oui ou Non`)
      const email = texte(l.get('EMAIL'))
      if (email && !/^\S+@\S+\.\S+$/.test(email)) avert(`${pos} : e-mail « ${email} » invalide`)

      const existant = ctx.fournisseursExistants.get(k)
      const raison = existant ?? nom.replace(/\s+/g, ' ')
      noms.set(k, raison)
      if (existant) res.resume.fournisseursConnus++; else res.resume.fournisseursNouveaux++

      res.fournisseurs.push({
        raison_sociale: raison, niu, rccm: texte(l.get('RCCM')), regime_fiscal: regime,
        assujetti_tva: tva === 'invalide' ? null : tva, centre_impots: texte(l.get('CENTREIMPOTS')),
        adresse: texte(l.get('ADRESSE')), ville: texte(l.get('VILLE')), telephone: texte(l.get('TELEPHONE')),
        email, contact_nom: texte(l.get('CONTACT')), banque: texte(l.get('BANQUE')),
        numero_compte: texte(l.get('NUMEROCOMPTE')), national: nat === 'invalide' ? null : nat, remarque: texte(l.get('REMARQUE'))
      })
    }
  }

  // ----- Articles -----
  const vus = new Map<string, number>()
  if (feuilleArticles) {
    for (const l of lireFeuille(feuilleArticles, ['FOURNISSEUR', 'REFERENCE'], 'Articles')) {
      const pos = `Articles, ligne ${l.n}`
      const fb = texte(l.get('FOURNISSEUR'))
      const ref = texte(l.get('REFERENCE'))?.replace(/\s+/g, ' ') ?? null
      const des = texte(l.get('DESIGNATION'))
      if (!fb) { err(`${pos} : fournisseur manquant`); continue }
      if (!ref) { err(`${pos} : référence manquante`); continue }
      if (!des) { err(`${pos} : désignation manquante`); continue }

      const k = cle(fb)
      const nom = noms.get(k)
      if (!nom) { err(`${pos} : fournisseur « ${fb} » inconnu (ni dans la feuille Fournisseurs, ni dans la base)`); continue }

      const prix = nombre(l.get('PRIXUNITAIREHT'))
      if (prix === null) { err(`${pos} : prix unitaire manquant ou illisible`); continue }
      if (prix < 0) { err(`${pos} : prix négatif`); continue }

      const d = dateIso(l.get('DATEPRIX'))
      if (d === 'invalide') { err(`${pos} : date du prix illisible (format jj/mm/aaaa attendu)`); continue }
      const sb = texte(l.get('SOURCE'))
      const source = sb ? SOURCES[cle(sb).replace(/[^A-Z]/g, '')] ?? null : null
      if (sb && !source) avert(`${pos} : source « ${sb} » inconnue, « Catalogue » retenu`)

      const dupKey = `${k}|${ref.toLowerCase()}`
      const deja = vus.get(dupKey)
      if (deja) { err(`${pos} : « ${ref} » déjà présent chez ${nom} à la ligne ${deja}`); continue }
      vus.set(dupKey, l.n)

      const ancien = ctx.prixExistants.get(dupKey)
      if (ancien === undefined) res.resume.articlesNouveaux++
      else {
        res.resume.articlesConnus++
        if (ancien !== prix) res.resume.prixModifies.push({ fournisseur: nom, reference: ref, ancien, nouveau: prix })
      }
      if (prix === 0) avert(`${pos} : prix à 0 FCFA pour « ${ref} »`)

      res.articles.push({
        fournisseur: nom, reference: ref, designation: des, unite: texte(l.get('UNITE'))?.toUpperCase() ?? null,
        prix_unitaire: prix, date_prix: d, source, remarque: texte(l.get('REMARQUE'))
      })
    }
  }

  if (res.fournisseurs.length === 0 && res.articles.length === 0 && res.erreurs.length === 0)
    err('Le fichier ne contient ni fournisseur ni article')
  return res
}
