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
import { hallOfFameRouter } from '../routes/hallOfFame';
import { tutorialRouter } from '../routes/tutorial';
import minigamesRouter from '../routes/minigames';
import poetryRouter from '../routes/poetry';
import chroniclesRouter from '../routes/chronicles';
import storyRouter from '../routes/story';
import guildsRouter from '../routes/guilds';
import progressionRouter from '../routes/progression';
import { npcRouter } from '../routes/npc';
import { siteRouter } from '../routes/site';
import { mediaRouter, galleryRouter } from '../routes/media';
import { mediaDir } from '../services/MediaService';
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
import { metricsMiddleware } from '../middleware/metrics';
import { metrics } from '../metrics';
import { errorHandler, notFoundHandler, badJsonHandler } from '../middleware/errorHandler';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const PORT = process.env.PORT || 3000;
const app = express();
const httpServer = createServer(app);

// ============================================================
// Доверие к прокси: без него req.ip — это адрес контейнера nginx
// ============================================================
//
// ТУТ БЫЛА ПОЛНОСТЬЮ ОБЩАЯ ПОЛОМКА, И ВИДНА ТОЛЬКО НА БОЕВОМ СЕРВЕРЕ.
//
// На боевом стеке игрок идёт так: браузер → Caddy (443) → nginx контейнера
// клиента → express. Оба прокси кладут настоящий адрес игрока в
// X-Forwarded-For, но express без trust proxy эти заголовки ИГНОРИРУЕТ.
// req.ip тогда равен адресу контейнера nginx, а он у всех игроков один
// и тот же.
//
// Проверено на проде: ключ ограничителя был
//   ratelimit:auth:::ffff:172.19.0.3
// где 172.19.0.3 — внутренний адрес контейнера, а не игрока. Следствия:
//
//   * гость — AuthService считает 5 гостей на IP за сутки. Пять входов
//     со всего мира, и дальше «слишком много гостей с этого устройства»
//     получает ВСЕ, включая новых игроков, на 24 часа;
//   * вход — authRateLimiter: 100 попыток на 15 минут на всех вместе;
//   * apiRateLimiter: 120 запросов в минуту на весь сервер, включая
//     аукцион, форум и обратную связь.
//
// При локальной разработке (npm run dev, запрос идёт прямо в express)
// это не видно: там req.ip честный, и все проверки проходят.
//
// ДОВЕРЯТЬ БЕЗОПАСНО: в deploy/docker-compose.prod.yml у сервиса server
// нет секции ports — наружу смотрят только Caddy. Подделать заголовок из
// интернета нельзя, до express можно достучаться только изнутри сети.
//
// Значение 2 — это nginx + Caddy. Меняется переменной окружения на случай,
// если в схеме появится ещё один прокси.
const TRUST_PROXY_HOPS = (() => {
  const raw = Number(process.env.TRUST_PROXY_HOPS ?? 2);
  if (!Number.isFinite(raw) || raw < 0) return 2;
  return Math.min(Math.floor(raw), 5);
})();
app.set('trust proxy', TRUST_PROXY_HOPS);

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

// Метрики для Prometheus. Ставится до маршрутов, иначе middleware увидит
// только те запросы, что до него дошли, - то есть почти none.
app.use(metricsMiddleware);

// ── /metrics ────────────────────────────────────────────────────
// Адрес, который уже давно прописан в tools/monitoring/prometheus.yml.
// Открыт наружу намеренно, но отдаёт только сводные числа: сколько запросов,
// с какой скоростью, сколько игроков онлайн. Ни имён, ни идентификаторов
// персонажей там нет - подпись из пользовательского ввода к тому же
// наводнит метрики мусором.
app.get('/metrics', (_req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(metrics.render());
});

// ── REST API маршруты ────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/characters', characterRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/world', worldRouter);
app.use('/api/game', gameRouter);
app.use('/api/admin', adminRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/hall-of-fame', hallOfFameRouter);
app.use('/api/tutorial', tutorialRouter);
app.use('/api/chess', minigamesRouter);
app.use('/api/poetry', poetryRouter);
app.use('/api/chronicles', chroniclesRouter);
app.use('/api/story', storyRouter);
app.use('/api/guilds', guildsRouter);
app.use('/api/progression', progressionRouter);
app.use('/api/npc', npcRouter);
app.use('/api/site', siteRouter);
// Загрузка фото и видео силами сотрудников
app.use('/api/admin/media', mediaRouter);
// Галерея сайта: опубликованные файлы, без авторизации — её смотрит
// любой посетитель главной страницы
app.use('/api/media/gallery', galleryRouter);
// Форум (чтение открыто, запись — авторизованным) и обратная связь
app.use('/api/forum', forumRouter);
app.use('/api/feedback', feedbackRouter);

// Веб-страница игры (лендинг с историей Сефевидов и загрузкой)
app.use(express.static(WEB_DIR));
app.use('/locales', express.static(LOCALES_DIR));
// Раздача загруженных файлов. Имена у файлов сгенерированные, поэтому
// кеш можно держать вечно: файл с тем же именем не появится второй раз.
app.use('/media', express.static(mediaDir(), {
  maxAge: '365d',
  immutable: true,
  index: false,
  dotfiles: 'deny',
  setHeaders: (res) => {
    // Ролик должен играть прямо в браузере, а не скачиваться
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

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

// ── Масштабирование: доставка событий между инстансами ──────────
//
// ЗАЧЕМ. До этого события между инстансами не ходили ВООБЩЕ: канал Redis
// публиковался, подписчик был в каждом процессе, а activePlayers — карта
// ЛОКАЛЬНАЯ. Личное событие (партия, рейд, приглашение) до сокета на
// другом инстансе не доходило.
//
// ЭТО ПЕРВЫЙ ШАГ ИЗ ЧЕТЫРЁХ (§96). Пока боевой контекст в памяти,
// следующий шаг бессмыслен — игра развалится раньше, чем что-то начнёт
// выигрывать. Но доставка событий сама по себе нужна: без неё рейд и
// партия между инстансами мёртвы.
//
// ПОЧЕМУ ЗА ФЛАГКОМ. При одном инстансе (сейчас прод — один контейнер)
// адаптер не даёт ничего, зато добавляет два соединения с Redis и ложку
// неочевидности в отладку. Поэтому по умолчанию ВЫКЛЮЧЕН.
const масштабирование = process.env.EOS_SCALE === '1';
if (масштабирование) {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const подписчик = createClient({ url });
  const публикатор = createClient({ url });
  подписчик.on('error', (e) => logger.error('[Scale] подписчик Redis:', e));
  публикатор.on('error', (e) => logger.error('[Scale] публикатор Redis:', e));
  await Promise.all([подписчик.connect(), публикатор.connect()]);
  io.adapter(createAdapter(подписчик, публикатор));
  logger.info('[Scale] адаптер socket.io подключён: события ходят между инстансами');
}
const gameSocketHandler = new GameSocketHandler(io);
gameSocketHandler.initialize();

// Игроки онлайн — единственная метрика, ради которой владельцу и нужен
// мониторинг в первую очередь. Считается в момент снятия метрик, а не на
// каждом входе и выходе: иначе пришлось бы поддерживать счётчик, который
// разъедется при первом же перезапуске сокета.
metrics.registerGaugeProvider(() => ({
  name: 'eos_players_online',
  help: 'Игроков в игре сейчас',
  labels: {},
  value: gameSocketHandler.getOnlineCount(),
}));

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
