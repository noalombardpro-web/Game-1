// Space layer: a controlled, continuous space around the two planets. Distances are compressed
// but travel is never instantaneous: crossing from Genesis to Cryos takes about a minute of
// cruise flight. The ship is pilotable (throttle, boost, cruise drive, laser, scanner), with
// collisions, a station to dock at, an asteroid field to mine, a wreck to salvage and an
// alien structure to scan. Pure logic plus three.js scene graph; no DOM.
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { createPlanet, createStation, createAsteroidField, createWreck, createAnomaly, createStarfield } from './spaceModels.js';

export const SPACE_BODIES = [
  { id: 'genesis', name: 'Genesis', kind: 'planet', pos: [0, 0, 0], radius: 3000, landable: true, atmosphere: true, description: 'Planète d’origine de la mission : océans, continents, forêts et ruines anciennes.' },
  { id: 'pallas', name: 'Pallas', kind: 'moon', pos: [9000, 600, -3500], radius: 650, landable: false, description: 'Petite lune rocheuse criblée de cratères. Aucun site d’atterrissage sûr.' },
  { id: 'station', name: 'Station Aurore', kind: 'station', pos: [-2500, 2800, 2000], radius: 150, description: 'Station orbitale de l’expédition : amarrage, réparations et recharge.' },
  { id: 'field', name: 'Champ d’astéroïdes', kind: 'field', pos: [21000, 800, 3000], radius: 2400, description: 'Ceinture de roches riches en minerais. Tirez pour extraire les ressources.' },
  { id: 'wreck', name: 'Épave du Perséphone', kind: 'wreck', pos: [21600, 700, 2500], radius: 90, description: 'Vaisseau d’exploration brisé. Ses soutes contiennent des composants anciens.' },
  { id: 'cryos', name: 'Cryos', kind: 'planet', pos: [42000, 1500, 6000], radius: 2500, landable: true, atmosphere: true, description: 'Planète glacée aux tempêtes de neige permanentes et aux cratères gelés.' },
  { id: 'anomaly', name: 'Structure anormale', kind: 'anomaly', pos: [38500, 2200, 3800], radius: 130, description: 'Anneau extraterrestre d’origine inconnue, aligné sur un signal à destination de plusieurs mondes.' }
];

const SCAN_RANGE = 900;
const LAND_ALTITUDE = 380;
const DOCK_RANGE = 70;

const FORWARD = new THREE.Vector3(0, 0, -1);

export class SpaceSession {
  /**
   * @param options { shipConfig, state?: saved state, seed }
   */
  constructor(options) {
    this.cfg = options.shipConfig;
    this.scene = new THREE.Scene();
    this.bodies = SPACE_BODIES.map((b) => ({ ...b, pos: new THREE.Vector3(...b.pos) }));
    this.byId = Object.fromEntries(this.bodies.map((b) => [b.id, b]));
    this.salvaged = new Set(options.state?.salvaged ?? []);
    this.reportedOrbit = !!options.state?.reportedOrbit;
    this.docked = false;
    this.cruising = false;
    this.selected = 0;
    this.fireCooldown = 0;
    this.visuals = [];
    this.buildScene(options.seed ?? 1);

    this.ship = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(),
      throttle: 0, energy: this.cfg.energy, hull: this.cfg.hull
    };
    if (options.state?.ship) this.restoreShip(options.state.ship);
    for (const i of options.state?.destroyed ?? []) this.destroyRock(i, false);
  }

  buildScene(seed) {
    const scene = this.scene;
    scene.add(createStarfield(seed));
    const sun = new THREE.DirectionalLight('#fff4e0', 3.4);
    sun.position.set(80000, 22000, 40000);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight('#6a8bd8', '#1a1a24', 0.22));
    const place = (obj, body) => { obj.position.copy(body.pos); scene.add(obj); this.visuals.push({ obj, body }); return obj; };
    place(createPlanet('genesis', 3000, seed), this.byId.genesis);
    place(createPlanet('moon', 650, seed + 1), this.byId.pallas);
    place(createPlanet('cryos', 2500, seed + 2), this.byId.cryos);
    place(createStation(), this.byId.station);
    place(createWreck(), this.byId.wreck);
    place(createAnomaly(), this.byId.anomaly);
    const field = createAsteroidField(520, this.byId.field.radius, seed + 3);
    field.mesh.position.copy(this.byId.field.pos);
    scene.add(field.mesh);
    this.field = field;
  }

  restoreShip(s) {
    this.ship.pos.set(...s.pos);
    this.ship.vel.set(...(s.vel ?? [0, 0, 0]));
    this.ship.q.set(...s.q);
    this.ship.throttle = s.throttle ?? 0;
    this.ship.energy = s.energy;
    this.ship.hull = s.hull;
    this.docked = !!s.docked;
  }

  /** Places the ship in orbit above a planet, facing along the orbit. */
  enterOrbit(planetId, energy, hull) {
    const planet = this.byId[planetId];
    const up = new THREE.Vector3(0, 1, 0);
    const lateral = planetId === 'cryos' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    this.ship.pos.copy(planet.pos).addScaledVector(up, planet.radius + 520).addScaledVector(lateral, 300);
    this.ship.vel.set(0, 0, 0);
    this.ship.q.setFromUnitVectors(FORWARD, new THREE.Vector3(1, 0, 0).cross(up).normalize().negate());
    this.ship.throttle = 0;
    this.ship.energy = energy ?? this.cfg.energy;
    this.ship.hull = hull ?? this.cfg.hull;
    this.docked = false;
  }

  get forward() {
    return FORWARD.clone().applyQuaternion(this.ship.q);
  }

  get speed() {
    return this.ship.vel.length();
  }

  /** Surface distance to the nearest solid body (planets, moon, station). */
  nearestBody() {
    let best = null;
    let bestDist = Infinity;
    for (const b of this.bodies) {
      if (b.kind === 'field') continue;
      const d = this.ship.pos.distanceTo(b.pos) - b.radius;
      if (d < bestDist) { bestDist = d; best = b; }
    }
    return { body: best, distance: bestDist };
  }

  altitudeOver(planetId) {
    const b = this.byId[planetId];
    return this.ship.pos.distanceTo(b.pos) - b.radius;
  }

  /** Landing candidate: a landable planet close enough, slow enough. */
  landingCandidate() {
    for (const b of this.bodies) {
      if (b.landable && this.altitudeOver(b.id) < LAND_ALTITUDE && this.speed < 90) return b;
    }
    return null;
  }

  dockAvailable() {
    const station = this.byId.station;
    const bay = station.pos.clone().add(new THREE.Vector3(0, 124, 0));
    return !this.docked && this.ship.pos.distanceTo(bay) < DOCK_RANGE && this.speed < 30;
  }

  wreckAvailable() {
    return !this.salvaged.has('wreck') && this.ship.pos.distanceTo(this.byId.wreck.pos) < 160;
  }

  /** Targets for the navigation computer, nearest first. */
  targets() {
    return this.bodies
      .filter((b) => b.kind !== 'field' || true)
      .map((b) => ({ id: b.id, name: b.name, kind: b.kind, pos: b.pos, distance: Math.max(0, this.ship.pos.distanceTo(b.pos) - (b.kind === 'field' ? 0 : b.radius)) }))
      .sort((a, b) => a.distance - b.distance);
  }

  cycleTarget() {
    this.selected = (this.selected + 1) % this.bodies.length;
  }

  get selectedBody() {
    return this.bodies[this.selected];
  }

  destroyRock(i, burst = true) {
    const rock = this.field.rocks[i];
    if (!rock || !rock.alive) return;
    rock.alive = false;
    rock.index = i;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    this.field.mesh.setMatrixAt(i, m);
    this.field.mesh.instanceMatrix.needsUpdate = true;
    return burst;
  }

  /**
   * Advances the simulation.
   * @param dt seconds
   * @param c  controls: { throttle (-1..1), yaw, pitch, roll (-1..1), boost, cruise, stop, fire, scan, nav, land, interact }
   * @returns events: laser, cargo, damage, scan, dock, undock, land, orbit, salvage, burst
   */
  update(dt, c) {
    const events = [];
    const s = this.ship;
    const cfg = this.cfg;
    this.fireCooldown -= dt;
    for (const v of this.visuals) {
      v.obj.traverse((o) => {
        if (o.userData.spin) o.rotation.y += dt * 0.05;
        if (o.userData.blink) o.material.emissiveIntensity = 1 + Math.sin(performance.now() * 0.006) * 1.2;
      });
    }
    if (c.nav) this.cycleTarget();

    if (this.docked) {
      s.energy = Math.min(cfg.energy, s.energy + 20 * dt);
      s.hull = Math.min(cfg.hull, s.hull + 10 * dt);
      if (c.land) events.push(...this.undock());
      return events;
    }

    // Orientation: yaw about the local up axis, pitch about local right, roll about local forward.
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(c.pitch * 1.3 * dt, c.yaw * 1.1 * dt, c.roll * 1.6 * dt, 'YXZ'));
    s.q.multiply(q).normalize();

    s.throttle = c.stop ? 0 : clamp(s.throttle + c.throttle * dt * 0.6, 0, 1);
    const near = this.nearestBody();
    const altitude = near.body?.atmosphere ? near.distance : Infinity;
    const inAtmosphere = altitude < 450;
    this.cruising = !!c.cruise && s.energy > 10 && near.distance > 700 && !inAtmosphere;

    let top = cfg.spaceSpeed * (c.boost && s.energy > 5 ? 2.6 : 1);
    if (this.cruising) top = cfg.cruiseSpeed;
    if (inAtmosphere) top = Math.min(top, 180);
    if (s.energy <= 0) top *= 0.25;
    const desired = this.forward.multiplyScalar(this.cruising ? top : top * s.throttle);
    const accel = this.cruising ? 500 : c.stop ? 140 : 70;
    const delta = desired.clone().sub(s.vel);
    const step = Math.min(delta.length(), accel * dt);
    if (delta.lengthSq() > 1e-6) s.vel.addScaledVector(delta.normalize(), step);

    if (inAtmosphere && this.speed > 230) {
      const heat = (this.speed - 230) * 0.05 * dt;
      s.hull = Math.max(0, s.hull - heat);
      events.push({ type: 'damage', amount: heat, reason: 'frottement atmosphérique' });
    }
    s.pos.addScaledVector(s.vel, dt);

    this.collide(events);

    const use = s.throttle * 0.9 + (c.boost ? 3 : 0) + (this.cruising ? 4 : 0);
    s.energy = clamp(s.energy - use * dt + (s.throttle < 0.05 && !c.boost ? 2.5 * dt : 0), 0, cfg.energy);

    if (c.fire) this.fireLaser(events);
    if (c.scan) events.push(this.scanNearest());
    if (c.land) {
      if (this.dockAvailable()) events.push(...this.dock());
      else {
        const candidate = this.landingCandidate();
        if (candidate) events.push({ type: 'land', planet: candidate.id });
      }
    }
    if (c.interact && this.wreckAvailable()) {
      this.salvaged.add('wreck');
      events.push({ type: 'salvage', loot: [['electronic_part', 3], ['ancient_tech', 1], ['alien_sample', 1]] });
    }
    if (!this.reportedOrbit) {
      const a = this.altitudeOver('genesis');
      if (a > 250 && a < 2600) {
        this.reportedOrbit = true;
        events.push({ type: 'orbit' });
      }
    }
    return events;
  }

  collide(events) {
    const s = this.ship;
    const hit = (normal, penetration, label) => {
      const impact = Math.max(0, -s.vel.dot(normal));
      s.pos.addScaledVector(normal, penetration);
      s.vel.addScaledVector(normal, impact * 1.2);
      s.vel.multiplyScalar(0.5);
      if (impact > 30) {
        const dmg = impact * 0.12;
        s.hull = Math.max(0, s.hull - dmg);
        events.push({ type: 'damage', amount: dmg, reason: label });
      }
    };
    for (const b of this.bodies) {
      if (b.kind === 'field') continue;
      const offset = s.pos.clone().sub(b.pos);
      const d = offset.length();
      const min = b.radius + (b.kind === 'planet' || b.kind === 'moon' ? 25 : 10);
      if (b.kind === 'station') {
        const bay = b.pos.clone().add(new THREE.Vector3(0, 124, 0));
        if (s.pos.distanceTo(bay) < DOCK_RANGE) continue;
      }
      if (d < min && d > 1e-3) hit(offset.divideScalar(d), min - d, b.name);
    }
    const fieldPos = this.byId.field.pos;
    if (s.pos.distanceTo(fieldPos) < this.byId.field.radius + 100) {
      for (const rock of this.field.rocks) {
        if (!rock.alive) continue;
        const rx = fieldPos.x + rock.x;
        const ry = fieldPos.y + rock.y;
        const rz = fieldPos.z + rock.z;
        const dx = s.pos.x - rx;
        const dy = s.pos.y - ry;
        const dz = s.pos.z - rz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const min = rock.radius + 8;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          hit(new THREE.Vector3(dx / d, dy / d, dz / d), min - d, 'astéroïde');
        }
      }
    }
  }

  fireLaser(events) {
    const s = this.ship;
    if (this.fireCooldown > 0 || s.energy < 1.5) return;
    this.fireCooldown = 0.25;
    s.energy -= 1.5;
    const dir = this.forward;
    const origin = s.pos.clone().addScaledVector(dir, 8);
    const fieldPos = this.byId.field.pos;
    let best = null;
    let bestT = 1400;
    if (s.pos.distanceTo(fieldPos) < this.byId.field.radius + 1500) {
      this.field.rocks.forEach((rock, i) => {
        if (!rock.alive) return;
        const c = new THREE.Vector3(fieldPos.x + rock.x, fieldPos.y + rock.y, fieldPos.z + rock.z);
        const oc = origin.clone().sub(c);
        const b = oc.dot(dir);
        const disc = b * b - (oc.lengthSq() - rock.radius * rock.radius);
        if (disc < 0) return;
        const t = -b - Math.sqrt(disc);
        if (t > 0 && t < bestT) { bestT = t; best = i; }
      });
    }
    const end = origin.clone().addScaledVector(dir, best === null ? 900 : bestT);
    events.push({ type: 'laser', from: origin, to: end });
    if (best === null) return;
    const rock = this.field.rocks[best];
    rock.hp -= 25;
    events.push({ type: 'burst', pos: end });
    if (rock.hp <= 0) {
      this.destroyRock(best);
      events.push({ type: 'cargo', item: rock.item, count: 1 + Math.floor(rock.radius / 20) });
    }
  }

  scanNearest() {
    const s = this.ship;
    let best = null;
    let bestScore = Infinity;
    const dir = this.forward;
    for (const b of this.bodies) {
      const to = b.pos.clone().sub(s.pos);
      const d = to.length();
      if (d - b.radius > SCAN_RANGE && b.kind !== 'planet') continue;
      const angle = Math.acos(clamp(to.normalize().dot(dir), -1, 1));
      const score = angle * 1000 + d * 0.01;
      if (angle < 0.5 && score < bestScore) { bestScore = score; best = b; }
    }
    if (!best) return { type: 'scan', target: null };
    return { type: 'scan', target: best, distance: s.pos.distanceTo(best.pos) };
  }

  dock() {
    const station = this.byId.station;
    this.docked = true;
    this.ship.vel.set(0, 0, 0);
    this.ship.throttle = 0;
    this.ship.pos.copy(station.pos).add(new THREE.Vector3(0, 124, 0));
    return [{ type: 'dock' }];
  }

  undock() {
    const station = this.byId.station;
    this.docked = false;
    this.ship.pos.copy(station.pos).add(new THREE.Vector3(0, 124 + 140, 0));
    this.ship.q.setFromUnitVectors(FORWARD, new THREE.Vector3(0, 1, 0));
    return [{ type: 'undock' }];
  }

  /** Free repairs and recharge at the station. */
  service() {
    this.ship.energy = this.cfg.energy;
    this.ship.hull = this.cfg.hull;
  }

  /** Camera pose for the cockpit (first person) or a chase view. */
  cameraPose(firstPerson) {
    const s = this.ship;
    const back = FORWARD.clone().negate().applyQuaternion(s.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.q);
    const position = firstPerson ? s.pos.clone() : s.pos.clone().addScaledVector(back, 34).addScaledVector(up, 9);
    return { position, quaternion: s.q.clone() };
  }

  toJSON() {
    const s = this.ship;
    return {
      ship: { pos: s.pos.toArray(), vel: s.vel.toArray(), q: s.q.toArray(), throttle: s.throttle, energy: s.energy, hull: s.hull, docked: this.docked },
      salvaged: [...this.salvaged],
      reportedOrbit: this.reportedOrbit,
      destroyed: this.field.rocks.map((r, i) => (r.alive ? -1 : i)).filter((i) => i >= 0)
    };
  }

  dispose() {
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) { m?.map?.dispose(); m?.dispose?.(); }
    });
  }
}
