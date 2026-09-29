// ============================================================
// Хаб панелей — Empire of Safavids
// ============================================================
//
// ЗАЧЕМ. Панелей в игре тридцать, и все они висели в одном ряду иконок
// (`.panel-toggles` — 33 кнопки на 1218 пикселей, за переносом на два ряда).
// Пользоваться этим можно было, но найти нужную панель — нельзя: подписи
// видны только при наведении, а ряд всё время занимает угол экрана.
//
// Теперь ряд — одна кнопка. Внутри хаба панели разложены по смыслу: бой,
// торговля, общество, прогресс, мир, прочее. Новая панель добавляется одной
// строкой в GROUPS, и ей сразу находится место.
//
// ЧТО НЕ СЛОМАНО. Панели по-прежнему открываются и по своей кнопке в
// `.panel-toggles`, если она есть: хаб — это второй вход в то же самое, а не
// замена. Поэтому NPC-клики (openPanelById) и горячие клавиши не затронуты.

import { icon, type IconName } from '../ui/icons';
import { t } from './i18n';
import { openPanelById } from './world';

/** Группа панелей: подпись, иконка и список панелей внутри */
interface HubGroup {
  id: string;
  icon: IconName;
  panels: { id: string; titleKey: string; icon: IconName; staffOnly?: boolean }[];
}

/**
 * Все панели игры, разложенные по смыслу.
 *
 * Порядок групп — от того, чем игрок занят чаще всего, к тому, что открывают
 * изредка. Внутри группы панели идут от общих к частным.
 */
const GROUPS: HubGroup[] = [
  {
    id: 'combat', icon: 'swords',
    panels: [
      { id: 'panel-skills', titleKey: 'hub.skills', icon: 'bolt' },
      { id: 'panel-inventory', titleKey: 'hub.inventory', icon: 'chest' },
      { id: 'panel-dungeons', titleKey: 'hub.dungeons', icon: 'swords' },
      { id: 'panel-pvp', titleKey: 'hub.pvp', icon: 'swords' },
      { id: 'panel-tower', titleKey: 'hub.tower', icon: 'star8' },
    ],
  },
  {
    id: 'trade', icon: 'coin',
    panels: [
      { id: 'panel-shop', titleKey: 'hub.shop', icon: 'coin' },
      { id: 'panel-auction', titleKey: 'hub.auction', icon: 'coin' },
      { id: 'panel-trade', titleKey: 'hub.caravans', icon: 'silk' },
      { id: 'panel-mount-stable', titleKey: 'hub.mounts', icon: 'chest' },
      { id: 'panel-craft', titleKey: 'hub.craft', icon: 'gear' },
    ],
  },
  {
    id: 'social', icon: 'user',
    panels: [
      { id: 'panel-notifications', titleKey: 'hub.notifications', icon: 'chat' },
      { id: 'panel-referral', titleKey: 'hub.referral', icon: 'user' },
      { id: 'panel-guild', titleKey: 'hub.guild', icon: 'user' },
      { id: 'panel-party', titleKey: 'hub.party', icon: 'user' },
      { id: 'panel-friends', titleKey: 'hub.friends', icon: 'user' },
    ],
  },
  {
    id: 'progress', icon: 'crown',
    panels: [
      { id: 'panel-tasks', titleKey: 'hub.tasks', icon: 'scroll' },
      { id: 'panel-achievements', titleKey: 'hub.achievements', icon: 'crown' },
      { id: 'panel-reputation', titleKey: 'hub.reputation', icon: 'flag' },
      // Зал славы: кто повалил мирового босса. Рядом с репутацией —
      // обе панели про то, что игрок сделал и что о нём помнят
      { id: 'panel-hall-of-fame', titleKey: 'hub.hall_of_fame', icon: 'crown' },
      // Почта: награды, которые не поместились в сумку при выдаче
      { id: 'panel-mail', titleKey: 'hub.mail', icon: 'scroll' },
      { id: 'panel-leaderboard', titleKey: 'hub.leaderboard', icon: 'crown' },
      { id: 'panel-pets', titleKey: 'hub.pets', icon: 'heart' },
    ],
  },
  {
    id: 'world', icon: 'map',
    panels: [
      { id: 'panel-quests', titleKey: 'hub.quests', icon: 'scroll' },
      // Подробный журнал квестов: он и раньше открывался только по клавише J,
      // отдельной кнопки не имел. В хабе лежит рядом со списком задач
      { id: 'panel-quests-j', titleKey: 'hub.quest_log', icon: 'scroll' },
      { id: 'panel-regions', titleKey: 'hub.regions', icon: 'map' },
      { id: 'panel-fishing', titleKey: 'hub.fishing', icon: 'drop' },
      { id: 'panel-house', titleKey: 'hub.house', icon: 'chest' },
      { id: 'panel-chess', titleKey: 'hub.chess', icon: 'crown' },
      { id: 'panel-poetry', titleKey: 'hub.poetry', icon: 'scroll' },
      { id: 'panel-chronicles', titleKey: 'hub.chronicles', icon: 'star8' },
      { id: 'panel-story', titleKey: 'hub.story', icon: 'crown' },
    ],
  },
  {
    id: 'other', icon: 'gear',
    panels: [
      // Панели сотрудников. Раньше их кнопки просто лежали в разметке скрытыми
      // и показывались через classList.toggle по правам. В хабе они тоже
      // скрыты: игроку без прав показывать «Админ» незачем — сервер всё равно
      // ответит 403, и панель выглядела бы поломкой
      { id: 'panel-media', titleKey: 'hub.media', icon: 'scroll', staffOnly: true },
      { id: 'panel-admin', titleKey: 'hub.admin', icon: 'shield', staffOnly: true },
      { id: 'panel-settings', titleKey: 'hub.settings', icon: 'gear' },
    ],
  },
];

/** Права сотрудника. До первого ответа сервера считаем, что их нет */
let isStaff = false;

/** Сообщить хабу о правах — вызывается тем же местом, что и раньше показывало кнопки */
export function setHubStaff(staff: boolean): void {
  if (staff === isStaff) return;
  isStaff = staff;
  // Перерисовываем, только если хаб уже открыт: иначе он соберётся заново
  // при первом нажатии и уже с правильным набором панелей
  if (!$('panel-hub')?.classList.contains('hidden')) renderHub();
}

/** Какая группа сейчас открыта. Запоминается, чтобы хаб не сбрасывался при закрытии */
let activeGroup = GROUPS[0].id;

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/**
 * Открыть панель из хаба.
 *
 * Панель показывается, хаб закрывается, а её собственная кнопка в ряду
 * (если такая есть) загорается. Загрузка содержимого идёт здесь, а не в
 * обработчике кнопки хаба, — иначе панель, открытая из хаба, оставалась бы
 * пустой до переоткрытия.
 */
function openFromHub(panelId: string, titleKey: string): void {
  const el = $(panelId);
  if (!el) return;
  // Открытие идёт через world.openPanelById: там уже есть и подсветка
  // кнопки, и доп. загрузка для инвентаря, квестов и карты. Дублировать
  // этот список здесь — значит через месяц забыть половину
  openPanelById(panelId);
  // Заголовок берём из хаба: у части панелей его нет вовсе, и игрок видел
  // серый прямоугольник без названия
  if (!el.querySelector('.hub-title')) {
    const title = document.createElement('div');
    title.className = 'hub-title';
    title.textContent = t(titleKey);
    el.prepend(title);
  }
  $('panel-hub')?.classList.add('hidden');
}

function renderHub(): void {
  const hub = $('panel-hub');
  if (!hub) return;

  const tabs = document.createElement('div');
  tabs.className = 'hub-tabs';
  const list = document.createElement('div');
  list.className = 'hub-list';

  for (const g of GROUPS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'hub-tab' + (g.id === activeGroup ? ' active' : '');
    tab.innerHTML = icon(g.icon, 16);
    tab.append(document.createTextNode(t(`hub.${g.id}`)));
    tab.addEventListener('click', () => {
      activeGroup = g.id;
      renderHub();
    });
    tabs.append(tab);
  }

  for (const p of GROUPS.find(g => g.id === activeGroup)?.panels ?? []) {
    if (p.staffOnly && !isStaff) continue;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'hub-item';
    const ico = document.createElement('span');
    ico.className = 'hub-item-icon';
    ico.innerHTML = icon(p.icon, 18);
    const label = document.createElement('span');
    label.textContent = t(p.titleKey);
    item.append(ico, label);
    item.addEventListener('click', () => openFromHub(p.id, p.titleKey));
    list.append(item);
  }

  hub.replaceChildren(tabs, list);
}

/** Вызывается диспетчером панелей по id, как и остальные загрузчики */
export function loadHub(): void {
  renderHub();
}

/** Есть ли такая панель в хабе — нужно переключателю кнопки в ряду */
export function hubKnows(panelId: string): boolean {
  return GROUPS.some(g => g.panels.some(p => p.id === panelId));
}
