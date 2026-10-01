// ============================================================
// Игровой мир: сокеты, движение, бой — Empire of Sefevids
// ============================================================
// Протокол: shared/constants.ts (SOCKET_EVENTS / SERVER_EVENTS).

import { socket } from './net';
import { api } from './api';
import { t, detectLocale, loadLocale } from './i18n';
import { Character, session, Vec3 } from './state';
import { World, PlayerEntity } from './entities';
import { loadPanelContent, checkWaterDanger, resetWaterDanger, loadActiveMount, loadShop, loadSkills, loadParty } from './panels';
import { setHubStaff } from './hub';
import { requestCutsceneForQuest, advance, isCutscenePlaying } from './cutscene';
import { openNpcDialogue } from './dialogue';
import { NPC_WORLD_POSITIONS, questNpcPosition } from './game3d/npc';
import { GATE, groundHeight, waterSurfaceY } from './game3d/terrain';
import { STAMINA, GAME_VERSION, SOCKET_EVENTS, SERVER_EVENTS, REGION_SPAWNS } from '../../../shared/constants';
import { QuestDef, QuestObjectiveDef } from './state';
import { World3D } from './game3d/world3d';
import { audio } from './audio';
import { создатьАвтобой, запустить, остановить } from './autobattle';
import {
  getSettings, updateSettings, applyDisplayMode, onSettingsChange,
  type DisplayMode, type GraphicsLevel,
} from './settings';
import {
  chatMessage, chatVisible, closeChat, hideTarget, loadInventory, loadQuests, loadRegions, updateMinimap, renderUnreadBadge,
  refreshDailyTasksBadge,
  drawWorldMap,
  loadSkillbar, openChat, refreshBars, setWorldTime, showTarget, startCooldown,
  tickCooldowns, toast, loadBuffs, clearBuffs,
  showGuestBanner, promptClaimAccount,
} from './hud';
import { initTutorial, onTutorialAction, tickTutorial } from './tutorial';
import { initDeathScreen, hideDeathScreen, isDead } from './deathScreen';
import { loadAccountLinks } from './accountLinks';
import { onPvpMatchFound, onPvpArenaEnd, onPvpMyHpChanged } from './pvp';
import { isCombatErrorCode, COMBAT_ERROR_KEYS } from '../../../shared/combatErrors';
import { setActiveDebuffs, addDebuff, clearDebuffs, isStunnedNow } from './debuffs';
import { setStance, isStance, getStance, STANCES, STANCE_ORDER } from './stance';
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


// ── Стрелка-навигатор: цель активного квеста ─────────────────
let navDefs: QuestDef[] | null = null;
let navTimer: ReturnType<typeof setInterval> | null = null;

// Якоря регионов для стрелки навигатора.
//
// ЧТО БЫЛО. Таблица дублировала REGION_SPAWNS из shared/constants, и все
// семь якорей стояли рядом со столицей: z от -170 до 200 при том, что
// зоны Хорасана лежат на z 700..1050. Стрелка вела к цели за полкилометра
// от зоны, к которой цель относилась.
//
// Теперь берётся из общего места, чтобы список нельзя было развести
// снова, и каждая точка лежит ВНУТРИ своей полосы.
const REGION_ANCHORS: Record<string, { x: number; z: number }> = REGION_SPAWNS;
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
    listEl.innerHTML = '<div class="quest-j-empty">' + t('world.qj_no_char') + '</div>';
    return;
  }
  try {
    const [defs, { quests }] = await Promise.all([getQuestDefs(), api.questState(cid)]);
    const active = (quests || []).filter((q) => q.status === 'active');
    if (!active.length) {
      listEl.innerHTML = '<div class="quest-j-empty">' + t('world.qj_empty') + '<br><small>' + t('world.qj_empty_hint') + '</small></div>';
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
    listEl.innerHTML = '<div class="quest-j-empty">' + t('world.qj_error') + '</div>';
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
/**
 * Пока летит запрос на вход или выход, повторные клики по двери
 * игнорируются. Без этого при медленной сети можно успеть отправить
 * несколько запросов и получить два телепорта подряд.
 */
let doorBusy = false;

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

/**
 * Вход в здание и выход из него.
 *
 * ТУТ БЫЛА НЕДОСТАЮЩАЯ ЗВЕНО. 3D-слой давно умел определять клик по двери
 * (pickDoor) и телепортировать по подтверждению сервера (enterBuildingAt /
 * exitBuildingAt), десять комнат были нарисованы и стояли в сцене — но
 * обработчик двери в world3d.init НЕ ПЕРЕДАВАЛИ. Сценарий: игрок подходит к
 * двери, жмёт, ничего не происходит, дверь выглядит как часть стены.
 * Пять публичных методов World3D при этом ни разу не вызывались.
 *
 * Почему телепорт только по ответу сервера, а не сразу на клик. Сервер
 * проверяет, что игрок действительно у двери, и двигает позицию в базе и
 * Redis. Если телепортировать локально, не дождавшись ответа, первый же
 * пакет движения из старой точки прилетит раньше, чем сервер сбросит
 * трекинг, и античит выкинет за спидхак. Поэтому клик только спрашивает
 * сервер, а перемещение происходит в ответе на его «да».
 */
function enterOrExitBuilding(action: string, buildingId: string, nameRu: string): void {
  if (!world3d) return;
  // Ссылку берём в локальную переменную: внутри обратного вызова сервера
  // TypeScript уже не видит сужения «world3d не пуст», полученного выше, —
  // а ссылка на мир за это время не исчезает: сменить её может только
  // полная пересборка сцены, которая пересоздаёт и эту функцию
  const w3d = world3d;
  // Пока запрос летит, повторные клики игнорируем: иначе при медленной
  // сети можно застрять в ожидании и получить два телепорта подряд
  if (doorBusy) return;
  doorBusy = true;

  const event = action === 'exit' ? SOCKET_EVENTS.INTERIOR_EXIT : SOCKET_EVENTS.INTERIOR_ENTER;
  let settled = false;
  const done = (): void => {
    if (settled) return;
    settled = true;
    doorBusy = false;
  };

  // Страховка: если сервер не ответил ни отказом, ни успехом (обрыв связи,
  // перезагрузка сервера), дверь должна перестать «залипать» иначе
  window.setTimeout(() => {
    if (settled) return;
    done();
    toast(t('world.inside_failed'), 'error');
  }, 6000);

  socket.emit(
    event,
    { buildingId },
    (res: { ok: boolean; target?: { x: number; y: number; z: number }; reason?: string }) => {
      done();
      if (!res?.ok) {
        // Причины сервер отдаёт по-английски. Показываем перевод по
        // смыслу, а не сырую строку: игрок не должен видеть служебный текст
        const map: Record<string, string> = {
          'Too far from the door': t('world.inside_far'),
          'Not inside': t('world.inside_not_inside'),
          'Unknown building': t('world.inside_unknown'),
          'Not authenticated': t('world.inside_not_auth'),
        };
        toast(map[res?.reason ?? ''] ?? t('world.inside_failed'), 'error');
        return;
      }
      if (!res.target) {
        toast(t('world.inside_failed'), 'error');
        return;
      }
      const ok = action === 'exit'
        ? w3d.exitBuildingAt(res.target)
        : w3d.enterBuildingAt(buildingId, res.target);
      if (!ok) {
        // Сервер разрешил, а локально перемещение не вышло: значит
        // локальное состояние разошлось с серверным. Молчать нельзя —
        // игрок увидит, что стоит у двери, и решит, что игра сломалась
        toast(t('world.inside_failed'), 'error');
        return;
      }
      toast(
        action === 'exit'
          ? t('world.inside_exit')
          : t('world.inside_enter').replace('{name}', nameRu || buildingId),
        'success',
      );
    },
  );
}


/**
 * Открыть панель по имени.
 *
 * Единственное место в игре, которое умеет открывать панель правильно:
 * показать её, подсветить кнопку в ряду и загрузить всё, что этой панели нужно
 * для отрисовки. Кнопка в ряду, хаб и NPC-клик пользуются именно ей — иначе
 * одна из точек входа забыла бы про доп. загрузку, и панель открылась бы пустой.
 */
export function openPanelById(panel: string): void {
  const el = document.getElementById(panel);
  if (!el) return;
  // ЧТО БЫЛО. Панели копились одна на другой. Открытие только снимало
  // класс hidden со своей панели и ничего не закрывало, а закрыть её было
  // нечем: кнопки «×» в разметке не было ни у одной из 37 панелей, а Esc
  // открывал меню, но панели не трогал. Итог, который и видел игрок: открыл
  // хаб, потом инвентарь, потом задачи — три панели друг на друге, верхняя
  // закрывает остальные, и снять их нечем, кроме повторного клика по кнопке
  // в ряду (о чём нигде не написано).
  closeAllPanels();
  el.classList.remove('hidden');
  document.querySelector<HTMLButtonElement>(`.panel-toggles button[data-panel="${panel}"]`)
    ?.classList.add('active');
  // Инвентарь, квесты и карта тянут за собой то, что им нужно для отрисовки
  if (panel === 'panel-inventory') void loadInventory();
  if (panel === 'panel-quests') void loadQuests();
  if (panel === 'panel-quests-j') void refreshQuestPanelJ();
  if (panel === 'panel-regions') void loadRegions();
  loadPanelContent(panel);
}

/** Все панели HUD — то, что открывается кнопкой, хабом, NPC-кликом или клавишей */
function allPanels(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.hud.side-panel')];
}

/** Закрыть одну панель и погасить её кнопку в ряду */
export function closePanel(panel: string): void {
  document.getElementById(panel)?.classList.add('hidden');
  document.querySelector(`.panel-toggles button[data-panel="${panel}"]`)?.classList.remove('active');
}

/**
 * Закрыть все открытые панели.
 *
 * Возвращает, сколько их было — на этом держится Esc: сначала он закрывает
 * панель, и только если открытых панелей не было вовсе, открывает меню.
 * Иначе Esc всегда открывал бы меню поверх панели, и закрыть её было бы
 * по-прежнему нечем.
 */
export function closeAllPanels(): number {
  const open = allPanels().filter((p) => !p.classList.contains('hidden'));
  for (const p of open) closePanel(p.id);
  return open.length;
}

/**
 * Переключить панель: открыть (закрыв остальные) или закрыть, если открыта.
 *
 * Единая точка для кнопок в ряду и горячих клавиш. Раньше обе делали
 * `classList.toggle('hidden')` напрямую — мимо openPanelById, а значит мимо
 * доп. загрузки содержимого: панель по клавише открывалась, но с тем, что
 * успело нарисоваться в прошлый раз.
 */
export function togglePanel(panel: string): void {
  const el = document.getElementById(panel);
  if (!el) return;
  if (!el.classList.contains('hidden')) {
    closePanel(panel);
    return;
  }
  openPanelById(panel);
  if (panel === 'panel-inventory') onTutorialAction('open_inventory');
}

/**
 * Крестик в правом верхнем углу каждой панели.
 *
 * Ставится скриптом, а не в разметке: панелей 37, и вписать кнопку в каждую
 * значит ещё 37 мест, где её можно забыть при добавлении новой панели.
 * Повторный вызов ничего не дублирует — проверка по наличию кнопки.
 */
function installPanelCloseButtons(): void {
  for (const panel of allPanels()) {
    if (panel.querySelector(':scope > .panel-close')) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-close';
    btn.title = t('common.close');
    btn.setAttribute('aria-label', t('common.close'));
    btn.textContent = '×';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closePanel(panel.id);
    });
    panel.prepend(btn);
  }
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
    // innerHTML стирает детей элемента, а в кнопках с бейджами они есть:
    // без этой строки красная цифра непрочитанных уведомлений гибла при
    // входе в мир и больше не появлялась никогда.
    const badge = el.querySelector('.unread-badge');
    el.innerHTML = icon(el.dataset.icon as IconName, 18);
    if (badge) el.append(badge);
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
    onDoor: (action, buildingId, nameRu) => void enterOrExitBuilding(action, buildingId, nameRu),
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
  // Восстановить состояние «внутри здания» по позиции спавна.
  //
  // ЧТО БЫЛО. Метод enterBuildingLocalAt был написан с этой самой целью и
  // комментарием, но его не вызывал НИКТО. Комнаты интерьеров лежат за
  // границей мира (комната у тракта около x=2500, а WORLD_HALF = 1200),
  // поэтому при входе внутрь здания выполнялся кламп границ: игрок
  // оказывался в (1170, 1170), а сервер видел скачок больше тысячи метров
  // и отвечал punish(speed_hack) — кик. Пять таких переподключений подряд,
  // и AntiCheatSystem вешал permanent-бан.
  //
  // Телепорта и пакета тут нет: сервер сам сбросил трекинг при авторизации,
  // нужно только вернуть клиенту правильный режим.
  const inside = world3d.enterBuildingLocalAt(me.pos.x, me.pos.z);
  if (inside) toast(t('world.inside_enter').replace('{name}', inside), 'info');
  markLoading(0.85, t('loading.connecting'));
  await nextPaint();
  fillMenuInfo();
  wireSettings();
  void loadAdminRights();
  void loadBuffs();
  // Активный скакун: без этого игрок входит в игру пешком, даже если
  // оставил коня в конюшне. Скорость нужна с первой секунды, а не после
  // первого захода в конюшню
  void loadActiveMount();
  // Настоящая стойка персонажа. Без этого клиент начинал бы каждый вход
  // с «Обычного боя» у себя в памяти, а сервер бит «Танцем серпа»: панель
  // показывала бы неверный выбор, и переключение по клавише сдвигало бы
  // игрока не с того места. Стойка живёт в базе, значит сервер обязан
  // назвать её при входе.
  void loadStanceFromServer();
  // Возврат от платёжного провайдера. Провайдер отправляет игрока обратно на
  // сайт с ?payment=<id>, и без проверки тут он вернулся бы в игру, не зная,
  // дошли деньги или нет. Платёж отмечается завершённым на сервере, а не
  // здесь, поэтому клиент только спрашивает и обновляет панель.
  void resumePaymentFromUrl();
  // Экипировка — тоже сразу: иначе аватар до первого открытия инвентаря
  // ходит с классовым оружием вместо надетого
  void loadInventory();
  if (session.isGuest) showGuestBanner();
  // Туториал новичка. Раньше не вызывался НИ РАЗУ, хотя был написан целиком:
  // игрок попадал в город с двадцатью кнопками без единой подсказки.
  void initTutorial(me.id);
  // Счётчик задач дня на кнопке в ряду: цифра живёт в памяти клиента,
  // поэтому её надо переспросить при каждом входе в мир
  void refreshDailyTasksBadge();
  // Шаг «атакуй мечом» засчитывается на замахе (3D-слой сообщает через крючок)
  world3d?.setOnAttack(() => onTutorialAction('attack'));
  // Шаг «осмотритесь» засчитывается на реальном повороте камеры мышью
  world3d?.setOnCamera(() => onTutorialAction('camera'));
  // Защита: до этого клиент вообще не отправлял блок и уклонение, хотя сервер
  // их обрабатывал. Теперь ПКМ и двойное нажатие клавиши доходят до сервера.
  world3d?.setOnBlock(() => startBlock());
  world3d?.setOnDodge(() => startDodge());
  // Автобой запускается при входе в мир, если игрок его включал. Выключенный
  // по умолчанию: решение остаётся за игроком, и состояние живёт в
  // настройках, поэтому между сессиями переключатель не сбрасывается.
  if (автобой.включён) стартАвтобоя();
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
  // Экран смерти не должен пережить выход из мира: он перекрывал бы
  // экран выбора персонажа (у него z-index выше экранов)
  hideDeathScreen();
  // Бонусы остаются в игре, но их таймер в HUD должен перестать тикать
  clearBuffs();
  // Эффекты монстров снимаем при выходе из мира по той же причине:
  // иначе иконка оглушения пережила бы выход в выбор персонажа, и
  // игрок вернулся бы в игру с пометкой «оглушён», хотя бить можно.
  // В базе эффекты снимает сервер по своему счёту; здесь - наш список.
  clearDebuffs();
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

  // Экран смерти подписывается ЗДЕСЬ, а не в boot(): строка выше снимает
  // все подписки сокета, так что модуль обязан пересоздать их при каждом
  // входе в мир. Сам оверлей при этом создаётся один раз.
  initDeathScreen();

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

  // PvP-арена: сервер нашёл соперника и поднял бой
  socket.on('pvp:match_found', (data: {
    matchId: number; endsAt: number;
    you: { id: string; name: string; hp: number; maxHp: number };
    opponent: { id: string; name: string; charClass: string; level: number } | null;
  }) => {
    void onPvpMatchFound(data);
  });

  // Бой закончился: нокаут или вышло время
  socket.on('pvp:ended', (data: {
    matchId: number; winnerId: string | null; youWon: boolean; reason?: string;
  }) => {
    void onPvpArenaEnd(data);
  });

  // Задача дня закрыта: сервер уже начислил золото, опыт и предмет.
  // Без этого сообщения игрок узнал бы о награде только по цифре в кошельке.
  socket.on(SERVER_EVENTS.DAILY_TASK_COMPLETED, ({ gold, experience, item }: {
    taskId: string; gold?: number; experience?: number; item?: string;
  }) => {
    const parts: string[] = [];
    if (gold) parts.push(`+${gold} ${t('world.gold')}`);
    if (experience) parts.push(`+${experience} ${t('world.exp')}`);
    if (item) {
      // Сервер присылает идентификатор вида mat_dragon_scale. Раньше он
      // уходил в тост как есть — игрок читал «+mat_dragon_scale» вместо
      // названия. Как и с зонами: ключ при отсутствии — не показываем путь.
      const key = `items.${item}`;
      const label = t(key);
      parts.push(label === key ? item : label);
    }
    audio.levelUp();
    const reward = parts.length ? `: ${parts.join(' · ')}` : '';
    toast(`${t('site.tasks_done_toast')}${reward}`, 'success');
    // Цифра на кнопке в ряду отстаёт ровно на одну задачу — обновляем
    void refreshDailyTasksBadge();
  });

  // ── Подземелье, репутация, мировые события ──
  //
  // Три события сервер отдавал, а клиент слушал только два. Мёртвая
  // доставка: игрок проходил подземелье, получал опыт и золото на руки и
  // не знал об этом — награда появлялась сама, без объяснения. Так же
  // молча менялся статус кармы (с нейтрального на красный, например) и
  // приходил вылет мирового босса. Все три события объявлены в
  // SERVER_EVENTS, все три шлются из GameSocketHandler — не хватало
  // было только приёмника.

  // Подземелье пройдено. Сервер уже начислил опыт, золото и предметы;
  // nameRu приходит вместе с наградой, придумывать название не нужно.
  socket.on(SERVER_EVENTS.DUNGEON_COMPLETED, (d: {
    dungeonNameRu?: string; experience?: number; gold?: number; items?: string[];
  }) => {
    const name = d?.dungeonNameRu ?? '';
    const parts: string[] = [];
    if (d?.experience) parts.push(`+${d.experience} ${t('world.exp')}`);
    if (d?.gold) parts.push(`+${d.gold} ${t('world.gold')}`);
    // Идентификаторы предметов показываем названиями, как в задаче дня.
    for (const id of d?.items ?? []) {
      const key = `items.${id}`;
      const label = t(key);
      parts.push(label === key ? id : label);
    }
    const reward = parts.length ? `: ${parts.join(' · ')}` : '';
    // Без названия подземелья заголовок с плейсхолдером бессмысленен,
    // поэтому на такой случай отдельная фраза без имени.
    const title = name
      ? t('dungeon.completed').replace('{name}', name)
      : t('dungeon.completed_generic');
    audio.levelUp();
    toast(`${title}${reward}`, 'success');
  });

  // Карма сменила статус. Сервер шлёт это только при смене статуса, а не
  // при каждом изменении числа, — то есть событие означает «теперь тебя
  // считают иначе», и молчать об этом нельзя.
  socket.on(SERVER_EVENTS.KARMA_CHANGED, (k: { newStatus?: string; newKarma?: number }) => {
    if (!k?.newStatus) return;
    const key = `karma.status.${k.newStatus}`;
    const label = t(key);
    // Неизвестный статус показываем как есть: молчаливый пропуск хуже
    // некрасивого слова, игрок должен увидеть, что сервер прислал.
    toast(t('karma.status_changed').replace('{status}', label === key ? k.newStatus : label),
      k.newKarma != null && k.newKarma < 0 ? 'error' : 'info');
  });

  // ── Партия, аукцион, баунти, действия администратора ──
  //
  // Все эти события сервер отдавал, а клиент не слушал. Партия при этом
  // менялась по-настоящему: человек вступал, кто-то выходил, партия
  // расформировалась - и панель продолжала показывать прежний состав
  // до следующего открытия.

  // Состав партии. members приходит с сервера: id и роль каждого.
  const составПартии = (members: { characterId: string; role: string }[]) => {
    const свои = members.filter((m) => m.characterId === session.character?.id).length;
    toast(t('party.members_changed').replace('{n}', String(members.length)).replace('{me}', String(свои)), 'info');
    void loadParty();
  };

  socket.on(SOCKET_EVENTS.PARTY_UPDATED, (d: { members?: { characterId: string; role: string }[] }) => {
    составПартии(Array.isArray(d?.members) ? d.members : []);
  });
  socket.on(SOCKET_EVENTS.PARTY_MEMBER_JOINED, (d: { characterId?: string; members?: { characterId: string; role: string }[] }) => {
    составПартии(Array.isArray(d?.members) ? d.members : []);
    if (d?.characterId && d.characterId === session.character?.id) toast(t('party.you_joined'), 'success');
  });
  socket.on(SOCKET_EVENTS.PARTY_MEMBER_LEFT, (d: { characterId?: string; members?: { characterId: string; role: string }[] }) => {
    // Вышедший должен забыть партию: сервер удалил её, а в localStorage
    // остался её id, и панель продолжала бы опрашивать несуществующую.
    if (d?.characterId && d.characterId === session.character?.id) {
      localStorage.removeItem('eos_party');
      toast(t('party.you_left'), 'info');
      return;
    }
    составПартии(Array.isArray(d?.members) ? d.members : []);
  });
  socket.on(SOCKET_EVENTS.PARTY_DISBANDED, () => {
    localStorage.removeItem('eos_party');
    toast(t('party.disbanded'), 'info');
  });

  // Новый лот на аукционе. Сервер шлёт price - показываем его, а
  // предмет не называем: идентификатор игроку ничего не скажет.
  socket.on(SOCKET_EVENTS.AUCTION_NEW_LISTING, (d: { itemId?: string; price?: number }) => {
    const части: string[] = [];
    if (d?.price != null) части.push(`${d.price} ${t('world.gold')}`);
    if (d?.itemId) {
      const ключ = `items.${d.itemId}`;
      const название = t(ключ);
      части.unshift(название === ключ ? d.itemId : название);
    }
    // Русский текст внутри литералов в вызове toast() проверка
    // gameI18n считает хардкодом: игрок с латинским интерфейсом увидел бы
    // «Новый лот на аукционе» вместо перевода. Поэтому разделитель и
    // двоеточие вынесены в словари, а здесь только ключи.
    toast(`${t('auction_notice.new_listing')}${части.length ? t('common.list_sep') + части.join(t('common.list_sep')) : ''}`, 'info');
  });

  // Баунти на игрока. amount приходит с сервера, placerId - кто повесил.
  socket.on(SOCKET_EVENTS.BOUNTY_PLACED, (d: { amount?: number; placerId?: string }) => {
    const сумма = d?.amount != null ? t('common.list_sep') + `${d.amount} ${t('world.gold')}` : '';
    toast(`${t('bounty.placed')}${сумма}`, 'error');
  });

  // Молчание персонажа. Причина приходит с сервера, показываем её.
  socket.on(SOCKET_EVENTS.ADMIN_MUTE, (d: { muteUntil?: string; reason?: string }) => {
    toast(`${t('admin.muted')}${d?.reason ? t('common.list_sep') + d.reason : ''}`, 'error');
  });

  // Телепорт администратором. Это единственное из трёх, где клиент
  // обязан не просто показать текст, а переставить игрока: иначе он
  // стоит в старом месте и не понимает, что произошло.
  socket.on(SOCKET_EVENTS.ADMIN_TELEPORT, (d: { position?: { x: number; z: number }; region?: string }) => {
    toast(t('admin.teleported'), 'info');
    // Переставляем сущность игрока, а не только показываем текст: иначе
    // он остался бы в старом месте и не понял бы, что произошло.
    // Ориентир — обработчик move:rejected выше: там позиция приходит
    // сверху и целиком переносится в сущность.
    if (d?.position && me) {
      me.pos = { x: Number(d.position.x), y: 0, z: Number(d.position.z) };
      me.target = { ...me.pos };
    }
  });

  // Выдача предмета: предмет уже в базе, но инвентарь в клиенте старый.
  socket.on(SOCKET_EVENTS.ADMIN_GIVE_ITEM, () => {
    toast(t('admin.item_given'), 'success');
    void loadInventory();
  });

  // Смена скакуна. Скорость пересчитывается в тике из session.mount,
  // поэтому достаточно перечитать активного скакуна: иначе игрок
  // пересел и продолжает ехать на прежней скорости до перезахода.
  socket.on(SOCKET_EVENTS.PLAYER_MOUNT, () => {
    void loadActiveMount();
  });

  // Мировые события: выход босса и его гибель. Состав полей — из
  // WorldEventSystem.announce: started несёт nameRu, defeated — нет,
  // поэтому у defeated своя фраза без имени.
  socket.on(SERVER_EVENTS.WORLD_EVENT, (e: { status?: string; nameRu?: string }) => {
    if (e?.status === 'started') {
      if (!e.nameRu) return;
      toast(t('world_event.boss_started').replace('{name}', e.nameRu), 'error');
    } else if (e?.status === 'defeated') {
      toast(t('world_event.boss_defeated'), 'success');
    }
  });

  // ── Бой ──
  // Ответ на включение активного навыка. Приходит тем же combat:result,
  // что и удар, поэтому обрабатывается здесь же, до проверки цели: у
  // включения навыка нет ни атакующего, ни цели.
  socket.on('combat:result', (raw: unknown) => {
    const act = raw as { skillActivated?: boolean; skillId?: string };
    if (act?.skillActivated) {
      toast(t('skills.skill_activate') + ': ' + (act.skillId ?? ''), 'success');
      void loadSkills();
    }
  });

  socket.on('combat:result', (r: { attackerId: string; targetId: string; damage: number; isCritical: boolean; isBlocked: boolean; isDodged: boolean; isParried?: boolean; reflected?: number; targetHp?: number; targetMaxHp?: number }) => {
    if (!world) return;
    const attacker = world.players.get(r.attackerId);
    const target = world.monsters.get(r.targetId) ?? world.players.get(r.targetId);
    if (!attacker || !target) return;
    if (r.attackerId === me?.id) {
      if (r.isParried) {
        // Цель парировала: наш удар вернулся. Показываем это честно, а то
        // выглядит так, будто удар просто исчез.
        world.addFloater(attacker.pos.x, attacker.pos.z - 1, t('world.parried_by_target'), '#8fe3c8', true);
        if (r.reflected) {
          world.addFloater(attacker.pos.x + 1, attacker.pos.z - 1, `-${r.reflected}`, '#8fe3c8', true);
        }
      } else if (r.isDodged) {
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

  // Урон со временем и то, что сейчас висит на игроке.
  //
  // Отдельный пакет от combat:hit: там удар, здесь то, что длится
  // секунды. Приходит раз в две секунды с полным списком, а не
  // накопительными событиями - иначе пропущенный пакет оставлял бы
  // на экране иконку яда, которого уже нет.
  socket.on('combat:debuff_tick', (r: {
    damage: number; hp: number; maxHp: number;
    debuffs: { id: string; kind: string; secondsLeft: number; magnitude: number }[];
  }) => {
    setActiveDebuffs(r.debuffs ?? []);
    if (r.hp > 0 || r.maxHp > 0) {
      session.hp = r.hp;
      session.maxHp = r.maxHp;
      refreshBars();
      onPvpMyHpChanged(r.hp);
    }
    if (r.damage > 0 && world && me) {
      // Число от тика помечаем: игрок должен отличить яд от удара, иначе
      // он решит, что монстр бьёт чаще, чем настроено в данных.
      world.addFloater(me.pos.x, me.pos.z - 1, `-${r.damage}`, '#c98fd0', true);
    }
  });

  socket.on('combat:hit', (r: { damage: number; isDodged: boolean; isBlocked: boolean; isParried?: boolean; reflected?: number; hp: number; maxHp: number; debuff?: { id: string; kind: string; durationMs: number } | null }) => {
    session.hp = r.hp;
    session.maxHp = r.maxHp;
    if (world && me) {
      if (r.isParried) {
        // Парирование: урона нет, а по атакующему прилетело отражение.
        // Показываем и то, и другое, иначе выглядит так, будто удар просто
        // потерялся.
        world.addFloater(me.pos.x, me.pos.z - 1, t('world.parry_success'), '#8fe3c8', true);
        if (r.reflected) {
          world.addFloater(me.pos.x + 1, me.pos.z - 1, `+${r.reflected}`, '#8fe3c8', true);
        }
        audio.parry();
      } else if (r.isDodged) {
        world.addFloater(me.pos.x, me.pos.z - 1, t('world.dodge'), '#cfe3f0');
      } else {
        world.addFloater(me.pos.x, me.pos.z - 1, `-${r.damage}`, '#ff8d7e', true);
        audio.hit();
        // Эффект приезжает вместе с ударом, а не отдельным пакетом:
        // иконка должна появиться в тот же миг, что и число урона.
        // Отдельное сообщение пришло бы на секунду позже и затерялось бы
        // в серии ударов.
        if (r.debuff) {
          // Добавление одного эффекта, а не замена всего списка: полный
          // список приходит отдельным пакетом раз в две секунды, а
          // иконка должна появиться в тот же миг, что и число урона.
          addDebuff({
            id: r.debuff.id,
            kind: r.debuff.kind,
            secondsLeft: Math.max(1, Math.round(r.debuff.durationMs / 1000)),
            magnitude: 0,
          });
        }
      }
    }
    if (!r.isParried) refreshBars();
    // Полоса здоровья на экране арены
    onPvpMyHpChanged(r.hp);
  });

  // Смена боевой стойки. Сервер подтверждает фактически применённую стойку,
  // а не запрошенную: если конная стрельба отклонена без скакуна, придёт
  // прежняя, и мышкой покажется верное значение.
  socket.on('combat:stance', (d: { stance: string }) => {
    if (d.stance && isStance(d.stance)) setStance(d.stance);
  });

  /**
   * Запрос смены стойки.
   *
   * Сначала проверяем скакуна сами: конная стрельба без коня отклоняется
   * сервером, но ждать ответа ради заведомо известного отказа - значит
   * переключать стойку «вслепую» и показывать неверное состояние.
   */
  // Функции смены стойки живут на уровне модуля: их зовёт и сокет, и
  // горячая клавиша, а wireSocket и wireInput - разные функции.

  // ТУТ БЫЛА ДЫРА В ОТЗЫВЕ. Сервер после успешного блока или уклонения
  // подтверждает это событием combat:defense, но клиент его не слушал
  // вовсе. Итог: игрок нажимал блок или уклонение, сервер их принимал и
  // применял множитель, а на экране не появлялось НИЧЕГО. Непонятно, сработало
  // или нет — при том что механика работала, просто молча. Соседние ветки
  // боя такого не страдали: combat:result и combat:hit слушаются.
  socket.on('combat:defense', (d: { actionType: string; characterId: string }) => {
    // Подтверждение приходит тому, кто защищался. Чужое игнорируем: зачем
    // показывать «Блок» над чужим персонажем — у него своя картинка.
    if (!me || d.characterId !== me.id) return;
    if (!world) return;
    if (d.actionType === 'dodge') {
      world.addFloater(me.pos.x, me.pos.z - 1, t('world.dodge'), '#cfe3f0');
    } else {
      world.addFloater(me.pos.x, me.pos.z - 1, t('world.block'), '#9fd4ff');
    }
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
    if (message === 'Target not found' || message === 'target_not_found') return;
    // Сервер шлёт код причины, а не текст: раньше приходила английская фраза
    // ('Dodge is on cooldown') и показывалась дословно посреди русского
    // интерфейса. Теперь код переводится на язык игрока.
    toast(isCombatErrorCode(message) ? t(COMBAT_ERROR_KEYS[message]) : message, 'error');
  });

  socket.on('combat:visual', (v: { attackerId: string; targetId: string }) => {
    if (!world || v.attackerId === me?.id) return; // свой урон уже отрисован по combat:result
    const a = world.players.get(v.attackerId);
    const b = world.monsters.get(v.targetId) ?? world.players.get(v.targetId);
    if (a && b) world.addEffect('slash', a.pos.x, a.pos.z, b.pos.x, b.pos.z, '#b9c8d6');
  });

  // ── Смерть и возрождение ──
  // Оверлей с выбором возрождения открывает deathScreen (он же слушает
  // player:died и player:respawned). Здесь только звук и поплавок в мире:
  // два оверлея смерти на экране — это каша из двух наложенных экранов.
  socket.on(SOCKET_EVENTS.PLAYER_DIED, () => {
    audio.playerDeath();
    if (me) world?.addFloater(me.pos.x, me.pos.z - 1, t('world.died'), '#ff8d7e');
  });

  socket.on(SOCKET_EVENTS.PLAYER_RESPAWNED, (d: {
    hp: number; maxHp: number; position: Vec3; gold?: number; type?: string;
  }) => {
    session.hp = d.hp;
    session.maxHp = d.maxHp;
    if (d.gold !== undefined && session.character) session.character.gold = d.gold;
    if (me) {
      me.pos = { ...d.position };
      me.target = { ...d.position };
    }
    // «Возрождение на стартовой точке» — только для города; после
    // респавна на месте смерти надпись была бы враньём
    toast(d.type === 'spot' ? t('panels.death_respawned_spot') : t('world.respawned'), 'success');
    refreshBars();
    // Автобой после смерти обязан начать заново: он был запущен до входа в
    // мир, а мир пересоздаётся при входе. Без этого игрок включил бы авто,
    // умер, вернулся - и автобой молчал бы, пока он не догадается
    // переключить его в настройках.
    if (автобой.включён) стартАвтобоя();
  });

  // ── Чат ── сервер поддерживает world/region/guild/party (см. GameSocketHandler.handleChatMessage)
  const chatEvents = ['chat:world', 'chat:region', 'chat:guild', 'chat:party'] as const;
  const channelPrefix: Record<string, string> = { 'chat:guild': 'chat.guild_tag', 'chat:party': 'chat.party_tag' };
  for (const ev of chatEvents) {
    socket.on(ev, ({ characterId, name, role, message }: { characterId: string; name?: string | null; role?: 'owner' | 'admin' | 'moderator' | null; message: string }) => {
      const p = world?.players.get(characterId);
      const displayName = name ?? p?.name ?? '???';
      const prefix = channelPrefix[ev] ? t(channelPrefix[ev]) : '';
      chatMessage(displayName, prefix + message, false, role ?? null, characterId);
    });
  }
  // Ошибки чата: сервер отдаёт код, а не готовый текст
  socket.on('chat:error', (e: { message?: string; code?: string; waitMs?: number; until?: string }) => {
    // Отказ по задержке. Показываем, сколько ждать, иначе игрок решит, что
    // его сообщения не доходят, и перестанет писать вовсе
    if (e.code === 'CHAT_COOLDOWN') {
      const sec = Math.max(1, Math.ceil((e.waitMs ?? 1000) / 1000));
      chatMessage(null, t('chat.cooldown').replace('{sec}', String(sec)), true);
      return;
    }
    // Мьют. Показываем, до когда: игрок должен понимать, что это не навсегда
    if (e.code === 'CHAT_MUTED') {
      const until = e.until ? new Date(e.until) : null;
      const mins = until && Number.isFinite(until.getTime())
        ? Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000))
        : 0;
      chatMessage(null, mins > 0
        ? t('chat.muted').replace('{min}', String(mins))
        : t('chat.muted_no_time'), true);
      return;
    }
    // Сообщение изменили фильтром. Без этой строки игрок увидел бы в чате
    // своё сообщение с цензурой и не понял бы, что произошло
    if (e.code === 'CHAT_FILTERED') {
      chatMessage(null, t('chat.filtered'), true);
      return;
    }
    // Остальные ошибки приходят готовым текстом с сервера
    if (e.message) chatMessage(null, e.message, true);
  });

  /**
   * Живое уведомление.
   *
   * ЧТО БЫЛО. Обработчик читал msg.message / msg.text / msg.title, а сервер
   * присылает titleRu / bodyRu. Три поля не совпадали ни с одним, поэтому
   * тост выводился ПУСТЫМ: игрок видел всплывашку без текста и не понимал,
   * что произошло. Поля переименованы на стороне NotificationService, когда
   * шаблоны получили title_ru / body_ru под колонки таблицы, а обработчик
   * остался с прошлыми именами.
   */
  socket.on('notification', (msg: {
    type?: string; titleRu?: string; bodyRu?: string; title?: string; body?: string;
  }) => {
    const title = msg.titleRu ?? msg.title ?? '';
    const body = msg.bodyRu ?? msg.body ?? '';
    toast([title, body].filter(Boolean).join(' — '), 'info');
    session.notifications.unread++;
    renderUnreadBadge();
  });

  socket.on('zone:changed', (payload: { zone: { id: string; name: string; nameRu: string; dangerLevel: number } | null }) => {
    if (payload.zone) {
      // Подпись зоны берём из словаря (тот же ключ, что на миникарте).
      // t() при отсутствии ключа возвращает сам путь — тогда показываем
      // английское имя с сервера, но никогда не русское.
      const key = `zones.${payload.zone.id}`;
      const zoneName = t(key);
      toast(zoneName === key ? payload.zone.name : zoneName, 'info');
    }
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
    // Автобой останавливается при разрыве. Без этого он продолжал бы
    // слать удары по обрывающемуся сокету, а при возврате в игру стартовал
    // бы ещё один цикл поверх работающего - и по миру пошло бы два
    // автобоя, то есть вдвое больше пакетов, чем нужно.
    стопАвтобоя();
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
      // Карта мира — тоже оверлей. Раньше Esc её не трогал, и меню
      // открывалось ПОВЕРХ карты: игрок жал Esc, чтобы убрать карту,
      // а получал меню, под которым карта оставалась.
      const mapOverlay = $('overlay-map');
      if (mapOverlay && !mapOverlay.classList.contains('hidden')) {
        mapOverlay.classList.add('hidden');
        return;
      }
      // Сначала закрываем панель. Раньше Esc только переключал меню, и панель
      // оставалась на экране поверх него: открыть новую панель, накрыть её
      // другой и убрать всё это было нечем.
      if (closeAllPanels() > 0) return;
      document.getElementById('overlay-menu')?.classList.toggle('hidden');
    } else if (e.code === getBind('map')) {
      const overlay = document.getElementById('overlay-map');
      overlay?.classList.toggle('hidden');
      if (overlay && !overlay.classList.contains('hidden')) redrawWorldMap();
    } else if (e.code === getBind('character')) {
      togglePanel('panel-character');
    } else if (e.code === getBind('guild')) {
      togglePanel('panel-guild');
    } else if (e.code === getBind('quests')) {
      togglePanel('panel-quests-j');
    } else if (e.code === getBind('inventory')) {
      togglePanel('panel-inventory');
    } else if (e.code === 'KeyR') {
      // Смена боевой стойки по кругу. Конная стрельба пешком пропускается:
      // иначе каждое второе нажатие упиралось бы в отказ сервера.
      cycleStance();
    } else if (/^Digit[1-4]$/.test(e.code)) {
      const idx = Number(e.code.slice(5)) - 1;
      const skill = session.skills[idx];
      if (skill) useSkill(skill.id);
    }
  };

  window.addEventListener('game:skill', (e) => useSkill((e as CustomEvent<string>).detail));

  // Включение активного навыка профессии (Зикр, Тадж). Панель шлёт
  // событие окна, потому что про сокет не знает; здесь оно уходит на сервер.
  window.addEventListener('game:skill-activate', (e) => {
    const skillId = (e as CustomEvent<string>).detail;
    if (!skillId || isDead()) return;
    socket.emit('skill:activate', { skillId });
  });
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
  //
  // ЧТО БЫЛО (1). Обработчик делал `classList.toggle('hidden')` сам, мимо
  // openPanelById. Поэтому открытая панель не закрывала другие, а её
  // содержимое не перезагружалось — панель показывала то, что нарисовалась
  // в прошлый раз. Теперь всё идёт через togglePanel.
  //
  // ЧТО БЫЛО (2). После перехода на togglePanel обработчик стал вызывать
  // загрузку содержимого ВТОРЫМ разом: togglePanel уходит в openPanelById,
  // а тот уже грузит и список, и подгрузку панели. Второй вызов запускал
  // ту же асинхронную загрузку параллельно, и содержимое выводилось
  // дважды: в панели квестов было 16 карточек вместо 8, в задачах дня —
  // две одинаковые таблицы. Нашёл на скриншоте для лендинга: панель
  // задач сфотографировалась с удвоенным содержимым.
  //
  // Открытие панели теперь целиком в openPanelById. Обработчик только
  // переключает: всё, что нужно догрузить, уже сделано по дороге.
  installPanelCloseButtons();
  wireWorldMapClose();
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.panel-toggles button')) {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (!panel) return;
      togglePanel(panel);
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
  // Загрузка файлов открыта сотрудникам сайта, а не только тем, у кого
  // выставлен флаг админа: у разработчика роль 'developer' без флага.
  // Роли повторяют серверный SITE_STAFF_ROLES, иначе кнопка была бы видна
  // кому-то, кому сервер всё равно ответит 403.
  const STAFF_ROLES = ['owner', 'administrator', 'admin', 'moderator', 'developer', 'dev', 'gm'];
  const isStaff = session.isAdmin || STAFF_ROLES.includes(session.isAdminRole ?? '');
  $('btn-panel-media')?.classList.toggle('hidden', !isStaff);
  // Панели сотрудников уехали в хаб, и права надо сообщить ему: он решает,
  // показывать их в списке или нет
  setHubStaff(isStaff);
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
  const autobattle = $('set-autobattle') as HTMLInputElement;

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
    if (autobattle) autobattle.checked = s.autobattle;
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
  // Автобой. Переключатель меняет настройку, а настройка запускает и
  // останавливает цикл - одной кнопкой, без двух разных механизмов.
  autobattle?.addEventListener('change', () => {
    updateSettings({ autobattle: autobattle.checked });
    if (autobattle.checked) {
      toast(t('world.autobattle_on'), 'info');
      стартАвтобоя();
    } else {
      остановить(автобой);
      toast(t('world.autobattle_off'), 'info');
    }
  });

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
  // Мёртвый не атакует. Раньше удары улетали на сервер сразу после
  // смерти и применялись к цели сразу после респавна.
  if (isDead()) return;
  // Оглушённый не атакует. Проверка на сервере всё равно есть и она
  // главная; эта нужна, чтобы игрок не ждал ответа на клик, который
  // сервер отвергнет, и не думал, что игра зависла. Текст берётся из
  // словаря, потому что сервер присылает код, а не фразу.
  if (isStunnedNow()) {
    toast(t('debuffs.stunned_hint'), 'error');
    return;
  }
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

/**
 * Защитное действие: блок или уклонение.
 *
 * Раньше их нельзя было вызвать вообще. Серверная механика существовала
 * (2 секунды блока и 1.5 секунды неуязвимости), но клиент отправлял ровно
 * один вид боевого действия — атаку, — поэтому ПКМ двигал только позу
 * персонажа на экране, а на сервере защиты не было. То есть обещанная
 * в плане стойка «Шахский щит» не существовала как механика.
 *
 * Цель для защиты не нужна, поэтому и проверки targetId здесь нет.
 */
function emitDefensive(actionType: 'dodge' | 'block'): void {
  if (!me || isDead()) return;
  socket.emit('combat:action', {
    characterId: me.id,
    actionType,
    position: me.pos,
    direction: world3d?.moveDir ?? { x: 0, y: 0, z: 1 },
    timestamp: Date.now(),
  });
}

/** Блок: ПКМ. Вызывается из мира при нажатии. */
function startBlock(): void {
  if (isDead()) return;
  emitDefensive('block');
}

/**
 * Уклонение: двойное нажатие клавиши направления.
 *
 * Клавиша не выделяется под рывок намеренно: WASD и Shift заняты, отдельную
 * букву игрок всё равно забыл бы. Двойное нажатие - привычный приём в таких
 * играх, и работает в ту же сторону, куда смотрит персонаж.
 */
function startDodge(): void {
  if (isDead()) return;
  emitDefensive('dodge');
}

/**
 * Спросить у сервера настоящую стойку и показать её.
 *
 * Отдельный запрос, а не поле в персонаже: стойка меняется в бою и должна
 * быть верной к первому удару, а не «когда подгрузится панель».
 *
 * Значение молча игнорируется, если оно неизвестно: пустой ответ сервера не
 * должен оставлять панель в состоянии «обычный бой» с враньём на экране.
 */
async function loadStanceFromServer(): Promise<void> {
  if (!session.character) return;
  try {
    const st = await api.characterStance(session.character.id);
    if (st && isStance(st.stance)) setStance(st.stance);
  } catch {
    // Сервер недоступен — игра всё равно начнётся, и стойку уточним при
    // первом переключении: ответ сервера всё равно придёт.
  }
}

// ── Возврат от платёжного провайдера ──────────────────────────
//
// Живёт здесь, а не в панели кошелька, потому что игрок возвращается на
// страницу игры, а не в панель: без этой проверки он просто увидел бы вход
// в игру и не узнал бы, что произошло с деньгами.

/**
 * Проверить платёж, к которому игрока вернул провайдер.
 *
 * Идентификатор берётся из адреса, поэтому проверяется на форму: чужой
 * параметр не должен уводить на запрос к произвольной строке. Запрос
 * отправляется только для своего платежа — сервер всё равно сверяет
 * владельца, но мусор в адресной строке не должен доводить до ошибки.
 */
async function resumePaymentFromUrl(): Promise<void> {
  const id = new URLSearchParams(window.location.search).get('payment');
  if (!id) return;
  // Ровно наш формат идентификатора. Подставленная строка отсеется здесь.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  if (!session.character) return;

  // Параметр убираем сразу: при следующем F5 он не нужен, а всплывал бы
  // снова и снова проверял бы один и тот же платёж.
  window.history.replaceState(null, '', window.location.pathname);

  try {
    const st = await api.paymentStatus(id);
    if (st.status === 'completed') {
      const wallet = await api.wallet(session.character.id);
      session.character.azens = wallet.azens;
      session.character.gold = wallet.gold;
      refreshBars();
      const bonus = st.bonus > 0 ? ` (+${st.bonus})` : '';
      toast(`+${st.azensExpected} AZENS${bonus}`, 'success');
      void loadShop();
      return;
    }
    if (st.status === 'failed') {
      toast(t('wallet.pay_rejected'), 'error');
      void loadShop();
    }
    // pending: провайдер ещё не прислал уведомление, либо платёж не завершён.
    // Молчание здесь честнее сообщения об успехе.
  } catch {
    // Платёж не найден или сеть моргнула. Игрок сам увидит историю платежей
    // в кошельке, поэтому тревожить его сообщением об ошибке неверно.
  }
}

// ── Смена боевой стойки ────────────────────────────────────────
//
// Функции на уровне модуля: их зовёт и подписка на сокет (подтверждение), и
// горячая клавиша в wireInput, а это разные функции.

/**
 * Запрос смены стойки.
 *
 * Скакуна проверяем сами: конная стрельба без коня отклоняется сервером, но
 * ждать ответа ради заведомо известного отказа — значит переключать стойку
 * «вслепую» и показывать неверное состояние.
 */
function requestStance(stance: string): void {
  if (isDead()) return;
  if (!isStance(stance)) return;
  // Признак активного скакуна: скорость больше нуля ровно у верхом
  // (loadActiveMount пишет её в session.mount)
  if (STANCES[stance].requiresMount && (session.mount?.speed ?? 0) <= 0) {
    // Тот же ключ, что и у серверного кода отказа: игрок видит одну и ту же
    // формулировку и на своей стороне, и по ответу сервера. Своего ключа
    // «stance_needs_mount» тут не заведено намеренно.
    toast(t(`world.${COMBAT_ERROR_KEYS.stance_needs_mount.replace('world.', '')}`), 'error');
    return;
  }
  socket.emit('combat:stance', { stance });
}

/**
 * Переключение стойки клавишей R.
 *
 * Отдельная клавиша на стойку не выделяется: стиль переключают часто и на
 * ходу, а свободных букв, которые игрок не забудет, в игре уже нет. Порядок
 * идёт по кругу, а конная стрельба пешком пропускается — иначе каждое второе
 * нажатие упиралось бы в отказ сервера.
 */
function cycleStance(): void {
  if (isDead()) return;
  const order = STANCE_ORDER.filter(s => !STANCES[s].requiresMount || (session.mount?.speed ?? 0) > 0);
  const i = order.indexOf(getStance());
  requestStance(order[(i + 1) % order.length] ?? 'balanced');
}

function basicAttack(): void {
  if (isDead()) return;        // мёртвый не дерётся и не включает боевую тему
  audio.pokeCombat();          // боевая тема на время драки
  emitCombat('attack');
}

// ── Автобой ──────────────────────────────────────────────────
//
// Цикл живёт в autobattle.ts, здесь только запуск и мост к настоящему бою.
// Автобой НЕ обходит emitCombat: он вызывает тот же путь, что и клик, поэтому
// серверные проверки урона, дальности и отката работают без исключений.
const автобой = создатьАвтобой(getSettings().autobattle);
let таймерАвтобоя: (() => void) | null = null;

/** Запустить автобой, если он включён и ещё не идёт. */
function стартАвтобоя(): void {
  if (таймерАвтобоя !== null) return;
  таймерАвтобоя = запустить(
    автобой,
    () => ({
      monsters: world?.monsters ?? new Map(),
      me,
      region: session.character?.region ?? '',
    }),
    () => isDead(),
    () => {
      // Удар: тот же путь, что и клик, плюс боевая тема. Цель выбирается
      // внутри цикла, поэтому сюда она не передаётся - и не может
      // разойтись с той, по которой реально бьёт сервер.
      audio.pokeCombat();
      emitCombat('attack');
    },
    // Такт о PvP-молчании: игрок должен узнать, почему автобой стоит.
    () => toast(t('world.autobattle_pvp_off'), 'info'),
  );
}

/** Остановить цикл и забыть таймер. */
function стопАвтобоя(): void {
  остановить(автобой);
  if (таймерАвтобоя !== null) {
    таймерАвтобоя();
    таймерАвтобоя = null;
  }
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

/**
 * Крестик на полноэкранной карте.
 *
 * ТУТ БЫЛА МЁРТВАЯ КНОПКА. Разметка с кнопкой ✕ была с самого начала,
 * обработчика к ней не подключил никто: карта закрывалась только клавишей
 * M. Игрок жал крестик — ничего не происходило, и карту приходилось
 * закрывать клавишей, о которой на кнопке не написано.
 */
function wireWorldMapClose(): void {
  const close = document.getElementById('worldmap-close');
  if (!close || close.dataset.wired === '1') return;
  close.dataset.wired = '1';
  close.addEventListener('click', () => {
    document.getElementById('overlay-map')?.classList.add('hidden');
  });
}

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
              toast(t('dialogue.quest_done').replace('{name}', q.titleRu).replace('{n}', String(q.experience)).replace('{unit}', t('world.exp')), 'success');
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
  // Мёртвый не шлёт пакеты движения: сервер их всё равно игнорирует,
  // а лишний трафик только мешал бы увидеть, что персонаж стоит.
  if (me.moving && !isDead() && now - lastMoveSent > MOVE_SEND_MS) {
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
  // Скорость скакуна приходит с сервера: она считается по таблице скакунов
  // и уровню в character_mounts, и там же считается предел античита
  world3d?.setMountSpeed(session.mount?.speed ?? 0);
  // Экипировка для аватара: оружие в руке и цвет брони. Пока сервер не
  // ответил (session.gear === null), риг показывает вид класса
  world3d?.setLocalGear(session.gear);
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
