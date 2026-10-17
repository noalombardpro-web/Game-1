// Short-lived visual effects: laser beams and impact flashes. Pure three.js, no game logic.
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  /** Straight beam from a to b that fades out after `life` seconds. */
  beam(a, b, color = '#ff4d3d', life = 0.15) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z)
    ]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.items.push({ object: line, life, total: life });
  }

  /** Expanding glow sphere (impacts, explosions). */
  burst(pos, color = '#ffb347', radius = 1.2, life = 0.4) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), material);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(mesh);
    this.items.push({ object: mesh, life, total: life, grow: radius });
  }

  /** Tiny, very short flash (muzzle). */
  flash(pos, color = '#fff1c1', size = 0.07) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), material);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(mesh);
    this.items.push({ object: mesh, life: 0.06, total: 0.06 });
  }

  update(dt) {
    this.items = this.items.filter((item) => {
      item.life -= dt;
      const t = Math.max(0, item.life / item.total);
      const obj = item.object;
      if (item.grow) {
        const s = item.grow * (1 - t) + 0.2;
        obj.scale.setScalar(s);
      }
      obj.material.opacity = t;
      if (item.life <= 0) {
        this.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
        return false;
      }
      return true;
    });
  }
}

/** Rising bubbles around the camera while diving. */
export class Bubbles {
  constructor(scene, count = 140) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.reset(i, 0, 0, 0, true);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#cfefff', size: 0.09, transparent: true, opacity: 0.6, depthWrite: false }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  reset(i, cx, cy, cz, anywhere = false) {
    this.positions[i * 3] = cx + (Math.random() - 0.5) * 16;
    this.positions[i * 3 + 1] = cy + (anywhere ? (Math.random() - 0.5) * 12 : -6);
    this.positions[i * 3 + 2] = cz + (Math.random() - 0.5) * 16;
  }

  /** `depth` is the camera depth below the surface (0 hides the bubbles). */
  update(dt, camera, depth, surfaceY) {
    this.points.visible = depth > 0.3;
    if (!this.points.visible) return;
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3 + 1] += (0.7 + (i % 5) * 0.15) * dt;
      this.positions[i * 3] += Math.sin(performance.now() * 0.001 + i) * 0.003;
      const y = this.positions[i * 3 + 1];
      const dx = this.positions[i * 3] - camera.x;
      const dz = this.positions[i * 3 + 2] - camera.z;
      if (y > surfaceY || y > camera.y + 7 || Math.hypot(dx, dz) > 10) this.reset(i, camera.x, camera.y, camera.z);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
