// Зоны внутри регионов: границы, принадлежность точек, опасность.
//
// Зоны делят каждый регион на прямоугольные подзоны. Импортируем настоящий
// модуль — если границы сломаются, тест это увидит, а не текст в файле.
import { ZONES, getZoneAt, getZonesByRegion, REGION_LEVEL_REQUIREMENTS } from '../../../shared/constants';

describe('Система зон', () => {
  it('зоны описаны и у каждой есть регион, границы и опасность', () => {
    expect({ зон: ZONES.length }).toEqual({ зон: expect.any(Number) });
    expect(ZONES.length).toBeGreaterThan(0);
    for (const z of ZONES) {
      expect({ id: z.id, регион_известен: z.region in REGION_LEVEL_REQUIREMENTS,
        границы_заданы: Number.isFinite(z.bounds.x1) && z.bounds.x1 < z.bounds.x2,
        опасность: z.dangerLevel >= 1 && z.dangerLevel <= 5,
        есть_название: Boolean(z.nameRu) })
        .toEqual({ id: z.id, регион_известен: true, границы_заданы: true, опасность: true, есть_название: true });
    }
  });

  it('границы зон одного региона не пересекаются', () => {
    // Пересечение означало бы: игрок в точке принадлежит двум зонам сразу,
    // и getZoneAt возвращает первую попавшуюся — поведение зависит от
    // порядка в массиве, а не от того, где он стоит
    const clashes: string[] = [];
    for (const region of Object.keys(REGION_LEVEL_REQUIREMENTS)) {
      const list = getZonesByRegion(region);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i].bounds, b = list[j].bounds;
          if (a.x1 < b.x2 && b.x1 < a.x2 && a.z1 < b.z2 && b.z1 < a.z2) {
            clashes.push(`${list[i].id} × ${list[j].id}`);
          }
        }
      }
    }
    expect({ пересечения: clashes }).toEqual({ пересечения: [] });
  });

  it('getZoneAt возвращает ту зону, в чьих границах точка', () => {
    for (const z of ZONES) {
      const inside = getZoneAt((z.bounds.x1 + z.bounds.x2) / 2, (z.bounds.z1 + z.bounds.z2) / 2);
      expect({ точка_в_зоне: z.id, нашли: inside?.id }).toEqual({ точка_в_зоне: z.id, нашли: z.id });
    }
  });

  it('вне зон точка не принадлежит ни одной', () => {
    // Угол карты: WORLD_HALF = 1200, а самая дальняя зона кончается на 350
    expect({ зона: getZoneAt(1199, 1199) }).toEqual({ зона: null });
  });

  it('уровень зоны не ниже требований региона', () => {
    // Иначе игрок приходит в зону сильнее, чем регион ему разрешает, и
    // требование уровня региона показывает в общем-то смысла
    const tooLow = ZONES.filter(z => z.minLevel < (REGION_LEVEL_REQUIREMENTS[z.region] ?? 1));
    expect({ зон_ниже_региона: tooLow.map(z => z.id) }).toEqual({ зон_ниже_региона: [] });
  });

  it('у каждого региона есть хотя бы одна зона', () => {
    const безЗон = Object.keys(REGION_LEVEL_REQUIREMENTS).filter(r => getZonesByRegion(r).length === 0);
    expect({ регионов_без_зон: безЗон }).toEqual({ регионов_без_зон: [] });
  });
});
