# ========================================
# Empire of Safavids — Полная установка на сервер
# Выполняй по порядку после подключения к серверу
# ========================================

echo "=========================================="
echo "Empire of Safavids — Установка"
echo "=========================================="
echo ""

# 1. Обновляем систему
echo "[1/10] Обновление системы..."
sudo apt update && sudo apt upgrade -y

# 2. Устанавливаем Node.js
echo "[2/10] Установка Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "Node: $(node --version)"

# 3. Устанавливаем PostgreSQL
echo "[3/10] Установка PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
echo "PostgreSQL установлен"

# 4. Устанавливаем Redis
echo "[4/10] Установка Redis..."
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
echo "Redis установлен"

# 5. Устанавливаем PM2
echo "[5/10] Установка PM2..."
sudo npm install -g pm2
echo "PM2 установлен"

# 6. Настраиваем базу данных
echo "[6/10] Настройка базы данных..."
sudo -u postgres psql -c "CREATE DATABASE empire_of_safavids;" 2>/dev/null || echo "База уже существует"
sudo -u postgres psql -c "CREATE USER safavid_user WITH PASSWORD 'your_db_password';" 2>/dev/null || echo "Пользователь уже существует"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE empire_of_safavids TO safavid_user;"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET client_encoding TO 'utf8';"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET default_transaction_isolation TO 'read committed';"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET timezone TO 'UTC';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON SCHEMA public TO safavid_user;"
echo "База данных настроена"

# 7. Устанавливаем зависимости сервера
echo "[7/10] Установка зависимостей сервера..."
cd ~/deploy/server
npm install
echo "Зависимости установлены"

# 8. Настраиваем .env
echo "[8/10] Настройка .env..."
if [ -f .env ]; then
    sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=your_db_password/g" .env
    sed -i "s/JWT_SECRET=.*/JWT_SECRET=dev-secret-change-me-to-something-secure/g" .env
    sed -i "s/CLIENT_ORIGIN=.*/CLIENT_ORIGIN=http:\/\/localhost:8080,http:\/\/localhost:3000,https:\/\/game.eos-gameonline.com/g" .env
else
    echo ".env not found, creating..."
    cp .env.example .env
    sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=your_db_password/g" .env
    sed -i "s/JWT_SECRET=.*/JWT_SECRET=dev-secret-change-me-to-something-secure/g" .env
    sed -i "s/CLIENT_ORIGIN=.*/CLIENT_ORIGIN=http:\/\/localhost:8080,http:\/\/localhost:3000,https:\/\/game.eos-gameonline.com/g" .env
fi
echo ".env настроен"

# 9. Собираем клиент
echo "[9/10] Сборка клиента..."
cd ~/deploy/client
if [ -d "node_modules" ]; then
    npm run build
else
    npm install
    npm run build
fi
mkdir -p ~/deploy/server/web/game
cp -r web/game/* ~/deploy/server/web/game/
echo "Клиент собран"

# 10. Запускаем сервер
echo "[10/10] Запуск сервера..."
cd ~/deploy/server
pm2 delete eos-server 2>/dev/null || true
pm2 start src/index/index.ts --name eos-server
pm2 save
pm2 startup
echo "Сервер запущен"

# Открываем порты
sudo ufw allow 3000/tcp 2>/dev/null || true
sudo ufw allow 80/tcp 2>/dev/null || true
sudo ufw enable 2>/dev/null || true
echo "Порты открыты"

echo ""
echo "=========================================="
echo "✅ Установка завершена!"
echo ""
echo "Игра доступна по адресу:"
echo "https://game.eos-gameonline.com/game/"
echo ""
echo "Проверь статус:"
echo "  pm2 status"
echo "  curl http://localhost:3000/health"
echo "=========================================="