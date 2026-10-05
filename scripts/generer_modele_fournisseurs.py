"""Génère public/modeles/Modele_fournisseurs_articles.xlsx : modèle d'import du catalogue fournisseurs.

Feuilles : Consignes, Fournisseurs (fiche fiscale), Articles (références et prix), Exemple, Listes.
Les en-têtes sont lus par src/lib/importCatalogue.ts : ne pas les renommer.
Usage : python scripts/generer_modele_fournisseurs.py
"""
from pathlib import Path
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

SORTIE = Path(__file__).resolve().parent.parent / "public" / "modeles" / "Modele_fournisseurs_articles.xlsx"
BLEU, ROUGE, GRIS, VERT = "1F4E79", "9C2B2B", "F2F2F2", "E2F0D9"
MAX = 1000  # lignes de saisie prévues

REGIMES = ["Réel", "Simplifié", "Libératoire", "Exonéré", "Autre"]
UNITES = ["U", "JEU", "KIT", "LOT", "L", "KG", "M", "M2", "M3", "H", "JOUR", "FORFAIT"]
SOURCES = ["Catalogue", "Devis", "Pro forma", "Facture"]
OUI_NON = ["Oui", "Non"]

# (en-tête, obligatoire, largeur, aide)
FOURNISSEURS = [
    ("RAISON_SOCIALE", True, 34, "Nom officiel, unique. C'est la clé : les articles s'y rattachent."),
    ("NIU", False, 18, "Numéro d'identifiant unique : une lettre (M ou P), 12 chiffres, une lettre. Ex. M071612345678A. Un NIU ne peut appartenir qu'à un fournisseur."),
    ("RCCM", False, 24, "Registre du commerce. Ex. RC/DLA/2015/B/1234"),
    ("REGIME_FISCAL", False, 16, "Choisir dans la liste."),
    ("ASSUJETTI_TVA", False, 14, "Oui / Non."),
    ("CENTRE_IMPOTS", False, 22, "Centre des impôts de rattachement."),
    ("ADRESSE", False, 30, ""),
    ("VILLE", False, 16, ""),
    ("TELEPHONE", False, 16, ""),
    ("EMAIL", False, 26, ""),
    ("CONTACT", False, 22, "Nom de la personne à contacter."),
    ("BANQUE", False, 18, ""),
    ("NUMERO_COMPTE", False, 24, "Numéro de compte ou RIB pour le paiement."),
    ("NATIONAL", False, 11, "Oui = prestataire national (MDI obligatoire au-delà de 2 M FCFA). Non par défaut = Oui."),
    ("REMARQUE", False, 30, ""),
]
ARTICLES = [
    ("FOURNISSEUR", True, 34, "Choisir dans la liste : elle reprend la feuille Fournisseurs. Un fournisseur déjà dans la base est aussi accepté."),
    ("REFERENCE", True, 20, "Référence constructeur ou code article. Majuscules et minuscules sont équivalentes."),
    ("DESIGNATION", True, 40, "Libellé de l'article ou du service."),
    ("UNITE", False, 10, "Choisir dans la liste. U par défaut."),
    ("PRIX_UNITAIRE_HT", True, 18, "Prix unitaire hors taxes, en FCFA. Nombre positif ou nul."),
    ("DATE_PRIX", False, 13, "Date du devis, de la facture ou du catalogue (jj/mm/aaaa). Aujourd'hui par défaut."),
    ("SOURCE", False, 12, "D'où vient le prix. Catalogue par défaut."),
    ("REMARQUE", False, 30, ""),
]

fin = Side(style="thin", color="BFBFBF")
cadre = Border(left=fin, right=fin, top=fin, bottom=fin)


def en_tetes(ws, colonnes):
    for i, (nom, oblig, larg, aide) in enumerate(colonnes, start=1):
        c = ws.cell(row=1, column=i, value=nom + (" *" if oblig else ""))
        c.fill = PatternFill("solid", fgColor=ROUGE if oblig else BLEU)
        c.font = Font(bold=True, color="FFFFFF")
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = cadre
        if aide:
            c.comment = Comment(aide, "MAD HYSACAM", width=320, height=110)
        ws.column_dimensions[get_column_letter(i)].width = larg
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A2"


def liste(ws, colonne, source, premiere=2, derniere=MAX, titre=None):
    dv = DataValidation(type="list", formula1=source, allow_blank=True, showErrorMessage=True,
                        errorTitle="Valeur non reconnue", error="Choisissez une valeur de la liste.")
    ws.add_data_validation(dv)
    dv.add(f"{colonne}{premiere}:{colonne}{derniere}")


wb = Workbook()

# ---------- Consignes ----------
ws = wb.active
ws.title = "Consignes"
ws.column_dimensions["A"].width = 24
ws.column_dimensions["B"].width = 100
ws["A1"] = "MODÈLE D'IMPORT DU CATALOGUE FOURNISSEURS"
ws["A1"].font = Font(bold=True, size=14, color=BLEU)
lignes = [
    ("But", "Renseigner les fournisseurs (identité et informations fiscales) et leurs articles avec les prix. "
            "Ces prix servent à vérifier les lignes de besoin et à alimenter la grille de prix (alerte au-delà de +15 %)."),
    ("Comment", "1. Remplissez la feuille Fournisseurs (une ligne par fournisseur).   2. Remplissez la feuille Articles (une ligne par article et par fournisseur).   "
                "3. Dans l'application : Fournisseurs > Importer Excel."),
    ("Colonnes obligatoires", "Elles sont en rouge et marquées d'une étoile : RAISON_SOCIALE (Fournisseurs) ; FOURNISSEUR, REFERENCE, DESIGNATION, PRIX_UNITAIRE_HT (Articles)."),
    ("Ne pas renommer", "Ne changez pas les en-têtes ni l'ordre des feuilles. Survolez un en-tête pour lire l'aide de la colonne."),
    ("Mise à jour", "Importer un fournisseur déjà connu (même NIU, sinon même raison sociale) le COMPLÈTE : une cellule vide n'efface jamais une information existante. "
                    "Importer un article déjà connu (même fournisseur et même référence) met à jour son prix ; l'ancien prix est conservé dans l'historique."),
    ("NIU", "Une lettre (M ou P), 12 chiffres, une lettre. Les espaces et les minuscules sont corrigés à l'import. Un NIU ne peut appartenir qu'à un seul fournisseur."),
    ("Contrôles à l'import", "Un aperçu s'affiche avant toute écriture. Sont bloquants : raison sociale ou référence manquante, prix invalide, fournisseur inconnu, "
                             "doublons dans le fichier, NIU partagé entre deux fournisseurs. Un NIU au format inhabituel est signalé sans bloquer."),
    ("Atomique", "Si une ligne est refusée par la base, rien n'est écrit : vous corrigez puis vous réimportez."),
    ("Prix", "Prix unitaire hors taxes, en FCFA. Une même référence peut avoir plusieurs fournisseurs : l'application compare leurs prix."),
    ("Exemple", "La feuille Exemple montre des lignes remplies. Elle n'est pas importée."),
]
for i, (a, b) in enumerate(lignes, start=3):
    ws.cell(row=i, column=1, value=a).font = Font(bold=True)
    c = ws.cell(row=i, column=2, value=b)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.cell(row=i, column=1).alignment = Alignment(vertical="top")
    ws.row_dimensions[i].height = 48

# ---------- Fournisseurs ----------
wf = wb.create_sheet("Fournisseurs")
en_tetes(wf, FOURNISSEURS)
col = {n: get_column_letter(i) for i, (n, *_r) in enumerate(FOURNISSEURS, start=1)}
liste(wf, col["REGIME_FISCAL"], "=Listes!$A$2:$A$6")
liste(wf, col["ASSUJETTI_TVA"], "=Listes!$D$2:$D$3")
liste(wf, col["NATIONAL"], "=Listes!$D$2:$D$3")
for r in range(2, MAX + 1):
    wf[f"{col['NIU']}{r}"].number_format = "@"        # texte : pas de notation scientifique
    wf[f"{col['TELEPHONE']}{r}"].number_format = "@"
    wf[f"{col['NUMERO_COMPTE']}{r}"].number_format = "@"

# ---------- Articles ----------
wa = wb.create_sheet("Articles")
en_tetes(wa, ARTICLES)
ca = {n: get_column_letter(i) for i, (n, *_r) in enumerate(ARTICLES, start=1)}
liste(wa, ca["FOURNISSEUR"], f"=Fournisseurs!$A$2:$A${MAX}")
liste(wa, ca["UNITE"], "=Listes!$B$2:$B$13")
liste(wa, ca["SOURCE"], "=Listes!$C$2:$C$5")
dv_prix = DataValidation(type="decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True, showErrorMessage=True,
                         errorTitle="Prix invalide", error="Saisissez un nombre positif ou nul (FCFA, hors taxes).")
wa.add_data_validation(dv_prix)
dv_prix.add(f"{ca['PRIX_UNITAIRE_HT']}2:{ca['PRIX_UNITAIRE_HT']}{MAX}")
dv_date = DataValidation(type="date", operator="greaterThan", formula1="36526", allow_blank=True, showErrorMessage=True,
                         errorTitle="Date invalide", error="Saisissez une date (jj/mm/aaaa).")
wa.add_data_validation(dv_date)
dv_date.add(f"{ca['DATE_PRIX']}2:{ca['DATE_PRIX']}{MAX}")
for r in range(2, MAX + 1):
    wa[f"{ca['PRIX_UNITAIRE_HT']}{r}"].number_format = "#,##0.##"
    wa[f"{ca['DATE_PRIX']}{r}"].number_format = "dd/mm/yyyy"

# ---------- Exemple ----------
we = wb.create_sheet("Exemple")
we["A1"] = "Exemple de feuille Fournisseurs (non importé)"
we["A1"].font = Font(bold=True, color=BLEU)
exf = [c[0] for c in FOURNISSEURS]
for j, n in enumerate(exf, start=1):
    c = we.cell(row=2, column=j, value=n)
    c.fill = PatternFill("solid", fgColor=BLEU); c.font = Font(bold=True, color="FFFFFF"); c.border = cadre
    we.column_dimensions[get_column_letter(j)].width = max(we.column_dimensions[get_column_letter(j)].width or 0, 18)
donnees_f = [
    ["PLANETE AUTO PLUS", "M071612345678A", "RC/DLA/2015/B/1234", "Réel", "Oui", "CDI Douala 1", "Rue Joss, Bonanjo", "Douala", "699000000",
     "ventes@planete-auto.example", "M. Nkono", "AFRILAND", "10005 00001 12345678901 23", "Oui", "Fournisseur principal pièces"],
    ["ETS KENFACK", "P098712345678B", "", "Simplifié", "Non", "CDI Bafoussam", "Marché A", "Bafoussam", "677000000", "", "", "", "", "Oui", ""],
]
for i, ligne in enumerate(donnees_f, start=3):
    for j, v in enumerate(ligne, start=1):
        c = we.cell(row=i, column=j, value=v); c.border = cadre; c.fill = PatternFill("solid", fgColor=VERT)
we["A7"] = "Exemple de feuille Articles (non importé)"
we["A7"].font = Font(bold=True, color=BLEU)
for j, (n, *_r) in enumerate(ARTICLES, start=1):
    c = we.cell(row=8, column=j, value=n)
    c.fill = PatternFill("solid", fgColor=BLEU); c.font = Font(bold=True, color="FFFFFF"); c.border = cadre
donnees_a = [
    ["PLANETE AUTO PLUS", "FIL-100", "Filtre à huile", "U", 10000, "05/10/2026", "Devis", ""],
    ["PLANETE AUTO PLUS", "PLQ-200", "Plaquettes de frein avant", "JEU", 50000, "05/10/2026", "Catalogue", ""],
    ["ETS KENFACK", "fil-100", "Filtre à huile", "U", 14000, "02/10/2026", "Facture", "Même article, autre fournisseur : les prix seront comparés"],
]
for i, ligne in enumerate(donnees_a, start=9):
    for j, v in enumerate(ligne, start=1):
        c = we.cell(row=i, column=j, value=v); c.border = cadre; c.fill = PatternFill("solid", fgColor=VERT)

# ---------- Listes ----------
wl = wb.create_sheet("Listes")
for j, (titre, valeurs) in enumerate([("REGIME_FISCAL", REGIMES), ("UNITE", UNITES), ("SOURCE", SOURCES), ("OUI_NON", OUI_NON)], start=1):
    c = wl.cell(row=1, column=j, value=titre)
    c.fill = PatternFill("solid", fgColor=BLEU); c.font = Font(bold=True, color="FFFFFF")
    wl.column_dimensions[get_column_letter(j)].width = 18
    for i, v in enumerate(valeurs, start=2):
        wl.cell(row=i, column=j, value=v)

SORTIE.parent.mkdir(parents=True, exist_ok=True)
wb.save(SORTIE)
print("Modele ecrit :", SORTIE)
