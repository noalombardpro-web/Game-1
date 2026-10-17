# Performances

## Ce qui est mesuré, et comment

- **Outil intégré** : `F3` affiche l'overlay (FPS, temps moyen et p95 d'une trame, temps CPU de la
  mise à jour, temps de soumission du rendu, draw calls, triangles, géométries, textures, nombre de
  tuiles, faune et ennemis). Source : `src/perf/profiler.js`.
- **Test automatisé** : `npm run test:e2e` joue le jeu dans Chromium headless, mesure les trames pendant
  8 s et enregistre le rapport dans `tests/e2e/out/report.json`.

## Résultats de l'environnement de développement

> **Avertissement important.** Cet environnement n'a pas de GPU : Chromium rend en WebGL logiciel
> (SwiftShader, CPU). Les FPS ci-dessous mesurent ce rendu logiciel, **pas** les performances sur un PC
> avec carte graphique, et ne permettent pas de conclure que l'objectif de 60 FPS est atteint. Seuls les
> volumes de travail (draw calls, triangles, temps CPU du jeu) sont indicatifs.

Dernière exécution de `npm run test:e2e` (qualité basse, 960×540, Chromium headless, rendu logiciel) :

| Mesure | Valeur |
|---|---|
| Rendu | ANGLE / SwiftShader (CPU), aucun GPU |
| Réglages | qualité basse : rayon de 4 tuiles, végétation à 50 %, carte d'ombres 512 |
| FPS mesuré | 1,3 (trame moyenne 967 ms, p95 1 883 ms) |
| **CPU du jeu par trame** (simulation, IA, HUD) | **4,5 ms** |
| Soumission du rendu par trame (inclut la rasterisation logicielle) | 80,7 ms |
| Draw calls | 216 |
| Triangles | ≈ 135 000 |
| Géométries / textures | 277 / 7 |

Lecture : la logique du jeu (simulation de la faune et des ennemis, physique, interface) coûte environ
4,5 ms par trame sur le CPU de test, soit une petite fraction du budget de 16,7 ms visé pour 60 FPS. Tout
le reste du temps de trame mesuré ici est de la rasterisation logicielle qu'un GPU réel exécuterait en
parallèle et beaucoup plus vite. Cela **ne prouve pas** que 60 FPS est atteint sur un PC : cette mesure
reste à faire sur une machine équipée d'une carte graphique.

## Volume de travail selon la qualité

Les valeurs ci-dessus sont celles de la qualité basse. Selon la position, le test relève de 190 à 250
draw calls et de 130 000 à 180 000 triangles. La qualité moyenne (par défaut) et la qualité haute
augmentent la distance d'affichage (rayon de 5 et 6 tuiles), la densité de végétation (80 % et 100 %) et la
taille de la carte d'ombres (1024 et 2048) ; elles n'ont pas été mesurées sur GPU.

## Mesures de conception en faveur des performances

| Mesure | Détail |
|---|---|
| Génération hors thread principal | Jusqu'à 3 Web Workers ; le thread principal construit au plus 2 maillages par trame. |
| Niveaux de détail | Tuiles à 48, 24 et 12 segments selon la distance ; jupes pour masquer les jointures. |
| Instanciation | Végétation et rochers en `InstancedMesh` ; calcul de la sphère englobante par instance pour le culling. |
| Détail seulement près du joueur | Végétation, ressources et faune uniquement sur les tuiles LOD 0. |
| Simulation à distance | Faune éloignée à 2 Hz sans perception ; modèles créés à moins de 120 m ; ennemis visibles à moins de 160 m. |
| Ombres limitées | La carte d'ombres suit le joueur sur 120 m ; seuls les arbres, palmiers et cactus projettent des ombres. |
| Pas de simulation à 1/30 s | Sous-pas : le temps de jeu suit le temps réel même si la trame est lente. |
| Qualité réglable | Trois préréglages (distance d'affichage, densité, ombres, résolution) dans les réglages. |

## Limites connues et pistes

- Le nombre de draw calls croît avec le nombre de tuiles LOD 0 × familles de végétation présentes ; la
  fusion des instances par matériau (voir la feuille de route) devrait le réduire nettement.
- Les ombres couvrent une zone restreinte (120 m) : au-delà, la végétation n'a pas d'ombre portée.
- Aucune mesure sur GPU réel n'a pu être faite ici : à valider sur une machine cible (60 FPS visés en qualité moyenne).
