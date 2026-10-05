insert into agences(code, nom, grande, pilote) values
 ('DLA','Douala',true,false),('YAO','Yaoundé',true,false),('KUM','Kumba',false,false),
 ('KRI','Kribi',false,true),('BUE','Buea',false,false),('LIM','Limbé',false,false),
 ('BAF','Bafoussam',false,false),('BER','Bertoua',false,true),('MAR','Maroua',false,false),
 ('NGA','Ngaoundéré',false,false),('EDE','Edéa',false,true),('EBO','Ebolowa',false,false),
 ('SAN','Sangmélima',false,false),('DYP','Douala Youpwe',false,false),('DG','Direction Générale',false,false)
on conflict do nothing;

insert into parametres(cle, valeur, libelle) values
 ('seuil_devis', 250000, 'Devis ou pro forma obligatoire au-delà de (FCFA)'),
 ('part_max_p1', 0.40, 'Part maximale de la demande d''une agence en P1'),
 ('ecart_prix_alerte', 0.15, 'Écart de prix signalé par rapport à la grille'),
 ('seuil_etude_reforme', 5000000, 'Étude réforme / remplacement au-delà de (FCFA cumulés par véhicule)'),
 ('provision_imprevus', 0.10, 'Provision imprévus sur les lignes MDD'),
 ('plafond_mdd_petite', 1000000, 'Plafond MDD petites agences (FCFA)'),
 ('plafond_mdd_grande', 5000000, 'Plafond MDD Douala et Yaoundé (FCFA)'),
 ('seuil_mdi', 2000000, 'MDI obligatoire au-delà de (FCFA)'),
 ('taux_avance', 0.80, 'Taux d''avance (le solde de 20 % est suivi)'),
 ('seuil_recu_vise', 50000, 'Reçu visé accepté pour un achat local en dessous de (FCFA)'),
 ('delai_accuse_h', 48, 'Accusé de réception de la MAD (heures)'),
 ('delai_reponse_reaf_h', 72, 'Réponse DML à une réaffectation (heures) puis validation automatique'),
 -- À VALIDER par la DG : le cahier des charges parle de "seuil" sans le chiffrer
 ('seuil_reaf_dg', 2000000, 'PROVISOIRE : réaffectation soumise à la DG au-delà de (FCFA)')
on conflict do nothing;

insert into cycles(id) values ('2610') on conflict do nothing;
