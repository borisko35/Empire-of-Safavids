// ============================================================
// Экран выбора персонажа — Empire of Safavids
// ============================================================

import { api } from '../api';
import { session, Character } from '../state';
import { t } from '../i18n';
import { CLASS_COLORS } from '../../ui/icons';
import { showScreen } from '../world';
import { createCharacterWithReferral } from '../referral';

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

/** Спрайты классов нужны иконкам выбора — грузим по URL лениво */
async function spriteUrl(base: string): Promise<string> {
  const mod = await import(`../assets/sprites/${base}.png`);
  return mod.default as string;
}

export async function initCharsScreen(onEnter: (c: Character) => void): Promise<void> {
  $('chars-username').textContent = session.username;
  showScreen('screen-chars');
  await buildClassPicker();
  await buildServerPicker();
  await refreshList(onEnter);

  ($('form-create') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const name = ($('new-name') as HTMLInputElement).value.trim();
    const serverId = ($('new-server') as HTMLSelectElement).value;
    try {
      // Создаём через обёртку: она приложит код приглашения и потратит его
      const { character } = await createCharacterWithReferral(name, selectedClass, serverId);
      ($('new-name') as HTMLInputElement).value = '';
      onEnter(character);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  $('btn-logout').addEventListener('click', () => {
    void api.logout().catch(() => {});
    location.reload();
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
      img.src = await spriteUrl(CLASS_SPRITE[c.class] ?? 'char_qizilbash_0');
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
          alert((err as Error).message);
        }
      });
      row.append(img, info, enter, del);
      row.addEventListener('click', () => onEnter(c));
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
    btn.innerHTML =
      `<img src="${await spriteUrl(CLASS_SPRITE[id])}" alt="">` +
      `<span>${t(`classes.${id}`)}</span>`;
    btn.addEventListener('click', () => {
      selectedClass = id;
      for (const el of picker.children) el.classList.remove('selected');
      btn.classList.add('selected');
    });
    picker.append(btn);
  }
}
