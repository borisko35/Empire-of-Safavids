// ============================================================
// Xsolla: конфигурация, каталог товаров и запрос токена
// ============================================================
// ЧТО ЗДЕСЬ РЕШАЕТСЯ. Наши наборы азенов (AZENS_PACKS в utils/economy.ts) не
// передаются в Xsolla суммой. В вызове Create token у Pay Station API поля
// purchase вообще нет — там только subscription и is_lootbox, то есть
// подписки. Для виртуальной валюты вызов другой, и сумма в нём тоже не
// передаётся: передаётся ТОВАР из каталога Xsolla.
//
// Отсюда главное последствие для проекта: у каждого набора должен быть свой
// SKU в каталоге Xsolla, и цена живёт в ДВУХ местах сразу — в нашем
// economy.ts (что показываем игроку) и в каталоге Xsolla (что реально
// берут). Если они разойдутся, игрок заплатит одну сумму и получит
// другую. Поэтому сверка суммы вебхука с нашей записью — не формальность,
// см. webhook.ts.
//
// ПОЧЕМУ ИМЕННО ЭТОТ ВЫЗОВ. Create payment token for purchase:
//   POST /v3/project/{project_id}/admin/payment/token
//   body: purchase.items[].sku + purchase.items[].quantity
// Витрина открывается адресом paystation4/?token=..., токен приходит в
// ответе вместе с order_id.
//
// ЧТО НУЖНО ОТ ВЛАДЕЛЬЦА (пять значений, остальное написано здесь):
//   XSOLLA_ENABLED        — 'true', когда ключи вписаны
//   XSOLLA_PUBLISHER_ID   — merchant_id из адреса кабинета (у нас 940854)
//   XSOLLA_PROJECT_ID     — ID проекта (у нас 316884)
//   XSOLLA_API_KEY        — секретный ключ API
//   XSOLLA_WEBHOOK_SECRET — секрет подписи вебхуков
// Ключи в чат не присылаются: вписываются в deploy/.env на сервере.
// XSOLLA_SANDBOX='true' переключает на песочницу — тестовые платежи не
// трогают настоящих денег, и это единственный способ проверить приём
// платежей до подписания договора.

const ОСНОВА_API = 'https://store.xsolla.com/api';

/** Витрина в бою и в песочнице. Это два разных хоста, а не один с флагом. */
export const ВИТРИНА_БОЕВАЯ = 'https://secure.xsolla.com/paystation4/';
export const ВИТРИНА_ПЕСОЧНИЦЫ = 'https://sandbox-secure.xsolla.com/paystation4/';

/**
 * Домены-подделки адреса почты.
 *
 * ЛОВУШКА, КОТОРАЯ ЖДЁТ ИМЕННО У НАС. У гостей в базе лежит
 * `guest_<id>@guest.invalid`, у OAuth-аккаунтов — `...@oauth.invalid`
 * (миграция 031 и AuthService). Передать это в Xsolla нельзя: адрес должен
 * соответствовать RFC 822, письмо о покупке уйдёт в никуда, а покупатель
 * не получит чек. Таким игрокам почту не передаём вовсе — тогда витрина
 * спросит её сама.
 */
const ПОДДЕЛКИ_ПОЧТЫ = ['@guest.invalid', '@oauth.invalid'];

export interface XsollaConfig {
  /** merchant_id: в адресе кабинета и в basicAuth. */
  publisherId: number;
  /** project_id: Xsolla ID нашего проекта. */
  projectId: number;
  apiKey: string;
  webhookSecret: string;
  sandbox: boolean;
}

export type Env = Record<string, string | undefined>;

function непустое(значение: string | undefined): string | null {
  if (typeof значение !== 'string') return null;
  const обрезанное = значение.trim();
  return обрезанное.length > 0 ? обрезанное : null;
}

function целое(значение: string | null): number | null {
  if (значение === null) return null;
  if (!/^\d+$/.test(значение)) return null;
  const число = Number(значение);
  return Number.isSafeInteger(число) ? число : null;
}

/**
 * Ключи из окружения.
 *
 * null, если провайдер выключен или ключей не хватает. Это штатное
 * состояние, а не сбой: маршрут отвечает «провайдер не настроен» и сайт
 * продолжает работать.
 *
 * Числа приводятся Number ЗДЕСЬ, а не в запросе. В JSON Xsolla ждёт
 * project_id числом; строкой придёт 422 с невнятным.property_errors.
 */
export function xsollaConfig(env: Env = process.env): XsollaConfig | null {
  if (env.XSOLLA_ENABLED !== 'true') return null;
  const publisherId = целое(непустое(env.XSOLLA_PUBLISHER_ID));
  const projectId = целое(непустое(env.XSOLLA_PROJECT_ID));
  const apiKey = непустое(env.XSOLLA_API_KEY);
  const webhookSecret = непустое(env.XSOLLA_WEBHOOK_SECRET);
  if (publisherId === null || projectId === null || apiKey === null || webhookSecret === null) {
    return null;
  }
  return {
    publisherId,
    projectId,
    apiKey,
    webhookSecret,
    sandbox: env.XSOLLA_SANDBOX === 'true',
  };
}

export function isXsollaEnabled(env: Env = process.env): boolean {
  return xsollaConfig(env) !== null;
}

/**
 * SKU набора азенов в каталоге Xsolla.
 *
 * Правила каталога: только латинские буквы, цифры, точка, дефис и
 * подчёркивание. packId приходит от клиента, поэтому проверка тут не
 * формальность: без неё в SKU уехал бы чужой текст, Xsolla ответил бы
 * 422, и игрок увидел бы «платёж не создан» вместо честной цены в каталоге.
 */
export const ПРЕФИКС_SKU = 'eos.azens.';

const ДОПУСТИМЫЙ_SKU = /^[A-Za-z0-9._-]+$/;

export function xsollaSku(packId: string): string {
  if (typeof packId !== 'string' || packId.length === 0) {
    throw new Error('pack_id пуст');
  }
  if (!ДОПУСТИМЫЙ_SKU.test(packId)) {
    throw new Error(`pack_id недопустим для SKU: ${packId}`);
  }
  return `${ПРЕФИКС_SKU}${packId}`;
}

/** Почта для Xsolla, если она настоящая. Подделкам адреса не бывает. */
export function xsollaEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const почта = непустое(email);
  if (почта === null) return null;
  const внизу = почта.toLowerCase();
  for (const подделка of ПОДДЕЛКИ_ПОЧТЫ) {
    if (внизу.endsWith(подделка)) return null;
  }
  return почта;
}

/** Страна для Xsolla: ISO 3166-1 alpha-2, заглавными. */
export function xsollaCountry(country: string | null | undefined): string | null {
  if (typeof country !== 'string') return null;
  const код = непустое(country);
  if (код === null) return null;
  if (!/^[A-Za-z]{2}$/.test(код)) return null;
  return код.toUpperCase();
}

/**
 * Адрес игрока для заголовка X-User-Ip.
 *
 * Проверка не для красоты: значение уходит в HTTP-заголовок, а перевод
 * строки в заголовке ломает запрос целиком и роняет весь платёж. Поэтому
 * пропускаем только то, что состоит из hex-символов и точек, - этого
 * хватает и для IPv4, и для IPv6, и не даёт проскочить ничего управляющего.
 */
export function xsollaUserIp(ip: string | null | undefined): string | null {
  if (typeof ip !== 'string') return null;
  const значение = непустое(ip);
  if (значение === null) return null;
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(значение)) return null;
  return значение;
}

export interface XsollaTokenInput {
  /** Наш paymentId: уходит в content позиции заказа и связывает вебхук с записью. */
  paymentId: string;
  /** Наш users.id: Xsolla будет присылать его в user_validation. */
  userId: string;
  /** SKU набора в каталоге Xsolla. */
  sku: string;
  /** Сколько единиц покупается. В нашем случае всегда 1: один набор. */
  quantity: number;
  /** Куда вернуть игрока после оплаты. */
  returnUrl: string;
  /** Куда вернуть, если игрок закрыл витрину, не заплатив. */
  cancelUrl?: string | null;
  /** Настоящая почта игрока, если она есть. */
  email?: string | null;
  /** Страна игрока: по ней Xsolla выбирает валюту. */
  country?: string | null;
  /**
   * Адрес игрока: Xsolla берёт страну из него, если country не передан.
   *
   * Ровно то, о чём говорит её 422: «user.country.value or the header
   * X-User-Ip must be specified». Адрес у нас есть всегда - это req.ip.
   */
  userIp?: string | null;
  /** Язык витрины. */
  language?: string | null;
}

export interface XsollaTokenRequest {
  path: string;
  body: Record<string, unknown>;
}

/**
 * Тело запроса токена.
 *
 * ПОЧЕМУ ТАК МНОГО ПРОВЕРОК ВНУТРИ. Каждая из них закрывает 422, а тело
 * ошибки у Xsolla невнятное: «JSON is not valid against json schema». Без
 * этих проверок ошибка уехала бы к игроку как «платёж не создался», и
 * виноватым выглядел бы каталог, а не код.
 */
export function buildXsollaTokenRequest(
  input: XsollaTokenInput,
  config: XsollaConfig,
): XsollaTokenRequest {
  if (typeof input.paymentId !== 'string' || input.paymentId.length === 0) {
    throw new Error('payment_id пуст');
  }
  if (typeof input.userId !== 'string' || input.userId.length === 0) {
    throw new Error('user_id пуст');
  }
  if (typeof input.sku !== 'string' || !ДОПУСТИМЫЙ_SKU.test(input.sku)) {
    throw new Error(`sku недопустим: ${String(input.sku)}`);
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new Error(`quantity должен быть целым положительным: ${String(input.quantity)}`);
  }
  if (typeof input.returnUrl !== 'string' || !/^https?:\/\//.test(input.returnUrl)) {
    throw new Error('return_url должен быть http(s)-адресом');
  }
  // Страна НЕ обязательна, вопреки тому, что написано было здесь раньше.
  // Проверено на живых ответах Xsolla: запрос без country приходит с
  //   422, errorCode 1102: «The parameter user.country.value or the header
  //   X-User-Ip must be specified»
  // То есть Xsolla требует страну ЛИБО адрес, и адрес для неё равноценен.
  // Прежний код требовал именно страну и падал сам, не доходя до Xsolla:
  // в игре страну игрока взять неоткуда, а заголовка x-solla-country в
  // обычном запросе не бывает. Из-за этого каждый платёж упирался в
  // «не удалось открыть страницу оплаты» при заведомо рабочих ключах.
  const country = xsollaCountry(input.country);
  const user: Record<string, unknown> = { id: { value: input.userId } };
  if (country !== null) {
    user.country = { value: country };
  }
  const почта = xsollaEmail(input.email);
  if (почта !== null) {
    // allow_modify не передаём: переданный адрес витрина не даёт менять, и
    // это то, что нужно — иначе чек уйдёт на чужой адрес.
    user.email = { value: почта };
  }

  const settings: Record<string, unknown> = {
    // Число, не строка. Строка даёт 422.
    project_id: config.projectId,
    // ВАЖНО: settings.external_id здесь БЫЛ и PayStation его не принимает.
    // См. purchase.items[].content ниже - наш paymentId едет туда.
    return_url: input.returnUrl,
    // Редиректы настроены так же, как в кабинете: автоматического нет,
    // игрок уходит кнопкой «Вернуться в игру» после успешной оплаты.
    // Автоматический редирект с витрины, которая открыта ПОВЕРХ 3D-мира,
    // выкинул бы игрока из состояния, заодно сбросив несохранённый прогресс.
    redirect_policy: {
      redirect_conditions: 'none',
      status_for_manual_redirection: 'successful',
      redirect_button_caption: 'Вернуться в игру',
      delay: 0,
    },
    ui: {
      // Список способов оплаты страны игрока, а не один метод по PayRank.
      // Смысл тот же, что и в кабинете: Xsolla сама покажет подходящее.
      is_payment_methods_list_mode: true,
    },
  };
  if (typeof input.language === 'string') {
    const язык = непустое(input.language);
    if (язык !== null) settings.language = язык.toLowerCase();
  }
  if (typeof input.cancelUrl === 'string') {
    const отмена = непустое(input.cancelUrl);
    if (отмена !== null) settings.cancel_url = отмена;
  }

  const body: Record<string, unknown> = {
    user,
    purchase: {
      items: [
        {
          sku: input.sku,
          quantity: input.quantity,
          // Наш paymentId едет ЗДЕСЬ, а не в settings.external_id.
          //
          // Проверено на живых ответах Xsolla, методом деления запроса на
          // шаги. settings.external_id с ЛЮБЫМ строковым значением (UUID,
          // число строкой, 'abc') роняет PayStation:
          //   422, errorCode 2000: «Exception with PayStation service»
          // Числом он тоже не проходит, но с другой ошибкой (1102), то есть
          // поле Xsolla знает, а PayStation ломается на самом значении.
          // Поле content у позиции заказа такого отказа не даёт: 201 и
          // токен. Это единственное найденное место, куда Xsolla берёт наш
          // идентификатор и отдаёт его потом в заказе.
          content: { external_id: input.paymentId },
        },
      ],
    },
    settings,
  };
  // Флаг песочницы на верхнем уровне, а не в settings. Отдельное поле.
  if (config.sandbox) body.sandbox = true;

  return { path: `/v3/project/${config.projectId}/admin/payment/token`, body };
}

/**
 * Заголовок Authorization для вызова API.
 *
 * basicAuth: base64 от «publisherId:apiKey». Для этого вызова нужен ключ,
 * действующий на ВСЕ проекты компании, а не ключ отдельного проекта: в
 * пути merchant_id вместо project_id. С ключом проекта придёт 401.
 */
export function xsollaAuthHeader(config: XsollaConfig): string {
  const пара = `${config.publisherId}:${config.apiKey}`;
  return `Basic ${Buffer.from(пара, 'utf-8').toString('base64')}`;
}

/** Адрес витрины для токена. Хост песочницы другой — ошибка здесь не видна. */
export function xsollaCheckoutUrl(token: string, sandbox: boolean): string {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('токен пуст');
  }
  const основа = sandbox ? ВИТРИНА_ПЕСОЧНИЦЫ : ВИТРИНА_БОЕВАЯ;
  return `${основа}?token=${encodeURIComponent(token)}`;
}

/** Адрес API для этого вызова. */
export function xsollaApiUrl(path: string): string {
  return `${ОСНОВА_API}${path}`;
}
