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

WORKDIR /app/server
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
