@echo off
rem ============================================================
rem Установка служб Windows — Empire of Safavids
rem Требует прав администратора (запускать через install-services.cmd)
rem ============================================================

cd /d "%~dp0.."

echo [1/3] Registering PostgreSQL (EOS-PostgreSQL)...
.pg\bin\pg_ctl.exe register -N "EOS-PostgreSQL" -D "%~dp0..\.pg\data" -o "-p 5432" -l "%~dp0..\.pg\postgres.log" -s
if %errorlevel%==0 (
  echo       registered, starting...
  net start EOS-PostgreSQL
) else (
  echo       already registered or failed, trying to start...
  net start EOS-PostgreSQL
)

echo [2/3] Installing game server service (EOS-Server)...
call node scripts\service-install.js install

echo [3/3] Done. Services:
sc query EOS-PostgreSQL | find "STATE"
sc query EOS-Server | find "STATE"
