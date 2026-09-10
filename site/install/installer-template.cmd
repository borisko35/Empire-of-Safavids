@echo off
rem ============================================================
rem Установщик Empire of Safavids — самораспаковка
rem ============================================================
rem ВНИМАНИЕ: файл СГЕНЕРИРОВАН скриптом tools/build-installer.js.
rem Не редактировать вручную: правьте install/installer-template.cmd
rem и пересоберите (node tools/build-installer.js).
rem Комплект (game.ico, ярлыки, лаунчер, деинсталлятор) упакован
rem в base64-контейнер ниже маркера :::PAYLOAD:::
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
title Empire of Safavids — Установка игры

set "PAYLOAD_DIR=%TEMP%\eos-install"
set "EOS_PAYLOAD=%TEMP%\eos-install"
set "INSTALL_DIR=%LOCALAPPDATA%\EmpireOfSafavids"

echo.
echo   ============================================================
echo     EMPIRE OF SAFAVIDS
echo     Установка игры на компьютер
echo     Историческая Action MMORPG: Сефевидская империя, 1501-1736
echo   ============================================================
echo.
echo   Каталог установки: %INSTALL_DIR%
echo.

rem ── 1. Распаковка комплекта из тела установщика ─────────────
echo   [1/4] Распаковка комплекта...
if exist "%PAYLOAD_DIR%" rmdir /s /q "%PAYLOAD_DIR%"
mkdir "%PAYLOAD_DIR%" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';$raw=[IO.File]::ReadAllText('%~f0');$i=$raw.LastIndexOf(':::PAYLOAD:::');if($i -lt 0){exit 3};$b=[Convert]::FromBase64String((($raw.Substring($i+13)) -replace '\s',''));$o=0;while($o -lt $b.Length){$nl=[BitConverter]::ToUInt16($b,$o);$o+=2;$n=[Text.Encoding]::UTF8.GetString($b,$o,$nl);$o+=$nl;$dl=[BitConverter]::ToUInt32($b,$o);$o+=4;$p=Join-Path $env:EOS_PAYLOAD $n;New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($p)) | Out-Null;[IO.File]::WriteAllBytes($p,$b[$o..($o+$dl-1)]);$o+=$dl}"
if errorlevel 1 (
  echo   [ОШИБКА] Не удалось распаковать комплект установщика.
  goto :fail
)

rem ── 2. Копирование файлов ────────────────────────────────────
echo   [2/4] Копирование файлов...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /y "%PAYLOAD_DIR%\game.ico"           "%INSTALL_DIR%\game.ico" >nul
copy /y "%PAYLOAD_DIR%\launcher.cmd"       "%INSTALL_DIR%\launcher.cmd" >nul
copy /y "%PAYLOAD_DIR%\shortcuts.ps1"      "%INSTALL_DIR%\shortcuts.ps1" >nul
copy /y "%PAYLOAD_DIR%\uninstall-game.cmd" "%INSTALL_DIR%\uninstall.cmd" >nul
copy /y "%PAYLOAD_DIR%\readme.txt"         "%INSTALL_DIR%\readme.txt" >nul

rem ── 3. Конфигурация лаунчера (game.ini) ──────────────────────
rem Если установщик запущен из репозитория — запоминаем его корень:
rem лаунчер сможет сам поднимать БД и сервер
set "REPO_LINE="
for %%I in ("%~dp0.") do set "EOS_SRC=%%~fI"
for %%I in ("%EOS_SRC%\..") do set "EOS_REPO=%%~fI"
if exist "%EOS_REPO%\server\package.json" set "REPO_LINE=REPO=%EOS_REPO%"
> "%INSTALL_DIR%\game.ini" echo URL=http://localhost:3000
if defined REPO_LINE >> "%INSTALL_DIR%\game.ini" echo %REPO_LINE%

rem ── 4. Система ярлыков: рабочий стол + меню «Пуск» ───────────
echo   [3/4] Создание ярлыков...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PAYLOAD_DIR%\shortcuts.ps1" -Action create -InstallDir "%INSTALL_DIR%" -Launcher "%INSTALL_DIR%\launcher.cmd" -Icon "%INSTALL_DIR%\game.ico" -Uninstaller "%INSTALL_DIR%\uninstall.cmd"
if errorlevel 1 (
  echo   [ОШИБКА] Не удалось создать ярлыки.
  goto :fail
)

rem ── 5. Регистрация в «Установка и удаление программ» ─────────
echo   [4/4] Регистрация в системе...
set "UNINST_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\EmpireOfSafavids"
reg add "%UNINST_KEY%" /v DisplayName     /d "Empire of Safavids" /f >nul
reg add "%UNINST_KEY%" /v DisplayVersion  /d "0.1.0" /f >nul
reg add "%UNINST_KEY%" /v Publisher       /d "Sigma Arena Games Group" /f >nul
reg add "%UNINST_KEY%" /v DisplayIcon     /d "%INSTALL_DIR%\game.ico" /f >nul
reg add "%UNINST_KEY%" /v InstallLocation /d "%INSTALL_DIR%" /f >nul
reg add "%UNINST_KEY%" /v UninstallString /d "\"%INSTALL_DIR%\uninstall.cmd\"" /f >nul
reg add "%UNINST_KEY%" /v NoModify        /t REG_DWORD /d 1 /f >nul
reg add "%UNINST_KEY%" /v NoRepair        /t REG_DWORD /d 1 /f >nul

rmdir /s /q "%PAYLOAD_DIR%" 2>nul

echo.
echo   ============================================================
echo     УСТАНОВКА ЗАВЕРШЕНА
echo   ============================================================
echo.
echo   Ярлык «Empire of Safavids» создан:
echo     * на рабочем столе;
echo     * в меню «Пуск» (там же — «Uninstall Empire of Safavids»).
echo.
echo   Запустите ярлык: лаунчер поднимет локальный сервер
echo   и откроет игру в браузере по адресу http://localhost:3000
echo.
pause
exit /b 0

:fail
echo.
echo   Установка прервана. Подробности — в сообщениях выше.
pause
exit /b 1

:::PAYLOAD:::
