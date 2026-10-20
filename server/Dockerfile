# Сборка: контекст — корень репозитория (см. docker-compose.yml / gitlab-ci.yml)
FROM node:20-alpine AS builder

WORKDIR /app
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install

WORKDIR /app
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY shared ./shared
# Тест gameI18n проверяет настоящую функцию t() из клиентского кода,
# поэтому файл должен попасть в сборку. В рабочий образ он не идёт.
COPY client/src/app/i18n.ts ./client/src/app/i18n.ts
# Тот же случай для автобоя: autobattle.test.ts исполняет НАСТОЯЩИЙ код
# client/src/app/autobattle.ts, потому что тест-раннера у клиента нет.
#
# ЧТО БЫЛО. Этой строки не было, и сборка образа падала на сервере:
#   src/tests/autobattle.test.ts(21,8): error TS2307:
#   Cannot find module '../../../client/src/app/autobattle'
# Локально это не воспроизводилось: на машине есть весь репозиторий, а в
# контейнер попадают только перечисленные файлы. То есть проверка была
# зелёной на моём столе и роняла прод-сборку - тот случай, когда
# компиляция роняет вместо теста, а узнать об этом можно только на VPS.
#
# Модуль без единого импорта, поэтому в образ тянется ровно он.
COPY client/src/app/autobattle.ts ./client/src/app/autobattle.ts

# Третий такой случай: fxCursor.test.ts исполняет НАСТОЯЩИЙ World из
# client/src/app/entities.ts. Тест поведенческий, а не сверка текста: внутри
# набора живут оба курсора сразу, и проверка требует, чтобы старый,
# индексный, показал 3 из 14, а новый по номеру — все 14. Сверкой текста
# такой баг не поймать.
#
# entities.ts тянет './state' — там один интерфейс Vec3 и НИ ОДНОГО импорта,
# поэтому в образ идут ровно два файла. Больше граф не замыкается.
#
# Что было: этой пары строк не было, и `npm run build` в образе падал на
#   src/tests/fxCursor.test.ts(18,23): error TS2307:
#   Cannot find module '../../../client/src/app/entities'
# Локально `npm run typecheck` был зелёным: на машине есть весь репозиторий,
# а в контейнер попадают только перечисленные файлы. То есть роняло не
# тестирование, а сборку образа, и узнать об этом можно было только выкаткой.
COPY client/src/app/entities.ts ./client/src/app/entities.ts
COPY client/src/app/state.ts ./client/src/app/state.ts
# waterWaves.ts тянет набор waterWavesInMetres.test.ts: он поднимает клиентский
# модуль прямо в тестах, потому что тот тянет только shared/water — ни three, ни
# DOM — и позволяет проверять настоящий сгенерированный GLSL, а не описание его
# в комментарии. Без этой строки сборка образа падает на выкатке: локально
# typecheck зелёный, а в образе модуля нет.
COPY client/src/app/game3d/waterWaves.ts ./client/src/app/game3d/waterWaves.ts

# spriteClamp.ts тянет npcNameNearClamp.test.ts: тест поднимает клиентский
# модуль, чтобы проверить потолок видимого размера надписей настоящими
# числами, а не пересказом. Модуль чистый — ни three, ни DOM, — поэтому
# поднимается где угодно. Без этой строки сборка образа падает на выкатке:
# локально typecheck зелёный, а в образе модуля нет.
COPY client/src/app/game3d/spriteClamp.ts ./client/src/app/game3d/spriteClamp.ts

# skyEnvironmentMath.ts тянет skyEnvironment.test.ts: тест проверяет математику
# неба (flip-упаковка эквиректа, §221) настоящими числами. Модуль чистый — ни
# three, ни DOM, — поэтому поднимается где угодно. Без этой строки сборка
# образа падает на выкатке: локально typecheck зелёный, а в образе модуля нет.
COPY client/src/app/game3d/skyEnvironmentMath.ts ./client/src/app/game3d/skyEnvironmentMath.ts

WORKDIR /app/server
# ТИПОВАЯ ПРОВЕРКА ВСЕГО ПРОЕКТА, ВКЛЮЧАЯ ТЕСТЫ, И ЛИМИТ КУЧИ.
#
# На выкатке 20.10.2026 сборка образа упала: `tsc` дошёл до
#   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
# и контейнер умер через 133 секунды. Это не ошибка в коде: проверяются все
# 342 файла тестов сразу (именно поэтому в образ копируются клиентские модули
# выше — сторож видит их импорты), и программа типов перестала помещаться в
# кучу node по умолчанию. На машине сборки свободно около 460 ГБ, поэтому
# предел поднят явно: без этого следующая пара тестовых файлов снова уронит
# выкатку, и снова только на сервере.
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN npm run build

# Production image: запуск через tsx из исходников.
# (tsc-сборка в dist не запускается под чистым node из-за
# ESM-импортов без расширений — tsx резолвит их как в dev.)
FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S gameserver -u 1001

COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/src ./server/src
COPY --from=builder /app/shared ./shared
COPY database/migrations ./database/migrations

RUN mkdir -p server/logs && chown -R gameserver:nodejs server/logs database/migrations

USER gameserver

WORKDIR /app/server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["npx", "tsx", "src/index/index.ts"]
