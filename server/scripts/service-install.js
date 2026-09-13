// ============================================================
// Установка/удаление службы Windows — Empire of Safavids
// ============================================================
// Использование (требуются права администратора):
//   node scripts/service-install.js install   — установить и запустить
//   node scripts/service-install.js uninstall — остановить и удалить
//
// Служба называется EOS-Server, автозапуск при загрузке Windows,
// при падении процесса node-windows перезапускает его автоматически.

const path = require('path');
const Service = require('node-windows').Service;

const action = process.argv[2] ?? 'install';

const svc = new Service({
  name: 'EOS-Server',
  displayName: 'Empire of Safavids — Game Server',
  description:
    'Игровой сервер Empire of Safavids: REST API, Socket.IO и игровой цикл на порту 3000. ' +
    'Требует запущенных PostgreSQL (EOS-PostgreSQL) и Redis на 127.0.0.1.',
  script: path.join(__dirname, 'service-runner.js'),
  // Перезапуск при падении: 1, 5, 15 секунд, затем каждые 20
  maxRestarts: 10,
  maxRestartsAtIntervals: [1000, 5000, 15000, 20000],
});

svc.on('install', () => {
  console.log('[service] installed, starting...');
  svc.start();
});
svc.on('start', () => console.log('[service] EOS-Server started'));
svc.on('alreadyinstalled', () => console.log('[service] already installed'));
svc.on('invalidinstallation', () => console.log('[service] ERROR: invalid installation'));
svc.on('error', (e) => { console.error('[service] ERROR:', e); process.exitCode = 1; });
svc.on('remove', () => console.log('[service] removed'));

if (action === 'uninstall') {
  svc.remove();
} else {
  svc.install();
}
