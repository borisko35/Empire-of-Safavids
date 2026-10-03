// ============================================================
// HUD: рамки, навыки, чат, панели, тосты — Empire of Safavids
// ============================================================

import { api, ApiError } from './api';
import type { ActiveBuff } from './api';
import { t } from './i18n';
import { fogLayerFor, worldFogMask } from './minimapFog';
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
  // Герат — восьмой регион. Без этой строки игрок в Герате видел бы имя зоны
  // и не видел бы имени региона, а путешествовать в него было бы некуда.
  herat: 'regions.herat',
  east_frontier: 'regions.east_frontier',
  west_frontier: 'regions.west_frontier',
};

const ZONE_NAMES: Record<string, string> = {
  // Столица - Исфахан, и полоса вокруг построенного города названа его
  // именем. Раньше здесь стояло tabriz_*, хотя город был Исфаханом, и зона
  // на экране называлась «Центр Тебриза» внутри Исфахана.
  isfahan_center: 'zones.isfahan_center', isfahan_outskirts: 'zones.isfahan_outskirts', isfahan_north: 'zones.isfahan_north',
  tabriz_bazaar: 'zones.tabriz_bazaar', tabriz_gates: 'zones.tabriz_gates', tabriz_south: 'zones.tabriz_south',
  shiraz_gardens: 'zones.shiraz_gardens', shiraz_walls: 'zones.shiraz_walls', shiraz_east: 'zones.shiraz_east',
  caucasus_pass: 'zones.caucasus_pass', caucasus_fortress: 'zones.caucasus_fortress', caucasus_peaks: 'zones.caucasus_peaks',
  mesopotamia_river: 'zones.mesopotamia_river', mesopotamia_ruins: 'zones.mesopotamia_ruins', mesopotamia_frontier: 'zones.mesopotamia_frontier',
  khorasan_oasis: 'zones.khorasan_oasis', khorasan_caravanserai: 'zones.khorasan_caravanserai', khorasan_east: 'zones.khorasan_east',
  persian_gulf_harbor: 'zones.persian_gulf_harbor', persian_gulf_waters: 'zones.persian_gulf_waters', persian_gulf_islands: 'zones.persian_gulf_islands',
  herat_gates: 'zones.herat_gates', herat_city: 'zones.herat_city', herat_east: 'zones.herat_east',
  east_frontier_gates: 'zones.east_frontier_gates', east_frontier_road: 'zones.east_frontier_road',
  east_frontier_far: 'zones.east_frontier_far', west_frontier_gates: 'zones.west_frontier_gates',
  west_frontier_road: 'zones.west_frontier_road', west_frontier_far: 'zones.west_frontier_far',
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
/**
 * Строка чата.
 *
 * authorId передаётся для кнопки жалобы: пожаловаться можно только на
 * чужое сообщение, и серверу нужен именно автор, а не текст. Для
 * системных строк и для собственных сообщений кнопки нет — жаловаться
 * на собственную реплику бессмысленно.
 */
export function chatMessage(
  name: string | null,
  text: string,
  system = false,
  role: 'owner' | 'admin' | 'moderator' | null = null,
  authorId?: string,
): void {
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

  // Кнопка жалобы: без неё сообщить о нарушителе было нечем
  const me = session.character?.id;
  if (authorId && me && authorId !== me) {
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'chat-report';
    report.dataset.report = authorId;
    report.title = t('chat.report_title');
    report.textContent = '⚑';
    report.addEventListener('click', () => void sendReport(authorId));
    msg.append(report);
  }

  log.append(msg);
  while (log.children.length > 80) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

/**
 * Отправить жалобу на игрока.
 *
 * Причину спрашиваем, а не берём «other»: жалоба без причины бесполезна
 * модератору, иначе он не сможет решить, что делать. Ответ сервера
 * показываем игроку — иначе он решит, что жалоба ушла, даже если её
 * отклонил лимит.
 */
async function sendReport(reportedId: string): Promise<void> {
  const me = session.character?.id;
  if (!me) return;
  const raw = window.prompt(t('chat.report_reason_prompt'), 'harassment');
  if (raw === null) return;
  // Причина из списка идёт как есть, любой другой текст — как 'other' с
  // пояснением в detail. Сервер всё равно проверит список, но полагаться
  // на одну только проверку сервера нельзя: неизвестное значение молча
  // ушло бы в content и модератор не увидел бы причины
  const known = (REPORT_REASONS as readonly string[]).includes(raw);
  const reason = known ? raw : 'other';
  try {
    await api.report(me, reportedId, reason, known ? '' : raw.slice(0, 500));
    toast(t('chat.report_sent'), 'success');
  } catch {
    toast(t('chat.report_failed'), 'error');
  }
}

/** Причины жалобы: тот же список, что принимает сервер */
const REPORT_REASONS = ['harassment', 'cheating', 'spam', 'scamming', 'other'] as const;

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
      // Замка нет: кнопка путешествия доступна всегда.
      // Решение владельца - преграды на пути не ставим. Раньше здесь было
      // `const locked = (session.level ?? 0) < r.minLevel;`, и кнопка
      // оставалась серой даже если бы сервер перестал отказывать:
      // затвор в интерфейсе выглядит как «город закрыт» не хуже серверного.
      const here = r.id === session.character?.region;
      const row = document.createElement('div');
      row.className = 'region-row' + (here ? ' current' : '');
      row.innerHTML =
        `<div class="rname"><b>${r.nameRu}</b><span class="ronline">${r.onlinePlayers} ${t('world.online')}</span></div>` +
        `<div class="rdesc">${r.description}</div>` +
        `<div class="rdesc">${t('badges.level')} ${r.minLevel}+</div>`;
      if (!here) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'region-travel';
        btn.dataset.region = r.id;

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
  personal: 'quest_type.personal',
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
  items: {
    slot: string;
    nameRu: string;
    rarity: string;
    enhancement: number;
    /** Время одного замаха в секундах; есть только у оружия */
    swingSeconds?: number;
  }[];
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
    // Время замаха приходит из данных предмета вместе с экипировкой.
    // Без него замах в 3D шёл бы по вбитому 0.45, и смена оружия на
    // более быстрое ничего бы не меняла.
    swingSeconds: equipped.get('weapon')?.swingSeconds ?? null,
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
  biomeAt, isRoad, terrainHeight, REGION_TOWNS,
} from './game3d/terrain';
import { ZONES } from '../../../shared/constants';

const MINIMAP_RANGE = 180;
/**
 * Запас подложки под поворот карты.
 *
 * Выборка рельефа рисуется квадратом ровно на холст. При повороте на 45°
 * этого не хватает: по углам остаётся пустота и биом обрывается. Меньше √2
 * нельзя — это диагональ квадрата; берём 1,5 с запасом на всякий угол.
 */
const MINIMAP_OVERSCAN = 1.5;   // мировых единиц по горизонтали от игрока
const TERRAIN_PAD = 24;      // запас слоя террейна (мировые единицы)
const TERRAIN_SNAP = 16;     // шаг привязки слоя к сетке мира

// Значки по виду города. Ключ - поле kind из REGION_TOWNS, то есть
// список берётся из данных построек, а не повторяется руками.
const ЗНАЧКИ_ГОРОДОВ: Record<string, string> = {
  trade: '⚖',      // торговый город
  walls: '🌿',     // сады за стеной
  fortress: '🏰',   // крепость
  ruins: '🏛',      // руины
  oasis: '🌴',      // оазис
  port: '⚓',       // причал
};

// Города регионов в списке поселений.
//
// Раньше список был захардкожен и содержал шесть записей - только те
// поселения, что строит buildSettlements. Шесть городов регионов в него
// не попадали, и карта показывала пустоту там, где стоит город. Поэтому
// список собирается из REGION_TOWNS: новый город на карте появляется
// сам, а не по памяти автора.
const ГОРОДА_РЕГИОНОВ_НА_КАРТЕ = REGION_TOWNS.map((t) => ({
  x: t.x,
  z: t.z,
  id: t.region,
  // Название берётся из словаря регионов, а не из nameRu в данных:
  // nameRu всегда по-русски, и игрок с английским интерфейсом увидел бы
  // «Хорасан» вместо «Khorasan».
  nameKey: `regions.${t.region}`,
  icon: ЗНАЧКИ_ГОРОДОВ[t.kind] ?? '🏛',
  r: t.radius,
}));

const MINIMAP_SETTLEMENTS: { x: number; z: number; id: string; nameKey: string; icon: string; r: number }[] = [
  { x: CITY.x, z: CITY.z, id: 'isfahan', nameKey: 'places.isfahan', icon: '🏰', r: CITY.radius },
  { x: CAMP.x, z: CAMP.z, id: 'camp', nameKey: 'places.camp', icon: '⛺', r: 30 },
  { x: PORT.x, z: PORT.z, id: 'port', nameKey: 'places.port', icon: '⚓', r: 30 },
  { x: CARAVANSERAI.x, z: CARAVANSERAI.z, id: 'caravanserai', nameKey: 'places.caravanserai', icon: '🐫', r: 30 },
  { x: VILLAGE.x, z: VILLAGE.z, id: 'village', nameKey: 'places.village', icon: '🏡', r: 30 },
  { x: FORT.x, z: FORT.z, id: 'fort', nameKey: 'places.fort', icon: '🏔', r: 30 },
  ...ГОРОДА_РЕГИОНОВ_НА_КАРТЕ,
];

// ── Полосы регионов: границы и названия ─────────────────────────────
// Считаются из ZONES, а не пишутся числами.
//
// Раньше полоса несла только z: все прежние регионы были горизонтальными
// полосами на всю ширину мира. Дальние края - полосы по x, и при старом
// расчёте подпись «Крайний восток» встала бы посреди карты, будто это
// горизонтальная полоса. Теперь полоса несёт обе оси.
const ПОЛОСЫ_РЕГИОНОВ: { region: string; x1: number; x2: number; z1: number; z2: number }[] = (() => {
  const карта = new Map<string, { x1: number; x2: number; z1: number; z2: number }>();
  for (const з of ZONES) {
    const п = карта.get(з.region);
    if (!п) карта.set(з.region, { x1: з.bounds.x1, x2: з.bounds.x2, z1: з.bounds.z1, z2: з.bounds.z2 });
    else {
      п.x1 = Math.min(п.x1, з.bounds.x1);
      п.x2 = Math.max(п.x2, з.bounds.x2);
      п.z1 = Math.min(п.z1, з.bounds.z1);
      п.z2 = Math.max(п.z2, з.bounds.z2);
    }
  }
  return [...карта.entries()]
    .map(([region, п]) => ({ region, ...п }))
    .sort((a, b) => a.z1 - b.z1);
})();

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
  // Слой шире видимой части: центр остаётся на игроке, а мир виден с запасом
  // по сторонам, чтобы поворот не оставлял пустых углов.
  const extent = (MINIMAP_RANGE * 2 + TERRAIN_PAD * 2) * MINIMAP_OVERSCAN;
  const ox = snap(cx) - extent / 2;
  const oz = snap(cz) - extent / 2;

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
  /**
   * Направление взгляда в радианах: карта поворачивается так, чтобы игрок
   * смотрел вверх. Ноль — север вверх, как было раньше.
   *
   * Угол поворота равен именно yaw камеры, а не отрицанию: при обоих
   * направлениях ось z на экране смотрит вниз, поэтому вектор взгляда
   * (−sin yaw, −cos yaw) после поворота на yaw попадает вверх ровно.
   */
  yaw = 0,
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

  // Поворот вокруг центра холста. Внутри — только то, что принадлежит миру;
  // стрелка игрока, рамка и метка севера рисуются после restore, иначе они
  // крутились бы вместе с картой и «смотрели» вбок.
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(yaw);
  ctx.translate(-size / 2, -size / 2);

  // Фон — разноцветный слой биомов (кэш пересобирается при смещении)
  ctx.clearRect(0, 0, size, size);
  // Слой строится с запасом по пикселям, иначе карта мылила бы: тот же мир
  // на меньшем числе пикселей.
  const layerPx = Math.round(size * MINIMAP_OVERSCAN);
  // Центр слоя — не край, а середина: иначе после расширения пересборка
  // никогда не срабатывала бы и карта ехала бы за игроком.
  const needLayer =
    !terrainLayer || terrainSizePx !== layerPx ||
    Math.abs(me.x - (terrainOrigin.x + terrainExtent / 2)) > TERRAIN_SNAP * 0.6 ||
    Math.abs(me.z - (terrainOrigin.z + terrainExtent / 2)) > TERRAIN_SNAP * 0.6;
  if (needLayer) buildTerrainLayer(me.x, me.z, layerPx);
  if (terrainLayer) {
    const ls = terrainSizePx / terrainExtent;   // px слоя на мировую единицу
    const sw = size * (ls / scale);             // размер выборки в px слоя
    // Выборка берётся с запасом и кладётся за пределы холста: пиксель на
    // мировую единицу не меняется (выборка и результат расширяются вместе),
    // поэтому рельеф не уезжает относительно маркеров — просто по краям
    // видно чуть больше мира, чем нужно при взгляде прямо.
    const swЗапас = sw * MINIMAP_OVERSCAN;
    const выносСлоя = (size * (MINIMAP_OVERSCAN - 1)) / 2;
    // Игрок — точно в центр мини-карты: выборка центрируется на его позиции
    const sx = (me.x - terrainOrigin.x) * ls - swЗапас / 2;
    const sy = (me.z - terrainOrigin.z) * ls - swЗапас / 2;
    ctx.drawImage(terrainLayer, sx, sy, swЗапас, swЗапас,
      -выносСлоя, -выносСлоя, size * MINIMAP_OVERSCAN, size * MINIMAP_OVERSCAN);

    // Туман войны: незнакомая местность закрыта. Маска в тех же мировых
    // координатах и в том же повороте, что и рельеф, поэтому совпадает с ним
    // пиксель в пиксель. Лежит ДО маркеров — иначе монстры светились бы сквозь
    // то, чего игрок не видел.
    const fog = fogLayerFor(terrainOrigin.x, terrainOrigin.z, terrainExtent, terrainSizePx);
    if (fog) ctx.drawImage(fog, 0, 0);
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

  ctx.restore();

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

  // Север: после поворота «вверх» больше не север, и без метки игрок не
  // понимает, куда идти. Север в мире — это −z; на холст его поворачивает
  // тот же угол, что и всю карту.
  const радиусСевера = size / 2 - 9;
  const nx = size / 2 + Math.sin(yaw) * радиусСевера;
  const ny = size / 2 - Math.cos(yaw) * радиусСевера;
  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate(yaw);
  ctx.fillStyle = '#ffe9b8';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -4.5);
  ctx.lineTo(-3.2, 3);
  ctx.lineTo(3.2, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Буква не поворачивается: перевёрнутое «С» читается хуже, чем стрелка
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.lineWidth = 2.5;
  ctx.strokeText(t('map.north'), nx, ny - 6);
  ctx.fillStyle = '#ffe9b8';
  ctx.fillText(t('map.north'), nx, ny - 6);
  ctx.textAlign = 'left';

  if (currentRegion && currentRegion !== lastMinimapRegion) {
    lastMinimapRegion = currentRegion;
  }
  return currentRegion;
}

// ── Карта мира (M): весь мир целиком ─────────────────────────
/** Прямоугольник занятого места на карте: подпись, значок или название региона */
type Прямоугольник = { x1: number; y1: number; x2: number; y2: number };

/**
 * Прямоугольники названий регионов с последней сборки слоя карты.
 *
 * Нужны подписям поселений: без них у карты два независимых списка занятости,
 * и название региона ложится поверх названия города. Слой карты статичен, так
 * что список переживает перерисовку и не требует пересборки.
 */
const мировыеНазванияРегионов: Прямоугольник[] = [];

let worldmapLayer: HTMLCanvasElement | null = null;
let worldmapLayerW = 0;

export function drawWorldMap(
  me: { x: number; z: number },
  monsters: { x: number; z: number }[],
  npcs?: { x: number; z: number }[],
  route?: { x: number; z: number }[],
): void {
  // Туман войны и на большой карте: карта со всей местностью рядом с
  // мини-картой с запорами выглядела бы как поломка, а не как замысел.
  const worldFog = worldFogMask();
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

    // ── Границы регионов и их названия ─────────────────────────
    // Полосы идут сверху вниз по z. Граница рисуется пунктиром, иначе
    // сплошная линия читалась бы как дорога, а названия поверх неё
    // показывали бы, что это рубеж между регионами.
    c.save();
    c.setLineDash([9, 7]);
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255, 233, 184, 0.55)';
    for (const полоса of ПОЛОСЫ_РЕГИОНОВ) {
      for (const z of [полоса.z1, полоса.z2]) {
        const a = toPx(-WORLD_HALF, z);
        const b = toPx(WORLD_HALF, z);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
    }
    c.restore();

    // Название региона - по центру его полосы. Шрифт крупный и с
    // обводкой, иначе надпись не читается поверх пятнистого биома.
    //
          // ЖАДНАЯ РАССТАНОВКА НАЗВАНИЙ, а не порог «тонкая полоса».
      //
      // ЧТО БЫЛО. Правило «полоса ниже 26 пикселей — сдвинь подпись
      // влево» починило три наезда, но оставило два: Тэбриз (28.3 px) и
      // Исфахан (37.8 px) порогом не считались тонкими, оба встали в
      // центр и оказались в 33.1 пикселя друг от друга при шрифтах 20+20.
      // Порог был угадан на глаз и не выводился из того, сталкиваются ли
      // подписи на самом деле.
      //
      // ЧТО СТАЛО. Подпись меряется настоящей шириной через measureText и
      // ищет свободное место в одном из пяти столбцов. Решение принимается
      // по фактическому пересечению прямоугольников, а не по порогу.
      // Кегль остаётся привязан к высоте полосы: в полосе 14 пикселей
      // двадцать пунктов не поместятся физически.
      //
      // Если места нет ни в одном столбце, подпись не рисуется. Это
      // осознанно: две наложенные подписи читаются хуже, чем одна
      // пропущенная, и пропуск виден — его можно починить.
      c.textAlign = 'center';
      c.lineJoin = 'round';
      c.lineWidth = 4;
      // Прямоугольники названий регионов уходят наружу: подписи поселений
      // обязаны их знать, иначе название региона ляжет поверх названия города.
      const занятыеНазвания: Прямоугольник[] = [];
      мировыеНазванияРегионов.length = 0;
      const СТОЛБЦЫ = [W / 2, W * 0.25, W * 0.75, W * 0.12, W * 0.88];
      ПОЛОСЫ_РЕГИОНОВ.forEach((полоса) => {
        // Города регионов подписаны ключом `regions.<регион>` — тем же, что и
        // сама полоса. Без этой проверки каждое название писалось дважды:
        // крупно бледным по полосе и мелким чётким у города.
        if (MINIMAP_SETTLEMENTS.some((s) => s.nameKey === `regions.${полоса.region}`)) return;
        const левый = toPx(полоса.x1, полоса.z1).x;
        const верх = toPx(полоса.x1, полоса.z1).y;
        const правый = toPx(полоса.x2, полоса.z2).x;
        const низ = toPx(полоса.x2, полоса.z2).y;
        const ширинаПолосы = Math.abs(правый - левый);
        const высотаПолосы = Math.abs(низ - верх);
        // Кегль - по меньшей стороне. У полосы по северу-югу узкая сторона
        // это высота, у полосы с края мира узкая - ширина. Раньше бралась
        // только высота, и подпись края вышла бы двадцатипиксельной
        // поверх всей карты.
        const кегль = Math.max(9, Math.min(20, Math.round(Math.min(ширинаПолосы, высотаПолосы) - 4)));
        c.font = `bold ${кегль}px sans-serif`;
        const надпись = t(`regions.${полоса.region}`);
        const половина = c.measureText(надпись).width / 2 + 4;
        const y = (верх + низ) / 2;
        // Сначала середина самой полосы: у полосы во всю ширину это W/2,
        // который и так первый в СТОЛБЦЫ, - поведение прежнее. У полосы с
        // края это её собственный центр.
        const центр = (левый + правый) / 2;
        const кандидаты = [центр,
          ...СТОЛБЦЫ.filter((с) => с >= левый + половина && с <= правый - половина)];
        let x: number | null = null;
        for (const столбец of кандидаты) {
          const прямоугольник = {
            x1: столбец - половина, y1: y - кегль,
            x2: столбец + половина, y2: y + кегль * 0.4,
          };
          if (прямоугольник.x1 < 2 || прямоугольник.x2 > W - 2) continue;
          const пересекает = занятыеНазвания.some((з) =>
            прямоугольник.x1 < з.x2 && прямоугольник.x2 > з.x1 &&
            прямоугольник.y1 < з.y2 && прямоугольник.y2 > з.y1);
          if (!пересекает) {
            x = столбец;
            занятыеНазвания.push(прямоугольник);
            мировыеНазванияРегионов.push(прямоугольник);
            break;
          }
        }
        if (x === null) return;
        // Если ключа нет, t вернёт сам путь - рисуем его, но так, чтобы
        // это было видно: путь ключа на карте означает недописанный словарь.
        c.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        c.strokeText(надпись, x, y);
        c.fillStyle = 'rgba(255, 233, 184, 0.92)';
        c.fillText(надпись, x, y);});
    c.textAlign = 'left';
    worldmapLayer = layer;
    worldmapLayerW = W;
  }
  ctx.drawImage(worldmapLayer, 0, 0);

  // Туман войны поверх мира: маска покрывает ровно [-WORLD_HALF, WORLD_HALF]
  // по обеим осям, поэтому ложится по той же формуле, что и toPx. Лежит до
  // сетки и подписей: незнакомая местность не должна просвечивать.
  if (worldFog) {
    const fx = W / 2 - WORLD_HALF * scale;
    const fy = H / 2 - WORLD_HALF * scale;
    const fw = WORLD_HALF * 2 * scale;
    ctx.drawImage(worldFog, fx, fy, fw, fw);
  }

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

  // Поселения: значок + подпись.
  //
  // ПОДПИСИ БОЛЬШЕ НЕ НАЕЗЖАЮТ. После расширения мира масштаб упал с
  // 0.25 до 0.0945 пикселя на единицу, и шесть из семи пар городов
  // оказались ближе 40 пикселей, а подпись занимает 50-60. Самая тесная
  // пара - Шираз и Кавказ, в 15.4 пикселя: наезжали бы гарантированно.
  //
  // Правило: значок рисуется ВСЕГДА - важно, где стоит город. Подпись
  // сдвигается вверх-вниз, а если некуда - не рисуется вовсе. Молча
  // пропущенная подпись лучше, чем две наложенные друг на друга.
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  // Список занятых мест общий для обеих надписей: названия регионов и подписи
  // поселений наезжали именно потому, что у каждой свой список. И значки тоже
  // занимают место — иначе подпись соседнего города ложилась на чужой значок.
  const занятыеПодписи: Прямоугольник[] = [...мировыеНазванияРегионов];
  const пересекает = (a: Прямоугольник, b: Прямоугольник): boolean =>
    a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  // Радиус значка — по самой тесной паре поселений на карте (Шираз и Кавказ в
  // 15.4 пикселя при холсте 900x600). Значок 16 пикселей шире промежутка, то
  // есть два значка всегда ложались друг на друга; 12 помещается с запасом.
  // Проверяется числами в mapOverlaps.test.ts.
  const ЗНАЧОК_РАДИУС = 6;
  for (const s of MINIMAP_SETTLEMENTS) {
    const { x, y } = toPx(s.x, s.z);
    ctx.font = '12px sans-serif';
    ctx.fillText(s.icon, x, y + 6);
    // Значок нарисован и теперь занимает место: подписи его обойдут.
    занятыеПодписи.push({
      x1: x - ЗНАЧОК_РАДИУС, y1: y - ЗНАЧОК_РАДИУС + 6,
      x2: x + ЗНАЧОК_РАДИУС, y2: y + ЗНАЧОК_РАДИУС + 6,
    });
    const надпись = t(s.nameKey);
    // Шрифт подписи, а не значка: при 16px прямоугольник выходит на треть
    // шире настоящего, подписи расходятся дальше нужного, а в тесных местах
    // часть названий молча пропадала.
    ctx.font = 'bold 12px sans-serif';
    const половинаШирины = ctx.measureText(надпись).width / 2 + 3;
    // Куда можно сдвинуть: вверх от 14 до 40 шагов по 9 пикселей.
    let yПодписи: number | null = null;
    // Восемнадцать сдвигов, а не восемь: в центре карты шесть поселений
    // в пятне 150x90 пикселей, и восьми попыток не хватало - три поселения
    // оставались без названия. Вертикали на холсте 600 пикселей, свободных
    // строк plenty; алгоритм просто переставал пробовать раньше времени.
    for (const сдвиг of [12, -12, 24, -24, 36, -36, 48, -48, 60, -60, 72, -72, 84, -84, 96, -96, 108, -108]) {
      const проба = y - сдвиг;
      const прямоугольник = { x1: x - половинаШирины, y1: проба - 11, x2: x + половинаШирины, y2: проба + 4 };
      if (проба < 12 || проба > H - 4) continue;
      if (!занятыеПодписи.some((з) => пересекает(прямоугольник, з))) {
        yПодписи = проба;
        занятыеПодписи.push(прямоугольник);
        break;
      }
    }
    // Вертикаль кончилась — пробуем уйти вбок и на другую высоту. У поселений на
    // одной горизонтали сдвиги вверх-вниз исчерпываются быстро, а единственный
    // запасной ход вбок на одной высоте оставлял две подписи без места: рядом
    // уже стояли значки соседей. Четыре высоты и шесть смещений стоят ничего —
    // проверка занятости дешёвая, — и на карте остаются все названия.
    if (yПодписи === null) {
      const вбок = Math.ceil(половинаШирины) + 8;
      const смещения = [вбок, -вбок, вбок * 2, -вбок * 2, вбок * 3, -вбок * 3];
      for (const высота of [-14, -32, -50, 18]) {
        let нашли = false;
        for (const шаг of смещения) {
          const пробаX = x + шаг;
          if (пробаX - половинаШирины < 2 || пробаX + половинаШирины > W - 2) continue;
          const прямоугольник = {
            x1: пробаX - половинаШирины, y1: y + высота - 12,
            x2: пробаX + половинаШирины, y2: y + высота + 2,
          };
          if (занятыеПодписи.some((з) => пересекает(прямоугольник, з))) continue;
          ctx.font = 'bold 12px sans-serif';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
          ctx.lineWidth = 3;
          ctx.strokeText(надпись, пробаX, y + высота);
          ctx.fillStyle = '#ffe9b8';
          ctx.fillText(надпись, пробаX, y + высота);
          занятыеПодписи.push(прямоугольник);
          yПодписи = y + высота;
          нашли = true;
          break;
        }
        if (нашли) break;
      }
    }
    if (yПодписи === null) continue;
    ctx.font = 'bold 12px sans-serif';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 3;
    ctx.strokeText(надпись, x, yПодписи);
    ctx.fillStyle = '#ffe9b8';
    ctx.fillText(надпись, x, yПодписи);
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

/** Коды сезонов: приходят с сервера и переводятся отдельно от погоды. */
const SEASONS = new Set(['spring', 'summer', 'autumn', 'winter']);

/**
 * Часы игрового времени: «7», «12», «23».
 *
 * Формат без ведущих нулей и без «:00» - намеренно: в углу экрана нужна
 * читаемая метка, а не точность до минуты. Минута в игре равна часу
 * (REAL_MINUTES_PER_GAME_HOUR = 1), поэтому «:00» был бы выдумкой.
 */
function clockLabel(hour: unknown): string {
  const h = Number(hour);
  return Number.isFinite(h) ? String(h) : '';
}

/**
 * Дата игрового календаря: «5.3.1501» (день.месяц.год).
 *
 * Числами, а не словами «пятое марта»: год отсчитывается от 1501-го, и
 * названия месяцев пришлось бы заводить ради одной строки. Числа в
 * календаре уместны и не требуют перевода.
 */
function dateLabel(payload: Record<string, unknown>): string {
  const d = Number(payload.gameDay);
  const m = Number(payload.gameMonth);
  const y = Number(payload.gameYear);
  if (![d, m, y].every((n) => Number.isFinite(n) && n > 0)) return '';
  return `${d}.${m}.${y}`;
}

export function setWorldTime(payload: Record<string, unknown>): void {
  const el = $('world-time');
  const rawTod = String(payload.timeOfDay ?? payload.time ?? '');
  const rawWeather = String(payload.weather ?? '');
  const rawSeason = String(payload.season ?? '');
  // Неизвестный код пропускаем молча, иначе игрок увидит на экране
  // «worldclock.morning» — t() отдаёт путь, если ключа нет.
  const tod = WORLD_CLOCK.has(rawTod) ? t(`worldclock.${rawTod}`) : '';
  const weather = WORLD_CLOCK.has(rawWeather) ? t(`worldclock.${rawWeather}`) : '';
  const season = SEASONS.has(rawSeason) ? t(`worldclock.season_${rawSeason}`) : '';
  // ЧТО БЫЛО. В углу показывались только два слова - время суток и
  // погода: «Утро · Дождь». Часов, числа, месяца, года и сезона не было,
  // хотя сервер всё это вычислял и присылал каждыые четыре минуты.
  // Теперь строка читается как настоящие часы с датой.
  const parts = [clockLabel(payload.gameHour), dateLabel(payload), season, tod, weather].filter(Boolean);
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

// ============================================================
// Бейдж задач дня
// ============================================================
//
// Тот же приём, что у непрочитанных уведомлений, — красная цифра на кнопке
// в ряду. Без неё единственным признаком того, что задачи обновились, была
// сама панель, которую надо открыть специально.
//
// Счётчик живёт в памяти модуля, а не в session: это состояние одной кнопки,
// а не данные персонажа, и в session его кто-нибудь не туда запишет.
let dailyOpen = 0;

/** Показать цифру: сколько задач дня осталось. Ноль — цифру погасить. */
export function renderTasksBadge(): void {
  const el = document.getElementById('tasks-badge');
  if (!el) return;
  el.textContent = dailyOpen > 99 ? '99+' : String(dailyOpen);
  el.classList.toggle('hidden', dailyOpen <= 0);
}

/** Запомнить число невыполненных задач и перерисовать цифру. */
export function setDailyTasksOpen(count: number): void {
  dailyOpen = Math.max(0, count);
  renderTasksBadge();
}

/**
 * Спросить сервер, сколько задач осталось.
 *
 * Зовётся при входе в мир: цифра не переживает переподключение, поэтому без
 * этого запроса на кнопке всегда стоял бы ноль — даже когда задачи ждут.
 */
export async function refreshDailyTasksBadge(): Promise<void> {
  if (!session.character) return;
  try {
    const data = await api.tasks(session.character.id);
    setDailyTasksOpen(data.tasks.filter((task: { completed?: boolean }) => !task.completed).length);
  } catch {
    /* Бейдж — приятное дополнение: панель работает и без него */
  }
}
