// Загрузка .env ДО остальных модулей: импорты в ESM выполняются сверху вниз,
// и пул БД создаётся на этапе импорта сервисов — поэтому конфиг должен
// подставиться до любого импорта, который дойдёт до DatabaseService.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const _envCandidates = ['.env', '../.env', '../../.env'];
const _envPath = _envCandidates
  .map((c) => path.resolve(process.cwd(), c))
  .find((p) => fs.existsSync(p));

if (_envPath) {
  dotenv.config({ path: _envPath });
}

export {};
