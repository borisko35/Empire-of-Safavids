@echo off
rem ============================================================
rem Запуск локального PostgreSQL из server\.pg (без Docker)
rem Empire of Safavids
rem ============================================================
cd /d "%~dp0server"

if not exist .pg\data\PG_VERSION (
  echo [DB] First run: initializing cluster...
  .pg\bin\initdb.exe -D .pg\data -U safavid_user -A trust -E UTF8 --no-locale
  if errorlevel 1 ( echo [DB] initdb failed & exit /b 1 )
)

.pg\bin\pg_ctl.exe -D .pg\data -o "-p 5432" -l .pg\postgres.log status >nul 2>&1
if errorlevel 1 (
  .pg\bin\pg_ctl.exe -D .pg\data -o "-p 5432" -l .pg\postgres.log start
) else (
  echo [DB] PostgreSQL already running on :5432
)

if not exist node_modules ( echo [DB] Installing npm dependencies... & call npm install --no-audit --no-fund )
call npm run db:init
echo [DB] Done. Now run: cd server ^&^& npm run dev
