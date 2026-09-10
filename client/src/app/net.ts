// ============================================================
// Socket.IO — Empire of Safavids
// ============================================================
// Тот же origin: в prod страница /game на :3000, в dev — прокси
// с :8080 (см. vite.config.ts).

import { io, Socket } from 'socket.io-client';

export const socket: Socket = io({ autoConnect: false });

/** Одноразовое ожидание события (для понятных ошибок подключения) */
export function onceError(handler: (payload: { message?: string }) => void): void {
  socket.once('auth:error', handler);
}
