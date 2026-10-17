# Architecture — PROJECT GENESIS

## Choix du moteur

| Option | Décision | Raison |
|---|---|---|
| Unreal Engine 5 | Non retenu | Éditeur et GPU requis ; l'environnement de développement est un conteneur Linux sans GPU ni écran. |
| Unity | Non retenu | Même contrainte (éditeur graphique, licence, pas de build headless fiable ici). |
| Three.js + Vite (navigateur) | **Retenu** | Exécutable et vérifiable de bout en bout (Chromium headless fourni), dépendances npm disponibles via le proxy, WebGL 2, Web Workers pour la génération. |

Conséquence : le jeu est un prototype navigateur. Il ne prétend pas égaler un jeu AAA sous UE5. Les contraintes du navigateur sont prises en compte : génération hors thread principal, streaming par tuiles, LOD, nombre de draw calls surveillé (overlay F3).

## Couches

```
src/
├── core/        Mathématiques, RNG déterministe (hash + mulberry32), bruit simplex/fBm. Sans dépendance.
├── world/       Terrain procédural, biomes, génération de tuiles (pure), workers, maillages, streaming,
│                végétation, POI, ciel/environnement, météo.
├── ai/          Machine à états, perception (vue/ouïe/occlusion), navigation sur le terrain.
├── entities/    Joueur, caméra, modèle du robot, faune (archétypes), ennemis, rover, effets.
├── systems/     Survie, inventaire/fabrication, missions, scan (raycast), sauvegarde, données.
├── audio/       Audio procédural (Web Audio API), sans fichiers externes.
├── ui/          HUD, radar, boussole, panneaux (inventaire, carte, journal, codex, réglages, pause).
├── perf/        Mesure des temps de trame et statistiques du renderer.
├── app/         Entrées (clavier/souris, rebinding), réglages, orchestrateur (Game).
└── main.js      Point d'entrée.
data/            Contenu configurable : biomes, espèces, objets/recettes, missions/POI, ennemis, commandes.
tests/unit/      Tests unitaires (Vitest) sur la logique pure.
tests/e2e/       Test de bout en bout dans Chromium headless.
```

Règle de séparation : tout ce qui se trouve dans `core/`, `world/terrain.js`, `world/chunkGenerator.js`,
`ai/`, `systems/` (hors `save.js`/`raycast.js`) et `data` est sans dépendance au rendu. Il est donc
testable et exécuté aussi bien dans le worker que dans les tests.

## Flux de données

1. `Game.startGame()` charge la sauvegarde ou crée une graine (`seedFromString`) ; `buildWorld()` assemble
   le terrain, l'environnement, le joueur, la faune, les ennemis, le rover et les POI.
2. Chaque trame : `World.update()` demande les tuiles manquantes (rayon selon la qualité). Les workers
   (`chunkWorker.js`) appellent `generateChunk()` et renvoient des tableaux typés. Le thread principal
   construit au plus 2 maillages par trame (`chunkMesh.js`).
3. La simulation est à pas fixe (1/30 s, sous-pas si la trame est lente) : joueur → rover → survie →
   météo/environnement → faune → ennemis → missions → audio → caméra.
4. Le HUD reçoit un instantané (`hudState()`), les panneaux reçoivent `panelData()`.
5. Sauvegarde : `snapshot()` → `SaveManager.write()` (écriture atomique, voir ci-dessous).

## Simulation à distance

- Faune : tout animal à moins de 110 m est simulé à chaque pas ; au-delà, seule une marche simplifiée
  est exécutée à 2 Hz (`CreatureManager.update`). Les modèles 3D ne sont créés qu'en dessous de 120 m.
- Ennemis : les modèles ne sont créés qu'en dessous de 160 m ; la logique reste active (6 unités).
- Tuiles : LOD 0 (48 segments, 2 m) à ≤ 2 tuiles, LOD 1 (24 segments) à ≤ 4, LOD 2 (12 segments) au-delà.
  La végétation et les ressources n'existent qu'en LOD 0. Des jupes (« skirts ») masquent les jointures.

## Sauvegarde atomique

`SaveManager.write()` : (1) écrit la sauvegarde dans une clé temporaire, (2) la relit et vérifie la somme
de contrôle FNV-1a, (3) copie l'ancienne sauvegarde dans la clé de secours, (4) remplace la clé principale,
(5) supprime la temporaire. Un échec à n'importe quelle étape laisse la dernière sauvegarde valable.
`read()` tente la clé principale puis la clé de secours et valide le schéma (`validateSave`).

## Déterminisme

Le terrain, la végétation, les ressources, les POI et les spawns de faune dérivent de la graine. La même
graine et les mêmes coordonnées donnent les mêmes données (testé dans `tests/unit/world.test.js`). Le
comportement dynamique (IA, météo) utilise `Math.random` ou un RNG de session et n'est pas figé.

## Limites techniques connues

- Précision flottante : les coordonnées restent en nombres JavaScript et les positions GPU en float32 ;
  aucun recentrage (« floating origin ») n'est encore implémenté. Au-delà de quelques dizaines de km,
  il faudra le recentrage.
- La hauteur analytique (`terrain.height`) et le maillage LOD 0 concordent aux sommets, mais entre deux
  sommets l'écart est de quelques centimètres.

## Ajouts (expansion)

- `src/vehicles/` : `Vehicle` (ground/air/sub) et `VehicleManager`, configurés par `data/vehicles.json`.
- `src/bases/` : `BaseManager` (placement, réseau d'énergie par portée, stations, services).
- `src/space/` : `SpaceSession` (scène spatiale séparée, modèle de vol, corps célestes, collisions, minage).
- `Game.buildGlobals / buildWorld(planetId)` : état partagé vs monde propre à une planète ; les états des
  planètes quittées sont gardés dans `planetStates` et sauvegardés.

## Personnage, armes, construction

- `src/entities/modelLibrary.js` charge les glTF de `public/assets/models` (préchargés au démarrage).
- `src/entities/characterModel.js` : modèle Mixamo, mélange des clips repos / marche / course, poses
  procédurales en espace monde (visée, accroupi, saut, nage) ; orientation lue sur le squelette.
- `src/systems/weapons.js` (logique pure, testée) et `src/app/arsenal.js` (méthodes ajoutées à `Game` :
  tir, roquettes, récolte, vue 1re personne, construction et édition).
- `src/building/pieces.js` (logique pure, testée : grille, coûts, surfaces praticables, collisions,
  effondrement) et `pieceMeshes.js` (rendu). Le monde consulte la grille via `world.groundAt`,
  `world.ceilingAt` et `world.resolveCollisions`.
- Terrain : `materials.js` mélange 7 textures selon des poids par sommet (`surfA`, `surfB`) calculés
  par `chunkGenerator.js` à partir du champ `surface` de chaque biome.
