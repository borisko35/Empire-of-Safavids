// ============================================================
// Конфигурация Vite — Empire of Safavids
// ============================================================
// Dev:   клиент на :8080, API/сокеты/локали проксируются на :3000
// Build: статика игры складывается в client/web/game — сервер
//        раздаёт её по адресу /game/ (кнопка «Играть» на лендинге)

import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/app',
  base: '/game/',
  build: {
    outDir: '../../web/game',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  server: {
    port: 8080,
    proxy: {
      '/api': 'http://localhost:3000',
      '/locales': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
