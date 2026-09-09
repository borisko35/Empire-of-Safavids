@echo off
rem Остановка локального PostgreSQL из server\.pg
cd /d "%~dp0server"
.pg\bin\pg_ctl.exe -D .pg\data stop
