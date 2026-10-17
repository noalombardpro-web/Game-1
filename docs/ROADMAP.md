# Feuille de route

Légende : ✅ livré et testé · 🟡 partiel (existe, simplifié) · ⬜ non commencé

## Version 0.1 — prototype jouable (cette version)

- ✅ Terrain procédural streamé (tuiles 96 m, 3 niveaux de détail, génération en Web Worker).
- ✅ Biomes : fond de lac, montagnes enneigées, toundra, plateau rocheux, désert, jungle, marécage,
  forêt de conifères, forêt tempérée, prairie (10 biomes, configurables dans `data/biomes.json`).
- 🟡 Reliefs particuliers : collines, vallées et montagnes sont présentes ; canyons, cratères, grottes,
  volcans et réseaux souterrains ne sont pas encore générés.
- ✅ Végétation procédurale variée (8 familles, variantes, échelle, teinte, inclinaison, balancement au vent).
- ✅ Robot articulé (marche, course, saut, accroupissement, lampe, capteurs lumineux), caméra 3e/1re personne.
- ✅ Cycle jour/nuit, ciel atmosphérique, lune, étoiles, nuages ; météo par biome (pluie, neige, orage avec
  éclairs, tempête de sable, brouillard).
- ✅ Faune : 9 espèces, archétypes quadrupède/bipède/sauropode/volant, herbivores, prédateurs, troupeaux,
  fuite, sommeil nocturne, abreuvement, prédateur territorial agressif.
- ✅ Ennemis : drones sentinelles (mobiles) et tourelles automatiques ; états patrouille, investigation,
  alerte, combat, recherche, retraite ; détection progressive, sans connaissance triche de la position.
- ✅ Scanner (R), codex, collecte de ressources (E), inventaire à capacité, fabrication, 5 emplacements de modules.
- ✅ Rover : accélération, freinage, inertie, pente, collisions, énergie et coque, entrée/sortie (E).
- 🟡 Nage : flottaison en surface, vitesse réduite ; pas de plongée ni de véhicule sous-marin.
- ✅ Missions (4) et journal, POI (camp, ruines, épave), points de contrôle.
- ✅ Survie : énergie, intégrité, température des composants.
- ✅ Sauvegarde atomique avec sauvegarde de secours et somme de contrôle ; sauvegarde automatique (90 s).
- ✅ Interface : HUD, boussole, radar, carte, panneaux, réglages (sensibilité, inversion, FOV, volume,
  qualité, difficulté), commandes rebindables.
- ✅ Audio procédural : vent, pluie, pas par surface, moteur du rover, tonnerre, alarme.

## Version 0.2 — monde et écosystème

- ⬜ Canyons, cratères d'impact, grottes et réseaux souterrains (génération 3D ou entrées de grotte).
- ⬜ Rivières (réseau de drainage) et littoraux ; plongée et véhicules sous-marins ; épaves immergées.
- ⬜ Bancs de poissons (boids) dans les lacs ; faune abyssale ; insectes bioluminescents nocturnes.
- ⬜ Espèces extraterrestres (biomes 20 à 26 de la spécification) : forêt bioluminescente, désert, glace, volcan, lunes.
- ⬜ Plus de dinosaures : gros herbivores supplémentaires, espèces aquatiques, espèces de froid et d'aridité.
- ⬜ Animations de fuite et de combat plus détaillées (IK des pattes au sol, pas adaptatifs).
- ⬜ Boss uniques (aucun pour l'instant).

## Version 0.3 — construction, véhicules, espace

- ⬜ Construction de bases (abri, laboratoire, hangar, générateur, stockage) avec connexions énergétiques.
- ⬜ Défenses automatisées installables ; plateforme de lancement.
- ⬜ Véhicules supplémentaires : moto, transporteur lourd, drone de reconnaissance, appareil à décollage vertical.
- ⬜ Vaisseau spatial : décollage, atmosphère, orbite, navigation entre corps célestes avec transitions contrôlées.
- ⬜ Recentrage flottant (floating origin) pour les très grandes distances.

## Version 0.4 — contenu, optimisation, finition

- ⬜ Missions secondaires, contrats d'exploration, événements dynamiques, zones secrètes, objets rares.
- ⬜ Manette (Gamepad API) ; tactile ; textes en anglais.
- ⬜ Éclairage indirect et réflexions (environment map), ombres en cascade (CSM).
- ⬜ Optimisation des draw calls : fusion des instances par tuile et par matériau, grille d'herbe GPU.
- ⬜ Chargement en flux (IndexedDB) pour les sauvegardes volumineuses.
- ⬜ Tests visuels de non-régression (captures de référence) et tests de charge de la faune.

## État après l'expansion (prompt 2)

Fait : monde v2, 17 biomes, plongée, 25 espèces, IA étendue, véhicules, bases, espace, planète Cryos,
missions secondaires. À faire, dans l'ordre : (1) intérieurs de grottes (groupe d'intérieur décalé,
collisions sol/murs, créatures de grotte) ; (2) directeur d'événements aléatoires (signal, créature rare,
tempête, épave, anomalie) ; (3) ennemis : couverts, flanc, laisse ; (4) ambiances sous-marines ;
(5) tests e2e supplémentaires (construction via l'UI, fabrication à l'établi, plongée profonde) ;
(6) mesures GPU réelles et réduction des draw calls (169 en qualité basse).

## État après la mise à jour personnage / armes / construction

Fait : personnage humain animé (3 modèles, 12 tenues), vue 1re / 3e personne, 5 armes sci-fi avec
munitions et rechargement, jetpack, construction rapide sur grille (mur, sol, rampe, toit) avec édition
et effondrement, textures photographiques du terrain et des constructions, lacs d'eau douce,
18 nouvelles espèces.

À faire ensuite : animations dédiées (saut, nage, tir) au lieu des poses procédurales ; dégâts des
ennemis sur les constructions et couverture derrière les murs ; édition des rampes et toits ;
pièges ; textures CC0 en plus haute résolution (ambientCG / Poly Haven) et cartes de normales ;
mesures de performance sur GPU réel (le rendu logiciel des tests est passé de ~1,1 à ~0,5 image/s
avec les textures et les personnages ; le temps CPU de jeu est passé de ~5,5 à ~8,5 ms par image).
