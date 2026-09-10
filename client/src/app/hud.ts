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
      const row = document.createElement('div');
      row.className = 'region-row' + (r.id === session.character?.region ? ' current' : '') + (locked ? ' locked' : '');
      row.innerHTML =
        `<div class="rname"><b>${r.nameRu}</b><span class="ronline">${r.onlinePlayers} ${t('world.online')}</span></div>` +
        `<div class="rdesc">${locked ? '🔒 ' : ''}${r.description}</div>` +
        `<div class="rdesc">${t('badges.level')} ${r.minLevel}+</div>`;
      box.append(row);
    }
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
      const objectives = q.objectives
        .map((o) => {
          const have = session.kills[o.target] ?? 0;
          const done = have >= o.required && o.type === 'kill';
          return o.type === 'kill'
            ? `<div class="qobj ${done ? 'done' : ''}">✦ ${o.description}: ${Math.min(have, o.required)}/${o.required}</div>`
            : `<div class="qobj">✦ ${o.description}</div>`;
        })
        .join('');
      card.innerHTML =
        `<div class="qtype">${q.type} · ${t('badges.level')} ${q.minLevel}+</div>` +
        `<b>${title}</b>` +
        `<div class="qdesc">${q.description}</div>` +
        objectives +
        `<div class="qreward">✦ ${q.rewards.experience} ${t('world.exp')} · ◉ ${q.rewards.gold}</div>`;
      box.append(card);
    }
  } catch {
    /* квесты недоступны */
  }
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
