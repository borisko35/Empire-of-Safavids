// ============================================================
// Admin Routes — Empire of Safavids
// ============================================================
// Административные эндпоинты: бан, мьют, телепорт, выдача,
// поиск игроков, просмотр логов.
// Все маршруты требуют авторизации + прав администратора.

import { Router, Request, Response } from 'express';
import { AdminService } from '../services/AdminService';
import { ChatModerationService } from '../services/ChatModerationService';
import { PaymentService } from '../services/PaymentService';
import { PromoService } from '../services/PromoService';
import { adminCheck, seniorAdminCheck } from '../middleware/adminCheck';
import { secureMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { GAME_SERVERS } from '../../../shared/constants';
import { Region } from '../types/game.types';
import { CharacterService } from '../services/CharacterService';
import { RedisService } from '../services/RedisService';
import { GameLoop } from '../systems/GameLoop';
import type { Weather } from '../systems/WorldTimeSystem';

export const adminRouter = Router();
const adminService = new AdminService();
const chatModeration = ChatModerationService.getInstance();
const characterService = new CharacterService();
const redis = RedisService.getInstance();

// Все админ-роуты сначала проходят auth (иначе req.userId пуст и adminCheck
// всегда отвечал бы 401 — ни один админ-метод не работал бы вообще).
adminRouter.use(secureMiddleware);

// ============================================================
// GET /api/admin/search?q=... — Поиск игрока
// ============================================================
adminRouter.get('/search', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }
  const results = await adminService.findPlayer(q);
  return res.json({ results });
}));

// ============================================================
// POST /api/admin/ban — Бан пользователя
// ============================================================
adminRouter.post('/ban', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { userId, reason, durationDays } = req.body;
  if (!userId || !reason) {
    return res.status(400).json({ error: 'userId and reason are required' });
  }
  await adminService.banUser(req.userId!, userId, reason, durationDays);
  return res.json({ success: true, message: 'User banned' });
}));

// ============================================================
// POST /api/admin/unban — Разбан
// ============================================================
adminRouter.post('/unban', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  await adminService.unbanUser(req.userId!, userId);
  return res.json({ success: true, message: 'User unbanned' });
}));

// ============================================================
// POST /api/admin/mute — Мьют чата персонажа
// ============================================================
adminRouter.post('/mute', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { characterId, durationMinutes, reason } = req.body;
  if (!characterId || !reason) {
    return res.status(400).json({ error: 'characterId and reason are required' });
  }
  await adminService.muteCharacter(req.userId!, characterId, durationMinutes, reason);
  return res.json({ success: true, message: 'Character muted' });
}));

// ============================================================
// GET /api/admin/reports — очередь жалоб на игроков
// ============================================================
//
// Жалобы накапливаются ChatModerationService.fileReport в таблице
// chat_messages с channel = 'report'. Отдельной таблицы жалоб нет:
// она понадвится, только если у жалоб появятся статусы и назначенный
// модератор.
adminRouter.get('/reports', adminCheck, asyncHandler(async (_req: Request, res: Response) => {
  const reports = await chatModeration.listReports(200);
  return res.json({ items: reports });
}));

// ============================================================
// POST /api/admin/teleport — Телепорт персонажа
// ============================================================
adminRouter.post('/teleport', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { characterId, position, region } = req.body;
  if (!characterId || !position || !region) {
    return res.status(400).json({ error: 'characterId, position, region are required' });
  }
  await adminService.teleportCharacter(req.userId!, characterId, position, region);
  return res.json({ success: true, message: 'Character teleported' });
}));

// ============================================================
// POST /api/admin/weather — Ручная смена погоды (kind='auto' — вернуть расписание)
// Без этого каждый эффект погоды приходилось ждать по 4 минуты в цикле.
// ============================================================
const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'sandstorm', 'snow', 'wind'];

adminRouter.post('/weather', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const raw = String(req.body?.kind ?? 'auto');
  if (raw !== 'auto' && !WEATHER_KINDS.includes(raw)) {
    return res.status(400).json({ error: `Unknown weather kind: ${raw}` });
  }
  const sys = GameLoop.getInstance().getWorldTimeSystem();
  sys.setWeatherOverride(raw === 'auto' ? null : (raw as Weather));
  // Сразу рассылаем — иначе клиенты увидят погоду только через минуту
  await sys.broadcastWorldTime();
  return res.json({ success: true, weather: raw });
}));

// ============================================================
// POST /api/admin/give-item — Выдача предмета
// ============================================================
adminRouter.post('/give-item', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { characterId, itemId, quantity, enhancement } = req.body;
  if (!characterId || !itemId) {
    return res.status(400).json({ error: 'characterId and itemId are required' });
  }
  await adminService.giveItem(req.userId!, characterId, itemId, quantity ?? 1, enhancement ?? 0);
  return res.json({ success: true, message: 'Item given' });
}));

// ============================================================
// POST /api/admin/give-gold — Выдача золота
// ============================================================
adminRouter.post('/give-gold', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { characterId, amount } = req.body;
  if (!characterId || !amount) {
    return res.status(400).json({ error: 'characterId and amount are required' });
  }
  await adminService.giveGold(req.userId!, characterId, amount);
  return res.json({ success: true, message: 'Gold given' });
}));

// ============================================================
// POST /api/admin/set-level — Изменение уровня
// ============================================================
adminRouter.post('/set-level', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { characterId, level } = req.body;
  if (!characterId || !level) {
    return res.status(400).json({ error: 'characterId and level are required' });
  }
  await adminService.setLevel(req.userId!, characterId, level);
  return res.json({ success: true, message: `Level set to ${level}` });
}));

// ============================================================
// GET /api/admin/violations/:characterId — Логи нарушений
// ============================================================
adminRouter.get('/violations/:characterId', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const violations = await adminService.getViolations(req.params.characterId);
  return res.json({ violations });
}));

// ============================================================
// GET /api/admin/logs — Журнал действий GM
// ============================================================
adminRouter.get('/logs', adminCheck, asyncHandler(async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  const logs = await adminService.getAdminLogs(limit, offset);
  return res.json({ logs });
}));

// ============================================================
// GET /api/admin/online — Онлайн-игроки
// ============================================================
adminRouter.get('/online', adminCheck, asyncHandler(async (_req: Request, res: Response) => {
  const onlinePlayers: { serverId: string; count: number }[] = [];
  for (const srv of GAME_SERVERS) {
    const members = await redis.getShardOnline(srv.id);
    onlinePlayers.push({ serverId: srv.id, count: members });
  }
  return res.json({ onlinePlayers });
}));

// ============================================================
// GET /api/admin/online-players — Кто сейчас в игре (для мониторинга)
// ============================================================
adminRouter.get('/online-players', adminCheck, asyncHandler(async (_req: Request, res: Response) => {
  const players: { characterId: string; userId: string; name: string; level: number; region: string; serverId: string }[] = [];
  for (const srv of GAME_SERVERS) {
    for (const region of Object.values(Region)) {
      const ids = await redis.getPlayersInRegion(srv.id, region).catch(() => [] as string[]);
      for (const id of ids) {
        const c = await characterService.getCharacterById(id).catch(() => null);
        if (c) players.push({ characterId: c.id, userId: c.userId, name: c.name, level: c.level, region: c.region, serverId: srv.id });
      }
    }
  }
  return res.json({ players, total: players.length });
}));

// ============================================================
// GET /api/admin/stats — Общая статистика сервера
// ============================================================
adminRouter.get('/stats', adminCheck, asyncHandler(async (_req: Request, res: Response) => {
  const stats = await adminService.getServerStats();
  return res.json(stats);
}));

// ============================================================
// POST /api/admin/grant-currency — ручное начисление валюты.
// ТОЛЬКО senior+ (обычным GM запрещено): деньги печатать нельзя.
// Причина обязательна и пишется в журнал admin_grants + admin_logs.
// ============================================================
adminRouter.post('/grant-currency', seniorAdminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { characterId, currency, amount, reason } = req.body ?? {};
  if (!characterId || !currency || amount === undefined || !reason) {
    return res.status(400).json({ error: 'characterId, currency, amount and reason are required' });
  }
  try {
    const balance = await adminService.grantCurrency(
      req.userId!, characterId, currency, Number(amount), String(reason)
    );
    return res.json({ success: true, balance });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
}));

// ============================================================
// GET /api/admin/grants — журнал ручных начислений (senior+)
// GET /api/admin/payments — леджер платежей игроков (senior+)
// ============================================================
adminRouter.get('/grants', seniorAdminCheck, asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const offset = Number(req.query.offset) || 0;
  const grants = await adminService.getGrants(limit, offset);
  return res.json({ grants });
}));

adminRouter.get('/payments', seniorAdminCheck, asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const offset = Number(req.query.offset) || 0;
  const payments = await adminService.getPayments(limit, offset);
  return res.json({ payments });
}));

// ============================================================
// GET /api/admin/finance — сверка эмиссии и подозрительная
// активность (senior+). Утечка = выпущено больше, чем на руках.
// ============================================================
adminRouter.get('/finance', seniorAdminCheck, asyncHandler(async (_req: Request, res: Response) => {
  const summary = await adminService.getFinanceSummary();
  return res.json(summary);
}));

// ============================================================
// POST /api/admin/refund — возврат зачисленного платежа (senior+).
// Списывает AZENS обратно (баланс может уйти в минус = долг),
// причина обязательна и пишется в admin_logs.
// ============================================================
adminRouter.post('/refund', seniorAdminCheck, asyncHandler(async (req: Request, res: Response) => {
  const { paymentId, reason } = req.body ?? {};
  if (!paymentId || !reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'paymentId and reason (min 5 chars) are required' });
  }
  const paymentService = new PaymentService();
  const result = await paymentService.reversePayment({
    provider: 'admin',
    providerPaymentId: `admin_refund_${paymentId}`,
    paymentId,
    reason: `refund by ${req.userId}: ${String(reason).trim()}`,
  });
  if (!result.ok) return res.status(400).json({ error: result.code });
  await adminService.logManualAction(req.userId!, 'refund', paymentId, String(reason).trim());
  return res.json({ success: true, deduped: result.deduped ?? false, azens: result.azens });
}));

// ============================================================
// Промокоды (senior+): создание и список.
// POST /api/admin/promocodes { code, azens?, silver?, syrian?, maxUses?, expiresAt? }
// ============================================================
const promoService = new PromoService();

adminRouter.post('/promocodes', seniorAdminCheck, asyncHandler(async (req: Request, res: Response) => {
  try {
    const promo = await promoService.create(req.userId!, req.body ?? {});
    await adminService.logManualAction(req.userId!, 'promo_create', promo.code, JSON.stringify(req.body ?? {}));
    return res.status(201).json({ success: true, promo });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
}));

adminRouter.get('/promocodes', seniorAdminCheck, asyncHandler(async (_req: Request, res: Response) => {
  const promos = await promoService.list();
  return res.json({ promos });
}));
