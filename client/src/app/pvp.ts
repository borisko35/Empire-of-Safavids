// ============================================================
// PvP-арена (клиент) — Empire of Safavids
// ============================================================
// Раньше кнопка «Найти бой» показывала тост и ничего не делала: матчмейкинг
// падал на внешнем ключе, соперник не уведомлялся, интерфейса боя не было.
// Теперь сервер шлёт pvp:match_found обоим, и мы показываем бой.
//
// ЧТО ПОКАЗЫВАЕМ, А ЧТО НЕТ: полосы здоровья, соперника, таймер и
// подтверждение результата. Само сражение идёт обычными ударами по
// сопернику — отдельной арены с телепортом нет, бой происходит там, где
// игрок стоял. Это проще и не ломает перемещение по миру.
//
// ПОЧЕМУ НЕ ПРОСИМ «ТЫ ПОБЕДИЛ» САМОМУ: сервер знает, чей HP ушёл в ноль.
// Если бы мы спрашивали игрока, можно было бы солгать. Поэтому мы просто
// сообщаем факт и просим подтвердить — на всякий случай, если кто-то
// отключился посреди боя.

import { api } from './api';
import { t } from './i18n';
import { toast } from './hud';
import { session } from './state';

interface ArenaState {
  matchId: number;
  opponentId: string;
  opponentName: string;
  opponentClass: string;
  opponentLevel: number;
  myHp: number;
  myMaxHp: number;
  endsAt: number;
}

let state: ArenaState | null = null;
let rootEl: HTMLElement | null = null;
let tickTimer: number | null = null;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** Разметка экрана боя */
function build(): void {
  if (rootEl) return;
  rootEl = document.createElement('div');
  rootEl.id = 'pvp-arena';
  rootEl.className = 'pvp-arena hidden';
  rootEl.innerHTML = `
    <div class="pvp-box">
      <div class="pvp-timer" id="pvp-timer">2:00</div>
      <div class="pvp-fighter pvp-fighter--me">
        <div class="pvp-name" id="pvp-me-name"></div>
        <div class="pvp-hp"><div class="pvp-hp-fill" id="pvp-me-hp"></div></div>
      </div>
      <div class="pvp-vs">VS</div>
      <div class="pvp-fighter">
        <div class="pvp-name" id="pvp-foe-name"></div>
        <div class="pvp-hp"><div class="pvp-hp-fill" id="pvp-foe-hp"></div></div>
      </div>
      <div class="pvp-hint" id="pvp-hint"></div>
    </div>
  `;
  document.body.append(rootEl);
}

/** Обновить полосы и таймер */
function paint(): void {
  if (!state || !rootEl) return;
  const left = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
  const timerEl = $('pvp-timer');
  if (timerEl) {
    timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    // В последние 10 секунд таймер краснеет — игрок должен успеть
    timerEl.classList.toggle('pvp-timer--low', left <= 10);
  }
  const me = $('pvp-me-hp');
  if (me) me.style.width = `${Math.max(0, Math.min(100, (state.myHp / state.myMaxHp) * 100))}%`;
  const foe = $('pvp-foe-hp');
  // Здоровье соперника точно нам неизвестно: показываем, что он ещё жив
  if (foe) foe.style.width = state.opponentId ? '100%' : '0%';
}

/** Сервер нашёл соперника */
export function onMatchFound(data: {
  matchId: number; endsAt: number;
  you: { id: string; name: string; hp: number; maxHp: number };
  opponent: { id: string; name: string; charClass: string; level: number } | null;
}): void {
  if (!data.opponent) {
    toast(t('pvp.not_found'), 'info');
    return;
  }
  build();
  state = {
    matchId: data.matchId,
    opponentId: data.opponent.id,
    opponentName: data.opponent.name,
    opponentClass: data.opponent.charClass,
    opponentLevel: data.opponent.level,
    myHp: data.you.hp,
    myMaxHp: data.you.maxHp,
    endsAt: data.endsAt,
  };
  const meName = $('pvp-me-name');
  if (meName) meName.textContent = data.you.name;
  const foeName = $('pvp-foe-name');
  if (foeName) foeName.textContent = `${data.opponent.name} · ${t(`classes.${data.opponent.charClass}`)}`;
  const hint = $('pvp-hint');
  if (hint) hint.textContent = t('pvp.fight_hint');
  rootEl!.classList.remove('hidden');
  paint();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = window.setInterval(paint, 500);
}

/** Наше здоровье изменилось (обычный поток боя) */
export function onMyHpChanged(hp: number): void {
  if (!state) return;
  state.myHp = hp;
  paint();
}

/** Бой закончился: показываем результат и просим подтвердить */
export async function onArenaEnd(data: {
  matchId: number; winnerId: string | null; youWon: boolean; reason?: string;
}): Promise<void> {
  if (!state || state.matchId !== data.matchId) return;
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  paint();

  const hint = $('pvp-hint');
  if (hint) {
    hint.textContent = data.winnerId
      ? (data.youWon ? t('pvp.you_won') : t('pvp.you_lost'))
      : t('pvp.draw');
  }
  // Отправляем подтверждение автоматически: сервер всё равно требует
  // подтверждения обоих, а факт он знает сам
  const winnerId = data.winnerId ?? '';
  try {
    const res = await api.pvpComplete(charId(), data.matchId, winnerId);
    if (res.status === 'pending') {
      toast(t('pvp.wait_opponent'), 'info');
      // Соперник ещё не подтвердил — спросим у него сами
      pollStatus(data.matchId);
    } else if (res.status === 'draw') {
      toast(t('pvp.draw'), 'info');
    }
  } catch (err) {
    toast((err as Error).message, 'error');
  }
  // Экран убираем: результат уже показан тостом
  window.setTimeout(() => hide(), 2500);
}

/** Ждём, пока соперник подтвердит исход */
function pollStatus(matchId: number): void {
  const started = Date.now();
  const poll = async (): Promise<void> => {
    if (!state || state.matchId !== matchId) return;
    // Дольше минуты ждать бессмысленно: сервер и так закроет бой сам
    if (Date.now() - started > 90_000) { hide(); return; }
    try {
      const res = await api.pvpMatchStatus(matchId);
      if (res.status === 'settled' || res.status === 'draw') { hide(); return; }
    } catch { /* попробуем ещё */ }
    window.setTimeout(() => void poll(), 3000);
  };
  window.setTimeout(() => void poll(), 3000);
}

function hide(): void {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  rootEl?.classList.add('hidden');
  state = null;
}

export { hide as onPvpHide };

function charId(): string {
  return session.character?.id ?? '';
}

/** Игрок ищет бой: показываем «ищем», пока сервер не ответит */
export function onSearching(): void {
  build();
  state = null;
  const hint = $('pvp-hint');
  if (hint) hint.textContent = t('pvp.searching');
  const timer = $('pvp-timer');
  if (timer) timer.textContent = '—';
  rootEl!.classList.remove('hidden');
}

// Импорты для world.ts
export { onMatchFound as onPvpMatchFound, onArenaEnd as onPvpArenaEnd, onMyHpChanged as onPvpMyHpChanged };
