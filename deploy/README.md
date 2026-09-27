# Empire of Safavids — Развёртывание на VPS (Docker + HTTPS)

## 📋 Что нужно подготовить заранее

| Шаг | Что сделать | Где |
|-----|-------------|-----|
| 1 | Купить домен (например `sefevids.online`) | reg.ru / namecheap / cloudflare |
| 2 | Создать A-запись домена → IP вашего VPS | панель домена |
| 3 | Убедиться, что на VPS открыты порты **80** и **443** | панель провайдера (Vultr / Timeweb / Selectel) |

> Без домена Let's Encrypt не выпустит сертификат — игра будет работать только по HTTP (не рекомендуется).

---

## 🖥 Шаг 1: Подключитесь к VPS

```powershell
# Из PowerShell (Windows)
ssh root@45.32.220.58
# пароль — ваш; в репозиторий не вносится
```

Или через **WinSCP**: хост `45.32.220.58`, пользователь `root`, пароль — ваш (хранится вне репозитория, например в менеджере паролей).

---

## 📥 Шаг 2: Загрузите файлы игры на сервер

**Способ А — scp из PowerShell** (один раз, после каждого изменения):
```powershell
scp -r "D:\My Projects\Empire of Sefevids\deploy" root@45.32.220.58:~/
```

**Способ Б — WinSCP**: перетащите папку `deploy` из левого окна в правое.

---

## ⚙️ Шаг 3: Установите Docker и Docker Compose

```bash
# Обновление и установка Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker root
newgrp docker
docker compose version
```

---

## 🔑 Шаг 4: Настройте переменные окружения

```bash
cd ~/deploy
cp .env.example .env
nano .env
```

Заполните:

```env
DOMAIN=ваш-домен.ru          # ← ваша A-запись уже должна смотреть сюда

# Пароль PostgreSQL — сгенерируйте случайный:
POSTGRES_PASSWORD=XXXXXXXXXXXXXXXX

# Секрет JWT — сгенерируйте случайный:
JWT_SECRET=YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

# Остальное можно не трогать — возьмёт значения по умолчанию
```

Сгенерировать пароли:
```bash
openssl rand -hex 16   # для POSTGRES_PASSWORD
openssl rand -hex 32   # для JWT_SECRET
```

Сохраните: **Ctrl+O → Enter → Ctrl+X**

---

## 🚀 Шаг 5: Запустите игру

```bash
cd ~/deploy
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Первый запуск может занять **5–10 минут** (скачивание образов + сборка).  
Следите за прогрессом:
```bash
docker compose -f docker-compose.prod.yml logs -f
```

Как только увидите `Empire of Safavids Server running on port 3000` — всё готово.

---

## ✅ Шаг 6: Проверка

```bash
# Статус контейнеров
docker compose -f docker-compose.prod.yml ps

# Health check
curl -s http://localhost/game/health
# → {"status":"ok","game":"Empire of Safavids","version":"0.2.0"}
```

Откройте в браузере: **https://ваш-домен.ru/game/**

---

## 🎮 Как дать доступ друзьям

Друг должен:
1. Открыть **https://ваш-домен.ru/game/** в браузере
2. Зарегистрироваться и играть

Никаких установок — игра работает прямо в браузере.

Если хотите десктопный клиент (launcher), обновите URL в `site/install/install-game.cmd`:
```batch
> "%INSTALL_DIR%\game.ini" echo URL=https://ваш-домен.ru
```
Затем пересоберите `install.zip` через `tools/build-installer.js` и залейте на сайт.

---

## 🔄 Обновление после изменений в коде

Обновление идёт в три шага, и **первый шаг обязателен**: он ничего не
меняет, но останавливает выкатку, если на сервере не нашлось файл с
секретами или команда `git` смотрит не в папку игры.

```bash
# 1. Проверка. Ничего не меняет. Если написано «ВЫКАТКУ ОСТАНОВЛЕНО» —
#    читать причину и чинить её, пересборку НЕ запускать.
bash tools/deploy-preflight.sh

# 2. Забрать изменения с GitHub
git pull origin main

# 3. Пересобрать и перезапустить
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
  up -d --force-recreate --build server client
```

**Почему проверка идёт первой.** Пересборка — это перезапуск сервера
игры. Если файл `deploy/.env` исчез, сервер не поднимется, и сайт
ляжет с 502 — при этом в логах пересборки ошибок не будет, ведь ошибка
возникает позже, при чтении настроек. Именно так было 27 сентября: файл
секретов пропал, логи были зелёные, а сайт лежал, пока искали причину.

Проверка также сверяет, куда наведён `git`. Если репозиторий указывает
на другую папку, `git pull` и `git reset` бьют не по игре, и это надо
знать ДО команды, а не после.

Миграции БД применятся автоматически перед стартом сервера. Если
миграция упала, сервер не поднимется — это сделано намеренно: лучше не
подняться, чем подняться со старой схемой базы и падать при первом
обращении игрока.

---

## 🛠 Полезные команды

```bash
# Перезапуск
docker compose -f docker-compose.prod.yml restart

# Логи
docker compose -f docker-compose.prod.yml logs -f server

# Остановить всё
docker compose -f docker-compose.prod.yml down

# Удалить volumes (сброс БД!)
docker compose -f docker-compose.prod.yml down -v
```

---

## 🔧 Если что-то не работает

| Проблема | Решение |
|----------|---------|
| `docker: command not found` | `curl -fsSL https://get.docker.com \| sh` |
| Сервер не запускается | `docker compose -f docker-compose.prod.yml logs server` |
| Ошибка `POSTGRES_PASSWORD` | Проверьте `.env` — пароль должен быть задан |
| CORS-ошибка в браузере | Убедитесь, что `DOMAIN` в `.env` совпадает с адресом в браузере |
| 502 Bad Gateway | `docker compose -f docker-compose.prod.yml ps` — проверьте, что все контейнеры `healthy` |
| Let's Encrypt не выпускает сертификат | Убедитесь, что порт 80 открыт снаружи и DNS указывает на этот VPS |
