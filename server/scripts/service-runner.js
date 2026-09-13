// ============================================================
// Точка входа службы Windows — Empire of Safavids
// ============================================================
// node-windows запускает этот файл через node.exe. Здесь задаётся
// рабочий каталог (чтобы dotenv нашёл server/.env, а index — корень
// репозитория со статикой client/web), после чего загружается
// собранный сервер из dist.

const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('dotenv').config();

// Гарантируем, что БД и Redis из .env доступны; сервер дальше сам
// сообщает о проблемах подключения в лог службы.
require('../dist/server/src/index/index.js');
