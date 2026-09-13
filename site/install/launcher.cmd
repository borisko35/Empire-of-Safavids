@echo off
rem ============================================================
rem Лаунчер Empire of Safavids
rem ============================================================
rem Открывает игру в браузере; если локальный сервер не отвечает —
rem поднимает базу данных и сервер из каталога репозитория,
rem записанного установщиком в game.ini.
rem Файл кладётся установщиком в %LOCALAPPDATA%\EmpireOfSafavids
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
title Empire of Safavids

set "DIR=%~dp0"
set "URL=http://localhost:3000"
set "REPO="

if exist "%DIR%game.ini" (
  for /f "usebackq eol=; tokens=1,* delims==" %%A in ("%DIR%game.ini") do (
    if /i "%%A"=="URL" set "URL=%%B"
    if /i "%%A"=="REPO" set "REPO=%%B"
  )
)

rem ── Проверка сервера (PowerShell есть на любой Windows) ──────
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%/health').StatusCode|Out-Null}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo   Сервер игры не отвечает на %URL%
  if defined REPO if exist "%REPO%\dev-db-start.cmd" (
    echo   Запускаю базу данных и сервер из: %REPO%
    call "%REPO%\dev-db-start.cmd"
    cd /d "%DIR%"
    start "Empire of Safavids Server" cmd /c "cd /d "%REPO%\server" && npm run dev"
    echo   Ожидание запуска сервера, ~12 секунд...
    ping -n 13 127.0.0.1 >nul
  ) else (
    echo   Каталог репозитория не найден в game.ini.
    echo   Запустите сервер вручную: cd server ^&^& npm run dev
    timeout /t 4 >nul
  )
)

rem ── Открытие игры в браузере по умолчанию ────────────────────
start "" "%URL%"
endlocal
