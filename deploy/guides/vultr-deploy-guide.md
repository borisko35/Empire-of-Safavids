# Empire of Safavids — Полный гайд по развёртыванию на Vultr

## Часть 1: Создание сервера на Vultr

### 1.1 Зарегистрируйтесь на Vultr
- Перейдите на https://www.vultr.com
- Нажмите "Sign Up"
- Заполните email и пароль
- Подтвердите email

### 1.2 Добавьте платёжный метод
- Перейдите в Billing → Payment Methods
- Добавьте карту или PayPal

### 1.3 Создайте сервер
1. Dashboard → Deploy New Server
2. Выберите **Cloud Compute**
3. Выберите локацию: **Amsterdam** или **New York** (ближе к Европе)
4. Выберите план: **vx1-g-2c-8g** (2 vCPU, 8GB RAM) — $0.060/час
5. Выберите ОС: **Ubuntu 22.04 LTS x64**
6. В разделе SSH Keys:
   - Либо выберите существующий ключ
   - Либо нажмите "Create a new SSH key" и следуйте инструкциям
7. Нажмите **Deploy Now**

### 1.4 Получите IP-адрес
После деплоя вултр покажет:
- **Instance Name**: (можете назвать как угодно)
- **IP Address**: например `159.65.123.45`
- **Root Password**: сохраните его!

---

## Часть 2: Подключение к серверу

### Способ А: Через PuTTY (рекомендуется)
1. Скачайте PuTTY: https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html
2. Запустите PuTTY
3. В поле **Host Name** введите IP-адрес сервера
4. Нажмите **Open**
5. Войдите как `root` с паролем, который дал Vultr

### Способ Б: Через PowerShell (Windows)
```powershell
ssh root@159.65.123.45
```
(замените IP на ваш)

---

## Часть 3: Установка зависимостей

Выполните на сервере:

```bash
# Обновляем систему
apt update && apt upgrade -y

# Устанавливаем Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Устанавливаем PostgreSQL
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Устанавливаем Redis
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server

# Устанавливаем PM2
npm install -g pm2

# Устанавливаем Git и Nginx
apt install -y git nginx
```

---

## Часть 4: Загрузка файлов игры

### С вашего компьютера выполните:
```powershell
# Загрузите пакет с игрой
scp deploy-package.zip root@159.65.123.45:~/
```

### На сервере распакуйте:
```bash
cd ~
unzip -q deploy-package.zip
cd deploy
```

---

## Часть 5: Настройка базы данных

```bash
# Создаём базу данных
sudo -u postgres psql

# Внутри psql выполните:
CREATE DATABASE empire_of_safavids;
CREATE USER safavid_user WITH PASSWORD 'ВашСложныйПароль123';
ALTER ROLE safavid_user SET client_encoding TO 'utf8';
ALTER ROLE safavid_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE safavid_user SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE empire_of_safavids TO safavid_user;
\q
```

---

## Часть 6: Настройка сервера

```bash
# Переходим в папку сервера
cd ~/deploy/server

# Устанавливаем зависимости
npm install

# Создаём .env файл
cp .env.example .env
nano .env
```

### Редактируйте .env:
```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=empire_of_safavids
DB_USER=safavid_user
DB_PASSWORD=ВашСложныйПароль123

REDIS_URL=redis://localhost:6379

JWT_SECRET=ваш_случайный_секрет_минимум_32_символа

# CORS: разрешите доступ с любых источников (для тестирования)
CLIENT_ORIGIN=http://localhost:8080,http://localhost:3000,http://159.65.123.45:3000

LOG_LEVEL=info
```

Сохраните: **Ctrl+O**, **Enter**, **Ctrl+X**

---

## Часть 7: Применение миграций

```bash
# Найдите файлы миграций
ls ../database/migrations/

# Примените каждую миграцию (по порядку!)
sudo -u postgres psql empire_of_safavids < ../database/migrations/001_initial.sql
sudo -u postgres psql empire_of_safavids < ../database/migrations/002_*.sql
# ... и так далее
```

---

## Часть 8: Сборка клиента

```bash
# Переходим в папку клиента
cd ~/deploy/client

# Устанавливаем зависимости
npm install

# Собираем
npm run build

# Копируем файлы игры на сервер
mkdir -p ../server/web/game
cp -r web/game/* ../server/web/game/
```

---

## Часть 9: Запуск сервера

```bash
# Возвращаемся в папку сервера
cd ~/deploy/server

# Запускаем через PM2
pm2 start src/index/index.ts --name eos-server

# Сохраняем конфигурацию PM2
pm2 save

# Добавляем автозапуск при старте системы
pm2 startup
# Скопируйте выводимую команду и выполните её
```

---

## Часть 10: Настройка firewall

```bash
# Включаем UFW
ufw default deny incoming
ufw default allow outgoing

# Открываем порты
ufw allow 22/tcp      # SSH
ufw allow 3000/tcp    # Игра
ufw allow 80/tcp      # HTTP (если будете использовать Nginx)
ufw allow 443/tcp     # HTTPS

# Включаем firewall
ufw enable
```

---

## Часть 11: Проверка

```bash
# Проверка статуса сервера
pm2 status

# Проверка логов
pm2 logs eos-server

# Тест API
curl http://localhost:3000/health
```

Должно ответить: `{"status":"ok","game":"Empire of Safavids","version":"0.2.0"}`

---

## Часть 12: Доступ к игре

### Для вас:
Откройте браузер и перейдите:
```
http://159.65.123.45:3000/game/
```

### Для друзей:
Объясните им:
1. Скачать `install.zip`
2. Запустить установщик
3. Ввести URL: `http://159.65.123.45:3000`

---

## Часть 13 (опционально): Nginx + SSL

Если хотите красивый домен и HTTPS:

```bash
# Устанавливаем Certbot
apt install -y certbot python3-certbot-nginx

# Создаём конфиг Nginx
nano /etc/nginx/sites-available/eos
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /game/ {
        alias /home/root/deploy/server/web/game/;
        try_files $uri $uri/ =404;
    }
}
```

```bash
# Активируем
ln -s /etc/nginx/sites-available/eos /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# Получаем SSL-сертификат
certbot --nginx -d your-domain.com
```

---

## Полезные команды

```bash
# Управление сервером
pm2 start eos-server
pm2 stop eos-server
pm2 restart eos-server
pm2 logs eos-server
pm2 status

# Просмотр статуса сервисов
systemctl status postgresql
systemctl status redis-server

# Проверка портов
netstat -tlnp | grep -E '3000|5432|6379'
```

---

## Решение проблем

### Проблема: Сервер не запускается
```bash
# Проверьте логи
pm2 logs eos-server --lines 50

# Проверьте базу данных
sudo -u postgres psql -c "SELECT 1"

# Проверьте Redis
redis-cli ping
```

### Проблема: Ошибка подключения к БД
```bash
# Проверьте статус PostgreSQL
systemctl status postgresql

# Перезапустите
sudo systemctl restart postgresql
```

### Проблема:防火墙 блокирует порты
```bash
# Проверьте UFW
ufw status

# Откройте порты
ufw allow 3000/tcp
```
