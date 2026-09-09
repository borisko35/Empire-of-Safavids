# Empire of Safavids — API Reference

## Базовый URL

```
https://api.empire-of-safavids.com/api
```

Все защищённые маршруты требуют заголовок:
```
Authorization: Bearer <token>
```

---

## Авторизация

### `POST /auth/register`
Регистрация нового аккаунта.

**Body:**
```json
{ "username": "Rustam", "email": "user@mail.com", "password": "min8chars" }
```
**Response `201`:**
```json
{ "message": "Account created successfully", "userId": "uuid" }
```

### `POST /auth/login`
Вход в аккаунт.

**Body:**
```json
{ "email": "user@mail.com", "password": "password" }
```
**Response `200`:**
```json
{ "token": "session-token", "jwtToken": "jwt", "userId": "uuid", "username": "Rustam" }
```

### `POST /auth/logout`
Выход. Требует `Authorization` заголовок.

---

## Персонажи

### `GET /characters`
Список персонажей текущего пользователя.

### `POST /characters`
Создание персонажа.

**Body:**
```json
{ "name": "Ismail", "class": "qizilbash" }
```

**Классы:** `qizilbash` | `sufi_mystic` | `persian_archer` | `bazaar_merchant` | `court_diplomat`

### `GET /characters/:id/skills`
Навыки персонажа.

---

## Игровой Мир

### `GET /world/regions`
Список регионов с количеством онлайн-игроков.

### `GET /world/regions/:id`
Информация о регионе.

---

## Аукцион

### `GET /game/auction`
Поиск лотов.

**Query params:** `itemId`, `maxPrice`, `minEnhancement`, `limit` (default 50), `offset`

### `POST /game/auction/list`
Разместить лот.

**Body:**
```json
{
  "characterId": "uuid",
  "itemId": "wpn_iron_sword",
  "quantity": 1,
  "enhancement": 5,
  "price": 10000,
  "buyoutPrice": 15000,
  "durationHours": 24
}
```

### `POST /game/auction/:listingId/buy`
Купить лот.

### `DELETE /game/auction/:listingId`
Отменить лот.

---

## Крафтинг

### `GET /game/crafting/recipes`
Список рецептов.

**Query:** `category` — `blacksmithing` | `tailoring` | `alchemy` | `cooking` | `jewelcrafting` | `carpentry`

### `POST /game/crafting/start`
Начать крафтинг.

**Body:**
```json
{ "characterId": "uuid", "recipeId": "recipe_iron_sword", "craftingSkillLevel": 10 }
```

### `POST /game/crafting/:jobId/complete`
Завершить крафтинг.

---

## Гильдии

### `POST /game/guilds`
Создать гильдию.

**Body:** `{ "leaderId": "uuid", "name": "Safavid Guard", "description": "..." }`

### `GET /game/guilds/:guildId`
Информация о гильдии + список членов.

### `POST /game/guilds/:guildId/invite`
Пригласить игрока.

### `POST /game/guilds/:guildId/kick`
Исключить игрока.

### `POST /game/guilds/:guildId/deposit`
Пополнить казну гильдии.

---

## Квесты

### `GET /game/quests`

**Query:** `type` — `main` | `side` | `daily` | `guild` | `world` | `class`

### `GET /game/quests/:questId`

---

## Данжи

### `GET /game/dungeons`

**Query:** `level` — фильтр по уровню

### `GET /game/dungeons/:dungeonId`

---

## Мировые Боссы

### `GET /game/world-bosses`

---

## Магазины

### `GET /game/shops`
Список всех NPC-магазинов.

### `GET /game/shops/:shopId`

---

## Socket.IO События

### Подключение

```js
const socket = io('wss://api.empire-of-safavids.com', {
  transports: ['websocket']
});
```

### Аутентификация

```js
// Отправить
socket.emit('auth', { token: 'session-token', characterId: 'uuid' });

// Получить
socket.on('auth:success', ({ character }) => { /* ... */ });
socket.on('auth:error',   ({ message })   => { /* ... */ });
```

### Движение

```js
socket.emit('player:move', {
  position:  { x: 10, y: 0, z: 5 },
  direction: { x: 1,  y: 0, z: 0 }
});

socket.on('player:moved', ({ characterId, position, direction, timestamp }) => {});
socket.on('player:joined', ({ characterId, name, class: cls, position }) => {});
socket.on('player:left',   ({ characterId }) => {});
```

### Бой

```js
socket.emit('combat:action', {
  characterId: 'uuid',
  actionType:  'skill',       // 'attack' | 'skill' | 'dodge' | 'block' | 'ultimate'
  skillId:     'qiz_slash',
  targetId:    'target-uuid',
  position:    { x: 0, y: 0, z: 0 },
  direction:   { x: 1, y: 0, z: 0 },
  timestamp:   Date.now()
});

socket.on('combat:result', ({ attackerId, targetId, damage, isCritical, isBlocked, isDodged }) => {});
socket.on('combat:hit',    ({ attackerId, damage, isCritical }) => {});
socket.on('combat:visual', ({ attackerId, targetId, actionType, skillId, position }) => {});
```

### Чат

```js
socket.emit('chat:message', {
  message: 'Привет!',
  channel: 'region'  // 'world' | 'region' | 'guild' | 'party'
});

socket.on('chat:world',  ({ characterId, message, timestamp }) => {});
socket.on('chat:region', ({ characterId, message, timestamp }) => {});
```

### Уведомления

```js
socket.on(`player:notification:${characterId}`, ({ type, titleRu, bodyRu, data }) => {});
```

### Игровое время

```js
socket.on('world:time_update', ({ gameHour, gameDay, gameMonth, gameYear, timeOfDay, season, weather }) => {});
```

---

## Коды ошибок

| Код | Описание |
|------|----------|
| 400  | Неверный запрос |
| 401  | Не авторизован |
| 403  | Нет доступа |
| 404  | Не найдено |
| 409  | Конфликт (уже существует) |
| 429  | Превышен лимит запросов |
| 500  | Ошибка сервера |
