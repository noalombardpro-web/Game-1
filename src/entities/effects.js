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
