# 🏰 Empire of Safavids — Action MMORPG

Историческая Action MMORPG, вдохновлённая эпохой Сефевидской империи (1501–1736).
Игра сочетает реальную историю с механиками современных MMORPG: Black Desert Online, Lost Ark, Throne and Liberty.

## 🎮 Ключевые особенности

- **Открытый мир** — Персия, Кавказ, Месопотамия, Анатолия
- **Динамичная боевая система** — комбо-атаки, уклонения, навыки классов
- **Классы персонажей** — Гвардеец Кызылбаш, Суфийский мистик, Персидский лучник, Базарный торговец, Придворный дипломат
- **Гильдии и кланы** — осады крепостей, территориальные войны
- **Экономика** — торговля шёлком, коврами, специями по Великому шёлковому пути
- **PvP/PvE** — битвы с Османской и Могольской империями
- **Крафтинг** — персидское оружие, доспехи, артефакты

## 🛠️ Технологический стек

| Компонент | Технология |
|-----------|------------|
| Backend | Node.js + TypeScript |
| Database | PostgreSQL + Redis |
| Networking | WebSocket (Socket.IO) |
| Auth | JWT + OAuth2 |
| DevOps | Docker + GitLab CI |
| Клиент | TypeScript + Vite + Three.js (3D от третьего лица) |

### Игровой клиент

Клиент собирается Vite (`client/package.json`). В разработке:

```bash
cd client
npm install
npm run dev      # http://localhost:8080 (API/сокеты проксируются на :3000)
```

Прод-сборка кладётся в `client/web/game` и раздаётся сервером:

```bash
npm run build    # → http://localhost:3000/game/ (кнопка «Играть» на лендинге)
```

Спрайты и 3D-мир генерируются процедурно: `node tools/generate-sprites.js`
(иконки классов для экрана выбора), рельеф/город/растительность и
персонажи с анимациями строятся кодом в `client/src/app/game3d/`.

Управление в мире: WASD — движение, Shift — бег, Пробел — прыжок,
C — присед, ЛКМ — атака, ПКМ — блок, мышь — камера (орбита 360°),
колесо — зум, 1–4 — навыки, Enter — чат, M — звук.

## 📁 Структура проекта

```
empire-of-sefevids/
├── client/          # Клиент: src/ (TS: ассеты, иконки) + web/ (лендинг)
├── server/          # Game Server (Node.js + TS). Конфиги в server/
├── shared/          # Общие типы, константы и локали ru/en/az
├── site/install/    # Установщик игры: иконка, ярлыки, лаунчер, деинсталлятор
├── database/        # SQL-миграции (применяются: npm run migrate)
├── docs/            # Документация
├── tools/           # Генераторы иконок/фона, сборщик установщика, monitoring
└── legacy/          # Архив: прототип на BYOND, конфиги автоматизации
```

## 🚀 Быстрый старт

```bash
# Клонировать репозиторий
git clone https://gitlab.com/sigma-arena-games-group/empire-of-sefevids.git
cd empire-of-sefevids

# Поднять PostgreSQL + Redis (+ pgAdmin: docker-compose --profile dev up -d)
docker-compose up -d

# Запустить миграции и сервер
cd server
npm install
cp .env.example .env          # затем при необходимости поправьте .env
npm run migrate
npm run dev

# Тесты
npm test
```

Проверить работоспособность: `curl http://localhost:3000/health`

Затем откройте веб-страницу игры: **http://localhost:3000** — лендинг с
историей Сефевидской империи (1501–1736), классами, переключателем
языков (ru/en/az) и кнопкой скачивания установщика.

### Установка игры на компьютер (Windows)

Сервер раздаёт самораспаковочный установщик:
`http://localhost:3000/download/installer` (или кнопка «Скачать для
Windows» на странице). Установщик:

- копирует лаунчер и иконку империи в `%LOCALAPPDATA%\EmpireOfSafavids`;
- создаёт ярлыки на рабочем столе и в меню «Пуск» (система ярлыков —
  `site/install/shortcuts.ps1`);
- регистрирует игру в «Установка и удаление программ»;
- лаунчер сам поднимает БД и сервер (если установщик запускался из
  репозитория) и открывает игру в браузере.

Пересборка установщика после правки `site/install/`:
`node tools/build-installer.js`.

Генераторы графических активов (без зависимостей):
`node tools/generate-icon.js` (favicon/game.ico) и
`node tools/generate-background.js` (фон-пейзаж Исфахана).

### Локальный запуск без Docker (Windows)

Если Docker не установлен, в репозитории есть портативный PostgreSQL 16
(`server/.pg`, в git не входит). Нужен только Node.js:

```cmd
dev-db-start.cmd    :: первый запуск инициализирует кластер и создаёт БД
cd server && npm run migrate && npm run dev
```

Остановить БД: `dev-db-stop.cmd`. Redis нужен запущенный на `:6379`
(любой локальный Redis/Memurai). Если у вас установлен «полноценный»
PostgreSQL — пропишите свои DB_USER/DB_PASSWORD в `server/.env`
и используйте его вместо портативного.

## 📜 Лицензия

Проприетарная лицензия © 2024 Sigma Arena Games Group
