// ============================================================
// HUD: рамки, навыки, чат, панели, тосты — Empire of Safavids
// ============================================================

import { api, ApiError } from './api';
import type { ActiveBuff } from './api';
import { t } from './i18n';
import { icon } from '../ui/icons';
import { session } from './state';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ── Временные бонусы ─────────────────────────────────────────
/**
 * Активные бонусы с обратным отсчётом. Раньше эффекты вроде «+5% к урону
 * на 10 минут» не существовали вовсе; теперь их надо где-то показать,
 * иначе игрок не знает, что ел кебаб и почему бьёт сильнее.
 *
 * Отсчёт идёт на таймере раз в секунду: сервер отдаёт остаток при
 * загрузке, дальше считаем локально, а раз в минуту переспрашиваем —
 * чтобы не расходиться с сервером, если игрок стоял в AFK.
 */
let activeBuffs: ActiveBuff[] = [];
let buffTimer: ReturnType<typeof setInterval> | null = null;

const BUFF_ICON: Record<string, string> = { sword: '⚔️', fist: '✊', boot: '👢', shield: '🛡️', scroll: '📜' };

function fmtBuffTime(sec: number): string {
  if (sec >= 60) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return `${sec}${t('common.seconds_short')}`;
}

function paintBuffs(): void {
  const box = $('buff-bar');
  if (!box) return;
  box.innerHTML = '';
  box.classList.toggle('hidden', activeBuffs.length === 0);
  for (const b of activeBuffs) {
    const chip = document.createElement('div');
    // Под минуту подсвечиваем: игрок должен успеть съесть ещё
    chip.className = 'buff-chip' + (b.remainingSec <= 60 ? ' ending' : '');
    const ico = document.createElement('span');
    ico.className = 'buff-icon';
    ico.textContent = BUFF_ICON[b.icon] ?? '✦';
    const name = document.createElement('span');
    name.className = 'buff-name';
    name.textContent = b.nameRu;
    const time = document.createElement('span');
    time.className = 'buff-time';
    time.textContent = fmtBuffTime(b.remainingSec);
    chip.append(ico, name, time);
    box.append(chip);
  }
}

function tickBuffs(): void {
  if (!activeBuffs.length) return;
  activeBuffs = activeBuffs
    .map(b => ({ ...b, remainingSec: b.remainingSec - 1 }))
    .filter(b => b.remainingSec > 0);
  paintBuffs();
}

export async function loadBuffs(): Promise<void> {
  const cid = session.character?.id;
  if (!cid) return;
  try {
    const data = await api.buffs(cid);
    activeBuffs = data.buffs ?? [];
  } catch {
    activeBuffs = [];
  }
  paintBuffs();
  if (buffTimer) clearInterval(buffTimer);
  buffTimer = setInterval(tickBuffs, 1000);
}

/** Вызвать сразу после использования предмета, чтобы бонус появился не дожидаясь опроса */
export function onBuffGained(buff: ActiveBuff | null | undefined): void {
  if (!buff) return;
  const rest = activeBuffs.filter(b => b.id !== buff.id);
  rest.push({ ...buff });
  activeBuffs = rest;
  paintBuffs();
}

export function clearBuffs(): void {
  activeBuffs = [];
  if (buffTimer) { clearInterval(buffTimer); buffTimer = null; }
  paintBuffs();
}

// ── Тосты ────────────────────────────────────────────────────
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), 4200);
}

// ── Полосы и рамка персонажа ─────────────────────────────────
export function refreshBars(): void {
  const s = session;
  const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%`;
  ($('bar-hp') as HTMLElement).style.width = pct(s.hp, s.maxHp);
  $('txt-hp').textContent = `${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`;
  ($('bar-mana') as HTMLElement).style.width = pct(s.mana, s.maxMana);
  $('txt-mana').textContent = `${Math.ceil(s.mana)} / ${s.maxMana}`;
  ($('bar-stamina') as HTMLElement).style.width = pct(s.stamina, s.maxStamina);
  $('txt-stamina').textContent = `${Math.ceil(s.stamina)} / ${s.maxStamina}`;
  // Краснеет, когда выносливость на исходе (плавание её быстро съедает)
  $('bar-stamina').classList.toggle('low', s.stamina < s.maxStamina * 0.2);
  ($('bar-exp') as HTMLElement).style.width = pct(s.experience, s.level * s.level * 100);
  $('txt-exp').textContent = `${s.experience} / ${s.level * s.level * 100}`;
  $('hud-name').textContent = s.character?.name ?? '';
  $('hud-level').textContent = `${t('badges.level')} ${s.level}`;
  $('hud-gold').textContent = `◉ ${s.character?.gold ?? 0}`;
  const regionName = t(REGION_NAMES[s.character?.region ?? ''] ?? s.character?.region ?? '');
  const zoneName = s.character?.zone ? t(ZONE_NAMES[s.character.zone] ?? s.character.zone) : '';
  $('hud-region').textContent = zoneName ? `${regionName} — ${zoneName}` : regionName;
  const azEl = document.getElementById('hud-azens');
  if (azEl) azEl.textContent = `AZENS ${s.character?.azens ?? 0}`;
}

const REGION_NAMES: Record<string, string> = {
  tabriz: 'regions.tabriz', isfahan: 'regions.isfahan', shiraz: 'regions.shiraz', caucasus: 'regions.caucasus',
  mesopotamia: 'regions.mesopotamia', khorasan: 'regions.khorasan', persian_gulf: 'regions.persian_gulf',
};

const ZONE_NAMES: Record<string, string> = {
  tabriz_center: 'zones.tabriz_center', tabriz_outskirts: 'zones.tabriz_outskirts', tabriz_north: 'zones.tabriz_north',
  isfahan_bazaar: 'zones.isfahan_bazaar', isfahan_gates: 'zones.isfahan_gates', isfahan_south: 'zones.isfahan_south',
  shiraz_gardens: 'zones.shiraz_gardens', shiraz_walls: 'zones.shiraz_walls', shiraz_east: 'zones.shiraz_east',
  caucasus_pass: 'zones.caucasus_pass', caucasus_fortress: 'zones.caucasus_fortress', caucasus_peaks: 'zones.caucasus_peaks',
  mesopotamia_river: 'zones.mesopotamia_river', mesopotamia_ruins: 'zones.mesopotamia_ruins', mesopotamia_frontier: 'zones.mesopotamia_frontier',
  khorasan_oasis: 'zones.khorasan_oasis', khorasan_caravanserai: 'zones.khorasan_caravanserai', khorasan_east: 'zones.khorasan_east',
  persian_gulf_harbor: 'zones.persian_gulf_harbor', persian_gulf_waters: 'zones.persian_gulf_waters', persian_gulf_islands: 'zones.persian_gulf_islands',
};

// ── Рамка цели ───────────────────────────────────────────────
export function showTarget(name: string, hp: number, maxHp: number): void {
  $('target-frame').classList.remove('hidden');
  $('target-name').textContent = name;
  ($('target-hp') as HTMLElement).style.width = `${Math.max(0, (hp / Math.max(1, maxHp)) * 100)}%`;
  $('target-hp-txt').textContent = `${Math.max(0, Math.ceil(hp))} / ${maxHp}`;
}

export function hideTarget(): void {
  $('target-frame').classList.add('hidden');
}

// ── Панель навыков (клавиши 1–4) ─────────────────────────────
const cooldowns = new Map<string, number>(); // skillId -> момент готовности

export async function loadSkillbar(): Promise<void> {
  if (!session.character) return;
  try {
    const { skills } = await api.skills(session.character.id);
    session.skills = skills;
  } catch {
    session.skills = [];
  }
  const bar = $('skillbar');
  bar.innerHTML = '';
  session.skills.forEach((skill, i) => {
    const slot = document.createElement('div');
    slot.className = 'skill';
    slot.id = `skill-${skill.id}`;
    slot.title = `${skill.nameRu} — ${t('world.mana')} ${skill.manaCost} / ${t('world.stamina')} ${skill.staminaCost}`;
    const isHeal = skill.damageMultiplier < 0;
    slot.innerHTML =
      `<span class="key">${i + 1}</span>` +
      icon(isHeal ? 'heart' : skill.aoe ? 'bolt' : 'sword', 26) +
      `<span class="cost">${skill.manaCost || skill.staminaCost}</span>` +
      '<span class="cd"></span>';
    slot.addEventListener('click', () => window.dispatchEvent(new CustomEvent('game:skill', { detail: skill.id })));
    bar.append(slot);
  });
}

export function startCooldown(skillId: string, seconds: number): void {
  cooldowns.set(skillId, performance.now() + seconds * 1000);
}

export function tickCooldowns(): void {
  const now = performance.now();
  for (const [id, readyAt] of cooldowns) {
    const el = document.getElementById(`skill-${id}`);
    if (!el) { cooldowns.delete(id); continue; }
    const cd = el.querySelector<HTMLElement>('.cd')!;
    const remain = readyAt - now;
    if (remain <= 0) {
      cd.style.transform = 'scaleY(0)';
      el.classList.remove('on-cd');
      cooldowns.delete(id);
    } else {
      const duration = skillCooldownSeconds(id) * 1000;
      cd.style.transform = `scaleY(${Math.min(1, remain / duration)})`;
      el.classList.add('on-cd');
    }
  }
}

function skillCooldownSeconds(id: string): number {
  return session.skills.find((s) => s.id === id)?.cooldown ?? 3;
}

// ── Чат ──────────────────────────────────────────────────────
export function chatMessage(name: string | null, text: string, system = false, role: 'owner' | 'admin' | 'moderator' | null = null): void {
  const log = $('chat-log');
  const msg = document.createElement('div');
  msg.className = 'msg' + (system ? ' sys' : '');
  if (role) {
    const badge = document.createElement('span');
    badge.className = `chat-role role-${role}`;
    badge.textContent = role === 'owner' ? 'OWNER' : role === 'admin' ? 'ADMIN' : 'MOD';
    msg.append(badge);
    msg.append(' ');
  }
  if (name) {
    const b = document.createElement('b');
    b.textContent = `${name}: `;
    msg.append(b);
  }
  msg.append(text);
  log.append(msg);
  while (log.children.length > 80) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

export function chatVisible(): boolean {
  // Режим печати = фокус в поле ввода (форма чата всегда видима в HUD,
  // поэтому проверять hidden-класс нельзя — движение блокировалось навсегда).
  return document.activeElement === document.getElementById('chat-text');
}

export function openChat(): HTMLInputElement {
  const form = $('chat-form');
  form.classList.remove('hidden');
  const input = $('chat-text') as HTMLInputElement;
  input.focus();
  return input;
}

export function closeChat(): void {
  // Форму не прячем (она часть HUD) — просто убираем фокус, чтобы WASD снова работали.
  ($('chat-text') as HTMLInputElement).blur();
}

// ── Панели регионов и квестов ────────────────────────────────
export async function loadRegions(): Promise<void> {
  try {
    const { regions } = await api.regions();
    const box = $('regions-list');
    box.innerHTML = '';
    for (const r of regions) {
      const locked = (session.level ?? 0) < r.minLevel;
      const here = r.id === session.character?.region;
      const row = document.createElement('div');
      row.className = 'region-row' + (here ? ' current' : '') + (locked ? ' locked' : '');
      row.innerHTML =
        `<div class="rname"><b>${r.nameRu}</b><span class="ronline">${r.onlinePlayers} ${t('world.online')}</span></div>` +
        `<div class="rdesc">${locked ? '🔒 ' : ''}${r.description}</div>` +
        `<div class="rdesc">${t('badges.level')} ${r.minLevel}+</div>`;
      if (!here) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'region-travel';
        btn.dataset.region = r.id;
        btn.disabled = locked;
        btn.textContent = t('world.travel');
        row.append(btn);
      }
      box.append(row);
    }

    // Путешествие: смена региона персонажа на сервере
    box.querySelectorAll<HTMLButtonElement>('button.region-travel').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!session.character) return;
        btn.disabled = true;
        try {
          const { character } = await api.travel(session.character.id, btn.dataset.region!);
          session.character.region = character.region;
          toast(t('world.travel_done'), 'success');
        } catch (err) {
          const code = (err as { code?: string }).code;
          toast(code ? t(`errors.${code}`) : (err as Error).message, 'error');
        }
        void loadRegions();
        void loadQuests();
      });
    });
  } catch {
    /* регионы недоступны — не критично */
  }
}

/** Русские названия типов квестов (в данных — англ. идентификаторы) */
const QUEST_TYPE_RU: Record<string, string> = {
  main: 'quest_type.main', side: 'quest_type.side', daily: 'quest_type.daily',
  class: 'quest_type.class', world: 'quest_type.world',
};

export async function loadQuests(): Promise<void> {
  try {
    const { quests } = await api.quests();
    const box = $('quests-list');
    box.innerHTML = '';
    const level = session.level ?? 1;
    const region = session.character?.region;

    // Прогресс с сервера — источник истины для принятых квестов
    if (session.character) {
      try {
        const { quests: state } = await api.questState(session.character.id);
        session.questState = Object.fromEntries(state.map((s) => [s.questId, s]));
      } catch {
        /* прогресс недоступен — показываем локальный */
      }
    }

    const available = quests.filter(
      (q) => q.minLevel <= level + 10 && (!q.requiredRegion || q.requiredRegion === region),
    );
    const list = available.slice(0, 8);
    if (!list.length) {
      box.innerHTML = `<div class="quest-card"><b>${t('common.loading')}</b></div>`;
      return;
    }
    for (const q of list) {
      const card = document.createElement('div');
      card.className = 'quest-card';
      const title = (session as unknown as { lang?: string }).lang === 'en' ? q.title : q.titleRu;
      const st = session.questState[q.id];
      const status: 'active' | 'completed' | undefined = st?.status as 'active' | 'completed' | undefined;

      const objectives = q.objectives
        .map((o) => {
          // Принятый квест — счётчик сервера; ещё не принятый — локальный превью-счётчик
          const have = status ? (st?.progress[o.id] ?? 0) : (session.kills[o.target] ?? 0);
          const done = status === 'completed' || (o.type === 'kill' && have >= o.required);
          return o.type === 'kill'
            ? `<div class="qobj ${done ? 'done' : ''}">✦ ${o.description}: ${Math.min(have, o.required)}/${o.required}</div>`
            : `<div class="qobj ${done ? 'done' : ''}">✦ ${o.description}</div>`;
        })
        .join('');

      let statusLine = '';
      if (status === 'completed') statusLine = `<div class="qstatus done">✓ ${t('world.completed')}</div>`;
      else if (status === 'active') statusLine = `<div class="qstatus">${t('world.in_progress')}</div>`;

      card.innerHTML =
        `<div class="qtype">${t(QUEST_TYPE_RU[q.type] ?? q.type)} · ${t('badges.level')} ${q.minLevel}+</div>` +
        `<b>${title}</b>` +
        `<div class="qdesc">${q.description}</div>` +
        objectives +
        `<div class="qreward">✦ ${q.rewards.experience} ${t('world.exp')} · ◉ ${q.rewards.gold}</div>` +
        statusLine;

      if (!status && session.character) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quest-accept';
        btn.dataset.quest = q.id;
        btn.textContent = t('world.accept');
        card.append(btn);
      }
      box.append(card);
    }

    // Принятие квестов (делегирование, т.к. список перерисовывается)
    box.querySelectorAll<HTMLButtonElement>('button.quest-accept').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!session.character) return;
        btn.disabled = true;
        try {
          await api.acceptQuest(session.character.id, btn.dataset.quest!);
          toast(t('world.quest_accepted'), 'success');
        } catch (err) {
          const code = (err as { code?: string }).code;
          toast(code ? t(`errors.${code}`) : (err as Error).message, 'error');
        }
        void loadQuests();
      });
    });
  } catch {
    /* квесты недоступны */
  }
}

// ── Сумка (инвентарь) ────────────────────────────────────────
const RARITY_COLOR: Record<string, string> = {
  common: '#b8bcc4', uncommon: '#6ecf7a', rare: '#4aa3e8',
  epic: '#b06ae8', legendary: '#e8a84a', artifact: '#e85a4a',
};

const EQUIPPABLE_TYPES = new Set(['weapon', 'armor', 'accessory']);
const SLOT_KEYS: Record<string, string> = {
  weapon: 'world.slot_weapon', armor: 'world.slot_armor', accessory: 'world.slot_accessory',
};

function invBtn(label: string, onClick: () => Promise<void>): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'inv-action';
  b.textContent = label;
  b.addEventListener('click', async () => {
    try {
      await onClick();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });
  return b;
}

export function renderEquipment(equipment: {
  items: { slot: string; nameRu: string; rarity: string; enhancement: number }[];
  stats: Record<string, number>;
}): void {
  // Сначала 3D-аватар, потом панель. Раньше вид персонажа вообще не зависел
  // от надетого: оружие и щит выводились из класса, так что смена доспеха
  // была видна только в панели. Именно сюда приходит экипировка и при
  // надевании, и при снятии, и при открытии инвентаря.
  const equipped = new Map(equipment.items.map(i => [i.slot, i]));
  const armor = equipped.get('armor');
  session.gear = {
    weapon: equipped.has('weapon'),
    // Цвет груди — по редкости доспеха: замена брони должна быть видна
    armorColor: armor ? parseInt((RARITY_COLOR[armor.rarity] ?? RARITY_COLOR.common).slice(1), 16) : null,
  };

  const box = $('equipment-summary');
  if (!box) return;
  box.innerHTML = '';
  const bySlot = new Map(equipment.items.map(i => [i.slot, i]));
  for (const slot of ['weapon', 'armor', 'accessory']) {
    const rowEl = document.createElement('div');
    rowEl.className = 'equip-row';
    const label = document.createElement('span');
    label.className = 'equip-slot';
    label.textContent = t(SLOT_KEYS[slot]);
    rowEl.append(label);
    const value = document.createElement('span');
    value.className = 'equip-value';
    const item = bySlot.get(slot);
    if (item) {
      value.textContent = item.enhancement > 0 ? `${item.nameRu} +${item.enhancement}` : item.nameRu;
      value.style.color = RARITY_COLOR[item.rarity] ?? RARITY_COLOR.common;
      rowEl.append(invBtn(t('world.unequip'), async () => {
        renderEquipment(await api.unequip(session.character!.id, slot));
        await loadInventory();
      }));
    } else {
      value.textContent = '—';
    }
    rowEl.append(value);
    box.append(rowEl);
  }
  const total = Object.values(equipment.stats).reduce((sum, v) => sum + v, 0);
  if (total > 0) {
    const hint = document.createElement('div');
    hint.className = 'equip-bonus';
    hint.textContent = `+${total} · ${t('world.stat_bonus')}`;
    box.append(hint);
  }
}

export async function loadInventory(): Promise<void> {
  if (!session.character) return;
  const cid = session.character.id;
  try {
    const [{ items }, equipment] = await Promise.all([
      api.inventory(cid),
      api.equipment(cid),
    ]);
    renderEquipment(equipment);
    // Бонусы «для воды» из надетого: сапоги/плащ снимают замедление в воде
    // и экономят выносливость при плавании
    session.waterBonus = {
      waterSpeed: equipment.bonuses?.waterSpeed ?? 0,
      swimStamina: equipment.bonuses?.swimStamina ?? 0,
    };
    const box = $('inventory-list');
    if (!box) return;
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = `<div class="inv-empty">—</div>`;
      return;
    }
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'inv-item';
      const label = it.enhancement > 0 ? `${it.nameRu} +${it.enhancement}` : it.nameRu;
      row.innerHTML =
        `<span class="dot" style="background:${RARITY_COLOR[it.rarity] ?? RARITY_COLOR.common}"></span>` +
        `<span class="inv-name">${label}</span><span class="inv-qty">×${it.quantity}</span>`;
      const actions = document.createElement('span');
      actions.className = 'inv-actions';
      if (EQUIPPABLE_TYPES.has(it.type)) {
        actions.append(invBtn(t('world.equip'), async () => {
          renderEquipment(await api.equip(cid, it.itemId));
          toast(t('world.equipped'), 'success');
          await loadInventory();
        }));
        actions.append(invBtn(t('world.enhance'), async () => {
          const out = await api.enhance(cid, it.itemId);
          const kind = out.result === 'success' ? 'success' : out.result === 'fail' ? 'info' : 'error';
          toast(out.messageRu || out.message, kind);
          await loadInventory();
        }));
      } else if (it.type === 'consumable') {
        actions.append(invBtn(t('world.use'), async () => {
          const res = await api.useItem(cid, it.itemId);
          session.hp = res.resources.hp; session.maxHp = res.resources.maxHp;
          session.mana = res.resources.mana; session.maxMana = res.resources.maxMana;
          session.stamina = res.resources.stamina; session.maxStamina = res.resources.maxStamina;
          refreshBars();
          // Предмет может дать временный бонус — показываем сразу, а не
          // после следующего опроса, иначе игрок решит, что эффекта нет
          const buff = res.resources.buff;
          if (buff) {
            onBuffGained(buff);
            toast(`${t('world.buff_gained')} ${buff.nameRu} · ${fmtBuffTime(buff.remainingSec)}`, 'success');
          } else {
            toast(t('world.item_used'), 'success');
          }
          await loadInventory();
        }));
      }
      // Продать предмет в ближайший магазин (45% от цены)
      actions.append(invBtn(t('world.sell'), async () => {
        const shopId = nearestShopId();
        if (!shopId) throw new Error(t('shop.no_shop_near'));
        const res = await api.shopSell(shopId, cid, it.itemId, it.quantity);
        if (session.character) session.character.gold = res.gold;
        refreshBars();
        toast(`${t('world.sold')} · +${res.goldGained} ${t('world.gold')}`, 'success');
        await loadInventory();
      }));
      row.append(actions);
      box.append(row);
    }
  } catch {
    /* инвентарь недоступен — не критично */
  }
}

// Ближайший магазин к текущей позиции персонажа.
// Возвращает id магазина (shop_isfahan_bazaar, shop_tabriz_general и т.д.)
const SHOP_LOCATIONS: { id: string; x: number; z: number }[] = [
  { id: 'shop_isfahan_bazaar', x: 15, z: 2 },     // Джафар у аркады
  { id: 'shop_tabriz_general', x: -350, z: -575 }, // у истоков реки А
  { id: 'shop_khorasan_rare', x: 505, z: 55 },     // караван-сарай
];
export function nearestShopId(): string | null {
  if (!session.character || !session.character.position) return null;
  const cx = session.character.position.x ?? 0;
  const cz = session.character.position.z ?? 0;
  let best: { id: string; dist: number } | null = null;
  for (const s of SHOP_LOCATIONS) {
    const d = Math.hypot(s.x - cx, s.z - cz);
    if (!best || d < best.dist) best = { id: s.id, dist: d };
  }
  return best && best.dist < 300 ? best.id : null;
}

// ── Мини-карта ───────────────────────────────────────────────
import {
  CITY, CAMP, PORT, CARAVANSERAI, VILLAGE, FORT, LAKE, POND, WORLD_HALF,
  biomeAt, isRoad, terrainHeight,
} from './game3d/terrain';

const MINIMAP_RANGE = 180;   // мировых единиц по горизонтали от игрока
const TERRAIN_PAD = 24;      // запас слоя террейна (мировые единицы)
const TERRAIN_SNAP = 16;     // шаг привязки слоя к сетке мира

const MINIMAP_SETTLEMENTS: { x: number; z: number; id: string; nameKey: string; icon: string; r: number }[] = [
  { x: CITY.x, z: CITY.z, id: 'isfahan', nameKey: 'places.isfahan', icon: '🏰', r: CITY.radius },
  { x: CAMP.x, z: CAMP.z, id: 'camp', nameKey: 'places.camp', icon: '⛺', r: 30 },
  { x: PORT.x, z: PORT.z, id: 'port', nameKey: 'places.port', icon: '⚓', r: 30 },
  { x: CARAVANSERAI.x, z: CARAVANSERAI.z, id: 'caravanserai', nameKey: 'places.caravanserai', icon: '🐫', r: 30 },
  { x: VILLAGE.x, z: VILLAGE.z, id: 'village', nameKey: 'places.village', icon: '🏡', r: 30 },
  { x: FORT.x, z: FORT.z, id: 'fort', nameKey: 'places.fort', icon: '🏔', r: 30 },
];

let lastMinimapRegion = '';

// ── Кэш слоя террейна: биомы рисуются один раз на «клетку» мира ──
// Пересчитывать биомы (fbm-шум) на каждый кадр мини-карты дорого,
// поэтому слой собирается только когда игрок сместился на TERRAIN_SNAP.
let terrainLayer: HTMLCanvasElement | null = null;
let terrainOrigin = { x: 0, z: 0 };
let terrainExtent = 0;   // мировых единиц на сторону слоя
let terrainSizePx = 0;

const BIOME_COLORS: Record<string, [number, number, number]> = {
  water: [26, 82, 128],
  desert: [201, 168, 106],
  forest: [58, 102, 56],
  mountain: [122, 112, 100],
  field: [108, 138, 72],
};
const ROAD_COLOR: [number, number, number] = [138, 122, 90];

function buildTerrainLayer(cx: number, cz: number, sizePx: number): HTMLCanvasElement {
  const snap = (v: number): number => Math.round(v / TERRAIN_SNAP) * TERRAIN_SNAP;
  const extent = MINIMAP_RANGE * 2 + TERRAIN_PAD * 2;
  const ox = snap(cx) - MINIMAP_RANGE - TERRAIN_PAD;
  const oz = snap(cz) - MINIMAP_RANGE - TERRAIN_PAD;

  const cvs = document.createElement('canvas');
  cvs.width = sizePx; cvs.height = sizePx;
  const c = cvs.getContext('2d');
  if (!c) return cvs;

  const img = c.createImageData(sizePx, sizePx);
  const data = img.data;
  // Шаг выборки 2 пикселя: 90² ≈ 8k вызовов шума на пересборку — приемлемо
  const step = 2;
  const cell = extent / sizePx;
  for (let py = 0; py < sizePx; py += step) {
    for (let px = 0; px < sizePx; px += step) {
      const wx = ox + (px + 0.5) * cell;
      const wz = oz + (py + 0.5) * cell;
      let col: [number, number, number];
      const biome = biomeAt(wx, wz);
      if (isRoad(wx, wz) && biome !== 'water') {
        col = ROAD_COLOR;
      } else {
        col = BIOME_COLORS[biome] ?? BIOME_COLORS.field;
        // Лёгкая высотная подсветка: горы и возвышенности читаются объёмно
        if (biome === 'mountain' || biome === 'field' || biome === 'desert') {
          const h = terrainHeight(wx, wz);
          const k = Math.max(0.82, Math.min(1.22, 1 + h / 160));
          col = [col[0] * k, col[1] * k, col[2] * k];
        }
      }
      for (let dy = 0; dy < step && py + dy < sizePx; dy++) {
        for (let dx = 0; dx < step && px + dx < sizePx; dx++) {
          const i = ((py + dy) * sizePx + (px + dx)) * 4;
          data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = 255;
        }
      }
    }
  }
  c.putImageData(img, 0, 0);

  // Вода: озёра и пруд поверх биомов (маска воды грубее реальной формы)
  const toLayer = (wx: number, wz: number) => ({
    x: ((wx - ox) / extent) * sizePx,
    y: ((wz - oz) / extent) * sizePx,
    r: (r: number) => (r / extent) * sizePx,
  });
  for (const body of [LAKE, POND]) {
    const p = toLayer(body.x, body.z);
    c.fillStyle = 'rgba(24, 74, 116, 0.85)';
    c.beginPath();
    c.arc(p.x, p.y, p.r(body.r), 0, Math.PI * 2);
    c.fill();
  }

  // Поселения: контуры стен/заборов
  c.strokeStyle = 'rgba(201, 168, 76, 0.75)';
  c.lineWidth = Math.max(1.5, sizePx / 90);
  for (const s of MINIMAP_SETTLEMENTS) {
    const p = toLayer(s.x, s.z);
    const r = p.r(s.id === 'isfahan' ? CITY.radius : 22);
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = 'rgba(176, 148, 104, 0.28)';
    c.fill();
  }

  terrainLayer = cvs;
  terrainOrigin = { x: ox, z: oz };
  terrainExtent = extent;
  terrainSizePx = sizePx;
  return cvs;
}

export function updateMinimap(
  me: { x: number; z: number },
  monsters: { x: number; z: number }[],
  npcs?: { x: number; z: number; nameRu: string }[],
  route?: { x: number; z: number }[],
): string {
  const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
  if (!canvas) return lastMinimapRegion;
  const ctx = canvas.getContext('2d');
  if (!ctx) return lastMinimapRegion;

  const size = canvas.width;
  const scale = size / (MINIMAP_RANGE * 2);
  const toPx = (wx: number, wz: number) => ({
    x: size / 2 + (wx - me.x) * scale,
    y: size / 2 + (wz - me.z) * scale,
  });

  // Фон — разноцветный слой биомов (кэш пересобирается при смещении)
  ctx.clearRect(0, 0, size, size);
  const needLayer =
    !terrainLayer || terrainSizePx !== size ||
    Math.abs(me.x - (terrainOrigin.x + MINIMAP_RANGE + TERRAIN_PAD)) > TERRAIN_SNAP * 0.6 ||
    Math.abs(me.z - (terrainOrigin.z + MINIMAP_RANGE + TERRAIN_PAD)) > TERRAIN_SNAP * 0.6;
  if (needLayer) buildTerrainLayer(me.x, me.z, size);
  if (terrainLayer) {
    const ls = terrainSizePx / terrainExtent;   // px слоя на мировую единицу
    const sw = size * (ls / scale);             // размер выборки в px слоя
    // Игрок — точно в центр мини-карты: выборка центрируется на его позиции
    const sx = (me.x - terrainOrigin.x) * ls - sw / 2;
    const sy = (me.z - terrainOrigin.z) * ls - sw / 2;
    ctx.drawImage(terrainLayer, sx, sy, sw, sw, 0, 0, size, size);
  } else {
    // ТУТ БЫЛА ПРОСТЬ ЗАЛИВКА ТЁМНО-СИНИМ. Это запасной путь на случай, когда
    // слой рельефа не построился, и он выглядел как «миникарта сломалась»:
    // пустая тёмная сетка с точкой игрока и больше ничем. На снимке игрок
    // снял именно это и решил, что карта не работает.
    //
    // Теперь вместо пустоты рисуется тон сетки и подпись: видно, что это
    // запасной вариант, а не молча сломанная карта.
    ctx.fillStyle = '#12233d';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(201,168,76,0.18)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= size; g += size / 6) {
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(size, g); ctx.stroke();
    }
  }

  // Сетка
  ctx.strokeStyle = 'rgba(20, 16, 8, 0.22)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (size / 4) * i;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }

  // Маршрут квеста (пунктир поверх биомов)
  if (route && route.length > 1) {
    ctx.strokeStyle = 'rgba(255, 217, 128, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    route.forEach((p, i) => {
      const { x, y } = toPx(p.x, p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    // Флажок конечной точки
    const end = toPx(route[route.length - 1].x, route[route.length - 1].z);
    if (end.x > 3 && end.y > 3 && end.x < size - 3 && end.y < size - 3) {
      ctx.fillStyle = '#ffd980';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Поселения (значок + подпись)
  let currentRegion = '';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const s of MINIMAP_SETTLEMENTS) {
    const { x, y } = toPx(s.x, s.z);
    if (x < -20 || y < -20 || x > size + 20 || y > size + 20) continue;
    // Значок
    ctx.font = '11px sans-serif';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.strokeText(s.icon, x, y + 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s.icon, x, y + 4);
    // Подпись: белый текст с тёмной обводкой — читается на любом биоме
    ctx.font = 'bold 9px sans-serif';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(t(s.nameKey), x, y - 7);
    ctx.fillStyle = '#ffe9b8';
    ctx.fillText(t(s.nameKey), x, y - 7);
    // Определяем текущий регион
    if (Math.hypot(me.x - s.x, me.z - s.z) < s.r) {
      currentRegion = t(s.nameKey);
    }
  }
  ctx.textAlign = 'left';

  const dot = (x: number, y: number, fill: string, r: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  // NPC (зелёные точки)
  if (npcs) {
    for (const npc of npcs) {
      const { x, y } = toPx(npc.x, npc.z);
      if (x < 2 || y < 2 || x > size - 2 || y > size - 2) continue;
      dot(x, y, '#43e06a', 2.6);
    }
  }

  // Монстры (красные точки)
  for (const m of monsters) {
    const { x, y } = toPx(m.x, m.z);
    if (x < 2 || y < 2 || x > size - 2 || y > size - 2) continue;
    dot(x, y, '#ff4f3d', 2.6);
  }

  // Игрок в центре (стрелка-треугольник)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1a1208';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(size / 2, size / 2 - 6);
  ctx.lineTo(size / 2 - 4.5, size / 2 + 4);
  ctx.lineTo(size / 2 + 4.5, size / 2 + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Рамка
  ctx.strokeStyle = 'rgba(201, 168, 76, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, size - 1.5, size - 1.5);

  if (currentRegion && currentRegion !== lastMinimapRegion) {
    lastMinimapRegion = currentRegion;
  }
  return currentRegion;
}

// ── Карта мира (M): весь мир целиком ─────────────────────────
let worldmapLayer: HTMLCanvasElement | null = null;
let worldmapLayerW = 0;

export function drawWorldMap(
  me: { x: number; z: number },
  monsters: { x: number; z: number }[],
  npcs?: { x: number; z: number }[],
  route?: { x: number; z: number }[],
): void {
  const canvas = document.getElementById('worldmap-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const scale = Math.min(W, H) / (WORLD_HALF * 2);
  const toPx = (wx: number, wz: number) => ({ x: W / 2 + wx * scale, y: H / 2 + wz * scale });

  // Статичный слой террейна строится один раз (дорого — полный проход по биомам)
  if (!worldmapLayer || worldmapLayerW !== W) {
    const step = 3;
    const layer = document.createElement('canvas');
    layer.width = W; layer.height = H;
    const c = layer.getContext('2d')!;
    const img = c.createImageData(W, H);
    for (let py = 0; py < H; py += step) {
      for (let px = 0; px < W; px += step) {
        const wx = (px - W / 2) / scale, wz = (py - H / 2) / scale;
        let col: [number, number, number];
        if (Math.abs(wx) > WORLD_HALF || Math.abs(wz) > WORLD_HALF) {
          col = [10, 22, 40];
        } else {
          const biome = biomeAt(wx, wz);
          const base = BIOME_COLORS[biome] ?? BIOME_COLORS.field;
          col = [base[0], base[1], base[2]];
        }
        for (let dy = 0; dy < step && py + dy < H; dy++) {
          for (let dx = 0; dx < step && px + dx < W; dx++) {
            const i = ((py + dy) * W + (px + dx)) * 4;
            img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
          }
        }
      }
    }
    c.putImageData(img, 0, 0);
    // Вода и контуры поселений — тоже статика
    for (const body of [LAKE, POND]) {
      const p = toPx(body.x, body.z);
      c.fillStyle = 'rgba(24, 74, 116, 0.9)';
      c.beginPath();
      c.arc(p.x, p.y, Math.max(2, body.r * scale), 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = 'rgba(201, 168, 76, 0.8)';
    c.lineWidth = 1.5;
    for (const s of MINIMAP_SETTLEMENTS) {
      const p = toPx(s.x, s.z);
      const r = Math.max(3, (s.id === 'isfahan' ? CITY.radius : 22) * scale);
      c.beginPath();
      c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.stroke();
    }
    worldmapLayer = layer;
    worldmapLayerW = W;
  }
  ctx.drawImage(worldmapLayer, 0, 0);

  // Сетка
  ctx.strokeStyle = 'rgba(20, 16, 8, 0.3)';
  ctx.lineWidth = 1;
  for (let gx = -WORLD_HALF; gx <= WORLD_HALF; gx += 400) {
    const p1 = toPx(gx, -WORLD_HALF), p2 = toPx(gx, WORLD_HALF);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    const q1 = toPx(-WORLD_HALF, gx), q2 = toPx(WORLD_HALF, gx);
    ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
  }

  // Маршрут квеста
  if (route && route.length > 1) {
    ctx.strokeStyle = 'rgba(255, 217, 128, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    route.forEach((p, i) => {
      const { x, y } = toPx(p.x, p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    const end = toPx(route[route.length - 1].x, route[route.length - 1].z);
    ctx.fillStyle = '#ffd980';
    ctx.beginPath();
    ctx.arc(end.x, end.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Поселения: значок + подпись
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const s of MINIMAP_SETTLEMENTS) {
    const { x, y } = toPx(s.x, s.z);
    ctx.font = '16px sans-serif';
    ctx.fillText(s.icon, x, y + 6);
    ctx.font = 'bold 12px sans-serif';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 3;
    ctx.strokeText(t(s.nameKey), x, y - 12);
    ctx.fillStyle = '#ffe9b8';
    ctx.fillText(t(s.nameKey), x, y - 12);
  }
  ctx.textAlign = 'left';

  const dot = (x: number, y: number, fill: string, r: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  if (npcs) {
    for (const n of npcs) {
      const { x, y } = toPx(n.x, n.z);
      dot(x, y, '#43e06a', 3);
    }
  }
  for (const m of monsters) {
    const { x, y } = toPx(m.x, m.z);
    dot(x, y, '#ff4f3d', 3);
  }

  // Игрок — белый треугольник
  const p = toPx(me.x, me.z);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1a1208';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 9);
  ctx.lineTo(p.x - 7, p.y + 6);
  ctx.lineTo(p.x + 7, p.y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Рамка
  ctx.strokeStyle = 'rgba(201, 168, 76, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
}

// ── Мировое время ────────────────────────────────────────────
// ТУТ БЫЛО ЗАШИТО ПО-РУССКИ. Время суток и погода были словарём с русскими
// словами прямо в коде: 'утро', 'облачно' и так далее. Итог — игрок, выбравший
// английский или азербайджанский язык, видел в углу экрана «ночь · облачно».
// Это видно сразу и сразу бьёт по впечатлению: на сайте написано «три языка»,
// а половина интерфейса остаётся русской. Переводы лежат в worldclock.
const WORLD_CLOCK = new Set([
  'morning', 'noon', 'afternoon', 'evening', 'dusk', 'night', 'midnight', 'dawn',
  'clear', 'cloudy', 'rain', 'storm', 'fog', 'sandstorm', 'snow', 'wind',
]);

export function setWorldTime(payload: Record<string, unknown>): void {
  const el = $('world-time');
  const rawTod = String(payload.timeOfDay ?? payload.time ?? '');
  const rawWeather = String(payload.weather ?? '');
  // Неизвестный код пропускаем молча, иначе игрок увидит на экране
  // «worldclock.morning» — t() отдаёт путь, если ключа нет.
  const tod = WORLD_CLOCK.has(rawTod) ? t(`worldclock.${rawTod}`) : '';
  const weather = WORLD_CLOCK.has(rawWeather) ? t(`worldclock.${rawWeather}`) : '';
  const parts = [tod, weather].filter(Boolean);
  el.textContent = parts.join(' · ');
  el.classList.toggle('top-only', $('target-frame').classList.contains('hidden'));
  // Всю погоду теперь рисует 3D-движок (game3d/weather.ts + sky.ts).
  // Здесь раньше был отдельный слой «дождь на мини-карте» — он не работал
  // никогда: ему передавали русскую подпись, а он ждал английский код.
  // А его молния была бесконечным рекурсивным таймером, который мигал бы
  // экраном каждые 0.1 с до бесконечности. Слой удалён.
}

// ============================================================
// Гостевой аккаунт — предложение сохранить прогресс
// ============================================================
// Гость вошёл без регистрации: его персонаж и весь прогресс лежат
// только в этом браузере. Если игрок очистит кэш или зайдёт с другого
// устройства — всё пропадёт. Поэтому предлагаем сохранить аккаунт:
// почта и пароль, user_id не меняется, прогресс остаётся.

/** Показать кнопку «сохранить аккаунт» (только для гостя) */
export function showGuestBanner(): void {
  const el = $('guest-banner');
  if (!el) return;
  el.classList.remove('hidden');
}

/** Спрятать кнопку — аккаунт уже сохранён */
export function hideGuestBanner(): void {
  $('guest-banner')?.classList.add('hidden');
}

/** Диалог сохранения аккаунта. Возвращает true, если аккаунт сохранён. */
export async function promptClaimAccount(): Promise<boolean> {
  const emailEl = $('claim-email') as HTMLInputElement;
  const passEl = $('claim-password') as HTMLInputElement;
  const errEl = $('claim-error');
  const form = $('form-claim') as HTMLFormElement;
  const screen = $('screen-claim');
  if (!form) return false;

  emailEl.value = '';
  passEl.value = '';
  errEl.textContent = '';
  errEl.classList.add('hidden');
  screen.classList.remove('hidden');

  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean): void => {
      screen.classList.add('hidden');
      form.onsubmit = null;
      $('btn-claim-cancel').onclick = null;
      resolve(ok);
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = emailEl.value.trim();
      const password = passEl.value;
      if (password.length < 8) {
        errEl.textContent = t('auth.password_hint');
        errEl.classList.remove('hidden');
        return;
      }
      try {
        await api.claimAccount(email, password);
        session.isGuest = false;
        localStorage.removeItem('eos_guest');
        hideGuestBanner();
        toast(t('auth.claim_success'), 'success');
        done(true);
      } catch (err) {
        const code = err instanceof ApiError ? err.code : undefined;
        const loc = code ? t(`errors.${code}`) : '';
        errEl.textContent = loc && loc !== `errors.${code}`
          ? loc
          : ((err as Error).message || t('common.error'));
        errEl.classList.remove('hidden');
      }
    };

    $('btn-claim-cancel').onclick = () => done(false);
  });
}

// ============================================================
// Непрочитанные уведомления
// ============================================================
//
// Красная цифра на кнопке уведомлений.
//
// Живёт здесь, а не в world.ts: panels.ts зовёт её из панели уведомлений,
// а world.ts импортирует panels.ts — импорт оттуда создал бы цикл. hud.ts
// импортируется обоими.
//
// Без цифры единственным признаком того, что уведомление пришло, был тост,
// исчезавший через пару секунд. Счётчик живёт в сессии, поэтому переживает
// открытие и закрытие панели.
export function renderUnreadBadge(): void {
  const el = document.getElementById('unread-badge');
  if (!el) return;
  const n = session.notifications.unread;
  el.textContent = n > 99 ? '99+' : String(n);
  el.classList.toggle('hidden', n <= 0);
}
