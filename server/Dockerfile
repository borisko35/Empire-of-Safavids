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
