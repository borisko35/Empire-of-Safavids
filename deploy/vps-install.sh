# ========================================
# Empire of Safavids — Развёртывание на Vultr VPS
# ========================================

# Этот скрипт нужно выполнить на сервере после подключения по SSH

echo "=========================================="
echo "Empire of Safavids — Установка на VPS"
echo "=========================================="
echo ""

# 1. Обновляем систему
echo "[1/8] Обновление системы..."
sudo apt update && sudo apt upgrade -y
echo "✅ Обновлено"
echo ""

# 2. Устанавливаем Node.js 20
echo "[2/8] Установка Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
echo "✅ Node.js установлен"
echo ""

# 3. Устанавливаем PostgreSQL
echo "[3/8] Установка PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
psql --version
echo "✅ PostgreSQL установлен"
echo ""

# 4. Устанавливаем Redis
echo "[4/8] Установка Redis..."
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-server --version
echo "✅ Redis установлен"
echo ""

# 5. Устанавливаем PM2 (менеджер процессов)
echo "[5/8] Установка PM2..."
sudo npm install -g pm2
pm2 --version
echo "✅ PM2 установлен"
echo ""

# 6. Устанавливаем Git и Nginx (опционально)
echo "[6/8] Установка Git и Nginx..."
sudo apt install -y git nginx
echo "✅ Git и Nginx установлены"
echo ""

echo "=========================================="
echo "Все зависимости установлены!"
echo "=========================================="
echo ""
echo "Следующие шаги:"
echo "1. Загрузите файлы игры на сервер:"
echo "   scp -r deploy/ user@YOUR_VPS_IP:~/empire-of-safavids"
echo ""
echo "2. Перейдите в папку сервера:"
echo "   cd ~/empire-of-safavids/server"
echo ""
echo "3. Установите зависимости:"
echo "   npm install"
echo ""
echo "4. Создайте .env файл:"
echo "   cp .env.example .env"
echo "   nano .env"
echo ""
echo "5. Настройте базу данных:"
echo "   sudo -u postgres psql"
echo "   CREATE DATABASE empire_of_safavids;"
echo "   CREATE USER safavid_user WITH PASSWORD 'your_password';"
echo "   GRANT ALL PRIVILEGES ON DATABASE empire_of_safavids TO safavid_user;"
echo "   \q"
echo ""
echo "6. Примените миграции:"
echo "   sudo -u postgres psql empire_of_safavids < /path/to/migration.sql"
echo ""
echo "7. Соберите клиент:"
echo "   cd ../client"
echo "   npm install"
echo "   npm run build"
echo "   mkdir -p ../server/web/game"
echo "   cp -r web/game/* ../server/web/game/"
echo ""
echo "8. Запустите сервер:"
echo "   cd ../server"
echo "   pm2 start src/index/index.ts --name eos-server"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "9. Откройте порты:"
echo "   sudo ufw allow 3000/tcp"
echo "   sudo ufw allow 80/tcp"
echo "   sudo ufw allow 443/tcp"
echo "   sudo ufw enable"
echo ""
echo "10. Игра доступна по адресу:"
echo "   http://YOUR_VPS_IP:3000/game/"
