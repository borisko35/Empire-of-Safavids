// Монстры названы переводом, и панель абордажа знает, какой перед ней зверь.
//
// ЧТО ЗДЕСЬ ВСКРЫТО. Сорок монстров не были переведены ни на одном языке:
// в словарях не было ни одного ключа. Имена видны в рамке прицела, в панели
// целей абордажа и в списках — игрок на en или az всю игру читал «Великий
// Симург» и «Левиафан Тебриза» по-русски.
//
// ОТДЕЛЬНО ПРО ID ЦЕЛИ АБОРДАЖА. У PvE-цели поле id — это instanceId живого
// экземпляра, а не вид монстра: перевести имя по нему невозможно, откат
// давал русский текст и выглядел как «перевод ещё не сделан». Поле monsterId
// добавлено в данные и в тип ответа маршрута.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MONSTERS_DATABASE } from '../data/monsters';
import { pveTargets } from '../systems/BoardingTargets';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const раздел = (код: string, имя: string): Record<string, string> => {
  const d = JSON.parse(читать(`shared/locales/${код}.json`))[имя];
  if (d === undefined || typeof d !== 'object') throw new Error(`${код}: раздела ${имя} нет`);
  return d as Record<string, string>;
};

const монстры = Object.entries(MONSTERS_DATABASE);
const водные = монстры.filter(([, def]) => (def as { aquatic?: boolean }).aquatic === true);

describe('Монстры переведены', () => {
  it('монстры разбираются из данных', () => {
    // Якоря на 40 и 7: разбор, молча вернувший неполный список, прошёл бы
    // проверки ниже как «переведено всё».
    must(монстры.length >= 40, `монстров ${монстры.length}, ожидалось не меньше 40`);
    must(водные.length >= 7, `водных монстров ${водные.length}, ожидалось не меньше 7`);
  });

  it('у каждого монстра есть перевод во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const d = раздел(код, 'monsters');
      for (const [id, def] of монстры) {
        const значение = d[id];
        must(typeof значение === 'string' && значение.trim() !== '',
          `${код}: у монстра ${id} нет перевода — игрок увидит «${def.nameRu}»`);
      }
    }
  });

  it('русское и английское названия совпадают с данными', () => {
    const ru = раздел('ru', 'monsters');
    const en = раздел('en', 'monsters');
    for (const [id, def] of монстры) {
      must(ru[id] === def.nameRu,
        `${id}: в данных «${def.nameRu}», в словаре «${ru[id]}» — игрок увидит разные названия`);
      must(en[id] === def.name,
        `${id}: в данных «${def.name}», в словаре «${en[id]}» — игрок увидит разные названия`);
    }
  });

  it('в разделе monsters нет ключей, которых нет среди монстров', () => {
    const id = new Set(монстры.map(([k]) => k));
    for (const код of ['ru', 'en', 'az'] as const) {
      for (const ключ of Object.keys(раздел(код, 'monsters'))) {
        must(id.has(ключ), `${код}: в monsters попал ключ ${ключ}, которого нет в данных`);
      }
    }
  });

  it('PvE-цели абордажа несут вид монстра, а не только instanceId', () => {
    // Единственная проверка, которой нет в статике: функция pveTargets
    // фильтрует по водным и отдаёт цели. Проверяется на подделке ИИ.
    const водныйId = водные[0]?.[0];
    must(typeof водныйId === 'string', 'в данных нет ни одного водного монстра');
    const подделка = {
      getAllInstances: () => [
        { instanceId: 'inst-1', monsterId: водныйId, position: { x: 10, y: 0, z: 10 } },
        // Наземный монстр не должен попадать в цели: абордаж — морской бой.
        { instanceId: 'inst-2', monsterId: монстры.find(([k]) => k === 'mob_bandit_scout')?.[0], position: { x: 11, y: 0, z: 10 } },
      ],
    };
    const цели = pveTargets(
      подделка as never,
      // Координаты атакующего обязательны: boardEligible проверяет дальность
      // по вход.x и вход.z, и без них цели отфильтровываются, проверка
      // молчит и выглядит как «функция не работает».
      {
        attackerId: 'char-1',
        attackerLevel: 100,
        attackerRegion: 'tabriz',
        attackerShard: 's1',
        x: 10,
        z: 10,
        mode: 'pve',
      } as never,
      1000,
    );
    must(цели.length >= 1, 'подделка не дала ни одной цели — проверка молчит');
    for (const цель of цели) {
      must(typeof цель.monsterId === 'string' && цель.monsterId !== '',
        `цель ${цель.id}: нет monsterId — перевести имя цели нечем`);
      must(цель.monsterId !== цель.id,
        `цель ${цель.id}: monsterId совпадает с id — это instanceId, а не вид монстра`);
      must(раздел('az', 'monsters')[цель.monsterId] !== undefined,
        `цель ${цель.id}: монстра ${цель.monsterId} нет в словаре`);
    }
  });

  it('рамка прицела и панель абордажа берут имя из перевода', () => {
    const мир = stripComments(читать('client/src/app/world.ts'));
    must(/tOr\(\s*`monsters\.\$\{/.test(мир),
      'рамка прицела печатает имя монстра по-русски — tOr(`monsters.…`) не найден');
    must(!/showTarget\(m\?\.nameRu/.test(мир),
      'в рамку прицела вернулся прямой m?.nameRu');

    const панель = stripComments(читать('client/src/app/panels.ts'));
    must(/tOr\(\s*`monsters\.\$\{/.test(панель),
      'панель абордажа не переводит имя цели — tOr(`monsters.…`) не найден');
    must(/цель\.monsterId/.test(панель),
      'панель абордажа ищет перевод по цели.id — это instanceId, перевод не найдётся');
  });
});