// ============================================================
// Панель гильдии: поиск, вступление, выход, склад, состав
// ============================================================
//
// ЧТО БЫЛО. Панель умела ровно три вещи: показать «вы не в гильдии», создать
// гильдию (через два prompt()) и показать состав. Семь маршрутов сервера и
// семь обёрток в api.ts были написаны, подключены и НИ РАЗУ не вызывались:
// /search, /join, /leave, /rank, /deposit-gold, /bank, /kick.
//
// Итог: вступить в чужую гильдию было невозможно. Гильдию можно было только
// создать и посмотреть состав — закрытый клуб, в который никто не может
// попасть. Для игры, где мы зовём людей именно за компанию, это была первая
// дыра, которую видно за пять секунд.

import { api } from './api';
import { t } from './i18n';
import { session } from './state';
import { toast, loadInventory } from './hud';

/**
 * Что можно положить на склад.
 *
 * Список взят из правил экипировки на сервере (CharacterService.SLOT_BY_TYPE):
 * ровно эти типы сервер вообще умеет надевать. Кладутся и снимаются они
 * одинаково, так что ограничение осмысленное — складывать бесполезную мелочь
 * незачем.
 */
const GUILD_BANK_TYPES = new Set(['weapon', 'armor', 'accessory']);

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Ранги от большего к меньшему — тот же порядок, что на сервере. */
const GUILD_RANKS: { value: string; canManage: boolean }[] = [
  { value: 'officer', canManage: false },
  { value: 'veteran', canManage: false },
  { value: 'member', canManage: false },
];

/**
 * Понятная причина вместо кода.
 *
 * Сервер отвечает кодом ошибки ('GOLD_NOT_ENOUGH'), потому что так его можно
 * переводить. Но раньше он отвечал английским текстом, и игрок видел в
 * подсказке «Guild is full» — на русской игре, в интерфейсе без единого
 * английского слова.
 */
const ERRORS: Record<string, string> = {
  GUILD_NOT_IN: 'guild.err_not_in',
  GUILD_NOT_FOUND: 'guild.err_not_found',
  GUILD_FULL: 'guild.err_full',
  GUILD_ALREADY_IN: 'guild.err_already_in',
  GUILD_LEADER_PROTECTED: 'guild.err_leader',
  GUILD_NOT_LEADER: 'guild.err_no_permission',
  GOLD_NOT_ENOUGH: 'guild.err_no_gold',
  GOLD_AMOUNT_INVALID: 'guild.err_bad_amount',
  ITEM_NOT_ENOUGH: 'guild.err_no_item',
  BANK_NOT_ENOUGH: 'guild.err_bank_empty',
  BANK_ROW_NOT_FOUND: 'guild.err_bank_empty',
  NOT_A_MEMBER: 'guild.err_not_in',
  RANK_INVALID: 'guild.err_bad_rank',
  RANK_SELF: 'guild.err_rank_self',
  RANK_TRANSFER_UNSUPPORTED: 'guild.err_rank_transfer',
  MEMBER_NOT_FOUND: 'guild.err_no_member',
  ALREADY_IN_GUILD: 'guild.err_already_in',
  // Навыки. SKILL_UNAVAILABLE отдаётся кодом 409 - это недоработка сервера,
  // а не ошибка игрока, и текст это говорит прямо.
  SKILLS_FORBIDDEN: 'guild.err_skills_forbidden',
  SKILL_UNAVAILABLE: 'guild.err_skill_unavailable',
  SKILL_UNKNOWN: 'guild.err_skill_unknown',
  SKILL_MAXED: 'guild.err_skill_maxed',
  NOT_ENOUGH_GUILD_GOLD: 'guild.err_skill_no_gold',
  // Задания. Четыре разные причины отказа - четыре разные подсказки.
  // Одна надпись «недоступно» на все случаи выглядела бы как поломка.
  MISSION_NO_PERMISSION: 'guild.err_mission_no_permission',
  MISSION_UNKNOWN: 'guild.err_mission_unknown',
  MISSION_NOT_ACTIVE: 'guild.err_mission_not_active',
  MISSION_NOT_DONE: 'guild.err_mission_not_done',
  MISSION_ALREADY_ACTIVE: 'guild.err_mission_already_active',
  MISSION_ALREADY_CLAIMED: 'guild.err_mission_already_claimed',
  MISSION_ON_COOLDOWN: 'guild.err_mission_on_cooldown',
  MISSION_NEEDS_MEMBERS: 'guild.err_mission_needs_members',
  MISSION_CLAIM_FAILED: 'guild.err_mission_claim_failed',
};

/**
 * Почему задание не берётся, на языке интерфейса.
 *
 * Ключ приходит с сервера полем blockedBy. Пустая строка - причин нет.
 * Ранжируется по ключу, а не по состоянию: одно и то же состояние 'open'
 * бывает и доступным, и заблокированным, и рисовать по нему - значит
 * врать игроку.
 */
const MISSION_BLOCKS: Record<string, string> = {
  MISSION_ALREADY_ACTIVE: 'guild.mission_already_active',
  MISSION_ON_COOLDOWN: 'guild.mission_on_cooldown',
  MISSION_NEEDS_MEMBERS: 'guild.mission_needs_members',
};

/**
 * Вид цели на языке интерфейса.
 *
 * Тип цели приходит с сервера строкой, и сервер отдаёт их на трёх языках
 * (kill, collect, dungeon). Новое значение из справочника не должно
 * превращать интерфейс в «kill: 12/100» посреди русского текста, поэтому
 * неизвестный вид показывается словом «цель», а не сырой строкой.
 */
const MISSION_OBJECTIVE_KIND: Record<string, string> = {
  kill: 'guild.mission_obj_kill',
  collect: 'guild.mission_obj_collect',
  dungeon: 'guild.mission_obj_dungeon',
};

/**
 * Идентификатор своего персонажа.
 *
 * Сервер ищет по guild_members.character_id, а не по аккаунту: раньше
 * персонаж не передавался, и панель показывала «вы не в гильдии» игроку,
 * который в гильдии состоял.
 */
function cid(): string {
  return session.character?.id ?? '';
}

function fail(err: unknown): void {
  const raw = (err as Error)?.message ?? '';
  const key = ERRORS[raw];
  toast(key ? t(key) : (raw || t('guild.err_generic')), 'error');
}

/** Текстовое поле в стиле панели. */
function field(placeholder: string, type = 'text'): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  el.placeholder = placeholder;
  el.className = 'guild-field';
  return el;
}

function block(cls = 'guild-block'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

// ── Задания: карточка одного задания ───────────────────────────

/**
 * Одно задание целиком.
 *
 * ЧТО ПРИХОДИТ С СЕРВЕРА И ЧТО НЕ РИСУЕТСЯ. state и blockedBy - решения
 * сервера. Клиент не решает, можно ли взять, потому что сервер всё равно
 * откажет, а игрок увидит причину только после нажатия. Здесь блок
 * рисуется по тому, что сервер сказал, и ни по чему другому.
 *
 * ЗАЧЕМ ЧЕТЫРЕ СОСТОЯНИЯ. 'open' - можно взять, 'active' - взято и не
 * выполнено, 'done' - выполнено, можно забрать, 'claimed' - награда уже
 * получена, задание на откате. Свести их в два («есть / нет») значило бы
 * отнять у игрока самое интересное состояние - «выполнено, забери награду».
 */
function renderMission(задание: {
  id: string; name: string; nameRu: string; description: string;
  objectives: { index: number; type: string; target: string; required: number; progress: number }[];
  rewards: { guildExp: number; gold: number; memberExp: number };
  cooldown: number; minMembers: number; needMembers: number; haveMembers: number;
  state: 'open' | 'active' | 'done' | 'claimed';
  blockedBy: string; availableAt: string | null;
}): HTMLElement {
  const карточка = document.createElement('div');
  const готово = задание.state === 'done';
  // Погашенная карточка - только у уже полученной награды. Активное и
  // готовое задания остаются яркими: это единственное, за чем игрок
  // приходит в панель.
  карточка.className = 'guild-skill'
    + (задание.state === 'claimed' ? ' guild-skill-off' : '')
    + (готово ? ' guild-mission-done' : '');

  const имя = document.createElement('div');
  имя.className = 'guild-skill-name';
  // Названия заданий в справочнике только по-русски и по-английски.
  // Азербайджанцу показывается английский, а не выдуманный перевод.
  имя.textContent = t('lang') === 'ru' ? задание.nameRu : задание.name;
  карточка.append(имя);

  const описание = document.createElement('div');
  описание.className = 'guild-skill-desc';
  описание.textContent = задание.description;
  карточка.append(описание);

  for (const цель of задание.objectives) {
    const строка = document.createElement('div');
    строка.className = 'guild-mission-obj';
    const сколько = Math.min(цель.progress, цель.required);
    строка.textContent = `${t(MISSION_OBJECTIVE_KIND[цель.type] ?? 'guild.mission_obj_other')}: `
      + `${сколько}/${цель.required}`;
    // Выполненная цель помечается отдельно: по одному числу «100/100» не
    // всегда видно, это конец или середина пути.
    if (сколько >= цель.required) строка.className += ' guild-mission-obj-done';
    карточка.append(строка);
  }

  const награда = document.createElement('div');
  награда.className = 'guild-skill-level';
  награда.textContent = t('guild.mission_rewards') + ': '
    + `${задание.rewards.gold.toLocaleString()} ${t('guild.mission_gold')}, `
    + `${задание.rewards.guildExp.toLocaleString()} ${t('guild.mission_guild_exp')}, `
    + `${задание.rewards.memberExp.toLocaleString()} ${t('guild.mission_member_exp')}`;
  карточка.append(награда);

  if (задание.state === 'claimed') {
    const отметка = document.createElement('div');
    отметка.className = 'guild-skills-hint';
    отметка.textContent = t('guild.mission_claimed');
    карточка.append(отметка);
    return карточка;
  }

  if (задание.state === 'done') {
    const забрать = document.createElement('button');
    забрать.type = 'button';
    забрать.className = 'guild-btn';
    забрать.textContent = t('guild.mission_claim');
    забрать.addEventListener('click', async () => {
      забрать.disabled = true;
      try {
        const итог = await api.guildMissionClaim(cid(), задание.id);
        const п = итог?.rewards;
        toast(п
          ? `${t('guild.mission_claimed_toast')} +${п.gold.toLocaleString()} ${t('guild.mission_gold')}`
          : t('guild.mission_claimed_toast'), 'success');
        await loadGuild();
      } catch (err) {
        fail(err);
        забрать.disabled = false;
      }
    });
    карточка.append(забрать);
    return карточка;
  }

  // Причина блокировки показывается ВМЕСТО кнопки. Кнопка «взять» с
  // подсказкой при наведении выглядела бы как «сейчас не выйдет», а на
  // телефоне подсказку никто не увидит.
  const причина = MISSION_BLOCKS[задание.blockedBy];
  if (причина) {
    const подсказка = document.createElement('div');
    подсказка.className = 'guild-skills-hint';
    подсказка.textContent = t(причина);
    // Сколько именно не хватает - иначе игрок не знает, кого звать.
    if (задание.blockedBy === 'MISSION_NEEDS_MEMBERS') {
      подсказка.textContent += ` (${задание.haveMembers}/${задание.needMembers})`;
    }
    карточка.append(подсказка);
    return карточка;
  }

  const взять = document.createElement('button');
  взять.type = 'button';
  взять.className = 'guild-btn';
  взять.textContent = t('guild.mission_start');
  взять.addEventListener('click', async () => {
    взять.disabled = true;
    try {
      await api.guildMissionStart(cid(), задание.id);
      toast(t('guild.mission_started'), 'success');
      await loadGuild();
    } catch (err) {
      fail(err);
      взять.disabled = false;
    }
  });
  карточка.append(взять);
  return карточка;
}

// ── Нет гильдии: поиск и вступление ────────────────────────────

function renderNoGuild(box: HTMLElement): void {
  const empty = document.createElement('div');
  empty.className = 'lb-empty';
  empty.textContent = t('guild.none');
  box.append(empty);

  const searchBlock = block();
  const query = field(t('guild.search_ph'));
  const findBtn = document.createElement('button');
  findBtn.type = 'button';
  findBtn.className = 'guild-btn';
  findBtn.textContent = t('guild.search');
  const list = block('guild-list');
  searchBlock.append(query, findBtn, list);

  const find = async (): Promise<void> => {
    findBtn.disabled = true;
    try {
      const res = await api.guildSearch(query.value.trim());
      renderGuildList(list, res.guilds ?? []);
    } catch (err) {
      fail(err);
    } finally {
      findBtn.disabled = false;
    }
  };
  findBtn.addEventListener('click', () => { void find(); });
  query.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void find(); });
  box.append(searchBlock);

  // Создание — отдельным блоком и без prompt(): два системных окна подряд
  // раздражают, а вводить имя в них неудобно
  const createBlock = block('guild-block');
  const name = field(t('guild.create_name'));
  const tag = field(t('guild.create_tag'));
  const desc = field(t('guild.create_desc'));
  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'guild-btn';
  createBtn.textContent = t('guild.create');
  createBtn.addEventListener('click', async () => {
    if (!name.value.trim() || !tag.value.trim()) { toast(t('guild.err_need_name'), 'error'); return; }
    createBtn.disabled = true;
    try {
      await api.guildCreate(cid(), name.value.trim(), tag.value.trim(), desc.value.trim());
      toast(t('guild.created'), 'success');
      await loadGuild();
    } catch (err) {
      fail(err);
    } finally {
      createBtn.disabled = false;
    }
  });
  createBlock.append(name, tag, desc, createBtn);
  box.append(createBlock);
}

/** Список найденных гильдий с кнопкой вступления. */
function renderGuildList(list: HTMLElement, guilds: { id: string; name: string; tag: string; level: number; description: string }[]): void {
  list.innerHTML = '';
  if (!guilds.length) {
    const none = document.createElement('div');
    none.className = 'lb-empty';
    none.textContent = t('guild.not_found');
    list.append(none);
    return;
  }
  for (const g of guilds) {
    const row = document.createElement('div');
    row.className = 'guild-row';

    const title = document.createElement('div');
    title.className = 'guild-row-title';
    title.textContent = `${g.name} [${g.tag}] · ${t('guild.level')} ${g.level}`;

    const desc = document.createElement('div');
    desc.className = 'guild-row-desc';
    desc.textContent = g.description || '';

    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'guild-btn';
    join.textContent = t('guild.join');
    join.addEventListener('click', async () => {
      join.disabled = true;
      try {
        await api.guildJoin(cid(), g.id);
        toast(t('guild.joined'), 'success');
        await loadGuild();
      } catch (err) {
        fail(err);
        join.disabled = false;
      }
    });

    row.append(title, desc, join);
    list.append(row);
  }
}

// ── Есть гильдия: состав, склад, выход ─────────────────────────

async function renderInGuild(box: HTMLElement, guild: { id: string; name: string; tag: string; level: number; gold: number }, myRank: string): Promise<void> {
  const canManage = myRank === 'leader' || myRank === 'officer';
  const me = session.character?.id ?? '';

  const head = block('guild-block');
  const title = document.createElement('div');
  title.className = 'guild-head';
  title.textContent = `${guild.name} [${guild.tag}]`;
  const info = document.createElement('div');
  info.className = 'guild-info';
  info.textContent = `${t('guild.level')} ${guild.level} · ${t('guild.your_rank')}: ${t(`guild.rank_${myRank}`)} · ${t('guild.gold')} ${guild.gold}`;
  head.append(title, info);
  box.append(head);

  // ── Состав ───────────────────────────────────────────────
  const membersBlock = block('guild-block');
  const membersTitle = document.createElement('div');
  membersTitle.className = 'guild-sub';
  membersTitle.textContent = t('guild.members');
  membersBlock.append(membersTitle);

  try {
    const { members } = await api.guildMembers(cid());
    const list = block('guild-list');
    for (const m of members ?? []) {
      const row = document.createElement('div');
      row.className = 'guild-row';

      const name = document.createElement('div');
      name.className = 'guild-row-title';
      // Онлайн теперь честный: раньше в SQL стояло FALSE as online, и весь
      // состав показывался офлайн, даже те, кто играет прямо сейчас
      name.textContent = m.online ? '🟢' : '⚪';
      const label = document.createElement('span');
      label.textContent = ` ${m.character_name}`;
      name.append(label);

      const meta = document.createElement('div');
      meta.className = 'guild-row-desc';
      meta.textContent = `${t(`guild.rank_${m.rank}`)} · ${t('guild.level')} ${m.level} · ${t('guild.contribution')} ${m.contribution_points}`;

      row.append(name, meta);

      // Управление доступно только главе и офицеру, и только над теми, кого
      // можно трогать: себя не назначают рангом, главного не трогают
      const isSelf = m.character_id === me;
      if (canManage && !isSelf && m.rank !== 'leader') {
        const select = document.createElement('select');
        select.className = 'guild-field';
        for (const r of GUILD_RANKS) {
          const opt = document.createElement('option');
          opt.value = r.value;
          opt.textContent = t(`guild.rank_${r.value}`);
          if (r.value === m.rank) opt.selected = true;
          select.append(opt);
        }
        select.addEventListener('change', async () => {
          select.disabled = true;
          try {
            await api.guildRank(cid(), m.character_id, select.value);
            toast(t('guild.rank_set'), 'success');
            await loadGuild();
          } catch (err) {
            fail(err);
            select.disabled = false;
          }
        });

        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'guild-btn guild-btn-danger';
        kick.textContent = t('guild.kick');
        kick.addEventListener('click', async () => {
          if (!confirm(t('guild.kick_confirm'))) return;
          kick.disabled = true;
          try {
            await api.guildKick(cid(), m.character_id);
            toast(t('guild.kicked'), 'success');
            await loadGuild();
          } catch (err) {
            fail(err);
            kick.disabled = false;
          }
        });

        const actions = document.createElement('div');
        actions.className = 'guild-actions';
        actions.append(select, kick);
        row.append(actions);
      }
      list.append(row);
    }
    membersBlock.append(list);
  } catch (err) {
    fail(err);
  }
  box.append(membersBlock);

  // ── Склад ────────────────────────────────────────────────
  const bankBlock = block('guild-block');
  const bankTitle = document.createElement('div');
  bankTitle.className = 'guild-sub';
  bankTitle.textContent = t('guild.bank');
  bankBlock.append(bankTitle);

  try {
    const { items } = await api.guildBank(cid());
    const list = block('guild-list');
    if (!items?.length) {
      const none = document.createElement('div');
      none.className = 'lb-empty';
      none.textContent = t('guild.bank_empty');
      list.append(none);
    } else {
      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'guild-row';
        const n = document.createElement('div');
        n.className = 'guild-row-title';
        // Раньше здесь был it.item_id — игрок видел «mat_dragon_scale»
        // вместо названия предмета. Сервер теперь отдаёт nameRu
        n.textContent = it.name_ru ?? it.nameRu ?? it.item_id;
        const q = document.createElement('div');
        q.className = 'guild-row-desc';
        q.textContent = `×${it.quantity}`;
        // Забрать можно: склад без выдачи был бы ловушкой — положил и потерял
        const take = document.createElement('button');
        take.type = 'button';
        take.className = 'guild-btn';
        take.textContent = t('guild.withdraw');
        take.addEventListener('click', async () => {
          take.disabled = true;
          try {
            await api.guildWithdrawItem(cid(), it.id, 1);
            toast(t('guild.withdrawn'), 'success');
            await loadGuild();
            void loadInventory();
          } catch (err) { fail(err); take.disabled = false; }
        });
        row.append(n, q, take);
        list.append(row);
      }
    }
    bankBlock.append(list);
  } catch (err) {
    fail(err);
  }

  // ── Вклад предметов ──────────────────────────────────────
  // Раньше этой кнопки не было: GuildService.depositItem был единственным
  // писателем в таблицу guild_bank и не вызывался нигде, так что склад
  // не мог наполниться ничем, кроме золота.
  try {
    const { items: inv } = await api.inventory(cid());
    const usable = (inv ?? []).filter((i: { type: string }) => GUILD_BANK_TYPES.has(i.type));
    const pick = document.createElement('select');
    pick.className = 'guild-field';
    if (!usable.length) {
      const none = document.createElement('div');
      none.className = 'lb-empty';
      none.textContent = t('guild.bank_nothing_to_deposit');
      bankBlock.append(none);
    } else {
      for (const i of usable) {
        const opt = document.createElement('option');
        opt.value = i.itemId;
        opt.textContent = `${i.enhancement > 0 ? `${i.nameRu} +${i.enhancement}` : i.nameRu} ×${i.quantity}`;
        pick.append(opt);
      }
      const put = document.createElement('button');
      put.type = 'button';
      put.className = 'guild-btn';
      put.textContent = t('guild.deposit_item');
      put.addEventListener('click', async () => {
        put.disabled = true;
        try {
          await api.guildDepositItem(cid(), pick.value, 1);
          toast(t('guild.item_deposited'), 'success');
          await loadGuild();
          void loadInventory();
        } catch (err) { fail(err); put.disabled = false; }
      });
      bankBlock.append(pick, put);
    }
  } catch (err) {
    fail(err);
  }

  // Списание золота раньше не происходило вовсе: depositGold только
  // ПРИБАВЛЯЛ золото к золоту гильдии, не вычитая его у игрока. Теперь
  // золото действительно списывается, поэтому поле ввода и смысл имеют.
  const amount = field(t('guild.deposit_ph'), 'number');
  const deposit = document.createElement('button');
  deposit.type = 'button';
  deposit.className = 'guild-btn';
  deposit.textContent = t('guild.deposit');
  deposit.addEventListener('click', async () => {
    const value = Number(amount.value);
    if (!value || value <= 0) { toast(t('guild.err_bad_amount'), 'error'); return; }
    deposit.disabled = true;
    try {
      await api.guildDepositGold(cid(), value);
      toast(t('guild.deposited'), 'success');
      await loadGuild();
    } catch (err) {
      fail(err);
      deposit.disabled = false;
    }
  });
  bankBlock.append(amount, deposit);
  box.append(bankBlock);

  // ── Навыки гильдии ─────────────────────────────────────────
  // Панели навыков не было вовсе, хотя сервер их считал и покупка была
  // доступна по маршруту: игрок не мог нажать кнопку, потому что кнопки
  // не существовало. Навыки были функцией без входа.
  //
  // Кнопка рисуется ТОЛЬКО там, где сервер разрешил. Поле available - это
  // та же isSkillWired, которую проверяет upgradeSkill. Если бы клиент
  // показывал кнопку для навыка без точки применения, игрок увидел бы цену
  // и получил бы отказ: цена показана, а купить нельзя.
  const skillsBlock = block('guild-block guild-skills');
  const skillsTitle = document.createElement('h3');
  skillsTitle.className = 'guild-h';
  skillsTitle.textContent = t('guild.skills_title');
  skillsBlock.append(skillsTitle);

  try {
    const данные = await api.guildSkills(cid());
    const казна = document.createElement('div');
    казна.className = 'guild-skills-gold';
    казна.textContent = t('guild.skills_gold') + ': ' + данные.gold.toLocaleString();
    skillsBlock.append(казна);

    if (!данные.canManage) {
      const подсказка = document.createElement('div');
      подсказка.className = 'guild-skills-hint';
      подсказка.textContent = t('guild.skills_no_right');
      skillsBlock.append(подсказка);
    }

    for (const навык of данные.skills) {
      const строка = document.createElement('div');
      строка.className = 'guild-skill' + (навык.available ? '' : ' guild-skill-off');

      const имя = document.createElement('div');
      имя.className = 'guild-skill-name';
      // Русское название на русском сервере, английское - на остальных.
      // Данные навыков описаны только по-русски, и выдумывать перевод
      // хуже, чем показать русский текст азербайджанцу.
      имя.textContent = t('lang') === 'ru' ? навык.nameRu : навык.name;
      строка.append(имя);

      const описание = document.createElement('div');
      описание.className = 'guild-skill-desc';
      описание.textContent = навык.description;
      строка.append(описание);

      const уровень = document.createElement('div');
      уровень.className = 'guild-skill-level';
      уровень.textContent = навык.maxed
        ? t('guild.skill_max')
        : t('guild.skill_level') + ' ' + навык.level + '/' + навык.maxLevel;
      строка.append(уровень);

      if (!навык.available) {
        // Навык без точки применения. Показываем честно, что его нельзя
        // купить, вместо пустого места: молчание выглядело бы как забытый
        // пункт, а не как сознательное решение.
        const недоступен = document.createElement('div');
        недоступен.className = 'guild-skill-hint';
        недоступен.textContent = t('guild.skill_unavailable');
        строка.append(недоступен);
      } else if (!навык.maxed) {
        const кнопка = document.createElement('button');
        кнопка.type = 'button';
        кнопка.className = 'guild-btn';
        const хватает = данные.gold >= навык.costNext;
        кнопка.textContent = t('guild.skill_buy') + ' — ' + навык.costNext.toLocaleString();
        // Кнопка гасится по трём причинам сразу, и каждая показывает
        // игроку СВОЮ подсказку при наведении: нет права, не хватает золота
        // или уже максимум. Одно серое «нельзя» ни о чём не говорит.
        кнопка.disabled = !данные.canManage || !хватает;
        кнопка.title = !данные.canManage ? t('guild.skills_no_right')
          : (хватает ? '' : t('guild.skill_no_gold'));
        кнопка.addEventListener('click', async () => {
          кнопка.disabled = true;
          try {
            const итог = await api.guildSkillUpgrade(cid(), навык.id, 1);
            toast(t('guild.skill_bought') + ' ' + итог.level, 'success');
            await loadGuild();
          } catch (err) {
            fail(err);
            кнопка.disabled = false;
          }
        });
        строка.append(кнопка);
      }
      skillsBlock.append(строка);
    }
  } catch (err) {
    // Панель навыков не появилась - и это не повод молчать. Но и повод
    // ронять всю панель гильдии тоже нет: склад и состав важнее.
    const сбой = document.createElement('div');
    сбой.className = 'guild-skills-hint';
    сбой.textContent = t('guild.skills_load_failed');
    skillsBlock.append(сбой);
    // Ошибка уходит в консоль, а не в интерфейс: игроку «навыки не
    // загрузились» ничего не объясняет, разработчику нужна причина.
    console.warn('[Guild] навыки не загрузились:', err);
  }
  box.append(skillsBlock);

  // ── Задания ───────────────────────────────────────────────
  // Отдельный блок, а не часть навыков: у заданий другой срок (откат в
  // часах), другое право (глава или офицер) и другое состояние. Смешанное
  // в одном списке выглядело бы так, будто это одно и то же.
  const missionsBlock = block('guild-block guild-missions');
  const missionsTitle = document.createElement('h3');
  missionsTitle.className = 'guild-h';
  missionsTitle.textContent = t('guild.missions_title');
  missionsBlock.append(missionsTitle);

  try {
    const данные = await api.guildMissions(cid());
    if (данные.missions.length === 0) {
      const пусто = document.createElement('div');
      пусто.className = 'guild-skills-hint';
      пусто.textContent = t('guild.missions_none');
      missionsBlock.append(пусто);
    }

    for (const задание of данные.missions) {
      missionsBlock.append(renderMission(задание));
    }
  } catch (err) {
    // Панель заданий не появилась - и об этом сказано прямо. Молчание
    // выглядело бы как «заданий нет», а это другое и более опасное
    // сообщение: игрок решил бы, что гильдия ничего не может делать.
    const сбой = document.createElement('div');
    сбой.className = 'guild-skills-hint';
    сбой.textContent = t('guild.missions_load_failed');
    missionsBlock.append(сбой);
    console.warn('[Guild] задания не загрузились:', err);
  }
  box.append(missionsBlock);

  // ── Выход ────────────────────────────────────────────────
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'guild-btn guild-btn-danger guild-leave';
  leave.textContent = t('guild.leave');
  leave.addEventListener('click', async () => {
    if (!confirm(t('guild.leave_confirm'))) return;
    leave.disabled = true;
    try {
      await api.guildLeave(cid());
      toast(t('guild.left'), 'success');
      await loadGuild();
    } catch (err) {
      fail(err);
      leave.disabled = false;
    }
  });
  box.append(leave);
}

// ── Точка входа ────────────────────────────────────────────────

export async function loadGuild(): Promise<void> {
  const box = $('panel-guild');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.guildMy(cid());
    if (!data?.guild) {
      renderNoGuild(box);
      return;
    }
    await renderInGuild(box, data.guild, data.rank ?? 'member');
  } catch (err) {
    fail(err);
  }
}
