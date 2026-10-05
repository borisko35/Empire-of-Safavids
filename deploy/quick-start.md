# Empire of Safavids — Быстрый старт на VPS

## Справочные данные
- **IP сервера:** адрес вашей машины (см. «Бесплатный хостинг» в deploy/README.md)
- **Логин:** root
- **Пароль:** ваш (в репозиторий не вносится — храните в менеджере паролей)

---

## Шаг 1: Подключись к серверу

### Вариант А: PowerShell (Windows)
Открой PowerShell и введи:
```powershell
ssh <пользователь>@<ip-машины>
```
Введи пароль root.

### Вариант Б: WinSCP
1. Запусти WinSCP
2. Заполни:
   - Хост: `<ip-машины>`
   - Пользователь: `root`
   - Пароль: ваш пароль root
3. Нажми "Подключиться"

---

## Шаг 2: Загрузи файлы игры

### Из PowerShell (после загрузки WinSCP не нужен):
```powershell
scp -r "D:\My Projects\Empire of Sefevids\deploy" <пользователь>@<ip-машины>:~/
```

### Или из WinSCP:
Перетащи папку `deploy` с левого окна (твои файлы) в правое (сервер).

---

## Шаг 3: Установи всё на сервере

Выполни по очереди:

```bash
# Перейди в папку
cd ~/deploy

# Запусти автоматическую установку
chmod +x vps-install.sh
bash vps-install.sh

# Создай базу данных
sudo -u postgres psql -c "CREATE DATABASE empire_of_safavids;"
sudo -u postgres psql -c "CREATE USER safavid_user WITH PASSWORD 'your_db_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE empire_of_safavids TO safavid_user;"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET client_encoding TO 'utf8';"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET default_transaction_isolation TO 'read committed';"
sudo -u postgres psql -c "ALTER ROLE safavid_user SET timezone TO 'UTC';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON SCHEMA public TO safavid_user;"
\q

# Установи зависимости сервера
cd ~/deploy/server
npm install

# Настрой .env
cp .env.example .env
sed -i "s/your_secure_password/your_db_password/g" .env

# Собери клиент
cd ~/deploy/client
npm install
npm run build
mkdir -p ~/deploy/server/web/game
cp -r web/game/* ~/deploy/server/web/game/

# Запусти сервер
cd ~/deploy/server
pm2 start src/index/index.ts --name eos-server
pm2 save
pm2 startup

# Открой порты
ufw allow 3000/tcp
ufw allow 80/tcp
ufw enable

# Проверь
curl http://localhost:3000/health
```

---

## Готово!

Игра доступна: https://game.eos-gameonline.com/game/