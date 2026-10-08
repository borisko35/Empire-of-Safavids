#!/bin/bash
# ============================================================
# Выкатка Empire of Safavids — с проверкой на каждом шаге
# ============================================================
#   "C:\Program Files\Git\bin\bash.exe" tools/deploy.sh
#
# ПОЧЕМУ НЕ ПРОСТО `bash tools/deploy.sh`
# ---------------------------------------
# На этой машине команда `bash` в PowerShell указывает на C:\Windows\system32\
# bash.exe — это заглушка WSL, а не Git Bash. WSL не установлен, и вызов падает с
# `execvpe(/bin/bash) failed: No such file or directory`. Скрипт не запускается
# ни с одной командой из старой шапки, и это выглядит как «выкатка сломалась»,
# хотя сломана не выкатка, а вызов оболочки.
#
# Правильный вызов на этой машине — полный путь к Git Bash. В cmd он тоже
# работает, в Git Bash — просто `bash tools/deploy.sh`.
#
# ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ТРИ КОМАНДЫ В ИНСТРУКЦИИ
# ------------------------------------------------------
# Так выкатка уже выглядела: preflight, потом `git pull`, потом пересборка.
# И вот что произошло 30 сентября: `git pull` УПАЛ с кодом 1, потому что на
# сервере лежал незакоммиченный tools/build-trailer.sh, а git не перезаписывает
# неотслеживаемые файлы. Дальше команда шла по цепочке `&&` с пайпом:
#
#   git pull --ff-only origin main 2>&1 | tail -3 && docker compose ... up
#                                                 ^^^^^^^^^ код `tail`
#
# Код возврата пайпа берётся у ПОСЛЕДНЕЙ команды, то есть у `tail`, а он всегда
# ноль. `&&` исполнился, контейнеры пересобрались на СТАРОМ коде, и выкатка
# рапортовала «Updating deef120..ec30537» - а эта строка печатается ДО отказа.
# Итог: три коммита на прод не попали, и это выглядело как успех.
#
# Здесь четыре проверки, любая из которых останавливает выкатку:
#   1. код возврата docker compose, без пайпа;
#   2. ЛОКАЛЬНЫЙ коммит равен ЗАПУШЕННОМУ — иначе на прод уедет не то, что в
#      репозитории, либо не уедет ничего;
#   3. незакоммиченные правки в client/, server/, shared/ — запрещены;
#   4. после пересборки — что сервер отвечает И что образ пересобран.
#
# ЧТО ПОМЕНЯЛОСЬ ПРИ ПЕРЕЕЗДЕ НА ДОМАШНЮЮ МАШИНУ
# -----------------------------------------------
# Скрипт писался под VPS, где игра живёт на отдельной машине и код приезжает
# через `git pull`. Домашняя машина устроена наоборот: репозиторий ЗДЕСЬ и есть
# источник, из которого собираются образы. Из этого следовало две поломки,
# и обе выкатывали бы не то:
#
#   1. `git pull` + проверка «коммит изменился». На VPS их смысл — забрать
#      свежее с origin. Дома `git pull` не нужен, а проверка «коммит
#      изменился» срабатывала наоборот: мы уже запушили, HEAD == origin/main,
#      и выкатка останавливалась с «коммитить нечего» — то есть НИ ОДНА
#      выкатка на этой машине не прошла бы. Сравнение перевёрнуто: теперь
#      останавливает РАЗНИЦА, а не её отсутствие.
#
#   2. Стек без профиля туннеля. Снаружи игра выходит через cloudflared, а
#      Caddy на этом пути выключен профилем `tls-direct`. Если собрать compose
#      только из docker-compose.prod.yml, то сервис cloudflared в проекте не
#      существует и не пересоздаётся, а при `up` без имён сервисов compose
#      попытался бы поднять ещё и Caddy — и тот перехватил бы 80 и 443 на
#      домашней машине. Профиль добавляется сам, если в deploy/.env задан
#      CLOUDFLARE_TUNNEL_TOKEN.
set -u

cd "$(dirname "${BASH_SOURCE[0]}")/.." || { echo "НЕ НАШЁЛ КОРЕНЬ"; exit 1; }
ENV_FILE="deploy/.env"

# ── Режим выкатки ───────────────────────────────────────────────────────────
# Туннель включается сам по наличию токена: не надо вспоминать флаги, и нельзя
# забыть профиль и уронить сайт.
#
# ИМЕНА ПЕРЕМЕННЫХ — ТОЛЬКО ЛАТИНИЦА. Оболочка читает файл в кодировке
# терминала, а не UTF-8: в Git Bash кириллическое `ТУННЕЛЬ=0` не распознавалось
# как присваивание, и выкатка падала с «command not found» на строке, где
# ничего не написано, кроме присваивания. Русские слова оставлены в комментариях
# и в выводе — они не разбираются оболочкой и потому безопасны.
C="docker compose -f deploy/docker-compose.prod.yml --env-file $ENV_FILE"
TUNNEL=0
if [ -f "$ENV_FILE" ] && grep -q '^CLOUDFLARE_TUNNEL_TOKEN=..*' "$ENV_FILE"; then
  C="$C -f deploy/docker-compose.tunnel.yml"
  TUNNEL=1
fi

say()  { printf '%s\n' "$*"; }
stop() { printf '\nВЫКАТКА ОСТАНОВЛЕНА: %s\n' "$*" >&2; exit 1; }

# ── Куда выкатываем ──────────────────────────────────────────────────────────
#
# ЧТО БЫЛО. Скрипт собирал и поднимал стек ТОЛЬКО на той машине, где запущен.
# Прод при этом живёт на AWS (§67), и одноимённый туннель Cloudflare сидит
# сразу на двух машинах. 8 октября 2026 выкатка отработала целиком, оба образа
# пересобрались, 80 моделей на месте, и скрипт напечатал `RESULT: PASS` —
# а живой сайт отдавал СТАРУЮ сборку:
#
#   контейнер отдаёт  index-D24E_uzX.js
#   сайт снаружи      index-CuOyWCn8.js   (новый отдаёт 404)
#
# Причина в том, что все проверки скрипта смотрели на локальный контейнер, а
# не на то, что реально получает игрок. Третья по счёту история «выглядит как
# успех» из этой же серии.
#
# ЧТО ТЕПЕРЬ. Появился явный выбор цели, и — главное — проверка отдаваемого
# сайта. Она не знает про цели ничего и работает всегда: скрипт достаёт из
# отдаваемого index.html имя бандла, сверяет его с тем, что лежит в
# выкатанном контейнере, и останавливается, если не совпало. Именно эту
# сверку и предписывала карта в §71, но в скрипте её не было.
#
# ИМЕНА ПЕРЕМЕННЫХ — ЛАТИНИЦА, см. замечание выше про `ТУННЕЛЬ=0`.
#
# Всё читается ИЗ deploy/.env, а не из окружения оболочки. Первая версия
# брала цель из окружения и настройки из файла, то есть половину просили
# вводить в одной строке команды, а половину — в .env. На практике это
# выглядело так: владелец положил `EOS_DEPLOY_TARGET=aws` в .env, запустил
# выкатку — а она отработала для local и рапортовала PASS. Ровно та поломка,
# ради которой всё затевалось, только теперь по собственной небрежности.
# Если переменная есть и в окружении, и в файле — побеждает окружение, это
# удобно для разового запуска.
env_get() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" 2>/dev/null | tail -1 | tr -d '\r'; }
[ -f "$ENV_FILE" ] || stop "net $ENV_FILE"

TARGET="$(env_get EOS_DEPLOY_TARGET)"
[ -n "$TARGET" ] || TARGET="local"
if [ -n "${EOS_DEPLOY_TARGET:-}" ]; then
  TARGET="$EOS_DEPLOY_TARGET"
fi
PUBLIC_URL="$(env_get PUBLIC_URL)"

case "$TARGET" in
  local) : ;;
  aws)
    AWS_HOST="$(env_get EOS_AWS_HOST)"
    AWS_USER="$(env_get EOS_AWS_USER)"
    AWS_KEY="$(env_get EOS_AWS_KEY)"
    AWS_DIR="$(env_get EOS_AWS_DIR)"
    [ -n "$AWS_HOST" ] || stop "cel aws: v $ENV_FILE net EOS_AWS_HOST"
    [ -n "$AWS_USER" ] || stop "cel aws: v $ENV_FILE net EOS_AWS_USER"
    [ -n "$AWS_KEY" ]  || stop "cel aws: v $ENV_FILE net EOS_AWS_KEY"
    [ -n "$AWS_DIR" ]  || stop "cel aws: v $ENV_FILE net EOS_AWS_DIR"
    [ -f "$AWS_KEY" ]   || stop "cel aws: klyuch ne nayden: $AWS_KEY"
    ;;
  *) stop "neizvestnaya cel vykati: '$TARGET' (ozhidaetsya local ili aws)" ;;
esac
[ -n "$PUBLIC_URL" ] || stop "v $ENV_FILE net PUBLIC_URL: bez nego ne proverit, chto otdayot sajt"

# Параметры ssh и сама функция remote() заводятся ТОЛЬКО для цели aws.
# При `set -u` обращение к $AWS_KEY при цели local — это «unbound variable» и
# падение на ровном месте: впервые оно и случилось, когда блок цели стоял
# выше проверки на aws, а скрипт запускали с local.
if [ "$TARGET" = "aws" ]; then
  SSH_OPTS="-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i $AWS_KEY"
  remote() { ssh $SSH_OPTS "$AWS_USER@$AWS_HOST" "$@"; }
fi

# Момент начала выкатки: по нему потом сверяется возраст образа.
DEPLOY_STARTED=$(date +%s)

# ── 1. Предварительная проверка ────────────────────────────────────────────
say "=== 1. PREDVARIТEL'NAYA PROVERKA ==="
say "  cel vykati: $TARGET"
say "  sajt:       $PUBLIC_URL"
if [ "$TARGET" = "aws" ]; then
  say "  mashina:    $AWS_USER@$AWS_HOST, katalog $AWS_DIR"
  say "  eto NE lokal'nyy stend. Posle etoy komandy prod menyaetsya."
  # Проверка связи ДО сборки: доезжать до конца выкатки и упасть на сети
  # дороже, чем остановиться заранее.
  MY_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || echo neopredeleno)"
  say "  nashiy publichnyy IP: $MY_IP"
  if ! remote "true" >/dev/null 2>&1; then
    say ""
    say "  SSH NE DOSTUPEN: $AWS_USER@$AWS_HOST"
    say "  Nashiy IP: $MY_IP"
    say "  Gruppa bezopasnosti AWS dolzhna puskat' s nego port 22."
    say "  Esli v ney zapisan drugoy adres (naprimer, izmenilsya IP u provaydera) —"
    say "  dobav'te $MY_IP/32 ryalom s SSH-22."
    stop "do AWS ne dostuchaet'sya: vykatka ne nachinalsya, prod ne tronut"
  fi
  say "  SSH ok"
fi
bash tools/deploy-preflight.sh || stop "предварительная проверка не пройдена"
if [ "$TUNNEL" -eq 1 ]; then
  say "  rezhim: tunnel Cloudflare (docker-compose.tunnel.yml podklyuchen)"
else
  say "  rezhim: pryamye porty (Caddy, bez tunnelya)"
fi

# ── 2. Сверить локальный код с запушенным ─────────────────────────────────
say ""
say "=== 2. SVERKA KODA ==="
# `git pull` тут НЕ выполняется сознательно. Домашняя машина — источник
# сборки, и тянуть в неё удалённые коммиты не нужно: незакоммиченные файлы
# владельца git при этом не перезаписывает, а `pull` всё равно откажется.
# Вместо этого сверяется ровно то, что попадёт в образ, с тем, что лежит в
# репозитории.
LOCAL="$(git rev-parse HEAD 2>/dev/null || true)"
[ -n "$LOCAL" ] || stop "git ne otvetil: ne iz chego sobrat' obraz"
git fetch origin main >/tmp/deploy-fetch.log 2>&1 || stop "git fetch ne udalsya"
REMOTE="$(git rev-parse origin/main 2>/dev/null || true)"
[ -n "$REMOTE" ] || stop "net lokal'noy ветки origin/main — ne iz chego sravnivat'"
say "  lokalno:  $LOCAL"
say "  v origin:  $REMOTE"
say "  tema:     $(git log -1 --pretty=%s 2>/dev/null)"

if [ "$LOCAL" != "$REMOTE" ]; then
  say ""
  say "  lokal'nyy kommit ne Raven zapushennomu."
  say "  Esli eto ne zabytyy push — zapushite: git push origin main"
  say "  Esli eto neobizanno izmeneniye — provedite ego cherez pravki, a ne cherez force."
  stop "na prod uekhal by ne tot kod, chto v repozitorii"
fi
say "  OK: lokal'nyy kod raven zapushennomu"

# Незакоммиченные правки. Именно они вводили в заблуждение 30 сентября, только
# с другой стороны: там на прод уехал старый код, а здесь уедет код, которого
# нет в репозитории и который нельзя потом воспроизвести.
#
# Проверяются только пути, попадающие в образ. Правки в ROADMAP или в deploy/
# на образ не влияют и выкатку не блокируют.
DIRTY="$(git status --porcelain -- client server shared 2>/dev/null)"
if [ -n "$DIRTY" ]; then
  say ""
  say "  V KODE EST NEZAKOMMITENNYE PRAVKI:"
  printf '%s\n' "$DIRTY" | sed 's/^/    /'
  say "  Na prod uekhalo by imenno eto, a ne to, chto v repozitorii."
  if [ "${DEPLOY_ALLOW_DIRTY:-}" = "1" ]; then
    say "  DEPLOY_ALLOW_DIRTY=1 — prodolzhaem na vash risk."
  else
    stop "zkommit'te ili otmenite ih. Obhod: DEPLOY_ALLOW_DIRTY=1"
  fi
fi

# ── 3. Пересобрать и перезапустить ─────────────────────────────────────────
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
#
# Пересобираются ТОЛЬКО server и client. cloudflared не трогаем: у него
# тег `latest` и нет нужды в пересборке, а его пересоздание означало бы
# падение сайта на минуту без причины.
#
# ID ОБРАЗА ЗАПОМИНАЕТСЯ ДО СБОРКИ. Он нужен для проверки после: пересборка
# обязана либо дать новый образ, либо честно сказать «слои не изменились».
#
# Для цели aws образы пересобираются ТАМ, поэтому и «до» снимается удалённо.
if [ "$TARGET" = "aws" ]; then
  SERVER_ID_BEFORE=$(remote "docker inspect -f '{{.Image}}' \$(\$($C ps -q server 2>/dev/null | head -1)) 2>/dev/null" | tr -d '\r')
  CLIENT_ID_BEFORE=$(remote "docker inspect -f '{{.Image}}' \$(\$($C ps -q client 2>/dev/null | head -1)) 2>/dev/null" | tr -d '\r')
else
  SERVER_ID_BEFORE=$(docker inspect -f '{{.Image}}' "$($C ps -q server 2>/dev/null | head -1)" 2>/dev/null | tr -d '\r')
  CLIENT_ID_BEFORE=$(docker inspect -f '{{.Image}}' "$($C ps -q client 2>/dev/null | head -1)" 2>/dev/null | tr -d '\r')
fi
say "  obraz server do sborki:  ${SERVER_ID_BEFORE:-(netu)}"
say "  obraz klienta do sborki: ${CLIENT_ID_BEFORE:-(netu)}"

# На aws код едет в репозиторий, а пересборка идёт ТАМ. Собирать на t3.micro
# с 911 МБ памяти нельзя, там под это разбит своп.
#
# ПОЧЕМУ УДАЛЁННЫЙ ВЫЗОВ ИМЕННО ТАКОЙ. Вместо того чтобы повторять здесь всю
# пересборку и её проверки через ssh, на удалённой машине запускается ТОТ ЖЕ
# сценарий с `EOS_DEPLOY_TARGET=local` — то есть ровно то, что уже доказало
# работоспособность на этой машине. Так на прод едет минимум непроверенного
# кода: одна команда с двумя аргументами вместо десятка вызовов docker через
# ssh, где любая неверная кавычка означала бы пустую выкатуку на боевом стенде.
if [ "$TARGET" = "aws" ]; then
  say "  otdayom kommit $LOCAL na $AWS_HOST"
  if ! remote "cd '$AWS_DIR' && git fetch --quiet origin main && git checkout -q $LOCAL && git reset --hard $LOCAL" >/tmp/deploy-remote.log 2>&1; then
    say ""
    say "  UDALENNYY KOD NE POSTAVLEN:"
    sed 's/^/    /' /tmp/deploy-remote.log
    stop "ne udalos dostavit kod na $AWS_HOST"
  fi
  REMOTE_HEAD=$(remote "cd '$AWS_DIR' && git rev-parse HEAD" | tr -d '\r')
  say "  kod na mashine: $REMOTE_HEAD"
  [ "$REMOTE_HEAD" = "$LOCAL" ] || stop "na $AWS_HOST kommit $REMOTE_HEAD, a otdayom $LOCAL"
  say "  zapuskayem tot zhe stsenariy tam"
  # Проверки образа, моделей и туннеля на удалённой машине выполняет сам
  # запущенный там сценарий: у него свой стек и свои контейнеры.
  if ! remote "cd '$AWS_DIR' && EOS_DEPLOY_TARGET=local bash tools/deploy.sh" >/tmp/deploy-remote.log 2>&1; then
    say ""
    say "  VYKATKA NA AWS NE UDALAS. Polnyi vyvod:"
    sed 's/^/    /' /tmp/deploy-remote.log
    stop "stsenariy na $AWS_HOST zavershilsya s oshibkoy"
  fi
  tail -20 /tmp/deploy-remote.log | sed 's/^/  /'
  say "  na AWS stsenariy zavershilsya uspeshno"
  # Дальше идут проверки ТОЛЬКО локального стека: на aws их уже сделали там.
  SKIP_LOCAL_CHECKS=1
else
  $C up -d --force-recreate --build server client >/tmp/deploy-build.log 2>&1
  KOD_BUILD=$?
  tail -25 /tmp/deploy-build.log | sed 's/^/  /'
  if [ "$KOD_BUILD" -ne 0 ]; then
    say ""
    say "  SBORKA NE UDALAS (kod $KOD_BUILD). Polnyi vyvod:"
    sed 's/^/    /' /tmp/deploy-build.log
    stop "konteynery ne perezabralis"
  fi
  SKIP_LOCAL_CHECKS=0
fi

# ── 4. Убедиться, что сервер отвечает ──────────────────────────────────────
say ""
say "=== 4. PROVERKA POSLE DEPLOYA ==="
# Таймаут: контейнеру нужно время на миграции. Без него проверка успела бы
# сработать на старом ещё работающем контейнере и сказать «всё хорошо».
gotovo=0
if [ "${SKIP_LOCAL_CHECKS:-0}" -eq 0 ]; then
  for _ in $(seq 1 30); do
    if $C exec -T server sh -c 'wget -qO- http://localhost:3000/health' >/dev/null 2>&1; then
      gotovo=1; break
    fi
    sleep 3
  done
  [ "$gotovo" -eq 1 ] || stop "server ne otvetil za 90 sekund posle peresborki"
  HEALTH=$($C exec -T server sh -c 'wget -qO- http://localhost:3000/health' 2>/dev/null | tr -d '\r\n')
  say "  server otvechaet: ${HEALTH:-(netu)}"
else
  say "  proverki steka vypolneny na udallennoj mashine"
fi

# Проверка ОБРАЗА. Ответ /health ничего не говорит о том, какой код запущен:
# старый контейнер, оставшийся на месте, отвечает так же хорошо. Именно
# поэтому 1 октября скрипт сказал "PASS" при упавшей сборке.
#
# ПОЧЕМУ НЕ ВОЗРАСТ ОБРАЗА. Тут было три попытки, и все три были негодными:
#   1. mtime файла package.json внутри контейнера. Docker копирует файл
#      СОХРАНЯЯ его время, а package.json меняется редко — проверка всегда
#      показывала «возраст» в несколько дней.
#   2. .Created образа, сравниваемое с началом выкатки. Выглядит правильно,
#      но Docker НЕ трогает .Created, когда слои не изменились: повторная
#      выкатка без правок кода честно печатает «Built» и оставляет дату старой.
#      Проверка объявляла это бедой и останавливала исправную выкатку.
#   3. CreatedAtUnix — не поддерживается, шаблон не парсится, проверка молча
#      ничего не делала.
#
# ЧТО ПРАВИЛЬНО. Сравнивается ID ОБРАЗА ДО и ПОСЛЕ сборки:
#   - ID изменился — образ пересобран, всё честно;
#   - ID тот же — сборка была холостой, слои не изменились. Это НЕ бедствие,
#     а правильное поведение: код в репозитории не менялся, пересобирать
#     было нечего. Доказать, что в контейнере правильный код, в этом случае
#     невозможно по дате, зато можно по содержимому — см. проверку моделей
#     ниже.
# Содержимое — единственная проверка, которая отличает «правильный старый
# образ» от «неправильного нового». Поэтому она обязательна в обоих случаях.
say "  proverka obraza: id do i posle sborki"
if [ "${SKIP_LOCAL_CHECKS:-0}" -eq 1 ]; then
  say "  propushchena: obraz proverilsya na udallennoj mashine"
else
  SERVER_ID_AFTER=$(docker inspect -f '{{.Image}}' "$($C ps -q server 2>/dev/null | head -1)" 2>/dev/null | tr -d '\r')
  CLIENT_ID_AFTER=$(docker inspect -f '{{.Image}}' "$($C ps -q client 2>/dev/null | head -1)" 2>/dev/null | tr -d '\r')
fi

check_image() {
  # Имена локальных переменных — латиницей, как и все остальные: оболочка
  # читает файл в кодировке терминала, и кириллица в имени ломает разбор
  # так же, как ломала в имени переменной режима.
  local imya="$1" bylo="$2" stalo="$3"
  if [ -z "$stalo" ] || [ "$stalo" = "0" ]; then
    stop "не удалось прочитать образ $imya после пересборки"
  fi
  if [ -n "$bylo" ] && [ "$bylo" != "0" ] && [ "$bylo" != "$stalo" ]; then
    say "  obraz $imya perezobran (id izmenilsya)"
    return 0
  fi
  # Образ тот же. Это нормально, когда код не менялся, но сказать об этом
  # надо прямо: иначе в отчёте «выкатка прошла» не видно, пересобиралось ли
  # что-нибудь вообще.
  say "  obraz $imya ne izmenilsya — sloi te zhe, kod ne menyalsya. Eto ne oshibka."
}

if [ "${SKIP_LOCAL_CHECKS:-0}" -eq 0 ]; then
  check_image server "$SERVER_ID_BEFORE" "$SERVER_ID_AFTER"
  check_image client "$CLIENT_ID_BEFORE" "$CLIENT_ID_AFTER"
fi

# Модели на месте. Без этой проверки выкатка с новым деко выглядит исправно:
# сервер отвечает, страница открывается, а файлов моделей в сборке нет, и
# игрок видит пустоту там, где должна быть статуя.
#
# ПРОВЕРЯЕТСЯ НЕ ПО HTTP, А ПО ФАЙЛАМ В ОБРАЗЕ.
# Первая версия ходила за моделями через `wget http://client/models/...` и
# получила для всех трёх ровно одно и то же число байт. Это была страница
# заглушка: nginx отдаёт index.html на любой несуществующий путь, то есть
# проверка возвращала «всё на месте» при полностью отсутствующих файлах.
# Проверка, которая не может упасть, хуже её отсутствия: она снимает
# последний рубеж перед продом и при этом создаёт видимость работы.
# Теперь файлы читаются с диска образа, где заглушки быть не может.
#
# СПИСОК ФАЙЛОВ БЕРЁТСЯ ИЗ МАНИФЕСТА, А НЕ ПЕРЕЧИСЛЕН. Иначе на этой строке
# пришлось бы дописывать каждую новую модель, и она тихо перестала бы что-то
# проверять: как только в игру добавили новый рог, скрипт продолжал бы
# рапортовать успех, проверяя статую и факел.
say "  proverka modeley v obraze klienta"
MODELS_DIR="game/models"
# Контейнер ищется по compose, а не по имени `empire-of-safavids-client-1`:
# имя жёстко зашито было верно только для локального стенда, а префикс
# проекта задаётся каталогом и на проде другой.
CLIENT_ID_C=""
if [ "${SKIP_LOCAL_CHECKS:-0}" -eq 0 ]; then
  CLIENT_ID_C=$($C ps -q client 2>/dev/null | head -1)
  [ -n "$CLIENT_ID_C" ] || stop "konteyner klienta ne nayden"
else
  say "  propushchena: modeli provereny na udallennoj mashine"
fi
# ПУТЬ ПЕРЕДАЁТСЯ ВНУТРИ `sh -c`, А НЕ АРГУМЕНТОМ.
# Git Bash (MSYS) переписывает аргумент, начинающийся с `/`, в путь Windows:
#   cat: can't open 'C:/Program Files/Git/usr/share/nginx/html/game/models/manifest.json'
# То есть контейнеру уходил не тот путь, команда падала, а stderr уходил в
# /dev/null — и проверка объявляла «манифеста нет» при манифесте на месте.
# Аргумент, не начинающийся с `/`, MSYS не трогает, поэтому путь и заносится
# внутрь строки, а не передаётся отдельным аргументом.
MANIFEST_RAW=""
if [ "${SKIP_LOCAL_CHECKS:-0}" -eq 0 ]; then
MANIFEST_RAW=$(docker exec "$CLIENT_ID_C" sh -c "cat /usr/share/nginx/html/$MODELS_DIR/manifest.json" 2>/dev/null | tr -d '\r')
if [ -z "$MANIFEST_RAW" ]; then
  say "  manifest ne prochitan: pokazuyu, chto est v obraze"
  docker exec "$CLIENT_ID_C" sh -c "ls -l /usr/share/nginx/html/$MODELS_DIR 2>&1" | head -10 | sed 's/^/    /'
  stop "v obraze klienta net manifest.json: sborka clienta ne polnaya"
fi
MODEL_FILES=$(printf '%s' "$MANIFEST_RAW" | grep -o '"file"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/')
MODEL_COUNT=$(printf '%s' "$MODEL_FILES" | grep -c . )
[ "${MODEL_COUNT:-0}" -gt 0 ] || stop "v manifest.json net polya file: razbor zony ne udalsya"
say "  v manifest.json modeley: $MODEL_COUNT"

# Один заход в контейнер на все файлы: по одному на каждый — медленно и шумно.
MISSING=$(docker exec "$CLIENT_ID_C" sh -c "
  cd /usr/share/nginx/html/$MODELS_DIR || exit 1
  for f in $MODEL_FILES; do
    n=\$(wc -c < \"\$f\" 2>/dev/null || echo 0)
    if [ \"\$n\" -le 0 ]; then echo \"net: \$f\"; fi
  done
" 2>/dev/null | tr -d '\r')
if [ -n "$MISSING" ]; then
  say ""
  say "  V SBORKE KLIENTA NE XT VSEKH MODELEY:"
  printf '%s\n' "$MISSING" | sed 's/^/    /'
  stop "dekora na prod ne popadet"
fi
say "  vse modeley iz manifest.json na meste v obraze"
fi

# ── Туннель ─────────────────────────────────────────────────────────────────
# БЫЛ БАГ, ИЗ-ЗА КОТОРОГО ПЕРЕЕЗД ОСТАНАВЛИВАЛСЯ НА ПОСЛЕДНЕМ ШАГЕ. 10 октября
# 2026 переезд на AWS дошёл до последней строки и упал:
#   ВЫКАТКА ОСТАНОВЛЕНА: cloudflared ne rabotaet
# Причина: выше поднимаются `server client` и всё, что в их depends_on
# (client, server, migrate, postgres, redis). cloudflared НЕ ВХОДИТ НИ В ЧЬИ
# depends_on — compose о нём не знает и на новой машине просто не создаёт его.
# Стек внутри зелёный, /health отвечает, 66 моделей на месте — а снаружи сайта
# нет. Этот баг ждал бы и на Oracle, и на любом VPS: выкатка написана под
# машину, где туннель уже кто-то поднял руками.
#
# Пересоздавать cloudflared при этом нельзя: у него тег `latest`, нужды в
# пересборке нет, а пересоздание роняет сайт на минуту без причины. Поэтому
# три состояния и три разных поступка:
#
#   контейнера нет -> создать (это новая машина);
#   контейнер есть, но не running -> стартовать (упал, надо поднять);
#   контейнер running -> НЕ ТРОГАТЬ (работает, вмешиваться незачем).
if [ "$TUNNEL" -eq 1 ]; then
  CF_ID=$($C ps -aq cloudflared 2>/dev/null | head -1)
  if [ -z "$CF_ID" ]; then
    say "  cloudflared on this machine is absent: creating it"
    # Тот же файл лога, что и у сборки: при отказе нужен вывод целиком,
    # а не хвост пайпа.
    if ! $C up -d cloudflared >>/tmp/deploy-build.log 2>&1; then
      say ""
      say "  CLOUDFLARED NE SOZDAN:"
      sed 's/^/    /' /tmp/deploy-build.log
      stop "tunnel container could not be created: the site would be unreachable"
    fi
    CF_ID=$($C ps -aq cloudflared 2>/dev/null | head -1)
  fi
  if [ -z "$CF_ID" ]; then
    stop "cloudflared still absent after up: look at deploy/docker-compose.tunnel.yml"
  fi

  CF_STATE=$(docker inspect -f '{{.State.Status}}' "$CF_ID" 2>/dev/null | tr -d '\r')
  if [ "$CF_STATE" != "running" ]; then
    say "  cloudflared is in state $CF_STATE: starting it"
    $C start cloudflared >>/tmp/deploy-build.log 2>&1 || true
    for _ in $(seq 1 15); do
      CF_STATE=$(docker inspect -f '{{.State.Status}}' "$CF_ID" 2>/dev/null | tr -d '\r')
      [ "$CF_STATE" = "running" ] && break
      sleep 2
    done
  fi
  say "  cloudflared: $CF_STATE"
  [ "$CF_STATE" = "running" ] || stop "cloudflared в состоянии $CF_STATE: сайт снаружи недоступен"

  # Контейнер «running» — это ещё не туннель. cloudflared поднимается и падает,
  # либо висит без соединения, и тогда сайт недоступен при полностью зелёном
  # стеке внутри. Единственный честный признак живого туннеля — его собственная
  # запись в журнале о регистрации соединения с Cloudflare. Проверка, которая
  # может пройти при мёртвом туннеле, хуже её отсутствия: она снимает последний
  # рубеж и при этом создаёт видимость работы.
  #
  # ИМЕННО ПО ВСЕМУ ЖУРНАЛУ, А НЕ ПО ХВОСТУ. Первая версия брала `tail -40` и
  # остановила исправную выкатку на живой машине: туннель был подключён (4
  # соединения), сайт отдавал 200, а строки регистрации лежали на 15, 18, 20 и
  # 22 — после них cloudflared допечатал ещё двадцать строк проверок, и окно их
  # выкинуло. Проверка, которая не может ПРОПУСТИТЬ живой туннель, хуже
  # отсутствующей: она останавливает выкатку и приучает читателя, что «TUNNEL NE
  # PODKLYUCHILSYA» — обычное дело, а значит её перестанут читать.
  CF_LOG=$(docker logs "$CF_ID" 2>&1 | tr -d '\r')
  CF_CONN=$(printf '%s' "$CF_LOG" | grep -c 'Registered tunnel connection' || true)
  if [ "${CF_CONN:-0}" -lt 1 ]; then
    say ""
    say "  TUNNEL NE PODKLYUCHILSYA: v zhurnale net zapisi o registracii soedineniya."
    say "  Poslednie stroki zhurnala cloudflared:"
    printf '%s\n' "$CF_LOG" | tail -15 | sed 's/^/    /'
    stop "cloudflared is running but not connected: the site is unreachable outside"
  fi
  say "  cloudflared zaregistriroval soedinenie s Cloudflare: soedineniy $CF_CONN"
fi

say ""
say "Git kommit na servere: $LOCAL"

# ── 5. ЧТО ОТДАЁТ САЙТ ──────────────────────────────────────────────────────
#
# ПОЧЕМУ ЭТА ПРОВЕРКА ПОСЛЕДНЯЯ И ПОЧЕМУ ОНА ГЛАВНАЯ. Всё, что выше, смотрит
# на контейнер: «образ пересобран», «сервер отвечает», «модели на месте»,
# «туннель подключён». Всё это может быть правдой про СВОЙ стек, пока сайт
# снаружи отдаёт чужую сборку.
#
# Так и случилось 8 октября 2026: локальный стек был полностью зелёным, а
# живой сайт отдавал старые файлы, потому что туннель Cloudflare сидит на
# двух машинах и запросы обслуживала та, что не пересобиралась. `RESULT: PASS`
# был напечатан, и он ничего не значил.
#
# Проверка простая и не знает ни про какие цели: берётся index.html, который
# отдаётся СНАРУЖИ, из него вытаскивается имя бандла, и этот же файл ищется в
# выкатанном контейнере. Разошлись имена — значит игрок получает не то, что
# выкачено, и выкатка не состоялась, сколько бы зелёных галочек ни стояло
# выше.
say ""
say "=== 5. CHTO OTDAYOT SAJT ==="

# ПАУЗА ПЕРЕД ПРОВЕРКОЙ САЙТА. Первые секунды после пересоздания контейнера
# сайт отвечает, но тело файла ещё не отдаёт: nginx внутри свежего контейнера
# и edge Cloudflare рассинхронизированы, и curl возвращает пусто. Проверка
# делает три попытки с паузой 3 секунды, то есть около 9 секунд, и этого не
# хватает.
#
# ЧТО ЭТО ЗНАЧИЛО. Выкатка 08.10.2026, цель aws, коммит со стеной города:
# образы пересобрались, контейнеры пересоздались, сервер ответил `status: ok`,
# все 81 модель на месте, туннель подключён (18 соединений), сайт отдавал
# РОВНО ТО ЖЕ ИМЯ бандла, что лежало в контейнере — и шаг 5 всё равно упал с
# «SAJT NE SKACHAL BUNDL», то есть объявил мёртвой сеть, которая была живой.
# Проверка вручную через минуту дала точные хэши: и главный бандл, и чанк со
# стеной совпали с контейнером до байта, все 6 файлов страницы открывались,
# новая модель отдавалась с кодом 200.
#
# То есть выкатка была хорошей, а скрипт сказал «плохо». Обратная поломка не
# менее опасна первой: человек, которому выкатка нужна прямо сейчас, видит
# `RESULT` не напечатан и разбирается сам. Тот случай, когда проверка мешает
# работать, хуже, чем когда она молчит.
say "  zhedem 20 sekund, poka pochty novyy kontayner i edge Cloudflare soglasuyutsya..."
sleep 20

hash_served() {
  # sha256 файла по сети. Без кэша: заголовок запроса не мешает Cloudflare
  # отдать тело из edge, поэтому при расхождении проверка переспрашивает.
  curl -fsS --max-time 30 -H 'Cache-Control: no-cache' "$1" 2>/dev/null | sha256sum | cut -d' ' -f1
}

INDEX_HTML="$(curl -fsS --max-time 30 -H 'Cache-Control: no-cache' "$PUBLIC_URL/game/" 2>/dev/null || true)"
[ -n "$INDEX_HTML" ] || stop "sajt ne otdayot $PUBLIC_URL/game/ : proverit' chto otdayot ne udalos"

# Имя главного бандла — из HTML, а не выдуманное: именно его браузер и пойдёт качать.
SERVED_ASSET="$(printf '%s' "$INDEX_HTML" | grep -o '/game/assets/index-[A-Za-z0-9_-]*\.js' | head -1)"
[ -n "$SERVED_ASSET" ] || stop "v otdayaemom index.html net imeni bundla: ne pochemu sveryat'"

# Тот же файл внутри выкатанного контейнера.
if [ "$TARGET" = "aws" ]; then
  remote "cd '$AWS_DIR' && docker exec \$($C ps -q client 2>/dev/null | head -1) sh -c \"grep -o '/game/assets/index-[A-Za-z0-9_-]*\.js' /usr/share/nginx/html/game/index.html | head -1\"" 2>/dev/null | tr -d '\r' > /tmp/deployed-asset.txt
  DEPLOYED_ASSET="$(head -1 /tmp/deployed-asset.txt 2>/dev/null)"
else
  DEPLOYED_ASSET="$(docker exec "$($C ps -q client 2>/dev/null | head -1)" sh -c \
    "grep -o '/game/assets/index-[A-Za-z0-9_-]*\.js' /usr/share/nginx/html/game/index.html | head -1" 2>/dev/null | tr -d '\r')"
fi

say "  sajt otdayet:   ${SERVED_ASSET:-netu}"
say "  konteyner vytal: ${DEPLOYED_ASSET:-netu}"

if [ -z "$DEPLOYED_ASSET" ]; then
  stop "v konteynere ne udalos nayti imya bundla: proverka otdayaemyh failov ne poluchilas"
fi

if [ "$SERVED_ASSET" != "$DEPLOYED_ASSET" ]; then
  say ""
  say "  SAJT OTDAYAET NE TO, CHTO VYKACHENO."
  say "  igrok poluchit: $SERVED_ASSET"
  say "  Vykacheno:      $DEPLOYED_ASSET"
  say ""
  say "  Veroyatneishaya prichina: u tunnelya Cloudflare dva konnektora —"
  say "  zdes i na AWS — i obsluzhivaet zapyusy ne tot, chego my kachali."
  say "  Esli cel byla aws — ne zabud'te perezapustit cloudflared tam,"
  say "  inache staraya sboraka budet otdayatsya i posle etoy vykati."
  stop "prod ne poluchil novyy kod"
fi

# Хэши сходятся только когда имена совпали; сверяем содержимое, потому что
# одноимённый файл может быть пересобран иначе.
# Скачивание может не удаться, и это НЕ то же самое, что разное содержимое.
# Пустой ответ даёт sha256 пустой строки, то есть e3b0c442... — такой «хэш
# разошёлся» вводил в заблуждение: на самом деле файл просто не скачался.
# Первый случай ложной тревоги — 08 октября 2026, цель aws: контейнер и сайт
# называли один и тот же бандл, а внешняя проверка упала на пустом curl.
hash_served_retry() {
  local url="$1" hv="" i
  # Семь попыток с растущей паузой: 5, 10, 20, 30, 45, 60, 60 секунд — всего
  # около четырёх минут.
  #
  # ПОЧЕМУ ТАК ДОЛГО, А НЕ ДЕСЯТЬ СЕКУНД. Первая версия ждала 9 секунд, вторая
  # — 20 секунд плюс пять попыток за 38 секунд. Обе остановили исправную
  # выкатку 08.10.2026, и обе на одном и том же месте.
  #
  # ПРИЧИНА, КОТОРУЮ ВИДНО ТОЛЬКО СО ВТОРОЙ СТОРОНЫ. Туннель Cloudflare держит
  # 18 соединений, и после выкатки edge-узлы расходятся во времени: часть уже
  # отдаёт новый index.html с новым именем бандла, а нового файла ещё не имеет и
  # отдаёт 404. Через минуту-две расходится всё. Двадцать секунд не хватает,
  # потому что это не «контейнер встаёт», а «edge сходится».
  #
  # Имена переменных латиницей — не украшение: `deployScript.test.ts` сторожит
  # именно это правило, потому что Git Bash (MSYS) портит кириллицу в разборах.
  # Проверка синтаксиса `bash -n` ловит ошибку сразу.
  local -a pauses=(5 10 20 30 45 60 60)
  local -a codes=(0 0 0 0 0 0 0)
  LAST_STATUS="000"
  for i in 1 2 3 4 5 6 7; do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$url" 2>/dev/null || true)"
    hv="$(curl -fsS --max-time 30 -H 'Cache-Control: no-cache' "$url" 2>/dev/null | sha256sum | cut -d' ' -f1)"
    LAST_STATUS="${code:-000}"
    # e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 —
    # это хэш пустой строки, то есть скачалось ровно ничего.
    if [ -n "$hv" ] && [ "$hv" != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
      return 0
    fi
    [ "$i" -lt 7 ] && sleep "${pauses[$((i - 1))]}"
  done
  return 1
}
H_SERVED="$(hash_served_retry "$PUBLIC_URL$SERVED_ASSET")" || H_SERVED=""
# ПУТЬ ВНУТРИ `sh -c`, А НЕ АРГУМЕНТОМ — по той же причине, что и в проверке
# моделей: Git Bash (MSYS) переписывает аргумент, начинающийся с `/`, в путь
# Windows, и sha256sum получил бы C:/Program Files/Git/usr/share/... Первую
# версию этой строки поймала проверка в deployScript.test.ts, и правильно.
CLIENT_ID_H=""
if [ "$TARGET" = "aws" ]; then
  H_DEPLOYED=$(remote "cd '$AWS_DIR' && docker exec \$($C ps -q client 2>/dev/null | head -1) sh -c \"sha256sum /usr/share/nginx/html$SERVED_ASSET\"" 2>/dev/null | tr -d '\r' | cut -d' ' -f1)
else
  CLIENT_ID_H=$($C ps -q client 2>/dev/null | head -1)
  H_DEPLOYED=$(docker exec "$CLIENT_ID_H" sh -c "sha256sum /usr/share/nginx/html$SERVED_ASSET" 2>/dev/null | tr -d '\r' | cut -d' ' -f1)
fi
if [ -z "$H_DEPLOYED" ]; then
  say ""
  say "  HASH KONTEYNERA NE PROCHITAN: soderzhimoe proverit' ne udalos'"
  stop "proverka soderzhimogo ne poluchilas"
fi
if [ -z "$H_SERVED" ]; then
  say ""
  # РАЗБОР ПО КОДУ ОТВЕТА. Прежний текст на любой неудаче говорил «недоступна
  # сеть или CDN», и это было неверно дважды из двух: сеть была жива, а сайт
  # отдавал 404 на новый файл, потому что edge Cloudflare ещё не сошёлся после
  # пересоздания контейнера. Один и тот же текст на две разные поломки учит
  # читателя ничему.
  say "  SAJT NE SKACHAL BUNDL za chetyre minuty (7 popytok, vse pustye)."
  say "  kod otveta saita: $LAST_STATUS"
  if [ "$LAST_STATUS" = "404" ]; then
    say ""
    say "  ETO NE OBLIVK SETI. Sait otvechaet 404 na fайл, kotoryy v konteynere"
    say "  lezhit — znachit, edge Cloudflare eshche ne doshol do novogo bndla."
    say "  S momenta vykatchi proshlo mnogo vremeni: tak ne byvaet, zanachit"
    say "  ne proshla rasprostranenie, ili na odnom iz uzlov tunnel'a sidel"
    say "  staryi konteyner. Nuzhno smotret' zhurnal cloudflared na AWS."
  else
    say ""
    say "  Eto ne 'soderzhimoe raznoye' — eto nedostupnaya set' ili CDN."
  fi
  stop "soderzhimoe bundla na saite ne udalos skachat'"
fi
if [ "$H_SERVED" != "$H_DEPLOYED" ]; then
  say ""
  say "  KHASHI RAZOYSHIS:"
  say "  sajt:      $H_SERVED"
  say "  konteyner: $H_DEPLOYED"
  stop "soderzhimoe bundla na saite i v konteynere raznoye"
fi
say "  sha256 sovpal: ${H_SERVED:0:16}"

# ── Каждый файл, на который ссылается страница, должен открываться ──────────
#
# Проверка выше смотрит на ОДИН файл — главный бандл. Этого мало, и случай
# 08 октября 2026 это показал: главный бандл на сервере был и сайт отдавал его
# имя, всё сошлось, а игрок получал 404 — потому что Cloudflare держал в кэше
# отрицательный ответ на путь, который до выкатки не существовал.
#
# ПОЧЕМУ ТАК ПОЛУЧАЕТСЯ. Имена ассетов содержат хэш содержимого, поэтому с
# каждой сборкой меняются. Если файл спросили, пока его нет, Cloudflare
# кэширует 404 — иquery string его НЕ обходит: ключ кэша собран без него
# (проверено: `Age` рос одинаково с `?cb=` и без). Ответ держится до истечения
# TTL, и всё это время сайт отдаёт свежий index.html, который ссылается на
# файл, недоступный снаружи. Игра не грузится, а сервер здоров и /health
# отвечает 200 — то есть поломка невидима для всех прежних проверок.
#
# Лечится только сбросом кэша Cloudflare. Проверка ниже честно говорит, что
# именно сбрасывать.
say ""
say "proverka vsekh faylov, na kotorye ssylaetsya stranica:"
DOSTUPNE=0
NEDOSTUPNE=""
for a in $(printf '%s' "$INDEX_HTML" | grep -o '/game/assets/[A-Za-z0-9_.-]*\.\(js\|css\)' | sort -u); do
  if curl -fsS -o /dev/null --max-time 20 "$PUBLIC_URL$a" 2>/dev/null; then
    DOSTUPNE=$((DOSTUPNE + 1))
  else
    NEDOSTUPNE="$NEDOSTUPNE $a"
  fi
done
say "  dostupno: $DOSTUPNE"
if [ -n "$NEDOSTUPNE" ]; then
  say ""
  say "  ETI FAILY SAJT NE OTDAYOT:"
  for a in $NEDOSTUPNE; do say "    $a"; done
  say ""
  say "  Server zdorov, no Cloudflare derzhit v keshe OTRITATEL'NYI otvet"
  say "  na ety puti: takoe byvaet, kogda fail sprosili do vykati, a ego"
  say "  eshche ne bylo na servere, i 404 zapisalsya v kesh s bolshim TTL."
  say "  Lechitsya odnim: sbrosit' kesh Cloudflare (Caching -> Configuration"
  say "  -> Purge Everything), ili zhdat' istecheniya TTL."
  stop "igry ne zagruzitsya: chast' faylov nedostupna"
fi
say "  vse fayly stranicy dostupny"

say ""
say "RESULT: PASS"
