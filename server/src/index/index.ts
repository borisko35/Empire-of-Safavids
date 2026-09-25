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

// ── Safety net: prevent unhandled rejections from crashing the process ──
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('[Process] Unhandled promise rejection (suppressed):', reason);
});
process.on('uncaughtException', (err: Error) => {
  logger.error('[Process] Uncaught exception (suppressed):', err);
});
import { authRouter } from '../routes/auth';
import { characterRouter } from '../routes/character';
import { worldRouter } from '../routes/world';
import { gameRouter } from '../routes/game';
import { adminRouter } from '../routes/admin';
import { friendsRouter } from '../routes/friends';
import { leaderboardRouter } from '../routes/leaderboard';
import { tutorialRouter } from '../routes/tutorial';
import minigamesRouter from '../routes/minigames';
import poetryRouter from '../routes/poetry';
import chroniclesRouter from '../routes/chronicles';
import guildsRouter from '../routes/guilds';
import progressionRouter from '../routes/progression';
import { npcRouter } from '../routes/npc';
import { siteRouter } from '../routes/site';
import { forumRouter } from '../routes/forum';
import { feedbackRouter } from '../routes/feedback';
import { skillsRouter } from '../routes/skills';
import { GameSocketHandler } from '../socket/GameSocketHandler';
import { DatabaseService } from '../services/DatabaseService';
import { RedisService } from '../services/RedisService';
import { GameLoop } from '../systems/GameLoop';
import { migrate } from '../database/migrate';
import { GAME_VERSION } from '../../../shared/constants';
import { requestLogger } from '../middleware/requestLogger';
import { errorHandler, notFoundHandler, badJsonHandler } from '../middleware/errorHandler';

const PORT = process.env.PORT || 3000;
const app = express();
const httpServer = createServer(app);

// Корень репозитория: npm-скрипты выполняются из server/, но путь
// проверяем, чтобы запуск из другого каталога не сломал статику.
// В Docker-образе (WORKDIR /app/server) shared лежит в /app/shared,
// поэтому корень shared ищем отдельно от web-статики.
const candidateRoots = [
  path.resolve(process.cwd(), '..'),
  process.cwd(),
  path.resolve(process.cwd(), '..', '..'),
  '/app',
];
const repoRoot = candidateRoots.find((dir) =>
  fs.existsSync(path.join(dir, 'client', 'web', 'index.html')),
);
const sharedRoot = candidateRoots.find((dir) =>
  fs.existsSync(path.join(dir, 'shared', 'locales', 'ru.json')),
) ?? repoRoot ?? process.cwd();
const WEB_DIR = path.resolve(repoRoot ?? process.cwd(), 'client', 'web');
const LOCALES_DIR = path.resolve(sharedRoot, 'shared', 'locales');
const INSTALLER_FILE = path.resolve(repoRoot ?? process.cwd(), 'site', 'install', 'install-game.cmd');

// ── Middleware ────────────────────────────────────────────
// Helmet: отключаем CSP только для dev; в продакшене оставляем
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { (req as unknown as { rawBody?: string }).rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: false }));

// Обработка невалидного JSON в теле запроса
app.use(badJsonHandler);

// Логирование запросов
app.use(requestLogger);

// ── REST API маршруты ────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/characters', characterRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/world', worldRouter);
app.use('/api/game', gameRouter);
app.use('/api/admin', adminRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/tutorial', tutorialRouter);
app.use('/api/chess', minigamesRouter);
app.use('/api/poetry', poetryRouter);
app.use('/api/chronicles', chroniclesRouter);
app.use('/api/guilds', guildsRouter);
app.use('/api/progression', progressionRouter);
app.use('/api/npc', npcRouter);
app.use('/api/site', siteRouter);
// Форум (чтение открыто, запись — авторизованным) и обратная связь
app.use('/api/forum', forumRouter);
app.use('/api/feedback', feedbackRouter);

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

// 404 для неизвестных маршрутов
app.use(notFoundHandler);

// Централизованный обработчик ошибок (должен быть последним)
app.use(errorHandler);

// Инициализация Socket.IO обработчиков
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:8080',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const gameSocketHandler = new GameSocketHandler(io);
gameSocketHandler.initialize();

// Запуск сервера
async function bootstrap() {
  try {
    await DatabaseService.getInstance().connect();
    logger.info('✅ Database connected');

    // Автоматические миграции перед стартом игрового цикла
    try {
      await migrate();
      logger.info('✅ Database migrations checked/applied');
    } catch (migErr) {
      logger.error('❌ Migration failed — aborting startup:', migErr);
      throw migErr;
    }

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

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

bootstrap();
