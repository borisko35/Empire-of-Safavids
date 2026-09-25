// ============================================================
// Socket.IO — Empire of Safavids
// ============================================================
// Тот же origin: в prod страница /game на :3000, в dev — прокси
// с :8080 (см. vite.config.ts).
// Поддержка автоматического переподключения с экспоненциальной
// задержкой и отслеживанием состояния соединения.

import { io, Socket } from 'socket.io-client';

/** Состояние подключения */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

const socket: Socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 15000,
  randomizationFactor: 0.5,
  timeout: 20000,
  transports: ['websocket', 'polling'],
});

/** Текущее состояние соединения */
let connectionState: ConnectionState = 'disconnected';
const stateListeners: Set<(state: ConnectionState) => void> = new Set();

socket.on('connect', () => {
  connectionState = 'connected';
  notifyStateListeners();
});

socket.on('disconnect', (reason) => {
  connectionState = reason === 'io server disconnect' ? 'reconnecting' : 'disconnected';
  notifyStateListeners();
});

socket.on('connect_error', () => {
  connectionState = 'reconnecting';
  notifyStateListeners();
});

socket.on('reconnect', () => {
  connectionState = 'connected';
  notifyStateListeners();
});

socket.on('reconnecting', () => {
  connectionState = 'reconnecting';
  notifyStateListeners();
});

function notifyStateListeners(): void {
  for (const listener of stateListeners) {
    try { listener(connectionState); } catch { /* игнорируем */ }
  }
}

/** Подписка на изменение состояния соединения */
export function onConnectionStateChange(listener: (state: ConnectionState) => void): () => void {
  stateListeners.add(listener);
  listener(connectionState); // Немедленный вызов с текущим состоянием
  return () => { stateListeners.delete(listener); };
}

/** Текущее состояние соединения */
export function getConnectionState(): ConnectionState {
  return connectionState;
}

/** Одноразовое ожидание события (для понятных ошибок подключения) */
export function onceError(handler: (payload: { message?: string }) => void): void {
  socket.once('auth:error', handler);
}

/** Проверка, подключён ли клиент */
export function isConnected(): boolean {
  return socket.connected;
}

export { socket };
