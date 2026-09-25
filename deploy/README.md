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
# пароль: REDACTED
```

Или через **WinSCP**: хост `45.32.220.58`, пользователь `root`, пароль `REDACTED`.

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

```bash
# На сервере
cd ~/deploy
git pull   # если репозиторий клонирован, либо снова scp deploy/
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Миграции БД применятся автоматически перед стартом сервера.

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
