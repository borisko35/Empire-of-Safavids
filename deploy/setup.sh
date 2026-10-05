#!/bin/bash
# Empire of Safavids — Полная установка на VPS (один скрипт)
# Запусти: bash setup.sh

set -e

echo "=========================================="
echo "Empire of Safavids — Установка"
echo "=========================================="

# Обновление
echo "[1/8] Обновление системы..."
apt update && apt upgrade -y

# Node.js
echo "[2/8] Установка Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PostgreSQL
echo "[3/8] Установка PostgreSQL..."
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Redis
echo "[4/8] Установка Redis..."
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server

# PM2
echo "[5/8] Установка PM2..."
npm install -g pm2

# База данных
echo "[6/8] Настройка базы данных..."
sudo -u postgres psql -c "CREATE DATABASE empire_of_safavids;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER safavid_user WITH PASSWORD 'your_db_password';" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE empire_of_safavids TO safavid_user;"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET client_encoding TO 'utf8';"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET default_transaction_isolation TO 'read committed';"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET timezone TO 'UTC';"

# Зависимости сервера
echo "[7/8] Установка зависимостей..."
cd /root/deploy/server
npm install
cp .env.example .env
sed -i "s/your_secure_password/your_db_password/g" .env

# Клиент
echo "[8/8] Сборка клиента..."
cd /root/deploy/client
npm install
npm run build
mkdir -p /root/deploy/server/web/game
cp -r web/game/* /root/deploy/server/web/game/

# Запуск
cd /root/deploy/server
pm2 delete eos-server 2>/dev/null || true
pm2 start src/index/index.ts --name eos-server
pm2 save

# Firewall
ufw allow 3000/tcp 2>/dev/null || true
ufw allow 80/tcp 2>/dev/null || true
ufw enable 2>/dev/null || true

echo ""
echo "=========================================="
echo "✅ ГОТОВО!"
echo ""
echo "Игра доступна: https://game.eos-gameonline.com/game/"
echo ""
echo "Проверь:"
echo "  pm2 status"
echo "  curl http://localhost:3000/health"
echo "=========================================="