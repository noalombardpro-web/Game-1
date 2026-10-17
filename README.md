# PROJECT GENESIS

Prototype de jeu d'exploration et de survie en science-fiction, en monde ouvert, en 3D dans le navigateur
(Three.js + Vite). Le personnage (soldat, exploratrice ou civile) parcourt un monde procédural streamé, observe une faune
(herbivores, prédateurs, dinosaures), affronte des ennemis artificiels, pilote un rover, collecte et
fabrique, scanne les lieux et suit des missions facultatives.

> Choix du moteur : Unreal Engine 5 et Unity exigent un éditeur graphique et un GPU, indisponibles dans
> l'environnement de développement. Le prototype est donc web (Three.js), ce qui le rend exécutable et
> vérifiable. Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Installation et lancement

Prérequis : Node.js 20.19 ou plus récent, un navigateur avec WebGL 2 (Chrome, Edge, Firefox récent).

```bash
npm install            # installe three, vite, vitest, playwright-core
npm run dev            # serveur de développement sur http://127.0.0.1:5173
```

Build de production et prévisualisation :

```bash
npm run build          # génère dist/
npm run preview        # sert dist/ sur http://127.0.0.1:4173
```

Tests :

```bash
npm test               # tests unitaires (Vitest)
npm run test:e2e       # parcours de bout en bout dans Chromium headless (construit le projet, sert dist/)
```

Pour le test de bout en bout, un Chromium est requis. Par défaut le script utilise
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` ; définissez `CHROME_PATH` pour un autre binaire.

Premier lancement : cliquez sur « Nouvelle partie » (la graine est facultative : deux graines identiques
donnent le même monde). Cliquez dans la scène pour capturer la souris. Échap ouvre le menu de pause.

## Contrôles (par défaut, modifiables dans Paramètres)

| Action | Touche |
|---|---|
| Avancer / reculer / gauche / droite | W A S D (ou flèches) |
| Orientation | Souris (capturée après un clic) |
| Saut | Espace |
| Course (consomme de l'énergie) | Maj |
| Accroupir (bascule) | C |
| Interagir : collecter, ouvrir un conteneur, monter / descendre d'un véhicule | E |
| Lampe frontale | F |
| Scanner la cible dans le viseur (codex, missions) | R |
| Utiliser un consommable (recharge ou réparation selon le besoin) | U |
| Tirer (maintenir pour les armes automatiques) | Clic gauche |
| Viser / zoom (lunette du fusil à rail) | Clic droit |
| Armes 1 à 5 · outil de récolte · molette = arme suivante | 1–5 · 0 · molette |
| Recharger | Q |
| Jetpack : deuxième appui sur Espace en l'air, maintenir | Espace ×2 |
| Construction rapide (mur 1, sol 2, rampe 3, toit 4 ; clic droit = bois / pierre / métal) | G |
| Éditer la pièce visée (portes, fenêtres) | H |
| Garde-robe (tenues du personnage) | O |
| Inventaire / fabrication / modules | Tab |
| Carte | M |
| Journal de mission | J |
| Codex | K |
| Changer de caméra (3e personne ↔ 1re personne avec arme en main) | V |
| Performances (overlay) | F3 |
| Menu / fermer un panneau | Échap |

Touches ajoutées : **B** construire (Z/X pivoter, clic gauche poser, T démonter), **N** cible suivante
(vaisseau), **L** atterrir. En plongée : Espace remonte, C descend.
Véhicules (E pour monter / descendre) : W/S accélérer et freiner, A/D diriger, Maj turbo ; drone et
aéronef : Espace monte, C descend ; sous-marin : mêmes commandes, pilotage 3D ; vaisseau : voir ci-dessous.
Réparation / recharge d'un véhicule : U avec un kit de réparation / une cellule.

Les commandes sont listées et rebindables dans **Paramètres → Commandes** ; les modifications sont
stockées localement. Le fichier de référence est `data/controls.json`.

## Nouveautés (version 0.3)

- **Personnage humain** à la place du robot : soldat, exploratrice ou civile (modèles animés Mixamo :
  repos, marche, course, accroupi, saut, nage, visée), **12 tenues** au choix dans la garde-robe (O ou
  Échap → Garde-robe), vue **1re personne** (arme visible) ou **3e personne** (V). Le corps se tourne
  vers la visée.
- **Armes sci-fi** : pistolet plasma, fusil laser (automatique), fusil à impulsions (dispersion),
  fusil à rail (lunette), lance-roquettes (explosion de zone, dégâts aux constructions). Chargeurs,
  munitions à fabriquer (Tab → Fabrication), rechargement (Q), recul, zoom. Pistolet et fusil laser
  au départ ; les autres se fabriquent à l'établi / au laboratoire.
- **Jetpack** : second appui sur Espace en l'air, carburant qui se recharge au sol.
- **Construction rapide façon Fortnite** (G) : murs, sols, rampes et toits sur une grille de 4 m,
  trois matériaux (bois, pierre, métal) avec points de structure différents, construction en continu
  en maintenant le clic, **mode édition** (H) pour découper portes et fenêtres, effondrement des
  pièces qui ne touchent plus le sol, collisions (on marche sur les sols et rampes, les murs bloquent),
  sauvegarde. Matériaux récoltés avec l'outil de récolte (0) sur les arbres et rochers.
- **Textures photographiques** (CC-BY, voir `public/assets/CREDITS.md`) : sol en 7 couches (herbe, terre,
  sable, neige, terre sèche, lave émissive, roche) mélangées selon le biome et la pente ; bois, brique
  et métal pour les constructions.
- **Lacs d'eau douce** dans les plaines (nouveau biome, truites, flamants, crocodiles).
- **18 nouvelles espèces** (42 au total) : cheval, flamant, ara, cigogne et truite (modèles 3D animés),
  cerf, loup (meute), lièvre, ours, bison, crocodile, manchot, dromadaire, grenouille géante, aigle,
  scorpion géant, dauphin, renard polaire.

## Fonctionnalités opérationnelles

- **Monde** : continents, océans (plateau, abysses), archipels, canyons, volcans, cratères, pôles ; tuiles
  de 96 m streamées, trois LOD, génération en Web Workers. **17 biomes** (`data/biomes.json`) : abysses,
  forêt de kelp, récif corallien, fond de lac, volcanique, cratère, canyon, banquise, sommets enneigés,
  toundra, plateau rocheux, désert, jungle, marécage, forêt de conifères, forêt tempérée, prairie.
- **Points d'intérêt** (`data/world.json`) : camp, ruines, épave, installation abandonnée, laboratoire isolé,
  site de cratère, caverne, épave de récif, ruines englouties ; placés selon biome ; conteneurs à fouiller.
- **Personnage** : marche, course, saut, accroupi, nage 3D (plongée avec limite de pression, bulles), gestes
  d'outil (scan, collecte, réparation), usure de l'outil, 5+ emplacements de modules aux effets réels
  (course, blindage, scan, thermique, plongée, nage, saut, capacité, outils).
- **Faune** (25 espèces) : mammifères, reptiles, dinosaures, oiseaux/planeurs, essaims, faune marine
  (requins de récif, raies, poissons, baudroie), créatures extraterrestres. IA : états, vue/ouïe/occlusion,
  évitement du relief, abandon des chasses impossibles, abri contre la météo, recherche de nourriture,
  chasse en meute (encerclement), herbivores défensifs, traits individuels, simulation à fréquence réduite.
- **Ennemis** : drones et tourelles, patrouille/investigation/alerte/combat/recherche, non omniscients.
- **Véhicules** (`data/vehicles.json`) : rover, buggy, transport, drone, aéronef, sous-marin, vaisseau ;
  inertie, collisions, énergie, coque, réparation, caméra, sons.
- **Bases** (`data/structures.json`) : habitat, générateur, stockage, établi, laboratoire, garage, antenne,
  aire de lancement, tourelle ; réseaux d'énergie, stations de fabrication, soins, atelier, persistance.
- **Espace** : vaisseau pilotable (cockpit), orbite, station, champ d'astéroïdes (minage laser), épave,
  anomalie, seconde planète (Cryos, climat glacé) avec atterrissage, scan, amarrage, sauvegarde.
- **Inventaire / fabrication** : catégories, ressources communes et rares, recettes par établi
  (main < établi < laboratoire), modules niveau 2, kits de réparation, capacité extensible.
- **Missions** : chaîne principale (12 étapes) et six contrats secondaires, événements typés
  (reach, scan, craft, build, dive, kill, drive, land…), journal, récompenses.
- **Météo / environnement** : jour/nuit, pluie, orage, neige, brouillard, sable, cendres volcaniques ;
  rendu sous-marin et assombrissement en altitude.
- **Sauvegarde atomique** (somme de contrôle + secours) : personnage, inventaire, armes, constructions, missions, codex, véhicules,
  structures, planète courante et états des autres, session spatiale.
- **Interface** : HUD, boussole, radar (portée accrue avec antenne), carte, journal, codex, inventaire,
  panneaux construction/station, HUD véhicule et spatial, réglages (sensibilité, volume, qualité).
- **Audio procédural** (Web Audio), sans fichier externe.

## Fonctionnalités partielles ou absentes

Voir [docs/ROADMAP.md](docs/ROADMAP.md). Honnêtement :

- **Non implémenté** : intérieurs de grottes / réseaux souterrains (les cavernes sont des points d'intérêt
  de surface), événements aléatoires dynamiques (signaux, tempêtes, créatures rares), couverture et
  coordination avancée des ennemis, ambiances sous-marines sonores dédiées, manette, boss.
- **Partiel** : réalisme visuel (formes procédurales, pas de PBR photoréaliste), IA ennemie (pas de couverts),
  nombre de planètes (2), interactions entre espèces limitées à proie/prédateur.
- **Mesures de performance** : uniquement en rendu logiciel (SwiftShader, ~1 FPS) ; seul le temps CPU
  de jeu (~5 ms/frame) est significatif. Voir docs/PERFORMANCE.md.

## Résultats des tests

Derniers résultats obtenus dans l'environnement de développement :

- `npm test` : **8 fichiers, 90 tests unitaires, tous réussis** (graine, relief, biomes, POI, inventaire,
  missions, survie, sauvegarde, IA, véhicules, bases, espace).
- `npm run test:e2e` (Chromium headless, rendu logiciel) : **35 vérifications** — accueil, streaming,
  marche, saut, panneaux, météo, collecte, rover, **tour de 6 biomes, nage en mer, buggy et drone,
  placement de structures, décollage / vol / atterrissage du vaisseau**, scan, tir, mission, sauvegarde et
  reprise, console sans erreur. Dernier run : 34/35, seul échec = scan de créature (cible mobile, test
  aléatoire) ; relancé avec 25 essais au lieu de 12. Le placement de structures du dernier run vérifiait
  mal son résultat (corrigé, non relancé).
- Non couvert par un test automatisé : audio (aucun rendu sonore vérifiable en headless), capture de la
  souris (pointer lock), remappage des touches, manette, rendu sur GPU réel, parties longues (fuites mémoire).

## Performances

Les mesures détaillées, la méthode et les limites sont dans [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
Les chiffres de l'environnement de test (rendu logiciel, sans GPU) ne sont pas représentatifs d'un PC
équipé d'une carte graphique.

## Licences et ressources

- **Code du projet** : terrain, végétation, la plupart des créatures, bâtiments et sons sont générés
  par le code. Textures et modèles tiers : voir `public/assets/CREDITS.md` (CC-BY, Mixamo, three.js). Le projet est fourni sans licence
  de redistribution particulière pour l'instant.
- **Dépendances** (npm, voir `package.json`) :
  - `three` (0.186.1) — licence MIT, utilisée pour le rendu et l'addon `Sky`.
  - `vite` (8.3.4) — licence MIT, outil de build et serveur de développement.
  - `vitest` (5.0.5) — licence MIT, tests unitaires.
  - `playwright-core` (1.64.1) — licence Apache-2.0, pilotage de Chromium pour le test de bout en bout.
- **Polices** : polices système uniquement.

## Structure

```
index.html            page, HUD et écran d'accueil
data/                 contenu configurable (biomes, espèces, objets, missions/POI, ennemis, commandes)
src/app/              boucle principale (Game), entrées, réglages
src/world/            terrain, tuiles, végétation, POI, environnement, météo
src/entities/         personnage, armes, caméra, faune, ennemis, effets ; src/building/ construction rapide
src/ai/               machines à états, perception, navigation
src/systems/          survie, inventaire, missions, sauvegarde, scan
src/audio/ src/ui/ src/perf/
tests/unit/           tests unitaires
tests/e2e/            test de bout en bout
docs/                 architecture, performances, feuille de route
```
