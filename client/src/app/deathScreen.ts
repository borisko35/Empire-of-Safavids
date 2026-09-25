// ============================================================
// Death Screen — Empire of Safavids
// ============================================================
// Оверлей смерти с обратным отсчётом до респавна и выбором
// способа возрождения.

import { socket } from './net';
import { session } from './state';
import { toast } from './hud';

let overlayEl: HTMLElement | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let respawnDelay = 10;

/** Инициализировать оверлей смерти (вызывается один раз при загрузке) */
export function initDeathScreen(): void {
  // Создаём DOM-элемент при первом вызове
  overlayEl = document.createElement('div');
  overlayEl.id = 'death-overlay';
  overlayEl.className = 'death-overlay hidden';
  overlayEl.innerHTML = `
    <div class="death-content">
      <div class="death-skull">☠</div>
      <h2 class="death-title">Вы пали в бою...</h2>
      <p class="death-subtitle" id="death-killer"></p>
      <div class="death-timer" id="death-countdown">10</div>
      <p class="death-hint">Возрождение через <span id="death-sec">10</span> сек.</p>
      <div class="death-buttons">
        <button class="death-btn death-btn--free" id="death-city">Возродиться в городе</button>
        <button class="death-btn death-btn--paid" id="death-spot">Возродиться на месте <small>(5% золота)</small></button>
      </div>
    </div>
  `;
  document.body.append(overlayEl);

  // Кнопки
  document.getElementById('death-city')?.addEventListener('click', () => respawn('city'));
  document.getElementById('death-spot')?.addEventListener('click', () => respawn('spot'));

  // Слушаем событие смерти от сервера
  socket.on('player:died', (data: { killerId?: string }) => {
    showDeathScreen(data.killerId);
  });

  // Слушаем респавн
  socket.on('player:respawned', (data: { hp: number; maxHp: number; position: { x: number; y: number; z: number } }) => {
    hideDeathScreen();
    // Обновляем состояние
    session.hp = data.hp;
    session.maxHp = data.maxHp;
    if (session.character) {
      session.character.position = data.position;
    }
  });
}

/** Показать экран смерти */
function showDeathScreen(_killerId?: string): void {
  if (!overlayEl) return;
  const killerEl = document.getElementById('death-killer');
  if (killerEl) {
    killerEl.textContent = _killerId ? `Убит игроком` : 'Погиб в бою';
  }

  overlayEl.classList.remove('hidden');
  respawnDelay = 10;
  updateCountdown();

  countdownTimer = setInterval(() => {
    respawnDelay--;
    updateCountdown();
    if (respawnDelay <= 0) {
      // Автоматический респавн в городе по умолчанию
      respawn('city');
    }
  }, 1000);
}

/** Обновить отображение таймера */
function updateCountdown(): void {
  const el = document.getElementById('death-countdown');
  const secEl = document.getElementById('death-sec');
  if (el) el.textContent = String(respawnDelay);
  if (secEl) secEl.textContent = String(respawnDelay);
}

/** Скрыть экран смерти */
function hideDeathScreen(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  overlayEl?.classList.add('hidden');
}

/** Возродиться */
function respawn(type: 'city' | 'spot'): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  socket.emit('respawn', { type, characterId: session.character?.id });
  toast('Возрождение...', 'info');
  hideDeathScreen();
}
