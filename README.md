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
| Клиент | TypeScript (в разработке) |

## 📁 Структура проекта

```
empire-of-sefevids/
├── client/          # Клиент (TypeScript: системы активов)
├── server/          # Game Server (Node.js + TS). Конфиги в server/
├── shared/          # Общие типы и константы (server + client)
├── database/        # SQL-миграции (применяются: npm run migrate)
├── docs/            # Документация
├── tools/           # Вспомогательные инструменты (monitoring)
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
