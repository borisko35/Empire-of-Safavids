# 👨‍💻 Руководство для Разработчиков — Empire of Safavids

## Быстрый старт

```bash
git clone https://gitlab.com/sigma-arena-games-group/empire-of-sefevids.git
cd empire-of-sefevids

# Запуск инфраструктуры
docker-compose up -d

# Установка зависимостей сервера
cd server && npm install

# Запуск в режиме разработки
npm run dev

# Тесты
npm test
npm run test -- --coverage
```

## Структура проекта

```
server/src/
├── data/          # Базы данных (предметы, монстры, квесты, данжи)
├── middleware/    # auth, rateLimiter
├── routes/        # REST API маршруты
├── services/      # Бизнес-логика (БД, аукцион, гильдии)
├── socket/        # Socket.IO обработчики
├── systems/       # Игровые системы (AI, карма, прокачка)
├── tests/         # Jest тесты
└── types/         # TypeScript типы
```

## Соглашения по коду

### Называние веток

```
feat/     — новая функциональность
fix/      — исправление бага
chore/    — технические задачи
docs/     — документация
test/     — тесты
refactor/ — рефакторинг
```

### Commit сообщения

```
feat: add KarmaSystem with PvP zones
fix: correct damage calculation for Sufi Mystic
docs: update API reference for auction endpoints
```

### Код-стайл

- TypeScript strict mode — обязательно
- Названия: `camelCase` для переменных, `PascalCase` для классов
- Комментарии на русском языке для игровых сущностей
- Каждый новый сервис/система — отдельный файл
- Тесты обязательны для новых систем

## Рабочий процесс

1. Создайте ветку от `main`
2. Реализуйте задачу
3. Напишите тесты
4. Создайте Merge Request в GitLab
5. Пройдите Code Review
6. Пройдите CI/CD pipeline

## Переменные окружения

Создайте файл `.env` в `server/`:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=empire_of_safavids
DB_USER=safavid_user
DB_PASSWORD=safavid_pass
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
CLIENT_ORIGIN=http://localhost:8080
LOG_LEVEL=debug
```

## Полезные команды

```bash
# Тесты с покрытием
npm test -- --coverage

# Линтинг
npm run lint

# Сборка
npm run build

# Просмотр логов БД
docker-compose logs postgres

# Подключение к pgAdmin
open http://localhost:5050

# Применение SQL-миграций из database/migrations
npm run migrate
```
