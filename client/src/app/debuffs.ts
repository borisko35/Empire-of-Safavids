// Индикатор эффектов монстров: иконки с обратным отсчётом и метка оглушения.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ПЕРЕМЕННАЯ В world.ts. Состояние эффектов
// читают три места: отрисовка полоски, запрет атаки и очистка при выходе.
// Если бы оно лежало прямо в world.ts, любая правка рисования тянула бы
// за собой правку запрета атаки, и рано или поздно одно из двух забыли бы
// обновить - а забытый запрет атаки выглядел бы как «оглушение не
// работает», хотя работает.
//
// ГЛАВНОЕ ПРАВИЛО. Оглушение показывается только когда оно действительно
// есть, и запрещает атаку только когда оно действительно есть. Проверка
// на сервере всё равно есть - клиентский запрет нужен не для честности,
// а чтобы игрок не ждал ответа на клик, который сервер всё равно отвергнет.
import { t } from './i18n';

export interface DebuffView {
  id: string;
  kind: string;
  secondsLeft: number;
  magnitude: number;
}

let debuffs: DebuffView[] = [];
let панель: HTMLElement | null = null;
let таймер: ReturnType<typeof setInterval> | null = null;
let onStunChange: ((stunned: boolean) => void) | null = null;

/**
 * Иконка и подпись для вида эффекта.
 *
 * Слова берутся из словаря, а не пишутся здесь: панель показывается
 * трём языкам, и русский текст в коде вернул бы его всем.
 */
function подпись(d: DebuffView): { значок: string; текст: string; цвет: string } {
  switch (d.kind) {
    case 'stun':
      return { значок: '✷', текст: t('debuffs.stun'), цвет: '#f0d67a' };
    case 'slow':
      return { значок: '⛓', текст: t('debuffs.slow'), цвет: '#9fc4e3' };
    case 'bleed':
      return { значок: '🩸', текст: t('debuffs.bleed'), цвет: '#e07a6a' };
    case 'poison':
      return { значок: '☠', текст: t('debuffs.poison'), цвет: '#a8d06a' };
    case 'fear':
      return { значок: '❗', текст: t('debuffs.fear'), цвет: '#c98fd0' };
    default:
      // Неизвестный вид эффекта показываем как есть, а не прячем: если
      // сервер прислал что-то новое, игрок должен это увидеть, иначе
      // неизвестный эффект выглядел бы как «ничего не произошло».
      return { значок: '●', текст: d.kind, цвет: '#cfe3f0' };
  }
}

/**
 * Полоса эффектов. Создаётся при первом обращении.
 *
 * Возвращает HTMLElement, а не HTMLElement | null: панель либо уже есть,
 * либо мы её сами создаём, а третьего варианта нет. Тип с null заставил
 * бы в каждом месте писать проверку, и проверку в итоге проглатывали бы.
 */
function найтиПанель(): HTMLElement {
  if (панель) return панель;
  let el = document.getElementById('debuff-bar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'debuff-bar';
    document.body.appendChild(el);
  }
  панель = el;
  return el;
}

function перерисовать(): void {
  const el = найтиПанель();
  // Порядок по оставшемуся времени: то, что скоро кончится, поднимается
  // наверх. Игрок читает сверху вниз, и то, что сейчас важнее, должно
  // быть ближе к началу списка.
  const поВремени = [...debuffs].sort((a, b) => a.secondsLeft - b.secondsLeft);
  el.innerHTML = поВремени.map(d => {
    const п = подпись(d);
    return `<div class="debuff-chip" style="border-color:${п.цвет}" title="${п.текст}">` +
      `<span class="debuff-icon">${п.значок}</span>` +
      `<span class="debuff-name" style="color:${п.цвет}">${п.текст}</span>` +
      `<span class="debuff-time">${d.secondsLeft}с</span></div>`;
  }).join('');
  el.style.display = debuffs.length ? 'flex' : 'none';
}

/** Обратный отсчёт. Каждую секунду, пока есть хоть один эффект. */
function запуститьОтсчёт(): void {
  if (таймер !== null || !debuffs.length) return;
  таймер = setInterval(() => {
    const раньше = debuffs.length;
    debuffs = debuffs.map(d => ({ ...d, secondsLeft: d.secondsLeft - 1 })).filter(d => d.secondsLeft > 0);
    перерисовать();
    // Огонь пропал - уменьшаем счётчик, чтобы не крутить пустой таймер
    // каждую секунду до конца сессии.
    if (debuffs.length < раньше || !debuffs.length) {
      if (таймер !== null) { clearInterval(таймер); таймер = null; }
    }
  }, 1000);
}

/** Полный список от сервера. Приходит раз в две секунды. */
export function setActiveDebuffs(list: DebuffView[]): void {
  const былоОглушение = debuffs.some(d => d.kind === 'stun');
  debuffs = (list ?? [])
    // Отсекаем то, что уже кончилось по серверным часам: за две секунды
    // между пакетами эффект мог истечь, и иконка простояла бы лишние
    // две секунды на экране.
    .filter(d => d.secondsLeft > 0)
    .map(d => ({ ...d, secondsLeft: Math.max(1, Math.floor(d.secondsLeft)) }));
  перерисовать();
  if (debuffs.length) запуститьОтсчёт();
  const сталоОглушение = debuffs.some(d => d.kind === 'stun');
  if (сталоОглушение !== былоОглушение) onStunChange?.(сталоОглушение);
}

/**
 * Добавить один эффект, пришедший с ударом.
 *
 * Повтор того же эффекта ПРОДЛЕВАет отсчёт, а не добавляет вторую
 * иконку: сервер продлевает срок при повторном попадании, и клиент
 * обязан вести себя так же. Иначе пять «Топтаний» подряд дали бы пять
 * одинаковых иконок, и игрок решил бы, что монстр накладывает эффекты
 * быстрее, чем настроено.
 */
export function addDebuff(d: DebuffView): void {
  if (!d || d.secondsLeft <= 0) return;
  const был = debuffs.find(x => x.id === d.id);
  debuffs = [...debuffs.filter(x => x.id !== d.id), { ...d, secondsLeft: Math.max(1, Math.floor(d.secondsLeft)) }];
  перерисовать();
  запуститьОтсчёт();
  if ((d.kind === 'stun') !== !!был && debuffs.some(x => x.kind === 'stun') !== !!был) {
    onStunChange?.(debuffs.some(x => x.kind === 'stun'));
  }
}

/** Оглушён ли игрок прямо сейчас. Из этого строится запрет атаки. */
export function isStunnedNow(): boolean {
  return debuffs.some(d => d.kind === 'stun');
}

/** Подписаться на смену оглушения. Вызывается один раз при старте. */
export function onStunChanged(fn: (stunned: boolean) => void): void {
  onStunChange = fn;
}

/**
 * Снять всё: выход из игры, смена региона, смерть.
 *
 * Эффекты живут в базе, а не только на экране: без очистки оглушение
 * пережило бы перезаход, и игрок вернулся бы не бьющим. Сервер снимает
 * их по своему счёту, клиент - по своему списку, и оба обязаны начать
 * с чистого листа.
 */
export function clearDebuffs(): void {
  debuffs = [];
  if (таймер !== null) { clearInterval(таймер); таймер = null; }
  перерисовать();
  onStunChange?.(false);
}
