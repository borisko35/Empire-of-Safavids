// ============================================================
// HUD: рамки, навыки, чат, панели, тосты — Empire of Safavids
// ============================================================

import { api } from './api';
import { t } from './i18n';
import { icon } from '../ui/icons';
import { session } from './state';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

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
  ($('bar-exp') as HTMLElement).style.width = pct(s.experience, s.level * s.level * 100);
  $('txt-exp').textContent = `${s.experience} / ${s.level * s.level * 100}`;
  $('hud-name').textContent = s.character?.name ?? '';
  $('hud-level').textContent = `${t('badges.level')} ${s.level}`;
  $('hud-gold').textContent = `◉ ${s.character?.gold ?? 0}`;
  $('hud-region').textContent = REGION_NAMES[s.character?.region ?? ''] ?? s.character?.region ?? '';
}

const REGION_NAMES: Record<string, string> = {
  tabriz: 'Тебриз', isfahan: 'Исфахан', shiraz: 'Шираз', caucasus: 'Кавказ',
  mesopotamia: 'Месопотамия', khorasan: 'Хорасан', persian_gulf: 'Персидский залив',
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
export function chatMessage(name: string | null, text: string, system = false): void {
  const log = $('chat-log');
  const msg = document.createElement('div');
  msg.className = 'msg' + (system ? ' sys' : '');
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
  return !$('chat-form').classList.contains('hidden');
}

export function openChat(): HTMLInputElement {
  const form = $('chat-form');
  form.classList.remove('hidden');
  const input = $('chat-text') as HTMLInputElement;
  input.focus();
  return input;
}

export function closeChat(): void {
  $('chat-form').classList.add('hidden');
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
      (q) => q.minLevel <= level + 2 && (!q.requiredRegion || q.requiredRegion === region),
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
        `<div class="qtype">${q.type} · ${t('badges.level')} ${q.minLevel}+</div>` +
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
          toast(t('world.item_used'), 'success');
          await loadInventory();
        }));
      }
      row.append(actions);
      box.append(row);
    }
  } catch {
    /* инвентарь недоступен — не критично */
  }
}

// ── Мини-карта ───────────────────────────────────────────────
const MINIMAP_RANGE = 120; // мировых единиц по горизонтали от игрока

export function updateMinimap(
  me: { x: number; z: number },
  monsters: { x: number; z: number }[],
): void {
  const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = canvas.width;
  const scale = size / (MINIMAP_RANGE * 2);
  const toPx = (wx: number, wz: number) => ({
    x: size / 2 + (wx - me.x) * scale,
    y: size / 2 + (wz - me.z) * scale,
  });

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(7, 15, 27, 0.72)';
  ctx.fillRect(0, 0, size, size);

  // Сетка
  ctx.strokeStyle = 'rgba(201, 168, 76, 0.15)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (size / 4) * i;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }

  // Монстры
  for (const m of monsters) {
    const { x, y } = toPx(m.x, m.z);
    if (x < 2 || y < 2 || x > size - 2 || y > size - 2) continue;
    ctx.fillStyle = '#e85a4a';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Игрок в центре
  ctx.fillStyle = '#f5f0e8';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9a84c';
  ctx.stroke();
}

// ── Мировое время ────────────────────────────────────────────
const TIME_OF_DAY_RU: Record<string, string> = {
  morning: 'утро', noon: 'полдень', afternoon: 'день', evening: 'вечер',
  dusk: 'закат', night: 'ночь', midnight: 'полночь', dawn: 'рассвет',
};
const WEATHER_RU: Record<string, string> = {
  clear: 'ясно', cloudy: 'облачно', rain: 'дождь', storm: 'гроза',
  fog: 'туман', sandstorm: 'песчаная буря', snow: 'снег',
};

export function setWorldTime(payload: Record<string, unknown>): void {
  const el = $('world-time');
  const tod = TIME_OF_DAY_RU[String(payload.timeOfDay ?? payload.time ?? '')] ?? '';
  const weather = WEATHER_RU[String(payload.weather ?? '')] ?? '';
  const parts = [tod, weather].filter(Boolean);
  el.textContent = parts.join(' · ');
  el.classList.toggle('top-only', $('target-frame').classList.contains('hidden'));
}
