// ============================================================
// Экран смерти — Empire of Safavids
// ============================================================
// Оверлей с выбором способа возрождения и отсчётом до
// страховочного автореспавна, который держит СЕРВЕР.
//
// Модуль создан заново целиком. Раньше он был написан, но не
// подключён: initDeathScreen никто не звал, весь текст в нём был
// зашит по-русски, а сервер событие 'respawn' не слушал вовсе.
// Одновременно в index.html жил #overlay-death с двумя строчками
// текста, который мигал и тут же пропадал: игрок не успевал ничего
// понять. Два источника правды — это два наложенных оверлея, поэтому
// #overlay-death удалён, и теперь экран смерти один: этот.

import { socket } from './net';
import { session } from './state';
import { toast } from './hud';
import { t } from './i18n';
import {
  SOCKET_EVENTS, SERVER_EVENTS, DEATH, RESPAWN_TYPES, RESPAWN_REJECT, type RespawnType,
} from '../../../shared/constants';

/** Что сервер сообщает о смерти */
interface DiedPayload {
  killerId?: string | null;
  killerName?: string | null;
  /** Через сколько секунд сервер воскресит сам, если игрок молчит */
  respawnInSec?: number;
  gold?: number;
  spotCostGold?: number;
  /** Сколько золота забрала карма за смерть: последствие видно игроку */
  karmaDropGold?: number;
}

/** Отказ сервера в респавне */
interface RespawnErrorPayload {
  reason?: string;
  cost?: number;
  gold?: number;
}

let overlayEl: HTMLElement | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let secondsLeft = 0;
/** Ждём ответа сервера: кнопки заблокированы, повторный запрос не шлём */
let awaitingServer = false;
/** Таймер возврата кнопок, если ответ так и не пришёл */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Через сколько миллисекунд кнопки оживают сами */
const REPLY_GRACE_MS = 3000;

/**
 * Подключить экран смерти.
 *
 * Вызывается из world.wireSocket(), а НЕ один раз при загрузке:
 * wireSocket() делает socket.off() и снимает ВСЕ подписки, поэтому
 * слушатели надо пересоздавать при каждом входе в мир. Сам оверлей
 * при этом создаётся один раз — иначе на экране оказалось бы два
 * наложенных оверлея после второго входа.
 */
export function initDeathScreen(): void {
  mount();
  wire();
}

/** Создать DOM один раз: повторный вход в мир не должен плодить оверлеи */
function mount(): void {
  if (!overlayEl) {
    const existing = document.getElementById('death-overlay');
    if (existing) {
      overlayEl = existing;
    } else {
      overlayEl = document.createElement('div');
      overlayEl.id = 'death-overlay';
      overlayEl.className = 'death-overlay hidden';
      overlayEl.innerHTML = `
        <div class="death-content">
          <div class="death-skull">&#9760;</div>
          <h2 class="death-title" id="death-title"></h2>
          <p class="death-subtitle" id="death-killer"></p>
          <p class="death-subtitle" id="death-karma" hidden></p>
          <div class="death-timer" id="death-countdown">0</div>
          <p class="death-hint" id="death-hint"></p>
          <p class="death-error hidden" id="death-error"></p>
          <div class="death-buttons">
            <button class="death-btn death-btn--free" id="death-city"></button>
            <button class="death-btn death-btn--paid" id="death-spot"></button>
          </div>
        </div>
      `;
      document.body.append(overlayEl);
    }
  }
  // Повторное подписывание безвредно: respawn() пропускает запрос, пока
  // ждём ответа сервера
  document.getElementById('death-city')?.addEventListener('click', () => respawn(RESPAWN_TYPES.CITY));
  document.getElementById('death-spot')?.addEventListener('click', () => respawn(RESPAWN_TYPES.SPOT));
}

/** Переподписать события сокета (после каждого socket.off()) */
function wire(): void {
  socket.on(SOCKET_EVENTS.PLAYER_DIED, (data: DiedPayload) => {
    showDeathScreen(data);
  });

  socket.on(SOCKET_EVENTS.PLAYER_RESPAWNED, () => {
    // Страховка от залипшего экрана: пришёл респавн (решение игрока,
    // автореспавн по таймеру или разрыв с последующим входом) — экран
    // закрывается в любом случае, даже если player:died где-то потерялся.
    hideDeathScreen();
  });

  socket.on(SERVER_EVENTS.RESPAWN_ERROR, (data: RespawnErrorPayload) => {
    onRespawnRejected(data);
  });
}

/** Показать экран смерти */
function showDeathScreen(payload: DiedPayload): void {
  session.dead = true;
  setAwaiting(false);
  const fromServer = Number(payload?.respawnInSec);
  secondsLeft = Math.max(1, Math.min(600, Number.isFinite(fromServer) && fromServer > 0
    ? fromServer
    : DEATH.AUTO_RESPAWN_SEC));

  paint(payload);
  setError(null);
  setButtonsEnabled(true);
  if (!overlayEl) return;
  overlayEl.classList.remove('hidden');
  startCountdown();
}

/** Закрыть экран смерти */
export function hideDeathScreen(): void {
  stopCountdown();
  setAwaiting(false);
  secondsLeft = 0;
  session.dead = false;
  overlayEl?.classList.add('hidden');
}

/** Игрок жив? (движение, атаки, анимация трупа) */
export function isDead(): boolean {
  return session.dead;
}

function stopCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/**
 * Обратный отсчёт до автореспавна.
 * Он же перезапускается после отказа: игрок остаётся на экране смерти,
 * и отсчёт должен продолжаться, а не висеть на нуле.
 */
function startCountdown(): void {
  stopCountdown();
  countdownTimer = setInterval(() => {
    secondsLeft--;
    paintCountdown();
    paintHint();
    if (secondsLeft <= 0) {
      stopCountdown();
      // Клиентский автореспавн — только удобство: страховку держит сервер,
      // поэтому даже если этот emit не дойдёт, игрок всё равно воскреснет.
      requestRespawn(RESPAWN_TYPES.CITY);
    }
  }, 1000);
}

/** Нажать кнопку возрождения */
function respawn(type: RespawnType): void {
  if (awaitingServer) return;
  requestRespawn(type);
}

/** Отправить запрос и заблокировать кнопки до ответа сервера */
function requestRespawn(type: RespawnType): void {
  setAwaiting(true);
  setError(null);
  setButtonsEnabled(false);
  paintHint();
  socket.emit(SOCKET_EVENTS.RESPAWN, { type });

  // Страховка от «залипшей» кнопки. Ответ может не прийти вовсе (сеть,
  // перезагрузка сервера), и тогда кнопки остались бы мёртвыми до конца
  // жизни экрана. Повторный запрос безвреден: сервер либо ответит
  // PLAYER_RESPAWNED, либо скажет not_dead, и экран закроется.
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!awaitingServer || !session.dead) return;
    if (secondsLeft <= 0) secondsLeft = 1;
    setButtonsEnabled(true);
    startCountdown();
  }, REPLY_GRACE_MS);
}

/** Переключить «ждём ответа». Смена состояния гасит таймер ожидания. */
function setAwaiting(value: boolean): void {
  awaitingServer = value;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * Отказ сервера. Экран смерти ОСТАЁТСЯ: игрок должен увидеть причину
 * (например, не хватило золота) и выбрать другой вариант, а не
 * смотреть на пустой экран.
 */
function onRespawnRejected(data: RespawnErrorPayload): void {
  setAwaiting(false);
  const reason = data?.reason ?? '';

  // Сервер сказал, что мёртвых состояний нет — значит, мы уже живые.
  // Это бывает при двойном запросе (клик + автореспавн по таймеру).
  if (reason === RESPAWN_REJECT.NOT_DEAD) {
    hideDeathScreen();
    return;
  }
  if (!session.dead) return;

  // Отсчёт мог уже идти к нулю — показываем снова живой остаток
  if (secondsLeft <= 0) secondsLeft = 1;
  setButtonsEnabled(true);
  paintCountdown();
  paintHint();
  setError(rejectText(reason, data));
  startCountdown();
  toast(rejectText(reason, data), 'error');
}

/** Понятная причина отказа вместо кода */
function rejectText(reason: string, data: RespawnErrorPayload): string {
  switch (reason) {
    case RESPAWN_REJECT.NO_GOLD:
      return t('panels.death_err_no_gold').replace('{gold}', String(data.cost ?? 0));
    case RESPAWN_REJECT.SPOT_BLOCKED:
      return t('panels.death_err_spot_blocked');
    case RESPAWN_REJECT.INVALID_TYPE:
    case RESPAWN_REJECT.NOT_AUTH:
    case RESPAWN_REJECT.NOT_DEAD:
    default:
      return t('panels.death_err_generic');
  }
}

// ── Отрисовка ─────────────────────────────────────────────────

function paint(payload: DiedPayload): void {
  const killer = document.getElementById('death-killer');
  if (killer) {
    killer.textContent = payload?.killerName
      ? t('panels.death_killer').replace('{name}', payload.killerName)
      : t('panels.death_killer_unknown');
  }
  const city = document.getElementById('death-city');
  if (city) city.textContent = t('panels.death_city');
  const spot = document.getElementById('death-spot');
  if (spot) {
    // Ключ death_cost уже был в словарях, но не использовался никогда.
    // Через replaceChildren, а не innerHTML: переводы — данные, а разметка.
    const cost = document.createElement('small');
    cost.textContent = t('panels.death_cost');
    spot.replaceChildren(document.createTextNode(t('panels.death_spot')), cost);
  }
  // Потеря золота по карме: показывается только когда что-то потеряно,
  // иначе строка мигает «0» у игроков, которым карма ни при чём.
  const karma = document.getElementById('death-karma');
  if (karma) {
    const lost = Number(payload?.karmaDropGold ?? 0);
    if (lost > 0) {
      karma.textContent = t('panels.death_karma_drop').replace('{gold}', String(lost));
      karma.hidden = false;
    } else {
      karma.textContent = '';
      karma.hidden = true;
    }
  }
  const title = document.getElementById('death-title');
  if (title) title.textContent = t('world.died');
  paintCountdown();
  paintHint();
}

function paintCountdown(): void {
  const el = document.getElementById('death-countdown');
  if (el) el.textContent = String(Math.max(0, secondsLeft));
}

/** Подпись под отсчётом: то, что игрок увидит, когда экран открыт */
function paintHint(): void {
  const hint = document.getElementById('death-hint');
  if (!hint) return;
  hint.textContent = awaitingServer
    ? t('panels.death_respawning')
    : t('panels.death_auto').replace('{sec}', String(Math.max(0, secondsLeft)));
}

function setButtonsEnabled(enabled: boolean): void {
  for (const id of ['death-city', 'death-spot']) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.disabled = !enabled;
  }
}

function setError(text: string | null): void {
  const el = document.getElementById('death-error');
  if (!el) return;
  el.textContent = text ?? '';
  el.classList.toggle('hidden', !text);
}
