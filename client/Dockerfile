# Сборка: контекст — корень репозитория (см. docker-compose.yml / gitlab-ci.yml)
FROM node:20-alpine AS builder

WORKDIR /app
COPY client/package*.json ./client/
WORKDIR /app/client
RUN npm ci

WORKDIR /app
COPY client/vite.config.ts ./client/
COPY client/tsconfig.json ./client/
COPY client/src ./client/src
COPY client/web ./client/web

WORKDIR /app/client
RUN npm run build

# Production: nginx раздаёт лендинг + игру, API/сокеты/локали проксирует на сервер
FROM nginx:1.27-alpine AS production

# client/web уже содержит собранную игру в web/game (outDir Vite)
COPY --from=builder /app/client/web /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/game/ || exit 1
