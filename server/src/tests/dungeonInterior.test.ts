// Сверка: точка входа каждого подземелья совпадает с комнатой ЕГО интерьера.
//
// ПОЧЕМУ ТАК ПОДРОБНО. Правило «вход не в мире, а в кармане» было верным и
// бесполезным: у гробницы вход стоял в 4968 — это карман, но не её комната.
// Комната гробницы 4704, и монстры появлялись в пустоте за 264 единицы от неё.
// Проверка проходила, потому что требовала слишком малое.
//
// Теперь сверка идёт по полю interiorId: подземелье само называет свой
// интерьер, и проверка не зависит от таблицы, написанной руками.
import { INTERIORS } from '../data/interiors';
import { DUNGEONS_DATABASE } from '../data/dungeons';

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const подземелья = Object.entries(DUNGEONS_DATABASE);

describe('Каждое подземелье живёт в своём интерьере', () => {
  it('интерьер подземелья существует', () => {
    must(подземелья.length >= 5, `подземелий ${подземелья.length}, проверка писалась под пять`);
    for (const [id, def] of подземелья) {
      must(
        typeof def.interiorId === 'string' && def.interiorId.length > 0,
        `${id}: нет поля interiorId — сверять точку входа с комнатой нечем`
      );
      must(
        INTERIORS[def.interiorId] !== undefined,
        `${id}: интерьера '${def.interiorId}' нет среди ${Object.keys(INTERIORS).length} построек`
      );
    }
  });

  it('точка входа равна комнате своего интерьера', () => {
    for (const [id, def] of подземелья) {
      const зал = INTERIORS[def.interiorId]!;
      must(
        def.entryX === зал.roomCx && def.entryZ === зал.roomCz,
        `${id}: вход (${def.entryX}, ${def.entryZ}), а комната интерьера ` +
          `'${def.interiorId}' — (${зал.roomCx}, ${зал.roomCz}): монстры появятся не в той комнате`
      );
    }
  });

  it('два подземелья не живут в одной комнате', () => {
    const комнаты = подземелья.map(([, def]) => def.entryX);
    const повторы = комнаты.filter((x, i) => комнаты.indexOf(x) !== i);
    must(
      повторы.length === 0,
      `комната ${повторы.join(', ')} занята двумя подземельями: их монстры окажутся рядом`
    );
  });

  it('у интерьера подземелья есть дверь наружу', () => {
    // Иначе в подземелье нельзя войти: дверь ставится в мире, а комната стоит в
    // кармане, и без двери игрок не найдёт входа.
    for (const [id, def] of подземелья) {
      const зал = INTERIORS[def.interiorId]!;
      must(
        typeof зал.doorX === 'number' && typeof зал.doorZ === 'number',
        `${id}: у интерьера '${def.interiorId}' нет двери — войти в подземелье нельзя`
      );
      must(
        Math.hypot(зал.doorX, зал.doorZ) < 3000,
        `${id}: дверь интерьера '${def.interiorId}' в (${зал.doorX}, ${зал.doorZ}) — ` +
          'это карман, а не улица: дверь должна быть в мире'
      );
    }
  });

  it('спавн игрока в комнате, а не в стене', () => {
    for (const [id, def] of подземелья) {
      const зал = INTERIORS[def.interiorId]!;
      const внутри =
        Math.abs(зал.spawnX - зал.roomCx) <= зал.roomHalf &&
        Math.abs(зал.spawnZ - зал.roomCz) <= зал.roomHalf;
      must(
        внутри,
        `${id}: спавн (${зал.spawnX}, ${зал.spawnZ}) вне зала ` +
          `(${зал.roomCx} ± ${зал.roomHalf}) — игрок появится в стене`
      );
    }
  });
});