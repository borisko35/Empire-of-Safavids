// ============================================================
// Экран выбора персонажа — Empire of Safavids
// ============================================================

import { api } from '../api';
import { session, Character } from '../state';
import { t } from '../i18n';
import { CLASS_COLORS } from '../../ui/icons';
import { showScreen } from '../world';

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
  await refreshList(onEnter);

  ($('form-create') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const name = ($('new-name') as HTMLInputElement).value.trim();
    try {
      const { character } = await api.createCharacter(name, selectedClass);
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

async function refreshList(onEnter: (c: Character) => void): Promise<void> {
  const list = $('char-list');
  list.innerHTML = '';
  try {
    const { characters } = await api.characters();
    if (!characters.length) {
      list.innerHTML = `<div class="char-empty">${t('chars.empty')}</div>`;
      return;
    }
    for (const c of characters) {
      const row = document.createElement('div');
      row.className = 'char-row';
      const img = document.createElement('img');
      img.src = await spriteUrl(CLASS_SPRITE[c.class] ?? 'char_qizilbash_0');
      img.alt = '';
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML =
        `<div class="name" style="color:${CLASS_COLORS[c.class] ?? 'var(--gold-light)'}">${c.name}</div>` +
        `<div class="meta">${t(`classes.${c.class}`)} · ${t('badges.level')} ${c.level} · ${regionLabel(c.region)}</div>`;
      const enter = document.createElement('span');
      enter.className = 'enter';
      enter.textContent = `▶ ${t('chars.enter_world')}`;
      row.append(img, info, enter);
      row.addEventListener('click', () => onEnter(c));
      list.append(row);
    }
  } catch (err) {
    list.innerHTML = `<div class="char-empty">${(err as Error).message}</div>`;
  }
}

function regionLabel(region: string): string {
  const names: Record<string, string> = {
    tabriz: 'Тебриз', isfahan: 'Исфахан', shiraz: 'Шираз', caucasus: 'Кавказ',
    mesopotamia: 'Месопотамия', khorasan: 'Хорасан', persian_gulf: 'Персидский залив',
  };
  return names[region] ?? region;
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
