#!/usr/bin/env bash
# ============================================================
# Подготовка новой машины под игру — Empire of Safavids
# ============================================================
#   bash tools/bootstrap-machine.sh
#
# ЗАЧЕМ ЭТОТ СКРИПТ
# ------------------------------------------------------
# Переезд на другую машину делается в шесть шагов, и пять из них — не про игру:
# поставить Docker, забрать репозиторий, положить секреты, открыть туннель,
# не забыть про free-тайриф. Каждый шаг можно сделать неправильно, и тогда
# сайт либо не поднимется, либо поднимется с выключенным входом.
#
# Переезд на Oracle Cloud упирался ровно в это: iptables у Oracle режет всё, что
# не разрешено явно, и «порт открыт в панели» не значит «порт открыт в системе».
# На это уходил день. Здесь это решение принято заранее:
#
#   МЫ НЕ ОТКРЫВАЕМ ПОРТЫ И НЕ ДАЁМ МАШИНЕ СВОЙ IP.
#   Идём через туннель Cloudflare, тем же самым, что уже работает. Тогда:
#     * править iptables не нужно вовсе;
#     * сертификат выпускает Cloudflare, а не Caddy;
#     * DNS менять не нужно — адрес уже указывает на туннель;
#     * Caddy выключается профилем, порты 80 и 443 на машине не занимаются.
#
# ЧТО НУЖНО ОТ ВЛАДЕЛЬЦА ДО ЗАПУСКА
# -----------------------------------
# 1. Машина создана, на неё можно зайти:  ssh ubuntu@<ip>
# 2. deploy/.env лежит на машине. Скрипт его НЕ придумывает и НЕ создаёт пустой:
#    молчаливый пустой файл поднимает сервер с выключенным входом, и это замечают
#    только игроки. Если файла нет — скрипт печатает точную команду
#    восстановления из резервной копии и останавливается.
#
# ФАЗЫ
# ----
#   0. что это за машина
#   1. Docker и плагин compose
#   2. репозиторий
#   3. секреты
#   4. выкатка
#   5. проверка
#
# СКРИПТ ИДЕМПОТЕНТЕН. Каждая фаза сначала проверяет, сделано ли уже, и только
# потом делает. Повторный запуск на машине, где всё уже есть, ничего не ломает
# и заканчивается той же фразой «ГОТОВО».
set -uo pipefail

say()  { printf '%s\n' "$*"; }
step() { printf '\n=== %s ===\n' "$*"; }
die()  { printf '\nОСТАНОВЛЕНО: %s\n' "$*" >&2; exit 1; }

REPO_URL="https://github.com/borisko35/Empire-of-Safavids.git"
HOME_DIR="${HOME_DIR:-$HOME}"
PROJECT_DIR="$HOME_DIR/Empire-of-Safavids"

say "=========================================================="
say " Подготовка машины под Empire of Safavids"
say "=========================================================="

# ── 0. Что это за машина ────────────────────────────────────────────────────
step "0. MASHINA"

if [ "$(uname -s)" != "Linux" ]; then
  die "script only runs on Linux, here is $(uname -s)"
fi
say "  system:  $(uname -sr)"
say "  arch:    $(uname -m)"

# ARM против amd64. Образы публикуют оба, и пересобирать ничего не нужно, но
# сказать вслух полезно: на ARM неожиданно падают apt-пакеты, если их доустанавливать.
case "$(uname -m)" in
  aarch64|arm64) say "  ARM64: vse obrazy Docker Hub est, peresborka ne nuzhna" ;;
  x86_64)        say "  amd64: vse obrazy Docker Hub est" ;;
  *)             die "unknown architecture $(uname -m)" ;;
esac

if [ -r /etc/os-release ]; then
  . /etc/os-release 2>/dev/null || true
  say "  distro:  ${PRETTY_NAME:-?}"
fi

# ── 1. Docker ──────────────────────────────────────────────────────────────
step "1. DOCKER"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  say "  Docker already here: $(docker --version)"
  say "  compose plugin:      $(docker compose version --short 2>/dev/null || echo '?')"
else
  say "  installing Docker from the official script"
  # get.docker.com НЕ выполняет произвольный код из репозитория игры: это
  # официальный установщик Docker, и он же проверяет подпись. Своего скрипта
  # для установки Docker не пишем — писать установщик системных пакетов
  # значит завести ещё один источник ошибок.
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh \
      || die "could not download the Docker installer: check the network"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO /tmp/get-docker.sh https://get.docker.com \
      || die "could not download the Docker installer: check the network"
  else
    die "neither curl nor wget: there is no way to download the installer"
  fi
  say "  running the installer (needs sudo)"
  sudo sh /tmp/get-docker.sh || die "the Docker installer failed: read its output above"
fi

if ! command -v docker >/dev/null 2>&1; then
  die "docker is still not on PATH after installation"
fi
docker compose version >/dev/null 2>&1 \
  || die "the compose plugin is missing: `docker compose` does not work, and the whole deploy is written for it"
say "  OK: $(docker --version), compose $(docker compose version --short 2>/dev/null || echo '?')"

# ── 2. Репозиторий ─────────────────────────────────────────────────────────
step "2. REPOZITORIY"

if [ -d "$PROJECT_DIR/.git" ]; then
  say "  already cloned: $PROJECT_DIR"
else
  if [ -e "$PROJECT_DIR" ]; then
    die "$PROJECT_DIR exists but is not a git repository: look at it by hand"
  fi
  say "  cloning $REPO_URL"
  command -v git >/dev/null 2>&1 || die "git is not installed: apt install git"
  git clone "$REPO_URL" "$PROJECT_DIR" || die "git clone failed"
fi

cd "$PROJECT_DIR" || die "could not go into $PROJECT_DIR"
say "  commit: $(git rev-parse --short HEAD 2>/dev/null || echo '?')"

# ── 3. Секреты ─────────────────────────────────────────────────────────────
step "3. SEKRETY"

ENV_FILE="deploy/.env"

# Токен туннеля проверяем ОТДЕЛЬНО. Без него docker-compose.tunnel.yml не
# стартует: compose требует переменную через `:?` и сам останавливается. Но
# сообщение об этом от compose нечитаемо, поэтому проверка здесь.
if [ ! -f "$ENV_FILE" ]; then
  cat <<'ЗАБОЙ'

  ФАЙЛА deploy/.env НЕТ. Без него сервер игры не поднимется.

  Положить файл можно двумя способами.

  Способ 1. Скопировать с машины, где игра уже работает:

      scp deploy/.env <эта-машина>:$PROJECT_DIR/deploy/.env

  Способ 2. Восстановить из резервной копии, а если её нет — из работающего
  контейнера на этой же машине:

      CID=$(docker ps -q --filter name=server | head -1)
      docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CID" \\
        | grep -E '^(JWT_SECRET|CLIENT_ORIGIN|DB_NAME|DB_USER|DB_PASSWORD|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|FACEBOOK_CLIENT_ID|FACEBOOK_CLIENT_SECRET)=' \\
        | sed 's/^DB_PASSWORD=/POSTGRES_PASSWORD=/' > deploy/.env
      echo "DOMAIN=$(grep '^CLIENT_ORIGIN=' deploy/.env | cut -d= -f2- | sed 's#https\?://##')" >> deploy/.env

  И токен туннеля — он обязателен, иначе compose не стартует:

      CLOUDFLARE_TUNNEL_TOKEN=...

ЗАБОЙ
  die "$ENV_FILE not found: the server will not start without it"
fi

say "  found $ENV_FILE"

# Права 600 — на Linux это работает, в отличие от Windows. Скрипт доводит дело
# до конца: пока файл доступен всем, секрет утекает на ту же машину.
chmod 600 "$ENV_FILE" 2>/dev/null && say "  rights set to 600"

if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=..*' "$ENV_FILE"; then
  say "  tunnel token found: the tunnel profile will be connected"
  say "  ports 80 and 443 do NOT need to be opened, iptables is not touched"
else
  say "  TUNNEL TOKEN NOT FOUND."
  say "  Without it Caddy starts instead and the machine must open ports 80 and 443"
  say "  AND drop the REJECT rules in iptables, which Oracle ships with."
  say "  To remove them:"
  say "    sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT"
  say "    sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT"
  say "    sudo netfilter-persistent save"
fi

# ── 4. Выкатка ─────────────────────────────────────────────────────────────
step "4. VYKACHKA"

say "  running tools/deploy.sh"
if bash tools/deploy.sh; then
  say "  deploy.sh finished"
else
  die "deploy.sh stopped: fix what it printed and run it again — the script is idempotent"
fi

# ── 5. Проверка ────────────────────────────────────────────────────────────
step "5. PROVERKA"

say "  containers:"
docker ps --format '    {{.Names}}  {{.Status}}' 2>/dev/null || say "    could not list"

say "  server health:"
# Состав файлов compose собирается в переменную, а не подставляется на месте.
# Пустой `-f ""` — это ошибка разбора, и проверка молча падала бы, даже когда
# сервер здоров.
COMPOSE_ARGS=(-f deploy/docker-compose.prod.yml --env-file "$ENV_FILE")
if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=..*' "$ENV_FILE" && [ -f deploy/docker-compose.tunnel.yml ]; then
  COMPOSE_ARGS+=(-f deploy/docker-compose.tunnel.yml)
fi
health=$(docker compose "${COMPOSE_ARGS[@]}" \
  exec -T server sh -c 'wget -qO- http://localhost:3000/health' 2>/dev/null || true)
if [ -n "$health" ]; then
  say "    $health"
else
  say "    no answer from /health: look at docker logs"
fi

cat <<'ГОТОВО'

 ГОТОВО. Машина поднята.

 Осталось одно: если адрес игры в туннеле ещё не указывает сюда — он уже
 указывает, потому что туннель один и тот же. Менять DNS не нужно.

 Проверить снаружи:

     curl -s -o /dev/null -w '%{http_code}\n' https://game.eos-gameonline.com/

 Следующая выкатка — та же команда:

     bash tools/deploy.sh
ГОТОВО