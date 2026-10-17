// Human player character: a skinned glTF model (Mixamo rig) with blended idle / walk / run clips,
// plus procedural overlays computed in world space (aiming arms, crouch, jump tuck, swimming,
// tool gestures). Same interface as the former robot model: root, lamp, toolTip, animate(), place().
import * as THREE from 'three';
import { cloneModel, getModel, loadModel } from './modelLibrary.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();

/** Finds a Mixamo bone by its short name ("Hips", "RightArm"...), whatever the prefix sanitising did. */
function findBone(root, short) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && (o.name === `mixamorig${short}` || o.name === `mixamorig:${short}` || o.name.endsWith(`_${short}`))) found = o;
  });
  return found;
}

/**
 * Rotates `bone` (blended with weight w) so that its +Y axis (Mixamo bones point along +Y)
 * points along the world direction `dir`.
 */
function pointBone(bone, dir, w) {
  if (!bone || w <= 0.001) return;
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(tmpQ);
  tmpA.copy(UP).applyQuaternion(tmpQ).normalize();
  tmpQ2.setFromUnitVectors(tmpA, tmpB.copy(dir).normalize());
  const target = tmpQ2.multiply(tmpQ);
  bone.parent.getWorldQuaternion(tmpQ).invert();
  const local = tmpQ.multiply(target);
  bone.quaternion.slerp(local, w);
  bone.updateMatrixWorld(true);
}

export function createCharacterModel() {
  const root = new THREE.Group();
  root.name = 'player';
  const body = new THREE.Group();
  root.add(body);

  const lamp = new THREE.SpotLight('#fff1d6', 0, 40, Math.PI / 6, 0.4, 1.2);
  lamp.position.set(0, 1.62, 0.25);
  root.add(lamp);
  lamp.target.position.set(0, 1.2, 6);
  root.add(lamp.target);

  const toolTip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#7fe9ff' }));
  toolTip.visible = false;
  toolTip.position.set(0.25, 1.3, 0.5);
  root.add(toolTip);

  const model = {
    root, body, lamp, toolTip,
    phase: 0, time: 0,
    skin: null, mesh: null, mixer: null, actions: {}, bones: {},
    weapon: null, firstPerson: false,
    aimDir: new THREE.Vector3(0, 0, 1),
    aiming: 0,
    pendingSkin: null,

    /** Applies a skin from data/skins.json (loads its model on demand). */
    setSkin(skin) {
      this.pendingSkin = skin;
      if (!getModel(skin.model)) {
        loadModel(skin.model).then(() => { if (this.pendingSkin === skin) this.setSkin(skin); });
        return;
      }
      const clone = cloneModel(skin.model);
      if (!clone) return;
      if (this.mesh) body.remove(this.mesh);
      this.mesh = clone;
      this.skin = skin;
      body.add(clone);
      clone.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        o.material = mats.map((m) => {
          const copy = m.clone();
          const tint = skin.tints?.[m.name];
          if (tint) copy.color.multiply(new THREE.Color(tint));
          const colour = skin.colors?.[m.name];
          if (colour) copy.color.set(colour);
          return copy;
        });
        if (o.material.length === 1) o.material = o.material[0];
      });
      // Game characters face +Z at yaw 0. Mixamo exports differ (armature rotated +/-90 degrees), so
      // the facing is read from the skeleton: facing +Z puts the left leg on the +X side.
      clone.updateMatrixWorld(true);
      const legL = findBone(clone, 'LeftUpLeg');
      const legR = findBone(clone, 'RightUpLeg');
      if (legL && legR && legL.getWorldPosition(tmpA).x < legR.getWorldPosition(tmpB).x) {
        clone.rotation.y = Math.PI;
        clone.updateMatrixWorld(true);
      }
      // Scale so that the top of the head sits at the skin's height.
      const top = findBone(clone, 'HeadTop_End') ?? findBone(clone, 'Head');
      if (top) {
        root.updateMatrixWorld(true);
        const y = top.getWorldPosition(tmpA).y - root.position.y;
        if (y > 0.01) clone.scale.multiplyScalar(skin.height / y);
      }
      for (const name of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']) {
        this.bones[name] = findBone(clone, name);
      }
      this.setupAnimation(skin);
      if (this.weapon) this.setWeapon(this.weapon);
      this.mesh.visible = !this.firstPerson;
    },

    setupAnimation(skin) {
      this.mixer = new THREE.AnimationMixer(this.mesh);
      const own = getModel(skin.model)?.animations ?? [];
      const shared = getModel('soldier')?.animations ?? [];
      // Clips borrowed from another model keep only the limb rotations: the hips track is expressed
      // in that model's armature frame, which differs between Mixamo exports.
      const foreign = (clip) => {
        const c = clip.clone();
        c.tracks = c.tracks.filter((t) => !/Hips\.(position|quaternion)$/.test(t.name));
        return c;
      };
      const pick = (...names) => {
        for (const [list, borrowed] of [[own, false], [shared, skin.model !== 'soldier']]) {
          for (const n of names) {
            const clip = list.find((c) => c.name.toLowerCase() === n.toLowerCase());
            if (clip) return borrowed ? foreign(clip) : clip;
          }
        }
        return null;
      };
      // Root motion is removed: the game moves the character, the clips only animate the limbs.
      const inPlace = (clip) => {
        if (!clip) return null;
        const c = clip.clone();
        c.tracks = c.tracks.filter((t) => !(t.name.endsWith('.position') && !/Hips/.test(t.name)));
        for (const t of c.tracks) {
          if (/Hips\.position$/.test(t.name)) {
            const v = t.values;
            const x0 = v[0];
            const z0 = v[2];
            for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
          }
        }
        return c;
      };
      const clips = {
        idle: inPlace(pick('Idle')),
        walk: inPlace(pick('Walk', 'Walking')),
        run: inPlace(pick('Run'))
      };
      this.actions = {};
      for (const [key, clip] of Object.entries(clips)) {
        if (!clip) continue;
        const action = this.mixer.clipAction(clip);
        action.play();
        action.setEffectiveWeight(key === 'idle' ? 1 : 0);
        this.actions[key] = action;
      }
    },

    /** Attaches (or removes) a weapon mesh in the right hand. */
    setWeapon(mesh) {
      if (this.weapon && this.weapon !== mesh) this.weapon.parent?.remove(this.weapon);
      this.weapon = mesh;
      if (!mesh) return;
      const hand = this.bones.RightHand;
      if (hand) {
        const s = 1 / hand.getWorldScale(tmpA).x;
        mesh.scale.setScalar(s);
        mesh.position.set(0, 0.09 * s, 0.03 * s);
        mesh.rotation.set(Math.PI / 2, 0, Math.PI / 2);
        hand.add(mesh);
      } else {
        mesh.scale.setScalar(1);
        mesh.position.set(0.25, 1.25, 0.4);
        root.add(mesh);
      }
    },

    setFirstPerson(on) {
      this.firstPerson = on;
      if (this.mesh) this.mesh.visible = !on;
    },

    /**
     * s = { speed, grounded, crouch, sprint, dt, airVel, swim, land, action, actionKind, aim (0..1), jet (0..1) }
     * Returns the stride phase for footstep sounds.
     */
    animate(s) {
      this.time += s.dt;
      const swim = s.swim ?? 0;
      body.rotation.x += ((swim ? 1.25 : 0) - body.rotation.x) * Math.min(1, s.dt * 5);
      body.position.y = swim ? 0.9 : 0;
      if (!this.mixer) {
        this.phase += s.speed * s.dt * 1.25;
        return this.phase;
      }
      const speed = s.speed;
      const runW = s.sprint || speed > 6 ? Math.min(1, Math.max(0, (speed - 4.6) / 2.5)) : 0;
      const moveW = Math.min(1, speed / 1.2);
      const air = s.grounded || swim ? 0 : 1;
      const w = {
        idle: (1 - moveW) * (1 - air * 0.3) + air * 0.3,
        walk: moveW * (1 - runW),
        run: moveW * runW
      };
      if (swim) { w.idle = 0.2; w.walk = 0.8; w.run = 0; }
      for (const [key, action] of Object.entries(this.actions)) {
        action.setEffectiveWeight(w[key] ?? 0);
      }
      if (this.actions.walk) this.actions.walk.timeScale = swim ? 0.7 : Math.max(0.6, speed / 1.6) * (s.crouch ? 0.8 : 1);
      if (this.actions.run) this.actions.run.timeScale = Math.max(0.8, speed / 6.2);
      this.mixer.update(s.dt);
      this.mesh.updateMatrixWorld(true);

      // Procedural overlays in world space.
      const B = this.bones;
      const yaw = root.rotation.y;
      const fwd = tmpB.set(Math.sin(yaw), 0, Math.cos(yaw));
      const crouch = Math.min(1, (s.crouch ?? 0) + (s.land ?? 0) * 0.6);
      body.position.y = swim ? 0.9 : -crouch * 0.42;
      if (crouch > 0.01 || air > 0) {
        const tuck = Math.max(crouch, air * (s.jet ? 0.25 : 0.55));
        for (const side of ['Left', 'Right']) {
          const thigh = new THREE.Vector3(fwd.x * 0.9, -0.55, fwd.z * 0.9).normalize();
          const shin = new THREE.Vector3(-fwd.x * 0.5, -1, -fwd.z * 0.5).normalize();
          pointBone(B[`${side}UpLeg`], thigh, tuck * 0.85);
          pointBone(B[`${side}Leg`], shin, tuck * 0.85);
        }
        if (B.Spine) pointBone(B.Spine, new THREE.Vector3(fwd.x * 0.35, 1, fwd.z * 0.35), crouch * 0.6);
      }
      const act = s.action ?? 0;
      const aim = Math.max(s.aim ?? 0, act);
      if (aim > 0.01 && !swim) {
        const dir = this.aimDir;
        pointBone(B.RightArm, dir, aim);
        pointBone(B.RightForeArm, dir, aim);
        if (this.weapon) {
          const left = new THREE.Vector3(dir.x + Math.cos(yaw) * 0.45, dir.y - 0.25, dir.z - Math.sin(yaw) * 0.45);
          pointBone(B.LeftArm, left, aim * 0.9);
          pointBone(B.LeftForeArm, new THREE.Vector3(dir.x - Math.cos(yaw) * 0.6, dir.y, dir.z + Math.sin(yaw) * 0.6), aim * 0.9);
        }
        if (B.Spine1) pointBone(B.Spine1, new THREE.Vector3(dir.x * 0.25, 1, dir.z * 0.25), aim * 0.4);
      }
      if (B.RightHand) {
        B.RightHand.getWorldPosition(tmpA);
        root.worldToLocal(toolTip.position.copy(tmpA));
      }
      toolTip.visible = act > 0.05;
      toolTip.material.color.set({ scan: '#7fe9ff', collect: '#ffd166', repair: '#ff8a3d' }[s.actionKind] ?? '#7fe9ff');
      toolTip.scale.setScalar(1 + act * 0.8);

      const loco = w.run > w.walk ? this.actions.run : this.actions.walk;
      // Two footfalls per clip cycle: the caller emits a step each time the phase crosses a multiple of PI.
      if (loco) this.phase = (loco.time / loco.getClip().duration) * Math.PI * 2;
      return this.phase;
    },

    place(x, y, z, yaw) {
      root.position.set(x, y, z);
      root.rotation.y = yaw;
    }
  };
  return model;
}
