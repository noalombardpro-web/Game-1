// Player gear on foot, installed on Game.prototype: weapons (hitscan and rockets), harvesting tool,
// first-person view model, aiming / zoom, grid building with edit mode, and the character skin.
import * as THREE from 'three';
import { Weapons, stepProjectile, blastDamage } from '../systems/weapons.js';
import { BuildGrid, placementFor, pieceKey, pieceBounds, cellAt, EDIT_GRID, MATERIALS, MATERIAL_ORDER, PIECE_TYPES, PIECE_NAMES } from '../building/pieces.js';
import { PieceRenderer, createGhostMesh, createEditOverlay } from '../building/pieceMeshes.js';
import { createWeaponMesh } from '../entities/weaponModels.js';
import { raySphere, rayTerrain } from '../systems/raycast.js';

const HARVEST_DAMAGE_TO_PIECES = 50;
const EDIT_REACH = 7;
const tmp = new THREE.Vector3();

export const arsenalMethods = {
  /** Gear shared by every planet: weapons, magazines, skin. Called from buildGlobals. */
  initArsenal(data) {
    const content = this.content;
    // New game, or a save from before weapons existed: hand out the starting kit once.
    if (!data?.weapons) {
      for (const [id, n] of Object.entries(content.weapons.start)) this.inventory.add(id, n);
    }
    this.weapons = new Weapons(content.weapons, this.inventory, data?.weapons);
    this.harvested = new Map();
    this.gridMode = null;
    this.editing = null;
    this.aimHold = 0;
    this.recoil = 0;
    this.projectiles = [];
  },

  /** Per-planet part: building grid, its meshes, the view model and the character. Called from buildWorld. */
  initArsenalWorld(s) {
    this.pieceRenderer?.dispose();
    this.grid = new BuildGrid(s?.grid ?? []);
    this.world.buildGrid = this.grid;
    this.pieceRenderer = new PieceRenderer(this.scene);
    this.pieceRenderer.sync(this.grid);
    for (const p of this.projectiles) p.mesh?.removeFromParent();
    this.projectiles = [];
    this.gridGhost = null;
    this.editOverlay = null;
    this.gridMode = null;
    this.editing = null;
    // The camera carries the first-person view model, so it has to be part of the scene graph.
    this.scene.add(this.camera);
    if (!this.viewmodel) {
      this.viewmodel = new THREE.Group();
      this.viewmodel.name = 'view model';
      this.viewmodelLight = new THREE.PointLight('#ffffff', 0.6, 2);
      this.viewmodelLight.position.set(0.2, 0.1, 0.2);
      this.viewmodel.add(this.viewmodelLight);
    }
    this.camera.add(this.viewmodel);
    this.applySkin();
    this.equipVisuals();
  },

  skinDef() {
    const skins = this.content.skins;
    return skins.skins.find((k) => k.id === this.settings.skin) ?? skins.skins.find((k) => k.id === skins.default);
  },

  applySkin() {
    this.player?.model.setSkin(this.skinDef());
  },

  setSkin(id) {
    if (!this.content.skins.skins.some((k) => k.id === id)) return;
    this.settings.skin = id;
    this.applySettings();
    this.applySkin();
    this.equipVisuals();
    this.ui.toast(`Tenue : ${this.skinDef().name}`, 'good');
    this.refreshPanel();
  },

  /** Rebuilds the weapon meshes (hand and view model) for the current weapon. */
  equipVisuals() {
    const id = this.weapons.current;
    const def = this.weapons.def;
    if (this.viewWeapon) this.viewmodel.remove(this.viewWeapon);
    this.viewWeapon = null;
    if (!id) {
      this.player?.model.setWeapon(null);
      return;
    }
    const color = def?.color ?? '#7fe9ff';
    this.player?.model.setWeapon(createWeaponMesh(id, color));
    const vm = createWeaponMesh(id, color);
    vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 10; } });
    // Barrel along the camera's -Z, held low on the right.
    vm.rotation.y = Math.PI;
    vm.scale.setScalar(0.7);
    vm.position.set(0.2, -0.2, -0.42);
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: '#3a3f2c', roughness: 0.9 }));
    glove.position.set(0, -0.05, 0);
    vm.add(glove);
    this.viewWeapon = vm;
    this.viewmodel.add(vm);
  },

  /** Runs every simulation step while on foot (weapons, building, editing, projectiles). */
  updateArsenal(dt) {
    const input = this.input;
    const reloaded = this.weapons.update(dt);
    if (reloaded) this.audio.playChime?.();
    this.updateProjectiles(dt);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    if (this.mounted || this.robot.destroyed) {
      this.viewmodel.visible = false;
      this.player.aim = 0;
      return;
    }
    if (input.pressed('grid_build')) this.toggleGridMode();
    if (input.pressed('edit')) this.toggleEdit();

    if (this.editing) {
      this.updateEdit();
    } else if (this.gridMode) {
      this.updateGridMode();
    } else if (!this.buildMode) {
      for (let n = 0; n <= 5; n++) {
        if (input.pressed(`weapon_${n}`)) this.selectWeapon(n);
      }
      const wheel = input.consumeWheel();
      if (wheel) {
        const name = this.weapons.cycle(wheel);
        if (name) { this.equipVisuals(); this.ui.toast(name, 'info'); }
      }
      if (input.pressed('reload') && this.weapons.startReload()) this.ui.toast('Rechargement…', 'info');
      if (this.weapons.current === 'harvest') {
        if (this.weapons.trySwing(input.isDown('fire') || input.pressed('fire'))) this.harvest();
      } else {
        const shot = this.weapons.tryFire(input.isDown('fire') || input.pressed('fire'), input.pressed('fire'));
        if (shot?.type === 'shot') this.fireShot(shot);
        else if (shot?.type === 'empty') this.ui.toast('Plus de munitions : fabriquez-en (Tab > Fabrication).', 'warn');
        else if (shot?.type === 'reload') this.ui.toast('Rechargement…', 'info');
      }
    }

    const aiming = !this.gridMode && !this.editing && !!this.weapons.def && input.isDown('aim');
    if (input.isDown('fire') && this.weapons.current) this.aimHold = 1.2;
    this.aimHold = Math.max(0, this.aimHold - dt);
    this.player.aim = this.weapons.current && (aiming || this.aimHold > 0 || input.isDown('aim')) ? 1 : this.weapons.current ? 0.15 : 0;
    this.player.model.aimDir.copy(this.rig.forward());

    // Zoom: field of view and look sensitivity follow the weapon's scope.
    const def = this.weapons.def;
    const targetFov = aiming && def ? Math.min(this.settings.fov, def.zoom) : this.settings.fov;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 14);
      this.camera.updateProjectionMatrix();
    }
    this.rig.lookScale = this.camera.fov / this.settings.fov;
    this.zoomed = aiming && def?.zoom < 30;

    const firstPerson = this.rig.mode === 'first';
    this.player.faceCamera = firstPerson;
    this.player.model.setFirstPerson(firstPerson);
    this.viewmodel.visible = firstPerson && !!this.viewWeapon && !this.zoomed;
    if (this.viewWeapon) {
      const t = performance.now() / 1000;
      const sway = Math.min(1, this.player.speed / 6);
      this.viewWeapon.position.set(
        (aiming ? 0.0 : 0.2) + Math.sin(t * 6) * 0.01 * sway,
        (aiming ? -0.13 : -0.2) + Math.abs(Math.cos(t * 6)) * 0.012 * sway - this.weapons.reloading * 0.08,
        -0.42 + this.recoil * 0.1
      );
      this.viewWeapon.rotation.x = this.recoil * 0.5;
    }
  },

  selectWeapon(n) {
    const msg = this.weapons.select(n);
    if (msg) this.ui.toast(msg, 'info');
    this.equipVisuals();
  },

  /** Ray origin and direction of a shot: from the camera, through the crosshair, with spread. */
  shotRay(pellet) {
    const origin = this.rig.camera.position.clone();
    const yaw = this.rig.yaw + pellet.yaw;
    const pitch = this.rig.pitch + pellet.pitch;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // In third person the camera is behind the character: start the ray level with the character.
    if (this.rig.mode !== 'first') origin.addScaledVector(dir, Math.max(0, origin.distanceTo(this.player.pos) - 1.2));
    return { origin, dir };
  },

  muzzlePosition() {
    if (this.rig.mode === 'first' && this.viewWeapon) return this.viewWeapon.userData.muzzle.getWorldPosition(new THREE.Vector3());
    return this.player.toolTipPosition(new THREE.Vector3());
  },

  fireShot(shot) {
    const def = shot.def;
    this.shotNoise = def.noise;
    this.recoil = Math.min(1, this.recoil + def.recoil * 6);
    this.rig.pitch = Math.min(0.9, this.rig.pitch + def.recoil * 0.35);
    this.audio.playShot();
    const muzzle = this.muzzlePosition();
    this.effects.flash(muzzle, def.color);
    if (shot.projectile) {
      const { dir } = this.shotRay(shot.pellets[0]);
      const start = muzzle.clone().addScaledVector(dir, 0.3);
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.35, 3, 6), new THREE.MeshBasicMaterial({ color: def.color }));
      mesh.position.copy(start);
      this.scene.add(mesh);
      this.projectiles.push({
        x: start.x, y: start.y, z: start.z, vx: dir.x * shot.projectile.speed, vy: dir.y * shot.projectile.speed, vz: dir.z * shot.projectile.speed,
        gravity: shot.projectile.gravity, range: def.range, travelled: 0, def, mesh, trail: 0
      });
      return;
    }
    for (const pellet of shot.pellets) {
      const { origin, dir } = this.shotRay(pellet);
      const hit = this.traceShot(origin, dir, def.range);
      const end = { x: origin.x + dir.x * hit.t, y: origin.y + dir.y * hit.t, z: origin.z + dir.z * hit.t };
      this.effects.beam(muzzle, end, def.color, def.id === 'rail_sniper' ? 0.35 : 0.07);
      this.effects.flash(end, def.color, hit.kind ? 0.18 : 0.1);
      this.applyHit(hit, def.damage);
    }
  },

  /** First thing a ray meets: built piece, creature, enemy or the terrain. */
  traceShot(origin, dir, range) {
    const terrainT = rayTerrain(this.world, origin, dir, range, 0.75);
    let hit = { t: terrainT, kind: null, obj: null };
    const piece = this.grid.raycast(origin, dir, Math.min(range, terrainT));
    if (piece) hit = { t: piece.t, kind: 'piece', obj: piece.piece };
    for (const c of this.creatures.near(origin.x, origin.z, range)) {
      const t = raySphere(origin, dir, { x: c.x, y: c.y + c.species.size.height * 0.5, z: c.z }, c.species.size.length * 0.5 + 0.3);
      if (t !== null && t < hit.t) hit = { t, kind: 'creature', obj: c };
    }
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const t = raySphere(origin, dir, { x: e.x, y: e.y, z: e.z }, 1.0);
      if (t !== null && t < hit.t) hit = { t, kind: 'enemy', obj: e };
    }
    return hit;
  },

  applyHit(hit, damage) {
    if (hit.kind === 'creature') {
      const c = hit.obj;
      if (c.takeDamage(damage, this.playerTarget)) {
        this.handleNotices(this.missions.notify({ type: 'kill', species: c.species.id }));
        this.grant('bio_sample', 1 + this.inventory.effects.lootBonus);
        this.ui.toast(`${c.species.name} neutralisé : matériau biologique récupéré.`, 'good');
      }
    } else if (hit.kind === 'enemy') {
      if (this.enemies.hit(hit.obj, damage)) {
        this.handleNotices(this.missions.notify({ type: 'destroy', kind: hit.obj.kind }));
        this.ui.toast(`${hit.obj.name} détruit.`, 'good');
        this.grant('ore_metal', 1);
        this.grant('mat_metal', 10);
      }
    } else if (hit.kind === 'piece') {
      this.damagePiece(hit.obj, damage);
    }
  },

  damagePiece(piece, amount) {
    const fallen = this.grid.damage(piece, amount, (x, z) => this.world.heightAt(x, z));
    for (const p of fallen) {
      const b = pieceBounds(p);
      this.effects.burst({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 }, '#c9b79c', 2.2, 0.45);
    }
    if (fallen.length) this.audio.playLand?.(4);
  },

  updateProjectiles(dt) {
    if (!this.projectiles.length) return;
    const heightAt = (x, z) => this.world.heightAt(x, z);
    this.projectiles = this.projectiles.filter((p) => {
      const from = { x: p.x, y: p.y, z: p.z };
      let boom = stepProjectile(p, dt, heightAt);
      const seg = new THREE.Vector3(p.x - from.x, p.y - from.y, p.z - from.z);
      const len = seg.length();
      if (!boom && len > 0) {
        seg.divideScalar(len);
        const hit = this.traceShot(new THREE.Vector3(from.x, from.y, from.z), seg, len);
        if (hit.kind) { boom = true; p.x = from.x + seg.x * hit.t; p.y = from.y + seg.y * hit.t; p.z = from.z + seg.z * hit.t; }
      }
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      p.mesh.rotateX(Math.PI / 2);
      p.trail -= dt;
      if (p.trail <= 0) { p.trail = 0.05; this.effects.burst({ x: p.x, y: p.y, z: p.z }, '#d9d4cc', 0.35, 0.5); }
      if (!boom) return true;
      this.explode(p, p.def);
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      return false;
    });
  },

  explode(at, def) {
    const r = def.projectile.radius;
    this.effects.burst(at, '#ffb347', r, 0.6);
    this.effects.burst(at, '#fff1c1', r * 0.4, 0.3);
    this.audio.playThunder?.(0);
    this.shotNoise = 1;
    for (const c of this.creatures.near(at.x, at.z, r + 3)) {
      const dmg = blastDamage(def.damage, r + c.species.size.length * 0.5, Math.hypot(c.x - at.x, c.y - at.y, c.z - at.z));
      if (dmg > 0) this.applyHit({ kind: 'creature', obj: c }, dmg);
    }
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const dmg = blastDamage(def.damage, r + 1, Math.hypot(e.x - at.x, e.y - at.y, e.z - at.z));
      if (dmg > 0) this.applyHit({ kind: 'enemy', obj: e }, dmg);
    }
    for (const piece of this.grid.near(at.x, at.z, r)) {
      if (!this.grid.has(piece)) continue;
      const b = pieceBounds(piece);
      const cx = Math.max(b.minX, Math.min(at.x, b.maxX));
      const cy = Math.max(b.minY, Math.min(at.y, b.maxY));
      const cz = Math.max(b.minZ, Math.min(at.z, b.maxZ));
      const dmg = blastDamage(def.damage * 2.5, r, Math.hypot(cx - at.x, cy - at.y, cz - at.z));
      if (dmg > 0) this.damagePiece(piece, dmg);
    }
    const p = this.player.pos;
    const self = blastDamage(def.damage * 0.4, r, Math.hypot(p.x - at.x, p.y + 0.9 - at.y, p.z - at.z));
    if (self > 1) this.damagePlayer(self);
  },

  /** Harvesting tool: wood from trees, stone from rocks, and it also breaks built pieces. */
  harvest() {
    const h = this.content.weapons.harvest;
    this.player.playAction('collect', 0.45);
    this.audio.playStep?.('rock', true);
    const origin = new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z);
    const dir = this.rig.forward();
    const piece = this.grid.raycast(this.rig.camera.position, dir, h.range + this.rig.camera.position.distanceTo(origin));
    if (piece) {
      this.damagePiece(piece.piece, HARVEST_DAMAGE_TO_PIECES);
      this.effects.burst(piece.point, '#d8c7a4', 0.4, 0.2);
      return;
    }
    const target = this.world.harvestTarget(origin, dir, h.range);
    if (!target) return;
    const rule = h[target.kind];
    const done = this.harvested.get(target.key) ?? 0;
    const at = { x: target.x, y: this.world.heightAt(target.x, target.z) + 1, z: target.z };
    if (done >= rule.hits) {
      this.ui.toast(target.kind === 'tree' ? 'Cet arbre est épuisé.' : 'Ce rocher est épuisé.', 'info');
      return;
    }
    this.harvested.set(target.key, done + 1);
    this.effects.burst(at, target.kind === 'tree' ? '#a87b4f' : '#9a9a9a', 0.5, 0.25);
    this.grant(rule.item, rule.amount);
  },

  // ---- Grid building ----------------------------------------------------

  toggleGridMode() {
    if (this.gridMode) {
      this.exitGridMode();
      return;
    }
    if (this.buildMode) this.cancelBuild();
    if (this.editing) this.exitEdit();
    this.gridMode = { type: 'wall', material: 'wood', lastKey: null, ghostKey: null };
    this.ui.toast('Construction rapide : 1 mur · 2 sol · 3 rampe · 4 toit · clic gauche poser · clic droit matériau · H éditer · G quitter', 'info');
  },

  exitGridMode() {
    this.gridMode = null;
    if (this.gridGhost) { this.scene.remove(this.gridGhost); this.gridGhost.geometry.dispose(); this.gridGhost = null; }
  },

  gridPlacement() {
    const g = this.gridMode;
    const p = placementFor(g.type, this.player.pos, this.rig.yaw, this.rig.pitch);
    return { ...p, m: g.material };
  },

  updateGridMode() {
    const g = this.gridMode;
    const input = this.input;
    for (let n = 1; n <= 4; n++) {
      if (input.pressed(`weapon_${n}`)) { g.type = PIECE_TYPES[n - 1]; g.lastKey = null; }
    }
    if (input.pressed('aim')) {
      g.material = MATERIAL_ORDER[(MATERIAL_ORDER.indexOf(g.material) + 1) % MATERIAL_ORDER.length];
      this.ui.toast(`Matériau : ${MATERIALS[g.material].name}`, 'info');
    }
    const wheel = input.consumeWheel();
    if (wheel) g.type = PIECE_TYPES[(PIECE_TYPES.indexOf(g.type) + wheel + PIECE_TYPES.length) % PIECE_TYPES.length];
    const p = this.gridPlacement();
    const check = this.grid.canPlace(p, this.inventory);
    g.valid = check.ok;
    g.reason = check.reason;
    const ghostKey = `${pieceKey(p)}:${p.d ?? 0}:${check.ok}`;
    if (ghostKey !== g.ghostKey) {
      g.ghostKey = ghostKey;
      if (this.gridGhost) { this.scene.remove(this.gridGhost); this.gridGhost.geometry.dispose(); }
      this.gridGhost = createGhostMesh(p, check.ok);
      this.scene.add(this.gridGhost);
    }
    // Hold the trigger to keep building while moving ("turbo" building): one piece per new slot.
    const key = pieceKey(p);
    // (A click shorter than one frame only shows up as a press, so presses are honoured on their own.)
    if (input.pressed('fire') || (input.isDown('fire') && key !== g.lastKey)) {
      g.lastKey = key;
      const result = this.grid.place(p, this.inventory);
      if (result.ok) {
        this.audio.playStep?.('rock', false);
        this.handleNotices(this.missions.notify({ type: 'build', structure: p.type }));
      } else if (input.pressed('fire')) {
        this.ui.toast(result.reason, 'warn');
      }
    }
    if (!input.isDown('fire') && !input.pressed('fire')) g.lastKey = null;
  },

  // ---- Edit mode --------------------------------------------------------

  toggleEdit() {
    if (this.editing) {
      this.exitEdit();
      return;
    }
    let hit = this.grid.raycast(this.rig.camera.position, this.rig.forward(), EDIT_REACH + (this.rig.mode === 'first' ? 0 : 4));
    if (!hit) {
      // Fallback: the wall slot (or floor slot) the player is facing, as when placing a piece.
      for (const type of ['wall', 'floor']) {
        const slot = this.grid.pieces.get(pieceKey(placementFor(type, this.player.pos, this.rig.yaw, this.rig.pitch)));
        if (slot) { hit = { piece: slot }; break; }
      }
    }
    if (!hit) {
      this.ui.toast('Visez un mur ou un sol construit pour l\'éditer.', 'info');
      return;
    }
    if (!EDIT_GRID[hit.piece.type]) {
      this.ui.toast(`${PIECE_NAMES[hit.piece.type]} : pas d'édition (murs et sols seulement).`, 'info');
      return;
    }
    if (this.gridGhost) this.gridGhost.visible = false;
    this.editing = { piece: hit.piece, version: -1 };
    this.ui.toast('Édition : clic gauche retire / remet une case (porte, fenêtre), clic droit réinitialise, H valide.', 'info');
  },

  exitEdit() {
    if (this.editOverlay) { this.scene.remove(this.editOverlay); this.editOverlay.traverse((o) => o.geometry?.dispose()); this.editOverlay = null; }
    this.editing = null;
    if (this.gridGhost) this.gridGhost.visible = true;
  },

  updateEdit() {
    const e = this.editing;
    if (!this.grid.has(e.piece) || this.grid.pieces.get(pieceKey(e.piece)) !== e.piece) {
      this.exitEdit();
      return;
    }
    if (this.input.pressed('fire')) {
      const hit = this.grid.raycast(this.rig.camera.position, this.rig.forward(), EDIT_REACH + 6);
      const overlayHit = hit?.piece === e.piece ? hit.point : this.editPointOnPiece(e.piece);
      const cell = overlayHit ? cellAt(e.piece, overlayHit) : null;
      if (cell) this.grid.toggleCell(e.piece, cell.c, cell.r);
    }
    if (this.input.pressed('aim')) this.grid.resetEdit(e.piece);
    if (e.version !== this.grid.version) {
      e.version = this.grid.version;
      if (this.editOverlay) { this.scene.remove(this.editOverlay); this.editOverlay.traverse((o) => o.geometry?.dispose()); }
      this.editOverlay = createEditOverlay(e.piece);
      this.scene.add(this.editOverlay);
    }
  },

  /** Crosshair point on the plane of an edited piece (lets removed cells be clicked again). */
  editPointOnPiece(piece) {
    const o = this.rig.camera.position;
    const d = this.rig.forward();
    const b = pieceBounds(piece);
    let t;
    if (piece.type === 'wall') {
      if (piece.o === 0) t = Math.abs(d.z) > 1e-6 ? ((b.minZ + b.maxZ) / 2 - o.z) / d.z : -1;
      else t = Math.abs(d.x) > 1e-6 ? ((b.minX + b.maxX) / 2 - o.x) / d.x : -1;
    } else {
      t = Math.abs(d.y) > 1e-6 ? (b.maxY - o.y) / d.y : -1;
    }
    if (!(t > 0 && t < EDIT_REACH + 6)) return null;
    tmp.copy(o).addScaledVector(d, t);
    const inside = tmp.x >= b.minX - 0.1 && tmp.x <= b.maxX + 0.1 && tmp.y >= b.minY - 0.1 && tmp.y <= b.maxY + 0.1 && tmp.z >= b.minZ - 0.1 && tmp.z <= b.maxZ + 0.1;
    return inside ? { x: tmp.x, y: tmp.y, z: tmp.z } : null;
  },

  /** HUD fragment for weapons, jetpack and grid building. */
  arsenalHud() {
    const w = this.weapons;
    const def = w.def;
    const slots = w.slots.map((id, n) => ({ n: n + 1, name: w.defs[id].name, owned: w.owns(id), active: w.current === id }));
    const g = this.gridMode;
    return {
      weapon: w.current ? {
        name: def ? def.name : this.content.weapons.harvest.name,
        mag: def ? w.mags[def.id] : null, magSize: def?.mag ?? null, reserve: def ? w.reserve() : null,
        reloading: w.reloading > 0
      } : null,
      slots,
      harvestActive: w.current === 'harvest',
      jet: (this.player.jetFuel / 100) * 100,
      jetting: this.player.jetting,
      zoomed: !!this.zoomed,
      grid: g ? {
        type: g.type, material: g.material, valid: g.valid, reason: g.reason,
        pieces: PIECE_TYPES.map((t, n) => ({ n: n + 1, name: PIECE_NAMES[t], active: t === g.type })),
        materials: MATERIAL_ORDER.map((m) => ({ id: m, name: MATERIALS[m].name, count: this.inventory.count(MATERIALS[m].item), active: m === g.material }))
      } : null,
      editing: !!this.editing
    };
  }
};
