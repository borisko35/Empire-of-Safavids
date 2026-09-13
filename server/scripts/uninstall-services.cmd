@echo off
rem ============================================================
rem Удаление служб Windows — Empire of Safavids
rem Требует прав администратора
rem ============================================================

echo Stopping and removing EOS-Server...
cd /d "%~dp0.."
call node scripts\service-install.js uninstall

echo Stopping and removing EOS-PostgreSQL...
net stop EOS-PostgreSQL
.pg\bin\pg_ctl.exe unregister -N "EOS-PostgreSQL"

echo Done.
