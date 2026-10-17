// User interface: HUD (vitals, compass, radar, prompts), panels (inventory, crafting,
// modules, map, journal, codex, settings, pause) and the start screen.
// The UI reads game state through `state` and reports player intent via `onAction`.
import { QUALITY_PRESETS } from '../app/settings.js';
import { MODULE_SLOTS } from '../systems/inventory.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyLabel = (code) => (code ?? '—').replace(/^Key/, '').replace(/^Digit/, '').replace('Mouse0', 'Clic gauche').replace('Mouse1', 'Clic milieu').replace('Mouse2', 'Clic droit').replace('ShiftLeft', 'Maj').replace('ShiftRight', 'Maj droite').replace('Space', 'Espace').replace('Escape', 'Échap');
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export class UI {
  /**
   * @param content   loaded content
   * @param onAction  callback(name, payload) for menu and button actions
   */
  constructor(content, onAction) {
    this.content = content;
    this.onAction = onAction;
    this.panel = null;
    this.tab = 'items';
    this.toastTimer = 0;
    this.radar = $('radar').getContext('2d');
    this.mapCanvas = null;
    this.mapCache = null;
    this.mapCacheKey = '';
    this.scanTimeout = 0;
    this.damageAlpha = 0;
    document.getElementById('panel').addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const [name, payload] = target.dataset.action.split(':');
      this.onAction(name, payload ?? target.dataset.value ?? null);
    });
    $('start').addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const [name, payload] = target.dataset.action.split(':');
      this.onAction(name, payload ?? null);
    });
  }

  showStart(hasSave) {
    $('start').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('btn-continue').disabled = !hasSave;
  }

  showGame() {
    $('start').classList.add('hidden');
    $('hud').classList.remove('hidden');
  }

  get seedInput() {
    return $('seed-input').value.trim();
  }

  get difficultyInput() {
    return $('difficulty-input').value;
  }

  error(message) {
    const box = $('error');
    box.textContent = message;
    box.classList.remove('hidden');
  }

  toast(text, kind = 'info') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => el.remove(), 5000);
  }

  setPrompt(text) {
    const el = $('prompt');
    if (el.textContent !== (text ?? '')) el.textContent = text ?? '';
    el.classList.toggle('hidden', !text);
  }

  showScan(info) {
    const card = $('scan-card');
    card.innerHTML = `<h3>${esc(info.title)}</h3><p>${esc(info.body)}</p>${info.stats ? `<dl>${info.stats.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}`;
    card.classList.remove('hidden');
    clearTimeout(this.scanTimeout);
    this.scanTimeout = setTimeout(() => card.classList.add('hidden'), 9000);
  }

  flashDamage(amount) {
    this.damageAlpha = Math.min(0.55, this.damageAlpha + amount / 60);
  }

  /** Per-frame HUD refresh. `s` is the snapshot built by the game. */
  update(dt, s) {
    $('bar-energy').style.width = `${s.energy.toFixed(1)}%`;
    $('bar-integrity').style.width = `${s.integrity.toFixed(1)}%`;
    $('val-energy').textContent = `${Math.round(s.energy)}`;
    $('val-integrity').textContent = `${Math.round(s.integrity)}`;
    $('bar-energy').classList.toggle('low', s.energy < 20);
    $('bar-integrity').classList.toggle('low', s.integrity < 30);
    $('temp').textContent = `${s.temperature.toFixed(0)} °C`;
    $('weather').textContent = s.weatherLabel;
    $('tool').textContent = Math.round(s.tool);
    $('tool').style.color = s.tool < 30 ? '#ff5d5d' : '';
    $('depth').textContent = s.depth ? `Prof. ${s.depth.value.toFixed(0)} m / ${s.depth.limit.toFixed(0)} m` : '';
    $('depth').style.color = s.depth && s.depth.value > s.depth.limit ? '#ff5d5d' : '';
    $('biome').textContent = s.biomeName;
    $('clock').textContent = s.clock;
    $('objective').textContent = s.objective;
    $('scan-progress').classList.toggle('hidden', !s.scanning);
    $('cross').classList.toggle('aim', s.aiming);
    this.setPrompt(s.prompt);
    this.drawCompass(s);

    const vehicleHud = $('vehicle-hud');
    vehicleHud.classList.toggle('hidden', !s.vehicle);
    if (s.vehicle) {
      const v = s.vehicle;
      $('vehicle-name').textContent = v.name;
      $('vehicle-speed').textContent = `${v.kmh.toFixed(0)} km/h`;
      $('vehicle-extra').textContent = v.altitude !== null ? `Altitude ${v.altitude.toFixed(0)} m` : v.depth !== null ? `Profondeur ${v.depth.toFixed(0)} m` : '';
      $('vehicle-energy').textContent = `Énergie ${Math.round(v.energy)} %`;
      $('vehicle-hull').textContent = `Coque ${Math.round(v.hull)} %`;
      $('vehicle-energy').style.color = v.energy < 20 ? '#ff5d5d' : '';
      $('vehicle-hull').style.color = v.hull < 30 ? '#ff5d5d' : '';
    }

    this.damageAlpha = Math.max(0, this.damageAlpha - dt * 1.2);
    $('damage').style.opacity = this.damageAlpha.toFixed(3);
    this.drawRadar(s);

    const perf = $('perf');
    perf.classList.toggle('hidden', !s.perfVisible);
    if (s.perfVisible && s.perf) {
      const p = s.perf;
      perf.textContent = `${p.fps.toFixed(0)} FPS · ${p.avgMs.toFixed(1)} ms moy. · p95 ${p.p95Ms.toFixed(1)} ms\n`
        + `draw ${p.drawCalls} · tris ${(p.triangles / 1000).toFixed(0)}k · géom. ${p.geometries} · tex. ${p.textures}\n`
        + `CPU jeu ${p.updateMs.toFixed(1)} ms · soumission rendu ${p.renderMs.toFixed(1)} ms\n`
        + `chunks ${s.chunks} · faune ${s.creatures} (vues ${s.views}) · ennemis ${s.enemies}`;
    }
  }

  drawCompass(s) {
    const strip = $('compass-strip');
    const headingDeg = ((s.yaw * 180) / Math.PI + 360) % 360;
    let html = '';
    for (let d = -180; d <= 180; d += 15) {
      const deg = (headingDeg + d + 720) % 360;
      const label = deg % 90 === 0 ? COMPASS[Math.round(deg / 45) % 8] : deg % 45 === 0 ? COMPASS[Math.round(deg / 45) % 8] : '';
      html += `<span class="tick" style="left:${50 + (d / 180) * 50}%">${label || '|'}</span>`;
    }
    for (const m of s.markers) {
      const rel = ((m.bearing - headingDeg + 540) % 360) - 180;
      if (Math.abs(rel) > 90) continue;
      html += `<span class="marker ${m.kind}" style="left:${50 + (rel / 180) * 50}%">▼ ${m.label} ${m.distance}m</span>`;
    }
    strip.innerHTML = html;
  }

  drawRadar(s) {
    const ctx = this.radar;
    const size = 150;
    const r = 70;
    const scale = r / (s.radarRange ?? 80);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(8, 16, 24, 0.7)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(127, 233, 255, 0.5)';
    ctx.stroke();
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    // Player-centred view: forward is up. Right = (-cos, sin), forward = (sin, cos).
    const plot = (x, z, color, size2 = 3) => {
      const dx = x - s.player.x;
      const dz = z - s.player.z;
      const u = -dx * cos + dz * sin;
      const v = dx * sin + dz * cos;
      const px = size / 2 + u * scale;
      const pz = size / 2 - v * scale;
      if (Math.hypot(px - size / 2, pz - size / 2) > r - 4) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, pz, size2, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const c of s.radar.creatures) plot(c.x, c.z, c.predator ? '#ff5d5d' : '#7dff9f');
    for (const e of s.radar.enemies) plot(e.x, e.z, '#ff3b3b', 4);
    for (const p of s.radar.points) plot(p.x, p.z, '#ffd166', 4);
    if (s.objectiveTarget) plot(s.objectiveTarget.x, s.objectiveTarget.z, '#7fe9ff', 4);
    ctx.fillStyle = '#7fe9ff';
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2 - 9);
    ctx.lineTo(size / 2 + 6, size / 2 + 6);
    ctx.lineTo(size / 2 - 6, size / 2 + 6);
    ctx.closePath();
    ctx.fill();
  }

  // ---- Panels ------------------------------------------------------------

  openPanel(name, data) {
    this.panel = name;
    const root = $('panel');
    root.classList.remove('hidden');
    this.renderPanel(name, data);
  }

  closePanel() {
    this.panel = null;
    $('panel').classList.add('hidden');
    $('panel').innerHTML = '';
  }

  refreshPanel(data) {
    if (this.panel) this.renderPanel(this.panel, data);
  }

  renderPanel(name, d) {
    const root = $('panel');
    const renderers = {
      inventory: () => this.inventoryHtml(d),
      map: () => this.mapHtml(d),
      journal: () => this.journalHtml(d),
      codex: () => this.codexHtml(d),
      settings: () => this.settingsHtml(d),
      pause: () => this.pauseHtml(d),
      build: () => this.buildHtml(d),
      structure: () => this.structureHtml(d)
    };
    const titles = {
      inventory: 'Inventaire & fabrication', map: 'Carte', journal: 'Journal de mission', codex: 'Codex', settings: 'Paramètres', pause: 'Pause',
      build: 'Construction', structure: d.structure ? d.structure.def.name : 'Structure'
    };
    const content = renderers[name]();
    root.innerHTML = `<div class="sheet"><header><h2>${titles[name]}</h2><button data-action="close" class="ghost">Fermer (Échap)</button></header>${content}</div>`;
    if (name === 'map') this.paintMap(d);
  }

  inventoryHtml(d) {
    const { inventory, content } = d;
    const tabs = [['items', 'Inventaire'], ['craft', 'Fabrication'], ['modules', 'Modules']];
    const tabsHtml = `<nav class="tabs">${tabs.map(([k, l]) => `<button data-action="tab" data-value="${k}" class="${this.tab === k ? 'active' : ''}">${l}</button>`).join('')}</nav>`;
    const capacityHtml = `<p class="muted">Capacité : ${inventory.used} / ${inventory.capacity}</p>`;
    if (this.tab === 'items') {
      const rows = Object.entries(inventory.counts).sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, n]) => {
          const item = content.itemsById[id];
          const useBtn = item.category === 'consumable' ? `<button data-action="use" class="small">Utiliser</button>` : '';
          const equipBtn = item.category === 'module' ? `<button data-action="equip:${id}" class="small">Installer</button>` : '';
          return `<li><span><b>${esc(item.name)}</b> × ${n}<br><small class="muted">${esc(item.description)}</small></span>${useBtn}${equipBtn}</li>`;
        }).join('');
      return `${tabsHtml}${capacityHtml}<ul class="list">${rows || '<li class="muted">Inventaire vide. Collectez des ressources avec E.</li>'}</ul>`;
    }
    if (this.tab === 'craft') {
      const stationName = { hand: 'kit portable', workbench: 'établi', lab: 'laboratoire' };
      const rank = { hand: 0, workbench: 1, lab: 2 };
      const rows = content.recipes.map((r) => {
        const out = content.itemsById[r.output.item];
        const ing = Object.entries(r.ingredients).map(([id, n]) => `<span style="color:${inventory.count(id) >= n ? 'inherit' : '#ff8a8a'}">${esc(content.itemsById[id].name)} ${inventory.count(id)}/${n}</span>`).join(' · ');
        const hasStation = rank[d.station] >= rank[r.station ?? 'hand'];
        const ok = hasStation && Object.entries(r.ingredients).every(([id, n]) => inventory.count(id) >= n);
        const need = hasStation ? '' : ` <small style="color:#ffb347">(nécessite : ${stationName[r.station]})</small>`;
        return `<li><span><b>${esc(out.name)}</b>${need}<br><small class="muted">${ing}</small></span><button data-action="craft" data-value="${r.id}" class="small" ${ok ? '' : 'disabled'}>Fabriquer</button></li>`;
      }).join('');
      return `${tabsHtml}${capacityHtml}<p class="muted">Station disponible : ${stationName[d.station]}</p><ul class="list">${rows}</ul>`;
    }
    const slots = MODULE_SLOTS.map((slot) => {
      const id = inventory.modules[slot];
      const item = id ? content.itemsById[id] : null;
      return `<li><span><b>${slot}</b><br><small class="muted">${item ? `${esc(item.name)} — ${esc(item.description)}` : 'Emplacement vide'}</small></span></li>`;
    }).join('');
    return `${tabsHtml}<ul class="list">${slots}</ul>`;
  }

  mapHtml() {
    return `<canvas id="map-canvas" width="640" height="480"></canvas>
      <p class="muted">Légende : ● bleu = robot · ▲ rouge = ennemi · ● vert = faune · ● rouge = prédateur · ◆ jaune = point d'intérêt · ◆ cyan = objectif. Rayon : 600 m.</p>`;
  }

  paintMap(d) {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: W, height: H } = canvas;
    const R = 600;
    const cell = 8;
    const key = `${Math.round(d.player.x / 20)}:${Math.round(d.player.z / 20)}`;
    if (this.mapCacheKey !== key) {
      const off = document.createElement('canvas');
      off.width = Math.ceil(W / cell);
      off.height = Math.ceil(H / cell);
      const octx = off.getContext('2d');
      for (let j = 0; j < off.height; j++) {
        for (let i = 0; i < off.width; i++) {
          const wx = d.player.x + (i * cell - W / 2) * (2 * R / W);
          const wz = d.player.z - (j * cell - H / 2) * (2 * R / W);
          const sample = d.biomeAt(wx, wz);
          octx.fillStyle = sample;
          octx.fillRect(i, j, 1, 1);
        }
      }
      this.mapCache = off;
      this.mapCacheKey = key;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapCache, 0, 0, W, H);
    const toPx = (x, z) => [W / 2 + (x - d.player.x) * (W / (2 * R)), H / 2 - (z - d.player.z) * (W / (2 * R))];
    const dot = (x, z, color, shape = 'circle', size = 5) => {
      const [px, py] = toPx(x, z);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#0b1218';
      ctx.beginPath();
      if (shape === 'tri') { ctx.moveTo(px, py - size); ctx.lineTo(px + size, py + size); ctx.lineTo(px - size, py + size); }
      else if (shape === 'diamond') { ctx.moveTo(px, py - size); ctx.lineTo(px + size, py); ctx.lineTo(px, py + size); ctx.lineTo(px - size, py); }
      else ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    for (const p of d.points) dot(p.x, p.z, '#ffd166', 'diamond', 7);
    for (const c of d.creatures) dot(c.x, c.z, c.predator ? '#ff5d5d' : '#7dff9f', 'circle', 3);
    for (const e of d.enemies) dot(e.x, e.z, '#ff3b3b', 'tri', 5);
    if (d.objectiveTarget) dot(d.objectiveTarget.x, d.objectiveTarget.z, '#7fe9ff', 'diamond', 8);
    for (const v of d.vehicles) dot(v.x, v.z, '#e0873a', 'circle', 6);
    for (const b of d.structures) dot(b.x, b.z, '#9bd1ff', 'diamond', 4);
    dot(d.player.x, d.player.z, '#7fe9ff', 'circle', 6);
    ctx.fillStyle = '#e8f7ff';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('N ↑  — 600 m', 10, 20);
  }

  journalHtml(d) {
    const { missions } = d;
    const done = missions.completed.map((id) => {
      const m = this.content.missions.find((x) => x.id === id);
      return m ? `<li class="done"><b>✔ ${esc(m.title)}</b><br><small class="muted">${esc(m.completion)}</small></li>` : '';
    }).join('');
    const current = missions.mission
      ? `<li class="current"><b>${esc(missions.mission.title)}</b><ul>${missions.mission.steps.map((s) => `<li class="${missions.stepDone(s) ? 'done' : ''}">${missions.stepDone(s) ? '✔' : '○'} ${esc(s.text)}</li>`).join('')}</ul></li>`
      : '<li class="muted">Toutes les missions principales sont terminées. L\'exploration reste libre.</li>';
    const log = d.logEntries.map((l) => `<li><small class="muted">${esc(l)}</small></li>`).join('');
    return `<div class="split"><div><h3>En cours</h3><ul class="list">${current}</ul></div>
      <div><h3>Terminées</h3><ul class="list">${done || '<li class="muted">Aucune pour l’instant.</li>'}</ul>
      <h3>Journal</h3><ul class="list log">${log}</ul></div></div>`;
  }

  codexHtml(d) {
    const species = this.content.species.map((s) => {
      const known = d.codex.species.includes(s.id);
      return `<li class="${known ? '' : 'locked'}"><b>${known ? esc(s.name) : '???'}</b> <small class="muted">${known ? `${esc(s.diet)} · ${esc(s.temperament)} · ${s.size.length} m` : 'Non scanné'}</small>${known ? `<br><small>${esc(s.description)}</small>` : ''}</li>`;
    }).join('');
    const points = d.allPoints.map((p) => {
      const known = d.codex.points.includes(p.id);
      return `<li class="${known ? '' : 'locked'}"><b>${known ? esc(p.name) : '???'}</b>${known ? `<br><small>${esc(p.log)}</small>` : ''}</li>`;
    }).join('');
    return `<div class="split"><div><h3>Faune (${d.codex.species.length}/${this.content.species.length})</h3><ul class="list">${species}</ul></div>
      <div><h3>Lieux (${d.codex.points.length}/${d.allPoints.length})</h3><ul class="list">${points}</ul></div></div>`;
  }

  settingsHtml(d) {
    const s = d.settings;
    const rows = Object.entries(d.bindings).map(([action, codes]) => `<li><span>${esc(this.content.controls.labels[action] ?? action)}</span>
      <span><kbd>${esc(codes.map(keyLabel).join(' / '))}</kbd> <button class="small" data-action="rebind" data-value="${action}">Modifier</button></span></li>`).join('');
    const qualityButtons = Object.entries(QUALITY_PRESETS).map(([k, p]) => `<button class="small ${s.quality === k ? 'active' : ''}" data-action="quality" data-value="${k}">${p.label}</button>`).join(' ');
    const diffButtons = ['easy', 'normal', 'hard'].map((k) => `<button class="small ${s.difficulty === k ? 'active' : ''}" data-action="difficulty" data-value="${k}">${{ easy: 'Facile', normal: 'Normal', hard: 'Difficile' }[k]}</button>`).join(' ');
    return `<div class="split">
      <div>
        <h3>Réglages</h3>
        <ul class="list">
          <li><span>Sensibilité souris</span><span><button class="small" data-action="sens" data-value="-1">−</button> ${s.sensitivity} <button class="small" data-action="sens" data-value="1">+</button></span></li>
          <li><span>Inverser l'axe Y</span><span><button class="small ${s.invertY ? 'active' : ''}" data-action="invert">${s.invertY ? 'Oui' : 'Non'}</button></span></li>
          <li><span>Champ de vision</span><span><button class="small" data-action="fov" data-value="-2">−</button> ${s.fov}° <button class="small" data-action="fov" data-value="2">+</button></span></li>
          <li><span>Volume</span><span><button class="small" data-action="volume" data-value="-0.1">−</button> ${Math.round(s.volume * 100)} % <button class="small" data-action="volume" data-value="0.1">+</button></span></li>
          <li><span>Qualité graphique</span><span>${qualityButtons}</span></li>
          <li><span>Difficulté</span><span>${diffButtons}</span></li>
          <li><span>Réinitialiser les commandes</span><span><button class="small" data-action="reset-bindings">Défaut</button></span></li>
        </ul>
      </div>
      <div><h3>Commandes</h3><ul class="list controls">${rows}</ul><p class="muted" id="rebind-hint"></p></div>
    </div>`;
  }

  buildHtml(d) {
    const rows = Object.entries(d.structureDefs.structures).map(([id, def]) => {
      const cost = Object.entries(def.cost).map(([item, n]) => `<span style="color:${d.inventory.count(item) >= n ? 'inherit' : '#ff8a8a'}">${esc(d.content.itemsById[item].name)} ${d.inventory.count(item)}/${n}</span>`).join(' · ');
      const ok = Object.entries(def.cost).every(([item, n]) => d.inventory.count(item) >= n);
      const power = def.power > 0 ? `+${def.power} énergie` : def.power < 0 ? `${def.power} énergie` : 'sans énergie';
      return `<li><span><b>${esc(def.name)}</b> <small class="muted">(${power})</small><br><small class="muted">${esc(def.description)}</small><br><small>${cost}</small></span>
        <button class="small" data-action="select-structure" data-value="${id}" ${ok ? '' : 'disabled'}>Placer</button></li>`;
    }).join('');
    return `<p class="muted">Viser le sol, clic gauche pour poser, Z / X pour pivoter, Échap pour annuler. T démonte la structure la plus proche (60 % des ressources rendus).</p><ul class="list">${rows}</ul>`;
  }

  structureHtml(d) {
    const s = d.structure;
    if (!s) return '<p class="muted">Aucune structure à proximité.</p>';
    const def = s.def;
    const status = s.powered ? '<span style="color:#7dff9f">alimentée</span>' : '<span style="color:#ff8a8a">hors tension (énergie insuffisante)</span>';
    const net = s.networkSupply !== undefined ? ` · réseau ${s.networkSupply} / ${s.networkDemand}` : '';
    let body = `<p class="muted">${esc(def.description)}</p><p>Niveau ${s.level} · ${status}${net}</p>`;
    const buttons = [];
    if (s.typeId === 'habitat') buttons.push('<button data-action="rest">Se reposer (réparation complète, sauvegarde, +4 h)</button>');
    if (s.typeId === 'lab' || s.typeId === 'workbench') buttons.push('<button data-action="open-craft">Ouvrir la fabrication</button>');
    if (def.upgrade) {
      const cost = Object.entries(def.upgrade.cost).map(([item, n]) => `${d.content.itemsById[item].name} ${n}`).join(', ');
      buttons.push(`<button data-action="upgrade" ${s.level >= 2 ? 'disabled' : ''}>Améliorer (${esc(cost)})</button>`);
    }
    buttons.push('<button data-action="dismantle-structure">Démonter</button>');
    if (s.typeId === 'storage') {
      const stored = Object.entries(s.storage).map(([id, n]) => `<li><span>${esc(d.content.itemsById[id].name)} × ${n}</span><span><button class="small" data-action="withdraw" data-value="${id}:1">−1</button> <button class="small" data-action="withdraw" data-value="${id}:10">−10</button></span></li>`).join('');
      const carried = Object.entries(d.inventory.counts).map(([id, n]) => `<li><span>${esc(d.content.itemsById[id].name)} × ${n}</span><span><button class="small" data-action="deposit" data-value="${id}:1">+1</button> <button class="small" data-action="deposit" data-value="${id}:10">+10</button> <button class="small" data-action="deposit" data-value="${id}:all">tout</button></span></li>`).join('');
      body += `<p>Contenu : ${s.stored} / ${s.capacity}</p><div class="split"><div><h3>Entrepôt</h3><ul class="list">${stored || '<li class="muted">Vide</li>'}</ul></div><div><h3>Inventaire</h3><ul class="list">${carried || '<li class="muted">Vide</li>'}</ul></div></div>`;
    }
    if (s.typeId === 'garage') {
      const rows = Object.entries(d.content.vehicles).filter(([, v]) => v.cost).map(([id, v]) => {
        const cost = Object.entries(v.cost).map(([item, n]) => `<span style="color:${d.inventory.count(item) >= n ? 'inherit' : '#ff8a8a'}">${esc(d.content.itemsById[item].name)} ${d.inventory.count(item)}/${n}</span>`).join(' · ');
        const ok = s.powered && Object.entries(v.cost).every(([item, n]) => d.inventory.count(item) >= n);
        return `<li><span><b>${esc(v.name)}</b><br><small class="muted">${cost}</small></span><button class="small" data-action="build-vehicle" data-value="${id}" ${ok ? '' : 'disabled'}>Construire</button></li>`;
      }).join('');
      body += `<h3>Atelier de véhicules</h3><ul class="list">${rows}</ul>`;
    }
    return `${body}<div class="stack">${buttons.join('')}</div>`;
  }

  pauseHtml(d) {
    return `<div class="stack">
      <button data-action="resume">Reprendre</button>
      <button data-action="save">Sauvegarder${d.lastSave ? ` (${esc(d.lastSave)})` : ''}</button>
      <button data-action="load" ${d.hasSave ? '' : 'disabled'}>Charger la dernière sauvegarde</button>
      <button data-action="open" data-value="settings">Paramètres</button>
      <button data-action="quit">Retour au menu principal</button>
    </div>
    <p class="muted">Sauvegarde automatique toutes les 90 secondes. Une écriture interrompue n'altère jamais la sauvegarde précédente.</p>`;
  }

  setRebindHint(text) {
    const hint = document.getElementById('rebind-hint');
    if (hint) hint.textContent = text;
  }

}

