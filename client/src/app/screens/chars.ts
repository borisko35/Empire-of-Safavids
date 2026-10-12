// ============================================================
// Экран выбора персонажа — Empire of Safavids
// ============================================================

import { api, ApiError } from '../api';
import { session, Character } from '../state';
import { t } from '../i18n';
import { CLASS_COLORS } from '../../ui/icons';
import { showScreen } from '../world';
import { toast } from '../hud';
import { createCharacterWithReferral } from '../referral';
import { attachClassPreview, stopClassPreviews } from './classPreview';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const CLASSES = ['qizilbash', 'sufi_mystic', 'persian_archer', 'bazaar_merchant', 'court_diplomat'] as const;
const CLASS_SPRITE: Record<string, string> = {
  qizilbash: 'char_qizilbash_0',
  sufi_mystic: 'char_sufi_mystic_0',
  persian_archer: 'char_persian_archer_0',
  bazaar_merchant: 'char_bazaar_merchant_0',
  court_diplomat: 'char_court_diplomat_0',
};

let selectedClass = 'qizilbash';
let spritesReady = false;

/**
 * Спрайты классов нужны иконкам выбора — грузим по URL лениво.
 *
 * ЗДЕСЬ БЫЛО ПРОЗРАЧНОЕ `await import(...)` БЕЗ ОБРАБОТКИ, и это стоило дороже,
 * чем кажется. Путь собран из шаблонной строки, поэтому Vite не разбирает его
 * статически и делает отдельный чанк на каждый спрайт: `char_qizilbash_0-*.js`
 * весит 72 байта и содержит одну строку вида
 * `var e = "/game/assets/char_qizilbash_0-8wMs2jEu.png"; export { e as default }`.
 * Имя чанка — с хешем содержимого, то есть меняется при КАЖДОЙ выкатке.
 *
 * Отсюда сцена, которая случится с каждым, кто не обновил страницу: в кеше
 * старый `index-*.js`, он просит `char_qizilbash_0-СТАРЫЙХЕШ.js`, сервер отдаёт
 * 404, импорт отклоняется. Дальше:
 *
 *   - `refreshList` падал на середине цикла, и список персонажей дорисовывался
 *     частично: часть строк есть, остальных нет, и никто не знает почему;
 *   - `refreshList` зовётся после удаления персонажа внутри `try`, где любой отказ
 *     показывается тостом «удалить не удалось». Персонаж удалён, а игроку
 *     сказали обратное — из-за спрайта, который никто не увидит.
 *
 * Спрайт — украшение. Отказ от него не должен рушить список и врать о том, что
 * случилось с персонажем, поэтому здесь null, а не исключение.
 */
async function spriteUrl(base: string): Promise<string | null> {
  try {
    const mod = await import(`../assets/sprites/${base}.png`);
    return mod.default as string;
  } catch (e) {
    // Один раз на спрайт, не на каждый вызов: при 404 на всех иконках выбора
    // иначе получим двадцать одинаковых строк.
    console.warn(`[chars] ${base}: ${t('chars.sprite_failed')}`, e);
    return null;
  }
}

export async function initCharsScreen(onEnter: (c: Character) => void): Promise<void> {
  // Превью с прошлого показа (повторный вход без перезагрузки): иначе старые
  // контексты остались бы тикать поверх новых.
  stopClassPreviews();
  $('chars-username').textContent = session.username;
  showScreen('screen-chars');
  await buildClassPicker();
  await buildServerPicker();
  await refreshList(onEnter);

  ($('form-create') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const name = ($('new-name') as HTMLInputElement).value.trim();
    const serverId = ($('new-server') as HTMLSelectElement).value;
    const err = $('create-error');
    err?.classList.add('hidden');
    try {
      // Создаём через обёртку: она приложит код приглашения и потратит его
      const { character } = await createCharacterWithReferral(name, selectedClass, serverId);
      ($('new-name') as HTMLInputElement).value = '';
      // В игру — без пяти живых превью за спиной.
      stopClassPreviews();
      onEnter(character);
    } catch (e) {
      // ТУТ БЫЛО alert(). Нативное окно останавливает всю страницу: пока
      // его не закроют, не работают ни кнопки, ни ввод. И показывало оно
      // текст ошибки БД («duplicate key value…»), потому что сервер отдавал
      // 500. Теперь код ошибки переводится, а текст стоит в форме.
      const code = (e as ApiError).code;
      const msg = code && t(`errors.${code}`) !== `errors.${code}` ? t(`errors.${code}`) : t('chars.create_failed');
      if (err) {
        err.textContent = msg;
        err.classList.remove('hidden');
      }
    }
  };

  $('btn-logout').addEventListener('click', () => {
    stopClassPreviews();
    // ПОРЯДОК ТОТ ЖЕ, ЧТО В МИРЕ, И ЭТО ВАЖНО.
    //
    // ЗДЕСЬ БЫЛО: `location.reload()` сразу после запроса. Так делать нельзя по
    // двум причинам, и обе молчаливые.
    //
    //   1. reload() срывает запрос на полпути. Отзыв токена на сервере -
    //      `authService.logout(token, userId)` - не успевает дойти, и сессия
    //      остаётся живой, хотя игрок считает, что вышел.
    //   2. Никто не звал clearAuth(), поэтому `eos_token` остаётся в
    //      localStorage, и после перезагрузки приложение читает его заново.
    //      Выход выглядит как «ничего не сделал».
    //
    // В мире (world.ts) тот же выход устроен правильно: запрос уходит, затем
    // logoutLocal() чистит локальную сессию и показывает экран входа. Здесь
    // сделано ровно то же, и перезагрузка убрана - она была единственной
    // причиной обеих поломок.
    void api.logout().catch(() => {});
    void import('../main').then((модуль) => модуль.logoutLocal());
  });
}

/** Выпадающий список игровых серверов с онлайном */
async function buildServerPicker(): Promise<void> {
  const select = $('new-server') as HTMLSelectElement | null;
  if (!select) return;
  try {
    const { servers } = await api.gameServers();
    select.innerHTML = '';
    for (const srv of servers) {
      const opt = document.createElement('option');
      opt.value = srv.id;
      const srvName = t(SERVER_NAMES[srv.id] ?? srv.nameRu);
      opt.textContent = `${srvName} — ${t('chars.online')}: ${srv.online}${srv.recommended ? ` ★ ${t('chars.recommended')}` : ''}`;
      if (srv.recommended) opt.selected = true;
      select.append(opt);
    }
  } catch {
    select.innerHTML = `<option value="isfahan">${t('regions.isfahan')}</option>`;
  }
}

/** Названия игровых серверов (по id из shared/constants) */
const SERVER_NAMES: Record<string, string> = {
  baku: 'servers.baku', nakhchivan: 'servers.nakhchivan', ganja: 'servers.ganja', tebriz: 'servers.tebriz',
  khoy: 'servers.khoy', rasht: 'servers.rasht', isfahan: 'servers.isfahan', derbent: 'servers.derbent',
};

let refreshListSeq = 0;

async function refreshList(onEnter: (c: Character) => void): Promise<void> {
  const list = $('char-list');
  list.innerHTML = '';
  const seq = ++refreshListSeq;
  try {
    const { characters } = await api.characters();
    // Второй параллельный вызов (двойной клик по «Войти») — старый молча выходит,
    // иначе два ответа interleaving дают задвоенные строки (1 персонаж = 2).
    if (seq !== refreshListSeq) return;
    if (!characters.length) {
      list.innerHTML = `<div class="char-empty">${t('chars.empty')}</div>`;
      return;
    }
    const seen = new Set<string>();
    for (const c of characters) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const row = document.createElement('div');
      row.className = 'char-row';
      const img = document.createElement('img');
      const спрайт = await spriteUrl(CLASS_SPRITE[c.class] ?? 'char_qizilbash_0');
      // Спрайт мог не загрузиться — карточка остаётся в списке, просто без
      // картинки. Раньше отказ здесь обрывал весь цикл, и список дорисовывался
      // наполовину.
      if (спрайт) img.src = спрайт;
      img.alt = '';
      const info = document.createElement('div');
      info.className = 'info';
      const serverName = t(SERVER_NAMES[c.serverId] ?? c.serverId);
      info.innerHTML =
        `<div class="name" style="color:${CLASS_COLORS[c.class] ?? 'var(--gold-light)'}">${c.name}</div>` +
        `<div class="meta">${t(`classes.${c.class}`)} · ${t('badges.level')} ${c.level} · ${regionLabel(c.region)}</div>` +
        `<div class="meta server-badge">${t('chars.server')}: ${serverName}</div>`;
      const enter = document.createElement('span');
      enter.className = 'enter';
      enter.textContent = `▶ ${t('chars.enter_world')}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'char-delete';
      del.textContent = '✕';
      del.title = t('chars.delete');
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!window.confirm(`${t('chars.delete_confirm')} ${c.name}?`)) return;
        try {
          await api.deleteCharacter(c.id);
          await refreshList(onEnter);
        } catch (err) {
          // Тот же alert(), что и при создании: он блокировал страницу.
          // Сюда попадает ошибка удаления, отдельной строки для неё нет —
          // показываем тостом, он ничего не перекрывает
          toast(t('chars.delete_failed'), 'error');
          void err;
        }
      });
      row.append(img, info, enter, del);
      row.addEventListener('click', () => {
        // Готовые персонажи показывают спрайты (их число не ограничено, а
        // каждое живое превью — это GL-контекст), но карточки классов за
        // спиной всё равно надо остановить.
        stopClassPreviews();
        onEnter(c);
      });
      list.append(row);
    }
  } catch (err) {
    list.innerHTML = `<div class="char-empty">${(err as Error).message}</div>`;
  }
}

function regionLabel(region: string): string {
  const names: Record<string, string> = {
    tabriz: 'regions.tabriz', isfahan: 'regions.isfahan', shiraz: 'regions.shiraz', caucasus: 'regions.caucasus',
    mesopotamia: 'regions.mesopotamia', khorasan: 'regions.khorasan', persian_gulf: 'regions.persian_gulf',
  };
  return t(names[region] ?? region);
}

async function buildClassPicker(): Promise<void> {
  const picker = $('class-picker');
  if (!spritesReady) {
    // предзагрузка URL спрайтов (для превью классов)
    spritesReady = true;
  }
  picker.innerHTML = '';
  for (const id of CLASSES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'class-option' + (id === selectedClass ? ' selected' : '');
    btn.style.setProperty('--class-color', CLASS_COLORS[id]);
    // Живое 3D-превью вместо плоского спрайта: настоящая модель с оружием
    // класса на медленном круге. Canvas в DOM сразу (с фоном из CSS), модель
    // доезжает асинхронно. Не доехала — вместо пустой тёмной карточки встанет
    // пиксельный спрайт.
    const canvas = document.createElement('canvas');
    canvas.className = 'class-preview';
    const название = document.createElement('span');
    название.textContent = t(`classes.${id}`);
    btn.append(canvas, название);
    void attachClassPreview(canvas, id).then((живое) => {
      if (живое) return;
      const img = document.createElement('img');
      img.alt = '';
      canvas.replaceWith(img);
      void spriteUrl(CLASS_SPRITE[id]).then((url) => {
        if (!url) return;
        img.src = url;
      });
    });
    btn.addEventListener('click', () => {
      selectedClass = id;
      for (const el of picker.children) el.classList.remove('selected');
      btn.classList.add('selected');
    });
    picker.append(btn);
  }
}
