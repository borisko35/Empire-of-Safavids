@echo off
rem ============================================================
rem Деинсталлятор Empire of Safavids
rem ============================================================
rem Удаляет ярлыки, запись реестра «Установка и удаление программ»
rem и каталог установки. Кладётся установщиком в
rem %LOCALAPPDATA%\EmpireOfSafavids рядом с game.ico
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
title Empire of Safavids — Удаление игры

set "INSTALL_DIR=%~dp0"
set "KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\EmpireOfSafavids"

echo.
echo   Удаление Empire of Safavids...
echo.

rem ── Ярлыки (рабочий стол + меню «Пуск») ─────────────────────
if exist "%INSTALL_DIR%shortcuts.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_DIR%shortcuts.ps1" -Action remove -InstallDir "%INSTALL_DIR%"
)

rem ── Запись в реестре ─────────────────────────────────────────
reg delete "%KEY%" /f >nul 2>&1
echo   Запись реестра удалена.

rem ── Каталог установки удаляем с задержкой (самоудаление) ────
echo   Файлы игры будут удалены через несколько секунд...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -WindowStyle Hidden -ArgumentList ('/c timeout /t 2 /nobreak >nul & rd /s /q \"' + $env:INSTALL_DIR.TrimEnd('\') + '\"')"
exit
