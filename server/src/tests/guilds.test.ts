// Гильдии: нельзя было ни вступить, ни выйти, ни положить золото.
//
// ЧТО БЫЛО. В api.ts лежали семь методов — search, join, leave, rank,
// deposit-gold, bank, kick — и все семь маршрутов на сервере тоже были
// написаны. Ни один из них не вызывался из интерфейса. Панель умела три
// вещи: сказать «вы не в гильдии», создать гильдию через два prompt() и
// показать состав. Итог: г��льдию можно было только создать, вступить в
// чужую было нельзя.
//
// ПОПUTNO К СЕРВЕРУ, потому что кнопки открыли наружу то, что было сломано:
//
// 1. depositGold ТОЛЬКО ПРИБАВЛЯЛА золото к золоту гильдии, не вычитая его
//    у игрока. Любой мог положить в котёл сколько угодно золота из воздуха.
//    Та же поломка с предметами: depositItem клала предмет на склад, не
//    забирая его из инвентаря.
//
// 2. removeMember был голым DELETE. Маршрут /kick смотрел, КТО просит, но
//    не КОГО: офицер мог исключить главного, а главу офицер мог разжаловать.
//    В обоих случаях в guilds.leader_id оставался UUID человека, который уже
//    не в гильдии, — и управлять ею было некому.
//
// 3. Уход главы делал то же самое: назначить нового было некому и нечем.
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const guildPanel = stripComments(read('client/src/app/guild.ts'));
const panels = stripComments(read('client/src/app/panels.ts'));
const service = stripComments(read('server/src/services/GuildService.ts'));
const routes = stripComments(read('server/src/routes/guilds.ts'));
const css = stripComments(read('client/src/app/styles.css'));
const locales = ['ru', 'en', 'az'].map(l => ({ l, raw: read(`shared/locales/${l}.json`) }));

describe('В гильдию можно вступить', () => {
  it('поиск и вступление выведены в интерфейс', () => {
    // ГЛАВНОЕ. Методы были написаны и не вызваны ни разу
    for (const call of ['api.guildSearch', 'api.guildJoin', 'api.guildLeave',
                        'api.guildRank', 'api.guildKick', 'api.guildBank', 'api.guildDepositGold']) {
      expect({ call, есть: guildPanel.includes(call) }).toEqual({ call, есть: true });
    }
  });

  it('панель вынесена в отдельный модуль, а не в общий список панелей', () => {
    // Списком из 25 панелей такую полноценную панель не написать: она
    // разрослась и начала мешать остальным
    expect(panels).toMatch(/import \{ loadGuild \} from '\.\/guild'/);
    expect(panels).not.toMatch(/async function loadGuild/);
  });

  it('создание гильдии без системных окон', () => {
    // Два prompt() подряд раздражают, а вводить в них имя неудобно
    expect(guildPanel).not.toMatch(/prompt\(/);
    expect(guildPanel).toMatch(/t\('guild\.create_name'\)/);
  });

  it('поиск срабатывает по Enter, а не только по кнопке', () => {
    expect(guildPanel).toMatch(/key === 'Enter'/);
  });
});

describe('Гильдию можно покинуть и вести ею', () => {
  it('кнопка выхода есть и спрашивает подтверждение', () => {
    expect(guildPanel).toMatch(/api\.guildLeave/);
    expect(guildPanel).toMatch(/t\('guild\.leave_confirm'\)/);
  });

  it('главного нельзя исключить', () => {
    // Иначе гильдия остаётся сиротой навсегда
    expect(service).toMatch(/if \(guild\.leader_id === charId\) throw new Error\('GUILD_LEADER_PROTECTED'\)/);
  });

  it('уход главы передаёт главенство следующему', () => {
    expect(service).toMatch(/async leaveGuild/);
    expect(service).toMatch(/if \(wasLeader\) await this\.promoteSuccessor/);
    expect(service).toMatch(/async promoteSuccessor/);
  });

  it('главенство достаётся самому старшему, а не случайному', () => {
    expect(service).toMatch(/officer' THEN 0 WHEN 'veteran' THEN 1/);
    expect(service).toMatch(/contribution_points DESC/);
  });

  it('главу нельзя разжаловать и нельзя выдать себе ранг', () => {
    // Через /rank можно было сделать себя главным офицером
    expect(service).toMatch(/if \(actorId === charId\) throw new Error\('RANK_SELF'\)/);
    expect(service).toMatch(/GUILD_LEADER_PROTECTED/);
  });

  it('ранг сверяется со списком, а не пишется как придёт', () => {
    expect(service).toMatch(/GUILD_RANKS\.includes\(rank\)/);
  });

  it('смена ранга различает, кто просит и кого меняют', () => {
    // Раньше в сервис передавались только двое, и «офицер назначил себя
    // главным» было неотличимо от «назначил офицером»
    expect(service).toMatch(/setRank\(guildId: string, actorId: string, charId: string, rank: string\)/);
    expect(routes).toMatch(/setRank\(data\.guild\.id, req\.userId, req\.body\.characterId, req\.body\.rank\)/);
  });

  it('кто-то проверяет, что участник вообще есть', () => {
    // Без RETURNING тихо проходили оба случая: и «ранг назначен», и «такого
    // участника нет» — игрок думал, что назначил, а ничего не изменилось
    expect(service).toMatch(/RETURNING character_id/);
  });

  it('управление составом скрыто от обычных участников', () => {
    expect(guildPanel).toMatch(/const canManage = myRank === 'leader' \|\| myRank === 'officer'/);
    expect(guildPanel).toMatch(/!isSelf && m\.rank !== 'leader'/);
  });
});

describe('Склад гильдии берёт, а не печатает', () => {
  it('золото списывается у игрока', () => {
    // ГЛАВНОЕ. Золото только ПРИБАВЛЯЛОСЬ к котлу гильдии: можно было
    // положить сколько угодно золота из воздуха и поднять валюту гильдии
    expect(service).toMatch(/UPDATE characters SET gold = gold - \$1 WHERE id = \$2 AND gold >= \$1/);
  });

  it('предмет забирается из инвентаря', () => {
    // Та же поломка: предмет клался на склад, а из сумки не исчезал
    expect(service).toMatch(/UPDATE character_items SET quantity = quantity - \$1/);
    expect(service).toMatch(/if \(took\.rowCount === 0\) throw new Error\('ITEM_NOT_ENOUGH'\)/);
  });

  it('обе операции в одной транзакции', () => {
    // Иначе есть окно «золото забрали, а в котёл не положили»
    expect(service).toMatch(/async depositGold[\s\S]{0,400}this\.db\.transaction/);
    expect(service).toMatch(/async depositItem[\s\S]{0,400}this\.db\.transaction/);
  });

  it('вклад идёт в той же транзакции, что и списание', () => {
    // Иначе игрок теряет золото без вклада в развитие гильдии
    expect(service).toMatch(/contribution_points = contribution_points \+ \$1/);
  });

  it('списание золота идёт раньше пополнения котла', () => {
    const i = service.indexOf('async depositGold');
    const body = service.slice(i, service.indexOf('async depositItem', i));
    expect(body.indexOf('gold = gold -')).toBeLessThan(body.indexOf('gold = gold +'));
  });

  it('маршрут выхода зовёт leaveGuild, а не removeMember', () => {
    expect(routes).toMatch(/await guilds\.leaveGuild\(data\.guild\.id, req\.userId\)/);
  });
});

describe('Ошибки понятны игроку', () => {
  it('коды сервера переводятся', () => {
    // Сервер отвечает кодом, игрок должен увидеть причину на своём языке
    expect(guildPanel).toMatch(/const ERRORS: Record<string, string>/);
    for (const key of ['GOLD_NOT_ENOUGH', 'GUILD_FULL', 'GUILD_LEADER_PROTECTED', 'GUILD_ALREADY_IN']) {
      expect(guildPanel).toContain(key);
    }
  });

  it('английского текста в ошибках не осталось', () => {
    // Раньше сервер отвечал 'Guild is full', и игрок видел это в подсказке
    expect(guildPanel).not.toMatch(/Guild is full/);
    expect(guildPanel).not.toMatch(/No permission/);
  });
});

describe('Панель гильдии оформлена и переведена', () => {
  it('стили для панели есть', () => {
    for (const sel of ['.guild-block', '.guild-row', '.guild-btn', '.guild-field', '.guild-list']) {
      expect({ sel, есть: css.includes(sel + ' {') || css.includes(sel + ',') }).toEqual({ sel, есть: true });
    }
  });

  it('опасная кнопка выхода отличается от обычных', () => {
    // Выход из гильдии и исключение игрока необратимы — их нельзя спутать
    expect(css).toMatch(/\.guild-btn-danger/);
  });

  it('все ключи панели есть во всех трёх языках', () => {
    const keys = ['none', 'join', 'joined', 'leave', 'left', 'leave_confirm', 'kick', 'kick_confirm',
                  'bank', 'bank_empty', 'deposit', 'deposit_ph', 'deposited', 'members', 'contribution',
                  'rank_leader', 'rank_officer', 'rank_veteran', 'rank_member', 'created', 'search'];
    for (const { l, raw } of locales) {
      for (const k of keys) {
        expect({ l, k, есть: raw.includes(`"${k}"`) }).toEqual({ l, k, есть: true });
      }
    }
  });

  it('тексты панели берутся из переводов, а не зашиты в код', () => {
    expect(guildPanel).not.toMatch(/Вступить/);
    expect(guildPanel).not.toMatch(/Покинуть гильдию/);
  });
});
