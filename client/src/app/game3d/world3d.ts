// ============================================================
// World3D — 3D-движок игры — Empire of Safavids
// ============================================================
// Сцена Three.js: рельеф, город, лагерь, растительность; камера от
// третьего лица с орбитой 360° и зумом (pointer lock); физика
// персонажа (бег/прыжок/присед/блок); прицеливание лучом; боевые
// эффекты и плавающий урон. Сетевые данные читает из entities.World.

import * as THREE from 'three';
import { World, PlayerEntity } from '../entities';
import { buildPlayerRig, buildMonsterRig, Rig } from './rig';
import {
  groundHeight, buildTerrain, buildScatter, buildCity, buildCamp, buildWater, buildSettlements,
  WORLD_HALF, CITY, CAMP, COLLIDERS,
} from './terrain';
import { createSky, SkyHandle } from './sky';
import { createFauna, FaunaHandle } from './fauna';
import { createNpcs, NpcsHandle } from './npc';
import { audio } from '../audio';
import { chatVisible } from '../hud';

export interface World3DCallbacks {
  onAttack: () => void;
  onTarget: (name: string, hp: number, maxHp: number) => void;
  onTargetCleared: () => void;
  /** Клик по NPC: открыть связанную панель */
  onNpc?: (panel: string, nameRu: string) => void;
}

const GRAVITY = 20;
const JUMP_V = 7.6;
const WALK_SPEED = 4.2;
const RUN_SPEED = 7.6;
const CROUCH_SPEED = 2.2;
const PLAYER_R = 0.7;   // радиус персонажа для столкновений
const CAMERA_R = 0.35;  // камера может прижиматься к стене ближе, чем персонаж

interface BoundRig {
  rig: Rig;
  kind: 'player' | 'monster';
}

export class World3D {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private torches: { light: THREE.PointLight; base: number }[] = [];
  private flames: THREE.Mesh[] = [];
  private sky!: SkyHandle;
  private fauna!: FaunaHandle;
  private npcs!: NpcsHandle;
  private clockHour = 12;          // игровые сутки: 0–23
  private lastInCity = false;

  private container!: HTMLElement;
  private fxLayer!: HTMLElement;
  private crosshair!: HTMLElement;
  private entities: World | null = null;
  private me: PlayerEntity | null = null;
  private rigs = new Map<string, BoundRig>();

  // Камера
  private yaw = Math.PI;          // куда смотрит камера
  private pitch = 0.34;
  private dist = 7.5;
  private locked = false;

  // Физика игрока
  private vy = 0;
  private grounded = true;
  private crouch = false;
  private block = false;
  private keys = new Set<string>();
  private stepTimer = 0;
  private attackCd = 0;

  // Служебное
  private raf = 0;
  private lastFx = { floater: 0, effect: 0 };
  private targetRing!: THREE.Mesh;
  private targetRingTarget: string | null = null;
  private wasNight = false;
  private lastDir: { x: number; y: number; z: number } = { x: 0, y: 0, z: 1 };
  private callbacks: World3DCallbacks | null = null;

  get isLocked() { return this.locked; }

  /** Последнее направление движения в мировых координатах (для пакетов player:move) */
  get moveDir() { return this.lastDir; }

  // ── Инициализация ────────────────────────────────────────────
  init(container: HTMLElement, callbacks: World3DCallbacks): void {
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'gl-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb9c4c9, 60, 420);

    this.camera = new THREE.PerspectiveCamera(62, container.clientWidth / container.clientHeight, 0.1, 1600);

    // Свет
    this.hemi = new THREE.HemisphereLight(0xbfd6e4, 0x6b5a42, 0.75);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe8c0, 1.5);
    this.sun.position.set(60, 90, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 260;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    // Мир
    buildTerrain(this.scene);
    buildScatter(this.scene);
    const city = buildCity(this.scene);
    for (const l of city.userData.lights as { x: number; z: number }[]) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(l.x, (l as { y?: number }).y ?? groundHeight(l.x, l.z) + 5.2, l.z);
      this.scene.add(light);
      this.torches.push({ light, base: 1.6 });
    }
    buildCamp(this.scene);
    buildWater(this.scene);
    buildSettlements(this.scene);
    const flame = this.scene.getObjectByName('campfire-flame');
    if (flame) {
      this.flames.push(flame as THREE.Mesh);
      const fireLight = new THREE.PointLight(0xff7a20, 0, 26, 1.6);
      fireLight.position.set(CAMP.x, groundHeight(CAMP.x, CAMP.z) + 1.6, CAMP.z);
      this.scene.add(fireLight);
      this.torches.push({ light: fireLight, base: 3.2 });
    }

    // Небо, фауна и NPC города
    this.sky = createSky(this.scene);
    this.fauna = createFauna(this.scene);
    this.npcs = createNpcs(this.scene);

    // Кольцо цели
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 28),
      new THREE.MeshBasicMaterial({ color: 0xba2a37, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);

    // FX-слой и прицел
    this.fxLayer = document.createElement('div');
    this.fxLayer.className = 'fx-layer';
    container.appendChild(this.fxLayer);
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair hidden';
    container.appendChild(this.crosshair);

    // События
    window.addEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Привязать сетевые сущности и своего игрока */
  attach(entities: World, me: PlayerEntity): void {
    this.entities = entities;
    this.me = me;
  }

  /** Поза камеры — для e2e-хука window.__eos */
  getCameraPose(): { yaw: number; pitch: number; dist: number } {
    return { yaw: this.yaw, pitch: this.pitch, dist: this.dist };
  }

  setCameraPose(yaw: number, pitch: number, dist?: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    if (dist != null) this.dist = Math.min(15, Math.max(3.2, dist));
  }

  /** Игровой час (0–23) от world:time — ведёт солнце/луну/звёзды */
  setClock(hour: number): void {
    if (Number.isFinite(hour)) this.clockHour = ((hour % 24) + 24) % 24;
  }

  /** Атака лучом из центра экрана без мыши (тот же путь, что у ЛКМ) */
  attackFromCamera(): void {
    this.tryAttack();
  }

  // ── События ввода ────────────────────────────────────────────
  private onResize = () => {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) {
      this.renderer.domElement.requestPointerLock();
      return;
    }
    if (e.button === 0) this.tryAttack();
    if (e.button === 2) this.block = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) this.block = false;
  };

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    this.crosshair.classList.toggle('hidden', !this.locked);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.yaw -= e.movementX * 0.0026;
    this.pitch = Math.min(1.25, Math.max(-0.5, this.pitch + e.movementY * 0.0022));
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.locked) return;
    e.preventDefault();
    this.dist = Math.min(15, Math.max(3.2, this.dist + e.deltaY * 0.008));
  };

  /** Пока открыт чат или фокус в поле ввода — движение и прыжок отключены */
  private isTyping(): boolean {
    const el = document.activeElement;
    return chatVisible()
      || el instanceof HTMLInputElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLSelectElement;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping()) return;
    if (this.keys.has(e.code)) return;
    this.keys.add(e.code);
    if (e.code === 'Space' && this.me && this.grounded) {
      e.preventDefault();
      this.vy = JUMP_V;
      this.grounded = false;
      audio.jump();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  private onBlur = () => {
    this.keys.clear();
    this.block = false;
  };

  // ── Атака и прицеливание ─────────────────────────────────────

  /**
   * Захват цели: конус прицеливания от камеры (~12°) + запас по близости.
   * Работает надёжнее луча по мешам: не зависит от высоты прицела.
   */
  private acquireTarget(): string | null {
    if (!this.entities || !this.me) return null;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const camPos = this.camera.position;
    let best: string | null = null;
    let bestDot = 0.978; // ~12°
    for (const [id, m] of this.entities.monsters) {
      if (m.deadAt) continue;
      const y = groundHeight(m.pos.x, m.pos.z) + 1.1;
      const to = new THREE.Vector3(m.pos.x - camPos.x, y - camPos.y, m.pos.z - camPos.z);
      const dist = to.length();
      if (dist > 26) continue;
      to.normalize();
      const dot = to.dot(forward);
      if (dot > bestDot) { bestDot = dot; best = id; }
    }
    if (best) return best;
    // Фолбэк: ближайший монстр вплотную к игроку (замах «наугад»)
    let nearest: string | null = null;
    let nearestD = 3.4;
    for (const [id, m] of this.entities.monsters) {
      if (m.deadAt) continue;
      const d = Math.hypot(m.pos.x - this.me.pos.x, m.pos.z - this.me.pos.z);
      if (d < nearestD) { nearestD = d; nearest = id; }
    }
    return nearest;
  }

  private tryAttack(): void {
    if (this.attackCd > 0) return;
    this.attackCd = 0.45;

    // Клик по NPC открывает связанную панель (приоритет над боем)
    if (this.pickNpc()) return;

    // Мягкое прицеливание: конус от камеры, затем близость
    const id = this.acquireTarget();
    if (id && this.entities) {
      this.entities.targetId = id;
      const m = this.entities.monsters.get(id);
      if (m) this.callbacks?.onTarget(m.nameRu, m.hp, m.maxHp);
    }
    // Замах всегда (отклик на клик); пакет атаки уходит только при цели
    this.attackAnim = true;
    audio.whoosh();
    if (this.entities?.targetId) this.callbacks?.onAttack();
  }

  /** Луч из центра экрана по NPC; при попадании — открыть панель */
  private pickNpc(): boolean {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = ray.intersectObjects(this.npcs.clickTargets, true);
    if (!hits.length || hits[0].distance > 22) return false;
    const panel = hits[0].object.userData.npcPanel as string | undefined;
    const name = hits[0].object.userData.npcName as string | undefined;
    if (!panel) return false;
    this.callbacks?.onNpc?.(panel, name ?? '');
    return true;
  }

  // ── Синхронизация ригов ──────────────────────────────────────
  private syncRigs(): void {
    if (!this.entities) return;
    const seen = new Set<string>();

    for (const [id, p] of this.entities.players) {
      seen.add(id);
      let b = this.rigs.get(id);
      if (!b) {
        b = { rig: buildPlayerRig(p.charClass), kind: 'player' };
        b.rig.group.userData.playerId = id;
        this.scene.add(b.rig.group);
        this.rigs.set(id, b);
      }
      const y = groundHeight(p.pos.x, p.pos.z);
      b.rig.group.position.set(p.pos.x, y, p.pos.z);
    }

    for (const [id, m] of this.entities.monsters) {
      seen.add(id);
      let b = this.rigs.get(id);
      if (!b) {
        b = { rig: buildMonsterRig(m.monsterId), kind: 'monster' };
        b.rig.group.userData.monsterId = id;
        this.scene.add(b.rig.group);
        this.rigs.set(id, b);
      }
      const y = groundHeight(m.pos.x, m.pos.z);
      b.rig.group.position.set(m.pos.x, y, m.pos.z);
      // Поворот к направлению движения
      const dx = m.target.x - m.pos.x, dz = m.target.z - m.pos.z;
      if (Math.hypot(dx, dz) > 0.1) {
        const want = Math.atan2(dx, dz);
        b.rig.group.rotation.y += shortestAngle(want - b.rig.group.rotation.y) * 0.12;
      }
    }

    // Удалённые сущности
    for (const [id, b] of this.rigs) {
      if (!seen.has(id)) {
        this.scene.remove(b.rig.group);
        b.rig.dispose();
        this.rigs.delete(id);
      }
    }
  }

  // ── FX: плавающий урон и эффекты из entities.World ──────────
  private syncFx(now: number): void {
    if (!this.entities) return;
    // Новые флоатеры -> DOM-элементы, проецируемые из 3D
    const fl = this.entities.floaters;
    while (this.lastFx.floater < fl.length) {
      const f = fl[this.lastFx.floater++];
      const el = document.createElement('div');
      el.className = 'floater3d' + (f.crit ? ' crit' : '');
      el.textContent = f.text;
      el.style.color = f.color;
      el.dataset.born = String(f.born);
      el.dataset.x = String(f.x);
      el.dataset.z = String(f.y); // 2D-конвенция: floater.y хранит координату z
      this.fxLayer.appendChild(el);
      setTimeout(() => el.remove(), 1150);
    }
    if (fl.length === 0) this.lastFx.floater = 0;

    // Новые эффекты -> частицы (2D-конвенция: y хранит координату z)
    const ef = this.entities.effects;
    while (this.lastFx.effect < ef.length) {
      const e = ef[this.lastFx.effect++];
      if (e.kind === 'heal') this.burst(e.x2, e.y2, 0x6ecf7a, 10);
      else this.burst(e.x2, e.y2, e.kind === 'slash' ? 0xf4d26c : 0xe07a4a, 8);
    }
    if (ef.length === 0) this.lastFx.effect = 0;

    // Позиции флоатеров
    for (const el of Array.from(this.fxLayer.children) as HTMLElement[]) {
      const age = (now - Number(el.dataset.born)) / 1100;
      const x = Number(el.dataset.x), z = Number(el.dataset.z);
      const p = new THREE.Vector3(x, groundHeight(x, z) + 2.1 + age * 1.1, z).project(this.camera);
      el.style.transform = `translate(-50%,-50%) translate(${(p.x * 0.5 + 0.5) * this.container.clientWidth}px, ${(-p.y * 0.5 + 0.5) * this.container.clientHeight}px)`;
      el.style.opacity = String(1 - age);
    }
  }

  private burst(x: number, z: number, color: number, count: number): void {
    const y = groundHeight(x, z) + 1.3;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const geo = new THREE.SphereGeometry(0.09, 6, 6);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(geo, mat.clone());
      p.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 2 + Math.random() * 2.5, Math.sin(a) * (1 + Math.random() * 2));
      this.scene.add(p);
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / 420;
        if (t >= 1) { this.scene.remove(p); return; }
        v.y -= 9 * 0.016;
        p.position.addScaledVector(v, 0.016);
        (p.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        requestAnimationFrame(tick);
      };
      tick();
    }
  }

  /** Выталкивает точку из цилиндрических коллайдеров построек (проходы — для углов) */
  private resolveCollisions(p: { x: number; z: number }, radius: number): void {
    if (!COLLIDERS.length) return;
    for (let pass = 0; pass < 3; pass++) {
      let pushed = false;
      for (const c of COLLIDERS) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min) {
          if (d > 1e-4) {
            p.x = c.x + (dx / d) * min;
            p.z = c.z + (dz / d) * min;
          } else {
            p.x = c.x + min; // ровно в центре — толкаем на восток
          }
          pushed = true;
        }
      }
      if (!pushed) break;
    }
  }

  // ── Главный апдейт ───────────────────────────────────────────
  update(dt: number, now: number, night: number): void {
    if (!this.entities || !this.me) return;
    if ((night >= 1) !== this.wasNight) {
      this.wasNight = night >= 1;
      audio.setNight(this.wasNight);
    }
    const me = this.me;

    // ── Ввод движения (относительно камеры) ──
    let ix = 0, iz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('KeyQ')) this.yaw += dt * 2.2;
    if (this.keys.has('KeyE')) this.yaw -= dt * 2.2;
    this.crouch = this.keys.has('KeyC') || this.keys.has('ControlLeft');

    const len = Math.hypot(ix, iz);
    const speed = this.crouch ? CROUCH_SPEED : this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
    // Направление камеры в мире (нужно и для поворота рига ниже)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    if (len > 0) {
      ix /= len; iz /= len;
      const wx = ix * cos - iz * sin;
      const wz = -ix * sin - iz * cos;
      me.pos.x += wx * speed * dt;
      me.pos.z += wz * speed * dt;
      this.lastDir = { x: wx, y: 0, z: wz };
      // Границы мира
      me.pos.x = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.x));
      me.pos.z = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.z));
      me.flipped = false;
    }

    // Столкновения с постройками — каждый кадр (в т.ч. если затолкало в стену)
    this.resolveCollisions(me.pos, PLAYER_R);

    // ── Вертикаль: прыжок и земля ──
    const groundY = groundHeight(me.pos.x, me.pos.z);
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      me.pos.y += this.vy * dt;
      if (me.pos.y <= groundY) {
        me.pos.y = groundY;
        this.vy = 0;
        this.grounded = true;
        audio.footstep(true);
      }
    } else {
      me.pos.y = groundY;
      // Шаги
      if (len > 0) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.stepTimer = speed > 6 ? 0.26 : 0.38;
          audio.footstep(speed > 6);
        }
      }
    }
    me.moving = len > 0;

    // ── Риги ──
    this.syncRigs();
    for (const [id, b] of this.rigs) {
      const isMe = id === me.id;
      let moving = false, spd = 0, dead = false;
      if (b.kind === 'player') {
        const p = this.entities.players.get(id)!;
        moving = p.moving; spd = p.moving ? 5.5 : 0;
        if (isMe) dead = document.getElementById('overlay-death')?.classList.contains('hidden') === false;
      } else {
        const m = this.entities.monsters.get(id)!;
        moving = !m.deadAt && Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) > 0.15;
        spd = moving ? 3.4 : 0;
        dead = m.deadAt > 0;
        if (this.targetRingTarget === id && !dead) {
          this.targetRing.position.set(m.pos.x, groundHeight(m.pos.x, m.pos.z) + 0.06, m.pos.z);
          this.targetRing.rotation.z = now / 900;
        }
      }
      // Поворот игрока к направлению движения
      if (isMe && moving) {
        const dx = ix, dz = iz;
        const want = Math.atan2(dx * cos - dz * sin, -(dx * sin + dz * cos));
        b.rig.group.rotation.y += shortestAngle(want - b.rig.group.rotation.y) * Math.min(1, dt * 10);
      } else if (!isMe) {
        // поворот монстров задан выше
      }
      b.rig.update(dt, { moving, speed: spd, grounded: b.kind === 'monster' ? true : this.grounded, crouch: isMe && this.crouch, block: isMe && this.block, dead });
      if (b.kind === 'player' && isMe && this.attackAnim) b.rig.triggerAttack();
    }
    this.attackAnim = false;

    // ── FX, кольцо цели ──
    this.syncFx(now);
    if (this.entities.targetId && this.targetRingTarget !== this.entities.targetId) {
      const m = this.entities.monsters.get(this.entities.targetId);
      this.targetRing.visible = !!m;
      this.targetRingTarget = m ? this.entities.targetId : null;
    } else if (!this.entities.targetId) {
      this.targetRing.visible = false;
      this.targetRingTarget = null;
    }

    // ── Камера ──
    const targetY = groundHeight(me.pos.x, me.pos.z) + 1.55 + (this.crouch ? -0.4 : 0);
    const camY = me.pos.y + 1.55 + Math.sin(this.pitch) * this.dist;
    const camX = me.pos.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist;
    const camZ = me.pos.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist;
    // Камера тоже не должна проникать в здания
    const cam = { x: camX, z: camZ };
    this.resolveCollisions(cam, CAMERA_R);
    const minY = groundHeight(cam.x, cam.z) + 0.5;
    this.camera.position.set(cam.x, Math.max(camY, minY), cam.z);
    this.camera.lookAt(me.pos.x, targetY, me.pos.z);

    // ── Свет и время суток ──
    const dayI = 1 - night;
    this.sky.update(dt, now, this.clockHour / 24, { x: me.pos.x, z: me.pos.z });
    this.fauna.update(dt, now);
    this.npcs.update(dt, now);

    // Солнце/луна по дуге: источник света следует за светилом
    const sunDir = this.sky.sunDirection;
    const useMoon = sunDir.y < 0.05;
    const lightDir = useMoon ? sunDir.clone().multiplyScalar(-1) : sunDir;
    this.sun.intensity = useMoon ? 0.32 : 0.25 + dayI * 1.35;
    this.hemi.intensity = 0.28 + dayI * 0.55;
    this.sun.color.setHex(useMoon ? 0x9db4e8 : night > 0.4 ? 0xffc98a : 0xffe8c0);
    this.sun.position.set(
      me.pos.x + lightDir.x * 120,
      Math.max(24, lightDir.y * 120),
      me.pos.z + lightDir.z * 120,
    );
    this.sun.target.position.set(me.pos.x, 0, me.pos.z);
    // Туман под цвет горизонта — сцена сливается с куполом
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.sky.horizonColor);
    // Гомон базара — только в городе
    const inCity = Math.hypot(me.pos.x - CITY.x, me.pos.z - CITY.z) < CITY.radius + 12;
    if (inCity !== this.lastInCity) {
      this.lastInCity = inCity;
      audio.setCity(inCity);
    }
    // Водопад: прокрутка текстуры струй
    const waterfall = this.scene.getObjectByName('waterfall');
    if (waterfall) {
      const mat = (waterfall as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.offset.y = (mat.map.offset.y - dt * 0.55) % 1;
    }
    // Факелы и костёр
    const torchOn = 0.35 + night * 0.65;
    for (const t of this.torches) {
      t.light.intensity = t.base * torchOn * (0.86 + Math.sin(now / 90 + t.base * 7) * 0.14);
    }
    for (const f of this.flames) {
      f.scale.y = 1 + Math.sin(now / 70) * 0.18;
    }

    if (this.attackCd > 0) this.attackCd -= dt;
    this.renderer.render(this.scene, this.camera);
  }

  private attackAnim = false;

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    if (document.pointerLockElement) document.exitPointerLock();
    for (const [, b] of this.rigs) b.rig.dispose();
    this.rigs.clear();
    this.sky?.dispose();
    this.fauna?.dispose();
    this.npcs?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.fxLayer?.remove();
    this.crosshair?.remove();
  }
}

function shortestAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
