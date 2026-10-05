# ============================================================
# Сборка трейлера Empire of Safavids
# ============================================================
# Требуется ffmpeg в PATH. Сценарий — tools/trailer-storyboard.md
#
#   powershell -ExecutionPolicy Bypass -File tools/build-trailer.ps1
#
# Что делает:
#   1. проверяет ffmpeg и наличие кадров;
#   2. собирает семь сегментов: медленный наезд (Ken Burns) + текст;
#   3. склеивает их наложением без чёрных промежутков;
#   4. собирает вторую, вертикальную версию 1080x1920;
#   5. кладёт всё в tools/trailer-out/.
#
# Музыки нет намеренно: тишина в ролике честнее плохого трека.
# Добавить трек — см. конец файла, там команда для ffmpeg.

$ErrorActionPreference = 'Stop'
$root     = Split-Path -Parent $PSScriptRoot
$assets   = Join-Path $root 'client/web/assets'
$shots    = Join-Path $assets 'screenshots'
$out      = Join-Path $root 'tools/trailer-out'
$font     = 'C\:/Windows/Fonts/segoeui.ttf'
$W = 1280; $H = 720; $FPS = 24

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host 'ffmpeg не найден в PATH. Установи его и запусти скрипт снова.' -ForegroundColor Red
  exit 1
}

foreach ($f in @('bg-history.png','og-screenshot.png')) {
  if (-not (Test-Path (Join-Path $assets $f))) { throw "Нет кадра: $f" }
}
foreach ($f in @('city.png','combat.png','worldmap.png','tasks.png')) {
  if (-not (Test-Path (Join-Path $shots $f))) { throw "Нет кадра: screenshots/$f" }
}
if (-not (Test-Path $font)) { throw "Нет шрифта segoeui.ttf" }

New-Item -ItemType Directory -Force -Path $out | Out-Null

# Сегменты: файл, секунды, текст, режим наезда, текст внизу
$segments = @(
  @{ img = (Join-Path $assets 'bg-history.png');    dur = 6; zoom = '1.0->1.12'; z = 'center';
     title = 'Империя Сефевидов'; sub = '1501-1736' },
  @{ img = (Join-Path $shots 'city.png');           dur = 7; zoom = '1.05->1.14'; z = 'center';
     title = 'Семь регионов Персии'; sub = '' },
  @{ img = (Join-Path $shots 'combat.png');         dur = 8; zoom = '1.06->1.15'; z = 'center';
     title = 'Бой. Ловкость. PvP'; sub = '' },
  @{ img = (Join-Path $shots 'worldmap.png');       dur = 7; zoom = '1.04->1.13'; z = 'center';
     title = 'Карта мира'; sub = 'форты, лагеря, караван-саиды' },
  @{ img = (Join-Path $shots 'tasks.png');          dur = 8; zoom = '1.08->1.16'; z = 'center';
     title = 'Задания каждый день'; sub = 'и что за них дают' },
  @{ img = (Join-Path $assets 'og-screenshot.png'); dur = 9; zoom = '1.0->1.06';  z = 'center';
     title = 'Бесплатно. В браузере.'; sub = 'game.eos-gameonline.com' },
  @{ img = (Join-Path $assets 'bg-history.png');    dur = 3; zoom = '1.12->1.0'; z = 'center';
     title = ''; sub = '' }
)

$gold   = '0xF4D26C'
$cream  = '0xEDE6D8'
$segFiles = @()
$i = 0

foreach ($s in $segments) {
  $i++
  $frames = $s.dur * $FPS
  $seg = Join-Path $out ("seg{0:d2}.mp4" -f $i)

  # НАЕЗД ЧЕРЕЗ НОМЕР КАДРА, А НЕ ДИАПАЗОНОМ.
  # Раньше здесь стояло zoompan=z='1.0->1.12'. ffmpeg так не умеет:
  #   [Parsed_zoompan_2] Undefined constant or missing '(' in '>1.12'
  #   Failed to configure output pad
  # Сборщик ни разу не запускали — ffmpeg не было в системе, — и ошибка
  # осталась незамеченной. Правильный диапазон выражается через номер кадра:
  # z='НАЧАЛО+(КОНЕЦ-НАЧАЛО)*on/(КАДРОВ-1)'. on считается с нуля, поэтому
  # делитель — (frames-1), иначе наезд не доходит до задуманного.
  $z1 = [regex]::Match($s.zoom, '^([\d.]+)').Groups[1].Value
  $z2 = [regex]::Match($s.zoom, '([\d.]+)$').Groups[1].Value
  $zoom = "z='$z1+($z2-$z1)*on/$($frames - 1)'"

  $text = ''
  if ($s.title) {
    $text = ",drawtext=fontfile=${font}:text='$($s.title)':fontcolor=${cream}:" +
            "fontsize=52:x=(w-text_w)/2:y=h-190:box=1:boxcolor=0x0D1B2ACC:boxborderw=18"
  }
  if ($s.sub) {
    $text += ",drawtext=fontfile=${font}:text='$($s.sub)':fontcolor=${gold}:" +
             "fontsize=30:x=(w-text_w)/2:y=h-110:box=1:boxcolor=0x0D1B2ACC:boxborderw=14"
  }

  # zoompan: медленный наезд, кадр не дрожит и не мылится
  $args = @(
    '-y', '-loop', '1', '-i', $s.img,
    '-vf',
    "scale=${W}:${H}:force_original_aspect_ratio=increase," +
    "crop=${W}:${H},zoompan=$zoom:d=${frames}:s=${W}x${H}:fps=${FPS}$text",
    '-t', $s.dur, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', $seg
  )
  & ffmpeg @args 2>$null
  # Проверяется РАЗМЕР, а не наличие файла. ffmpeg создаёт выходной файл и
  # только потом падает на фильтре, так что «файл существует» означает
  # «что-то осталось на диске» - при сломанной сборке это 0 байт.
  if (-not (Test-Path $seg) -or (Get-Item $seg).Length -eq 0) { throw "Сегмент $i не собрался" }
  $segFiles += $seg
}

# Склейка наложением: fadeout одного и fadein следующего внахлёст.
# ВХОДЫ адресуются как [0:v], [1:v] и так далее. Метки v0..vN ffmpeg не
# создаёт сам, и без явной адресации он отвечает «Invalid stream specifier».
# Промежуточные метки названы xN, чтобы не путались со входами. Отдаётся
# последняя метка напрямую: «;[xN][vout]» - это список меток, а не фильтр,
# а «;[xN]null[vout]» - у null вход должен быть подписан.
$inputs = @()
$segFiles | ForEach-Object { $inputs += @('-i', $_) }
$total = ($segments | Measure-Object -Property dur -Sum).Sum
$xfade = ''
$acc = $segments[0].dur
$prev = '[0:v]'
for ($k = 1; $k -lt $segFiles.Count; $k++) {
  $xfade += "${prev}[${k}:v]xfade=transition=fade:duration=0.6:offset=$($acc - 0.6)[x$k];"
  $prev = "[x$k]"
  $acc += $segments[$k].dur - 0.6
}
$xfade = $xfade.TrimEnd(';')
$final = "[x$($segFiles.Count - 1)]"

$hor = Join-Path $out 'trailer-1920x1080.mp4'
& ffmpeg -y @inputs -filter_complex $xfade -map $final `
  -c:v libx264 -pix_fmt yuv420p -r $FPS $hor 2>$null
if (-not (Test-Path $hor) -or (Get-Item $hor).Length -eq 0) { throw 'Горизонтальный ролик не собрался' }

# Вертикальная версия 1080x1920: обрезка по центру, текст крупнее
$short = Join-Path $out 'trailer-vertical-1080x1920.mp4'
$vf = "scale=1080:1920:force_original_aspect_ratio=increase," +
      "crop=1080:1920,drawbox=x=0:y=0:w=1080:h=1920:color=0x0D1B2A:t=fill," +
      "drawtext=fontfile=${font}:text='БЕСПЛАТНО. В БРАУЗЕРЕ.':fontcolor=${gold}:fontsize=64:" +
      "x=(w-text_w)/2:y=760:box=1:boxcolor=0x0D1B2ACC:boxborderw=20," +
      "drawtext=fontfile=${font}:text='game.eos-gameonline.com':fontcolor=${cream}:fontsize=44:" +
      "x=(w-text_w)/2:y=880"
& ffmpeg -y -loop 1 -i (Join-Path $shots 'combat.png') -t 10 -vf $vf `
  -c:v libx264 -pix_fmt yuv420p -r $FPS $short 2>$null
if (-not (Test-Path $short) -or (Get-Item $short).Length -eq 0) { throw 'Вертикальный ролик не собрался' }

# Проверка: ролик не только собрался, но и читается целиком. mp4 может
# оказаться битым на середине, и без полного декодирования это не видно.
$bad = 0
foreach ($f in @($hor, $short)) {
  $name = Split-Path $f -Leaf
  $probe = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name `
    -show_entries format=duration -of default=nw=1:nk=1 $f 2>$null
  if (-not $probe) { Write-Host "  НЕТ  $name: ffprobe не отдал данных" -ForegroundColor Red; $bad++; continue }
  $errs = (& ffmpeg -v error -i $f -f null - 2>&1 | Measure-Object).Count
  if ($errs -ne 0) { $bad++ }
  $size = [math]::Round((Get-Item $f).Length / 1MB, 1)
  Write-Host ("  {0}  {1}  ошибок декодирования: {2}  {3} МБ" -f $name, ($probe -join ' '), $errs, $size)
}
if ($bad -ne 0) {
  Write-Host ''
  Write-Host "Плохих: $bad"
  Write-Host 'RESULT: FAIL' -ForegroundColor Red
  exit 1
}
Write-Host 'Плохих: 0'
Write-Host 'RESULT: PASS' -ForegroundColor Green

Write-Host ''
Write-Host "Готово. Файлы в $out :" -ForegroundColor Green
Get-ChildItem $out -Filter 'trailer-*.mp4' | ForEach-Object {
  "  {0}  ({1} МБ)" -f $_.Name, [math]::Round($_.Length/1MB, 1)
}
Write-Host ''
Write-Host 'Добавить музыку (положи трек рядом и выполни):' -ForegroundColor Cyan
Write-Host "  ffmpeg -i $hor -i music.mp3 -c:v copy -c:a aac -shortest `"$($hor -replace '\.mp4$','-music.mp4')`""
