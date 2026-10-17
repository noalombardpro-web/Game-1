# PROJECT GENESIS

Prototype de jeu d'exploration et de survie en science-fiction, en monde ouvert, en 3D dans le navigateur
(Three.js + Vite). Le robot explorateur parcourt un monde procédural streamé, observe une faune
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
| Interagir : collecter, ouvrir un conteneur, monter / descendre du rover | E |
| Lampe frontale | F |
| Scanner la cible dans le viseur (codex, missions) | R |
| Utiliser un consommable (recharge ou réparation selon le besoin) | U |
| Tir plasma (maintenir) | Clic gauche |
| Inventaire / fabrication / modules | Tab |
| Carte | M |
| Journal de mission | J |
| Codex | K |
| Changer de caméra (3e / 1re personne) | V |
| Performances (overlay) | F3 |
| Menu / fermer un panneau | Échap |

Dans le rover : W/S accélérer et freiner (marche arrière), A/D diriger, Maj turbo (consomme plus d'énergie).

Les commandes sont listées et rebindables dans **Paramètres → Commandes** ; les modifications sont
stockées localement. Le fichier de référence est `data/controls.json`.

## Fonctionnalités opérationnelles

- **Monde** : terrain procédural à partir d'une graine, tuiles de 96 m streamées autour du joueur, trois
  niveaux de détail, génération hors thread principal (Web Workers), jupes de jointure, collisions avec
  la végétation et les rochers.
- **Biomes** (10, définis dans `data/biomes.json`) : fond de lac, montagnes enneigées, toundra, plateau
  rocheux, désert, jungle, marécage, forêt de conifères, forêt tempérée, prairie.
- **Végétation** : huit familles (pins, feuillus, palmiers, cactus, arbustes, fougères, herbe, rochers),
  deux à trois variantes par famille, échelle, teinte et inclinaison aléatoires, balancement au vent.
- **Robot** : modèle articulé procédural, marche, course, saut, accroupissement, lampe, capteurs
  lumineux ; sol suivi, chute avec dégâts, nage en surface (vitesse réduite).
- **Environnement** : cycle jour/nuit (20 min), soleil et lune, ciel atmosphérique, étoiles, nuages,
  brouillard. **Météo** propre à chaque biome : ciel dégagé, nuageux, pluie, orage (éclairs et tonnerre),
  neige, brouillard, tempête de sable ; le vent influence la végétation et les particules.
- **Faune** (9 espèces, `data/species.json`) : herbivores grégaires qui broutent, boivent, dorment la nuit
  ou fuient ; curieux ; prédateurs qui patrouillent leur territoire et chassent ; un prédateur territorial
  attaque le joueur. Modèles procéduraux pour les archétypes quadrupède, bipède, sauropode et volant.
- **Ennemis** : drones sentinelles (patrouille, investigation, alerte, combat, recherche, retraite) et
  tourelles automatiques. Ils ne connaissent la position du joueur qu'en le voyant ou en l'entendant ;
  ils alertent leurs alliés. Difficulté facile / normal / difficile.
- **Ressources** : six types (minerai, silicate, cristal énergétique, composant électronique, matériau
  biologique, échantillon extraterrestre) selon le biome, collecte avec E.
- **Inventaire et fabrication** : capacité limitée (80 unités), sept recettes (`data/items.json`),
  cinq emplacements de modules dont les effets sont visibles (course, blindage, portée de scan, survie
  thermique, butin).
- **Rover** : accélération, freinage, inertie, pente, suspension suivant le terrain, collisions, énergie
  et coque, entrée et sortie avec E, moteur audio dépendant de la vitesse.
- **Scan et codex** : R identifie faune, ennemis, ressources, points d'intérêt et le rover.
- **Points d'intérêt** : camp de l'expédition (balise), ruines pré-humaines (tourelles, inscriptions),
  épave de navette (conteneur à fouiller une fois).
- **Missions** : quatre missions en étapes (signal, faune, énergie, ruines) avec journal et récompenses.
- **Survie** : énergie, intégrité, température des composants (biome, jour/nuit, altitude). Réactivation
  au dernier point sûr après une destruction.
- **Sauvegarde** : manuelle (Échap → Sauvegarder) et automatique (90 s). Écriture atomique : nouvelle
  sauvegarde vérifiée par somme de contrôle, sauvegarde précédente conservée comme secours, la sauvegarde
  principale n'est remplacée qu'en fin de processus. Position, robot, inventaire, modules, missions,
  codex, ressources collectées, rover, heure du jour.
- **Interface** : HUD (énergie, intégrité, température, boussole, radar, invite contextuelle, objectif),
  carte colorée par biome, journal, codex, inventaire, fabrication, modules, réglages (sensibilité,
  inversion Y, champ de vision, volume, qualité graphique, difficulté, commandes rebindables).
- **Audio procédural** (Web Audio) : vent, pluie, pas adaptés à la surface, moteur du rover, tonnerre,
  alarme des ennemis, impacts. Aucun fichier audio externe.

## Fonctionnalités partielles ou absentes

Voir [docs/ROADMAP.md](docs/ROADMAP.md) pour le détail et le calendrier. En résumé :

- **Non implémenté** : exploration sous-marine complète (plongée, véhicules sous-marins), espace (vaisseau,
  orbites, planètes multiples), construction de bases, biomes extraterrestres, canyons, grottes, volcans,
  boss, bancs de poissons, missions secondaires, manette.
- **Partiel** : nage (flottaison en surface uniquement), relief (collines, vallées et montagnes seulement),
  faune (9 espèces, pas de faune marine), missions (4 étapes principales), audio (pas de musique adaptative
  complète, les ambiances sont synthétisées).

## Résultats des tests

Derniers résultats obtenus dans l'environnement de développement :

- `npm test` : **4 fichiers, 49 tests unitaires, tous réussis** (reproductibilité de la graine, bruit, relief,
  génération de tuiles, variation de la végétation, inventaire et fabrication, missions, survie,
  sauvegarde atomique et récupération, perception et navigation, IA des drones et de la faune).
- `npm run test:e2e` : **27 vérifications sur 27 réussies** dans Chromium headless (rendu logiciel) :
  écran d'accueil, streaming de 81 tuiles, faune et ennemis présents, marche, saut, adhérence au terrain,
  inventaire, pause, carte / journal / codex / réglages, météo (pluie, sable, neige), collecte avec E,
  rover (monter, conduire, descendre), scan d'une créature avec entrée au codex, tir sur une créature,
  atteinte du camp, scan de la balise et fin de la première mission avec récompense, sauvegarde puis
  « Continuer » avec restauration de la position, des missions et de l'inventaire, absence d'erreur
  dans la console. Des captures sont écrites dans `tests/e2e/out/` (ignoré par git).
- Non couvert par un test automatisé : audio (aucun rendu sonore vérifiable en headless), capture de la
  souris (pointer lock), remappage des touches, manette, rendu sur GPU réel, parties longues (fuites mémoire).

## Performances

Les mesures détaillées, la méthode et les limites sont dans [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
Les chiffres de l'environnement de test (rendu logiciel, sans GPU) ne sont pas représentatifs d'un PC
équipé d'une carte graphique.

## Licences et ressources

- **Code du projet** : tout le code et tout le contenu (terrain, végétation, créatures, bâtiments,
  sons) sont générés par le code ; aucun asset tiers n'est utilisé. Le projet est fourni sans licence
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
src/entities/         robot, caméra, faune, ennemis, rover, effets
src/ai/               machines à états, perception, navigation
src/systems/          survie, inventaire, missions, sauvegarde, scan
src/audio/ src/ui/ src/perf/
tests/unit/           tests unitaires
tests/e2e/            test de bout en bout
docs/                 architecture, performances, feuille de route
```
