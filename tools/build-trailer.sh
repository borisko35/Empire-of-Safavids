#!/bin/bash
# ============================================================
# Сборка трейлера Empire of Safavids — bash-версия
# ============================================================
# Требуется ffmpeg. Сценарий — tools/trailer-storyboard.md
#
#   bash tools/build-trailer.sh
#
# Почему отдельный файл, а не только build-trailer.ps1: на VPS нет
# PowerShell, а собирать ролик нужно там, где уже лежат кадры. Сценарий у
# обоих один, отличается только запуск.
#
# НАЙДЕННАЯ ОШИБКА, КОТОРАЯ ЕЩЁ ЖИЛА В POWERSHELL-ВЕРСИИ
# -------------------------------------------------------
# Наезд задан выражением zoompan=z='1.0->1.12'. ffmpeg так не умеет:
#
#   [Parsed_zoompan_2] Undefined constant or missing '(' in '>1.12'
#   Failed to configure output pad
#
# Сборщик ни разу не запускали — ffmpeg не было в системе, — и ошибка
# осталась незамеченной. Правильный диапазон выражается через номер кадра:
# zoompan z='НАЧАЛО+(КОНЕЦ-НАЧАЛО)*on/(КАДРОВ-1)'.
#
# Музыки нет намеренно: тишина в ролике честнее плохого трека.

set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
assets="$root/client/web/assets"
shots="$assets/screenshots"
out="$root/tools/trailer-out"
W=1280; H=720; FPS=24

say() { printf '%s\n' "$*"; }
fail() { printf 'СБОЙ: %s\n' "$*" >&2; exit 1; }

# ── Проверки. Ничего не собирается, пока не сойдётся всё. ───────────────────
command -v ffmpeg  >/dev/null 2>&1 || fail 'ffmpeg не найден в PATH'
command -v ffprobe >/dev/null 2>&1 || fail 'ffprobe не найден в PATH'

# Шрифт с кириллицей. Проверяется наличие, а не имя: на другой машине
# шрифт называется иначе, и квадраты вместо букв обнаружились бы только
# при просмотре ролика.
FONT=""
for f in /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
         /usr/share/fonts/TTF/DejaVuSans.ttf \
         /usr/share/fonts/dejavu/DejaVuSans.ttf \
         "$root/tools/trailer-out/segoeui.ttf" \
         "C:/Windows/Fonts/segoeui.ttf"; do
  if [ -f "$f" ]; then FONT="$f"; break; fi
done
[ -n "$FONT" ] || fail 'не найден шрифт с кириллицей (DejaVuSans.ttf)'

for f in bg-history.png og-screenshot.png; do
  [ -f "$assets/$f" ] || fail "нет кадра: assets/$f"
done
for f in city.png combat.png worldmap.png tasks.png; do
  [ -f "$shots/$f" ] || fail "нет кадра: screenshots/$f"
done

rm -rf "$out"; mkdir -p "$out"
say "шрифт:    $FONT"
say "выход:    $out"
say "кадров:   6, сцен: 7, хронометраж 48 с"
say ''

GOLD='0xF4D26C'; CREAM='0xEDE6D8'

# Сцена: файл | секунды | zoom от | zoom до | заголовок | подпись
# Порядок и хронометраж — как в tools/trailer-storyboard.md.
# ЗАПЯТАЯ В КАЖДОМ ПОЛЕ, а не список: список в bash разъезжается по
# пробелам в кириллице, и заголовок молча становится двумя полями.
scenes=(
  "$assets/bg-history.png|6|1.00|1.12|Империя Сефевидов|1501 — 1736"
  "$shots/city.png|7|1.05|1.14|Семь регионов Персии|"
  "$shots/combat.png|8|1.06|1.15|Бой. Ловкость. PvP|"
  "$shots/worldmap.png|7|1.04|1.13|Карта мира|форты, лагеря, караван-саиды"
  "$shots/tasks.png|8|1.08|1.16|Задания каждый день|и что за них дают"
  "$assets/og-screenshot.png|9|1.00|1.06|Бесплатно. В браузере.|game.eos-gameonline.com"
  "$assets/bg-history.png|3|1.12|1.00||"
)
SEGMENTS=${#scenes[@]}
FIRST=1

# ── Сегменты: медленный наезд + текст ───────────────────────────────────────
segs=()
i=0
for row in "${scenes[@]}"; do
  i=$((i + 1))
  IFS='|' read -r img dur z1 z2 title sub <<< "$row"
  frames=$(( dur * FPS ))
  seg="$out/seg$(printf '%02d' $i).mp4"

  # Наезд через номер кадра. on — номер выходного кадра, он считается с нуля,
  # поэтому делитель — (frames-1), иначе наезд не доходит до задуманного.
  zoom="z='$z1+($z2-$z1)*on/$((frames - 1))'"

  text=""
  if [ -n "$title" ]; then
    text=",drawtext=fontfile=$FONT:text='$title':fontcolor=$CREAM:fontsize=52:x=(w-text_w)/2:y=h-190:box=1:boxcolor=0x0D1B2ACC:boxborderw=18"
  fi
  if [ -n "$sub" ]; then
    text="$text,drawtext=fontfile=$FONT:text='$sub':fontcolor=$GOLD:fontsize=30:x=(w-text_w)/2:y=h-110:box=1:boxcolor=0x0D1B2ACC:boxborderw=14"
  fi

  vf="scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,zoompan=$zoom:d=$frames:s=${W}x${H}:fps=$FPS$text"
  if ! ffmpeg -y -loglevel error -loop 1 -i "$img" -vf "$vf" -t "$dur" \
       -c:v libx264 -pix_fmt yuv420p -preset medium "$seg" 2>"$out/err$i.txt"; then
    cat "$out/err$i.txt" >&2
    fail "сегмент $i не собрался"
  fi
  # Проверяется РАЗМЕР, а не существование файла. Первая проба проверяла
  # наличие и рапортовала «OK, 0 байт»: ffmpeg создаёт выходной файл, потом
  # падает на фильтре, и файл остаётся пустым. Проверка на существование
  # обманывает ровно тогда, когда всё сломано.
  [ -s "$seg" ] || fail "сегмент $i пустой"
  say "  сегмент $i  ${dur}с  $(stat -c%s "$seg") байт"
  segs+=("$seg")
done

# ── Склейка наложением: fadeout одного и fadein следующего внахлёст ─────────
inputs=()
for s in "${segs[@]}"; do inputs+=(-i "$s"); done

XFADE_DUR=0.6
# ВХОДЫ адресуются как [0:v], [1:v] и так далее. Метки v0..v6 ffmpeg не
# создаёт сам: без явной адресации он отвечал «Invalid stream specifier:
# v0». Промежуточные метки названы xN, чтобы не путались со входами.
#
# Цепь строится с нуля. Первая версия начинала с куска
# `xfade=transition=fade:duration=0.6:offset=0`, думая, что это инициализация,
# и приклеивала к нему первую пару меток. Получался фильтр без входов, и
# виновата выглядела метка, а на деле виноват был ведущий кусок.
xfade=""
acc="$(echo "${scenes[0]}" | cut -d'|' -f2)"
prev="[0:v]"
for k in $(seq 2 "$SEGMENTS"); do
  idx=$((k - 1))
  dur="$(echo "${scenes[$((k - 1))]}" | cut -d'|' -f2)"
  xfade="$xfade$prev[$idx:v]xfade=transition=fade:duration=$XFADE_DUR:offset=$(awk "BEGIN{print $acc - $XFADE_DUR}")[x$idx];"
  prev="[x$idx]"
  acc="$(awk "BEGIN{print $acc + $dur - $XFADE_DUR}")"
done
# Отдаём последнюю промежуточную метку напрямую. Два варианта tried и оба
# не работают: `;[x6][vout]` - метки подряд, это список меток, а не фильтр
# («No output pad can be associated to link label 'vout'»); `;[x6]null[vout]`
# - а у null вход должен быть подписан, иначе «Cannot find a matching stream
# for unlabeled input pad 0». Отображение последней метки делает и то и
# другое ненужным.
METS=$((${#scenes[@]} - 1))
xfade="${xfade%;}"
FINAL="[x$METS]"

hor="$out/trailer-1920x1080.mp4"
say ''
say "склейка $SEGMENTS сегментов..."
if ! ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$xfade" -map "$FINAL" \
     -c:v libx264 -pix_fmt yuv420p -r $FPS "$hor" 2>"$out/err-xfade.txt"; then
  cat "$out/err-xfade.txt" >&2
  # Граф печатается рядом с ошибкой: без него «No output pad can be
  # associated to link label 'v1'» не говорит, где именно ошибка.
  say "граф: $xfade" >&2
  fail 'склейка не удалась'
fi
[ -s "$hor" ] || fail 'горизонтальный ролик пустой'

# ── Вертикальная версия 1080x1920 для превью на itch.io ────────────────────
# Сценарий требует 20 секунд из кадров 2, 3 и 6 - тех, что читаются в
# маленьком размере. Сборщик делал 10 секунд из одного кадра боя, то есть
# обещание из черновика не выполнялось. Собираются три сегмента и склеиваются.
#
# НЕ ПРОВЕРЕНО ГЛАЗАМИ: кадр 1280x720 обрезается до 1080x1920 по центру,
# и интерфейс по краям (панель персонажа слева, миникарта справа) уходит за
# границу. Технически это верный вертикальный ролик, но как он выглядит -
# смотреть нужно владельцу. Ниже печатается предупреждение, а не молчание.
VW=1080; VH=1920
vseg=()
i=0
# кадр|секунды|подпись
for row in "$shots/city.png|7|Город" \
           "$shots/combat.png|7|Бой" \
           "$assets/og-screenshot.png|6|Бесплатно. В браузере."; do
  i=$((i + 1))
  IFS='|' read -r img vdur vlabel <<< "$row"
  vframes=$(( vdur * FPS ))
  vseg_path="$out/vseg$(printf '%02d' $i).mp4"
  vvf="scale=$VW:$VH:force_original_aspect_ratio=increase,crop=$VW:$VH,\
zoompan=z='1.0+0.08*on/$((vframes - 1))':d=$vframes:s=${VW}x${VH}:fps=$FPS,\
drawtext=fontfile=$FONT:text='$vlabel':fontcolor=$CREAM:fontsize=56:x=(w-text_w)/2:y=1240:box=1:boxcolor=0x0D1B2ACC:boxborderw=20"
  if ! ffmpeg -y -loglevel error -loop 1 -i "$img" -vf "$vvf" -t "$vdur" \
       -c:v libx264 -pix_fmt yuv420p -preset medium "$vseg_path" 2>"$out/errv$i.txt"; then
    cat "$out/errv$i.txt" >&2
    fail "вертикальный сегмент $i не собрался"
  fi
  [ -s "$vseg_path" ] || fail "вертикальный сегмент $i пустой"
  vseg+=("$vseg_path")
done

vinputs=()
for s in "${vseg[@]}"; do vinputs+=(-i "$s"); done
vxfade=""
acc="$(echo "${vseg[0]}" >/dev/null; echo 7)"
prev="[0:v]"
for k in 1 2; do
  vxfade="$vxfade$prev[$k:v]xfade=transition=fade:duration=0.5:offset=$(awk "BEGIN{print $acc - 0.5}")[vx$k];"
  prev="[vx$k]"
  acc="$(awk "BEGIN{print $acc + 7 - 0.5}")"
done
vxfade="${vxfade%;}"
short="$out/trailer-vertical-1080x1920.mp4"
if ! ffmpeg -y -loglevel error "${vinputs[@]}" -filter_complex "$vxfade" -map '[vx2]' \
     -c:v libx264 -pix_fmt yuv420p -r $FPS "$short" 2>"$out/err-vxfade.txt"; then
  cat "$out/err-vxfade.txt" >&2
  say "граф: $vxfade" >&2
  fail 'вертикальный ролик не собрался'
fi
[ -s "$short" ] || fail 'вертикальный ролик пустой'

# ── Проверка: ролик не только собрался, но и читается целиком ───────────────
# Сборка без ошибок ничего не значит: mp4 может оказаться битым на середине.
# Полное декодирование в никуда - единственная честная проверка, что файл
# проигрывается целиком.
#
# ВСЕ ИМЕНА ПЕРЕМЕННЫХ ЗДЕСЬ - ЛАТИНИЦЕЙ, И ЭТО НЕ СТИЛЬ.
# Первая версия называла их по-русски (плохо, имя, ширина, высота, кодек,
# длит, ошибок, ожид, факт). bash такие имена не разбирает: `высота=$(...)`
# он прочитал как команду и выполнил - сообщение «высота=: command not
# found». Дальше все проверки ехали на пустых значениях, `плохих` был
# не число, `[ $плохих -ne 0 ]` ругался - и скрипт напечатал
# RESULT: PASS при ПОЛНОСТЬЮ сломанной проверке.
#
# Это тот же случай, что и раньше сегодня: проверка, которая не может
# краснеть, хуже отсутствующей. Здесь она даже объявила успех.
# Кириллица остаётся в ТЕКСТАХ, которые видит зритель, - там она обязана.
say ''
say "=== PROVERKA GOTOVYH FAILOV ==="
bad=0
for f in "$hor" "$short"; do
  name="$(basename "$f")"
  # Каждое поле запрашивается ОТДЕЛЬНО. Одним запросом ffprobe отдаёт поля в
  # порядке объявления, а не в том, в котором их ждёшь: пришлось на
  # stream=width,height,codec_name он вернул h264 1280 720 - и кодек встал
  # на первое место. Разбор по позициям дал «1280» вместо высоты и «h264»
  # вместо числа. Здесь порядок не важен: запрашиваем ровно одно поле.
  w="$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 "$f" 2>/dev/null | tr -d '\r')"
  h="$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$f" 2>/dev/null | tr -d '\r')"
  codec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$f" 2>/dev/null | tr -d '\r')"
  dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null | tr -d '\r')"
  errs="$(ffmpeg -v error -i "$f" -f null - 2>&1 | wc -l)"

  # Число ли это вообще. Пустое значение - это не «ноль ошибок», это
  # «проверка не получила данных», и раньше именно так и вышло.
  for v in "$w" "$h" "$dur"; do
    case "$v" in
      ''|*[!0-9.]*) say "  NET   $name: ne chislo polucheno ('$v') - ffprobe ne otdal"; bad=$((bad + 1)) ;;
    esac
  done
  say "  $name  ${w}x${h}  $codec  $(awk "BEGIN{printf \"%.1f\", $dur}")s  $(stat -c%s "$f") bayt  oshibok dekodirovaniya: $errs"
  [ "$errs" -eq 0 ] || bad=$((bad + 1))
done

# Ожидаемая длительность считается, а не берётся из сценария: шесть
# наложений по 0.6 с срезают 3.6 с, и «48 минус 3.6» должно получиться
# само, а не быть написано руками.
want=$(awk "BEGIN{print 48 - 6 * $XFADE_DUR}")
got=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$hor" 2>/dev/null)
say "  ozhidalos ${want}s, poluchilos $(awk "BEGIN{printf \"%.2f\", $got}")s"
awk "BEGIN{exit (($got - $want < 0.4) ? 0 : 1)}" || { say '  RASHOZHDENIE PO HRONOMETRAZHU'; bad=$((bad + 1)); }

# Проверка обязана быть в состоянии «известно». Если счётчик не число,
# результат неизвестен, а PASS при неизвестном - это ложь.
case "$bad" in
  ''|*[!0-9]*) say ''; say 'SCHYOTCHIK PROVERKI NE CHISLO - REZULTAT NEIZVESTEN'; say 'RESULT: FAIL'; exit 1 ;;
esac

if [ "$bad" -ne 0 ]; then
  say ''
  say "plohih: $bad"
  say "RESULT: FAIL"
  exit 1
fi
rm -f "$out"/err*.txt
say ''
say 'plohih: 0'
say 'RESULT: PASS'
say ''
say 'VNIMANIE, NE PROVERENO GLAZAMI: kadr 1280x720 obrezaetsya do 1080x1920'
say 'po centru, i interfeys po kraiam (panel personazha sleva, minikarta'
say 'sprava) ukhodit za granicu. Tekhnicheski rolik verny, no kak on vyglyadit -'
say 'smotret nuzhno vladeltcu.'
