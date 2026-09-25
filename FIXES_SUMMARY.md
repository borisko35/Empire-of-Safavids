# 🔧 Empire of Safavids — Изменения сервера и клиента

## Фаза 1: Критические исправления (исправлены)

### 🔴 Критические баги

| # | Файл | Описание |
|---|------|----------|
| 1 | `server/package.json` | Дублирующиеся scripts, `main` на неверный путь, отсутствовал `"type": "module"` |
| 2 | `server/src/index/index.ts` | `void shutdown` — лишний `void` |
| 3 | `server/src/middleware/auth.ts` | Нет проверки бана — добавлен `bannedCheck` + `secureMiddleware` |
| 4 | `server/tsconfig.json` | `commonjs` при `"type": "module"`, неверный `rootDir` |
| 5 | `server/Dockerfile` | `CMD` указывал на `dist/server/src/index/index.js` |
| 6 | `server/scripts/service-runner.js` | Аналогичная проблема с путём |

### 🛡️ Безопасность
- Добавлен `express.urlencoded()` парсер
- `badJsonHandler` ловит невалидный JSON
- Helmet усилен (`crossOriginEmbedderPolicy: false`)
- Все API-маршруты защищены `secureMiddleware` (auth + banned check)
- Логирование запросов (`requestLogger`)

### 🗄️ База данных — новые миграции
| # | Файл | Таблицы |
|---|------|---------|
| 9 | `010_dungeons.sql` | `dungeon_sessions`, `dungeon_members`, `dungeon_boss_progress`, `dungeon_history`, `dungeon_attempts` |
| 10 | `011_parties.sql` | `parties`, `party_members`, `party_progress`, `party_invites` |
| 11 | `012_trade.sql` | `trade_contracts`, `trade_history`, `trade_listings` |
| 13 | `013_admin.sql` | `users.is_admin`, `users.admin_role` |

### 🏗️ Инфраструктура
- `server/src/middleware/errorHandler.ts` — глобальный обработчик ошибок
- `server/src/middleware/requestLogger.ts` — логирование запросов
- `server/src/middleware/adminCheck.ts` — проверка прав администратора
- `server/src/routes/admin.ts` — admin API (ban, mute, teleport, give-item, give-gold, set-level, violations, logs, online, stats)
- `server/src/services/AdminService.ts` — добавлен `getServerStats()`

### 📊 Статистика фазы 1
**15 файлов**: 3 новых (errorHandler.ts, requestLogger.ts, adminCheck.ts), 12 изменённых

---

## Фаза 2: Новые фичи (добавлены)

### 🎮 Клиент — Reconnection

| Файл | Описание |
|------|----------|
| `client/src/app/net.ts` | Обновлен: `autoConnect: false`, reconnection с экспоненциальной задержкой, трекинг состояния, `onConnectionStateChange()`, `getConnectionState()`, `isConnected()` |
| `client/src/app/world.ts` | Добавлен обработчик `reconnect` — тост "Соединение восстановлено!" |
| `client/src/app/connectionIndicator.ts` | **Новый файл** — HUD индикатор состояния WebSocket (подключено/переподключение/отключено) |
| `client/src/app/main.ts` | Инициализация `initConnectionIndicator()` при старте |
| `shared/locales/ru.json` | Добавлен `"reconnected"` |
| `shared/locales/en.json` | Добавлен `"reconnected"` |
| `shared/locales/az.json` | Добавлен `"reconnected"` |

### 🛡️ Сервер — Админ-панель

| Файл | Описание |
|------|----------|
| `database/migrations/013_admin.sql` | `users.is_admin`, `users.admin_role` |
| `server/src/routes/admin.ts` | **Новый файл** — 10 эндпоинтов: search, ban, unban, mute, teleport, give-item, give-gold, set-level, violations, logs, online, stats |
| `server/src/middleware/adminCheck.ts` | **Новый файл** — проверка admin-прав + `seniorAdminCheck` |
| `server/src/services/AdminService.ts` | Добавлен `getServerStats()` |
| `server/src/index/index.ts` | Добавлен `adminRouter` |
| `server/src/routes/auth.ts` | `logout`/`logout-all` вернуты на `authMiddleware` (не блокировать баненных) |

### 📊 Статистика фазы 2
**10+ файлов**: 4 новых (connectionIndicator.ts, admin.ts, adminCheck.ts, 013_admin.sql), 6+ изменённых

---

## Фаза 3: Играбельность + Контент (добавлены)

### 🎓 Туториал

| Файл | Описание |
|------|----------|
| `server/src/services/TutorialService.ts` | **Новый** — 9 шагов: движение → камера → атака → навыки → NPC → инвентарь → магазин → охота → завершение |
| `server/src/routes/tutorial.ts` | **Новый** — steps, progress, advance, skip |
| `client/src/app/tutorial.ts` | **Новый** — оверлей с прогресс-баром, подсветкой целей, кнопками "Далее"/"Пропустить" |

### ☠️ Экран смерти + респавн

| Файл | Описание |
|------|----------|
| `client/src/app/deathScreen.ts` | **Новый** — оверлей с таймером 10 сек, кнопки "Возродиться в городе" / "На месте (5% золота)" |
| `client/src/app/world.ts` | Инициализация `initDeathScreen()` при входе в мир |

### 📊 Leaderboard / Рейтинги

| Файл | Описание |
|------|----------|
| `server/src/services/LeaderboardService.ts` | **Новый** — 5 типов рейтинга (level, pvp, kills, quests, playtime),_RANK() OVER, позиция игрока |
| `server/src/routes/leaderboard.ts` | **Новый** — GET /:type, GET /:type/me |
| `client/src/app/panels.ts` | Панель рейтинга с табами, топ-20, медалями 🥇🥈🥉 |

### 👥 Система друзей

| Файл | Описание |
|------|----------|
| `server/src/services/FriendsService.ts` | **Новый** — запросы, принятие, удаление, блокировка, список друзей |
| `server/src/routes/friends.ts` | **Новый** — GET /, POST /request, POST /accept, DELETE /:id, POST /block |
| `client/src/app/panels.ts` | Панель друзей: онлайн-статус, принятие запросов, удаление |

### 🗄️ База данных

| Файл | Таблицы |
|------|---------|
| `014_friends_leaderboard_tutorial.sql` | `friends`, `leaderboard`, `tutorial_progress` |

### 🎮 Контент × расширение

**Предметы** (~30 новых):
- 🧪 Зелья: малое/среднее HP, малая мана, стамина, кебаб
- 🛡️ Броня: железная кольчуга, кожаная броня, пластинчатая броня Шаха
- 💍 Аксессуары: нефритовый перстень, амулет Сефевидов, сапоги Шёлкового Пути
- 🧱 Материалы: шёлковая нить, лепестки роз
- 📜 Квестовые: Печать Шаха, Фрагмент Древней Карты
- ⚔️ Легендарное: Шамшир Аламута, Лук Мастеров Исфахана

**Монстры** (~10 новых):
- 🦂 Пустынный скорпион (ур. 3, Тебриз)
- 🐺 Серый волк (ур. 6, Тебриз)
- 🗡️ Разбойник с Большой Дороги (ур. 8, Тебриз)
- 🗡️ Послушник ассасинов (ур. 22, Исфахан)
- 🌊 Песчанный элементаль (ур. 30, элита, Исфахан)
- 💀 Неживой страж (ур. 45, элита, Шираз)

**Квесты** (~10 новых):
- Побочные Тебриза: Гнездо скорпионов, Волчьи шкуры
- Побочные Исфахана: Шёлковый Путь, Песчаная буря
- Побочные Шираза: Проклятое кладбище
- Ежедневные: Патрулирование дорог, Сбор трав

### 🌐 Локализации
- `ru.json`, `en.json`, `az.json` — ключи для рейтингов, друзей, туториала, экрана смерти

### 📊 Статистика фазы 3
**20+ файлов**: 8 новых (FriendsService, LeaderboardService, TutorialService, friends routes, leaderboard routes, tutorial routes, deathScreen.ts, tutorial.ts, 014_migration), 5+ изменённых

---

## Фаза 4: Неожиданные фичи + Продвижение (добавлены)

### ♟️ Шахматы Шаха — мини-игра

| Файл | Описание |
|------|----------|
| `server/src/systems/ChessOfTheShah.ts` | **Новый** — Шахматы 6×6 со ставками золотом. AI-противник с эвристикой (приоритет взятий). Мат/пат, продвижение пешки. |
| `server/src/routes/minigames.ts` | **Новый** — API: /start, /move, /state/:id, /resign |
| `client/src/app/panels.ts` | UI: шахматная доска 6×6 с Unicode-фигурами, ставка золотом, ходы кликами |

### 📜 Стихи Хафиза — поэтическая мини-игра

| Файл | Описание |
|------|----------|
| `server/src/systems/PoetryOfHafiz.ts` | **Новый** — 5 стихотворений Хафиза Ширази (3 уровня сложности). Собрать строки в правильном порядке. Награда: золото + опыт + титул. |
| `server/src/routes/poetry.ts` | **Новый** — API: /challenges, /start, /select, /undo, /quit |
| `client/src/app/panels.ts` | UI: выбор строк, отмена, результат с анимацией |

### 📚 Хроники Сефевидов — внутриигровая энциклопедия

| Файл | Описание |
|------|----------|
| `server/src/services/ChroniclesService.ts` | **Новый** — 12 записей по 5 категориям: история, культура, география, биографии, мифология. Открываются по мере прохождения квестов. |
| `server/src/routes/chronicles.ts` | **Новый** — API: /, /category/:cat, /:id |
| `client/src/app/panels.ts` | UI: карточки записей с модальным окном, фильтрация по категориям |

### 🌐 SEO + Лендинг (продвижение)

| Файл | Описание |
|------|----------|
| `client/web/index.html` | Open Graph, Twitter Card, JSON-LD структурированные данные, canonical URL |
| `client/web/index.html` | Новые секции: Скриншоты, Особенности, Сообщество (Discord/Twitter/Reddit/IndieDB), FAQ (5 вопросов), Системные требования |
| `shared/locales/*.json` | ~60 новых ключей для всех секций лендинга + мини-игр |

### 📊 Статистика фазы 4
**12+ файлов**: 6 новых (ChessOfTheShah, PoetryOfHafiz, ChroniclesService, minigames routes, poetry routes, chronicles routes), 5+ изменённых (index.ts, panels.ts, api.ts, styles.css, index.html, 3 locale files)

---

## Фаза 5: Глубокий геймплей (добавлено)

### 🏴 Гильдии / Ордены Кызылбашей

| Файл | Описание |
|------|----------|
| `server/src/services/GuildService.ts` | **Новый** — создание, вступление, ранги, банк, вклад золота/предметов, логи |
| `server/src/routes/guilds.ts` | **Новый** — 10 эндпоинтов: create, join, leave, members, rank, deposit, bank, kick, search |
| `database/migrations/015_*.sql` | Таблицы `guilds`, `guild_members`, `guild_logs`, `guild_bank` |

### ⭐ Достижения (20+)

| Файл | Описание |
|------|----------|
| `server/src/services/AchievementService.ts` | **Новый** — 20 достижений по 6 категориям (бой, исследование, соц., крафт, квесты, секретные) |
| Награды | Золото, опыт, титулы ("Истребитель", "Герой Империи", "Шахматный Гений") |

### 📋 Ежедневные / Еженедельные задачи

| Файл | Описание |
|------|----------|
| `server/src/services/DailyTaskService.ts` | **Новый** — 8 ежедневных + 2 еженедельных задач с автосбросом |
| Задачи | Убить N монстров, пройти подземелья, выполнить квесты, выиграть PvP, скрафтить, собрать ресурсы |

### 📊 Репутация с фракциями

| Файл | Описание |
|------|----------|
| `server/src/services/ReputationService.ts` | **Новый** — 4 фракции (Кызылбаши, Суфии, Торговцы, Ассасины), 5 рангов каждая |
| `database/migrations/015_*.sql` | Таблица `character_reputation` |

### 🐺 Питомцы

| Файл | Описание |
|------|----------|
| `server/src/services/PetService.ts` | **Новый** — 6 питомцев (волк, сокол, кошка, кобра, птенец Симурга, дракон), прокачка, смена |
| `database/migrations/016_*.sql` | Таблицы `pets`, `character_pets` |

### 🏠 Дом / Недвижимость

| Файл | Описание |
|------|----------|
| `server/src/services/HousingService.ts` | **Новый** — 5 типов домов (хижина→дворец), 8 украшений, улучшение, бонусы крафта |
| `database/migrations/016_*.sql` | Таблицы `player_houses`, `house_decorations` |

### 🏟️ PvP Арена

| Файл | Описание |
|------|----------|
| `server/src/services/PvPService.ts` | **Новый** — матчмейкинг по рейтингу, расчёт Elo, 5 тиров (бронза→легенда), история боёв |
| `database/migrations/016_*.sql` | Таблицы `pvp_arena`, `pvp_rankings` |

### 🏰 Бесконечная Башня

| Файл | Описание |
|------|----------|
| `server/src/services/EndGameService.ts` | **Новый** — генерация этажей, награды за каждые 5 (босс), лидерборд |
| `database/migrations/016_*.sql` | Таблица `endless_tower` |

### 🌐 Клиент: API + UI

| Файл | Описание |
|------|----------|
| `client/src/app/api.ts` | ~40 новых методов API |
| `client/src/app/panels.ts` | 8 новых панелей: гильдия, достижения, задачи, питомцы, дом, PvP, башня, репутация |
| `shared/locales/*.json` | ~40 новых ключей для каждой локали |

### 📊 Статистика фазы 5
**25+ файлов**: 9 новых (GuildService, AchievementService, DailyTaskService, ReputationService, PetService, HousingService, PvPService, EndGameService, guilds routes, progression routes, gameplay routes, 2 миграции), 5+ изменённых (index.ts, game.ts, panels.ts, api.ts, 3 locale files)

---

## ⏭️ Что дальше (следующая фаза)

### Высокий приоритет
- [ ] **Sentry** — интеграция трекинга ошибок
- [ ] **Тесты нагрузки** — k6/artillery для WebSocket
- [ ] **Админ-панель UI** — web-интерфейс для модераторов
- [ ] **Система достижения** — подключить `AchievementSystem.ts`
- [ ] **Система питомцев** — `PetSystem.ts` + таблицы

### Средний приоритет
- [ ] Дробить монолитные файлы (`world.ts`, `world3d.ts`, `terrain.ts`, `GameSocketHandler.ts`)
- [x] ~~**Leaderboard**~~ — ✅ реализован (Phase 3)
- [x] ~~**Система друзей**~~ — ✅ реализована (Phase 3)
- [x] ~~**Туториал**~~ — ✅ реализован (Phase 3)
- [ ] **Аналитика** — события посещаемости, удержание

### Низкий приоритет
- [ ] **CDN** для статики
- [ ] **Docker Compose** для разработки
- [ ] **e2e тесты** (Cypress/Playwright)
- [ ] **A/B тесты** для квестов

---

## 🧪 Как проверить

```bash
# Проверить TypeScript компиляцию сервера
cd server && npm run typecheck

# Проверить линтинг
cd server && npm run lint

# Проверить миграции (требуется PostgreSQL)
cd server && npm run migrate

# Запустить сервер в dev-режиме
cd server && npm run dev

# Проверить health
curl http://localhost:3000/health

# Проверить admin (требуется admin аккаунт)
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/admin/stats

# Проверить клиент
cd client && npm run typecheck && npm run build
```

---

## ✅ TypeScript: 0 ошибок

После фазы 2 все ошибки компиляции исправлены:
- Сервер (`server/tsconfig.json`): убран `rootDir`, `../shared` корректно включён
- Клиент: чисто
- Дополнительно исправлено 10 предсуществующих TS-ошибок:
  - `GuildService.ts` — пустой SQL-запрос в `listGuilds()`
  - `PremiumSystem.ts` — неиспользуемые `redis`/`notifications` + импорты
  - `GameSocketHandler.ts` — неиспользуемый `regenTimer`
  - `AISystem.ts` — неиспользуемый параметр `players`
  - `AntiCheatSystem.ts` — неиспользуемый параметр `characterId`
  - `auth.validation.ts` — неиспользуемый импорт `AuthError`
  - `AISystem.test.ts` / `CharacterService.test.ts` — неиспользуемые импорты

---

## 📝 Примечания

- `secureMiddleware` = `authMiddleware` + `bannedCheck` — используется на всех защищённых маршрутах
- `authMiddleware` (без banned check) — на `logout`/`logout-all`
- `adminCheck` — требует `is_admin = TRUE` в `users` таблице
- WebSocket reconnection: экспоненциальный backoff (1s → 15s), бесконечные попытки
- Connection indicator показывается в правом нижнем углу экрана
- Все локали (ru/en/az) обновлены: добавлен `"reconnected"`
