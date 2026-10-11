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

const xsollaExchangeRouter = Router();

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
  return res.json({ ok: true });
});

export default xsollaExchangeRouter;