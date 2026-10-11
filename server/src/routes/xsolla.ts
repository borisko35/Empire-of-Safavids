// Обмен кода Xsolla Login на токен.
//
// ЗАЧЕМ. Виджет входа редиректит на redirect_uri с ?code=...&state=...
// Клиент сверил state (см. web/js/xsolla-login.js) — но сам код обменять не
// может: для этого нужен секрет виджета, а он в браузере оказался бы
// доступен кому угодно. Обмен обязан быть на сервере.
//
// ПОЧЕМУ БЕЗ СЕКРЕТА — ОТКАЗ, А НЕ ПОЛУРАБОТА. Если XSOLLA_LOGIN_SECRET не
// задан, маршрут отвечает «не настроено». Молчаливое «ок» выдало бы игроку
// вход, которого не было, и он попал бы в игру без аккаунта.
import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { AuthService } from '../services/AuthService';

const xsollaExchangeRouter = Router();
// Отдельный экземпляр — но не вторая база: внутри AuthService синглтоны
// DatabaseService.getInstance() и RedisService.getInstance(), поэтому это
// тот же пул, а не новый.
const authService = new AuthService();

interface XsollaExchangeError {
  error: string;
}

type ExchangeResult =
  | { ok: true; token: string }
  | { ok: false; code: XsollaExchangeError['error'] };

/**
 * Пом енять code на токен у Xsolla.
 *
 * Вынесено из маршрута, чтобы не тащить сеть в обработчик запроса — и
 * чтобы это можно было проверить отдельно.
 */
async function exchangeCode(код: string, secret: string): Promise<ExchangeResult> {
  const ответ = await fetch('https://login.xsolla.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: '18679',
      client_secret: secret,
      redirect_uri: 'https://game.eos-gameonline.com/',
      code: код,
    }).toString(),
  });
  if (!ответ.ok) {
    return { ok: false, code: ответ.status === 400 ? 'code_rejected' : 'exchange_failed' };
  }
  const данные = (await ответ.json()) as { access_token?: string };
  if (!данные.access_token) return { ok: false, code: 'no_token' };
  return { ok: true, token: данные.access_token };
}

xsollaExchangeRouter.post('/exchange', async (req: Request, res: Response) => {
  const код = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!код) return res.status(400).json({ error: 'code_required' });

  // Секрет из окружения. Его нет — входить нечем, и лучше сказать это, чем
  // ответить «ок» на невыполненный вход.
  const секрет = process.env.XSOLLA_LOGIN_SECRET;
  if (!секрет) {
    logger.warn('[Xsolla] XSOLLA_LOGIN_SECRET не задан: обмен кода невозможен');
    return res.status(503).json({ error: 'not_configured' });
  }

  let результат: ExchangeResult;
  try {
    результат = await exchangeCode(код, секрет);
  } catch (e) {
    logger.error('[Xsolla] обмен кода:', (e as Error).message);
    return res.status(502).json({ error: 'exchange_failed' });
  }
  if (!результат.ok) return res.status(400).json({ error: результат.code });

  // НЕДОВЕДЁННАЯ ПОЛОВИНА БЫЛА ЗДЕСЬ. Раньше маршрут отвечал { ok: true } и на
  // этом всё. Токен Xsolla получен, но игры он не касается: localStorage
  // пуст, и человек, прошедший вход, оказывался перед формой почты как
  // будто ничего не произошло. Теперь токен превращается в НАШУ сессию
  // через AuthService.loginWithXsolla — см. комментарий у него про
  // порядок привязки.
  let сессия;
  try {
    сессия = await authService.loginWithXsolla(результат.token);
  } catch (e) {
    // Не смогли выдать сессию — это не «вход выполнен наполовину».
    // Отвечаем отказом, иначе клиент сохранил бы пустой токен и повис
    // бы в состоянии «залогинен, но персонажей нет».
    logger.error('[Xsolla] выдача сессии не удалась:', (e as Error).message);
    return res.status(502).json({ error: 'session_failed' });
  }

  // Поля называются так же, как у обычного входа по почте: клиенту не
  // нужна отдельная ветка «а если через Xsolla».
  return res.json({
    ok: true,
    token: сессия.token,
    userId: сессия.userId,
    username: сессия.username,
  });
});

export default xsollaExchangeRouter;