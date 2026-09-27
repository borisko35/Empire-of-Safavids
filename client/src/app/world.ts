// ============================================================
// Игровой мир: сокеты, движение, бой — Empire of Sefevids
// ============================================================
// Протокол: shared/constants.ts (SOCKET_EVENTS / SERVER_EVENTS).

import { socket } from './net';
import { api } from './api';
import { t, detectLocale, loadLocale } from './i18n';
import { Character, session, Vec3 } from './state';
import { World, PlayerEntity } from './entities';
import { loadPanelContent, checkWaterDanger, resetWaterDanger } from './panels';
import { requestCutsceneForQuest, advance, isCutscenePlaying } from './cutscene';
import { openNpcDialogue } from './dialogue';
import { NPC_WORLD_POSITIONS, questNpcPosition } from './game3d/npc';
import { GATE, groundHeight, waterSurfaceY } from './game3d/terrain';
import { STAMINA, GAME_VERSION } from '../../../shared/constants';
import { QuestDef, QuestObjectiveDef } from './state';
import { World3D } from './game3d/world3d';
import { audio } from './audio';
import {
  getSettings, updateSettings, applyDisplayMode, onSettingsChange,
  type DisplayMode, type GraphicsLevel,
} from './settings';
import {
  chatMessage, chatVisible, closeChat, hideTarget, loadInventory, loadQuests, loadRegions, updateMinimap,
  drawWorldMap,
  loadSkillbar, openChat, refreshBars, setWorldTime, showTarget, startCooldown,
  tickCooldowns, toast, loadBuffs, clearBuffs,
  showGuestBanner, promptClaimAccount,
} from './hud';
import { initTutorial, onTutorialAction, tickTutorial } from './tutorial';
import { loadAccountLinks } from './accountLinks';
import { icon, type IconName } from '../ui/icons';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const MOVE_SEND_MS = 100;   // частота пакетов движения (лимит анти-чита 30/сек)

/**
 * В этой точке вода глубже, чем брод: сухопутному монстру сюда нельзя.
 * Порог тот же, что и переход в плавание у игрока (world3d SWIM_MIN_DEPTH).
 */
function swimNeeded(x: number, z: number): boolean {
  const surf = waterSurfaceY(x, z);
  return surf !== null && surf - groundHeight(x, z) > 1.2;
}

let world3d: World3D | null = null;
let world: World | null = null;
let me: PlayerEntity | null = null;
let raf = 0;
let lastFrame = 0;
let lastMoveSent = 0;
/** Обратный отсчёт до следующей проверки «опасность в воде» (раз в секунду) */
let dangerTick = 0;
let lastMinimapDraw = 0;
let lastWorldmapDraw = 0;
let lastExploreCheck = 0;
// Уже отправленные explore-цели (чтобы не спамить endpoint каждый тик)
const exploreSent = new Set<string>();
let night = 0;
let deathTimer: ReturnType<typeof setTimeout> | null = null;


// ── Стрелка-навигатор: цель активного квеста ─────────────────
let navDefs: QuestDef[] | null = null;
let navTimer: ReturnType<typeof setInterval> | null = null;

const REGION_ANCHORS: Record<string, { x: number; z: number }> = {
  tabriz: { x: 34, z: 26 }, isfahan: { x: 34, z: 26 }, shiraz: { x: 90, z: -60 },
  caucasus: { x: 60, z: 140 }, mesopotamia: { x: 200, z: 50 },
  khorasan: { x: 150, z: 200 }, persian_gulf: { x: -60, z: -170 },
};
const EXPLORE_ANCHORS: Record<string, { x: number; z: number }> = {
  tabriz_gate: GATE, isfahan_bazaar: { x: 34, z: 34 }, ottoman_camp_isfahan: { x: 34, z: 26 },
};

function resolveQuestTarget(obj: QuestObjectiveDef, def: QuestDef): { x: number; z: number; label: string } | null {
  if (!me) return null;
  const withDist = (x: number, z: number) =>
    ({ x, z, label: `${obj.description} · ${Math.round(Math.hypot(x - me!.pos.x, z - me!.pos.z))} ${t('nav.m')}` });
  const anchor = REGION_ANCHORS[def.npcGiverRegion];

  if (obj.type === 'kill') {
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    if (world) {
      for (const m of world.monsters.values()) {
        if (m.monsterId !== obj.target || m.deadAt) continue;
        const d = Math.hypot(m.pos.x - me.pos.x, m.pos.z - me.pos.z);
        if (d < bestD) { bestD = d; best = { x: m.pos.x, z: m.pos.z }; }
      }
    }
    if (best) return withDist(best.x, best.z);
    // Монстров этого вида нет в мире — ведём к ближайшей точке спавна
    // из квеста, а не к центру региона (иначе линия упирается в ворота/плазу)
    if (obj.spawnPoints?.length) {
      let bestSpawn: { x: number; z: number } | null = null;
      let bestSpawnD = Infinity;
      for (const sp of obj.spawnPoints) {
        const d = Math.hypot(sp.x - me.pos.x, sp.z - me.pos.z);
        if (d < bestSpawnD) { bestSpawnD = d; bestSpawn = sp; }
      }
      if (bestSpawn) return withDist(bestSpawn.x, bestSpawn.z);
    }
    if (anchor) return withDist(anchor.x, anchor.z);
    return null;
  }
  if (obj.type === 'talk') {
    const npc = questNpcPosition(obj.target);
    if (npc) return withDist(npc.x, npc.z);
    // Цели-спутника нет в мире: сначала сдающий квест NPC, потом точки квеста,
    // и только потом ближайший квестный NPC региона (не любой рядом стоящий)
    const turnIn = def.npcGiver ? questNpcPosition(def.npcGiver) : null;
    if (turnIn) return withDist(turnIn.x, turnIn.z);
    if ((obj as any).spawnPoints?.length) {
      let bestSpawn: { x: number; z: number } | null = null;
      let bestSpawnD = Infinity;
      for (const sp of (obj as any).spawnPoints as { x: number; z: number }[]) {
        const d = Math.hypot(sp.x - me!.pos.x, sp.z - me!.pos.z);
        if (d < bestSpawnD) { bestSpawnD = d; bestSpawn = sp; }
      }
      if (bestSpawn) return withDist(bestSpawn.x, bestSpawn.z);
    }
    const anchor = REGION_ANCHORS[def.npcGiverRegion];
    if (anchor) return withDist(anchor.x, anchor.z);
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const npc of Object.values(NPC_WORLD_POSITIONS)) {
      if (!npc.quest) continue;
      const d = Math.hypot(npc.x - me.pos.x, npc.z - me.pos.z);
      if (d < bestD) { bestD = d; best = npc; }
    }
    if (best) return withDist(best.x, best.z);
  }
  if (obj.type === 'explore') {
    const a = EXPLORE_ANCHORS[obj.target];
    if (a) return withDist(a.x, a.z);
  }
  // фолбэк по spawnPoints из квеста (если NPC неизвестен)
  if ((obj as any).spawnPoints?.length) {
    let bestSpawn: { x: number; z: number } | null = null;
    let bestSpawnD = Infinity;
    for (const sp of (obj as any).spawnPoints as { x: number; z: number }[]) {
      const d = Math.hypot(sp.x - me!.pos.x, sp.z - me!.pos.z);
      if (d < bestSpawnD) { bestSpawnD = d; bestSpawn = sp; }
    }
    if (bestSpawn) return withDist(bestSpawn.x, bestSpawn.z);
  }
  return anchor ? withDist(anchor.x, anchor.z) : null;
}

// ── Журнал квестов (J): активные с прогрессом и маркерами ────
let questDefsCache: QuestDef[] | null = null;
async function getQuestDefs(): Promise<QuestDef[]> {
  if (!questDefsCache) questDefsCache = (await api.quests()).quests;
  return questDefsCache;
}

async function refreshQuestPanelJ(): Promise<void> {
  const listEl = document.getElementById('quests-j-list');
  if (!listEl) return;
  const cid = session.character?.id;
  if (!cid) {
    listEl.innerHTML = '<div class="quest-j-empty">Нет персонажа</div>';
    return;
  }
  try {
    const [defs, { quests }] = await Promise.all([getQuestDefs(), api.questState(cid)]);
    const active = (quests || []).filter((q) => q.status === 'active');
    if (!active.length) {
      listEl.innerHTML = '<div class="quest-j-empty">Нет активных заданий<br><small>Поговорите с NPC чтобы получить задания</small></div>';
      return;
    }
    listEl.innerHTML = active.map((q) => {
      const def = defs.find((d) => d.id === q.questId);
      const progress = q.progress || {};
      const objHtml = (def?.objectives ?? []).map((o) => {
        const have = progress[o.id] ?? 0;
        const done = have >= o.required;
        const counter = o.type === 'kill' || o.type === 'collect' ? ` ${Math.min(have, o.required)}/${o.required}` : '';
        return `<div class="quest-j-desc ${done ? 'done' : ''}">${done ? '✓' : '•'} ${o.description}${counter}</div>`;
      }).join('');
      const title = def ? ((session as unknown as { lang?: string }).lang === 'en' ? def.title : def.titleRu) : q.questId;
      return `<div class="quest-j-item" data-quest="${q.questId}">` +
        `<div class="quest-j-title">◆ ${title}</div>` +
        objHtml +
        `</div>`;
    }).join('');
  } catch {
    listEl.innerHTML = '<div class="quest-j-empty">Ошибка загрузки квестов</div>';
  }
}

async function refreshNavTarget(): Promise<void> {
  if (!session.character || !world3d) return;
  try {
    if (!navDefs) navDefs = (await api.quests()).quests;
    const { quests: state } = await api.questState(session.character.id);
    const active = state.filter((q) => q.status === 'active');
    let target: { x: number; z: number; label: string } | null = null;
    for (const st of active) {
      const def = navDefs.find((q) => q.id === st.questId);
      if (!def) continue;
      const obj = def.objectives.find((o) => !o.optional && (st.progress[o.id] ?? 0) < o.required);
      if (!obj) continue;
      target = resolveQuestTarget(obj, def);
      if (target) break;
    }
    world3d.setNavTarget(target);
    const el = document.getElementById('nav-hud');
    if (el) {
      el.classList.toggle('hidden', !target);
      el.textContent = target ? ('🎯 ' + target.label) : '';
    }
  } catch {
    /* навигация не критична */
  }
}

// ── Вход в мир ───────────────────────────────────────────────

/** Один кадр браузера — дать экрану загрузки отрисоваться до тяжёлой сборки */
function nextPaint(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/**
 * Минимальная длительность экрана загрузки, мс.
 * Реальный мир собирается за ~1,3 с, и экран «моргал» — вход в игру
 * выглядел как сбой. Теперь полоса плавно добирает до 100% и держит
 * экран, пока не пройдёт это время. Если загрузка реально дольше
 * (слабый ПК, медленная сеть) — ждём её, а не обрываем.
 */
const MIN_LOADING_MS = 10_500;
/** Подсказки, которые сменяются на экране загрузки */
const LOADING_TIPS = [
  'loading.tip_1', 'loading.tip_2', 'loading.tip_3',
  'loading.tip_4', 'loading.tip_5', 'loading.tip_6',
];
/** Как часто меняется подсказка, мс */
const TIP_EVERY_MS = 1900;

let loadingStart = 0;
let loadingShown = 0;
let loadingTarget = 0;
let loadingLabel = '';
let loadingRaf = 0;
let tipAt = 0;
let tipIx = 0;

/** Прогресс и подпись на экране загрузки (0..1) */
function setLoading(fraction: number, text: string): void {
  const fill = $('loading-fill');
  if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  const label = $('loading-text');
  if (label) label.textContent = text;
}

/**
 * Плавная анимация полосы: реальный прогресс не может «перепрыгнуть»
 * Allowed — так заполнение выглядит живым, а не рывком. Подсказка внизу
 * меняется каждые TIP_EVERY_MS, чтобы ожидание не было пустым.
 */
function startLoadingLoop(): void {
  const tick = (): void => {
    const elapsed = performance.now() - loadingStart;
    const k = Math.max(0, Math.min(1, elapsed / MIN_LOADING_MS));
    // easeOutCubic: быстрый разгон, мягкое торможение у 100%
    const allowed = 1 - Math.pow(1 - k, 3);
    const goal = Math.min(loadingTarget, allowed);
    if (goal > loadingShown) loadingShown = goal;
    setLoading(loadingShown, loadingLabel);
    if (elapsed - tipAt >= TIP_EVERY_MS) {
      tipAt = elapsed;
      tipIx = (tipIx + 1) % LOADING_TIPS.length;
      const tip = $('loading-tip');
      if (tip) {
        tip.textContent = t(LOADING_TIPS[tipIx]);
        tip.classList.remove('tip-fade');
        void tip.offsetWidth; // рестарт CSS-анимации появления
        tip.classList.add('tip-fade');
      }
    }
    loadingRaf = requestAnimationFrame(tick);
  };
  loadingRaf = requestAnimationFrame(tick);
}

/** Задать реальный прогресс, не перескакивая к тому, что уже нарисовано */
function markLoading(fraction: number, text: string): void {
  loadingTarget = fraction;
  loadingLabel = text;
}

/** Задать реальный прогресс и включить экран загрузки */
function showLoading(fraction: number, text: string): void {
  loadingStart = performance.now();
  loadingShown = 0;
  loadingTarget = fraction;
  loadingLabel = text;
  tipAt = 0;
  tipIx = 0;
  const tip = $('loading-tip');
  if (tip) tip.textContent = t(LOADING_TIPS[0]);
  setLoading(0, text);
  $('overlay-loading')?.classList.remove('hidden');
  cancelAnimationFrame(loadingRaf);
  startLoadingLoop();
}

/** Дойти до 100% и дождаться MIN_LOADING_MS, затем спрятать экран */
async function finishLoading(): Promise<void> {
  loadingTarget = 1;
  loadingLabel = t('loading.ready');
  const left = MIN_LOADING_MS - (performance.now() - loadingStart);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  setLoading(1, t('loading.ready'));
  hideLoading();
}

function hideLoading(): void {
  cancelAnimationFrame(loadingRaf);
  loadingRaf = 0;
  $('overlay-loading')?.classList.add('hidden');
}

/** Имя, класс и уровень героя — карточка главного меню (Esc) */
function fillMenuInfo(): void {
  // Версию берём из общей константы: раньше «v0.2.0» было вписано прямо
  // в разметку и разошлось с GAME_VERSION на сервере
  const ver = $('menu-version');
  if (ver) ver.textContent = `v${GAME_VERSION}`;

  const c = session.character;
  if (!c) return;
  const info = $('menu-char-info');
  if (info) {
    info.textContent =
      `${c.name} · ${t('panels.char_class')}: ${c.class} · ${t('panels.char_level')}: ${c.level}`;
  }
}

/** Открыть панель по имени — как кнопка-переключатель, но без двойного клика */
function openPanelById(panel: string): void {
  const el = document.getElementById(panel);
  if (!el) return;
  el.classList.remove('hidden');
  document.querySelector<HTMLButtonElement>(`.panel-toggles button[data-panel="${panel}"]`)
    ?.classList.add('active');
  loadPanelContent(panel);
}

export async function enterWorld(character: Character): Promise<void> {
  session.character = character;
  session.hp = character.hp; session.maxHp = character.maxHp;
  session.mana = character.mana; session.maxMana = character.maxMana;
  session.stamina = character.stamina; session.maxStamina = character.maxStamina;
  session.level = character.level;
  session.experience = character.experience;

  showScreen('screen-world');
  // Экран загрузки со своей темой — пока собирается мир
  showLoading(0.08, t('loading.entering'));
  audio.ensureLoading();
  await nextPaint();
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon as IconName, 18);
  });
  refreshBars();
  void loadSkillbar();
  void refreshNavTarget();
  if (navTimer) clearInterval(navTimer);
  navTimer = setInterval(() => void refreshNavTarget(), 3000);
  void loadRegions();
  void loadQuests();

  world = new World();
  world3d = new World3D();
  // Сборка мира тяжёлая (~сотни тысяч вершин) — отдаём кадр на отрисовку
  markLoading(0.2, t('loading.building'));
  await nextPaint();
  world3d.init(document.getElementById('game3d-root') as HTMLElement, {
    onAttack: () => basicAttack(),
    onTarget: (name, hp, maxHp) => showTarget(name, hp, maxHp),
    onTargetCleared: () => hideTarget(),
    onNpc: (panel, name, npcId) => {
      // Клик по NPC: открыть связанную панель (кнопкой-переключателем,
      // чтобы не ломать состояние .hidden/.active)
      const btn = document.querySelector<HTMLButtonElement>(`.panel-toggles button[data-panel="${panel}"]`);
      const el = document.getElementById(panel);
      if (btn && el?.classList.contains('hidden')) btn.click();
      else loadPanelContent(panel);
      if (name) toast(`${name} — ${t('panels.npc_greeting')}`, 'info');
      // Диалог: ветвящаяся беседа, тон/дружба, засчитывает talk-цели квестов
      if (npcId) void openNpcDialogue(npcId).catch(() => {});
    },
  });

  me = {
    id: character.id,
    name: character.name,
    charClass: character.class,
    pos: { ...character.position },
    target: { ...character.position },
    moving: false,
    seed: 0,
    flipped: false,
    isSelf: true,
  };
  world.players.set(me.id, me);
  world3d.attach(world, me);
  markLoading(0.85, t('loading.connecting'));
  await nextPaint();
  fillMenuInfo();
  wireSettings();
  void loadAdminRights();
  void loadBuffs();
  if (session.isGuest) showGuestBanner();
  // Туториал новичка. Раньше не вызывался НИ РАЗУ, хотя был написан целиком:
  // игрок попадал в город с двадцатью кнопками без единой подсказки.
  void initTutorial(me.id);
  // Шаг «атакуй мечом» засчитывается на замахе (3D-слой сообщает через крючок)
  world3d?.setOnAttack(() => onTutorialAction('attack'));
  // Шаг «осмотритесь» засчитывается на реальном повороте камеры мышью
  world3d?.setOnCamera(() => onTutorialAction('camera'));
  resetWaterDanger();
  await finishLoading();
  audio.ensureGame();

  // Отладочный хук для e2e-проверок (не влияет на игру)
  (window as unknown as { __eos: unknown }).__eos = {
    get monsters() { return [...(world?.monsters.values() ?? [])].map((m) => ({ id: m.instanceId, name: m.nameRu, x: Math.round(m.pos.x), z: Math.round(m.pos.z), hp: m.hp })); },
    get me() { return me ? { x: Math.round(me.pos.x), z: Math.round(me.pos.z) } : null; },
    get cam() { return world3d?.getCameraPose() ?? null; },
    setCam(yaw: number, pitch: number, dist?: number): void { world3d?.setCameraPose(yaw, pitch, dist); },
    attack(): void { world3d?.attackFromCamera(); },
    setHour(hour: number): void { world3d?.setClock(hour); },
    get audioMode() { return audio.currentMode; },
    tp(x: number, z: number): void {
      if (me && world) {
        me.pos.x = x; me.pos.z = z;
        me.target = { ...me.pos };
      }
    },
  };

  wireSocket();
  wireInput();

  if (socket.connected) {
    socket.emit('auth', { token: session.token, characterId: character.id });
  } else {
    socket.connect(); // по 'connect' обработчик сам пришлёт auth
  }
  chatMessage(null, t('world.connecting'), true);
  document.getElementById('chat-log')?.lastElementChild?.setAttribute('data-conn-status', '');

  lastFrame = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

export function leaveWorld(): void {
  cancelAnimationFrame(raf);
  audio.ensureAuth();
  if (navTimer) { clearInterval(navTimer); navTimer = null; }
  world3d?.setNavTarget(null);
  socket.disconnect();
  if (deathTimer) clearTimeout(deathTimer);
  // Бонусы остаются в игре, но их таймер в HUD должен перестать тикать
  clearBuffs();
  world3d?.dispose();
  world3d = null;
  world = null; me = null;
}

// ── Экраны ───────────────────────────────────────────────────

export function showScreen(id: string): void {
  for (const el of document.querySelectorAll<HTMLElement>('.screen')) {
    el.classList.toggle('hidden', el.id !== id);
  }
}

// ── Сокет-протокол ───────────────────────────────────────────

function wireSocket(): void {
  socket.off();

  socket.on('connect', () => {
    if (session.character) {
      socket.emit('auth', { token: session.token, characterId: session.character.id });
    }
  });

  socket.on('auth:success', ({ character }: { character: Character }) => {
    // Снять строку «Подключение к серверу…» и подтвердить вход в мир
    const log = document.getElementById('chat-log');
    log?.querySelector('[data-conn-status]')?.remove();
    chatMessage(null, t('world.connected'), true);
    if (me && world) {
      me.target = { ...character.position };
      me.pos = { ...character.position };
    }
  });

  socket.on('auth:error', ({ message }: { message: string }) => {
    toast(`${t('common.error')}: ${message}`, 'error');
    showLostScreen(message);
  });

  socket.on('player:joined', ({ characterId, name, charClass, position }: { characterId: string; name: string; charClass?: string; position: Vec3 }) => {
    if (!world || characterId === me?.id) return;
    world.players.set(characterId, {
      id: characterId, name, charClass: charClass ?? 'qizilbash',
      pos: { ...position }, target: { ...position }, moving: false,
      seed: characterId.length, flipped: false,
    });
    chatMessage(null, `${name} — ${t('world.online')}`, true);
  });

  socket.on('player:moved', ({ characterId, position }: { characterId: string; position: Vec3 }) => {
    const p = world?.players.get(characterId);
    if (p) p.target = { ...position };
  });

  socket.on('player:left', ({ characterId }: { characterId: string }) => {
    const p = world?.players.get(characterId);
    if (p && world) {
      chatMessage(null, `${p.name} — ${t('badges.statuses.offline')}`, true);
      world.players.delete(characterId);
    }
  });

  // ── Монстры ──
  socket.on('monster:spawned', (payload: { instanceId: string; monsterId: string; nameRu: string; position: Vec3; hp: number; maxHp?: number; type: string; aquatic?: boolean; aquaticSize?: number }) => {
    if (!world) return;
    world.monsters.set(payload.instanceId, {
      instanceId: payload.instanceId,
      monsterId: payload.monsterId,
      nameRu: payload.nameRu,
      type: payload.type,
      // Подводное: рисуется спиной над водой, иначе его не видно
      aquatic: payload.aquatic === true,
      aquaticSize: payload.aquaticSize ?? 0.25,
      pos: { ...payload.position },
      target: { ...payload.position },
      speed: 3.5,
      hp: payload.hp,
      maxHp: payload.maxHp ?? payload.hp,
      deadAt: 0,
      seed: payload.instanceId.length % 2,
    });
  });

  socket.on('monster:ai_action', ({ instanceId, action }: { instanceId: string; action: { type: string; destination?: Vec3; targetId?: string; skillId?: string } }) => {
    const m = world?.monsters.get(instanceId);
    if (!m) return;
    if (action.destination) {
      // Сухопутный монстр не идёт туда, где пришлось бы плыть: раньше
      // разбойник уходил в озеро и там замирал. Уже в воде — даём выйти.
      const dest = action.destination;
      if (!swimNeeded(dest.x, dest.z) || swimNeeded(m.pos.x, m.pos.z)) {
        m.target = { ...dest };
        m.speed = 3.2;
      } else {
        m.target = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
      }
    }
    if ((action.type === 'attack' || action.type === 'skill') && action.targetId && world) {
      const victim = world.players.get(action.targetId);
      if (victim) {
        world.addEffect('hit', m.pos.x, m.pos.z, victim.pos.x, victim.pos.z, '#e07a4a');
      }
    }
  });

  socket.on('monster:killed', ({ instanceId, killerId, expReward, gold, loot, leveledUp, newLevel }: {
    instanceId: string; killerId: string; expReward: number;
    gold?: number; loot?: { itemId: string; nameRu: string; qty: number }[];
    leveledUp?: boolean; newLevel?: number;
  }) => {
    const w = world;
    const m = w?.monsters.get(instanceId);
    if (!w || !m) return;
    m.deadAt = performance.now();
    w.addFloater(m.pos.x, m.pos.z - 1.2, '☠', '#F4D26C');
    setTimeout(() => world?.monsters.delete(instanceId), 950);
    audio.kill();
    if (killerId === me?.id) {
      // Шаг туториала «убей монстра» засчитывается здесь
      onTutorialAction('kill_monster', m.monsterId);
    }
    if (killerId === me?.id) {
      session.kills[m.monsterId] = (session.kills[m.monsterId] ?? 0) + 1;
      session.experience += expReward;
      w.addFloater(m.pos.x, m.pos.z - 0.8, `+${expReward} ${t('world.exp')}`, '#F4D26C');
      if (gold) {
        if (session.character) session.character.gold += gold;
        w.addFloater(m.pos.x, m.pos.z - 0.3, `+${gold} ◉`, '#F4D26C');
      }
      if (loot?.length) {
        const line = `${t('world.loot')}: ${loot.map(l => `${l.nameRu} ×${l.qty}`).join(', ')}`;
        chatMessage(null, line, true);
        toast(line, 'success');
      }
      if (leveledUp && newLevel) {
        session.level = newLevel;
        audio.levelUp();
        toast(`${t('world.levelup')} ${newLevel}!`, 'success');
        void loadRegions();
        void loadQuests();
      }
      void loadQuests();
      void loadInventory();
      refreshBars();
    }
  });

  // Квест завершён сервером: награды уже начислены в БД
  socket.on('quest:completed', ({ quests }: {
    quests: {
      questId: string; titleRu: string; experience: number; gold: number;
      items: { nameRu: string; quantity: number }[]; leveledUp?: boolean; newLevel?: number;
    }[];
  }) => {
    for (const q of quests) {
      const items = q.items?.length ? ` · ${q.items.map((i) => `${i.nameRu} ×${i.quantity}`).join(', ')}` : '';
      toast(`${t('world.quest_completed')}: ${q.titleRu} (+${q.experience} ${t('world.exp')}, +${q.gold} ◉${items})`, 'success');
      if (q.leveledUp && q.newLevel) {
        session.level = q.newLevel;
        audio.levelUp();
        toast(`${t('world.levelup')} ${q.newLevel}!`, 'success');
      }
    }
    // Сюжетная сцена на ключевом квесте. Запрашиваем у сервера по одному
    // на каждый завершённый квест: так покрыты все пути завершения, а
    // сервер отдаёт сцену только один раз.
    for (const q of quests) {
      void requestCutsceneForQuest(q.questId);
    }
    void loadQuests();
    void loadInventory();
    void refreshNavTarget();
    refreshBars();
  });

  // Задача дня закрыта: сервер уже начислил золото, опыт и предмет.
  // Без этого сообщения игрок узнал бы о награде только по цифре в кошельке.
  socket.on('daily:task', ({ gold, experience, item }: {
    taskId: string; gold?: number; experience?: number; item?: string;
  }) => {
    const parts: string[] = [];
    if (gold) parts.push(`+${gold} ${t('world.gold')}`);
    if (experience) parts.push(`+${experience} ${t('world.exp')}`);
    if (item) parts.push(item);
    audio.levelUp();
    toast(`${t('site.tasks_done_toast')}: ${parts.join(' · ')}`, 'success');
  });

  // ── Бой ──
  socket.on('combat:result', (r: { attackerId: string; targetId: string; damage: number; isCritical: boolean; isBlocked: boolean; isDodged: boolean; targetHp?: number; targetMaxHp?: number }) => {
    if (!world) return;
    const attacker = world.players.get(r.attackerId);
    const target = world.monsters.get(r.targetId) ?? world.players.get(r.targetId);
    if (!attacker || !target) return;
    if (r.attackerId === me?.id) {
      if (r.isDodged) {
        world.addFloater(target.pos.x, target.pos.z - 1, t('world.dodge'), '#cfe3f0');
      } else {
        world.addEffect('slash', attacker.pos.x, attacker.pos.z, target.pos.x, target.pos.z, r.isCritical ? '#F4D26C' : '#e8e2d2');
        world.addFloater(
          target.pos.x, target.pos.z - 1,
          `-${r.damage}${r.isCritical ? '!' : r.isBlocked ? ' ⛨' : ''}`,
          r.isCritical ? '#F4D26C' : '#ffffff', r.isCritical,
        );
        const m = world.monsters.get(r.targetId);
        if (m && r.targetHp != null) m.hp = r.targetHp;
        if (r.targetId === world.targetId && r.targetHp != null) {
          showTarget(m?.nameRu ?? '', r.targetHp, r.targetMaxHp ?? m?.maxHp ?? 1);
        }
      }
    }
  });

  socket.on('combat:hit', (r: { damage: number; isDodged: boolean; isBlocked: boolean; hp: number; maxHp: number }) => {
    session.hp = r.hp;
    session.maxHp = r.maxHp;
    if (world && me) {
      if (r.isDodged) world.addFloater(me.pos.x, me.pos.z - 1, t('world.dodge'), '#cfe3f0');
      else world.addFloater(me.pos.x, me.pos.z - 1, `-${r.damage}`, '#ff8d7e', true);
    }
    audio.hit();
    refreshBars();
  });

  // Периодический синк ресурсов с сервера (регенерация, золото, уровень)
  socket.on('player:resources', (r: {
    hp: number; maxHp: number; mana: number; maxMana: number;
    stamina: number; maxStamina: number; level: number; experience: number; gold: number;
  }) => {
    session.hp = r.hp; session.maxHp = r.maxHp;
    session.mana = r.mana; session.maxMana = r.maxMana;
    session.stamina = r.stamina; session.maxStamina = r.maxStamina;
    session.level = r.level; session.experience = r.experience;
    if (session.character) session.character.gold = r.gold;
    refreshBars();
  });

  socket.on('combat:heal', (r: { targetId: string; heal: number; hp: number; maxHp: number }) => {
    if (!world || !me) return;
    const target = world.players.get(r.targetId);
    if (target) world.addEffect('heal', target.pos.x, target.pos.z, target.pos.x, target.pos.z, '#6ecf7a');
    if (r.targetId === me.id) {
      session.hp = r.hp;
      session.maxHp = r.maxHp;
      world.addFloater(me.pos.x, me.pos.z - 1, `+${r.heal}`, '#6ecf7a');
      refreshBars();
    }
  });

  socket.on('combat:error', ({ message }: { message: string }) => {
    // Шум боя: добивание мёртвой цели — обычная ситуация, не ошибка игрока
    if (message === 'Target not found') return;
    toast(message, 'error');
  });

  socket.on('combat:visual', (v: { attackerId: string; targetId: string }) => {
    if (!world || v.attackerId === me?.id) return; // свой урон уже отрисован по combat:result
    const a = world.players.get(v.attackerId);
    const b = world.monsters.get(v.targetId) ?? world.players.get(v.targetId);
    if (a && b) world.addEffect('slash', a.pos.x, a.pos.z, b.pos.x, b.pos.z, '#b9c8d6');
  });

  // ── Смерть и возрождение ──
  socket.on('player:died', () => {
    document.getElementById('overlay-death')?.classList.remove('hidden');
    audio.playerDeath();
    if (me) world?.addFloater(me.pos.x, me.pos.z - 1, t('world.died'), '#ff8d7e');
  });

  socket.on('player:respawned', ({ hp, maxHp, position }: { hp: number; maxHp: number; position: Vec3 }) => {
    document.getElementById('overlay-death')?.classList.add('hidden');
    session.hp = hp;
    session.maxHp = maxHp;
    if (me) {
      me.pos = { ...position };
      me.target = { ...position };
    }
    toast(t('world.respawned'), 'success');
    refreshBars();
  });

  // ── Чат ── сервер поддерживает world/region/guild/party (см. GameSocketHandler.handleChatMessage)
  const chatEvents = ['chat:world', 'chat:region', 'chat:guild', 'chat:party'] as const;
  const channelPrefix: Record<string, string> = { 'chat:guild': '[Гильдия] ', 'chat:party': '[Группа] ' };
  for (const ev of chatEvents) {
    socket.on(ev, ({ characterId, name, role, message }: { characterId: string; name?: string | null; role?: 'owner' | 'admin' | 'moderator' | null; message: string }) => {
      const p = world?.players.get(characterId);
      const displayName = name ?? p?.name ?? '???';
      const prefix = channelPrefix[ev] ?? '';
      chatMessage(displayName, prefix + message, false, role ?? null);
    });
  }
  // гильдия/пати ошибки
  socket.on('chat:error', ({ message }: { message: string }) => {
    chatMessage(null, message, true);
  });

  socket.on('notification', (msg: { message?: string; text?: string; title?: string }) => {
    toast(msg.message ?? msg.text ?? msg.title ?? '', 'info');
  });

  socket.on('world:time', (payload: Record<string, unknown>) => {
    setWorldTime(payload);
    const tod = String(payload.timeOfDay ?? '');
    night = tod === 'night' || tod === 'midnight' ? 1 : tod === 'evening' || tod === 'dawn' ? 0.5 : 0;
    const hour = Number(payload.gameHour ?? payload.hour);
    if (Number.isFinite(hour)) world3d?.setClock(hour);
    const weather = String(payload.weather ?? '');
    if (weather) world3d?.setWeather(weather);
  });

  socket.on('move:rejected', ({ reason }: { reason?: string }) => {
    if (me && session.character) {
      me.pos = { ...session.character.position };
      me.target = { ...session.character.position };
    }
    toast(reason ?? 'move rejected', 'error');
  });

  socket.on('force:disconnect', ({ reason }: { reason: string }) => {
    showLostScreen(reason);
  });

  socket.on('disconnect', (reason: string) => {
    if (reason === 'io server disconnect' || reason === 'transport close') {
      showLostScreen('disconnect');
    }
  });
}

function showLostScreen(reason: string): void {
  const el = document.getElementById('overlay-lost');
  if (!el) return;
  (document.getElementById('lost-reason') as HTMLElement).textContent = reason;
  el.classList.remove('hidden');
  setTimeout(() => {
    leaveWorld();
    // Возврат к выбору персонажа
    void import('./main').then((m) => m.gotoCharacters());
  }, 2200);
}

// ── Ввод: поддержка переназначения клавиш ──────────────────────
const DEFAULT_BINDS: Record<string, string> = { map: 'KeyM', character: 'KeyF', guild: 'KeyG', quests: 'KeyJ', inventory: 'KeyI' };
function getBind(action: string): string {
  try {
    const saved = JSON.parse(localStorage.getItem('eos_keybinds') ?? '{}');
    return saved[action] ?? DEFAULT_BINDS[action] ?? action;
  } catch { return DEFAULT_BINDS[action] ?? action; }
}
export function setBind(action: string, code: string): void {
  const saved = JSON.parse(localStorage.getItem('eos_keybinds') ?? '{}');
  saved[action] = code;
  localStorage.setItem('eos_keybinds', JSON.stringify(saved));
}

function wireInput(): void {
  window.onkeydown = (e) => {
    if (chatVisible()) return;
    // Кат-сцена перехватывает ввод: пока она идёт, игра не управляется,
    // иначе «дальше» нажималась бы вместе с движением персонажа
    if (isCutscenePlaying()) {
      e.preventDefault();
      if (e.code === 'Space' || e.code === 'Enter') advance();
      else if (e.code === 'Escape') document.getElementById('cutscene-skip')?.dispatchEvent(new Event('click'));
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      if (document.pointerLockElement) document.exitPointerLock();
      openChat();
    } else if (e.code === 'Escape') {
      // Настройки закрывает собственный обработчик — меню не трогаем
      if (!$('overlay-settings')?.classList.contains('hidden')) return;
      document.getElementById('overlay-menu')?.classList.toggle('hidden');
    } else if (e.code === getBind('map')) {
      const overlay = document.getElementById('overlay-map');
      overlay?.classList.toggle('hidden');
      if (overlay && !overlay.classList.contains('hidden')) redrawWorldMap();
    } else if (e.code === getBind('character')) {
      const panel = document.getElementById('panel-character');
      panel?.classList.toggle('hidden');
      if (panel && !panel.classList.contains('hidden')) loadPanelContent('panel-character');
    } else if (e.code === getBind('guild')) {
      const panel = document.getElementById('panel-guild');
      panel?.classList.toggle('hidden');
      if (panel && !panel.classList.contains('hidden')) loadPanelContent('panel-guild');
    } else if (e.code === getBind('quests')) {
      const panel = document.getElementById('panel-quests-j');
      panel?.classList.toggle('hidden');
      if (panel && !panel.classList.contains('hidden')) void refreshQuestPanelJ();
    } else if (e.code === getBind('inventory')) {
      const panel = document.getElementById('panel-inventory');
      panel?.classList.toggle('hidden');
      // Клавиша I открывает панель так же, как клик по кнопке — иначе сумка пустая
      if (panel && !panel.classList.contains('hidden')) void loadInventory();
      onTutorialAction('open_inventory');
    } else if (/^Digit[1-4]$/.test(e.code)) {
      const idx = Number(e.code.slice(5)) - 1;
      const skill = session.skills[idx];
      if (skill) useSkill(skill.id);
    }
  };

  window.addEventListener('game:skill', (e) => useSkill((e as CustomEvent<string>).detail));
  window.addEventListener('quest:accepted', () => { void refreshNavTarget(); void refreshQuestPanelJ(); });

  $('btn-continue')?.addEventListener('click', () => document.getElementById('overlay-menu')?.classList.add('hidden'));

  // Быстрые действия главного меню открывают свои панели
  const quick = (id: string, panel: string) => {
    $(id)?.addEventListener('click', () => {
      $('overlay-menu')?.classList.add('hidden');
      openPanelById(panel);
    });
  };
  quick('btn-quick-mounts', 'panel-mount-stable');
  quick('btn-quick-tower', 'panel-tower');
  quick('btn-quick-pets', 'panel-pets');
  $('btn-exit')?.addEventListener('click', () => {
    document.getElementById('overlay-menu')?.classList.add('hidden');
    void api.logout().catch(() => {});
    leaveWorld();
    void import('./main').then((m) => m.logoutLocal());
  });

  // Чат: переключение вкладок
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.chat-tab')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll<HTMLButtonElement>('.chat-tab')) t.classList.remove('active');
      tab.classList.add('active');
    });
  }

  // Чат: отправка — канал берётся из активной вкладки (fallback: старое #chat-channel или region)
  ($('chat-form') as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault();
    const input = $('chat-text') as HTMLInputElement;
    const text = input.value.trim();
    if (text && socket.connected) {
      const activeTab = document.querySelector<HTMLButtonElement>('.chat-tab.active');
      let channel = activeTab?.dataset.channel ?? (document.getElementById('chat-channel') as HTMLSelectElement | null)?.value ?? 'region';
      // UI имеет system/trade/war — мапим на поддерживаемые сервером каналы
      const allowed = new Set(['world', 'region', 'guild', 'party']);
      if (!allowed.has(channel)) channel = 'region';
      socket.emit('chat:message', {
        message: text,
        channel,
      });
      input.value = '';
    }
    closeChat();
  };

  // Переключатели панелей
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.panel-toggles button')) {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.dataset.panel!);
      panel?.classList.toggle('hidden');
      btn.classList.toggle('active', !panel?.classList.contains('hidden'));
      if (btn.dataset.panel === 'panel-regions') void loadRegions();
      if (btn.dataset.panel === 'panel-quests') void loadQuests();
      if (btn.dataset.panel === 'panel-inventory') {
        void loadInventory();
        // Шаг туториала засчитывается и по иконке мышью, не только по клавише I —
        // иначе новичок, нажавший иконку, застрял бы на шаге
        onTutorialAction('open_inventory');
      }
      loadPanelContent(btn.dataset.panel);
    });
  }

  wireSettings();
}

// ── Настройки ────────────────────────────────────────────────
// Панель #overlay-settings была мёртвым кодом: кнопка «Настройки»
// ничего не открывала, слайдеры громкости ни к чему не были подключены,
// а «качество графики» ничего не меняло в движке. Здесь всё это оживает.
let settingsWired = false;

/** Настройки → движок: громкость, графика, подсказки, мини-карта */
function applySettingsToEngine(): void {
  const s = getSettings();
  audio.setMusicVolume(s.music);
  audio.setSfxVolume(s.sfx);
  world3d?.setGraphics(s.graphics, s.fog);
  $('controls-hint')?.classList.toggle('hidden', !s.hints);
  $('minimap')?.classList.toggle('hidden', !s.minimap);
}

/**
 * Права администратора: сервер знает, кто админ, но клиент об этом не
 * спрашивал, а кнопка админки в разметке была навсегда скрыта классом
 * hidden. Из-за этого переключатель погоды и остальные админ-инструменты
 * были недостижимы — приходилось дёргать API вручную из консоли.
 */
async function loadAdminRights(): Promise<void> {
  try {
    const res = await api.authMe();
    const d = res.data;
    session.isAdmin = !!d.isAdmin;
    session.isAdminRole = d.adminRole || 'gm';
  } catch {
    session.isAdmin = false;
    session.isAdminRole = 'gm';
  }
  $('btn-panel-admin')?.classList.toggle('hidden', !session.isAdmin);
}

function wireSettings(): void {
  if (settingsWired) return;
  settingsWired = true;

  const displayBox = $('set-display');
  const gfxBox = $('set-graphics');
  const music = $('set-music') as HTMLInputElement;
  const sfx = $('set-sfx') as HTMLInputElement;
  const mute = $('set-mute') as HTMLInputElement;
  const lang = $('set-lang') as HTMLSelectElement;
  const hints = $('set-hints') as HTMLInputElement;
  const minimap = $('set-minimap') as HTMLInputElement;
  const fog = $('set-fog') as HTMLInputElement;

  // Значения настроек → элементы панели
  const paint = (): void => {
    const s = getSettings();
    displayBox?.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-mode') === s.display);
    });
    gfxBox?.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-level') === s.graphics);
    });
    if (music) music.value = String(s.music);
    if (sfx) sfx.value = String(s.sfx);
    if (mute) mute.checked = audio.muted;
    if (lang) lang.value = detectLocale();
    if (hints) hints.checked = s.hints;
    if (minimap) minimap.checked = s.minimap;
    if (fog) fog.checked = s.fog;
  };

  const open = (): void => {
    paint();
    $('overlay-menu')?.classList.add('hidden');
    $('overlay-settings')?.classList.remove('hidden');
    // Привязанные аккаунты подгружаем при открытии настроек: они могли
    // измениться (например, игрок только что привязал Google), и в момент
    // входа в игру их ещё не было
    void loadAccountLinks();
  };
  const close = (): void => $('overlay-settings')?.classList.add('hidden');

  $('btn-settings')?.addEventListener('click', open);
  $('settings-close')?.addEventListener('click', close);
  $('btn-claim')?.addEventListener('click', () => { void promptClaimAccount(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !$('overlay-settings')?.classList.contains('hidden')) close();
  });

  // ── Экранный режим: полный экран / без рамок / с рамкой ──
  displayBox?.addEventListener('click', (e) => {
    const mode = (e.target as HTMLElement).closest('button')?.getAttribute('data-mode') as DisplayMode | null;
    if (!mode) return;
    updateSettings({ display: mode });
    void applyDisplayMode(mode);
    paint();
  });

  // ── Качество графики: 6 уровней от «слабой» до «ультра» ──
  gfxBox?.addEventListener('click', (e) => {
    const level = (e.target as HTMLElement).closest('button')?.getAttribute('data-level') as GraphicsLevel | null;
    if (!level) return;
    updateSettings({ graphics: level });
    paint();
  });

  // ── Звук ──
  music?.addEventListener('input', () => updateSettings({ music: Number(music.value) }));
  sfx?.addEventListener('input', () => updateSettings({ sfx: Number(sfx.value) }));
  mute?.addEventListener('change', () => {
    audio.setMuted(mute.checked);
    paint();
  });

  // ── Язык: словарь перезагружается и переподставляет все data-i18n ──
  lang?.addEventListener('change', () => {
    localStorage.setItem('eos.locale', lang.value);
    void loadLocale(lang.value).then(paint);
  });

  // ── Прочее ──
  hints?.addEventListener('change', () => updateSettings({ hints: hints.checked }));
  minimap?.addEventListener('change', () => updateSettings({ minimap: minimap.checked }));
  fog?.addEventListener('change', () => updateSettings({ fog: fog.checked }));

  // Любое изменение настроек: подтянуть активные кнопки и применить в движке
  onSettingsChange(() => {
    paint();
    applySettingsToEngine();
  });

  // Применить сохранённое к текущему миру (одним прогоном через подписку)
  updateSettings(getSettings());
}

// ── Бой ──────────────────────────────────────────────────────

function emitCombat(actionType: 'attack' | 'skill', skillId?: string): void {
  if (!me || !world || !session.character) return;
  if (!world.targetId) {
    toast(t('world.attack_hint'), 'info');
    return;
  }
  socket.emit('combat:action', {
    characterId: me.id,
    actionType,
    skillId,
    targetId: world.targetId,
    position: me.pos,
    direction: world3d?.moveDir ?? { x: 0, y: 0, z: 1 },
    timestamp: Date.now(),
  });
}

function basicAttack(): void {
  audio.pokeCombat();          // боевая тема на время драки
  emitCombat('attack');
}

function useSkill(skillId: string): void {
  const skill = session.skills.find((s) => s.id === skillId);
  if (!skill) return;
  if (skill.manaCost > session.mana || skill.staminaCost > session.stamina) {
    toast(`${t('common.error')}: ${t('world.mana')}/${t('world.stamina')}`, 'error');
    return;
  }
  // Локальный расход и кулдаун (сервер перепроверит)
  session.mana -= skill.manaCost;
  session.stamina -= skill.staminaCost;
  startCooldown(skillId, skill.cooldown);
  refreshBars();
  // Шаг туториала «используй навык» засчитывается здесь
  onTutorialAction('use_skill', skill.id);
  audio.pokeCombat();
  emitCombat('skill', skillId);
}

// ── Игровой цикл ─────────────────────────────────────────────

function redrawWorldMap(): void {
  if (!me || !world) return;
  drawWorldMap(
    { x: me.pos.x, z: me.pos.z },
    [...world.monsters.values()].map((m) => ({ x: m.pos.x, z: m.pos.z })),
    Object.values(NPC_WORLD_POSITIONS).map((n) => ({ x: n.x, z: n.z })),
    world3d?.getNavRoute() ?? [],
  );
}

// ── Explore-цели: подошёл к точке квеста — засчитать на сервере.
// Без этого explore закрывался только регионом (сразу при взятии),
// а не походом к воротам/лагерю.
async function checkExploreObjectives(): Promise<void> {
  if (!session.character || !me || !world) return;
  try {
    if (!navDefs) navDefs = (await api.quests()).quests;
    const { quests: state } = await api.questState(session.character.id);
    for (const st of state) {
      if (st.status !== 'active') continue;
      const def = navDefs.find((q) => q.id === st.questId);
      if (!def) continue;
      for (const o of def.objectives) {
        if (o.type !== 'explore' || o.optional) continue;
        if ((st.progress[o.id] ?? 0) >= o.required) continue;
        const key = `${st.questId}:${o.id}`;
        if (exploreSent.has(key)) continue;
        const target = resolveQuestTarget(o, def);
        if (!target) continue;
        if (Math.hypot(target.x - me.pos.x, target.z - me.pos.z) > 8) continue;
        exploreSent.add(key);
        try {
          const res = await api.questExplore(session.character.id, st.questId, o.id);
          if (res.completed?.length) {
            for (const q of res.completed) {
              toast(`Квест завершён: ${q.titleRu} (+${q.experience} ${t('world.exp')})`, 'success');
            }
            window.dispatchEvent(new CustomEvent('quest:accepted'));
          }
        } catch { exploreSent.delete(key); }
      }
    }
  } catch { /* навигация не критична */ }
}

function loop(now: number): void {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (!world || !me) return;

  // Сетевые сущности: интерполяция чужих игроков/монстров, чистка FX
  world.update(dt);

  // 3D-движок: управление мной, физика, риги, камера, рендер
  world3d?.update(dt, now, night);

  // Пакеты движения — по факту позиции, которую задал 3D-движок
  if (me.moving && now - lastMoveSent > MOVE_SEND_MS) {
    lastMoveSent = now;
    socket.emit('player:move', {
      position: { ...me.pos },
      direction: world3d?.moveDir ?? { x: 0, y: 0, z: 1 },
    });
  }

  // ── Выносливость ──
  // Раньше стамина не тратилась нигде, кроме навыков: плыть можно было
  // бесконечно. Теперь плавание её расходует, а на суше она восстанавливается
  // (после отдыха — быстрее). Сервер считает то же самое раз в 5 секунд.
  // Снаряжение для воды (сапоги/плащ) уменьшает расход и снимает замедление.
  world3d?.setWaterBonus(session.waterBonus.waterSpeed, session.waterBonus.swimStamina);
  // Лодка (если встал на воду) заменяет сапоги в воде: лучший бонус, не сумма
  const boat = session.boat;
  world3d?.setBoat(
    boat ? boat.id : null,
    boat ? boat.waterSpeed : 0,
    boat ? 0.5 : 0,               // в лодке выносливость почти не тратится
    boat ? boat.swimSpeed : 0,
  );

  // Знак «опасность в воде» — раз в секунду, не каждый кадр
  dangerTick -= dt;
  if (dangerTick <= 0) {
    dangerTick = 1;
    if (world) {
      checkWaterDanger({
        swimming: world3d?.isSwimming ?? false,
        inBoat: session.boat !== null,
        monsters: [...world.monsters.values()],
      });
    }
  }
  // Живая позиция для рыбалки и прочих «где я сейчас» запросов.
  // session.character.position обновляется только раз в несколько секунд
  // с сервера — для заброса удочки такая задержка означала бы промах.
  if (me) {
    const p = session.selfPos;
    p.x = me.pos.x; p.z = me.pos.z;
  }
  const swimming = world3d?.isSwimming ?? false;
  if (swimming) {
    const drain = STAMINA.SWIM_DRAIN_PER_SEC * (1 - (world3d?.waterStaminaSave ?? 0));
    session.stamina = Math.max(0, session.stamina - session.maxStamina * drain * dt);
  } else {
    const rate = session.stamina < session.maxStamina * 0.6
      ? STAMINA.LAND_REGEN_PER_SEC
      : STAMINA.IDLE_REGEN_PER_SEC;
    session.stamina = Math.min(session.maxStamina, session.stamina + session.maxStamina * rate * dt);
  }
  // Устал — бег и усиленное плавание отключаются
  world3d?.setSprintAllowed(session.stamina > session.maxStamina * STAMINA.SPRINT_MIN);
  if (world3d?.exhaustedNow) toast(t('world.exhausted'), 'error');

  session.mana = Math.min(session.maxMana, session.mana + session.maxMana * 0.02 * dt);
  if (Math.random() < dt * 0.5) refreshBars();

  tickCooldowns();
  // Туториал: шаг «иди» засчитывается по реально пройденному расстоянию
  tickTutorial();

  // Мини-карта: игрок в центре, монстры вокруг (раз в ~0.5с)
  if (now - lastMinimapDraw > 500) {
    lastMinimapDraw = now;
    updateMinimap(
      { x: me.pos.x, z: me.pos.z },
      [...world.monsters.values()].map((m) => ({ x: m.pos.x, z: m.pos.z })),
    );
  }

  // Большая карта (M): перерисовка раз в ~1.5с, пока открыта
  if (now - lastWorldmapDraw > 1500) {
    lastWorldmapDraw = now;
    if (!document.getElementById('overlay-map')?.classList.contains('hidden')) {
      redrawWorldMap();
    }
  }

  // Explore-цели: дошёл до точки — засчитать на сервере (раз в ~3с)
  if (now - lastExploreCheck > 3000) {
    lastExploreCheck = now;
    void checkExploreObjectives();
  }
}
