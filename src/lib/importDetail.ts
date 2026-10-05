// Import des besoins au format de la feuille « Detail » du fichier « Urgence DML » :
// FAMILLE | AGENCES | AFFECTATION | N°CHASSIS | ETAT | DESIGNATIONS | REFERENCE | QTE | PU HT | PTHT | FOURNISSEUR | ...
// Colonnes facultatives du modèle V3 : TYPE_INTERVENTION, NATURE, N°_OT_OU_PANNE, JUSTIFICATION, REF_DEVIS.
// Module sans dépendance à l'interface : testable seul.

export type Cell = string | number | boolean | null | undefined
export type RawRow = {
  n: number; famille: Cell; agence: Cell; affect: Cell; chassis: Cell; etat: Cell; desig: string
  ref: Cell; qte: Cell; pu: Cell; pt: Cell; fourn: Cell; selAg: Cell; selDg: Cell; obs: Cell
  type: Cell; nature: Cell; ot: Cell; justif: Cell; devis: Cell
}

export const strip = (s: Cell) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

const key = (v: Cell) => strip(v).replace(/[^A-Z]/g, '')

// ---------- Lecture de la feuille ----------
export function lireDetail(aoa: Cell[][]): RawRow[] {
  const h = aoa.findIndex(r => r.some(c => key(c) === 'FAMILLE') && r.some(c => key(c).startsWith('DESIGNATION')))
  if (h < 0) throw new Error('Feuille « Detail » introuvable : en-têtes FAMILLE / DESIGNATIONS absents')
  const col: Record<string, number> = {}
  aoa[h].forEach((c, i) => {
    const k = key(c)
    if (k === 'FAMILLE') col.famille = i
    else if (k === 'AGENCES' || k === 'AGENCE') col.agence = i
    else if (k === 'AFFECTATION') col.affect = i
    else if (k.includes('CHASSIS')) col.chassis = i
    else if (k === 'ETAT') col.etat = i
    else if (k.startsWith('DESIGNATION')) col.desig = i
    else if (k === 'REFERENCE') col.ref = i
    else if (k === 'QTE') col.qte = i
    else if (k === 'PUHT') col.pu = i
    else if (k === 'PTHT') col.pt = i
    else if (k === 'FOURNISSEUR') col.fourn = i
    else if (k === 'SELECTIONAG') col.selAg = i
    else if (k === 'SELECTIONDG') col.selDg = i
    else if (k === 'OBSERVATIONS') col.obs = i
    else if (k === 'TYPEINTERVENTION' || k === 'TYPE') col.type = i
    else if (k === 'NATURE') col.nature = i
    else if (k === 'NOTOUPANNE' || k === 'NOT' || k === 'OT') col.ot = i
    else if (k === 'JUSTIFICATION') col.justif = i
    else if (k === 'REFDEVIS' || k === 'DEVIS') col.devis = i
  })
  for (const k of ['famille', 'agence', 'desig'])
    if (col[k] === undefined) throw new Error(`Colonne obligatoire absente : ${k}`)

  const g = (r: Cell[], k: string): Cell => (col[k] === undefined ? null : r[col[k]])
  const rows: RawRow[] = []
  aoa.slice(h + 1).forEach((r, i) => {
    if (!r.some(c => c !== null && c !== undefined && c !== '')) return
    const desig = String(g(r, 'desig') ?? '').trim()
    if (!desig && !g(r, 'agence')) return
    rows.push({
      n: h + 2 + i, famille: g(r, 'famille'), agence: g(r, 'agence'), affect: g(r, 'affect'), chassis: g(r, 'chassis'),
      etat: g(r, 'etat'), desig, ref: g(r, 'ref'), qte: g(r, 'qte'), pu: g(r, 'pu'), pt: g(r, 'pt'), fourn: g(r, 'fourn'),
      selAg: g(r, 'selAg'), selDg: g(r, 'selDg'), obs: g(r, 'obs'), type: g(r, 'type'), nature: g(r, 'nature'),
      ot: g(r, 'ot'), justif: g(r, 'justif'), devis: g(r, 'devis')
    })
  })
  return rows
}

// ---------- Normalisations ----------
const CODE_PARC = /^([A-Z]{1,3}\d{2,3}(-\d{1,3})?|[A-Z]{2}\d{3}[A-Z]{2})$/
const STOCK_GENERIQUE = /^(STOCK|MAGASIN|GAMME|MIDLUM)/
const VEHICULES = ['Camion', 'Engin', 'VL', 'Moto']
const TYPES = ['Remise en service', 'Entretien préventif', 'Mise à niveau', 'Stock', 'Réglementaire', 'Fonctionnement']
const NATURES = ['Pièce', 'Prestation', 'Autre']

function normFamille(f: Cell, affect: Cell, estCode: boolean) {
  const s = strip(f)
  let fam = s.startsWith('CAMION') ? 'Camion' : s === 'ENGIN' ? 'Engin' : s === 'VL' ? 'VL' : s === 'MOTO' ? 'Moto'
    : s.startsWith('PERIPH') ? 'Périphérique' : 'Équipement'
  let inferee = false
  if (!estCode && VEHICULES.includes(fam)) { fam = STOCK_GENERIQUE.test(strip(affect)) ? 'Stock' : 'Équipement'; inferee = true }
  return { fam, inferee }
}

const normEtat = (e: Cell) => {
  const s = strip(e)
  return s.startsWith('IMMOBIL') ? 'Immobilisé' : s.startsWith('DISPONIBLE') ? 'Disponible' : 'Sans objet'
}

const VILLES = /^(LOCAL|DG|AUTRES?|KRIBI|BAFOUSSAM|NGAOUNDERE|DOUALA|YAOUNDE|BERTOUA|MAROUA|EDEA|BUEA|LIMBE|KUMBA|EBOLOWA|SANGMELIMA)$/

// Unifie les raisons sociales (constat C3 : « Planète », « Planete auto », « PLANETE AUTO PLUS »…)
export function normFourn(raw: Cell): { nom: string; multiple: boolean } {
  if (raw == null || String(raw).trim() === '') return { nom: '', multiple: false }
  let s = strip(raw).replace(/\(.*?\)/g, '').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
  let multiple = false
  if (s.includes('/')) { multiple = true; s = s.split('/')[0].trim() }
  const sansEts = s.replace(/^ETS\.? /, '')
  if (VILLES.test(sansEts)) return { nom: 'ACHAT LOCAL (À PRÉCISER)', multiple }
  if (/^PLANET(E)?( AUTO( PLUS)?)?$/.test(sansEts)) return { nom: 'PLANETE AUTO PLUS', multiple }
  if (/^PLANET(E)? TRADE$/.test(sansEts)) return { nom: 'PLANETE TRADE', multiple }
  if (/^DIL+AS( SARL)?$/.test(sansEts)) return { nom: 'DILAS SARL', multiple }
  if (/^TENKO( AUTOMOBILE)?$/.test(sansEts)) return { nom: 'ETS TENKO AUTOMOBILE', multiple }
  if (/^MISSAD$/.test(sansEts)) return { nom: 'ETS MISSAD', multiple }
  if (/^COLOR( CERAMICA)?$/.test(sansEts)) return { nom: 'COLOR CERAMICA', multiple }
  if (/^ESPACE MAINTENANCE$/.test(sansEts)) return { nom: 'ESPACE MAINTENANCE', multiple }
  if (/^(CGI|CAPI|SMARTRACK)/.test(sansEts)) return { nom: sansEts.split(' ')[0], multiple }
  const ets = /^(KENFACK|EMA|P&G|NAVAL|GLOBAL TRUCK|DIKASON|MOLA|PABLO|ARIEC|AGACO|FRANCO METAL|TSOPNANG|LE PARTENAIRE|AXELLE SERVICE)$/
  return { nom: s.startsWith('ETS ') ? s : ets.test(s) ? 'ETS ' + s : s, multiple }
}

export const nombre = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null || v === '') return null
  const x = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(x) ? x : null
}

const mediane = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ---------- Préparation de l'import ----------
export type Contexte = {
  agences: { code: string; nom: string }[]
  parcExistant: Map<string, string | null>   // code -> châssis connu
  grilleExistante: Set<string>
  cleExistantes: Set<string>          // lignes déjà présentes dans le cycle (agence|code|désignation|réf|qté|pu)
}

export type LigneImport = {
  ligne_excel: number; agence_code: string; code_parc: string | null; etat_vehicule: string
  type_intervention: string; nature: string; ot_panne: string | null; reference: string | null
  designation: string; quantite: number; prix_unitaire: number; fournisseur: string
  ref_devis: string | null; priorite: 'P1' | 'P2' | 'P3'; justification: string | null
}
export type VehiculeImport = { code: string; agence_code: string; famille: string; chassis: string | null; etat: string }

export type Resultat = {
  lignes: LigneImport[]
  vehicules: VehiculeImport[]
  fournisseurs: string[]
  grille: { reference: string; prix_plafond: number }[]
  rapport: {
    lus: number; importees: number; montant: number
    parAgence: Record<string, number>; agencesInconnues: Record<string, number>
    doublons: number; nouveauxVehicules: number; chassisCompletes: number; conflitsChassis: { code: string; chassis: string[] }[]
    fournisseursUnifies: Record<string, string>; sansFournisseur: number; plusieursFournisseurs: number
    prixManquants: number; ecartsTotal: number; typeInfere: number; sansCodeParc: number; remisesSansOT: number
  }
}

export function preparer(rows: RawRow[], ctx: Contexte, options: { grille: boolean }): Resultat {
  const nom2code: Record<string, string> = { DG: 'DG' }
  ctx.agences.forEach(a => { nom2code[strip(a.nom)] = a.code })

  const res: Resultat = {
    lignes: [], vehicules: [], fournisseurs: [], grille: [],
    rapport: {
      lus: rows.length, importees: 0, montant: 0, parAgence: {}, agencesInconnues: {}, doublons: 0, nouveauxVehicules: 0, chassisCompletes: 0,
      conflitsChassis: [], fournisseursUnifies: {}, sansFournisseur: 0, plusieursFournisseurs: 0, prixManquants: 0,
      ecartsTotal: 0, typeInfere: 0, sansCodeParc: 0, remisesSansOT: 0
    }
  }
  const r = res.rapport

  // châssis par code parc (constat C2 : plusieurs châssis pour un même véhicule)
  const chassisParCode: Record<string, Set<string>> = {}
  rows.forEach(x => {
    const c = strip(x.affect)
    if (nom2code[strip(x.agence)] && x.chassis && CODE_PARC.test(c)) (chassisParCode[c] ??= new Set()).add(String(x.chassis).trim())
  })

  const vus = new Set(ctx.cleExistantes)
  const vehiculesVus = new Set<string>()
  const fournisseurs = new Set<string>()
  const prixParRef: Record<string, number[]> = {}

  for (const x of rows) {
    const ag = nom2code[strip(x.agence)]
    if (!ag) { const k = String(x.agence ?? '(vide)'); r.agencesInconnues[k] = (r.agencesInconnues[k] ?? 0) + 1; continue }

    const aff = strip(x.affect)
    const estCode = CODE_PARC.test(aff)
    const code = estCode ? aff : null
    const { fam } = normFamille(x.famille, x.affect, estCode)
    let etat = normEtat(x.etat)

    const qte = nombre(x.qte) ?? 0
    const pu = nombre(x.pu) ?? 0
    const pt = nombre(x.pt)
    if (qte <= 0) continue                                  // une ligne sans quantité n'est pas importable
    if (!pu) r.prixManquants++
    if (pt != null && Math.abs(qte * pu - pt) > 1) r.ecartsTotal++

    const fo = normFourn(x.fourn)
    if (fo.multiple) r.plusieursFournisseurs++
    if (!fo.nom) r.sansFournisseur++
    else if (String(x.fourn).trim() !== fo.nom) r.fournisseursUnifies[String(x.fourn).trim()] = fo.nom

    const ref = x.ref == null || String(x.ref).trim() === '' ? null : String(x.ref).trim()
    const cle = [ag, code ?? String(x.affect ?? '').trim(), strip(x.desig), ref ?? '', qte, pu].join('|')
    if (vus.has(cle)) { r.doublons++; continue }
    vus.add(cle)

    // véhicule du référentiel
    if (code) {
      if (!vehiculesVus.has(code)) {
        vehiculesVus.add(code)
        const chs = [...(chassisParCode[code] ?? [])]
        const famille = VEHICULES.includes(fam) ? fam : 'Camion'
        if (!ctx.parcExistant.has(code)) {
          res.vehicules.push({ code, agence_code: ag, famille, chassis: chs[0] ?? null, etat })
          r.nouveauxVehicules++
        } else if (!ctx.parcExistant.get(code) && chs[0]) {
          // véhicule déjà au parc mais sans châssis : on le complète (la base ne remplace jamais un châssis existant)
          res.vehicules.push({ code, agence_code: ag, famille, chassis: chs[0], etat })
          r.chassisCompletes++
        }
        if (chs.length > 1) r.conflitsChassis.push({ code, chassis: chs })
      }
    } else r.sansCodeParc++

    // valeurs absentes de la feuille d'origine : déduites, à confirmer par la DML
    const stock = /^STOCK/.test(aff) || /^MAGASIN/.test(aff)
    let type = stock ? (/FONCTION/.test(aff) ? 'Fonctionnement' : 'Stock') : etat === 'Immobilisé' ? 'Remise en service' : 'Entretien préventif'
    const tSaisi = TYPES.find(t => strip(t) === strip(x.type))
    if (tSaisi) type = tSaisi; else r.typeInfere++
    if (type === 'Stock' || type === 'Fonctionnement') etat = 'Sans objet'

    const prestation = /REPARATION|REVISION|MAIN D.OEUVRE|LOCATION|PRESTATION|TRAVAUX|VISITE|METROLOGIE|ETALONNAGE|RENOVATION DE/.test(strip(x.desig))
    const nSaisie = NATURES.find(n => strip(n) === strip(x.nature))
    const nature = nSaisie ?? (ref ? 'Pièce' : prestation ? 'Prestation' : 'Autre')

    const ot = type === 'Remise en service' && x.ot != null && String(x.ot).trim() !== '' ? String(x.ot).trim() : null
    if (type === 'Remise en service' && !ot) r.remisesSansOT++

    const justif = x.justif != null && String(x.justif).trim() !== '' ? String(x.justif).trim()
      : x.obs != null && String(x.obs).trim() !== '' ? `[Import] ${String(x.obs).trim()}` : null

    res.lignes.push({
      ligne_excel: x.n, agence_code: ag, code_parc: code, etat_vehicule: etat, type_intervention: type, nature,
      ot_panne: ot, reference: ref, designation: x.desig, quantite: qte, prix_unitaire: pu, fournisseur: fo.nom,
      ref_devis: x.devis == null || String(x.devis).trim() === '' ? null : String(x.devis).trim(),
      priorite: etat === 'Immobilisé' ? 'P1' : type === 'Stock' || type === 'Fonctionnement' ? 'P3' : 'P2',
      justification: justif
    })
    if (fo.nom) fournisseurs.add(fo.nom)
    r.importees++; r.montant += qte * pu; r.parAgence[ag] = (r.parAgence[ag] ?? 0) + 1
    if (ref && pu) (prixParRef[ref] ??= []).push(pu)
  }

  res.fournisseurs = [...fournisseurs]
  if (options.grille)
    for (const [ref, p] of Object.entries(prixParRef))
      if (p.length >= 2 && !ctx.grilleExistante.has(ref.toLowerCase()))
        res.grille.push({ reference: ref, prix_plafond: Math.round(mediane(p)) })
  return res
}
