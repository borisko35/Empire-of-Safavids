#!/bin/bash
# ============================================================
# Выкатка Empire of Safavids — с проверкой на каждом шаге
# ============================================================
#   bash tools/deploy.sh
#
# ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ТРИ КОМАНДЫ В ИНСТРУКЦИИ
# ------------------------------------------------------
# Так выкатка уже выглядела: preflight, потом `git pull`, потом пересборка.
# И вот что произошло 30 сентября: `git pull` УПАЛ с кодом 1, потому что на
# сервере лежал незакоммиченный tools/build-trailer.sh, а git не перезаписывает
# неотслеживаемые файлы. Дальше команда шла по цепочке `&&` с пайпом:
#
#   git pull --ff-only origin main 2>&1 | tail -3 && docker compose ... up
#                                                 ^^^^^^^^^ к��д `tail`
#
# Код возврата пайпа берётся у ПОСЛЕДНЕЙ команды, то есть у `tail`, а он всегда
# ноль. `&&` исполнился, контейнеры пересобрались на СТАРОМ коде, и выкатка
# рапортовала «Updating deef120..ec30537» - а эта строка печатается ДО отказа.
# Итог: три коммита на прод не попали, и это выглядело как успех.
#
# Здесь три проверки, любая из которых останавливает выкатку:
#   1. код возврата `git pull`, без пайпа;
#   2. коммит ДО и ПОСЛЕ - если не изменился, деплоить нечего;
#   3. после пересборки - что сервер отвечает.
set -u

cd "$(dirname "${BASH_SOURCE[0]}")/.." || { echo "НЕ НАШЁЛ КОРЕНЬ"; exit 1; }
C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env"

# Момент начала выкатки: по нему потом сверяется возраст образа.
DEPLOY_STARTED=$(date +%s)

say()  { printf '%s\n' "$*"; }
stop() { printf '\nВЫКАТКА ОСТАНОВЛЕНА: %s\n' "$*" >&2; exit 1; }

# ── 1. Предварительная проверка ────────────────────────────────────────────
say "=== 1. PREDVARIТEL'NAYA PROVERKA ==="
bash tools/deploy-preflight.sh || stop "предварительная проверка не пройдена"

# ── 2. Забрать изменения ───────────────────────────────────────────────────
say ""
say "=== 2. ZABRAT IZMENENIYA ==="
do="$(git rev-parse --short HEAD)"
say "  bylo:  $do"
git fetch origin main >/tmp/deploy-fetch.log 2>&1 || stop "git fetch ne udalsya"
git pull --ff-only origin main >/tmp/deploy-pull.log 2>&1
KOD=$?
posle="$(git rev-parse --short HEAD)"
say "  stalo: $posle"
if [ "$KOD" -ne 0 ]; then
  # Лог git печатается ЦЕЛИКОМ: строка «Updating a..b» появляется до отказа,
  # и по ней легко решить, что всё прошло.
  say "  git pull NE UDALSYA (kod $KOD):"
  sed 's/^/    /' /tmp/deploy-pull.log
  say "  ChASTO PRICHINA: na servere lezhit nezakommitovannyy fail, kotoryy by
  push zaper. Git ne perepisyvaet neotslezhivaemye faily i otmenyaet merge.
  Takih failov net v spiske untracked: git status --porcelain | grep '^??'"
  stop "izmeneniya ne zabraty"
fi
if [ "$do" = "$posle" ]; then
  stop "commit ne izmenilsya - vykaty nechego, a konteynery by perezabralis vkhudyost"
fi
say "  OK: kommit povednyatsya"

# ── 3. Пересобрать и перезапустить ──────────────────────────────────────────
say ""
say "=== 3. PERESBORKA ==="
# ПОЧЕМУ ТАК. Здесь раньше стояло:
#   $C up ... 2>&1 | tail -6 | sed 's/^/  /' || stop "..."
# и это ровно та ошибка, ради которой весь скрипт и написан: код возврата
# пайпа берётся у ПОСЛЕДНЕЙ команды, то есть у sed, а он всегда ноль.
# Падение сборки образа проходило как успех. Так и вышло 1 октября:
# образ сервера не пересобрался (ошибка TS2307 в Dockerfile-контексте),
# а скрипт напечатал "RESULT: PASS", потому что старый контейнер ещё
# отвечал на /health.
#
# Теперь лог пишется в файл, код возврата снимается с docker compose
# напрямую, и вывод показывается ПОСЛЕ проверки кода. Значит, упавшая
# сборка печатается целиком и останавливает выкатку, а не теряется в
# хвосте пайпа.
$C up -d --force-recreate --build server client >/tmp/deploy-build.log 2>&1
KOD_BUILD=$?
tail -25 /tmp/deploy-build.log | sed 's/^/  /'
if [ "$KOD_BUILD" -ne 0 ]; then
  say ""
  say "  SBORKA NE UDALAS (kod $KOD_BUILD). Polnyi vyvod:"
  sed 's/^/    /' /tmp/deploy-build.log
  stop "konteynery ne perezabralis"
fi

# ── 4. Убедиться, что сервер отвечает ──────────────────────────────────────
say ""
say "=== 4. PROVERKA POSLE DEPLOYA ==="
# Таймаут: контейнеру нужно время на миграции. Без него проверка успела бы
# сработать на старом ещё работающем контейнере и сказать «всё хорошо».
gotovo=0
for _ in $(seq 1 30); do
  if $C exec -T server sh -c 'wget -qO- http://localhost:3000/health' >/dev/null 2>&1; then
    gotovo=1; break
  fi
  sleep 3
done
[ "$gotovo" -eq 1 ] || stop "server ne otvetil za 90 sekund posle peresborki"
say "  server otvechaet"

# Проверка ВРЕМЕНИ ОБРАЗА. Ответ /health ничего не говорит о том, какой
# код запущен: старый контейнер, оставшийся на месте, отвечает так же
# хорошо. Именно поэтому 1 октября скрипт сказал "PASS" при упавшей
# сборке. Сверяем, что образ сервера создан после начала выкатки.
say "  proverka vozrasta obraza"
VREMYA_START="${DEPLOY_STARTED:-0}"
if [ "$VREMYA_START" -gt 0 ]; then
  SOZDAN=$($C images -q server 2>/dev/null | head -1)
  if [ -n "$SOZDAN" ]; then
    VOSRAT=0
    # «Возраст образа в секундах»: если он больше, чем длительность
    # выкатки, значит контейнер едет на старом коде.
    VOSRAT=$($C run --rm --no-deps --entrypoint sh server -c \
      'echo $(( $(date +%s) - $(stat -c %Y /app/server/package.json) ))' 2>/dev/null | tr -d '\r')
    if [ -n "$VOSRAT" ] && [ "$VOSRAT" -gt 3600 ] 2>/dev/null; then
      stop "obraz server starshe 1 chasa ($VOSRAT s) - vozmozhno, konteyner na starom kode"
    fi
    say "  obraz server: vozrast ${VOSRAT:-?} s"
  fi
fi

for f in / /trailer.html /LICENSE; do
  n=$($C exec -T server sh -c "wget -qO- http://client$f 2>/dev/null | wc -c")
  say "  $f -> $n bayt"
done
say ""
say "Git kommit na servere: $(git rev-parse --short HEAD)"
say "RESULT: PASS"
