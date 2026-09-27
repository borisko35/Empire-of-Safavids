// ============================================================
// Приглашение друга — Empire of Safavids
// ============================================================
// Ссылка от пригласившего выглядит так: /game/?ref=КОД
//
// Код запоминается СРАЗУ при заходе на страницу, а не при создании
// персонажа. Игрок может прийти по ссылке, зарегистрироваться, отойти
// на день и создать персонажа завтра. Если бы мы искали код в адресе
// только в момент создания, приглашение бы тихо пропало.
//
// Код живёт в localStorage, а не в sessionStorage: игрок может закрыть
// вкладку и вернуться хоть через неделю — приглашение должно засчитаться.
//
// Код удаляется ТОЛЬКО после успешного создания персонажа. Иначе игрок
// создал бы первого персонажа, код бы потратился впустую, а второй
// персонаж уже не принёс бы награды.

import { api } from './api';
import { t } from './i18n';
import { toast } from './hud';

const CODE_KEY = 'eos_referral';
/** Сколько символов в коде — столько же, сколько генерирует сервер */
const CODE_LEN = 8;

/** Принимает ли сервер такой код: ровно CODE_LEN букв и цифр */
function looksLikeCode(v: string): boolean {
  return new RegExp(`^[A-Za-z0-9]{${CODE_LEN}}$`).test(v);
}

/**
 * Забрать код из адреса и запомнить. Вызывается один раз при старте игры,
 * ДО восстановления сессии: код может прийти к уже вошедшему игроку.
 *
 * Возвращает true, если в адресе был код (тогда его надо смыть из URL,
 * иначе игрок будет приглашать сам себя при каждом переходе).
 */
export function captureReferralFromUrl(): boolean {
  let found = false;
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('ref');
    if (raw) {
      const code = raw.trim().toUpperCase();
      // Мусор в ссылке (например ?ref=abc) не должен ломать страницу,
      // но и затирать уже сохранённый код — тоже нельзя
      if (looksLikeCode(code) && !localStorage.getItem(CODE_KEY)) {
        localStorage.setItem(CODE_KEY, code);
        toast(t('referral.invited_toast'), 'success');
      }
      found = true;
      // Убираем код из адреса в любом случае: чистый адрес нужен и для
      // OAuth-возврата, и чтобы не смущать игрока длинной ссылкой
      url.searchParams.delete('ref');
      window.history.replaceState({}, '', url.toString());
    }
  } catch {
    // Адрес бывает неразбираемым (песочница iframe) — не повод ломать игру
  }
  return found;
}

/** Запомненный код приглашения, если он есть */
export function savedReferralCode(): string | null {
  try {
    const v = localStorage.getItem(CODE_KEY);
    return v && looksLikeCode(v) ? v.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Создать персонажа, приложив код приглашения, и потратить код.
 *
 * Код убирается из памяти только после успешного ответа сервера: если
 * запрос не прошёл, игрок не должен потерять приглашение.
 */
export async function createCharacterWithReferral(
  name: string,
  characterClass: string,
  serverId: string,
): Promise<{ character: Awaited<ReturnType<typeof api.createCharacter>>['character']; invited: boolean }> {
  const code = savedReferralCode();
  const res = await api.createCharacter(name, characterClass, serverId, code ?? undefined);
  // Приглашение засчитано сервером, код отработал — убираем, чтобы второй
  // персонаж того же аккаунта не принёс награду повторно
  if (code) {
    try { localStorage.removeItem(CODE_KEY); } catch { /* не критично */ }
  }
  return { character: res.character, invited: !!code };
}
