// Три места, где игрок видел не то, что написано в данных.
//
// ЧТО ЗДЕСЬ ОБЩЕЕ. Все три находки — это не «функция не дописана», а обрыв на
// последнем шаге: путь существует и работает, а последнее звено в цепочке
// забыто. Именно такие хуже всего выглядят при чтении кода: кажется, что
// работает.
//
// 1. `skill_no_effect` сервер шлёт через socket, клиент ищет ключ
//    `world.combat_error_skill_no_effect`, а ключа нет ни в одном языке.
//    `t()` при промахе возвращает сам путь, поэтому игрок видел строку
//    «world.combat_error_skill_no_effect» вместо объяснения.
// 2. Таблица PvP в панели лидерборда была зашита строкой 'PvP', когда три
//    соседних таба переведены, а ключ `panels.lb_pvp` во всех трёх языках
//    лежал неиспользованным.
// 3. Ранг гильдии `recruit` есть в типе `GuildRank` и в данных `GUILD_RANKS`,
//    но ключа `guild.rank_recruit` не было ни в одном языке, а клиент рисует
//    `t(\`guild.rank_${m.rank}\`)` без проверки существования ключа.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const панель = код('client/src/app/panels.ts');
const гильдия = код('client/src/app/guild.ts');
const сокет = код('server/src/socket/GameSocketHandler.ts');
const ошибки = код('shared/combatErrors.ts');
const ранги = код('server/src/data/guilds.ts');

function словарь(кодЯзыка: string): Record<string, unknown> {
  return JSON.parse(читать(`shared/locales/${кодЯзыка}.json`));
}

const ЯЗЫКИ = ['ru', 'en', 'az'] as const;

describe('skill_no_effect: сервер шлёт, а перевода не было', () => {
  it('код действительно уходит на клиент', () => {
    // Без этого проверка была бы страховкой от воображаемой проблемы:
    // если код не отправляется, ключ перевода не нужен.
    must(
      /emit\(SOCKET_EVENTS\.COMBAT_ERROR, \{ code: 'skill_no_effect' \}\)/.test(сокет),
      'сервер не шлёт skill_no_effect — тогда правка перевода лишняя',
    );
  });

  it('клиент ищет ровно этот ключ', () => {
    must(
      /skill_no_effect: 'world\.combat_error_skill_no_effect'/.test(ошибки),
      'клиент ждёт другой ключ, и править надо не тот',
    );
  });

  it('ключ есть во всех трёх языках', () => {
    for (const кодЯзыка of ЯЗЫКИ) {
      const мир = словарь(кодЯзыка) as { world: Record<string, string> };
      const текст = мир.world?.combat_error_skill_no_effect;
      must(
        typeof текст === 'string' && текст.length > 0,
        `в ${кодЯзыка}.json нет world.combat_error_skill_no_effect — игрок увидит путь ключа`,
      );
    }
  });
});

describe('Таблица PvP в лидерборде', () => {
  it('подпись берётся из перевода, а не из строки', () => {
    // Соседние табы переведены, этот был зашит: в азербайджанской версии
    // таблица оставалась наполовину чужой при трёх переведённых соседях.
    must(
      /\{ id: 'pvp', label: t\('panels\.lb_pvp'\) \}/.test(панель),
      "таб PvP снова подписан строкой: ключ panels.lb_pvp есть, но не используется",
    );
    must(
      !/label: 'PvP'/.test(панель),
      "в панели осталась зашитая подпись 'PvP'",
    );
  });

  it('ключ при этом существует во всех трёх языках', () => {
    for (const кодЯзыка of ЯЗЫКИ) {
      const п = словарь(кодЯзыка) as { panels: Record<string, string> };
      must(п.panels?.lb_pvp, `в ${кодЯзыка}.json нет panels.lb_pvp`);
    }
  });
});

describe('Ранг гильдии recruit', () => {
  it('ранг настоящий, а не выдуманный переводом', () => {
    must(/'recruit'/.test(ранги), 'ранга recruit больше нет в данных — ключ лишний');
  });

  it('подпись ранга есть во всех трёх языках', () => {
    for (const кодЯзыка of ЯЗЫКИ) {
      const г = словарь(кодЯзыка) as { guild: Record<string, string> };
      must(
        typeof г.guild?.rank_recruit === 'string' && г.guild.rank_recruit.length > 0,
        `в ${кодЯзыка}.json нет guild.rank_recruit, а клиент рисует t(\`guild.rank_\${m.rank}\`) без проверки`,
      );
    }
  });

  it('все ранги типа GuildRank переведены', () => {
    // Обобщение последней проверки: добавление ранга без ключа проходит
    // молча, пока кто-то не покажет гильдию с этим рангом.
    const тип = /export type GuildRank = ([^;]+);/.exec(ранги)?.[1] ?? '';
    const список = [...тип.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    must(список.length >= 5, `рангов в типе ${список.length}: список не разобран`);
    for (const кодЯзыка of ЯЗЫКИ) {
      const г = словарь(кодЯзыка) as { guild: Record<string, string> };
      for (const ранг of список) {
        must(
          г.guild?.[`rank_${ранг}`],
          `в ${кодЯзыка}.json нет guild.rank_${ранг}: ранг есть в типе, а подписи нет`,
        );
      }
    }
  });

  it('клиент подставляет ранг без проверки ключа', () => {
    // Это и есть причина, по которой пропуск ключа опасен: заглушки нет,
    // игрок увидел бы строку `guild.rank_recruit`.
    must(
      /t\(`guild\.rank_\$\{m\.rank\}`\)/.test(гильдия),
      'подпись ранга члена гильдии перестала подставляться динамически: проверка выше стала страховкой от пустого места',
    );
  });
});