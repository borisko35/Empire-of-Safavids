// Храм Симурга: последнее звено — вход.
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Не «в коде есть путь в храм», а то, что храм входит
// в игру ТОЙ ЖЕ машиной, что и цитадель, без единой строки Special case.
// Цитадель построила механику (рейды партией, панель, отсчёт, ми designer), и
// второй рейд должен достаться даром. Если для храма понадобилась бы отдельная
// ветка — значит машина не машина, а один костыль под первый данж.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const данные = читать('server/src/data/dungeons.ts');
const партии = код('server/src/systems/PartySystem.ts');
const маршруты = код('server/src/routes/game.ts');
const панель = код('client/src/app/panels.ts');
const сервисДанжей = код('server/src/systems/DungeonService.ts');

describe('Храм: входится той же машиной, что и цитадель', () => {
  it('рейд-машина смотрит на isRaid, а не на имя данжа', () => {
    // Если бы вместо флага стояло сравнение с id цитадели, храм не вошёл бы.
    must(
      /if \(!def\?\.isRaid\) return \{ ok: false, code: 'raid_not_raid_dungeon' \};/.test(партии),
      'createRaid больше не смотрит на isRaid: второй рейд требует отдельной ветки',
    );
    must(!/baghdad|citadel/i.test(партии), 'в PartySystem появилось имя цитадели: машина стала костылём');
  });

  it('список рейдов тоже общий', () => {
    must(
      /async listOpenRaids\(dungeonId: string\)[\s\S]{0,160}if \(!def\?\.isRaid\) return \[\];/.test(партии),
      'список рейдов зашит под конкретный данж',
    );
  });

  it('маршруты рейда не знают имён данжей', () => {
    // Маршрут берёт dungeonId из пути. Сравнение с конкретным значением
    // сделало бы второй рейд недостижимым.
    must(!/baghdad|simurgh/i.test(маршруты), 'в маршрутах появилось имя данжа: они стали одноразовыми');
  });

  it('панель рисует рейд для любого рейд-подземелья', () => {
    must(/d\.isRaid && !status\.active/.test(панель), 'панель больше не различает рейд по флагу');
    must(!/baghdad|simurgh/i.test(панель), 'в панели появилось имя данжа');
  });
});

describe('Храм: подходит под требования машины', () => {
  it('помечен рейдом', () => {
    must(/'dungeon_simurgh_temple'[\s\S]{0,900}?isRaid: true/.test(данные), 'храм не рейд — машина его не возьмёт');
  });

  it('минимальный состав не превышает максonмальный', () => {
    // Иначе рейд было бы не открыть: enter требует... нет, но проверка
    // minPlayers остаётся смыслом. 10 из 20 — как у цитадели.
    must(/'dungeon_simurgh_temple'[\s\S]{0,900}?minPlayers: 10/.test(данные), 'minPages храма не 10');
    must(/'dungeon_simurgh_temple'[\s\S]{0,900}?maxPlayers: 20/.test(данные), 'maxPages храма не 20');
  });

  it('финальный босс в боссовой комнате', () => {
    // Храм последний в файле, поэтому режем по его id и ближайшему закрытию.
    const начало = данные.indexOf("'dungeon_simurgh_temple': {");
    must(начало > 0, 'храм не найден');
    const храм = данные.slice(начало);
    must(/isBossRoom: true/.test(храм), 'в храме нет боссовой комнаты');
    must(/bossId: 'world_boss_simurgh'/.test(храм), 'финальный босс не Симург');
  });

  it('вход в заход проверяет уровень и регион — они у храма заданы', () => {
    // Машина входа работает для всех: minLevel/maxLevel/region обязаны быть.
    must(/'dungeon_simurgh_temple'[\s\S]{0,900}?minLevel: 80/.test(данные), 'minLevel не задан');
    must(/'dungeon_simurgh_temple'[\s\S]{0,900}?maxLevel: 90/.test(данные), 'maxLevel не задан');
    must(/'dungeon_simurgh_temple'[\s\S]{0,900}?region: Region.KHORASAN/.test(данные), 'регион не Хорасан');
    // И сама проверка общая, не под цитадель.
    must(/if \(character\.level < def\.minLevel \|\| character\.level > def\.maxLevel\)/.test(сервисДанжей),
      'проверка уровня перестала быть общей');
  });
});