// .env должен загрузиться ДО импортов сервисов: они создают пул БД на этапе импорта
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from '../utils/logger';
import { authRouter } from '../routes/auth';
import { characterRouter } from '../routes/character';
import { worldRouter } from '../routes/world';
import { gameRouter } from '../routes/game';
import { GameSocketHandler } from '../socket/GameSocketHandler';
import { DatabaseService } from '../services/DatabaseService';
import { RedisService } from '../services/RedisService';
import { GameLoop } from '../systems/GameLoop';
import { GAME_VERSION } from '../../../shared/constants';

const PORT = process.env.PORT || 3000;
const app = express();
const httpServer = createServer(app);

// Корень репозитория: npm-скрипты выполняются из server/, но путь
// проверяем, чтобы запуск из другого каталога не сломал статику
const repoRoot = [path.resolve(process.cwd(), '..'), process.cwd()].find((dir) =>
  fs.existsSync(path.join(dir, 'client', 'web', 'index.html')),
);
const WEB_DIR = path.resolve(repoRoot ?? process.cwd(), 'client', 'web');
const LOCALES_DIR = path.resolve(repoRoot ?? process.cwd(), 'shared', 'locales');
const INSTALLER_FILE = path.resolve(repoRoot ?? process.cwd(), 'site', 'install', 'install-game.cmd');

// Socket.IO для real-time игровой логики
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:8080',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Middleware. CSP helmet по умолчанию включает upgrade-insecure-requests,
// который ломает подгрузку ресурсов страницы по http://localhost — отключаем
// только его, остальные защиты helmet остаются
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

// REST API маршруты
app.use('/api/auth', authRouter);
app.use('/api/characters', characterRouter);
app.use('/api/world', worldRouter);
app.use('/api/game', gameRouter);

// Веб-страница игры (лендинг с историей Сефевидов и загрузкой)
app.use(express.static(WEB_DIR));
app.use('/locales', express.static(LOCALES_DIR));

// Файл загрузки и установки игры на компьютер
app.get('/download/installer', (_req, res) => {
  res.download(INSTALLER_FILE, 'EmpireOfSafavids-Setup.cmd', (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'installer not found' });
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', game: 'Empire of Safavids', version: GAME_VERSION });
});

// Инициализация Socket.IO обработчиков
const gameSocketHandler = new GameSocketHandler(io);
gameSocketHandler.initialize();

// Запуск сервера
async function bootstrap() {
  try {
    await DatabaseService.getInstance().connect();
    logger.info('✅ Database connected');

    await RedisService.getInstance().connect();
    logger.info('✅ Redis connected');

    // Подписчики Redis pub/sub (уведомления, кики, спавн, ИИ)
    await gameSocketHandler.subscribeToRedisEvents();

    // Объявления мировых событий — всем онлайн-игрокам
    GameLoop.getInstance().setWorldEventBroadcaster((payload) => {
      gameSocketHandler.broadcastWorldEvent(payload);
    });

    // Игровой цикл: спавн монстров + тик ИИ + мировые события
    GameLoop.getInstance().start();

    httpServer.listen(PORT, () => {
      logger.info(`🏰 Empire of Safavids Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`);
  try {
    GameLoop.getInstance().stop();
    httpServer.close();
    await RedisService.getInstance().disconnect();
    await DatabaseService.getInstance().disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

bootstrap();
