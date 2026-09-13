# Развёртывание на VPS — Empire of Safavids

Пошаговая инструкция: от чистого Ubuntu-сервера до работающей игры
на `https://ваш-домен`, доступной с любого компьютера через браузер.

## Что понадобится

- VPS: 2 vCPU / 4 GB RAM / 20 GB диска (Ubuntu 22.04+ или Debian 12)
- Домен, у которого **A-запись указывает на IP сервера**
- Открытые порты **80** и **443**

## 1. Установить Docker

```bash
curl -fsSL https://get.docker.com | sh
```

## 2. Получить код игры

```bash
apt install -y git
git clone <адрес-репозитория> /opt/empire
cd /opt/empire
```

## 3. Создать конфигурацию

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Заполните три значения:

| Переменная | Что указать |
|---|---|
| `DOMAIN` | ваш домен, например `game.example.com` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 16` |
| `JWT_SECRET` | `openssl rand -hex 32` |

## 4. Запустить

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Первый запуск: сборка ~3–5 минут, выпуск сертификата Let's Encrypt —
до минуты после старта (нужен доступный извне порт 80).

Проверка:

```bash
curl https://ваш-домен/health      # {"status":"ok",...}
```

Затем откройте `https://ваш-домен` в браузере — лендинг, кнопка
«Играть», регистрация, и игра.

## Что поднимается

| Сервис | Роль |
|---|---|
| `caddy` | единственная точка входа: HTTPS (сертификаты сами продлеваются), прокси на клиент |
| `client` | лендинг `/`, игра `/game/`, прокси `api/locales/socket.io/download` на сервер |
| `migrate` | разовый прогон SQL-миграций перед стартом сервера |
| `server` | игровой сервер (Socket.IO + REST) |
| `postgres` | база, данные в томе `pg_data` |
| `redis` | сессии, позиции, pub/sub, данные в томе `redis_data` |

Наружу открыты только порты 80/443; база, Redis и сервер — во
внутренней сети compose.

## Обновление игры

```bash
cd /opt/empire
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Новые SQL-миграции применятся сервисом `migrate` автоматически
(до старта обновлённого сервера). Игроки, находящиеся в мире,
переподключатся после рестарта.

## Резервная копия базы

```bash
# снять
docker compose -f deploy/docker-compose.prod.yml exec postgres \
  pg_dump -U safavid_user empire_of_safavids > backup_$(date +%F).sql

# восстановить
cat backup_2026-09-13.sql | docker compose -f deploy/docker-compose.prod.yml exec -T postgres \
  psql -U safavid_user -d empire_of_safavids
```

Рекомендуется ночной cron с выгрузкой в внешний storage.

## Диагностика

```bash
docker compose -f deploy/docker-compose.prod.yml ps          # статус
docker compose -f deploy/docker-compose.prod.yml logs -f server   # логи сервера
docker compose -f deploy/docker-compose.prod.yml logs -f caddy    # сертификаты/прокси
```

Частые проблемы:

- **Сертификат не выпускается** — проверьте A-запись домена
  (`dig +short ваш-домен`) и что порты 80/443 не закрыты файрволом.
- **502 от Caddy** — клиент ещё собирается; подождите минуту,
  `logs -f client`.
- **Сервер перезапускается** — `logs -f server`: чаще всего неверный
  `POSTGRES_PASSWORD`/`JWT_SECRET` в `deploy/.env` после смены — при
  смене пароля БД нужно пересоздать том `pg_data` или поменять пароль
  через psql.

## Безопасность

- Секреты живут только в `deploy/.env` — файл не коммитится
  (добавьте в `.gitignore`).
- SSH на сервере — по ключу, парольный вход отключить.
- База и Redis не торчат наружу; для админ-доступа к БД — SSH-туннель:
  `ssh -L 5433:postgres:5432 user@vps`, затем подключение на
  `localhost:5433`.
