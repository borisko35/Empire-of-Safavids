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
  groundHeight, buildTerrain, buildScatter, buildCity, buildCamp, buildWater, buildSettlements, buildRoads,
  bridgeAt, waterSurfaceY, WORLD_HALF, CITY, CAMP, LAKE, COLLIDERS, FAUNA_COLLIDERS, CIV_COLLIDERS,
} from './terrain';
import { createSky, SkyHandle, SKY_RADIUS } from './sky';
import { createFauna, FaunaHandle } from './fauna';
import { createNpcs, NpcsHandle } from './npc';
import { createCivilians, CiviliansHandle } from './civilians';
import { createWeather, WeatherHandle, type WeatherKind } from './weather';
import { buildTownBuildings, createInteriors, InteriorsHandle, INTERIOR_COLLIDERS, POCKET_COLLIDERS, buildPocketGround, pocketGroundY, BUILDINGS } from './interiors';
import { createNavigator, NavigatorHandle, NavTarget } from './navigator';
import { audio } from '../audio';
import { getSettings, graphicsProfile, type GraphicsLevel } from '../settings';
import { chatVisible } from '../hud';

export interface World3DCallbacks {
  onAttack: () => void;
  onTarget: (name: string, hp: number, maxHp: number) => void;
  onTargetCleared: () => void;
  /** Клик по NPC: открыть связанную панель */
  onNpc?: (panel: string, nameRu: string, npcId: string) => void;
  /** Клик по двери здания: войти/выйти (мир уже телепортирован, нужен только тост). */
  onDoor?: (action: 'enter' | 'exit', buildingId: string, nameRu: string) => void;
}

const GRAVITY = 20;
const JUMP_V = 7.6;
const WALK_SPEED = 4.2;
const RUN_SPEED = 7.6;
const CROUCH_SPEED = 2.2;
const PLAYER_R = 1.0;   // радиус персонажа для столкновений
const CAMERA_R = 0.35;  // камера может прижиматься к стене ближе, чем персонаж

// ── Вода ──
// Глубина считается от НАСТОЯЩЕГО дна (ландшафт) до поверхности воды,
// а не по маске waterMask: маска лишь говорит «здесь вода», но не насколько.
// Именно глубина решает, бродит персонаж или плывёт.
const WADE_MIN_DEPTH = 0.15;  // от этой глубины ноги уже в воде
const SWIM_MIN_DEPTH = 1.2;   // глубже — плавание, мельче — брод по дну
const SWIM_FEET = 1.2;        // во время плавания ноги на столько ниже поверхности
const SWIM_SPEED = 2.0;       // обычное плавание (быстрее идти, чем бродить)
const SWIM_SPRINT = 3.2;      // плавание с усилием
const WADE_MULT = 0.75;       // замедление в броду по воде

interface BoundRig {
  rig: Rig;
  kind: 'player' | 'monster';
  /** Монстр оказался в глубокой воде и плывёт (поза и анимация) */
  monsterSwim?: boolean;
  /** Подводное существо: рисуется на поверхности, а не под ней */
  aquatic?: boolean;
  /** Насколько тело поднято над водой (спина торчит) */
  aquaticLift?: number;
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
  private civilians!: CiviliansHandle;
  private weather!: WeatherHandle;
  private interiors!: InteriorsHandle;
  private doorTargets: THREE.Object3D[] = [];
  private navigator!: NavigatorHandle;
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
  private swimming = false;
  /** Высота ног локального игрока с предыдущего кадра (физика, а не ландшафт) */
  private feetY = Number.NaN;
  private keys = new Set<string>();
  /** Хватает ли стамины на бег/усиленное плавание — решает world.ts по полоске */
  private sprintAllowed = true;
  /** Скорость в воде и экономия стамины — из экипировки (сапоги, плащ) */
  private waterSpeedBonus = 0;
  private swimStaminaSave = 0;
  /** Лодка: id активной и её бонусы к воде */
  private boatId: string | null = null;
  private boatWaterSpeed = 0;
  private boatStaminaSave = 0;
  /** Скорость в воде на лодке, м/с */
  private boatSwimSpeed = 0;
  /** Сколько секунд осталось показывать «выдохся» после конца стамины */
  private exhaustedFlash = 0;
  private stepTimer = 0;
  private attackCd = 0;
  /**
   * Крючок «игрок замахнулся». Ставится слоем приложения (см. world.ts) —
   * туториалу нужно знать о замахе, а заводить зависимость от интерфейса
   * внутрь 3D-слоя нельзя.
   */
  private onAttack: (() => void) | null = null;
  /**
   * Крючок «игрок осмотрелся». Камеру крутит движение мыши при захвате
   * указателя, а не правая кнопка (она — блок), поэтому шаг туториала
   * засчитываем именно здесь. Иначе игрок крутил бы мышью и не видел бы
   * реакции, а текст шага обещал правую кнопку, которая тут ни при чём.
   */
  private onCamera: (() => void) | null = null;

  // Служебное
  private raf = 0;
  private lastFx = { floater: 0, effect: 0 };
  private targetRing!: THREE.Mesh;
  private targetRingTarget: string | null = null;
  private wasNight = false;
  private lastDir: { x: number; y: number; z: number } = { x: 0, y: 0, z: 1 };
  private callbacks: World3DCallbacks | null = null;
  private debugColliders!: THREE.Group;
  private wasInWater = false;
  private splashMesh!: THREE.Mesh;
  private bubbleTimer = 0;
  /** Следит за размером контейнера: полный экран и режим «с рамкой»
   *  меняют размер без события resize окна */
  private ro: ResizeObserver | null = null;

  get isLocked() { return this.locked; }

  /** Плывёт ли игрок — расход выносливости и звуки воды зависят от этого */
  get isSwimming() { return this.swimming; }

  /** На чём игрок: null — на берегу, иначе id активной лодки */
  get activeBoatId(): string | null { return this.boatId; }

  /**
   * Лодка: снимает замедление воды, добавляет скорость и экономит
   * выносливость. Заменяет сапоги, пока игрок в лодке, — берётся лучший
   * из двух бонусов, а не сумма (иначе лодка дала бы больше единицы).
   */
  setBoat(boatId: string | null, waterSpeed: number, staminaSave: number, swimSpeed = 0): void {
    this.boatId = boatId;
    this.boatWaterSpeed = boatId ? Math.max(0, Math.min(1, waterSpeed)) : 0;
    this.boatStaminaSave = boatId ? Math.max(0, Math.min(0.9, staminaSave)) : 0;
    this.boatSwimSpeed = boatId ? Math.max(0, swimSpeed) : 0;
  }

  /** Хватает ли выносливости на бег (и на усиленное плавание) */
  setSprintAllowed(v: boolean): void {
    // Момент, когда силы кончились, — один раз подсказываем игроку
    if (this.sprintAllowed && !v) this.exhaustedFlash = 0.4;
    this.sprintAllowed = v;
  }

  /** Экономия выносливости при плавании: сапоги/плащ или лодка */
  get waterStaminaSave(): number {
    return Math.max(this.swimStaminaSave, this.boatStaminaSave);
  }

  /** True один раз, только что выносливость закончилась */
  get exhaustedNow(): boolean {
    if (this.exhaustedFlash <= 0) return false;
    this.exhaustedFlash = 0;
    return true;
  }

  /**
   * Бонусы «для воды» из экипировки (сапоги/плащ): 0 — вода тормозит как
   * обычно, 1 — вода не мешает вовсе; stamina — экономия расхода.
   */
  setWaterBonus(waterSpeed: number, staminaSave: number): void {
    this.waterSpeedBonus = Math.max(0, Math.min(1, waterSpeed));
    this.swimStaminaSave = Math.max(0, Math.min(0.75, staminaSave));
  }

  /** Последнее направление движения в мировых координатах (для пакетов player:move) */
  get moveDir() { return this.lastDir; }

  /** Экипировать/снять оружие у персонажа */
  equipPlayerWeapon(show: boolean): void {
    if (!this.me) return;
    const b = this.rigs.get(this.me.id);
    if (b && b.kind === 'player') b.rig.equipWeapon(show);
  }

  /** Экипировать/снять щит у персонажа */
  equipPlayerShield(show: boolean): void {
    if (!this.me) return;
    const b = this.rigs.get(this.me.id);
    if (b && b.kind === 'player') b.rig.equipShield(show);
  }

  /** Проверить, экипировано ли оружие */
  isPlayerWeaponEquipped(): boolean {
    if (!this.me) return false;
    const b = this.rigs.get(this.me.id);
    return b && b.kind === 'player' ? b.rig.isWeaponEquipped() : false;
  }

  /** Проверить, экипирован ли щит */
  isPlayerShieldEquipped(): boolean {
    if (!this.me) return false;
    const b = this.rigs.get(this.me.id);
    return b && b.kind === 'player' ? b.rig.isShieldEquipped() : false;
  }

  // ── Инициализация ────────────────────────────────────────────
  init(container: HTMLElement, callbacks: World3DCallbacks): void {
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    buildRoads(this.scene);
    const city = buildCity(this.scene);
    for (const l of city.userData.lights as { x: number; z: number }[]) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(l.x, (l as { y?: number }).y ?? groundHeight(l.x, l.z) + 5.2, l.z);
      this.scene.add(light);
      this.torches.push({ light, base: 1.6 });
    }
    for (const d of buildTownBuildings(this.scene)) this.doorTargets.push(d);
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
    this.civilians = createCivilians(this.scene);
    this.weather = createWeather(this.scene, audio);
    this.interiors = createInteriors(this.scene);
    for (const d of this.interiors.clickTargets) this.doorTargets.push(d);
    buildPocketGround(this.scene);
    this.navigator = createNavigator(this.scene);

    // DEBUG: визуализация коллайдеров (нажмите Z для включения/выключения)
    console.log(`[Collision] Total colliders: ${COLLIDERS.length}`);
    this.debugColliders = new THREE.Group();
    this.debugColliders.visible = false;
    const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.35 });
    for (const c of COLLIDERS) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, 4, 12), debugMat);
      cyl.position.set(c.x, groundHeight(c.x, c.z) + 2, c.z);
      this.debugColliders.add(cyl);
    }
    this.scene.add(this.debugColliders);

    // Кольцо цели
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 28),
      new THREE.MeshBasicMaterial({ color: 0xba2a37, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);

    // Кольцо всплеска при входе в воду
    this.splashMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 1.8, 20),
      new THREE.MeshBasicMaterial({ color: 0xaaddee, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.splashMesh.rotation.x = -Math.PI / 2;
    this.splashMesh.visible = false;
    this.scene.add(this.splashMesh);

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
    // Размер контейнера меняется и без resize окна: полный экран и
    // экранный режим «с рамкой» уменьшают игровую область по-своему.
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(container);

    // Качество графики — из сохранённых настроек
    this.setGraphics(getSettings().graphics);
  }

  /**
   * Применить уровень графики: разрешение кадра, тени, дальность
   * прорисовки, плотность частиц погоды. Вызывается при входе в мир
   * и на лету из панели настроек.
   */
  setGraphics(level: GraphicsLevel, fogOn = getSettings().fog): void {
    if (!this.renderer || !this.scene || !this.sun || !this.camera) return;
    const p = graphicsProfile(level);

    // Разрешение кадра: <1 — сжатый кадр (быстро), >1 — суперсэмплинг (красиво)
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(2.5, p.pixelScale * (devicePixelRatio || 1))));

    // Тени: смена режима требует пересборки материалов
    const shadowsChanged = this.renderer.shadowMap.enabled !== p.shadows;
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (shadowsChanged) {
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => { m.needsUpdate = true; });
        else if (mat) mat.needsUpdate = true;
      });
    }
    if (this.sun.shadow.mapSize.x !== p.shadowMapSize) {
      this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }

    // Дальность прорисовки. Туманом ведает погода и хранит своё «домашнее»
    // значение far — меняем его же, иначе смена погоды всё откатит.
    const fog = this.scene.fog as THREE.Fog | null;
    const fogFar = fogOn ? p.fogFar : p.fogFar * 4; // туман выключен — просто очень далеко
    if (fog) fog.far = fogFar;
    // Небо — сфера радиусом SKY_RADIUS вокруг игрока. Дальняя плоскость
    // камеры всегда должна быть больше неё, иначе часть неба отсекается
    // и на том месте видно чёрный купол (background у сцены пустой).
    this.camera.far = Math.max(SKY_RADIUS * 1.15, fogFar + 750);
    this.camera.updateProjectionMatrix();
    this.weather?.setQuality(fogFar, p.weather);

    this.onResize();
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

  /** Цель стрелки-навигатора над игроком */
  setNavTarget(target: NavTarget | null): void {
    this.navigator?.setTarget(target);
  }

  /** Построенный маршрут навигатора (для мини-карты) */
  getNavRoute(): { x: number; z: number }[] {
    return this.navigator?.getRoute() ?? [];
  }

  /** Игровой час (0–23) от world:time — ведёт солнце/луну/звёзды */
  setClock(hour: number): void {
    if (Number.isFinite(hour)) this.clockHour = ((hour % 24) + 24) % 24;
  }

  /** Атака лучом из центра экрана без мыши (тот же путь, что у ЛКМ) */
  attackFromCamera(): void {
    this.tryAttack();
  }

  /** Подписка на замах — вызывается из слоя приложения */
  setOnAttack(cb: (() => void) | null): void {
    this.onAttack = cb;
  }

  /** Подписка на поворот камеры — вызывается из слоя приложения */
  setOnCamera(cb: (() => void) | null): void {
    this.onCamera = cb;
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
    // Шаг туториала «камера»: настоящий поворот камеры, а не дрожание мыши
    if (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3) this.onCamera?.();
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
    // DEBUG: переключение визуализации коллайдеров
    if (e.code === 'KeyZ') {
      this.debugColliders.visible = !this.debugColliders.visible;
      console.log(`[Collision] Debug colliders: ${this.debugColliders.visible ? 'ON' : 'OFF'} (${COLLIDERS.length} total)`);
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

    // Крючок для слоя приложения (туториал засчитывает замах).
    // Вызывается ДО проверки цели: игрок замахнулся — шаг засчитан, даже если
    // рядом никого не было. Прямая зависимость от tutorial.ts здесь была бы
    // нарушением слоёв: 3D-слой ничего не должен знать про интерфейс.
    this.onAttack?.();

    // Клик по NPC открывает связанную панель (приоритет над боем)
    // Сначала клик по NPC открывает панель, затем — дверь здания.
    if (this.pickNpc()) return;

    if (this.pickDoor()) return;

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
    const npcId = hits[0].object.userData.npcId as string | undefined;
    if (!panel) return false;
    this.callbacks?.onNpc?.(panel, name ?? '', npcId ?? '');
    return true;
  }

  /** Клик по двери здания: только детект. Телепорт — лишь после ACK
   *  сервера (иначе первый пакет из кармана опередит сброс трекинга
   *  и античит кикнет за спидхак). */
  private pickDoor(): boolean {
    if (!this.me || !this.doorTargets.length) return false;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = ray.intersectObjects(this.doorTargets, false);
    if (!hits.length || hits[0].distance > 22) return false;
    const ud = hits[0].object.userData as { doorBuilding?: string; doorAction?: string; doorName?: string };
    if (!ud.doorBuilding || (ud.doorAction !== 'enter' && ud.doorAction !== 'exit')) return false;
    this.callbacks?.onDoor?.(ud.doorAction, ud.doorBuilding, ud.doorName ?? ud.doorBuilding);
    return true;
  }

  /** Телепорт внутрь в точку от сервера (вызывать только по ack). */
  enterBuildingAt(id: string, target: { x: number; y: number; z: number }): boolean {
    if (!this.me) return false;
    const def = this.interiors.def(id);
    if (!def) return false;
    this.interiors.enter(id);
    this.weather?.setInside(true);
    this.me.pos.x = target.x;
    this.me.pos.y = target.y;
    this.me.pos.z = target.z;
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** Телепорт наружу в точку от сервера (вызывать только по ack). */
  exitBuildingAt(target: { x: number; y: number; z: number }): boolean {
    if (!this.me || !this.interiors.isInside()) return false;
    const def = this.interiors.insideDef();
    if (!def) return false;
    this.interiors.exit();
    this.weather?.setInside(false);
    this.me.pos.x = target.x;
    this.me.pos.y = target.y;
    this.me.pos.z = target.z;
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** Локальный выход без сервера: резиновая лента при отклонении движения. */  exitBuildingLocal(): boolean {
    if (!this.me || !this.interiors.isInside()) return false;
    const def = this.interiors.insideDef();
    if (!def) return false;
    this.interiors.exit();
    // Восстановить погоду при выходе локально (без сервера)
    if (!this.interiors.isInside()) this.weather?.setInside(false);
    this.me.pos.x = def.exitX;
    this.me.pos.z = def.exitZ;
    this.me.pos.y = groundHeight(def.exitX, def.exitZ);
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** Погода от сервера (world:time): дождь, гроза, песчаная буря. */
  setWeather(w: string): void {
    this.weather?.setWeather(w);
    // Тучи тоже должны знать о погоде: раньше небо вообще не получало
    // код погоды, поэтому в дождь и бурю облака оставались белыми
    this.sky?.setWeather((w || 'clear') as WeatherKind);
  }

  isInsideBuilding(): boolean {
    return this.interiors.isInside();
  }

  /** Восстановить состояние «внутри» по позиции спавна (вход в мир в кармане).
   *  Без телепорта и без сокета: сервер уже сбросил трекинг при AUTH.
   *  Без этого первый шаг в комнате упирался в кламп границ и давал кик. */
  enterBuildingLocalAt(x: number, z: number): string | null {
    if (!this.me) return null;
    const def = BUILDINGS.find((b) =>
      Math.abs(x - b.roomCx) <= 16 && Math.abs(z - b.roomCz) <= 16) ?? null;
    if (!def) return null;
    this.interiors.enter(def.id);
    return def.nameRu;
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
        // Экипировка по умолчанию: оружие класса видно, щит только для Кызылбаша
        const isLocal = id === this.me?.id;
        if (isLocal) {
          const hasWeapon = p.charClass !== 'sufi_mystic';
          const hasShield = p.charClass === 'qizilbash';
          b.rig.equipWeapon(hasWeapon);
          b.rig.equipShield(hasShield);
        }
      }
      // Высота тела — из логической позиции (мосты, плавание, интерьеры),
      // а не из ландшафта: иначе тело «улетает» на горы в кармане
      // и «тонет» на дне в воде.
      // Для локального игрока берём this.feetY — результат физики текущего
      // кадра (плавание держит на поверхности, внутри здания — пол комнаты).
      // Для остальных — позицию, пришедшую по сокету.
      const py = id === this.me?.id
        ? (Number.isFinite(this.feetY) ? this.feetY : groundHeight(p.pos.x, p.pos.z))
        : (Number.isFinite(p.pos.y) ? p.pos.y : groundHeight(p.pos.x, p.pos.z));
      b.rig.group.position.set(p.pos.x, py, p.pos.z);
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
      // Подводное ли? Флаг и высоту над водой шлёт сервер при спавне —
      // список существ меняется, клиенту о нём знать не нужно.
      if (m.aquatic) {
        b.aquatic = true;
        b.aquaticLift = m.aquaticSize ?? 0.25;
      }
      // Живой монстр не уходит под воду: раньше тело ставилось прямо на дно
      // (у озера оно на 3.2 м ниже поверхности) и разбойник «тонул», оставаясь
      // под водой. Теперь на глубине он держится у поверхности и плывёт,
      // на мелководье идёт по дну — так же, как уже сделано для фауны.
      const gy = groundHeight(m.pos.x, m.pos.z);
      const surf = waterSurfaceY(m.pos.x, m.pos.z);
      const mDepth = !m.deadAt && surf !== null ? surf - gy : 0;
      const swimM = mDepth > SWIM_MIN_DEPTH;
      b.monsterSwim = swimM;
      // Подводное существо торчит из воды, а не висит под ней: игрок должен
      // видеть, что в озере что-то есть, и подплывать к нему на осознанном
      // риске. Спина над водой — как у настоящей рыбы.
      const aquaticM = b.aquatic === true;
      const y = swimM && surf !== null
        ? (aquaticM ? surf + (b.aquaticLift ?? 0) : surf - SWIM_FEET)
        : gy;
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

  /** Пузырёк при плавании: маленькая полупрозрачная сфера, всплывает и исчезает */
  private spawnBubble(x: number, y: number, z: number): void {
    const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.06, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xccddff, transparent: true, opacity: 0.5 });
    const b = new THREE.Mesh(geo, mat);
    b.position.set(x + (Math.random() - 0.5) * 0.8, y - 0.2, z + (Math.random() - 0.5) * 0.8);
    this.scene.add(b);
    const start = performance.now();
    const vy = 1.5 + Math.random();
    const vx = (Math.random() - 0.5) * 0.4;
    const vz = (Math.random() - 0.5) * 0.4;
    const tick = () => {
      const t = (performance.now() - start) / 900;
      if (t >= 1) { this.scene.remove(b); b.geometry.dispose(); return; }
      b.position.x += vx * 0.016;
      b.position.y += vy * 0.016;
      b.position.z += vz * 0.016;
      b.scale.setScalar(1 + t * 0.5);
      mat.opacity = 0.5 * (1 - t);
      requestAnimationFrame(tick);
    };
    tick();
  }

  /** Выталкивает точку из цилиндрических коллайдеров построек (проходы — для углов) */
  private resolveCollisions(p: { x: number; z: number }, radius: number): void {
    this.resolveCircleList(p, radius, COLLIDERS);
    this.resolveCircleList(p, radius, FAUNA_COLLIDERS);
    // Коллайдеры интерьера живут в кармане мира — снаружи список пуст.
    this.resolveCircleList(p, radius, INTERIOR_COLLIDERS);
    // Забор кармана держит игрока на плато, даже если он как-то вышел из комнаты.
    this.resolveCircleList(p, radius, POCKET_COLLIDERS);
    // Горожане: сквозь них не пройти.
    this.resolveCircleList(p, radius, CIV_COLLIDERS);
  }

  private resolveCircleList(
    p: { x: number; z: number }, radius: number, list: { x: number; z: number; r: number }[],
  ): void {
    if (!list.length) return;
    for (let pass = 0; pass < 3; pass++) {
      let pushed = false;
      for (const c of list) {
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

    if (this.exhaustedFlash > 0) this.exhaustedFlash -= dt;

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
    const onBridge = bridgeAt(me.pos.x, me.pos.z);
    const surfaceY = waterSurfaceY(me.pos.x, me.pos.z);
    // Реальная глубина = поверхность воды − дно под ногами.
    // Раньше здесь стояла маска waterMask > 0.3, из-за чего во всей мягкой
    // прибрежной зоне включался «брод» с невидимым полом у поверхности —
    // персонаж ходил ПО воде. Теперь: мелко — идём по настоящему дну
    // (вода по пояс), глубоко — плывём, тело погружено, голова над водой.
    const bedY = this.interiors.isInside() ? Number.NaN : groundHeight(me.pos.x, me.pos.z);
    const depth = (surfaceY !== null && onBridge === null && !Number.isNaN(bedY))
      ? Math.max(0, surfaceY - bedY)
      : 0;
    this.swimming = depth > SWIM_MIN_DEPTH;
    const wading = depth > WADE_MIN_DEPTH && !this.swimming;
    // Усиленный бег/плытьё — только если хватает выносливости
    const shifting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.sprintAllowed;
    // Снаряжение для воды снимает замедление: сапоги/плащ уменьшают
    // множитель брода и прибавляют скорость плавания. Лодка даёт свой
    // бонус — берётся лучший из двух, а не сумма (иначе лодка дала бы
    // больше 1 и вода перестала бы тормозить совсем при любом снаряжении)
    const waterBonus = Math.max(this.waterSpeedBonus, this.boatWaterSpeed);
    const wadeMult = WADE_MULT + (1 - WADE_MULT) * waterBonus;
    const swimSpeed = SWIM_SPEED + (WALK_SPEED - SWIM_SPEED) * waterBonus;
    const swimSprint = SWIM_SPRINT + (RUN_SPEED - SWIM_SPRINT) * waterBonus;
    const boatSpeed = this.boatId ? this.boatSwimSpeed : 0;
    const speed = (this.swimming
      ? (shifting ? Math.max(swimSprint, boatSpeed * 1.25) : Math.max(swimSpeed, boatSpeed))
      : this.crouch ? CROUCH_SPEED : shifting ? RUN_SPEED : WALK_SPEED)
      * (wading ? wadeMult : 1);
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
      // Границы мира — только снаружи: карман интерьеров вне этих пределов,
      // внутри комнаты игрока держат стены-коллайдеры.
      if (!this.interiors.isInside()) {
        me.pos.x = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.x));
        me.pos.z = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.z));
      }
      me.flipped = false;
    }

    // Столкновения с постройками — каждый кадр (в т.ч. если затолкало в стену)
    this.resolveCollisions(me.pos, PLAYER_R);

    // ── Вертикаль: прыжок / плавание / мост / земля ──
    // Внутри здания пол — пол комнаты; в кармане вне комнат — плато.
    const pocketY = pocketGroundY(me.pos.x, me.pos.z);
    const groundY = this.interiors.isInside()
      ? this.interiors.floorY()
      : pocketY ?? groundHeight(me.pos.x, me.pos.z);
    const bridgeY = bridgeAt(me.pos.x, me.pos.z);
    // Невидимый пол у поверхности (wadeFloor) убран: в мелкой воде ступни
    // стоят на НАСТОЯЩЕМ дне, и игрок реально идёт по пояс в воде, а не
    // «гуляет» по поверхности.
    const effectiveGroundY = bridgeY !== null ? bridgeY : groundY;
    if (this.swimming) {
      // ... поверхность локального водоёма, а не всегда озера
      const swimLevel = surfaceY ?? LAKE.level;
      // Тело погружено: ноги под водой, голова над поверхностью.
      const floatY = swimLevel - SWIM_FEET;
      me.pos.y += (floatY - me.pos.y) * Math.min(1, dt * 4);
      this.vy *= 0.85; // гашение вертикальной скорости
      // Прыжок в воде = всплытие вверх
      if (this.keys.has('Space')) {
        this.vy = 3.5;
      }
      me.pos.y += this.vy * dt;
      // Не выше поверхности (иначе снова «ходим по воде») и не ниже дна:
      const lo = Math.max(effectiveGroundY + 0.2, swimLevel - 1.9);
      const hi = swimLevel - 0.7;
      me.pos.y = Math.min(Math.max(me.pos.y, lo), hi);
      this.grounded = false;
    } else if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      me.pos.y += this.vy * dt;
      if (me.pos.y <= effectiveGroundY) {
        me.pos.y = effectiveGroundY;
        this.vy = 0;
        this.grounded = true;
        audio.footstep(true);
      }
    } else {
      me.pos.y = effectiveGroundY;
      // Шаги: по мелкой воде — журчание, по земле — обычный шаг
      if (len > 0) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.stepTimer = speed > 6 ? 0.26 : 0.38;
          if (wading) audio.waterStep();
          else audio.footstep(speed > 6);
        }
      }
    }
    me.moving = len > 0;
    // Высота тела для рига: физика (мост/вода/пол комнаты), не ландшафт
    this.feetY = me.pos.y;

    // ── Водные эффекты: всплеск + пузырьки ──
    const inWater = wading || this.swimming;
    if (inWater && !this.wasInWater) {
      // Вошли в воду — всплеск на поверхности того водоёма, где стоим
      this.splashMesh.visible = true;
      this.splashMesh.position.set(me.pos.x, (surfaceY ?? LAKE.level) + 0.1, me.pos.z);
      (this.splashMesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
      this.splashMesh.scale.set(1, 1, 1);
      audio.splash();
    } else if (this.swimming) {
      // Пузырьки: каждые 0.4с при движении
      if (me.moving) {
        this.bubbleTimer -= dt;
        if (this.bubbleTimer <= 0) {
          this.bubbleTimer = 0.4;
          this.spawnBubble(me.pos.x, me.pos.y, me.pos.z);
        }
      }
    }
    // Анимация всплеска
    if (this.splashMesh.visible) {
      const mat = this.splashMesh.material as THREE.MeshBasicMaterial;
      mat.opacity -= dt * 1.2;
      this.splashMesh.scale.x += dt * 3;
      this.splashMesh.scale.z += dt * 3;
      if (mat.opacity <= 0) { this.splashMesh.visible = false; }
    }
    this.wasInWater = inWater;

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
          // Кольцо цели — над поверхностью воды, если монстр в воде,
          // иначе прямо под ногами (иначе кольцо уйдёт на дно вместе с ним)
          const rs = waterSurfaceY(m.pos.x, m.pos.z);
          this.targetRing.position.set(
            m.pos.x,
            rs !== null ? rs + 0.06 : b.rig.group.position.y + 0.06,
            m.pos.z,
          );
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
      const mSwim = b.kind === 'monster' && (b.monsterSwim === true);
      b.rig.update(dt, {
        moving,
        speed: spd,
        grounded: b.kind === 'monster' ? !mSwim : this.grounded,
        crouch: isMe && this.crouch,
        block: isMe && this.block,
        dead,
        swimming: b.kind === 'monster' ? mSwim : (isMe && this.swimming),
      });
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
    const swimCamOffset = this.swimming ? 0.4 : 0;
    const swimLevel = waterSurfaceY(me.pos.x, me.pos.z) ?? LAKE.level;
    const targetY = this.swimming
      ? me.pos.y + 1.15                       // взгляд — на торс пловца, не над головой
      : me.pos.y + 1.55 + (this.crouch ? -0.4 : 0);
    const camY = me.pos.y + 1.55 + swimCamOffset + Math.sin(this.pitch) * this.dist;
    const camX = me.pos.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist;
    const camZ = me.pos.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist;
    // Камера тоже не должна проникать в здания
    const cam = { x: camX, z: camZ };
    this.resolveCollisions(cam, CAMERA_R);
    const camGround = this.interiors.isInside()
      ? this.interiors.floorY()
      : pocketGroundY(cam.x, cam.z) ?? groundHeight(cam.x, cam.z);
    // Камера не ныряет: держим её над поверхностью воды в точке её стояния
    const camSurface = waterSurfaceY(cam.x, cam.z);
    const minY = Math.max(
      camGround + 0.5,
      camSurface !== null ? camSurface + 0.45 : -Infinity,
      this.swimming ? swimLevel + 0.6 : -Infinity,
    );
    this.camera.position.set(cam.x, Math.max(camY, minY), cam.z);
    this.camera.lookAt(me.pos.x, targetY, me.pos.z);

    // ── Свет и время суток ──
    const dayI = 1 - night;
    this.sky.update(dt, now, this.clockHour / 24, { x: me.pos.x, z: me.pos.z });
    this.fauna.update(dt, now);
    this.npcs.update(dt, now);
    // Позиция игрока нужна горожанам, чтобы они его обходили, а не шли сквозь
    this.civilians.update(dt, now, me.pos.x, me.pos.z);
    this.navigator.update(now, { x: me.pos.x, z: me.pos.z });

    // Солнце/луна по дуге: источник света следует за светилом.
    // Тучи гасят свет: в грозу мир не должен светиться как в полдень.
    const sunDir = this.sky.sunDirection;
    const useMoon = sunDir.y < 0.05;
    const lightDir = useMoon ? sunDir.clone().multiplyScalar(-1) : sunDir;
    const dim = 1 - this.sky.overcast * 0.45;
    this.sun.intensity = (useMoon ? 0.32 : 0.25 + dayI * 1.35) * dim;
    this.hemi.intensity = (0.28 + dayI * 0.55) * (1 - this.sky.overcast * 0.3);
    this.sun.color.setHex(useMoon ? 0x9db4e8 : night > 0.4 ? 0xffc98a : 0xffe8c0);
    if (this.sky.overcast > 0.3) {
      // В дождь и бурю свет холоднее — тучи отражают серое небо
      this.sun.color.lerp(new THREE.Color(0xb8c4d2), (this.sky.overcast - 0.3) / 0.7 * 0.5);
    }
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
    // Погода обновляется после записи цвета тумана из неба,
    // чтобы песчаная буря могла приглушить дальность поверх.
    this.weather.update(dt, me.pos.x, me.pos.z, me.pos.y, this.lastInCity);
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
    this.ro?.disconnect();
    this.ro = null;
    if (document.pointerLockElement) document.exitPointerLock();
    for (const [, b] of this.rigs) b.rig.dispose();
    this.rigs.clear();
    this.sky?.dispose();
    this.fauna?.dispose();
    this.npcs?.dispose();
    this.civilians?.dispose();
    this.weather?.dispose();
    this.interiors?.dispose();
    this.navigator?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.fxLayer?.remove();
    this.crosshair?.remove();
  }
}

function shortestAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
