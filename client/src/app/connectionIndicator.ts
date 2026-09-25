// ============================================================
// Connection Status Indicator — Empire of Safavids
// ============================================================
// Показывает состояние WebSocket-соединения в HUD.

import { onConnectionStateChange, ConnectionState } from './net';

/** Создать индикатор состояния соединения в HUD */
export function initConnectionIndicator(): void {
  const box = document.getElementById('toasts');
  if (!box) return;

  const el = document.createElement('div');
  el.id = 'conn-status';
  el.className = 'conn-status conn-status--disconnected';
  el.textContent = '● Отключено';
  el.style.cssText = `
    position: fixed; bottom: 16px; right: 16px;
    padding: 8px 16px; border-radius: 8px;
    background: rgba(0,0,0,0.75); color: #ff6b6b;
    font-size: 13px; font-weight: 600;
    z-index: 9999; pointer-events: none;
    transition: all 0.3s ease;
    opacity: 0;
  `;
  box.append(el);

  // Скрываем через секунду при старте
  setTimeout(() => { el.style.opacity = '0'; }, 3000);

  onConnectionStateChange((state: ConnectionState) => {
    switch (state) {
      case 'connected':
        el.className = 'conn-status conn-status--connected';
        el.textContent = '● Подключено';
        el.style.color = '#51cf66';
        el.style.opacity = '1';
        setTimeout(() => { el.style.opacity = '0'; }, 3000);
        break;
      case 'reconnecting':
        el.className = 'conn-status conn-status--reconnecting';
        el.textContent = '🔄 Переподключение…';
        el.style.color = '#ffd43b';
        el.style.opacity = '1';
        break;
      case 'connecting':
        el.className = 'conn-status conn-status--connecting';
        el.textContent = '🔄 Подключение…';
        el.style.color = '#ffd43b';
        el.style.opacity = '1';
        break;
      case 'disconnected':
      default:
        el.className = 'conn-status conn-status--disconnected';
        el.textContent = '● Отключено';
        el.style.color = '#ff6b6b';
        el.style.opacity = '1';
        break;
    }
  });
}
