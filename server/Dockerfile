# Сборка: контекст — корень репозитория (см. docker-compose.yml / gitlab-ci.yml)
FROM node:20-alpine AS builder

WORKDIR /app
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci

WORKDIR /app
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY shared ./shared

WORKDIR /app/server
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S gameserver -u 1001

COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./
COPY database/migrations ./database/migrations

RUN mkdir -p logs && chown -R gameserver:nodejs logs

USER gameserver

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server/src/index/index.js"]
