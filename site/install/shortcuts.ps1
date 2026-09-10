# ============================================================
# Система ярлыков — Empire of Safavids
# ============================================================
# Создание и удаление ярлыков игры: рабочий стол, меню «Пуск»
# (группа с ярлыками игры и деинсталлятором). Используется
# установщиком install-game.cmd и деинсталлятором uninstall-game.cmd.
#
# Создать:
#   powershell -NoProfile -ExecutionPolicy Bypass -File shortcuts.ps1 ^
#     -Action create -InstallDir "C:\...\EmpireOfSafavids" ^
#     -Launcher "C:\...\EmpireOfSafavids\launcher.cmd" ^
#     -Icon "C:\...\EmpireOfSafavids\game.ico" ^
#     -Uninstaller "C:\...\EmpireOfSafavids\uninstall.cmd"
#
# Удалить:
#   powershell -NoProfile -ExecutionPolicy Bypass -File shortcuts.ps1 ^
#     -Action remove -InstallDir "C:\...\EmpireOfSafavids"

param(
  [Parameter(Mandatory = $true)][ValidateSet('create', 'remove')][string]$Action,
  [string]$InstallDir = '',
  [string]$Launcher = '',
  [string]$Icon = '',
  [string]$Uninstaller = '',
  [string]$GameName = 'Empire of Safavids'
)

$ErrorActionPreference = 'Stop'

$Desktop  = [Environment]::GetFolderPath('Desktop')
$Programs = [Environment]::GetFolderPath('Programs')   # ...\Start Menu\Programs
$Group    = Join-Path $Programs $GameName

$shortcuts = @(
  @{ Path = (Join-Path $Desktop "$GameName.lnk"); Target = $Launcher },
  @{ Path = (Join-Path $Group   "$GameName.lnk"); Target = $Launcher }
)

if ($Action -eq 'create') {
  if (-not $Launcher)   { throw 'Укажите -Launcher' }
  if (-not $InstallDir) { throw 'Укажите -InstallDir' }
  New-Item -ItemType Directory -Force -Path $Group | Out-Null

  # Третий ярлык — деинсталлятор в группе меню «Пуск»
  if ($Uninstaller) {
    $shortcuts += @{ Path = (Join-Path $Group "Uninstall $GameName.lnk"); Target = $Uninstaller }
  }

  $shell = New-Object -ComObject WScript.Shell
  foreach ($sc in $shortcuts) {
    $lnk = $shell.CreateShortcut($sc.Path)
    $lnk.TargetPath       = $sc.Target
    $lnk.WorkingDirectory = $InstallDir
    if ($Icon) { $lnk.IconLocation = "$Icon,0" }
    $lnk.Description  = "Empire of Safavids — историческая Action MMORPG (Сефевидская империя, 1501–1736)"
    $lnk.WindowStyle  = 7   # свёрнутое окно консоли лаунчера
    $lnk.Save()
    Write-Host "  + ярлык: $($sc.Path)"
  }
  Write-Host 'Ярлыки созданы.'
}
else {
  foreach ($sc in $shortcuts) {
    if (Test-Path $sc.Path) { Remove-Item -Force $sc.Path; Write-Host "  - ярлык: $($sc.Path)" }
  }
  if (Test-Path $Group) { Remove-Item -Recurse -Force $Group; Write-Host "  - группа меню Пуск: $Group" }
  Write-Host 'Ярлыки удалены.'
}
